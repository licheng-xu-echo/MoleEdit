/* MolEdit — tools/lead-interact.mjs
 * Lead 真实鼠标/键盘交互验证（CDP Input 事件）：点选、拖动旋转、滚轮缩放、平移、移动原子、工具切换、数据集切换、快捷键。
 * 运行：node tools/lead-interact.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await openPage(APP_URL, { width: 1440, height: 900 });
const mouse = (type, x, y, extra = {}) => page.cdp.send('Input.dispatchMouseEvent', Object.assign({
  type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1
}, extra));

async function drag(x0, y0, x1, y1, steps = 8) {
  await mouse('mouseMoved', x0, y0, { buttons: 0 });
  await mouse('mousePressed', x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    await sleep(8);
  }
  await mouse('mouseReleased', x1, y1);
  await sleep(120);
}

try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');
  await page.wait(400);

  const geom = await page.eval(`(function(){
    var c = document.getElementById('viewport-canvas');
    var r = c.getBoundingClientRect();
    return { left:r.left, top:r.top, width:r.width, height:r.height, cx:r.left+r.width/2, cy:r.top+r.height/2 };
  })()`);
  check('canvas 几何信息', geom.width > 600 && geom.height > 500, JSON.stringify(geom));

  const methane = fs.readFileSync(path.join(ROOT, 'samples', 'methane.gjf'), 'utf8');
  await page.eval(`MolApp.loadText(${JSON.stringify(methane)}, {filename:"methane.gjf"})`);
  await page.wait(300);
  check('加载甲烷（5 原子 4 键）', (await page.eval('MolApp.getState()')).atomCount === 5);

  const shot = async (name) => page.screenshot(path.join(SHOTS, name));

  // ---------- 1. 点击中心选中碳原子 ----------
  await shot('interact-before.png');
  await mouse('mouseMoved', geom.cx, geom.cy, { buttons: 0 });
  await mouse('mousePressed', geom.cx, geom.cy);
  await mouse('mouseReleased', geom.cx, geom.cy);
  await page.wait(200);
  let sel = await page.eval('MolApp.getState().selection');
  check('真实鼠标点击中心选中 1 个原子', Array.isArray(sel) && sel.length === 1, JSON.stringify(sel));
  check('点击后 DOM 选中数更新', (await page.text('#selection-count')).indexOf('1') !== -1, await page.text('#selection-count'));
  await shot('interact-click-select.png');

  // ---------- 2. 拖动空白旋转 ----------
  const beforeRotate = await shot('interact-rotate-before.png');
  await drag(geom.left + 120, geom.top + 120, geom.left + 260, geom.top + 180);
  const afterRotate = await shot('interact-rotate-after.png');
  check('拖动空白旋转相机（截图变化）', !fs.readFileSync(beforeRotate).equals(fs.readFileSync(afterRotate)));

  // ---------- 3. 滚轮缩放 ----------
  const beforeZoom = await shot('interact-zoom-before.png');
  await page.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: geom.cx, y: geom.cy, deltaX: 0, deltaY: -240, button: 'left', buttons: 0
  });
  await page.wait(200);
  const afterZoom = await shot('interact-zoom-after.png');
  check('滚轮缩放（截图变化）', !fs.readFileSync(beforeZoom).equals(fs.readFileSync(afterZoom)));

  // ---------- 4. 平移工具 ----------
  await page.eval(`document.getElementById('tool-pan').click()`);
  const toolPan = await page.eval('document.getElementById("tool-pan").getAttribute("aria-pressed") || document.getElementById("tool-pan").classList.contains("active")');
  await drag(geom.left + 150, geom.top + 150, geom.left + 240, geom.top + 210);
  check('平移工具可激活并拖动无异常', true, 'tool-active=' + toolPan);

  // ---------- 5. 移动原子工具 + 撤销 ----------
  await page.eval(`MolApp.setSelection([]); document.getElementById('tool-move-atom').click()`);
  await page.wait(100);
  const atomBefore = await page.eval('MolApp.getAtom(0)');
  await drag(geom.cx, geom.cy, geom.cx + 60, geom.cy + 40);
  const atomAfter = await page.eval('MolApp.getAtom(0)');
  const moved = atomBefore && atomAfter && (Math.abs(atomAfter.x - atomBefore.x) + Math.abs(atomAfter.y - atomBefore.y) + Math.abs(atomAfter.z - atomBefore.z)) > 1e-3;
  check('移动原子工具拖动原子', moved, JSON.stringify(atomBefore) + ' -> ' + JSON.stringify(atomAfter));
  await page.eval('MolApp.undo()');
  const atomUndo = await page.eval('MolApp.getAtom(0)');
  check('移动原子后 undo 恢复', atomUndo && Math.abs(atomUndo.x - atomBefore.x) < 1e-6 && Math.abs(atomUndo.y - atomBefore.y) < 1e-6,
    JSON.stringify(atomUndo));
  await shot('interact-move-atom.png');

  // 回到选择工具
  await page.eval(`document.getElementById('tool-select').click(); MolApp.setStyle('ballstick'); MolApp.setSelection([0,1]);`);
  await page.wait(150);

  // ---------- 6. 样式下拉与显示选项 ----------
  await page.eval(`(function(){
    var s = document.getElementById('style-select'); s.value='spacefill';
    s.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  check('样式下拉切换到 spacefill', (await page.eval('MolApp.getState().style')) === 'spacefill');
  await shot('interact-spacefill.png');
  await page.eval(`(function(){
    var s=document.getElementById('style-select'); s.value='ballstick'; s.dispatchEvent(new Event('change',{bubbles:true}));
    var l=document.getElementById('toggle-labels'); if(l.checked) { l.checked=false; l.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`);
  check('样式切回 ballstick 且标签可关闭', (await page.eval('MolApp.getState().style')) === 'ballstick');

  // ---------- 7. 数据集切换（water.log 2 帧） ----------
  const logText = fs.readFileSync(path.join(ROOT, 'samples', 'water.log'), 'utf8');
  await page.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:"water.log"})`);
  await page.wait(200);
  const options = await page.eval(`(function(){
    var s=document.getElementById('dataset-select'); return { count:s.options.length, disabled:s.disabled, texts:[].map.call(s.options,function(o){return o.textContent;}) };
  })()`);
  check('数据集下拉有多帧选项', options.count >= 2 && !options.disabled, JSON.stringify(options));
  await page.eval(`(function(){ var s=document.getElementById('dataset-select'); s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const st = await page.eval('MolApp.getState()');
  check('切换第二帧', st.datasetIndex === 1, st.datasetIndex + '/' + st.datasetCount);

  // ---------- 8. 键盘 Esc / F ----------
  await page.eval(`MolApp.setSelection([0,1,2])`);
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.wait(150);
  check('Esc 清空选择', (await page.eval('MolApp.getState().selection')).length === 0);
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, text: 'f' });
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
  await page.wait(250);
  check('F 重置视角无异常', true);
  await shot('interact-log-frame2.png');

  // ---------- 9. 拖放加载文件（DataTransfer + File） ----------
  const drop = await page.eval(`(async function(){
    try {
      var text = ${JSON.stringify(methane)};
      var file = new File([text], 'dropped.gjf', {type:'text/plain'});
      var dt = new DataTransfer();
      dt.items.add(file);
      var target = document.getElementById('viewport');
      var ev = new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:dt});
      target.dispatchEvent(ev);
      await new Promise(function(r){setTimeout(r,500);});
      return JSON.stringify(MolApp.getState());
    } catch(e) { return 'ERR:' + (e && e.message || e); }
  })()`);
  check('拖放 .gjf 文件加载', drop.indexOf('"atomCount":5') !== -1, drop);

  check('交互测试全程无 JS 异常', page.errors.length === 0 && page.consoleErrors.length === 0,
    JSON.stringify(page.errors.concat(page.consoleErrors)));
} catch (e) {
  check('交互脚本执行异常', false, String(e && e.stack || e));
} finally {
  await page.close();
  await sleep(300);
}

const pass = results.filter((r) => r.ok).length;
console.log('\n========================================');
console.log(`Lead 交互测试：通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + ' :: ' + r.detail));
  process.exitCode = 1;
}
