import { beforeEach, describe, expect, it } from 'vitest';
import { GestureMachine, type HandCandidate, type StrokeSink } from '../src/engine/gestureMachine';
import { GESTURE_CONFIG } from '../src/engine/config';

type Ev = { type: 'start' | 'move' | 'end'; x?: number; y?: number };

function hand(x: number, y: number, pinch: number, extra: Partial<HandCandidate> = {}): HandCandidate {
  return {
    tip: { x, y },
    wrist: { x, y: y + 0.2 },
    pinchRatio: pinch,
    palmSize: 0.12,
    handedness: 'Right',
    score: 0.95,
    index: 0,
    ...extra,
  };
}

const OPEN = 0.9;
const PINCH = 0.1;
const MID = (GESTURE_CONFIG.pinchEnter + GESTURE_CONFIG.pinchExit) / 2;

describe('GestureMachine 捏合状态机', () => {
  let events: Ev[];
  let gm: GestureMachine;
  let t: number;
  const step = (hands: HandCandidate[]) => {
    t += 33;
    return gm.update(hands, t);
  };
  const starts = () => events.filter((e) => e.type === 'start').length;
  const ends = () => events.filter((e) => e.type === 'end').length;

  beforeEach(() => {
    events = [];
    const sink: StrokeSink = {
      onStrokeStart: (x, y) => events.push({ type: 'start', x, y }),
      onStrokeMove: (x, y) => events.push({ type: 'move', x, y }),
      onStrokeEnd: () => events.push({ type: 'end' }),
    };
    gm = new GestureMachine(sink);
    gm.setAspect(16 / 9);
    t = 1000;
  });

  it('初始无手 → NO_HAND，出现张开的手 → HOVER，不画', () => {
    expect(step([]).state).toBe('NO_HAND');
    const o = step([hand(0.5, 0.5, OPEN)]);
    expect(o.state).toBe('HOVER');
    expect(o.cursorVisible).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('多帧确认：单帧捏合不会开始画，连续 2 帧才开始', () => {
    step([hand(0.5, 0.5, OPEN)]);
    step([hand(0.5, 0.5, PINCH)]);
    expect(starts()).toBe(0);
    step([hand(0.5, 0.5, OPEN)]); // 抖动一帧，计数清零
    step([hand(0.5, 0.5, PINCH)]);
    expect(starts()).toBe(0);
    const o = step([hand(0.5, 0.5, PINCH)]);
    expect(o.state).toBe('DRAWING');
    expect(starts()).toBe(1);
  });

  it('滞回：介于进入/退出阈值之间时，未画时不开始、画时不停止', () => {
    step([hand(0.5, 0.5, OPEN)]);
    for (let i = 0; i < 5; i++) step([hand(0.5, 0.5, MID)]);
    expect(starts()).toBe(0);
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    expect(gm.state).toBe('DRAWING');
    for (let i = 0; i < 5; i++) step([hand(0.5 + i * 0.01, 0.5, MID)]);
    expect(gm.state).toBe('DRAWING');
    expect(ends()).toBe(0);
    expect(events.filter((e) => e.type === 'move').length).toBe(5);
  });

  it('松开立即抬笔，松开后移动不再画', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.52, 0.5, PINCH)]);
    step([hand(0.53, 0.5, OPEN)]);
    expect(gm.state).toBe('HOVER');
    expect(ends()).toBe(1);
    const before = events.length;
    for (let i = 0; i < 5; i++) step([hand(0.55 + i * 0.01, 0.5, OPEN)]);
    expect(events.length).toBe(before);
  });

  it('重新捏合一定是新笔画（先 end 再 start）', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, OPEN)]);
    step([hand(0.6, 0.5, PINCH)]);
    step([hand(0.6, 0.5, PINCH)]);
    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start']);
  });

  it('画到一半手离开：立即抬笔进入 LOST，超时后 NO_HAND；手回来需重新捏合确认', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    const o = step([]);
    expect(o.state).toBe('LOST');
    expect(o.cursorVisible).toBe(false);
    expect(ends()).toBe(1);
    // 手回来时还捏着：不会立刻接上，需要重新确认，且是新笔画
    step([hand(0.52, 0.5, PINCH)]);
    expect(starts()).toBe(1);
    step([hand(0.52, 0.5, PINCH)]);
    expect(starts()).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start']);
    // 超时变 NO_HAND
    step([]);
    t += GESTURE_CONFIG.lostTimeoutMs + 10;
    expect(gm.update([], t).state).toBe('NO_HAND');
  });

  it('置信度低 / 手掌太小视为丢失', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    expect(step([hand(0.5, 0.5, PINCH, { score: 0.2 })]).state).toBe('LOST');
    expect(ends()).toBe(1);
    step([hand(0.5, 0.5, OPEN)]);
    expect(step([hand(0.5, 0.5, OPEN, { palmSize: 0.01 })]).state).toBe('LOST');
  });

  it('快速跳跃断笔：单帧跳太远时结束笔画，不连成长直线', () => {
    step([hand(0.1, 0.5, PINCH)]);
    step([hand(0.1, 0.5, PINCH)]);
    step([hand(0.12, 0.5, PINCH)]);
    step([hand(0.9, 0.5, PINCH)]); // 跳跃
    expect(ends()).toBe(1);
    const moveXs = events.filter((e) => e.type === 'move').map((e) => e.x!);
    expect(Math.max(...moveXs)).toBeLessThan(0.5);
    // 继续捏着会在新位置开始新笔画
    step([hand(0.9, 0.5, PINCH)]);
    expect(starts()).toBe(2);
    const last = events.filter((e) => e.type === 'start').pop()!;
    expect(last.x!).toBeGreaterThan(0.8);
  });

  it('长时间没有数据（卡顿）断笔', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    t += 1000;
    gm.update([hand(0.51, 0.5, PINCH)], t);
    expect(ends()).toBe(1);
  });

  it('多手：锁定离上一帧最近的主手，不在两手间跳', () => {
    const a = (x: number, p = PINCH) => hand(x, 0.5, p, { handedness: 'Right', index: 0 });
    const b = (x: number, p = OPEN) => hand(x, 0.5, p, { handedness: 'Left', index: 1 });
    step([a(0.3)]);
    step([a(0.3)]);
    expect(gm.state).toBe('DRAWING');
    for (let i = 0; i < 5; i++) {
      const o = step([b(0.8), a(0.31 + i * 0.01)]);
      expect(o.primaryIndex).toBe(0);
    }
    const xs = events.filter((e) => e.type === 'move').map((e) => e.x!);
    expect(Math.max(...xs)).toBeLessThan(0.5);
    expect(ends()).toBe(0);
  });

  it('多手：主手消失、只剩远处另一只手 → 结束旧笔画，两手轨迹不相连', () => {
    step([hand(0.2, 0.5, PINCH)]);
    step([hand(0.2, 0.5, PINCH)]);
    step([hand(0.21, 0.5, PINCH)]);
    step([hand(0.8, 0.5, PINCH, { handedness: 'Left', index: 1 })]);
    expect(ends()).toBe(1);
    step([hand(0.8, 0.5, PINCH, { handedness: 'Left', index: 1 })]);
    step([hand(0.8, 0.5, PINCH, { handedness: 'Left', index: 1 })]);
    expect(starts()).toBe(2);
  });

  it('reset() 立即抬笔', () => {
    step([hand(0.5, 0.5, PINCH)]);
    step([hand(0.5, 0.5, PINCH)]);
    gm.reset();
    expect(ends()).toBe(1);
    expect(gm.state).toBe('NO_HAND');
  });

  it('光标经过平滑：静止抖动被抑制', () => {
    step([hand(0.5, 0.5, OPEN)]);
    let maxDev = 0;
    for (let i = 0; i < 30; i++) {
      const o = step([hand(0.5 + (i % 2 ? 0.004 : -0.004), 0.5, OPEN)]);
      maxDev = Math.max(maxDev, Math.abs(o.cursor.x - 0.5));
    }
    expect(maxDev).toBeLessThan(0.004);
  });

  it('光标快速移动时延迟低（3 帧内追上 80% 以上）', () => {
    step([hand(0.3, 0.5, OPEN)]);
    let o = step([hand(0.3, 0.5, OPEN)]);
    for (let i = 1; i <= 3; i++) o = step([hand(0.3 + i * 0.05, 0.5, OPEN)]);
    expect(o.cursor.x).toBeGreaterThan(0.3 + 0.15 * 0.8);
  });
});
