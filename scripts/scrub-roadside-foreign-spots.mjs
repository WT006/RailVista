/**
 * 清掉公路景点库中的境外 / 邻国串味 / 金门马祖点，再可选重算省份。
 *
 *   node scripts/scrub-roadside-foreign-spots.mjs --dry
 *   node scripts/scrub-roadside-foreign-spots.mjs --write
 *   node scripts/scrub-roadside-foreign-spots.mjs --write --recalc-province
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inHimalayaExteriorBand,
  inKinmenMatsu,
  isAdmissibleHarvestPoi,
} from './lib/china-land.mjs';
import { provinceOfPoint } from './lib/province-bbox.mjs';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPOTS = join(R, 'data/roads/roadside-spots.json');
const REPORT = join(R, 'data/roads/scrub-foreign-spots-report.json');

const DRY = process.argv.includes('--dry');
const WRITE = process.argv.includes('--write');
const RECALC = process.argv.includes('--recalc-province');

const CJK_RE = /[\u4e00-\u9fff]/;
/** 中国陆地外包框（与 spotGrid CHINA_LAND_BBOX 对齐） */
const CHINA = { minLng: 73.5, minLat: 17.5, maxLng: 134.77, maxLat: 53.56 };

/** 官方/品牌英文：保留 */
const KEEP_EN = [
  /^mission hills\b/i,
  /^island6$/i,
  /^para site$/i,
  /^artis\s*tree$/i,
  /^ocata?\b/i,
  /^zhong yu museum$/i,
  /^yak museum$/i,
  /^wolong panda museum$/i,
];

/** 邻国语言 / 境外专名（无汉字则删） */
const FOREIGN_SCRIPT_OR_NAME = [
  /[А-Яа-яЁё]/, // 俄 / 蒙西里尔
  /[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/, // 越南
  /[가-힣]/, // 韩
  /[ก-๙]/, // 泰
  /[\u1000-\u109F]/, // 缅甸文
  /\b(núi|thác|hang |động|chợ|đèo|pháo đài|trạm |đài |bản |xã |dốc |nhà |điểm |thác\b|tham |đài truyền)\b/i,
  /\b(хабаровск|амурск|хехцир|набережная|смотровая|музей истории)\b/i,
  /\b(cát cát|bắc hà|quyết tiến|hâu thào|phùng|đồn cao|ngườm ngao|pác bó)\b/i,
  /\b(혜산|백두|형제폭포|사기문|왕재산)\b/,
  /^n[uú]i\b/i,
  /^thác\b/i,
  /^hang\b/i,
  /^g\d{3}.*,?\s*e\d+/i, // 桩号噪声 G098，E31
  /map of garz[eê]/i,
  /oracle bones/i,
  /great 360/i,
  /270°?\s*viewpoint/i,
  /viewpoint pagoda/i,
  /swimming spot/i,
  /1 cave ngay/i,
  /kyāṅjiṅ|kyangjin/i,
  /^lung m[eě]n$/i,
];

/** 允许保留的境内少数民族文字（有汉字的点不走这里） */
function isAllowedMinorityScript(name, province) {
  // 藏文：藏区省份
  if (/[\u0F00-\u0FFF]/.test(name)) {
    return ['西藏', '四川', '青海', '甘肃', '云南'].includes(province);
  }
  // 维吾尔 / 哈萨克等阿拉伯字母：新疆
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(name)) {
    return province === '新疆';
  }
  return false;
}

function inChinaLand(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= CHINA.minLng &&
    lng <= CHINA.maxLng &&
    lat >= CHINA.minLat &&
    lat <= CHINA.maxLat
  );
}

function shouldKeepEn(name) {
  return KEEP_EN.some((re) => re.test(name));
}

