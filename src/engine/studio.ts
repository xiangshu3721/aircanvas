import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { BrushType, GestureState, StatusKind, Stroke } from '../types';
import { StrokeHistory } from './history';
import { drawStroke, drawStrokes, newStrokeId, shouldAppend, type RenderOptions } from './renderer';
import { GestureMachine, type HandCandidate, type StrokeSink } from './gestureMachine';
import { extractCandidates } from './handFeatures';
import { mapVideoToCanvas, type MapOptions } from './coordinateMapper';
import type { HandTracker } from './handTracker';
import { AdaptiveScheduler, isCoarsePointer } from '../utils/perf';
import { DETECT_CONFIG } from './config';

export interface StudioElements {
  stage: HTMLElement;
  video: HTMLVideoElement;
  /** 中层：已完成笔画（缓存） */
  done: HTMLCanvasElement;
  /** 中层：正在画的笔画 */
  live: HTMLCanvasElement;
  /** 顶层：光标、骨骼调试；同时接收鼠标/触屏事件 */
  overlay: HTMLCanvasElement;
}

export interface StudioCallbacks {
  onStatus?(s: StatusKind): void;
  onHistory?(h: { canUndo: boolean; canRedo: boolean; count: number }): void;
  onStroke?(): void;
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

type Source = 'hand' | 'pointer';

/**
 * 画布控制器：不依赖 React，负责分层画布、识别循环、鼠标/触屏输入。
 * 高频数据（光标、当前笔画）全部走 ref + 直接画 canvas，不触发 React 渲染。
 */
export class Studio {
  readonly history = new StrokeHistory();
  brush: { color: string; width: number; brushType: BrushType } = { color: '#00D2D3', width: 6, brushType: 'normal' };
  mirror = true;
  debug = false;
  trackingEnabled = false;

  private el: StudioElements;
  private cb: StudioCallbacks;
  private ctxDone: CanvasRenderingContext2D;
  private ctxLive: CanvasRenderingContext2D;
  private ctxOverlay: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private maxGlowBlur = 18;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private destroyed = false;

  private tracker: HandTracker | null = null;
  private gesture: GestureMachine;
  private scheduler = new AdaptiveScheduler(DETECT_CONFIG.minIntervalMs, DETECT_CONFIG.maxIntervalMs);
  private candidates: HandCandidate[] = [];
  private lastVideoTime = -1;
  private lastResult: HandLandmarkerResult | null = null;
  private mapOpts: MapOptions = { videoWidth: 640, videoHeight: 480, canvasWidth: 1, canvasHeight: 1, mirror: true };
  private tmpPt = { x: 0, y: 0 };

  private current: Stroke | null = null;
  private currentSource: Source | null = null;
  private liveDirty = false;
  private overlayHasContent = false;
  private renderedVersion = -1;
  private status: StatusKind = 'idle';
  private activePointer: number | null = null;
  private stats = { detections: 0, lastCost: 0 };

