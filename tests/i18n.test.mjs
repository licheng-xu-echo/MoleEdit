#!/usr/bin/env node
/* ============================================================================
 * MolEdit — tests/i18n.test.mjs
 * 所有者：i18n-dev。契约：INTERFACE2.md §3 / §7。
 *
 * 覆盖：
 *  A. 契约常量与 API 形状、默认语言 en、Node 可加载
 *  B. register / t 回退 / has / 插值
 *  C. setLang / toggleLang / onChange / 持久化
 *  D. translateDOM（最小 DOM shim）：text / HTML / title / placeholder / aria-label、
 *     缺字典保留原文本、<html lang>、document.title
 *  E. 关键扫描：index.html 中所有 data-i18n* key 在 en/zh 字典均存在，
 *     且 en 字典与 DOM 初始英文文本一致、key 无冲突、命名空间正确；
 *     另含 v1 DOM id 保留、v2 新 DOM、脚本顺序、<html lang="en">、
 *     EN 初始静态文本无中文残留（#lang-toggle 除外，Lead 已裁决豁免）
 *
 * 运行：node tests/i18n.test.mjs      （全绿 exit 0；失败 exit 1）
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const failures = [];

function record(okFlag, name, detail) {
  if (okFlag) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? ' — ' + detail : ''));
  }
}

function ok(cond, name, detail) {
  record(!!cond, name, detail);
}

function eq(actual, expected, name) {
  const same = actual === expected;
  record(same, name, same ? '' : '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
}

function deepEq(actual, expected, name) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  record(same, name, same ? '' : '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
}

function section(title) {
  console.log('\n' + title);
}

/* ========================================================================== *
 * 最小 DOM shim（仅实现 i18n.js translateDOM 所需接口）
 * ========================================================================== */

const SELECTOR_RE = /^\[([\w-]+)\]$/;

function matches(el, selector) {
  const m = SELECTOR_RE.exec(selector);
  if (!m) return false;
  return el.hasAttribute(m[1]);
}

function makeElement(attrs, text, html, children) {
  const el = {
    _attrs: Object.assign({}, attrs || {}),
    textContent: text || '',
    innerHTML: html || '',
    _children: [],
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    setAttribute(name, value) {
      this._attrs[name] = String(value);
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name);
    },
    querySelectorAll(selector) {
      return this._children.filter((c) => matches(c, selector));
    }
  };
  if (Array.isArray(children)) {
    el._children = children;
    children.forEach((c) => { c._parent = el; });
  }
  return el;
}

function makeDocument(elements) {
  const docEl = {
    _attrs: { lang: 'en' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    setAttribute(name, value) {
      this._attrs[name] = String(value);
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name);
    }
  };
  const doc = {
    title: '初始标题',
    documentElement: docEl,
    _elements: elements,
    querySelectorAll(selector) {
      return elements.filter((el) => matches(el, selector));
    }
  };
  return { doc, docEl, elements };
}

let domBackup = null;
function installDOM(doc) {
  domBackup = globalThis.document;
  globalThis.document = doc;
}
function uninstallDOM() {
  if (domBackup === undefined) delete globalThis.document;
  else globalThis.document = domBackup;
  domBackup = null;
}

