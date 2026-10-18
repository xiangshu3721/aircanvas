import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppMode, BoardBg, BrushType, StatusKind } from './types';
import { DEFAULT_COLOR, DEFAULT_WIDTH, STORAGE_KEYS } from './engine/config';
import { Landing } from './components/Landing';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { Guide, LoadingCard, Notice, SettingsPanel, StatusPill, Toast } from './components/Panels';
import { ExportDialog } from './components/ExportDialog';
import { useStudio } from './hooks/useStudio';
import { useCameraSession } from './hooks/useCameraSession';
import { CAMERA_ERROR_TEXT } from './utils/camera';
import { canvasToBlob, renderExportCanvas, saveBlob } from './utils/export';
import { createThrottledSaver, loadArtwork, saveArtwork, type SavedArtwork } from './utils/storage';
import { isCoarsePointer } from './utils/perf';

export const BG_COLOR: Record<BoardBg, string> = { black: '#0F1115', white: '#FFFFFF' };

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [saved] = useState<SavedArtwork | null>(() => loadArtwork());
  const [phase, setPhase] = useState<'landing' | 'app'>('landing');
  const [mode, setMode] = useState<AppMode>('camera');
  const [boardBg, setBoardBg] = useState<BoardBg>(saved?.boardBg ?? 'black');
  const [color, setColor] = useState(saved?.color ?? DEFAULT_COLOR);
  const [width, setWidth] = useState(saved?.width ?? DEFAULT_WIDTH);
  const [brush, setBrush] = useState<BrushType>(saved?.brush ?? 'normal');
  const [mirror, setMirror] = useState(true);
  const [debug, setDebug] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<keyof typeof CAMERA_ERROR_TEXT | null>(null);
  const [toast, setToast] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingCamera, setPendingCamera] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const active = phase === 'app';
  const { studioRef, status, hist, hasDrawn } = useStudio(
    { stage: stageRef, video: videoRef, done: doneRef, live: liveRef, overlay: overlayRef },
    active,
  );
  const cam = useCameraSession(videoRef, studioRef);
  const cameraOn = cam.phase === 'on';
  const cameraBusy = cam.phase === 'starting' || cam.phase === 'loading-model';

  const showToast = useCallback((t: string) => setToast(t), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------- 本地自动保存 ----------
  const restoredRef = useRef(false);
  const latest = useRef({ color, width, brush, boardBg, mode });
  latest.current = { color, width, brush, boardBg, mode };
  const quotaWarned = useRef(false);
  const saverRef = useRef<ReturnType<typeof createThrottledSaver> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createThrottledSaver(() => {
      const s = studioRef.current;
      if (!s || !restoredRef.current) return;
      const r = saveArtwork({ strokes: s.history.strokes as SavedArtwork['strokes'], ...latest.current });
      if (r === 'ok') quotaWarned.current = false;
      else if (!quotaWarned.current) {
        quotaWarned.current = true;
        setToast(r === 'quota' ? '浏览器本地空间满了，作品暂时没法自动保存，可以先点「保存」导出图片' : '这个浏览器不允许本地保存，刷新后作品会丢失');
      }
    }, 600);
  }

  // 进入画布后恢复上次作品
  useEffect(() => {
    if (!active || restoredRef.current) return;
    const s = studioRef.current;
    if (!s) return;
    if (saved?.strokes.length) {
      s.loadStrokes(saved.strokes);
      showToast(`已恢复上次的作品（${saved.strokes.length} 笔）`);
    }
    restoredRef.current = true;
  }, [active, saved, studioRef, showToast]);

  useEffect(() => {
    if (restoredRef.current) saverRef.current!.schedule();
  }, [hist, color, width, brush, boardBg, mode]);

  useEffect(() => {
    const flush = () => saverRef.current!.flush();
    const onVis = () => document.hidden && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, []);

  // ---------- 同步设置到画布控制器 ----------
  useEffect(() => {
    const s = studioRef.current;
    if (s) s.brush = { color, width, brushType: brush };
  }, [color, width, brush, active, studioRef]);
  useEffect(() => {
    if (studioRef.current) studioRef.current.mirror = mirror;
  }, [mirror, active, studioRef]);
  useEffect(() => {
    if (studioRef.current) studioRef.current.debug = debug;
  }, [debug, active, studioRef]);

  // ---------- 摄像头 ----------
  const startCamera = useCallback(async () => {
    const ok = await cam.start('user');
    if (ok) {
      setMirror(true);
      setMode('camera');
      if (!readFlag(STORAGE_KEYS.guide)) setGuideOpen(true);
    }
  }, [cam]);

  useEffect(() => {
    if (active && pendingCamera && studioRef.current) {
      setPendingCamera(false);
      void startCamera();
    }
  }, [active, pendingCamera, startCamera, studioRef]);

  // 摄像头/模型出错：自动降级为触屏白板，并说明原因
  useEffect(() => {
    if (cam.error) {
      setMode('board');
      setNotice(cam.error);
      setGuideOpen(false);
    }
  }, [cam.error]);

  const onStart = () => {
    setMode('camera');
    setPhase('app');
    setPendingCamera(true);
  };
  const onTouch = () => {
    setMode('board');
    setPhase('app');
  };

  const onMode = (m: AppMode) => {
    if (m === 'camera' && !cameraOn) {
      if (!cameraBusy) {
        setMode('camera');
        void startCamera();
      }
      return;
    }
    setMode(m);
  };

  const onSwitchCamera = async () => {
    const next = await cam.switchFacing();
    if (next) setMirror(next === 'user'); // 后置默认不镜像
    else if (cam.phase === 'on') showToast('没能切换摄像头，可能只有一个摄像头');
  };

  const onCameraOff = () => {
    cam.stop();
    setMode('board');
    setSettingsOpen(false);
    showToast('摄像头已关闭，可以直接用手指或鼠标画');
  };

  // ---------- 全屏（桌面） ----------
  const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled && !isCoarsePointer();
  useEffect(() => {
    const on = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const onFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => showToast('浏览器不允许全屏'));
  };

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        studioRef.current?.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        studioRef.current?.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, studioRef]);

  // ---------- 导出 ----------
  const renderExport = useCallback(
    async (includeCamera: boolean) => {
      const s = studioRef.current!;
      const { width: w, height: h } = s.size;
      const c = renderExportCanvas({
        strokes: s.history.strokes,
        width: w,
        height: h,
        background: BG_COLOR[boardBg],
        video: includeCamera && cameraOn ? videoRef.current : null,
        mirror,
      });
      return canvasToBlob(c);
    },
    [studioRef, boardBg, cameraOn, mirror],
  );

  const onClear = () => {
    studioRef.current?.clear();
    showToast('已清空，点「撤销」可以找回');
  };

  let shownStatus: StatusKind = status;
  if (cam.phase === 'starting') shownStatus = 'camera-starting';
  else if (cam.phase === 'loading-model') shownStatus = 'model-loading';
  else if (!cameraOn) shownStatus = 'idle';

  const showVideo = mode === 'camera' && cameraOn;
  const stageBg = showVideo || (mode === 'camera' && cameraBusy) ? '#000' : BG_COLOR[boardBg];
  const touchOnly = !cameraOn && !cameraBusy;
  const emptyHint = touchOnly ? '用手指或鼠标画一颗星星 ✨' : '试着在空中画一颗星星 ✨';

  if (phase === 'landing') {
    return <Landing onStart={onStart} onTouch={onTouch} hasSaved={!!saved?.strokes.length} />;
  }

  return (
    <div className={`app mode-${mode} bg-${boardBg}`} style={{ background: stageBg }}>
      <div className="stage" ref={stageRef}>
        <video
          ref={videoRef}
          className={'cam-video' + (showVideo ? ' visible' : '') + (mirror ? ' mirror' : '')}
          playsInline
          muted
          autoPlay
        />
        {showVideo && <div className="cam-dim" />}
        <canvas ref={doneRef} className="layer layer-done" />
        <canvas ref={liveRef} className="layer layer-live" />
        <canvas ref={overlayRef} className="layer layer-overlay" data-testid="canvas" />
      </div>

      {!hasDrawn && hist.count === 0 && !guideOpen && <div className="empty-hint">{emptyHint}</div>}

      <TopBar
        mode={mode}
        cameraOn={cameraOn}
        canSwitchCamera={cameraOn}
        fullscreenSupported={fullscreenSupported}
        isFullscreen={isFullscreen}
        onMode={onMode}
        onSwitchCamera={onSwitchCamera}
        onFullscreen={onFullscreen}
        onHelp={() => setGuideOpen(true)}
        onSettings={() => setSettingsOpen((v) => !v)}
      />
      <StatusPill status={shownStatus} />
      {cam.phase === 'loading-model' && <LoadingCard text={cam.loadingText} />}

      {settingsOpen && (
        <SettingsPanel
          debug={debug}
          mirror={mirror}
          cameraOn={cameraOn}
          cameraBusy={cameraBusy}
          boardBg={boardBg}
          onDebug={setDebug}
          onMirror={setMirror}
          onBoardBg={setBoardBg}
          onCameraOff={onCameraOff}
          onCameraOn={() => {
            setSettingsOpen(false);
            setMode('camera');
            void startCamera();
          }}
          onClose={() => setSettingsOpen(false)}
          info="作品只保存在这台设备的浏览器里，不会上传。"
        />
      )}

      <Toolbar
        color={color}
        width={width}
        brush={brush}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        canClear={hist.count > 0}
        onColor={setColor}
        onWidth={setWidth}
        onBrush={setBrush}
        onUndo={() => studioRef.current?.undo()}
        onRedo={() => studioRef.current?.redo()}
        onClear={onClear}
        onSave={() => setExportOpen(true)}
      />

      {guideOpen && (
        <Guide
          touchOnly={touchOnly}
          onDone={() => {
            writeFlag(STORAGE_KEYS.guide);
            setGuideOpen(false);
          }}
        />
      )}
      {notice && (
        <Notice
          title={CAMERA_ERROR_TEXT[notice].title}
          desc={CAMERA_ERROR_TEXT[notice].desc}
          onClose={() => {
            setNotice(null);
            cam.setError(null);
          }}
          onRetry={
            notice === 'unsupported' || notice === 'insecure' || notice === 'nodevice'
              ? undefined
              : () => {
                  setNotice(null);
                  cam.setError(null);
                  setMode('camera');
                  void startCamera();
                }
          }
        />
      )}
      {exportOpen && (
        <ExportDialog cameraAvailable={cameraOn} render={renderExport} onSave={(b) => saveBlob(b)} onClose={() => setExportOpen(false)} />
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}
