/* ============================================================================
 * MolEdit — tests/e2e.mjs（qa-dev）— v2
 * 端到端测试：CDP 驱动常驻 headless Chrome（127.0.0.1:9222），打开 file:// 页面，
 * 覆盖 INTERFACE.md §8/§9（v1 功能回归）+ INTERFACE2.md §3/§4/§6/§8/§10/§11
 * （i18n 默认英文、Gaussian LOG 结果面板、频率振动动画、跨平台脚本静态检查）。
 *
 * 用法（在 moledit/ 下）：
 *   node tests/e2e.mjs
 * 产出：
 *   tests/e2e-report.json   结构化结果 [{case,pass,expected,actual,error}, ...] + visualQA
 *   screenshots/e2e-*.png   截图
 * 退出码：全部通过 0，存在失败 1。
 *
 * 语言策略（INTERFACE2.md §11.3）：
 *   - 开场 localStorage.clear() + reload 断言默认 en（标题/按钮/面板/选项卡/提示全英文）；
 *   - EN 模式 chrome UI 无 CJK 扫描（排除 #error-banner / #mol-title / #selection-list /
 *     #lang-toggle 等契约允许项）；
 *   - 之后 MolApp.setLanguage('zh') 运行 v1 回归（保留原中文文案断言）；
 *   - 再按用例需要切换 EN/ZH 验证结果面板与持久化。
 *
 * 注意：
 *   - 本会话沙箱不能启动浏览器；必须有常驻 headless Chrome（CDP 9222）。
 *   - 产品代码只读；本文件不修改任何产品文件。
 *   - 视觉结论（人工 read_image 检查）保存在 report 的 visualQA 字段：
 *     每次运行会读取上一份 report 的 visualQA 并保留（由 tests/qa-visual.mjs 写入）。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openPage } from '../tools/cdp.mjs';

const require = createRequire(import.meta.url);
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS_DIR, '..');
const PAGE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html';
const SAMPLES_DIR = path.join(ROOT, 'samples');
const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
const SHOTS_DIR = path.join(ROOT, 'screenshots');
const REPORT_PATH = path.join(TESTS_DIR, 'e2e-report.json');
const VIEW = { width: 1440, height: 900 };
const REQUIRED_DOM_IDS = [
  'file-input', 'btn-open', 'sample-select', 'btn-undo', 'btn-redo',
  'btn-export-xyz', 'btn-export-gjf', 'btn-export-sdf',
  'tool-select', 'tool-rotate', 'tool-move-atom', 'tool-move-fragment', 'tool-pan',
  'viewport', 'viewport-canvas', 'viewport-overlay', 'empty-hint',
  'mol-title', 'mol-format', 'dataset-select', 'dataset-label',
  'atom-count', 'bond-count', 'charge-input', 'multiplicity-input',
  'selection-count', 'selection-list',
  'measure-distance', 'measure-angle', 'measure-dihedral',
  'bond-length-input', 'bond-length-move', 'btn-apply-bond-length',
  'angle-input', 'angle-move', 'btn-apply-angle',
  'dihedral-input', 'dihedral-move', 'btn-apply-dihedral',
  'style-select', 'toggle-labels', 'toggle-indices', 'toggle-axes',
  'btn-rebond', 'btn-clear-selection', 'btn-reset-view',
  'status-bar', 'error-banner',
  // ---- v2（INTERFACE2.md §3.4 / §7）----
  'lang-toggle', 'side-tabs', 'tab-molecule', 'tab-results',
  'tab-page-molecule', 'tab-page-results', 'results-panel'
];
// EN 模式下允许出现中文的元素（契约 §8.1 例外 + 语言按钮自身文案）
const CJK_ALLOWED_SELECTORS = ['#error-banner', '#mol-title', '#selection-list', '#lang-toggle',
  '#results-freq-note', '#results-warnings'];
// INTERFACE2.md §10 跨平台交付文件（相对 moledit/）
const PORTABILITY_FILES = [
  { file: 'launch.sh', kind: 'bash', must: ['--dry-run', 'MOLEDIT_PORT', 'xdg-open', 'open ', 'python3', 'server.mjs'] },
  { file: 'start-server.sh', kind: 'bash', must: ['python3', 'node'] },
  { file: 'MolEdit.command', kind: 'bash', must: ['launch.sh'] },
  { file: 'tools/create-linux-desktop-shortcut.sh', kind: 'bash', must: ['--dry-run', 'moledit.desktop', 'Exec='] }
];

/* ------------------------------ 结果收集 ------------------------------ */
const cases = [];
const shots = [];
const startedAt = Date.now();
let prevReport = null;
try { prevReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch { /* 首次运行 */ }

function assertionError(message, expected, actual) {
  const err = new Error(message);
  err.expected = expected;
  err.actual = actual;
  return err;
}
function assert(cond, message, expected, actual) {
  if (!cond) throw assertionError(message, expected, actual);
}
function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw assertionError(label + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual), expected, actual);
  }
}
function assertClose(label, actual, expected, tol) {
  if (typeof actual !== 'number' || !isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw assertionError(label + '：期望 ' + expected + ' ± ' + tol + '，实际 ' + actual, expected, actual);
  }
}
function assertIn(label, actual, min, max) {
  if (typeof actual !== 'number' || !isFinite(actual) || actual < min || actual > max) {
    throw assertionError(label + '：期望范围 [' + min + ', ' + max + ']，实际 ' + actual, min + '..' + max, actual);
  }
}
function assertMatch(label, text, regex) {
  if (!regex.test(String(text))) {
    throw assertionError(label + '：文本 ' + JSON.stringify(String(text)) + ' 不匹配 ' + regex, String(regex), text);
  }
}
function assertIncludes(label, text, part) {
  if (String(text).indexOf(part) === -1) {
    throw assertionError(label + '：文本 ' + JSON.stringify(String(text)) + ' 不含 ' + JSON.stringify(part), '含 ' + part, text);
  }
}
function num(text) {
  const m = String(text == null ? '' : text).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

async function testCase(name, expected, fn) {
  const rec = { case: name, pass: false, expected: String(expected), actual: null, error: null, detail: null, ms: 0 };
  const observed = {};
  const t0 = Date.now();
  process.stdout.write('• ' + name + ' ... ');
  try {
    const ret = await fn(observed);
    rec.actual = ret === undefined ? observed : ret;
    rec.pass = true;
    console.log('PASS');
  } catch (e) {
    rec.error = e && e.message ? e.message : String(e);
    rec.actual = e && e.actual !== undefined ? e.actual : (Object.keys(observed).length ? observed : null);
    if (Object.keys(observed).length) rec.detail = observed;
    if (e && e.expected !== undefined) rec.expected = String(e.expected);
    console.log('FAIL: ' + rec.error);
  }
  rec.ms = Date.now() - t0;
  cases.push(rec);
  return rec;
}

/* ------------------------------ 页面辅助 ------------------------------ */
let page;
let animationBaselineHash = null; // 频率动画测试用：播放前视口画布 hash（停止后应恢复）
const ev = (expr) => page.eval(expr);

async function loadTextFile(filename, opts) {
  const text = fs.readFileSync(path.join(SAMPLES_DIR, filename), 'utf8');
  const options = Object.assign({ filename: filename }, opts || {});
  const result = await page.eval('MolApp.loadText(' + JSON.stringify(text) + ', ' + JSON.stringify(options) + ')');
  await page.wait(180);
  return result;
}
async function loadRawText(text, opts) {
  return page.eval('MolApp.loadText(' + JSON.stringify(text) + ', ' + JSON.stringify(opts || {}) + ')');
}
async function expectReject(expr, label) {
  try {
    await page.eval(expr);
  } catch (e) {
    return String((e && e.message) || e);
  }
  throw assertionError(label + '：期望抛出错误，但调用成功', 'throws Error', 'no error');
}
async function shot(name) {
  await page.wait(200);
  const file = await page.screenshot(path.join(SHOTS_DIR, name));
  const bytes = fs.statSync(file).size;
  shots.push({ name: name, path: 'screenshots/' + name, bytes: bytes });
  return file;
}
/* headless Chrome 的 rAF 只在需要合成帧时触发；用一次强制截图逼出待渲染的帧，
 * 保证随后读取的 canvas 像素/截图反映最新状态（否则样式切换后的断言会读到旧帧）。 */
async function forceFrame() {
  // 连续两次强制合成帧：保证 requestRender 里排队的 rAF 回调都已执行并绘制到 canvas。
  try { await page.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); } catch (e) { /* 忽略 */ }
  await page.wait(80);
  try { await page.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); } catch (e) { /* 忽略 */ }
  await page.wait(80);
}
async function domSnapshot() {
  return page.eval(`(function(){
    function el(id){ return document.getElementById(id); }
    function t(id){ var e=el(id); return e ? String(e.textContent).replace(/\\s+/g,' ').trim() : null; }
    function v(id){ var e=el(id); return e ? e.value : null; }
    function dis(id){ var e=el(id); return e ? !!e.disabled : null; }
    function hid(id){ var e=el(id); return e ? !!e.hidden : null; }
    var ss=el('sample-select'), ds=el('dataset-select');
    return {
      status: t('status-bar'),
      molTitle: t('mol-title'), molFormat: t('mol-format'),
      atomCount: t('atom-count'), bondCount: t('bond-count'),
      selectionCount: t('selection-count'), selectionList: t('selection-list'),
      measureDistance: t('measure-distance'), measureAngle: t('measure-angle'), measureDihedral: t('measure-dihedral'),
      bondLengthInput: v('bond-length-input'), angleInput: v('angle-input'), dihedralInput: v('dihedral-input'),
      styleSelect: v('style-select'),
      datasetSelect: v('dataset-select'), datasetLabel: t('dataset-label'), datasetDisabled: dis('dataset-select'),
      datasetOptionCount: ds ? ds.options.length : -1,
      sampleOptionCount: ss ? ss.options.length : -1,
      toggleLabels: el('toggle-labels') ? !!el('toggle-labels').checked : null,
      toggleIndices: el('toggle-indices') ? !!el('toggle-indices').checked : null,
      toggleAxes: el('toggle-axes') ? !!el('toggle-axes').checked : null,
      btnUndoDisabled: dis('btn-undo'), btnRedoDisabled: dis('btn-redo'),
      btnExportXyzDisabled: dis('btn-export-xyz'), btnExportGjfDisabled: dis('btn-export-gjf'), btnExportSdfDisabled: dis('btn-export-sdf'),
      btnApplyBondLengthDisabled: dis('btn-apply-bond-length'),
      btnApplyAngleDisabled: dis('btn-apply-angle'),
      btnApplyDihedralDisabled: dis('btn-apply-dihedral'),
      errorBannerHidden: hid('error-banner'), errorBannerText: t('error-banner'),
      emptyHintHidden: hid('empty-hint'),
      chargeInputValue: v('charge-input'), chargeDisabled: dis('charge-input'),
      multiplicityInputValue: v('multiplicity-input'), multiplicityDisabled: dis('multiplicity-input'),
      // ---- v2 ----
      langToggle: t('lang-toggle'),
      tabMoleculeActive: el('tab-molecule') ? el('tab-molecule').classList.contains('is-active') : null,
      tabResultsActive: el('tab-results') ? el('tab-results').classList.contains('is-active') : null,
      tabResultsDisabled: dis('tab-results'),
      moleculePageHidden: hid('tab-page-molecule'),
      resultsPageHidden: hid('tab-page-results'),
      resultsPanel: !!el('results-panel'),
      resultsEmptyHidden: hid('results-empty'),
      resultsContentHidden: hid('results-content')
    };
  })()`);
}
async function canvasHash() {
  await forceFrame();
  // 全字节 FNV-1a（不做采样，避免采样碰撞导致不同样式误判相同）
  return page.eval("(function(){var c=document.getElementById('viewport-canvas');var ctx=c.getContext('2d');" +
    "var d=ctx.getImageData(0,0,c.width,c.height).data;var h=2166136261;" +
    "for(var i=0;i<d.length;i++){h=(h^d[i])*16777619>>>0;}return c.width+'x'+c.height+':'+h;})()");
}
async function canvasStats() {
  return page.eval(`(function(){
    var c=document.getElementById('viewport-canvas');var ctx=c.getContext('2d');
    var d=ctx.getImageData(0,0,c.width,c.height).data;
    var W=c.width,H=c.height;
    var step=2,minX=W,minY=H,maxX=-1,maxY=-1,count=0,orange=0,sumX=0,sumY=0,total=0;
    // 排除左下角坐标轴区域（x<160 且 y>H-170），得到“分子内容”包围盒
    var mMinX=W,mMinY=H,mMaxX=-1,mMaxY=-1,mCount=0;
    for(var y=0;y<H;y+=step){
      for(var x=0;x<W;x+=step){
        total++;
        var i=(y*W+x)*4, r=d[i], g=d[i+1], b=d[i+2];
        if(r<245||g<245||b<245){
          count++; sumX+=x; sumY+=y;
          if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
          if(r>200&&g>70&&g<190&&b<110) orange++;
          if(!(x<160 && y>H-170)){
            mCount++;
            if(x<mMinX)mMinX=x; if(x>mMaxX)mMaxX=x; if(y<mMinY)mMinY=y; if(y>mMaxY)mMaxY=y;
          }
        }
      }
    }
    var mw = mMaxX-mMinX, mh = mMaxY-mMinY;
    var minDim = Math.min(W,H);
    return {W:W,H:H,total:total,nonWhite:count,nonWhiteRatio:count/total,
      bbox:{minX:minX,minY:minY,maxX:maxX,maxY:maxY,width:maxX-minX,height:maxY-minY},
      molecule:{minX:mMinX,minY:mMinY,maxX:mMaxX,maxY:mMaxY,width:mw,height:mh,count:mCount},
      fill: Math.max(mw,mh)/minDim,
      clipped: (mMinX<=1||mMinY<=1||mMaxX>=W-2||mMaxY>=H-2),
      centroid:{x:count?sumX/count:0,y:count?sumY/count:0},
      orangePixels:orange,
      cornerPixel:[d[0],d[1],d[2]],
      centerPixel:(function(){var i=(((H>>1)*W)+(W>>1))*4;return [d[i],d[i+1],d[i+2]];})()};
  })()`);
}
async function findAtomPoint(exclude) {
  return page.eval('(function(ex){' +
    "var c=document.getElementById('viewport-canvas');var r=c.getBoundingClientRect();" +
    "var found=null,step=8;" +
    'for(var y=24;y<r.height-24&&!found;y+=step){' +
    'for(var x=24;x<r.width-24;x+=step){' +
    'if(ex&&Math.sqrt((x-ex.x)*(x-ex.x)+(y-ex.y)*(y-ex.y))<48)continue;' +
    'var cx=r.left+x,cy=r.top+y;' +
    'if(document.elementFromPoint(cx,cy)!==c)continue;' +
    "c.dispatchEvent(new PointerEvent('pointermove',{clientX:cx,clientY:cy,bubbles:true,pointerType:'mouse',pointerId:7}));" +
    "if(c.style.cursor==='pointer'){found={x:x,y:y,clientX:cx,clientY:cy};break;}" +
    '}' +
    '}' +
    "c.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+6,clientY:r.top+r.height-6,bubbles:true,pointerType:'mouse',pointerId:7}));" +
    'return {found:found,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};' +
    '})(' + JSON.stringify(exclude || null) + ')');
}
async function findBlankPoint() {
  return page.eval("(function(){var c=document.getElementById('viewport-canvas');var r=c.getBoundingClientRect();" +
    'var list=[[r.left+r.width-30,r.top+40],[r.left+r.width-30,r.top+r.height-40],[r.left+30,r.top+r.height-40]];' +
    'for(var i=0;i<list.length;i++){var p=list[i];if(document.elementFromPoint(p[0],p[1])===c)return {x:p[0],y:p[1]};}' +
    'return null;})()');
}
async function realClick(x, y, modifiers) {
  const mods = modifiers || 0;
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none', modifiers: mods });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
  await page.wait(180);
}
async function realDrag(x0, y0, dx, dy) {
  const steps = 8;
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await page.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, button: 'left', buttons: 1
    });
  }
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + dx, y: y0 + dy, button: 'left', buttons: 0, clickCount: 1 });
  await page.wait(260);
}