/* localStorage mock */
function installStorage(initial) {
  const store = Object.assign({}, initial || {});
  const calls = { get: [], set: [] };
  globalThis.localStorage = {
    getItem(key) {
      calls.get.push(key);
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      calls.set.push([key, String(value)]);
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
  return { store, calls };
}
function uninstallStorage() {
  delete globalThis.localStorage;
}

/* ========================================================================== *
 * 0. 模块加载
 * ========================================================================== */

section('A. 契约常量 / API / Node 加载');
const priorDocument = globalThis.document;
const priorStorage = globalThis.localStorage;
const MolI18n = require('../js/i18n.js');

ok(MolI18n && typeof MolI18n === 'object', 'require("../js/i18n.js") 返回对象');
eq(globalThis.MolI18n, MolI18n, 'globalThis.MolI18n 已挂载且与 module.exports 一致');
eq(MolI18n.DEFAULT_LANG, 'en', 'DEFAULT_LANG === "en"');
deepEq(MolI18n.LANGS, ['en', 'zh'], 'LANGS === ["en","zh"]');
eq(MolI18n.STORAGE_KEY, 'moledit.lang', 'STORAGE_KEY === "moledit.lang"');
eq(MolI18n.getLang(), 'en', '未 init 时 getLang() 默认为 en（不读浏览器语言）');

const API = ['init', 'getLang', 'setLang', 'toggleLang', 'onChange', 'register', 't', 'has', 'translateDOM'];
API.forEach((name) => ok(typeof MolI18n[name] === 'function', 'API ' + name + '() 存在且为函数'));
ok(Object.keys(MolI18n).every((k) => API.indexOf(k) >= 0 || ['DEFAULT_LANG', 'LANGS', 'STORAGE_KEY'].indexOf(k) >= 0),
  'MolI18n 可枚举属性仅含 §3.1 契约字段', JSON.stringify(Object.keys(MolI18n)));
eq(MolI18n._dicts && typeof MolI18n._dicts.en, 'object', '_dicts 测试视图存在（不可枚举）');
ok(Object.keys(MolI18n).indexOf('_dicts') < 0, '_dicts 不可枚举（不污染公共 API）');

/* ========================================================================== *
 * B. 字典 / register / 回退 / has
 * ========================================================================== */

section('B. register / t 回退 / has');

eq(MolI18n.t('app.title'), 'MolEdit — Molecular Editor', '内置字典 en: app.title');
eq(MolI18n.t('toolbar.open'), 'Open file', '内置字典 en: toolbar.open');
eq(MolI18n.t('edit.bondAngleHint'), 'Select 3 atoms (2nd is the vertex)', '内置字典 en: edit.bondAngleHint');
eq(MolI18n.t('measure.distance'), 'Bond length <em>d</em>', '内置字典 en: measure.distance (含 HTML)');

MolI18n.register('en', { 'test.hello': 'Hello', 'test.onlyEn': 'Only EN', 'test.interp': 'Loaded {file} ({n} atoms)' });
MolI18n.register('zh', { 'test.hello': '你好', 'test.interp': '已加载 {file}（{n} 原子）' });
eq(MolI18n.t('test.hello'), 'Hello', 'register/en + t 返回英文');
MolI18n.setLang('zh');
eq(MolI18n.t('test.hello'), '你好', 'register/zh + setLang(zh) 后 t 返回中文');
eq(MolI18n.t('test.onlyEn'), 'Only EN', 'zh 缺失 key 回退到 en 字典');
eq(MolI18n.t('test.not.exists'), 'test.not.exists', '完全缺失 key 回退为 key 本身');
eq(MolI18n.t(null), '', 't(null) 返回空字符串');
eq(MolI18n.t(undefined), '', 't(undefined) 返回空字符串');
ok(MolI18n.has('test.hello') === true, 'has(已注册 key) === true');
ok(MolI18n.has('test.not.exists') === false, 'has(未注册 key) === false');
ok(MolI18n.has('app.title') === true, 'has(app.title) === true');
ok(MolI18n.has('') === false, 'has("") === false');

// register 合并 / 覆盖 / 幂等 / 非法入参
MolI18n.register('en', { 'test.hello': 'Hello again' });
eq(MolI18n.t('test.hello'), '你好', '同 key 覆盖只影响注册语言（当前 zh 仍为中文）');
MolI18n.setLang('en');
eq(MolI18n.t('test.hello'), 'Hello again', 'register 同 key 后注册覆盖先注册（en 生效）');
MolI18n.register('en', { 'test.hello': 'Hello again' });
eq(MolI18n.t('test.hello'), 'Hello again', 'register 幂等（重复注册不产生异常）');
MolI18n.register('en', { 'test.extra': 'Extra' });
eq(MolI18n.t('test.extra'), 'Extra', 'register 合并新 key 不丢旧 key');
MolI18n.register('fr', { 'test.fr': 'Bonjour' });
eq(MolI18n.t('test.fr'), 'test.fr', 'register 非法语言被忽略');
MolI18n.register('en', null);
MolI18n.register(null, {});
ok(true, 'register 非法入参不抛异常');

// 插值
eq(MolI18n.t('test.interp', { file: 'a.xyz', n: 3 }), 'Loaded a.xyz (3 atoms)', '插值 {file}/{n}');
eq(MolI18n.t('test.interp', { file: 'a.xyz' }), 'Loaded a.xyz ({n} atoms)', '缺失参数保留 {name} 原文');
eq(MolI18n.t('test.interp', {}), 'Loaded {file} ({n} atoms)', '空参数对象保留全部占位符');
eq(MolI18n.t('test.interp', { file: null, n: 3 }), 'Loaded {file} (3 atoms)', 'null 参数保留占位符');
eq(MolI18n.t('test.interp', { file: 0, n: 3 }), 'Loaded 0 (3 atoms)', '数值 0 参数正常替换');
MolI18n.setLang('zh');
eq(MolI18n.t('test.interp', { file: '水.xyz', n: 3 }), '已加载 水.xyz（3 原子）', '中文插值');

/* ========================================================================== *
 * C. setLang / toggleLang / onChange / 持久化（无 DOM 时也安全）
 * ========================================================================== */

section('C. setLang / toggleLang / onChange / 持久化');

eq(MolI18n.getLang(), 'zh', 'setLang("zh") 后 getLang() === "zh"');
MolI18n.setLang('fr');
eq(MolI18n.getLang(), 'zh', 'setLang 非法值 ("fr") 被忽略');
MolI18n.setLang('');
MolI18n.setLang(null);
MolI18n.setLang(5);
eq(MolI18n.getLang(), 'zh', 'setLang 非法值 null/""/5 均被忽略');
MolI18n.setLang('en');
eq(MolI18n.getLang(), 'en', 'setLang("en") 生效');
ok(!globalThis.document, '本阶段无 DOM：setLang 不因缺少 document 抛异常');

const seen = [];
const unsub = MolI18n.onChange((lang) => seen.push(lang));
MolI18n.setLang('zh');
MolI18n.setLang('en');
deepEq(seen, ['zh', 'en'], 'onChange 回调收到切换后的语言序列');
eq(typeof unsub, 'function', 'onChange 返回退订函数');
unsub();
MolI18n.setLang('zh');
deepEq(seen, ['zh', 'en'], '退订后不再收到通知');

const seenA = [];
const seenB = [];
const unsubA = MolI18n.onChange(() => { throw new Error('listener boom'); });
const unsubB = MolI18n.onChange((lang) => seenA.push(lang));
MolI18n.setLang('en');
deepEq(seenA, ['en'], '某监听器抛异常不影响其它监听器');
eq(MolI18n.getLang(), 'en', 'setLang 后语言正确（异常监听器场景）');
unsubA();
unsubB();

// 持久化
let st = installStorage({});
MolI18n.setLang('zh');
deepEq(st.calls.set, [['moledit.lang', 'zh']], 'setLang 写 localStorage["moledit.lang"]="zh"');
MolI18n.setLang('en');
eq(st.store['moledit.lang'], 'en', 'setLang 更新持久化值为 en');
eq(MolI18n.toggleLang(), 'zh', 'toggleLang() 返回新语言 zh');
eq(st.store['moledit.lang'], 'zh', 'toggleLang 也持久化');
eq(MolI18n.toggleLang(), 'en', 'toggleLang() 再次切换回 en');

// 持久化读取（init）
st = installStorage({ 'moledit.lang': 'zh' });
eq(MolI18n.init(), 'zh', 'init() 读取 localStorage 中的 zh');
uninstallStorage();

st = installStorage({ 'moledit.lang': 'fr' });
eq(MolI18n.init(), 'en', 'init() 忽略非法持久化值，回退 en');
uninstallStorage();

st = installStorage({});
eq(MolI18n.init(), 'en', 'init() 无持久化时默认 en（不读浏览器语言）');
eq(MolI18n.init({ defaultLang: 'zh' }), 'zh', 'init({defaultLang:"zh"}) 在无持久化时采用 zh');
uninstallStorage();

st = installStorage({ 'moledit.lang': 'en' });
eq(MolI18n.init({ defaultLang: 'zh' }), 'en', 'init(): 持久化值优先于 defaultLang');
uninstallStorage();
MolI18n.setLang('en');

/* ========================================================================== *
 * D. translateDOM（DOM shim）
 * ========================================================================== */

section('D. translateDOM（text / HTML / title / placeholder / aria-label / html lang / title）');

const elText = makeElement({ 'data-i18n': 'toolbar.open' }, 'Open file');
const elHtml = makeElement({ 'data-i18n-html': 'measure.distance' }, 'Bond length d', 'Bond length <em>d</em>');
const elTitle = makeElement({ 'data-i18n-title': 'toolbar.openTitle', title: 'Open a local file (.xyz / .sdf / .gjf / .log)' });
const elPlaceholder = makeElement({ 'data-i18n-placeholder': 'edit.targetLengthPlaceholder', placeholder: 'e.g. 1.2000' });
const elAria = makeElement({ 'data-i18n-aria-label': 'toolbar.langToggleAria', 'aria-label': 'Switch language' });
const elMissing = makeElement({ 'data-i18n': 'test.not.exists.anywhere' }, 'Keep me');
const elToggle = makeElement({ 'data-i18n': 'toolbar.langToggle' }, '中文');
const fake = makeDocument([elText, elHtml, elTitle, elPlaceholder, elAria, elMissing, elToggle]);
installDOM(fake.doc);
installStorage({});

const initLang = MolI18n.init();
eq(initLang, 'en', 'init() 返回当前语言 en');
eq(fake.docEl._attrs.lang, 'en', 'init() 设置 <html lang="en">');
eq(fake.doc.title, 'MolEdit — Molecular Editor', 'init() 用 app.title 设置 document.title（en）');
eq(elText.textContent, 'Open file', 'translateDOM: data-i18n textContent（en）');
eq(elHtml.innerHTML, 'Bond length <em>d</em>', 'translateDOM: data-i18n-html innerHTML（en）');
eq(elTitle.getAttribute('title'), 'Open a local file (.xyz / .sdf / .gjf / .log)', 'translateDOM: data-i18n-title → title（en）');
eq(elPlaceholder.getAttribute('placeholder'), 'e.g. 1.2000', 'translateDOM: data-i18n-placeholder → placeholder（en）');
eq(elAria.getAttribute('aria-label'), 'Switch language', 'translateDOM: data-i18n-aria-label → aria-label（en）');
eq(elMissing.textContent, 'Keep me', '缺字典时保留原 DOM 文本（无占位符闪烁）');
eq(elToggle.textContent, '中文', '语言按钮 en 模式显示“中文”');

// onChange 在 DOM 已更新之后触发
let titleInListener = null;
let langInListener = null;
const unsubDom = MolI18n.onChange(() => {
  titleInListener = fake.doc.title;
  langInListener = fake.docEl._attrs.lang;
});
MolI18n.setLang('zh');
eq(fake.docEl._attrs.lang, 'zh-CN', 'setLang(zh) 更新 <html lang="zh-CN">');
eq(fake.doc.title, 'MolEdit — 分子编辑器', 'setLang(zh) 用 app.title 更新 document.title');
eq(elText.textContent, '打开文件', 'translateDOM: 切换 zh 后 text 变中文');
eq(elHtml.innerHTML, '键长 <em>d</em>', 'translateDOM: 切换 zh 后 HTML 变中文');
eq(elTitle.getAttribute('title'), '打开本地文件（.xyz / .sdf / .gjf / .log）', '切换 zh 后 title 属性变中文');
eq(elPlaceholder.getAttribute('placeholder'), '例如 1.2000', '切换 zh 后 placeholder 变中文');
eq(elAria.getAttribute('aria-label'), '切换语言', '切换 zh 后 aria-label 变中文');
eq(elToggle.textContent, 'EN', '语言按钮 zh 模式显示 "EN"');
eq(elMissing.textContent, 'Keep me', 'zh 下缺失 key 仍保留原文本');
eq(titleInListener, 'MolEdit — 分子编辑器', 'onChange 触发时 document.title 已更新');
eq(langInListener, 'zh-CN', 'onChange 触发时 <html lang> 已更新');
unsubDom();

// init 读取持久化 zh + DOM
installStorage({ 'moledit.lang': 'zh' });
eq(MolI18n.init(), 'zh', 'init() 读取持久化 zh');
eq(fake.doc.title, 'MolEdit — 分子编辑器', 'init() 持久化 zh 时设置中文 title');
eq(elText.textContent, '打开文件', 'init() 持久化 zh 时 translateDOM 生效');
uninstallStorage();

// translateDOM(root) 局部作用域
const childA = makeElement({ 'data-i18n': 'toolbar.undo' }, 'Undo');
const childB = makeElement({ 'data-i18n': 'toolbar.redo' }, 'Redo');
const parent = makeElement({}, '', '', [childA, childB]);
MolI18n.setLang('zh');
MolI18n.translateDOM(parent);
eq(childA.textContent, '撤销', 'translateDOM(rootElement) 翻译其子元素');
eq(childB.textContent, '重做', 'translateDOM(rootElement) 翻译全部子元素');

// 无 document 时不抛异常
MolI18n.setLang('en');
uninstallDOM();
let noDomErr = null;
try {
  MolI18n.translateDOM();
  MolI18n.init();
  MolI18n.setLang('zh');
  MolI18n.setLang('en');
} catch (e) {
  noDomErr = e;
}
eq(noDomErr, null, '无 document 环境下 translateDOM/init/setLang 均不抛异常');
ok(true, '说明：setLang 在无 document 时仅更新状态与 storage');

/* ========================================================================== *
 * E. index.html 扫描（关键：en/zh 字典覆盖所有 data-i18n* key）
 * ========================================================================== */

section('E. index.html 扫描：i18n key 覆盖 / 一致性 / DOM 契约');

const htmlPath = path.join(ROOT, 'index.html');
ok(fs.existsSync(htmlPath), 'index.html 存在');
const rawHtml = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function normalize(s) {
  return decodeEntities(String(s)).replace(/\s+/g, ' ').trim();
}

/**
 * 极简 HTML 元素扫描（针对本项目受控 HTML）：
 * 返回 [{ tag, attrs, text, innerHTML, start, end }]
 * - text = 开标签之后到下一个 '<' 的文本（适用于无嵌套 data-i18n 元素）
 * - innerHTML = 从开标签结束到对应结束标签的内容（用于 data-i18n-html）
 */
function scanElements(html) {
  const tagRe = /<([a-zA-Z][\w:-]*)((?:\s+[^<>]*?)?)>/g;
  const attrRe = /([\w:-]+)="([^"]*)"/g;
  const tags = [];
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1];
    const attrStr = m[2] || '';
    const attrs = {};
    const attrCount = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(attrStr)) !== null) {
      const name = a[1];
      attrCount[name] = (attrCount[name] || 0) + 1;
      attrs[name] = a[2];
    }
    const tagStart = m.index;
    const tagEnd = tagRe.lastIndex;
    const textStart = tagEnd;
    const nextTag = html.indexOf('<', textStart);
    const textEnd = nextTag < 0 ? html.length : nextTag;
    let innerHTML = '';
    if (attrs['data-i18n-html']) {
      const closeIdx = html.indexOf('</' + tag + '>', tagEnd);
      if (closeIdx >= 0) innerHTML = html.slice(tagEnd, closeIdx);
    }
    tags.push({
      tag,
      attrs,
      attrCount,
      text: html.slice(textStart, textEnd),
      innerHTML,
      start: tagStart,
      end: tagEnd
    });
  }
  return tags;
}

