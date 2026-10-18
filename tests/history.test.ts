import { describe, expect, it } from 'vitest';
import { StrokeHistory } from '../src/engine/history';
import type { Stroke } from '../src/types';

const mk = (id: string): Stroke => ({ id, color: '#fff', width: 6, brushType: 'normal', points: [{ x: 0.1, y: 0.1, timestamp: 0 }], createdAt: 0 });
const ids = (h: StrokeHistory) => h.strokes.map((s) => s.id);

describe('StrokeHistory 撤销 / 重做 / 清空', () => {
  it('撤销与重做', () => {
    const h = new StrokeHistory();
    h.add(mk('a'));
    h.add(mk('b'));
    expect(h.undo()).toBe(true);
    expect(ids(h)).toEqual(['a']);
    expect(h.redo()).toBe(true);
    expect(ids(h)).toEqual(['a', 'b']);
    expect(h.redo()).toBe(false);
  });
  it('清空后可以撤销恢复，再重做又清空', () => {
    const h = new StrokeHistory();
    h.add(mk('a'));
    h.add(mk('b'));
    expect(h.clear()).toBe(true);
    expect(ids(h)).toEqual([]);
    h.undo();
    expect(ids(h)).toEqual(['a', 'b']);
    h.redo();
    expect(ids(h)).toEqual([]);
    h.undo();
    h.undo();
    expect(ids(h)).toEqual(['a']);
  });
  it('空画布清空不产生历史', () => {
    const h = new StrokeHistory();
    expect(h.clear()).toBe(false);
    expect(h.canUndo).toBe(false);
  });
  it('新笔画会清掉重做栈', () => {
    const h = new StrokeHistory();
    h.add(mk('a'));
    h.undo();
    h.add(mk('c'));
    expect(h.canRedo).toBe(false);
    expect(ids(h)).toEqual(['c']);
  });
  it('清空后画新笔画，再连续撤销能找回清空前内容', () => {
    const h = new StrokeHistory();
    h.add(mk('a'));
    h.clear();
    h.add(mk('n'));
    h.undo();
    h.undo();
    expect(ids(h)).toEqual(['a']);
  });
  it('version 在每次变化时递增（用于判断是否需要重绘缓存层）', () => {
    const h = new StrokeHistory();
    const v0 = h.version;
    h.add(mk('a'));
    h.undo();
    h.redo();
    h.clear();
    expect(h.version).toBe(v0 + 4);
  });
  it('load() 恢复存档且不产生撤销记录', () => {
    const h = new StrokeHistory();
    h.load([mk('x'), mk('y')]);
    expect(ids(h)).toEqual(['x', 'y']);
    expect(h.canUndo).toBe(false);
  });
});
