/* =============================================================================
 * ui-cdp-smoke.mjs — ui-dev 自测（v2）：i18n / 结果面板 / MolApp API v2
 * 通过 Lead 的常驻 headless Chrome CDP（127.0.0.1:9222）驱动，复用 tools/cdp.mjs。
 *
 * 用法（在 moledit/ 下）：
 *   node tests/ui-cdp-smoke.mjs                       # file:// 页面
 *   MOLEDIT_URL=http://127.0.0.1:8777/ node tests/ui-cdp-smoke.mjs
 * 产物：shots/ui2-*.png（EN / ZH 关键页）；失败 exit 1。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../tools/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PAGE_URL_FILE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const PAGE_URL = process.env.MOLEDIT_URL || PAGE_URL_FILE;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail != null ? '   [' + String(detail).slice(0, 190) + ']' : ''));
}
function approx(a, b, tol) { return typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page, timeout = 20000) {
  await page.waitFor('!!(document.readyState === "complete" && window.MolApp)', timeout);
  await page.eval('(async function(){ await MolApp.ready; return true; })()');
  await page.wait(250);
}

/** 清掉语言持久化后重新加载，保证默认 en（等价首次打开）。 */
async function freshPage(page) {
  await page.eval("localStorage.removeItem('moledit.lang'); 'ok'");
  await page.reload();
  await page.wait(700);
  await waitReady(page);
}

async function shot(page, name) {
  const file = await page.screenshot(path.join(SHOTS, name));
  console.log('      截图 ' + name + ' → ' + file);
  return file;
}

function hasFile(rel) { return fs.existsSync(path.join(ROOT, rel)); }

