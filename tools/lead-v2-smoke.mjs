/* MolEdit — tools/lead-v2-smoke.mjs
 * Lead 对 v2 三项新功能的独立冒烟：
 *  1) 默认英文 + 语言切换 + 持久化
 *  2) Gaussian log 结果面板（单点能/热化学/能量曲线/收敛曲线/频率列表）
 *  3) 频率振动动画（播放/停止/帧切换/振幅）+ 跨平台启动脚本静态检查
 * 运行：node tools/lead-v2-smoke.mjs
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
const near = (a, b, tol) => typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await openPage(APP_URL, { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');
  await page.wait(400);

  // ---------- 1. 默认英文（清 localStorage 后 reload） ----------
  await page.eval('localStorage.clear()');
  await page.reload();
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');
  await page.wait(500);
  const lang = await page.eval('MolApp.getLanguage()');
  const docLang = await page.eval('document.documentElement.lang');
  const title = await page.eval('document.title');
  check('默认语言 = en', lang === 'en', lang);
  check('<html lang> = en', docLang === 'en', docLang);
  check('默认英文标题', /Molecular Editor/i.test(title) && !/[\u4e00-\u9fff]/.test(title), title);
  const emptyText = await page.text('#empty-hint');
  check('空状态提示英文', /open|load|xyz/i.test(emptyText) && !/[\u4e00-\u9fff]/.test(emptyText.replace(/#lang-toggle/g, '')), (emptyText || '').trim().slice(0, 80));
  const btnText = await page.text('#btn-open');
  check('打开按钮英文', btnText.trim() === 'Open file', btnText);
  const langBtn = await page.text('#lang-toggle');
  check('语言按钮显示 中文', langBtn.trim() === '中文', langBtn);
  await page.eval('MolApp.loadSample("water-xyz")');
  await page.wait(400);
  const sampleOptions = await page.eval('(function(){var s=document.getElementById("sample-select");return [].map.call(s.options,function(o){return o.textContent;});})()');
  check('示例下拉英文名', sampleOptions.some((x) => /Water/.test(x)) && !sampleOptions.some((x) => /[\u4e00-\u9fff]/.test(x)), sampleOptions.slice(0, 3).join(' | '));
  await page.screenshot(path.join(SHOTS, 'lead-v2-default-en.png'));

  // ---------- 2. 语言切换 + 持久化 ----------
  await page.eval('document.getElementById("lang-toggle").click()');
  await page.wait(400);
  const lang2 = await page.eval('MolApp.getLanguage()');
  const zhBtn = await page.text('#btn-open');
  check('点击切换为中文', lang2 === 'zh' && zhBtn.trim() === '打开文件', lang2 + ' / ' + zhBtn);
  const stored = await page.eval('localStorage.getItem("moledit.lang")');
  check('语言持久化 localStorage', stored === 'zh', stored);
  await page.eval('MolApp.setLanguage("en")');
  await page.wait(300);
  check('MolApp.setLanguage(en) 生效', (await page.eval('MolApp.getLanguage()')) === 'en');

  // ---------- 3. 加载 opt+freq log，检查结果面板 ----------
  const logText = fs.readFileSync(path.join(ROOT, 'samples', 'water-opt-freq.log'), 'utf8');
  const load = await page.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:'water-opt-freq.log'})`);
  await page.wait(900);
  check('LoadResult 含结果字段', load.hasLogResults === true && load.hasFrequencies === true && load.hasThermochemistry === true && load.hasOptimization === true,
    JSON.stringify({ hasLogResults: load.hasLogResults, freq: load.frequencyCount, opt: load.hasOptimization, thermo: load.hasThermochemistry }));
  const rs = await page.eval('MolApp.getResultsState()');
  check('结果面板可用且自动切到 results', rs.available === true && rs.activeTab === 'results', JSON.stringify({ available: rs.available, tab: rs.activeTab }));
  check('频率数量 3 / freqFrameIndex 4', rs.frequencyCount === 3 && rs.freqFrameIndex === 4, JSON.stringify({ freq: rs.frequencyCount, frame: rs.freqFrameIndex }));
  check('单点能 -76.4093345678', near(rs.finalEnergy, -76.4093345678, 1e-9), rs.finalEnergy);
  const lg = await page.eval('MolApp.getLogResults()');
  check('热化学 8 项存在', lg && lg.summary.thermochemistry &&
    near(lg.summary.thermochemistry.zeroPointCorrection, 0.021241, 1e-9) &&
    near(lg.summary.thermochemistry.sumElectronicGibbs, -76.406211, 1e-6),
    lg && lg.summary.thermochemistry ? JSON.stringify(lg.summary.thermochemistry).slice(0, 160) : 'null');
  check('优化步 4 步且收敛', lg && lg.summary.opt && lg.summary.opt.steps.length === 4 && lg.summary.opt.converged === true,
    lg && lg.summary.opt ? lg.summary.opt.steps.length + ' steps, converged=' + lg.summary.opt.converged : 'null');
  const domSummary = await page.eval('(function(){var out={};\n    ["final-energy","termination","optimization","zpe","sum-gibbs","temperature"].forEach(function(f){\n      var e=document.querySelector("#results-summary [data-field=\\""+f+"\\"] .res-value"); out[f]=e?e.textContent.trim():null; }); return out;})()');
  check('DOM summary 数值正确', /-76\.4093/.test(domSummary['final-energy'] || '') && /0\.021241/.test(domSummary.zpe || ''),
    JSON.stringify(domSummary));
  const canvases = await page.eval(`(function(){
    function stat(id){var c=document.getElementById(id);if(!c)return null;var ctx=c.getContext('2d');var d=ctx.getImageData(0,0,c.width,c.height).data;var nw=0;for(var i=0;i<d.length;i+=97){if(d[i]<245||d[i+1]<245||d[i+2]<245)nw++;}return {w:c.width,h:c.height,nonWhite:nw};}
    return {energy:stat('results-energy-canvas'), conv:stat('results-conv-canvas')};
  })()`);
  check('能量曲线 canvas 非空白', canvases.energy && canvases.energy.nonWhite > 20, JSON.stringify(canvases.energy));
  check('收敛曲线 canvas 非空白', canvases.conv && canvases.conv.nonWhite > 20, JSON.stringify(canvases.conv));
  const freqRows = await page.eval('(function(){return document.querySelectorAll("#results-freq-list .freq-row").length;})()');
  check('频率列表 3 行', freqRows === 3, freqRows);
  await page.screenshot(path.join(SHOTS, 'lead-v2-results-en.png'));

  // ---------- 4. 振动动画 ----------
  // 先切到频率对应的几何帧，再比较播放前后分子坐标是否被修改（切帧本身会改变坐标）
  await page.eval('MolApp.setDatasetIndex(' + rs.freqFrameIndex + ')');
  await page.wait(300);
  const molBefore = await page.eval('(function(){return MolApp.getAtom(0).x+","+MolApp.getAtom(0).y+","+MolApp.getAtom(0).z;})()');
  const frameBefore = await page.eval('MolApp.getState().datasetIndex');
  await page.eval('MolApp.playFrequency(0)');
  await page.wait(500);
  const animState = await page.eval('MolApp.getFrequencyAnimationState()');
  check('播放后 animating=true', animState.animating === true, JSON.stringify(animState));
  const frameAfter = await page.eval('MolApp.getState().datasetIndex');
  check('播放时切到 freqFrameIndex 帧', frameAfter === rs.freqFrameIndex, frameBefore + ' -> ' + frameAfter);
  const h1 = await page.eval('(function(){var c=document.getElementById("viewport-canvas");var ctx=c.getContext("2d");var d=ctx.getImageData(0,0,c.width,c.height).data;var h=2166136261;for(var i=0;i<d.length;i+=997){h=(h^d[i])*16777619>>>0;}return h;})()');
  await page.wait(350);
  const h2 = await page.eval('(function(){var c=document.getElementById("viewport-canvas");var ctx=c.getContext("2d");var d=ctx.getImageData(0,0,c.width,c.height).data;var h=2166136261;for(var i=0;i<d.length;i+=997){h=(h^d[i])*16777619>>>0;}return h;})()');
  check('动画使画布像素变化（振动中）', h1 !== h2, h1 + ' -> ' + h2);
  const molAfter = await page.eval('(function(){return MolApp.getAtom(0).x+","+MolApp.getAtom(0).y+","+MolApp.getAtom(0).z;})()');
  check('动画不修改分子数据', molBefore === molAfter, molBefore + ' == ' + molAfter);
  await page.eval('MolApp.setFrequencyAmplitude(80)');
  const amp = (await page.eval('MolApp.getFrequencyAnimationState()')).amplitude;
  check('振幅设置 80', amp === 80, amp);
  await page.screenshot(path.join(SHOTS, 'lead-v2-freq-anim-en.png'));
  await page.eval('MolApp.stopFrequencyAnimation()');
  await page.wait(300);
  const stopState = await page.eval('MolApp.getFrequencyAnimationState()');
  check('停止后 animating=false', stopState.animating === false, JSON.stringify(stopState));

  // ---------- 5. 中文结果面板 ----------
  await page.eval('MolApp.setLanguage("zh")');
  await page.wait(400);
  const zhFreqTitle = await page.eval('(function(){var e=document.querySelector("#results-freq-section .res-title, #results-freq-section h3");return e?e.textContent.trim():null;})()');
  check('中文下结果面板标题中文', /频率/.test(zhFreqTitle || ''), zhFreqTitle);
  const zhSummary = await page.eval('MolApp.getResultsState()');
  check('中文切换不影响结果状态', zhSummary.frequencyCount === 3 && zhSummary.available === true);
  await page.screenshot(path.join(SHOTS, 'lead-v2-results-zh.png'));
  await page.eval('MolApp.setLanguage("en")');
  await page.wait(200);

  // ---------- 6. 普通 log（无频率）与 xyz 的 tab 行为 ----------
  const waterLog = fs.readFileSync(path.join(ROOT, 'samples', 'water.log'), 'utf8');
  const wl = await page.eval(`MolApp.loadText(${JSON.stringify(waterLog)}, {filename:'water.log'})`);
  await page.wait(400);
  const wlState = await page.eval('MolApp.getResultsState()');
  check('普通 water.log：结果可用但无频率/热化学，不自动切 results',
    wl.hasLogResults === true && wlState.available === true && wlState.hasFrequencies === false &&
      wlState.hasThermochemistry === false && wlState.activeTab === 'molecule',
    JSON.stringify({ hasLogResults: wl.hasLogResults, available: wlState.available, hasFreq: wlState.hasFrequencies, hasThermo: wlState.hasThermochemistry, tab: wlState.activeTab }));
  const xyzText = fs.readFileSync(path.join(ROOT, 'samples', 'water.xyz'), 'utf8');
  await page.eval(`MolApp.loadText(${JSON.stringify(xyzText)}, {filename:'water.xyz'})`);
  await page.wait(300);
  const xyzState = await page.eval('MolApp.getResultsState()');
  check('加载 xyz 后 results tab 禁用并回 molecule', xyzState.available === false && xyzState.activeTab === 'molecule', JSON.stringify(xyzState));

  // ---------- 7. 跨平台脚本静态检查 ----------
  const fsChecks = [
    ['launch.sh', /#!/, /xdg-open/, /python3/],
    ['MolEdit.command', /launch\.sh/, /exec bash/],
    ['start-server.sh', /http\.server/, /server\.mjs/],
    ['tools/create-linux-desktop-shortcut.sh', /\[Desktop Entry\]/, /--dry-run/]
  ];
  let scriptOk = true;
  const scriptDetail = [];
  for (const [file, ...patterns] of fsChecks) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) { scriptOk = false; scriptDetail.push(file + ':missing'); continue; }
    const text = fs.readFileSync(fp, 'utf8');
    const noCR = text.indexOf('\r') === -1;
    const ok = noCR && text.startsWith('#!/usr/bin/env bash') && patterns.every((p) => p.test(text));
    if (!ok) { scriptOk = false; scriptDetail.push(file + ':bad'); }
  }
  check('Linux/macOS 启动脚本齐全且内容正确', scriptOk, scriptDetail.join(' '));
  check('README 含 Linux/macOS 启动说明', /Linux/i.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')) && /macOS/i.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));

  check('全程无 JS 异常/console.error', page.errors.length === 0 && page.consoleErrors.length === 0,
    JSON.stringify(page.errors.concat(page.consoleErrors)));
} catch (e) {
  check('v2 冒烟脚本执行异常', false, String((e && e.stack) || e));
} finally {
  await page.close();
  await sleep(300);
}

const pass = results.filter((r) => r.ok).length;
console.log('\n========================================');
console.log(`Lead v2 冒烟：通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + ' :: ' + r.detail));
  process.exitCode = 1;
}
