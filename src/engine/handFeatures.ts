import type { NormalizedLandmark, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandCandidate } from './gestureMachine';
import { mapVideoToCanvasNormalized, type MapOptions } from './coordinateMapper';

export const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_MCP: 9 } as const;

/** 两个关键点在真实像素比例下的距离（landmark 的 x/y 分别按视频宽/高归一化） */
export function landmarkDistance(a: NormalizedLandmark | { x: number; y: number }, b: { x: number; y: number }, videoAspect: number) {
  return Math.hypot((a.x - b.x) * videoAspect, a.y - b.y);
}

/** 捏合比例 = 拇指尖到食指尖距离 / 手掌大小（手腕到中指根） */
export function pinchRatio(lms: ArrayLike<{ x: number; y: number }>, videoAspect: number) {
  const palm = landmarkDistance(lms[LM.WRIST], lms[LM.MIDDLE_MCP], videoAspect);
  if (palm < 1e-6) return Infinity;
  return landmarkDistance(lms[LM.THUMB_TIP], lms[LM.INDEX_TIP], videoAspect) / palm;
}

/** 预分配的候选数组，避免每帧新建对象 */
const pool: HandCandidate[] = [];
function slot(i: number): HandCandidate {
  return (pool[i] ??= {
    tip: { x: 0, y: 0 },
    wrist: { x: 0, y: 0 },
    pinchRatio: 1,
    palmSize: 0,
    handedness: '',
    score: 0,
    index: i,
  });
}

export function extractCandidates(result: HandLandmarkerResult, map: MapOptions, out: HandCandidate[]): HandCandidate[] {
  out.length = 0;
  const aspect = map.videoWidth / map.videoHeight;
  const hands = result.landmarks ?? [];
  const handed = result.handedness ?? result.handednesses ?? [];
  for (let i = 0; i < hands.length; i++) {
    const lms = hands[i];
    if (!lms || lms.length < 21) continue;
    const c = slot(i);
    c.index = i;
    mapVideoToCanvasNormalized(lms[LM.INDEX_TIP], map, c.tip);
    mapVideoToCanvasNormalized(lms[LM.WRIST], map, c.wrist);
    c.pinchRatio = pinchRatio(lms, aspect);
    // 手掌大小换算成相对视频宽度
    c.palmSize = landmarkDistance(lms[LM.WRIST], lms[LM.MIDDLE_MCP], aspect) / aspect;
    const cat = handed[i]?.[0];
    c.handedness = cat?.categoryName ?? '';
    c.score = cat?.score ?? 1;
    out.push(c);
  }
  return out;
}