function dropReason(spot) {
  const lng = Number(spot.lng);
  const lat = Number(spot.lat);
  const name = String(spot.name ?? '');
  const tags = spot.osmTags || {};

  if (!inChinaLand(lng, lat)) return 'outside_china_bbox';
  if (inKinmenMatsu(lng, lat)) return 'kinmen_matsu';
  if (!isAdmissibleHarvestPoi({ lng, lat, name, tags })) return 'admissible_false';

  // 喜马拉雅南坡：无汉字即删
  if (inHimalayaExteriorBand(lng, lat) && !CJK_RE.test(name)) return 'himalaya_non_cjk';

  if (shouldKeepEn(name)) return '';
  if (CJK_RE.test(name)) return '';

  // 境内藏文 / 维吾尔文专名保留
  if (isAllowedMinorityScript(name, spot.province)) return '';

  // 无汉字 + 外语脚本/邻国名 → 删
  if (FOREIGN_SCRIPT_OR_NAME.some((re) => re.test(name))) {
    return 'foreign_script_or_name';
  }

  // 黑龙江东缘俄式点：lng≥134.5（抚远市内中文点已在上面放行）
  if (spot.province === '黑龙江' && lng >= 134.5 && /[А-Яа-яЁёA-Za-z]/.test(name)) {
    return 'heilongjiang_border_foreign';
  }

  // 其余无汉字拉丁噪声（未进 KEEP / 民族文字白名单）→ 删
  if (/^[A-Za-z0-9\s\-'’"“”\.\(\)\/,&+:;!?#°]+$/.test(name.trim())) {
    return 'latin_noise';
  }

  // 无法确认的外文脚本
  return 'non_cjk_unverified';
}

if (!DRY && !WRITE) {
  console.error('请指定 --dry 或 --write');
  process.exit(1);
}

const file = JSON.parse(readFileSync(SPOTS, 'utf8'));
const spots = Array.isArray(file.spots) ? file.spots : [];
const dropped = [];
const kept = [];

for (const s of spots) {
  const reason = dropReason(s);
  if (reason) dropped.push({ id: s.id, name: s.name, province: s.province, lng: s.lng, lat: s.lat, reason });
  else kept.push(s);
}

const byReason = {};
for (const d of dropped) byReason[d.reason] = (byReason[d.reason] || 0) + 1;

let reassigned = 0;
const moved = new Map();
if (RECALC) {
  // 与 fill-spot-province --force 一致：当前省若仍命中重叠框则保留，避免边界整批改挂
  for (const s of kept) {
    const prev = String(s.province ?? '');
    const next = provinceOfPoint(Number(s.lng), Number(s.lat), prev);
    if (!next) continue;
    if (prev && prev !== next) {
      const key = `${prev}→${next}`;
      moved.set(key, (moved.get(key) || 0) + 1);
      reassigned += 1;
    }
    s.province = next;
  }
}

const report = {
  updated: new Date().toISOString().slice(0, 10),
  before: spots.length,
  dropped: dropped.length,
  after: kept.length,
  byReason,
  reassigned,
  movedTop: [...moved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
  samples: dropped.slice(0, 40),
};

console.log(`[scrub] ${spots.length} → 删 ${dropped.length} → 剩 ${kept.length}`);
console.log('[scrub] byReason', byReason);
if (RECALC) {
  console.log(`[scrub] 省份重算改挂 ${reassigned}`);
  if (moved.size) {
    console.log(
      '改挂 TOP:',
      [...moved.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · '),
    );
  }
}

writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log('[scrub] 报告 →', REPORT);

if (WRITE && !DRY) {
  const noteExtra = `；${report.updated} 清境外/外语错挂 ${dropped.length} 条，剩 ${kept.length}${RECALC ? `，省份强制重算改挂 ${reassigned}` : ''}`;
  file.spots = kept;
  file.updated = report.updated;
  file.note = String(file.note || '').replace(/；20\d{2}-\d{2}-\d{2} 清境外\/外语错挂[^\n]*/g, '') + noteExtra;
  writeFileSync(SPOTS, `${JSON.stringify(file)}\n`);
  console.log('[scrub] 已写入', SPOTS);
} else {
  console.log('[scrub] dry-run，未写库');
}
