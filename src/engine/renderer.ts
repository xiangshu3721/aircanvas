import type { Stroke, StrokePoint } from '../types';

let idSeq = 0;
export function newStrokeId() {
  idSeq = (idSeq + 1) % 1e9;
  return `s${Date.now().toString(36)}${idSeq.toString(36)}`;
}

/** 归一化坐标 → 画布像素坐标 */
export function denormalize(p: { x: number; y: number }, w: number, h: number) {
  return { x: p.x * w, y: p.y * h };
}

export interface RenderOptions {
  /** 画布 CSS 宽高 */
  width: number;
  height: number;
  /** 荧光笔最大模糊半径（手机上调小） */
  maxGlowBlur: number;
}

/** 按当前 CSS 尺寸生成笔画路径（二次贝塞尔中点插值） */
export function tracePath(ctx: CanvasRenderingContext2D, pts: readonly StrokePoint[], w: number, h: number) {
  const n = pts.length;
  ctx.beginPath();
  if (n === 0) return;
  const x0 = pts[0].x * w;
  const y0 = pts[0].y * h;
  ctx.moveTo(x0, y0);
  if (n === 1) {
    ctx.lineTo(x0 + 0.01, y0);
    return;
  }
  if (n === 2) {
    ctx.lineTo(pts[1].x * w, pts[1].y * h);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[i].x * w;
    const cy = pts[i].y * h;
    const mx = (cx + pts[i + 1].x * w) / 2;
    const my = (cy + pts[i + 1].y * h) / 2;
    ctx.quadraticCurveTo(cx, cy, mx, my);
  }
  ctx.lineTo(pts[n - 1].x * w, pts[n - 1].y * h);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, o: RenderOptions) {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tracePath(ctx, s.points, o.width, o.height);
  if (s.brushType === 'glow') {
    // 外层：彩色发光
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = Math.min(o.maxGlowBlur, 6 + s.width * 1.2);
    ctx.stroke();
    // 内层：亮芯
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, s.width * 0.35);
    ctx.stroke();
  } else {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], o: RenderOptions) {
  for (const s of strokes) drawStroke(ctx, s, o);
}

/** 两点距离（像素）小于阈值则不追加，减少点数和内存 */
export function shouldAppend(last: StrokePoint | undefined, x: number, y: number, w: number, h: number, minPx = 1.2) {
  if (!last) return true;
  return Math.hypot((x - last.x) * w, (y - last.y) * h) >= minPx;
}
