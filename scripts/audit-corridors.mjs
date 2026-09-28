/**
 * 走廊数据体检（v3 修复 P1-6-2）——stationsHint 站坐标与走廊折线的偏差扫描。
 *
 * 背景：站级硬门禁（P0-1）把投影阈值收紧到 10/6km 后，走廊 stationsHint 中
 * 「站名在走廊里、坐标却离线几十上百公里」的缺口会直接导致整条走廊结果被拒，
 * 车被迫改走拓扑/OSM。本脚本离线扫描全部预置走廊，输出需要补几何/改 hint 的站，
 * 供 P1-6 数据补齐按清单作业（已知命中：湛海-海口、呼准鄂-东胜东、
 * 京广-英德/韶关东/乐昌）。
 *
 * 用法：
 *   node scripts/audit-corridors.mjs                  # 输出投影 >10km 的站
 *   node scripts/audit-corridors.mjs --max-km 6       # 按高铁阈值
 *   node scripts/audit-corridors.mjs --json out.json
 *   node scripts/audit-corridors.mjs --md docs/corridor-audit-report.md
 *   node scripts/audit-corridors.mjs --strict          # 有超阈站时退出码 1
 *
 * 纯离线脚本：只读 data/presets/corridors/*.json 与 data/stations-geo.json。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../data/presets/corridors');
const stationsGeoPath = join(__dirname, '../data/stations-geo.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  return {
    maxKm: Number(opt('--max-km', '10')),
    jsonPath: opt('--json', null),
    mdPath: opt('--md', null),
    strict: args.includes('--strict'),
  };
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointToSegmentKm(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return haversineKm(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return haversineKm(px, py, x1 + t * dx, y1 + t * dy);
}

function projectToPolylineKm(lng, lat, coords) {
  let min = Infinity;
  let idx = -1;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegmentKm(
      lng,
      lat,
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1],
    );
    if (d < min) {
      min = d;
      idx = i;
    }
  }
  return { distKm: min, idx };
}

function normalizeName(name) {
  return String(name || '').replace(/站$/g, '').trim();
}

function main() {
  const cfg = parseArgs();
  const stationsGeo = JSON.parse(readFileSync(stationsGeoPath, 'utf8'));
  const files = readdirSync(corridorsDir).filter((f) => f.endsWith('.json'));

  const bad = [];
  let corridorCount = 0;
  let hintChecked = 0;
  let hintNoCoord = 0;

  for (const file of files) {
    let c;
    try {
      c = JSON.parse(readFileSync(join(corridorsDir, file), 'utf8'));
    } catch {
      continue;
    }
    const railway = Array.isArray(c.railway) ? c.railway : [];
    const hints = Array.isArray(c.stationsHint) ? c.stationsHint : [];
    if (!c.id || railway.length < 2 || hints.length < 2) continue;
    corridorCount += 1;

    for (const hint of hints) {
      const name = normalizeName(hint);
      const geo = stationsGeo[name];
      if (!geo || geo.lng == null || geo.lat == null) {
        hintNoCoord += 1;
        continue;
      }
      hintChecked += 1;
      const proj = projectToPolylineKm(Number(geo.lng), Number(geo.lat), railway);
      if (proj.distKm > cfg.maxKm) {
        bad.push({
          corridorId: c.id,
          corridorName: c.name || '',
          station: name,
          distKm: Number(proj.distKm.toFixed(1)),
          projIdx: proj.idx,
          railwayPts: railway.length,
        });
      }
    }
  }

  bad.sort((a, b) => b.distKm - a.distKm);

  console.log(
    `走廊 ${corridorCount} 条；有坐标 hint 投影检查 ${hintChecked} 站次；hint 无坐标 ${hintNoCoord}；>${cfg.maxKm}km 命中 ${bad.length}`,
  );
  for (const b of bad) {
    console.log(
      `  ${b.distKm.toFixed(1).padStart(6)}km  ${b.corridorId}（${b.corridorName}）  ${b.station}  @idx${b.projIdx}/${b.railwayPts}`,
    );
  }

  if (cfg.jsonPath) {
    writeFileSync(
      cfg.jsonPath,
      JSON.stringify(
        {
          scannedAt: new Date().toISOString(),
          maxKm: cfg.maxKm,
          corridorCount,
          hintChecked,
          hintNoCoord,
          bad,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`JSON: ${cfg.jsonPath}`);
  }

  if (cfg.mdPath) {
    const lines = [
      '# 走廊几何缺口体检',
      '',
      `> 时间：${new Date().toISOString()}`,
      `> 阈值：stationsHint 站投影 > ${cfg.maxKm}km`,
      `> 走廊 ${corridorCount} 条；检查 ${hintChecked} 站次；hint 无坐标 ${hintNoCoord}；命中 ${bad.length}`,
      '',
      '| 偏差km | 走廊 | 名称 | 站 | 投影位置 |',
      '|---|---|---|---|---|',
    ];
    for (const b of bad) {
      lines.push(
        `| ${b.distKm} | ${b.corridorId} | ${b.corridorName} | ${b.station} | idx${b.projIdx}/${b.railwayPts} |`,
      );
    }
    lines.push('');
    lines.push('## stationsHint 缺坐标的站（另需 P1-6 补 geocode）');
    lines.push('');
    lines.push(`共 ${hintNoCoord} 站次（跨走廊重复计数），用 --json 扩展或 geocode 流程补齐。`);
    writeFileSync(cfg.mdPath, lines.join('\n'), 'utf8');
    console.log(`Markdown: ${cfg.mdPath}`);
  }

  if (cfg.strict && bad.length) process.exit(1);
}

main();
