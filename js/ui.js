/* ============================================================================
 * MolEdit — 界面与交互（GaussView 风格）
 * 所有者：ui-dev。契约：INTERFACE.md §8 + INTERFACE2.md §8（v2）。
 * 依赖（只读，按 INTERFACE2.md §2 顺序先于本文件加载）：
 *   MolCore、MolGaussLog、MolI18n、MolRender、MolSamples、MolResults
 * 本文件是经典脚本，向 globalThis 挂载 window.MolApp（INTERFACE2.md §8.3）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '2.0.0';
  var MAX_SELECTION = 4;
  var MAX_UNDO = 50;

  var TOOL_LIST = ['select', 'rotate', 'move-atom', 'move-fragment', 'pan'];
  var TOOL_NAME_KEYS = {
    'select': 'ui.toolSelect',
    'rotate': 'ui.toolRotate',
    'move-atom': 'ui.toolMoveAtom',
    'move-fragment': 'ui.toolMoveFragment',
    'pan': 'ui.toolPan'
  };
  var STYLE_ALLOWED = ['ballstick', 'spacefill', 'stick', 'wireframe'];
  var STYLE_NAME_KEYS = {
    'ballstick': 'ui.styleBallstick',
    'spacefill': 'ui.styleSpacefill',
    'stick': 'ui.styleStick',
    'wireframe': 'ui.styleWireframe'
  };
  var OPTION_KEYS = ['labels', 'indices', 'showAxes', 'bondWidth', 'background',
    'selectionColor', 'hoverColor', 'measurementColor', 'labelMinScreenRadius'];

  /* ====================================================================
   * i18n 字典（命名空间 ui. / status. / samples.，i18n-dev 的 MolI18n 负责合并）
   * 同时作为 js/i18n.js 未就绪时的本地回退字典。
   * ==================================================================== */

  var I18N_EN = {
    /* 语言切换按钮 */
    'ui.langButtonZh': '中文',
    'ui.langButtonEn': 'EN',
    'ui.langSwitchToZh': 'Switch to Chinese',
    'ui.langSwitchToEn': 'Switch to English',

    /* 工具 / 样式 / 显示选项 */
    'ui.toolSelect': 'Select',
    'ui.toolRotate': 'Rotate',
    'ui.toolMoveAtom': 'Move atom',
    'ui.toolMoveFragment': 'Move fragment',
    'ui.toolPan': 'Pan',
    'ui.styleBallstick': 'Ball and stick',
    'ui.styleSpacefill': 'Spacefill',
    'ui.styleStick': 'Stick',
    'ui.styleWireframe': 'Wireframe',
    'ui.optionLabels': 'Element labels',
    'ui.optionIndices': 'Atom indices',
    'ui.optionShowAxes': 'Axes',
    'ui.optionShown': '{option}: shown',
    'ui.optionHidden': '{option}: hidden',

    /* 选择 / 数据集 / HUD */
    'ui.selectionNoMolecule': 'No molecule loaded',
    'ui.selectionEmpty': 'No atoms selected (click atoms in the viewport)',
    'ui.selectionItem': '{order}. {symbol} #{index}',
    'ui.datasetFrame': 'Frame {i}/{n}',
    'ui.datasetSingle': 'Single frame',
    'ui.hud': '{title} · {format} · {atoms} atoms / {bonds} bonds',
    'ui.hudFrame': ' · {i}/{n}',
    'ui.statusCounts': 'Atoms {atoms}  ·  Bonds {bonds}  ·  Selected {selected}',

    /* 鼠标提示 */
    'ui.hintSelect': 'Left click to select · Shift to add · Drag to rotate · Wheel to zoom · Shift+drag / middle drag to pan',
    'ui.hintRotate': 'Drag to rotate · Click an atom to select · Wheel to zoom · Shift+drag / middle drag to pan',
    'ui.hintMoveAtom': 'Drag an atom to move it · Drag empty space to rotate · Wheel to zoom',
    'ui.hintMoveFragment': 'Drag an atom to move its fragment · Drag empty space to rotate · Wheel to zoom',
    'ui.hintPan': 'Drag to pan the view · Wheel to zoom',

    /* 依赖缺失提示 */
    'ui.depsMissingHint': '⚠ Some dependency scripts are missing: {list}',
    'ui.listSeparator': ', ',

    /* 状态栏 */
    'status.ready': 'Ready — open a file or load a sample',
    'status.tool': 'Active tool: {tool}',
    'status.maxSelection': 'At most {max} atoms can be selected',
    'status.selectionCleared': 'Selection cleared',
    'status.loaded': 'Loaded {file} ({format}, {atoms} atoms)',
    'status.loadedFrames': ', {n} frames',
    'status.loadedWarnings': '; warnings: {warnings}',
    'status.sampleLoaded': 'Sample loaded: {name} · {format} · {atoms} atoms / {bonds} bonds',
    'status.sampleLoadedFrames': ' · {n} frames',
    'status.undone': 'Undone',
    'status.redone': 'Redone',
    'status.exported': 'Exported {file}',
    'status.style': 'Display style: {style}',
    'status.viewReset': 'View reset',
    'status.noRenderer': '3D renderer not loaded; cannot reset the view',
    'status.rebonded': 'Rebonded: {n} bonds',
    'status.datasetSwitched': 'Switched to frame {i}/{n}',
    'status.movedAtom': 'Moved atom(s): {n}',
    'status.movedFragment': 'Moved fragment(s): {n}',
    'status.bondLengthSet': 'Bond length set to {value} Å (was {before} Å)',
    'status.angleSet': 'Bond angle set to {value}° (was {before}°)',
    'status.dihedralSet': 'Bond dihedral set to {value}° (was {before}°)',
    'status.chargeChanged': 'Charge changed to {value}',
    'status.multiplicityChanged': 'Multiplicity changed to {value}',
    'status.error': 'Error: {msg}',
    'status.langChanged': 'Language: English',
    'status.tabMolecule': 'Sidebar: Molecule',
    'status.tabResults': 'Sidebar: Results',

    /* 错误（本地化后展示，解析器抛出的消息除外） */
    'ui.errUnknown': 'Unknown error',
    'ui.errUntitled': 'Untitled molecule',
    'ui.errNotLoaded': 'No molecule loaded. Open a file or load a sample first.',
    'ui.errAtomInt': 'Atom index must be an integer',
    'ui.errAtomRange': 'Atom index out of range: {index}',
    'ui.errAtomsArray': 'atoms must be an array of atom indices',
    'ui.errAtomsDuplicate': 'Selected atoms must not repeat',
    'ui.errNeedAtoms': '{need} atoms required (currently {have}). Select them in the viewport first.',
    'ui.errBadTool': 'Unknown tool: {tool}',
    'ui.errBadStyle': 'Unknown display style: {style}',
    'ui.errBadOption': 'Unknown display option: {key}',
    'ui.errBadDatasetIndex': 'Dataset index must be an integer',
    'ui.errDatasetRange': 'Dataset index out of range: {index}',
    'ui.errParserMissing': 'Parser module not loaded (js/parsers.js missing); cannot open files',
    'ui.errNoMoleculesParsed': 'No molecule data found in the file',
    'ui.errNotText': 'File content must be text',
    'ui.errEmptyFile': 'File is empty',
    'ui.errNoAtomsInFile': 'Molecules in the file contain no atoms',
    'ui.errTextData': 'text data',
    'ui.errSamplesMissing': 'Sample library not loaded (js/samples.js missing)',
    'ui.errSampleNotFound': 'Sample not found: {key}',
    'ui.errSampleBadFormat': 'Unrecognized sample data format: {key}',
    'ui.errSampleKey': 'Sample key must not be empty',
    'ui.errSampleNoData': 'Sample “{name}” has no molecule data',
    'ui.errNoFile': 'No file selected',
    'ui.errReadFile': 'Failed to read file: {msg}',
    'ui.errCoreMissing': 'Core module not loaded (js/core.js missing)',
    'ui.errMeasureEditMissing': 'Core module is missing measure/edit implementation',
    'ui.errLengthNumber': 'Bond length must be a valid number',
    'ui.errLengthPositive': 'Bond length must be greater than 0 Å',
    'ui.errSetLength': 'Failed to set bond length: {msg}',
    'ui.errAngleNumber': 'Bond angle must be a valid number',
    'ui.errAngleRange': 'Bond angle must be between 0° and 180° (exclusive)',
    'ui.errSetAngle': 'Failed to set bond angle: {msg}',
    'ui.errDihedralNumber': 'Dihedral angle must be a valid number',
    'ui.errSetDihedral': 'Failed to set dihedral: {msg}',
    'ui.errRebondMissing': 'Core module has no rebond implementation',
    'ui.errExportFormat': 'Unsupported export format: {format}',
    'ui.errExportModule': 'Export module not loaded (MolCore.export.{fmt} missing)',
    'ui.errExportEmpty': 'Export failed: no text generated',
    'ui.errChargeInt': 'Charge must be an integer',
    'ui.errMultiplicityInt': 'Multiplicity must be an integer ≥ 1',
    'ui.errScript': 'Script error: {msg}',
    'ui.errDepsMissing': 'Dependency scripts not fully loaded: {list}. The UI is still usable, but related features are unavailable.',
    'ui.errBadTab': 'Unknown sidebar tab: {name}',
    'ui.errResultsUnavailable': 'No calculation results available for this file',
    'ui.errResultsPanelMissing': 'Results panel is not available',
    'ui.errNoFrequencies': 'No frequency modes to animate',
    'ui.errFrequencyMode': 'Invalid frequency mode index: {index}',
    'ui.errAmplitude': 'Amplitude must be a valid number',
    'ui.errLangInvalid': 'Unsupported language: {lang}',

    /* 示例库 */
    'samples.placeholder': 'Load a sample…',
    'samples.unavailable': 'Sample library unavailable'
  };

  var I18N_ZH = {
    'ui.langButtonZh': '中文',
    'ui.langButtonEn': 'EN',
    'ui.langSwitchToZh': '切换到中文',
    'ui.langSwitchToEn': '切换到英文',

    'ui.toolSelect': '选择',
    'ui.toolRotate': '旋转',
    'ui.toolMoveAtom': '移动原子',
    'ui.toolMoveFragment': '移动片段',
    'ui.toolPan': '平移',
    'ui.styleBallstick': '球棍模型',
    'ui.styleSpacefill': '空间填充',
    'ui.styleStick': '棍状',
    'ui.styleWireframe': '线框',
    'ui.optionLabels': '元素符号',
    'ui.optionIndices': '原子序号',
    'ui.optionShowAxes': '坐标轴',
    'ui.optionShown': '{option}：显示',
    'ui.optionHidden': '{option}：隐藏',

    'ui.selectionNoMolecule': '未加载分子',
    'ui.selectionEmpty': '未选择原子（点击视口中的原子）',
    'ui.selectionItem': '{order}. {symbol} #{index}',
    'ui.datasetFrame': '帧 {i}/{n}',
    'ui.datasetSingle': '单帧',
    'ui.hud': '{title} · {format} · {atoms} 原子 / {bonds} 键',
    'ui.hudFrame': ' · {i}/{n}',
    'ui.statusCounts': '原子 {atoms}  ·  键 {bonds}  ·  选中 {selected}',

    'ui.hintSelect': '左键选择原子 · Shift 追加选择 · 拖动旋转 · 滚轮缩放 · Shift+拖动/中键平移',
    'ui.hintRotate': '拖动旋转视图 · 单击原子选择 · 滚轮缩放 · Shift+拖动/中键平移',
    'ui.hintMoveAtom': '按住原子拖动可移动单个原子 · 拖动空白旋转 · 滚轮缩放',
    'ui.hintMoveFragment': '按住原子拖动可移动所在片段 · 拖动空白旋转 · 滚轮缩放',
    'ui.hintPan': '拖动平移视图 · 滚轮缩放',

    'ui.depsMissingHint': '⚠ 部分依赖脚本缺失：{list}',
    'ui.listSeparator': '、',

    'status.ready': '就绪 —— 请打开文件或从示例库加载分子',
    'status.tool': '当前工具：{tool}',
    'status.maxSelection': '最多选择 {max} 个原子',
    'status.selectionCleared': '已清除选择',
    'status.loaded': '已加载 {file}（{format}，{atoms} 原子）',
    'status.loadedFrames': '，共 {n} 帧',
    'status.loadedWarnings': '；警告：{warnings}',
    'status.sampleLoaded': '已加载示例：{name} · {format} · {atoms} 原子 / {bonds} 键',
    'status.sampleLoadedFrames': ' · 共 {n} 帧',
    'status.undone': '已撤销',
    'status.redone': '已重做',
    'status.exported': '已导出 {file}',
    'status.style': '显示样式：{style}',
    'status.viewReset': '视角已重置',
    'status.noRenderer': '3D 渲染器未加载，无法重置视角',
    'status.rebonded': '已重新推断化学键：{n} 条',
    'status.datasetSwitched': '已切换到 {i}/{n} 帧',
    'status.movedAtom': '已移动原子（{n} 个原子）',
    'status.movedFragment': '已移动片段（{n} 个原子）',
    'status.bondLengthSet': '键长已设为 {value} Å（原 {before} Å）',
    'status.angleSet': '键角已设为 {value}°（原 {before}°）',
    'status.dihedralSet': '二面角已设为 {value}°（原 {before}°）',
    'status.chargeChanged': '电荷已改为 {value}',
    'status.multiplicityChanged': '多重度已改为 {value}',
    'status.error': '错误：{msg}',
    'status.langChanged': '语言：中文',
    'status.tabMolecule': '侧栏：分子',
    'status.tabResults': '侧栏：结果',

    'ui.errUnknown': '未知错误',
    'ui.errUntitled': '未命名分子',
    'ui.errNotLoaded': '尚未加载分子，请先打开文件或从示例库加载',
    'ui.errAtomInt': '原子序号必须为整数',
    'ui.errAtomRange': '原子序号超出范围：{index}',
    'ui.errAtomsArray': 'atoms 参数必须是原子序号数组',
    'ui.errAtomsDuplicate': '选择的原子不能重复',
    'ui.errNeedAtoms': '需要 {need} 个原子（当前 {have} 个），请先在视口中选择',
    'ui.errBadTool': '未知工具：{tool}',
    'ui.errBadStyle': '未知显示样式：{style}',
    'ui.errBadOption': '未知显示选项：{key}',
    'ui.errBadDatasetIndex': '数据集序号必须为整数',
    'ui.errDatasetRange': '数据集序号超出范围：{index}',
    'ui.errParserMissing': '解析模块未加载（js/parsers.js 缺失），无法打开文件',
    'ui.errNoMoleculesParsed': '未能从文件中解析出任何分子数据',
    'ui.errNotText': '文件内容必须为文本',
    'ui.errEmptyFile': '文件内容为空',
    'ui.errNoAtomsInFile': '文件中的分子没有任何原子',
    'ui.errTextData': '文本数据',
    'ui.errSamplesMissing': '示例库未加载（js/samples.js 缺失）',
    'ui.errSampleNotFound': '未找到示例：{key}',
    'ui.errSampleBadFormat': '示例数据格式无法识别：{key}',
    'ui.errSampleKey': '示例 key 不能为空',
    'ui.errSampleNoData': '示例“{name}”没有可用的分子数据',
    'ui.errNoFile': '未选择文件',
    'ui.errReadFile': '读取文件失败：{msg}',
    'ui.errCoreMissing': '核心模块未加载（js/core.js 缺失）',
    'ui.errMeasureEditMissing': '核心模块缺少 measure/edit 实现',
    'ui.errLengthNumber': '键长必须是有效数字',
    'ui.errLengthPositive': '键长必须大于 0 Å',
    'ui.errSetLength': '设置键长失败：{msg}',
    'ui.errAngleNumber': '键角必须是有效数字',
    'ui.errAngleRange': '键角必须在 0°–180° 之间（不含端点）',
    'ui.errSetAngle': '设置键角失败：{msg}',
    'ui.errDihedralNumber': '二面角必须是有效数字',
    'ui.errSetDihedral': '设置二面角失败：{msg}',
    'ui.errRebondMissing': '核心模块未提供 rebond 实现',
    'ui.errExportFormat': '不支持的导出格式：{format}',
    'ui.errExportModule': '导出模块未加载（MolCore.export.{fmt} 缺失）',
    'ui.errExportEmpty': '导出失败：未生成文本内容',
    'ui.errChargeInt': '电荷必须为整数',
    'ui.errMultiplicityInt': '多重度必须为 ≥ 1 的整数',
    'ui.errScript': '脚本错误：{msg}',
    'ui.errDepsMissing': '依赖脚本未完整加载：{list}。界面仍可使用，但相关功能不可用。',
    'ui.errBadTab': '未知侧栏标签：{name}',
    'ui.errResultsUnavailable': '当前文件没有可用的计算结果',
    'ui.errResultsPanelMissing': '结果面板不可用',
    'ui.errNoFrequencies': '没有可播放的频率模式',
    'ui.errFrequencyMode': '无效的频率模式序号：{index}',
    'ui.errAmplitude': '振幅必须是有效数字',
    'ui.errLangInvalid': '不支持的语言：{lang}',

    'samples.placeholder': '加载示例…',
    'samples.unavailable': '示例库不可用'
  };

  /* ------------------------------ i18n 辅助 ------------------------------ */

  function i18nApi() { return global.MolI18n || null; }

  function interpolate(text, params) {
    if (params == null) return String(text);
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (all, name) {
      return (params[name] == null) ? all : String(params[name]);
    });
  }

  /** 可见文案：优先 MolI18n，其次 ui.js 内置字典（保证 i18n.js 未就绪时也工作）。 */
  function t(key, params) {
    var I = i18nApi();
    if (I && typeof I.t === 'function') {
      try {
        var value = I.t(key, params);
        if (value != null && value !== key) return String(value);
      } catch (err) { /* 回退 */ }
    }
    var dict = (state.lang === 'zh') ? I18N_ZH : I18N_EN;
    var fallback = dict[key];
    if (fallback == null) fallback = I18N_EN[key];
    if (fallback == null) fallback = I18N_ZH[key];
    if (fallback == null) fallback = key;
    return interpolate(fallback, params);
  }

  function registerI18n() {
    var I = i18nApi();
    if (!I || typeof I.register !== 'function') return false;
    try {
      I.register('en', I18N_EN);
      I.register('zh', I18N_ZH);
      return true;
    } catch (err) {
      if (global.console && console.warn) console.warn('[MolApp] MolI18n.register 失败：', err);
      return false;
    }
  }

  function initI18n() {
    registerI18n();
    var I = i18nApi();
    if (I && typeof I.init === 'function') {
      try {
        var lang = I.init({ defaultLang: 'en' });
        state.lang = (lang === 'zh') ? 'zh' : 'en';
      } catch (err) {
        state.lang = 'en';
      }
      if (typeof I.onChange === 'function') {
        try { I.onChange(handleLanguageChange); } catch (err) { /* 忽略 */ }
      }
    } else {
      // js/i18n.js 未就绪：内置字典 + 默认英文，保证 EN/LTR 界面可用
      state.lang = 'en';
      try {
        if (document.documentElement) document.documentElement.setAttribute('lang', 'en');
      } catch (err) { /* 忽略 */ }
    }
    updateLangButton();
  }

  function handleLanguageChange(lang) {
    var next = (lang === 'zh') ? 'zh' : 'en';
    if (next === state.lang) {
      // 仍需刷新一次（例如字典稍后才就绪）
      updateLangButton();
      return;
    }
    state.lang = next;
    updateLangButton();
    // 状态栏若记录的是示例名，按新语言重新解析（示例名 name/nameEn 不同）
    if (state.status && state.status.parts && state.status.parts[0] && state.status.parts[0].key === 'status.sampleLoaded' && state.sampleKey != null) {
      for (var i = 0; i < state.samples.length; i++) {
        if (state.samples[i].key === state.sampleKey) {
          state.status.parts[0].params = state.status.parts[0].params || {};
          state.status.parts[0].params.name = sampleDisplayName(state.samples[i]);
          break;
        }
      }
    }
    populateSampleSelect();
    refreshAll();
    updateMouseHint();
    updateDepsMissingHint();
    if (state.resultsPanel && typeof state.resultsPanel.refreshLanguage === 'function') {
      try { state.resultsPanel.refreshLanguage(); } catch (err) { /* 忽略 */ }
    }
  }

  function updateLangButton() {
    var btn = refs.langToggle;
    if (!btn) return;
    var toZh = state.lang === 'en';
    btn.textContent = toZh ? t('ui.langButtonZh') : t('ui.langButtonEn');
    var label = toZh ? t('ui.langSwitchToZh') : t('ui.langSwitchToEn');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function toggleLanguage() {
    var I = i18nApi();
    if (I && typeof I.toggleLang === 'function') {
      try {
        var lang = I.toggleLang();
        if (lang === 'zh' || lang === 'en') {
          if (lang === state.lang) handleLanguageChange(lang);
          else handleLanguageChange(lang);
          return;
        }
      } catch (err) { /* 回退到本地切换 */ }
    }
    handleLanguageChange(state.lang === 'en' ? 'zh' : 'en');
  }

  function setLanguageApi(lang) {
    var next = String(lang || '').toLowerCase();
    if (next !== 'en' && next !== 'zh') throw new Error(t('ui.errLangInvalid', { lang: lang }));
    var I = i18nApi();
    if (I && typeof I.setLang === 'function') {
      try { I.setLang(next); } catch (err) { /* 回退 */ }
    }
    if (state.lang !== next) handleLanguageChange(next);
    else updateLangButton();
  }

  function toolLabel(tool) { return t(TOOL_NAME_KEYS[tool] || tool); }

  function styleLabel(style) { return t(STYLE_NAME_KEYS[style] || style); }

  function optionLabel(key) {
    if (key === 'labels') return t('ui.optionLabels');
    if (key === 'indices') return t('ui.optionIndices');
    if (key === 'showAxes') return t('ui.optionShowAxes');
    return key;
  }

  function sampleDisplayName(sample) {
    if (!sample) return '';
    if (state.lang === 'en') return String(sample.nameEn || sample.name || sample.key || '');
    return String(sample.name || sample.nameEn || sample.key || '');
  }

  /* ------------------------------- 状态 ------------------------------- */

  var state = {
    booted: false,
    view: null,
    resizeObserver: null,
    mol: null,
    molecules: [],
    datasetIndex: 0,
    format: null,
    filename: '',
    sourceName: '',
    warnings: [],
    selection: [],
    hover: null,
    tool: 'select',
    style: 'ballstick',
    options: { labels: true, indices: false, showAxes: true },
    undoStack: [],
    redoStack: [],
    samples: [],
    drag: null,
    lastError: null,
    status: { parts: [{ key: 'status.ready', params: null }] },
    readyResolved: false,
    /* v2 */
    lang: 'en',
    sideTab: 'molecule',
    resultsPanel: null,
    logResults: null,
    sampleKey: null,
    depsMissing: []
  };

  var refs = {};
  var ovBadges = [];
  var ovLabels = {};
  var resolveReady = null;

  /* ------------------------------- 工具函数 ------------------------------- */

  function $(id) { return document.getElementById(id); }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function chineseMessage(err) {
    if (err == null) return t('ui.errUnknown');
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    try { return String(err); } catch (e) { return t('ui.errUnknown'); }
  }

  function symbolOf(index) {
    var mol = state.mol;
    if (!mol || !mol.atoms || !mol.atoms[index]) return '?';
    return String(mol.atoms[index].symbol || '?');
  }

  function getTitle() {
    var mol = state.mol;
    if (!mol) return '';
    return String(mol.title || state.sourceName || state.filename || t('ui.errUntitled'));
  }

  /* --------------------------- 数值格式化 --------------------------- */

  function fmtDistance(v) {
    return isFiniteNumber(v) ? v.toFixed(3) : '—';
  }

  function fmtAngle(v) {
    return isFiniteNumber(v) ? v.toFixed(2) : '—';
  }

  function fmtInput(v) {
    return isFiniteNumber(v) ? v.toFixed(4) : '';
  }

  /* ------------------------------ 错误与状态 ------------------------------ */

  function showErrorBanner(msg) {
    var el = refs.errorBanner;
    if (!el) return;
    el.textContent = String(msg);
    el.hidden = false;
  }

  function hideErrorBanner() {
    if (refs.errorBanner) refs.errorBanner.hidden = true;
  }

  function clearError() {
    state.lastError = null;
    hideErrorBanner();
  }

  function fail(err) {
    var msg = chineseMessage(err);
    state.lastError = msg;
    showErrorBanner(msg);
    setStatus('status.error', { msg: msg });
    if (err && typeof err === 'object') {
      try { err._moleditReported = true; } catch (e) { /* 忽略 */ }
    }
    return msg;
  }

  /** setStatus(key|parts, params?)：保存 i18n key/片段，切换语言后 refreshStatus 会重新翻译。 */
  function setStatus(key, params) {
    if (!key) {
      state.status = null;
    } else if (Array.isArray(key)) {
      state.status = { parts: key };
    } else {
      state.status = { parts: [{ key: key, params: params || null }] };
    }
    refreshStatus();
  }

  function statusText() {
    if (!state.status) return '';
    var parts = state.status.parts || [];
    var out = '';
    for (var i = 0; i < parts.length; i++) out += t(parts[i].key, parts[i].params);
    return out;
  }

  /* ------------------------------ 撤销/重做 ------------------------------ */

  function takeSnapshot() {
    var mol = state.mol;
    if (!mol) return null;
    return {
      atoms: (mol.atoms || []).map(function (a) {
        return { symbol: a.symbol, x: a.x, y: a.y, z: a.z };
      }),
      bonds: (mol.bonds || []).map(function (b) {
        return { i: b.i, j: b.j, order: b.order };
      }),
      charge: mol.charge == null ? 0 : mol.charge,
      multiplicity: mol.multiplicity == null ? 1 : mol.multiplicity,
      bondSource: mol.bondSource || 'inferred'
    };
  }

  function commitUndo(snapshot) {
    if (!snapshot) return;
    state.undoStack.push(snapshot);
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack.length = 0;
    refreshUndoButtons();
  }

  function restoreSnapshot(snapshot) {
    var mol = state.mol;
    if (!mol || !snapshot) return;
    mol.atoms = (snapshot.atoms || []).map(function (a) {
      return { symbol: a.symbol, x: a.x, y: a.y, z: a.z };
    });
    mol.bonds = (snapshot.bonds || []).map(function (b) {
      return { i: b.i, j: b.j, order: b.order };
    });
    mol.charge = snapshot.charge;
    mol.multiplicity = snapshot.multiplicity;
    mol.bondSource = snapshot.bondSource || 'inferred';
  }

  function undo() {
    if (!state.mol || state.drag) return false;
    if (!state.undoStack.length) return false;
    var current = takeSnapshot();
    var snapshot = state.undoStack.pop();
    state.redoStack.push(current);
    restoreSnapshot(snapshot);
    vcall('requestRender');
    setStatus('status.undone');
    refreshAll();
    return true;
  }

  function redo() {
    if (!state.mol || state.drag) return false;
    if (!state.redoStack.length) return false;
    var current = takeSnapshot();
    var snapshot = state.redoStack.pop();
    state.undoStack.push(current);
    restoreSnapshot(snapshot);
    vcall('requestRender');
    setStatus('status.redone');
    refreshAll();
    return true;
  }

  /* ------------------------------ 渲染器桥接 ------------------------------ */

  function vcall(name) {
    var view = state.view;
    if (!view || typeof view[name] !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      return view[name].apply(view, args);
    } catch (err) {
      if (global.console && console.warn) console.warn('[MolApp] view.' + name + ' 调用失败：', err);
      return undefined;
    }
  }

  function initView() {
    if (!global.MolRender || typeof global.MolRender.createView !== 'function') return;
    try {
      var view = global.MolRender.createView(refs.canvas, {
        style: state.style,
        labels: !!state.options.labels,
        indices: !!state.options.indices,
        showAxes: !!state.options.showAxes,
        background: '#ffffff'
      });
      state.view = view;
      if (view && 'onRender' in view) {
        view.onRender = function () { updateOverlay(); };
      } else if (view) {
        try { view.onRender = function () { updateOverlay(); }; } catch (e) { /* 忽略 */ }
      }
      if (typeof ResizeObserver !== 'undefined') {
        state.resizeObserver = new ResizeObserver(function () {
          vcall('resize');
          updateOverlay();
        });
        state.resizeObserver.observe(refs.viewport);
      }
      global.addEventListener('resize', onWindowResize);
      requestAnimationFrame(function () {
        vcall('resize');
        vcall('requestRender');
        updateOverlay();
      });
    } catch (err) {
      state.view = null;
      fail(err);
    }
  }

  function onWindowResize() {
    vcall('resize');
    updateOverlay();
  }

  /* --------------------------- 视口叠加层（HTML） --------------------------- */

  function buildOverlay() {
    var overlay = refs.overlay;
    if (!overlay) return;
    overlay.textContent = '';
    ovBadges = [];
    ovLabels = {};
    var i;
    for (i = 0; i < MAX_SELECTION; i++) {
      var badge = document.createElement('div');
      badge.className = 'ov-badge';
      badge.textContent = String(i + 1);
      badge.hidden = true;
      overlay.appendChild(badge);
      ovBadges.push(badge);
    }
    var labelDefs = ['distance', 'angle', 'dihedral'];
    for (i = 0; i < labelDefs.length; i++) {
      var label = document.createElement('div');
      label.className = 'ov-label';
      label.hidden = true;
      overlay.appendChild(label);
      ovLabels[labelDefs[i]] = label;
    }
  }

  function hideOverlayAll() {
    var i;
    for (i = 0; i < ovBadges.length; i++) ovBadges[i].hidden = true;
    for (var key in ovLabels) {
      if (Object.prototype.hasOwnProperty.call(ovLabels, key)) ovLabels[key].hidden = true;
    }
  }

  function safeProject(index) {
    var view = state.view;
    if (!view || typeof view.project !== 'function') return null;
    try {
      var p = view.project(index);
      if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
      return p;
    } catch (err) {
      return null;
    }
  }

  function safeScreenRadius(index) {
    var view = state.view;
    if (!view || typeof view.screenRadius !== 'function') return 10;
    try {
      var r = view.screenRadius(index);
      return isFiniteNumber(r) ? r : 10;
    } catch (err) {
      return 10;
    }
  }

  function safeProjectPoint(index) {
    var p = safeProject(index);
    if (!p || p.visible === false) return null;
    return p;
  }

  function midpointProject(a, b) {
    var pa = safeProjectPoint(a);
    var pb = safeProjectPoint(b);
    if (!pa || !pb) return null;
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  }

  function placeOverlay(el, x, y) {
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.hidden = false;
  }

  function updateOverlay() {
    var overlay = refs.overlay;
    if (!overlay) return;
    var view = state.view;
    var mol = state.mol;
    if (!view || !mol || state.selection.length === 0) {
      hideOverlayAll();
      return;
    }
    var selection = state.selection;
    var i, atomIndex, p, r;
    // 选中序号徽标（1–4，按点击顺序）。
    // 与 renderer.js 画布内徽标的位置/尺寸保持一致，使 HTML 徽标恰好覆盖画布徽标
    // （§8.3 要求 overlay 用 project 绘制序号徽标；renderer 也会画，这里对齐避免重影）。
    for (i = 0; i < MAX_SELECTION; i++) {
      atomIndex = selection[i];
      var badge = ovBadges[i];
      if (atomIndex == null) { badge.hidden = true; continue; }
      p = safeProjectPoint(atomIndex);
      if (!p) { badge.hidden = true; continue; }
      r = safeScreenRadius(atomIndex);
      var br = Math.max(9, Math.min(13, r * 0.34));
      var bx = p.x;
      var by = p.y - r - br - 2;
      if (by < br + 1) by = p.y + r + br + 2;
      badge.hidden = false;
      badge.textContent = String(i + 1);
      badge.style.width = (br * 2) + 'px';
      badge.style.height = (br * 2) + 'px';
      badge.style.lineHeight = Math.max(br * 2 - 3, 8) + 'px';
      badge.style.fontSize = (br * 1.28).toFixed(1) + 'px';
      placeOverlay(badge, bx, by);
    }
    // 当前测量数值标签
    hideOverlayLabels();
    var m = computeMeasurements();
    if (selection.length === 2 && m.distance != null) {
      var mid = midpointProject(selection[0], selection[1]);
      if (mid) placeOverlay(ovLabels.distance, mid.x, mid.y - 10);
      if (ovLabels.distance) ovLabels.distance.textContent = 'd = ' + fmtDistance(m.distance) + ' Å';
    } else if (selection.length === 3 && m.angle != null) {
      var vertex = safeProjectPoint(selection[1]);
      if (vertex) placeOverlay(ovLabels.angle, vertex.x, vertex.y - 16);
      if (ovLabels.angle) ovLabels.angle.textContent = '∠ = ' + fmtAngle(m.angle) + '°';
    } else if (selection.length === 4 && m.dihedral != null) {
      var mid2 = midpointProject(selection[1], selection[2]);
      if (mid2) placeOverlay(ovLabels.dihedral, mid2.x, mid2.y - 12);
      if (ovLabels.dihedral) ovLabels.dihedral.textContent = 'τ = ' + fmtAngle(m.dihedral) + '°';
    }
  }

  function hideOverlayLabels() {
    for (var key in ovLabels) {
      if (Object.prototype.hasOwnProperty.call(ovLabels, key)) ovLabels[key].hidden = true;
    }
  }

  /* ------------------------------ 测量计算 ------------------------------ */

  function computeMeasurements() {
    var result = {
      distance: null,
      angle: null,
      dihedral: null,
      atoms: state.selection.slice()
    };
    var mol = state.mol;
    var core = global.MolCore;
    var sel = state.selection;
    if (!mol || !core || !core.measure) return result;
    try {
      if (sel.length >= 2) result.distance = core.measure.distance(mol, sel[0], sel[1]);
    } catch (e) { result.distance = null; }
    try {
      if (sel.length >= 3) result.angle = core.measure.angle(mol, sel[0], sel[1], sel[2]);
    } catch (e) { result.angle = null; }
    try {
      if (sel.length >= 4) result.dihedral = core.measure.dihedral(mol, sel[0], sel[1], sel[2], sel[3]);
    } catch (e) { result.dihedral = null; }
    return result;
  }

  function measurementForRenderer() {
    var sel = state.selection;
    if (!state.mol || sel.length < 2) return null;
    if (sel.length === 2) return { atoms: sel.slice(0, 2), type: 'distance' };
    if (sel.length === 3) return { atoms: sel.slice(0, 3), type: 'angle' };
    return { atoms: sel.slice(0, 4), type: 'dihedral' };
  }

  /* ------------------------------ 选择操作 ------------------------------ */

  function applySelection(next) {
    state.selection = next || [];
    vcall('setSelection', state.selection);
    vcall('setMeasurement', measurementForRenderer());
    vcall('requestRender');
    refreshAll();
  }

  function setSelection(indices) {
    var mol = state.mol;
    var out = [];
    if (mol && Object.prototype.toString.call(indices) === '[object Array]') {
      for (var i = 0; i < indices.length; i++) {
        var idx = Number(indices[i]);
        if (!isFinite(idx) || Math.floor(idx) !== idx) continue;
        if (idx < 0 || idx >= mol.atoms.length) continue;
        if (out.indexOf(idx) !== -1) continue;
        if (out.length >= MAX_SELECTION) {
          setStatus('status.maxSelection', { max: MAX_SELECTION });
          break;
        }
        out.push(idx);
      }
    }
    applySelection(out);
  }

  function selectAtom(index, opts) {
    var mol = requireMolecule();
    var idx = Number(index);
    if (!isFinite(idx) || Math.floor(idx) !== idx) throw new Error(t('ui.errAtomInt'));
    if (idx < 0 || idx >= mol.atoms.length) throw new Error(t('ui.errAtomRange', { index: index }));
    var add = !!(opts && opts.add);
    var sel = state.selection.slice();
    var pos = sel.indexOf(idx);
    if (pos !== -1) {
      sel.splice(pos, 1);
    } else if (add) {
      if (sel.length >= MAX_SELECTION) {
        setStatus('status.maxSelection', { max: MAX_SELECTION });
        return;
      }
      sel.push(idx);
    } else {
      sel = [idx];
    }
    applySelection(sel);
  }

  function clearSelection() {
    if (!state.selection.length) {
      hideOverlayAll();
      return;
    }
    applySelection([]);
    setStatus('status.selectionCleared');
  }

  /* ------------------------------ 面板刷新 ------------------------------ */

  function refreshAll() {
    refreshMoleculePanel();
    refreshSelectionPanel();
    refreshStatus();
    refreshUndoButtons();
    refreshExportButtons();
    refreshToolButtons();
    refreshDisplayControls();
    refreshHud();
    if (refs.emptyHint) refs.emptyHint.hidden = !!state.mol;
    updateOverlay();
  }

  function refreshMoleculePanel() {
    var mol = state.mol;
    if (refs.molTitle) {
      refs.molTitle.textContent = mol ? getTitle() : '—';
      refs.molTitle.title = mol ? getTitle() : '—';
    }
    if (refs.molFormat) refs.molFormat.textContent = state.format ? String(state.format).toUpperCase() : '—';
    if (refs.atomCount) refs.atomCount.textContent = mol && mol.atoms ? String(mol.atoms.length) : '0';
    if (refs.bondCount) refs.bondCount.textContent = mol && mol.bonds ? String(mol.bonds.length) : '0';
    if (refs.chargeInput) {
      refs.chargeInput.disabled = !mol;
      refs.chargeInput.value = mol ? String(mol.charge == null ? 0 : mol.charge) : '0';
    }
    if (refs.multiplicityInput) {
      refs.multiplicityInput.disabled = !mol;
      refs.multiplicityInput.value = mol ? String(mol.multiplicity == null ? 1 : mol.multiplicity) : '1';
    }
    refreshDatasetSelect();
  }

  function refreshDatasetSelect() {
    var sel = refs.datasetSelect;
    if (!sel) return;
    var count = state.molecules.length;
    var signature = count + ':' + state.datasetIndex + ':' + state.lang;
    if (sel.getAttribute('data-signature') !== signature) {
      sel.textContent = '';
      if (count > 1) {
        for (var i = 0; i < count; i++) {
          var opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = t('ui.datasetFrame', { i: i + 1, n: count });
          sel.appendChild(opt);
        }
      } else {
        var single = document.createElement('option');
        single.value = '0';
        single.textContent = count === 1 ? t('ui.datasetSingle') : '—';
        sel.appendChild(single);
      }
      sel.setAttribute('data-signature', signature);
    }
    sel.value = String(state.datasetIndex);
    sel.disabled = count <= 1;
    if (refs.datasetLabel) {
      // 单帧（或未加载）时只保留下拉框中的 “Single frame/单帧”，隐藏右侧重复的 label；
      // 多帧时显示 “Frame i/n” 便于快速识别当前帧。
      if (count > 1) {
        refs.datasetLabel.hidden = false;
        refs.datasetLabel.textContent = t('ui.datasetFrame', { i: state.datasetIndex + 1, n: count });
      } else {
        refs.datasetLabel.hidden = true;
        refs.datasetLabel.textContent = '';
      }
    }
  }

  function refreshSelectionPanel() {
    var mol = state.mol;
    var sel = state.selection;
    if (refs.selectionCount) refs.selectionCount.textContent = sel.length + ' / ' + MAX_SELECTION;
    if (refs.selectionList) {
      if (!mol) {
        refs.selectionList.textContent = t('ui.selectionNoMolecule');
      } else if (!sel.length) {
        refs.selectionList.textContent = t('ui.selectionEmpty');
      } else {
        var parts = [];
        for (var i = 0; i < sel.length; i++) {
          parts.push(t('ui.selectionItem', { order: i + 1, symbol: symbolOf(sel[i]), index: sel[i] + 1 }));
        }
        refs.selectionList.textContent = parts.join('   ');
      }
    }
    var m = computeMeasurements();
    if (refs.measureDistance) {
      refs.measureDistance.textContent = m.distance == null ? '—' : 'd = ' + fmtDistance(m.distance) + ' Å';
    }
    if (refs.measureAngle) {
      refs.measureAngle.textContent = m.angle == null ? '—' : '∠ = ' + fmtAngle(m.angle) + '°';
    }
    if (refs.measureDihedral) {
      refs.measureDihedral.textContent = m.dihedral == null ? '—' : 'τ = ' + fmtAngle(m.dihedral) + '°';
    }
    syncMeasureInputs(m);
    updateEditCardStates(sel.length);
  }

  function syncMeasureInputs(m) {
    if (refs.bondLengthInput) refs.bondLengthInput.value = fmtInput(m.distance);
    if (refs.angleInput) refs.angleInput.value = fmtInput(m.angle);
    if (refs.dihedralInput) refs.dihedralInput.value = fmtInput(m.dihedral);
  }

  function updateEditCardStates(selectionCount) {
    setCardEnabled(refs.cardBondLength, selectionCount >= 2);
    setCardEnabled(refs.cardAngle, selectionCount >= 3);
    setCardEnabled(refs.cardDihedral, selectionCount >= 4);
  }

  function setCardEnabled(card, enabled) {
    if (!card) return;
    card.classList.toggle('is-disabled', !enabled);
    var controls = card.querySelectorAll('input, select, button');
    for (var i = 0; i < controls.length; i++) controls[i].disabled = !enabled;
  }

  function refreshStatus() {
    var mol = state.mol;
    var atomCount = mol && mol.atoms ? mol.atoms.length : 0;
    var bondCount = mol && mol.bonds ? mol.bonds.length : 0;
    var text = t('ui.statusCounts', { atoms: atomCount, bonds: bondCount, selected: state.selection.length });
    var extra = statusText();
    if (extra) text += '      |      ' + extra;
    if (refs.statusBar) refs.statusBar.textContent = text;
  }

  function refreshHud() {
    var hud = refs.viewportHud;
    if (!hud) return;
    var mol = state.mol;
    if (!mol) {
      hud.hidden = true;
      hud.textContent = '';
      return;
    }
    hud.hidden = false;
    var fmt = state.format ? String(state.format).toUpperCase() : '?';
    var bondCount = mol.bonds ? mol.bonds.length : 0;
    var text = t('ui.hud', { title: getTitle(), format: fmt, atoms: mol.atoms.length, bonds: bondCount });
    if (state.molecules.length > 1) {
      text += t('ui.hudFrame', { i: state.datasetIndex + 1, n: state.molecules.length });
    }
    hud.textContent = text;
    hud.title = text;
  }

  function refreshUndoButtons() {
    if (refs.btnUndo) refs.btnUndo.disabled = !state.mol || state.undoStack.length === 0;
    if (refs.btnRedo) refs.btnRedo.disabled = !state.mol || state.redoStack.length === 0;
  }

  function refreshExportButtons() {
    var disabled = !state.mol;
    if (refs.btnExportXyz) refs.btnExportXyz.disabled = disabled;
    if (refs.btnExportGjf) refs.btnExportGjf.disabled = disabled;
    if (refs.btnExportSdf) refs.btnExportSdf.disabled = disabled;
  }

  function refreshToolButtons() {
    var buttons = document.querySelectorAll('[data-tool]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var active = btn.getAttribute('data-tool') === state.tool;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function refreshDisplayControls() {
    if (refs.styleSelect) refs.styleSelect.value = state.style;
    if (refs.toggleLabels) refs.toggleLabels.checked = !!state.options.labels;
    if (refs.toggleIndices) refs.toggleIndices.checked = !!state.options.indices;
    if (refs.toggleAxes) refs.toggleAxes.checked = !!state.options.showAxes;
  }

  function updateMouseHint() {
    var el = refs.mouseHint;
    if (!el) return;
    var keys = {
      'select': 'ui.hintSelect',
      'rotate': 'ui.hintRotate',
      'move-atom': 'ui.hintMoveAtom',
      'move-fragment': 'ui.hintMoveFragment',
      'pan': 'ui.hintPan'
    };
    el.textContent = t(keys[state.tool] || keys.select);
  }

  /* ------------------------------ 工具切换 ------------------------------ */

  function setTool(tool) {
    if (TOOL_LIST.indexOf(tool) === -1) throw new Error(t('ui.errBadTool', { tool: tool }));
    state.tool = tool;
    refreshToolButtons();
    updateMouseHint();
    updateCursor(state.hover);
    setStatus('status.tool', { tool: toolLabel(tool) });
  }

  function updateCursor(hit) {
    var canvas = refs.canvas;
    if (!canvas) return;
    var cursor = 'default';
    if (state.tool === 'pan') {
      cursor = 'grab';
    } else if (hit != null && hit >= 0) {
      if (state.tool === 'move-atom' || state.tool === 'move-fragment') cursor = 'move';
      else cursor = 'pointer';
    }
    if (state.drag) cursor = (state.drag.mode === 'pan') ? 'grabbing' : (state.drag.mode === 'rotate' ? 'grabbing' : 'move');
    canvas.style.cursor = cursor;
  }

  /* ------------------------------ 分子装载 ------------------------------ */

  function cloneMoleculeSafe(mol) {
    if (!mol || typeof mol !== 'object') return null;
    if (global.MolCore && typeof global.MolCore.clone === 'function') {
      try { return global.MolCore.clone(mol); } catch (e) { /* 回退到手工拷贝 */ }
    }
    return {
      title: mol.title ? String(mol.title) : '',
      atoms: (mol.atoms || []).map(function (a) {
        return { symbol: String(a.symbol), x: Number(a.x), y: Number(a.y), z: Number(a.z) };
      }),
      bonds: (mol.bonds || []).map(function (b) {
        return { i: b.i | 0, j: b.j | 0, order: b.order == null ? 1 : (b.order | 0) };
      }),
      charge: mol.charge == null ? 0 : (mol.charge | 0),
      multiplicity: mol.multiplicity == null ? 1 : (mol.multiplicity | 0),
      source: mol.source || 'user',
      energy: mol.energy == null ? null : mol.energy,
      bondSource: mol.bondSource || 'inferred',
      frameIndex: mol.frameIndex == null ? 0 : mol.frameIndex,
      frameCount: mol.frameCount == null ? 1 : mol.frameCount
    };
  }

  function normalizeMolecule(mol) {
    if (!mol || typeof mol !== 'object') return null;
    if (!Array.isArray(mol.atoms)) mol.atoms = [];
    if (!Array.isArray(mol.bonds)) mol.bonds = [];
    if (mol.charge == null) mol.charge = 0;
    if (mol.multiplicity == null) mol.multiplicity = 1;
    if (!mol.bondSource) mol.bondSource = 'inferred';
    if (mol.title == null) mol.title = '';
    if (mol.frameCount == null) mol.frameCount = 1;
    return mol;
  }

  function setMolecules(molecules, meta) {
    meta = meta || {};
    state.molecules = molecules || [];
    state.datasetIndex = 0;
    state.mol = state.molecules[0] || null;
    state.format = meta.format || (state.mol && state.mol.source) || null;
    state.filename = meta.filename || '';
    state.sourceName = meta.name || '';
    state.warnings = meta.warnings || [];
    state.selection = [];
    state.hover = null;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.drag = null;
    state.sampleKey = (meta.source === 'sample' && meta.sampleKey != null) ? String(meta.sampleKey) : null;
    if (state.mol && !state.mol.title && state.sourceName) state.mol.title = state.sourceName;
    // 同步顶栏“示例”下拉：从文件/文本加载后回到占位项，避免显示与当前分子来源不符；
    // 从示例库加载时高亮对应示例项。
    if (refs.sampleSelect) {
      if (meta.source === 'sample' && meta.sampleKey != null) {
        refs.sampleSelect.value = String(meta.sampleKey);
        if (refs.sampleSelect.value !== String(meta.sampleKey)) refs.sampleSelect.value = '';
      } else {
        refs.sampleSelect.value = '';
      }
    }
    clearError();
    if (state.view) {
      vcall('setHover', null);
      vcall('setSelection', []);
      vcall('setMeasurement', null);
      vcall('setMolecule', state.mol);
      vcall('frameAll');
      vcall('requestRender');
    }
    refreshAll();
    updateCursor(null);
  }

  function applyDataset(index) {
    var i = Number(index);
    if (!isFinite(i) || Math.floor(i) !== i) throw new Error(t('ui.errBadDatasetIndex'));
    if (i < 0 || i >= state.molecules.length) throw new Error(t('ui.errDatasetRange', { index: index }));
    state.datasetIndex = i;
    state.mol = state.molecules[i] || null;
    state.selection = [];
    state.hover = null;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.drag = null;
    if (state.mol && !state.mol.title && state.sourceName) state.mol.title = state.sourceName;
    if (state.view) {
      vcall('setHover', null);
      vcall('setSelection', []);
      vcall('setMeasurement', null);
      vcall('setMolecule', state.mol);
      vcall('frameAll');
      vcall('requestRender');
    }
    clearError();
    refreshAll();
    updateCursor(null);
  }

  /* --------------------------- 计算结果面板（v2） --------------------------- */

  function initResultsPanel() {
    if (state.resultsPanel) return;
    var container = refs.resultsPanel;
    if (!container) return;
    var R = global.MolResults;
    if (!R || typeof R.create !== 'function') return;
    try {
      state.resultsPanel = R.create(container, {
        i18n: i18nApi(),
        getView: function () { return state.view; },
        onRequestFrame: function (idx) {
          var i = Number(idx);
          if (!isFinite(i) || Math.floor(i) !== i) return;
          if (i < 0 || i >= state.molecules.length) return;
          try { setDatasetIndexApi(i); } catch (err) { /* 忽略帧切换失败 */ }
        }
      });
    } catch (err) {
      state.resultsPanel = null;
      if (global.console && console.warn) console.warn('[MolApp] MolResults.create 失败：', err);
    }
  }

  /** 解析 Gaussian log 结果；模块缺失/异常时返回 null（不影响分子加载）。 */
  function computeLogResults(text, format) {
    if (String(format || '').toLowerCase() !== 'log') return null;
    var G = global.MolGaussLog;
    if (!G || typeof G.parse !== 'function') return null;
    try {
      return G.parse(String(text == null ? '' : text)) || null;
    } catch (err) {
      if (global.console && console.warn) console.warn('[MolApp] MolGaussLog.parse 失败：', err);
      return null;
    }
  }

  function logSummary() {
    var r = state.logResults;
    return (r && r.summary) ? r.summary : null;
  }

  function resultsAvailable() {
    var summary = logSummary();
    return !!(summary && summary.hasAnalysis);
  }

  function syncResultsUI() {
    var available = resultsAvailable();
    var summary = logSummary();
    if (state.resultsPanel) {
      try {
        state.resultsPanel.setResults(available ? state.logResults : null);
      } catch (err) {
        if (global.console && console.warn) console.warn('[MolApp] resultsPanel.setResults 失败：', err);
      }
    }
    if (refs.tabResults) {
      refs.tabResults.disabled = !available;
      refs.tabResults.setAttribute('aria-disabled', available ? 'false' : 'true');
    }
    if (!available) {
      if (state.sideTab !== 'molecule') setSideTab('molecule');
      return;
    }
    var auto = !!(summary && (summary.hasFrequencies || summary.hasOptimization || summary.hasThermochemistry));
    setSideTab(auto ? 'results' : 'molecule');
  }

  function clearLogResults() {
    state.logResults = null;
    if (state.resultsPanel) {
      try { state.resultsPanel.setResults(null); } catch (err) { /* 忽略 */ }
    }
    if (refs.tabResults) {
      refs.tabResults.disabled = true;
      refs.tabResults.setAttribute('aria-disabled', 'true');
    }
    if (state.sideTab !== 'molecule') setSideTab('molecule');
  }

  function setSideTab(name) {
    var tab = String(name || '');
    if (tab !== 'molecule' && tab !== 'results') throw new Error(t('ui.errBadTab', { name: name }));
    if (tab === 'results' && refs.tabResults && refs.tabResults.disabled) {
      throw new Error(t('ui.errResultsUnavailable'));
    }
    state.sideTab = tab;
    var isMolecule = tab === 'molecule';
    if (refs.tabMolecule) {
      refs.tabMolecule.classList.toggle('is-active', isMolecule);
      refs.tabMolecule.setAttribute('aria-selected', isMolecule ? 'true' : 'false');
    }
    if (refs.tabResults) {
      refs.tabResults.classList.toggle('is-active', !isMolecule);
      refs.tabResults.setAttribute('aria-selected', isMolecule ? 'false' : 'true');
    }
    if (refs.tabPageMolecule) refs.tabPageMolecule.hidden = !isMolecule;
    if (refs.tabPageResults) refs.tabPageResults.hidden = isMolecule;
    if (state.resultsPanel) {
      try { state.resultsPanel.setActive(!isMolecule); } catch (err) { /* 忽略 */ }
    }
  }

  function resultsPanelState() {
    var panel = state.resultsPanel;
    if (!panel || typeof panel.getState !== 'function') return null;
    try { return panel.getState() || null; } catch (err) { return null; }
  }

  function requireResultsPanel() {
    var panel = state.resultsPanel;
    if (!panel) throw new Error(t('ui.errResultsPanelMissing'));
    return panel;
  }

  function makeLoadResult() {
    var mol = state.mol;
    var summary = logSummary();
    var freqCount = (summary && Array.isArray(summary.frequencies)) ? summary.frequencies.length : 0;
    var jobCount = (summary && summary.jobCount != null)
      ? summary.jobCount
      : ((state.logResults && Array.isArray(state.logResults.jobs)) ? state.logResults.jobs.length : 0);
    return {
      format: state.format,
      moleculeCount: state.molecules.length,
      datasetIndex: state.datasetIndex,
      atomCount: mol && mol.atoms ? mol.atoms.length : 0,
      bondCount: mol && mol.bonds ? mol.bonds.length : 0,
      title: getTitle(),
      filename: state.filename,
      warnings: state.warnings.slice(),
      /* v2 */
      hasLogResults: !!(state.logResults && state.logResults.ok !== false),
      logJobCount: jobCount,
      frequencyCount: freqCount,
      hasFrequencies: !!(summary && summary.hasFrequencies),
      hasThermochemistry: !!(summary && summary.hasThermochemistry),
      hasOptimization: !!(summary && summary.hasOptimization)
    };
  }

  function parseTextViaCore(text, opts) {
    var core = global.MolCore;
    if (!core || typeof core.parseFile !== 'function') {
      throw new Error(t('ui.errParserMissing'));
    }
    var parsed = core.parseFile(String(text), opts || {});
    if (!parsed || !Array.isArray(parsed.molecules) || !parsed.molecules.length) {
      throw new Error(t('ui.errNoMoleculesParsed'));
    }
    return parsed;
  }

  function loadText(text, opts) {
    opts = opts || {};
    var filename = opts.filename || opts.name || '';
    try {
      if (typeof text !== 'string') throw new Error(t('ui.errNotText'));
      if (!text.replace(/^\uFEFF/, '').trim()) throw new Error(t('ui.errEmptyFile'));
      var parseOpts = { filename: filename };
      if (opts.format) parseOpts.format = String(opts.format).toLowerCase();
      var parsed = parseTextViaCore(text, parseOpts);
      var format = String(parsed.format || parseOpts.format || '').toLowerCase();
      var molecules = [];
      for (var i = 0; i < parsed.molecules.length; i++) {
        var cloned = normalizeMolecule(cloneMoleculeSafe(parsed.molecules[i]));
        if (cloned && cloned.atoms.length) molecules.push(cloned);
      }
      if (!molecules.length) throw new Error(t('ui.errNoAtomsInFile'));
      if (!format) format = String(molecules[0].source || 'xyz').toLowerCase();
      state.logResults = computeLogResults(text, format);
      setMolecules(molecules, {
        format: format,
        filename: filename,
        name: opts.name || '',
        warnings: parsed.warnings || [],
        source: 'text'
      });
      syncResultsUI();
      var label = filename || t('ui.errTextData');
      var statusParts = [{
        key: 'status.loaded',
        params: { file: label, format: format.toUpperCase(), atoms: molecules[0].atoms.length }
      }];
      if (molecules.length > 1) statusParts.push({ key: 'status.loadedFrames', params: { n: molecules.length } });
      if (state.warnings && state.warnings.length) {
        statusParts.push({ key: 'status.loadedWarnings', params: { warnings: state.warnings.join(t('ui.listSeparator')) } });
      }
      setStatus(statusParts);
      return makeLoadResult();
    } catch (err) {
      clearLogResults();
      if (!(err && err._moleditReported)) fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  /* ------------------------------ 示例库 ------------------------------ */

  function readSamples() {
    var S = global.MolSamples;
    if (!S) return [];
    var raw = null;
    try {
      if (typeof S.list === 'function') raw = S.list();
      else if (Array.isArray(S.list)) raw = S.list;
      else if (S.samples) raw = S.samples;
      else if (S.items) raw = S.items;
    } catch (err) {
      if (global.console && console.warn) console.warn('[MolApp] MolSamples.list 调用失败：', err);
      return [];
    }
    var out = [];
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i];
        if (typeof item === 'string') {
          out.push({ key: item, name: item, nameEn: item, format: null, filename: null, _raw: item });
        } else if (item && typeof item === 'object') {
          var key = item.key || item.id || item.name || ('sample' + i);
          out.push({
            key: String(key),
            name: String(item.name || item.title || key),
            nameEn: String(item.nameEn || item.name || item.title || key),
            format: item.format ? String(item.format).toLowerCase() : null,
            filename: item.filename ? String(item.filename) : null,
            _raw: item
          });
        }
      }
    } else if (raw && typeof raw === 'object') {
      var keys = Object.keys(raw);
      for (var k = 0; k < keys.length; k++) {
        var value = raw[keys[k]];
        out.push({
          key: keys[k],
          name: String((value && (value.name || value.title)) || keys[k]),
          nameEn: String((value && (value.nameEn || value.name || value.title)) || keys[k]),
          format: (value && value.format) ? String(value.format).toLowerCase() : null,
          _raw: value
        });
      }
    }
    return out;
  }

  function resolveSampleData(key) {
    var S = global.MolSamples;
    if (!S) throw new Error(t('ui.errSamplesMissing'));
    var raw;
    var known = null;
    for (var i = 0; i < state.samples.length; i++) {
      if (state.samples[i].key === String(key)) { known = state.samples[i]; break; }
    }
    if (typeof S.get === 'function') {
      raw = S.get(key);
    } else if (S[key] != null) {
      raw = S[key];
    } else if (known && known._raw != null) {
      raw = known._raw;
    }
    if (raw == null && known && known._raw != null) raw = known._raw;
    if (raw == null) throw new Error(t('ui.errSampleNotFound', { key: key }));

    if (typeof raw === 'string') {
      var parsed = parseTextViaCore(raw, { filename: key });
      return { molecules: parsed.molecules, format: parsed.format || (known && known.format) || null, text: raw };
    }
    if (Array.isArray(raw)) {
      return { molecules: raw, format: (known && known.format) || (raw[0] && raw[0].source) || null, text: null };
    }
    if (raw && Array.isArray(raw.molecules)) {
      return { molecules: raw.molecules, format: raw.format || (known && known.format) || null, text: (typeof raw.text === 'string' ? raw.text : null) };
    }
    if (raw && Array.isArray(raw.atoms)) {
      return { molecules: [raw], format: (raw.source || (known && known.format)) || null, text: null };
    }
    if (raw && Array.isArray(raw.molecule)) {
      return { molecules: raw.molecule, format: (known && known.format) || null, text: null };
    }
    if (raw && typeof raw.text === 'string') {
      var parsed2 = parseTextViaCore(raw.text, { filename: key, format: raw.format || (known && known.format) });
      return { molecules: parsed2.molecules, format: parsed2.format || (known && known.format) || null, text: raw.text };
    }
    throw new Error(t('ui.errSampleBadFormat', { key: key }));
  }

  function loadSample(key) {
    try {
      if (key == null || key === '') throw new Error(t('ui.errSampleKey'));
      var known = null;
      for (var i = 0; i < state.samples.length; i++) {
        if (state.samples[i].key === String(key)) { known = state.samples[i]; break; }
      }
      var displayName = known ? sampleDisplayName(known) : String(key);
      var resolved = resolveSampleData(key);
      var molecules = [];
      for (var j = 0; j < resolved.molecules.length; j++) {
        var cloned = normalizeMolecule(cloneMoleculeSafe(resolved.molecules[j]));
        if (cloned && cloned.atoms.length) molecules.push(cloned);
      }
      if (!molecules.length) throw new Error(t('ui.errSampleNoData', { name: displayName }));
      var format = String((known && known.format) || resolved.format || molecules[0].source || 'xyz').toLowerCase();
      var sampleFilename = (known && known.filename) || (key + '.' + format);
      state.logResults = resolved.text ? computeLogResults(resolved.text, format) : null;
      setMolecules(molecules, {
        format: format,
        filename: sampleFilename,
        name: displayName,
        source: 'sample',
        sampleKey: String(key)
      });
      syncResultsUI();
      var bondCount = molecules[0].bonds ? molecules[0].bonds.length : 0;
      var statusParts = [{
        key: 'status.sampleLoaded',
        params: { name: displayName, format: format.toUpperCase(), atoms: molecules[0].atoms.length, bonds: bondCount }
      }];
      if (molecules.length > 1) statusParts.push({ key: 'status.sampleLoadedFrames', params: { n: molecules.length } });
      setStatus(statusParts);
      return makeLoadResult();
    } catch (err) {
      clearLogResults();
      if (!(err && err._moleditReported)) fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function listSamples() {
    return state.samples.map(function (s) {
      return { key: s.key, name: s.name, nameEn: s.nameEn || s.name, format: s.format || null };
    });
  }

  function populateSampleSelect() {
    var sel = refs.sampleSelect;
    if (!sel) return;
    var prev = sel.value || '';
    state.samples = readSamples();
    sel.textContent = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.samples.length ? t('samples.placeholder') : t('samples.unavailable');
    sel.appendChild(placeholder);
    for (var i = 0; i < state.samples.length; i++) {
      var opt = document.createElement('option');
      opt.value = state.samples[i].key;
      opt.textContent = sampleDisplayName(state.samples[i]);
      sel.appendChild(opt);
    }
    var keep = false;
    for (var j = 0; j < state.samples.length; j++) {
      if (state.samples[j].key === prev) { keep = true; break; }
    }
    sel.value = keep ? prev : '';
    sel.disabled = state.samples.length === 0;
  }

  /* ------------------------------ 文件读取/拖放 ------------------------------ */

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error(t('ui.errNoFile'))); return; }
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error(t('ui.errReadFile', { msg: (reader.error && reader.error.message) || t('ui.errUnknown') })));
      };
      reader.onload = function () { resolve(String(reader.result == null ? '' : reader.result)); };
      try {
        reader.readAsText(file, 'utf-8');
      } catch (err) {
        reject(new Error(t('ui.errReadFile', { msg: chineseMessage(err) })));
      }
    });
  }

  function handleFile(file) {
    return readFileAsText(file).then(function (text) {
      loadText(text, { filename: file.name });
    }).catch(function (err) {
      if (!(err && err._moleditReported)) fail(err);
    });
  }

  function onFileInputChange() {
    var input = refs.fileInput;
    if (!input || !input.files || !input.files.length) return;
    var file = input.files[0];
    input.value = '';
    handleFile(file);
  }

  function bindDropZone() {
    var vp = refs.viewport;
    if (!vp) return;
    vp.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      vp.classList.add('drag-over');
    });
    vp.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* 忽略 */ }
      vp.classList.add('drag-over');
    });
    vp.addEventListener('dragleave', function (e) {
      e.stopPropagation();
      if (!e.relatedTarget || !vp.contains(e.relatedTarget)) vp.classList.remove('drag-over');
    });
    vp.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      vp.classList.remove('drag-over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });
    global.addEventListener('dragover', function (e) {
      if (e.dataTransfer) e.preventDefault();
    });
    global.addEventListener('drop', function (e) {
      if (!vp.contains(e.target)) e.preventDefault();
    });
  }

  /* ------------------------------ 指针交互 ------------------------------ */

  function canvasPos(e) {
    var rect = refs.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pickAtom(x, y) {
    var view = state.view;
    if (!view || typeof view.pick !== 'function' || !state.mol) return null;
    try {
      var hit = view.pick(x, y);
      return (hit == null || !isFinite(hit)) ? null : hit;
    } catch (err) {
      return null;
    }
  }

  function fragmentAtoms(mol, atomIndex) {
    if (!mol) return [atomIndex];
    var core = global.MolCore;
    if (core && typeof core.components === 'function') {
      try {
        var comps = core.components(mol);
        for (var c = 0; c < comps.length; c++) {
          if (comps[c].indexOf(atomIndex) !== -1) return comps[c].slice();
        }
      } catch (err) { /* 回退 BFS */ }
    }
    var bonds = mol.bonds || [];
    var seen = {};
    var queue = [atomIndex];
    var out = [];
    seen[atomIndex] = true;
    while (queue.length) {
      var cur = queue.shift();
      out.push(cur);
      for (var b = 0; b < bonds.length; b++) {
        var next = -1;
        if (bonds[b].i === cur) next = bonds[b].j;
        else if (bonds[b].j === cur) next = bonds[b].i;
        if (next >= 0 && !seen[next]) { seen[next] = true; queue.push(next); }
      }
    }
    return out;
  }

  function beginMoveDrag(mode, hit) {
    var mol = state.mol;
    var indices = mode === 'move-fragment' ? fragmentAtoms(mol, hit) : [hit];
    var positions = [];
    for (var i = 0; i < indices.length; i++) {
      var atom = mol.atoms[indices[i]];
      if (!atom) continue;
      positions.push({ index: indices[i], x: atom.x, y: atom.y, z: atom.z });
    }
    return { snapshot: takeSnapshot(), positions: positions };
  }

  function onPointerDown(e) {
    if (e.button === 2) return;
    if (e.button === 1) e.preventDefault();
    if (!refs.canvas) return;
    var pos = canvasPos(e);
    var hit = pickAtom(pos.x, pos.y);
    var tool = state.tool;
    var mode = null;
    if (e.button === 1) {
      mode = 'pan';
    } else if (e.button === 0) {
      if (e.shiftKey && (tool === 'select' || tool === 'rotate')) {
        mode = 'pan';
      } else if (tool === 'pan') {
        mode = 'pan';
      } else if ((tool === 'move-atom' || tool === 'move-fragment') && hit != null) {
        mode = tool;
      } else {
        mode = 'rotate';
      }
    }
    if (!mode) return;
    var drag = {
      mode: mode,
      pointerId: e.pointerId,
      startX: pos.x,
      startY: pos.y,
      lastX: pos.x,
      lastY: pos.y,
      moved: false,
      hit: hit,
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      snapshot: null,
      positions: null,
      committed: false
    };
    if (mode === 'move-atom' || mode === 'move-fragment') {
      if (hit == null) return;
      var prepared = beginMoveDrag(mode, hit);
      drag.snapshot = prepared.snapshot;
      drag.positions = prepared.positions;
    }
    state.drag = drag;
    try { refs.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    updateCursor(hit);
    e.preventDefault();
  }

  function moveDrag(drag, totalX, totalY) {
    if (!drag.committed) {
      drag.committed = true;
      commitUndo(drag.snapshot);
    }
    var delta = vcall('screenDeltaToWorld', totalX, totalY);
    if (!delta || delta.length < 3) return;
    var dx = Number(delta[0]);
    var dy = Number(delta[1]);
    var dz = Number(delta[2]);
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;
    var mol = state.mol;
    if (!mol) return;
    for (var i = 0; i < drag.positions.length; i++) {
      var item = drag.positions[i];
      var atom = mol.atoms[item.index];
      if (!atom) continue;
      atom.x = item.x + dx;
      atom.y = item.y + dy;
      atom.z = item.z + dz;
    }
    vcall('requestRender');
    updateOverlay();
  }

  function onPointerMove(e) {
    if (!refs.canvas) return;
    var drag = state.drag;
    if (drag && drag.pointerId === e.pointerId) {
      var pos = canvasPos(e);
      var dx = pos.x - drag.lastX;
      var dy = pos.y - drag.lastY;
      var totalX = pos.x - drag.startX;
      var totalY = pos.y - drag.startY;
      if (!drag.moved && Math.sqrt(totalX * totalX + totalY * totalY) > 3) drag.moved = true;
      if (drag.moved) {
        if (drag.mode === 'rotate') vcall('rotate', dx, dy);
        else if (drag.mode === 'pan') vcall('pan', dx, dy);
        else if (drag.mode === 'move-atom' || drag.mode === 'move-fragment') moveDrag(drag, totalX, totalY);
      }
      drag.lastX = pos.x;
      drag.lastY = pos.y;
      if (drag.moved) e.preventDefault();
      return;
    }
    var p = canvasPos(e);
    var hit = pickAtom(p.x, p.y);
    if (hit !== state.hover) {
      state.hover = hit;
      vcall('setHover', hit);
    }
    updateCursor(hit);
  }

  function finishMoveDrag(drag) {
    if (!drag.committed) return;
    var mol = state.mol;
    if (!mol) return;
    if (mol.bondSource === 'inferred') {
      var core = global.MolCore;
      if (core && typeof core.rebond === 'function') {
        try { core.rebond(mol); } catch (err) {
          if (global.console && console.warn) console.warn('[MolApp] rebond 失败：', err);
        }
      }
    }
    vcall('requestRender');
    refreshAll();
    setStatus(drag.mode === 'move-fragment' ? 'status.movedFragment' : 'status.movedAtom', { n: drag.positions.length });
  }

  function onPointerUp(e) {
    var drag = state.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    state.drag = null;
    try { refs.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    if (drag.mode === 'move-atom' || drag.mode === 'move-fragment') {
      if (drag.committed) {
        finishMoveDrag(drag);
      } else if (!drag.moved && e.button === 0) {
        // 未发生拖动：在移动工具下点击原子仍视为选择（§8.3 点击语义一致）
        var clickPos = canvasPos(e);
        var clickHit = pickAtom(clickPos.x, clickPos.y);
        if (clickHit != null) {
          try {
            selectAtom(clickHit, { add: drag.shift || e.ctrlKey || drag.ctrl });
          } catch (err) {
            fail(err);
          }
        }
      }
      var hoverHit = pickAtom(canvasPos(e).x, canvasPos(e).y);
      state.hover = hoverHit;
      vcall('setHover', hoverHit);
      updateCursor(hoverHit);
      return;
    }
    if (!drag.moved && e.button === 0) {
      var pos = canvasPos(e);
      var hit = pickAtom(pos.x, pos.y);
      if (hit != null) {
        if (state.tool === 'pan') {
          updateCursor(hit);
          return;
        }
        try {
          selectAtom(hit, { add: drag.shift || e.ctrlKey || drag.ctrl });
        } catch (err) {
          fail(err);
        }
      } else if (state.tool === 'select') {
        clearSelection();
      }
    }
    var nowHit = pickAtom(canvasPos(e).x, canvasPos(e).y);
    state.hover = nowHit;
    vcall('setHover', nowHit);
    updateCursor(nowHit);
  }

  function onPointerCancel(e) {
    var drag = state.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    state.drag = null;
    if (drag.committed && (drag.mode === 'move-atom' || drag.mode === 'move-fragment')) {
      finishMoveDrag(drag);
    } else {
      vcall('requestRender');
    }
    try { refs.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    updateCursor(null);
  }

  function onWheel(e) {
    e.preventDefault();
    var factor = Math.exp(-e.deltaY * 0.0015);
    if (!isFinite(factor) || factor <= 0) return;
    vcall('zoom', factor);
    updateOverlay();
  }

  /* ------------------------------ 编辑操作 ------------------------------ */

  function requireMolecule() {
    if (!state.mol) throw new Error(t('ui.errNotLoaded'));
    return state.mol;
  }

  function getCore() {
    if (!global.MolCore) throw new Error(t('ui.errCoreMissing'));
    return global.MolCore;
  }

  function resolveAtomList(atomsOpt, need) {
    var list;
    if (atomsOpt != null) {
      if (Object.prototype.toString.call(atomsOpt) !== '[object Array]') {
        throw new Error(t('ui.errAtomsArray'));
      }
      list = atomsOpt;
    } else {
      list = state.selection;
    }
    var out = [];
    for (var i = 0; i < list.length && out.length < need; i++) {
      var idx = Number(list[i]);
      if (!isFinite(idx) || Math.floor(idx) !== idx) throw new Error(t('ui.errAtomInt'));
      if (idx < 0 || idx >= state.mol.atoms.length) throw new Error(t('ui.errAtomRange', { index: list[i] }));
      if (out.indexOf(idx) !== -1) throw new Error(t('ui.errAtomsDuplicate'));
      out.push(idx);
    }
    if (out.length < need) {
      throw new Error(t('ui.errNeedAtoms', { need: need, have: out.length }));
    }
    return out;
  }

  function applyGeometryChange(snapshot, work, action) {
    var core = getCore();
    var mol = requireMolecule();
    if (!core.measure || !core.edit) throw new Error('核心模块缺少 measure/edit 实现');
    var before = null;
    try {
      before = measureBefore(core, mol, action.kind, action.atoms);
      work(core, mol);
    } catch (err) {
      restoreSnapshot(snapshot);
      vcall('requestRender');
      refreshAll();
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
    var after = null;
    try { after = measureBefore(core, mol, action.kind, action.atoms); } catch (e) { after = null; }
    commitUndo(snapshot);
    clearError();
    return { before: before, after: after };
  }

  function measureBefore(core, mol, kind, atoms) {
    if (kind === 'distance') return core.measure.distance(mol, atoms[0], atoms[1]);
    if (kind === 'angle') return core.measure.angle(mol, atoms[0], atoms[1], atoms[2]);
    return core.measure.dihedral(mol, atoms[0], atoms[1], atoms[2], atoms[3]);
  }

  function afterGeometryEdit(statusKey, statusParams) {
    var mol = state.mol;
    if (mol && mol.bondSource === 'inferred') {
      var core = global.MolCore;
      if (core && typeof core.rebond === 'function') {
        try { core.rebond(mol); } catch (err) {
          if (global.console && console.warn) console.warn('[MolApp] rebond failed:', err);
        }
      }
    }
    vcall('requestRender');
    refreshAll();
    if (statusKey) setStatus(statusKey, statusParams);
  }

  function applyBondLength(value, opts) {
    try {
      opts = opts || {};
      var mol = requireMolecule();
      var core = getCore();
      if (!core.measure || !core.edit) throw new Error(t('ui.errMeasureEditMissing'));
      var atoms = resolveAtomList(opts.atoms, 2);
      var target = Number(value);
      if (!isFinite(target)) throw new Error(t('ui.errLengthNumber'));
      if (target <= 0) throw new Error(t('ui.errLengthPositive'));
      var moveSide = opts.moveSide || (refs.bondLengthMove && refs.bondLengthMove.value) || 'j';
      var snapshot = takeSnapshot();
      var before;
      var moved;
      try {
        before = core.measure.distance(mol, atoms[0], atoms[1]);
        moved = core.edit.setBondLength(mol, atoms[0], atoms[1], target, { moveSide: moveSide });
      } catch (err) {
        restoreSnapshot(snapshot);
        vcall('requestRender');
        refreshAll();
        throw new Error(t('ui.errSetLength', { msg: chineseMessage(err) }));
      }
      commitUndo(snapshot);
      clearError();
      var after = core.measure.distance(mol, atoms[0], atoms[1]);
      afterGeometryEdit('status.bondLengthSet', { value: fmtDistance(after), before: fmtDistance(before) });
      return { before: before, after: after, moved: moved ? Array.prototype.slice.call(moved) : [] };
    } catch (err) {
      if (!(err && err._moleditReported)) fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function applyBondAngle(value, opts) {
    try {
      opts = opts || {};
      var mol = requireMolecule();
      var core = getCore();
      if (!core.measure || !core.edit) throw new Error(t('ui.errMeasureEditMissing'));
      var atoms = resolveAtomList(opts.atoms, 3);
      var target = Number(value);
      if (!isFinite(target)) throw new Error(t('ui.errAngleNumber'));
      if (target <= 0 || target >= 180) throw new Error(t('ui.errAngleRange'));
      var moveSide = opts.moveSide || (refs.angleMove && refs.angleMove.value) || 'k';
      var snapshot = takeSnapshot();
      var before;
      var moved;
      try {
        before = core.measure.angle(mol, atoms[0], atoms[1], atoms[2]);
        moved = core.edit.setBondAngle(mol, atoms[0], atoms[1], atoms[2], target, { moveSide: moveSide });
      } catch (err) {
        restoreSnapshot(snapshot);
        vcall('requestRender');
        refreshAll();
        throw new Error(t('ui.errSetAngle', { msg: chineseMessage(err) }));
      }
      commitUndo(snapshot);
      clearError();
      var after = core.measure.angle(mol, atoms[0], atoms[1], atoms[2]);
      afterGeometryEdit('status.angleSet', { value: fmtAngle(after), before: fmtAngle(before) });
      return { before: before, after: after, moved: moved ? Array.prototype.slice.call(moved) : [] };
    } catch (err) {
      if (!(err && err._moleditReported)) fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function applyBondDihedral(value, opts) {
    try {
      opts = opts || {};
      var mol = requireMolecule();
      var core = getCore();
      if (!core.measure || !core.edit) throw new Error(t('ui.errMeasureEditMissing'));
      var atoms = resolveAtomList(opts.atoms, 4);
      var target = Number(value);
      if (!isFinite(target)) throw new Error(t('ui.errDihedralNumber'));
      var moveSide = opts.moveSide || (refs.dihedralMove && refs.dihedralMove.value) || 'l';
      var snapshot = takeSnapshot();
      var before;
      var moved;
      try {
        before = core.measure.dihedral(mol, atoms[0], atoms[1], atoms[2], atoms[3]);
        moved = core.edit.setDihedral(mol, atoms[0], atoms[1], atoms[2], atoms[3], target, { moveSide: moveSide });
      } catch (err) {
        restoreSnapshot(snapshot);
        vcall('requestRender');
        refreshAll();
        throw new Error(t('ui.errSetDihedral', { msg: chineseMessage(err) }));
      }
      commitUndo(snapshot);
      clearError();
      var after = core.measure.dihedral(mol, atoms[0], atoms[1], atoms[2], atoms[3]);
      afterGeometryEdit('status.dihedralSet', { value: fmtAngle(after), before: fmtAngle(before) });
      return { before: before, after: after, moved: moved ? Array.prototype.slice.call(moved) : [] };
    } catch (err) {
      if (!(err && err._moleditReported)) fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function doRebond() {
    var mol = requireMolecule();
    var core = getCore();
    if (typeof core.rebond !== 'function') throw new Error(t('ui.errRebondMissing'));
    var snapshot = takeSnapshot();
    try {
      core.rebond(mol);
    } catch (err) {
      restoreSnapshot(snapshot);
      vcall('requestRender');
      refreshAll();
      fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
    commitUndo(snapshot);
    vcall('requestRender');
    refreshAll();
    setStatus('status.rebonded', { n: mol.bonds ? mol.bonds.length : 0 });
    return mol.bonds ? mol.bonds.length : 0;
  }

  /* ------------------------------ 显示设置 ------------------------------ */

  function setStyle(style) {
    var value = String(style || '').toLowerCase();
    if (STYLE_ALLOWED.indexOf(value) === -1) throw new Error(t('ui.errBadStyle', { style: style }));
    state.style = value;
    vcall('setOptions', { style: value });
    vcall('requestRender');
    refreshDisplayControls();
    setStatus('status.style', { style: styleLabel(value) });
  }

  function setOption(key, value) {
    key = String(key || '');
    if (OPTION_KEYS.indexOf(key) === -1) throw new Error(t('ui.errBadOption', { key: key }));
    state.options[key] = value;
    var patch = {};
    patch[key] = value;
    vcall('setOption', key, value);
    vcall('requestRender');
    refreshDisplayControls();
    if (key === 'labels' || key === 'indices' || key === 'showAxes') {
      setStatus(value ? 'ui.optionShown' : 'ui.optionHidden', { option: optionLabel(key) });
    }
  }

  function resetView() {
    if (!state.view) {
      setStatus('status.noRenderer');
      return;
    }
    vcall('resetCamera');
    vcall('requestRender');
    updateOverlay();
    setStatus('status.viewReset');
  }

  /* ------------------------------ 导出 ------------------------------ */

  function sanitizeFilename(name) {
    var base = String(name || 'molecule').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^\.+/, '').trim();
    if (!base) base = 'molecule';
    return base.slice(0, 80);
  }

  function exportText(format) {
    var fmt = String(format || '').toLowerCase().replace(/^\./, '');
    if (['xyz', 'gjf', 'sdf'].indexOf(fmt) === -1) throw new Error(t('ui.errExportFormat', { format: format }));
    var mol = requireMolecule();
    var core = getCore();
    if (!core.export || typeof core.export[fmt] !== 'function') {
      throw new Error(t('ui.errExportModule', { fmt: fmt }));
    }
    var text;
    try {
      text = core.export[fmt](mol);
    } catch (err) {
      fail(err);
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
    if (typeof text !== 'string' || !text.length) throw new Error(t('ui.errExportEmpty'));
    return text;
  }

  function downloadExport(format) {
    try {
      var fmt = String(format || '').toLowerCase();
      var text = exportText(fmt);
      var filename = sanitizeFilename(getTitle()) + '.' + fmt;
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 0);
      clearError();
      setStatus('status.exported', { file: filename });
    } catch (err) {
      if (!(err && err._moleditReported)) fail(err);
    }
  }

  /* ------------------------------ 电荷/多重度 ------------------------------ */

  function onChargeChange() {
    var mol = state.mol;
    if (!mol || !refs.chargeInput) return;
    var raw = refs.chargeInput.value;
    var value = Number(raw);
    if (raw === '' || !isFinite(value) || Math.floor(value) !== value) {
      var chargeMsg = t('ui.errChargeInt');
      showErrorBanner(chargeMsg);
      state.lastError = chargeMsg;
      refreshMoleculePanel();
      return;
    }
    if (value === mol.charge) { clearError(); return; }
    var snapshot = takeSnapshot();
    mol.charge = value;
    commitUndo(snapshot);
    clearError();
    refreshMoleculePanel();
    setStatus('status.chargeChanged', { value: value });
  }

  function onMultiplicityChange() {
    var mol = state.mol;
    if (!mol || !refs.multiplicityInput) return;
    var raw = refs.multiplicityInput.value;
    var value = Number(raw);
    if (raw === '' || !isFinite(value) || Math.floor(value) !== value || value < 1) {
      var multMsg = t('ui.errMultiplicityInt');
      showErrorBanner(multMsg);
      state.lastError = multMsg;
      refreshMoleculePanel();
      return;
    }
    if (value === mol.multiplicity) { clearError(); return; }
    var snapshot = takeSnapshot();
    mol.multiplicity = value;
    commitUndo(snapshot);
    clearError();
    refreshMoleculePanel();
    setStatus('status.multiplicityChanged', { value: value });
  }

  /* ------------------------------ 数据集 ------------------------------ */

  function setDatasetIndexApi(index) {
    applyDataset(index);
    setStatus('status.datasetSwitched', { i: state.datasetIndex + 1, n: state.molecules.length });
  }

  /* ------------------------------ 键盘 ------------------------------ */

  function onKeyDown(e) {
    var target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    var mod = e.ctrlKey || e.metaKey;
    var key = String(e.key || '').toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape') {
      clearSelection();
      hideErrorBanner();
    } else if (!mod && key === 'f') {
      e.preventDefault();
      resetView();
    }
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bindEvents() {
    if (refs.btnOpen && refs.fileInput) {
      refs.btnOpen.addEventListener('click', function () { refs.fileInput.click(); });
    }
    if (refs.fileInput) refs.fileInput.addEventListener('change', onFileInputChange);
    if (refs.sampleSelect) {
      refs.sampleSelect.addEventListener('change', function () {
        var key = refs.sampleSelect.value;
        if (!key) return;
        try {
          loadSample(key);
        } catch (err) {
          if (!(err && err._moleditReported)) fail(err);
        }
      });
    }
    if (refs.datasetSelect) {
      refs.datasetSelect.addEventListener('change', function () {
        try {
          setDatasetIndexApi(refs.datasetSelect.value);
        } catch (err) {
          if (!(err && err._moleditReported)) fail(err);
          refreshDatasetSelect();
        }
      });
    }
    if (refs.btnUndo) refs.btnUndo.addEventListener('click', function () { undo(); });
    if (refs.btnRedo) refs.btnRedo.addEventListener('click', function () { redo(); });
    if (refs.btnExportXyz) refs.btnExportXyz.addEventListener('click', function () { downloadExport('xyz'); });
    if (refs.btnExportGjf) refs.btnExportGjf.addEventListener('click', function () { downloadExport('gjf'); });
    if (refs.btnExportSdf) refs.btnExportSdf.addEventListener('click', function () { downloadExport('sdf'); });

    var toolButtons = document.querySelectorAll('[data-tool]');
    for (var i = 0; i < toolButtons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          try { setTool(btn.getAttribute('data-tool')); } catch (err) { fail(err); }
        });
      })(toolButtons[i]);
    }

    if (refs.btnApplyBondLength) {
      refs.btnApplyBondLength.addEventListener('click', function () {
        try {
          applyBondLength(refs.bondLengthInput.value, { moveSide: refs.bondLengthMove.value });
        } catch (err) {
          if (!(err && err._moleditReported)) fail(err);
        }
      });
    }
    if (refs.btnApplyAngle) {
      refs.btnApplyAngle.addEventListener('click', function () {
        try {
          applyBondAngle(refs.angleInput.value, { moveSide: refs.angleMove.value });
        } catch (err) {
          if (!(err && err._moleditReported)) fail(err);
        }
      });
    }
    if (refs.btnApplyDihedral) {
      refs.btnApplyDihedral.addEventListener('click', function () {
        try {
          applyBondDihedral(refs.dihedralInput.value, { moveSide: refs.dihedralMove.value });
        } catch (err) {
          if (!(err && err._moleditReported)) fail(err);
        }
      });
    }

    if (refs.styleSelect) {
      refs.styleSelect.addEventListener('change', function () {
        try { setStyle(refs.styleSelect.value); } catch (err) { fail(err); }
      });
    }
    if (refs.toggleLabels) {
      refs.toggleLabels.addEventListener('change', function () {
        setOption('labels', !!refs.toggleLabels.checked);
      });
    }
    if (refs.toggleIndices) {
      refs.toggleIndices.addEventListener('change', function () {
        setOption('indices', !!refs.toggleIndices.checked);
      });
    }
    if (refs.toggleAxes) {
      refs.toggleAxes.addEventListener('change', function () {
        setOption('showAxes', !!refs.toggleAxes.checked);
      });
    }
    if (refs.btnRebond) {
      refs.btnRebond.addEventListener('click', function () {
        try { doRebond(); } catch (err) { if (!(err && err._moleditReported)) fail(err); }
      });
    }
    if (refs.btnClearSelection) refs.btnClearSelection.addEventListener('click', clearSelection);
    if (refs.btnResetView) refs.btnResetView.addEventListener('click', function () { resetView(); });
    if (refs.chargeInput) refs.chargeInput.addEventListener('change', onChargeChange);
    if (refs.multiplicityInput) refs.multiplicityInput.addEventListener('change', onMultiplicityChange);
    if (refs.errorBanner) {
      refs.errorBanner.addEventListener('click', function () { refs.errorBanner.hidden = true; });
    }
    if (refs.langToggle) {
      refs.langToggle.addEventListener('click', function () {
        try { toggleLanguage(); } catch (err) { fail(err); }
      });
    }
    if (refs.tabMolecule) {
      refs.tabMolecule.addEventListener('click', function () {
        try {
          setSideTab('molecule');
          setStatus('status.tabMolecule');
        } catch (err) { fail(err); }
      });
    }
    if (refs.tabResults) {
      refs.tabResults.addEventListener('click', function () {
        if (refs.tabResults.disabled) return;
        try {
          setSideTab('results');
          setStatus('status.tabResults');
        } catch (err) { fail(err); }
      });
    }

    if (refs.canvas) {
      refs.canvas.addEventListener('pointerdown', onPointerDown);
      refs.canvas.addEventListener('pointermove', onPointerMove);
      refs.canvas.addEventListener('pointerup', onPointerUp);
      refs.canvas.addEventListener('pointercancel', onPointerCancel);
      refs.canvas.addEventListener('pointerleave', function () {
        if (state.drag) return;
        state.hover = null;
        vcall('setHover', null);
        updateCursor(null);
      });
      refs.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    if (refs.viewport) {
      refs.viewport.addEventListener('wheel', onWheel, { passive: false });
      refs.viewport.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      bindDropZone();
    }
    document.addEventListener('keydown', onKeyDown);
    global.addEventListener('error', function (event) {
      if (!state.booted) return;
      var msg = (event && event.message) ? String(event.message) : '';
      if (!msg) return;
      if (state.lastError === msg) return;
      state.lastError = msg;
      showErrorBanner(t('ui.errScript', { msg: msg }));
    });
    global.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var msg = chineseMessage(reason);
      state.lastError = msg;
      showErrorBanner(msg);
    });
  }

  function cacheRefs() {
    refs.app = $('app');
    refs.topbar = $('topbar');
    refs.fileInput = $('file-input');
    refs.btnOpen = $('btn-open');
    refs.sampleSelect = $('sample-select');
    refs.btnUndo = $('btn-undo');
    refs.btnRedo = $('btn-redo');
    refs.btnExportXyz = $('btn-export-xyz');
    refs.btnExportGjf = $('btn-export-gjf');
    refs.btnExportSdf = $('btn-export-sdf');
    refs.toolbar = $('toolbar');
    refs.viewport = $('viewport');
    refs.canvas = $('viewport-canvas');
    refs.overlay = $('viewport-overlay');
    refs.emptyHint = $('empty-hint');
    refs.emptyHintSub = $('empty-hint-sub');
    refs.viewportHud = $('viewport-hud');
    refs.mouseHint = $('mouse-hint');
    refs.sidepanel = $('sidepanel');
    refs.molTitle = $('mol-title');
    refs.molFormat = $('mol-format');
    refs.datasetSelect = $('dataset-select');
    refs.datasetLabel = $('dataset-label');
    refs.atomCount = $('atom-count');
    refs.bondCount = $('bond-count');
    refs.chargeInput = $('charge-input');
    refs.multiplicityInput = $('multiplicity-input');
    refs.selectionCount = $('selection-count');
    refs.selectionList = $('selection-list');
    refs.measureDistance = $('measure-distance');
    refs.measureAngle = $('measure-angle');
    refs.measureDihedral = $('measure-dihedral');
    refs.cardBondLength = $('card-bond-length');
    refs.cardAngle = $('card-angle');
    refs.cardDihedral = $('card-dihedral');
    refs.bondLengthInput = $('bond-length-input');
    refs.bondLengthMove = $('bond-length-move');
    refs.btnApplyBondLength = $('btn-apply-bond-length');
    refs.angleInput = $('angle-input');
    refs.angleMove = $('angle-move');
    refs.btnApplyAngle = $('btn-apply-angle');
    refs.dihedralInput = $('dihedral-input');
    refs.dihedralMove = $('dihedral-move');
    refs.btnApplyDihedral = $('btn-apply-dihedral');
    refs.styleSelect = $('style-select');
    refs.toggleLabels = $('toggle-labels');
    refs.toggleIndices = $('toggle-indices');
    refs.toggleAxes = $('toggle-axes');
    refs.btnRebond = $('btn-rebond');
    refs.btnClearSelection = $('btn-clear-selection');
    refs.btnResetView = $('btn-reset-view');
    refs.statusBar = $('status-bar');
    refs.errorBanner = $('error-banner');
    /* v2：语言切换 + 侧栏 Tab + 结果面板容器 */
    refs.langToggle = $('lang-toggle');
    refs.sideTabs = $('side-tabs');
    refs.tabMolecule = $('tab-molecule');
    refs.tabResults = $('tab-results');
    refs.tabPageMolecule = $('tab-page-molecule');
    refs.tabPageResults = $('tab-page-results');
    refs.resultsPanel = $('results-panel');
  }

  /* ------------------------------ 启动 ------------------------------ */

  function checkDependencies() {
    var missing = [];
    if (!global.MolCore) {
      missing.push('js/core.js（MolCore）');
    } else {
      if (!global.MolCore.measure) missing.push('js/core.js（MolCore.measure）');
      if (typeof global.MolCore.parseFile !== 'function') missing.push('js/parsers.js（MolCore.parseFile）');
      if (!global.MolCore.edit) missing.push('js/core.js（MolCore.edit）');
    }
    if (!global.MolRender || typeof global.MolRender.createView !== 'function') {
      missing.push('js/renderer.js（MolRender.createView）');
    }
    if (!global.MolSamples) missing.push('js/samples.js（MolSamples）');
    return missing;
  }

  function boot() {
    cacheRefs();
    buildOverlay();
    initI18n();
    var missing = checkDependencies();
    state.depsMissing = missing;

    initView();
    populateSampleSelect();
    initResultsPanel();
    if (state.resultsPanel) {
      try { state.resultsPanel.setActive(false); } catch (err) { /* 忽略 */ }
    }
    bindEvents();
    refreshAll();
    updateMouseHint();
    updateLangButton();

    if (missing.length) {
      fail(new Error(t('ui.errDepsMissing', { list: missing.join(t('ui.listSeparator')) })));
    } else {
      setStatus('status.ready');
    }
    updateDepsMissingHint();
    state.booted = true;

    requestAnimationFrame(function () {
      vcall('resize');
      vcall('requestRender');
      updateOverlay();
      requestAnimationFrame(function () {
        if (state.readyResolved) return;
        state.readyResolved = true;
        if (resolveReady) resolveReady();
      });
    });
  }

  /* --------------------------- v2 公共 API 辅助 --------------------------- */

  function getResultsStateApi() {
    var summary = logSummary();
    var panelState = resultsPanelState();
    var tabDisabled = !!(refs.tabResults && refs.tabResults.disabled);
    return {
      available: !!(summary && summary.hasAnalysis) && !tabDisabled,
      activeTab: state.sideTab,
      jobCount: (summary && summary.jobCount != null)
        ? summary.jobCount
        : ((state.logResults && Array.isArray(state.logResults.jobs)) ? state.logResults.jobs.length : 0),
      frequencyCount: (summary && Array.isArray(summary.frequencies)) ? summary.frequencies.length : 0,
      hasFrequencies: !!(summary && summary.hasFrequencies),
      hasOptimization: !!(summary && summary.hasOptimization),
      hasThermochemistry: !!(summary && summary.hasThermochemistry),
      animating: !!(panelState && panelState.animating),
      paused: !!(panelState && panelState.paused),
      selectedMode: (panelState && panelState.selectedMode != null) ? panelState.selectedMode : null,
      amplitude: (panelState && typeof panelState.amplitude === 'number') ? panelState.amplitude : 50,
      freqFrameIndex: (summary && summary.freqFrameIndex != null) ? summary.freqFrameIndex : null,
      finalEnergy: (summary && summary.finalEnergy != null) ? summary.finalEnergy : null
    };
  }

  function frequencyList() {
    var summary = logSummary();
    return (summary && Array.isArray(summary.frequencies)) ? summary.frequencies : [];
  }

  function playFrequencyApi(modeIndex) {
    var panel = requireResultsPanel();
    if (!resultsAvailable()) throw new Error(t('ui.errResultsUnavailable'));
    var freqs = frequencyList();
    if (!freqs.length) throw new Error(t('ui.errNoFrequencies'));
    var mode = (modeIndex == null) ? 0 : Number(modeIndex);
    if (!isFinite(mode) || Math.floor(mode) !== mode || mode < 0 || mode >= freqs.length) {
      throw new Error(t('ui.errFrequencyMode', { index: modeIndex }));
    }
    if (typeof panel.playFrequency !== 'function') throw new Error(t('ui.errResultsPanelMissing'));
    try {
      panel.playFrequency(mode);
    } catch (err) {
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
    if (state.sideTab !== 'results' && refs.tabResults && !refs.tabResults.disabled) {
      try { setSideTab('results'); } catch (err) { /* 忽略 */ }
    }
  }

  function stopFrequencyAnimationApi() {
    var panel = requireResultsPanel();
    if (typeof panel.stopAnimation !== 'function') throw new Error(t('ui.errResultsPanelMissing'));
    try {
      panel.stopAnimation();
    } catch (err) {
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function getFrequencyAnimationStateApi() {
    var panelState = resultsPanelState();
    var summary = logSummary();
    return {
      animating: !!(panelState && panelState.animating),
      paused: !!(panelState && panelState.paused),
      selectedMode: (panelState && panelState.selectedMode != null) ? panelState.selectedMode : null,
      amplitude: (panelState && typeof panelState.amplitude === 'number') ? panelState.amplitude : 50,
      freqFrameIndex: (summary && summary.freqFrameIndex != null) ? summary.freqFrameIndex : null
    };
  }

  function setFrequencyAmplitudeApi(percent) {
    var panel = requireResultsPanel();
    var value = Number(percent);
    if (!isFinite(value)) throw new Error(t('ui.errAmplitude'));
    if (typeof panel.setAmplitude !== 'function') throw new Error(t('ui.errResultsPanelMissing'));
    try {
      panel.setAmplitude(value);
    } catch (err) {
      throw (err instanceof Error ? err : new Error(chineseMessage(err)));
    }
  }

  function updateDepsMissingHint() {
    if (!refs.emptyHintSub) return;
    if (!state.depsMissing || !state.depsMissing.length) return;
    refs.emptyHintSub.textContent = t('ui.depsMissingHint', { list: state.depsMissing.join(t('ui.listSeparator')) });
  }

  function makeApi() {
    return {
      version: VERSION,

      getState: function () {
        var mol = state.mol;
        return {
          hasMolecule: !!mol,
          atomCount: mol && mol.atoms ? mol.atoms.length : 0,
          bondCount: mol && mol.bonds ? mol.bonds.length : 0,
          selection: state.selection.slice(),
          style: state.style,
          format: state.format,
          title: getTitle(),
          datasetIndex: state.datasetIndex,
          datasetCount: state.molecules.length,
          charge: mol ? (mol.charge == null ? 0 : mol.charge) : 0,
          multiplicity: mol ? (mol.multiplicity == null ? 1 : mol.multiplicity) : 1,
          filename: state.filename,
          warnings: state.warnings.slice(),
          lang: state.lang,
          activeTab: state.sideTab,
          hasLogResults: !!(state.logResults && state.logResults.ok !== false)
        };
      },

      loadText: function (text, opts) {
        try { return Promise.resolve(loadText(text, opts)); }
        catch (err) { return Promise.reject(err); }
      },
      loadSample: function (key) {
        try { return Promise.resolve(loadSample(key)); }
        catch (err) { return Promise.reject(err); }
      },
      listSamples: listSamples,

      getMeasurements: function () { return computeMeasurements(); },
      getAtom: function (index) {
        var mol = state.mol;
        var idx = Number(index);
        if (!mol || !isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= mol.atoms.length) return null;
        var a = mol.atoms[idx];
        return { symbol: a.symbol, x: a.x, y: a.y, z: a.z };
      },
      getBonds: function () {
        var mol = state.mol;
        if (!mol || !mol.bonds) return [];
        return mol.bonds.map(function (b) { return { i: b.i, j: b.j, order: b.order }; });
      },

      setSelection: setSelection,
      selectAtom: selectAtom,
      clearSelection: clearSelection,

      setStyle: setStyle,
      setOption: setOption,
      resetView: resetView,
      setDatasetIndex: setDatasetIndexApi,

      applyBondLength: applyBondLength,
      applyBondAngle: applyBondAngle,
      applyBondDihedral: applyBondDihedral,

      undo: undo,
      redo: redo,
      exportText: exportText,
      getLastError: function () { return state.lastError; },
      rebond: function () { doRebond(); },

      /* ---------------- v2：i18n + 结果面板 / 频率动画 ---------------- */
      setLanguage: function (lang) { setLanguageApi(lang); },
      getLanguage: function () { return state.lang; },
      getLogResults: function () { return state.logResults; },
      getResultsState: getResultsStateApi,
      setSideTab: function (name) { setSideTab(name); },
      playFrequency: playFrequencyApi,
      stopFrequencyAnimation: stopFrequencyAnimationApi,
      getFrequencyAnimationState: getFrequencyAnimationStateApi,
      setFrequencyAmplitude: setFrequencyAmplitudeApi
    };
  }

  /* ------------------------------ 对外暴露 ------------------------------ */

  var readyPromise = new Promise(function (resolve) { resolveReady = resolve; });
  var api = makeApi();
  api.ready = readyPromise;

  try {
    Object.defineProperty(global, 'MolApp', {
      value: api,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (err) {
    global.MolApp = api;
  }

  function start() {
    try {
      boot();
    } catch (err) {
      fail(err);
      if (!state.readyResolved) {
        state.readyResolved = true;
        if (resolveReady) resolveReady();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
