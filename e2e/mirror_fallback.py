"""本站模型/wasm 不可用时（模拟 github.io 在大陆连不上），自动改用 jsDelivr 备用源"""
import os, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
FAKE_VIDEO = os.environ.get('FAKE_VIDEO', '/workspace/aircanvas-e2e/hand.y4m')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={FAKE_VIDEO}'])
    ctx = b.new_context(viewport={'width': 1180, 'height': 820}, permissions=['camera'])
    host = urlparse(BASE).netloc
    ctx.route(lambda u: urlparse(u).netloc == host and ('/models/' in u or '/wasm/' in u), lambda r: r.abort('connectionfailed'))
    pg = ctx.new_page()
    reqs = []
    pg.on('request', lambda r: reqs.append(r.url))
    pg.goto(BASE)
    pg.evaluate("localStorage.setItem('aircanvas.guideSeen.v1','1')")
    t0 = time.time()
    pg.click('[data-testid=start]')
    pg.wait_for_function('window.__aircanvas.info().detections > 0', timeout=120000)
    used = sorted({urlparse(u).netloc for u in reqs if 'jsdelivr' in u})
    print('PASS 本站不可用 → 备用源加载成功', f'{time.time() - t0:.1f}s', used, [u.split('@')[-1] for u in reqs if 'jsdelivr' in u][:4])
    b.close()