const elements = scanElements(rawHtml);

// 收集所有 i18n 绑定
const bindings = []; // { key, kind, value, tag, id }
const ATTR_KINDS = [
  ['data-i18n', 'text', 'text'],
  ['data-i18n-html', 'html', 'innerHTML'],
  ['data-i18n-title', 'title', 'title'],
  ['data-i18n-placeholder', 'placeholder', 'placeholder'],
  ['data-i18n-aria-label', 'attr', 'aria-label']
];

elements.forEach((el) => {
  const kindsOnEl = ATTR_KINDS.filter(([dataAttr]) => el.attrs[dataAttr] !== undefined);
  if (kindsOnEl.length > 1 && kindsOnEl.some(([d]) => d === 'data-i18n') && kindsOnEl.some(([d]) => d === 'data-i18n-html')) {
    ok(false, '元素同时声明 data-i18n 与 data-i18n-html（冲突）', JSON.stringify(el.attrs));
    return;
  }
  kindsOnEl.forEach(([dataAttr, kind, valueField]) => {
    const key = el.attrs[dataAttr];
    let value = '';
    if (kind === 'text') value = el.text;
    else if (kind === 'html') value = el.innerHTML;
    else if (kind === 'title') value = el.attrs.title || '';
    else if (kind === 'placeholder') value = el.attrs.placeholder || '';
    else if (kind === 'attr') value = el.attrs['aria-label'] || '';
    bindings.push({ key, kind, value, tag: el.tag, id: el.attrs.id || '', dataAttr });
  });
});