/* ------------------------------ v2 页面/语言辅助 ------------------------------ */
async function waitReady() {
  await page.waitFor('document.readyState === "complete"', 30000);
  await page.waitFor('window.MolApp && typeof MolApp.getState === "function"', 30000);
  await page.eval('MolApp.ready');
  await page.wait(250);
}
async function reloadPage() {
  await page.reload();
  await waitReady();
}
/** 清掉持久化语言并 reload，回到契约规定的默认语言 en（INTERFACE2.md §3.1/§11.3#1） */
async function resetToDefaultLanguage() {
  await page.eval('localStorage.clear()');
  await reloadPage();
}
async function setLang(lang) {
  await page.eval('MolApp.setLanguage(' + JSON.stringify(lang) + ')');
  await page.wait(160);
}
async function getLang() {
  return page.eval('MolApp.getLanguage()');
}
/** i18n 相关 DOM 快照（标题/语言按钮/关键按钮/面板标题/tab/示例选项/结果面板） */
async function i18nSnapshot() {
  return page.eval(`(function(){
    function q(id){ var e=document.getElementById(id); return e ? String(e.textContent).replace(/\\s+/g,' ').trim() : null; }
    function attr(id,name){ var e=document.getElementById(id); return e ? e.getAttribute(name) : null; }
    function opts(id){ var e=document.getElementById(id); if(!e||!e.options) return null;
      return Array.prototype.slice.call(e.options).map(function(o){ return {value:o.value, text:String(o.textContent).replace(/\\s+/g,' ').trim()}; }); }
    function listText(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)).map(function(e){ return String(e.textContent).replace(/\\s+/g,' ').trim(); }); }
    return {
      title: document.title,
      htmlLang: document.documentElement.lang,
      langToggle: q('lang-toggle'),
      langToggleTitle: attr('lang-toggle','title'),
      langToggleAria: attr('lang-toggle','aria-label'),
      btnOpen: q('btn-open'), btnUndo: q('btn-undo'), btnRedo: q('btn-redo'),
      exportXyz: q('btn-export-xyz'), exportGjf: q('btn-export-gjf'), exportSdf: q('btn-export-sdf'),
      tabMolecule: q('tab-molecule'), tabResults: q('tab-results'),
      tabResultsDisabled: (function(){ var e=document.getElementById('tab-results'); return e ? !!e.disabled : null; })(),
      status: q('status-bar'), emptyHint: q('empty-hint'), mouseHint: q('mouse-hint'),
      panelTitles: listText('#sidepanel .panel-title'),
      toolLabels: listText('#toolbar .tool-btn span'),
      styleOptions: opts('style-select'),
      bondMoveOptions: opts('bond-length-move'),
      samplePlaceholder: (function(){ var e=document.getElementById('sample-select'); return e&&e.options.length ? String(e.options[0].textContent).replace(/\\s+/g,' ').trim() : null; })(),
      sampleOptions: opts('sample-select'),
      resultsEmpty: q('results-empty'),
      resultsPanelText: (function(){ var e=document.getElementById('results-panel'); return e ? String(e.textContent).replace(/\\s+/g,' ').trim().slice(0,400) : null; })()
    };
  })()`);
}
const CJK_RE_SOURCE = '[\\u3400-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]';
/** 扫描 roots 内（排除 excludes）**可见**文本/属性/option 中的 CJK，返回违规列表（用于 §11.3#3）。
 *  仅扫描“用户可见”的 chrome UI：display:none / hidden / 0 尺寸的元素不计（例如无结果时结果面板中
 *  保留的上一次渲染的隐藏节点，不属于可见中文残留）。 */
async function cjkViolations(roots, excludes) {
  return page.eval(`(function(){
    var roots = ${JSON.stringify(roots)};
    var excludes = ${JSON.stringify(excludes || [])};
    var CJK = new RegExp('${CJK_RE_SOURCE.replace(/\\/g, '\\\\')}');
    var out = [];
    function excluded(el){ if(!el || !el.closest) return false;
      for (var i=0;i<excludes.length;i++){ try { if (el.closest(excludes[i])) return true; } catch(e){} } return false; }
    function visible(el){
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName === 'OPTION') {
        var p = el.parentElement;
        while (p && p.tagName !== 'SELECT') p = p.parentElement;
        if (!p) return false;
        el = p;
      }
      if (el.closest && el.closest('[hidden]')) return false;
      if (typeof el.getBoundingClientRect !== 'function') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function add(kind, el, text){ out.push({ kind:kind, id:(el&&el.id)||'', tag:(el&&el.tagName)||'',
      text:String(text).replace(/\\s+/g,' ').trim().slice(0,100) }); }
    roots.forEach(function(sel){
      var root = document.querySelector(sel);
      if (!root) return;
      if (root.nodeType === 1 && excluded(root)) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        var t = n.nodeValue || '';
        if (!t.trim() || !CJK.test(t)) continue;
        var el = n.parentElement;
        if (excluded(el) || !visible(el)) continue;
        add('text', el, t);
      }
      var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
      for (var i=0;i<nodes.length;i++){
        var el2 = nodes[i];
        if (excluded(el2)) continue;
        if (el2.tagName === 'OPTION') {
          var ot = el2.textContent || '';
          if (ot.trim() && CJK.test(ot) && visible(el2)) add('option', el2, ot);
          continue;
        }
        if (!visible(el2)) continue;
        ['title','placeholder','aria-label'].forEach(function(attrName){
          var v = el2.getAttribute(attrName);
          if (v && CJK.test(v)) add('attr:'+attrName, el2, v);
        });
      }
    });
    return out;
  })()`);
}
function cjkCount(text) {
  const re = new RegExp(CJK_RE_SOURCE, 'g');
  const m = String(text == null ? '' : text).match(re);
  return m ? m.length : 0;
}
/** 读取 samples 或 tests/fixtures 下第一个存在的文件 */
function readFirstExisting(relPaths) {
  for (const rel of relPaths) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) return { rel: rel, text: fs.readFileSync(full, 'utf8') };
  }
  return null;
}
function readOptFreqLog() {
  return readFirstExisting(['samples/water-opt-freq.log', 'tests/fixtures/water-opt-freq.log']);
}
async function loadOptFreqInPage() {
  const src = readOptFreqLog();
  if (!src) throw assertionError('缺少 opt+freq 样例（samples/water-opt-freq.log 或 tests/fixtures/water-opt-freq.log）', 'fixture exists', null);
  const result = await loadRawText(src.text, { filename: 'water-opt-freq.log' });
  await page.wait(200);
  return { result: result, source: src.rel };
}
let nodeGaussLogCache;
function nodeGaussLog() {
  if (nodeGaussLogCache !== undefined) return nodeGaussLogCache;
  try {
    const mod = require(path.join(ROOT, 'js', 'gausslog.js'));
    nodeGaussLogCache = (typeof globalThis.MolGaussLog === 'object' && globalThis.MolGaussLog) ? globalThis.MolGaussLog : mod;
    if (typeof nodeGaussLogCache.parse !== 'function') nodeGaussLogCache = null;
  } catch (e) { nodeGaussLogCache = null; }
  return nodeGaussLogCache;
}
/** Node 侧用 MolGaussLog 解析 fixture，作为结果面板断言的期望值来源（与 gausslog 单测一致） */
function expectedOptFreqResults() {
  const src = readOptFreqLog();
  if (!src) throw assertionError('缺少 opt+freq 样例（samples/water-opt-freq.log 或 tests/fixtures/water-opt-freq.log）', 'fixture exists', null);
  const G = nodeGaussLog();
  if (!G) throw assertionError('js/gausslog.js 未就绪（无法 require 或缺少 parse）', 'MolGaussLog.parse', null);
  return { source: src.rel, results: G.parse(src.text) };
}
/** 页面内 MolApp 结果状态快照（只用 §8.3 API） */
async function resultsApiSnapshot() {
  return page.eval(`(function(){
    var out = {};
    try { out.resultsState = MolApp.getResultsState(); } catch(e) { out.resultsStateError = String((e&&e.message)||e); }
    try { out.animState = MolApp.getFrequencyAnimationState(); } catch(e) { out.animStateError = String((e&&e.message)||e); }
    try { out.lang = MolApp.getLanguage(); } catch(e) { out.langError = String((e&&e.message)||e); }
    try {
      var raw = MolApp.getLogResults();
      if (raw && raw.summary) {
        var s = raw.summary, tc = s.thermochemistry;
        out.summary = {
          jobCount: s.jobCount, route: s.route, charge: s.charge, multiplicity: s.multiplicity, natoms: s.natoms,
          finalEnergy: s.finalEnergy, normalTermination: s.normalTermination,
          hasFrequencies: !!s.hasFrequencies, hasOptimization: !!s.hasOptimization, hasThermochemistry: !!s.hasThermochemistry,
          freqFrameIndex: (s.freqFrameIndex==null ? null : s.freqFrameIndex),
          frequencyCount: Array.isArray(s.frequencies) ? s.frequencies.length : 0,
          energyStepCount: Array.isArray(s.energySteps) ? s.energySteps.length : 0,
          optStepCount: (s.opt && Array.isArray(s.opt.steps)) ? s.opt.steps.length : 0,
          optConverged: (s.opt ? s.opt.converged : null),
          optEnergies: (s.opt && Array.isArray(s.opt.steps)) ? s.opt.steps.map(function(st){ return st.energy; }) : [],
          optStepDetail: (s.opt && Array.isArray(s.opt.steps) && s.opt.steps.length) ? {
            maxForce: s.opt.steps[0].maxForce, rmsForce: s.opt.steps[0].rmsForce,
            maxDisplacement: s.opt.steps[0].maxDisplacement, rmsDisplacement: s.opt.steps[0].rmsDisplacement
          } : null,
          thermochemistry: tc ? {
            temperature: tc.temperature, pressure: tc.pressure,
            zpe: tc.zeroPointCorrection, thermalEnergy: tc.thermalCorrectionEnergy,
            thermalEnthalpy: tc.thermalCorrectionEnthalpy, thermalGibbs: tc.thermalCorrectionGibbs,
            sumZpe: tc.sumElectronicZeroPoint, sumEnergy: tc.sumElectronicThermal,
            sumEnthalpy: tc.sumElectronicEnthalpy, sumGibbs: tc.sumElectronicGibbs
          } : null,
          frequencies: (s.frequencies||[]).slice(0,8).map(function(f){
            return { modeIndex:f.modeIndex, frequency:f.frequency, irIntensity:(f.irIntensity==null?null:f.irIntensity),
              imaginary:!!f.imaginary, displacementCount:(f.displacements||[]).length };
          })
        };
      } else { out.summary = null; }
    } catch(e) { out.logResultsError = String((e&&e.message)||e); }
    return out;
  })()`);
}
/** 结果面板 DOM 快照（§6.1 规定的 id） */
async function resultsDomSnapshot() {
  return page.eval(`(function(){
    function q(id){ var e=document.getElementById(id); return e ? String(e.textContent).replace(/\\s+/g,' ').trim() : null; }
    function hidden(id){ var e=document.getElementById(id); return e ? !!(e.hidden || e.style.display==='none' || e.offsetParent === null) : null; }
    var rows = {};
    Array.prototype.slice.call(document.querySelectorAll('#results-summary .res-row')).forEach(function(r){
      var f = r.getAttribute('data-field');
      var v = r.querySelector('.res-value');
      rows[f] = v ? String(v.textContent).replace(/\\s+/g,' ').trim() : String(r.textContent).replace(/\\s+/g,' ').trim();
    });
    var freqRows = Array.prototype.slice.call(document.querySelectorAll('#results-freq-list .freq-row')).map(function(b){
      function part(sel){ var e=b.querySelector(sel); return e ? String(e.textContent).replace(/\\s+/g,' ').trim() : null; }
      return { modeIndex:b.getAttribute('data-mode-index'), index:part('.freq-index'), value:part('.freq-value'), ir:part('.freq-ir'),
        active:b.classList.contains('is-active'), imaginary:b.classList.contains('is-imaginary') };
    });
    return {
      tabResultsDisabled: (function(){ var e=document.getElementById('tab-results'); return e ? !!e.disabled : null; })(),
      tabMoleculeActive: (function(){ var e=document.getElementById('tab-molecule'); return e ? e.classList.contains('is-active') : null; })(),
      tabResultsActive: (function(){ var e=document.getElementById('tab-results'); return e ? e.classList.contains('is-active') : null; })(),
      moleculePageHidden: hidden('tab-page-molecule'), resultsPageHidden: hidden('tab-page-results'),
      resultsEmptyHidden: hidden('results-empty'), resultsContentHidden: hidden('results-content'),
      summaryFields: Object.keys(rows), summary: rows,
      freqSectionHidden: hidden('results-freq-section'),
      energySectionHidden: hidden('results-energy-section'), convSectionHidden: hidden('results-conv-section'),
      hasEnergyCanvas: !!document.getElementById('results-energy-canvas'),
      hasConvCanvas: !!document.getElementById('results-conv-canvas'),
      freqRows: freqRows,
      playText: q('results-freq-play'), stopText: q('results-freq-stop'), modeLabel: q('results-freq-mode-label'),
      amplitudeValue: (function(){ var e=document.getElementById('results-freq-amplitude'); return e ? e.value : null; })(),
      jobSelectValue: (function(){ var e=document.getElementById('results-job-select'); return e ? e.value : null; })(),
      panelText: q('results-panel')
    };
  })()`);
}
/** 指定 canvas 的像素统计（图表非空白判定） */
async function chartStats(selector) {
  return page.eval('(function(sel){' +
    'var c = document.querySelector(sel); if (!c || !c.getContext) return null;' +
    'var ctx = c.getContext("2d"); var W = c.width, H = c.height;' +
    'if (!W || !H) return { w:W, h:H, nonWhite:0, ratio:0, colorKinds:0, cssW:0, cssH:0 };' +
    'var d = ctx.getImageData(0, 0, W, H).data; var nonWhite = 0; var colorMap = {};' +
    'for (var i = 0; i < d.length; i += 4) { var r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];' +
    '  if (a > 0 && (r < 250 || g < 250 || b < 250)) { nonWhite++;' +
    '    if ((r + g + b) < 720) colorMap[(r>>4)+","+(g>>4)+","+(b>>4)] = 1; } }' +
    'var rc = c.getBoundingClientRect();' +
    'return { w:W, h:H, cssW:rc.width, cssH:rc.height, nonWhite:nonWhite,' +
    '  ratio: nonWhite / (W*H || 1), colorKinds: Object.keys(colorMap).length }; })(' + JSON.stringify(selector) + ')');
}
/** 跨平台脚本静态快照（存在/LF/shebang/关键分支） */
function portabilitySnapshot() {
  return PORTABILITY_FILES.map((spec) => {
    const full = path.join(ROOT, spec.file);
    const out = { file: spec.file, exists: fs.existsSync(full) };
    if (!out.exists) return out;
    const buf = fs.readFileSync(full);
    const text = buf.toString('utf8');
    out.bytes = buf.length;
    out.hasCR = buf.indexOf(0x0d) !== -1;
    out.firstLine = String(text.split('\n')[0] || '').replace(/\r$/, '');
    out.endsWithNewline = text.endsWith('\n');
    out.missingFragments = (spec.must || []).filter((frag) => text.indexOf(frag) === -1);
    return out;
  });
}
/** 用可用的 bash 对脚本做 bash -n 语法检查；沙箱/无 bash 时返回 available:false（测试记 SKIP） */
function bashSyntaxCheck(files) {
  const candidates = ['bash', 'C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'];
  let bash = null;
  for (const candidate of candidates) {
    try {
      const r = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 10000 });
      if (r && r.status === 0 && !r.error) { bash = candidate; break; }
    } catch (e) { /* try next */ }
  }
  if (!bash) return { available: false, bash: null, results: [] };
  const results = files.map((rel) => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return { file: rel, status: 'missing' };
    let r;
    try { r = spawnSync(bash, ['-n', full], { stdio: 'ignore', timeout: 15000 }); }
    catch (e) { return { file: rel, status: 'error', detail: String((e && e.code) || e) }; }
    if (r && r.error) return { file: rel, status: 'unavailable', detail: String(r.error.code || r.error.message) };
    return { file: rel, status: !r ? 'no-result' : (r.status === 0 ? 'ok' : 'syntax-fail:' + r.status) };
  });
  return { available: true, bash: bash, results: results };
}

