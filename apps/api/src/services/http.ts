/**
 * 统一 HTTP 超时封装。
 *
 * 背景：12306 侧原先所有 fetch 都没有 timeout，上游挂起时前端会无限转圈。
 * geocode.ts 已各自使用 AbortSignal.timeout，这里再抽一层通用封装，供 12306 链路复用。
 */

export class HttpTimeoutError extends Error {
  code = 'UPSTREAM_TIMEOUT';
  constructor(label: string, ms: number) {
    super(`${label}超时（>${ms}ms）`);
    this.name = 'HttpTimeoutError';
  }
}

export interface TimeoutOptions {
  timeoutMs?: number;
  label?: string;
}

/** 带超时的 fetch；超时抛 HttpTimeoutError（code=UPSTREAM_TIMEOUT） */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: TimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const label = opts.label ?? '上游请求';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw Object.assign(new HttpTimeoutError(label, timeoutMs), { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 给任意 Promise 套一个最后期限：到期先返回 null 让主流程继续，
 * 原始 Promise 仍可在后台继续 await（用于"先返回、后补齐"）。
 *
 * 注意：调用方必须自行给原始 Promise 挂 catch，避免 unhandled rejection。
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ value: T | null; timedOut: boolean }> {
  if (!Number.isFinite(ms) || ms <= 0) return { value: await promise, timedOut: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const value = await Promise.race([promise.then((v) => v as T | null), guard]);
    return { value: value ?? null, timedOut: value == null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 环境变量取数（非法值回退默认） */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