  constructor(el: StudioElements, cb: StudioCallbacks = {}) {
    this.el = el;
    this.cb = cb;
    this.ctxDone = el.done.getContext('2d')!;
    this.ctxLive = el.live.getContext('2d')!;
    this.ctxOverlay = el.overlay.getContext('2d')!;
    this.maxGlowBlur = isCoarsePointer() ? 10 : 18;
    const sink: StrokeSink = {
      onStrokeStart: (x, y, t) => this.beginStroke('hand', x, y, t),
      onStrokeMove: (x, y, t) => this.extendStroke('hand', x, y, t),
      onStrokeEnd: () => this.finishStroke('hand'),
    };
    this.gesture = new GestureMachine(sink);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el.stage);
    window.addEventListener('orientationchange', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.bindPointer();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- 尺寸 ----------
  resize = () => {
    if (this.destroyed) return;
    const r = this.el.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.el.done, this.el.live, this.el.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.gesture.setAspect(w / h);
    this.renderedVersion = -1; // 尺寸变化 → 按归一化坐标整体重绘
    this.liveDirty = true;
    this.redrawDone();
    this.drawLive();
  };

  get size() {
    return { width: this.w, height: this.h };
  }

  private get renderOpts(): RenderOptions {
    return { width: this.w, height: this.h, maxGlowBlur: this.maxGlowBlur };
  }

  private prep(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
  }

  /** 已完成层：只在新增笔画、撤销/重做/清空、尺寸变化时重绘 */
  private redrawDone() {
    if (this.renderedVersion === this.history.version) return;
    this.prep(this.ctxDone);
    drawStrokes(this.ctxDone, this.history.strokes, this.renderOpts);
    this.renderedVersion = this.history.version;
  }

  private drawLive() {
    if (!this.liveDirty) return;
    this.liveDirty = false;
    this.prep(this.ctxLive);
    if (this.current) drawStroke(this.ctxLive, this.current, this.renderOpts);
  }

  // ---------- 笔画 ----------
  private beginStroke(src: Source, x: number, y: number, t: number) {
    if (this.current) {
      if (this.currentSource !== src && src === 'hand') return; // 鼠标/触屏正在画，忽略手势
      this.finishStroke(this.currentSource!);
    }
    this.current = {
      id: newStrokeId(),
      color: this.brush.color,
      width: this.brush.width,
      brushType: this.brush.brushType,
      points: [{ x, y, timestamp: t }],
      createdAt: Date.now(),
    };
    this.currentSource = src;
    this.liveDirty = true;
  }

  private extendStroke(src: Source, x: number, y: number, t: number) {
    if (!this.current || this.currentSource !== src) return;
    const pts = this.current.points;
    if (shouldAppend(pts[pts.length - 1], x, y, this.w, this.h)) {
      pts.push({ x, y, timestamp: t });
      this.liveDirty = true;
    }
  }

  private finishStroke(src: Source) {
    const s = this.current;
    if (!s || this.currentSource !== src) return;
    this.current = null;
    this.currentSource = null;
    this.liveDirty = true;
    this.history.add(s);
    // 增量：只把新笔画画到缓存层，不整体重绘
    if (this.renderedVersion === this.history.version - 1) {
      this.ctxDone.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawStroke(this.ctxDone, s, this.renderOpts);
      this.renderedVersion = this.history.version;
    } else {
      this.redrawDone();
    }
    this.drawLive();
    this.emitHistory();
    this.cb.onStroke?.();
  }

  private emitHistory() {
    this.cb.onHistory?.({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      count: this.history.strokes.length,
    });
  }

  /** 正在画时先收笔，避免撤销到一半的笔画 */
  private settle() {
    if (this.current) this.finishStroke(this.currentSource!);
  }

  loadStrokes(strokes: Stroke[]) {
    this.settle();
    this.history.load(strokes);
    this.redrawDone();
    this.emitHistory();
  }

  undo() {
    this.settle();
    if (this.history.undo()) {
      this.redrawDone();
      this.emitHistory();
    }
  }
  redo() {
    this.settle();
    if (this.history.redo()) {
      this.redrawDone();
      this.emitHistory();
    }
  }
  clear() {
    this.settle();
    if (this.history.clear()) {
      this.redrawDone();
      this.emitHistory();
    }
  }

  // ---------- 鼠标 / 触屏（Pointer Events 统一） ----------
  private bindPointer() {
    const c = this.el.overlay;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('lostpointercapture', this.onUp);
    c.addEventListener('contextmenu', prevent);
  }

  private norm(e: PointerEvent) {
    const r = this.el.overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  private onDown = (e: PointerEvent) => {
    if (!e.isPrimary || this.activePointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.activePointer = e.pointerId;
    try {
      this.el.overlay.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.currentSource === 'hand') this.finishStroke('hand');
    const p = this.norm(e);
    this.beginStroke('pointer', p.x, p.y, e.timeStamp);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const r = this.el.overlay.getBoundingClientRect();
    if (list.length > 0) {
      for (const ev of list) {
        this.extendStroke('pointer', (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, ev.timeStamp);
      }
    } else {
      this.extendStroke('pointer', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.timeStamp);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.finishStroke('pointer');
  };

  // ---------- 手势识别 ----------
  setTracker(t: HandTracker | null) {
    this.tracker = t;
    this.scheduler.reset();
    this.gesture.reset();
    this.lastResult = null;
    this.lastVideoTime = -1;
  }

  setTrackingEnabled(on: boolean) {
    this.trackingEnabled = on;
    if (!on) {
      this.gesture.reset();
      this.lastResult = null;
      this.setStatus('idle');
    }
  }

  /** 切换摄像头、页面隐藏等情况下调用：立即抬笔 */
  resetGesture() {
    this.gesture.reset();
    this.lastResult = null;
    this.lastVideoTime = -1;
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.resetGesture();
      if (this.activePointer !== null) {
        this.activePointer = null;
        this.finishStroke('pointer');
      }
    }
  };

  private setStatus(s: StatusKind) {
    if (s === this.status) return;
    this.status = s;
    this.cb.onStatus?.(s);
  }

  private statusFromGesture(g: GestureState): StatusKind {
    if (g === 'DRAWING') return 'drawing';
    if (g === 'HOVER') return 'hand-found';
    return 'searching';
  }

  private detect(now: number) {
    const v = this.el.video;
    if (!this.tracker || !this.trackingEnabled || document.hidden) return;
    if (v.readyState < 2 || v.videoWidth === 0) return;
    if (v.currentTime === this.lastVideoTime) return; // 同一视频帧不重复推理
    if (!this.scheduler.shouldRun(now)) return; // 繁忙时跳帧
    this.lastVideoTime = v.currentTime;
    const t0 = performance.now();
    const res = this.tracker.detect(v, now);
    const cost = performance.now() - t0;
    this.scheduler.record(performance.now(), cost);
    this.stats.detections++;
    this.stats.lastCost = cost;
    if (!res) return;
    this.lastResult = res;
    const m = this.mapOpts;
    m.videoWidth = v.videoWidth;
    m.videoHeight = v.videoHeight;
    m.canvasWidth = this.w;
    m.canvasHeight = this.h;
    m.mirror = this.mirror;
    extractCandidates(res, m, this.candidates);
    const out = this.gesture.update(this.candidates, now);
    this.setStatus(this.statusFromGesture(out.state));
  }

  private drawOverlay() {
    const g = this.gesture.out;
    const showCursor = this.trackingEnabled && g.cursorVisible;
    const showDebug = this.trackingEnabled && this.debug && !!this.lastResult?.landmarks?.length;
    if (!showCursor && !showDebug) {
      if (this.overlayHasContent) {
        this.prep(this.ctxOverlay);
        this.overlayHasContent = false;
      }
      return;
    }
    const ctx = this.ctxOverlay;
    this.prep(ctx);
    this.overlayHasContent = true;
    if (showDebug) this.drawSkeleton(ctx);
    if (showCursor) {
      const x = g.cursor.x * this.w;
      const y = g.cursor.y * this.h;
      const color = this.brush.color;
      const r = Math.max(9, this.brush.width / 2 + 7);
      ctx.save();
      if (g.state === 'DRAWING') {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(4, this.brush.width / 2 + 2), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawSkeleton(ctx: CanvasRenderingContext2D) {
    const res = this.lastResult!;
    const m = this.mapOpts;
    const p = this.tmpPt;
    res.landmarks.forEach((lms, i) => {
      const primary = i === this.gesture.out.primaryIndex;
      ctx.lineWidth = 2;
      ctx.strokeStyle = primary ? 'rgba(46,213,115,0.9)' : 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        mapVideoToCanvas(lms[a], m, p);
        ctx.moveTo(p.x, p.y);
        mapVideoToCanvas(lms[b], m, p);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.fillStyle = primary ? '#2ED573' : 'rgba(255,255,255,0.7)';
      for (const lm of lms) {
        mapVideoToCanvas(lm, m, p);
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    });
  }

  private loop = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    try {
      this.detect(now);
    } catch (e) {
      console.warn('[AirCanvas] detect error', e);
    }
    this.redrawDone();
    this.drawLive();
    this.drawOverlay();
  };

  /** 给 E2E 测试 / 调试读取的只读信息 */
  debugInfo() {
    return {
      strokes: this.history.strokes.length,
      points: this.history.strokes.reduce((n, s) => n + s.points.length, 0),
      gesture: this.gesture.out.state,
      cursorVisible: this.gesture.out.cursorVisible,
      cursor: { ...this.gesture.out.cursor },
      hands: this.lastResult?.landmarks?.length ?? 0,
      detections: this.stats.detections,
      inferMs: Math.round(this.scheduler.averageCost * 10) / 10,
      delegate: this.tracker?.delegate ?? null,
      size: { w: this.w, h: this.h },
      lastStroke: this.history.strokes[this.history.strokes.length - 1] ?? null,
    };
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('orientationchange', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const c = this.el.overlay;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('lostpointercapture', this.onUp);
    c.removeEventListener('contextmenu', prevent);
  }
}

function prevent(e: Event) {
  e.preventDefault();
}
