/* =============================================================================
 * ui-logic-smoke.mjs — 无浏览器环境下验证 js/ui.js 的逻辑（ui-dev 自测）
 *
 * 原理：极简 DOM shim + node:vm，按 INTERFACE.md §4 顺序在同一上下文加载
 *       core.js → parsers.js → renderer.js → samples.js → ui.js，
 *       然后直接调用 window.MolApp，覆盖加载/选择/测量/几何编辑/undo/导出/
 *       数据集/键盘/拖放/电荷/§8.2 DOM id/渲染器集成（投影、拾取、拖动原子）。
 * 用法：node tests/ui-logic-smoke.mjs（在 moledit/ 下）
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail != null ? '   [' + String(detail).slice(0, 160) + ']' : ''));
}
function approx(a, b, tol) { return typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ 极简 DOM ============================ */
const VOID_TAGS = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return String(this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(list) { this.el.setAttribute('class', list.join(' ')); }
  contains(name) { return this._get().indexOf(name) !== -1; }
  add(name) { const l = this._get(); if (l.indexOf(name) === -1) { l.push(name); this._set(l); } }
  remove(name) { this._set(this._get().filter((n) => n !== name)); }
  toggle(name, force) {
    const has = this.contains(name);
    const want = force == null ? !has : !!force;
    if (want && !has) this.add(name);
    if (!want && has) this.remove(name);
    return want;
  }
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.text = text; this.parentNode = null; this.children = []; }
  get textContent() { return this.text; }
  set textContent(v) { this.text = String(v); }
}

class Context2DStub {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1;
    this.lineCap = 'butt'; this.lineJoin = 'miter'; this.globalAlpha = 1;
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.shadowColor = 'transparent'; this.shadowBlur = 0; this.shadowOffsetX = 0; this.shadowOffsetY = 0;
  }
  save() {} restore() {} setTransform() {} clearRect() {} fillRect() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} fill() {} stroke() {}
  fillText() {} strokeText() {} setLineDash() {} translate() {} scale() {} rotate() {} clip() {}
  measureText(text) { return { width: String(text == null ? '' : text).length * 7 }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createLinearGradient() { return { addColorStop() {} }; }
}

