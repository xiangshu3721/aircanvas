import { GESTURE_CONFIG, type GestureConfig } from './config';
import { OneEuroFilter2D } from './oneEuro';
import type { GestureState, Vec2 } from '../types';

/** 一只候选手，坐标已映射为画布归一化坐标（0~1） */
export interface HandCandidate {
  /** 食指指尖（landmark 8），画布归一化坐标 */
  tip: Vec2;
  /** 手腕（landmark 0），画布归一化坐标，用于主手锁定 */
  wrist: Vec2;
  /** 拇指尖与食指尖距离 / 手掌大小 */
  pinchRatio: number;
  /** 手掌大小（相对视频宽度），太小视为不可靠 */
  palmSize: number;
  handedness: string;
  score: number;
  /** 在原始结果数组中的序号（调试绘制用） */
  index: number;
}

export interface StrokeSink {
  onStrokeStart(x: number, y: number, t: number): void;
  onStrokeMove(x: number, y: number, t: number): void;
  onStrokeEnd(): void;
}

export interface GestureOutput {
  state: GestureState;
  /** 平滑后的光标位置（画布归一化坐标） */
  cursor: Vec2;
  cursorVisible: boolean;
  pinchRatio: number;
  /** 当前锁定的主手在结果数组里的序号，-1 表示无 */
  primaryIndex: number;
}

/**
 * 捏合手势状态机：NO_HAND / HOVER / DRAWING / LOST
 * - 滞回阈值 + 多帧确认进入绘画
 * - 松开、丢手、换手、跳跃过大、长时间无数据 → 立即结束笔画
 * - 重新捏合一定是新笔画
 */
export class GestureMachine {
  private cfg: GestureConfig;
  private filter: OneEuroFilter2D;
  private enterCount = 0;
  private exitCount = 0;
  private lostAt = 0;
  private lastT = -1;
  private lastRaw: Vec2 | null = null;
  private lastWrist: Vec2 | null = null;
  private lockedLabel: string | null = null;
  private aspect = 1;
  readonly out: GestureOutput = {
    state: 'NO_HAND',
    cursor: { x: 0, y: 0 },
    cursorVisible: false,
    pinchRatio: 1,
    primaryIndex: -1,
  };

  constructor(private sink: StrokeSink, cfg: Partial<GestureConfig> = {}) {
    this.cfg = { ...GESTURE_CONFIG, ...cfg } as GestureConfig;
    const f = this.cfg.filter;
    this.filter = new OneEuroFilter2D(f.minCutoff, f.beta, f.dCutoff);
  }

  get state(): GestureState {
    return this.out.state;
  }

  /** 画布宽高比（宽/高），用于计算对角线距离 */
  setAspect(aspect: number) {
    if (aspect > 0 && Number.isFinite(aspect)) this.aspect = aspect;
  }

  /** 外部强制结束（例如页面隐藏、切换摄像头） */
  reset() {
    this.endStroke();
    this.out.state = 'NO_HAND';
    this.out.cursorVisible = false;
    this.out.primaryIndex = -1;
    this.enterCount = 0;
    this.exitCount = 0;
    this.lastRaw = null;
    this.lastWrist = null;
    this.lockedLabel = null;
    this.lastT = -1;
    this.filter.reset();
  }

  private endStroke() {
    if (this.out.state === 'DRAWING') {
      this.out.state = 'HOVER';
      this.sink.onStrokeEnd();
    }
    this.exitCount = 0;
  }

  /** 归一化坐标距离，按画布对角线为 1 计算 */
  private diagDist(a: Vec2, b: Vec2) {
    const w = this.aspect;
    const h = 1;
    const dx = (a.x - b.x) * w;
    const dy = (a.y - b.y) * h;
    return Math.hypot(dx, dy) / Math.hypot(w, h);
  }

