import { describe, expect, it } from 'vitest';
import { downloadAsset, sha256Hex, assetSources, type CacheLike, type Source } from '../src/utils/assetLoader';
import manifest from '../src/engine/assetManifest.json';

const data = new Uint8Array(4000).map((_, i) => (i * 7) % 251);
let spec: { path: string; size: number; sha256: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 模拟一个下载源：每 interval 毫秒吐出 chunk 字节；status!=200 表示失败；stallAfter 后不再吐数据 */
function server(cfg: Record<string, { status?: number; chunk: number; interval: number; corrupt?: boolean; stallAfter?: number }>) {
  const log: string[] = [];
  const aborted: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    log.push(host);
    const c = cfg[host];
    if (!c || (c.status && c.status !== 200)) return new Response('no', { status: c?.status ?? 404 });
    const signal = init?.signal;
    let off = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        await sleep(c.interval);
        if (signal?.aborted) {
          aborted.push(host);
          ctrl.error(new DOMException('aborted', 'AbortError'));
          return;
        }
        if (c.stallAfter !== undefined && off >= c.stallAfter) {
          await new Promise((r) => signal?.addEventListener('abort', r));
          aborted.push(host);
          ctrl.error(new DOMException('aborted', 'AbortError'));
          return;
        }
        if (off >= data.length) return ctrl.close();
        const part = data.slice(off, off + c.chunk);
        if (c.corrupt) part[0] ^= 0xff;
        off += c.chunk;
        ctrl.enqueue(part);
      },
    });
    return new Response(body, { status: 200 });
  };
  return { fetch, log, aborted };
}

function memCache(): CacheLike & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async match(k) {
      const v = store.get(k);
      return v ? new Response(new Blob([v as BlobPart])) : undefined;
    },
    async put(k, r) {
      store.set(k, new Uint8Array(await r.arrayBuffer()));
    },
  };
}

const SOURCES: Source[] = [
  { name: 'self', base: 'https://self.test/', primary: true },
  { name: 'm1', base: 'https://m1.test/' },
  { name: 'm2', base: 'https://m2.test/' },
];

describe('模型下载：缓存 + 多源竞速 + 校验', async () => {
  spec = { path: 'models/x.task', size: data.length, sha256: await sha256Hex(data) };

  it('本站快：只走本站，不碰备用源，并写入缓存', async () => {
    const s = server({ 'self.test': { chunk: 1000, interval: 2 } });
    const cache = memCache();
    const progress: number[] = [];
    const r = await downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 200, onProgress: (n) => progress.push(n) }, { fetch: s.fetch, cache });
    expect(r.source).toBe('self');
    expect(r.fromCache).toBe(false);
    expect(Array.from(r.data)).toEqual(Array.from(data));
    expect(s.log).toEqual(['self.test']);
    expect(cache.store.size).toBe(1);
    expect(progress[progress.length - 1]).toBe(data.length);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('第二次：直接从缓存读取，不发任何网络请求', async () => {
    const s = server({ 'self.test': { chunk: 1000, interval: 2 } });
    const cache = memCache();
    await downloadAsset(spec, { sources: SOURCES }, { fetch: s.fetch, cache });
    const s2 = server({});
    const r = await downloadAsset(spec, { sources: SOURCES }, { fetch: s2.fetch, cache });
    expect(r.fromCache).toBe(true);
    expect(s2.log).toEqual([]);
  });

  it('本站 404：立即切到备用源', async () => {
    const s = server({ 'self.test': { status: 404, chunk: 1, interval: 1 }, 'm1.test': { chunk: 1000, interval: 2 } });
    const r = await downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 5000 }, { fetch: s.fetch, cache: null });
    expect(r.source).toBe('m1');
    expect(s.log.slice(0, 2)).toEqual(['self.test', 'm1.test']);
  });

  it('本站很慢：启用备用源竞速，保留更快的并取消其他', async () => {
    const s = server({
      'self.test': { chunk: 20, interval: 10 },
      'm1.test': { chunk: 200, interval: 10 },
      'm2.test': { chunk: 50, interval: 10 },
    });
    const r = await downloadAsset(
      spec,
      { sources: SOURCES, hedgeAfterMs: 60, hedgeIfRemainingMs: 100, compareWindowMs: 60 },
      { fetch: s.fetch, cache: null },
    );
    expect(r.source).toBe('m1');
    expect(s.log).toEqual(['self.test', 'm1.test', 'm2.test']);
    await sleep(30);
    expect(s.aborted).toContain('self.test');
    expect(s.aborted).toContain('m2.test');
  });

  it('速度差不多时本站优先（备用源被取消）', async () => {
    const s = server({
      'self.test': { chunk: 40, interval: 10 },
      'm1.test': { chunk: 45, interval: 10 },
      'm2.test': { chunk: 40, interval: 10 },
    });
    const r = await downloadAsset(
      spec,
      { sources: SOURCES, hedgeAfterMs: 50, hedgeIfRemainingMs: 10, compareWindowMs: 80 },
      { fetch: s.fetch, cache: null },
    );
    expect(r.source).toBe('self');
  });

  it('本站估算很快就能下完时不启用备用源', async () => {
    const s = server({ 'self.test': { chunk: 200, interval: 10 }, 'm1.test': { chunk: 4000, interval: 1 } });
    const r = await downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 30, hedgeIfRemainingMs: 5000 }, { fetch: s.fetch, cache: null });
    expect(r.source).toBe('self');
    expect(s.log).toEqual(['self.test']);
  });

  it('内容被篡改（SHA-256 不符）会被拒绝并换源', async () => {
    const s = server({ 'self.test': { chunk: 1000, interval: 2, corrupt: true }, 'm1.test': { chunk: 1000, interval: 2 } });
    const cache = memCache();
    const r = await downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 5000 }, { fetch: s.fetch, cache });
    expect(r.source).toBe('m1');
    expect(Array.from(r.data)).toEqual(Array.from(data));
  });

  it('卡住不动的源会被放弃', async () => {
    const s = server({ 'self.test': { chunk: 500, interval: 2, stallAfter: 1000 }, 'm1.test': { chunk: 1000, interval: 2 } });
    const r = await downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 60000, stallMs: 80 }, { fetch: s.fetch, cache: null });
    expect(r.source).toBe('m1');
  });

  it('全部失败时报错', async () => {
    const s = server({});
    await expect(downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 10 }, { fetch: s.fetch, cache: null })).rejects.toThrow();
  });

  it('可以中途取消', async () => {
    const s = server({ 'self.test': { chunk: 10, interval: 10 } });
    const ctrl = new AbortController();
    const p = downloadAsset(spec, { sources: SOURCES, hedgeAfterMs: 60000, signal: ctrl.signal }, { fetch: s.fetch, cache: null });
    setTimeout(() => ctrl.abort(), 30);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('资源清单与备用源', () => {
  it('备用源顺序：本站优先，其后是 jsDelivr（本仓库 tag）', () => {
    const s = assetSources('https://xiangshu3721.github.io/aircanvas/');
    expect(s[0]).toMatchObject({ name: 'self', primary: true });
    expect(s.slice(1).every((x) => x.base.includes(`/gh/xiangshu3721/aircanvas@${manifest.mirrorTag}/`))).toBe(true);
    expect(s.slice(1).every((x) => x.base.includes('jsdelivr.net'))).toBe(true);
  });
  it('模型是 float16 版（约 7.5MB），每个文件都有 SHA-256', () => {
    const m = manifest.files['models/hand_landmarker.task'];
    expect(m.size).toBeLessThan(8 * 1024 * 1024);
    for (const f of Object.values(manifest.files)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