/* ------------------------------ 主流程 ------------------------------ */
async function main() {
  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
  // 清理上一轮的 e2e 截图，避免陈旧文件影响截图盘点
  for (const f of fs.readdirSync(SHOTS_DIR)) {
    if (/^e2e-.*\.png$/.test(f) || /^_probe.*\.png$/.test(f)) {
      try { fs.unlinkSync(path.join(SHOTS_DIR, f)); } catch { /* 忽略 */ }
    }
  }

  page = await openPage(PAGE_URL, VIEW);
  await waitReady();
  // v2 语言基线：清掉持久化语言后 reload，确保默认 en（INTERFACE2.md §3.1 / §11.3#1）
  await resetToDefaultLanguage();

  /* ====================== v2-A. i18n：默认英文 / 切换 / 持久化 ====================== */
  await testCase('i18n-default-en', '默认英文：localStorage.clear()+reload 后 title/html lang/按钮/选项卡/面板/示例/提示全英文，语言按钮显示“中文”',
    async (obs) => {
      obs.snap = await i18nSnapshot();
      obs.state = await page.eval('({ lang: MolApp.getLanguage(), defaultLang: MolI18n.DEFAULT_LANG, storageKey: MolI18n.STORAGE_KEY, storage: localStorage.getItem(MolI18n.STORAGE_KEY) })');
      assertEqual('MolI18n.DEFAULT_LANG', obs.state.defaultLang, 'en');
      assertEqual('MolApp.getLanguage() 默认', obs.state.lang, 'en');
      assertEqual('无持久化值（clear 后）', obs.state.storage, null);
      assertEqual('<html lang>', obs.snap.htmlLang, 'en');
      assertIncludes('document.title 含英文', obs.snap.title, 'Molecular Editor');
      assertEqual('语言按钮文字（EN 下显示 中文）', obs.snap.langToggle, '中文');
      assertEqual('Open file 按钮', String(obs.snap.btnOpen).toLowerCase(), 'open file');
      assertEqual('选项卡 Molecule', obs.snap.tabMolecule, 'Molecule');
      assertEqual('选项卡 Results', obs.snap.tabResults, 'Results');
      assertEqual('初始 Results tab 禁用', obs.snap.tabResultsDisabled, true);
      assertEqual('状态栏英文', cjkCount(obs.snap.status), 0);
      assertIn('状态栏非空', String(obs.snap.status || '').length, 3, 400);
      assertEqual('空状态英文', cjkCount(obs.snap.emptyHint), 0);
      assertEqual('鼠标提示英文', cjkCount(obs.snap.mouseHint), 0);
      assertEqual('面板标题全部英文', cjkCount(obs.snap.panelTitles.join(' ')), 0);
      assertEqual('工具按钮全部英文', cjkCount(obs.snap.toolLabels.join(' ')), 0);
      assertEqual('样式选项英文', cjkCount((obs.snap.styleOptions || []).map((o) => o.text).join(' ')), 0);
      assertEqual('移动方式选项英文', cjkCount((obs.snap.bondMoveOptions || []).map((o) => o.text).join(' ')), 0);
      assertEqual('示例下拉 placeholder 英文', cjkCount(obs.snap.samplePlaceholder), 0);
      const sampleNames = (obs.snap.sampleOptions || []).slice(1).map((o) => o.text);
      assert(sampleNames.length >= 4, '示例下拉应有至少 4 个示例', '>=4', sampleNames);
      assertEqual('EN 下示例名全英文', cjkCount(sampleNames.join(' ')), 0);
      assert(obs.snap.sampleOptions.some((o) => /water|benzene|methane|methanol|butane/i.test(o.text)),
        'EN 示例名应包含英文分子名', 'contains english molecule name', sampleNames);
      await shot('e2e-en-main.png');
      return obs;
    });

  await testCase('i18n-en-no-cjk', 'EN 模式应用 chrome UI 无 CJK 残留（豁免 #lang-toggle/#error-banner/#mol-title/#selection-list 等）',
    async (obs) => {
      obs.violations = await cjkViolations(
        ['#topbar', '#toolbar', '#sidepanel', '#statusbar', '#empty-hint', '#mouse-hint', '#viewport-hud', '#results-panel'],
        CJK_ALLOWED_SELECTORS
      );
      obs.titleViolation = cjkCount(await page.eval('document.title'));
      assertEqual('document.title 无 CJK', obs.titleViolation, 0);
      assertEqual('chrome UI CJK 违规条数', obs.violations.length, 0);
      return obs;
    });

  await testCase('i18n-toggle-zh', '点击 #lang-toggle：语言变 zh、html lang=zh-CN、标题/按钮/面板/示例名/状态栏变中文、按钮文字变 EN',
    async (obs) => {
      obs.clicked = await page.eval('(function(){var b=document.getElementById("lang-toggle");b.click();return true;})()');
      await page.wait(250);
      obs.snap = await i18nSnapshot();
      obs.lang = await getLang();
      assertEqual('点击后语言', obs.lang, 'zh');
      assertEqual('<html lang>', obs.snap.htmlLang, 'zh-CN');
      assertIncludes('document.title 中文', obs.snap.title, '分子编辑器');
      assertEqual('语言按钮文字（zh 下显示 EN）', obs.snap.langToggle, 'EN');
      assertEqual('Open file 按钮中文化', /[\u4e00-\u9fff]/.test(String(obs.snap.btnOpen)), true);
      assertEqual('选项卡 Molecule 中文化', cjkCount(obs.snap.tabMolecule) > 0, true);
      assertEqual('选项卡 Results 中文化', cjkCount(obs.snap.tabResults) > 0, true);
      assert(cjkCount(obs.snap.status) > 0, '状态栏应变中文', 'CJK>0', obs.snap.status);
      assert(cjkCount(obs.snap.emptyHint) > 0, '空状态提示应变中文', 'CJK>0', obs.snap.emptyHint);
      assert(cjkCount(obs.snap.panelTitles.join(' ')) > 0, '面板标题应变中文', 'CJK>0', obs.snap.panelTitles);
      const sampleNames = (obs.snap.sampleOptions || []).slice(1).map((o) => o.text);
      assert(cjkCount(sampleNames.join(' ')) > 0, '示例名应变中文', 'CJK>0', sampleNames);
      assertEqual('语言按钮 title 走 i18n（应为英文/非空）', typeof obs.snap.langToggleTitle === 'string' && obs.snap.langToggleTitle.length > 0, true);
      return obs;
    });

  await testCase('i18n-persistence', '语言持久化：zh 下 reload（不清 localStorage）仍是 zh，title/按钮保持中文',
    async (obs) => {
      obs.before = await page.eval('localStorage.getItem(MolI18n.STORAGE_KEY)');
      await reloadPage();
      obs.lang = await getLang();
      obs.snap = await i18nSnapshot();
      assertEqual('reload 前 localStorage', obs.before, 'zh');
      assertEqual('reload 后语言', obs.lang, 'zh');
      assertEqual('<html lang>', obs.snap.htmlLang, 'zh-CN');
      assertIncludes('reload 后标题中文', obs.snap.title, '分子编辑器');
      assertEqual('reload 后语言按钮文字', obs.snap.langToggle, 'EN');
      assert(cjkCount(obs.snap.btnOpen) > 0, 'reload 后按钮应为中文', 'CJK>0', obs.snap.btnOpen);
      return obs;
    });

  await testCase('i18n-back-en', '点击语言按钮切回 en：title/html lang/按钮恢复英文，语言按钮显示“中文”',
    async (obs) => {
      await page.eval('document.getElementById("lang-toggle").click()');
      await page.wait(250);
      obs.lang = await getLang();
      obs.snap = await i18nSnapshot();
      assertEqual('切回后语言', obs.lang, 'en');
      assertEqual('<html lang>', obs.snap.htmlLang, 'en');
      assertIncludes('title 英文', obs.snap.title, 'Molecular Editor');
      assertEqual('语言按钮文字', obs.snap.langToggle, '中文');
      assertEqual('按钮全部英文', cjkCount(obs.snap.btnOpen), 0);
      assertEqual('状态栏英文', cjkCount(obs.snap.status), 0);
      return obs;
    });

  await testCase('i18n-attributes-en', 'EN 下 title/placeholder 属性英文（抽查按钮/工具/输入框，豁免 #lang-toggle）',
    async (obs) => {
      obs.attrs = await page.eval(`(function(){
        var ids = ['btn-open','btn-undo','btn-redo','btn-export-xyz','tool-select','tool-rotate',
          'tool-move-atom','tool-move-fragment','tool-pan','btn-reset-view','btn-clear-selection',
          'btn-rebind','btn-apply-bond-length','btn-apply-angle','btn-apply-dihedral','file-input','charge-input'];
        var out = [];
        ids.forEach(function(id){ var e=document.getElementById(id); if(!e) return;
          ['title','placeholder','aria-label'].forEach(function(a){ var v=e.getAttribute(a);
            if (v) out.push({id:id, attr:a, value:v}); }); });
        return out;
      })()`);
      const bad = obs.attrs.filter((a) => cjkCount(a.value) > 0);
      assertEqual('属性 CJK 违规条数', bad.length, 0);
      assert(obs.attrs.length >= 5, '抽查属性数量', '>=5', obs.attrs.length);
      return obs;
    });

  // v1 中文文案断言统一在 zh 下执行（INTERFACE2.md §11.3#2）
  await setLang('zh');

  /* ========================== 1. 页面就绪 / DOM 契约 ========================== */
  await testCase('page-ready-and-dom', '页面加载完成；MolApp 就绪；v1+v2 全部契约 DOM id 存在；初始为空状态（zh 文案）',
    async (obs) => {
      obs.info = await page.eval(`(function(){
        return {
          title: document.title,
          readyState: document.readyState,
          version: MolApp.version,
          globals: { core: !!window.MolCore, render: !!window.MolRender, samples: !!window.MolSamples,
            i18n: !!window.MolI18n, gausslog: !!window.MolGaussLog, charts: !!window.MolCharts, results: !!window.MolResults },
          api: { setLanguage: typeof MolApp.setLanguage, getLanguage: typeof MolApp.getLanguage,
            getLogResults: typeof MolApp.getLogResults, getResultsState: typeof MolApp.getResultsState,
            setSideTab: typeof MolApp.setSideTab, playFrequency: typeof MolApp.playFrequency,
            stopFrequencyAnimation: typeof MolApp.stopFrequencyAnimation,
            getFrequencyAnimationState: typeof MolApp.getFrequencyAnimationState,
            setFrequencyAmplitude: typeof MolApp.setFrequencyAmplitude },
          lang: MolApp.getLanguage(),
          samples: MolSamples.list.map(function(s){return {key:s.key,format:s.format,name:s.name,nameEn:s.nameEn};}),
          missingIds: ${JSON.stringify(REQUIRED_DOM_IDS)}.filter(function(id){return !document.getElementById(id);}),
          state: MolApp.getState(),
          canvas: (function(){var c=document.getElementById('viewport-canvas');var r=c.getBoundingClientRect();
            return {w:c.width,h:c.height,cssW:r.width,cssH:r.height,dpr:window.devicePixelRatio||1,scrollY:window.scrollY};})()
        };
      })()`);
      obs.dom = await domSnapshot();
      assertEqual('document.readyState', obs.info.readyState, 'complete');
      assertMatch('MolApp.version 语义化版本', obs.info.version, /^\d+\.\d+\.\d+$/);
      assert(obs.info.globals.core && obs.info.globals.render && obs.info.globals.samples,
        'v1 全局对象 MolCore/MolRender/MolSamples 应全部存在', 'all true', obs.info.globals);
      assert(obs.info.globals.i18n && obs.info.globals.gausslog && obs.info.globals.charts && obs.info.globals.results,
        'v2 全局对象 MolI18n/MolGaussLog/MolCharts/MolResults 应全部存在', 'all true', obs.info.globals);
      const missingApi = Object.keys(obs.info.api).filter((k) => obs.info.api[k] !== 'function');
      assertEqual('v2 MolApp API 缺失数量', missingApi.length, 0);
      assertEqual('当前语言（应为 zh，本段中文断言）', obs.info.lang, 'zh');
      assertEqual('缺失 DOM id 数量', obs.info.missingIds.length, 0);
      assertEqual('初始 hasMolecule', obs.info.state.hasMolecule, false);
      assertEqual('初始 atomCount', obs.info.state.atomCount, 0);
      assertEqual('初始 datasetCount', obs.info.state.datasetCount, 0);
      assertIncludes('状态栏初始文本', obs.dom.status, '就绪');
      assertEqual('初始 error-banner 隐藏', obs.dom.errorBannerHidden, true);
      assertEqual('初始 empty-hint 可见', obs.dom.emptyHintHidden, false);
      assertEqual('初始撤销按钮禁用', obs.dom.btnUndoDisabled, true);
      assertEqual('初始导出按钮禁用', obs.dom.btnExportXyzDisabled, true);
      assert(obs.info.samples.length >= 6, '示例库应至少 6 个示例', '>=6', obs.info.samples.length);
      const formats = new Set(obs.info.samples.map((s) => s.format));
      for (const fmt of ['xyz', 'sdf', 'gjf', 'log']) assert(formats.has(fmt), '示例库应包含格式 ' + fmt, fmt, [...formats]);
      const noNameEn = obs.info.samples.filter((s) => !s.nameEn);
      assertEqual('示例缺少 nameEn 的数量（§9）', noNameEn.length, 0);
      assert(obs.info.canvas.w > 600 && obs.info.canvas.h > 400, 'canvas 尺寸应足够大', '>600x400', obs.info.canvas);
      assertEqual('canvas 宽度与 CSS 宽度一致(DPR=1)', obs.info.canvas.w, Math.round(obs.info.canvas.cssW * obs.info.canvas.dpr));
      assertEqual('页面未滚动', obs.info.canvas.scrollY, 0);
      assertEqual('初始 Results tab 禁用', obs.dom.tabResultsDisabled, true);
      assertEqual('初始 Molecule tab 激活', obs.dom.tabMoleculeActive, true);
      await shot('e2e-empty.png');
      return obs;
    });

  await testCase('initial-no-errors', '初始无 JS 异常 / console.error / Log error',
    async (obs) => {
      obs.pageErrors = page.errors.slice();
      obs.consoleErrors = page.consoleErrors.slice();
      assertEqual('Runtime/Log 错误数', obs.pageErrors.length, 0);
      assertEqual('console.error 数', obs.consoleErrors.length, 0);
      return obs;
    });

  /* ========================== 2. 四格式加载 ========================== */
  await testCase('load-xyz', 'water.xyz → format=xyz, 3 原子, 2 键, title=water (H2O)；DOM 同步',
    async (obs) => {
      obs.result = await loadTextFile('water.xyz');
      obs.state = await page.eval('MolApp.getState()');
      obs.dom = await domSnapshot();
      assertEqual('format', obs.result.format, 'xyz');
      assertEqual('moleculeCount', obs.result.moleculeCount, 1);
      assertEqual('atomCount', obs.result.atomCount, 3);
      assertEqual('bondCount', obs.result.bondCount, 2);
      assertEqual('title', obs.result.title, 'water (H2O)');
      assertEqual('filename', obs.result.filename, 'water.xyz');
      assertEqual('warnings 数量', obs.result.warnings.length, 0);
      assertEqual('state.hasMolecule', obs.state.hasMolecule, true);
      assertEqual('DOM 原子数', obs.dom.atomCount, '3');
      assertEqual('DOM 键数', obs.dom.bondCount, '2');
      assertEqual('DOM 格式', obs.dom.molFormat, 'XYZ');
      assertEqual('DOM 标题', obs.dom.molTitle, 'water (H2O)');
      assertEqual('empty-hint 已隐藏', obs.dom.emptyHintHidden, true);
      assertIncludes('状态栏提示', obs.dom.status, '已加载');
      assertEqual('导出按钮已启用', obs.dom.btnExportGjfDisabled, false);
      await shot('e2e-xyz.png');
      return obs;
    });

  await testCase('measure-distance-water', '选 [0,1] 键长 ≈ 0.9572 Å（容差 0.1），API 与 DOM 一致',
    async (obs) => {
      obs.set = await page.eval('(function(){MolApp.setSelection([0,1]);return {m:MolApp.getMeasurements(),state:MolApp.getState()};})()');
      obs.dom = await domSnapshot();
      assertClose('API distance', obs.set.m.distance, 0.9572, 0.1);
      assertClose('DOM distance 数值', num(obs.dom.measureDistance), obs.set.m.distance, 0.001);
      assertMatch('DOM 键长文本格式', obs.dom.measureDistance, /^d = \d+\.\d{3} Å$/);
      assertEqual('DOM 键角为占位符', obs.dom.measureAngle, '—');
      assertEqual('DOM 二面角为占位符', obs.dom.measureDihedral, '—');
      assertEqual('选中数 DOM', obs.dom.selectionCount, '2 / 4');
      assertClose('编辑框自动回填键长', num(obs.dom.bondLengthInput), obs.set.m.distance, 1e-4);
      assertEqual('selection 状态', JSON.stringify(obs.set.state.selection), JSON.stringify([0, 1]));
      return obs;
    });

  await testCase('measure-angle-water', '选 [1,0,2] 键角 ≈ 104.52°（容差 0.1；顶点=第 2 个选中原子），API 与 DOM 一致',
    async (obs) => {
      obs.set = await page.eval('(function(){MolApp.setSelection([1,0,2]);return {m:MolApp.getMeasurements(),state:MolApp.getState()};})()');
      obs.dom = await domSnapshot();
      assertClose('API angle', obs.set.m.angle, 104.52, 0.1);
      assertClose('DOM angle 数值', num(obs.dom.measureAngle), obs.set.m.angle, 0.01);
      assertMatch('DOM 键角文本格式', obs.dom.measureAngle, /^∠ = \d+\.\d{2}°$/);
      assertClose('键长仍为 0.957', num(obs.dom.measureDistance), 0.9572, 0.1);
      assertEqual('选择顺序保持', JSON.stringify(obs.set.state.selection), JSON.stringify([1, 0, 2]));
      assertClose('编辑框自动回填键角', num(obs.dom.angleInput), obs.set.m.angle, 1e-4);
      return obs;
    });

  await testCase('load-sdf', 'benzene.sdf → format=sdf, 12 原子, 12 键, title=benzene；DOM 同步',
    async (obs) => {
      obs.result = await loadTextFile('benzene.sdf');
      obs.state = await page.eval('MolApp.getState()');
      obs.bonds = await page.eval('MolApp.getBonds()');
      obs.dom = await domSnapshot();
      assertEqual('format', obs.result.format, 'sdf');
      assertEqual('atomCount', obs.result.atomCount, 12);
      assertEqual('bondCount', obs.result.bondCount, 12);
      assertEqual('title', obs.result.title, 'benzene');
      assertEqual('DOM 原子数', obs.dom.atomCount, '12');
      assertEqual('DOM 键数', obs.dom.bondCount, '12');
      assertEqual('DOM 格式', obs.dom.molFormat, 'SDF');
      const bondKeys = obs.bonds.map((b) => b.i + '-' + b.j);
      assertEqual('全部键满足 i<j', obs.bonds.every((b) => b.i < b.j), true);
      assertEqual('键唯一（无重复）', new Set(bondKeys).size, obs.bonds.length);
      await shot('e2e-sdf.png');
      return obs;
    });

  await testCase('measure-dihedral-benzene', '苯环选 [0,1,2,3] 二面角 ≈ 0（共面，容差 0.5），API 与 DOM 一致；顺带核实 C-C 1.39 Å / 内角 30°',
    async (obs) => {
      obs.set = await page.eval('(function(){MolApp.setSelection([0,1,2,3]);return {m:MolApp.getMeasurements(),state:MolApp.getState()};})()');
      obs.dom = await domSnapshot();
      assertClose('API dihedral', obs.set.m.dihedral, 0, 0.5);
      assertClose('DOM dihedral 数值', num(obs.dom.measureDihedral), obs.set.m.dihedral, 0.01);
      assertMatch('DOM 二面角文本格式', obs.dom.measureDihedral, /^τ = -?\d+\.\d{2}°$/);
      assertClose('C-C 键长', obs.set.m.distance, 1.39, 0.01);
      assertClose('C-C-C 键角', obs.set.m.angle, 120, 0.5);
      return obs;
    });

  /* ========================== 3. DOM 面板 / 选择状态 ========================== */
  await testCase('dom-panel-and-selection', 'DOM 计数/测量/按钮禁用态随选择数 0/2/3/4 正确变化；最多选 4 个原子；benzene 选 4 个截图',
    async (obs) => {
      await loadTextFile('benzene.sdf');
      obs.initial = await domSnapshot();
      assertEqual('初始 selectionCount', obs.initial.selectionCount, '0 / 4');
      assertEqual('初始 键长编辑按钮禁用', obs.initial.btnApplyBondLengthDisabled, true);
      assertEqual('初始 键角编辑按钮禁用', obs.initial.btnApplyAngleDisabled, true);
      assertEqual('初始 二面角编辑按钮禁用', obs.initial.btnApplyDihedralDisabled, true);
      assertEqual('初始 键长为 —', obs.initial.measureDistance, '—');
      assertEqual('初始 撤销按钮禁用', obs.initial.btnUndoDisabled, true);
      assertEqual('初始 电荷输入可用', obs.initial.chargeDisabled, false);
      assertEqual('初始 电荷值', obs.initial.chargeInputValue, '0');
      assertEqual('初始 多重度值', obs.initial.multiplicityInputValue, '1');

      obs.two = await page.eval('(function(){MolApp.setSelection([0,1]);return {m:MolApp.getMeasurements(),dom:(function(){' +
        "function d(id){return document.getElementById(id);}" +
        'return {bondDisabled:d("btn-apply-bond-length").disabled,angleDisabled:d("btn-apply-angle").disabled,' +
        'dihedralDisabled:d("btn-apply-dihedral").disabled,distance:d("measure-distance").textContent,' +
        'angle:d("measure-angle").textContent,dihedral:d("measure-dihedral").textContent};})()};})()');
      assertEqual('2 原子时键长按钮启用', obs.two.dom.bondDisabled, false);
      assertEqual('2 原子时键角按钮禁用', obs.two.dom.angleDisabled, true);
      assertEqual('2 原子时二面角按钮禁用', obs.two.dom.dihedralDisabled, true);
      assertEqual('2 原子时键角 DOM 为 —', obs.two.dom.angle, '—');
      assertMatch('2 原子时键长数值', obs.two.dom.distance, /d = \d+\.\d{3} Å/);

      obs.three = await page.eval('(function(){MolApp.setSelection([0,1,2]);return {m:MolApp.getMeasurements(),dom:(function(){' +
        "function d(id){return document.getElementById(id);}" +
        'return {bondDisabled:d("btn-apply-bond-length").disabled,angleDisabled:d("btn-apply-angle").disabled,' +
        'dihedralDisabled:d("btn-apply-dihedral").disabled,angle:d("measure-angle").textContent};})()};})()');
      assertEqual('3 原子时键角按钮启用', obs.three.dom.angleDisabled, false);
      assertEqual('3 原子时二面角按钮禁用', obs.three.dom.dihedralDisabled, true);
      assertMatch('3 原子时 angle 数值', obs.three.dom.angle, /∠ = \d+\.\d{2}°/);

      obs.four = await page.eval('(function(){MolApp.setSelection([0,1,2,3]);return {m:MolApp.getMeasurements(),dom:(function(){' +
        "function d(id){return document.getElementById(id);}" +
        'return {dihedralDisabled:d("btn-apply-dihedral").disabled,dihedral:d("measure-dihedral").textContent,' +
        'count:d("selection-count").textContent,list:d("selection-list").textContent};})()};})()');
      obs.dom4 = await domSnapshot();
      assertEqual('4 原子时二面角按钮启用', obs.four.dom.dihedralDisabled, false);
      assertMatch('4 原子时二面角数值', obs.four.dom.dihedral, /τ = -?\d+\.\d{2}°/);
      assertEqual('4 原子时 selection-count', obs.four.dom.count, '4 / 4');
      assertIncludes('selection-list 含序号 1', obs.four.dom.list, '1. C #1');
      assertIncludes('selection-list 含序号 4', obs.four.dom.list, '4. C #4');
      assertEqual('4 原子时二面角编辑框回填', num(obs.dom4.dihedralInput) !== null, true);
      await shot('e2e-select.png');

      obs.cap = await page.eval('(function(){MolApp.clearSelection();MolApp.setSelection([0,1,2,3,4,5,6]);' +
        'return {selection:MolApp.getState().selection,count:MolApp.getState().selection.length,' +
        'status:document.getElementById("status-bar").textContent};})()');
      assertEqual('超过 4 个原子时选择数被截断', obs.cap.count, 4);
      assertIncludes('状态栏提示最多 4 个', obs.cap.status, '最多选择');

      obs.cleared = await page.eval('(function(){MolApp.clearSelection();return {m:MolApp.getMeasurements(),' +
        'count:document.getElementById("selection-count").textContent,' +
        'd:document.getElementById("measure-distance").textContent};})()');
      assertEqual('清除选择后 selection-count', obs.cleared.count, '0 / 4');
      assertEqual('清除选择后 key-distance', obs.cleared.d, '—');
      return obs;
    });

  /* ========================== 4. GJF 加载 ========================== */
  await testCase('load-gjf', 'methane.gjf → format=gjf, 5 原子, 4 键, title=Methane optimization；截图',
    async (obs) => {
      obs.result = await loadTextFile('methane.gjf');
      obs.dom = await domSnapshot();
      assertEqual('format', obs.result.format, 'gjf');
      assertEqual('atomCount', obs.result.atomCount, 5);
      assertEqual('bondCount', obs.result.bondCount, 4);
      assertEqual('title', obs.result.title, 'Methane optimization');
      assertEqual('DOM 格式', obs.dom.molFormat, 'GJF');
      assertEqual('DOM 原子数', obs.dom.atomCount, '5');
      assertEqual('DOM 键数', obs.dom.bondCount, '4');
      await shot('e2e-gjf.png');
      return obs;
    });

  /* ========================== 5. LOG 多帧 ========================== */
  await testCase('load-log-multiframe', 'water.log → format=log, moleculeCount=2；setDatasetIndex(1) 后 datasetIndex=1、原子数 3、坐标变化、DOM 同步',
    async (obs) => {
      obs.result = await loadTextFile('water.log');
      obs.state0 = await page.eval('MolApp.getState()');
      obs.dom0 = await domSnapshot();
      assertEqual('format', obs.result.format, 'log');
      assertEqual('moleculeCount', obs.result.moleculeCount, 2);
      assertEqual('atomCount', obs.result.atomCount, 3);
      assertEqual('bondCount', obs.result.bondCount, 2);
      assertEqual('title', obs.result.title, 'Water optimization');
      assertEqual('state.datasetCount', obs.state0.datasetCount, 2);
      assertEqual('初始 datasetIndex', obs.state0.datasetIndex, 0);
      assertEqual('DOM 格式', obs.dom0.molFormat, 'LOG');
      assertEqual('数据集下拉可用', obs.dom0.datasetDisabled, false);
      assertEqual('数据集选项数', obs.dom0.datasetOptionCount, 2);
      assertIncludes('数据集标签', obs.dom0.datasetLabel, '1/2');

      obs.atom0 = await page.eval('MolApp.getAtom(1)');
      obs.switch = await page.eval('(function(){MolApp.setDatasetIndex(1);return {state:MolApp.getState(),atom1:MolApp.getAtom(1),' +
        'dom:{select:document.getElementById("dataset-select").value,label:document.getElementById("dataset-label").textContent,' +
        'atomCount:document.getElementById("atom-count").textContent,selection:MolApp.getState().selection}};})()');
      await page.wait(150);
      assertEqual('切换后 datasetIndex', obs.switch.state.datasetIndex, 1);
      assertEqual('切换后 atomCount', obs.switch.state.atomCount, 3);
      assertEqual('切换后数据集下拉值', obs.switch.dom.select, '1');
      assertIncludes('切换后数据集标签', obs.switch.dom.label, '2/2');
      assertEqual('切换后 DOM 原子数', obs.switch.dom.atomCount, '3');
      assertEqual('切换后选择被清空', obs.switch.dom.selection.length, 0);
      assert(Math.abs(obs.atom0.x - obs.switch.atom1.x) > 1e-4, '两帧 H 原子 x 坐标应不同', 'diff>1e-4', [obs.atom0.x, obs.switch.atom1.x]);
      await shot('e2e-log.png');
      return obs;
    });

  /* ========================== 6. 加载错误处理 ========================== */
  await testCase('load-error-handling', '无法解析的文本 → Promise 拒绝 + 中文错误横幅；当前分子不被清空；重新加载后横幅恢复隐藏',
    async (obs) => {
      const text = 'this file is definitely not a molecule\nrandom text\n';
      obs.errorMessage = await expectReject('MolApp.loadText(' + JSON.stringify(text) + ', {filename:"bad.txt"})', '加载坏文件');
      assert(/[\u4e00-\u9fa5]/.test(obs.errorMessage), '错误信息应为中文', '含中文', obs.errorMessage);
      obs.domAfter = await domSnapshot();
      obs.stateAfter = await page.eval('MolApp.getState()');
      assertEqual('错误横幅可见', obs.domAfter.errorBannerHidden, false);
      assert(obs.domAfter.errorBannerText && obs.domAfter.errorBannerText.length > 0, '错误横幅应有文本', '非空', obs.domAfter.errorBannerText);
      assertEqual('当前分子未被清空', obs.stateAfter.hasMolecule, true);
      assertEqual('当前分子原子数保持', obs.stateAfter.atomCount, 3);
      await loadTextFile('water.xyz');
      obs.domReload = await domSnapshot();
      assertEqual('重新加载后横幅隐藏', obs.domReload.errorBannerHidden, true);
      assertEqual('getLastError 已清空', await page.eval('MolApp.getLastError()'), null);
      return obs;
    });

  /* ========================== 7. 键长编辑 ========================== */
  await testCase('edit-bond-length', 'water 选 [0,1] → applyBondLength(1.2)：API/DOM 均为 1.2；导出 xyz 再加载仍为 1.2',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.apply = await page.eval('(function(){MolApp.setSelection([0,1]);var r=MolApp.applyBondLength(1.2);' +
        'return {result:r,m:MolApp.getMeasurements(),dom:{d:document.getElementById("measure-distance").textContent,' +
        'input:document.getElementById("bond-length-input").value,undoDisabled:document.getElementById("btn-undo").disabled,' +
        'status:document.getElementById("status-bar").textContent}};})()');
      await page.wait(150);
      assertClose('before', obs.apply.result.before, 0.9572, 0.1);
      assertClose('after', obs.apply.result.after, 1.2, 1e-6);
      assertClose('API 测量', obs.apply.m.distance, 1.2, 1e-6);
      assertClose('DOM 测量', num(obs.apply.dom.d), 1.2, 0.001);
      assertEqual('编辑框回填', obs.apply.dom.input, '1.2000');
      assertEqual('撤销按钮启用', obs.apply.dom.undoDisabled, false);
      assertIncludes('状态栏提示', obs.apply.dom.status, '键长已设为');

      obs.exported = await page.eval('(function(){var t=MolApp.exportText("xyz");var p=MolCore.parseFile(t,{format:"xyz"});' +
        'return {text:t,mol:p.molecules[0],count:p.molecules.length};})()');
      assertEqual('导出 xyz 分子数', obs.exported.count, 1);
      assertEqual('导出 xyz 原子数', obs.exported.mol.atoms.length, 3);
      // 用导出文本重新加载（完整回环：导出 → 解析 → 加载）
      await loadRawText(obs.exported.text, { filename: 'edited.xyz' });
      obs.reloadMeasure = await page.eval('(function(){MolApp.setSelection([0,1]);MolApp.getState();' +
        'return {m:MolApp.getMeasurements(),format:MolApp.getState().format,atomCount:MolApp.getState().atomCount,bondCount:MolApp.getState().bondCount,' +
        'domD:document.getElementById("measure-distance").textContent};})()');
      assertClose('导出回环后的键长', obs.reloadMeasure.m.distance, 1.2, 1e-6);
      assertClose('导出回环后 DOM 键长', num(obs.reloadMeasure.domD), 1.2, 0.001);
      assertEqual('导出回环格式', obs.reloadMeasure.format, 'xyz');
      assertEqual('导出回环原子数', obs.reloadMeasure.atomCount, 3);
      assertEqual('导出回环键数', obs.reloadMeasure.bondCount, 2);
      await shot('e2e-bondlength.png');
      return obs;
    });

  /* ========================== 8. 键角编辑 ========================== */
  await testCase('edit-bond-angle', 'water 选 [1,0,2] → applyBondAngle(120)：API/DOM 均 ≈120；O-H 键长不变',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.before = await page.eval('(function(){MolApp.setSelection([1,0,2]);return {m:MolApp.getMeasurements(),bonds:MolApp.getBonds()};})()');
      obs.apply = await page.eval('(function(){var r=MolApp.applyBondAngle(120);return {result:r,m:MolApp.getMeasurements(),' +
        'dom:{a:document.getElementById("measure-angle").textContent,input:document.getElementById("angle-input").value,' +
        'status:document.getElementById("status-bar").textContent}};})()');
      await page.wait(150);
      assertClose('before angle', obs.before.m.angle, 104.52, 0.1);
      assertClose('after angle', obs.apply.result.after, 120, 1e-6);
      assertClose('API angle', obs.apply.m.angle, 120, 1e-6);
      assertClose('DOM angle', num(obs.apply.dom.a), 120, 0.01);
      assertIncludes('状态栏提示', obs.apply.dom.status, '键角已设为');
      obs.afterBonds = await page.eval('MolApp.getBonds()');
      assertEqual('键数不变', obs.afterBonds.length, 2);
      assertClose('O-H 键长不变', obs.apply.m.distance, 0.9572, 0.1);
      await shot('e2e-angle.png');
      return obs;
    });

  /* ========================== 9. 二面角编辑（butane） ========================== */
  await testCase('edit-dihedral-butane', 'butane 选 4 个碳 [0,1,2,3]：初始 ≈180；applyBondDihedral 60 / -60 / 180 均生效；C-C 键长与 C-C-C 键角不变(<1e-3)',
    async (obs) => {
      await loadTextFile('butane.xyz');
      obs.init = await page.eval('(function(){MolApp.setSelection([0,1,2,3]);' +
        'function d(a,b){return MolCore.measure.distance({atoms:[0,1,2,3,4,5].map(function(i){return MolApp.getAtom(i);})},a,b);}' +
        'function ang(a,b,c){return MolCore.measure.angle({atoms:[0,1,2,3,4,5].map(function(i){return MolApp.getAtom(i);})},a,b,c);}' +
        'return {m:MolApp.getMeasurements(),d01:d(0,1),d12:d(1,2),d23:d(2,3),a012:ang(0,1,2),a123:ang(1,2,3),bondCount:MolApp.getBonds().length};})()');
      assertClose('初始二面角 |τ|', Math.abs(obs.init.m.dihedral), 180, 0.5);
      assertClose('初始 d01', obs.init.d01, 1.53, 1e-3);
      assertClose('初始 d12', obs.init.d12, 1.53, 1e-3);
      assertClose('初始 d23', obs.init.d23, 1.53, 1e-3);
      assertClose('初始 a012', obs.init.a012, 112, 0.5);
      assertClose('初始 a123', obs.init.a123, 112, 0.5);
      assertEqual('初始键数', obs.init.bondCount, 13);

      obs.step60 = await page.eval('(function(){var r=MolApp.applyBondDihedral(60);return {result:r,m:MolApp.getMeasurements(),' +
        'dom:document.getElementById("measure-dihedral").textContent};})()');
      await page.wait(120);
      assertClose('after(60)', obs.step60.result.after, 60, 1e-6);
      assertClose('API dihedral(60)', obs.step60.m.dihedral, 60, 1e-6);
      assertClose('DOM dihedral(60)', num(obs.step60.dom), 60, 0.01);
      await shot('e2e-dihedral.png');

      obs.stepMinus60 = await page.eval('(function(){var r=MolApp.applyBondDihedral(-60);return {result:r,m:MolApp.getMeasurements()};})()');
      assertClose('after(-60)', obs.stepMinus60.result.after, -60, 1e-6);
      assertClose('API dihedral(-60)', obs.stepMinus60.m.dihedral, -60, 1e-6);

      obs.step180 = await page.eval('(function(){var r=MolApp.applyBondDihedral(180);return {result:r,m:MolApp.getMeasurements()};})()');
      assertClose('after(180) 绝对值', Math.abs(obs.step180.result.after), 180, 1e-6);
      assertClose('API dihedral(180) 绝对值', Math.abs(obs.step180.m.dihedral), 180, 1e-6);

      obs.after = await page.eval('(function(){var atoms=[0,1,2,3,4,5].map(function(i){return MolApp.getAtom(i);});' +
        'function d(a,b){return MolCore.measure.distance({atoms:atoms},a,b);}' +
        'function ang(a,b,c){return MolCore.measure.angle({atoms:atoms},a,b,c);}' +
        'return {d01:d(0,1),d12:d(1,2),d23:d(2,3),a012:ang(0,1,2),a123:ang(1,2,3),bondCount:MolApp.getBonds().length};})()');
      assert(Math.abs(obs.after.d01 - obs.init.d01) < 1e-3, 'C-C 键长 d01 不应被破坏', obs.init.d01, obs.after.d01);
      assert(Math.abs(obs.after.d12 - obs.init.d12) < 1e-3, 'C-C 键长 d12 不应被破坏', obs.init.d12, obs.after.d12);
      assert(Math.abs(obs.after.d23 - obs.init.d23) < 1e-3, 'C-C 键长 d23 不应被破坏', obs.init.d23, obs.after.d23);
      assert(Math.abs(obs.after.a012 - obs.init.a012) < 1e-3, 'C-C-C 键角 a012 不应被破坏', obs.init.a012, obs.after.a012);
      assert(Math.abs(obs.after.a123 - obs.init.a123) < 1e-3, 'C-C-C 键角 a123 不应被破坏', obs.init.a123, obs.after.a123);
      assertEqual('键数不变', obs.after.bondCount, 13);
      return obs;
    });

  /* ========================== 10. 非法编辑 ========================== */
  await testCase('edit-invalid-inputs', '非法键长/键角/原子数不足 → 抛中文错误且分子几何不变',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.msgNeg = await expectReject('(function(){MolApp.setSelection([0,1]);return MolApp.applyBondLength(-1);})()', '负键长');
      obs.msgBig = await expectReject('(function(){MolApp.setSelection([1,0,2]);return MolApp.applyBondAngle(200);})()', '越界键角');
      obs.msgShort = await expectReject('(function(){MolApp.setSelection([0]);return MolApp.applyBondLength(1.2);})()', '原子数不足');
      for (const m of [obs.msgNeg, obs.msgBig, obs.msgShort]) assert(/[\u4e00-\u9fa5]/.test(m), '错误消息应为中文', '含中文', m);
      obs.state = await page.eval('(function(){MolApp.setSelection([0,1]);var m=MolApp.getMeasurements();' +
        'return {m:m,bondCount:MolApp.getState().bondCount,atoms3:[MolApp.getAtom(0),MolApp.getAtom(1),MolApp.getAtom(2)]};})()');
      assertClose('几何未被修改（键长）', obs.state.m.distance, 0.9572, 0.1);
      assertEqual('键数未变', obs.state.bondCount, 2);
      obs.dom = await domSnapshot();
      assertEqual('错误横幅可见', obs.dom.errorBannerHidden, false);
      await loadTextFile('water.xyz');
      return obs;
    });

  /* ========================== 11. 撤销 / 重做 ========================== */
  await testCase('undo-redo', '改键长 1.5 → undo 恢复 0.9572 → redo 回到 1.5；按钮 disabled 与 DOM 数值同步；栈空返回 false',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.initial = await page.eval('(function(){MolApp.setSelection([0,1]);return {m:MolApp.getMeasurements(),' +
        'undoDisabled:document.getElementById("btn-undo").disabled,redoDisabled:document.getElementById("btn-redo").disabled,' +
        'undo:MolApp.undo()};})()');
      const original = obs.initial.m.distance;
      assertClose('原始键长', original, 0.9572, 0.1);
      assertEqual('初始 undo 按钮禁用', obs.initial.undoDisabled, true);
      assertEqual('初始 redo 按钮禁用', obs.initial.redoDisabled, true);
      assertEqual('初始 undo() 返回 false', obs.initial.undo, false);

      obs.applied = await page.eval('(function(){MolApp.applyBondLength(1.5);MolApp.setSelection([0,1]);' +
        'return {m:MolApp.getMeasurements(),domD:document.getElementById("measure-distance").textContent,' +
        'undoDisabled:document.getElementById("btn-undo").disabled,redoDisabled:document.getElementById("btn-redo").disabled};})()');
      assertClose('编辑后键长', obs.applied.m.distance, 1.5, 1e-6);
      assertClose('编辑后 DOM 键长', num(obs.applied.domD), 1.5, 0.001);
      assertEqual('编辑后 undo 按钮启用', obs.applied.undoDisabled, false);

      obs.undone = await page.eval('(function(){var r=MolApp.undo();MolApp.setSelection([0,1]);' +
        'return {ret:r,m:MolApp.getMeasurements(),domD:document.getElementById("measure-distance").textContent,' +
        'undoDisabled:document.getElementById("btn-undo").disabled,redoDisabled:document.getElementById("btn-redo").disabled};})()');
      assertEqual('undo() 返回 true', obs.undone.ret, true);
      assertClose('undo 后 API 键长', obs.undone.m.distance, original, 1e-6);
      assertClose('undo 后 DOM 键长', num(obs.undone.domD), original, 0.001);
      assertEqual('undo 后 redo 按钮启用', obs.undone.redoDisabled, false);

      obs.redone = await page.eval('(function(){var r=MolApp.redo();MolApp.setSelection([0,1]);' +
        'return {ret:r,m:MolApp.getMeasurements(),domD:document.getElementById("measure-distance").textContent};})()');
      assertEqual('redo() 返回 true', obs.redone.ret, true);
      assertClose('redo 后 API 键长', obs.redone.m.distance, 1.5, 1e-6);
      assertClose('redo 后 DOM 键长', num(obs.redone.domD), 1.5, 0.001);

      obs.stack = await page.eval('(function(){MolApp.undo();MolApp.setSelection([0,1]);' +
        'var afterFirst=MolApp.getMeasurements().distance;var second=MolApp.undo();' +
        'return {afterFirst:afterFirst,secondUndo:second,state:MolApp.getState()};})()');
      assertClose('第二次 undo 后恢复原值', obs.stack.afterFirst, original, 1e-6);
      assertEqual('空栈 undo() 返回 false', obs.stack.secondUndo, false);
      return obs;
    });

  /* ========================== 12. UI 按钮路径 ========================== */
  await testCase('ui-apply-buttons', '通过 DOM 输入框+应用按钮改键长 1.3 / 键角 130 / 二面角 90，测量与 DOM 同步',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.bond = await page.eval('(function(){MolApp.setSelection([0,1]);' +
        'var i=document.getElementById("bond-length-input");i.value="1.3";' +
        'document.getElementById("btn-apply-bond-length").click();' +
        'return {m:MolApp.getMeasurements(),domD:document.getElementById("measure-distance").textContent,' +
        'status:document.getElementById("status-bar").textContent};})()');
      await page.wait(120);
      assertClose('按钮改键长后 API', obs.bond.m.distance, 1.3, 1e-6);
      assertClose('按钮改键长后 DOM', num(obs.bond.domD), 1.3, 0.001);

      obs.angle = await page.eval('(function(){MolApp.setSelection([1,0,2]);' +
        'var i=document.getElementById("angle-input");i.value="130";' +
        'document.getElementById("btn-apply-angle").click();' +
        'return {m:MolApp.getMeasurements(),domA:document.getElementById("measure-angle").textContent};})()');
      await page.wait(120);
      assertClose('按钮改键角后 API', obs.angle.m.angle, 130, 1e-6);
      assertClose('按钮改键角后 DOM', num(obs.angle.domA), 130, 0.01);

      await loadTextFile('butane.xyz');
      obs.dihedral = await page.eval('(function(){MolApp.setSelection([0,1,2,3]);' +
        'var i=document.getElementById("dihedral-input");i.value="90";' +
        'document.getElementById("btn-apply-dihedral").click();' +
        'return {m:MolApp.getMeasurements(),domT:document.getElementById("measure-dihedral").textContent,' +
        'status:document.getElementById("status-bar").textContent};})()');
      await page.wait(120);
      assertClose('按钮改二面角后 API', obs.dihedral.m.dihedral, 90, 1e-6);
      assertClose('按钮改二面角后 DOM', num(obs.dihedral.domT), 90, 0.01);
      assertIncludes('状态栏提示', obs.dihedral.status, '二面角已设为');
      return obs;
    });

  /* ========================== 13. 键盘快捷键 ========================== */
  await testCase('keyboard-shortcuts', 'Ctrl+Z 撤销 / Ctrl+Y 重做 / Esc 清除选择',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.applied = await page.eval('(function(){MolApp.setSelection([0,1]);MolApp.applyBondLength(1.4);' +
        'return {distance:MolApp.getMeasurements().distance,original:null};})()');
      assertClose('编辑后键长', obs.applied.distance, 1.4, 1e-6);
      obs.undo = await page.eval('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true,cancelable:true}));' +
        'return {distance:MolApp.getMeasurements().distance};})()');
      assertClose('Ctrl+Z 后键长恢复', obs.undo.distance, 0.9572, 0.1);
      obs.redo = await page.eval('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"y",ctrlKey:true,bubbles:true,cancelable:true}));' +
        'return {distance:MolApp.getMeasurements().distance};})()');
      assertClose('Ctrl+Y 后键长回到 1.4', obs.redo.distance, 1.4, 1e-6);
      obs.escape = await page.eval('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));' +
        'return {selection:MolApp.getState().selection,count:document.getElementById("selection-count").textContent};})()');
      assertEqual('Esc 后选择清空', obs.escape.selection.length, 0);
      assertEqual('Esc 后 selection-count', obs.escape.count, '0 / 4');
      return obs;
    });

  /* ========================== 14. 显示样式 / 选项 ========================== */
  await testCase('styles-cycle', '四种样式 setStyle 生效且 #style-select 同步；不同样式画布像素不同；spacefill / wireframe 截图',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.hashes = {};
      obs.hashes.ballstick = await canvasHash();
      // 顺序：ballstick → stick → wireframe → spacefill（spacefill 会触发视口收缩，放最后）
      for (const style of ['stick', 'wireframe', 'spacefill']) {
        obs.styleResult = await page.eval('(function(s){MolApp.setStyle(s);' +
          'return {state:MolApp.getState().style,select:document.getElementById("style-select").value,' +
          'status:document.getElementById("status-bar").textContent};})(' + JSON.stringify(style) + ')');
        assertEqual('style ' + style + ' 状态', obs.styleResult.state, style);
        assertEqual('style ' + style + ' 下拉同步', obs.styleResult.select, style);
        assertIncludes('style ' + style + ' 状态栏', obs.styleResult.status, '显示样式');
        await forceFrame();
        obs.hashes[style] = await canvasHash();
        if (style === 'spacefill') await shot('e2e-spacefill.png');
        if (style === 'wireframe') await shot('e2e-wireframe.png');
      }
      assert(obs.hashes.ballstick !== obs.hashes.spacefill, 'ballstick 与 spacefill 画布像素应不同', 'different', obs.hashes);
      assert(obs.hashes.stick !== obs.hashes.wireframe, 'stick 与 wireframe 画布像素应不同', 'different', obs.hashes);
      obs.reset = await page.eval('(function(){MolApp.setStyle("ballstick");return MolApp.getState().style;})()');
      assertEqual('恢复 ballstick', obs.reset, 'ballstick');
      return obs;
    });

  await testCase('style-adaptive-fit', '样式切换自适应取景：spacefill 内容不裁剪且 fill 0.5~0.85；spacefill→ballstick 往返后 fill 仍 0.5~0.85',
    async (obs) => {
      await loadTextFile('water.xyz');
      await page.eval('MolApp.setStyle("ballstick")');
      await forceFrame();
      obs.ballstick = await canvasStats();
      obs.ballstickFill = Number(obs.ballstick.fill.toFixed(3));
      assertIn('ballstick fill', obs.ballstick.fill, 0.5, 0.85);
      assertEqual('ballstick 内容未被裁剪', obs.ballstick.clipped, false);

      await page.eval('MolApp.setStyle("spacefill")');
      await forceFrame();
      obs.spacefill = await canvasStats();
      obs.spacefillFill = Number(obs.spacefill.fill.toFixed(3));
      assertIn('spacefill fill', obs.spacefill.fill, 0.5, 0.85);
      assertEqual('spacefill 内容完整在画布内（不裁剪）', obs.spacefill.clipped, false);
      assertEqual('spacefill 内容包围盒在画布内', obs.spacefill.molecule.minX >= 0 && obs.spacefill.molecule.minY >= 0 &&
        obs.spacefill.molecule.maxX <= obs.spacefill.W && obs.spacefill.molecule.maxY <= obs.spacefill.H, true);

      await page.eval('MolApp.setStyle("ballstick")');
      await forceFrame();
      obs.roundTrip = await canvasStats();
      obs.roundTripFill = Number(obs.roundTrip.fill.toFixed(3));
      assertIn('spacefill→ballstick 往返后 fill', obs.roundTrip.fill, 0.5, 0.85);
      assertEqual('往返后内容未被裁剪', obs.roundTrip.clipped, false);
      return obs;
    });

  await testCase('display-options', 'setOption(labels/indices/showAxes) 与复选框同步；bondWidth 可设置；未知选项报错',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.labels = await page.eval('(function(){MolApp.setOption("labels",false);' +
        'return {checked:document.getElementById("toggle-labels").checked};})()');
      assertEqual('labels=false 复选框', obs.labels.checked, false);
      obs.indices = await page.eval('(function(){MolApp.setOption("indices",true);' +
        'return {checked:document.getElementById("toggle-indices").checked};})()');
      assertEqual('indices=true 复选框', obs.indices.checked, true);
      obs.axes = await page.eval('(function(){MolApp.setOption("showAxes",false);' +
        'return {checked:document.getElementById("toggle-axes").checked};})()');
      assertEqual('showAxes=false 复选框', obs.axes.checked, false);
      obs.bondWidth = await page.eval('(function(){MolApp.setOption("bondWidth",1.4);return true;})()');
      assertEqual('bondWidth 可设置', obs.bondWidth, true);
      obs.unknown = await expectReject('(function(){MolApp.setOption("noSuchOption",1);return true;})()', '未知选项');
      assert(/[\u4e00-\u9fa5]/.test(obs.unknown), '未知选项错误应为中文', '含中文', obs.unknown);
      obs.restore = await page.eval('(function(){MolApp.setOption("labels",true);MolApp.setOption("indices",false);' +
        'MolApp.setOption("showAxes",true);MolApp.setOption("bondWidth",1.0);' +
        'return {labels:document.getElementById("toggle-labels").checked,indices:document.getElementById("toggle-indices").checked,' +
        'axes:document.getElementById("toggle-axes").checked};})()');
      assertEqual('恢复 labels', obs.restore.labels, true);
      assertEqual('恢复 indices', obs.restore.indices, false);
      assertEqual('恢复 axes', obs.restore.axes, true);
      return obs;
    });

  /* ========================== 15. 示例库 ========================== */
  await testCase('sample-library', 'listSamples 列表完整；loadSample 可用；#sample-select change 加载示例',
    async (obs) => {
      obs.samples = await page.eval('MolApp.listSamples()');
      obs.dom = await domSnapshot();
      assert(obs.samples.length >= 4, '示例数量', '>=4', obs.samples.length);
      assertEqual('下拉选项数 = 示例数 + 1', obs.dom.sampleOptionCount, obs.samples.length + 1);
      const xyzSample = obs.samples.find((s) => s.format === 'xyz');
      const sdfSample = obs.samples.find((s) => s.format === 'sdf');
      assert(!!xyzSample && !!sdfSample, '示例库应含 xyz 与 sdf 示例', 'both', obs.samples);
      obs.loadSample = await page.eval('MolApp.loadSample(' + JSON.stringify(xyzSample.key) + ')');
      assertEqual('loadSample 格式', obs.loadSample.format, 'xyz');
      assert(obs.loadSample.atomCount > 0, 'loadSample 原子数', '>0', obs.loadSample.atomCount);
      obs.changed = await page.eval('(function(){var s=document.getElementById("sample-select");' +
        's.value=' + JSON.stringify(sdfSample.key) + ';s.dispatchEvent(new Event("change",{bubbles:true}));' +
        'return {format:MolApp.getState().format,title:MolApp.getState().title,atomCount:MolApp.getState().atomCount};})()');
      assertEqual('下拉切换后格式', obs.changed.format, 'sdf');
      assert(obs.changed.atomCount > 0, '下拉切换后原子数', '>0', obs.changed.atomCount);
      return obs;
    });

  /* ========================== 16. 导出回环 ========================== */
  await testCase('export-roundtrip', 'butane 导出 xyz/gjf/sdf 后用页面内 MolCore.parseFile 解析：原子数/键数/坐标误差达标',
    async (obs) => {
      await loadTextFile('butane.xyz');
      obs.rt = await page.eval(`(function(){
        var n = MolApp.getState().atomCount;
        function coords(){ var out=[]; for(var i=0;i<n;i++){var a=MolApp.getAtom(i);out.push({x:a.x,y:a.y,z:a.z});} return out; }
        var base = coords();
        function one(fmt){
          var text = MolApp.exportText(fmt);
          var detected = MolCore.detectFormat(text);
          var parsed = MolCore.parseFile(text, {format: fmt});
          var mol = parsed.molecules[0];
          var maxDiff = 0;
          for (var i=0;i<base.length && i<mol.atoms.length;i++){
            var b=base[i], a=mol.atoms[i];
            maxDiff=Math.max(maxDiff, Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.z-b.z));
          }
          return {format:fmt, detected:detected, atomCount:mol.atoms.length, bondCount:mol.bonds.length,
            maxDiff:maxDiff, textLength:text.length, endsWithNewline: text.charAt(text.length-1)==='\\n'};
        }
        return {baseCount:n, baseBondCount:MolApp.getBonds().length, xyz:one('xyz'), gjf:one('gjf'), sdf:one('sdf')};
      })()`);
      assertEqual('导出前原子数', obs.rt.baseCount, 14);
      assertEqual('导出前键数', obs.rt.baseBondCount, 13);
      for (const fmt of ['xyz', 'gjf', 'sdf']) {
        const r = obs.rt[fmt];
        assertEqual(fmt + ' detectFormat', r.detected, fmt);
        assertEqual(fmt + ' 原子数', r.atomCount, 14);
        assertEqual(fmt + ' 键数', r.bondCount, 13);
        assertEqual(fmt + ' 换行结尾', r.endsWithNewline, true);
        if (fmt === 'sdf') assertClose('sdf 坐标误差(4 位小数格式)', r.maxDiff, 0, 1e-3);
        else assertClose(fmt + ' 坐标误差', r.maxDiff, 0, 1e-6);
      }
      return obs;
    });

  /* ========================== 17. 真实鼠标交互 ========================== */
  await testCase('mouse-click-and-shift', 'CDP 真实鼠标点击原子 → 选中；Shift+点击另一原子 → 追加；点空白 → 清空；再点已选原子 → 取消选中',
    async (obs) => {
      await loadTextFile('water.xyz');
      await page.eval('(function(){MolApp.resetView();MolApp.clearSelection();return true;})()');
      await page.wait(200);
      obs.scan1 = await findAtomPoint(null);
      assert(!!obs.scan1.found, '应能通过 hover 光标找到原子屏幕位置', 'found', obs.scan1);
      await realClick(obs.scan1.found.clientX, obs.scan1.found.clientY);
      obs.afterClick = await page.eval('(function(){var s=MolApp.getState();return {selection:s.selection,symbol:s.selection.length?MolApp.getAtom(s.selection[0]).symbol:null};})()');
      assertEqual('单击后选中原子数', obs.afterClick.selection.length, 1);
      assert(obs.afterClick.symbol != null, '选中原子应有元素符号', 'not null', obs.afterClick);

      obs.scan2 = await findAtomPoint(obs.scan1.found);
      assert(!!obs.scan2.found, '应能找到第二个原子位置', 'found', obs.scan2);
      await realClick(obs.scan2.found.clientX, obs.scan2.found.clientY, 8 /* Shift */);
      obs.afterShift = await page.eval('(function(){var s=MolApp.getState();return {selection:s.selection,count:document.getElementById("selection-count").textContent};})()');
      assertEqual('Shift+点击后选中原子数', obs.afterShift.selection.length, 2);
      assert(obs.afterShift.selection.indexOf(obs.afterClick.selection[0]) !== -1, 'Shift 点击应追加而不是替换', obs.afterClick.selection[0], obs.afterShift.selection);
      assertEqual('DOM selection-count 同步', obs.afterShift.count, '2 / 4');

      obs.blank = await findBlankPoint();
      assert(!!obs.blank, '应找到画布空白点', 'found', obs.blank);
      await realClick(obs.blank.x, obs.blank.y);
      obs.afterBlank = await page.eval('(function(){return {selection:MolApp.getState().selection,count:document.getElementById("selection-count").textContent};})()');
      assertEqual('点空白后选择清空', obs.afterBlank.selection.length, 0);

      await realClick(obs.scan1.found.clientX, obs.scan1.found.clientY);
      obs.again = await page.eval('(function(){return MolApp.getState().selection;})()');
      assertEqual('再次点击选同一个原子', obs.again.length, 1);
      await realClick(obs.scan1.found.clientX, obs.scan1.found.clientY);
      obs.toggle = await page.eval('(function(){return MolApp.getState().selection;})()');
      assertEqual('无 Shift 再点已选原子 → 取消选择', obs.toggle.length, 0);
      return obs;
    });

  await testCase('mouse-drag-rotate', 'CDP 真实鼠标在空白处拖动 → 相机旋转（画布像素改变）、选择不受影响；截图',
    async (obs) => {
      await loadTextFile('water.xyz');
      await page.eval('(function(){MolApp.resetView();MolApp.clearSelection();return true;})()');
      await page.wait(250);
      obs.blank = await findBlankPoint();
      assert(!!obs.blank, '应找到画布空白点', 'found', obs.blank);
      await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: obs.blank.x, y: obs.blank.y, button: 'none' });
      await page.wait(150);
      obs.hashBefore = await canvasHash();
      obs.selectionBefore = await page.eval('MolApp.getState().selection');
      await realDrag(obs.blank.x, obs.blank.y, 150, 70);
      obs.hashAfter = await canvasHash();
      obs.stateAfter = await page.eval('(function(){return {selection:MolApp.getState().selection,selectionCount:MolApp.getState().selection.length};})()');
      assert(obs.hashBefore !== obs.hashAfter, '拖动旋转后画布像素应变化', 'different', { before: obs.hashBefore, after: obs.hashAfter });
      assertEqual('拖动旋转不应改变选择', obs.stateAfter.selection.length, 0);
      await shot('e2e-mouse-drag.png');
      return obs;
    });

  await testCase('mouse-wheel-zoom', 'CDP 真实滚轮缩放 → 画布像素改变（zoom 生效）',
    async (obs) => {
      await loadTextFile('water.xyz');
      await page.eval('(function(){MolApp.resetView();MolApp.clearSelection();return true;})()');
      await page.wait(250);
      obs.rect = await page.eval("(function(){var r=document.getElementById('viewport-canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
      obs.hashBefore = await canvasHash();
      await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: obs.rect.x, y: obs.rect.y, deltaX: 0, deltaY: -300, modifiers: 0 });
      await page.wait(300);
      obs.hashAfter = await canvasHash();
      assert(obs.hashBefore !== obs.hashAfter, '滚轮缩放后画布像素应变化', 'different', { before: obs.hashBefore, after: obs.hashAfter });
      return obs;
    });

  /* ========================== 18. 画布视觉启发式 ========================== */
  await testCase('visual-canvas-heuristics', '白底画布；分子居中且占视口合理比例；选中后出现橙色高亮像素',
    async (obs) => {
      await loadTextFile('water.xyz');
      await page.eval('(function(){MolApp.setStyle("ballstick");MolApp.resetView();MolApp.clearSelection();' +
        'MolApp.setOption("labels",true);MolApp.setOption("showAxes",true);return true;})()');
      await page.wait(300);
      obs.stats = await canvasStats();
      const s = obs.stats;
      const near = (a, b, tol) => Math.abs(a - b) <= tol;
      assert(near(s.cornerPixel[0], 255, 3) && near(s.cornerPixel[1], 255, 3) && near(s.cornerPixel[2], 255, 3),
        '画布左上角应为白色背景', '[255,255,255]', s.cornerPixel);
      assertIn('非白像素比例', s.nonWhiteRatio, 0.01, 0.6);
      assertIn('分子填充率（§9 约 60~70%）', s.fill, 0.5, 0.85);
      assertEqual('分子内容未被画布裁剪', s.clipped, false);
      assertIn('内容质心 x', s.centroid.x / s.W, 0.3, 0.7);
      assertIn('内容质心 y', s.centroid.y / s.H, 0.2, 0.8);
      obs.statsSelected = await page.eval('(function(){MolApp.setSelection([0,1,2]);return true;})()');
      await page.wait(250);
      obs.selStats = await canvasStats();
      assert(obs.selStats.orangePixels >= 80, '选中后画布应出现橙色高亮像素', '>=80', obs.selStats.orangePixels);
      assert(obs.selStats.orangePixels > s.orangePixels, '选中后橙色像素应多于未选中时', s.orangePixels, obs.selStats.orangePixels);
      await page.eval('MolApp.clearSelection()');
      return obs;
    });

  /* ====================== v2-B. Gaussian LOG 结果面板（§4/§6/§8） ====================== */
  const SUMMARY_FIELDS = ['natoms', 'route', 'charge', 'multiplicity', 'final-energy', 'termination',
    'optimization', 'temperature', 'pressure', 'zpe', 'thermal-energy', 'thermal-enthalpy', 'thermal-gibbs',
    'sum-zpe', 'sum-energy', 'sum-enthalpy', 'sum-gibbs'];

  await testCase('log-results-parse', '加载 opt+freq log：LoadResult/MolApp.getLogResults 与 Node 侧 MolGaussLog 解析一致（能量/热化学/4 优化步/3 频率）',
    async (obs) => {
      obs.expected = expectedOptFreqResults();
      obs.exp = obs.expected.results;
      obs.load = await loadOptFreqInPage();
      obs.api = await resultsApiSnapshot();
      assertEqual('format', obs.load.result.format, 'log');
      assertEqual('hasLogResults', obs.load.result.hasLogResults, true);
      assertEqual('logJobCount', obs.load.result.logJobCount, obs.exp.summary.jobCount);
      assertEqual('frequencyCount', obs.load.result.frequencyCount, 3);
      assertEqual('hasFrequencies', obs.load.result.hasFrequencies, true);
      assertEqual('hasThermochemistry', obs.load.result.hasThermochemistry, true);
      assertEqual('hasOptimization', obs.load.result.hasOptimization, true);
      assert(obs.api.summary, 'getLogResults().summary 应存在', 'summary', obs.api);
      const s = obs.api.summary, e = obs.exp.summary;
      assertEqual('summary.jobCount', s.jobCount, e.jobCount);
      assertEqual('summary.natoms', s.natoms, 3);
      assertEqual('summary.charge', s.charge, e.charge);
      assertEqual('summary.multiplicity', s.multiplicity, e.multiplicity);
      assertIncludes('summary.route 含 opt', String(s.route).toLowerCase(), 'opt');
      assertIncludes('summary.route 含 freq', String(s.route).toLowerCase(), 'freq');
      assertClose('summary.finalEnergy', s.finalEnergy, e.finalEnergy, 1e-9);
      assertEqual('summary.normalTermination', s.normalTermination, true);
      assertEqual('opt 步数', s.optStepCount, 4);
      assertEqual('opt 收敛', s.optConverged, true);
      assert(s.energyStepCount >= 3, '能量曲线步数 >=3', '>=3', s.energyStepCount);
      assertEqual('频率数', s.frequencyCount, 3);
      assertEqual('freqFrameIndex 与 Node 一致', s.freqFrameIndex, e.freqFrameIndex);
      assert(s.thermochemistry, '热化学应解析到', 'thermochemistry', s.thermochemistry);
      const tc = s.thermochemistry, etc = e.thermochemistry;
      const tcFields = [['temperature', 1e-6], ['pressure', 1e-6], ['zpe', 1e-9], ['thermalEnergy', 1e-9],
        ['thermalEnthalpy', 1e-9], ['thermalGibbs', 1e-9], ['sumZpe', 1e-9], ['sumEnergy', 1e-9],
        ['sumEnthalpy', 1e-9], ['sumGibbs', 1e-9]];
      for (const [key, tol] of tcFields) assertClose('thermochemistry.' + key, tc[key], etc[key], tol);
      assertEqual('频率列表长度', s.frequencies.length, 3);
      for (let i = 0; i < 3; i++) {
        const got = s.frequencies[i], want = e.frequencies[i];
        assertClose('mode#' + (i + 1) + ' frequency', got.frequency, want.frequency, 1e-3);
        assertEqual('mode#' + (i + 1) + ' displacementCount', got.displacementCount, 3);
      }
      if (obs.api.resultsState) {
        assertEqual('resultsState.available', obs.api.resultsState.available, true);
        assertEqual('resultsState.frequencyCount', obs.api.resultsState.frequencyCount, 3);
        assertEqual('resultsState.hasFrequencies', obs.api.resultsState.hasFrequencies, true);
        assertEqual('resultsState.hasOptimization', obs.api.resultsState.hasOptimization, true);
        assertEqual('resultsState.hasThermochemistry', obs.api.resultsState.hasThermochemistry, true);
        assertClose('resultsState.finalEnergy', obs.api.resultsState.finalEnergy, e.finalEnergy, 1e-9);
      }
      // log-dev 提供的 fixture 已知数值（tests/fixtures/water-opt-freq.log），与 gausslog 单测一致
      const KNOWN = {
        finalEnergy: -76.4093345678,
        optEnergies: [-76.4088123456, -76.4091234567, -76.4093123456, -76.4093345678],
        frequencies: [1600.1234, 3800.5678, 3900.1111],
        irIntensities: [12.3456, 45.6789, 67.8901],
        zpe: 0.021241, temperature: 298.15, pressure: 1.0, freqFrameIndex: 4
      };
      obs.known = KNOWN;
      assertClose('已知 finalEnergy', s.finalEnergy, KNOWN.finalEnergy, 1e-9);
      assertEqual('已知 opt 步数', s.optStepCount, KNOWN.optEnergies.length);
      for (let i = 0; i < KNOWN.optEnergies.length; i++) {
        assertClose('已知 optStep[' + i + '].energy', obs.api.summary.optEnergies[i], KNOWN.optEnergies[i], 1e-6);
      }
      assertEqual('已知 freqFrameIndex', s.freqFrameIndex, KNOWN.freqFrameIndex);
      assertClose('已知 ZPE', tc.zpe, KNOWN.zpe, 1e-9);
      assertClose('已知 Temperature', tc.temperature, KNOWN.temperature, 1e-6);
      assertClose('已知 Pressure', tc.pressure, KNOWN.pressure, 1e-6);
      for (let i = 0; i < 3; i++) {
        assertClose('已知 frequency[' + i + ']', s.frequencies[i].frequency, KNOWN.frequencies[i], 1e-3);
        assertClose('已知 IR[' + i + ']', s.frequencies[i].irIntensity, KNOWN.irIntensities[i], 1e-3);
      }
      return obs;
    });

  await testCase('results-auto-tab', 'opt+freq log 加载后 #tab-results 可用并自动切到 Results 页（results-content 可见）',
    async (obs) => {
      obs.load = await loadOptFreqInPage();
      obs.dom = await resultsDomSnapshot();
      await page.wait(150);
      obs.dom = await resultsDomSnapshot();
      obs.state = await page.eval('MolApp.getResultsState()');
      assertEqual('tab-results 禁用', obs.dom.tabResultsDisabled, false);
      assertEqual('results 页隐藏', obs.dom.resultsPageHidden, false);
      assertEqual('tab-results 激活', obs.dom.tabResultsActive, true);
      assertEqual('tab-molecule 激活', obs.dom.tabMoleculeActive, false);
      assertEqual('results-empty 隐藏', obs.dom.resultsEmptyHidden, true);
      assertEqual('results-content 可见', obs.dom.resultsContentHidden, false);
      assertEqual('resultsState.activeTab', obs.state.activeTab, 'results');
      assertEqual('aria-selected(results)', await page.eval('document.getElementById("tab-results").getAttribute("aria-selected")'), 'true');
      assertEqual('aria-selected(molecule)', await page.eval('document.getElementById("tab-molecule").getAttribute("aria-selected")'), 'false');
      return obs;
    });

  await testCase('results-summary-dom', '结果面板概要表 17 个 data-field 行齐全，能量/热化学数值与解析结果一致',
    async (obs) => {
      obs.expected = expectedOptFreqResults();
      obs.exp = obs.expected.results;
      await loadOptFreqInPage();
      obs.dom = await resultsDomSnapshot();
      for (const field of SUMMARY_FIELDS) assert(obs.dom.summaryFields.indexOf(field) !== -1, '缺少 data-field 行: ' + field, field, obs.dom.summaryFields);
      const s = obs.exp.summary;
      assertEqual('natoms 行', num(obs.dom.summary['natoms']), 3);
      assertEqual('charge 行', num(obs.dom.summary['charge']), s.charge);
      assertEqual('multiplicity 行', num(obs.dom.summary['multiplicity']), s.multiplicity);
      assertClose('final-energy 行', num(obs.dom.summary['final-energy']), s.finalEnergy, 1e-5);
      assertEqual('termination 行非空且非占位', String(obs.dom.summary['termination'] || '').trim().length > 0 &&
        String(obs.dom.summary['termination']).trim() !== '—', true);
      assertEqual('optimization 行非空且非占位', String(obs.dom.summary['optimization'] || '').trim().length > 0 &&
        String(obs.dom.summary['optimization']).trim() !== '—', true);
      assertClose('temperature 行', num(obs.dom.summary['temperature']), s.thermochemistry.temperature, 0.01);
      assertClose('pressure 行', num(obs.dom.summary['pressure']), s.thermochemistry.pressure, 0.01);
      const tcRows = [['zpe', 'zeroPointCorrection'], ['thermal-energy', 'thermalCorrectionEnergy'],
        ['thermal-enthalpy', 'thermalCorrectionEnthalpy'], ['thermal-gibbs', 'thermalCorrectionGibbs'],
        ['sum-zpe', 'sumElectronicZeroPoint'], ['sum-energy', 'sumElectronicThermal'],
        ['sum-enthalpy', 'sumElectronicEnthalpy'], ['sum-gibbs', 'sumElectronicGibbs']];
      for (const [row, key] of tcRows) assertClose('热化学行 ' + row, num(obs.dom.summary[row]), s.thermochemistry[key], 1e-4);
      return obs;
    });

  await testCase('results-charts-nonblank', '能量曲线与收敛曲线 canvas 尺寸正常且非空白（像素启发式 + 多颜色）',
    async (obs) => {
      await loadOptFreqInPage();
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(300);
      await forceFrame();
      obs.energy = await chartStats('#results-energy-canvas');
      obs.conv = await chartStats('#results-conv-canvas');
      obs.dom = await resultsDomSnapshot();
      for (const [label, st] of [['energy', obs.energy], ['conv', obs.conv]]) {
        assert(!!st, label + ' canvas 应存在', 'canvas stats', st);
        assert(st.w >= 100 && st.h >= 60, label + ' canvas 像素尺寸', '>=100x60', st);
        assert(st.cssW > 80 && st.cssH > 40, label + ' canvas CSS 尺寸', '>80x40', { cssW: st.cssW, cssH: st.cssH });
        assert(st.nonWhite >= 150, label + ' canvas 非空白像素数', '>=150', st.nonWhite);
        assert(st.colorKinds >= 2, label + ' canvas 颜色数', '>=2', st.colorKinds);
      }
      assertEqual('energy section 未隐藏', obs.dom.energySectionHidden, false);
      assertEqual('conv section 未隐藏', obs.dom.convSectionHidden, false);
      return obs;
    });

  await testCase('results-freq-list', '频率列表 3 行，模式号/频率/IR 与解析一致；播放控件与振幅滑块默认值存在',
    async (obs) => {
      obs.expected = expectedOptFreqResults();
      obs.exp = obs.expected.results;
      await loadOptFreqInPage();
      obs.dom = await resultsDomSnapshot();
      assertEqual('频率行数', obs.dom.freqRows.length, 3);
      for (let i = 0; i < 3; i++) {
        const row = obs.dom.freqRows[i], want = obs.exp.summary.frequencies[i];
        assertEqual('row#' + i + ' data-mode-index', row.modeIndex, String(i));
        assertClose('row#' + i + ' 频率值', num(row.value), want.frequency, 1);
        assertEqual('row#' + i + ' 虚频标记', row.imaginary, false);
        assert(num(row.ir) !== null || row.ir === '—', 'row#' + i + ' IR 值或占位', want.irIntensity, row.ir);
      }
      assert(obs.dom.playText && obs.dom.playText.length > 0, '播放按钮文案非空', 'non-empty', obs.dom.playText);
      assert(obs.dom.stopText && obs.dom.stopText.length > 0, '停止按钮文案非空', 'non-empty', obs.dom.stopText);
      assertEqual('振幅滑块默认值', obs.dom.amplitudeValue, '50');
      return obs;
    });

  /* ====================== v2-C. 频率振动动画（§5/§6.2/§8.3） ====================== */
  await testCase('freq-play-animation', 'playFrequency(0)：animating=true、视口位移动画进行（画布像素随时间变化）、分子数据不被修改',
    async (obs) => {
      await loadOptFreqInPage();
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(200);
      // playFrequency 会先按契约 onRequestFrame(freqFrameIndex) 切帧，因此先在 Node 侧把帧切到
      // freqFrameIndex，再记录基线（避免把“切帧”误判为“动画修改分子数据”）。
      obs.freqFrameIndex = (await page.eval('MolApp.getResultsState()')).freqFrameIndex;
      if (obs.freqFrameIndex != null) {
        await page.eval('MolApp.setDatasetIndex(' + JSON.stringify(obs.freqFrameIndex) + ')');
        await page.wait(300);
      }
      obs.baselineAtoms = await page.eval('[0,1,2].map(function(i){var a=MolApp.getAtom(i);return [a.x,a.y,a.z];})');
      animationBaselineHash = await canvasHash();
      await page.eval('MolApp.playFrequency(0)');
      await page.wait(220);
      obs.anim1 = await page.eval('MolApp.getFrequencyAnimationState()');
      await page.wait(260);
      obs.hashA = await canvasHash();
      obs.atomsDuring1 = await page.eval('[0,1,2].map(function(i){var a=MolApp.getAtom(i);return [a.x,a.y,a.z];})');
      await page.wait(320);
      obs.hashB = await canvasHash();
      obs.atomsDuring2 = await page.eval('[0,1,2].map(function(i){var a=MolApp.getAtom(i);return [a.x,a.y,a.z];})');
      obs.resultsState = await page.eval('MolApp.getResultsState()');
      obs.framesState = await page.eval('({datasetIndex:MolApp.getState().datasetIndex,datasetCount:MolApp.getState().datasetCount})');
      assertEqual('animating', obs.anim1.animating, true);
      assertEqual('selectedMode', obs.anim1.selectedMode, 0);
      assertIn('amplitude 默认 50 附近', obs.anim1.amplitude, 10, 100);
      assertEqual('播放后所在帧 = freqFrameIndex', obs.framesState.datasetIndex, obs.freqFrameIndex);
      assert(obs.hashA !== animationBaselineHash, '播放中视口画面应变化（位移生效）', 'changed', { baseline: animationBaselineHash, during: obs.hashA });
      assert(obs.hashB !== obs.hashA, '动画应持续变化（两次采样不同）', 'moving', { a: obs.hashA, b: obs.hashB });
      assertEqual('动画不修改分子坐标（同帧内两次读取一致）', JSON.stringify(obs.atomsDuring2), JSON.stringify(obs.atomsDuring1));
      assertEqual('动画不修改分子坐标（与播放前基线一致）', JSON.stringify(obs.atomsDuring2), JSON.stringify(obs.baselineAtoms));
      assertEqual('resultsState.animating', obs.resultsState.animating, true);
      return obs;
    });

  await testCase('freq-stop-restores', 'stopFrequencyAnimation()：animating=false，视口恢复播放前画面（位移清除）',
    async (obs) => {
      assert(animationBaselineHash !== null, '前置：freq-play-animation 已记录基线', 'baseline set', animationBaselineHash);
      await page.eval('MolApp.stopFrequencyAnimation()');
      await page.wait(300);
      obs.state = await page.eval('MolApp.getFrequencyAnimationState()');
      obs.hashAfterStop = await canvasHash();
      obs.resultsState = await page.eval('MolApp.getResultsState()');
      assertEqual('animating', obs.state.animating, false);
      assertEqual('resultsState.animating', obs.resultsState.animating, false);
      assertEqual('停止后画面恢复基线', obs.hashAfterStop, animationBaselineHash);
      return obs;
    });

  await testCase('freq-amplitude', 'setFrequencyAmplitude 生效（100/10），振幅变化驱动视口动画；播放中可调',
    async (obs) => {
      await loadOptFreqInPage();
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(200);
      obs.set100 = await page.eval('(function(){MolApp.setFrequencyAmplitude(100);return MolApp.getFrequencyAnimationState();})()');
      assertEqual('amplitude=100', obs.set100.amplitude, 100);
      await page.eval('MolApp.playFrequency(1)');
      await page.wait(250);
      obs.hash1 = await canvasHash();
      await page.wait(300);
      obs.hash2 = await canvasHash();
      obs.set10 = await page.eval('(function(){MolApp.setFrequencyAmplitude(10);return MolApp.getFrequencyAnimationState();})()');
      assertEqual('amplitude=10（播放中实时生效）', obs.set10.amplitude, 10);
      await page.wait(220);
      obs.hash3 = await canvasHash();
      await page.wait(260);
      obs.hash4 = await canvasHash();
      assert(obs.hash1 !== obs.hash2, '播放中画面持续变化', 'moving', { h1: obs.hash1, h2: obs.hash2 });
      assert(obs.hash3 !== obs.hash2 || obs.hash4 !== obs.hash3, '调整振幅后画面继续变化（实时生效）', 'changed', { h2: obs.hash2, h3: obs.hash3, h4: obs.hash4 });
      await page.eval('MolApp.stopFrequencyAnimation()');
      return obs;
    });

  await testCase('freq-frame-index', 'freqFrameIndex 与解析一致；playFrequency 会先切到该帧（onRequestFrame 生效）',
    async (obs) => {
      obs.expected = expectedOptFreqResults();
      obs.exp = obs.expected.results;
      await loadOptFreqInPage();
      obs.api = await resultsApiSnapshot();
      obs.datasetCount = (await page.eval('MolApp.getState()')).datasetCount;
      assertEqual('getResultsState().freqFrameIndex', obs.api.resultsState.freqFrameIndex, obs.exp.summary.freqFrameIndex);
      assertEqual('已知 freqFrameIndex=4', obs.api.resultsState.freqFrameIndex, 4);
      assert(obs.datasetCount >= 5, '全局 orientation 帧数应 >=5（freqFrameIndex=4）', '>=5', obs.datasetCount);
      if (obs.exp.summary.freqFrameIndex != null) {
        await page.eval('MolApp.setDatasetIndex(0)');
        await page.eval('MolApp.playFrequency(0)');
        await page.wait(400);
        obs.after = await page.eval('(function(){return {datasetIndex:MolApp.getState().datasetIndex, anim:MolApp.getFrequencyAnimationState()};})()');
        assertEqual('播放时自动切到 freqFrameIndex 帧', obs.after.datasetIndex, obs.exp.summary.freqFrameIndex);
        assertEqual('切帧后动画运行', obs.after.anim.animating, true);
        await page.eval('MolApp.stopFrequencyAnimation()');
      } else {
        obs.note = 'fixture 无 Standard orientation 帧，freqFrameIndex 为 null（按契约不要求切帧）';
      }
      return obs;
    });

  await testCase('results-tab-switch', 'setSideTab 切换 molecule/results：aria/显隐正确；播放中隐藏 Results → 硬停止+清空位移+视口恢复基线+保留 selectedMode；切回不自动恢复动画',
    async (obs) => {
      await loadOptFreqInPage();
      await page.eval('MolApp.setSideTab("results")');
      obs.freqFrame = (await page.eval('MolApp.getResultsState()')).freqFrameIndex;
      if (obs.freqFrame != null) {
        await page.eval('MolApp.setDatasetIndex(' + JSON.stringify(obs.freqFrame) + ')');
        await page.wait(300);
      }
      obs.baselineHash = await canvasHash();
      await page.eval('MolApp.playFrequency(0)');
      await page.wait(220);
      await forceFrame();
      await page.wait(120);
      await forceFrame();
      obs.animDuring = await page.eval('MolApp.getFrequencyAnimationState()');
      obs.hashDuring = await canvasHash();
      // 播放中把 Results 页隐藏 → 按契约硬停止并清空视口位移
      await page.eval('MolApp.setSideTab("molecule")');
      await page.wait(350);
      obs.dom = await resultsDomSnapshot();
      obs.animAfterHide = await page.eval('MolApp.getFrequencyAnimationState()');
      obs.stateAfterHide = await page.eval('MolApp.getResultsState()');
      obs.hashAfterHide = await canvasHash();
      obs.ariaAfterHide = await page.eval('({molecule:document.getElementById("tab-molecule").getAttribute("aria-selected"),results:document.getElementById("tab-results").getAttribute("aria-selected")})');
      // 切回 Results：不应自动恢复动画
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(350);
      obs.animAfterBack = await page.eval('MolApp.getFrequencyAnimationState()');
      obs.back = await resultsDomSnapshot();
      obs.ariaAfterBack = await page.eval('({molecule:document.getElementById("tab-molecule").getAttribute("aria-selected"),results:document.getElementById("tab-results").getAttribute("aria-selected")})');
      assertEqual('播放中 animating', obs.animDuring.animating, true);
      assert(obs.hashDuring !== obs.baselineHash, '播放中视口应有位移（像素变化）', 'changed', { base: obs.baselineHash, during: obs.hashDuring });
      assertEqual('切到 molecule 后 results 页隐藏', obs.dom.resultsPageHidden, true);
      assertEqual('切到 molecule 后 molecule 页可见', obs.dom.moleculePageHidden, false);
      assertEqual('tab-molecule 激活', obs.dom.tabMoleculeActive, true);
      assertEqual('隐藏时 aria-selected(molecule)', obs.ariaAfterHide.molecule, 'true');
      assertEqual('隐藏时 aria-selected(results)', obs.ariaAfterHide.results, 'false');
      assertEqual('resultsState.activeTab', obs.stateAfterHide.activeTab, 'molecule');
      assertEqual('隐藏 results 页后动画停止', obs.animAfterHide.animating, false);
      assertEqual('隐藏 results 页时硬停止（paused=false）', obs.animAfterHide.paused, false);
      assertEqual('隐藏后保留 selectedMode', obs.animAfterHide.selectedMode, 0);
      assertEqual('隐藏后视口位移清空（画面恢复播放前基线）', obs.hashAfterHide, obs.baselineHash);
      assertEqual('切回 Results 不自动恢复动画', obs.animAfterBack.animating, false);
      assertEqual('切回 Results 后 selectedMode 仍保留', obs.animAfterBack.selectedMode, 0);
      assertEqual('切回 results 后页面可见', obs.back.resultsPageHidden, false);
      assertEqual('切回后 aria-selected(results)', obs.ariaAfterBack.results, 'true');
      assertEqual('切回后 aria-selected(molecule)', obs.ariaAfterBack.molecule, 'false');
      return obs;
    });

  await testCase('results-language-refresh', '结果面板语言切换：EN 无 CJK 残留；ZH 文案中文化；数值不变',
    async (obs) => {
      await loadOptFreqInPage();
      await page.eval('MolApp.setSideTab("results")');
      await setLang('en');
      await page.wait(250);
      obs.enViolations = await cjkViolations(['#results-panel'], CJK_ALLOWED_SELECTORS);
      obs.enDom = await resultsDomSnapshot();
      await setLang('zh');
      await page.wait(250);
      obs.zhDom = await resultsDomSnapshot();
      obs.zhCjk = cjkCount(obs.zhDom.panelText);
      assertEqual('EN 结果面板 CJK 违规数', obs.enViolations.length, 0);
      assert(obs.zhCjk > 0, 'ZH 结果面板应出现中文文案', 'CJK>0', obs.zhCjk);
      assertEqual('语言切换后 final-energy 数值不变',
        num(obs.enDom.summary['final-energy']), num(obs.zhDom.summary['final-energy']));
      assertEqual('语言切换后频率行数不变', obs.enDom.freqRows.length, obs.zhDom.freqRows.length);
      return obs;
    });

  /* ====================== v2-D. 普通 log / 非 log 的 results 行为 ====================== */
  await testCase('log-plain-results-water', '普通 water.log：results 可用（有单点能/能量数据），无频率/收敛/热化学，不自动切 results tab',
    async (obs) => {
      const src = readFirstExisting(['samples/water.log']);
      assert(!!src, '缺少 samples/water.log', 'exists', src);
      const G = nodeGaussLog();
      assert(!!G, 'js/gausslog.js 未就绪', 'MolGaussLog', G);
      obs.expected = G.parse(src.text);
      obs.load = await loadTextFile('water.log');
      obs.api = await resultsApiSnapshot();
      obs.state = await page.eval('MolApp.getResultsState()');
      obs.dom = await resultsDomSnapshot();
      assertEqual('hasLogResults', obs.load.hasLogResults, true);
      assertEqual('hasFrequencies', obs.load.hasFrequencies, false);
      assertEqual('frequencyCount', obs.load.frequencyCount, 0);
      assertEqual('results 可用', obs.state.available, true);
      assertEqual('tab-results 可用（不禁用）', obs.dom.tabResultsDisabled, false);
      assertEqual('不自动切 results（activeTab）', obs.state.activeTab, 'molecule');
      assertEqual('results 页隐藏', obs.dom.resultsPageHidden, true);
      assertClose('finalEnergy 与解析一致', obs.api.summary.finalEnergy, obs.expected.summary.finalEnergy, 1e-9);
      assertClose('DOM final-energy 行', num(obs.dom.summary['final-energy']), obs.expected.summary.finalEnergy, 1e-4);
      assertEqual('无频率行', obs.dom.freqRows.length, 0);
      return obs;
    });

  await testCase('xyz-results-disabled', '加载 xyz：results 不可用、#tab-results 禁用、回到 molecule tab、getLogResults()=null',
    async (obs) => {
      await loadTextFile('water.xyz');
      obs.state = await page.eval('MolApp.getResultsState()');
      obs.dom = await resultsDomSnapshot();
      obs.logResults = await page.eval('MolApp.getLogResults()');
      assertEqual('results.available', obs.state.available, false);
      assertEqual('frequencyCount', obs.state.frequencyCount, 0);
      assertEqual('tab-results 禁用', obs.dom.tabResultsDisabled, true);
      assertEqual('activeTab', obs.state.activeTab, 'molecule');
      assertEqual('results 页隐藏', obs.dom.resultsPageHidden, true);
      assertEqual('getLogResults() 为 null', obs.logResults, null);
      return obs;
    });

  await testCase('sample-opt-freq', '示例库新增 water-opt-freq：nameEn 存在；loadSample 后结果面板可用；EN/ZH 示例名切换正确',
    async (obs) => {
      obs.samples = await page.eval('MolApp.listSamples()');
      obs.sample = obs.samples.find((s) => s.key === 'water-opt-freq');
      assert(!!obs.sample, '示例库缺少 water-opt-freq', 'exists', obs.samples.map((s) => s.key));
      assertEqual('format', obs.sample.format, 'log');
      assert(!!obs.sample.nameEn && obs.sample.nameEn.length > 0, 'water-opt-freq 应有 nameEn', 'non-empty', obs.sample);
      assertEqual('EN 下示例名无 CJK', cjkCount(obs.sample.nameEn), 0);
      await page.eval('MolApp.loadSample("water-opt-freq")');
      await page.wait(300);
      obs.state = await page.eval('MolApp.getResultsState()');
      assertEqual('loadSample 后 results 可用', obs.state.available, true);
      assertEqual('loadSample 后频率数', obs.state.frequencyCount, 3);
      obs.zhNames = await page.eval('(function(){var s=document.getElementById("sample-select");var o=s.options[[].findIndex.call(s.options,function(x){return x.value==="water-opt-freq";})];return o?o.textContent.trim():null;})()');
      await setLang('en');
      obs.enNames = await page.eval('(function(){var s=document.getElementById("sample-select");var o=s.options[[].findIndex.call(s.options,function(x){return x.value==="water-opt-freq";})];return o?o.textContent.trim():null;})()');
      assert(cjkCount(obs.zhNames) > 0, 'ZH 示例名应中文', 'CJK>0', obs.zhNames);
      assertEqual('EN 示例名无 CJK', cjkCount(obs.enNames), 0);
      await setLang('zh');
      return obs;
    });

  /* ====================== v2-E. Linux/macOS 跨平台静态检查（§10/§11.3#7） ====================== */
  await testCase('portability-files', '跨平台脚本存在、无 CRLF、以 LF 结尾、bash shebang、含关键分支命令、ASCII 文件名',
    async (obs) => {
      obs.snapshot = portabilitySnapshot();
      const missing = obs.snapshot.filter((s) => !s.exists).map((s) => s.file);
      assertEqual('缺失脚本数', missing.length, 0);
      for (const item of obs.snapshot) {
        assert(item.bytes > 50, item.file + ' 内容过短', '>50B', item.bytes);
        assertEqual(item.file + ' 无 CRLF', item.hasCR, false);
        assertMatch(item.file + ' shebang', item.firstLine, /^#!.*bash/);
        assertEqual(item.file + ' 以换行结尾', item.endsWithNewline, true);
        assertEqual(item.file + ' 缺少关键片段', JSON.stringify(item.missingFragments), '[]');
        assertEqual(item.file + ' 文件名为 ASCII', /^[\x20-\x7e]+$/.test(item.file), true);
      }
      return obs;
    });

  await testCase('portability-readme', 'README 含 Linux/macOS 启动说明（launch.sh / chmod +x / macOS / MolEdit.command）',
    async (obs) => {
      const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
      obs.bytes = readme.length;
      obs.missing = ['launch.sh', 'Linux', 'macOS', 'chmod +x', 'MolEdit.command'].filter((k) => readme.indexOf(k) === -1);
      assert(obs.bytes > 2000, 'README 过短', '>2000', obs.bytes);
      assertEqual('README 缺少的关键词', JSON.stringify(obs.missing), '[]');
      return obs;
    });

  await testCase('portability-bash-syntax', '有 bash 时对 launch.sh/start-server.sh/MolEdit.command/desktop-shortcut.sh 执行 bash -n；无 bash 或沙箱限制则记 SKIP',
    async (obs) => {
      obs.check = bashSyntaxCheck(PORTABILITY_FILES.map((f) => f.file));
      obs.skipped = false;
      if (!obs.check.available) {
        obs.skipped = true;
        obs.skipReason = '本机/沙箱无可用 bash（Lead 会用 escalated 运行 tests/portability.test.mjs 覆盖 bash -n）';
        return obs;
      }
      const all = obs.check.results;
      if (all.length && all.every((r) => r.status === 'unavailable')) {
        obs.skipped = true;
        obs.skipReason = 'bash 可执行但子进程受限（沙箱命名管道 EPERM），记 SKIP，由 Lead portability.test.mjs 覆盖';
        return obs;
      }
      const bad = all.filter((r) => r.status !== 'ok');
      assertEqual('bash -n 失败脚本数', bad.length, 0);
      return obs;
    });

  /* ====================== v2-F. 关键截图（EN/ZH 主界面、结果面板 EN/ZH） ====================== */
  await testCase('screenshots-main-en-zh', 'EN 主界面与 ZH 主界面截图（含分子渲染），并核对 EN 界面 CJK 扫描',
    async (obs) => {
      await loadTextFile('water.xyz');
      await setLang('en');
      await page.wait(250);
      obs.enPath = await shot('e2e-en-main.png');
      obs.enViolations = await cjkViolations(['#topbar', '#toolbar', '#sidepanel', '#statusbar'], CJK_ALLOWED_SELECTORS);
      await setLang('zh');
      await page.wait(250);
      obs.zhPath = await shot('e2e-zh-main.png');
      obs.zhStatus = cjkCount((await i18nSnapshot()).status);
      assertEqual('EN 主界面 CJK 违规数', obs.enViolations.length, 0);
      assert(obs.zhStatus > 0, 'ZH 主界面状态栏应为中文', 'CJK>0', obs.zhStatus);
      return obs;
    });

  await testCase('screenshots-results-en-zh', '结果面板 EN/ZH 截图（含图表与频率列表），EN 面板无 CJK 残留',
    async (obs) => {
      await loadOptFreqInPage();
      await setLang('en');
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(300);
      obs.enPath = await shot('e2e-results-en.png');
      obs.enViolations = await cjkViolations(['#results-panel'], CJK_ALLOWED_SELECTORS);
      assertEqual('EN 结果面板 CJK 违规数', obs.enViolations.length, 0);
      await setLang('zh');
      await page.wait(300);
      obs.zhPath = await shot('e2e-results-zh.png');
      return obs;
    });

  await testCase('screenshots-freq-list-and-anim', '结果面板滚动到底：频率列表+播放/停止/振幅控件截图（EN/ZH）；100% 振幅动画播放中位移清晰截图',
    async (obs) => {
      await loadOptFreqInPage();
      await setLang('en');
      await page.eval('MolApp.setSideTab("results")');
      await page.wait(300);
      obs.scroll = await page.eval('(function(){var sp=document.getElementById("sidepanel");var pg=document.getElementById("tab-page-results");' +
        'if(pg)pg.scrollTop=pg.scrollHeight;if(sp)sp.scrollTop=sp.scrollHeight;' +
        'return {page:pg?pg.scrollTop:null,panel:sp?sp.scrollTop:null,pageH:pg?pg.scrollHeight:null};})()');
      await page.wait(300);
      await page.eval('MolApp.setFrequencyAmplitude(50)');
      await page.wait(120);
      obs.enPath = await shot('e2e-results-freq-en.png');
      obs.enRows = (await resultsDomSnapshot()).freqRows;
      obs.ampValue = (await resultsDomSnapshot()).amplitudeValue;
      await setLang('zh');
      await page.wait(250);
      await page.eval('(function(){var sp=document.getElementById("sidepanel");var pg=document.getElementById("tab-page-results");' +
        'if(pg)pg.scrollTop=pg.scrollHeight;if(sp)sp.scrollTop=sp.scrollHeight;return true;})()');
      await page.wait(250);
      obs.zhPath = await shot('e2e-results-freq-zh.png');
      // 动画截图：100% 振幅 + 强制合成帧推进相位（headless 下 rAF 只在合成帧时触发），保证位移可见
      await page.eval('(function(){var sp=document.getElementById("sidepanel");var pg=document.getElementById("tab-page-results");' +
        'if(pg)pg.scrollTop=0;if(sp)sp.scrollTop=0;return true;})()');
      await page.eval('MolApp.setFrequencyAmplitude(100)');
      obs.resultsState = await page.eval('MolApp.getResultsState()');
      if (obs.resultsState.freqFrameIndex != null) {
        await page.eval('MolApp.setDatasetIndex(' + JSON.stringify(obs.resultsState.freqFrameIndex) + ')');
        await page.wait(300);
      }
      obs.baselineHash = await canvasHash();
      // 采样基线像素，用于挑选“明显相位”的动画帧截图（headless 下 rAF 需强制合成帧才推进）
      await page.eval('(function(){var c=document.getElementById("viewport-canvas");var d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;' +
        'var a=[];for(var i=0;i<d.length;i+=97)a.push(d[i]);window.__qaBase=a;return a.length;})()');
      await page.eval('MolApp.playFrequency(2)'); // 模式 3（3900.11 cm⁻¹）位移主要在屏幕平面内（H 原子 ±y），截图位移最直观
      obs.phaseDiff = 0;
      for (let i = 0; i < 12; i++) {
        await forceFrame();
        await page.wait(90);
        obs.phaseDiff = await page.eval('(function(){var c=document.getElementById("viewport-canvas");' +
          'var d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;var a=window.__qaBase;var diff=0,j=0;' +
          'for(var i=0;i<d.length;i+=97){if(d[i]!==a[j])diff++;j++;}return diff;})()');
        if (obs.phaseDiff > 1200) break;
      }
      obs.animPath = await shot('e2e-freq-anim.png');
      obs.hashDuring = await canvasHash();
      obs.animState = await page.eval('MolApp.getFrequencyAnimationState()');
      await page.eval('(function(){try{delete window.__qaBase;}catch(e){window.__qaBase=null;}return true;})()');
      await page.eval('MolApp.stopFrequencyAnimation()');
      await page.eval('MolApp.setFrequencyAmplitude(50)');
      if (obs.scroll) obs.scrolled = (obs.scroll.page > 0) || (obs.scroll.panel > 0);
      assert(obs.scrolled === true, '结果面板应可滚动（频率列表/控件在下方）', 'scrolled', obs.scroll);
      assertEqual('滚动后频率行数', obs.enRows.length, 3);
      assertEqual('振幅滑块存在', obs.ampValue, '50');
      assertEqual('动画播放中 animating', obs.animState.animating, true);
      assert(obs.hashDuring !== obs.baselineHash, '动画播放中视口位移生效（画面变化）', 'changed', { base: obs.baselineHash, during: obs.hashDuring });
      assert(obs.phaseDiff > 1200, '动画截图应处于明显位移相位（像素差异充分）', '>1200', obs.phaseDiff);
      return obs;
    });

  await testCase('i18n-final-en-scan', '最终 EN 模式全 chrome（含结果面板）无 CJK 残留；切回 en 后语言状态正确',
    async (obs) => {
      await setLang('en');
      await page.wait(200);
      obs.lang = await getLang();
      obs.violations = await cjkViolations(
        ['#topbar', '#toolbar', '#sidepanel', '#statusbar', '#empty-hint', '#mouse-hint', '#results-panel'],
        CJK_ALLOWED_SELECTORS
      );
      obs.titleCjk = cjkCount(await page.eval('document.title'));
      assertEqual('语言', obs.lang, 'en');
      assertEqual('document.title 无 CJK', obs.titleCjk, 0);
      assertEqual('全 chrome CJK 违规数', obs.violations.length, 0);
      return obs;
    });

  /* ========================== 19. 截图盘点 ========================== */
  await testCase('screenshots-inventory', '本轮生成的全部 e2e 截图存在且非空（>5KB）',
    async (obs) => {
      obs.expected = ['e2e-empty.png', 'e2e-xyz.png', 'e2e-sdf.png', 'e2e-gjf.png', 'e2e-log.png',
        'e2e-select.png', 'e2e-bondlength.png', 'e2e-angle.png', 'e2e-dihedral.png',
        'e2e-spacefill.png', 'e2e-wireframe.png', 'e2e-mouse-drag.png',
        // v2（INTERFACE2.md §11.3 #1/#2/#4/#5 证据）
        'e2e-en-main.png', 'e2e-zh-main.png', 'e2e-results-en.png', 'e2e-results-zh.png', 'e2e-freq-anim.png',
        'e2e-results-freq-en.png', 'e2e-results-freq-zh.png'];
      obs.missing = [];
      obs.small = [];
      for (const name of obs.expected) {
        const full = path.join(SHOTS_DIR, name);
        if (!fs.existsSync(full)) { obs.missing.push(name); continue; }
        if (fs.statSync(full).size < 5000) obs.small.push(name + ':' + fs.statSync(full).size);
      }
      assertEqual('缺失截图数', obs.missing.length, 0);
      assertEqual('过小截图数', obs.small.length, 0);
      obs.shots = shots.slice();
      return obs;
    });

  /* ========================== 20. 最终页面错误检查 ========================== */
  await testCase('page-errors-final', '整个测试过程无 Runtime 异常 / console.error / Log error',
    async (obs) => {
      obs.pageErrors = page.errors.slice();
      obs.consoleErrors = page.consoleErrors.slice();
      obs.lastError = await page.eval('MolApp.getLastError()');
      assertEqual('Runtime/Log 错误数', obs.pageErrors.length, 0);
      assertEqual('console.error 数', obs.consoleErrors.length, 0);
      assertEqual('getLastError', obs.lastError, null);
      return obs;
    });

  /* 收尾：恢复默认 en 并清除 localStorage 语言键，避免共用 Chrome 的其他成员页面
   * 因持久化语言为 zh 而抖动（Lead 提醒：file:// localStorage 跨 tab 共享）。 */
  try {
    await page.eval('MolApp.setLanguage("en")');
    await page.wait(150);
    await page.eval('localStorage.removeItem(MolI18n.STORAGE_KEY)');
  } catch (e) { /* 忽略收尾失败 */ }
}

