/* =============================================================================
 * MolEdit — js/gausslog.js
 * Gaussian LOG 计算结果深度解析（类似 GaussView 的结果抽取）：
 *   单点能 / 优化收敛曲线数据 / 热化学 8 项 / 频率与每原子振动位移。
 *
 * 依赖：无（纯 JS 经典脚本，浏览器与 Node 均可加载；无 DOM 依赖）
 * 全局：MolGaussLog
 * 契约：INTERFACE2.md §4
 *
 * 设计原则：
 *  - parse(text) 对任意输入都不抛异常：空/非 log 文本返回 ok:false + warnings；
 *    解析过程中的异常同样被捕获。
 *  - 只做“计算结果抽取”，不改 js/parsers.js 的 v1 几何解析行为。
 *  - 兼容 Gaussian 03/09/16 常见输出格式：D 指数、`**` 溢出值、CRLF/BOM、
 *    多 job（Entering Link 1 / --Link1--）、hpmodes、IR 缺失等。
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var FORMAT = 'gaussian-log';

  // ===========================================================================
  // 0. 基础工具
  // ===========================================================================

  /** 把 Gaussian 数字 token 转成 number；`**`/空/NaN/Infinity 返回 null。 */
  function parseNumber(token) {
    if (token === null || token === undefined) return null;
    if (typeof token === 'number') return isFinite(token) ? token : null;
    var s = String(token).trim();
    if (!s) return null;
    if (/^[*#]+$/.test(s)) return null;                 // ** 溢出占位
    s = s.replace(/[dD]/g, 'E');
    var v = Number(s);
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  var RE_NUMBER_TOKEN = /-?\d+(?:\.\d*)?(?:[eEdD][-+]?\d+)?/g;

  /** 从一行文本里提取全部数字（D 指数按 E 处理）。 */
  function extractNumbers(text) {
    if (!text) return [];
    var matches = String(text).match(RE_NUMBER_TOKEN);
    if (!matches) return [];
    var out = [];
    for (var i = 0; i < matches.length; i++) {
      var v = parseNumber(matches[i]);
      if (v !== null) out.push(v);
    }
    return out;
  }

  /** 二分查找：返回第一个 >= value 的下标。 */
  function lowerBound(arr, value) {
    var lo = 0;
    var hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 返回最后一个 < value 的元素下标（不存在返回 -1）。 */
  function lastBefore(arr, value) {
    return lowerBound(arr, value) - 1;
  }

  // ===========================================================================
  // 1. 预编译正则
  // ===========================================================================

  var RE_ENTERING_LINK = /^\s*Entering Link\s+1\b/i;
  var RE_ENTERING_SYSTEM = /^\s*Entering Gaussian System\b/i;
  var RE_LINK1_TOKEN = /^\s*--\s*Link1\s*--\s*$/i;

  var RE_ROUTE_DECORATION = /^[-=*_~+|#\s]+$/;
  var RE_HASH_ONLY = /^#+\s*$/;
  var RE_ONLY_DECOR = /^[-=*_+~|\s]+$/;

  /** SCF Done:  E(RB3LYP) =  -76.4089399955     A.U. after    6 cycles */
  var RE_SCF_DONE = /SCF Done:\s+E\(([^)]*)\)\s*=\s*(-?\d+(?:\.\d*)?(?:[eEdD][-+]?\d+)?)(?:\s+A\.U\.\s+after\s+(\d+)\s+cycles)?/i;

  var RE_CHARGE_MULT = /Charge\s*=\s*(-?\d+)\s+Multiplicity\s*=\s*(-?\d+)/i;
  var RE_NATOMS = /NAtoms\s*=\s*(\d+)/i;

  var RE_STANDARD_ORIENTATION = /Standard orientation\s*:/i;
  var RE_INPUT_ORIENTATION = /Input orientation\s*:/i;

  var RE_CONV_HEADER = /Item\s+Value\s+Threshold\s+Converged\?/i;
  var RE_CONV_ROW = /^\s*(Maximum\s+Force|RMS\s+Force|Maximum\s+Displacement|RMS\s+Displacement)\s+(\S+)\s+(\S+)\s+(YES|NO)\b/i;
  var RE_PRED_DELTA = /Predicted change in Energy\s*=\s*(-?\d+(?:\.\d*)?(?:[eEdD][-+]?\d+)?)/i;

  var RE_OPT_COMPLETED = /Optimization completed/i;
  var RE_STATIONARY = /(?:--\s*)?Stationary point found/i;

  var RE_TERM_NORMAL = /Normal termination of Gaussian/i;
  var RE_TERM_ERROR = /Error termination/i;

  var RE_TEMP_PRESSURE = /Temperature\s+(-?\d+(?:\.\d+)?)\s*Kelvin\.?\s*Pressure\s+(-?\d+(?:\.\d+)?)\s*Atm/i;
  var RE_TEMPERATURE = /Temperature\s+(-?\d+(?:\.\d+)?)\s*Kelvin/i;
  var RE_PRESSURE = /Pressure\s+(-?\d+(?:\.\d+)?)\s*Atm/i;

  /** Frequencies --  /  Frequencies --- (hpmodes) */
  var RE_FREQ_LINE = /^\s*Frequencies\s*(-{2,})\s*(.*)$/i;
  var RE_HARMONIC = /Harmonic frequencies/i;
  var RE_RED_MASS = /^\s*(?:Red\.?\s*masses?|Reduced\s+masses?)\s*-{2,}\s*(.*)$/i;
  var RE_FRC_CONST = /^\s*(?:Frc\.?\s*consts?|Force\s+constants?)\s*-{2,}\s*(.*)$/i;
  var RE_IR_INTEN = /^\s*IR\s+Inten(?:sities|sity)?\s*-{2,}\s*(.*)$/i;
  var RE_ATOM_AN = /^\s*Atom\s+AN\b/i;
  var RE_COORD_ATOM = /^\s*Coord\s+Atom\s+Element\b/i;

  var RE_GAUSSIAN_HINT = /Entering Gaussian System|Entering Link\s+1|SCF Done:|Normal termination of Gaussian|Error termination|Standard orientation:|Input orientation:|Harmonic frequencies|Gaussian, Inc\.|Gaussian 16|Gaussian 09|Gaussian 03/i;

  function thermoFieldRe(label) {
    return new RegExp(label + '\\s*=\\s*(-?\\d+(?:\\.\\d*)?(?:[eEdD][-+]?\\d+)?)', 'i');
  }

  /** 热化学 8 项：字段名 -> 正则（顺序即匹配顺序，避免前缀误配）。 */
  var THERMO_FIELDS = [
    ['zeroPointCorrection', thermoFieldRe('Zero-point correction')],
    ['thermalCorrectionEnergy', thermoFieldRe('Thermal correction to Energy')],
    ['thermalCorrectionEnthalpy', thermoFieldRe('Thermal correction to Enthalpy')],
    ['thermalCorrectionGibbs', thermoFieldRe('Thermal correction to Gibbs Free Energy')],
    ['sumElectronicZeroPoint', thermoFieldRe('Sum of electronic and zero-point Energies')],
    ['sumElectronicThermal', thermoFieldRe('Sum of electronic and thermal Energies')],
    ['sumElectronicEnthalpy', thermoFieldRe('Sum of electronic and thermal Enthalpies')],
    ['sumElectronicGibbs', thermoFieldRe('Sum of electronic and thermal Free Energies')]
  ];

  // ===========================================================================
  // 2. job 分区
  // ===========================================================================

  /** 该区间内是否含任何“结果 / route”标记（用于保留被标记截断的前导区间）。 */
  function hasAnalysisMarkers(lines, start, end) {
    for (var i = start; i < end; i++) {
      var line = lines[i];
      if (line.indexOf('SCF Done') !== -1) return true;
      if (RE_STANDARD_ORIENTATION.test(line) || RE_INPUT_ORIENTATION.test(line)) return true;
      if (RE_FREQ_LINE.test(line) || RE_HARMONIC.test(line)) return true;
      if (RE_CONV_ROW.test(line)) return true;
      if (line.indexOf('Thermochemistry') !== -1) return true;
      if (RE_TERM_NORMAL.test(line) || RE_TERM_ERROR.test(line)) return true;
      if (/^\s*#/.test(line) && !RE_HASH_ONLY.test(line.replace(/^\s+/, ''))) return true;
    }
    return false;
  }

  /**
   * 识别 job 起始行（0 基）：
   *  1) "Entering Link 1" / "Entering Gaussian System" / "--Link1--"（相距 <= 10 行视为同一头部，去重）；
   *  2) 无头部标记时退化到 route 行分组（多 job 拼接日志）。
   */
  function findJobStarts(lines) {
    var starts = [];
    for (var i = 0; i < lines.length; i++) {
      if (RE_ENTERING_LINK.test(lines[i]) || RE_ENTERING_SYSTEM.test(lines[i]) || RE_LINK1_TOKEN.test(lines[i])) {
        if (!starts.length || i - starts[starts.length - 1] > 10) starts.push(i);
      }
    }
    if (starts.length > 0) {
      if (starts[0] > 0 && hasAnalysisMarkers(lines, 0, starts[0])) starts.unshift(0);
      return starts;
    }

    var routeStarts = [];
    for (var k = 0; k < lines.length; k++) {
      var t = lines[k].replace(/^\s+/, '');
      if (t.charAt(0) !== '#') continue;
      if (RE_HASH_ONLY.test(t) || RE_ROUTE_DECORATION.test(t)) continue;
      if (routeStarts.length && k - routeStarts[routeStarts.length - 1] <= 1) continue; // 多行 route 同一组
      routeStarts.push(k);
    }
    if (routeStarts.length > 1) {
      if (routeStarts[0] > 0 && hasAnalysisMarkers(lines, 0, routeStarts[0])) routeStarts.unshift(0);
      return routeStarts;
    }
    return [0];
  }

  /** 统计全文 Standard / Input orientation 标题行位置。 */
  function collectPositions(lines) {
    var standard = [];
    var input = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('orientation') === -1) continue;
      if (RE_STANDARD_ORIENTATION.test(line)) standard.push(i);
      else if (RE_INPUT_ORIENTATION.test(line)) input.push(i);
    }
    return { standardPositions: standard, inputPositions: input };
  }

  // ===========================================================================
  // 3. route / 电荷 / 原子数
  // ===========================================================================

  /** 读取 route：区间内第一处以 '#' 开头的（非装饰）行，并合并紧随其后的连续 route 行。 */
  function findRoute(lines, start, end) {
    for (var i = start; i < end; i++) {
      var t = lines[i].replace(/^\s+/, '');
      if (t.charAt(0) !== '#') continue;
      if (RE_HASH_ONLY.test(t) || RE_ROUTE_DECORATION.test(t)) continue;
      var parts = [t.replace(/\s+$/, '')];
      var j = i + 1;
      while (j < end) {
        var t2 = lines[j].replace(/^\s+/, '');
        if (t2.charAt(0) === '#' && !RE_HASH_ONLY.test(t2) && !RE_ROUTE_DECORATION.test(t2)) {
          parts.push(t2.replace(/\s+$/, ''));
          j++;
        } else {
          break;
        }
      }
      return { lineIndex: i, routeFull: parts.join(' ') };
    }
    return null;
  }

  /** routeFull -> route：去掉 '#'、合并空白、去掉开头的 verbosity 标志（n/p/t）。 */
  function cleanRoute(routeFull) {
    if (!routeFull) return '';
    var segments = String(routeFull).split('#');
    var parts = [];
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i].replace(/\s+/g, ' ').trim();
      if (s) parts.push(s);
    }
    var route = parts.join(' ');
    route = route.replace(/^[nNpPtT](?=\s|$)\s*/, '');
    return route.trim();
  }

  /** 统计某个 orientation 坐标块的原子行数（表头之后连续的数字行）。 */
  function countOrientationRows(lines, headerIndex, end) {
    var count = 0;
    var i = headerIndex + 1;
    while (i < end && i < headerIndex + 5000) {
      var trimmed = lines[i].trim();
      if (!trimmed) {
        if (count > 0) break;
        i++;
        continue;
      }
      var tokens = trimmed.split(/\s+/);
      if (tokens.length < 5) {
        if (count > 0) break;
        i++;
        continue;
      }
      var center = parseInt(tokens[0], 10);
      var atomicNo = parseInt(tokens[1], 10);
      if (!isFinite(center) || !isFinite(atomicNo) || tokens[0].charAt(0) === '-') {
        if (count > 0) break;
        i++;
        continue;
      }
      var ok = true;
      for (var k = 2; k < tokens.length; k++) {
        if (parseNumber(tokens[k]) === null) { ok = false; break; }
      }
      if (!ok) {
        if (count > 0) break;
        i++;
        continue;
      }
      count++;
      i++;
    }
    return count;
  }

  // ===========================================================================
  // 4. 频率段解析
  // ===========================================================================

  function pushDisplacement(mode, atomIndex, dx, dy, dz) {
    if (!mode || atomIndex < 0) return;
    mode.displacements.push({ atomIndex: atomIndex, dx: dx, dy: dy, dz: dz });
  }

  function assignModeValues(modes, values, key) {
    for (var k = 0; k < modes.length && k < values.length; k++) {
      modes[k][key] = values[k];
    }
  }

  /** hpmodes 的 "Coord Atom Element:" 行取原子下标：优先 Atom 列，其次 Coord 列。 */
  function pickAtomIndex(coord, atomNumber, natoms) {
    var byAtom = atomNumber - 1;
    var byCoord = coord - 1;
    if (natoms !== null && natoms > 0) {
      if (byAtom >= 0 && byAtom < natoms) return byAtom;
      if (byCoord >= 0 && byCoord < natoms) return byCoord;
    }
    if (byAtom >= 0) return byAtom;
    return byCoord >= 0 ? byCoord : 0;
  }

  /**
   * 解析 "Atom AN X Y Z X Y Z ..." 普通位移表：
   *  每行 2 个整数（原子号、原子序数）+ n 个模式各 3 列。
   * @returns {number} 表结束行下标
   */
  function parseAtomAnTable(lines, startLine, windowEnd, modes, natoms) {
    var i = startLine;
    while (i < windowEnd) {
      var rowLine = lines[i];
      if (!rowLine.trim()) break;
      if (RE_FREQ_LINE.test(rowLine) || RE_RED_MASS.test(rowLine) || RE_FRC_CONST.test(rowLine) ||
          RE_IR_INTEN.test(rowLine) || RE_COORD_ATOM.test(rowLine) || RE_HARMONIC.test(rowLine)) {
        break;
      }
      var tokens = rowLine.trim().split(/\s+/);
      if (tokens.length < 5) break;
      var atomNumber = parseInt(tokens[0], 10);
      var atomicNumber = parseInt(tokens[1], 10);
      if (!isFinite(atomNumber) || !isFinite(atomicNumber)) break;
      var values = [];
      var bad = false;
      for (var t = 2; t < tokens.length; t++) {
        var v = parseNumber(tokens[t]);
        if (v === null) { bad = true; break; }
        values.push(v);
      }
      if (bad || values.length < 3) break;
      var atomIndex = atomNumber - 1;
      if (atomIndex < 0) break;
      if (natoms !== null && atomIndex >= natoms) break;
      var columns = Math.floor(values.length / 3);
      for (var k = 0; k < columns && k < modes.length; k++) {
        pushDisplacement(modes[k], atomIndex, values[3 * k], values[3 * k + 1], values[3 * k + 2]);
      }
      i++;
    }
    return i;
  }

  /**
   * 解析 hpmodes 的 "Coord Atom Element:" 分组：
   *  行 = coord atom element dx dy dz（每组通常对应 1 个模式；也兼容一轮多模式 n*3 列）。
   * @returns {number} 新增的模式内行数（用于判断是否推进 hpMode）
   */
  function parseHpmodesGroup(lines, startLine, windowEnd, modes, hpMode, natoms) {
    var i = startLine;
    var rows = 0;
    while (i < windowEnd) {
      var rowLine = lines[i];
      if (!rowLine.trim()) { i++; break; }
      if (RE_COORD_ATOM.test(rowLine) || RE_ATOM_AN.test(rowLine) || RE_FREQ_LINE.test(rowLine) ||
          RE_RED_MASS.test(rowLine) || RE_FRC_CONST.test(rowLine) || RE_IR_INTEN.test(rowLine)) {
        break;
      }
      var tokens = rowLine.trim().split(/\s+/);
      if (tokens.length < 6) { i++; continue; }
      var coord = parseInt(tokens[0], 10);
      var atomNumber = parseInt(tokens[1], 10);
      var element = parseInt(tokens[2], 10);
      if (!isFinite(coord) || !isFinite(atomNumber) || !isFinite(element)) { i++; continue; }
      var values = [];
      var bad = false;
      for (var t = 3; t < tokens.length; t++) {
        var v = parseNumber(tokens[t]);
        if (v === null) { bad = true; break; }
        values.push(v);
      }
      if (bad || values.length < 3 || values.length % 3 !== 0) { i++; continue; }
      var atomIndex = pickAtomIndex(coord, atomNumber, natoms);
      var columns = values.length / 3;
      if (columns === modes.length && columns > 1) {
        for (var k = 0; k < modes.length; k++) {
          pushDisplacement(modes[k], atomIndex, values[3 * k], values[3 * k + 1], values[3 * k + 2]);
        }
      } else {
        var target = modes[Math.min(hpMode, modes.length - 1)];
        pushDisplacement(target, atomIndex, values[0], values[1], values[2]);
        rows++;
      }
      i++;
    }
    return { nextLine: i, rows: rows };
  }

  /**
   * 解析一个 "Frequencies --" 块（可含 1–3 个模式）。
   * @param {string[]} lines
   * @param {number} headerIdx   Frequencies 行下标
   * @param {number} windowEnd   下一频率块 / job 结束
   * @param {number|null} natoms
   * @returns {Array} 模式数组
   */
  function parseFrequencyBlock(lines, headerIdx, windowEnd, natoms) {
    var header = RE_FREQ_LINE.exec(lines[headerIdx]);
    if (!header) return [];
    var freqValues = extractNumbers(header[2]);
    var modes = [];
    for (var k = 0; k < freqValues.length; k++) {
      modes.push({
        modeIndex: k + 1,                 // 调用方会重排为 job 内全局 1 基编号
        frequency: freqValues[k],
        irIntensity: null,
        reducedMass: null,
        forceConstant: null,
        imaginary: freqValues[k] < 0,
        displacements: []
      });
    }
    if (!modes.length) return modes;

    var hpMode = 0;
    var hpRowsInGroup = 0;
    var i = headerIdx + 1;
    while (i < windowEnd) {
      var line = lines[i];
      var m;
      if ((m = RE_RED_MASS.exec(line))) { assignModeValues(modes, extractNumbers(m[1]), 'reducedMass'); i++; continue; }
      if ((m = RE_FRC_CONST.exec(line))) { assignModeValues(modes, extractNumbers(m[1]), 'forceConstant'); i++; continue; }
      if ((m = RE_IR_INTEN.exec(line))) { assignModeValues(modes, extractNumbers(m[1]), 'irIntensity'); i++; continue; }
      if (RE_ATOM_AN.test(line)) {
        i = parseAtomAnTable(lines, i + 1, windowEnd, modes, natoms);
        continue;
      }
      if (RE_COORD_ATOM.test(line)) {
        if (hpRowsInGroup > 0) { hpMode++; hpRowsInGroup = 0; }
        var group = parseHpmodesGroup(lines, i + 1, windowEnd, modes, hpMode, natoms);
        hpRowsInGroup += group.rows;
        i = group.nextLine;
        continue;
      }
      i++;
    }
    return modes;
  }

  // ===========================================================================
  // 5. 单个 job 解析
  // ===========================================================================

  function makeThermo() {
    return {
      temperature: null,
      pressure: null,
      zeroPointCorrection: null,
      thermalCorrectionEnergy: null,
      thermalCorrectionEnthalpy: null,
      thermalCorrectionGibbs: null,
      sumElectronicZeroPoint: null,
      sumElectronicThermal: null,
      sumElectronicEnthalpy: null,
      sumElectronicGibbs: null
    };
  }

  /**
   * 解析 [start, end) 行范围内的一个 Gaussian job。
   * 无任何可识别内容时返回 null。
   * @returns {object|null}
   */
  function parseJob(lines, start, end, ctx, warnings) {
    var i;
    var m;
    var t;

    // ---- route -----------------------------------------------------------
    var routeInfo = findRoute(lines, start, end);
    var routeFull = routeInfo ? routeInfo.routeFull : '';
    var route = cleanRoute(routeFull);

    // ---- charge / multiplicity ------------------------------------------
    var charge = null;
    var multiplicity = null;
    for (i = start; i < end; i++) {
      m = RE_CHARGE_MULT.exec(lines[i]);
      if (m) {
        charge = parseInt(m[1], 10);
        multiplicity = parseInt(m[2], 10);
        break;
      }
    }
    if (charge === null && ctx.globalCharge !== null) {
      charge = ctx.globalCharge;
      multiplicity = ctx.globalMultiplicity;
    }

    // ---- NAtoms ----------------------------------------------------------
    var natoms = null;
    for (i = start; i < end; i++) {
      m = RE_NATOMS.exec(lines[i]);
      if (m) { natoms = parseInt(m[1], 10); break; }
    }

    // ---- orientation 标题（本 job 第一个；NAtoms 缺失时由行数推断） -------
    var firstOrientationLine = -1;
    for (i = start; i < end; i++) {
      if (RE_STANDARD_ORIENTATION.test(lines[i])) { firstOrientationLine = i; break; }
    }
    if (firstOrientationLine < 0) {
      for (i = start; i < end; i++) {
        if (RE_INPUT_ORIENTATION.test(lines[i])) { firstOrientationLine = i; break; }
      }
    }
    if (natoms === null && firstOrientationLine >= 0) {
      var rows = countOrientationRows(lines, firstOrientationLine, end);
      if (rows > 0) natoms = rows;
    }

    // ---- 全局帧索引 ------------------------------------------------------
    var orientationStartIndex = null;
    if (ctx.standardPositions.length > 0) {
      var stdIdx = lowerBound(ctx.standardPositions, start);
      if (stdIdx < ctx.standardPositions.length && ctx.standardPositions[stdIdx] < end) {
        orientationStartIndex = stdIdx;              // 全局 Standard orientation 帧号
      }
    } else if (ctx.inputPositions.length > 0) {
      var inpIdx = lowerBound(ctx.inputPositions, start);
      if (inpIdx < ctx.inputPositions.length && ctx.inputPositions[inpIdx] < end) {
        orientationStartIndex = 0;                   // 回退：仅 1 个 Input orientation 帧
      }
    }

    // ---- SCF Done 序列 ---------------------------------------------------
    var scfEntries = [];
    for (i = start; i < end; i++) {
      m = RE_SCF_DONE.exec(lines[i]);
      if (!m) continue;
      var energy = parseNumber(m[2]);
      if (energy === null) continue;
      scfEntries.push({
        step: scfEntries.length + 1,
        energy: energy,
        cycles: m[3] ? parseInt(m[3], 10) : null,
        lineIndex: i
      });
    }
    var scfEnergies = [];
    for (i = 0; i < scfEntries.length; i++) {
      scfEnergies.push({
        step: scfEntries[i].step,
        energy: scfEntries[i].energy,
        cycles: scfEntries[i].cycles
      });
    }

    // ---- 优化收敛表 ------------------------------------------------------
    var tables = [];
    var currentTable = null;
    for (i = start; i < end; i++) {
      var line = lines[i];
      if (RE_CONV_HEADER.test(line)) continue;      // 表头行本身不含判据值
      m = RE_PRED_DELTA.exec(line);
      if (m) {
        var pred = parseNumber(m[1]);
        if (currentTable) currentTable.predictedDeltaEnergy = pred;
        else if (tables.length) tables[tables.length - 1].predictedDeltaEnergy = pred;
        continue;
      }
      m = RE_CONV_ROW.exec(line);
      if (!m) continue;
      var label = m[1].replace(/\s+/g, ' ').toLowerCase();
      var value = parseNumber(m[2]);
      var isYes = /^YES$/i.test(m[4]);
      if (label === 'maximum force') {
        if (currentTable && currentTable.rows > 0) tables.push(currentTable);
        currentTable = {
          maxForce: null, rmsForce: null, maxDisplacement: null, rmsDisplacement: null,
          converged: null, predictedDeltaEnergy: null, rows: 0, flags: [],
          lineIndex: i
        };
      }
      if (!currentTable) continue;
      if (label === 'maximum force') currentTable.maxForce = value;
      else if (label === 'rms force') currentTable.rmsForce = value;
      else if (label === 'maximum displacement') currentTable.maxDisplacement = value;
      else if (label === 'rms displacement') currentTable.rmsDisplacement = value;
      currentTable.rows++;
      currentTable.flags.push(isYes);
    }
    if (currentTable && currentTable.rows > 0) tables.push(currentTable);

    var optSteps = [];
    for (t = 0; t < tables.length; t++) {
      var table = tables[t];
      var stepEnergy = null;
      for (var s = 0; s < scfEntries.length; s++) {
        if (scfEntries[s].lineIndex < table.lineIndex) stepEnergy = scfEntries[s].energy;
        else break;
      }
      var frameIndex = null;
      if (ctx.standardPositions.length > 0) {
        var fi = lastBefore(ctx.standardPositions, table.lineIndex);
        if (fi >= 0) frameIndex = fi;
      }
      var allYes = table.rows >= 4 && table.flags.length >= 4;
      if (allYes) {
        for (var f = 0; f < table.flags.length; f++) {
          if (!table.flags[f]) { allYes = false; break; }
        }
      }
      var anyNo = false;
      for (var f2 = 0; f2 < table.flags.length; f2++) {
        if (!table.flags[f2]) { anyNo = true; break; }
      }
      var converged = table.rows >= 4 ? (allYes ? true : false) : (anyNo ? false : null);
      optSteps.push({
        step: optSteps.length + 1,
        energy: stepEnergy,
        maxForce: table.maxForce,
        rmsForce: table.rmsForce,
        maxDisplacement: table.maxDisplacement,
        rmsDisplacement: table.rmsDisplacement,
        converged: converged,
        predictedDeltaEnergy: table.predictedDeltaEnergy,
        frameIndex: frameIndex
      });
    }

    // ---- Optimization completed / Stationary point ----------------------
    var completed = false;
    var stationaryPoint = false;
    for (i = start; i < end; i++) {
      if (!completed && RE_OPT_COMPLETED.test(lines[i])) completed = true;
      if (!stationaryPoint && RE_STATIONARY.test(lines[i])) stationaryPoint = true;
      if (completed && stationaryPoint) break;
    }
    var optimization = null;
    if (completed || stationaryPoint || optSteps.length > 0) {
      var optConverged = null;
      if (completed || stationaryPoint) {
        optConverged = true;
      } else if (optSteps.length > 0) {
        optConverged = optSteps[optSteps.length - 1].converged;
      }
      optimization = {
        completed: completed,
        stationaryPoint: stationaryPoint,
        converged: optConverged
      };
    }

    // ---- 热化学 ----------------------------------------------------------
    var thermo = makeThermo();
    var thermoFound = false;
    for (i = start; i < end; i++) {
      var tl = lines[i];
      if (RE_TEMP_PRESSURE.test(tl)) {
        m = RE_TEMP_PRESSURE.exec(tl);
        thermo.temperature = parseNumber(m[1]);
        thermo.pressure = parseNumber(m[2]);
        thermoFound = true;
      }
      for (var tf = 0; tf < THERMO_FIELDS.length; tf++) {
        m = THERMO_FIELDS[tf][1].exec(tl);
        if (m) {
          var tv = parseNumber(m[1]);
          if (tv !== null) {
            thermo[THERMO_FIELDS[tf][0]] = tv;   // 多处出现时取最后（最终结果）
            thermoFound = true;
          }
          break;
        }
      }
    }
    if (thermo.temperature === null || thermo.pressure === null) {
      for (i = start; i < end; i++) {
        if (thermo.temperature === null) {
          m = RE_TEMPERATURE.exec(lines[i]);
          if (m) { thermo.temperature = parseNumber(m[1]); thermoFound = true; }
        }
        if (thermo.pressure === null) {
          m = RE_PRESSURE.exec(lines[i]);
          if (m) { thermo.pressure = parseNumber(m[1]); thermoFound = true; }
        }
        if (thermo.temperature !== null && thermo.pressure !== null) break;
      }
    }

    // ---- 频率 ------------------------------------------------------------
    var freqHeaderIndices = [];
    var hasHarmonicHeader = false;
    for (i = start; i < end; i++) {
      if (RE_FREQ_LINE.test(lines[i])) freqHeaderIndices.push(i);
      if (!hasHarmonicHeader && RE_HARMONIC.test(lines[i])) hasHarmonicHeader = true;
    }
    var frequencies = [];
    for (var h = 0; h < freqHeaderIndices.length; h++) {
      var windowEnd = (h + 1 < freqHeaderIndices.length) ? freqHeaderIndices[h + 1] : end;
      var blockModes = parseFrequencyBlock(lines, freqHeaderIndices[h], windowEnd, natoms);
      for (var b = 0; b < blockModes.length; b++) {
        blockModes[b].modeIndex = frequencies.length + 1;
        frequencies.push(blockModes[b]);
      }
    }

    // 频率段告警：位移/IR 缺失属于可容忍情况
    if (frequencies.length > 0) {
      var withDisp = 0;
      var withIr = 0;
      for (var q = 0; q < frequencies.length; q++) {
        if (frequencies[q].displacements.length > 0) withDisp++;
        if (frequencies[q].irIntensity !== null) withIr++;
      }
      if (withDisp === 0) {
        warnings.push('Frequency modes found but per-atom displacements could not be parsed (hpmodes/truncated output); animation data will be empty.');
      }
      if (withIr < frequencies.length) {
        warnings.push('Some frequency modes have no IR intensities (e.g. freq=(raman)); irIntensity set to null.');
      }
    } else if (hasHarmonicHeader) {
      warnings.push('Harmonic frequencies section found but no mode frequencies could be read.');
    }
    if (natoms === null) {
      var maxAtom = -1;
      for (var fq = 0; fq < frequencies.length; fq++) {
        for (var dq = 0; dq < frequencies[fq].displacements.length; dq++) {
          if (frequencies[fq].displacements[dq].atomIndex > maxAtom) {
            maxAtom = frequencies[fq].displacements[dq].atomIndex;
          }
        }
      }
      if (maxAtom >= 0) natoms = maxAtom + 1;
    }

    // ---- freqFrameIndex --------------------------------------------------
    var freqFrameIndex = null;
    if (freqHeaderIndices.length > 0) {
      var firstFreqLine = freqHeaderIndices[0];
      var frameNo = lastBefore(ctx.standardPositions, firstFreqLine);
      if (frameNo >= 0) {
        freqFrameIndex = frameNo;
      } else if (ctx.standardPositions.length === 0 && ctx.inputPositions.length > 0) {
        var inputNo = lastBefore(ctx.inputPositions, firstFreqLine);
        if (inputNo >= 0) {
          freqFrameIndex = 0;
          warnings.push('No Standard orientation found; freqFrameIndex falls back to the last Input orientation (single parsed frame, index 0).');
        }
      }
    }

    // ---- 终止状态 --------------------------------------------------------
    var normalTermination = null;
    for (i = start; i < end; i++) {
      if (RE_TERM_NORMAL.test(lines[i])) normalTermination = true;
      else if (RE_TERM_ERROR.test(lines[i])) normalTermination = false;
    }

    // ---- 内容判定 --------------------------------------------------------
    var hasContent = routeInfo !== null || scfEntries.length > 0 || frequencies.length > 0 ||
      optSteps.length > 0 || optimization !== null || thermoFound ||
      freqHeaderIndices.length > 0 || firstOrientationLine >= 0 || normalTermination !== null;
    if (!hasContent) return null;

    return {
      index: -1,                          // 调用方赋值为 jobs 数组下标
      route: route,
      routeFull: routeFull,
      charge: charge,
      multiplicity: multiplicity,
      natoms: natoms,
      normalTermination: normalTermination,
      scfEnergies: scfEnergies,
      optSteps: optSteps,
      optimization: optimization,
      thermochemistry: thermoFound ? thermo : null,
      frequencies: frequencies,
      freqFrameIndex: freqFrameIndex,
      orientationStartIndex: orientationStartIndex
    };
  }

  // ===========================================================================
  // 6. 聚合 summary
  // ===========================================================================

  function emptySummary() {
    return {
      hasAnalysis: false,
      jobCount: 0,
      route: '',
      charge: null,
      multiplicity: null,
      natoms: null,
      finalEnergy: null,
      normalTermination: null,
      hasFrequencies: false,
      hasOptimization: false,
      hasThermochemistry: false,
      opt: null,
      thermochemistry: null,
      frequencies: [],
      freqFrameIndex: null,
      energySteps: []
    };
  }

  function firstNonNull(jobs, key) {
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i][key] !== null && jobs[i][key] !== undefined) return jobs[i][key];
    }
    return null;
  }

  /** 由 jobs[] 构建 UI 直接使用的聚合结果。 */
  function buildSummary(jobs) {
    var summary = emptySummary();
    summary.jobCount = jobs.length;
    if (!jobs.length) return summary;

    var optJob = null;
    var freqJob = null;
    var thermoJob = null;
    var analysisJob = null;
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (!optJob && (job.optSteps.length > 0 || job.optimization)) optJob = job;
      if (!freqJob && job.frequencies.length > 0) freqJob = job;
      if (!thermoJob && job.thermochemistry) thermoJob = job;
      if (!analysisJob && (job.frequencies.length > 0 || job.thermochemistry)) analysisJob = job;
    }
    if (!analysisJob) analysisJob = optJob || jobs[0];

    summary.route = analysisJob.route || '';
    if (!summary.route) {
      for (i = 0; i < jobs.length; i++) {
        if (jobs[i].route) { summary.route = jobs[i].route; break; }
      }
    }
    summary.charge = analysisJob.charge !== null ? analysisJob.charge : firstNonNull(jobs, 'charge');
    summary.multiplicity = analysisJob.multiplicity !== null ? analysisJob.multiplicity : firstNonNull(jobs, 'multiplicity');
    summary.natoms = analysisJob.natoms !== null ? analysisJob.natoms : firstNonNull(jobs, 'natoms');

    // 单点能：全文最后一个 SCF Done（按 job 顺序）
    for (i = jobs.length - 1; i >= 0; i--) {
      var scf = jobs[i].scfEnergies;
      if (scf.length > 0) {
        summary.finalEnergy = scf[scf.length - 1].energy;
        break;
      }
    }
    // 终止状态：最后一个非 null 的 job 值
    for (i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].normalTermination !== null) {
        summary.normalTermination = jobs[i].normalTermination;
        break;
      }
    }

    summary.hasFrequencies = freqJob !== null;
    summary.hasOptimization = optJob !== null;
    summary.hasThermochemistry = thermoJob !== null;
    summary.frequencies = freqJob ? freqJob.frequencies : [];
    summary.thermochemistry = thermoJob ? thermoJob.thermochemistry : null;
    summary.freqFrameIndex = freqJob ? freqJob.freqFrameIndex : null;

    if (optJob) {
      var opt = optJob.optimization;
      summary.opt = {
        steps: optJob.optSteps,
        completed: opt ? opt.completed : false,
        stationaryPoint: opt ? opt.stationaryPoint : false,
        converged: opt ? opt.converged : null
      };
    }

    // 能量曲线：优先 optSteps.energy；否则 scfEnergies
    var energySteps = [];
    if (optJob) {
      for (i = 0; i < optJob.optSteps.length; i++) {
        if (optJob.optSteps[i].energy !== null) {
          energySteps.push({ step: optJob.optSteps[i].step, energy: optJob.optSteps[i].energy });
        }
      }
    }
    if (!energySteps.length) {
      var sourceJob = analysisJob;
      for (i = 0; i < sourceJob.scfEnergies.length; i++) {
        energySteps.push({ step: sourceJob.scfEnergies[i].step, energy: sourceJob.scfEnergies[i].energy });
      }
    }
    summary.energySteps = energySteps;

    summary.hasAnalysis = !!(freqJob || optJob || thermoJob || summary.finalEnergy !== null);
    return summary;
  }

  function failure(warnings) {
    return {
      ok: false,
      format: FORMAT,
      jobs: [],
      summary: emptySummary(),
      warnings: warnings
    };
  }

  // ===========================================================================
  // 7. 公共 API
  // ===========================================================================

  /**
   * 解析 Gaussian 输出日志。
   * 绝不抛异常：空文本 / 非 log 文本 -> {ok:false, jobs:[], summary:{hasAnalysis:false}, warnings:[...]}
   * @param {string} text
   * @returns {{ok:boolean, format:string, jobs:Array, summary:object, warnings:string[]}}
   */
  function parse(text) {
    var warnings = [];
    var source = '';
    try {
      if (text === null || text === undefined) source = '';
      else if (typeof text === 'string') source = text;
      else source = String(text);
    } catch (err) {
      source = '';
    }

    // BOM + 换行归一化（CRLF / 单独 CR）
    if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
    source = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (!source.trim()) {
      warnings.push('Empty input: not a Gaussian log.');
      return failure(warnings);
    }
    if (!RE_GAUSSIAN_HINT.test(source)) {
      warnings.push('Input does not look like a Gaussian output log (no Entering Link 1 / SCF Done / orientation markers).');
      return failure(warnings);
    }

    try {
      var lines = source.split('\n');
      var ctx = {
        globalCharge: null,
        globalMultiplicity: null,
        standardPositions: [],
        inputPositions: []
      };

      // 全文第一处 Charge/Multiplicity 作为缺失 job 的回退值
      for (var i = 0; i < lines.length; i++) {
        var cm = RE_CHARGE_MULT.exec(lines[i]);
        if (cm) {
          ctx.globalCharge = parseInt(cm[1], 10);
          ctx.globalMultiplicity = parseInt(cm[2], 10);
          break;
        }
      }

      var positions = collectPositions(lines);
      ctx.standardPositions = positions.standardPositions;
      ctx.inputPositions = positions.inputPositions;

      var starts = findJobStarts(lines);
      var jobs = [];
      for (var s = 0; s < starts.length; s++) {
        var start = starts[s];
        var end = (s + 1 < starts.length) ? starts[s + 1] : lines.length;
        if (end <= start) continue;
        var jobWarnings = [];
        var job = parseJob(lines, start, end, ctx, jobWarnings);
        if (!job) continue;
        job.index = jobs.length;
        jobs.push(job);
        for (var w = 0; w < jobWarnings.length; w++) {
          if (warnings.indexOf(jobWarnings[w]) === -1) warnings.push(jobWarnings[w]);
        }
      }

      var summary = buildSummary(jobs);
      if (jobs.length === 0) {
        warnings.push('No Gaussian job content could be recognized in this log.');
      }

      for (var e = 0; e < jobs.length; e++) {
        if (jobs[e].normalTermination === false) {
          warnings.push('Job ' + (e + 1) + ' ended with Error termination.');
        }
      }

      return {
        ok: true,
        format: FORMAT,
        jobs: jobs,
        summary: summary,
        warnings: warnings
      };
    } catch (err) {
      warnings.push('Failed to parse Gaussian log: ' + (err && err.message ? err.message : String(err)));
      return failure(warnings);
    }
  }

  /** LogResults 是否包含任何可展示结果（null/非法输入安全）。 */
  function hasAnalysis(results) {
    return !!(results && results.ok !== false && results.summary && results.summary.hasAnalysis === true);
  }

  var MolGaussLog = (root.MolGaussLog = root.MolGaussLog || {});
  MolGaussLog.version = VERSION;
  MolGaussLog.parse = parse;
  MolGaussLog.hasAnalysis = hasAnalysis;

  // Node 单元测试支持（UMD 同 js/core.js）
  if (typeof module === 'object' && module.exports) module.exports = MolGaussLog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
