// 从 npm 包 @mediapipe/tasks-vision 拷贝 wasm 到 public/wasm，运行时不依赖 Google 的 CDN；
// 同时生成 src/engine/assetManifest.json（文件大小 + SHA-256），用于下载进度、完整性校验和本地缓存版本。
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules/@mediapipe/tasks-vision');
const src = join(pkgDir, 'wasm');
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
const mpVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const entry = (rel) => {
  const buf = readFileSync(join(root, 'public', rel));
  return { size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
};
const manifest = {
  mediapipeVersion: mpVersion,
  // jsDelivr 备用源使用的 git tag（指向含有这些文件的 gh-pages 提交），见 README
  mirrorTag: `mp-${mpVersion}`,
  files: Object.fromEntries([...files.map((f) => `wasm/${f}`), 'models/hand_landmarker.task'].map((rel) => [rel, entry(rel)])),
};
const out = join(root, 'src/engine/assetManifest.json');
const text = JSON.stringify(manifest, null, 2) + '\n';
if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
  writeFileSync(out, text);
  console.log('[copy-wasm] 更新 assetManifest.json');
}
