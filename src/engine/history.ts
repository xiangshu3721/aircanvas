import type { Stroke } from '../types';

type Op = { type: 'add'; stroke: Stroke } | { type: 'clear'; removed: Stroke[] };

/**
 * 笔画列表 + 操作历史。撤销/重做都基于操作，清空也是一个可撤销的操作。
 */
export class StrokeHistory {
  private _strokes: Stroke[] = [];
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  /** 每次笔画列表变化时 +1，渲染层据此判断是否需要重绘 */
  version = 0;

  get strokes(): readonly Stroke[] {
    return this._strokes;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** 从本地存档恢复：直接替换笔画，不产生撤销记录 */
  load(strokes: Stroke[]) {
    this._strokes = strokes.slice();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.version++;
  }

  add(stroke: Stroke) {
    this._strokes.push(stroke);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack.length = 0;
    this.version++;
  }

  clear(): boolean {
    if (this._strokes.length === 0) return false;
    this.undoStack.push({ type: 'clear', removed: this._strokes });
    this._strokes = [];
    this.redoStack.length = 0;
    this.version++;
    return true;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    if (op.type === 'add') {
      const i = this._strokes.lastIndexOf(op.stroke);
      if (i >= 0) this._strokes.splice(i, 1);
    } else {
      this._strokes = op.removed.concat(this._strokes);
    }
    this.redoStack.push(op);
    this.version++;
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    if (op.type === 'add') {
      this._strokes.push(op.stroke);
    } else {
      this._strokes = [];
    }
    this.undoStack.push(op);
    this.version++;
    return true;
  }
}
