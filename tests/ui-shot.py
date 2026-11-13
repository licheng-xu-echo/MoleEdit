# -*- coding: utf-8 -*-
"""ui-shot.py — 无 Chrome 环境下的真实浏览器截图与 UI 冒烟（PyQt5 QtWebEngine）。

背景：本会话沙箱禁止命名管道客户端连接，Chrome / Edge / Firefox 等多进程浏览器
无法启动（QtWebEngine 也需要 --single-process 才能在沙箱内运行），因此用
PyQt5 QtWebEngine（Chromium 56 内核）单进程模式加载 index.html，做真实渲染截图。

注意：该内核较旧（不支持 CSS Grid / flex gap / padStart），产品 CSS 已采用
flex + margin 布局以兼容；本脚本不测试依赖 padStart 的 gjf/sdf 导出。

用法：python tests/ui-shot.py
产物：shots/ui-*.png；stdout 输出 PASS/FAIL；有失败 exit 1。
"""
import os
import sys
import time
import json

# 统一 UTF-8 输出，避免 Windows 控制台 GBK 编码无法打印 Å / 中文
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")
PAGE = os.path.join(ROOT, "index.html")
os.makedirs(SHOTS, exist_ok=True)

os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
    "--no-sandbox --single-process --disable-gpu --disable-gpu-compositing "
    "--disable-dev-shm-usage --disable-features=UseSkiaRenderer "
    "--user-data-dir=" + os.path.join(SHOTS, "qtweb-profile")
)
os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"
os.environ["QT_QPA_PLATFORM"] = "windows"

from PyQt5 import QtCore, QtWidgets  # noqa: E402
from PyQt5 import QtWebEngineWidgets  # noqa: E402

results = []
console_msgs = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)[:300]))
    print(("PASS  " if ok else "FAIL  ") + name + (("   [" + str(detail)[:160] + "]") if detail != "" else ""), flush=True)


