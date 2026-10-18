import { describe, expect, it, vi } from 'vitest';
import { ARTWORK_KEY, createThrottledSaver, deserializeArtwork, loadArtwork, saveArtwork, serializeArtwork } from '../src/utils/storage';
import type { Stroke } from '../src/types';

class MemStorage {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) {
      const e = new Error('full');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const stroke: Stroke = {
  id: 's1',
  color: '#FF4757',
  width: 12,
  brushType: 'glow',
  points: [
    { x: 0.123456789, y: 0.5, timestamp: 1000 },
    { x: 0.2, y: 0.6, timestamp: 1016.4 },
  ],
  createdAt: 123,
};
const art = { strokes: [stroke], color: '#1E90FF', width: 20, brush: 'glow' as const, boardBg: 'white' as const, mode: 'board' as const };

describe('本地自动保存', () => {
  it('序列化 → 反序列化保持内容（坐标 4 位小数）', () => {
    const back = deserializeArtwork(serializeArtwork(art))!;
    expect(back.color).toBe('#1E90FF');
    expect(back.width).toBe(20);
    expect(back.brush).toBe('glow');
    expect(back.boardBg).toBe('white');
    expect(back.strokes).toHaveLength(1);
    const s = back.strokes[0];
    expect(s.color).toBe('#FF4757');
    expect(s.brushType).toBe('glow');
    expect(s.points[0].x).toBeCloseTo(0.1235, 4);
    expect(s.points[1].timestamp).toBe(16);
  });
  it('save / load 往返', () => {
    const st = new MemStorage() as unknown as Storage;
    expect(saveArtwork(art, st)).toBe('ok');
    expect(loadArtwork(st)!.strokes).toHaveLength(1);
  });
  it('清空后保存空列表，读取为空', () => {
    const st = new MemStorage() as unknown as Storage;
    saveArtwork(art, st);
    saveArtwork({ ...art, strokes: [] }, st);
    expect(loadArtwork(st)!.strokes).toHaveLength(0);
  });
  it('超出容量时返回 quota，不抛异常，旧存档仍在', () => {
    const mem = new MemStorage();
    const st = mem as unknown as Storage;
    saveArtwork(art, st);
    mem.quota = 10;
    expect(saveArtwork(art, st)).toBe('quota');
    expect(loadArtwork(st)!.strokes).toHaveLength(1);
  });
  it('存储不可用 / 损坏数据不崩溃', () => {
    expect(saveArtwork(art, null)).toBe('unavailable');
    const mem = new MemStorage();
    mem.data.set(ARTWORK_KEY, '{bad json');
    expect(loadArtwork(mem as unknown as Storage)).toBeNull();
    expect(deserializeArtwork(JSON.stringify({ v: 1, strokes: [{ c: '#fff', w: 3, p: ['x'] }] }))!.strokes).toHaveLength(0);
  });
  it('节流：短时间多次调用只写一次，flush 立即写入', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const s = createThrottledSaver(fn, 500);
    s.schedule();
    s.schedule();
    s.schedule();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
    s.schedule();
    s.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
