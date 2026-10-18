export type BrushType = 'normal' | 'glow';

/** 归一化坐标点（0~1，相对画布宽高） */
export interface StrokePoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface Stroke {
  id: string;
  color: string;
  /** 线宽，CSS 像素 */
  width: number;
  brushType: BrushType;
  points: StrokePoint[];
  createdAt: number;
}

export type GestureState = 'NO_HAND' | 'HOVER' | 'DRAWING' | 'LOST';

export type AppMode = 'camera' | 'board';
export type BoardBg = 'black' | 'white';

export type CameraErrorKind =
  | 'denied'
  | 'nodevice'
  | 'busy'
  | 'unsupported'
  | 'insecure'
  | 'model'
  | 'unknown';

export interface Vec2 {
  x: number;
  y: number;
}

export type StatusKind =
  | 'idle'
  | 'camera-starting'
  | 'model-loading'
  | 'searching'
  | 'hand-found'
  | 'drawing'
  | 'paused';
