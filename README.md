# AirCanvas 空中画板 V1.0

对着摄像头**捏合拇指和食指**，就能在空中画画；松开就停笔。不想开摄像头，也可以直接用手指或鼠标画。

- 在线体验：https://xiangshu3721.github.io/aircanvas/
- 纯前端：无登录、无后端、无数据库、无密钥。摄像头画面只在你自己的设备上处理，**不上传任何数据**。
- 作品自动保存在当前浏览器本地（localStorage），刷新或下次打开自动恢复。
- 国内可用：手势模型（`hand_landmarker.task`）和识别引擎（wasm）都放在本站，运行时不访问任何海外 CDN，不用 Google Fonts。

## 怎么玩

1. 打开网页，点「开始创作」，允许使用摄像头。
2. 伸出手掌，让摄像头看到食指 → 屏幕上会出现一个圆圈光标。
3. 拇指和食指轻轻捏在一起 → 开始画；手指分开 → 这一笔结束。
4. 底部工具栏：10 种颜色 + 自定义颜色、粗细（细/中/粗/特粗 + 滑杆）、普通/荧光画笔、撤销、重做、清空（可撤销找回）、保存图片。
5. 顶部可以切换「摄像头 / 白板」模式；设置里有手部关键点调试、镜像开关、白板黑/白底、关闭摄像头改用触屏。

## 功能清单

| 模块 | 说明 |
| --- | --- |
| 首屏 | 不会自动申请摄像头；「开始创作」→ 摄像头 → 加载模型（有提示）→ 首次三步新手指引（记住已看过） |
| 手势 | 单手食指指尖（landmark 8）当画笔；拇指尖-食指尖距离按手掌大小归一化；进入/退出阈值不同（滞回）+ 连续 2 帧确认；状态机 NO_HAND / HOVER / DRAWING / LOST；松开或丢手立即抬笔；重新捏合一定是新笔画；One Euro Filter 平滑；单帧跳太远自动断笔；多只手时锁定主手 |
| 坐标映射 | 独立函数，处理视频原始宽高、画布宽高、object-fit: cover 裁切、镜像、旋转、尺寸变化 |
| 绘画 | Canvas 2D 分层（视频/背景 → 已完成笔画缓存层 + 当前笔画层 → 光标层）；二次贝塞尔中点插值；笔画用归一化坐标保存，尺寸变化按比例重绘 |
| 历史 | 基于操作的撤销 / 重做，清空也能撤销 |
| 模式 | 摄像头模式（视频铺满、适度压暗）；白板模式（黑/白底，摄像头后台继续识别）；切换不丢内容 |
| 保存 | 离屏 canvas 按画布比例 × 设备像素比导出 PNG，不含工具栏/光标/骨骼；可选「包含摄像头画面」；手机优先系统分享，否则下载，iOS 可长按预览图保存 |
| 异常 | 拒绝权限、无摄像头、被占用、浏览器不支持、非 HTTPS、模型加载失败（GPU 失败自动改用 CPU）都有说人话的提示，并自动切到触屏绘画 |
| 性能 | 识别按视频新帧 + 推理耗时自适应调度，忙时跳帧；页面隐藏暂停识别；关闭摄像头释放所有 track 并关闭模型；光标与笔画不走 React state |
| 本地保存 | 笔画结束后节流写入 localStorage；容量满时轻提示不崩溃；清空同步 |

## 本地开发

```bash
npm install
npm run dev        # 开发（会自动从 @mediapipe/tasks-vision 拷贝 wasm 到 public/wasm）
npm test           # 单元测试（vitest）
npm run build      # 生产构建 → dist/
npm run preview    # 预览构建结果（http://127.0.0.1:4173/）
npm run e2e        # 端到端测试（需先 npm run preview；需要 Python playwright 与 Chrome）
npm run stress     # 长时间压力 / 内存测试
```

> 摄像头只能在 `https://` 或 `localhost` 下使用。

### 目录结构

