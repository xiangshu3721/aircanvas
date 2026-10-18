import { useEffect, useRef, useState, type RefObject } from 'react';
import { Studio } from '../engine/studio';
import type { StatusKind } from '../types';

export interface StudioRefs {
  stage: RefObject<HTMLDivElement>;
  video: RefObject<HTMLVideoElement>;
  done: RefObject<HTMLCanvasElement>;
  live: RefObject<HTMLCanvasElement>;
  overlay: RefObject<HTMLCanvasElement>;
}

/** 创建画布控制器；只有低频状态（撤销可用、状态文字）才进 React state */
export function useStudio(refs: StudioRefs, active: boolean) {
  const studioRef = useRef<Studio | null>(null);
  const [status, setStatus] = useState<StatusKind>('idle');
  const [hist, setHist] = useState({ canUndo: false, canRedo: false, count: 0 });
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!active) return;
    const { stage, video, done, live, overlay } = refs;
    if (!stage.current || !video.current || !done.current || !live.current || !overlay.current) return;
    const s = new Studio(
      { stage: stage.current, video: video.current, done: done.current, live: live.current, overlay: overlay.current },
      {
        onStatus: setStatus,
        onHistory: setHist,
        onStroke: () => setHasDrawn(true),
      },
    );
    studioRef.current = s;
    (window as unknown as { __aircanvas?: unknown }).__aircanvas = { info: () => s.debugInfo() };
    return () => {
      s.destroy();
      studioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { studioRef, status, hist, hasDrawn };
}
