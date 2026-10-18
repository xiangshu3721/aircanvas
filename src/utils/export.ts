import type { Stroke } from '../types';
import { drawStrokes } from '../engine/renderer';
import { computeFit } from '../engine/coordinateMapper';
import { isCoarsePointer, isIOS } from './perf';

export interface ExportOptions {
  strokes: readonly Stroke[];
  /** 当前画布 CSS 尺寸 */
  width: number;
  height: number;
  background: string;
  /** 导出倍率，默认按 devicePixelRatio（至少 2 倍，最多 3 倍） */
  scale?: number;
  /** 只有用户勾选「包含摄像头画面」时才传 */
  video?: HTMLVideoElement | null;
  mirror?: boolean;
}

export function exportScale() {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(3, Math.max(2, dpr));
}

/** 在离屏 canvas 上重新绘制作品，不影响当前画布 */
export function renderExportCanvas(o: ExportOptions): HTMLCanvasElement {
  const scale = o.scale ?? exportScale();
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(o.width * scale));
  c.height = Math.max(1, Math.round(o.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, o.width, o.height);
  const v = o.video;
  if (v && v.videoWidth > 0) {
    const t = computeFit(v.videoWidth, v.videoHeight, o.width, o.height);
    ctx.save();
    if (o.mirror) {
      ctx.translate(o.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, t.offsetX, t.offsetY, t.srcW * t.scale, t.srcH * t.scale);
    ctx.restore();
  }
  drawStrokes(ctx, o.strokes, { width: o.width, height: o.height, maxGlowBlur: 24 });
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png');
  });
}

export function exportFileName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `AirCanvas-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'manual';

/**
 * 保存图片：手机优先系统分享 → 普通下载 → iOS 退化为让用户长按图片保存
 */
export async function saveBlob(blob: Blob, name = exportFileName()): Promise<SaveResult> {
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && isCoarsePointer() && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'AirCanvas 空中画板' });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  if (isIOS()) return 'manual';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
