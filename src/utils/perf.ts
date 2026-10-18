/**
 * 自适应识别调度：根据最近的推理耗时决定下一次识别间隔。
 * 推理快 → 每个新视频帧都识别；推理慢（手机/CPU）→ 自动跳帧，保证渲染流畅。
 */
export class AdaptiveScheduler {
  private avg = 0;
  private nextAt = 0;
  constructor(
    private minInterval = 0,
    private maxInterval = 120,
  ) {}

  get averageCost() {
    return this.avg;
  }

  shouldRun(now: number) {
    return now >= this.nextAt;
  }

  /** 记录一次推理耗时（毫秒） */
  record(now: number, cost: number) {
    this.avg = this.avg === 0 ? cost : this.avg * 0.85 + cost * 0.15;
    // 推理占用超过一半帧预算时，留出时间给渲染
    const interval = Math.min(this.maxInterval, Math.max(this.minInterval, this.avg * 1.6 - 16));
    this.nextAt = now + interval;
  }

  reset() {
    this.avg = 0;
    this.nextAt = 0;
  }
}

export function isCoarsePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