  private choose(valid: HandCandidate[]): { hand: HandCandidate; switched: boolean } {
    if (this.lastWrist) {
      let best = valid[0];
      let bestD = Infinity;
      for (const h of valid) {
        const d = Math.hypot(h.wrist.x - this.lastWrist.x, h.wrist.y - this.lastWrist.y);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      return { hand: best, switched: bestD > this.cfg.handSwitchDistance };
    }
    // 没有历史位置：优先上次锁定的左右手，否则取置信度最高
    let best = valid[0];
    for (const h of valid) {
      if (this.lockedLabel && h.handedness === this.lockedLabel && best.handedness !== this.lockedLabel) best = h;
      else if ((!this.lockedLabel || h.handedness === best.handedness) && h.score > best.score) best = h;
    }
    return { hand: best, switched: false };
  }

  update(hands: readonly HandCandidate[], t: number): GestureOutput {
    const cfg = this.cfg;
    const out = this.out;
    const gap = this.lastT < 0 ? 0 : t - this.lastT;
    this.lastT = t;

    let valid: HandCandidate[] | null = null;
    for (const h of hands) {
      if (h.score >= cfg.minHandScore && h.palmSize >= cfg.minPalmSize && Number.isFinite(h.pinchRatio)) {
        (valid ??= []).push(h);
      }
    }

    if (!valid) {
      // 没有手（或置信度太低）：立即抬笔
      this.endStroke();
      if (out.state === 'HOVER') {
        out.state = 'LOST';
        this.lostAt = t;
      } else if (out.state === 'LOST' && t - this.lostAt > cfg.lostTimeoutMs) {
        out.state = 'NO_HAND';
        this.lastWrist = null;
      }
      out.cursorVisible = false;
      out.primaryIndex = -1;
      this.enterCount = 0;
      this.lastRaw = null;
      this.filter.reset();
      return out;
    }

    const { hand, switched } = this.choose(valid);
    const reacquired = out.state === 'NO_HAND' || out.state === 'LOST';
    if (switched || reacquired || gap > cfg.maxGapMs) {
      // 换了一只手 / 重新找到手 / 数据不连续：不能连到旧笔画
      this.endStroke();
      this.enterCount = 0;
      this.lastRaw = null;
      this.filter.reset();
      out.state = 'HOVER';
    }
    this.lastWrist = { x: hand.wrist.x, y: hand.wrist.y };
    this.lockedLabel = hand.handedness;
    out.primaryIndex = hand.index;
    out.pinchRatio = hand.pinchRatio;

    // 单帧跳跃过大：断笔并让光标直接跳到新位置
    if (this.lastRaw && this.diagDist(this.lastRaw, hand.tip) > cfg.maxJumpRatio) {
      this.endStroke();
      this.enterCount = 0;
      this.filter.reset();
    }
    if (this.lastRaw) {
      this.lastRaw.x = hand.tip.x;
      this.lastRaw.y = hand.tip.y;
    } else {
      this.lastRaw = { x: hand.tip.x, y: hand.tip.y };
    }

    const f = this.filter.filter(hand.tip.x, hand.tip.y, t);
    out.cursor.x = f.x;
    out.cursor.y = f.y;
    out.cursorVisible = true;

    if (out.state === 'DRAWING') {
      if (hand.pinchRatio > cfg.pinchExit) {
        this.exitCount++;
        if (this.exitCount >= cfg.exitConfirmFrames) {
          this.endStroke();
          this.enterCount = 0;
          return out;
        }
      } else {
        this.exitCount = 0;
      }
      this.sink.onStrokeMove(f.x, f.y, t);
    } else {
      if (hand.pinchRatio < cfg.pinchEnter) {
        this.enterCount++;
        if (this.enterCount >= cfg.enterConfirmFrames) {
          out.state = 'DRAWING';
          this.exitCount = 0;
          this.sink.onStrokeStart(f.x, f.y, t);
        }
      } else {
        this.enterCount = 0;
      }
    }
    return out;
  }
}
