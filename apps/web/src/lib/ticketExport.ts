/**
 * 纪念票票面 → PNG（html-to-image）与本机下载。
 * 仅在本机生成，不上云。
 */
import { toPng } from 'html-to-image';

/** 等容器内图片与字体就绪，减少截图缺图/缺字 */
async function waitForCaptureReady(el: HTMLElement) {
  await document.fonts.ready.catch(() => undefined);
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
    ),
  );
}

export async function captureTicketPng(el: HTMLElement, pixelRatio = 2): Promise<string> {
  await waitForCaptureReady(el);
  return toPng(el, {
    pixelRatio,
    cacheBust: true,
    // 透明边不裁；票面自身已有圆角与底色
    backgroundColor: undefined,
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ticketDownloadName(name: string, serial?: string): string {
  const base = (name || '纪念票').replace(/[\\/:*?"<>|]+/g, '_').trim() || '纪念票';
  const suffix = serial?.replace(/[\\/:*?"<>|\s]+/g, '_') || String(Date.now());
  return `${base}-${suffix}.png`;
}
