import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { DETECT_CONFIG } from './config';
import { loadVisionAssets, type VisionAssets } from '../utils/assetLoader';
import { isIOS } from '../utils/perf';

/** 本站静态资源地址 */
export function assetUrl(path: string) {
  return new URL(import.meta.env.BASE_URL + path, document.baseURI).href;
}
export function assetBase() {
  return assetUrl('');
}

export type Delegate = 'GPU' | 'CPU';

/** GPU 初始化超过这个时间就放弃，改用 CPU（iOS/部分设备上 GPU 初始化可能卡住） */
export const GPU_INIT_TIMEOUT_MS = 8000;
const DELEGATE_KEY = 'aircanvas.delegate.v1';

function rememberCpu() {
  try {
    localStorage.setItem(DELEGATE_KEY, 'CPU');
  } catch {
    /* ignore */
  }
}

/** iOS/iPadOS 直接用 CPU；以前 GPU 失败过的设备也直接用 CPU */
export function preferCpu() {
  try {
    if (localStorage.getItem(DELEGATE_KEY) === 'CPU') return true;
  } catch {
    /* ignore */
  }
  return isIOS();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export type TrackerStage = 'download' | 'init' | 'ready';

/**
 * MediaPipe HandLandmarker 封装：资源来自本地缓存/本站/备用源，GPU 优先（带超时）失败回退 CPU。
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  delegate: Delegate = 'GPU';
  fromCache = false;
  private closed = false;
  private lastTs = 0;

  static async create(onStage?: (s: TrackerStage) => void): Promise<HandTracker> {
    const t = new HandTracker();
    await t.init(onStage);
    return t;
  }

  private async init(onStage?: (s: TrackerStage) => void) {
    onStage?.('download');
    const assets: VisionAssets = await loadVisionAssets(assetBase());
    this.fromCache = assets.fromCache;
    if (this.closed) return;
    onStage?.('init');
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = { wasmLoaderPath: assets.loaderUrl, wasmBinaryPath: assets.wasmUrl };
    const make = (delegate: Delegate) => {
      const test = (window as unknown as { __aircanvasTest?: { gpuHang?: boolean } }).__aircanvasTest;
      if (delegate === 'GPU' && test?.gpuHang) return new Promise<HandLandmarker>(() => {}); // 测试用：模拟 GPU 初始化卡死
      return vision.HandLandmarker.createFromOptions(fileset, {
        // 每次给一份拷贝，避免底层转移/占用原缓冲区
        baseOptions: { modelAssetBuffer: assets.model.slice(), delegate },
        runningMode: 'VIDEO',
        numHands: DETECT_CONFIG.numHands,
        minHandDetectionConfidence: DETECT_CONFIG.minHandDetectionConfidence,
        minHandPresenceConfidence: DETECT_CONFIG.minHandPresenceConfidence,
        minTrackingConfidence: DETECT_CONFIG.minTrackingConfidence,
      });
    };
    this.recreate = () => make('CPU');

    if (!preferCpu()) {
      const gpu = make('GPU');
      try {
        this.landmarker = await withTimeout(gpu, GPU_INIT_TIMEOUT_MS);
        this.delegate = 'GPU';
      } catch (e) {
        console.warn('[AirCanvas] GPU 初始化失败或超时，改用 CPU', e);
        rememberCpu();
        // 超时的 GPU 实例如果之后才创建好，直接关掉
        gpu.then((lm) => lm.close()).catch(() => {});
      }
    }
    if (!this.landmarker) {
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
    }
    if (this.closed) {
      this.landmarker.close();
      this.landmarker = null;
      return;
    }
    // 预热：第一次推理通常很慢（编译着色器），放在加载阶段做
    try {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      c.getContext('2d')?.fillRect(0, 0, 64, 48);
      this.lastTs = performance.now();
      this.landmarker.detectForVideo(c, this.lastTs);
    } catch (e) {
      if (this.delegate === 'GPU') {
        console.warn('[AirCanvas] GPU 预热失败，改用 CPU', e);
        rememberCpu();
        try {
          this.landmarker.close();
        } catch {
          /* ignore */
        }
        this.landmarker = await make('CPU');
        this.delegate = 'CPU';
      }
    }
    onStage?.('ready');
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
        rememberCpu();
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