ok(bindings.length >= 80, 'index.html data-i18n* 绑定数量 >= 80', '实际=' + bindings.length);

const uniqueKeys = Array.from(new Set(bindings.map((b) => b.key)));
ok(uniqueKeys.length >= 80, 'index.html 唯一 i18n key 数量 >= 80', '实际=' + uniqueKeys.length);
console.log('     （扫描到 ' + bindings.length + ' 处绑定 / ' + uniqueKeys.length + ' 个唯一 key）');

// E1. 关键：en/zh 字典覆盖所有 key
const missingEn = [];
const missingZh = [];
const notString = [];
uniqueKeys.forEach((key) => {
  const en = MolI18n._dicts.en[key];
  const zh = MolI18n._dicts.zh[key];
  if (typeof en !== 'string' || en === '') missingEn.push(key);
  if (typeof zh !== 'string' || zh === '') missingZh.push(key);
  if ((en !== undefined && typeof en !== 'string') || (zh !== undefined && typeof zh !== 'string')) notString.push(key);
});
eq(missingEn.length, 0, '【关键】en 字典覆盖 index.html 全部 ' + uniqueKeys.length + ' 个 key', missingEn.join(', '));
eq(missingZh.length, 0, '【关键】zh 字典覆盖 index.html 全部 ' + uniqueKeys.length + ' 个 key', missingZh.join(', '));
eq(notString.length, 0, '所有字典值均为非空字符串', notString.join(', '));

