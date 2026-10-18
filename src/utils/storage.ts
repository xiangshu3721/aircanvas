import type { AppMode, BoardBg, BrushType, Stroke } from '../types';

/**
 * 作品自动保存到浏览器本地（localStorage），不上传任何数据。
 */
export const ARTWORK_KEY = 'aircanvas.artwork.v1';

export interface SavedArtwork {
  v: 1;
  strokes: Stroke[];
  color: string;
  width: number;
  brush: BrushType;
  boardBg: BoardBg;
  mode: AppMode;
  savedAt: number;
}

export type SaveOutcome = 'ok' | 'quota' | 'unavailable';

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** 压缩：坐标保留 4 位小数，时间戳改为相对笔画开始的整数毫秒 */
export function serializeArtwork(a: Omit<SavedArtwork, 'v' | 'savedAt'>): string {
  const strokes = a.strokes.map((s) => {
    const t0 = s.points[0]?.timestamp ?? 0;
    return {
      id: s.id,
      c: s.color,
      w: s.width,
      b: s.brushType,
      t: s.createdAt,
      p: s.points.flatMap((p) => [r4(p.x), r4(p.y), Math.round(p.timestamp - t0)]),
    };
  });
  return JSON.stringify({ v: 1, color: a.color, width: a.width, brush: a.brush, boardBg: a.boardBg, mode: a.mode, savedAt: Date.now(), strokes });
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function deserializeArtwork(raw: string | null): SavedArtwork | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !Array.isArray(d.strokes)) return null;
    const strokes: Stroke[] = [];
    for (const s of d.strokes) {
      if (!s || !Array.isArray(s.p) || typeof s.c !== 'string' || !isNum(s.w)) continue;
      const points = [];
      for (let i = 0; i + 2 < s.p.length; i += 3) {
        const [x, y, t] = [s.p[i], s.p[i + 1], s.p[i + 2]];
        if (isNum(x) && isNum(y) && isNum(t)) points.push({ x, y, timestamp: t });
      }
      if (points.length === 0) continue;
      strokes.push({
        id: String(s.id ?? Math.random().toString(36).slice(2)),
        color: s.c,
        width: s.w,
        brushType: s.b === 'glow' ? 'glow' : 'normal',
        points,
        createdAt: isNum(s.t) ? s.t : Date.now(),
      });
    }
    return {
      v: 1,
      strokes,
      color: typeof d.color === 'string' ? d.color : '#00D2D3',
      width: isNum(d.width) ? d.width : 6,
      brush: d.brush === 'glow' ? 'glow' : 'normal',
      boardBg: d.boardBg === 'white' ? 'white' : 'black',
      mode: d.mode === 'board' ? 'board' : 'camera',
      savedAt: isNum(d.savedAt) ? d.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadArtwork(storage: Storage | null = getStorage()): SavedArtwork | null {
  try {
    return deserializeArtwork(storage?.getItem(ARTWORK_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveArtwork(a: Omit<SavedArtwork, 'v' | 'savedAt'>, storage: Storage | null = getStorage()): SaveOutcome {
  if (!storage) return 'unavailable';
  try {
    storage.setItem(ARTWORK_KEY, serializeArtwork(a));
    return 'ok';
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    return /quota/i.test(name) || (e as { code?: number })?.code === 22 ? 'quota' : 'unavailable';
  }
}

/** 节流保存：连续调用时最多每 wait 毫秒真正写一次，且保证最后一次一定写入 */
export function createThrottledSaver(save: () => void, wait = 600) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const run = () => {
    timer = null;
    last = Date.now();
    save();
  };
  return {
    schedule() {
      if (timer) return;
      const delay = Math.max(0, wait - (Date.now() - last));
      timer = setTimeout(run, delay);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
