import type { CameraErrorKind } from '../types';

export type Facing = 'user' | 'environment';

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message?: string) {
    super(message ?? kind);
  }
}

export function classifyCameraError(err: unknown): CameraErrorKind {
  if (err instanceof CameraError) return err.kind;
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'nodevice';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

export const CAMERA_ERROR_TEXT: Record<CameraErrorKind, { title: string; desc: string }> = {
  denied: {
    title: '没有拿到摄像头权限',
    desc: '你拒绝了摄像头权限。可以在浏览器地址栏左侧的「锁」图标里重新允许，或者先用手指/鼠标画画。',
  },
  nodevice: { title: '没找到摄像头', desc: '这台设备好像没有可用的摄像头。先用手指/鼠标画画吧。' },
  busy: {
    title: '摄像头被占用了',
    desc: '摄像头可能正被别的应用（视频会议、相机等）使用。关掉它们后点「重试」，或者先用手指/鼠标画画。',
  },
  unsupported: {
    title: '这个浏览器不支持摄像头',
    desc: '请换用最新版的 Chrome、Edge、Safari 或微信内置浏览器。先用手指/鼠标画画吧。',
  },
  insecure: {
    title: '需要 HTTPS 才能用摄像头',
    desc: '浏览器只允许在 https 网址里打开摄像头。先用手指/鼠标画画吧。',
  },
  model: {
    title: '手势识别没能启动',
    desc: '手势模型加载失败（可能是网络慢或设备不支持）。可以点「重试」，或者先用手指/鼠标画画。',
  },
  unknown: { title: '摄像头没能打开', desc: '出了点小问题。可以点「重试」，或者先用手指/鼠标画画。' },
};

export async function openCamera(facing: Facing): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new CameraError('insecure');
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md || typeof md.getUserMedia !== 'function') throw new CameraError('unsupported');
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facing },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30, max: 30 },
  };
  try {
    return await md.getUserMedia({ video, audio: false });
  } catch (err) {
    // 约束太严时退一步，只要能出画面就行
    if ((err as { name?: string })?.name === 'OverconstrainedError') {
      return await md.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
}
