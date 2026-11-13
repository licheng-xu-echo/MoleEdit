/* MolEdit — tools/lead-smoke.mjs（Lead 快速冒烟，QA 完整 E2E 之外的独立复核）
 * 运行：node tools/lead-smoke.mjs
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
const near = (a, b, tol = 1e-3) => typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol;

const page = await openPage(APP_URL, { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');
  await page.wait(500);
  // 本回归沿用中文文案断言（v2 默认英文），先切到中文；结束时恢复英文。
  await page.eval('MolApp.setLanguage("zh")');
  await page.wait(300);
  check('页面加载 + MolApp.ready', true);
  check('初始页面无 JS 错误', page.errors.length === 0, JSON.stringify(page.errors));

  // ---------- 1. 四格式加载 ----------
  const files = [
    ['water.xyz', 'xyz', 3, 2], ['benzene.sdf', 'sdf', 12, 12],
    ['methanol.gjf', 'gjf', 6, 5], ['water.log', 'log', 3, 2]
  ];
  for (const [file, fmt, atoms, bonds] of files) {
    const text = fs.readFileSync(path.join(ROOT, 'samples', file), 'utf8');
    const r = await page.eval(`MolApp.loadText(${JSON.stringify(text)}, {filename:${JSON.stringify(file)}})`.replace('filename:', 'filename:'));
    const st = await page.eval('MolApp.getState()');
    check('加载 ' + file, r.format === fmt && st.atomCount === atoms && st.bondCount === bonds,
      `format=${r.format} atoms=${st.atomCount} bonds=${st.bondCount} frames=${r.moleculeCount}`);
    await page.wait(150);
  }

  // ---------- 2. 测量（water） ----------
  const waterText = fs.readFileSync(path.join(ROOT, 'samples', 'water.xyz'), 'utf8');
  await page.eval(`MolApp.loadText(${JSON.stringify(waterText)}, {filename:"water.xyz"})`);
  await page.eval('MolApp.setSelection([0,1])');
  let m = await page.eval('MolApp.getMeasurements()');
  check('水 O-H 键长 0.9572', near(m.distance, 0.9572, 0.01), m.distance);
  await page.eval('MolApp.setSelection([1,0,2])');
  m = await page.eval('MolApp.getMeasurements()');
  check('水 H-O-H 键角 104.52', near(m.angle, 104.52, 0.1), m.angle);
  const domDistance = await page.text('#measure-distance');
  check('DOM #measure-distance 同步', /0\.9\d/.test(domDistance || ''), domDistance);
  await page.wait(300);
  await page.screenshot(path.join(SHOTS, 'smoke-water-select.png'));

  // ---------- 3. 键长编辑 + 撤销/重做 ----------
  await page.eval('MolApp.setSelection([0,1])');
  const before = (await page.eval('MolApp.getMeasurements()')).distance;
  const ab = await page.eval('MolApp.applyBondLength(1.2)');
  m = await page.eval('MolApp.getMeasurements()');
  check('applyBondLength(1.2)', near(m.distance, 1.2, 1e-6), `before=${before} after=${m.distance}`);
  const domD2 = await page.text('#measure-distance');
  check('DOM 键长显示 1.2', /1\.2/.test(domD2 || ''), domD2);
  await page.screenshot(path.join(SHOTS, 'smoke-water-bond120.png'));
  await page.eval('MolApp.undo()'); await page.wait(100);
  m = await page.eval('MolApp.getMeasurements()');
  check('undo 恢复原键长', near(m.distance, before, 1e-6), m.distance);
  await page.eval('MolApp.redo()'); await page.wait(100);
  m = await page.eval('MolApp.getMeasurements()');
  check('redo 回到 1.2', near(m.distance, 1.2, 1e-6), m.distance);

  // ---------- 4. 键角编辑 ----------
  await page.eval('MolApp.loadText(' + JSON.stringify(waterText) + ', {filename:"water.xyz"})');
  await page.eval('MolApp.setSelection([1,0,2])');
  await page.eval('MolApp.applyBondAngle(120)');
  m = await page.eval('MolApp.getMeasurements()');
  check('applyBondAngle(120)', near(m.angle, 120, 1e-5), m.angle);
  // 键角编辑只应旋转片段，O-H 键长保持不变（与编辑前比较）
  await page.eval('MolApp.undo()'); await page.eval('MolApp.setSelection([0,1])');
  const ohBefore = (await page.eval('MolApp.getMeasurements()')).distance;
  await page.eval('MolApp.setSelection([1,0,2])');
  await page.eval('MolApp.applyBondAngle(120)');
  m = await page.eval('MolApp.getMeasurements()');
  await page.eval('MolApp.setSelection([0,1])');
  const ohAfter = (await page.eval('MolApp.getMeasurements()')).distance;
  check('键角编辑不改变 O-H 键长', near(ohAfter, ohBefore, 1e-9), ohBefore + ' -> ' + ohAfter);
  await page.screenshot(path.join(SHOTS, 'smoke-water-angle120.png'));

  // ---------- 5. 二面角编辑（butane） ----------
  const butaneText = fs.readFileSync(path.join(ROOT, 'samples', 'butane.xyz'), 'utf8');
  await page.eval(`MolApp.loadText(${JSON.stringify(butaneText)}, {filename:"butane.xyz"})`);
  await page.eval('MolApp.setSelection([0,1,2,3])');
  m = await page.eval('MolApp.getMeasurements()');
  check('丁烷初始二面角 180', near(Math.abs(m.dihedral), 180, 0.5), m.dihedral);
  const d0 = m.distance;
  await page.eval('MolApp.applyBondDihedral(60)');
  m = await page.eval('MolApp.getMeasurements()');
  check('applyBondDihedral(60)', near(m.dihedral, 60, 1e-5), m.dihedral);
  await page.eval('MolApp.applyBondDihedral(-60)');
  m = await page.eval('MolApp.getMeasurements()');
  check('applyBondDihedral(-60)', near(m.dihedral, -60, 1e-5), m.dihedral);
  await page.eval('MolApp.applyBondDihedral(180)');
  m = await page.eval('MolApp.getMeasurements()');
  check('applyBondDihedral(180)', near(Math.abs(m.dihedral), 180, 1e-5), m.dihedral);
  check('二面角编辑不破坏 C-C 键长', near(m.distance, d0, 1e-3), `${d0} -> ${m.distance}`);
  check('二面角编辑不破坏 C-C-C 键角', near(m.angle, 112, 0.5), m.angle);
  await page.screenshot(path.join(SHOTS, 'smoke-butane-dihedral.png'));

  // ---------- 6. 多帧 / 样式 / 导出 ----------
  const logText = fs.readFileSync(path.join(ROOT, 'samples', 'water.log'), 'utf8');
  const logRes = await page.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:"water.log"})`);
  check('water.log 多帧', logRes.moleculeCount >= 2, logRes.moleculeCount);
  await page.eval('MolApp.setDatasetIndex(1)');
  const st2 = await page.eval('MolApp.getState()');
  check('帧切换', st2.datasetIndex === 1 && st2.datasetCount >= 2, st2.datasetIndex + '/' + st2.datasetCount);

  await page.eval(`MolApp.loadText(${JSON.stringify(waterText)}, {filename:"water.xyz"})`);
  await page.eval('MolApp.setStyle("spacefill")'); await page.wait(200);
  await page.screenshot(path.join(SHOTS, 'smoke-water-spacefill.png'));
  await page.eval('MolApp.setStyle("wireframe")'); await page.wait(200);
  check('四种样式切换无异常', true);
  await page.eval('MolApp.setStyle("ballstick")');
  await page.eval('MolApp.setSelection([0,1,2])');
  await page.wait(200);

  const xyzOut = await page.eval('MolApp.exportText("xyz")');
  const gjfOut = await page.eval('MolApp.exportText("gjf")');
  const sdfOut = await page.eval('MolApp.exportText("sdf")');
  const round = await page.eval(`(function(){
    var r = {};
    try { r.xyz = MolCore.parseFile(${JSON.stringify(xyzOut)}, {filename:'a.xyz'}).molecules[0].atoms.length; } catch(e){ r.xyzErr = String(e); }
    try { r.gjf = MolCore.parseFile(${JSON.stringify(gjfOut)}, {filename:'a.gjf'}).molecules[0].atoms.length; } catch(e){ r.gjfErr = String(e); }
    try { r.sdf = MolCore.parseFile(${JSON.stringify(sdfOut)}, {filename:'a.sdf'}).molecules[0].atoms.length; } catch(e){ r.sdfErr = String(e); }
    return r;
  })()`);
  check('导出 xyz/gjf/sdf 均可被重新解析', round.xyz === 3 && round.gjf === 3 && round.sdf === 3, JSON.stringify(round));

  // ---------- 7. 错误处理 ----------
  const errState = await page.eval(`(function(){
    try { MolApp.setSelection([0]); MolApp.applyBondAngle(120); return 'no-error'; }
    catch(e) { return String(e.message || e); }
  })()`);
  check('选择不足时 applyBondAngle 抛中文错误', /请选择|原子|不足/.test(errState), errState);
  // 坏文件：异步接口应 reject，且 UI 显示错误横幅、保留当前分子
  const atomsBeforeBad = (await page.eval('MolApp.getState()')).atomCount;
  const bad = await page.eval(`(async function(){ try { await MolApp.loadText('garbage text', {filename:'x.xyz'}); return 'no-error'; } catch(e){ return String(e.message||e); } })()`);
  const banner = await page.text('#error-banner');
  const atomsAfterBad = (await page.eval('MolApp.getState()')).atomCount;
  check('坏文件给出中文解析错误并显示错误横幅', /解析|无法|格式|xyz/i.test(bad) && !!banner && banner.trim().length > 0,
    'message=' + bad + ' | banner=' + banner);
  check('坏文件不清空当前分子', atomsAfterBad === atomsBeforeBad, atomsBeforeBad + ' -> ' + atomsAfterBad);

  // 最后回到 water 选中状态，便于截图
  await page.eval(`MolApp.loadText(${JSON.stringify(waterText)}, {filename:"water.xyz"})`);
  await page.eval('MolApp.setSelection([1,0,2])');
  await page.wait(300);
  await page.screenshot(path.join(SHOTS, 'smoke-water-final.png'));

  check('全程无 JS 异常/console.error', page.errors.length === 0 && page.consoleErrors.length === 0,
    JSON.stringify(page.errors.concat(page.consoleErrors)));
  // 恢复默认英文，避免污染其他测试的 localStorage
  await page.eval('MolApp.setLanguage("en")');
} catch (e) {
  check('冒烟脚本执行异常', false, String(e && e.stack || e));
} finally {
  await page.close();
  await new Promise(function (r) { setTimeout(r, 300); });
}

const pass = results.filter((r) => r.ok).length;
console.log('\n========================================');
console.log(`Lead 冒烟：通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败项：');
  results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + ' :: ' + r.detail));
  process.exitCode = 1;
}