// en/zh 字典 key 集合一致（排除本测试自己 register 的 test.* 探针 key）
const ownKeys = (dict) => Object.keys(dict).filter((k) => k.indexOf('test.') !== 0).sort();
const enKeys = ownKeys(MolI18n._dicts.en);
const zhKeys = ownKeys(MolI18n._dicts.zh);
deepEq(zhKeys, enKeys, 'en/zh 字典 key 集合完全一致（index.html 静态文案）');

// E2. en 字典与 DOM 初始英文文本完全一致（避免语言初始化闪烁）
const mismatches = [];
bindings.forEach((b) => {
  const enVal = MolI18n._dicts.en[b.key];
  if (typeof enVal !== 'string') return;
  if (b.kind === 'html') {
    if (normalize(enVal) !== normalize(b.value)) mismatches.push(b.key + ' (en-html 不一致: ' + normalize(enVal) + ' != ' + normalize(b.value) + ')');
  } else {
    if (normalize(enVal) !== normalize(b.value)) mismatches.push(b.key + ' (' + b.kind + ': "' + normalize(enVal) + '" != "' + normalize(b.value) + '")');
  }
});
eq(mismatches.length, 0, 'en 字典值与 index.html 初始英文文本一致（无切换闪烁）', mismatches.slice(0, 8).join(' | '));

