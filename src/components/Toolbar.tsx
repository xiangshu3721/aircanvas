import { useEffect, useRef, useState } from 'react';
import type { BrushType } from '../types';
import { COLORS, MAX_WIDTH, MIN_WIDTH, WIDTHS } from '../engine/config';
import { IconPen, IconRedo, IconSave, IconSparkle, IconTrash, IconUndo } from './Icons';

interface Props {
  color: string;
  width: number;
  brush: BrushType;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onColor(c: string): void;
  onWidth(w: number): void;
  onBrush(b: BrushType): void;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
  onSave(): void;
}

export function Toolbar(p: Props) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sizeOpen) return;
    const close = (e: PointerEvent) => {
      if (!sizeRef.current?.contains(e.target as Node)) setSizeOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [sizeOpen]);
  const isPreset = (COLORS as readonly string[]).includes(p.color.toUpperCase());
  return (
    <div className="toolbar glass" onPointerDown={(e) => e.stopPropagation()} data-testid="toolbar">
      <div className="tb-row tb-colors" role="radiogroup" aria-label="颜色">
        {COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={p.color.toUpperCase() === c}
            aria-label={`颜色 ${c}`}
            className={'swatch' + (p.color.toUpperCase() === c ? ' on' : '')}
            style={{ ['--c' as string]: c }}
            onClick={() => p.onColor(c)}
            data-color={c}
          />
        ))}
        <label className={'swatch custom' + (!isPreset ? ' on' : '')} title="自定义颜色" style={{ ['--c' as string]: p.color }}>
          <input
            type="color"
            aria-label="自定义颜色"
            value={p.color.length === 7 ? p.color : '#00D2D3'}
            onChange={(e) => p.onColor(e.target.value.toUpperCase())}
            data-testid="color-custom"
          />
        </label>
      </div>
      <span className="tb-sep hide-mobile" />
      <div className="tb-row tb-actions">
        <div className="size-wrap" ref={sizeRef}>
          <button
            className={'tool-btn' + (sizeOpen ? ' active' : '')}
            onClick={() => setSizeOpen((v) => !v)}
            aria-label={`粗细 ${p.width}`}
            aria-expanded={sizeOpen}
            data-testid="size-btn"
          >
            <span className="size-dot" style={{ width: Math.min(22, p.width + 2), height: Math.min(22, p.width + 2), background: p.color }} />
            <small>粗细</small>
          </button>
          {sizeOpen && (
            <div className="size-pop glass" data-testid="size-pop">
              <div className="size-presets">
                {WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    className={'size-preset' + (p.width === w.value ? ' on' : '')}
                    onClick={() => {
                      p.onWidth(w.value);
                      setSizeOpen(false);
                    }}
                    data-width={w.value}
                  >
                    <span style={{ width: w.value + 2, height: w.value + 2 }} />
                    <small>{w.label}</small>
                  </button>
                ))}
              </div>
              <label className="size-slider">
                <input
                  type="range"
                  min={MIN_WIDTH}
                  max={MAX_WIDTH}
                  value={p.width}
                  onChange={(e) => p.onWidth(Number(e.target.value))}
                  aria-label="粗细滑杆"
                  data-testid="size-slider"
                />
                <output>{p.width}px</output>
              </label>
            </div>
          )}
        </div>
        <div className="brush-seg" role="radiogroup" aria-label="画笔">
          <button
            role="radio"
            aria-checked={p.brush === 'normal'}
            className={p.brush === 'normal' ? 'on' : ''}
            onClick={() => p.onBrush('normal')}
            data-testid="brush-normal"
          >
            <IconPen width={18} height={18} />
            <small>普通</small>
          </button>
          <button
            role="radio"
            aria-checked={p.brush === 'glow'}
            className={p.brush === 'glow' ? 'on' : ''}
            onClick={() => p.onBrush('glow')}
            data-testid="brush-glow"
          >
            <IconSparkle width={18} height={18} />
            <small>荧光</small>
          </button>
        </div>
        <span className="tb-sep hide-mobile" />
        <button className="tool-btn" onClick={p.onUndo} disabled={!p.canUndo} aria-label="撤销" data-testid="undo">
          <IconUndo />
          <small>撤销</small>
        </button>
        <button className="tool-btn" onClick={p.onRedo} disabled={!p.canRedo} aria-label="重做" data-testid="redo">
          <IconRedo />
          <small>重做</small>
        </button>
        <button className="tool-btn" onClick={p.onClear} disabled={!p.canClear} aria-label="清空" data-testid="clear">
          <IconTrash />
          <small>清空</small>
        </button>
        <button className="tool-btn accent" onClick={p.onSave} aria-label="保存" data-testid="save">
          <IconSave />
          <small>保存</small>
        </button>
      </div>
    </div>
  );
}
