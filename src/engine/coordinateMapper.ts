import type { Vec2 } from '../types';

export type Rotation = 0 | 90 | 180 | 270;

export interface MapOptions {
  /** 原始视频帧宽高（video.videoWidth / videoHeight） */
  videoWidth: number;
  videoHeight: number;
  /** 画布显示尺寸（CSS 像素） */
  canvasWidth: number;
  canvasHeight: number;
  /** 是否镜像显示（前置摄像头通常为 true） */
  mirror: boolean;
  /** 视频帧需要顺时针旋转多少度才是正的（大多数浏览器已自动处理，为 0） */
  rotation?: Rotation;
  /** 视频显示方式，目前和 CSS 保持一致用 cover */
  fit?: 'cover' | 'contain';
}

export interface CoverTransform {
  /** 旋转后的视频宽高 */
  srcW: number;
  srcH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 计算 object-fit 的缩放与偏移（与 CSS 行为一致：居中裁切） */
export function computeFit(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  rotation: Rotation = 0,
  fit: 'cover' | 'contain' = 'cover',
): CoverTransform {
  const swap = rotation === 90 || rotation === 270;
  const srcW = swap ? videoHeight : videoWidth;
  const srcH = swap ? videoWidth : videoHeight;
  const sx = canvasWidth / srcW;
  const sy = canvasHeight / srcH;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return {
    srcW,
    srcH,
    scale,
    offsetX: (canvasWidth - srcW * scale) / 2,
    offsetY: (canvasHeight - srcH * scale) / 2,
  };
}

/** 把归一化点按顺时针旋转 rotation 度（在 0~1 空间内） */
export function rotateNormalized(x: number, y: number, rotation: Rotation, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  switch (rotation) {
    case 90:
      out.x = 1 - y;
      out.y = x;
      break;
    case 180:
      out.x = 1 - x;
      out.y = 1 - y;
      break;
    case 270:
      out.x = y;
      out.y = 1 - x;
      break;
    default:
      out.x = x;
      out.y = y;
  }
  return out;
}

/**
 * 把 MediaPipe 输出的归一化坐标（相对原始视频帧）映射为画布上的 CSS 像素坐标。
 * 顺序：旋转 → 镜像 → cover 缩放裁切。
 * 镜像时：用户把手往自己的左边移，光标就往用户看到的左边走。
 */
export function mapVideoToCanvas(pt: Vec2, opts: MapOptions, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const rotation = opts.rotation ?? 0;
  rotateNormalized(pt.x, pt.y, rotation, out);
  if (opts.mirror) out.x = 1 - out.x;
  const t = computeFit(opts.videoWidth, opts.videoHeight, opts.canvasWidth, opts.canvasHeight, rotation, opts.fit);
  out.x = t.offsetX + out.x * t.srcW * t.scale;
  out.y = t.offsetY + out.y * t.srcH * t.scale;
  return out;
}

/** 同上，但输出相对画布的归一化坐标（0~1，可能超出范围表示在可见区域外） */
export function mapVideoToCanvasNormalized(pt: Vec2, opts: MapOptions, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  mapVideoToCanvas(pt, opts, out);
  out.x /= opts.canvasWidth;
  out.y /= opts.canvasHeight;
  return out;
}
