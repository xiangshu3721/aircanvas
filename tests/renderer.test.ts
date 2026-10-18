import { describe, expect, it } from 'vitest';
import { denormalize, shouldAppend, tracePath } from '../src/engine/renderer';
import type { StrokePoint } from '../src/types';

/** 记录绘图调用的假 context */
function fakeCtx() {
  const calls: [string, ...number[]][] = [];
  return {
    calls,
    beginPath: () => calls.push(['beginPath']),
    moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
    lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
    quadraticCurveTo: (a: number, b: number, c: number, d: number) => calls.push(['quad', a, b, c, d]),
  };
}

const pts: StrokePoint[] = [
  { x: 0.1, y: 0.2, timestamp: 0 },
  { x: 0.3, y: 0.4, timestamp: 1 },
  { x: 0.5, y: 0.2, timestamp: 2 },
  { x: 0.7, y: 0.6, timestamp: 3 },
];

describe('归一化坐标与重绘', () => {
  it('denormalize 按画布尺寸换算', () => {
    expect(denormalize({ x: 0.5, y: 0.25 }, 800, 400)).toEqual({ x: 400, y: 100 });
  });
  it('尺寸变化后按比例重绘：所有坐标按新尺寸等比缩放', () => {
    const a = fakeCtx();
    const b = fakeCtx();
    tracePath(a as unknown as CanvasRenderingContext2D, pts, 1000, 500);
    tracePath(b as unknown as CanvasRenderingContext2D, pts, 390, 844);
    expect(a.calls.length).toBe(b.calls.length);
    for (let i = 0; i < a.calls.length; i++) {
      const [na, ...va] = a.calls[i];
      const [nb, ...vb] = b.calls[i];
      expect(na).toBe(nb);
      for (let k = 0; k < va.length; k++) {
        const scale = k % 2 === 0 ? 390 / 1000 : 844 / 500;
        expect(vb[k]).toBeCloseTo(va[k] * scale, 6);
      }
    }
  });
  it('二次贝塞尔中点插值：控制点是原始点，终点是相邻点中点', () => {
    const c = fakeCtx();
    tracePath(c as unknown as CanvasRenderingContext2D, pts, 100, 100);
    expect(c.calls[1]).toEqual(['moveTo', 10, 20]);
    const q = c.calls[2];
    expect(q[0]).toBe('quad');
    expect(q[1]).toBeCloseTo(30);
    expect(q[2]).toBeCloseTo(40);
    expect(q[3]).toBeCloseTo(40);
    expect(q[4]).toBeCloseTo(30);
    expect(c.calls[c.calls.length - 1]).toEqual(['lineTo', 70, 60]);
  });
  it('单点笔画也能画出一个点', () => {
    const c = fakeCtx();
    tracePath(c as unknown as CanvasRenderingContext2D, [pts[0]], 100, 100);
    expect(c.calls.some((x) => x[0] === 'lineTo')).toBe(true);
  });
  it('shouldAppend 过滤过近的点', () => {
    expect(shouldAppend(undefined, 0.5, 0.5, 100, 100)).toBe(true);
    expect(shouldAppend(pts[0], 0.1001, 0.2, 1000, 1000)).toBe(false);
    expect(shouldAppend(pts[0], 0.11, 0.2, 1000, 1000)).toBe(true);
  });
});
