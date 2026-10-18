import { describe, expect, it } from 'vitest';
import { extractCandidates, pinchRatio } from '../src/engine/handFeatures';
import { AdaptiveScheduler } from '../src/utils/perf';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandCandidate } from '../src/engine/gestureMachine';

function lms(thumb: [number, number], index: [number, number]) {
  const a = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  a[0] = { x: 0.5, y: 0.8, z: 0, visibility: 1 };
  a[9] = { x: 0.5, y: 0.6, z: 0, visibility: 1 };
  a[4] = { x: thumb[0], y: thumb[1], z: 0, visibility: 1 };
  a[8] = { x: index[0], y: index[1], z: 0, visibility: 1 };
  return a;
}

describe('手部特征', () => {
  it('捏合比例按手掌大小归一化，与离摄像头远近无关', () => {
    const near = pinchRatio(lms([0.45, 0.5], [0.55, 0.5]), 1);
    // 手离远一半：所有距离都减半
    const far = lms([0.475, 0.5], [0.525, 0.5]);
    far[0] = { ...far[0], y: 0.7 };
    far[9] = { ...far[9], y: 0.6 };
    expect(pinchRatio(far, 1)).toBeCloseTo(near, 6);
  });
  it('考虑视频宽高比（x 方向乘以宽高比）', () => {
    const r1 = pinchRatio(lms([0.45, 0.5], [0.55, 0.5]), 1);
    const r2 = pinchRatio(lms([0.45, 0.5], [0.55, 0.5]), 4 / 3);
    expect(r2).toBeCloseTo((r1 * 4) / 3, 6);
  });
  it('extractCandidates 映射坐标（镜像）并读取左右手', () => {
    const res = {
      landmarks: [lms([0.45, 0.5], [0.8, 0.5])],
      worldLandmarks: [],
      handedness: [[{ categoryName: 'Left', score: 0.9, index: 0, displayName: '' }]],
      handednesses: [],
    } as unknown as HandLandmarkerResult;
    const out: HandCandidate[] = [];
    extractCandidates(res, { videoWidth: 640, videoHeight: 480, canvasWidth: 640, canvasHeight: 480, mirror: true }, out);
    expect(out).toHaveLength(1);
    expect(out[0].tip.x).toBeCloseTo(0.2, 6);
    expect(out[0].handedness).toBe('Left');
    expect(out[0].score).toBe(0.9);
  });
});

describe('自适应识别频率', () => {
  it('推理快时每帧都跑，推理慢时自动拉长间隔', () => {
    const s = new AdaptiveScheduler(0, 120);
    s.record(0, 5);
    expect(s.shouldRun(1)).toBe(true);
    const slow = new AdaptiveScheduler(0, 120);
    for (let i = 0; i < 20; i++) slow.record(0, 60);
    expect(slow.shouldRun(30)).toBe(false);
    expect(slow.shouldRun(121)).toBe(true);
  });
});
