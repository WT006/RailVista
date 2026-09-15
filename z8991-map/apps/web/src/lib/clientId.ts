const STORAGE_KEY = 'railvista:clientId';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 浏览器稳定客户端 id，供精确任务互斥（勿与 IP 绑定） */
export function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // 隐私模式等：会话内至少保持稳定
    const g = globalThis as { __railvistaClientId?: string };
    if (!g.__railvistaClientId) g.__railvistaClientId = randomId();
    return g.__railvistaClientId;
  }
}
