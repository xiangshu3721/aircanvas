import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraErrorKind } from '../types';
import { classifyCameraError, openCamera, stopStream, type Facing } from '../utils/camera';
import { HandTracker, type TrackerStage } from '../engine/handTracker';
import type { Studio } from '../engine/studio';

export type CamPhase = 'off' | 'starting' | 'loading-model' | 'on';

/**
 * 摄像头 + 手势模型的生命周期：
 * 申请摄像头 → 预览 → 加载模型 → 开始识别；关闭/卸载时停止所有 track、关闭模型。
 */
export function useCameraSession(videoRef: RefObject<HTMLVideoElement>, studioRef: RefObject<Studio | null>, onPreview?: () => void) {
  const [phase, setPhase] = useState<CamPhase>('off');
  const [facing, setFacing] = useState<Facing>('user');
  const [error, setError] = useState<CameraErrorKind | null>(null);
  const [stage, setStage] = useState<TrackerStage | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const reqRef = useRef(0);

  const attach = useCallback(async (stream: MediaStream) => {
    const v = videoRef.current;
    if (!v) throw new Error('video missing');
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    try {
      await v.play();
    } catch {
      /* 部分浏览器 play() 会被打断，后续帧到达后仍能识别 */
    }
  }, [videoRef]);

  const release = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    studioRef.current?.setTrackingEnabled(false);
    studioRef.current?.setTracker(null);
    trackerRef.current?.close();
    trackerRef.current = null;
  }, [videoRef, studioRef]);

  const start = useCallback(
    async (f: Facing = facing): Promise<boolean> => {
      const id = ++reqRef.current;
      setError(null);
      setPhase('starting');
      let stream: MediaStream;
      try {
        stream = await openCamera(f);
      } catch (e) {
        if (id !== reqRef.current) return false;
        console.warn('[AirCanvas] camera error', e);
        setError(classifyCameraError(e));
        setPhase('off');
        return false;
      }
      if (id !== reqRef.current) {
        stopStream(stream);
        return false;
      }
      stopStream(streamRef.current);
      streamRef.current = stream;
      // 摄像头被系统收回（拔掉、被占用）时的处理
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current === stream) {
          release();
          setError('busy');
          setPhase('off');
        }
      });
      try {
        await attach(stream);
      } catch (e) {
        release();
        setError('unknown');
        setPhase('off');
        return false;
      }
      setFacing(f);
      if (!trackerRef.current) {
        setPhase('loading-model');
        onPreview?.();
        for (;;) {
          try {
            const t = await HandTracker.create(setStage);
            if (id !== reqRef.current) {
              t.close();
              return false;
            }
            trackerRef.current = t;
            break;
          } catch (e) {
            if (id !== reqRef.current) return false;
            // 用户点了「重试」：旧下载被取消，接着等新的下载
            if ((e as { name?: string })?.name === 'AbortError') continue;
            console.warn('[AirCanvas] model error', e);
            release();
            setError('model');
            setPhase('off');
            setStage(null);
            return false;
          }
        }
      }
      setStage(null);
      studioRef.current?.setTracker(trackerRef.current);
      studioRef.current?.setTrackingEnabled(true);
      setPhase('on');
      return true;
    },
    [facing, attach, release, studioRef, onPreview],
  );

  const stop = useCallback(() => {
    reqRef.current++;
    release();
    setPhase('off');
    setStage(null);
  }, [release]);

  /** 切换前后摄像头：只换视频流，模型保留 */
  const switchFacing = useCallback(async (): Promise<Facing | null> => {
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    const id = ++reqRef.current;
    studioRef.current?.resetGesture();
    try {
      stopStream(streamRef.current);
      streamRef.current = null;
      const stream = await openCamera(next);
      if (id !== reqRef.current) {
        stopStream(stream);
        return null;
      }
      streamRef.current = stream;
      await attach(stream);
      setFacing(next);
      return next;
    } catch (e) {
      if (id !== reqRef.current) return null;
      // 换不过去就回到原来的摄像头
      try {
        const stream = await openCamera(facing);
        streamRef.current = stream;
        await attach(stream);
      } catch {
        release();
        setError(classifyCameraError(e));
        setPhase('off');
      }
      return null;
    }
  }, [facing, attach, release, studioRef]);

  useEffect(() => () => {
    reqRef.current++;
    stopStream(streamRef.current);
    trackerRef.current?.close();
  }, []);

  return { phase, facing, error, setError, stage, start, stop, switchFacing };
}