// E3. 同一 key 多处使用时初始文本一致（无冲突）
const byKey = new Map();
bindings.forEach((b) => {
  if (!byKey.has(b.key)) byKey.set(b.key, []);
  byKey.get(b.key).push(b);
});
const conflicts = [];
byKey.forEach((list, key) => {
  const kinds = new Set(list.map((b) => b.kind));
  if (kinds.size > 1) {
    // 同 key 用作 text/html 之外的不同属性是允许的（title 与 text 不同），这里只检查同 kind 文本一致性
  }
  const values = new Set(list.map((b) => normalize(b.value)));
  if (values.size > 1) conflicts.push(key + ' => ' + JSON.stringify(Array.from(values)));
});
eq(conflicts.length, 0, '同一 key 多元素使用时初始文本一致（无重复 key 冲突）', conflicts.slice(0, 8).join(' | '));

// E4. 命名空间归属（i18n-dev 负责 index.html 静态文案）
const ALLOWED_NS = ['app.', 'toolbar.', 'tools.', 'panel.', 'info.', 'measure.', 'edit.', 'display.', 'hints.', 'empty.'];
const badNs = uniqueKeys.filter((k) => !ALLOWED_NS.some((ns) => k.indexOf(ns) === 0));
eq(badNs.length, 0, 'index.html key 均在 i18n-dev 命名空间内（未占用 ui/status/samples/results.*）', badNs.join(', '));

