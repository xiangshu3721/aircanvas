import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { DETECT_CONFIG } from './config';

/** 运行时资源全部来自本站 public/ 目录，不依赖任何海外 CDN */
export function assetUrl(path: string) {
  return new URL(import.meta.env.BASE_URL + path, document.baseURI).href;
}

export type Delegate = 'GPU' | 'CPU';

/**
 * MediaPipe HandLandmarker 封装：懒加载、GPU 优先失败回退 CPU、只创建一次。
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  delegate: Delegate = 'GPU';
  private closed = false;
  private lastTs = 0;

  static async create(onProgress?: (msg: string) => void): Promise<HandTracker> {
    const t = new HandTracker();
    await t.init(onProgress);
    return t;
  }

  private async init(onProgress?: (msg: string) => void) {
    onProgress?.('加载识别引擎…');
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(assetUrl('wasm'));
    onProgress?.('加载手势模型…');
    const modelAssetPath = assetUrl('models/hand_landmarker.task');
    const make = (delegate: Delegate) =>
      vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numHands: DETECT_CONFIG.numHands,
        minHandDetectionConfidence: DETECT_CONFIG.minHandDetectionConfidence,
        minHandPresenceConfidence: DETECT_CONFIG.minHandPresenceConfidence,
        minTrackingConfidence: DETECT_CONFIG.minTrackingConfidence,
      });
    try {
      this.landmarker = await make('GPU');
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('[AirCanvas] GPU 初始化失败，改用 CPU', e);
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
    }
    this.recreate = () => make('CPU');
  }

  private recreate: (() => Promise<HandLandmarker>) | null = null;
  private recreating = false;

  /** 同一时间戳不会重复推理；GPU 运行出错时自动切到 CPU */
  detect(video: HTMLVideoElement, now: number): HandLandmarkerResult | null {
    if (!this.landmarker || this.closed || this.recreating) return null;
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    try {
      return this.landmarker.detectForVideo(video, ts);
    } catch (e) {
      if (this.delegate === 'GPU' && this.recreate) {
        console.warn('[AirCanvas] GPU 推理出错，切换到 CPU', e);
        this.recreating = true;
        const old = this.landmarker;
        this.landmarker = null;
        try {
          old.close();
        } catch {
          /* ignore */
        }
        this.recreate()
          .then((lm) => {
            if (this.closed) lm.close();
            else {
              this.landmarker = lm;
              this.delegate = 'CPU';
            }
          })
          .catch((err) => console.warn('[AirCanvas] CPU 重建失败', err))
          .finally(() => (this.recreating = false));
      }
      return null;
    }
  }

  close() {
    this.closed = true;
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }
}
