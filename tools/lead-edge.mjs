/* MolEdit — tools/lead-edge.mjs
 * Lead 边界场景补充验证：单原子、无键两原子、电荷/多重度、多帧文本、SDF 多记录、重新推断键、叠加层保留。
 * 运行：node tools/lead-edge.mjs
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
const n = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

const page = await openPage(APP_URL, { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');
  await page.wait(300);

  const loadText = async (text, filename) => page.eval(
    `MolApp.loadText(${JSON.stringify(text)}, {filename:${JSON.stringify(filename)}})`
  );

  // ---------- 1. 单原子 ----------
  const one = await loadText('1\nsingle atom\nH 0.0 0.0 0.0\n', 'single.xyz');
  let st = await page.eval('MolApp.getState()');
  check('单原子无键加载', st.atomCount === 1 && st.bondCount === 0, JSON.stringify({ a: st.atomCount, b: st.bondCount }));
  await page.wait(300);
  await page.screenshot(path.join(SHOTS, 'edge-single-atom.png'));

  // ---------- 2. 两个远离原子（无键）+ 键长编辑 ----------
  const two = await loadText('2\nfar pair\nC 0.0 0.0 0.0\nC 10.0 0.0 0.0\n', 'pair.xyz');
  st = await page.eval('MolApp.getState()');
  check('远距离两原子无键', st.atomCount === 2 && st.bondCount === 0, 'bonds=' + st.bondCount);
  await page.eval('MolApp.setSelection([0,1])');
  const d0 = (await page.eval('MolApp.getMeasurements()')).distance;
  check('远距离距离 10', Math.abs(d0 - 10) < 1e-6, d0);
  await page.eval('MolApp.applyBondLength(2.5)');
  const d1 = (await page.eval('MolApp.getMeasurements()')).distance;
  check('对无键原子应用键长 2.5', Math.abs(d1 - 2.5) < 1e-6, n(d1));
  const atom1 = await page.eval('MolApp.getAtom(1)');
  check('无键时移动 j 侧原子到 x=2.5', Math.abs(atom1.x - 2.5) < 1e-6 && Math.abs(atom1.y) < 1e-9, JSON.stringify(atom1));

  // ---------- 3. 电荷 / 多重度编辑 + GJF 导出 ----------
  const waterText = fs.readFileSync(path.join(ROOT, 'samples', 'water.xyz'), 'utf8');
  await loadText(waterText, 'water.xyz');
  await page.eval(`(function(){
    var c=document.getElementById('charge-input'); c.value='-1'; c.dispatchEvent(new Event('change',{bubbles:true}));
    var m=document.getElementById('multiplicity-input'); m.value='2'; m.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  st = await page.eval('MolApp.getState()');
  check('电荷/多重度 UI 编辑生效', st.charge === -1 && st.multiplicity === 2, JSON.stringify({ c: st.charge, m: st.multiplicity }));
  const gjf = await page.eval('MolApp.exportText("gjf")');
  check('GJF 导出包含 -1 2', /^-1 2$/m.test(gjf), gjf.split('\n').filter((l) => /^-?\d+ \d+$/.test(l.trim())).join(' | '));
  check('GJF 导出包含连接性行数正确', /^\s*1 2 1\.0 3 1\.0\s*$/m.test(gjf) && /^\s*2 1 1\.0\s*$/m.test(gjf), JSON.stringify(gjf.split('\n').filter(function(l){return /^\s*\d+ \d+ 1\.0/.test(l);})));

  // ---------- 4. 多帧 XYZ 文本 ----------
  const multiXyz = '2\nframe A\nH 0 0 0\nH 0 0 0.74\n2\nframe B\nH 0 0 0\nH 0 0 1.5\n';
  const multi = await loadText(multiXyz, 'multi.xyz');
  st = await page.eval('MolApp.getState()');
  check('多帧 XYZ datasetCount=2', multi.moleculeCount === 2 && st.datasetCount === 2, JSON.stringify({ m: multi.moleculeCount, d: st.datasetCount }));
  await page.eval('MolApp.setDatasetIndex(1)');
  const dist2 = await page.eval('(function(){MolApp.setSelection([0,1]);return MolApp.getMeasurements().distance;})()');
  check('切换到第 2 帧键长 1.5', Math.abs(dist2 - 1.5) < 1e-9, dist2);

  // ---------- 5. SDF 多记录（把已导出的 SDF 复制两份） ----------
  await loadText(waterText, 'water.xyz');
  const sdfOne = await page.eval('MolApp.exportText("sdf")');
  const multiSdf = sdfOne + sdfOne;
  const msdf = await loadText(multiSdf, 'multi.sdf');
  st = await page.eval('MolApp.getState()');
  check('SDF 多记录 datasetCount=2', msdf.moleculeCount === 2 && st.datasetCount === 2, JSON.stringify({ m: msdf.moleculeCount, d: st.datasetCount }));
  check('SDF 第二帧标题一致', st.title === 'water (H2O)', st.title);

  // ---------- 6. 重新推断化学键按钮 ----------
  await loadText(waterText, 'water.xyz');
  await page.eval('MolApp.setSelection([0,1])');
  await page.eval('MolApp.applyBondLength(3.5)');
  st = await page.eval('MolApp.getState()');
  check('拉伸到 3.5 Å 后键数减少（interred 重推断）', st.bondCount === 1, 'bonds=' + st.bondCount);
  await page.eval('document.getElementById("btn-rebond").click()');
  await page.wait(200);
  const rb = await page.eval('MolApp.getState()');
  check('“重新推断化学键”按钮可用', typeof rb.bondCount === 'number', 'bonds=' + rb.bondCount);

  // ---------- 7. 样式切换后测量叠加层仍保留 ----------
  await loadText(waterText, 'water.xyz');
  await page.eval('MolApp.setSelection([1,0,2])');
  await page.eval('MolApp.setStyle("spacefill")');
  await page.wait(250);
  const overlay = await page.eval('(function(){var o=document.getElementById("viewport-overlay");return {text:o.textContent, children:o.childElementCount};})()');
  check('spacefill 下测量叠加层保留', overlay.children >= 1 && overlay.text.indexOf('104') !== -1, JSON.stringify(overlay));
  await page.screenshot(path.join(SHOTS, 'edge-spacefill-overlay.png'));
  await page.eval('MolApp.setStyle("ballstick")');

  // ---------- 8. 空字符串/纯空白文件错误 ----------
  const emptyErr = await page.eval(`(async function(){ try { await MolApp.loadText('   \\n\\n', {filename:'empty.xyz'}); return 'no-error'; } catch(e){ return String(e.message||e); } })()`);
  check('空白文件给出本地化错误（en: File is empty / zh: 空）', /empty|空|内容/i.test(emptyErr), emptyErr);

  check('边界测试全程无 JS 异常', page.errors.length === 0 && page.consoleErrors.length === 0,
    JSON.stringify(page.errors.concat(page.consoleErrors)));
} catch (e) {
  check('边界脚本执行异常', false, String((e && e.stack) || e));
} finally {
  await page.close();
  await sleep(300);
}

const pass = results.filter((r) => r.ok).length;
console.log('\n========================================');
console.log(`Lead 边界测试：通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + ' :: ' + r.detail));
  process.exitCode = 1;
}


