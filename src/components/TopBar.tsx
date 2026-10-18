import type { AppMode } from '../types';
import { IconBoard, IconCamera, IconExitFullscreen, IconFullscreen, IconHelp, IconSettings, IconSwitchCam } from './Icons';

interface Props {
  mode: AppMode;
  cameraOn: boolean;
  canSwitchCamera: boolean;
  fullscreenSupported: boolean;
  isFullscreen: boolean;
  onMode(m: AppMode): void;
  onSwitchCamera(): void;
  onFullscreen(): void;
  onHelp(): void;
  onSettings(): void;
}

export function TopBar(p: Props) {
  return (
    <header className="topbar glass" onPointerDown={(e) => e.stopPropagation()}>
      <div className="brand">
        <div className="logo-mark" aria-hidden>
          <span />
        </div>
        <b>AirCanvas</b>
        <em>空中画板</em>
      </div>
      <div className="mode-seg" role="tablist" aria-label="绘画模式">
        <button
          role="tab"
          aria-selected={p.mode === 'camera'}
          className={p.mode === 'camera' ? 'on' : ''}
          onClick={() => p.onMode('camera')}
          data-testid="mode-camera"
          title={p.cameraOn ? '摄像头绘画' : '打开摄像头，用手势画画'}
        >
          <IconCamera width={18} height={18} />
          <span>摄像头</span>
        </button>
        <button
          role="tab"
          aria-selected={p.mode === 'board'}
          className={p.mode === 'board' ? 'on' : ''}
          onClick={() => p.onMode('board')}
          data-testid="mode-board"
          title="纯色白板"
        >
          <IconBoard width={18} height={18} />
          <span>白板</span>
        </button>
      </div>
      <div className="top-actions">
        {p.canSwitchCamera && (
          <button className="icon-btn" onClick={p.onSwitchCamera} aria-label="切换前后摄像头" title="切换前后摄像头" data-testid="switch-cam">
            <IconSwitchCam />
          </button>
        )}
        {p.fullscreenSupported && (
          <button className="icon-btn hide-mobile" onClick={p.onFullscreen} aria-label="全屏" title="全屏">
            {p.isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
          </button>
        )}
        <button className="icon-btn" onClick={p.onSettings} aria-label="设置" title="设置" data-testid="settings">
          <IconSettings />
        </button>
        <button className="icon-btn" onClick={p.onHelp} aria-label="帮助" title="帮助" data-testid="help">
          <IconHelp />
        </button>
      </div>
    </header>
  );
}