// E5. app.title 双语按契约
eq(MolI18n._dicts.en['app.title'], 'MolEdit — Molecular Editor', '字典 en app.title 按契约');
eq(MolI18n._dicts.zh['app.title'], 'MolEdit — 分子编辑器', '字典 zh app.title 按契约');

// E6. 语言按钮：en 下文字“中文”，zh 下 "EN"
const toggleBind = bindings.find((b) => b.key === 'toolbar.langToggle');
ok(!!toggleBind, 'index.html 存在 data-i18n="toolbar.langToggle"（语言按钮文字）');
if (toggleBind) {
  eq(normalize(toggleBind.value), '中文', '#lang-toggle 初始文字为“中文”（en 默认）');
  eq(MolI18n._dicts.zh['toolbar.langToggle'], 'EN', 'zh 字典 toolbar.langToggle === "EN"');
}

// E7. v2 新增 DOM id 必须存在
const htmlWithAttrs = rawHtml;
function hasId(id) {
  return new RegExp('id="' + id + '"').test(htmlWithAttrs);
}
const V2_IDS = ['lang-toggle', 'side-tabs', 'tab-molecule', 'tab-results', 'tab-page-molecule', 'tab-page-results', 'results-panel'];
V2_IDS.forEach((id) => ok(hasId(id), 'v2 DOM id 存在: #' + id));

// E8. v1 DOM id 全部保留
const V1_IDS = [
  'file-input', 'btn-open', 'sample-select', 'btn-undo', 'btn-redo',
  'btn-export-xyz', 'btn-export-gjf', 'btn-export-sdf',
  'tool-select', 'tool-rotate', 'tool-move-atom', 'tool-move-fragment', 'tool-pan',
  'viewport', 'viewport-canvas', 'viewport-overlay', 'empty-hint', 'empty-hint-sub',
  'viewport-hud', 'mouse-hint', 'toolbar', 'sidepanel', 'topbar', 'app',
  'mol-title', 'mol-format', 'dataset-select', 'dataset-label', 'atom-count', 'bond-count',
  'charge-input', 'multiplicity-input', 'selection-count', 'selection-list',
  'measure-distance', 'measure-angle', 'measure-dihedral',
  'bond-length-input', 'bond-length-move', 'btn-apply-bond-length',
  'angle-input', 'angle-move', 'btn-apply-angle',
  'dihedral-input', 'dihedral-move', 'btn-apply-dihedral',
  'style-select', 'toggle-labels', 'toggle-indices', 'toggle-axes',
  'btn-rebond', 'btn-clear-selection', 'btn-reset-view',
  'status-bar', 'error-banner'
];
const missingIds = V1_IDS.filter((id) => !hasId(id));
eq(missingIds.length, 0, 'v1 DOM id 全部保留（' + V1_IDS.length + ' 个）', missingIds.join(', '));