```
src/
  App.tsx              页面组装、模式与设置
  components/          首屏、顶栏、工具栏、设置、指引、导出弹层等
  hooks/               useStudio（画布控制器）、useCameraSession（摄像头+模型生命周期）
  engine/
    config.ts          所有手势阈值集中在这里（GESTURE_CONFIG）
    gestureMachine.ts  捏合状态机（滞回、多帧确认、断笔、主手锁定）
    coordinateMapper.ts 视频坐标 → 画布坐标（cover、镜像、旋转）
    oneEuro.ts         One Euro Filter
    handFeatures.ts    关键点 → 候选手（捏合比例、手掌大小）
    handTracker.ts     MediaPipe HandLandmarker 封装（GPU→CPU 回退）
    history.ts         撤销/重做/清空
    renderer.ts        笔画绘制（贝塞尔平滑、荧光）
    studio.ts          分层画布、识别循环、Pointer Events
  utils/               导出 PNG、本地保存、摄像头、性能调度
public/
  models/hand_landmarker.task   手势模型（已提交到仓库）
  wasm/                         构建时从 npm 包拷贝（不提交）
tests/                 vitest 单元测试
e2e/                   Playwright 端到端 + 压力测试脚本
```

### 调手感

阈值都在 `src/engine/config.ts` 的 `GESTURE_CONFIG`：`pinchEnter`（捏合进入）、`pinchExit`（松开退出）、`enterConfirmFrames`（确认帧数）、`maxJumpRatio`（断笔距离）、`filter`（平滑参数）等。

## 部署

构建产物使用相对路径（Vite `base: './'`），**同一份 `dist/` 可以放在任何路径下**（GitHub Pages 的 `/aircanvas/` 子路径、CloudBase 根目录或子目录都行）。

### GitHub Pages（当前线上）

```bash
npm run deploy:gh   # 构建并把 dist/ 发布到 gh-pages 分支
```

仓库 Settings → Pages 里 Source 选 `gh-pages` 分支根目录。地址：https://xiangshu3721.github.io/aircanvas/

### 腾讯云 CloudBase 静态网站托管（国内访问更快，可选）

<a id="cloudbase"></a>

1. 登录 [腾讯云云开发控制台](https://console.cloud.tencent.com/tcb)，使用已有环境（或新建一个按量/免费额度环境），在「静态网站托管」里开通。记下环境 ID（形如 `your-env-id`）。
2. 本机安装并登录 CloudBase CLI：
   ```bash
   npm i -g @cloudbase/cli
   tcb login
   ```
3. 构建并上传：
   ```bash
   npm install
   npm run build
   tcb hosting deploy ./dist / -e your-env-id          # 部署到根目录
   # 或部署到子目录：tcb hosting deploy ./dist /aircanvas -e your-env-id
   ```
4. 打开控制台给出的默认域名（`https://your-env-id-xxxx.tcloudbaseapp.com/`）即可访问。默认域名就是 HTTPS，摄像头可以用。
5. 注意事项：
   - 要部署 `dist/` 里的全部文件，包括 `models/hand_landmarker.task`（约 7.5MB）和 `wasm/`（约 20MB）。
   - `.wasm` 文件需要以 `application/wasm` 类型返回（CloudBase 默认支持）；如果自定义了 CDN 规则，记得别把 `.task` / `.wasm` 拦掉。
   - 如需绑定自己的域名，在控制台「静态网站托管 → 设置」里添加并配置 HTTPS 证书（中国大陆域名需备案）。

## 浏览器支持

最新版 Chrome / Edge / Safari（iOS 15+）/ 微信内置浏览器。手势识别优先用 GPU，不支持时自动改用 CPU；摄像头不可用时可以一直用触屏/鼠标画。

## 隐私

- 不收集、不上传任何数据；没有统计、没有后端。
- 作品只保存在当前浏览器的本地存储里，清除浏览器数据会一并删除。
- 使用的 `@mediapipe/tasks-vision` 固定为 0.10.35（该版本不含联网日志上报）。

## 许可

MIT
