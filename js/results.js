/* ============================================================================
 * MolEdit v2 — js/results.js
 * GaussView 风格“计算结果”面板：单点能 / 热化学概要、能量曲线、优化收敛曲线、
 * 频率列表与 3D 视口中的振动动画。挂载 globalThis.MolResults。
 *
 * 契约：INTERFACE2.md §6（§6.1 API / §6.2 行为 / §6.3 自测）。
 * 依赖：js/i18n.js（先加载）、js/charts.js（先加载）、renderer 的
 *       view.setDisplacements()（运行时可选，缺失时给出本地化错误）。
 *
 * 用法：
 *   var panel = MolResults.create(document.getElementById('results-panel'), {
 *     i18n: MolI18n,
 *     getView: function () { return state.view; },          // -> renderer view|null
 *     onRequestFrame: function (frameIndex) { ... }          // 可选：切到该几何帧
 *   });
 *   panel.setResults(logResults | null);
 *
 * 本文件只创建/控制 container 内部 DOM，不改分子数据、不调用 view.setMolecule。
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var HARTREE_TO_KCAL = 627.5094740631;

  /* ======================================================================
   * 0. 文案字典（results.* 命名空间，加载时注册到 MolI18n）
   * ==================================================================== */

  var EN = {
    'results.empty.title': 'No calculation results',
    'results.empty.text': 'Open a Gaussian .log file to view single-point energies, thermochemistry, optimization convergence and vibrational frequencies.',
    'results.jobs.label': 'Job',
    'results.jobs.option': 'Job {n}',
    'results.sections.energy': 'Energy profile',
    'results.sections.convergence': 'Optimization convergence',
    'results.sections.frequencies': 'Vibrational frequencies',
    'results.field.natoms': 'Atoms',
    'results.field.route': 'Route',
    'results.field.charge': 'Charge',
    'results.field.multiplicity': 'Multiplicity',
    'results.field.finalEnergy': 'Final SCF energy (Eh)',
    'results.field.termination': 'Termination',
    'results.field.optimization': 'Optimization',
    'results.field.temperature': 'Temperature (K)',
    'results.field.pressure': 'Pressure (atm)',
    'results.field.zpe': 'Zero-point correction (Eh)',
    'results.field.thermalEnergy': 'Thermal correction to energy (Eh)',
    'results.field.thermalEnthalpy': 'Thermal correction to enthalpy (Eh)',
    'results.field.thermalGibbs': 'Thermal correction to Gibbs (Eh)',
    'results.field.sumZpe': 'Sum of electronic and zero-point energies (Eh)',
    'results.field.sumEnergy': 'Sum of electronic and thermal energies (Eh)',
    'results.field.sumEnthalpy': 'Sum of electronic and thermal enthalpies (Eh)',
    'results.field.sumGibbs': 'Sum of electronic and thermal free energies (Eh)',
    'results.values.normal': 'Normal',
    'results.values.error': 'Error',
    'results.values.unknown': 'Unknown',
    'results.values.optimized': 'Optimized',
    'results.values.notConverged': 'Not converged',
    'results.values.none': '—',
    'results.chart.step': 'Optimization step',
    'results.chart.deltaEnergy': 'ΔE (kcal/mol)',
    'results.chart.energy': 'Energy (Eh)',
    'results.chart.logValue': 'log10(value)',
    'results.chart.singlePoint': 'Single point: E = {energy} Eh',
    'results.chart.noEnergy': 'No optimization data',
    'results.chart.noConvergence': 'No convergence data',
    'results.chart.legendDelta': 'ΔE (kcal/mol)',
    'results.chart.singlePointLegend': 'E (Eh)',
    'results.chart.thresholdNote': 'Dashed lines: convergence thresholds.',
    'results.conv.maxForce': 'Max Force',
    'results.conv.rmsForce': 'RMS Force',
    'results.conv.maxDisplacement': 'Max Displacement',
    'results.conv.rmsDisplacement': 'RMS Displacement',
    'results.freq.ir': 'IR',
    'results.freq.modeLabel': 'Mode {n} · {value} cm⁻¹',
    'results.freq.amplitude': 'Amplitude',
    'results.freq.play': 'Play vibration animation',
    'results.freq.pause': 'Pause vibration animation',
    'results.freq.resume': 'Resume vibration animation',
    'results.freq.stop': 'Stop vibration animation',
    'results.freq.noteFrame': 'Vibration animation plays in the 3D viewport (geometry frame {frame}).',
    'results.freq.noteNoFrame': 'Vibration animation plays in the 3D viewport.',
    'results.freq.noteSomeMissing': 'Some modes have no displacement data and cannot be animated.',
    'results.freq.noteAllMissing': 'No mode has displacement data; animation is unavailable.',
    'results.freq.noteNoFrequencies': 'No frequency data.',
    'results.error.noFrequencies': 'No frequency data available.',
    'results.error.noDisplacements': 'No displacement data for this mode.',
    'results.error.invalidMode': 'Invalid frequency mode: {mode}.',
    'results.error.noView': 'No 3D viewport is available for the vibration animation.',
    'results.error.noRendererSupport': 'The 3D renderer does not support displacement animation.'
  };

  var ZH = {
    'results.empty.title': '暂无计算结果',
    'results.empty.text': '打开 Gaussian .log 文件后可查看单点能、热化学、优化收敛与振动频率。',
    'results.jobs.label': '任务',
    'results.jobs.option': '任务 {n}',
    'results.sections.energy': '能量曲线',
    'results.sections.convergence': '优化收敛',
    'results.sections.frequencies': '振动频率',
    'results.field.natoms': '原子数',
    'results.field.route': '路由',
    'results.field.charge': '电荷',
    'results.field.multiplicity': '多重度',
    'results.field.finalEnergy': '最终 SCF 能量 (Eh)',
    'results.field.termination': '终止状态',
    'results.field.optimization': '优化状态',
    'results.field.temperature': '温度 (K)',
    'results.field.pressure': '压力 (atm)',
    'results.field.zpe': '零点校正 (Eh)',
    'results.field.thermalEnergy': '热能校正 (Eh)',
    'results.field.thermalEnthalpy': '焓校正 (Eh)',
    'results.field.thermalGibbs': '吉布斯自由能校正 (Eh)',
    'results.field.sumZpe': '电子能 + 零点能 (Eh)',
    'results.field.sumEnergy': '电子能 + 热能 (Eh)',
    'results.field.sumEnthalpy': '电子能 + 热焓 (Eh)',
    'results.field.sumGibbs': '电子能 + 热自由能 (Eh)',
    'results.values.normal': '正常',
    'results.values.error': '异常',
    'results.values.unknown': '未知',
    'results.values.optimized': '已收敛',
    'results.values.notConverged': '未收敛',
    'results.values.none': '—',
    'results.chart.step': '优化步',
    'results.chart.deltaEnergy': 'ΔE (kcal/mol)',
    'results.chart.energy': '能量 (Eh)',
    'results.chart.logValue': 'log10(数值)',
    'results.chart.singlePoint': '单点能：E = {energy} Eh',
    'results.chart.noEnergy': '无优化数据',
    'results.chart.noConvergence': '无收敛数据',
    'results.chart.legendDelta': 'ΔE (kcal/mol)',
    'results.chart.singlePointLegend': 'E (Eh)',
    'results.chart.thresholdNote': '虚线为 4 项收敛判据的阈值。',
    'results.conv.maxForce': '最大力',
    'results.conv.rmsForce': 'RMS 力',
    'results.conv.maxDisplacement': '最大位移',
    'results.conv.rmsDisplacement': 'RMS 位移',
    'results.freq.ir': 'IR',
    'results.freq.modeLabel': '模式 {n} · {value} cm⁻¹',
    'results.freq.amplitude': '振幅',
    'results.freq.play': '播放振动动画',
    'results.freq.pause': '暂停振动动画',
    'results.freq.resume': '继续振动动画',
    'results.freq.stop': '停止振动动画',
    'results.freq.noteFrame': '振动动画在 3D 视口中播放（几何帧 {frame}）。',
    'results.freq.noteNoFrame': '振动动画在 3D 视口中播放。',
    'results.freq.noteSomeMissing': '部分模式缺少位移数据，无法播放动画。',
    'results.freq.noteAllMissing': '所有模式都缺少位移数据，无法播放动画。',
    'results.freq.noteNoFrequencies': '无频率数据。',
    'results.error.noFrequencies': '没有可用的频率数据。',
    'results.error.noDisplacements': '该模式没有位移数据，无法播放振动动画。',
    'results.error.invalidMode': '无效的频率模式：{mode}。',
    'results.error.noView': '没有可用的 3D 视口，无法播放振动动画。',
    'results.error.noRendererSupport': '当前渲染器不支持振动位移，无法播放振动动画。'
  };

  /** 概要表字段（顺序即渲染顺序，data-field 与 INTERFACE2.md §6.1 完全一致） */
  var SUMMARY_FIELDS = [
    'natoms', 'route', 'charge', 'multiplicity',
    'final-energy', 'termination', 'optimization',
    'temperature', 'pressure',
    'zpe', 'thermal-energy', 'thermal-enthalpy', 'thermal-gibbs',
    'sum-zpe', 'sum-energy', 'sum-enthalpy', 'sum-gibbs'
  ];
  var FIELD_LABEL_KEYS = {
    'natoms': 'results.field.natoms',
    'route': 'results.field.route',
    'charge': 'results.field.charge',
    'multiplicity': 'results.field.multiplicity',
    'final-energy': 'results.field.finalEnergy',
    'termination': 'results.field.termination',
    'optimization': 'results.field.optimization',
    'temperature': 'results.field.temperature',
    'pressure': 'results.field.pressure',
    'zpe': 'results.field.zpe',
    'thermal-energy': 'results.field.thermalEnergy',
    'thermal-enthalpy': 'results.field.thermalEnthalpy',
    'thermal-gibbs': 'results.field.thermalGibbs',
    'sum-zpe': 'results.field.sumZpe',
    'sum-energy': 'results.field.sumEnergy',
    'sum-enthalpy': 'results.field.sumEnthalpy',
    'sum-gibbs': 'results.field.sumGibbs'
  };

  /** 4 项优化收敛判据（阈值来自 Gaussian 默认值，INTERFACE2.md §4.4） */
  var CONV_METRICS = [
    { key: 'maxForce', field: 'maxForce', threshold: 0.000450, color: '#d94f3d' },
    { key: 'rmsForce', field: 'rmsForce', threshold: 0.000300, color: '#e08a1e' },
    { key: 'maxDisplacement', field: 'maxDisplacement', threshold: 0.001800, color: '#2563eb' },
    { key: 'rmsDisplacement', field: 'rmsDisplacement', threshold: 0.001200, color: '#0f9c9c' }
  ];
  var ENERGY_COLOR = '#2563eb';

  var PLAY_SYMBOL = '▶';
  var PAUSE_SYMBOL = '⏸';
  var STOP_SYMBOL = '■';
  var AMPLITUDE_DEFAULT = 50;
  var AMPLITUDE_MIN = 10;
  var AMPLITUDE_MAX = 100;
  var BASE_AMPLITUDE_ANGSTROM = 0.5;   // 100% 时最大位移 0.5 Å
  var PHASE_SPEED = 1.2 * Math.PI;     // rad/s

  /* ======================================================================
   * 1. 小工具
   * ==================================================================== */

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return has(params, k) && params[k] != null ? String(params[k]) : m;
    });
  }

  function makeEl(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function fmtHartree(v) {
    return isNum(v) ? v.toFixed(6) : '—';
  }

  function fmtInt(v) {
    return isNum(v) ? String(Math.round(v)) : '—';
  }

  function fmtText(v) {
    if (v == null) return '—';
    var s = String(v);
    return s === '' ? '—' : s;
  }

  function truncateStr(s, max) {
    s = String(s == null ? '' : s);
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + '…';
  }

  /** 频率值文本：虚频强制显示为负数 */
  function freqValueText(freq) {
    var f = freq || {};
    if (!isNum(f.frequency)) return '—';
    var v = f.frequency;
    var imaginary = f.imaginary === true || v < 0;
    if (imaginary && v > 0) v = -v;
    return v.toFixed(2) + ' cm⁻¹';
  }

  function isImaginaryFreq(freq) {
    if (!freq) return false;
    if (freq.imaginary === true) return true;
    return isNum(freq.frequency) && freq.frequency < 0;
  }

  function hasDisplacements(freq) {
    return !!(freq && Array.isArray(freq.displacements) && freq.displacements.length > 0);
  }

  function rafWanted(rootObj, cb) {
    if (typeof rootObj.requestAnimationFrame === 'function') return rootObj.requestAnimationFrame(cb);
    return setTimeout(function () { cb(Date.now()); }, 16);
  }

  function cafWanted(rootObj, id) {
    if (id == null) return;
    if (typeof rootObj.cancelAnimationFrame === 'function') rootObj.cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  /* ======================================================================
   * 2. i18n 注册 / 取词
   * ==================================================================== */

  function registerDictionary() {
    var M = root.MolI18n;
    if (!M || typeof M.register !== 'function') return false;
    try {
      M.register('en', EN);
      M.register('zh', ZH);
      return true;
    } catch (err) {
      return false;
    }
  }

  registerDictionary();

  /* ======================================================================
   * 3. 面板工厂
   * ==================================================================== */

  /**
   * 创建计算结果面板。
   * @param {HTMLElement} containerEl 容器（index.html 的 #results-panel）
   * @param {object} opts { i18n, getView, onRequestFrame }
   */
  function create(containerEl, opts) {
    if (!containerEl || containerEl.nodeType !== 1) {
      throw new Error('MolResults.create: 需要一个有效的容器元素');
    }
    opts = opts || {};
    var i18n = opts.i18n || root.MolI18n || null;
    if (!i18n) throw new Error('MolResults.create: 需要传入 i18n（MolI18n）');
    // 极端情况下（脚本乱序加载）补注册字典
    if (typeof i18n.has !== 'function' || !i18n.has('results.empty.title')) registerDictionary();

    /* --------------------------- 3.1 取词闭包 --------------------------- */

    function t(key, params) {
      var out = null;
      if (i18n && typeof i18n.t === 'function') {
        try { out = i18n.t(key, params); } catch (err) { out = null; }
      }
      if (typeof out !== 'string' || out === key) {
        var lang = 'en';
        try {
          if (i18n && typeof i18n.getLang === 'function') lang = i18n.getLang() || 'en';
        } catch (err) { lang = 'en'; }
        var dict = lang === 'zh' ? ZH : EN;
        out = has(dict, key) ? dict[key] : (has(EN, key) ? EN[key] : key);
      }
      return interpolate(out, params);
    }

    function mkError(key, params) {
      var err = new Error(t(key, params));
      err.key = key;
      return err;
    }

    /* --------------------------- 3.2 运行状态 --------------------------- */

    var state = {
      disposed: false,
      results: null,
      available: false,
      active: true,              // tab 是否可见
      jobIndex: 0,
      jobCount: 0,
      frequencyCount: 0,
      selectedMode: null,
      animating: false,          // 内部 playing 别名
      paused: false,
      amplitude: AMPLITUDE_DEFAULT,
      phase: 0,
      lastTs: 0,
      base: null,                // { vecs:[[x,y,z]|undefined], len, maxLen }
      view: null,
      rafId: null,
      animToken: 0,
      noteError: null,
      hasCharts: false,
      hasFrequencies: false,
      hasOptimization: false,
      hasThermochemistry: false,
      energyPoints: 0,
      convSeries: 0,
      energyCfg: null,
      convCfg: null,
      energyChartInfo: null,
      convChartInfo: null,
      chartDrawScheduled: false,
      chartRafId: null,
      resizeRafId: null,
      i18nUnsubscribe: null
    };

    /* --------------------------- 3.3 构建 DOM --------------------------- */

    containerEl.innerHTML = '';
    var container = containerEl;

    var emptyEl = makeEl('div', 'res-empty');
    emptyEl.id = 'results-empty';
    var emptyTitle = makeEl('p', 'res-empty-title');
    var emptyText = makeEl('p', 'res-empty-text');
    emptyEl.appendChild(emptyTitle);
    emptyEl.appendChild(emptyText);
    container.appendChild(emptyEl);

    var contentEl = makeEl('div', 'res-content');
    contentEl.id = 'results-content';
    contentEl.hidden = true;

    // job 选择行
    var jobRow = makeEl('div', 'res-job-row');
    jobRow.hidden = true;
    var jobLabel = makeEl('label', 'res-job-label');
    jobLabel.htmlFor = 'results-job-select';
    var jobSelect = document.createElement('select');
    jobSelect.id = 'results-job-select';
    jobSelect.className = 'res-select';
    jobSelect.setAttribute('aria-label', 'Calculation job');
    jobRow.appendChild(jobLabel);
    jobRow.appendChild(jobSelect);
    contentEl.appendChild(jobRow);

    // 概要
    var summaryEl = makeEl('div', 'res-summary');
    summaryEl.id = 'results-summary';
    contentEl.appendChild(summaryEl);

    // 能量曲线
    var energySection = makeEl('section', 'res-section');
    energySection.id = 'results-energy-section';
    var energyTitle = makeEl('h3', 'res-title');
    energyTitle.id = 'results-energy-title';
    var energyCanvas = document.createElement('canvas');
    energyCanvas.id = 'results-energy-canvas';
    energyCanvas.className = 'res-chart res-chart-energy';
    var energyNote = makeEl('p', 'res-note res-note-energy');
    energyNote.id = 'results-energy-note';
    energyNote.hidden = true;
    energySection.appendChild(energyTitle);
    energySection.appendChild(energyCanvas);
    energySection.appendChild(energyNote);
    contentEl.appendChild(energySection);

    // 收敛曲线
    var convSection = makeEl('section', 'res-section');
    convSection.id = 'results-conv-section';
    var convTitle = makeEl('h3', 'res-title');
    convTitle.id = 'results-conv-title';
    var convCanvas = document.createElement('canvas');
    convCanvas.id = 'results-conv-canvas';
    convCanvas.className = 'res-chart res-chart-conv';
    var convNote = makeEl('p', 'res-note res-note-conv');
    convNote.id = 'results-conv-note';
    convNote.hidden = true;
    convSection.appendChild(convTitle);
    convSection.appendChild(convCanvas);
    convSection.appendChild(convNote);
    contentEl.appendChild(convSection);

    // 频率列表 + 控制
    var freqSection = makeEl('section', 'res-section');
    freqSection.id = 'results-freq-section';
    var freqTitle = makeEl('h3', 'res-title');
    freqTitle.id = 'results-freq-title';
    var freqList = makeEl('div', 'res-freq-list');
    freqList.id = 'results-freq-list';
    freqList.setAttribute('role', 'listbox');

    var freqControls = makeEl('div', 'res-freq-controls');
    freqControls.id = 'results-freq-controls';

    var playBtn = makeEl('button', 'res-btn res-btn-play', PLAY_SYMBOL);
    playBtn.id = 'results-freq-play';
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', t('results.freq.play'));

    var stopBtn = makeEl('button', 'res-btn res-btn-stop', STOP_SYMBOL);
    stopBtn.id = 'results-freq-stop';
    stopBtn.type = 'button';
    stopBtn.setAttribute('aria-label', t('results.freq.stop'));

    var ampLabel = makeEl('label', 'res-amp');
    var ampLabelText = makeEl('span', 'res-amp-label');
    var ampInput = document.createElement('input');
    ampInput.id = 'results-freq-amplitude';
    ampInput.type = 'range';
    ampInput.min = String(AMPLITUDE_MIN);
    ampInput.max = String(AMPLITUDE_MAX);
    ampInput.step = '1';
    ampInput.value = String(AMPLITUDE_DEFAULT);
    ampInput.className = 'res-amp-input';
    var ampValue = makeEl('span', 'res-amp-value', String(AMPLITUDE_DEFAULT) + '%');
    ampLabel.appendChild(ampLabelText);
    ampLabel.appendChild(ampInput);
    ampLabel.appendChild(ampValue);

    var modeLabel = makeEl('span', 'res-mode-label', '—');
    modeLabel.id = 'results-freq-mode-label';

    freqControls.appendChild(playBtn);
    freqControls.appendChild(stopBtn);
    freqControls.appendChild(ampLabel);
    freqControls.appendChild(modeLabel);

    var freqNote = makeEl('p', 'res-note');
    freqNote.id = 'results-freq-note';

    freqSection.appendChild(freqTitle);
    freqSection.appendChild(freqList);
    freqSection.appendChild(freqControls);
    freqSection.appendChild(freqNote);
    contentEl.appendChild(freqSection);

    container.appendChild(contentEl);

    var refs = {
      container: container,
      empty: emptyEl,
      emptyTitle: emptyTitle,
      emptyText: emptyText,
      content: contentEl,
      jobRow: jobRow,
      jobLabel: jobLabel,
      jobSelect: jobSelect,
      summary: summaryEl,
      energySection: energySection,
      energyTitle: energyTitle,
      energyCanvas: energyCanvas,
      energyNote: energyNote,
      convSection: convSection,
      convTitle: convTitle,
      convCanvas: convCanvas,
      convNote: convNote,
      freqSection: freqSection,
      freqTitle: freqTitle,
      freqList: freqList,
      freqControls: freqControls,
      playBtn: playBtn,
      stopBtn: stopBtn,
      ampLabel: ampLabel,
      ampLabelText: ampLabelText,
      ampInput: ampInput,
      ampValue: ampValue,
      modeLabel: modeLabel,
      freqNote: freqNote
    };

    /* --------------------------- 3.4 数据选取 --------------------------- */

    function activeJob() {
      var res = state.results;
      if (!res || !Array.isArray(res.jobs) || !res.jobs.length) return null;
      var idx = state.jobIndex;
      if (idx == null || idx < 0 || idx >= res.jobs.length) idx = 0;
      return res.jobs[idx] || null;
    }

    function jobHasData(job) {
      if (!job) return false;
      if (Array.isArray(job.scfEnergies) && job.scfEnergies.length) return true;
      if (Array.isArray(job.optSteps) && job.optSteps.length) return true;
      if (Array.isArray(job.frequencies) && job.frequencies.length) return true;
      if (job.thermochemistry) return true;
      if (job.optimization) return true;
      if (job.route) return true;
      return false;
    }

    function getEnergySteps() {
      var job = activeJob();
      var steps = [];
      var i;
      if (job) {
        if (Array.isArray(job.optSteps)) {
          for (i = 0; i < job.optSteps.length; i++) {
            var os = job.optSteps[i];
            if (os && isNum(os.energy)) {
              steps.push({ step: isNum(os.step) ? os.step : i + 1, energy: os.energy });
            }
          }
        }
        if (!steps.length && Array.isArray(job.scfEnergies)) {
          for (i = 0; i < job.scfEnergies.length; i++) {
            var se = job.scfEnergies[i];
            if (se && isNum(se.energy)) {
              steps.push({ step: isNum(se.step) ? se.step : i + 1, energy: se.energy });
            }
          }
        }
      }
      if (!steps.length) {
        var sm = state.results && state.results.summary;
        if (sm && Array.isArray(sm.energySteps)) {
          for (i = 0; i < sm.energySteps.length; i++) {
            var es = sm.energySteps[i];
            if (es && isNum(es.energy)) {
              steps.push({ step: isNum(es.step) ? es.step : i + 1, energy: es.energy });
            }
          }
        }
      }
      return steps;
    }

    function getOptSteps() {
      var job = activeJob();
      if (job && Array.isArray(job.optSteps) && job.optSteps.length) return job.optSteps;
      var sm = state.results && state.results.summary;
      if (sm && sm.opt && Array.isArray(sm.opt.steps)) return sm.opt.steps;
      return [];
    }

    function getFrequencies() {
      var job = activeJob();
      if (job && Array.isArray(job.frequencies) && job.frequencies.length) return job.frequencies;
      var sm = state.results && state.results.summary;
      if (sm && Array.isArray(sm.frequencies)) return sm.frequencies;
      return [];
    }

    function getThermochemistry() {
      var job = activeJob();
      if (job && job.thermochemistry) return job.thermochemistry;
      var sm = state.results && state.results.summary;
      return sm ? (sm.thermochemistry || null) : null;
    }

    function getFinalEnergy() {
      var sm = state.results && state.results.summary;
      if (sm && isNum(sm.finalEnergy)) return sm.finalEnergy;
      var steps = getEnergySteps();
      if (steps.length) return steps[steps.length - 1].energy;
      return null;
    }

    function effectiveFreqFrame() {
      var job = activeJob();
      if (job && isNum(job.freqFrameIndex)) return job.freqFrameIndex;
      var sm = state.results && state.results.summary;
      if (sm && isNum(sm.freqFrameIndex)) return sm.freqFrameIndex;
      return null;
    }

    function getOptStatus() {
      var job = activeJob();
      var sm = state.results && state.results.summary;
      var opt = (job && job.optimization) || (sm && sm.opt) || null;
      var steps = getOptSteps();
      if (!opt && !steps.length) return { text: t('results.values.none'), raw: null };
      if (opt) {
        if (opt.converged === true || opt.completed === true || opt.stationaryPoint === true) {
          return { text: t('results.values.optimized'), raw: true };
        }
        if (opt.converged === false || opt.completed === false) {
          return { text: t('results.values.notConverged'), raw: false };
        }
      }
      if (steps.length) {
        var last = steps[steps.length - 1];
        if (last && last.converged === true) return { text: t('results.values.optimized'), raw: true };
        return { text: t('results.values.notConverged'), raw: false };
      }
      return { text: t('results.values.none'), raw: null };
    }

    function getTerminationText() {
      var job = activeJob();
      var sm = state.results && state.results.summary;
      var nt = job && job.normalTermination != null ? job.normalTermination
        : (sm ? sm.normalTermination : null);
      if (nt === true) return t('results.values.normal');
      if (nt === false) return t('results.values.error');
      return t('results.values.unknown');
    }

    function computeAvailable(res) {
      if (!res || typeof res !== 'object') return false;
      var sm = res.summary;
      if (sm) {
        if (sm.hasAnalysis === true) return true;
        if (isNum(sm.finalEnergy)) return true;
        if (sm.hasFrequencies || sm.hasOptimization || sm.hasThermochemistry) return true;
        if (Array.isArray(sm.frequencies) && sm.frequencies.length) return true;
        if (Array.isArray(sm.energySteps) && sm.energySteps.length) return true;
      }
      if (Array.isArray(res.jobs) && res.jobs.length) {
        for (var i = 0; i < res.jobs.length; i++) if (jobHasData(res.jobs[i])) return true;
      }
      return false;
    }

    /* --------------------------- 3.5 渲染 --------------------------- */

    function renderEmptyText() {
      emptyTitle.textContent = t('results.empty.title');
      emptyText.textContent = t('results.empty.text');
    }

    function renderJobSelect() {
      var res = state.results;
      var jobs = (res && Array.isArray(res.jobs)) ? res.jobs : [];
      var meaningful = [];
      var i;
      for (i = 0; i < jobs.length; i++) {
        if (jobHasData(jobs[i])) meaningful.push(i);
      }
      var show = meaningful.length > 1;
      refs.jobRow.hidden = !show;
      refs.jobLabel.textContent = t('results.jobs.label');
      try { refs.jobSelect.setAttribute('aria-label', t('results.jobs.label')); } catch (err) { /* ignore */ }
      while (refs.jobSelect.firstChild) refs.jobSelect.removeChild(refs.jobSelect.firstChild);
      if (!show) {
        if (meaningful.length === 1) state.jobIndex = meaningful[0];
        else if (jobs.length && (state.jobIndex < 0 || state.jobIndex >= jobs.length)) state.jobIndex = 0;
        return;
      }
      if (meaningful.indexOf(state.jobIndex) < 0) state.jobIndex = meaningful[0];
      for (i = 0; i < meaningful.length; i++) {
        var jobIdx = meaningful[i];
        var job = jobs[jobIdx] || {};
        var opt = document.createElement('option');
        opt.value = String(jobIdx);
        var label = t('results.jobs.option', { n: jobIdx + 1 });
        if (job.route) label += ' · ' + truncateStr(job.route, 38);
        opt.textContent = label;
        if (job.route) opt.title = job.route;
        refs.jobSelect.appendChild(opt);
      }
      refs.jobSelect.value = String(state.jobIndex);
    }

    function buildSummaryValues() {
      var sm = (state.results && state.results.summary) || {};
      var job = activeJob();
      var th = getThermochemistry() || null;
      var vals = {};

      function pick(key) {
        if (job && job[key] != null) return job[key];
        return sm[key];
      }

      vals['natoms'] = { text: fmtInt(pick('natoms')) };
      vals['route'] = { text: fmtText(pick('route')) };
      if (vals['route'].text !== '—') vals['route'].title = vals['route'].text;
      vals['charge'] = { text: fmtInt(pick('charge')) };
      vals['multiplicity'] = { text: fmtInt(pick('multiplicity')) };
      vals['final-energy'] = { text: fmtHartree(getFinalEnergy()) };
      vals['termination'] = { text: getTerminationText() };
      vals['optimization'] = { text: getOptStatus().text };

      vals['temperature'] = {
        text: th && isNum(th.temperature) ? th.temperature.toFixed(2) + ' K' : '—'
      };
      vals['pressure'] = {
        text: th && isNum(th.pressure) ? th.pressure.toFixed(5) + ' atm' : '—'
      };

      vals['zpe'] = { text: fmtHartree(th ? th.zeroPointCorrection : null) };
      vals['thermal-energy'] = { text: fmtHartree(th ? th.thermalCorrectionEnergy : null) };
      vals['thermal-enthalpy'] = { text: fmtHartree(th ? th.thermalCorrectionEnthalpy : null) };
      vals['thermal-gibbs'] = { text: fmtHartree(th ? th.thermalCorrectionGibbs : null) };
      vals['sum-zpe'] = { text: fmtHartree(th ? th.sumElectronicZeroPoint : null) };
      vals['sum-energy'] = { text: fmtHartree(th ? th.sumElectronicThermal : null) };
      vals['sum-enthalpy'] = { text: fmtHartree(th ? th.sumElectronicEnthalpy : null) };
      vals['sum-gibbs'] = { text: fmtHartree(th ? th.sumElectronicGibbs : null) };
      return vals;
    }

    function renderSummary() {
      var vals = buildSummaryValues();
      while (refs.summary.firstChild) refs.summary.removeChild(refs.summary.firstChild);
      for (var i = 0; i < SUMMARY_FIELDS.length; i++) {
        var field = SUMMARY_FIELDS[i];
        var info = vals[field] || { text: '—' };
        var row = makeEl('div', 'res-row');
        row.setAttribute('data-field', field);
        if (field === 'route') row.className += ' res-row-route';
        var label = makeEl('span', 'res-label', t(FIELD_LABEL_KEYS[field] || field));
        var value = makeEl('span', 'res-value', info.text);
        if (info.title) value.title = info.title;
        row.appendChild(label);
        row.appendChild(value);
        refs.summary.appendChild(row);
      }
    }

    /* --------------------------- 3.6 图表 --------------------------- */

    function scheduleDrawCharts() {
      if (state.disposed || state.chartDrawScheduled) return;
      state.chartDrawScheduled = true;
      state.chartRafId = rafWanted(root, function () {
        state.chartDrawScheduled = false;
        state.chartRafId = null;
        drawChartsNow();
        // 若区块刚由隐藏变为可见，布局可能还没稳定，再补一帧
        if (state.energyCfg || state.convCfg) {
          state.chartRafId = rafWanted(root, function () {
            state.chartRafId = null;
            drawChartsNow();
          });
        }
      });
    }

    function drawChartsNow() {
      if (state.disposed) return;
      if (!root.MolCharts || typeof root.MolCharts.drawLineChart !== 'function') return;
      if (state.energyCfg && !refs.energySection.hidden) {
        try {
          state.energyChartInfo = root.MolCharts.drawLineChart(refs.energyCanvas, state.energyCfg);
        } catch (err) {
          state.energyChartInfo = { ok: false, error: err && err.message };
        }
      }
      if (state.convCfg && !refs.convSection.hidden) {
        try {
          state.convChartInfo = root.MolCharts.drawLineChart(refs.convCanvas, state.convCfg);
        } catch (err) {
          state.convChartInfo = { ok: false, error: err && err.message };
        }
      }
    }

    function renderEnergy() {
      var steps = getEnergySteps();
      var pts = [];
      for (var i = 0; i < steps.length; i++) {
        if (isNum(steps[i].energy)) pts.push(steps[i]);
      }
      state.energyPoints = pts.length;
      var show = pts.length > 0;
      refs.energySection.hidden = !show;
      state.energyCfg = null;
      if (!show) return;

      refs.energyTitle.textContent = t('results.sections.energy');
      var cfg = {
        xLabel: t('results.chart.step'),
        series: [],
        legend: false,
        padding: { top: 10, right: 18, bottom: 36, left: 58 },
        emptyText: t('results.chart.noEnergy')
      };
      if (pts.length === 1) {
        // 单点：画绝对值并标注绝对能量
        var e = pts[0].energy;
        cfg.yLabel = t('results.chart.energy');
        cfg.series = [{
          name: t('results.chart.singlePointLegend'),
          points: [{ x: pts[0].step, y: e }],
          color: ENERGY_COLOR,
          lineWidth: 2,
          marker: 'circle'
        }];
        cfg.pointLabels = function (seriesCfg, pt) { return pt.rawY.toFixed(6); };
        cfg.yMin = e - 0.002;
        cfg.yMax = e + 0.002;
        cfg.yTickFormat = function (v) { return Number(v).toFixed(4); };
        cfg.yMin = e - 0.002;
        cfg.yMax = e + 0.002;
        cfg.padding.top = 16;
        refs.energyNote.hidden = false;
        refs.energyNote.textContent = t('results.chart.singlePoint', { energy: e.toFixed(6) });
      } else {
        var ref = pts[pts.length - 1].energy;
        var rel = [];
        for (i = 0; i < pts.length; i++) {
          rel.push({
            x: pts[i].step,
            y: (pts[i].energy - ref) * HARTREE_TO_KCAL
          });
        }
        cfg.yLabel = t('results.chart.deltaEnergy');
        cfg.series = [{
          name: t('results.chart.legendDelta'),
          points: rel,
          color: ENERGY_COLOR,
          lineWidth: 2,
          marker: 'circle'
        }];
        cfg.pointLabels = function (seriesCfg, pt) {
          var v = Math.abs(pt.rawY) < 0.005 ? 0 : pt.rawY;
          return v.toFixed(2);
        };
        refs.energyNote.hidden = true;
        refs.energyNote.textContent = '';
      }
      state.energyCfg = cfg;
      scheduleDrawCharts();
    }

    function renderConvergence() {
      var steps = getOptSteps();
      var series = [];
      var totalPoints = 0;
      for (var m = 0; m < CONV_METRICS.length; m++) {
        var metric = CONV_METRICS[m];
        var points = [];
        for (var i = 0; i < steps.length; i++) {
          var st = steps[i] || {};
          var v = st[metric.field];
          if (!isNum(v) || v <= 0) continue;
          points.push({ x: isNum(st.step) ? st.step : i + 1, y: v });
        }
        totalPoints += points.length;
        if (points.length) {
          series.push({
            name: t('results.conv.' + metric.key),
            points: points,
            color: metric.color,
            lineWidth: 1.6,
            marker: 'circle'
          });
        }
      }
      state.convSeries = series.length;
      var show = totalPoints > 0;
      refs.convSection.hidden = !show;
      state.convCfg = null;
      if (!show) return;

      refs.convTitle.textContent = t('results.sections.convergence');
      var thresholds = [];
      for (m = 0; m < CONV_METRICS.length; m++) {
        thresholds.push({
          value: CONV_METRICS[m].threshold,
          color: CONV_METRICS[m].color,
          dash: [5, 4],
          lineWidth: 1.1
        });
      }
      state.convCfg = {
        xLabel: t('results.chart.step'),
        yLabel: t('results.chart.logValue'),
        yScale: 'log10',
        series: series,
        thresholds: thresholds,
        legend: true,
        padding: { top: 8, right: 18, bottom: 36, left: 58 },
        emptyText: t('results.chart.noConvergence')
      };
      refs.convNote.hidden = false;
      refs.convNote.textContent = t('results.chart.thresholdNote');
      scheduleDrawCharts();
    }

    /* --------------------------- 3.7 频率列表 --------------------------- */

    function renderFrequencies() {
      var freqs = getFrequencies();
      state.frequencyCount = freqs.length;
      state.hasFrequencies = freqs.length > 0;
      refs.freqSection.hidden = freqs.length === 0;
      refs.freqTitle.textContent = t('results.sections.frequencies');
      while (refs.freqList.firstChild) refs.freqList.removeChild(refs.freqList.firstChild);

      for (var i = 0; i < freqs.length; i++) {
        var freq = freqs[i] || {};
        var row = makeEl('button', 'freq-row');
        row.type = 'button';
        row.setAttribute('data-mode-index', String(i));
        row.setAttribute('role', 'option');
        var idxSpan = makeEl('span', 'freq-index', String(i + 1));
        var valSpan = makeEl('span', 'freq-value', freqValueText(freq));
        var irText = isNum(freq.irIntensity)
          ? t('results.freq.ir') + ' ' + freq.irIntensity.toFixed(1)
          : t('results.freq.ir') + ' —';
        var irSpan = makeEl('span', 'freq-ir', irText);
        row.appendChild(idxSpan);
        row.appendChild(valSpan);
        row.appendChild(irSpan);
        if (isImaginaryFreq(freq)) row.className += ' is-imaginary';
        var tip = freqValueText(freq);
        if (!hasDisplacements(freq)) tip += ' · ' + t('results.freq.noteSomeMissing');
        row.title = tip;
        refs.freqList.appendChild(row);
      }

      var enabled = freqs.length > 0;
      refs.playBtn.disabled = !enabled;
      refs.stopBtn.disabled = !enabled;
      refs.ampInput.disabled = !enabled;

      state.noteError = null;
      updateFreqNote();
      updateAnimUI();
    }

    function updateFreqNote() {
      if (!refs.freqNote) return;
      if (!state.available || !state.frequencyCount) {
        refs.freqNote.hidden = true;
        refs.freqNote.textContent = '';
        refs.freqNote.classList.remove('is-error');
        return;
      }
      refs.freqNote.hidden = false;
      if (state.noteError) {
        refs.freqNote.textContent = state.noteError;
        refs.freqNote.classList.add('is-error');
        return;
      }
      refs.freqNote.classList.remove('is-error');
      var freqs = getFrequencies();
      var missing = 0;
      for (var i = 0; i < freqs.length; i++) if (!hasDisplacements(freqs[i])) missing++;
      var parts = [];
      var frame = effectiveFreqFrame();
      if (frame != null) parts.push(t('results.freq.noteFrame', { frame: frame + 1 }));
      else parts.push(t('results.freq.noteNoFrame'));
      if (missing === freqs.length && freqs.length) parts.push(t('results.freq.noteAllMissing'));
      else if (missing > 0) parts.push(t('results.freq.noteSomeMissing'));
      refs.freqNote.textContent = parts.join(' ');
    }

    /* --------------------------- 3.8 动画 UI --------------------------- */

    function updateAnimUI() {
      if (state.disposed) return;
      refs.playBtn.textContent = state.animating ? PAUSE_SYMBOL : PLAY_SYMBOL;
      var playTitle = state.animating ? t('results.freq.pause')
        : (state.paused ? t('results.freq.resume') : t('results.freq.play'));
      refs.playBtn.title = playTitle;
      refs.playBtn.setAttribute('aria-label', playTitle);
      refs.stopBtn.textContent = STOP_SYMBOL;
      refs.stopBtn.title = t('results.freq.stop');
      refs.stopBtn.setAttribute('aria-label', t('results.freq.stop'));
      refs.ampLabelText.textContent = t('results.freq.amplitude');
      refs.ampValue.textContent = state.amplitude + '%';
      refs.ampInput.value = String(state.amplitude);

      var freqs = getFrequencies();
      if (state.selectedMode != null && state.selectedMode >= 0 && state.selectedMode < freqs.length) {
        refs.modeLabel.textContent = t('results.freq.modeLabel', {
          n: state.selectedMode + 1,
          value: freqValueText(freqs[state.selectedMode]).replace(/\s*cm⁻¹$/, '')
        });
      } else {
        refs.modeLabel.textContent = '—';
      }

      var rows = refs.freqList.children;
      for (var i = 0; i < rows.length; i++) {
        var active = state.selectedMode != null && String(state.selectedMode) === rows[i].getAttribute('data-mode-index');
        if (active) rows[i].classList.add('is-active');
        else rows[i].classList.remove('is-active');
        if (active) rows[i].setAttribute('aria-selected', 'true');
        else rows[i].removeAttribute('aria-selected');
      }
    }

    /* --------------------------- 3.9 渲染入口 --------------------------- */

    function render() {
      if (state.disposed) return;
      var available = computeAvailable(state.results);
      state.available = available;
      renderEmptyText();
      if (!available) {
        state.jobCount = 0;
        state.frequencyCount = 0;
        state.hasCharts = false;
        state.hasFrequencies = false;
        state.hasOptimization = false;
        state.hasThermochemistry = false;
        state.energyPoints = 0;
        state.convSeries = 0;
        state.energyCfg = null;
        state.convCfg = null;
        state.energyChartInfo = null;
        state.convChartInfo = null;
        refs.empty.hidden = false;
        refs.content.hidden = true;
        refs.jobRow.hidden = true;
        updateFreqNote();
        updateAnimUI();
        return;
      }

      refs.empty.hidden = true;
      refs.content.hidden = false;

      var sm = state.results.summary || {};
      state.jobCount = isNum(sm.jobCount) ? sm.jobCount
        : (Array.isArray(state.results.jobs) ? state.results.jobs.length : 1);
      state.hasOptimization = !!(sm.hasOptimization || getOptSteps().length);
      state.hasThermochemistry = !!(sm.hasThermochemistry || getThermochemistry());

      renderJobSelect();
      renderSummary();
      renderEnergy();
      renderConvergence();
      renderFrequencies();
      updateAnimUI();
      state.hasCharts = !!(state.energyPoints > 0 || state.convSeries > 0);
      scheduleDrawCharts();
    }

    /* --------------------------- 3.10 振动动画核心 --------------------------- */

    function getViewSafe() {
      if (typeof opts.getView !== 'function') return null;
      try {
        var v = opts.getView();
        return v || null;
      } catch (err) {
        return null;
      }
    }

    /** 把频率的 displacements 数组规整成按原子索引的向量表并求最大模长 */
    function normalizeDisplacements(disps) {
      if (!Array.isArray(disps) || !disps.length) return null;
      var vecs = [];
      var len = 0;
      var maxLen = 0;
      for (var i = 0; i < disps.length; i++) {
        var d = disps[i];
        if (!d) continue;
        var idx = isNum(d.atomIndex) ? d.atomIndex : i;
        if (!isNum(idx) || idx < 0) continue;
        var v = [Number(d.dx) || 0, Number(d.dy) || 0, Number(d.dz) || 0];
        vecs[idx] = v;
        if (idx + 1 > len) len = idx + 1;
        var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (l > maxLen) maxLen = l;
      }
      if (!(maxLen > 0) || !len) return null;
      return { vecs: vecs, len: len, maxLen: maxLen };
    }

    function clearDisplacements() {
      var view = state.view || getViewSafe();
      if (!view) return;
      try {
        if (typeof view.setDisplacements === 'function') view.setDisplacements(null);
        if (typeof view.requestRender === 'function') view.requestRender();
      } catch (err) { /* 渲染器异常不影响面板 */ }
      state.view = view;
    }

    function cancelRaf() {
      if (state.rafId != null) {
        cafWanted(root, state.rafId);
        state.rafId = null;
      }
    }

    /**
     * 停止动画循环（可选择是否清除视口位移），不清 selectedMode 以外的 UI 状态。
     */
    function haltAnimation(options) {
      options = options || {};
      state.animToken++;
      cancelRaf();
      state.animating = false;
      state.paused = false;
      state.base = null;
      if (options.clear !== false) clearDisplacements();
    }

    function applyFrame(view) {
      var base = state.base;
      if (!base || !view) return;
      var amp = clamp(state.amplitude, AMPLITUDE_MIN, AMPLITUDE_MAX) / 100 * BASE_AMPLITUDE_ANGSTROM;
      var scale = amp * Math.sin(state.phase) / base.maxLen;
      var arr = new Array(base.len);
      for (var i = 0; i < base.len; i++) {
        var v = base.vecs[i];
        if (!v) arr[i] = [0, 0, 0];
        else arr[i] = [v[0] * scale, v[1] * scale, v[2] * scale];
      }
      try {
        if (typeof view.setDisplacements === 'function') view.setDisplacements(arr);
        if (typeof view.requestRender === 'function') view.requestRender();
      } catch (err) { /* ignore renderer errors during animation */ }
    }

    function tick(ts) {
      if (!state.animating || state.disposed) return;
      var view = state.view || getViewSafe();
      if (!view) {
        showAnimError(mkError('results.error.noView'));
        return;
      }
      if (!state.lastTs) state.lastTs = ts;
      var dt = (ts - state.lastTs) / 1000;
      if (!(dt >= 0)) dt = 0;
      if (dt > 0.1) dt = 0.1;
      state.lastTs = ts;
      state.phase += PHASE_SPEED * dt;
      applyFrame(view);
      if (!state.active) {
        // tab 隐藏时硬停止（清位移），但保留 selectedMode 高亮（INTERFACE2 §6.1）
        haltPlaybackKeepSelection();
        return;
      }
      state.rafId = rafWanted(root, tick);
    }

    function startLoop() {
      if (state.disposed) return;
      var view = getViewSafe();
      if (!view) throw mkError('results.error.noView');
      if (typeof view.setDisplacements !== 'function') throw mkError('results.error.noRendererSupport');
      state.view = view;
      state.animating = true;
      state.paused = false;
      state.lastTs = 0;
      state.noteError = null;
      refs.stopBtn.disabled = false;
      updateAnimUI();
      updateFreqNote();
      state.phase = 0;
      applyFrame(view);
      cancelRaf();
      state.rafId = rafWanted(root, tick);
    }

    function pauseAnimation() {
      if (!state.animating) return;
      cancelRaf();
      state.animating = false;
      state.paused = true;   // 用户主动暂停：保留当前位移，不清空
      updateAnimUI();
    }

    /**
     * tab 隐藏 / 页面切走：硬停止动画并清空 3D 视口位移，
     * 但保留 selectedMode 高亮与振幅设置（INTERFACE2 §6.1 裁决）。
     * 再次 setActive(true) 不自动恢复播放。
     */
    function haltPlaybackKeepSelection() {
      state.animToken++;
      cancelRaf();
      state.animating = false;
      state.paused = false;
      state.base = null;
      state.phase = 0;
      clearDisplacements();
      updateAnimUI();
      updateFreqNote();
    }

    function resumeAnimation() {
      if (state.disposed) return;
      if (!state.base || state.selectedMode == null) return false;
      var view = getViewSafe();
      if (!view) throw mkError('results.error.noView');
      if (typeof view.setDisplacements !== 'function') throw mkError('results.error.noRendererSupport');
      state.view = view;
      state.animating = true;
      state.paused = false;
      state.lastTs = 0;
      updateAnimUI();
      cancelRaf();
      state.rafId = rafWanted(root, tick);
      return true;
    }

    function stopInternal() {
      state.animToken++;
      cancelRaf();
      state.animating = false;
      state.paused = false;
      state.base = null;
      state.selectedMode = null;
      state.phase = 0;
      clearDisplacements();
      if (refs.stopBtn) refs.stopBtn.disabled = state.frequencyCount === 0;
      updateAnimUI();
      updateFreqNote();
    }

    function showAnimError(err) {
      haltAnimation({ clear: true });
      state.selectedMode = null;
      state.noteError = err && err.message ? err.message : String(err);
      updateAnimUI();
      updateFreqNote();
    }

    /* --------------------------- 3.11 公共 API 实现 --------------------------- */

    function setResults(logResults) {
      if (state.disposed) return;
      // 换分子 / 清空 / 新结果：先停止动画并清除视口位移
      stopInternal();
      state.results = logResults || null;
      state.jobIndex = 0;
      if (state.results && Array.isArray(state.results.jobs)) {
        for (var i = 0; i < state.results.jobs.length; i++) {
          if (jobHasData(state.results.jobs[i])) { state.jobIndex = i; break; }
        }
      }
      render();
    }

    function refreshLanguage() {
      if (state.disposed) return;
      render();
      drawChartsNow();
      scheduleDrawCharts();
    }

    function setActive(active) {
      if (state.disposed) return;
      state.active = !!active;
      if (!state.active) {
        // 隐藏时硬停止并清空位移（保留 selectedMode 高亮/振幅），避免 3D 视口残留形变
        haltPlaybackKeepSelection();
        return;
      }
      if (state.available) {
        drawChartsNow();
        scheduleDrawCharts();
      }
    }

    function getState() {
      var sm = state.results && state.results.summary;
      return {
        available: !!state.available,
        jobCount: state.jobCount,
        frequencyCount: state.frequencyCount,
        selectedMode: state.selectedMode,
        animating: !!state.animating,
        paused: !!state.paused,
        hasCharts: !!state.hasCharts,
        finalEnergy: isNum(getFinalEnergy()) ? getFinalEnergy() : null,
        freqFrameIndex: effectiveFreqFrame(),
        amplitude: state.amplitude,
        hasFrequencies: !!state.hasFrequencies,
        hasOptimization: !!state.hasOptimization,
        hasThermochemistry: !!state.hasThermochemistry
      };
    }

    function playFrequency(modeIndex) {
      if (state.disposed) return;
      var freqs = getFrequencies();
      if (!freqs.length) throw mkError('results.error.noFrequencies');
      var idx;
      if (modeIndex == null) idx = state.selectedMode == null ? 0 : state.selectedMode;
      else idx = Math.floor(Number(modeIndex));
      if (!isFinite(idx) || idx < 0 || idx >= freqs.length) {
        throw mkError('results.error.invalidMode', { mode: modeIndex });
      }
      var freq = freqs[idx] || {};
      var base = normalizeDisplacements(freq.displacements);
      if (!base) throw mkError('results.error.noDisplacements');

      cancelRaf();
      state.animating = false;
      state.paused = false;
      state.base = null;
      state.selectedMode = idx;
      state.base = base;
      state.noteError = null;
      state.phase = 0;
      updateAnimUI();
      updateFreqNote();

      var token = ++state.animToken;
      var frame = effectiveFreqFrame();
      var maybePromise = null;
      if (frame != null && typeof opts.onRequestFrame === 'function') {
        try {
          maybePromise = opts.onRequestFrame(frame);
        } catch (err) {
          maybePromise = null;
        }
      }

      var begin = function () {
        if (state.disposed || token !== state.animToken) return null;
        try {
          // 关键顺序（INTERFACE2.md §6.2）：先切帧（onRequestFrame），再 getView()
          startLoop();
          return null;
        } catch (err) {
          showAnimError(err);
          return err;
        }
      };

      if (maybePromise && typeof maybePromise.then === 'function') {
        // onRequestFrame 返回 Promise：等待切帧完成后再播放（错误只能通过 note 提示）
        return Promise.resolve(maybePromise).then(begin, begin);
      }
      var syncError = begin();
      if (syncError) throw syncError;
      return undefined;
    }

    function stopAnimation() {
      if (state.disposed) return;
      stopInternal();
    }

    function setAmplitude(percent) {
      if (state.disposed) return;
      var p = Number(percent);
      if (!isFinite(p)) return;
      state.amplitude = clamp(Math.round(p), AMPLITUDE_MIN, AMPLITUDE_MAX);
      refs.ampInput.value = String(state.amplitude);
      refs.ampValue.textContent = state.amplitude + '%';
    }

    function dispose() {
      if (state.disposed) return;
      state.animToken++;
      cancelRaf();
      if (state.chartRafId != null) {
        cafWanted(root, state.chartRafId);
        state.chartRafId = null;
      }
      if (state.resizeRafId != null) {
        cafWanted(root, state.resizeRafId);
        state.resizeRafId = null;
      }
      state.animating = false;
      state.paused = false;
      try { clearDisplacements(); } catch (err) { /* ignore */ }
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener('resize', onWindowResize);
      }
      if (resizeObserver && typeof resizeObserver.disconnect === 'function') {
        try { resizeObserver.disconnect(); } catch (err) { /* ignore */ }
      }
      if (typeof state.i18nUnsubscribe === 'function') {
        try { state.i18nUnsubscribe(); } catch (err) { /* ignore */ }
        state.i18nUnsubscribe = null;
      }
      state.disposed = true;
      state.results = null;
      containerEl.innerHTML = '';
    }

    /* --------------------------- 3.12 事件绑定 --------------------------- */

    function onWindowResize() {
      if (state.disposed) return;
      if (state.resizeRafId != null) cafWanted(root, state.resizeRafId);
      state.resizeRafId = rafWanted(root, function () {
        state.resizeRafId = null;
        drawChartsNow();
      });
    }

    refs.jobSelect.addEventListener('change', function () {
      var v = parseInt(refs.jobSelect.value, 10);
      if (!isFinite(v) || v < 0) return;
      state.jobIndex = v;
      stopInternal();
      render();
    });

    refs.playBtn.addEventListener('click', function () {
      if (state.disposed) return;
      try {
        if (state.animating) {
          pauseAnimation();
        } else if (state.paused && state.base && state.selectedMode != null) {
          resumeAnimation();
        } else {
          var p = playFrequency(state.selectedMode == null ? 0 : state.selectedMode);
          if (p && typeof p.then === 'function') {
            p.catch(function (err) { showAnimError(err); });
          }
        }
      } catch (err) {
        showAnimError(err);
      }
    });

    refs.stopBtn.addEventListener('click', function () {
      if (state.disposed) return;
      stopAnimation();
    });

    refs.ampInput.addEventListener('input', function () {
      var v = Number(refs.ampInput.value);
      if (!isFinite(v)) return;
      state.amplitude = clamp(Math.round(v), AMPLITUDE_MIN, AMPLITUDE_MAX);
      refs.ampValue.textContent = state.amplitude + '%';
    });

    refs.freqList.addEventListener('click', function (ev) {
      if (state.disposed) return;
      var node = ev.target;
      var row = null;
      while (node && node !== refs.freqList) {
        if (node.classList && node.classList.contains('freq-row')) { row = node; break; }
        node = node.parentNode;
      }
      if (!row) return;
      var idx = parseInt(row.getAttribute('data-mode-index'), 10);
      if (!isFinite(idx)) return;
      try {
        var p = playFrequency(idx);
        if (p && typeof p.then === 'function') {
          p.catch(function (err) { showAnimError(err); });
        }
      } catch (err) {
        showAnimError(err);
      }
    });

    if (typeof root.addEventListener === 'function') root.addEventListener('resize', onWindowResize);

    var resizeObserver = null;
    if (typeof root.ResizeObserver === 'function') {
      try {
        resizeObserver = new root.ResizeObserver(function () {
          if (state.disposed) return;
          if (state.available) scheduleDrawCharts();
        });
        resizeObserver.observe(container);
      } catch (err) {
        resizeObserver = null;
      }
    }

    // 语言切换时面板自行重绘（ui.js 也会调用 refreshLanguage，重复调用是幂等的）
    if (i18n && typeof i18n.onChange === 'function') {
      try {
        state.i18nUnsubscribe = i18n.onChange(function () { refreshLanguage(); });
      } catch (err) {
        state.i18nUnsubscribe = null;
      }
    }

    /* --------------------------- 3.13 初始渲染 --------------------------- */

    renderEmptyText();
    render();

    /* --------------------------- 3.14 返回面板对象 --------------------------- */

    var panel = {
      version: VERSION,
      setResults: setResults,
      refreshLanguage: refreshLanguage,
      setActive: setActive,
      getState: getState,
      playFrequency: playFrequency,
      stopAnimation: stopAnimation,
      setAmplitude: setAmplitude,
      dispose: dispose,
      // 额外调试/自测辅助（不属于契约核心 API，E2E 不应依赖）
      getChartInfo: function () {
        return {
          energy: state.energyChartInfo,
          convergence: state.convChartInfo
        };
      },
      getFrequencyRows: function () {
        var out = [];
        var rows = refs.freqList.children;
        for (var i = 0; i < rows.length; i++) {
          out.push({
            modeIndex: Number(rows[i].getAttribute('data-mode-index')),
            text: rows[i].textContent,
            imaginary: rows[i].classList.contains('is-imaginary'),
            active: rows[i].classList.contains('is-active')
          });
        }
        return out;
      },
      _getSummaryValues: buildSummaryValues
    };

    // 供调试：在面板 DOM 上挂引用
    container.__molResultsPanel = panel;

    return panel;
  }

  /* ======================================================================
   * 4. 挂载全局
   * ==================================================================== */

  var MolResults = (root.MolResults = root.MolResults || {});
  MolResults.version = VERSION;
  MolResults.create = create;

  if (typeof module === 'object' && module && module.exports) module.exports = MolResults;
})(typeof globalThis !== 'undefined' ? globalThis : this);
