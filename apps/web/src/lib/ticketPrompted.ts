/**
 * 「本趟行程已经提示过生成纪念票」的本机记录，避免每次回到完成态都再弹一次。
 * 只记 key，不记内容；key 用行程自身的缓存键（铁路 tripCacheKey / 自驾 driveTripKey）。
 */
const INDEX_KEY = 'railvista:ticketPromptedTrips';
const MAX_KEEP = 40;

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

export function hasPromptedTripTicket(key: string): boolean {
  if (!key) return false;
  return readRaw().includes(key);
}

/** 提示出现即登记（用户关掉或点了生成票都不再重复提示） */
export function markTripTicketPrompted(key: string) {
  if (!key) return;
  const list = readRaw();
  if (list.includes(key)) return;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify([key, ...list].slice(0, MAX_KEEP)));
  } catch {
    /* private mode / quota */
  }
}
