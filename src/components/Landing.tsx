interface Props {
  onStart(): void;
  onTouch(): void;
  hasSaved?: boolean;
}

export function Landing({ onStart, onTouch, hasSaved }: Props) {
  return (
    <main className="landing">
      <div className="landing-bg" aria-hidden>
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
          <path className="ribbon r1" d="M60 420 C 200 240, 320 520, 460 330 S 700 160, 760 260" />
          <path className="ribbon r2" d="M40 180 C 180 90, 300 260, 420 160 S 640 80, 780 140" />
          <path className="ribbon r3" d="M120 540 C 260 470, 400 600, 540 480 S 720 420, 790 500" />
        </svg>
      </div>
      <div className="landing-card">
        <div className="logo-mark big" aria-hidden>
          <span />
        </div>
        <h1>
          AirCanvas <span>空中画板</span>
        </h1>
        <p className="tagline">伸出双手，让创意在空气中绽放</p>
        <div className="landing-actions">
          <button className="btn-primary" onClick={onStart} data-testid="start">
            开始创作
          </button>
          <button className="btn-ghost" onClick={onTouch} data-testid="touch">
            触屏绘画
          </button>
        </div>
        {hasSaved && <p className="saved-tip">上次的作品还在，进去就能接着画</p>}
        <p className="privacy">摄像头画面只在你的设备上处理，不会上传</p>
      </div>
    </main>
  );
}
