/* MolEdit — tools/lead-perf.mjs
 * 大分子性能抽查：加载 1000 原子 XYZ、切换样式/选择、粗测渲染耗时。
 * 运行：node tools/lead-perf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 生成 1000 原子链式分子（仅性能测试，不进入示例库）
const n = 1000;
const atoms = [];
let x = 0, y = 0, z = 0;
const dx = 1.53 * Math.cos(56 * Math.PI / 180);
const dy = 1.53 * Math.sin(56 * Math.PI / 180);
for (let i = 0; i < n; i++) {
  atoms.push(['C', x, y, z]);
  x += dx;
  y += (i % 2 === 0) ? dy : -dy;
  z += ((i % 37) - 18) * 0.01;
}
const text = [String(n), 'perf-test-1000']
  .concat(atoms.map((a) => a[0] + ' ' + a[1].toFixed(6) + ' ' + a[2].toFixed(6) + ' ' + a[3].toFixed(6)))
  .join('\n') + '\n';

const page = await openPage('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');

  const load = await page.eval(`(async function(){
    var t0 = performance.now();
    var res = await MolApp.loadText(${JSON.stringify(text)}, {filename:'big.xyz'});
    var t1 = performance.now();
    return { atoms: res.atomCount, bonds: res.bondCount, loadMs: Math.round((t1-t0)*10)/10 };
  })()`);
  console.log('1000 原子加载:', JSON.stringify(load));

  const render = await page.eval(`(async function(){
    var t0 = performance.now();
    MolApp.setSelection([0,1,2,3]);
    MolApp.setStyle('spacefill');
    MolApp.setStyle('ballstick');
    await new Promise(function(r){ requestAnimationFrame(function(){ setTimeout(r, 60); }); });
    var t1 = performance.now();
    return { switchMs: Math.round((t1-t0)*10)/10 };
  })()`);
  console.log('样式切换/选择:', JSON.stringify(render));

  // 旋转 20 帧粗测
  const rot = await page.eval(`(async function(){
    var cv = document.getElementById('viewport-canvas');
    var r = cv.getBoundingClientRect();
    var t0 = performance.now();
    for (var k = 1; k <= 20; k++) {
      var ev = new PointerEvent('pointerdown', {bubbles:true, clientX:r.left+100, clientY:r.top+100, button:0, pointerId:1, pointerType:'mouse', isPrimary:true});
      cv.dispatchEvent(ev);
      var mv = new PointerEvent('pointermove', {bubbles:true, clientX:r.left+100+k*5, clientY:r.top+100+k*2, button:0, pointerId:1, pointerType:'mouse', isPrimary:true});
      cv.dispatchEvent(mv);
      await new Promise(function(res){ requestAnimationFrame(res); });
    }
    var up = new PointerEvent('pointerup', {bubbles:true, clientX:r.left+200, clientY:r.top+140, button:0, pointerId:1, pointerType:'mouse', isPrimary:true});
    cv.dispatchEvent(up);
    var t1 = performance.now();
    return { frames: 20, avgFrameMs: Math.round((t1-t0)/20*10)/10 };
  })()`);
  console.log('旋转 20 帧:', JSON.stringify(rot));
  const st = await page.eval('MolApp.getState()');
  console.log('状态:', JSON.stringify({ atoms: st.atomCount, bonds: st.bondCount, selection: st.selection, style: st.style }));
  await page.wait(300);
  await page.screenshot(path.join(ROOT, 'shots', 'lead-big1000.png'));
  console.log('截图: shots/lead-big1000.png');
  console.log('页面错误:', JSON.stringify(page.errors.concat(page.consoleErrors)));
  await page.close();
  await new Promise((r) => setTimeout(r, 300));
} catch (e) {
  console.error('性能测试失败:', e && e.stack || e);
  await page.close().catch(() => {});
  process.exitCode = 1;
}
