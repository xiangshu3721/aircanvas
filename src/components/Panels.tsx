import type { ReactNode } from 'react';
import type { BoardBg, StatusKind } from '../types';
import { IconClose } from './Icons';

export function Modal({ children, onClose, className = '', testId }: { children: ReactNode; onClose?(): void; className?: string; testId?: string }) {
  return (
    <div className="modal-mask" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal glass ' + className} role="dialog" aria-modal="true" data-testid={testId}>
        {onClose && (
          <button className="icon-btn modal-close" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function Guide({ onDone, touchOnly }: { onDone(): void; touchOnly: boolean }) {
  return (
    <Modal className="guide" testId="guide">
      <h2>三步学会空中画画</h2>
      <ol className="guide-steps">
        <li>
          <span className="g-emoji">✋</span>
          <div>
            <b>伸出手掌</b>
            <p>让摄像头看到你的食指</p>
          </div>
        </li>
        <li>
          <span className="g-emoji">🤏</span>
          <div>
            <b>轻轻捏合</b>
            <p>拇指和食指轻轻捏在一起，就开始画画</p>
          </div>
        </li>
        <li>
          <span className="g-emoji">🖐️</span>
          <div>
            <b>松开停止</b>
            <p>手指分开，这一笔就画完了</p>
          </div>
        </li>
      </ol>
      {touchOnly && <p className="guide-tip">现在是触屏模式：直接用手指或鼠标在屏幕上画。</p>}
      <button className="btn-primary wide" onClick={onDone} data-testid="guide-ok">
        知道了
      </button>
    </Modal>
  );
}

interface SettingsProps {
  debug: boolean;
  mirror: boolean;
  cameraOn: boolean;
  cameraBusy: boolean;
  boardBg: BoardBg;
  onDebug(v: boolean): void;
  onMirror(v: boolean): void;
  onBoardBg(v: BoardBg): void;
  onCameraOff(): void;
  onCameraOn(): void;
  onClose(): void;
  info?: string;
}

function Toggle({ checked, onChange, disabled, testId }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; testId?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={'toggle' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span />
    </button>
  );
}

export function SettingsPanel(p: SettingsProps) {
  return (
    <div className="settings glass" onPointerDown={(e) => e.stopPropagation()} data-testid="settings-panel">
      <div className="settings-head">
        <b>设置</b>
        <button className="icon-btn" onClick={p.onClose} aria-label="关闭设置">
          <IconClose />
        </button>
      </div>
      <div className="set-row">
        <div>
          <b>显示手部关键点</b>
          <p>调试用，能看到识别出的手</p>
        </div>
        <Toggle checked={p.debug} onChange={p.onDebug} disabled={!p.cameraOn} testId="toggle-debug" />
      </div>
      <div className="set-row">
        <div>
          <b>镜像画面</b>
          <p>像照镜子一样，左右方向一致</p>
        </div>
        <Toggle checked={p.mirror} onChange={p.onMirror} disabled={!p.cameraOn} testId="toggle-mirror" />
      </div>
      <div className="set-row">
        <div>
          <b>白板颜色</b>
          <p>白板模式和保存图片的底色</p>
        </div>
        <div className="bg-seg">
          <button className={p.boardBg === 'black' ? 'on' : ''} onClick={() => p.onBoardBg('black')} data-testid="bg-black">
            黑
          </button>
          <button className={p.boardBg === 'white' ? 'on' : ''} onClick={() => p.onBoardBg('white')} data-testid="bg-white">
            白
          </button>
        </div>
      </div>
      {p.cameraOn ? (
        <button className="btn-ghost wide" onClick={p.onCameraOff} data-testid="camera-off">
          关闭摄像头，改用触屏
        </button>
      ) : (
        <button className="btn-ghost wide" onClick={p.onCameraOn} disabled={p.cameraBusy} data-testid="camera-on">
          打开摄像头，用手势画画
        </button>
      )}
      {p.info && <p className="set-info">{p.info}</p>}
    </div>
  );
}

const STATUS_TEXT: Partial<Record<StatusKind, string>> = {
  'camera-starting': '摄像头启动中…',
  'model-loading': '正在加载手势模型…',
  searching: '寻找手掌…',
  'hand-found': '已识别手掌 · 捏合开始画',
  drawing: '正在绘画',
};

export function StatusPill({ status }: { status: StatusKind }) {
  const text = STATUS_TEXT[status];
  if (!text) return null;
  return (
    <div className={'status-pill glass s-' + status} role="status" aria-live="polite" data-testid="status">
      <i />
      {text}
    </div>
  );
}

export function Notice({ title, desc, onClose, onRetry }: { title: string; desc: string; onClose(): void; onRetry?(): void }) {
  return (
    <Modal onClose={onClose} className="notice" testId="notice">
      <div className="notice-icon">📷</div>
      <h2>{title}</h2>
      <p>{desc}</p>
      <div className="notice-actions">
        <button className="btn-primary" onClick={onClose} data-testid="notice-touch">
          用手指 / 鼠标画画
        </button>
        {onRetry && (
          <button className="btn-ghost" onClick={onRetry} data-testid="notice-retry">
            重试摄像头
          </button>
        )}
      </div>
    </Modal>
  );
}

export function LoadingCard({ text }: { text: string }) {
  return (
    <div className="loading-card glass" role="status" data-testid="loading">
      <span className="spinner" />
      <div>
        <b>{text || '准备中…'}</b>
        <p>第一次打开需要下载约 10MB 的识别模型，请稍等</p>
      </div>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="toast glass" role="status" data-testid="toast">
      {text}
    </div>
  );
}
