import { describe, expect, it } from 'vitest';
import { computeFit, mapVideoToCanvas, mapVideoToCanvasNormalized, rotateNormalized } from '../src/engine/coordinateMapper';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('computeFit (object-fit: cover)', () => {
  it('同宽高比：无裁切', () => {
    const t = computeFit(640, 480, 1280, 960);
    close(t.scale, 2);
    close(t.offsetX, 0);
    close(t.offsetY, 0);
  });
  it('竖屏手机 390x844 显示 640x480：左右裁切', () => {
    const t = computeFit(640, 480, 390, 844);
    close(t.scale, 844 / 480);
    expect(t.offsetX).toBeLessThan(0);
    close(t.offsetY, 0);
    close(t.offsetX, (390 - 640 * (844 / 480)) / 2);
  });
  it('超宽屏 1440x600 显示 640x480：上下裁切', () => {
    const t = computeFit(640, 480, 1440, 600);
    close(t.scale, 1440 / 640);
    close(t.offsetX, 0);
    expect(t.offsetY).toBeLessThan(0);
  });
  it('contain 模式留黑边', () => {
    const t = computeFit(640, 480, 390, 844, 0, 'contain');
    close(t.scale, 390 / 640);
    expect(t.offsetY).toBeGreaterThan(0);
  });
});

describe('mapVideoToCanvas', () => {
  const base = { videoWidth: 640, videoHeight: 480, canvasWidth: 1280, canvasHeight: 960, mirror: false };
  it('中心点始终映射到画布中心（各种宽高比 + 镜像）', () => {
    for (const [cw, ch] of [[1280, 960], [390, 844], [1440, 900], [844, 390], [1000, 1000]]) {
      for (const mirror of [true, false]) {
        const p = mapVideoToCanvas({ x: 0.5, y: 0.5 }, { ...base, canvasWidth: cw, canvasHeight: ch, mirror });
        close(p.x, cw / 2);
        close(p.y, ch / 2);
      }
    }
  });
  it('不镜像：视频左上角 → 画布左上角', () => {
    const p = mapVideoToCanvas({ x: 0, y: 0 }, base);
    close(p.x, 0);
    close(p.y, 0);
  });
  it('镜像：原始画面左侧的点出现在画布右侧（用户往左，光标往用户看到的左边）', () => {
    // 前置摄像头原始帧里，用户的左手方向在画面的右边（x 大）
    const userMovesLeft = { x: 0.8, y: 0.5 };
    const p = mapVideoToCanvas(userMovesLeft, { ...base, mirror: true });
    expect(p.x).toBeLessThan(base.canvasWidth / 2);
    close(p.x, 0.2 * 1280);
  });
  it('竖屏 cover 裁切：被裁掉区域的点映射到画布外', () => {
    const opts = { ...base, canvasWidth: 390, canvasHeight: 844 };
    const p = mapVideoToCanvas({ x: 0.05, y: 0.5 }, opts);
    expect(p.x).toBeLessThan(0);
    const n = mapVideoToCanvasNormalized({ x: 0.5, y: 0.25 }, opts);
    close(n.y, 0.25);
    close(n.x, 0.5);
  });
  it('竖屏 cover：x 方向按放大后的比例映射', () => {
    const opts = { ...base, canvasWidth: 390, canvasHeight: 844 };
    const s = 844 / 480;
    const p = mapVideoToCanvas({ x: 0.6, y: 0.5 }, opts);
    close(p.x, 195 + 0.1 * 640 * s);
  });
  it('尺寸变化后重新计算（同一点在不同画布下归一化位置随裁切变化）', () => {
    const a = mapVideoToCanvasNormalized({ x: 0.7, y: 0.5 }, { ...base, canvasWidth: 1440, canvasHeight: 900 });
    const b = mapVideoToCanvasNormalized({ x: 0.7, y: 0.5 }, { ...base, canvasWidth: 390, canvasHeight: 844 });
    expect(b.x).toBeGreaterThan(a.x);
  });
  it('旋转 90° 时宽高互换', () => {
    const t = computeFit(640, 480, 480, 640, 90);
    close(t.scale, 1);
    close(t.offsetX, 0);
    const r = rotateNormalized(0, 0, 90);
    close(r.x, 1);
    close(r.y, 0);
    const p = mapVideoToCanvas({ x: 0, y: 0 }, { ...base, canvasWidth: 480, canvasHeight: 640, rotation: 90 });
    close(p.x, 480);
    close(p.y, 0);
  });
  it('旋转 180° / 270°', () => {
    const r180 = rotateNormalized(0.2, 0.3, 180);
    close(r180.x, 0.8);
    close(r180.y, 0.7);
    const r270 = rotateNormalized(0.2, 0.3, 270);
    close(r270.x, 0.3);
    close(r270.y, 0.8);
  });
  it('复用输出对象（不每帧新建）', () => {
    const out = { x: 0, y: 0 };
    const r = mapVideoToCanvas({ x: 0.5, y: 0.5 }, base, out);
    expect(r).toBe(out);
  });
});
