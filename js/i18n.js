/* ============================================================================
 * MolEdit — js/i18n.js
 * 所有者：i18n-dev。契约：INTERFACE2.md §3（v2 权威）。
 *
 * 国际化引擎（经典脚本，零依赖，Node 可 require）：
 *   - 默认语言必须是 'en'（不读取浏览器语言）；语言选择持久化到 localStorage。
 *   - 本文件在加载时注册 index.html 静态文案的 en/zh 字典
 *     （命名空间：app.* / toolbar.* / tools.* / panel.* / info.* /
 *       measure.* / edit.* / display.* / hints.* / empty.*）。
 *   - 其它模块（ui.js / results.js 等）在自身加载时调用
 *     MolI18n.register('en'|'zh', {...}) 注册自己的命名空间。
 *
 * 全局：globalThis.MolI18n
 * ========================================================================== */
(function (root) {
  'use strict';

  var DEFAULT_LANG = 'en';
  var LANGS = Object.freeze(['en', 'zh']);
  var STORAGE_KEY = 'moledit.lang';
  var HTML_LANG = { en: 'en', zh: 'zh-CN' };

  /* --------------------------- 字典（index.html） --------------------------- */

  var EN = {
    /* 应用级 */
    'app.title': 'MolEdit — Molecular Editor',
    'app.brandSub': 'Molecular Editor',
    'app.ready': 'Ready',
    'app.errorCloseTitle': 'Click to close',

    /* 顶栏 */
    'toolbar.open': 'Open file',
    'toolbar.openTitle': 'Open a local file (.xyz / .sdf / .gjf / .log)',
    'toolbar.sampleTitle': 'Load a molecule from the sample library',
    'toolbar.sampleAria': 'Sample library',
    'toolbar.loadSample': 'Load sample…',
    'toolbar.undo': 'Undo',
    'toolbar.undoTitle': 'Undo (Ctrl+Z)',
    'toolbar.redo': 'Redo',
    'toolbar.redoTitle': 'Redo (Ctrl+Shift+Z / Ctrl+Y)',
    'toolbar.export': 'Export',
    'toolbar.exportXyzTitle': 'Export as XYZ file',
    'toolbar.exportGjfTitle': 'Export as Gaussian input file',
    'toolbar.exportSdfTitle': 'Export as SDF file',
    'toolbar.langToggle': '中文',
    'toolbar.langToggleTitle': 'Switch to Chinese',
    'toolbar.langToggleAria': 'Switch language',
    'toolbar.toolbarAria': 'Viewport tools',

    /* 工具竖栏 */
    'tools.select': 'Select',
    'tools.selectTitle': 'Select tool: click atoms / drag to rotate',
    'tools.rotate': 'Rotate',
    'tools.rotateTitle': 'Rotate tool: drag with the left button to rotate the view',
    'tools.moveAtom': 'Move atom',
    'tools.moveAtomTitle': 'Move atom: drag an atom (one drag = one undo step)',
    'tools.moveFragment': 'Move fragment',
    'tools.moveFragmentTitle': 'Move fragment: drag an atom to move its whole connected fragment',
    'tools.pan': 'Pan',
    'tools.panTitle': 'Pan tool: drag to pan the view',

    /* 右侧面板 / Tab */
    'panel.tabMolecule': 'Molecule',
    'panel.tabResults': 'Results',
    'panel.tabsAria': 'Sidebar tabs',
    'panel.fileInfo': 'File info',
    'panel.selection': 'Selection & measurements',
    'panel.geometry': 'Geometry editing',
    'panel.display': 'Display settings',
    'panel.sidepanelAria': 'Molecular info and editing panel',
    'panel.viewportAria': '3D molecular viewport',

    /* 文件信息 */
    'info.title': 'Title',
    'info.format': 'Format',
    'info.dataset': 'Dataset',
    'info.datasetAria': 'Dataset (frame)',
    'info.singleFrame': 'Single frame',
    'info.atoms': 'Atoms',
    'info.bonds': 'Bonds',
    'info.charge': 'Charge',
    'info.chargeAria': 'Total charge',
    'info.multiplicity': 'Multiplicity',
    'info.multiplicityAria': 'Spin multiplicity',

    /* 选择与测量 */
    'measure.selectionOrder': 'Selected atoms (click order)',
    'measure.noSelection': 'No atoms selected',
    'measure.distance': 'Bond length <em>d</em>',
    'measure.angle': 'Bond angle <em>∠</em>',
    'measure.dihedral': 'Dihedral angle <em>τ</em>',

    /* 几何编辑 */
    'edit.bondLengthTitle': 'Bond length',
    'edit.bondLengthHint': 'Select 2 atoms',
    'edit.targetLength': 'Target length (Å)',
    'edit.targetLengthPlaceholder': 'e.g. 1.2000',
    'edit.moveMode': 'Move mode',
    'edit.moveJ': 'Move atom 2 side',
    'edit.moveI': 'Move atom 1 side',
    'edit.moveSmaller': 'Move smaller fragment',
    'edit.applyBondLength': 'Apply bond length',
    'edit.bondAngleTitle': 'Bond angle',
    'edit.bondAngleHint': 'Select 3 atoms (2nd is the vertex)',
    'edit.targetAngle': 'Target angle (°)',
    'edit.targetAnglePlaceholder': 'e.g. 104.5200',
    'edit.moveK': 'Move atom 3 side',
    'edit.applyBondAngle': 'Apply bond angle',
    'edit.dihedralTitle': 'Dihedral angle',
    'edit.dihedralHint': 'Select 4 atoms (axis is 2–3)',
    'edit.targetDihedralPlaceholder': 'e.g. 60.0000',
    'edit.moveL': 'Rotate atom 4 side',
    'edit.moveA': 'Rotate atom 1 side',
    'edit.rotateSmaller': 'Rotate smaller fragment',
    'edit.applyDihedral': 'Apply dihedral angle',

    /* 显示设置 */
    'display.style': 'Display style',
    'display.ballstick': 'Ball & stick',
    'display.spacefill': 'Spacefill',
    'display.stick': 'Stick',
    'display.wireframe': 'Wireframe',
    'display.labels': 'Element symbols',
    'display.indices': 'Atom indices',
    'display.axes': 'Axes',
    'display.rebond': 'Re-infer bonds',
    'display.clearSelection': 'Clear selection',
    'display.resetView': 'Reset view',
    'display.resetViewTitle': 'Reset view (F)',

    /* 提示 / 空状态 */
    'hints.mouse': 'Click to select atoms · Shift to add · Drag to rotate · Scroll to zoom',
    'hints.keyboard': 'Shortcuts: Ctrl+Z undo · Ctrl+Shift+Z / Ctrl+Y redo · Esc clear selection · F reset view',
    'empty.title': 'Open an .xyz / .sdf / .gjf / .log file, or load one from the sample library',
    'empty.sub': 'Supports XYZ, SDF, Gaussian input and output files · Multi-frame datasets supported'
  };

  var ZH = {
    /* 应用级 */
    'app.title': 'MolEdit — 分子编辑器',
    'app.brandSub': '分子编辑器',
    'app.ready': '就绪',
    'app.errorCloseTitle': '点击关闭',

    /* 顶栏 */
    'toolbar.open': '打开文件',
    'toolbar.openTitle': '打开本地文件（.xyz / .sdf / .gjf / .log）',
    'toolbar.sampleTitle': '从示例库加载分子',
    'toolbar.sampleAria': '示例库',
    'toolbar.loadSample': '加载示例…',
    'toolbar.undo': '撤销',
    'toolbar.undoTitle': '撤销（Ctrl+Z）',
    'toolbar.redo': '重做',
    'toolbar.redoTitle': '重做（Ctrl+Shift+Z / Ctrl+Y）',
    'toolbar.export': '导出',
    'toolbar.exportXyzTitle': '导出为 XYZ 文件',
    'toolbar.exportGjfTitle': '导出为 Gaussian 输入文件',
    'toolbar.exportSdfTitle': '导出为 SDF 文件',
    'toolbar.langToggle': 'EN',
    'toolbar.langToggleTitle': '切换到英文',
    'toolbar.langToggleAria': '切换语言',
    'toolbar.toolbarAria': '视口工具',

    /* 工具竖栏 */
    'tools.select': '选择',
    'tools.selectTitle': '选择工具：点选原子 / 拖动旋转',
    'tools.rotate': '旋转',
    'tools.rotateTitle': '旋转工具：左键拖动旋转视图',
    'tools.moveAtom': '移原子',
    'tools.moveAtomTitle': '移动原子：按住原子拖动（一次拖动一步撤销）',
    'tools.moveFragment': '移片段',
    'tools.moveFragmentTitle': '移动片段：按住原子拖动整个连通片段',
    'tools.pan': '平移',
    'tools.panTitle': '平移工具：拖动平移视图',

    /* 右侧面板 / Tab */
    'panel.tabMolecule': '分子',
    'panel.tabResults': '结果',
    'panel.tabsAria': '侧栏标签页',
    'panel.fileInfo': '文件信息',
    'panel.selection': '选择与测量',
    'panel.geometry': '几何编辑',
    'panel.display': '显示设置',
    'panel.sidepanelAria': '分子信息与编辑面板',
    'panel.viewportAria': '3D 分子视口',

    /* 文件信息 */
    'info.title': '标题',
    'info.format': '格式',
    'info.dataset': '数据集',
    'info.datasetAria': '数据集（帧）',
    'info.singleFrame': '单帧',
    'info.atoms': '原子数',
    'info.bonds': '键数',
    'info.charge': '电荷',
    'info.chargeAria': '总电荷',
    'info.multiplicity': '多重度',
    'info.multiplicityAria': '自旋多重度',

    /* 选择与测量 */
    'measure.selectionOrder': '已选原子（点击顺序）',
    'measure.noSelection': '未选择原子',
    'measure.distance': '键长 <em>d</em>',
    'measure.angle': '键角 <em>∠</em>',
    'measure.dihedral': '二面角 <em>τ</em>',

    /* 几何编辑 */
    'edit.bondLengthTitle': '键长',
    'edit.bondLengthHint': '选择 2 个原子',
    'edit.targetLength': '目标长度（Å）',
    'edit.targetLengthPlaceholder': '例如 1.2000',
    'edit.moveMode': '移动方式',
    'edit.moveJ': '移动原子2一侧',
    'edit.moveI': '移动原子1一侧',
    'edit.moveSmaller': '移动较小片段',
    'edit.applyBondLength': '应用键长',
    'edit.bondAngleTitle': '键角',
    'edit.bondAngleHint': '选择 3 个原子（第 2 个为顶点）',
    'edit.targetAngle': '目标角度（°）',
    'edit.targetAnglePlaceholder': '例如 104.5200',
    'edit.moveK': '移动原子3一侧',
    'edit.applyBondAngle': '应用键角',
    'edit.dihedralTitle': '二面角',
    'edit.dihedralHint': '选择 4 个原子（轴为 2-3）',
    'edit.targetDihedralPlaceholder': '例如 60.0000',
    'edit.moveL': '旋转原子4一侧',
    'edit.moveA': '旋转原子1一侧',
    'edit.rotateSmaller': '旋转较小片段',
    'edit.applyDihedral': '应用二面角',

    /* 显示设置 */
    'display.style': '显示样式',
    'display.ballstick': '球棍模型',
    'display.spacefill': '空间填充',
    'display.stick': '棍状',
    'display.wireframe': '线框',
    'display.labels': '元素符号',
    'display.indices': '原子序号',
    'display.axes': '坐标轴',
    'display.rebond': '重新推断化学键',
    'display.clearSelection': '清除选择',
    'display.resetView': '重置视角',
    'display.resetViewTitle': '重置视角（F）',

    /* 提示 / 空状态 */
    'hints.mouse': '左键选择原子 · Shift 追加 · 拖动旋转 · 滚轮缩放',
    'hints.keyboard': '快捷键：Ctrl+Z 撤销 · Ctrl+Shift+Z / Ctrl+Y 重做 · Esc 清除选择 · F 重置视角',
    'empty.title': '打开 .xyz / .sdf / .gjf / .log 文件，或从示例库加载',
    'empty.sub': '支持 XYZ、SDF、Gaussian 输入与输出文件 · 支持多帧数据集'
  };

  /* ------------------------------- 内部状态 ------------------------------- */

  var dicts = { en: {}, zh: {} };
  var currentLang = DEFAULT_LANG;
  var listeners = [];
  var attrBindings = [
    { data: 'data-i18n-title', attr: 'title' },
    { data: 'data-i18n-placeholder', attr: 'placeholder' },
    { data: 'data-i18n-aria-label', attr: 'aria-label' }
  ];

  function isLang(lang) {
    return typeof lang === 'string' && LANGS.indexOf(lang) >= 0;
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /* ------------------------------- 存储 ------------------------------- */

  function getStorage() {
    try {
      var s = root.localStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    } catch (e) { /* 隐私模式 / 禁用时忽略 */ }
    return null;
  }

  function readStoredLang() {
    var s = getStorage();
    if (!s) return null;
    try {
      var v = s.getItem(STORAGE_KEY);
      return isLang(v) ? v : null;
    } catch (e) { return null; }
  }

  function writeStoredLang(lang) {
    var s = getStorage();
    if (!s) return;
    try { s.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  /* ------------------------------- 文档 ------------------------------- */

  function getDocument() {
    try {
      if (typeof document !== 'undefined' && document) return document;
    } catch (e) { /* ignore */ }
    return null;
  }

  function queryAll(scope, selector) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];
    try { return scope.querySelectorAll(selector); } catch (e) { return []; }
  }

  function eachNode(list, fn) {
    if (!list) return;
    var i;
    if (typeof list.length === 'number') {
      for (i = 0; i < list.length; i++) {
        try { fn(list[i]); } catch (e) { /* 单个节点失败不影响整体 */ }
      }
    }
  }

  function attrOf(el, name) {
    try {
      if (el && typeof el.getAttribute === 'function') return el.getAttribute(name);
    } catch (e) { /* ignore */ }
    return null;
  }

  function translateElement(el) {
    if (!el || typeof el !== 'object') return;
    var key = attrOf(el, 'data-i18n');
    if (key && has(key)) {
      try { el.textContent = t(key); } catch (e) { /* ignore */ }
    }
    var htmlKey = attrOf(el, 'data-i18n-html');
    if (htmlKey && has(htmlKey)) {
      try { el.innerHTML = t(htmlKey); } catch (e) { /* ignore */ }
    }
    for (var i = 0; i < attrBindings.length; i++) {
      var bind = attrBindings[i];
      var k = attrOf(el, bind.data);
      if (!k || !has(k)) continue;
      try {
        if (typeof el.setAttribute === 'function') el.setAttribute(bind.attr, t(k));
      } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------- 引擎 API ------------------------------- */

  function lookup(lang, key) {
    var d = dicts[lang];
    if (d && own(d, key)) return d[key];
    return undefined;
  }

  function interpolate(template, params) {
    if (!params || typeof params !== 'object') return template;
    return String(template).replace(/\{([^{}]+)\}/g, function (m, name) {
      if (own(params, name)) {
        var v = params[name];
        if (v === null || v === undefined) return m;
        return String(v);
      }
      return m;
    });
  }

  function t(key, params) {
    if (key === null || key === undefined) return '';
    var k = String(key);
    var value = lookup(currentLang, k);
    if (value === undefined) value = lookup(DEFAULT_LANG, k);
    if (value === undefined) value = k;
    if (typeof value !== 'string') value = String(value);
    return interpolate(value, params);
  }

  function has(key) {
    if (typeof key !== 'string') return false;
    return lookup(currentLang, key) !== undefined || lookup(DEFAULT_LANG, key) !== undefined;
  }

  function register(lang, dict) {
    if (!isLang(lang) || !dict || typeof dict !== 'object') return;
    var target = dicts[lang];
    for (var k in dict) {
      if (!own(dict, k)) continue;
      var v = dict[k];
      if (typeof v === 'string') target[k] = v;
    }
  }

  function notify(lang) {
    var list = listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](lang); } catch (e) { /* 回调异常不阻断其它监听者 */ }
    }
  }

  function applyDocument() {
    var doc = getDocument();
    if (!doc) return;
    var docEl = doc.documentElement;
    if (docEl && typeof docEl.setAttribute === 'function') {
      try { docEl.setAttribute('lang', HTML_LANG[currentLang] || currentLang); } catch (e) { /* ignore */ }
    }
    if (has('app.title')) {
      try { doc.title = t('app.title'); } catch (e) { /* ignore */ }
    }
    translateDOM(doc);
  }

  function translateDOM(rootNode) {
    var doc = getDocument();
    var scope = rootNode || doc;
    if (!scope) return;

    // root 自身也参与翻译（Element.querySelectorAll 不含自身）
    if (scope !== doc) translateElement(scope);

    eachNode(queryAll(scope, '[data-i18n]'), function (el) {
      var key = attrOf(el, 'data-i18n');
      if (!key || !has(key)) return;
      try { el.textContent = t(key); } catch (e) { /* ignore */ }
    });
    eachNode(queryAll(scope, '[data-i18n-html]'), function (el) {
      var key = attrOf(el, 'data-i18n-html');
      if (!key || !has(key)) return;
      try { el.innerHTML = t(key); } catch (e) { /* ignore */ }
    });
    for (var i = 0; i < attrBindings.length; i++) {
      (function (bind) {
        eachNode(queryAll(scope, '[' + bind.data + ']'), function (el) {
          var key = attrOf(el, bind.data);
          if (!key || !has(key)) return;
          try {
            if (typeof el.setAttribute === 'function') el.setAttribute(bind.attr, t(key));
          } catch (e) { /* ignore */ }
        });
      })(attrBindings[i]);
    }
  }

  function init(opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var stored = readStoredLang();
    var fallback = isLang(options.defaultLang) ? options.defaultLang : DEFAULT_LANG;
    currentLang = stored || fallback;
    applyDocument();
    return currentLang;
  }

  function getLang() {
    return currentLang;
  }

  function setLang(lang) {
    if (!isLang(lang)) return;
    currentLang = lang;
    writeStoredLang(lang);
    applyDocument();
    notify(lang);
  }

  function toggleLang() {
    setLang(currentLang === 'en' ? 'zh' : 'en');
    return currentLang;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    var active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      var idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  /* ------------------------------- 模块导出 ------------------------------- */

  var MolI18n = {
    DEFAULT_LANG: DEFAULT_LANG,
    LANGS: LANGS,
    STORAGE_KEY: STORAGE_KEY,
    init: init,
    getLang: getLang,
    setLang: setLang,
    toggleLang: toggleLang,
    onChange: onChange,
    register: register,
    t: t,
    has: has,
    translateDOM: translateDOM
  };

  // 测试用只读字典视图（不可枚举，不属于公共 API；tests/i18n.test.mjs 用来
  // 校验 index.html 所有 key 在 en/zh 两种语言下都有译文）。
  Object.defineProperty(MolI18n, '_dicts', {
    value: dicts,
    enumerable: false,
    writable: false,
    configurable: false
  });

  // 本文件自带 index.html 静态文案字典，加载即注册（其它模块随后各自 register）
  register('en', EN);
  register('zh', ZH);

  root.MolI18n = MolI18n;
  if (typeof module === 'object' && module && module.exports) module.exports = MolI18n;
})(typeof globalThis !== 'undefined' ? globalThis : this);
