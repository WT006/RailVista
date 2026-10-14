/**
 * 行程纪念痕迹：用户「设为当前行程」时留下可载入纪念票页的 TicketConfig。
 * 与 ticketSaved（用户主动保存）分离；仅本机 localStorage。
 */
import { newTicketId, type TicketConfig, type TicketKind } from '@railvista/shared';

const TRACE_KEY = 'railvista:ticketTraces';
/** 各票种痕迹上限（铁路 / 自驾 / 飞行各自独立，超出淘汰该票种最旧） */
export const TICKET_TRACE_MAX = 5;

export type TicketTrace = {
  id: string;
  /** 铁路 tripCache key 或 driveCurrent.key，用于去重 */
  sourceKey: string;
  kind: TicketKind;
  name: string;
  updatedAt: number;
  config: TicketConfig;
};

function coreDatePart(cfg: TicketConfig): string {
  const fromText = (cfg.dateText || '').split(/[·•]/)[0]?.trim() ?? '';
  if (fromText) return fromText.replace(/\s+/g, '');
  const m = /HW-[A-Z]+-(\d{8})/i.exec(cfg.serial || '');
  if (!m?.[1]) return '';
  const d = m[1];
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

function odLabel(cfg: TicketConfig): string {
  const a = cfg.route.ends[0];
  const b = cfg.route.ends[1];
  const left = (a?.code || a?.name || '').trim();
  const right = (b?.code || b?.name || '').trim();
  if (left && right) return `${left}→${right}`;
  return left || right;
}

function traceDisplayName(cfg: TicketConfig): string {
  const od = odLabel(cfg);
  const date = coreDatePart(cfg);
  if (cfg.kind === 'railway') {
    const code = (cfg.route.middleLabel || '').trim();
    const head = [code, od].filter(Boolean).join(' ');
    return [head, date].filter(Boolean).join(' · ') || cfg.title || '铁路纪念票';
  }
  if (cfg.kind === 'flight') {
    const no = (cfg.airline?.flightNo || cfg.route.middleLabel || '').trim();
    const head = [no, od].filter(Boolean).join(' ');
    return [head, date].filter(Boolean).join(' · ') || cfg.title || '飞行纪念票';
  }
  const routeName = (cfg.subtitle || '').trim();
  const head = routeName && od && !routeName.includes('→') ? `${routeName} · ${od}` : routeName || od;
  return [head, date].filter(Boolean).join(' · ') || cfg.title || '自驾纪念票';
}

function traceFingerprint(cfg: TicketConfig): string {
  const a = (cfg.route.ends[0]?.code || cfg.route.ends[0]?.name || '').trim();
  const b = (cfg.route.ends[1]?.code || cfg.route.ends[1]?.name || '').trim();
  const date = coreDatePart(cfg);
  if (cfg.kind === 'railway') {
    return ['r', (cfg.route.middleLabel || '').trim(), a, b, date].join('|');
  }
  if (cfg.kind === 'flight') {
    const no = (cfg.airline?.flightNo || cfg.route.middleLabel || '').trim();
    return ['f', no, a, b, date].join('|');
  }
  const shields = [...(cfg.route.shields ?? [])].map((s) => s.trim()).filter(Boolean).sort().join(',');
  return ['d', (cfg.subtitle || '').trim(), a, b, shields, date].join('|');
}

function readRaw(): TicketTrace[] {
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TicketTrace[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof t.id === 'string' &&
        typeof t.sourceKey === 'string' &&
        t.config &&
        typeof t.config === 'object',
    );
  } catch {
    return [];
  }
}

/** 按票种各留最近 TICKET_TRACE_MAX 条，再按时间倒序合并 */
function pruneByKind(entries: TicketTrace[]): TicketTrace[] {
  const byKind = new Map<TicketKind, TicketTrace[]>();
  for (const t of entries) {
    const arr = byKind.get(t.kind) ?? [];
    arr.push(t);
    byKind.set(t.kind, arr);
  }
  const kept: TicketTrace[] = [];
  for (const arr of byKind.values()) {
    arr.sort((a, b) => b.updatedAt - a.updatedAt);
    kept.push(...arr.slice(0, TICKET_TRACE_MAX));
  }
  return kept.sort((a, b) => b.updatedAt - a.updatedAt);
}

function writeRaw(entries: TicketTrace[]) {
  try {
    localStorage.setItem(TRACE_KEY, JSON.stringify(pruneByKind(entries)));
  } catch {
    /* private mode / quota */
  }
}

export function listTicketTraces(kind?: TicketKind): TicketTrace[] {
  const sorted = pruneByKind(readRaw());
  const raw = readRaw();
  if (raw.length !== sorted.length) writeRaw(sorted);
  if (kind) return sorted.filter((t) => t.kind === kind);
  return sorted;
}

/**
 * 写入 / 覆盖痕迹。
 * - 同 sourceKey 优先覆盖；
 * - 否则同行程指纹覆盖；
 * - 新痕迹置顶，同票种超出上限淘汰最旧。
 */
export function upsertTicketTrace(input: {
  sourceKey: string;
  config: TicketConfig;
  name?: string;
}): TicketTrace {
  const cfg = JSON.parse(JSON.stringify(input.config)) as TicketConfig;
  const name = input.name?.trim() || traceDisplayName(cfg);
  const fp = traceFingerprint(cfg);
  const list = readRaw();
  const bySource = list.findIndex((t) => t.sourceKey === input.sourceKey);
  const byFp =
    bySource < 0 ? list.findIndex((t) => traceFingerprint(t.config) === fp) : -1;
  const hitIdx = bySource >= 0 ? bySource : byFp;
  const id = hitIdx >= 0 ? list[hitIdx]!.id : newTicketId();
  const item: TicketTrace = {
    id,
    sourceKey: input.sourceKey,
    kind: cfg.kind,
    name,
    updatedAt: Date.now(),
    config: cfg,
  };
  const rest = list.filter((_, i) => i !== hitIdx);
  writeRaw([item, ...rest]);
  return item;
}

export function getTicketTrace(id: string): TicketTrace | null {
  return readRaw().find((t) => t.id === id) ?? null;
}

export function removeTicketTrace(id: string) {
  writeRaw(readRaw().filter((t) => t.id !== id));
}
