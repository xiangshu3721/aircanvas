"""AirCanvas 端到端测试（Playwright + Chromium 无头）
用法: python3 e2e/e2e.py <base_url> [tag]   例: python3 e2e/e2e.py http://127.0.0.1:4173/ local
需要: pip install playwright；Chrome 路径可用 CHROME=/usr/bin/google-chrome 指定
"""
import json, os, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173/'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'local'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
SHOTS = os.environ.get('SHOTS', '/workspace/aircanvas-shots')
FAKE_VIDEO = os.environ.get('FAKE_VIDEO', '/workspace/aircanvas-e2e/hand.y4m')
os.makedirs(SHOTS, exist_ok=True)
PRE = '' if TAG == 'local' else TAG + '_'
results = []


MIRROR_WHITELIST = {'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'}


def external(reqs):
    return [u for u in reqs if urlparse(u).netloc != urlparse(BASE).netloc and not u.startswith(('data:', 'blob:'))]


def ok(name, cond, info=''):
    results.append({'name': name, 'pass': bool(cond), 'info': str(info)})
    print(('PASS' if cond else 'FAIL'), name, info, flush=True)


GUM_COUNTER = """
(() => {
  window.__gumCalls = 0;
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => { window.__gumCalls++; return orig(c); };
  }
})();
"""


def mock_gum_error(name):
    return """
(() => {
  window.__gumCalls = 0;
  const md = navigator.mediaDevices || {};
  md.getUserMedia = () => { window.__gumCalls++; return Promise.reject(new DOMException('mock', '%s')); };
})();
""" % name


def info(pg):
    return pg.evaluate('window.__aircanvas && window.__aircanvas.info()')


def overflow(pg):
    return pg.evaluate('Math.max(document.documentElement.scrollWidth - innerWidth, document.body.scrollWidth - innerWidth)')


def canvas_box(pg):
    return pg.locator('[data-testid=canvas]').bounding_box()


def draw(pg, pts, touch=False, cdp=None):
    """pts: 相对画布的 0~1 坐标列表"""
    b = canvas_box(pg)
    abs_pts = [(b['x'] + x * b['width'], b['y'] + y * b['height']) for x, y in pts]
    if touch:
        x0, y0 = abs_pts[0]
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0, 'id': 1}]})
        for x, y in abs_pts[1:]:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    else:
        pg.mouse.move(*abs_pts[0])
        pg.mouse.down()
        for x, y in abs_pts[1:]:
            pg.mouse.move(x, y, steps=2)
        pg.mouse.up()
    pg.wait_for_timeout(80)


def line(x0, y0, x1, y1, n=16):
    return [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]


def pixel_alpha(pg, nx, ny):
    """读取已完成笔画层某个归一化位置的像素 alpha"""
    return pg.evaluate("""([nx, ny]) => {
      const c = document.querySelector('.layer-done');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(Math.round(nx * c.width), Math.round(ny * c.height), 1, 1).data;
      return d[3];
    }""", [nx, ny])


def new_page(b, vp, mobile, init=None, perms=None):
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile,
                        accept_downloads=True, permissions=perms or [])
    if init:
        ctx.add_init_script(init)
    pg = ctx.new_page()
    errs, reqs = [], []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: reqs.append(r.url))
    return ctx, pg, errs, reqs


