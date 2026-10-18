"""慢网测试：模拟 1.5Mbps 下行，测首次 / 二次打开到「可画」「手势就绪」的时间和下载量
用法: python3 e2e/slownet.py <base_url> <label> [down_kbps=1500] [latency_ms=150]
二次打开分两种：A 正常 HTTP 缓存；B 禁用 HTTP 缓存（模拟 max-age=600 过期 / Safari 清掉了 HTTP 缓存）
"""
import json, os, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE, LABEL = sys.argv[1], sys.argv[2]
KBPS = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
LAT = int(sys.argv[4]) if len(sys.argv) > 4 else 150
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
FAKE_VIDEO = os.environ.get('FAKE_VIDEO', '/workspace/aircanvas-e2e/hand.y4m')
GPU_HANG = os.environ.get('GPU_HANG') == '1'


def run_open(ctx, cdp_cache_disabled=False, timeout=400):
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg)
    cdp.send('Network.enable')
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': LAT,
             'downloadThroughput': KBPS * 1000 / 8, 'uploadThroughput': 750 * 1000 / 8})
    cdp.send('Network.setCacheDisabled', {'cacheDisabled': cdp_cache_disabled})
    sizes, urls, cached = {}, {}, set()
    cdp.on('Network.requestWillBeSent', lambda e: urls.__setitem__(e['requestId'], e['request']['url']))
    cdp.on('Network.requestServedFromCache', lambda e: cached.add(e['requestId']))
    cdp.on('Network.loadingFinished', lambda e: sizes.__setitem__(e['requestId'], e['encodedDataLength']))
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(BASE, wait_until='domcontentloaded', timeout=120000)
    pg.wait_for_selector('[data-testid=start]', timeout=120000)
    t_landing = time.time() - t0
    t1 = time.time()
    pg.click('[data-testid=start]')
    pg.wait_for_selector('[data-testid=toolbar]')
    # 可画：画布可以接受触屏/鼠标笔画
    b = pg.locator('[data-testid=canvas]').bounding_box()
    if pg.locator('[data-testid=guide-ok]').count():
        pg.click('[data-testid=guide-ok]')
    pg.mouse.move(b['x'] + b['width'] * 0.2, b['y'] + b['height'] * 0.6)
    pg.mouse.down()
    pg.mouse.move(b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.62, steps=8)
    pg.mouse.up()
    drew = pg.evaluate('window.__aircanvas.info().strokes')
    t_draw = time.time() - t1
    ready = None
    while time.time() - t1 < timeout:
        i = pg.evaluate('window.__aircanvas && window.__aircanvas.info()')
        if i and i['detections'] > 0:
            ready = time.time() - t1
            break
        if pg.locator('[data-testid=guide-ok]').count():
            pg.click('[data-testid=guide-ok]')
        pg.wait_for_timeout(250)
    info = pg.evaluate('window.__aircanvas.info()')
    pg.wait_for_timeout(300)
    big = {}
    total = 0
    for rid, sz in sizes.items():
        u = urls.get(rid, '')
        total += sz
        if sz > 50000:
            big[urlparse(u).path.split('/')[-1] + ('@' + urlparse(u).netloc if urlparse(u).netloc != urlparse(BASE).netloc else '')] = round(sz / 1e6, 2)
    status = pg.locator('[data-testid=status]').inner_text() if pg.locator('[data-testid=status]').count() else ''
    pg.close()
    return {'landingSec': round(t_landing, 1), 'drawableSec': round(t_draw, 1), 'drewDuringLoad': drew,
            'gestureReadySec': round(ready, 1) if ready else None, 'delegate': info.get('delegate'),
            'networkMB': round(total / 1e6, 2), 'bigFiles': big, 'errors': errs[:3], 'lastStatus': status}


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=[
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        f'--use-file-for-fake-video-capture={FAKE_VIDEO}'])
    ctx = b.new_context(viewport={'width': 1180, 'height': 820}, permissions=['camera'])
    if GPU_HANG:
        ctx.add_init_script('window.__aircanvasTest = { gpuHang: true };')
    res = {'label': LABEL, 'kbps': KBPS, 'latencyMs': LAT}
    res['first'] = run_open(ctx)
    print('first', res['first'], flush=True)
    res['secondHttpCache'] = run_open(ctx)
    print('second(http cache)', res['secondHttpCache'], flush=True)
    res['secondNoHttpCache'] = run_open(ctx, cdp_cache_disabled=True)
    print('second(no http cache)', res['secondNoHttpCache'], flush=True)
    b.close()
json.dump(res, open(f'/workspace/aircanvas-e2e/slownet_{LABEL}.json', 'w'), ensure_ascii=False, indent=1)
