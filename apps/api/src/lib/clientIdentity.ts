/**
 * 客户端身份与可信 IP。
 * - 精确任务互斥用浏览器 X-Client-Id（勿用 IP，避免 NAT 下互相取消）
 * - 限流用代理侧真实 IP（X-Real-IP / XFF 最右跳）
 */

const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function normalizeClientId(raw: string | undefined | null): string | null {
  const id = (raw || '').trim();
  if (!CLIENT_ID_RE.test(id)) return null;
  return id;
}

/** 取紧邻代理看到的客户端 IP；忽略可伪造的 XFF 最左跳 */
export function trustedClientIp(header: (name: string) => string | undefined): string {
  const real = header('x-real-ip')?.trim();
  if (real) return real;

  const xff = header('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // nginx $proxy_add_x_forwarded_for 会把真实 peer 追加在末尾
    if (parts.length) return parts[parts.length - 1]!;
  }

  return 'local';
}

/**
 * 精确任务 clientKey：优先浏览器稳定 id；无则退化为 ip:…（旧客户端/脚本兼容）
 */
export function clientKeyFromRequest(header: (name: string) => string | undefined): string {
  const fromHeader =
    normalizeClientId(header('x-client-id')) ||
    normalizeClientId(header('x-railvista-client-id'));
  if (fromHeader) return `cid:${fromHeader}`;
  return `ip:${trustedClientIp(header)}`;
}