def ui_suite(b, name, vp, mobile):
    V = name + ': '
    ctx, pg, errs, reqs = new_page(b, vp, mobile, GUM_COUNTER)
    cdp = ctx.new_cdp_session(pg) if mobile else None
    pg.goto(BASE)
    pg.wait_for_selector('[data-testid=start]')
    ok(V + '首屏标题', 'AirCanvas' in pg.locator('h1').inner_text() and '空中画板' in pg.locator('h1').inner_text())
    ok(V + '首屏提示语', pg.get_by_text('伸出双手，让创意在空气中绽放').count() == 1)
    ok(V + '首屏两个按钮', pg.get_by_text('开始创作').count() == 1 and pg.get_by_text('触屏绘画').count() == 1)
    pg.wait_for_timeout(500)
    ok(V + '加载时不自动申请摄像头', pg.evaluate('window.__gumCalls') == 0, pg.evaluate('window.__gumCalls'))
    ok(V + '首屏无横向溢出', overflow(pg) <= 0, overflow(pg))
    pg.wait_for_timeout(2500)
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}01_landing_{name}.png')

    pg.click('[data-testid=touch]')
    pg.wait_for_selector('[data-testid=toolbar]')
    pg.wait_for_timeout(300)
    ok(V + '触屏模式不申请摄像头', pg.evaluate('window.__gumCalls') == 0)
    ok(V + '空画布提示', pg.locator('.empty-hint').count() == 1)
    ok(V + '画布铺满', abs(info(pg)['size']['w'] - vp['width']) <= 1 and abs(info(pg)['size']['h'] - vp['height']) <= 1, info(pg)['size'])

    # 画线
    draw(pg, line(0.2, 0.35, 0.8, 0.4), mobile, cdp)
    i = info(pg)
    ok(V + ('触屏' if mobile else '鼠标') + '画线生成 1 笔', i['strokes'] == 1 and i['points'] > 5, i['points'])
    ok(V + '线条真的画到了画布上', pixel_alpha(pg, 0.5, 0.375) > 0, pixel_alpha(pg, 0.5, 0.375))
    ok(V + '空画布提示在第一笔后隐藏', pg.locator('.empty-hint').count() == 0)
    p0 = i['lastStroke']['points'][0]
    ok(V + '坐标准确（起点）', abs(p0['x'] - 0.2) < 0.01 and abs(p0['y'] - 0.35) < 0.01, p0)

    # 颜色
    pg.click('[data-color="#FF4757"]')
    ok(V + '颜色选中有光环', pg.locator('[data-color="#FF4757"].on').count() == 1)
    draw(pg, line(0.2, 0.5, 0.8, 0.5), mobile, cdp)
    ok(V + '颜色生效', info(pg)['lastStroke']['color'] == '#FF4757', info(pg)['lastStroke']['color'])
    # 自定义颜色
    pg.locator('[data-testid=color-custom]').fill('#123456')
    pg.wait_for_timeout(100)
    draw(pg, line(0.25, 0.55, 0.7, 0.58), mobile, cdp)
    ok(V + '自定义颜色生效', info(pg)['lastStroke']['color'].upper() == '#123456', info(pg)['lastStroke']['color'])
    pg.click('[data-color="#2ED573"]')

    # 粗细
    pg.click('[data-testid=size-btn]')
    pg.wait_for_selector('[data-testid=size-pop]')
    if mobile:
        pg.wait_for_timeout(450)
        pg.screenshot(path=f'{SHOTS}/{PRE}04_mobile_toolbar_size_{name}.png')
    pg.click('[data-width="12"]')
    draw(pg, line(0.2, 0.6, 0.8, 0.62), mobile, cdp)
    ok(V + '粗细预设生效(12)', info(pg)['lastStroke']['width'] == 12)
    pg.click('[data-testid=size-btn]')
    pg.locator('[data-testid=size-slider]').fill('25')
    pg.click('[data-testid=size-btn]')
    draw(pg, line(0.2, 0.66, 0.8, 0.66), mobile, cdp)
    ok(V + '粗细滑杆生效(25)', info(pg)['lastStroke']['width'] == 25, info(pg)['lastStroke']['width'])
    pg.click('[data-testid=size-btn]')
    pg.click('[data-width="6"]')

    # 荧光
    pg.click('[data-testid=brush-glow]')
    pg.click('[data-color="#00D2D3"]')
    draw(pg, [(0.3 + 0.15 * __import__('math').cos(t / 10 * 6.283), 0.25 + 0.08 * __import__('math').sin(t / 10 * 6.283)) for t in range(11)], mobile, cdp)
    ok(V + '荧光画笔生效', info(pg)['lastStroke']['brushType'] == 'glow')
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}02_board_drawing_{name}.png')
    if mobile:
        pg.wait_for_timeout(450)
        pg.screenshot(path=f'{SHOTS}/{PRE}04_mobile_toolbar_{name}.png')
    pg.click('[data-testid=brush-normal]')

    n = info(pg)['strokes']
    # 撤销 / 重做
    pg.click('[data-testid=undo]')
    ok(V + '撤销', info(pg)['strokes'] == n - 1)
    pg.click('[data-testid=redo]')
    ok(V + '重做', info(pg)['strokes'] == n)
    pg.keyboard.press('Control+z')
    ok(V + '快捷键 Ctrl+Z', info(pg)['strokes'] == n - 1)
    pg.keyboard.press('Control+Shift+z')
    ok(V + '快捷键 Ctrl+Shift+Z', info(pg)['strokes'] == n)
    # 清空后撤销
    pg.click('[data-testid=clear]')
    ok(V + '清空', info(pg)['strokes'] == 0 and pixel_alpha(pg, 0.5, 0.375) == 0)
    pg.click('[data-testid=undo]')
    ok(V + '清空后撤销恢复', info(pg)['strokes'] == n and pixel_alpha(pg, 0.5, 0.375) > 0)
    color_before = pg.locator('.swatch.on').get_attribute('data-color')
    ok(V + '清空不重置颜色', color_before == '#00D2D3', color_before)

    # 设置面板：白底
    pg.click('[data-testid=settings]')
    pg.wait_for_selector('[data-testid=settings-panel]')
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}05_settings_{name}.png')
    pg.click('[data-testid=bg-white]')
    pg.wait_for_timeout(300)
    bg = pg.evaluate("getComputedStyle(document.querySelector('.app')).backgroundColor")
    ok(V + '白板切换为白底且内容不丢', bg == 'rgb(255, 255, 255)' and info(pg)['strokes'] == n, bg)
    pg.click('[data-testid=bg-black]')
    pg.click('[data-testid=settings]')

    # 横竖屏 resize
    before = info(pg)
    pg.set_viewport_size({'width': vp['height'], 'height': vp['width']})
    pg.wait_for_timeout(400)
    after = info(pg)
    ok(V + 'resize 后笔画数不变', after['strokes'] == before['strokes'])
    ok(V + 'resize 后画布尺寸更新', after['size']['w'] == vp['height'] and after['size']['h'] == vp['width'], after['size'])
    ok(V + 'resize 后按比例重绘（原线条位置仍有像素）', pixel_alpha(pg, 0.5, 0.375) > 0)
    draw(pg, line(0.1, 0.8, 0.4, 0.82), mobile, cdp)
    p0 = info(pg)['lastStroke']['points'][0]
    ok(V + 'resize 后新笔画坐标不乱', abs(p0['x'] - 0.1) < 0.01 and abs(p0['y'] - 0.8) < 0.01, p0)
    ok(V + '横屏无横向溢出', overflow(pg) <= 0, overflow(pg))
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}06_landscape_{name}.png')
    pg.set_viewport_size(vp)
    pg.wait_for_timeout(300)

    # 导出
    pg.click('[data-testid=save]')
    pg.wait_for_selector('[data-testid=export-img]')
    nat = pg.evaluate("(() => { const i = document.querySelector('[data-testid=export-img]'); return [i.naturalWidth, i.naturalHeight]; })()")
    sz = info(pg)['size']
    scale = max(2, 2 if mobile else 1)
    ok(V + 'PNG 导出尺寸 = 画布 × 倍率', nat[0] == round(sz['w'] * scale) and nat[1] == round(sz['h'] * scale), (nat, sz))
    ok(V + '导出不改变作品', info(pg)['strokes'] == n + 1)
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}07_export_{name}.png')
    if not mobile:
        with pg.expect_download() as dl:
            pg.click('[data-testid=export-save]')
        d = dl.value
        path = f'/tmp/aircanvas-{name}.png'
        d.save_as(path)
        head = open(path, 'rb').read(8)
        ok(V + 'PNG 下载成功', head[:4] == b'\x89PNG', d.suggested_filename)
    pg.locator('.modal-close').click()

    ok(V + '无横向溢出', overflow(pg) <= 0, overflow(pg))
    # 本地保存：刷新后仍在
    count = info(pg)['strokes']
    pg.wait_for_timeout(900)
    stored = pg.evaluate("(localStorage.getItem('aircanvas.artwork.v1')||'').length")
    ok(V + '已自动保存到 localStorage', stored > 100, stored)
    pg.reload()
    pg.wait_for_selector('[data-testid=touch]')
    ok(V + '首屏提示有上次作品', pg.locator('.saved-tip').count() == 1)
    pg.click('[data-testid=touch]')
    pg.wait_for_timeout(400)
    ok(V + '刷新后作品自动恢复', info(pg)['strokes'] == count and pixel_alpha(pg, 0.5, 0.375) > 0, (info(pg)['strokes'], count))
    ok(V + '刷新后画笔设置恢复', pg.locator('.swatch.on').get_attribute('data-color') == '#00D2D3')
    pg.click('[data-testid=clear]')
    pg.wait_for_timeout(900)
    pg.reload()
    pg.click('[data-testid=touch]')
    pg.wait_for_timeout(300)
    ok(V + '清空后刷新同步为空', info(pg)['strokes'] == 0)
    # 重新可撤销历史不会跨刷新，正常
    ok(V + '控制台无报错', len(errs) == 0, errs[:3])
    ext = external(reqs)
    ok(V + '外部请求只允许 jsDelivr 备用源白名单', all(urlparse(u).netloc in MIRROR_WHITELIST for u in ext), ext[:5])
    ok(V + '本站优先：网络正常时没有用到备用源', len(ext) == 0, ext[:5])
    ok(V + '首屏空闲预取了模型（本站）', any('models/hand_landmarker.task' in u for u in reqs))
    ctx.close()


