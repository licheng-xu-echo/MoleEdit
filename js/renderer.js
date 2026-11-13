/*!
 * MolEdit — js/renderer.js
 * Canvas 2D 软件 3D 渲染器（GaussView 风格球棍模型）
 *
 * 契约：INTERFACE.md §7（MolRender API）。经典脚本、零依赖、零 ES module。
 * 挂载：globalThis.MolRender = { version, createView, styles, defaultOptions }
 *
 * 设计要点：
 *  - 相机 = 3x3 旋转矩阵（模型 -> 视图）+ 世界中心 + 透视距离 + 每埃像素缩放 + 屏幕平移；
 *  - 每一帧先统一投影所有原子（缓存到 frame 对象，bond/pick/project/overlay 复用）；
 *  - 原子与“键半段”放入同一个列表按视图深度排序（画家算法），保证近处原子遮挡背后键；
 *  - 球体径向渐变高光 + 深色描边；键按两端原子颜色分半、带描边；多重键用平行线；
 *  - 选中环 / 序号徽标在最后绘制，永远处于最上层；
 *  - 元素颜色与范德华半径优先读取 MolCore.ELEMENTS，缺失时使用内置 CPK 兜底表；
 *  - 不修改分子数据、不注册 window 事件（交互由 ui.js 负责）。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var TWO_PI = Math.PI * 2;
  var FONT_STACK = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var FRAME_FILL = 0.68;          // frameAll 时分子内容（含样式半径）占据视口短边的比例
  var ROTATE_DEG_PER_PX = 0.55;   // 拖动旋转灵敏度（度/像素）

  var STYLE_LIST = ['ballstick', 'spacefill', 'stick', 'wireframe'];

  /* =====================================================================
   * 默认选项（INTERFACE.md §7 规定，不得增删公共字段）
   * ===================================================================== */
  var DEFAULT_OPTIONS = {
    style: 'ballstick',               // 'ballstick' | 'spacefill' | 'stick' | 'wireframe'
    labels: true,                     // 原子上显示元素符号
    indices: false,                   // 显示原子序号（1 基）
    showAxes: true,                   // 左下角坐标轴
    background: '#ffffff',
    selectionColor: '#ff7a00',
    hoverColor: '#ffd166',
    measurementColor: '#0f9d9d',
    bondWidth: 1.0,                   // 键粗细倍率
    labelMinScreenRadius: 9           // 屏幕半径小于此值不画元素符号
  };

  /* =====================================================================
   * 内置 CPK 兜底元素表（MolCore.ELEMENTS 不存在时使用）
   * 颜色取自 Jmol/CPK 常用配色；vdw / covalent 单位 Å。
   * ===================================================================== */
  var FALLBACK_ELEMENTS = {
    H:  { symbol: 'H',  name: '氢',  atomicNumber: 1,  color: '#ffffff', vdw: 1.20, covalent: 0.31 },
    He: { symbol: 'He', name: '氦',  atomicNumber: 2,  color: '#d9ffff', vdw: 1.40, covalent: 0.28 },
    Li: { symbol: 'Li', name: '锂',  atomicNumber: 3,  color: '#cc80ff', vdw: 1.82, covalent: 1.28 },
    Be: { symbol: 'Be', name: '铍',  atomicNumber: 4,  color: '#c2ff00', vdw: 1.53, covalent: 0.96 },
    B:  { symbol: 'B',  name: '硼',  atomicNumber: 5,  color: '#ffb5b5', vdw: 1.92, covalent: 0.84 },
    C:  { symbol: 'C',  name: '碳',  atomicNumber: 6,  color: '#454545', vdw: 1.70, covalent: 0.76 },
    N:  { symbol: 'N',  name: '氮',  atomicNumber: 7,  color: '#3050f8', vdw: 1.55, covalent: 0.71 },
    O:  { symbol: 'O',  name: '氧',  atomicNumber: 8,  color: '#ff0d0d', vdw: 1.52, covalent: 0.66 },
    F:  { symbol: 'F',  name: '氟',  atomicNumber: 9,  color: '#90e050', vdw: 1.47, covalent: 0.57 },
    Ne: { symbol: 'Ne', name: '氖',  atomicNumber: 10, color: '#b3e3f5', vdw: 1.54, covalent: 0.58 },
    Na: { symbol: 'Na', name: '钠',  atomicNumber: 11, color: '#ab5cf2', vdw: 2.27, covalent: 1.66 },
    Mg: { symbol: 'Mg', name: '镁',  atomicNumber: 12, color: '#8aff00', vdw: 1.73, covalent: 1.41 },
    Al: { symbol: 'Al', name: '铝',  atomicNumber: 13, color: '#bfa6a6', vdw: 1.84, covalent: 1.21 },
    Si: { symbol: 'Si', name: '硅',  atomicNumber: 14, color: '#f0c8a0', vdw: 2.10, covalent: 1.11 },
    P:  { symbol: 'P',  name: '磷',  atomicNumber: 15, color: '#ff8000', vdw: 1.80, covalent: 1.07 },
    S:  { symbol: 'S',  name: '硫',  atomicNumber: 16, color: '#ffff30', vdw: 1.80, covalent: 1.05 },
    Cl: { symbol: 'Cl', name: '氯',  atomicNumber: 17, color: '#1ff01f', vdw: 1.75, covalent: 1.02 },
    Ar: { symbol: 'Ar', name: '氩',  atomicNumber: 18, color: '#80d1e3', vdw: 1.88, covalent: 1.06 },
    K:  { symbol: 'K',  name: '钾',  atomicNumber: 19, color: '#8f40d4', vdw: 2.75, covalent: 2.03 },
    Ca: { symbol: 'Ca', name: '钙',  atomicNumber: 20, color: '#3dff00', vdw: 2.31, covalent: 1.76 },
    Sc: { symbol: 'Sc', name: '钪',  atomicNumber: 21, color: '#e6e6e6', vdw: 2.30, covalent: 1.70 },
    Ti: { symbol: 'Ti', name: '钛',  atomicNumber: 22, color: '#bfc2c7', vdw: 2.15, covalent: 1.60 },
    V:  { symbol: 'V',  name: '钒',  atomicNumber: 23, color: '#a6a6ab', vdw: 2.05, covalent: 1.53 },
    Cr: { symbol: 'Cr', name: '铬',  atomicNumber: 24, color: '#8a99c7', vdw: 2.05, covalent: 1.39 },
    Mn: { symbol: 'Mn', name: '锰',  atomicNumber: 25, color: '#9c7ac7', vdw: 2.05, covalent: 1.39 },
    Fe: { symbol: 'Fe', name: '铁',  atomicNumber: 26, color: '#e06633', vdw: 2.00, covalent: 1.32 },
    Co: { symbol: 'Co', name: '钴',  atomicNumber: 27, color: '#f090a0', vdw: 2.00, covalent: 1.26 },
    Ni: { symbol: 'Ni', name: '镍',  atomicNumber: 28, color: '#50d050', vdw: 1.63, covalent: 1.24 },
    Cu: { symbol: 'Cu', name: '铜',  atomicNumber: 29, color: '#c88033', vdw: 1.40, covalent: 1.32 },
    Zn: { symbol: 'Zn', name: '锌',  atomicNumber: 30, color: '#7d80b0', vdw: 1.39, covalent: 1.22 },
    Ga: { symbol: 'Ga', name: '镓',  atomicNumber: 31, color: '#c28f8f', vdw: 1.87, covalent: 1.22 },
    Ge: { symbol: 'Ge', name: '锗',  atomicNumber: 32, color: '#668f8f', vdw: 2.11, covalent: 1.20 },
    As: { symbol: 'As', name: '砷',  atomicNumber: 33, color: '#bd80e3', vdw: 1.85, covalent: 1.19 },
    Se: { symbol: 'Se', name: '硒',  atomicNumber: 34, color: '#ffa100', vdw: 1.90, covalent: 1.20 },
    Br: { symbol: 'Br', name: '溴',  atomicNumber: 35, color: '#a62929', vdw: 1.85, covalent: 1.20 },
    Kr: { symbol: 'Kr', name: '氪',  atomicNumber: 36, color: '#5cb8d1', vdw: 2.02, covalent: 1.16 },
    Rb: { symbol: 'Rb', name: '铷',  atomicNumber: 37, color: '#702eb0', vdw: 3.03, covalent: 2.20 },
    Sr: { symbol: 'Sr', name: '锶',  atomicNumber: 38, color: '#00ff00', vdw: 2.49, covalent: 1.95 },
    Y:  { symbol: 'Y',  name: '钇',  atomicNumber: 39, color: '#94ffff', vdw: 2.40, covalent: 1.90 },
    Zr: { symbol: 'Zr', name: '锆',  atomicNumber: 40, color: '#94e0e0', vdw: 2.30, covalent: 1.75 },
    Mo: { symbol: 'Mo', name: '钼',  atomicNumber: 42, color: '#54b5b5', vdw: 2.10, covalent: 1.54 },
    Ag: { symbol: 'Ag', name: '银',  atomicNumber: 47, color: '#c0c0c0', vdw: 1.72, covalent: 1.53 },
    Cd: { symbol: 'Cd', name: '镉',  atomicNumber: 48, color: '#ffd98f', vdw: 1.58, covalent: 1.48 },
    In: { symbol: 'In', name: '铟',  atomicNumber: 49, color: '#a67573', vdw: 1.93, covalent: 1.44 },
    Sn: { symbol: 'Sn', name: '锡',  atomicNumber: 50, color: '#668080', vdw: 2.17, covalent: 1.41 },
    Sb: { symbol: 'Sb', name: '锑',  atomicNumber: 51, color: '#9e63b5', vdw: 2.06, covalent: 1.40 },
    Te: { symbol: 'Te', name: '碲',  atomicNumber: 52, color: '#d47a00', vdw: 2.06, covalent: 1.36 },
    I:  { symbol: 'I',  name: '碘',  atomicNumber: 53, color: '#940094', vdw: 1.98, covalent: 1.39 },
    Xe: { symbol: 'Xe', name: '氙',  atomicNumber: 54, color: '#429eb0', vdw: 2.16, covalent: 1.40 },
    Cs: { symbol: 'Cs', name: '铯',  atomicNumber: 55, color: '#57178f', vdw: 3.43, covalent: 2.44 },
    Ba: { symbol: 'Ba', name: '钡',  atomicNumber: 56, color: '#00c900', vdw: 2.68, covalent: 2.15 },
    Pt: { symbol: 'Pt', name: '铂',  atomicNumber: 78, color: '#d0d0e0', vdw: 1.75, covalent: 1.36 },
    Au: { symbol: 'Au', name: '金',  atomicNumber: 79, color: '#ffd123', vdw: 1.66, covalent: 1.36 },
    Hg: { symbol: 'Hg', name: '汞',  atomicNumber: 80, color: '#b8b8d0', vdw: 1.55, covalent: 1.32 },
    Pb: { symbol: 'Pb', name: '铅',  atomicNumber: 82, color: '#575961', vdw: 2.02, covalent: 1.46 }
  };

  /* =====================================================================
   * 通用工具
   * ===================================================================== */
  var hasOwn = Object.prototype.hasOwnProperty;
  function has(obj, key) { return obj != null && hasOwn.call(obj, key); }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function normSymbol(symbol) {
    if (typeof symbol !== 'string' || !symbol) return '';
    var s = symbol.trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /* ---------- 颜色 ---------- */
  function parseColor(c) {
    if (typeof c !== 'string') return [150, 150, 150];
    var s = c.trim();
    var m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      var h = m[1];
      return [parseInt(h.charAt(0) + h.charAt(0), 16), parseInt(h.charAt(1) + h.charAt(1), 16), parseInt(h.charAt(2) + h.charAt(2), 16)];
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = /^rgba?\(\s*([^)]+)\)$/i.exec(s);
    if (m) {
      var p = m[1].split(',');
      return [clamp(parseInt(p[0], 10) || 0, 0, 255), clamp(parseInt(p[1], 10) || 0, 0, 255), clamp(parseInt(p[2], 10) || 0, 0, 255)];
    }
    return [150, 150, 150];
  }

  function rgbCss(c) {
    return 'rgb(' + (Math.round(c[0]) | 0) + ',' + (Math.round(c[1]) | 0) + ',' + (Math.round(c[2]) | 0) + ')';
  }
  function mixColor(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function lighten(c, t) { return mixColor(c, [255, 255, 255], clamp(t, 0, 1)); }
  function darken(c, t) { return mixColor(c, [0, 0, 0], clamp(t, 0, 1)); }
  function luminance(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }

  /* ---------- 3x3 旋转矩阵（行主序：v_view = R * v_world） ---------- */
  function matIdentity() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }

  function matMul(a, b) {
    var o = new Array(9);
    for (var r = 0; r < 3; r++) {
      var r0 = a[r * 3], r1 = a[r * 3 + 1], r2 = a[r * 3 + 2];
      o[r * 3] = r0 * b[0] + r1 * b[3] + r2 * b[6];
      o[r * 3 + 1] = r0 * b[1] + r1 * b[4] + r2 * b[7];
      o[r * 3 + 2] = r0 * b[2] + r1 * b[5] + r2 * b[8];
    }
    return o;
  }

  function matRotX(rad) {
    var c = Math.cos(rad), s = Math.sin(rad);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }
  function matRotY(rad) {
    var c = Math.cos(rad), s = Math.sin(rad);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }

  // Gram-Schmidt 正交化，抑制长时间拖动后的矩阵漂移
  function matOrthonormalize(m) {
    var a0 = m[0], a1 = m[1], a2 = m[2];
    var l0 = Math.sqrt(a0 * a0 + a1 * a1 + a2 * a2) || 1;
    a0 /= l0; a1 /= l0; a2 /= l0;
    var b0 = m[3], b1 = m[4], b2 = m[5];
    var d = b0 * a0 + b1 * a1 + b2 * a2;
    b0 -= d * a0; b1 -= d * a1; b2 -= d * a2;
    var l1 = Math.sqrt(b0 * b0 + b1 * b1 + b2 * b2) || 1;
    b0 /= l1; b1 /= l1; b2 /= l1;
    var c0 = a1 * b2 - a2 * b1;
    var c1 = a2 * b0 - a0 * b2;
    var c2 = a0 * b1 - a1 * b0;
    return [a0, a1, a2, b0, b1, b2, c0, c1, c2];
  }

  /* =====================================================================
   * 元素解析（优先 MolCore，退回内置 CPK 表；绝不因 core.js 缺失而报错）
   * ===================================================================== */
  function currentElementsTable() {
    var core = root.MolCore;
    if (core && core.ELEMENTS && typeof core.ELEMENTS === 'object') return core.ELEMENTS;
    return null;
  }

  function lookupElementInsensitive(table, symbol) {
    if (!table || !symbol) return null;
    var s = normSymbol(symbol);
    if (!s) return null;
    var e = table[s];
    if (e && typeof e === 'object') return e;
    for (var k in table) {
      if (!has(table, k)) continue;
      if (k.toUpperCase() === s.toUpperCase()) {
        var v = table[k];
        return (v && typeof v === 'object') ? v : null;
      }
    }
    return null;
  }

  function resolveElement(symbol) {
    var core = root.MolCore;
    if (core && typeof core.element === 'function') {
      try {
        var e = core.element(symbol);
        if (e && typeof e === 'object') return e;
      } catch (err) { /* 忽略：继续走兜底逻辑 */ }
    }
    var tbl = currentElementsTable();
    if (tbl) {
      var e2 = lookupElementInsensitive(tbl, symbol);
      if (e2) return e2;
    }
    return lookupElementInsensitive(FALLBACK_ELEMENTS, symbol);
  }

  function unknownElement(symbol) {
    var sym = normSymbol(symbol) || '?';
    return { symbol: sym, name: sym, atomicNumber: 0, color: '#c9c9c9', vdw: 1.60, covalent: 0.80 };
  }

  // 预计算每颗原子的绘制颜色（渐变、描边、文字颜色），每帧复用，避免重复字符串拼接
  function decorateAtom(symbol) {
    var el = resolveElement(symbol) || unknownElement(symbol);
    var base = parseColor(el.color);
    var vdw = num(el.vdw);
    var covalent = num(el.covalent);
    if (!(vdw > 0)) vdw = 1.60;
    if (!(covalent > 0)) covalent = 0.80;
    var lum = luminance(base);
    // 很浅的颜色（如 H 的白色）如果只做“变亮”，球会变成扁平白盘；
    // 因此对浅色原子改用整体压暗的灰阶渐变，让高光/明暗仍然可见。
    var isLight = lum > 0.82;
    // V-1：wireframe 在白色背景下需要可辨识的深色线条/原子点；
    // 白色元素（H）改用深灰蓝，其余元素用压暗后的元素色。
    var wireColor = lum > 0.72 ? '#4a5568' : rgbCss(darken(base, 0.12));
    var gHi = rgbCss(isLight ? lighten(base, 0.02) : lighten(base, 0.62));
    var gHi2 = rgbCss(isLight ? darken(base, 0.06) : lighten(base, 0.30));
    var gMid = rgbCss(isLight ? darken(base, 0.14) : lighten(base, 0.10));
    var gBase = rgbCss(isLight ? darken(base, 0.21) : base);
    var gEdge = rgbCss(darken(base, isLight ? 0.33 : 0.36));
    var gStroke = rgbCss(darken(base, isLight ? 0.45 : 0.56));
    return {
      symbol: normSymbol(el.symbol || symbol) || '?',
      base: base,
      vdw: vdw,
      covalent: covalent,
      // 球体径向渐变（左上高光 -> 右下阴影）
      hi: gHi,
      hi2: gHi2,
      mid: gMid,
      gBase: gBase,
      edge: gEdge,
      stroke: gStroke,
      // 键（圆柱）用色：基色 + 高光条 + 描边
      baseCss: rgbCss(base),
      wireColor: wireColor,
      bondEdge: rgbCss(darken(base, isLight ? 0.40 : 0.55)),
      bondShade: rgbCss(isLight ? darken(base, 0.10) : darken(base, 0.20)),
      bondLight: rgbCss(isLight ? lighten(base, 0.0) : lighten(base, 0.24)),
      labelColor: lum > 0.60 ? '#20262e' : '#ffffff'
    };
  }

  /* =====================================================================
   * createView(canvas, options?) -> view
   * ===================================================================== */
  function createView(canvas, userOptions) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('MolRender.createView: 需要传入有效的 <canvas> 元素');
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('MolRender.createView: 无法创建 Canvas 2D 上下文');

    /* ---------- 选项 ---------- */
    var opts = {};
    var k;
    for (k in DEFAULT_OPTIONS) {
      if (has(DEFAULT_OPTIONS, k)) opts[k] = DEFAULT_OPTIONS[k];
    }

    /* ---------- 状态 ---------- */
    var mol = null;
    var atomCache = [];            // 与 mol.atoms 对齐的绘制缓存
    var cacheMol = null;
    var cacheLen = -1;
    var cacheTable = null;

    var W = 0, H = 0, dpr = 1;
    var rot = matIdentity();       // 模型 -> 视图
    var center = [0, 0, 0];        // 世界坐标中心
    var scale = 40;                // 中心平面处 px / Å
    var camDist = 20;              // 相机到中心的距离（Å），透视投影
    var panX = 0, panY = 0;        // 屏幕平移（CSS px）

    var selection = [];
    var hover = -1;
    var measurement = null;        // { atoms: number[], type: 'distance'|'angle'|'dihedral' }
    // v2 振动位移（INTERFACE2 §5）：displacements[i] = [dx,dy,dz]（Å）；null=无位移。
    // 只影响投影/绘制，绝不写回 molecule。
    var displacements = null;

    var frameCache = null;
    var frameValid = false;

    var rafId = 0;
    var disposed = false;
    var needsAutoFrame = false;

    /* ---------- 选项应用 ---------- */
    function applyOption(key, value) {
      var val = value;
      var n;
      switch (key) {
        case 'style':
          if (STYLE_LIST.indexOf(val) < 0) return false;
          break;
        case 'labels':
        case 'indices':
        case 'showAxes':
          val = !!val;
          break;
        case 'background':
        case 'selectionColor':
        case 'hoverColor':
        case 'measurementColor':
          if (typeof val !== 'string' || !val) return false;
          break;
        case 'bondWidth':
          n = typeof val === 'number' ? val : parseFloat(val);
          if (!isFinite(n) || n <= 0) return false;
          val = clamp(n, 0.15, 6);
          break;
        case 'labelMinScreenRadius':
          n = typeof val === 'number' ? val : parseFloat(val);
          if (!isFinite(n) || n < 0) return false;
          val = clamp(n, 0, 200);
          break;
        default:
          return false;
      }
      if (opts[key] === val) return false;
      opts[key] = val;
      return true;
    }

    /* ---------- 尺寸 / DPR ---------- */
    function syncSize(force) {
      var ndpr = num(root.devicePixelRatio);
      if (!(ndpr > 0)) ndpr = 1;
      var cw = canvas.clientWidth || 0;
      var ch = canvas.clientHeight || 0;
      if (!cw || !ch) {
        // 画布尚未布局（display:none 等）：退回属性尺寸，避免把相机算坏
        cw = cw || Math.round((canvas.width || 0) / ndpr) || 0;
        ch = ch || Math.round((canvas.height || 0) / ndpr) || 0;
      }
      var changed = force || cw !== W || ch !== H || ndpr !== dpr;
      W = cw; H = ch; dpr = ndpr;
      var bw = Math.max(1, Math.round(W * dpr));
      var bh = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      if (changed) invalidate();
      return changed;
    }

    function invalidate() {
      frameCache = null;
      frameValid = false;
    }

    /* ---------- 原子缓存同步 ---------- */
    function syncAtoms() {
      if (!mol || !mol.atoms) {
        if (atomCache.length) { atomCache = []; cacheLen = -1; cacheMol = null; }
        return;
      }
      var atoms = mol.atoms;
      var table = currentElementsTable();
      var need = cacheMol !== mol || cacheLen !== atoms.length || cacheTable !== table;
      if (!need) {
        for (var i = 0; i < atoms.length; i++) {
          var c = atomCache[i];
          var a = atoms[i];
          var sym = a ? a.symbol : '';
          if (!c || normSymbol(c.symbol) !== normSymbol(sym)) { need = true; break; }
        }
      }
      if (!need) return;
      var next = new Array(atoms.length);
      for (var j = 0; j < atoms.length; j++) {
        var atom = atoms[j];
        next[j] = decorateAtom(atom ? atom.symbol : '?');
      }
      atomCache = next;
      cacheMol = mol;
      cacheLen = atoms.length;
      cacheTable = table;
    }

    /* ---------- 样式相关的世界半径 / 键粗 ---------- */
    function atomRadiusWorldFor(c, style) {
      switch (style) {
        case 'spacefill': return c.vdw;
        case 'stick': return 0.15;                                  // 棍状：均匀细圆柱
        case 'wireframe': return Math.max(0.012, 0.015 * c.vdw);
        default: return 0.28 * c.vdw;   // ballstick（0.28×vdw 让键更醒目）
      }
    }

    function atomRadiusWorld(c) {
      return atomRadiusWorldFor(c, opts.style);
    }

    // 键的“直径”（Å），用于换算屏幕宽度；wireframe 走固定像素
    function bondDiameterWorld() {
      if (opts.style === 'stick') return 0.26;
      if (opts.style === 'wireframe') return 0;
      // ballstick：契约“键粗 ≈ 0.11Å × scale”按圆柱半径理解 => 直径 0.22Å
      return 0.22;
    }

    /* ---------- 相机取景（P1：按当前样式的原子视觉半径 + 投影包围盒取景） ---------- */
    function frameAllInternal() {
      if (!mol || !mol.atoms || !mol.atoms.length) {
        center = [0, 0, 0];
        scale = Math.max(24, Math.min(W || 640, H || 480) * 0.12);
        camDist = 24;
        panX = 0; panY = 0;
        return;
      }
      syncAtoms();
      var atoms = mol.atoms;
      var i, n = atoms.length;
      var minx = Infinity, miny = Infinity, minz = Infinity;
      var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      for (i = 0; i < n; i++) {
        var a = atoms[i];
        var x = num(a && a.x), y = num(a && a.y), z = num(a && a.z);
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (z < minz) minz = z;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
        if (z > maxz) maxz = z;
      }
      if (!isFinite(minx)) { minx = miny = minz = -1; maxx = maxy = maxz = 1; }
      center = [(minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5];

      // 相机距离由“含视觉半径的包围球”决定（只影响透视强度）
      var fit = 0;
      for (i = 0; i < n; i++) {
        var at = atoms[i];
        var dx0 = num(at && at.x) - center[0];
        var dy0 = num(at && at.y) - center[1];
        var dz0 = num(at && at.z) - center[2];
        var d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) + atomRadiusWorld(atomCache[i]);
        if (d0 > fit) fit = d0;
      }
      if (!isFinite(fit) || fit < 1e-3) fit = 1.0;
      camDist = Math.max(fit * 6, 2.2);
      var dist = camDist > 1e-6 ? camDist : 1e-6;

      // 以 scale=1 做一次投影，得到“含当前样式原子半径”的屏幕包围盒
      var r0 = rot[0], r1 = rot[1], r2 = rot[2];
      var r3 = rot[3], r4 = rot[4], r5 = rot[5];
      var r6 = rot[6], r7 = rot[7], r8 = rot[8];
      var pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
      for (i = 0; i < n; i++) {
        var at2 = atoms[i];
        var dx = num(at2 && at2.x) - center[0];
        var dy = num(at2 && at2.y) - center[1];
        var dz = num(at2 && at2.z) - center[2];
        var vx = r0 * dx + r1 * dy + r2 * dz;
        var vy = r3 * dx + r4 * dy + r5 * dz;
        var vz = r6 * dx + r7 * dy + r8 * dz;
        var denom = dist - vz;
        if (denom < dist * 0.05) denom = dist * 0.05;
        var pf = dist / denom;
        var rw = atomRadiusWorld(atomCache[i]) * pf;
        var px = vx * pf, py = -vy * pf;
        if (px - rw < pMinX) pMinX = px - rw;
        if (px + rw > pMaxX) pMaxX = px + rw;
        if (py - rw < pMinY) pMinY = py - rw;
        if (py + rw > pMaxY) pMaxY = py + rw;
      }
      if (!isFinite(pMinX)) { pMinX = -1; pMaxX = 1; pMinY = -1; pMaxY = 1; }
      var bw = Math.max(1e-6, pMaxX - pMinX);
      var bh = Math.max(1e-6, pMaxY - pMinY);
      var minDim = (W > 0 && H > 0) ? Math.min(W, H) : 640;
      scale = FRAME_FILL * minDim / Math.max(bw, bh);
      // 内容包围盒中心 -> 画布中心
      panX = -scale * (pMinX + pMaxX) * 0.5;
      panY = -scale * (pMinY + pMaxY) * 0.5;
    }

    /* ---------- 样式切换后的对称视口自适应（P1） ---------- */
    // 切换样式后按当前样式的“屏幕包围盒”调整，使分子约占视口短边的 FRAME_FILL(68%)：
    //  - 内容过大（会溢出）-> 收缩 scale；
    //  - 内容明显偏小（< 62% 目标占比，如 spacefill -> ballstick）-> 放大 scale；
    //  - 只改 scale（必要时补 pan 让分子屏幕中心不动），旋转方向与相机中心保持不变。
    function fitViewOnStyleChange(prevStyle) {
      if (!mol || !mol.atoms || !mol.atoms.length || !(W > 0) || !(H > 0)) return false;
      syncAtoms();
      var fr = buildFrame(false);   // 取景不看振动位移，避免动画抖动

      function bbox(f) {
        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (var q = 0; q < f.n; q++) {
          var l = f.xs[q] - f.rs[q];
          var r = f.xs[q] + f.rs[q];
          var t = f.ys[q] - f.rs[q];
          var b = f.ys[q] + f.rs[q];
          if (l < minx) minx = l;
          if (r > maxx) maxx = r;
          if (t < miny) miny = t;
          if (b > maxy) maxy = b;
        }
        if (!isFinite(minx)) return null;
        return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
      }

      var bb = bbox(fr);
      if (!bb) return false;
      var minDim = Math.min(W, H);
      var target = minDim * FRAME_FILL;
      var curMax = Math.max(1, bb.maxx - bb.minx, bb.maxy - bb.miny);
      var curFill = curMax / minDim;
      var k = target / curMax;
      var shrink = k < 0.995;
      // 明显偏小时也放大回目标（阈值 62%，避免 60~70% 区间内来回切换产生抖动）
      var enlarge = k > 1.002 && curFill < 0.62;
      if (!shrink && !enlarge) return false;

      // 用“切换前样式”的原子视觉半径求切换前的视觉包围盒中心——
      // 切换样式时保持这个屏幕中心不动（防抖动），而不是保持新样式的包围盒中心。
      function radiusForStyle(f, q, style) {
        var rw = atomRadiusWorldFor(atomCache[q], style);
        var rs = rw * scale * f.pf[q];
        if (style === 'wireframe') rs = Math.max(rs, 2.0);
        if (rs < 0.6) rs = 0.6;
        return rs;
      }
      var cx0 = null, cy0 = null;
      if (prevStyle && prevStyle !== opts.style) {
        var ominx = Infinity, ominy = Infinity, omaxx = -Infinity, omaxy = -Infinity;
        for (var q2 = 0; q2 < fr.n; q2++) {
          var r2 = radiusForStyle(fr, q2, prevStyle);
          if (fr.xs[q2] - r2 < ominx) ominx = fr.xs[q2] - r2;
          if (fr.xs[q2] + r2 > omaxx) omaxx = fr.xs[q2] + r2;
          if (fr.ys[q2] - r2 < ominy) ominy = fr.ys[q2] - r2;
          if (fr.ys[q2] + r2 > omaxy) omaxy = fr.ys[q2] + r2;
        }
        if (isFinite(ominx)) {
          cx0 = (ominx + omaxx) * 0.5;
          cy0 = (ominy + omaxy) * 0.5;
        }
      }
      if (cx0 === null) {
        cx0 = (bb.minx + bb.maxx) * 0.5;
        cy0 = (bb.miny + bb.maxy) * 0.5;
      }

      scale *= k;                       // 只改缩放：旋转矩阵不变
      var bb2 = bbox(buildFrame(false));
      if (!bb2) { invalidate(); return true; }
      // 补 pan：让分子视觉中心保持切换前的屏幕坐标
      panX += cx0 - (bb2.minx + bb2.maxx) * 0.5;
      panY += cy0 - (bb2.miny + bb2.maxy) * 0.5;
      invalidate();
      return true;
    }

    /* ---------- 每帧统一投影（缓存供 render / pick / project 复用） ---------- */
    // withDisplacements: true=使用振动位移（绘制/投影/pick/标签/键/测量引导全部生效）；
    // false=只用未位移原子（取景/样式自适应用，避免振动动画时画面抖动）。
    function buildFrame(withDisplacements) {
      var useDisp = (withDisplacements !== false) && !!displacements && displacements.length > 0;
      var n = (mol && mol.atoms) ? mol.atoms.length : 0;
      var fr = {
        n: n, W: W, H: H,
        xs: new Float64Array(n),
        ys: new Float64Array(n),
        zs: new Float64Array(n),
        pf: new Float64Array(n),
        rs: new Float64Array(n),
        visible: new Uint8Array(n),
        depthMin: 0,
        depthMax: 0
      };
      if (!n) return fr;
      syncAtoms();

      var halfW = W * 0.5, halfH = H * 0.5;
      var c0 = center[0], c1 = center[1], c2 = center[2];
      var r0 = rot[0], r1 = rot[1], r2 = rot[2];
      var r3 = rot[3], r4 = rot[4], r5 = rot[5];
      var r6 = rot[6], r7 = rot[7], r8 = rot[8];
      var s = scale;
      var d = camDist > 1e-6 ? camDist : 1e-6;
      var minZ = Infinity, maxZ = -Infinity;
      var i;

      for (i = 0; i < n; i++) {
        var a = mol.atoms[i];
        var ddx = 0, ddy = 0, ddz = 0;
        if (useDisp && i < displacements.length) {
          var dd = displacements[i];
          if (dd) { ddx = num(dd[0]); ddy = num(dd[1]); ddz = num(dd[2]); }
        }
        var ax = num(a && a.x) + ddx - c0;
        var ay = num(a && a.y) + ddy - c1;
        var az = num(a && a.z) + ddz - c2;
        var vx = r0 * ax + r1 * ay + r2 * az;
        var vy = r3 * ax + r4 * ay + r5 * az;
        var vz = r6 * ax + r7 * ay + r8 * az;
        var denom = d - vz;
        if (denom < d * 0.05) denom = d * 0.05;
        var pf = d / denom;
        var sx = halfW + panX + s * vx * pf;
        var sy = halfH + panY - s * vy * pf;
        var rw = atomRadiusWorld(atomCache[i]);
        var rs = rw * s * pf;
        if (opts.style === 'wireframe') rs = Math.max(rs, 2.2);
        if (rs < 0.6) rs = 0.6;
        fr.xs[i] = sx;
        fr.ys[i] = sy;
        fr.zs[i] = vz;
        fr.pf[i] = pf;
        fr.rs[i] = rs;
        fr.visible[i] = (sx + rs >= -1 && sx - rs <= W + 1 && sy + rs >= -1 && sy - rs <= H + 1) ? 1 : 0;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
      }
      fr.depthMin = minZ;
      fr.depthMax = maxZ;
      return fr;
    }

    function ensureFrame() {
      if (!frameValid || !frameCache) {
        if (W <= 0 || H <= 0) syncSize(false);
        frameCache = buildFrame();
        frameValid = true;
      } else if (frameCache.n !== ((mol && mol.atoms) ? mol.atoms.length : 0)) {
        frameCache = buildFrame();
        frameValid = true;
      }
      return frameCache;
    }

    /* ---------- 背景 / 清屏 ---------- */
    function paintBackground() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.clearRect(0, 0, W, H);
      if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, W, H);
      }
    }

    /* =================================================================
     * 绘制：原子 / 键
     * ================================================================= */
    function drawAtomText(c, x, y, r, atomIndex, alpha) {
      var showSym = !!opts.labels && r >= opts.labelMinScreenRadius;
      var showIdx = !!opts.indices && r >= Math.max(4, opts.labelMinScreenRadius * 0.45);
      if (!showSym && !showIdx) return;
      var a0 = ctx.globalAlpha;
      ctx.globalAlpha = Math.min(1, alpha + 0.35);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = c.labelColor;

      function fitFont(text, fs, maxW, weight) {
        ctx.font = weight + ' ' + fs.toFixed(1) + 'px ' + FONT_STACK;
        var wpx = ctx.measureText(text).width;
        if (wpx > maxW && wpx > 1e-6) {
          fs = Math.max(6, fs * (maxW / wpx));
          ctx.font = weight + ' ' + fs.toFixed(1) + 'px ' + FONT_STACK;
        }
        return fs;
      }

      if (showSym && showIdx) {
        var fs1 = fitFont(c.symbol, clamp(r * 0.60, 7, 30), r * 1.45, 700);
        ctx.fillText(c.symbol, x, y - fs1 * 0.42);
        var fs2 = fitFont(String(atomIndex + 1), clamp(r * 0.40, 7, 19), r * 1.05, 600);
        ctx.globalAlpha = Math.min(1, alpha + 0.2) * 0.9;
        ctx.fillText(String(atomIndex + 1), x, y + fs1 * 0.42 + fs2 * 0.15);
      } else if (showSym) {
        var fs = fitFont(c.symbol, clamp(r * 0.72, 8, 34), r * 1.55, 700);
        ctx.fillText(c.symbol, x, y + fs * 0.02);
      } else {
        var fidx = fitFont(String(atomIndex + 1), clamp(r * 0.72, 8, 26), r * 1.35, 600);
        ctx.fillText(String(atomIndex + 1), x, y + fidx * 0.02);
      }
      ctx.globalAlpha = a0;
    }

    // 背景色（雾化叠加用；transparent 时退回白色）
    function backgroundColor() {
      var b = opts.background;
      return (typeof b === 'string' && b && b !== 'transparent') ? b : '#ffffff';
    }

    function drawAtom(fr, i, fog) {
      var c = atomCache[i];
      if (!c) return;
      var x = fr.xs[i], y = fr.ys[i], r = fr.rs[i];
      if (r < 0.35) return;
      if (x + r < -2 || x - r > W + 2 || y + r < -2 || y - r > H + 2) return;

      ctx.globalAlpha = 1;

      // V-1：线框模式的原子画成与键同色的实心对比圆点（白底上 H 也清晰可见）
      if (opts.style === 'wireframe') {
        ctx.fillStyle = c.wireColor;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(r, 1.2), 0, TWO_PI);
        ctx.fill();
        return;
      }

      if (r < 3.2) {
        // 很小时用纯色点，避免无意义的渐变开销；线框样式用对比色（V-1）
        ctx.fillStyle = (opts.style === 'wireframe') ? c.wireColor : c.baseCss;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(r, 1.0), 0, TWO_PI);
        ctx.fill();
        return;
      }

      // 球体：左上高光的径向渐变 + 深色描边
      var g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.40, r * 0.03, x, y, r * 1.02);
      g.addColorStop(0, c.hi);
      g.addColorStop(0.30, c.hi2);
      g.addColorStop(0.62, c.mid);
      g.addColorStop(0.88, c.gBase);
      g.addColorStop(1, c.edge);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TWO_PI);
      ctx.fillStyle = g;
      ctx.fill();

      var strokeW = Math.max(0.7, Math.min(r * 0.055, 3.2));
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = c.stroke;
      ctx.stroke();

      // 高光小亮点（大球才画，增加“球感”）
      if (r > 12) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - r * 0.37, y - r * 0.45, Math.max(1, r * 0.075), 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      drawAtomText(c, x, y, r, i, 1);

      // 雾化：用背景色叠加而不是 globalAlpha，保证球体本身不透明——
      // 否则远处的标签/键会透过近处半透明球体“浮”出来（P2）。
      if (fog > 0.004) {
        ctx.globalAlpha = fog;
        ctx.fillStyle = backgroundColor();
        ctx.beginPath();
        ctx.arc(x, y, r + strokeW * 0.5, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 一条屏幕线段（可带虚线）；dashArr 为 [实, 虚] 像素数组或 null
    function strokeScreenLine(x0, y0, x1, y1, width, color, dashArr) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dashArr || []);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // 键半段的可见线段（半段参数 s: 0=原子中心, 1=键中点），
    // 已按两端原子球半径裁剪，避免键“穿进”球体内部看到条纹。
    function bondHalfLine(g, l, half, extraOff) {
      var off = l.off + extraOff;
      var L = g.halfLen;
      var s0 = half === 0 ? l.s0 : l.t0;
      var s1 = half === 0 ? l.s1 : l.t1;
      var ax, ay, bx, by;
      if (half === 0) {
        ax = g.xi + g.ux * (L * s0) + g.px * off;
        ay = g.yi + g.uy * (L * s0) + g.py * off;
        bx = g.xi + g.ux * (L * s1) + g.px * off;
        by = g.yi + g.uy * (L * s1) + g.py * off;
      } else {
        ax = g.xj - g.ux * (L * s0) + g.px * off;
        ay = g.yj - g.uy * (L * s0) + g.py * off;
        bx = g.xj - g.ux * (L * s1) + g.px * off;
        by = g.yj - g.uy * (L * s1) + g.py * off;
      }
      return [ax, ay, bx, by];
    }

    // 键的半段：描边 -> 圆柱基色 -> 高光条（三遍绘制模拟圆柱光照）；
    // 多重键的 side line 更细（P4）。fog>0 时最后用背景色叠加做雾化。
    function strokeBondHalf(g, half, fog) {
      var lines = g.lines;
      var edge = half === 0 ? g.edgeI : g.edgeJ;
      var shade = half === 0 ? g.shadeI : g.shadeJ;
      var light = half === 0 ? g.lightI : g.lightJ;
      var j, l, seg;
      var pass;

      ctx.globalAlpha = 1;
      for (pass = 0; pass < 3; pass++) {
        for (j = 0; j < lines.length; j++) {
          l = lines[j];
          if (half === 0) {
            if (l.s1 - l.s0 < 1e-4) continue;
          } else {
            if (l.t1 - l.t0 < 1e-4) continue;
          }
          if (pass === 0) {
            if (!(l.outline > 0)) continue;
            seg = bondHalfLine(g, l, half, 0);
            strokeScreenLine(seg[0], seg[1], seg[2], seg[3], l.outline, edge, l.dash);
          } else if (pass === 1) {
            seg = bondHalfLine(g, l, half, 0);
            strokeScreenLine(seg[0], seg[1], seg[2], seg[3], l.width, shade, l.dash);
          } else {
            if (!(l.highlight > 0)) continue;
            seg = bondHalfLine(g, l, half, g.highlightOff * (l.factor || 1));
            strokeScreenLine(seg[0], seg[1], seg[2], seg[3], l.highlight, light, l.dash);
          }
        }
      }
      ctx.setLineDash([]);

      // 雾化叠加（不透明球/键，避免远处物体透出来）
      if (fog > 0.004) {
        ctx.globalAlpha = fog;
        for (j = 0; j < lines.length; j++) {
          l = lines[j];
          if (half === 0) {
            if (l.s1 - l.s0 < 1e-4) continue;
          } else {
            if (l.t1 - l.t0 < 1e-4) continue;
          }
          seg = bondHalfLine(g, l, half, 0);
          strokeScreenLine(seg[0], seg[1], seg[2], seg[3],
            Math.max(l.outline || 0, l.width) + 0.8, backgroundColor(), null);
        }
        ctx.globalAlpha = 1;
      }
    }

    function buildBondGeometry(fr, bond) {
      var i = bond.i, j = bond.j;
      var xi = fr.xs[i], yi = fr.ys[i], xj = fr.xs[j], yj = fr.ys[j];
      var dx = xj - xi, dy = yj - yi;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.6) return null;
      var ux = dx / len, uy = dy / len;
      var px = -uy, py = ux;                 // 屏幕垂直单位向量
      var pfMid = (fr.pf[i] + fr.pf[j]) * 0.5;
      var style = opts.style;
      var order = bond.order;
      var nLines = order === 3 ? 3 : ((order === 2 || order === 4) ? 2 : 1);
      var baseWpx = 0;
      var lineW = 1.0;
      var step = 0;
      var outlineWidth = 0;
      var highlightWidth = 0;

      if (style === 'wireframe') {
        lineW = Math.max(1.15, 1.25 * opts.bondWidth);
        step = nLines > 1 ? 2.8 : 0;
        outlineWidth = 0;
      } else {
        baseWpx = bondDiameterWorld() * scale * pfMid * opts.bondWidth;
        if (style === 'stick') baseWpx = clamp(baseWpx, 1.2, 80);
        else baseWpx = clamp(baseWpx, 0.9, 46);
        if (nLines === 1) {
          lineW = baseWpx;
          outlineWidth = lineW >= 1.6 ? lineW + Math.max(2.0, lineW * 0.30) : 0;
        } else if (style === 'stick') {
          // 棍状：多重键 = 并排细圆柱，总宽与单键接近
          lineW = Math.max(1.0, baseWpx / nLines);
          step = lineW * 1.12;
          outlineWidth = lineW + 1.4;
        } else {
          // 球棍：多重键 = 分离的平行细线，线与线之间留出背景缝隙
          lineW = Math.max(1.0, baseWpx * (nLines === 2 ? 0.50 : 0.38));
          outlineWidth = lineW + Math.max(1.6, lineW * 0.22);
          step = outlineWidth + Math.max(2.2, lineW * 0.30);
        }
        // 圆柱高光条（太细时省略）
        highlightWidth = lineW >= 3.2 ? Math.max(1.0, lineW * 0.28) : 0;
      }

      // 高光条整体向“左上方”偏移（模拟单一光源）
      var hsign;
      if (py < -1e-6) hsign = 1;
      else if (py > 1e-6) hsign = -1;
      else hsign = (px < 0) ? 1 : -1;
      var highlightOff = hsign * lineW * 0.26;

      var offs;
      if (nLines === 1) offs = [0];
      else if (nLines === 2) offs = [-0.5 * step, 0.5 * step];
      else offs = [-step, 0, step];

      // 裁掉落在两端原子球内部的线段，避免键“穿进”球体表面形成条纹。
      // 半段参数 s（0=该端原子中心，1=键中点）：到该端球心距离 = sqrt((halfLen*s)^2+off^2)，
      // 到另一端球心距离 = sqrt((len*(1-s/2))^2+off^2)。
      var halfLen = len * 0.5;
      var rI = fr.rs[i], rJ = fr.rs[j];
      // 多重键：主键保持原宽度，side line 更细（P4）
      var factors;
      if (nLines === 1) factors = [1];
      else if (nLines === 2) factors = [1, 0.72];
      else factors = [0.68, 1, 0.68];
      var outlinePad = Math.max(0, outlineWidth - lineW);
      var lines = [];
      for (var li = 0; li < offs.length; li++) {
        var off = offs[li];
        var trimI = Math.sqrt(Math.max(0, rI * rI - off * off));
        var trimJ = Math.sqrt(Math.max(0, rJ * rJ - off * off));
        var s0 = clamp(trimI / halfLen, 0, 1);
        var s1 = clamp(2 * (1 - trimJ / len), 0, 1);
        var t0 = clamp(trimJ / halfLen, 0, 1);
        var t1 = clamp(2 * (1 - trimI / len), 0, 1);
        if (style === 'wireframe') { s0 = 0; s1 = 1; t0 = 0; t1 = 1; }
        var f = factors[li];
        var lw = lineW * f;
        lines.push({
          off: off,
          factor: f,
          width: lw,
          outline: outlineWidth > 0 ? lw + outlinePad : 0,
          highlight: highlightWidth > 0 ? Math.max(1.0, highlightWidth * f) : 0,
          dash: null,
          s0: s0, s1: s1, t0: t0, t1: t1
        });
      }

      var ci = atomCache[i], cj = atomCache[j];
      var shadeI, shadeJ, lightI, lightJ, edgeI, edgeJ;
      if (style === 'wireframe') {
        // V-1：白底下必须可辨识，统一用加深后的元素色（H 用深灰蓝）
        shadeI = ci ? ci.wireColor : '#4a5568';
        shadeJ = cj ? cj.wireColor : '#4a5568';
        lightI = shadeI; lightJ = shadeJ;
        edgeI = shadeI; edgeJ = shadeJ;
      } else {
        shadeI = ci ? ci.bondShade : '#777777';
        shadeJ = cj ? cj.bondShade : '#777777';
        lightI = ci ? ci.bondLight : '#bbbbbb';
        lightJ = cj ? cj.bondLight : '#bbbbbb';
        edgeI = ci ? ci.bondEdge : '#555555';
        edgeJ = cj ? cj.bondEdge : '#555555';
      }
      return {
        i: i, j: j, order: order,
        xi: xi, yi: yi, xj: xj, yj: yj,
        ux: ux, uy: uy, halfLen: halfLen,
        px: px, py: py,
        lines: lines,
        outlineWidth: outlineWidth,
        highlightWidth: highlightWidth,
        highlightOff: highlightOff,
        shadeI: shadeI, shadeJ: shadeJ,
        lightI: lightI, lightJ: lightJ,
        edgeI: edgeI, edgeJ: edgeJ
      };
    }

    function drawScene(fr) {
      var n = fr.n;
      var bonds = (mol && Array.isArray(mol.bonds)) ? mol.bonds : [];
      var items = [];
      var i, b;
      var span = fr.depthMax - fr.depthMin;

      // 轻微雾化：返回 0..0.16 的“背景色叠加量”。
      // 不能用 globalAlpha 降低不透明度，否则远处标签/键会透过近处球体浮出来（P2）。
      function fogAmount(z) {
        if (!(span > 1e-6)) return 0;
        var farness = clamp((fr.depthMax - z) / span, 0, 1);
        return farness * 0.16;
      }

      for (i = 0; i < n; i++) {
        items.push({ kind: 1, i: i, z: fr.zs[i], fog: fogAmount(fr.zs[i]) });
      }

      if (opts.style !== 'spacefill') {
        for (var bi = 0; bi < bonds.length; bi++) {
          var bd = bonds[bi];
          if (!bd || typeof bd !== 'object') continue;
          var ii = Math.floor(num(bd.i));
          var jj = Math.floor(num(bd.j));
          if (!isFinite(ii) || !isFinite(jj) || ii === jj) continue;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          if (!fr.visible[ii] && !fr.visible[jj]) continue;
          var ord = Math.floor(num(bd.order));
          if (ord !== 2 && ord !== 3 && ord !== 4) ord = 1;
          var geom = buildBondGeometry(fr, { i: ii, j: jj, order: ord });
          if (!geom) continue;
          var zi = fr.zs[ii], zj = fr.zs[jj];
          var avgZ = (zi + zj) * 0.5;
          var fog = fogAmount(avgZ);
          items.push({ kind: 0, half: 0, geom: geom, z: (3 * zi + zj) * 0.25, fog: fog });
          items.push({ kind: 0, half: 1, geom: geom, z: (zi + 3 * zj) * 0.25, fog: fog });
        }
      }

      // 画家算法：z 小的（远）先画；同一深度先画键、后画原子（原子覆盖背后键）
      items.sort(function (p, q) {
        if (p.z !== q.z) return p.z - q.z;
        return p.kind - q.kind;
      });

      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      for (var it = 0; it < items.length; it++) {
        var item = items[it];
        if (item.kind === 1) {
          drawAtom(fr, item.i, item.fog);
        } else {
          strokeBondHalf(item.geom, item.half, item.fog);
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    /* =================================================================
     * 绘制：悬停 / 选中 / 测量 / 坐标轴
     * ================================================================= */
    function drawHover(fr) {
      if (!(hover >= 0) || hover >= fr.n) return;
      var x = fr.xs[hover], y = fr.ys[hover], r = Math.max(fr.rs[hover], 4);
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = opts.hoverColor;
      ctx.lineWidth = Math.max(6, r * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r + 3.0, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.4, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }

    function drawSelection(fr) {
      var i, idx, x, y, r;
      var sel = selection;
      var n = fr.n;
      if (!sel.length) return;

      // 1) 清晰的双层橙色高亮环（全部环在徽标之下；P3）
      var selDark = rgbCss(darken(parseColor(opts.selectionColor), 0.32));
      ctx.save();
      for (i = 0; i < sel.length; i++) {
        idx = sel[i];
        if (idx < 0 || idx >= n) continue;
        x = fr.xs[idx]; y = fr.ys[idx]; r = Math.max(fr.rs[idx], 3);
        // 极淡外发光
        ctx.strokeStyle = opts.selectionColor;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = Math.max(7, r * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, r + 6.0, 0, TWO_PI);
        ctx.stroke();
        // 深橙外圈 1px（白色/浅色球上也清晰）
        ctx.globalAlpha = 1;
        ctx.strokeStyle = selDark;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r + 5.0, 0, TWO_PI);
        ctx.stroke();
        // 亮橙主环 2.6px（不透明）
        ctx.strokeStyle = opts.selectionColor;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.9, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();

      // 2) 顶部序号徽标（永远最上层）
      ctx.save();
      for (i = 0; i < sel.length; i++) {
        idx = sel[i];
        if (idx < 0 || idx >= n) continue;
        x = fr.xs[idx]; y = fr.ys[idx]; r = Math.max(fr.rs[idx], 3);
        var br = clamp(r * 0.34, 9, 13);
        var bx = x;
        var by = y - r - br - 7;
        if (by < br + 1) by = y + r + br + 7;   // 顶部出界时挪到下方
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'rgba(0,0,0,0.28)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = opts.selectionColor;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, TWO_PI);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, br - 0.6, 0, TWO_PI);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 ' + (br * 1.28).toFixed(1) + 'px ' + FONT_STACK;
        ctx.fillText(String(i + 1), bx, by + br * 0.06);
      }
      ctx.restore();
    }

    function measurementAtoms() {
      if (!measurement || !measurement.atoms) return null;
      var n = (mol && mol.atoms) ? mol.atoms.length : 0;
      var arr = [];
      for (var i = 0; i < measurement.atoms.length; i++) {
        var idx = Math.floor(num(measurement.atoms[i]));
        if (!isFinite(idx) || idx < 0 || idx >= n) return null;
        arr.push(idx);
      }
      return arr.length >= 2 ? arr : null;
    }

    function angleOf(cx, cy, ax, ay, bx, by) {
      var a1 = Math.atan2(ay - cy, ax - cx);
      var a2 = Math.atan2(by - cy, bx - cx);
      var d = a2 - a1;
      while (d > Math.PI) d -= TWO_PI;
      while (d < -Math.PI) d += TWO_PI;
      return { start: a1, delta: d };
    }

    function drawMeasurementArc(fr, vIdx, aIdx, bIdx, radius) {
      var vx = fr.xs[vIdx], vy = fr.ys[vIdx];
      var ang = angleOf(vx, vy, fr.xs[aIdx], fr.ys[aIdx], fr.xs[bIdx], fr.ys[bIdx]);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(vx, vy, radius, ang.start, ang.start + ang.delta, ang.delta < 0);
      ctx.stroke();
    }

    function drawMeasurement(fr) {
      var arr = measurementAtoms();
      if (!arr) return;
      var color = opts.measurementColor;
      var pts = [];
      var i;
      for (i = 0; i < arr.length; i++) pts.push({ x: fr.xs[arr[i]], y: fr.ys[arr[i]] });

      // 引导线段（距离/键角/二面角）
      var segs = [];
      if (pts.length >= 2) {
        segs.push([pts[0], pts[1]]);
        if (pts.length >= 3) segs.push([pts[1], pts[2]]);
        if (pts.length >= 4) segs.push([pts[2], pts[3]]);
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 白色衬底，保证在深色球体上也可见
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 4.2;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      for (i = 0; i < segs.length; i++) {
        ctx.beginPath();
        ctx.moveTo(segs[i][0].x, segs[i][0].y);
        ctx.lineTo(segs[i][1].x, segs[i][1].y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 5]);
      for (i = 0; i < segs.length; i++) {
        ctx.beginPath();
        ctx.moveTo(segs[i][0].x, segs[i][0].y);
        ctx.lineTo(segs[i][1].x, segs[i][1].y);
        ctx.stroke();
      }

      // 顶点圆弧
      ctx.setLineDash([]);
      ctx.lineWidth = 1.8;
      if (pts.length === 3) {
        var r1 = clamp(Math.min(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)) * 0.34, 14, 46);
        drawMeasurementArc(fr, arr[1], arr[0], arr[2], r1);
      } else if (pts.length === 4) {
        var r2 = clamp(Math.min(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)) * 0.30, 12, 40);
        var r3 = clamp(Math.min(Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y),
          Math.hypot(pts[3].x - pts[2].x, pts[3].y - pts[2].y)) * 0.30, 12, 40);
        drawMeasurementArc(fr, arr[1], arr[0], arr[2], r2);
        drawMeasurementArc(fr, arr[2], arr[1], arr[3], r3);
      }

      // 参与测量的原子小圆点
      for (i = 0; i < pts.length; i++) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawAxes() {
      if (W < 90 || H < 90) return;
      var ox = 58, oy = H - 58;
      if (W < 280 || H < 220) { ox = 34; oy = H - 34; }
      var arm = 30;
      var AX = [
        { v: [rot[0], rot[3], rot[6]], color: '#e05545', label: 'X' },
        { v: [rot[1], rot[4], rot[7]], color: '#3f9e5f', label: 'Y' },
        { v: [rot[2], rot[5], rot[8]], color: '#3a6fd8', label: 'Z' }
      ];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 白色衬底圆，避免与分子/文字糊在一起
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ox, oy, arm + 18, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      var placedLabels = [];

      // 先画指向观察者反方向的轴（远的先画）
      var order = [0, 1, 2];
      order.sort(function (a, b) { return AX[a].v[2] - AX[b].v[2]; });
      var q;
      for (q = 0; q < order.length; q++) {
        var ax = AX[order[q]];
        var vx = ax.v[0], vy = ax.v[1];
        var vlen = Math.sqrt(vx * vx + vy * vy);
        var labelX, labelY;
        if (vlen < 0.12) {
          // 轴几乎正对/背对观察者：画成圆点，标签放到斜上方
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = ax.color;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(ox, oy, 5, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          labelX = ox + 13;
          labelY = oy - 13;
        } else {
          var ux = vx / vlen, uy = -vy / vlen;   // 屏幕坐标 y 向下
          var seg = arm * clamp(vlen, 0.45, 1);
          var ex = ox + ux * seg;
          var ey = oy + uy * seg;
          // 白色光晕衬底让重叠的轴也能分辨
          ctx.globalAlpha = 0.92;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = 5.4;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = ax.color;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = ax.color;
          ctx.beginPath();
          ctx.arc(ex, ey, 3.0, 0, TWO_PI);
          ctx.fill();
          labelX = ox + ux * (seg + 11);
          labelY = oy + uy * (seg + 11);
        }
        // 标签：白色圆底 + 彩色字母；与已放置标签重叠时向外推开
        var tries = 0;
        while (tries < 4) {
          var collide = false;
          for (var pc = 0; pc < placedLabels.length; pc++) {
            var pdx = labelX - placedLabels[pc].x;
            var pdy = labelY - placedLabels[pc].y;
            var pd = Math.sqrt(pdx * pdx + pdy * pdy);
            if (pd < 18) {
              if (pd < 0.5) { pdx = 1; pdy = 0; pd = 1; }
              labelX = placedLabels[pc].x + (pdx / pd) * 18;
              labelY = placedLabels[pc].y + (pdy / pd) * 18;
              collide = true;
            }
          }
          tries++;
          if (!collide) break;
        }
        placedLabels.push({ x: labelX, y: labelY });
        ctx.globalAlpha = 0.94;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(labelX, labelY, 8, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ax.color;
        ctx.font = '700 11px ' + FONT_STACK;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ax.label, labelX, labelY + 0.5);
      }

      ctx.fillStyle = '#8a949e';
      ctx.beginPath();
      ctx.arc(ox, oy, 2.2, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    /* =================================================================
     * 绘制主流程
     * ================================================================= */
    function callOnRender() {
      var cb = view.onRender;
      if (typeof cb === 'function') {
        try {
          cb(view);
        } catch (err) {
          if (root.console && root.console.warn) {
            root.console.warn('[MolRender] onRender 回调异常：', err);
          }
        }
      }
    }

    function render() {
      if (disposed) return;
      // 若已有排队的 rAF，取消之，避免同一帧重复绘制
      if (rafId) {
        cancelFrame(rafId);
        rafId = 0;
      }
      syncSize(false);
      if (!(W > 0) || !(H > 0)) {
        callOnRender();
        return;
      }
      if (needsAutoFrame) {
        needsAutoFrame = false;
        frameAllInternal();
      }

      paintBackground();

      var fr = buildFrame();
      frameCache = fr;
      frameValid = true;

      if (mol && fr.n > 0) {
        ctx.save();
        drawScene(fr);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);

        drawMeasurement(fr);
        drawHover(fr);
        drawSelection(fr);
      }

      if (opts.showAxes) drawAxes();

      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      callOnRender();
    }

    /* =================================================================
     * rAF 调度
     * ================================================================= */
    function requestFrame(cb) {
      if (typeof root.requestAnimationFrame === 'function') return root.requestAnimationFrame(cb);
      return root.setTimeout(function () { cb(Date.now()); }, 16);
    }
    function cancelFrame(id) {
      if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(id);
      else root.clearTimeout(id);
    }

    function requestRender() {
      if (disposed) return;
      invalidate();
      if (rafId) return;
      rafId = requestFrame(function () {
        rafId = 0;
        render();
      });
    }

    /* =================================================================
     * 公共 API
     * ================================================================= */
    function setMolecule(next) {
      mol = (next && typeof next === 'object' && Array.isArray(next.atoms)) ? next : null;
      atomCache = [];
      cacheMol = null;
      cacheLen = -1;
      cacheTable = null;
      hover = -1;
      measurement = null;
      displacements = null;      // INTERFACE2 §5：换分子自动清空振动位移
      if (mol) {
        syncAtoms();
        needsAutoFrame = !(W > 0 && H > 0);
        frameAllInternal();
        // 选择索引可能因删除原子而失效，保留有效部分
        var n = mol.atoms.length;
        var kept = [];
        for (var i = 0; i < selection.length; i++) {
          if (selection[i] >= 0 && selection[i] < n) kept.push(selection[i]);
        }
        selection = kept;
      } else {
        selection = [];
      }
      invalidate();
      requestRender();
    }

    function setOptions(partial) {
      if (!partial || typeof partial !== 'object') return;
      var changed = false;
      var styleBefore = opts.style;
      for (var key in DEFAULT_OPTIONS) {
        if (!has(DEFAULT_OPTIONS, key)) continue;
        if (!has(partial, key)) continue;
        if (applyOption(key, partial[key])) changed = true;
      }
      if (changed) {
        if (opts.style !== styleBefore) fitViewOnStyleChange(styleBefore);
        invalidate();
        requestRender();
      }
    }

    function setOption(key, value) {
      if (!has(DEFAULT_OPTIONS, key)) return;
      var styleBefore = opts.style;
      if (applyOption(key, value)) {
        if (opts.style !== styleBefore) fitViewOnStyleChange(styleBefore);
        invalidate();
        requestRender();
      }
    }

    function getOptions() {
      var o = {};
      for (var key in opts) {
        if (has(opts, key)) o[key] = opts[key];
      }
      return o;
    }

    function setSelection(indices) {
      var n = (mol && mol.atoms) ? mol.atoms.length : 0;
      var out = [];
      if (Array.isArray(indices)) {
        for (var i = 0; i < indices.length; i++) {
          var idx = Math.floor(num(indices[i]));
          if (!isFinite(idx) || idx < 0 || idx >= n) continue;
          if (out.indexOf(idx) < 0) out.push(idx);
        }
      }
      selection = out;
      requestRender();
    }

    function setHover(index) {
      var n = (mol && mol.atoms) ? mol.atoms.length : 0;
      var idx = (index === null || index === undefined) ? -1 : Math.floor(num(index));
      if (!isFinite(idx) || idx < 0 || idx >= n) idx = -1;
      if (idx === hover) return;
      hover = idx;
      requestRender();
    }

    function setMeasurement(m) {
      if (!m || typeof m !== 'object' || !Array.isArray(m.atoms)) {
        measurement = null;
        requestRender();
        return;
      }
      var n = (mol && mol.atoms) ? mol.atoms.length : 0;
      var atoms = [];
      for (var i = 0; i < m.atoms.length; i++) {
        var idx = Math.floor(num(m.atoms[i]));
        if (!isFinite(idx) || idx < 0 || idx >= n) continue;
        atoms.push(idx);
      }
      var type = m.type;
      if (type !== 'distance' && type !== 'angle' && type !== 'dihedral') type = null;
      if (!type) {
        if (atoms.length === 2) type = 'distance';
        else if (atoms.length === 3) type = 'angle';
        else if (atoms.length >= 4) type = 'dihedral';
      }
      var need = type === 'distance' ? 2 : (type === 'angle' ? 3 : 4);
      if (!type || atoms.length < need) {
        measurement = null;
      } else {
        measurement = { atoms: atoms.slice(0, need), type: type };
      }
      requestRender();
    }

    function resize() {
      if (disposed) return;
      syncSize(true);
      fitViewOnStyleChange();
      render();
    }

    /* ---------- v2 振动位移（INTERFACE2 §5） ---------- */
    // 输入 displacements[i] = [dx,dy,dz]（Å，世界坐标）；长度可小于原子数（缺省 0）。
    // 只用于投影/绘制，绝不修改 molecule。null 表示清除。
    function cloneDisplacements(src) {
      if (!Array.isArray(src)) return null;
      var out = new Array(src.length);
      for (var i = 0; i < src.length; i++) {
        var v = src[i];
        if (v && typeof v === 'object') {
          out[i] = [num(v[0]), num(v[1]), num(v[2])];
        } else {
          out[i] = [0, 0, 0];
        }
      }
      return out;
    }

    function setDisplacements(next) {
      if (disposed) return;
      displacements = (next === null || next === undefined) ? null : cloneDisplacements(next);
      if (displacements && displacements.length === 0) displacements = null;
      invalidate();
      requestRender();
    }

    function getDisplacements() {
      if (!displacements) return null;
      var out = new Array(displacements.length);
      for (var i = 0; i < displacements.length; i++) {
        var v = displacements[i] || [0, 0, 0];
        out[i] = [num(v[0]), num(v[1]), num(v[2])];
      }
      return out;
    }

    function frameAll() {
      frameAllInternal();
      invalidate();
      requestRender();
    }

    function resetCamera() {
      rot = matIdentity();
      panX = 0;
      panY = 0;
      frameAllInternal();
      invalidate();
      requestRender();
    }

    function rotate(dxPx, dyPx) {
      var dx = num(dxPx), dy = num(dyPx);
      if (!dx && !dy) return;
      var k = ROTATE_DEG_PER_PX * Math.PI / 180;
      // 水平拖动 -> 绕屏幕竖直轴；垂直拖动 -> 绕屏幕水平轴（右手系，自然跟手）
      var ry = dx * k;
      var rx = dy * k;
      rot = matMul(matRotY(ry), matMul(matRotX(rx), rot));
      rot = matOrthonormalize(rot);
      invalidate();
      requestRender();
    }

    function pan(dxPx, dyPx) {
      var dx = num(dxPx), dy = num(dyPx);
      if (!dx && !dy) return;
      panX += dx;
      panY += dy;
      invalidate();
      requestRender();
    }

    function zoom(factor) {
      var f = num(factor);
      if (!isFinite(f) || f <= 0) return;
      scale = clamp(scale * f, 1e-4, 1e6);
      invalidate();
      requestRender();
    }

    function pick(cssX, cssY) {
      var fr = ensureFrame();
      if (!fr.n || !mol) return null;
      var x = num(cssX), y = num(cssY);
      var best = -1;
      var bestDepth = -Infinity;
      var bestD2 = Infinity;
      for (var i = 0; i < fr.n; i++) {
        var r = Math.max(fr.rs[i], 5);
        var dx = x - fr.xs[i];
        var dy = y - fr.ys[i];
        var d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        var z = fr.zs[i];
        if (z > bestDepth + 1e-6 || (Math.abs(z - bestDepth) <= 1e-6 && d2 < bestD2)) {
          best = i;
          bestDepth = z;
          bestD2 = d2;
        }
      }
      return best >= 0 ? best : null;
    }

    function project(atomIndex) {
      var fr = ensureFrame();
      var idx = Math.floor(num(atomIndex));
      if (!isFinite(idx) || idx < 0 || idx >= fr.n) {
        return { x: 0, y: 0, depth: 0, visible: false };
      }
      var px = fr.xs[idx], py = fr.ys[idx];
      return {
        x: px,
        y: py,
        depth: fr.zs[idx],
        visible: px >= 0 && px <= W && py >= 0 && py <= H
      };
    }

    function projectAll() {
      var fr = ensureFrame();
      var out = new Array(fr.n);
      for (var i = 0; i < fr.n; i++) {
        var px = fr.xs[i], py = fr.ys[i];
        out[i] = {
          x: px,
          y: py,
          depth: fr.zs[i],
          visible: px >= 0 && px <= W && py >= 0 && py <= H
        };
      }
      return out;
    }

    function screenRadius(atomIndex) {
      var fr = ensureFrame();
      var idx = Math.floor(num(atomIndex));
      if (!isFinite(idx) || idx < 0 || idx >= fr.n) return 0;
      return fr.rs[idx];
    }

    function screenDeltaToWorld(dxPx, dyPx, atomIndex) {
      var pf = 1;
      var fr = null;
      if (atomIndex !== undefined && atomIndex !== null) {
        fr = ensureFrame();
        var idx = Math.floor(num(atomIndex));
        if (isFinite(idx) && idx >= 0 && idx < fr.n) pf = fr.pf[idx];
      }
      var s = scale * pf;
      if (!isFinite(s) || Math.abs(s) < 1e-9) s = 1e-6;
      var vx = num(dxPx) / s;
      var vy = -num(dyPx) / s;
      // 视图空间增量 -> 世界空间（R^T 作用于 (vx, vy, 0)）
      return [
        rot[0] * vx + rot[3] * vy,
        rot[1] * vx + rot[4] * vy,
        rot[2] * vx + rot[5] * vy
      ];
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) {
        cancelFrame(rafId);
        rafId = 0;
      }
      mol = null;
      atomCache = [];
      cacheMol = null;
      cacheLen = -1;
      cacheTable = null;
      selection = [];
      hover = -1;
      measurement = null;
      displacements = null;
      frameCache = null;
      frameValid = false;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
      } catch (err) { /* 忽略 */ }
      ctx = null;
    }

    /* ---------- 组装 view 对象 ---------- */
    var view = {
      canvas: canvas,
      version: VERSION,
      onRender: null,
      setMolecule: setMolecule,
      setOptions: setOptions,
      setOption: setOption,
      getOptions: getOptions,
      setSelection: setSelection,
      setHover: setHover,
      setMeasurement: setMeasurement,
      // v2：振动位移（INTERFACE2 §5）
      setDisplacements: setDisplacements,
      getDisplacements: getDisplacements,
      resize: resize,
      render: render,
      requestRender: requestRender,
      frameAll: frameAll,
      resetCamera: resetCamera,
      rotate: rotate,
      pan: pan,
      zoom: zoom,
      pick: pick,
      project: project,
      projectAll: projectAll,
      screenRadius: screenRadius,
      screenDeltaToWorld: screenDeltaToWorld,
      dispose: dispose
    };

    // 应用 createView 的初始选项（不触发调度，随后统一首绘）
    if (userOptions && typeof userOptions === 'object') {
      for (k in DEFAULT_OPTIONS) {
        if (!has(DEFAULT_OPTIONS, k)) continue;
        if (has(userOptions, k)) applyOption(k, userOptions[k]);
      }
    }

    syncSize(true);
    invalidate();
    render();
    return view;
  }

  /* =====================================================================
   * 挂载全局对象
   * ===================================================================== */
  var MolRender = (root.MolRender = root.MolRender || {});
  MolRender.version = VERSION;
  MolRender.styles = STYLE_LIST.slice();
  MolRender.defaultOptions = (function () {
    var o = {};
    for (var key in DEFAULT_OPTIONS) if (has(DEFAULT_OPTIONS, key)) o[key] = DEFAULT_OPTIONS[key];
    return o;
  })();
  MolRender.fallbackElements = FALLBACK_ELEMENTS;
  MolRender.createView = createView;

  // 便于 Node 冒烟测试（浏览器中 module 不存在，不产生影响）
  if (typeof module === 'object' && module && module.exports) module.exports = MolRender;

})(typeof globalThis !== 'undefined' ? globalThis : this);
