/**
 * 手势模型 / 识别引擎下载器
 * - 本地缓存：Cache Storage（带版本号），第二次打开不走网络
 * - 多源：本站优先；本站太慢或失败时，自动并发尝试 jsDelivr 备用源（文件来自本仓库的 git tag），
 *   短暂竞速后只保留更快的那个；每个文件都校验大小和 SHA-256
 * - 流式读取，汇报真实下载进度
 */
import manifest from '../engine/assetManifest.json';

export interface AssetSpec {
  path: string;
  size: number;
  sha256: string;
}

export interface Source {
  name: string;
  /** 以 / 结尾的基础地址 */
  base: string;
  primary?: boolean;
}

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

export interface LoaderDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  cache: CacheLike | null;
  sha256?: (data: Uint8Array) => Promise<string>;
  now?: () => number;
}

export interface DownloadOptions {
  sources: Source[];
  /** 本站下载多久后评估是否启用备用源 */
  hedgeAfterMs?: number;
  /** 按当前速度估算剩余时间超过它，才启用备用源 */
  hedgeIfRemainingMs?: number;
  /** 多源同时下载多久后比较速度，只保留最快的 */
  compareWindowMs?: number;
  /** 某个源多久没有收到数据视为卡住 */
  stallMs?: number;
  signal?: AbortSignal;
  onProgress?: (loaded: number) => void;
  /** 缓存 key 前缀 */
  cacheKeyBase?: string;
}

export interface DownloadResult {
  data: Uint8Array;
  source: string;
  fromCache: boolean;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

class AttemptError extends Error {}

interface Attempt {
  src: Source;
  ctrl: AbortController;
  loaded: number;
  startedAt: number;
  windowStartLoaded: number;
  lastDataAt: number;
  state: 'running' | 'failed' | 'done' | 'aborted';
}

/** 下载单个文件（先查缓存，再多源竞速） */
export function downloadAsset(spec: AssetSpec, opts: DownloadOptions, deps: LoaderDeps): Promise<DownloadResult> {
  const now = deps.now ?? (() => Date.now());
  const hedgeAfter = opts.hedgeAfterMs ?? 4000;
  const hedgeIfRemaining = opts.hedgeIfRemainingMs ?? 8000;
  const compareWindow = opts.compareWindowMs ?? 3000;
  const stallMs = opts.stallMs ?? 25000;
  const cacheKey = (opts.cacheKeyBase ?? 'https://aircanvas.local/assets/') + spec.path;
  const hash = deps.sha256 ?? sha256Hex;

  return new Promise<DownloadResult>((resolve, reject) => {
    let settled = false;
    const attempts: Attempt[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let stallTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      timers.forEach(clearTimeout);
      if (stallTimer) clearInterval(stallTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (r: DownloadResult | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      for (const a of attempts) {
        if (a.state === 'running') {
          a.state = 'aborted';
          a.ctrl.abort();
        }
      }
      if (r) resolve(r);
      else reject(err);
    };
    const onAbort = () => finish(null, new DOMException('aborted', 'AbortError'));
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort);

    const report = () => {
      let best = 0;
      for (const a of attempts) if (a.state === 'running' || a.state === 'done') best = Math.max(best, a.loaded);
      opts.onProgress?.(Math.min(best, spec.size));
    };

    const startNext = (all = false) => {
      for (const src of opts.sources) {
        if (attempts.some((a) => a.src === src)) continue;
        start(src);
        if (!all) return true;
      }
      return all;
    };

    const onFail = (a: Attempt) => {
      if (settled) return;
      a.state = 'failed';
      report();
      if (attempts.some((x) => x.state === 'running')) return;
      if (!startNext()) finish(null, new Error(`所有下载源都失败了：${spec.path}`));
    };

    const start = (src: Source) => {
      const a: Attempt = { src, ctrl: new AbortController(), loaded: 0, startedAt: now(), windowStartLoaded: 0, lastDataAt: now(), state: 'running' };
      attempts.push(a);
      (async () => {
        const res = await deps.fetch(src.base + spec.path, { signal: a.ctrl.signal, mode: 'cors', credentials: 'omit' });
        if (!res.ok || !res.body) throw new AttemptError(`HTTP ${res.status}`);
        const buf = new Uint8Array(spec.size);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (a.state !== 'running') return;
          if (a.loaded + value.length > spec.size) throw new AttemptError('文件比预期大');
          buf.set(value, a.loaded);
          a.loaded += value.length;
          a.lastDataAt = now();
          report();
        }
        if (a.loaded !== spec.size) throw new AttemptError('文件不完整');
        if ((await hash(buf)) !== spec.sha256) throw new AttemptError('校验失败');
        if (settled || a.state !== 'running') return;
        a.state = 'done';
        report();
        try {
          await deps.cache?.put(cacheKey, new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(spec.size) } }));
        } catch {
          /* 缓存写不进去也不影响使用 */
        }
        finish({ data: buf, source: src.name, fromCache: false });
      })().catch(() => {
        if (a.state === 'running') onFail(a);
      });
    };