class Element {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attributes = Object.create(null);
    this.style = {};
    this.classList = new ClassList(this);
    this._listeners = Object.create(null);
    this._text = null;
    this._hidden = false;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = null;
    this._id = '';
    this._ctx = null;
    this.width = 0;
    this.height = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
  }
  get id() { return this._id; }
  set id(v) { this._id = String(v); this.attributes.id = this._id; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', String(v)); }
  get hidden() { return this._hidden === true; }
  set hidden(v) {
    this._hidden = !!v;
    if (this._hidden) this.attributes.hidden = '';
    else delete this.attributes.hidden;
  }
  get textContent() {
    if (this._text != null) return this._text;
    return this.children.map((c) => String(c.textContent == null ? '' : c.textContent)).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this.textContent = String(v).replace(/<[^>]*>/g, ''); }
  get options() { return this.children.filter((c) => c instanceof Element && c.localName === 'option'); }
  get firstChild() { return this.children[0] || null; }
  appendChild(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
    this._text = null; // 与真实 DOM 一致：持有子节点后 textContent 由子节点拼接
    this.children.push(node);
    if (node) node.parentNode = this;
    return node;
  }
  removeChild(node) {
    this._text = null;
    const i = this.children.indexOf(node);
    if (i !== -1) this.children.splice(i, 1);
    if (node) node.parentNode = null;
    return node;
  }
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
    if (name === 'id') this._id = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this._hidden = true;
  }
  getAttribute(name) {
    const key = String(name);
    return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
  }
  removeAttribute(name) {
    delete this.attributes[String(name)];
    if (name === 'id') this._id = '';
    if (name === 'hidden') this._hidden = false;
    if (name === 'disabled') this.disabled = false;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, String(name)); }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }
  dispatchEvent(event) { return dispatch(event, this); }
  click() {
    const ev = new SimpleEvent('click', { bubbles: true });
    this.dispatchEvent(ev);
  }
  focus() { docActiveElement = this; }
  blur() { if (docActiveElement === this) docActiveElement = null; }
  getBoundingClientRect() {
    if (this.id === 'viewport-canvas' || this.id === 'viewport') {
      return { left: 62, top: 52, width: 1000, height: 760, right: 1062, bottom: 812 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
  contains(node) {
    let cur = node;
    while (cur) { if (cur === this) return true; cur = cur.parentNode; }
    return false;
  }
  querySelectorAll(selector) {
    const out = [];
    const selectors = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
    const walk = (el) => {
      for (const child of el.children) {
        if (!(child instanceof Element)) continue;
        if (selectors.some((sel) => matchSelector(child, sel))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }
  closest(selector) {
    let cur = this;
    while (cur && cur instanceof Element) {
      if (matchSelector(cur, selector)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  getContext() {
    if (!this._ctx) this._ctx = new Context2DStub(this);
    return this._ctx;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function matchCompound(el, compound) {
  if (!(el instanceof Element)) return false;
  let rest = String(compound).trim();
  const nots = [];
  rest = rest.replace(/:not\(\[([^\]]+)\]\)/g, (m, a) => { nots.push(a.trim()); return ''; });
  const ids = [];
  rest = rest.replace(/#([A-Za-z0-9_-]+)/g, (m, v) => { ids.push(v); return ''; });
  const classes = [];
  rest = rest.replace(/\.([A-Za-z0-9_-]+)/g, (m, v) => { classes.push(v); return ''; });
  const attrs = [];
  rest = rest.replace(/\[([^\]]+)\]/g, (m, v) => { attrs.push(v.trim()); return ''; });
  const tag = rest.trim().toLowerCase();
  if (tag && tag !== '*' && el.localName !== tag) return false;
  for (const id of ids) if (el.id !== id) return false;
  for (const cls of classes) if (!el.classList.contains(cls)) return false;
  for (const attr of attrs) {
    const name = attr.split('=')[0].trim();
    if (!el.hasAttribute(name)) return false;
  }
  for (const attr of nots) {
    const name = attr.split('=')[0].trim();
    if (el.hasAttribute(name)) return false;
  }
  return true;
}

function matchSelector(el, selector) {
  const parts = String(selector).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let anc = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = null;
    while (anc) {
      if (matchCompound(anc, parts[i])) { found = anc; break; }
      anc = anc.parentNode;
    }
    if (!found) return false;
    anc = found.parentNode;
  }
  return true;
}

class SimpleEvent {
  constructor(type, opts = {}) {
    this.bubbles = !!opts.bubbles;
    this.cancelable = opts.cancelable !== false;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.dataTransfer = opts.dataTransfer || null;
    this.shiftKey = false;
    this.ctrlKey = false;
    this.metaKey = false;
    this.key = '';
    this.clientX = 0;
    this.clientY = 0;
    this.button = 0;
    this.buttons = 0;
    this.pointerId = 1;
    this.deltaY = 0;
    Object.assign(this, opts);
    this.type = type;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._propagationStopped = true; }
}

let docActiveElement = null;
const windowListeners = Object.create(null);

function dispatch(event, target) {
  let stopped = false;
  const ev = event;
  ev.target = target;
  ev.currentTarget = target;
  ev.stopPropagation = function () { stopped = true; };
  const call = (node) => {
    const handlers = node && node._listeners && node._listeners[ev.type];
    if (!handlers) return;
    for (const h of handlers.slice()) {
      h.call(node, ev);
      if (stopped) break;
    }
  };
  let node = target;
  while (node && node !== document) {
    call(node);
    if (stopped) break;
    node = node.parentNode;
    ev.currentTarget = node;
  }
  if (!stopped) { ev.currentTarget = document; call(document); }
  if (!stopped && windowListeners[ev.type]) {
    ev.currentTarget = sandbox;
    for (const h of windowListeners[ev.type].slice()) {
      h.call(sandbox, ev);
      if (stopped) break;
    }
  }
  return !ev.defaultPrevented;
}

function parseHTML(html, doc) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHTML = bodyMatch ? bodyMatch[1] : html;
  const stack = [doc.body];
  const tagRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/gi;
  let m;
  while ((m = tagRe.exec(bodyHTML))) {
    if (m[0].startsWith('<!--') || /^<!DOCTYPE/i.test(m[0])) continue;
    if (m[1]) {
      const closeTag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].localName === closeTag) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = new Element(tag, doc);
      const attrText = m[3] || '';
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;
      let a;
      while ((a = attrRe.exec(attrText))) {
        if (a[1]) {
          const value = a[3] != null ? a[3] : (a[4] != null ? a[4] : a[5]);
          el.setAttribute(a[1], value);
        } else if (a[6]) {
          el.setAttribute(a[6], '');
        }
      }
      stack[stack.length - 1].appendChild(el);
      if (!VOID_TAGS.has(tag) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] != null) {
      if (m[5].trim()) stack[stack.length - 1].appendChild(new TextNode(m[5].replace(/\s+/g, ' ')));
    }
  }
}

/* ============================ 创建沙箱 ============================ */
const sandbox = Object.create(null);
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval;
sandbox.clearInterval = clearInterval;
sandbox.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
sandbox.cancelAnimationFrame = (id) => clearTimeout(id);

const document = {
  readyState: 'complete',
  title: '',
  _listeners: Object.create(null),
  _idMap: Object.create(null),
  createElement(tag) { return new Element(tag, this); },
  createTextNode(text) { return new TextNode(text); },
  createDocumentFragment() { return new Element('#fragment', this); },
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  },
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  },
  dispatchEvent(event) { return dispatch(event, this); },
  getElementById(id) { return this._idMap[id] || null; },
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
  querySelector(selector) { return this.body.querySelector(selector); },
  get activeElement() { return docActiveElement; },
  body: null,
  documentElement: null
};
document.body = new Element('body', document);
document.documentElement = new Element('html', document);
document.documentElement.appendChild(document.body);
parseHTML(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), document);
(function registerIds(el) {
  for (const child of el.children) {
    if (child instanceof Element) {
      if (child.id) document._idMap[child.id] = child;
      registerIds(child);
    }
  }
})(document.body);

/* 视口 canvas 布局尺寸（renderer 通过 clientWidth/clientHeight 取尺寸） */
const viewportCanvasEl = document.getElementById('viewport-canvas');
viewportCanvasEl.clientWidth = 1000;
viewportCanvasEl.clientHeight = 760;
viewportCanvasEl.width = 1000;
viewportCanvasEl.height = 760;

/* localStorage（js/i18n.js 语言持久化） */
const storageMap = Object.create(null);
const localStorageShim = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(storageMap, String(key)) ? storageMap[String(key)] : null; },
  setItem(key, value) { storageMap[String(key)] = String(value); },
  removeItem(key) { delete storageMap[String(key)]; },
  clear() { for (const k of Object.keys(storageMap)) delete storageMap[k]; }
};

class XFileReader {
  constructor() { this.result = null; this.error = null; this.onload = null; this.onerror = null; }
  readAsText(file) {
    if (!file) { this.error = new Error('no file'); if (this.onerror) setTimeout(() => this.onerror(), 0); return; }
    this.result = String(file._content != null ? file._content : '');
    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
  }
}
class XBlob { constructor(parts = []) { this.parts = parts; } }
class XURL { static createObjectURL() { return 'blob:shim'; } static revokeObjectURL() {} }
class XDataTransfer {
  constructor() { this.files = []; this.items = { add: (f) => { this.files.push(f); } }; }
}

sandbox.document = document;
sandbox.localStorage = localStorageShim;
sandbox.FileReader = XFileReader;
sandbox.Blob = XBlob;
sandbox.URL = XURL;
sandbox.DataTransfer = XDataTransfer;
sandbox.Event = SimpleEvent;
sandbox.KeyboardEvent = SimpleEvent;
sandbox.DragEvent = SimpleEvent;
sandbox.ResizeObserver = undefined;
sandbox.devicePixelRatio = 1;
sandbox.navigator = { userAgent: 'node-shim' };
sandbox.location = { href: 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html' };
sandbox.addEventListener = (type, fn) => {
  if (!windowListeners[type]) windowListeners[type] = [];
  windowListeners[type].push(fn);
};
sandbox.removeEventListener = (type, fn) => {
  const arr = windowListeners[type];
  if (!arr) return;
  const i = arr.indexOf(fn);
  if (i !== -1) arr.splice(i, 1);
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

/* 按 INTERFACE2.md §2 顺序加载脚本（charts/results 依赖 Canvas 布局，逻辑测试中跳过，
 * 由 tests/ui-cdp-smoke.mjs 在真实浏览器中覆盖结果面板；i18n.js/gausslog.js 存在则加载） */
const scripts = [
  'js/core.js', 'js/parsers.js', 'js/gausslog.js', 'js/i18n.js',
  'js/renderer.js', 'js/samples.js', 'js/charts.js', 'js/ui.js'
];
for (const rel of scripts) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    if (rel !== 'js/gausslog.js' && rel !== 'js/charts.js') console.log('SKIP  ' + rel + '（文件不存在）');
    continue;
  }
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: rel });
}
if (sandbox.MolResults && sandbox.MolResults.create) {
  console.log('SKIP js/ui.js 结果面板创建（DOM shim 不加载 results.js，真实浏览器见 ui-cdp-smoke）');
}

