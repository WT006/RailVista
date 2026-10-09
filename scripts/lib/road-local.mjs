/**
 * 万里路书 · 国道关系「本地」加载库（scripts/lib/road-local.mjs）
 *
 * 不依赖 Overpass：分省 PBF 里已含 road route relation（有序成员），rvwn 里已含全部 way 几何。
 *   1) buildRelIndex()  扫 31 省 PBF → 每省 { ref: [{id, role}] 有序 } 落盘
 *   2) openProvGeom()  打开省 rvwn，建 way id→index，提供 way 几何
 *   3) loadRoadRelationLocal(ref)  合并各省该编号成员 + 几何 → road-from-relation 同构输入
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanRelations } from './osm-pbf.mjs';
import { normalizeRefs } from './road-ref.mjs';
import { openRvwn } from './rvwn.mjs';

const PBF_DIR = join('data', 'cache', 'osm');
const RELINDEX_DIR = join('data', 'roads', 'rel-index');
const NET_DIR = join('data', 'roads', 'net');

export const SLUGS = existsSync(PBF_DIR)
  ? readdirSync(PBF_DIR).filter((f) => f.endsWith('.osm.pbf')).map((f) => f.replace('-latest.osm.pbf', '')).sort()
  : [];

/**
 * 扫描并落盘分省关系索引：{ ref: [{id, role}] }（仅普通国道 G3 位）。
 * 同一编号在省内若有多条关系（如方向复线，多为高速），普通国道只取成员最多的一条。
 */
export async function buildRelIndex({ force = false } = {}) {
  mkdirSync(RELINDEX_DIR, { recursive: true });
  for (const slug of SLUGS) {
    const out = join(RELINDEX_DIR, slug + '.json');
    if (!force && existsSync(out)) continue;
    const byRef = new Map(); // ref → [{id,role}]
    await scanRelations(join(PBF_DIR, slug + '-latest.osm.pbf'), (r) => {
      if (r.tags.route !== 'road') return;
      const refs = normalizeRefs(r.tags.ref);
      for (const ref of refs) {
        if (!/^G\d{3}$/.test(ref)) continue; // 只收普通国道
        const roleById = new Map();
        for (const m of r.members) if (m.type === 'way') roleById.set(m.id, m.role || '');
        const members = r.wayIds.map((id) => ({ id, role: roleById.get(id) || '' }));
        const prev = byRef.get(ref);
        if (!prev || members.length > prev.length) byRef.set(ref, members);
      }
    });
    const obj = Object.fromEntries([...byRef.entries()].map(([k, v]) => [k, v]));
    writeFileSync(out, JSON.stringify(obj));
    console.log('  ' + slug.padEnd(16) + ' 普通国道关系 ' + byRef.size);
  }
}

/** 读取分省关系索引 */
export function readRelIndex(slug) {
  const p = join(RELINDEX_DIR, slug + '.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 打开省 rvwn 并建立 way id→index（懒建，调用方负责 close） */
export function openProvGeom(slug) {
  const reader = openRvwn(join(NET_DIR, slug + '.rvwn'));
  const indexById = new Map();
  const refById = new Map();
  for (const w of reader.iterateWays()) { indexById.set(w.id, w.index); refById.set(w.id, w.ref || ''); }
  function fullOf(id) {
    const wi = indexById.get(id);
    if (wi === undefined) return null;
    const w = reader.readWay(wi);
    if (!w) return null;
    const g = reader.readWayNodes(w);
    const points = [];
    for (let i = 0; i < g.lngs.length; i += 1) points.push([g.lngs[i], g.lats[i]]);
    return { nodeIds: Array.from(g.ids), points };
  }
  function geomOf(id) {
    return fullOf(id)?.points ?? null;
  }
  /** 该省片里 ref 列表包含目标编号（含 G219;S205 共线）的全部 way id */
  function taggedIds(ref) {
    const out = [];
    for (const [id, r] of refById) {
      const parts = r.split(/[;；,，]/);
      if (parts.includes(ref)) out.push(id);
    }
    return out;
  }
  return { slug, geomOf, fullOf, has: (id) => indexById.has(id), taggedIds, close: () => reader.close() };
}

/**
 * 合并各省该国道的有序成员 + 几何，返回 road-from-relation 同构输入。
 * seq 按「省顺序 × 成员序」分配；省顺序用 SLUGS（仅用于分量排序兜底，拓扑为主）。
 */
export function loadRoadRelationLocal(ref) {
  const members = [];
  const wayGeom = new Map();
  const providers = [];
  try {
    for (const slug of SLUGS) {
      const rel = readRelIndex(slug)[ref];
      if (!rel || !rel.length) continue;
      const prov = openProvGeom(slug);
      providers.push(prov);
      const base = providers.length * 1_000_000;
      rel.forEach((m, i) => {
        if (wayGeom.has(m.id)) return;
        const geom = prov.geomOf(m.id);
        if (!geom || geom.length < 2) return;
        wayGeom.set(m.id, geom);
        members.push({ ref: m.id, role: m.role || '', seq: base + i });
      });
    }
  } finally {
    for (const p of providers) p.close();
  }
  if (!members.length) return null;
  return { id: null, members, wayGeom, tags: { ref } };
}