    const rate = (a: Attempt, sinceLoaded: number, since: number) => (a.loaded - sinceLoaded) / Math.max(1, now() - since);

    const begin = () => {
      start(opts.sources[0]);
      // 卡住检测
      stallTimer = setInterval(() => {
        for (const a of attempts) {
          if (a.state === 'running' && now() - a.lastDataAt > stallMs) {
            a.ctrl.abort();
            onFail(a);
          }
        }
      }, 1000);
      // 对冲：本站慢就加上备用源
      timers.push(
        setTimeout(() => {
          if (settled) return;
          const p = attempts[0];
          if (p.state === 'running') {
            const r = rate(p, 0, p.startedAt);
            const remaining = r > 0 ? (spec.size - p.loaded) / r : Infinity;
            if (remaining <= hedgeIfRemaining) return;
          }
          startNext(true);
          const windowStart = now();
          for (const a of attempts) a.windowStartLoaded = a.loaded;
          // 竞速一小段时间后只保留最快的（同等速度时本站优先）
          timers.push(
            setTimeout(() => {
              if (settled) return;
              const running = attempts.filter((a) => a.state === 'running');
              if (running.length < 2) return;
              const primary = running.find((a) => a.src.primary);
              let best = running[0];
              for (const a of running) if (rate(a, a.windowStartLoaded, windowStart) > rate(best, best.windowStartLoaded, windowStart)) best = a;
              const keep =
                primary && best !== primary && rate(best, best.windowStartLoaded, windowStart) < 1.5 * rate(primary, primary.windowStartLoaded, windowStart)
                  ? primary
                  : best;
              for (const a of running) {
                if (a !== keep) {
                  a.state = 'aborted';
                  a.ctrl.abort();
                }
              }
              report();
            }, compareWindow),
          );
        }, hedgeAfter),
      );
    };

    (async () => {
      try {
        const hit = await deps.cache?.match(cacheKey);
        if (hit) {
          const data = new Uint8Array(await hit.arrayBuffer());
          if (data.length === spec.size) {
            opts.onProgress?.(spec.size);
            return finish({ data, source: 'cache', fromCache: true });
          }
        }
      } catch {
        /* 缓存读失败就走网络 */
      }
      if (!settled) begin();
    })();
  });
}

// ---------------------------------------------------------------------------
// 应用层：识别引擎 + 模型（单例，首屏预取和点「开始」共用一次下载）
// ---------------------------------------------------------------------------

export const ASSET_VERSION = `${manifest.mediapipeVersion}-${manifest.files['models/hand_landmarker.task'].sha256.slice(0, 8)}`;
const CACHE_PREFIX = 'aircanvas-assets-';
const CACHE_NAME = CACHE_PREFIX + ASSET_VERSION;
const MIRROR_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'];

export function assetSources(selfBase: string): Source[] {
  return [
    { name: 'self', base: selfBase, primary: true },
    ...MIRROR_HOSTS.map((h) => ({ name: h, base: `https://${h}/gh/xiangshu3721/aircanvas@${manifest.mirrorTag}/` })),
  ];
}

export interface VisionAssets {
  loaderUrl: string;
  wasmUrl: string;
  model: Uint8Array;
  fromCache: boolean;
  sources: string[];
}