def denial_suite(b):
    for err, expect in [('NotAllowedError', '没有拿到摄像头权限'), ('NotReadableError', '摄像头被占用了'), ('NotFoundError', '没找到摄像头')]:
        for name, vp, mobile in [('mobile', {'width': 390, 'height': 844}, True), ('desktop', {'width': 1440, 'height': 900}, False)]:
            ctx, pg, errs, _ = new_page(b, vp, mobile, mock_gum_error(err))
            cdp = ctx.new_cdp_session(pg) if mobile else None
            pg.goto(BASE)
            pg.click('[data-testid=start]')
            pg.wait_for_selector('[data-testid=notice]', timeout=8000)
            t = pg.locator('[data-testid=notice]').inner_text()
            ok(f'{name}: {err} → 清晰提示原因', expect in t, t.split('\n')[1] if '\n' in t else t)
            ok(f'{name}: {err} → 自动切到白板', pg.locator('[data-testid=mode-board][aria-selected=true]').count() == 1)
            if err == 'NotAllowedError':
                pg.wait_for_timeout(450)
                pg.screenshot(path=f'{SHOTS}/{PRE}08_denied_{name}.png')
            pg.click('[data-testid=notice-touch]')
            draw(pg, line(0.2, 0.4, 0.7, 0.45), mobile, cdp)
            ok(f'{name}: {err} → 降级后仍可触屏绘画', info(pg)['strokes'] == 1)
            ok(f'{name}: {err} → 控制台无报错', len(errs) == 0, errs[:2])
            ctx.close()


