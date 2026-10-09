/**
 * 12306 queryByTrainNo 常返回整趟车经停，即使传了 from/to 电码。
 * 精确路线 / 行程 OD 必须再按起讫站名切片，否则会把「西宁→拉萨」扩成「重庆西→拉萨」。
 */

export type NamedOdStop = { name?: string };

function normalizeStationName(name: string): string {
  return String(name || '')
    .replace(/站$/, '')
    .trim();
}

/** 与共享包 sliceStopsByOd 一致：精确相等，或去「站」后互相 startsWith */
export function stationNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizeStationName(a);
  const nb = normalizeStationName(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

export function sliceStopsByOdNames<T extends NamedOdStop>(
  stops: T[],
  fromName: string,
  toName: string,
): T[] | null {
  if (!stops?.length || !fromName || !toName) return null;
  const iFrom = stops.findIndex((s) => !!s.name && stationNamesMatch(s.name, fromName));
  const iTo = stops.findIndex((s) => !!s.name && stationNamesMatch(s.name, toName));
  if (iFrom < 0 || iTo < 0 || iFrom >= iTo) return null;
  return stops.slice(iFrom, iTo + 1);
}