export interface LoadState {
  phase: 'idle' | 'downloading' | 'done' | 'error';
  loaded: number;
  total: number;
  fromCache: boolean;
  startedAt: number;
  sources: string[];
}

let state: LoadState = { phase: 'idle', loaded: 0, total: 0, fromCache: false, startedAt: 0, sources: [] };
const listeners = new Set<(s: LoadState) => void>();
let inflight: Promise<VisionAssets> | null = null;
let inflightCtrl: AbortController | null = null;

function setState(patch: Partial<LoadState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getLoadState() {
  return state;
}

export function subscribeLoadState(fn: (s: LoadState) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function openCache(): Promise<CacheLike | null> {
  try {
    if (typeof caches === 'undefined') return null;
    // 清掉旧版本
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)));
    const c = await caches.open(CACHE_NAME);
    return {
      match: (k) => c.match(k),
      put: (k, r) => c.put(k, r),
    };
  } catch {
    return null;
  }
}

/** 判断用 simd 还是 nosimd 版本（和 MediaPipe 内部判断一致） */
async function pickWasm(): Promise<'vision_wasm_internal' | 'vision_wasm_nosimd_internal'> {
  const vision = await import('@mediapipe/tasks-vision');
  const fs = await vision.FilesetResolver.forVisionTasks('x');
  return fs.wasmBinaryPath.includes('nosimd') ? 'vision_wasm_nosimd_internal' : 'vision_wasm_internal';
}

function spec(path: keyof typeof manifest.files): AssetSpec {
  return { path, ...manifest.files[path] };
}

/** 加载（或复用正在进行的加载）。fast=true 时立即启用备用源（「重试」用） */
export function loadVisionAssets(selfBase: string, fast = false): Promise<VisionAssets> {
  if (inflight) return inflight;
  const ctrl = new AbortController();
  inflightCtrl = ctrl;
  const p = (async () => {
    const base = await pickWasm();
    const specs = [spec(`wasm/${base}.js`), spec(`wasm/${base}.wasm`), spec('models/hand_landmarker.task')];
    const total = specs.reduce((n, s) => n + s.size, 0);
    const progress = specs.map(() => 0);
    setState({ phase: 'downloading', loaded: 0, total, startedAt: Date.now(), fromCache: false, sources: [] });
    const cache = await openCache();
    try {
      (navigator.storage as StorageManager | undefined)?.persist?.().catch(() => {});
    } catch {
      /* ignore */
    }
    const deps: LoaderDeps = { fetch: (u, i) => fetch(u, i), cache };
    const results = await Promise.all(
      specs.map((s, i) =>
        downloadAsset(
          s,
          {
            sources: assetSources(selfBase),
            hedgeAfterMs: fast ? 0 : 4000,
            signal: ctrl.signal,
            cacheKeyBase: new URL(`__assets__/${ASSET_VERSION}/`, selfBase).href,
            onProgress: (n) => {
              progress[i] = n;
              setState({ loaded: progress.reduce((a, b) => a + b, 0) });
            },
          },
          deps,
        ),
      ),
    );
    const [loader, wasm, model] = results;
    const fromCache = results.every((r) => r.fromCache);
    const sources = [...new Set(results.map((r) => r.source))];
    setState({ phase: 'done', loaded: total, fromCache, sources });
    return {
      loaderUrl: URL.createObjectURL(new Blob([loader.data as BlobPart], { type: 'text/javascript' })),
      wasmUrl: URL.createObjectURL(new Blob([wasm.data as BlobPart], { type: 'application/wasm' })),
      model: model.data,
      fromCache,
      sources,
    };
  })();
  inflight = p;
  p.catch((e) => {
    if (inflight === p) inflight = null;
    if (!ctrl.signal.aborted) setState({ phase: 'error' });
    throw e;
  }).catch(() => {});
  return p;
}

/** 放弃当前下载，重新开始（立即启用备用源） */
export function restartVisionAssets(selfBase: string) {
  inflightCtrl?.abort();
  inflight = null;
  return loadVisionAssets(selfBase, true);
}

/** 首屏空闲时预取（不申请摄像头）。省流量模式下不预取 */
export function prefetchVisionAssets(selfBase: string) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  loadVisionAssets(selfBase).catch(() => {});
}