const MolApp = sandbox.MolApp;
check('js/ui.js 暴露 window.MolApp', !!MolApp && typeof MolApp === 'object');
check('MolApp.version = 2.0.0', MolApp && MolApp.version === '2.0.0', MolApp && MolApp.version);
check('MolCore / MolSamples 已加载', typeof sandbox.MolCore === 'object' && typeof sandbox.MolSamples === 'object');
check('MolI18n 已加载（i18n.js）', typeof sandbox.MolI18n === 'object' && typeof sandbox.MolI18n.t === 'function');
const hasRenderer = typeof sandbox.MolRender === 'object' && typeof sandbox.MolRender.createView === 'function';
check('renderer.js 已加载且 createView 可用', hasRenderer, hasRenderer ? sandbox.MolRender.version : 'missing');
const hasGaussLog = typeof sandbox.MolGaussLog === 'object' && typeof sandbox.MolGaussLog.parse === 'function';
check('gausslog.js 已加载（可选）', true, hasGaussLog ? sandbox.MolGaussLog.version : 'missing（log 结果用例将 SKIP）');

/* §8.2 全部 DOM id 存在 */
const REQUIRED_IDS = [
  'file-input', 'btn-open', 'sample-select', 'btn-undo', 'btn-redo',
  'btn-export-xyz', 'btn-export-gjf', 'btn-export-sdf',
  'tool-select', 'tool-rotate', 'tool-move-atom', 'tool-move-fragment', 'tool-pan',
  'viewport', 'viewport-canvas', 'viewport-overlay', 'empty-hint',
  'mol-title', 'mol-format', 'dataset-select', 'dataset-label', 'atom-count', 'bond-count',
  'charge-input', 'multiplicity-input',
  'selection-count', 'selection-list', 'measure-distance', 'measure-angle', 'measure-dihedral',
  'bond-length-input', 'bond-length-move', 'btn-apply-bond-length',
  'angle-input', 'angle-move', 'btn-apply-angle',
  'dihedral-input', 'dihedral-move', 'btn-apply-dihedral',
  'style-select', 'toggle-labels', 'toggle-indices', 'toggle-axes',
  'btn-rebond', 'btn-clear-selection', 'btn-reset-view',
  'status-bar', 'error-banner',
  /* v2 */
  'lang-toggle', 'side-tabs', 'tab-molecule', 'tab-results',
  'tab-page-molecule', 'tab-page-results', 'results-panel'
];
const missingIds = REQUIRED_IDS.filter((id) => !document.getElementById(id));
check('§8.2 全部 DOM id 存在（' + REQUIRED_IDS.length + ' 个）', missingIds.length === 0, missingIds.join(','));
check('5 个工具按钮 data-tool 完整', document.querySelectorAll('[data-tool]').length === 5);

