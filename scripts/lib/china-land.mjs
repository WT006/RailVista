/**
 * 公路侧 POI 境内判定（harvest / 清库脚本）。
 * 与 packages/shared/src/drive/spotGrid.ts 的 isAdmissibleChinaPoi 保持同规则。
 */
const CJK_RE = /[\u4e00-\u9fff]/;
const CN_COUNTRY_RE =
  /^(CN|CHN|China|PRC|HK|MO|TW|中国|中华人民共和国|香港|澳门|台湾)$/i;
const FOREIGN_NAME_RE =
  /\b(Nepal|Kathmandu|Pokhara|Namche|Lukla|Sikkim|Gangtok|Thimphu|Paro|Hanuman|Chorten|Melamchi|Lobuche|Kongma|Chukhung|Everest viewpoint|Haa valley|Bahrabise|Nasim Pati)\b/i;

export function inHimalayaExteriorBand(lng, lat) {
  if (lng >= 80 && lng < 88.35 && lat >= 26.2 && lat < 28.15) return true;
  if (lng >= 88.35 && lng <= 92.2 && lat >= 26.4 && lat < 27.72) return true;
  return false;
}

/** 金门 / 马祖：福建 bbox 会扫进来，不能算厦门/福州公路景点 */
export function inKinmenMatsu(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng >= 118.2 && lng <= 118.55 && lat >= 24.16 && lat <= 24.55) return true;
  if (lng >= 119.85 && lng <= 120.55 && lat >= 25.9 && lat <= 26.45) return true;
  return false;
}

export function isAdmissibleHarvestPoi({ lng, lat, name, tags } = {}) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (inKinmenMatsu(lng, lat)) return false;
  const t = tags && typeof tags === 'object' ? tags : {};
  const country = t['addr:country'] || t['is_in:country'] || t.country;
  if (country && !CN_COUNTRY_RE.test(String(country).trim())) return false;
  const nm = String(name ?? '');
  if (inHimalayaExteriorBand(lng, lat) && !CJK_RE.test(nm)) return false;
  if (FOREIGN_NAME_RE.test(nm) && !CJK_RE.test(nm)) return false;
  return true;
}
