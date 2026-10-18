"""长时间压力测试：
A. 加速模拟约 10 分钟的大量笔画（3000 笔 × 40 点），每 300 笔强制 GC 后记录 JS heap、撤销重绘耗时
B. fake 摄像头下持续手势识别 N 秒，每 15 秒 GC 后记录 heap，检查识别循环是否泄漏
用法: python3 e2e/stress.py <base_url> [识别时长秒，默认 180]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173/'
DUR = int(sys.argv[2]) if len(sys.argv) > 2 else 180
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
FAKE_VIDEO = os.environ.get('FAKE_VIDEO', '/workspace/aircanvas-e2e/hand.y4m')
out = {}

DRAW_JS = """async ([count, ptsPer, seed]) => {
  const c = document.querySelector('[data-testid=canvas]');
  const r = c.getBoundingClientRect();
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const colors = ['#FF4757','#FF9F43','#FFD93D','#2ED573','#00D2D3','#1E90FF','#A55EEA','#FF6BBD'];
  for (let k = 0; k < count; k++) {
    if (k % 50 === 0) {
      document.querySelector(`[data-color="${colors[k / 50 % colors.length | 0]}"]`).click();
      document.querySelector(k % 100 === 0 ? '[data-testid=brush-glow]' : '[data-testid=brush-normal]').click();
      await new Promise(requestAnimationFrame);
    }
    let x = r.left + rnd() * r.width, y = r.top + 80 + rnd() * (r.height - 200);
    const ev = (type) => c.dispatchEvent(new PointerEvent(type, {pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true}));
    ev('pointerdown');
    const a = rnd() * 6.28;
    for (let i = 0; i < ptsPer; i++) { x += Math.cos(a + i * 0.15) * 6; y += Math.sin(a + i * 0.15) * 6; ev('pointermove'); }
    ev('pointerup');
    if (k % 20 === 19) await new Promise(requestAnimationFrame);
  }
}"""

HEAP_JS = "async () => { if (window.gc) { gc(); gc(); } await new Promise(r => setTimeout(r, 200)); return performance.memory.usedJSHeapSize; }"

with sync_playwright() as p:
    # ---------- A ----------
    b = p.chromium.launch(executable_path=CHROME, args=['--js-flags=--expose-gc', '--enable-precise-memory-info'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE)
    pg.evaluate('localStorage.clear()')
    pg.reload()
    pg.click('[data-testid=touch]')
    pg.wait_for_timeout(500)
    samples = [{'strokes': 0, 'heapMB': round(pg.evaluate(HEAP_JS) / 1048576, 2)}]
    t0 = time.time()
    for i in range(10):
        pg.evaluate(DRAW_JS, [300, 40, 1234 + i])
        inf = pg.evaluate('window.__aircanvas.info()')
        t1 = time.perf_counter()
        pg.evaluate("document.querySelector('[data-testid=undo]').click(); document.querySelector('[data-testid=redo]').click();")
        pg.evaluate('new Promise(requestAnimationFrame)')
        undo_ms = (time.perf_counter() - t1) * 1000
        heap = pg.evaluate(HEAP_JS)
        samples.append({'strokes': inf['strokes'], 'points': inf['points'], 'heapMB': round(heap / 1048576, 2), 'undoRedoMs': round(undo_ms)})
        print(samples[-1], flush=True)
    # 帧时间（画布已有 3000 笔时，持续画一笔期间的 rAF 间隔）
    frame = pg.evaluate("""async () => {
      const times = []; let last = performance.now();
      const c = document.querySelector('[data-testid=canvas]'); const r = c.getBoundingClientRect();
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true}));
      ev('pointerdown', r.left + 100, r.top + 300);
      for (let i = 0; i < 120; i++) { ev('pointermove', r.left + 100 + i * 8, r.top + 300 + Math.sin(i / 8) * 80); await new Promise(requestAnimationFrame); const n = performance.now(); times.push(n - last); last = n; }
      ev('pointerup', 0, 0);
      times.sort((a, b) => a - b);
      return { median: times[60], p95: times[114] };
    }""")
    pg.wait_for_timeout(1500)
    stored = pg.evaluate("(localStorage.getItem('aircanvas.artwork.v1')||'').length")
    toast = pg.locator('[data-testid=toast]').inner_text() if pg.locator('[data-testid=toast]').count() else ''
    # 清空 → 撤销恢复
    pg.click('[data-testid=clear]')
    pg.click('[data-testid=undo]')
    restored = pg.evaluate('window.__aircanvas.info().strokes')
    out['A'] = {'samples': samples, 'elapsedSec': round(time.time() - t0, 1), 'frameMsWith3000Strokes': frame,
                'localStorageChars': stored, 'toast': toast, 'clearUndoRestored': restored, 'errors': errs[:5]}
    ctx.close()
    b.close()

    # ---------- B ----------
    b = p.chromium.launch(executable_path=CHROME, args=[
        '--js-flags=--expose-gc', '--enable-precise-memory-info', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={FAKE_VIDEO}'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, permissions=['camera'])
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE)
    pg.evaluate("localStorage.setItem('aircanvas.guideSeen.v1','1')")
    pg.click('[data-testid=start]')
    pg.wait_for_function("window.__aircanvas && window.__aircanvas.info().detections > 3", timeout=60000)
    trace = []
    start = time.time()
    d0 = pg.evaluate('window.__aircanvas.info().detections')
    while time.time() - start < DUR:
        heap = pg.evaluate(HEAP_JS)
        inf = pg.evaluate('window.__aircanvas.info()')
        trace.append({'t': round(time.time() - start), 'heapMB': round(heap / 1048576, 2), 'detections': inf['detections'], 'hands': inf['hands'], 'inferMs': inf['inferMs']})
        print(trace[-1], flush=True)
        pg.wait_for_timeout(15000)
    d1 = pg.evaluate('window.__aircanvas.info().detections')
    out['B'] = {'trace': trace, 'detectionsPerSec': round((d1 - d0) / (time.time() - start), 1), 'errors': errs[:5],
                'delegate': pg.evaluate('window.__aircanvas.info().delegate')}
    ctx.close()
    b.close()

json.dump(out, open('/workspace/aircanvas-e2e/stress.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ('samples', 'trace')} for k, v in out.items()}, ensure_ascii=False, indent=1))