/* ============================ 用例 ============================ */
const main = async () => {
  await MolApp.ready;
  check('MolApp.ready 可 resolve', true);

  /* ---------- v2：默认英文 + 语言切换 ---------- */
  check('v2 默认语言 = en', MolApp.getLanguage() === 'en', MolApp.getLanguage());
  check('v2 <html lang> = en', document.documentElement.getAttribute('lang') === 'en', document.documentElement.getAttribute('lang'));
  check('v2 document.title 英文', String(document.title).indexOf('Molecular Editor') !== -1, document.title);
  check('v2 语言按钮 en 模式显示「中文」', document.getElementById('lang-toggle').textContent === '中文', document.getElementById('lang-toggle').textContent);
  const enPlaceholder = document.getElementById('sample-select').options[0].textContent;
  check('v2 示例下拉占位英文', /Load a sample/.test(enPlaceholder), enPlaceholder);
  check('v2 状态栏英文', /Ready/.test(document.getElementById('status-bar').textContent), document.getElementById('status-bar').textContent);
  check('v2 动态区域 EN 无中文（状态栏/数据集/选择/鼠标提示）',
    !/[\u4e00-\u9fa5]/.test(document.getElementById('status-bar').textContent +
      document.getElementById('dataset-label').textContent +
      document.getElementById('selection-list').textContent +
      document.getElementById('mouse-hint').textContent),
    document.getElementById('status-bar').textContent);

  await MolApp.setLanguage('zh');
  check('v2 setLanguage(zh) 生效', MolApp.getLanguage() === 'zh', MolApp.getLanguage());
  check('v2 中文 document.title', String(document.title).indexOf('分子编辑器') !== -1, document.title);
  check('v2 zh 模式语言按钮显示 EN', document.getElementById('lang-toggle').textContent === 'EN', document.getElementById('lang-toggle').textContent);
  check('v2 示例占位中文', /加载示例/.test(document.getElementById('sample-select').options[0].textContent), document.getElementById('sample-select').options[0].textContent);
  check('v2 状态栏中文', /就绪/.test(document.getElementById('status-bar').textContent), document.getElementById('status-bar').textContent);
  check('v2 语言持久化到 localStorage', sandbox.localStorage.getItem('moledit.lang') === 'zh', sandbox.localStorage.getItem('moledit.lang'));
  const samples = MolApp.listSamples();
  check('listSamples 返回示例列表（≥6）', Array.isArray(samples) && samples.length >= 6, JSON.stringify(samples.map((s) => s.key)));

  let st = MolApp.getState();
  check('初始空状态', st.hasMolecule === false && st.atomCount === 0);
  check('空状态提示初始可见', document.getElementById('empty-hint').hidden === false);
  check('v2 未加载时 dataset-label 隐藏', document.getElementById('dataset-label').hidden === true);

  /* 1. 加载 XYZ 示例 */
  const loadRes = await MolApp.loadSample('water-xyz');
  check('loadSample(water-xyz)', loadRes.format === 'xyz' && loadRes.atomCount === 3 && loadRes.bondCount === 2, JSON.stringify(loadRes));
  st = MolApp.getState();
  check('DOM 原子数/键数', document.getElementById('atom-count').textContent === '3' && document.getElementById('bond-count').textContent === '2');
  check('v2 单帧时 dataset-label 隐藏（避免与 select 重复）',
    document.getElementById('dataset-label').hidden === true &&
    document.getElementById('dataset-label').textContent === '' &&
    document.getElementById('dataset-select').textContent === '单帧',
    JSON.stringify({ hidden: document.getElementById('dataset-label').hidden, label: document.getElementById('dataset-label').textContent, select: document.getElementById('dataset-select').textContent }));
  check('导出按钮启用', document.getElementById('btn-export-xyz').disabled === false);
  check('加载后空状态提示隐藏', document.getElementById('empty-hint').hidden === true);
  const atom0 = MolApp.getAtom(0);
  check('getAtom(0) 返回 O 坐标', atom0 && atom0.symbol === 'O' && approx(atom0.x, 0, 1e-9) && approx(atom0.z, 0, 1e-9), JSON.stringify(atom0));
  const bonds = MolApp.getBonds();
  check('getBonds 返回 2 条键', Array.isArray(bonds) && bonds.length === 2, JSON.stringify(bonds));

  /* 2. 选择与测量（键角顶点为第 2 个原子，故水选 H,O,H） */
  MolApp.setSelection([1, 0, 2]);
  let meas = MolApp.getMeasurements();
  check('水键长 ≈ 0.9572', approx(meas.distance, 0.9572, 0.002), meas.distance);
  check('水键角 ≈ 104.5', approx(meas.angle, 104.5, 0.2), meas.angle);
  check('3 原子时二面角为 null', meas.dihedral === null);
  check('#measure-distance 文本', /d = 0\.957/.test(document.getElementById('measure-distance').textContent), document.getElementById('measure-distance').textContent);
  check('#measure-angle 文本', /104\.5/.test(document.getElementById('measure-angle').textContent), document.getElementById('measure-angle').textContent);
  check('#selection-count 文本', document.getElementById('selection-count').textContent.indexOf('3 / 4') !== -1);
  check('键长编辑卡片可用', document.getElementById('btn-apply-bond-length').disabled === false);
  check('二面角编辑卡片禁用', document.getElementById('btn-apply-dihedral').disabled === true);

  /* 3. 键长编辑 + undo/redo */
  const applyLen = MolApp.applyBondLength(1.2, { atoms: [0, 1] });
  check('applyBondLength(1.2)', approx(applyLen.after, 1.2, 1e-9) && approx(applyLen.before, 0.9572, 0.002), JSON.stringify(applyLen));
  check('输入框回填 1.2000', /^1\.2/.test(document.getElementById('bond-length-input').value), document.getElementById('bond-length-input').value);
  check('undo 按钮启用', document.getElementById('btn-undo').disabled === false);
  check('undo 恢复', MolApp.undo() === true && approx(MolApp.getMeasurements().distance, 0.9572, 0.002), MolApp.getMeasurements().distance);
  check('redo 恢复 1.2', MolApp.redo() === true && approx(MolApp.getMeasurements().distance, 1.2, 1e-9), MolApp.getMeasurements().distance);

  /* 4. 键角 */
  MolApp.applyBondAngle(120, { atoms: [1, 0, 2] });
  check('applyBondAngle(120)', approx(MolApp.getMeasurements().angle, 120, 1e-6), MolApp.getMeasurements().angle);
  MolApp.undo();
  check('undo 恢复键角 104.5', approx(MolApp.getMeasurements().angle, 104.5, 0.2), MolApp.getMeasurements().angle);
  MolApp.redo();

  /* 5. 导出回环 */
  const xyz = MolApp.exportText('xyz');
  const xyzParsed = sandbox.MolCore.parseFile(xyz, { filename: 'roundtrip.xyz' });
  const rtMol = xyzParsed.molecules[0];
  check('exportText(xyz) 可解析且键长一致', rtMol.atoms.length === 3 && approx(sandbox.MolCore.measure.distance(rtMol, 0, 1), 1.2, 1e-4), sandbox.MolCore.measure.distance(rtMol, 0, 1));
  const gjf = MolApp.exportText('gjf');
  check('exportText(gjf) 含 charge/multiplicity', /0 1/.test(gjf) && gjf.split('\n').length > 8, gjf.split('\n').length);
  const sdf = MolApp.exportText('sdf');
  check('exportText(sdf) 含 V2000/$$$$', /V2000/.test(sdf) && /\$\$\$\$/.test(sdf));
  let exportErr = null;
  try { MolApp.exportText('pdb'); } catch (e) { exportErr = e; }
  check('未知导出格式抛中文错误', !!exportErr && /不支持/.test(exportErr.message), exportErr && exportErr.message);

  /* 6. 二面角（丁烷） */
  await MolApp.loadSample('butane-xyz');
  MolApp.setSelection([0, 1, 2, 3]);
  meas = MolApp.getMeasurements();
  check('丁烷二面角 ≈ ±180', meas.dihedral != null && Math.abs(Math.abs(meas.dihedral) - 180) < 0.5, meas.dihedral);
  const lenBefore = meas.distance;
  MolApp.applyBondDihedral(60, { atoms: [0, 1, 2, 3] });
  check('applyBondDihedral(60)', approx(MolApp.getMeasurements().dihedral, 60, 1e-4), MolApp.getMeasurements().dihedral);
  MolApp.applyBondDihedral(-60, { atoms: [0, 1, 2, 3] });
  check('applyBondDihedral(-60)', approx(MolApp.getMeasurements().dihedral, -60, 1e-4), MolApp.getMeasurements().dihedral);
  MolApp.applyBondDihedral(180, { atoms: [0, 1, 2, 3] });
  check('applyBondDihedral(180)', Math.abs(MolApp.getMeasurements().dihedral) > 179.99, MolApp.getMeasurements().dihedral);
  check('二面角编辑未破坏键长', approx(MolApp.getMeasurements().distance, lenBefore, 0.02), MolApp.getMeasurements().distance);

  /* 7. 参数校验 */
  let err1 = null;
  try { MolApp.applyBondLength(1.2, { atoms: [0] }); } catch (e) { err1 = e; }
  check('原子不足时 applyBondLength 抛错', !!err1 && /2 个原子/.test(err1.message), err1 && err1.message);
  check('错误会记录到 getLastError', !!MolApp.getLastError(), MolApp.getLastError());
  let err2 = null;
  try { MolApp.applyBondLength(-1, { atoms: [0, 1] }); } catch (e) { err2 = e; }
  check('非法键长抛错', !!err2 && /大于 0/.test(err2.message), err2 && err2.message);
  check('错误横幅可见', document.getElementById('error-banner').hidden === false);
  check('错误横幅是中文', /键长|原子/.test(document.getElementById('error-banner').textContent));

  /* 8. 文件读取：FileReader 路径 */
  await MolApp.loadSample('benzene-sdf');
  const xyzDrop = '3\nwater drop\nO 0.000000 0.000000 0.119262\nH 0.000000 0.763239 -0.477047\nH 0.000000 -0.763239 -0.477047\n';
  const fileInput = document.getElementById('file-input');
  fileInput.files = [{ name: 'drop-water.xyz', _content: xyzDrop }];
  fileInput.dispatchEvent(new SimpleEvent('change', { bubbles: true }));
  for (let i = 0; i < 40; i++) { await sleep(10); if (MolApp.getState().filename === 'drop-water.xyz') break; }
  st = MolApp.getState();
  check('file-input change + FileReader 加载文件', st.hasMolecule && st.atomCount === 3 && st.filename === 'drop-water.xyz', JSON.stringify({ a: st.atomCount, f: st.filename, fmt: st.format }));
  check('文件加载后选择/撤销栈清空', st.selection.length === 0 && document.getElementById('btn-undo').disabled === true);
  check('文件加载后无错误', MolApp.getLastError() === null && document.getElementById('error-banner').hidden === true);

  /* 9. 视口拖放 */
  const viewport = document.getElementById('viewport');
  const dt = new XDataTransfer();
  dt.files.push({ name: 'drop-benzene.sdf', _content: fs.readFileSync(path.join(ROOT, 'samples', 'benzene.sdf'), 'utf8') });
  viewport.dispatchEvent(new SimpleEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  for (let i = 0; i < 60; i++) { await sleep(10); if (MolApp.getState().filename === 'drop-benzene.sdf') break; }
  st = MolApp.getState();
  check('视口 drop 加载 SDF', st.hasMolecule && st.atomCount === 12 && st.bondCount === 12 && st.format === 'sdf', JSON.stringify({ a: st.atomCount, b: st.bondCount, f: st.format }));

  /* 10. 四种格式加载（samples/ 真实文件） */
  for (const [file, fmt, atoms] of [['water.xyz', 'xyz', 3], ['benzene.sdf', 'sdf', 12], ['methanol.gjf', 'gjf', 6], ['water.log', 'log', 3]]) {
    const text = fs.readFileSync(path.join(ROOT, 'samples', file), 'utf8');
    const res = await MolApp.loadText(text, { filename: file });
    check('loadText(' + file + ')', res.format === fmt && res.atomCount === atoms, JSON.stringify({ format: res.format, atoms: res.atomCount, bonds: res.bondCount }));
    check('  DOM 标题非空（' + file + '）', document.getElementById('mol-title').textContent.length > 0);
  }

  /* 11. 坏文件 */
  const beforeBad = MolApp.getState();
  let badErr = null;
  try { await MolApp.loadText('这不是分子文件', { filename: 'bad.xyz' }); } catch (e) { badErr = e; }
  st = MolApp.getState();
  check('坏文件 loadText 抛错且不清空当前分子', !!badErr && st.hasMolecule === true && st.atomCount === beforeBad.atomCount, badErr && badErr.message);
  check('坏文件错误横幅显示中文', document.getElementById('error-banner').hidden === false && document.getElementById('error-banner').textContent.length > 0, document.getElementById('error-banner').textContent);

  /* 12. 多帧数据集 */
  await MolApp.loadText(fs.readFileSync(path.join(ROOT, 'samples', 'water.log'), 'utf8'), { filename: 'water.log' });
  st = MolApp.getState();
  check('LOG 多帧 datasetCount=2', st.datasetCount === 2 && st.format === 'log', JSON.stringify({ n: st.datasetCount, f: st.format }));
  MolApp.setDatasetIndex(1);
  st = MolApp.getState();
  check('setDatasetIndex(1) 生效', st.datasetIndex === 1);
  check('#dataset-label 显示 2/2', document.getElementById('dataset-label').hidden === false && document.getElementById('dataset-label').textContent.indexOf('2/2') !== -1, document.getElementById('dataset-label').textContent);
  check('数据集切换清空选择/撤销', st.selection.length === 0 && document.getElementById('btn-undo').disabled === true);

  /* 13. 键盘 */
  await MolApp.loadSample('water-xyz');
  MolApp.setSelection([0, 1]);
  MolApp.applyBondLength(1.05, { atoms: [0, 1] });
  document.dispatchEvent(new SimpleEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  check('Ctrl+Z 撤销（键盘）', approx(MolApp.getMeasurements().distance, 0.9572, 0.002), MolApp.getMeasurements().distance);
  document.dispatchEvent(new SimpleEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  check('Ctrl+Shift+Z 重做（键盘）', approx(MolApp.getMeasurements().distance, 1.05, 1e-9), MolApp.getMeasurements().distance);
  MolApp.setSelection([0, 1]);
  document.dispatchEvent(new SimpleEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check('Esc 清空选择', MolApp.getState().selection.length === 0);

  /* 14. 电荷/多重度 */
  document.getElementById('charge-input').value = '-1';
  document.getElementById('charge-input').dispatchEvent(new SimpleEvent('change', { bubbles: true }));
  check('电荷输入变更生效', MolApp.getState().charge === -1, MolApp.getState().charge);
  check('电荷变更可 undo', MolApp.undo() === true && MolApp.getState().charge === 0, MolApp.getState().charge);
  document.getElementById('multiplicity-input').value = '2';
  document.getElementById('multiplicity-input').dispatchEvent(new SimpleEvent('change', { bubbles: true }));
  check('多重度输入变更生效', MolApp.getState().multiplicity === 2, MolApp.getState().multiplicity);

  /* 15. 显示设置 */
  MolApp.setStyle('spacefill');
  check('setStyle(spacefill)', MolApp.getState().style === 'spacefill' && document.getElementById('style-select').value === 'spacefill');
  MolApp.setOption('labels', false);
  check('setOption(labels,false) 同步复选框', document.getElementById('toggle-labels').checked === false);
  MolApp.setOption('indices', true);
  check('setOption(indices,true)', document.getElementById('toggle-indices').checked === true);
  let styleErr = null;
  try { MolApp.setStyle('bogus'); } catch (e) { styleErr = e; }
  check('未知样式抛错', !!styleErr, styleErr && styleErr.message);
  MolApp.setStyle('ballstick');
  MolApp.setOption('labels', true);
  MolApp.setOption('indices', false);

  /* 16. 重新推断键 */
  const bondsBefore = MolApp.getBonds().length;
  MolApp.rebond();
  check('rebond() 可调用且键数稳定', MolApp.getBonds().length === bondsBefore, MolApp.getBonds().length);
  check('rebond 可 undo', MolApp.undo() === true);

  /* 17. 选择规则 */  MolApp.loadSample('butane-xyz');
  MolApp.setSelection([0, 1, 2, 3, 4, 5]);
  check('setSelection 最多 4 个', MolApp.getState().selection.length === 4, JSON.stringify(MolApp.getState().selection));
  MolApp.setSelection([2, 2, 2]);
  check('setSelection 去重', JSON.stringify(MolApp.getState().selection) === '[2]', JSON.stringify(MolApp.getState().selection));
  MolApp.setSelection([99, -1, 0]);
  check('setSelection 忽略越界', JSON.stringify(MolApp.getState().selection) === '[0]');
  MolApp.selectAtom(1, { add: true });
  check('selectAtom(add) 追加', JSON.stringify(MolApp.getState().selection) === '[0,1]');
  MolApp.selectAtom(0);
  check('点击已选原子 = 取消该原子（其余保留）', JSON.stringify(MolApp.getState().selection) === '[1]', JSON.stringify(MolApp.getState().selection));
  MolApp.setSelection([2]);
  MolApp.selectAtom(0);
  check('点击未选原子 = 替换选择', JSON.stringify(MolApp.getState().selection) === '[0]', JSON.stringify(MolApp.getState().selection));
  MolApp.clearSelection();
  check('clearSelection', MolApp.getState().selection.length === 0);

  /* 18. 视图相关 API 安全 */
  let viewSafe = true;
  try {
    MolApp.resetView();
    MolApp.setSelection([0, 1]);
    MolApp.undo();
    MolApp.redo();
    MolApp.setOption('showAxes', true);
  } catch (e) { viewSafe = false; console.log('  视图相关调用异常: ' + e.message); }
  check('视图相关 API（resetView/setSelection/undo/redo/setOption）不抛错', viewSafe);

  /* 19. 状态栏/HUD/示例下拉 */
  MolApp.loadSample('benzene-sdf');
  await sleep(20);
  const statusText = document.getElementById('status-bar').textContent;
  check('状态栏显示原子/键/选中', /原子\s*12/.test(statusText) && /键\s*12/.test(statusText), statusText);
  check('文件信息 DOM 更新', document.getElementById('mol-format').textContent === 'SDF' && document.getElementById('atom-count').textContent === '12');
  const sampleSelect = document.getElementById('sample-select');
  check('示例下拉框已填充', sampleSelect.options.length >= 7, sampleSelect.options.length);
  sampleSelect.value = 'methane-gjf';
  sampleSelect.dispatchEvent(new SimpleEvent('change', { bubbles: true }));
  await sleep(30);
  st = MolApp.getState();
  check('示例下拉 change 加载 methane-gjf', st.format === 'gjf' && st.atomCount === 5, JSON.stringify({ f: st.format, a: st.atomCount }));

  /* qa V-2：示例下拉与文件/文本加载来源同步 */
  check('示例下拉加载后高亮对应示例', sampleSelect.value === 'methane-gjf', sampleSelect.value);
  await MolApp.loadText(fs.readFileSync(path.join(ROOT, 'samples', 'water.xyz'), 'utf8'), { filename: 'water.xyz' });
  check('qa V-2：文件/文本加载后示例下拉重置为占位', sampleSelect.value === '' && MolApp.getState().filename === 'water.xyz', sampleSelect.value);
  await MolApp.loadSample('benzene-sdf');
  check('示例加载后示例下拉选中对应项', sampleSelect.value === 'benzene-sdf', sampleSelect.value);

  /* 20. 导出下载 */
  let downloadOk = true;
  try { document.getElementById('btn-export-xyz').click(); } catch (e) { downloadOk = false; console.log('  导出下载异常: ' + e.message); }
  check('导出按钮点击（Blob 下载）不抛错', downloadOk);

  /* ====================== 21. 渲染器集成 ====================== */
  if (hasRenderer) {
    await MolApp.loadSample('water-xyz');
    await sleep(60);
    MolApp.setSelection([1, 0]);
    await sleep(60);
    const badges = document.querySelectorAll('.ov-badge');
    check('viewport-overlay 有 4 个序号徽标节点', badges.length === 4, badges.length);
    const shownBadges = badges.filter((b) => !b.hidden);
    check('选中 2 原子显示 2 个序号徽标', shownBadges.length === 2, shownBadges.map((b) => b.textContent).join(','));
    check('徽标序号为 1,2', shownBadges.map((b) => b.textContent).sort().join(',') === '1,2', shownBadges.map((b) => b.textContent).join(','));
    check('徽标位置为有效投影坐标', shownBadges.every((b) => isFinite(parseFloat(b.style.left)) && isFinite(parseFloat(b.style.top))), shownBadges.map((b) => b.style.left + '/' + b.style.top).join(' '));
    const shownLabels = document.querySelectorAll('.ov-label:not([hidden])');
    check('距离测量浮层标签显示 d =', shownLabels.length === 1 && /^d = \d\.\d{3} Å$/.test(shownLabels[0].textContent), shownLabels.map((l) => l.textContent).join('|'));
    check('浮层标签位置有效', shownLabels.every((l) => isFinite(parseFloat(l.style.left)) && isFinite(parseFloat(l.style.top))));

    const rect = viewportCanvasEl.getBoundingClientRect();
    const firePointer = (type, x, y, extra) => {
      viewportCanvasEl.dispatchEvent(new SimpleEvent(type, Object.assign({
        bubbles: true, cancelable: true,
        clientX: rect.left + x, clientY: rect.top + y,
        button: 0, pointerId: 1
      }, extra || {})));
    };
    const clickXY = (x, y) => { firePointer('pointerdown', x, y); firePointer('pointerup', x, y); };

    MolApp.clearSelection();
    await sleep(30);
    const b0 = shownBadges[0];
    const bx = parseFloat(b0.style.left);
    const bTop = parseFloat(b0.style.top);
    let hit = null;
    for (let dy = 0; dy <= 500 && !hit; dy += 5) {
      clickXY(bx, bTop + dy);
      const sel = MolApp.getState().selection;
      if (sel.length === 1) hit = { atom: sel[0], x: bx, y: bTop + dy };
    }
    check('真实 pointerdown/up 可拾取原子', hit !== null, JSON.stringify(hit));
    if (hit) {
      check('点击后叠加层徽标更新', document.querySelectorAll('.ov-badge:not([hidden])').length === 1);
      await sleep(30);
      const beforeBadge = { left: parseFloat(b0.style.left), top: parseFloat(b0.style.top) };
      firePointer('pointerdown', 30, 30);
      for (let i = 1; i <= 6; i++) firePointer('pointermove', 30 + i * 10, 30 + i * 4, { buttons: 1 });
      firePointer('pointerup', 90, 54);
      await sleep(60);
      MolApp.setSelection([0]);
      await sleep(40);
      const afterEl = document.querySelector('.ov-badge:not([hidden])');
      const afterBadge = afterEl ? { left: parseFloat(afterEl.style.left), top: parseFloat(afterEl.style.top) } : null;
      check('拖动空白旋转视图（投影位置改变）', afterBadge && (Math.abs(afterBadge.left - beforeBadge.left) + Math.abs(afterBadge.top - beforeBadge.top) > 1), JSON.stringify({ before: beforeBadge, after: afterBadge }));

      const beforeZoom = document.querySelector('.ov-badge:not([hidden])').style.left;
      document.getElementById('viewport').dispatchEvent(new SimpleEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240 }));
      await sleep(60);
      const afterZoom = document.querySelector('.ov-badge:not([hidden])').style.left;
      check('滚轮缩放改变投影', beforeZoom !== afterZoom, beforeZoom + ' -> ' + afterZoom);

      document.getElementById('tool-move-atom').click();
      MolApp.setSelection([hit.atom]);
      await sleep(50);
      const curBadge = document.querySelector('.ov-badge:not([hidden])');
      const cbx = parseFloat(curBadge.style.left);
      const cby = parseFloat(curBadge.style.top);
      MolApp.clearSelection();
      await sleep(20);
      let hitPoint = null;
      let moveAtom = hit.atom;
      for (let dy = 0; dy <= 600 && !hitPoint; dy += 5) {
        clickXY(cbx, cby + dy);
        const sel = MolApp.getState().selection;
        if (sel.length === 1) { hitPoint = { x: cbx, y: cby + dy }; moveAtom = sel[0]; }
      }
      check('移动工具下点击仍可选中原子', hitPoint !== null, JSON.stringify(hitPoint) + ' atom=' + moveAtom);
      if (hitPoint) {
        const atomBefore = MolApp.getAtom(moveAtom);
        firePointer('pointerdown', hitPoint.x, hitPoint.y);
        for (let i = 1; i <= 5; i++) firePointer('pointermove', hitPoint.x + i * 10, hitPoint.y + i * 6, { buttons: 1 });
        firePointer('pointerup', hitPoint.x + 50, hitPoint.y + 30);
        await sleep(80);
        const atomAfter = MolApp.getAtom(moveAtom);
        const movedDist = Math.hypot(atomAfter.x - atomBefore.x, atomAfter.y - atomBefore.y, atomAfter.z - atomBefore.z);
        check('pointer 拖动原子改变坐标', movedDist > 0.05, 'Δ=' + movedDist.toFixed(3) + ' Å');
        const undone = MolApp.undo();
        const atomUndo = MolApp.getAtom(moveAtom);
        const back = Math.hypot(atomUndo.x - atomBefore.x, atomUndo.y - atomBefore.y, atomUndo.z - atomBefore.z);
        check('拖动原子后一次 undo 恢复坐标', undone === true && back < 1e-9, 'Δ=' + back.toFixed(9));
      }
      document.getElementById('tool-select').click();
    }

    MolApp.setSelection([1, 0, 2]);
    await sleep(50);
    const angleLabels = document.querySelectorAll('.ov-label:not([hidden])');
    check('3 原子时浮层显示键角', angleLabels.length === 1 && /∠ = /.test(angleLabels[0].textContent), angleLabels.length && angleLabels[0].textContent);
    MolApp.loadSample('butane-xyz');
    await sleep(60);
    MolApp.setSelection([0, 1, 2, 3]);
    await sleep(60);
    const dihLabels = document.querySelectorAll('.ov-label:not([hidden])');
    check('4 原子时浮层显示二面角', dihLabels.length === 1 && /τ = /.test(dihLabels[0].textContent), dihLabels.length && dihLabels[0].textContent);
    check('4 个序号徽标全部显示', document.querySelectorAll('.ov-badge:not([hidden])').length === 4);

    for (const style of ['ballstick', 'spacefill', 'stick', 'wireframe']) {
      MolApp.setStyle(style);
      await sleep(20);
    }
    check('四种显示样式切换不抛错', MolApp.getState().style === 'wireframe');
    MolApp.setStyle('ballstick');
    MolApp.clearSelection();
  } else {
    console.log('SKIP  渲染器集成测试（renderer.js 未加载）');
  }

  /* ====================== v2：LOG 结果 + 侧栏 Tab + 语言回切 ====================== */

  // 普通 log：results tab 可用但只有能量 → 不自动切换
  await MolApp.loadText(fs.readFileSync(path.join(ROOT, 'samples', 'water.log'), 'utf8'), { filename: 'water.log' });
  const plainLogState = MolApp.getResultsState();
  check('v2 普通 log：getResultsState 结构完整', plainLogState && typeof plainLogState.available === 'boolean' &&
    'activeTab' in plainLogState && 'jobCount' in plainLogState && 'frequencyCount' in plainLogState &&
    'animating' in plainLogState && 'amplitude' in plainLogState, JSON.stringify(plainLogState));
  if (hasGaussLog) {
    check('v2 普通 log：MolApp.getLogResults() 非空', !!MolApp.getLogResults(), MolApp.getLogResults() && MolApp.getLogResults().format);
    check('v2 普通 log：results tab 可用', document.getElementById('tab-results').disabled === false);
    const plainSummary = MolApp.getLogResults().summary;
    const expectTab = (plainSummary.hasFrequencies || plainSummary.hasOptimization || plainSummary.hasThermochemistry) ? 'results' : 'molecule';
    check('v2 普通 log：按 summary 自动切 tab', MolApp.getState().activeTab === expectTab, MolApp.getState().activeTab + ' (expect ' + expectTab + ')');
    check('v2 普通 log：无频率模式', plainLogState.frequencyCount === 0, plainLogState.frequencyCount);
  } else {
    check('v2 普通 log：gausslog.js 缺失时降级（tab 禁用）', document.getElementById('tab-results').disabled === true);
  }

  // opt+freq fixture：自动切 results tab + 频率信息 + playFrequency 失败路径
  const optFreqCandidates = [
    path.join(ROOT, 'tests', 'fixtures', 'water-opt-freq.log'),
    path.join(ROOT, 'samples', 'water-opt-freq.log')
  ];
  let optFreqPath = null;
  for (const p of optFreqCandidates) { if (fs.existsSync(p)) { optFreqPath = p; break; } }
  if (hasGaussLog && optFreqPath) {
    const resOpt = await MolApp.loadText(fs.readFileSync(optFreqPath, 'utf8'), { filename: 'water-opt-freq.log' });
    const results = MolApp.getLogResults();
    check('v2 opt+freq：LoadResult 带结果字段', resOpt && resOpt.hasLogResults === true &&
      resOpt.logJobCount >= 1 && resOpt.frequencyCount === 3 &&
      resOpt.hasFrequencies === true && resOpt.hasOptimization === true && resOpt.hasThermochemistry === true,
      JSON.stringify({ has: resOpt && resOpt.hasLogResults, jobs: resOpt && resOpt.logJobCount, freq: resOpt && resOpt.frequencyCount, hasF: resOpt && resOpt.hasFrequencies, hasO: resOpt && resOpt.hasOptimization, hasT: resOpt && resOpt.hasThermochemistry }));
    check('v2 opt+freq：finalEnergy 正确', results && results.summary && approx(results.summary.finalEnergy, -76.4093345678, 1e-9), results && results.summary && results.summary.finalEnergy);
    check('v2 opt+freq：自动切到 results tab', MolApp.getState().activeTab === 'results', MolApp.getState().activeTab);
    check('v2 opt+freq：tab-results 可用 + tab 页显隐正确',
      document.getElementById('tab-results').disabled === false &&
      document.getElementById('tab-page-results').hidden === false &&
      document.getElementById('tab-page-molecule').hidden === true &&
      document.getElementById('tab-molecule').getAttribute('aria-selected') === 'false' &&
      document.getElementById('tab-results').getAttribute('aria-selected') === 'true');
    const rs = MolApp.getResultsState();
    check('v2 opt+freq：getResultsState 频率/能量字段', rs && rs.frequencyCount === 3 && rs.hasFrequencies === true &&
      rs.hasOptimization === true && rs.hasThermochemistry === true && approx(rs.finalEnergy, -76.4093345678, 1e-9), JSON.stringify(rs));
    check('v2 opt+freq：freqFrameIndex = 4', rs && rs.freqFrameIndex === 4, rs && rs.freqFrameIndex);
    MolApp.setSideTab('molecule');
    check('v2 setSideTab(molecule) 切换', MolApp.getState().activeTab === 'molecule' && document.getElementById('tab-page-molecule').hidden === false);
    MolApp.setSideTab('results');
    check('v2 setSideTab(results) 切换', MolApp.getState().activeTab === 'results' && document.getElementById('tab-page-results').hidden === false);
    // 逻辑 shim 未加载 results.js → 面板缺失，playFrequency 应抛本地化 Error
    let pfErr = null;
    try { MolApp.playFrequency(0); } catch (e) { pfErr = e; }
    check('v2 playFrequency 在无面板时抛本地化错误', !!pfErr && /result|结果/i.test(pfErr.message), pfErr && pfErr.message);
    let ampErr = null;
    try { MolApp.setFrequencyAmplitude('abc'); } catch (e) { ampErr = e; }
    check('v2 setFrequencyAmplitude 非法值抛错', !!ampErr, ampErr && ampErr.message);
    const animState = MolApp.getFrequencyAnimationState();
    check('v2 getFrequencyAnimationState 结构', animState && 'animating' in animState && 'paused' in animState && 'selectedMode' in animState && 'amplitude' in animState, JSON.stringify(animState));
  } else {
    console.log('SKIP  v2 opt+freq 结果用例（gausslog.js 或 fixture 未就绪）');
  }

  // 加载非 log → results tab 禁用并回 molecule tab
  await MolApp.loadSample('water-xyz');
  check('v2 非 log：results tab 禁用且回 molecule',
    document.getElementById('tab-results').disabled === true && MolApp.getState().activeTab === 'molecule' &&
    MolApp.getLogResults() === null);
  let tabErr = null;
  try { MolApp.setSideTab('results'); } catch (e) { tabErr = e; }
  check('v2 无结果时 setSideTab(results) 抛本地化错误', !!tabErr && typeof tabErr.message === 'string' && tabErr.message.length > 0, tabErr && tabErr.message);

  /* v2：切回英文，动态文案英文、示例名英文（若有 nameEn） */
  await MolApp.setLanguage('en');
  check('v2 setLanguage(en) 生效', MolApp.getLanguage() === 'en');
  check('v2 切回英文后状态栏英文', /Atoms/.test(document.getElementById('status-bar').textContent) && !/原子/.test(document.getElementById('status-bar').textContent), document.getElementById('status-bar').textContent);
  await MolApp.loadSample('water-xyz');
  const enStatus = document.getElementById('status-bar').textContent;
  check('v2 英文状态栏 Sample loaded', /Sample loaded/.test(enStatus), enStatus);
  const enSampleText = document.getElementById('sample-select').options[1].textContent;
  check('v2 示例名英文（nameEn 或回退）', enSampleText.length > 0, enSampleText);
  const enLangPersist = sandbox.localStorage.getItem('moledit.lang');
  check('v2 语言持久化 en', enLangPersist === 'en', enLangPersist);

  /* 汇总 */
  const failed = results.filter((r) => !r.ok);
  console.log('\n========== 结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 ==========');
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log(' - ' + f.name + '  ' + f.detail));
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error('UI-LOGIC-SMOKE FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