const page = await openPage(PAGE_URL, { width: 1440, height: 900 });
console.log('目标 URL: ' + PAGE_URL);
let checks = { freqAnim: false, results: false };
try {
  await waitReady(page);
  await freshPage(page);

  const hasGaussLog = await page.eval("typeof MolGaussLog === 'object' && typeof MolGaussLog.parse === 'function'");
  const hasResults = await page.eval("typeof MolResults === 'object' && typeof MolResults.create === 'function'");
  console.log('      MolGaussLog=' + hasGaussLog + '  MolResults=' + hasResults);

  /* ===================== 1. 默认英文（首次打开） ===================== */
  const en = await page.eval(`(function(){
    var q = function(id){ return document.getElementById(id); };
    var samples = MolApp.listSamples();
    return {
      lang: MolApp.getLanguage(), htmlLang: document.documentElement.getAttribute('lang'),
      title: document.title, langBtn: q('lang-toggle').textContent,
      langBtnTitle: q('lang-toggle').title,
      placeholder: q('sample-select') && q('sample-select').options[0] ? q('sample-select').options[0].textContent : '',
      sampleNames: samples.map(function(s){ return s.nameEn || s.name; }),
      tabMolecule: q('tab-molecule').textContent, tabResults: q('tab-results').textContent,
      tabResultsDisabled: q('tab-results').disabled,
      status: q('status-bar').textContent,
      toolLabel: q('tool-select').textContent.trim(),
      panelTitle: document.querySelector('#tab-page-molecule .panel-title').textContent.trim(),
      store: (function(){ try { return localStorage.getItem('moledit.lang'); } catch(e) { return 'ERR'; } })()
    };
  })()`);
  check('v2 默认语言 = en', en && en.lang === 'en', en && en.lang);
  check('v2 <html lang> = en', en && en.htmlLang === 'en', en && en.htmlLang);
  check('v2 document.title 英文', en && /Molecular Editor/.test(en.title), en && en.title);
  check('v2 语言按钮文本「中文」+ 英文 title', en && en.langBtn === '中文' && /Switch to Chinese/.test(en.langBtnTitle), JSON.stringify({ text: en && en.langBtn, title: en && en.langBtnTitle }));
  check('v2 示例占位/名称英文', en && /Load a sample/.test(en.placeholder) && (en.sampleNames || []).every((n) => !/[\u4e00-\u9fa5]/.test(n)), en && JSON.stringify(en.sampleNames));
  check('v2 侧栏 Tab 英文 + Results 初始禁用', en && en.tabMolecule === 'Molecule' && en.tabResults === 'Results' && en.tabResultsDisabled === true, JSON.stringify({ a: en && en.tabMolecule, b: en && en.tabResults, d: en && en.tabResultsDisabled }));
  check('v2 状态栏/工具/面板标题英文', en && /Ready/.test(en.status) && en.toolLabel === 'Select' && en.panelTitle === 'File info', JSON.stringify({ s: en && en.status, t: en && en.toolLabel, p: en && en.panelTitle }));
  check('v2 未设置 language 持久化', en && (en.store === null || en.store === 'en'), en && en.store);

  /* EN 模式 chrome UI 无 CJK（#lang-toggle 语言名“中文”、错误横幅、用户数据除外） */
  const cjkScan = await page.eval(`(function(){
    var roots = ['topbar','toolbar','sidepanel','statusbar','empty-hint','mouse-hint','viewport-hud'];
    var out = [];
    roots.forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      var clone = el.cloneNode(true);
      var skip = clone.querySelectorAll('#lang-toggle, #error-banner');
      for (var i = 0; i < skip.length; i++) { if (skip[i].parentNode) skip[i].parentNode.removeChild(skip[i]); }
      var txt = clone.textContent || '';
      var m = txt.match(/[\u4e00-\u9fa5]/);
      if (m) out.push(id + ':' + m[0]);
    });
    return out;
  })()`);
  check('v2 EN 模式 chrome UI 无中文残留', Array.isArray(cjkScan) && cjkScan.length === 0, JSON.stringify(cjkScan));
  await shot(page, 'ui2-default-en.png');

  /* ===================== 2. 语言切换 + 持久化 ===================== */
  await page.eval("document.getElementById('lang-toggle').click(); 'ok'");
  await page.wait(500);
  const zh = await page.eval(`(function(){
    var q = function(id){ return document.getElementById(id); };
    return {
      lang: MolApp.getLanguage(), htmlLang: document.documentElement.getAttribute('lang'),
      title: document.title, langBtn: q('lang-toggle').textContent, langBtnTitle: q('lang-toggle').title,
      placeholder: q('sample-select').options[0].textContent,
      sampleNames: MolApp.listSamples().map(function(s){ return s.name; }),
      tabMolecule: q('tab-molecule').textContent, tabResults: q('tab-results').textContent,
      status: q('status-bar').textContent, panelTitle: document.querySelector('#tab-page-molecule .panel-title').textContent,
      store: (function(){ try { return localStorage.getItem('moledit.lang'); } catch(e) { return 'ERR'; } })()
    };
  })()`);
  check('v2 点击语言按钮切到中文', zh && zh.lang === 'zh' && zh.htmlLang === 'zh-CN', JSON.stringify({ l: zh && zh.lang, h: zh && zh.htmlLang }));
  check('v2 中文标题/按钮/占位/面板标题', zh && /分子编辑器/.test(zh.title) && zh.langBtn === 'EN' && /切换到英文/.test(zh.langBtnTitle) && /加载示例/.test(zh.placeholder) && zh.panelTitle === '文件信息', JSON.stringify({ t: zh && zh.title, b: zh && zh.langBtn, p: zh && zh.placeholder, pt: zh && zh.panelTitle }));
  check('v2 中文示例名/侧栏 Tab/状态栏', zh && (zh.sampleNames || []).every((n) => /[\u4e00-\u9fa5]/.test(n)) && zh.tabMolecule === '分子' && zh.tabResults === '结果' && /就绪/.test(zh.status), JSON.stringify({ n: zh && zh.sampleNames, t: zh && zh.tabMolecule, s: zh && zh.status }));
  check('v2 语言持久化 localStorage=zh', zh && zh.store === 'zh', zh && zh.store);

  /* 重载后仍为中文（持久化） */
  await page.reload();
  await page.wait(700);
  await waitReady(page);
  const afterReload = await page.eval("({lang: MolApp.getLanguage(), title: document.title, htmlLang: document.documentElement.getAttribute('lang')})");
  check('v2 重载后语言持久化（仍 zh）', afterReload && afterReload.lang === 'zh' && afterReload.htmlLang === 'zh-CN', JSON.stringify(afterReload));
  await page.eval("MolApp.setLanguage('en'); 'ok'");
  await page.wait(400);
  check('v2 切回 en', (await page.eval('MolApp.getLanguage()')) === 'en');

  /* ===================== 3. v1 功能回归（EN） ===================== */
  const water = await page.eval("MolApp.loadSample('water-xyz')");
  check('v1 loadSample(water-xyz)', water && water.format === 'xyz' && water.atomCount === 3 && water.bondCount === 2, JSON.stringify(water));
  const singleDataset = await page.eval(`(function(){
    var sel = document.getElementById('dataset-select');
    var lab = document.getElementById('dataset-label');
    return {selText: sel.textContent, selDisabled: sel.disabled, labHidden: lab.hidden, labText: lab.textContent};
  })()`);
  check('v2 单帧：select 显示 Single frame，dataset-label 隐藏（无重复）',
    singleDataset && singleDataset.selText === 'Single frame' && singleDataset.selDisabled === true &&
    singleDataset.labHidden === true && singleDataset.labText === '',
    JSON.stringify(singleDataset));
  const meas = await page.eval("MolApp.setSelection([1,0,2]); MolApp.getMeasurements()");
  check('v1 水键长/键角', meas && approx(meas.distance, 0.9572, 0.002) && approx(meas.angle, 104.5, 0.2), JSON.stringify(meas));
  const measureDom = await page.eval(`(function(){
    return {d: document.getElementById('measure-distance').textContent, a: document.getElementById('measure-angle').textContent,
      c: document.getElementById('selection-count').textContent,
      badges: document.querySelectorAll('.ov-badge:not([hidden])').length,
      labels: document.querySelectorAll('.ov-label:not([hidden])').length,
      inputLen: document.getElementById('bond-length-input').value};
  })()`);
  check('v1 DOM 测量文本/输入回填/叠加层', measureDom && /d = 0\.957/.test(measureDom.d) && /104\.5/.test(measureDom.a) && measureDom.c.indexOf('3 / 4') !== -1 && measureDom.badges === 3 && measureDom.labels === 1 && measureDom.inputLen.indexOf('0.9572') === 0, JSON.stringify(measureDom));
  await page.wait(300);
  await shot(page, 'ui2-water-en.png');
  await page.wait(150);
  await shot(page, 'ui2-measure-en.png');

  const applyLen = await page.eval('MolApp.applyBondLength(1.2, {atoms: [0, 1]})');
  const afterLen = await page.eval('MolApp.getMeasurements().distance');
  check('v1 applyBondLength(1.2)', applyLen && approx(afterLen, 1.2, 1e-6), afterLen);
  const undone = await page.eval('MolApp.undo()');
  const undoLen = await page.eval('MolApp.getMeasurements().distance');
  const redone = await page.eval('MolApp.redo()');
  check('v1 undo/redo', undone === true && approx(undoLen, 0.9572, 0.002) && redone === true, JSON.stringify({ undoLen: undoLen }));
  const roundTrip = await page.eval(`(function(){
    var text = MolApp.exportText('xyz');
    var parsed = MolCore.parseFile(text, {filename:'rt.xyz'});
    var m = parsed.molecules[0];
    return {atoms: m.atoms.length, d: MolCore.measure.distance(m, 0, 1)};
  })()`);
  check('v1 exportText(xyz) 回环', roundTrip && roundTrip.atoms === 3 && approx(roundTrip.d, 1.2, 1e-4), JSON.stringify(roundTrip));

  const angleApply = await page.eval('MolApp.applyBondAngle(120, {atoms: [1, 0, 2]})');
  const angleAfter = await page.eval('MolApp.getMeasurements().angle');
  check('v1 applyBondAngle(120)', angleApply && approx(angleAfter, 120, 1e-6), angleAfter);

  const butaneText = fs.readFileSync(path.join(ROOT, 'samples', 'butane.xyz'), 'utf8');
  await page.eval('MolApp.loadText(' + JSON.stringify(butaneText) + ", {filename:'butane.xyz'})");
  const butane = await page.eval('MolApp.setSelection([0,1,2,3]); MolApp.getMeasurements()');
  check('v1 丁烷二面角 ≈ ±180', butane && butane.dihedral != null && Math.abs(Math.abs(butane.dihedral) - 180) < 0.5, butane && butane.dihedral);
  await page.eval('MolApp.applyBondDihedral(60, {atoms: [0,1,2,3]})');
  check('v1 applyBondDihedral(60)', approx(await page.eval('MolApp.getMeasurements().dihedral'), 60, 1e-3), '');
  await page.eval('MolApp.applyBondDihedral(-60, {atoms: [0,1,2,3]})');
  await page.eval('MolApp.applyBondDihedral(180, {atoms: [0,1,2,3]})');
  check('v1 二面角 -60/180', Math.abs(await page.eval('MolApp.getMeasurements().dihedral')) > 179.99, '');

  for (const [fname, fmt, atoms] of [['benzene.sdf', 'sdf', 12], ['methanol.gjf', 'gjf', 6], ['water.log', 'log', 3]]) {
    const text = fs.readFileSync(path.join(ROOT, 'samples', fname), 'utf8');
    const res = await page.eval('MolApp.loadText(' + JSON.stringify(text) + ', {filename: ' + JSON.stringify(fname) + '})');
    check('v1 loadText(' + fname + ')', res && res.format === fmt && res.atomCount === atoms, JSON.stringify({ f: res && res.format, a: res && res.atomCount }));
  }
  const dataset = await page.eval(`(function(){
    var s = MolApp.getState();
    var lab = document.getElementById('dataset-label');
    return {n: s.datasetCount, opts: Array.prototype.map.call(document.getElementById('dataset-select').options, function(o){return o.textContent;}),
      labHidden: lab.hidden, labText: lab.textContent};
  })()`);
  check('v1 多帧数据集（water.log）', dataset && dataset.n >= 2 && dataset.opts.length >= 2, JSON.stringify(dataset));
  check('v2 多帧：dataset-label 显示 Frame 1/2', dataset && dataset.labHidden === false && /Frame 1\/2/.test(dataset.labText), JSON.stringify(dataset));
  await page.eval('MolApp.setDatasetIndex(1)');
  check('v1 setDatasetIndex(1)', (await page.eval('MolApp.getState().datasetIndex')) === 1, '');

  const errInfo = await page.eval(`(async function(){
    try { await MolApp.loadText('这不是分子文件', {filename:'bad.xyz'}); return {threw:false}; }
    catch (e) { return {threw:true, banner: !document.getElementById('error-banner').hidden, still: MolApp.getState().hasMolecule, last: MolApp.getLastError()}; }
  })()`);
  check('v1 坏文件错误横幅 + 保留当前分子', errInfo && errInfo.threw === true && errInfo.banner === true && errInfo.still === true, JSON.stringify(errInfo));
  await page.wait(250);
  await shot(page, 'ui2-error-en.png');
  await page.eval("document.getElementById('error-banner').hidden = true; 'ok'");

  for (const style of ['spacefill', 'stick', 'wireframe', 'ballstick']) {
    await page.eval('MolApp.setStyle(' + JSON.stringify(style) + ')');
  }
  check('v1 四种样式切换', (await page.eval('MolApp.getState().style')) === 'ballstick', '');

  /* ===================== 4. 侧栏 Tab 基本行为 ===================== */
  await page.eval("MolApp.loadSample('water-xyz'); 'ok'");
  const tabState = await page.eval(`(function(){
    return {active: MolApp.getState().activeTab, resultsDisabled: document.getElementById('tab-results').disabled,
      molHidden: document.getElementById('tab-page-molecule').hidden, resHidden: document.getElementById('tab-page-results').hidden};
  })()`);
  check('v2 非 log：Results tab 禁用且显示 Molecule', tabState && tabState.resultsDisabled === true && tabState.active === 'molecule' && tabState.molHidden === false && tabState.resHidden === true, JSON.stringify(tabState));

  /* ===================== 5. LOG 结果面板 ===================== */
  if (hasGaussLog && hasResults) {
    checks.results = true;
    const optRes = await page.eval("MolApp.loadSample('water-opt-freq')");
    const resultsInfo = await page.eval(`(function(){
      var q = function(id){ return document.getElementById(id); };
      function canvasNonBlank(id) {
        var c = q(id); if (!c || !c.getContext) return false;
        try {
          var g = c.getContext('2d');
          var w = c.width, h = c.height;
          if (!w || !h) return false;
          var seen = {}, n = 0, i;
          for (i = 0; i < 240; i++) {
            var x = Math.floor((i * 37 + 11) % w), y = Math.floor((i * 53 + 7) % h);
            var d = g.getImageData(x, y, 1, 1).data;
            var key = d[0] + ',' + d[1] + ',' + d[2];
            if (!seen[key]) { seen[key] = 1; n++; }
          }
          return n > 2;
        } catch (e) { return 'ERR:' + e.message; }
      }
      var summary = {};
      var rows = q('results-summary') ? q('results-summary').querySelectorAll('.res-row') : [];
      for (var i = 0; i < rows.length; i++) { summary[rows[i].getAttribute('data-field')] = rows[i].textContent; }
      return {
        load: MolApp.getResultsState(),
        summaryRows: rows.length, summary: summary,
        freqRows: q('results-freq-list') ? q('results-freq-list').querySelectorAll('.freq-row').length : 0,
        emptyHidden: q('results-empty') ? q('results-empty').hidden : null,
        contentHidden: q('results-content') ? q('results-content').hidden : null,
        energyCanvas: canvasNonBlank('results-energy-canvas'),
        convCanvas: canvasNonBlank('results-conv-canvas'),
        tabActive: document.getElementById('tab-results').getAttribute('aria-selected'),
        pageHidden: q('tab-page-results').hidden
      };
    })()`);
    check('v2 opt+freq LoadResult 字段', optRes && optRes.hasLogResults === true && optRes.frequencyCount === 3 && optRes.hasFrequencies === true && optRes.hasOptimization === true && optRes.hasThermochemistry === true, JSON.stringify({ f: optRes && optRes.frequencyCount, o: optRes && optRes.hasOptimization }));
    check('v2 自动切到 Results tab', resultsInfo && resultsInfo.tabActive === 'true' && resultsInfo.pageHidden === false && resultsInfo.load.activeTab === 'results', JSON.stringify({ active: resultsInfo && resultsInfo.load.activeTab, tab: resultsInfo && resultsInfo.tabActive }));
    check('v2 结果面板 summary 行 ≥ 17 且内容正确', resultsInfo && resultsInfo.summaryRows >= 17 && /-76\.409/.test(resultsInfo.summary['final-energy'] || '') && (resultsInfo.summary.natoms || '').indexOf('3') !== -1, JSON.stringify({ rows: resultsInfo && resultsInfo.summaryRows, energy: resultsInfo && resultsInfo.summary['final-energy'], atoms: resultsInfo && resultsInfo.summary.natoms }));
    check('v2 频率列表 3 行', resultsInfo && resultsInfo.freqRows === 3, resultsInfo && resultsInfo.freqRows);
    check('v2 能量/收敛曲线 canvas 非空白', resultsInfo && resultsInfo.energyCanvas === true && resultsInfo.convCanvas === true, JSON.stringify({ e: resultsInfo && resultsInfo.energyCanvas, c: resultsInfo && resultsInfo.convCanvas }));
    check('v2 GetResultsState 聚合字段', resultsInfo && resultsInfo.load && resultsInfo.load.frequencyCount === 3 && resultsInfo.load.hasFrequencies === true && resultsInfo.load.freqFrameIndex === 4 && approx(resultsInfo.load.finalEnergy, -76.4093345678, 1e-9), JSON.stringify(resultsInfo && resultsInfo.load));
    await page.wait(350);
    await shot(page, 'ui2-results-en.png');
    // 滚到频率列表/控制区截图（GaussView 结果面板核心区域）
    await page.eval("(function(){ var p = document.getElementById('tab-page-results'); p.scrollTop = p.scrollHeight; return p.scrollTop; })()");
    await page.wait(250);
    await shot(page, 'ui2-results-freq-en.png');
    await page.eval("(function(){ var p = document.getElementById('tab-page-results'); p.scrollTop = 0; return 0; })()");

    /* 频率动画：播放/振幅/停止 + 不修改分子 */
    const playRes = await page.eval(`(function(){
      try { MolApp.playFrequency(0); return {ok:true, state: MolApp.getFrequencyAnimationState()}; }
      catch (e) { return {ok:false, msg: String(e && e.message || e)}; }
    })()`);
    await page.wait(250);
    // onRequestFrame 可能已切到频率帧；在同一帧内比较位移前后分子坐标（动画不得修改数据）
    const atomBefore = await page.eval('MolApp.getAtom(0)');
    const canvasBefore = await page.eval("document.getElementById('viewport-canvas').toDataURL('image/png').slice(0, 20000)");
    await page.wait(450);
    const animInfo = await page.eval(`(function(){
      var state = MolApp.getFrequencyAnimationState();
      var canvas = document.getElementById('viewport-canvas');
      var v = canvas.toDataURL('image/png').slice(0, 20000);
      return {state: state, canvasSig: v, atom: MolApp.getAtom(0)};
    })()`);
    check('v2 playFrequency(0) 开始动画', playRes && playRes.ok === true && animInfo && animInfo.state.animating === true, JSON.stringify({ play: playRes && playRes.ok, anim: animInfo && animInfo.state }));
    check('v2 动画改变视口渲染（canvas 像素变化）', canvasBefore !== animInfo.canvasSig, 'beforeLen=' + String(canvasBefore && canvasBefore.length) + ' afterLen=' + String(animInfo.canvasSig && animInfo.canvasSig.length));
    check('v2 动画不修改分子坐标', atomBefore && animInfo.atom && approx(atomBefore.x, animInfo.atom.x, 1e-12) && approx(atomBefore.y, animInfo.atom.y, 1e-12) && approx(atomBefore.z, animInfo.atom.z, 1e-12), JSON.stringify({ before: atomBefore, after: animInfo.atom }));
    await shot(page, 'ui2-freq-anim-en.png');

    await page.eval('MolApp.setFrequencyAmplitude(80)');
    check('v2 setFrequencyAmplitude(80)', (await page.eval('MolApp.getFrequencyAnimationState().amplitude')) === 80, '');
    await page.eval('MolApp.stopFrequencyAnimation()');
    await page.wait(250);
    const stopped = await page.eval('({state: MolApp.getFrequencyAnimationState(), results: MolApp.getResultsState()})');
    check('v2 stopFrequencyAnimation 停止且恢复', stopped && stopped.state.animating === false && stopped.results.animating === false, JSON.stringify(stopped && stopped.state));

    /* Tab 切换 API + DOM */
    await page.eval("MolApp.setSideTab('molecule')");
    const tabMol = await page.eval("({active: MolApp.getState().activeTab, molHidden: document.getElementById('tab-page-molecule').hidden, resHidden: document.getElementById('tab-page-results').hidden})");
    check('v2 setSideTab(molecule)', tabMol && tabMol.active === 'molecule' && tabMol.molHidden === false && tabMol.resHidden === true, JSON.stringify(tabMol));
    await page.eval("MolApp.setSideTab('results')");
    check('v2 setSideTab(results)', (await page.eval('MolApp.getState().activeTab')) === 'results', '');

    /* 语言切换后结果面板文案中文化 */
    await page.eval("MolApp.setLanguage('zh')");
    await page.wait(450);
    const resultsZh = await page.eval(`(function(){
      var q = function(id){ return document.getElementById(id); };
      var txt = (q('results-summary') ? q('results-summary').textContent : '') + (q('results-freq-list') ? q('results-freq-list').textContent : '');
      return {hasCJK: /[\\u4e00-\\u9fa5]/.test(txt), tabMolecule: q('tab-molecule').textContent, tabResults: q('tab-results').textContent, lang: MolApp.getLanguage()};
    })()`);
    check('v2 切中文后结果面板文案中文', resultsZh && resultsZh.lang === 'zh' && resultsZh.hasCJK === true && resultsZh.tabMolecule === '分子' && resultsZh.tabResults === '结果', JSON.stringify(resultsZh));
    await shot(page, 'ui2-results-zh.png');
    await page.eval("MolApp.setLanguage('en')");
    await page.wait(350);

    /* 普通 log：可用但无频率；非 log：禁用回 molecule */
    const plain = await page.eval("MolApp.loadSample('water-log')");
    const plainState = await page.eval('({state: MolApp.getResultsState(), active: MolApp.getState().activeTab, disabled: document.getElementById("tab-results").disabled})');
    check('v2 普通 log results 可用（无频率）', plain && plain.hasLogResults === true && plainState && plainState.disabled === false && plainState.state.frequencyCount === 0, JSON.stringify({ has: plain && plain.hasLogResults, st: plainState && plainState.state }));
    check('v2 普通 log 侧栏 tab 按 summary 自动选择', plainState && plainState.active === ((plainState.state.hasFrequencies || plainState.state.hasOptimization || plainState.state.hasThermochemistry) ? 'results' : 'molecule'), JSON.stringify({ active: plainState && plainState.active, st: plainState && plainState.state }));
    await page.eval("MolApp.loadSample('water-xyz')");
    const afterXyz = await page.eval('({disabled: document.getElementById("tab-results").disabled, active: MolApp.getState().activeTab, log: MolApp.getLogResults()})');
    check('v2 非 log 后 results tab 禁用并回 molecule', afterXyz && afterXyz.disabled === true && afterXyz.active === 'molecule' && afterXyz.log === null, JSON.stringify({ d: afterXyz && afterXyz.disabled, a: afterXyz && afterXyz.active }));
  } else {
    console.log('SKIP  LOG 结果面板用例（gausslog.js / results.js 未加载）');
  }

  /* ===================== 6. 中文主界面截图（water） ===================== */
  await page.eval("MolApp.setLanguage('zh')");
  await page.eval("MolApp.loadSample('water-xyz'); MolApp.setSelection([1,0,2]); 'ok'");
  await page.wait(500);
  await shot(page, 'ui2-water-zh.png');
  await page.eval("MolApp.setLanguage('en'); MolApp.clearSelection(); 'ok'");

  /* ===================== 7. 1100×700 最小窗口 ===================== */
  const smallPage = await openPage(PAGE_URL, { width: 1100, height: 700 });
  try {
    await waitReady(smallPage);
    await smallPage.eval("localStorage.removeItem('moledit.lang'); 'ok'");
    await smallPage.reload();
    await smallPage.wait(700);
    await waitReady(smallPage);
    const small = await smallPage.eval(`(function(){
      var r = document.getElementById('viewport-canvas').getBoundingClientRect();
      return {winW: window.innerWidth, winH: window.innerHeight, bodyScroll: document.body.scrollWidth,
        htmlClient: document.documentElement.clientWidth, canvasW: Math.round(r.width), canvasH: Math.round(r.height),
        sideW: Math.round(document.getElementById('sidepanel').getBoundingClientRect().width),
        tabs: !!document.getElementById('side-tabs'), lang: MolApp.getLanguage()};
    })()`);
    check('v2 1100×700 无横向溢出且画布可用', small && small.winW === 1100 && small.bodyScroll <= small.htmlClient && small.canvasW > 400 && small.canvasH > 400 && small.tabs === true && small.lang === 'en', JSON.stringify(small));
    await smallPage.screenshot(path.join(SHOTS, 'ui2-small-en.png'));
    await smallPage.eval("MolApp.setLanguage('zh'); 'ok'");
    await smallPage.wait(350);
    await smallPage.screenshot(path.join(SHOTS, 'ui2-small-zh.png'));
    check('v2 1100×700 页面无错误', smallPage.errors.length === 0 && smallPage.consoleErrors.length === 0, smallPage.errors.length + '+' + smallPage.consoleErrors.length);
  } finally {
    await smallPage.close();
  }

  /* ===================== 8. 控制台 / 页面错误 ===================== */
  const errors = page.errors.concat(page.consoleErrors);
  for (const e of errors.slice(0, 10)) console.log('      [' + e.type + '] ' + String(e.text).slice(0, 200));
  check('控制台/页面无 error', errors.length === 0, errors.length + ' 条');

  const failed = results.filter((r) => !r.ok);
  console.log('\n========== 结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 ==========');
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(' - ' + f.name + '  ' + f.detail);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('UI-CDP-SMOKE FATAL:', (err && err.stack) || err);
  process.exitCode = 1;
} finally {
  try { await page.close(); } catch (e) { /* ignore */ }
}