def quota_suite(b):
    init = """
(() => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'aircanvas.artwork.v1') throw new DOMException('full', 'QuotaExceededError');
    return orig.call(this, k, v);
  };
})();
"""
    ctx, pg, errs, _ = new_page(b, {'width': 1440, 'height': 900}, False, init)
    pg.goto(BASE)
    pg.click('[data-testid=touch]')
    draw(pg, line(0.2, 0.4, 0.7, 0.45))
    pg.wait_for_selector('[data-testid=toast]', timeout=3000)
    t = pg.locator('[data-testid=toast]').inner_text()
    ok('本地容量满 → 轻提示且不崩溃', '本地空间满了' in t, t)
    draw(pg, line(0.2, 0.5, 0.7, 0.55))
    ok('本地容量满 → 仍可继续画', pg.evaluate('window.__aircanvas.info().strokes') == 2 and len(errs) == 0, errs[:2])
    ctx.close()


def fake_camera_suite(p):
    if not os.path.exists(FAKE_VIDEO):
        ok('fake 摄像头视频存在', False, FAKE_VIDEO)
        return
    b = p.chromium.launch(executable_path=CHROME, args=[
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        f'--use-file-for-fake-video-capture={FAKE_VIDEO}', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for name, vp, mobile in [('desktop', {'width': 1440, 'height': 900}, False), ('mobile', {'width': 390, 'height': 844}, True)]:
        V = f'fake 摄像头 {name}: '
        ctx, pg, errs, reqs = new_page(b, vp, mobile, GUM_COUNTER, perms=['camera'])
        pg.goto(BASE)
        pg.wait_for_selector('[data-testid=start]')
        pg.click('[data-testid=start]')
        t0 = time.time()
        try:
            pg.wait_for_selector('[data-testid=guide]', timeout=15000)
            ok(V + '摄像头画面出来就弹新手指引（不用等模型）', True, f'{time.time() - t0:.1f}s')
        except Exception:
            ok(V + '摄像头画面出来就弹新手指引（不用等模型）', False, errs[:3])
            pg.screenshot(path=f'{SHOTS}/{PRE}fail_fakecam_{name}.png')
            ctx.close()
            continue
        if name == 'desktop':
            pg.wait_for_timeout(450)
            pg.screenshot(path=f'{SHOTS}/{PRE}09_guide_{name}.png')
        pg.click('[data-testid=guide-ok]')
        ok(V + '「知道了」写入 localStorage', pg.evaluate("localStorage.getItem('aircanvas.guideSeen.v1')") == '1')
        found = False
        for _ in range(60):
            i = info(pg)
            if i['hands'] > 0 and i['cursorVisible']:
                found = True
                break
            pg.wait_for_timeout(250)
        i = info(pg)
        ok(V + '识别出手并出现光标', found, json.dumps({k: i[k] for k in ('hands', 'gesture', 'detections', 'inferMs', 'delegate', 'cursor')}, ensure_ascii=False))
        status = pg.locator('[data-testid=status]').inner_text() if pg.locator('[data-testid=status]').count() else ''
        ok(V + '状态提示显示已识别手掌', '已识别手掌' in status or '正在绘画' in status, status)
        pg.click('[data-testid=settings]')
        pg.click('[data-testid=toggle-debug]')
        pg.click('[data-testid=settings]')
        pg.wait_for_timeout(600)
        pg.wait_for_timeout(450)
        pg.screenshot(path=f'{SHOTS}/{PRE}03_camera_fake_{name}.png')
        # 镜像方向：画面里的手指在原始帧中位置 vs 光标位置
        c1 = info(pg)['cursor']
        pg.click('[data-testid=settings]')
        pg.click('[data-testid=toggle-mirror]')
        pg.click('[data-testid=settings]')
        pg.wait_for_timeout(500)
        c2 = info(pg)['cursor']
        ok(V + '切换镜像后光标左右翻转', abs((c1['x'] + c2['x']) - 1) < 0.03, (round(c1['x'], 3), round(c2['x'], 3)))
        pg.click('[data-testid=settings]')
        pg.click('[data-testid=toggle-mirror]')
        pg.click('[data-testid=settings]')
        # 模式切换不丢内容
        cdp = ctx.new_cdp_session(pg) if mobile else None
        draw(pg, line(0.2, 0.3, 0.6, 0.35), mobile, cdp)
        n = info(pg)['strokes']
        pg.click('[data-testid=mode-board]')
        pg.wait_for_timeout(300)
        ok(V + '切到白板：视频隐藏、内容不丢', info(pg)['strokes'] == n and pg.locator('.cam-video.visible').count() == 0)
        pg.wait_for_timeout(600)
        ok(V + '白板模式摄像头后台继续识别', info(pg)['hands'] > 0, info(pg)['detections'])
        pg.click('[data-testid=mode-camera]')
        pg.wait_for_timeout(300)
        ok(V + '切回摄像头：内容不丢', info(pg)['strokes'] == n and pg.locator('.cam-video.visible').count() == 1)
        # 包含摄像头画面导出
        pg.click('[data-testid=save]')
        pg.wait_for_selector('[data-testid=export-img]')
        pg.click('[data-testid=include-camera]')
        pg.wait_for_timeout(600)
        pg.wait_for_timeout(450)
        pg.screenshot(path=f'{SHOTS}/{PRE}07_export_with_camera_{name}.png')
        pg.locator('.modal-close').click()
        # 关闭摄像头
        pg.click('[data-testid=settings]')
        pg.click('[data-testid=camera-off]')
        pg.wait_for_timeout(400)
        live = pg.evaluate("(() => { const v = document.querySelector('video'); return !!(v && v.srcObject); })()")
        ok(V + '关闭摄像头后释放视频流', not live)
        ok(V + '关闭摄像头后内容仍在', info(pg)['strokes'] == n)
        ext = external(reqs)
        ok(V + '模型与 wasm 从本站加载', any('models/hand_landmarker.task' in u for u in reqs) and any('/wasm/vision_wasm' in u for u in reqs))
        ok(V + '外部请求只允许白名单，且网络正常时为 0', len(ext) == 0, ext[:5])
        # 二次打开：模型和 wasm 走本地缓存，不再请求网络
        n_before = len(reqs)
        pg2 = ctx.new_page()
        reqs2 = []
        pg2.on('request', lambda r: reqs2.append(r.url))
        pg2.goto(BASE)
        pg2.click('[data-testid=start]')
        t2 = time.time()
        pg2.wait_for_function('window.__aircanvas && window.__aircanvas.info().detections > 0', timeout=30000)
        ok(V + '二次打开：模型/wasm 走本地缓存（0 次网络请求）', not any(('hand_landmarker' in u or 'vision_wasm' in u) for u in reqs2),
           f'手势就绪 {time.time() - t2:.1f}s')
        pg2.close()
        errs2 = [e for e in errs if 'gl_' not in e.lower() and 'webgl' not in e.lower()]
        ok(V + '控制台无报错', len(errs2) == 0, errs[:3])
        ctx.close()
    # GPU 初始化卡住 → 8 秒后回退 CPU，期间可以画
    ctx, pg, errs, _ = new_page(b, {'width': 1180, 'height': 820}, False, 'window.__aircanvasTest = { gpuHang: true };', perms=['camera'])
    pg.goto(BASE)
    pg.evaluate("localStorage.setItem('aircanvas.guideSeen.v1','1')")
    pg.click('[data-testid=start]')
    t0 = time.time()
    pg.wait_for_selector('[data-testid=loading]', timeout=10000)
    draw(pg, line(0.2, 0.6, 0.6, 0.62))
    ok('GPU 卡住：加载期间可以用鼠标画', pg.evaluate('window.__aircanvas.info().strokes') == 1)
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}10_loading_bar_desktop.png')
    try:
        pg.wait_for_function('window.__aircanvas.info().detections > 0', timeout=40000)
        i = pg.evaluate('window.__aircanvas.info()')
        ok('GPU 初始化卡住 → 超时回退 CPU 并能识别', i['delegate'] == 'CPU', f"{time.time() - t0:.1f}s delegate={i['delegate']}")
    except Exception as e:
        ok('GPU 初始化卡住 → 超时回退 CPU 并能识别', False, str(e)[:120])
    ok('GPU 失败后记住改用 CPU（下次不再等 8 秒）', pg.evaluate("localStorage.getItem('aircanvas.delegate.v1')") == 'CPU')
    ctx.close()

    # 模型加载失败 → 提示 + 降级触屏
    ctx, pg, errs, _ = new_page(b, {'width': 390, 'height': 844}, True, None, perms=['camera'])
    pg.route('**/hand_landmarker.task', lambda r: r.fulfill(status=404, body='not found'))
    ctx.route('**/*jsdelivr.net/**', lambda r: r.fulfill(status=404, body='not found'))
    pg.goto(BASE)
    pg.click('[data-testid=start]')
    try:
        pg.wait_for_selector('[data-testid=notice]', timeout=60000)
        t = pg.locator('[data-testid=notice]').inner_text()
        ok('模型加载失败 → 提示原因', '手势识别没能启动' in t, t.split('\n')[1] if '\n' in t else t)
    except Exception as e:
        ok('模型加载失败 → 提示原因', False, str(e)[:100])
    ok('模型加载失败 → 自动切到白板并释放摄像头', pg.locator('[data-testid=mode-board][aria-selected=true]').count() == 1 and
       not pg.evaluate("!!document.querySelector('video').srcObject"))
    pg.wait_for_timeout(450)
    pg.screenshot(path=f'{SHOTS}/{PRE}08_model_failed_mobile.png')
    ok('模型加载失败 → 页面没挂（无未捕获异常）', not any('Uncaught' in e for e in errs), errs[:2])
    ctx.close()
    b.close()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ui_suite(b, 'mobile', {'width': 390, 'height': 844}, True)
    ui_suite(b, 'desktop', {'width': 1440, 'height': 900}, False)
    denial_suite(b)
    quota_suite(b)
    b.close()
    fake_camera_suite(p)

passed = sum(r['pass'] for r in results)
print(f'\n== {passed}/{len(results)} passed ==')
json.dump(results, open(f'/workspace/aircanvas-e2e/e2e_{TAG}.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if passed == len(results) else 1)
