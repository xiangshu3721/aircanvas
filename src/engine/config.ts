/**
 * 手势识别相关的所有阈值都集中在这里，方便调手感。
 * 距离均按「手掌大小」归一化：手腕(0) 到 中指根(9) 的距离。
 */
export const GESTURE_CONFIG = {
  /** 捏合比例小于它 → 认为在捏（进入阈值） */
  pinchEnter: 0.26,
  /** 捏合比例大于它 → 认为松开（退出阈值，比进入阈值大，形成滞回） */
  pinchExit: 0.4,
  /** 连续多少帧满足"捏合"才开始画（防抖） */
  enterConfirmFrames: 2,
  /** 连续多少帧满足"松开"才停笔（1 = 立即） */
  exitConfirmFrames: 1,
  /** 手消失多久后从 LOST 变为 NO_HAND（毫秒） */
  lostTimeoutMs: 700,
  /** 单帧移动超过画布对角线的这个比例 → 断笔，防止拉出长直线 */
  maxJumpRatio: 0.22,
  /** 两次识别间隔超过它（毫秒）→ 视为不连续，断笔 */
  maxGapMs: 300,
  /** 手掌太小（离太远、不可靠）→ 视为丢失。相对画面宽度 */
  minPalmSize: 0.035,
  /** 手的置信度低于它 → 视为丢失 */
  minHandScore: 0.5,
  /** 主手锁定：若唯一候选手离上一帧位置超过此距离（归一化），视为换了一只手 */
  handSwitchDistance: 0.3,
  /** One Euro Filter 参数（单位：归一化坐标/秒） */
  filter: { minCutoff: 1.4, beta: 9, dCutoff: 1.0 },
} as const;

export type GestureConfig = typeof GESTURE_CONFIG;

export const DETECT_CONFIG = {
  numHands: 2,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.6,
  minTrackingConfidence: 0.5,
  /** 自适应识别：最小 / 最大识别间隔（毫秒） */
  minIntervalMs: 0,
  maxIntervalMs: 120,
} as const;

export const COLORS = [
  '#FF4757',
  '#FF9F43',
  '#FFD93D',
  '#2ED573',
  '#00D2D3',
  '#1E90FF',
  '#A55EEA',
  '#FF6BBD',
  '#FFFFFF',
  '#111111',
] as const;

export const WIDTHS = [
  { label: '细', value: 3 },
  { label: '中', value: 6 },
  { label: '粗', value: 12 },
  { label: '特粗', value: 20 },
] as const;

export const DEFAULT_COLOR = '#00D2D3';
export const DEFAULT_WIDTH = 6;
export const MIN_WIDTH = 1;
export const MAX_WIDTH = 40;

export const STORAGE_KEYS = {
  guide: 'aircanvas.guideSeen.v1',
} as const;
