// 从 npm 包 @mediapipe/tasks-vision 拷贝 wasm 到 public/wasm，运行时不依赖任何 CDN
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = join(root, 'public/wasm');
const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

mkdirSync(dst, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[copy-wasm] 找不到 ${from}，请先 npm install`);
    process.exit(1);
  }
  const to = join(dst, f);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  console.log(`[copy-wasm] ${f}`);
}
const model = join(root, 'public/models/hand_landmarker.task');
if (!existsSync(model)) {
  console.error('[copy-wasm] 缺少 public/models/hand_landmarker.task（仓库里应已提交），请检查');
  process.exit(1);
}