// E9. 结构：原有 5 个 section 在 #tab-page-molecule 内；#results-panel 在 #tab-page-results 内
const molPageStart = rawHtml.indexOf('id="tab-page-molecule"');
const molPageEnd = rawHtml.indexOf('id="tab-page-results"');
const resPanelIdx = rawHtml.indexOf('id="results-panel"');
const sideTabsIdx = rawHtml.indexOf('id="side-tabs"');
const langToggleIdx = rawHtml.indexOf('id="lang-toggle"');
ok(molPageStart > sideTabsIdx && langToggleIdx > 0, '#side-tabs 在 #tab-page-molecule 之前，且 #lang-toggle 在顶栏');
ok(molPageStart >= 0 && molPageEnd > molPageStart && resPanelIdx > molPageEnd, '#results-panel 位于 #tab-page-results 内');
const sectionCount = (rawHtml.slice(molPageStart, molPageEnd).match(/class="panel-section"/g) || []).length;
eq(sectionCount, 4, '#tab-page-molecule 内包含原有 4 个 panel-section（文件信息/选择/几何/显示）');
ok(/id="tab-molecule"[^>]*role="tab"/.test(rawHtml), '#tab-molecule 具有 role="tab"');
ok(/id="tab-results"[^>]*disabled/.test(rawHtml), '#tab-results 初始 disabled');
ok(/id="tab-results"[^>]*aria-selected="false"/.test(rawHtml), '#tab-results aria-selected="false"');
ok(/id="tab-molecule"[^>]*aria-selected="true"/.test(rawHtml), '#tab-molecule aria-selected="true"');
ok(/id="tab-page-results"[^>]*hidden/.test(rawHtml), '#tab-page-results 初始 hidden');
ok(/id="side-tabs"[^>]*role="tablist"/.test(rawHtml), '#side-tabs role="tablist"');

// E10. 加载顺序（INTERFACE2 §2）与 CSS 引用
const scriptSrcs = [];
const scriptRe = /<script\s+src="([^"]+)"><\/script>/g;
let sm;
while ((sm = scriptRe.exec(rawHtml)) !== null) scriptSrcs.push(sm[1]);
deepEq(scriptSrcs, [
  'js/core.js', 'js/parsers.js', 'js/gausslog.js', 'js/i18n.js',
  'js/renderer.js', 'js/samples.js', 'js/charts.js', 'js/results.js', 'js/ui.js'
], '脚本加载顺序严格按 INTERFACE2 §2（9 个经典脚本）');
const appCssIdx = rawHtml.indexOf('href="css/app.css"');
const resultsCssIdx = rawHtml.indexOf('href="css/results.css"');
ok(appCssIdx > 0 && resultsCssIdx > appCssIdx, 'css/results.css 在 css/app.css 之后引入');

// E11. <html lang="en"> 与 title
ok(/<html\s+lang="en"/.test(rawHtml), '<html lang="en">');
const titleMatch = /<title>([^<]*)<\/title>/.exec(rawHtml);
ok(!!titleMatch, '<title> 存在');
if (titleMatch) eq(normalize(titleMatch[1]), 'MolEdit — Molecular Editor', '<title> 初始为英文');

// E12. EN 初始静态可见文本无中文残留（#lang-toggle 除外，Lead 已裁决豁免）
const noComments = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noScripts = noComments.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const cjkViolations = [];
scanElements(noScripts).forEach((el) => {
  const txt = normalize(el.text);
  if (!txt || !CJK_RE.test(txt)) return;
  const isLangToggle = el.attrs.id === 'lang-toggle';
  if (isLangToggle && txt === '中文') return;
  cjkViolations.push('<' + el.tag + (el.attrs.id ? ' id=' + el.attrs.id : '') + '> ' + txt.slice(0, 40));
});
eq(cjkViolations.length, 0, 'EN 初始静态文本无中文残留（#lang-toggle 豁免）', cjkViolations.slice(0, 8).join(' | '));

// E13. 语言按钮的 title/aria 在 en/zh 均为对应语言
eq(MolI18n._dicts.en['toolbar.langToggleTitle'], 'Switch to Chinese', 'en 语言按钮 title 为英文');
eq(MolI18n._dicts.zh['toolbar.langToggleTitle'], '切换到英文', 'zh 语言按钮 title 为中文');
ok(!!MolI18n._dicts.en['toolbar.langToggleAria'] && !!MolI18n._dicts.zh['toolbar.langToggleAria'], '语言按钮 aria-label 双语齐全');

/* ========================================================================== *
 * F. 收尾
 * ========================================================================== */

// 清理全局注入
if (priorDocument === undefined) delete globalThis.document;
else globalThis.document = priorDocument;
if (priorStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = priorStorage;

section('F. 结果');
console.log('\n  ✅ 通过: ' + pass + '    ❌ 失败: ' + fail);
if (fail > 0) {
  console.log('\n失败明细：');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
}
console.log('\n🎉 i18n 测试全部通过（含 index.html ' + uniqueKeys.length + ' 个 key 的 en/zh 覆盖扫描）');
process.exit(0);