/* ------------------------------ 报告输出 ------------------------------ */
function productSnapshot() {
  const files = ['index.html', 'css/app.css', 'js/core.js', 'js/parsers.js', 'js/renderer.js',
    'js/samples.js', 'js/ui.js', 'INTERFACE.md', 'INTERFACE2.md',
    // v2 新增模块
    'js/i18n.js', 'js/gausslog.js', 'js/charts.js', 'js/results.js', 'css/results.css',
    'tests/fixtures/water-opt-freq.log',
    // Linux/macOS 跨平台交付
    'launch.sh', 'MolEdit.command', 'start-server.sh', 'tools/create-linux-desktop-shortcut.sh', 'README.md'];
  const out = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    try {
      const buf = fs.readFileSync(full);
      out[f] = {
        bytes: buf.length,
        md5: crypto.createHash('md5').update(buf).digest('hex'),
        mtime: fs.statSync(full).mtime.toISOString()
      };
    } catch (e) {
      out[f] = { error: String((e && e.message) || e) };
    }
  }
  return out;
}

function writeReport(fatalError) {
  const total = cases.length;
  const passed = cases.filter((c) => c.pass).length;
  const failed = total - passed;
  const skipped = cases.filter((c) => c.pass && c.actual && c.actual.skipped === true).length;
  const pageErrors = page ? page.errors.slice() : [];
  const consoleErrors = page ? page.consoleErrors.slice() : [];
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node tests/e2e.mjs（工作目录 moledit/）',
    pageUrl: PAGE_URL,
    viewport: VIEW,
    cdp: 'headless Chrome @ 127.0.0.1:9222 (tools/cdp.mjs, 缓存已禁用)',
    i18n: { defaultLang: 'en', testedLangs: ['en', 'zh'], cjkScan: 'EN chrome UI（豁免 #lang-toggle/#error-banner/#mol-title/#selection-list/#results-freq-note）' },
    environment: {
      node: process.version,
      platform: process.platform,
      durationMs: Date.now() - startedAt
    },
    product: productSnapshot(),
    summary: {
      total: total,
      passed: passed,
      failed: failed,
      skipped: skipped,
      pageErrorCount: pageErrors.length,
      consoleErrorCount: consoleErrors.length,
      fatalError: fatalError ? String(fatalError) : null
    },
    cases: cases,
    screenshots: shots,
    // 视觉质检结论由人工 read_image 检查后写入（tests/qa-visual.mjs）；
    // 重跑 e2e 时保留上一份 report 的 visualQA，避免人工结论被覆盖。
    visualQA: (prevReport && prevReport.visualQA) ? prevReport.visualQA : []
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

let fatalError = null;
try {
  await main();
} catch (e) {
  fatalError = (e && e.message) || String(e);
  console.error('\n[致命错误] ' + fatalError);
  if (e && e.stack) console.error(e.stack);
} finally {
  if (page) { try { await page.close(); } catch { /* 忽略 */ } }
}

const report = writeReport(fatalError);
console.log('\n================ E2E 结果（v2） ================');
console.log('用例: ' + report.summary.total + '  通过: ' + report.summary.passed +
  '  失败: ' + report.summary.failed +
  '  SKIP: ' + report.summary.skipped +
  '  页面错误: ' + report.summary.pageErrorCount +
  '  console.error: ' + report.summary.consoleErrorCount);
if (report.summary.failed > 0) {
  console.log('\n失败明细:');
  for (const c of cases.filter((x) => !x.pass)) {
    console.log('  ❌ ' + c.case + '：' + c.error);
  }
}
const skippedCases = cases.filter((c) => c.pass && c.actual && c.actual.skipped === true);
if (skippedCases.length) {
  console.log('\nSKIP 明细:');
  for (const c of skippedCases) console.log('  ⏭ ' + c.case + '：' + (c.actual.skipReason || '环境限制'));
}
console.log('截图 ' + report.screenshots.length + ' 张 → ' + path.join('screenshots', '*.png'));
console.log('报告 → ' + REPORT_PATH);
if (report.summary.pageErrorCount) {
  console.log('页面错误:');
  for (const e of page ? page.errors : []) console.log('  [' + e.type + '] ' + e.text);
}
if (report.summary.consoleErrorCount) {
  console.log('console.error:');
  for (const e of page ? page.consoleErrors : []) console.log('  ' + e.text);
}
if (fatalError || report.summary.failed > 0) process.exitCode = 1;
