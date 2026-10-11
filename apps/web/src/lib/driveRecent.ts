/**
 * 自驾首页「最近访问」：起终点行程 + 公路编号，localStorage 轻量索引。
 * 对标铁路侧 tripCache 的 listRecent 体验（折叠列表 + 可删除），不做行程快照。
 */

export const MAX_DRIVE_RECENT = 12;
const INDEX_KEY = 'railvista:driveRecent';

export type DriveRecentOd = {
  kind: 'od';
  key: string;
  from: string;
  to: string;
  at: number;
};

export type DriveRecentRoad = {
  kind: 'road';
  key: string;
  id: string;
  name: string;
  sub?: string;
  at: number;
};

export type DriveRecentEntry = DriveRecentOd | DriveRecentRoad;

function readRaw(): DriveRecentEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriveRecentEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e &&
        typeof e === 'object' &&
        typeof e.key === 'string' &&
        (e.kind === 'od' || e.kind === 'road'),
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: DriveRecentEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries.slice(0, MAX_DRIVE_RECENT)));
  } catch {
    /* private mode / quota */
  }
}

function upsert(entry: DriveRecentEntry) {
  const rest = readRaw().filter((e) => e.key !== entry.key);
  writeRaw([entry, ...rest]);
}

export function listDriveRecent(): DriveRecentEntry[] {
  return readRaw().sort((a, b) => b.at - a.at);
}

export function pushDriveRecentOd(from: string, to: string) {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t) return;
  upsert({
    kind: 'od',
    key: `od:${f}|${t}`,
    from: f,
    to: t,
    at: Date.now(),
  });
}

export function pushDriveRecentRoad(id: string, name: string, sub?: string) {
  const rid = id.trim();
  const n = name.trim() || rid;
  if (!rid) return;
  upsert({
    kind: 'road',
    key: `road:${rid}`,
    id: rid,
    name: n,
    sub: sub?.trim() || undefined,
    at: Date.now(),
  });
}

export function removeDriveRecent(key: string) {
  writeRaw(readRaw().filter((e) => e.key !== key));
}