class Page(QtWebEngineWidgets.QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        console_msgs.append((int(level), str(message), int(line), str(source)))


class Harness:
    def __init__(self, app):
        self.app = app
        self.view = QtWebEngineWidgets.QWebEngineView()
        self.page = Page(self.view)
        self.view.setPage(self.page)
        self.view.setWindowFlags(QtCore.Qt.FramelessWindowHint | QtCore.Qt.Tool)
        self.view.resize(1440, 900)
        self.view.move(0, 0)
        s = self.page.settings()
        s.setAttribute(QtWebEngineWidgets.QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QtWebEngineWidgets.QWebEngineSettings.JavascriptEnabled, True)
        self.loaded = False
        self.page.loadFinished.connect(self._on_load)

    def _on_load(self, ok):
        self.loaded = bool(ok)

    def load(self):
        self.view.load(QtCore.QUrl.fromLocalFile(PAGE))
        self.view.show()
        self.view.raise_()

    def pump(self, ms):
        t0 = time.time()
        while (time.time() - t0) * 1000 < ms:
            self.app.processEvents()
            time.sleep(0.008)

    def wait_loaded(self, timeout=30.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            self.app.processEvents()
            if self.loaded:
                return True
            time.sleep(0.02)
        return False

    def js(self, code, timeout=10.0):
        """执行同步 JS，返回 (ok, value)；ok=False 时 value 为错误信息。"""
        expr = """
        (function(){
          try { var v = (function(){ %s })();
                return {__ok: true, value: (v === undefined ? null : v)}; }
          catch (e) { return {__ok: false, value: String(e && e.message || e)}; }
        })()
        """ % code
        box = {"done": False, "value": None}
        self.page.runJavaScript(expr, lambda v, b=box: b.update({"done": True, "value": v}))
        t0 = time.time()
        while time.time() - t0 < timeout:
            self.app.processEvents()
            if box["done"]:
                r = box["value"] or {}
                return bool(r.get("__ok")), r.get("value")
            time.sleep(0.005)
        return False, "js timeout"

    def js_async(self, code, timeout=15.0):
        """执行 async JS（await），返回 (ok, value)。"""
        expr = """
        (function(){
          window.__ui_shot_ready = false;
          window.__ui_shot_result = null;
          (async function(){
            try { var v = await (async function(){ %s })();
                  window.__ui_shot_result = {__ok: true, value: (v === undefined ? null : v)}; }
            catch (e) { window.__ui_shot_result = {__ok: false, value: String(e && e.message || e)}; }
            window.__ui_shot_ready = true;
          })();
          return true;
        })()
        """ % code
        ok, _ = self.js(expr, timeout=5)
        if not ok:
            return False, "js async start failed"
        t0 = time.time()
        while time.time() - t0 < timeout:
            self.app.processEvents()
            ready = {"done": False, "value": None}
            self.page.runJavaScript("!!window.__ui_shot_ready", lambda v, b=ready: b.update({"done": True, "value": v}))
            t1 = time.time()
            while time.time() - t1 < 0.4:
                self.app.processEvents()
                if ready["done"]:
                    break
                time.sleep(0.005)
            if ready["done"] and ready["value"] is True:
                res = {"done": False, "value": None}
                self.page.runJavaScript("window.__ui_shot_result", lambda v, b=res: b.update({"done": True, "value": v}))
                t1 = time.time()
                while time.time() - t1 < 1.0:
                    self.app.processEvents()
                    if res["done"]:
                        break
                    time.sleep(0.005)
                r = res["value"] or {}
                return bool(r.get("__ok")), r.get("value")
            time.sleep(0.01)
        return False, "js async timeout"

    def shot(self, name):
        self.pump(300)
        path = os.path.join(SHOTS, name)
        ok = self.view.grab().save(path)
        return ok, path


def main():
    app = QtWidgets.QApplication(sys.argv)
    h = Harness(app)
    h.load()
    if not h.wait_loaded(40):
        check("QtWebEngine 加载 index.html", False, "load timeout")
        return 1
    check("QtWebEngine 加载 index.html", True)
    ok, ua = h.js("return navigator.userAgent;")
    print("      浏览器: " + str(ua)[:130], flush=True)

    ok, val = h.js_async("if (!window.MolApp) throw new Error('no MolApp'); await MolApp.ready; return MolApp.version;", timeout=30)
    check("MolApp.ready 完成", ok and val == "1.0.0", val)
    ok, deps = h.js("return {core: typeof MolCore, render: typeof MolRender, samples: typeof MolSamples, parse: typeof (window.MolCore && MolCore.parseFile)};")
    check("依赖全局对象齐全", ok and deps and deps.get("core") == "object" and deps.get("render") == "object" and deps.get("samples") == "object" and deps.get("parse") == "function", deps)
    ok, deps2 = h.js("return {layout: getComputedStyle(document.getElementById('main')).display, canvas: getComputedStyle(document.getElementById('viewport-canvas')).width + 'x' + getComputedStyle(document.getElementById('viewport-canvas')).height};")
    check("主布局 flex 生效且画布有尺寸", ok and deps2 and deps2.get("layout") == "flex" and deps2.get("canvas") != "0pxx0px", deps2)

    ok, st = h.js("return MolApp.getState();")
    check("初始空状态", ok and st and st.get("hasMolecule") is False, st)
    ok, path = h.shot("ui-empty.png")
    check("截图 ui-empty.png", ok, path)

    # 加载示例
    ok, res = h.js_async("var r = await MolApp.loadSample('water-xyz'); return r;", timeout=15)
    check("loadSample(water-xyz)", ok and res and res.get("atomCount") == 3 and res.get("bondCount") == 2, res)
    h.pump(600)
    ok, path = h.shot("ui-water.png")
    check("截图 ui-water.png", ok, path)

    # 选择 + 测量
    h.js("MolApp.setSelection([1,0,2]); return true;")
    h.pump(450)
    ok, m = h.js("return MolApp.getMeasurements();")
    check("键长/键角测量", ok and m and abs(float(m.get("distance")) - 0.9572) < 0.01 and abs(float(m.get("angle")) - 104.5) < 0.5, m)
    ok, dom = h.js("return {d: document.getElementById('measure-distance').textContent, a: document.getElementById('measure-angle').textContent, c: document.getElementById('selection-count').textContent, badge: document.querySelectorAll('.ov-badge:not([hidden])').length, label: document.querySelectorAll('.ov-label:not([hidden])').length};")
    check("DOM 测量文本", ok and dom and dom.get("d", "").startswith("d = ") and "104" in dom.get("a", ""), dom)
    check("叠加层 3 徽标 + 1 测量标签", ok and dom and dom.get("badge") == 3 and dom.get("label") == 1, dom)
    ok, path = h.shot("ui-measure.png")
    check("截图 ui-measure.png", ok, path)

    # 编辑键长
    ok, ap = h.js("var r = MolApp.applyBondLength(1.2, {atoms:[0,1]}); return r;")
    check("applyBondLength(1.2)", ok and ap and abs(float(ap.get("after")) - 1.2) < 1e-6, ap)
    h.pump(400)
    ok, m = h.js("return MolApp.getMeasurements();")
    check("键长生效 1.2", ok and abs(float(m.get("distance")) - 1.2) < 1e-6, m)
    ok, inp = h.js("return document.getElementById('bond-length-input').value;")
    check("输入框回填 1.2", ok and str(inp).startswith("1.2"), inp)
    ok, path = h.shot("ui-edit.png")
    check("截图 ui-edit.png", ok, path)

    # undo / redo
    ok, u = h.js("return MolApp.undo();")
    ok2, m2 = h.js("return MolApp.getMeasurements();")
    check("undo 恢复键长", ok and u is True and ok2 and abs(float(m2.get("distance")) - 0.9572) < 0.01, m2)
    ok, r = h.js("return MolApp.redo();")
    ok2, m3 = h.js("return MolApp.getMeasurements();")
    check("redo 恢复 1.2", ok and r is True and ok2 and abs(float(m3.get("distance")) - 1.2) < 1e-6, m3)

    # 真实 PointerEvent 点选原子
    h.js("MolApp.clearSelection(); return true;")
    h.pump(250)
    ok, badgePos = h.js("var b = document.querySelector('.ov-badge:not([hidden])'); if (!b) { MolApp.setSelection([0]); b = document.querySelector('.ov-badge'); } var r = document.getElementById('viewport-canvas').getBoundingClientRect(); return b ? {left: parseFloat(b.style.left), top: parseFloat(b.style.top), rectLeft: r.left, rectTop: r.top} : null;")
    hit = None
    hit_xy = None
    if ok and badgePos:
        # 先保证有徽标位置：临时选中原子 0，扫描点击（点空白会清空选择）
        h.js("MolApp.setSelection([0]); return true;")
        h.pump(250)
        ok, badgePos = h.js("var b = document.querySelector('.ov-badge:not([hidden])'); var r = document.getElementById('viewport-canvas').getBoundingClientRect(); return b ? {left: parseFloat(b.style.left), top: parseFloat(b.style.top), rectLeft: r.left, rectTop: r.top} : null;")
        if ok and badgePos:
            cx = badgePos["left"] + badgePos["rectLeft"]
            cy = badgePos["top"] + badgePos["rectTop"]
            h.js("MolApp.clearSelection(); return true;")
            h.pump(100)
            for dy in range(0, 320, 8):
                h.js("(function(){var c=document.getElementById('viewport-canvas');var o={bubbles:true,cancelable:true,clientX:%f,clientY:%f,button:0,pointerId:1};c.dispatchEvent(new PointerEvent('pointerdown',o));c.dispatchEvent(new PointerEvent('pointerup',o));return true;})();" % (cx, cy + dy))
                ok2, sel = h.js("return MolApp.getState().selection;")
                if ok2 and sel and len(sel) > 0:
                    hit = {"atom": sel[0], "dy": dy}
                    hit_xy = (cx, cy + dy)
                    break
    check("真实 PointerEvent 点选原子", hit is not None, hit)

    # 悬停高亮：鼠标移到原子上，canvas cursor 应为 pointer
    if hit_xy:
        h.js("(function(){var c=document.getElementById('viewport-canvas');c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:%f,clientY:%f,pointerId:1}));return true;})();" % hit_xy)
        h.pump(150)
        ok, cur = h.js("return document.getElementById('viewport-canvas').style.cursor;")
        check("悬停原子时鼠标指针变为 pointer", ok and cur == "pointer", cur)

    # 拖动空白旋转（真实 pointer 事件，比较徽标投影位置）
    h.js("MolApp.setSelection([0]); return true;")
    h.pump(300)
    ok, before_badge = h.js("var b=document.querySelector('.ov-badge:not([hidden])'); var r=document.getElementById('viewport-canvas').getBoundingClientRect(); return b?{left:parseFloat(b.style.left),top:parseFloat(b.style.top),rectLeft:r.left,rectTop:r.top}:null;")
    if ok and before_badge:
        bx = before_badge["left"] + before_badge["rectLeft"]
        by = before_badge["top"] + before_badge["rectTop"]
        # 在左上角空白处拖动
        h.js("(function(){var c=document.getElementById('viewport-canvas');var sx=80,sy=80;c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:sx,clientY:sy,button:0,pointerId:3}));for(var i=1;i<=8;i++){c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:sx+i*12,clientY:sy+i*5,button:0,pointerId:3}));}c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:sx+96,clientY:sy+40,button:0,pointerId:3}));return true;})();")
        h.pump(350)
        ok, after_badge = h.js("var b=document.querySelector('.ov-badge:not([hidden])'); return b?{left:parseFloat(b.style.left),top:parseFloat(b.style.top)}:null;")
        moved_ok = bool(ok and after_badge and (abs(after_badge["left"] - before_badge["left"]) + abs(after_badge["top"] - before_badge["top"]) > 2))
        check("拖动空白旋转视图（投影位移动）", moved_ok, {"before": before_badge and (before_badge["left"], before_badge["top"]), "after": after_badge and (after_badge["left"], after_badge["top"])})
    else:
        check("拖动空白旋转视图（投影位移动）", False, "无徽标位置")

    # 键盘快捷键（真实 KeyboardEvent）
    h.js("MolApp.setSelection([0,1]); return true;")
    ok, apk = h.js("return MolApp.applyBondLength(1.05, {atoms:[0,1]});")
    before_kd = float(apk.get("before")) if (ok and apk) else None
    h.pump(300)
    ok, kd1 = h.js("return MolApp.getMeasurements().distance;")
    h.js("document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true, cancelable:true})); return true;")
    h.pump(300)
    ok, kd2 = h.js("return MolApp.getMeasurements().distance;")
    check("Ctrl+Z 键盘撤销", ok and before_kd is not None and abs(float(kd1) - 1.05) < 1e-6 and abs(float(kd2) - before_kd) < 1e-6, {"before": before_kd, "after": kd2})
    h.js("document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Z', ctrlKey:true, shiftKey:true, bubbles:true, cancelable:true})); return true;")
    h.pump(300)
    ok, kd3 = h.js("return MolApp.getMeasurements().distance;")
    check("Ctrl+Shift+Z 键盘重做", ok and abs(float(kd3) - 1.05) < 1e-6, kd3)
    h.js("MolApp.setSelection([0]); return true;")
    h.pump(100)
    h.js("document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); return true;")
    h.pump(150)
    ok, esc_sel = h.js("return MolApp.getState().selection;")
    check("Esc 键盘清空选择", ok and esc_sel == [], esc_sel)

    # 窗口最小尺寸 1100×700 布局
    h.view.resize(1100, 700)
    h.pump(700)
    ok, small = h.js("return {bodyScroll: document.body.scrollWidth, htmlClient: document.documentElement.clientWidth, mainW: document.getElementById('main').getBoundingClientRect().width, sideW: document.getElementById('sidepanel').getBoundingClientRect().width, canvasW: document.getElementById('viewport-canvas').clientWidth};")
    check("1100×700 下无横向溢出", ok and small and small.get("bodyScroll") <= small.get("htmlClient") and small.get("canvasW", 0) > 200, small)
    ok, path = h.shot("ui-small.png")
    check("截图 ui-small.png（1100×700）", ok, path)
    h.view.resize(1440, 900)
    h.pump(500)

    # 样式切换
    h.js("MolApp.setSelection([0,1,2]); MolApp.setStyle('spacefill'); return true;")
    h.pump(500)
    ok, path = h.shot("ui-spacefill.png")
    check("截图 ui-spacefill.png", ok, path)
    h.js("MolApp.setStyle('ballstick'); MolApp.setOption('indices', true); MolApp.setOption('labels', false); return true;")
    h.pump(400)
    ok, path = h.shot("ui-labels.png")
    check("截图 ui-labels.png（序号开启/元素符号关闭）", ok, path)
    h.js("MolApp.setOption('indices', false); MolApp.setOption('labels', true); MolApp.clearSelection(); return true;")

    # 四种格式加载（每种截图）
    fmt_shots = {"benzene.sdf": "ui-sdf.png", "methanol.gjf": "ui-gjf.png", "water.log": "ui-log.png"}
    for fname, fmt, atoms in (("benzene.sdf", "sdf", 12), ("methanol.gjf", "gjf", 6), ("water.log", "log", 3)):
        with open(os.path.join(ROOT, "samples", fname), "r", encoding="utf-8") as f:
            text = f.read()
        ok, res = h.js_async("var r = await MolApp.loadText(%s, {filename: %s}); return r;" % (json.dumps(text), json.dumps(fname)), timeout=15)
        check("loadText(%s)" % fname, ok and res and res.get("format") == fmt and res.get("atomCount") == atoms, res)
        h.pump(500)
        ok, path = h.shot(fmt_shots[fname])
        check("截图 " + fmt_shots[fname], ok, path)

    # 丁烷二面角（4 原子选择 + 浮层）
    with open(os.path.join(ROOT, "samples", "butane.xyz"), "r", encoding="utf-8") as f:
        butane_text = f.read()
    ok, res = h.js_async("var r = await MolApp.loadText(%s, {filename: 'butane.xyz'}); return r;" % json.dumps(butane_text), timeout=15)
    check("loadText(butane.xyz)", ok and res and res.get("atomCount") == 14, res)
    h.js("MolApp.setSelection([0,1,2,3]); return true;")
    h.pump(500)
    ok, m = h.js("return MolApp.getMeasurements();")
    check("丁烷二面角测量", ok and m and m.get("dihedral") is not None and abs(abs(float(m.get("dihedral"))) - 180.0) < 0.5, m)
    ok, path = h.shot("ui-dihedral.png")
    check("截图 ui-dihedral.png", ok, path)

    # 侧面板滚动到底部（显示设置）
    h.js("document.getElementById('sidepanel').scrollTop = 99999; return true;")
    h.pump(350)
    ok, path = h.shot("ui-panel.png")
    check("截图 ui-panel.png（显示设置）", ok, path)
    h.js("document.getElementById('sidepanel').scrollTop = 0; return true;")

    # 多帧数据集（重新加载 water.log）
    with open(os.path.join(ROOT, "samples", "water.log"), "r", encoding="utf-8") as f:
        log_text = f.read()
    h.js_async("await MolApp.loadText(%s, {filename: 'water.log'}); return true;" % json.dumps(log_text), timeout=15)
    ok, ds = h.js("return {n: MolApp.getState().datasetCount, opts: Array.prototype.map.call(document.getElementById('dataset-select').options, function(o){return o.textContent;})};")
    check("LOG 多帧下拉", ok and ds and ds.get("n") == 2 and len(ds.get("opts") or []) == 2, ds)
    h.js("MolApp.setDatasetIndex(1); return true;")
    ok, ds2 = h.js("return {idx: MolApp.getState().datasetIndex, label: document.getElementById('dataset-label').textContent};")
    check("数据集切换到 2/2", ok and ds2 and ds2.get("idx") == 1 and "2/2" in ds2.get("label", ""), ds2)

    # 错误横幅
    ok, err = h.js_async("try { await MolApp.loadText('这不是分子文件', {filename:'bad.xyz'}); return {threw:false}; } catch(e) { return {threw:true, msg: String(e.message||e), last: MolApp.getLastError(), banner: !document.getElementById('error-banner').hidden}; }", timeout=10)
    check("坏文件中文错误 + 横幅", ok and err and err.get("threw") is True and err.get("banner") is True and err.get("last"), err)
    h.pump(300)
    ok, path = h.shot("ui-error.png")
    check("截图 ui-error.png", ok, path)

    # 导出（旧内核缺 padStart，仅在支持时测试）
    ok, hasPad = h.js("return typeof String.prototype.padStart === 'function';")
    if ok and hasPad:
        ok, xyz = h.js("return MolApp.exportText('xyz');")
        check("exportText(xyz)", ok and isinstance_str(xyz) and xyz.split("\n")[0].strip() == "3", (xyz or "")[:40])
    else:
        print("SKIP  exportText（旧内核不支持 String.padStart）", flush=True)

    # 控制台错误
    errors = [m for m in console_msgs if m[0] >= 2]
    for m in errors[:10]:
        print("  console.error:", m[1][:160], flush=True)
    check("控制台无 error 级消息", len(errors) == 0, "%d 条" % len(errors))

    failed = [r for r in results if not r[1]]
    print("\n========== 结果：%d/%d 通过 ==========" % (len(results) - len(failed), len(results)), flush=True)
    if failed:
        print("失败项：")
        for (name, _ok, detail) in failed:
            print(" - %s  %s" % (name, detail))
        return 1
    return 0


def isinstance_str(x):
    return isinstance(x, str)


if __name__ == "__main__":
    sys.exit(main())
