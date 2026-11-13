/* ============================================================================
 * MolEdit v2 — js/charts.js
 * 零依赖 Canvas 2D 折线图（计算结果面板内部使用），挂载 globalThis.MolCharts。
 * 经典脚本，无 ESM / 无第三方库 / 不注册全局事件。
 *
 * 设计目标（INTERFACE2.md §6.2）：
 *   - 多序列折线、线性轴与 log10 轴、阈值水平虚线、坐标轴/刻度/标签/图例；
 *   - devicePixelRatio 适配（高分屏不模糊），尺寸变化后调用方重新 draw 即可；
 *   - 颜色固定值（不依赖 CSS 变量，Canvas 内无法使用 var()）；
 *   - 所有文本由调用方传入已本地化的字符串。
 *
 * API：
 *   MolCharts.version                            -> '1.0.0'
 *   MolCharts.colors                             -> 固定色板
 *   MolCharts.drawLineChart(canvas, config)      -> info object
 *   MolCharts.draw(canvas, config)               -> 同 drawLineChart
 *   MolCharts.formatScientific(value)            -> '1e-4' / '4.5e-4' / '0.01'
 *
 * config = {
 *   title: 'Energy profile',
 *   xLabel: 'Step', yLabel: 'ΔE (kcal/mol)',
 *   yScale: 'linear' | 'log10',        // log10：y 取 log10(y)，y<=0 的点被跳过
 *   series: [{
 *     name: 'ΔE',                       // 图例名（空串不画图例）
 *     points: [{ x: 1, y: 0.5 }, ...],  // y 可为 null（跳过该点）
 *     color: '#2563eb', lineWidth: 1.8, dash: null,
 *     marker: 'circle' | 'none'
 *   }],
 *   thresholds: [{ value: 0.00045, color: '#d94f3d', dash: [5, 4], lineWidth: 1.1 }],
 *   xMin/xMax/yMin/yMax,                // 可省略（自动取范围）
 *   xTickFormat: function(v){...}, yTickFormat: function(v){...},
 *   pointLabels: false | true | function(seriesCfg, point){ return 'text'|null },
 *   legend: true,
 *   emptyText: 'No data',
 *   padding: { top, right, bottom, left },
 *   background, plotBackground, axisColor, gridColor, textColor, titleColor
 * }
 * ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var LN10 = Math.LN10;

  var COLORS = {
    blue: '#2563eb',
    red: '#d94f3d',
    orange: '#e08a1e',
    teal: '#0f9c9c',
    green: '#2f9e44',
    purple: '#7c3aed',
    gray: '#8a96a8',
    navy: '#334e7a'
  };
  var SERIES_PALETTE = [COLORS.blue, COLORS.red, COLORS.teal, COLORS.orange, COLORS.purple, COLORS.green, COLORS.gray];

  var DEFAULTS = {
    title: '',
    xLabel: '',
    yLabel: '',
    yScale: 'linear',
    series: null,
    thresholds: null,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    xTickFormat: null,
    yTickFormat: null,
    pointLabels: false,
    legend: true,
    emptyText: '',
    padding: { top: 10, right: 16, bottom: 36, left: 60 },
    background: '#ffffff',
    plotBackground: '#fbfcfe',
    axisColor: '#b3bfcf',
    gridColor: '#e7ecf3',
    textColor: '#556277',
    titleColor: '#1e2733',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
    titleFont: '600 11px ',
    labelFont: '10px ',
    tickFont: '10px '
  };

  /* ------------------------------- 工具函数 ------------------------------- */

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function trimNum(str) {
    var s = String(str);
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) return s;
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  /** 把 1e-4 / 0.01 / 12.3 这类值格式化成紧凑文本（用于对数轴刻度） */
  function formatScientific(v) {
    if (!isNum(v)) return '—';
    if (v === 0) return '0';
    var av = Math.abs(v);
    if (av >= 0.001 && av < 10000) {
      return trimNum(v.toPrecision(3));
    }
    var s = v.toExponential(1).replace(/e\+/, 'e');
    // 10 的整数次幂显示成 1e-4 而不是 1.0e-4
    s = s.replace(/^(-?1)\.0e/, '$1e');
    return s;
  }

  function fmtTickDefault(v) {
    if (!isNum(v)) return '—';
    var av = Math.abs(v);
    if (av === 0) return '0';
    if (av >= 1000 || av < 0.001) return formatScientific(v);
    return trimNum(v.toPrecision(4));
  }

  function niceStep(span, target) {
    if (!(span > 0) || !isFinite(span)) span = 1;
    target = target || 5;
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / LN10));
    var norm = raw / mag;
    var nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
  }

  function roundTick(v, step) {
    if (!isNum(v)) return 0;
    var exp = Math.floor(Math.log(Math.abs(step)) / LN10);
    var dec = Math.min(12, Math.max(0, -exp + 3));
    return Number(v.toFixed(dec));
  }

  function linearTicks(min, max, target) {
    if (!isNum(min) || !isNum(max)) return [];
    if (max - min <= 0) return [min];
    var step = niceStep(max - min, target || 5);
    var first = Math.ceil(min / step - 1e-9) * step;
    var ticks = [];
    var guard = 0;
    for (var v = first; v <= max + step * 1e-6 && guard < 60; v += step, guard++) {
      ticks.push(roundTick(v, step));
    }
    if (!ticks.length) ticks = [min, max];
    return ticks;
  }

  /** 对数轴（已变换为 log10 值）的整数十进位刻度 */
  function logTicks(lo, hi) {
    if (!isNum(lo) || !isNum(hi)) return [];
    var s = Math.floor(lo - 1e-9);
    var e = Math.ceil(hi + 1e-9);
    if (e - s < 2) {
      s = Math.floor(lo - 0.5);
      e = Math.ceil(hi + 0.5);
    }
    var step = 1;
    if (e - s > 6) step = Math.ceil((e - s) / 6);
    var ticks = [];
    for (var t = s; t <= e + 1e-9; t += step) ticks.push(Math.round(t));
    return ticks;
  }

  function mergeConfig(cfg) {
    var out = {};
    var k;
    for (k in DEFAULTS) if (has(DEFAULTS, k)) out[k] = DEFAULTS[k];
    if (cfg) {
      for (k in cfg) {
        if (has(cfg, k) && cfg[k] !== undefined) out[k] = cfg[k];
      }
    }
    var pad = {};
    for (k in DEFAULTS.padding) if (has(DEFAULTS.padding, k)) pad[k] = DEFAULTS.padding[k];
    if (cfg && cfg.padding) {
      for (k in cfg.padding) if (has(cfg.padding, k) && isNum(cfg.padding[k])) pad[k] = cfg.padding[k];
    }
    out.padding = pad;
    return out;
  }

  /** 按 CSS 尺寸 + DPR 同步 canvas 像素尺寸，返回绘图上下文信息 */
  function setupCanvas(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    var ctx;
    try {
      ctx = canvas.getContext('2d');
    } catch (err) {
      return null;
    }
    if (!ctx) return null;
    var cssW = Math.round(canvas.clientWidth || 0);
    var cssH = Math.round(canvas.clientHeight || 0);
    var dpr = Number(root.devicePixelRatio) || 1;
    if (dpr < 1) dpr = 1;
    if (cssW < 8 || cssH < 8) {
      return { ctx: ctx, width: cssW, height: cssH, dpr: dpr, zero: true };
    }
    var pxW = Math.max(1, Math.round(cssW * dpr));
    var pxH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx: ctx, width: cssW, height: cssH, dpr: dpr, zero: false };
  }

  function transformY(v, yScale) {
    if (!isNum(v)) return null;
    if (yScale === 'log10') {
      if (!(v > 0)) return null;
      return Math.log(v) / LN10;
    }
    return v;
  }

  function setDash(ctx, dash) {
    if (Array.isArray(dash) && dash.length) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
  }

  function font(spec, family) {
    var s = String(spec || '10px ');
    if (s.indexOf('px') >= 0) return s + family;
    return s + family;
  }

  /* ------------------------------- 主绘制函数 ------------------------------- */

  /**
   * 绘制折线图。
   * @param {HTMLCanvasElement} canvas
   * @param {object} cfg 见文件头注释
   * @returns {{ok:boolean, reason?:string, width?:number, height?:number, dpr?:number,
   *            plot?:object, seriesCount?:number, pointCount?:number, xTicks?:number[], yTicks?:number[]}}
   */
  function drawLineChart(canvas, cfg) {
    var setup = setupCanvas(canvas);
    if (!setup) return { ok: false, reason: 'no-canvas' };
    if (setup.zero) return { ok: false, reason: 'zero-size', width: setup.width, height: setup.height };

    var ctx = setup.ctx;
    var W = setup.width;
    var H = setup.height;
    var dpr = setup.dpr;
    var c = mergeConfig(cfg);
    var family = c.fontFamily;

    /* ---- 1. 规整数据 ---- */
    var yScale = c.yScale === 'log10' ? 'log10' : 'linear';
    var rawSeries = Array.isArray(c.series) ? c.series : [];
    var series = [];
    var allPoints = [];
    var i, j, k;

    for (i = 0; i < rawSeries.length; i++) {
      var sIn = rawSeries[i];
      if (!sIn || sIn.hidden) continue;
      var ptsIn = Array.isArray(sIn.points) ? sIn.points : [];
      var pts = [];
      for (j = 0; j < ptsIn.length; j++) {
        var pIn = ptsIn[j];
        if (!pIn || !isNum(pIn.x)) continue;
        var ty = transformY(pIn.y, yScale);
        if (ty == null) continue;
        pts.push({ x: pIn.x, y: ty, rawY: pIn.y });
      }
      pts.sort(function (a, b) { return a.x - b.x; });
      if (!pts.length) continue;
      var color = sIn.color || SERIES_PALETTE[series.length % SERIES_PALETTE.length];
      series.push({
        name: sIn.name != null ? String(sIn.name) : '',
        color: color,
        lineWidth: isNum(sIn.lineWidth) ? sIn.lineWidth : 1.8,
        dash: sIn.dash || null,
        marker: sIn.marker || 'circle',
        points: pts,
        cfg: sIn
      });
      for (k = 0; k < pts.length; k++) allPoints.push(pts[k]);
    }

    var rawThresholds = Array.isArray(c.thresholds) ? c.thresholds : [];
    var thresholds = [];
    for (i = 0; i < rawThresholds.length; i++) {
      var tIn = rawThresholds[i];
      if (!tIn) continue;
      var tY = transformY(tIn.value, yScale);
      if (tY == null) continue;
      thresholds.push({
        value: tIn.value,
        y: tY,
        color: tIn.color || COLORS.gray,
        dash: Array.isArray(tIn.dash) ? tIn.dash : [5, 4],
        lineWidth: isNum(tIn.lineWidth) ? tIn.lineWidth : 1.1
      });
    }

    /* ---- 2. 计算坐标范围 ---- */
    var xs = [];
    var ys = [];
    for (i = 0; i < allPoints.length; i++) { xs.push(allPoints[i].x); ys.push(allPoints[i].y); }
    for (i = 0; i < thresholds.length; i++) ys.push(thresholds[i].y);

    var xMin = isNum(c.xMin) ? c.xMin : (xs.length ? Math.min.apply(null, xs) : 0);
    var xMax = isNum(c.xMax) ? c.xMax : (xs.length ? Math.max.apply(null, xs) : 1);
    if (xMax - xMin <= 1e-12) {
      var base = Math.abs(xMin) > 0 ? Math.abs(xMin) : 1;
      xMin = xMin - base * 0.5;
      xMax = xMax + base * 0.5;
    } else {
      var xPad = (xMax - xMin) * 0.04;
      xMin -= xPad;
      xMax += xPad;
    }

    var yMin;
    var yMax;
    if (isNum(c.yMin)) yMin = transformY(c.yMin, yScale);
    else yMin = ys.length ? Math.min.apply(null, ys) : 0;
    if (isNum(c.yMax)) yMax = transformY(c.yMax, yScale);
    else yMax = ys.length ? Math.max.apply(null, ys) : 1;
    if (yMin == null) yMin = 0;
    if (yMax == null) yMax = 1;
    if (yMax - yMin <= 1e-12) {
      if (yScale === 'log10') { yMin -= 0.5; yMax += 0.5; }
      else {
        var yPad0 = Math.abs(yMax) > 0 ? Math.abs(yMax) * 0.1 : 1;
        yMin -= yPad0;
        yMax += yPad0;
      }
    } else {
      var yPad = (yMax - yMin) * 0.12;
      yMin -= yPad;
      yMax += yPad;
    }
    if (yScale === 'log10') {
      // 保证对数轴至少有约 2 个十进位，避免刻度过疏
      if (yMax - yMin < 1.2) {
        var mid = (yMax + yMin) / 2;
        yMin = mid - 0.7;
        yMax = mid + 0.7;
      }
    }

    /* ---- 3. 图例与布局 ---- */
    var legendItems = [];
    if (c.legend !== false) {
      for (i = 0; i < series.length; i++) {
        if (series[i].name) legendItems.push(series[i]);
      }
    }
    var pad = c.padding;
    var innerW = Math.max(10, W - pad.left - pad.right);
    ctx.font = font(c.labelFont, family);
    var legendRows = [];
    var curRow = [];
    var curW = 0;
    for (i = 0; i < legendItems.length; i++) {
      var itemW = 14 + 4 + Math.ceil(ctx.measureText(legendItems[i].name).width) + 12;
      if (curRow.length && curW + itemW > innerW) {
        legendRows.push(curRow);
        curRow = [];
        curW = 0;
      }
      curRow.push({ series: legendItems[i], width: itemW });
      curW += itemW;
    }
    if (curRow.length) legendRows.push(curRow);
    var legendH = legendRows.length ? legendRows.length * 14 + 2 : 0;
    var titleH = c.title ? 17 : 0;

    var plot = {
      x: pad.left,
      y: pad.top + titleH + legendH,
      w: innerW,
      h: H - (pad.top + titleH + legendH) - pad.bottom
    };
    if (plot.w < 24 || plot.h < 24) {
      return { ok: false, reason: 'too-small', width: W, height: H };
    }

    function xToPx(x) { return plot.x + ((x - xMin) / (xMax - xMin)) * plot.w; }
    function yToPx(y) { return plot.y + plot.h - ((y - yMin) / (yMax - yMin)) * plot.h; }

    /* ---- 4. 背景 ---- */
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c.plotBackground;
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h);

    /* ---- 5. 标题 ---- */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (c.title) {
      ctx.font = font(c.titleFont, family);
      ctx.fillStyle = c.titleColor;
      ctx.fillText(String(c.title), plot.x, 3);
    }

    /* ---- 6. 图例 ---- */
    if (legendRows.length) {
      var ly = pad.top + titleH;
      for (i = 0; i < legendRows.length; i++) {
        var lx = plot.x;
        var row = legendRows[i];
        for (j = 0; j < row.length; j++) {
          var lg = row[j].series;
          ctx.font = font(c.labelFont, family);
          ctx.fillStyle = c.textColor;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          var cy = ly + i * 14 + 7;
          // 线示例
          ctx.strokeStyle = lg.color;
          ctx.lineWidth = lg.lineWidth || 1.8;
          setDash(ctx, lg.dash || null);
          ctx.beginPath();
          ctx.moveTo(lx + 1, cy);
          ctx.lineTo(lx + 13, cy);
          ctx.stroke();
          setDash(ctx, null);
          ctx.fillStyle = lg.color;
          ctx.beginPath();
          ctx.arc(lx + 7, cy, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = c.textColor;
          ctx.fillText(lg.name, lx + 18, cy + 0.5);
          lx += row[j].width;
        }
      }
    }

    /* ---- 7. 刻度 ---- */
    var yTicks;
    if (yScale === 'log10') {
      yTicks = logTicks(Math.min(yMin, yMax), Math.max(yMin, yMax));
      if (yTicks.length < 2) yTicks = [Math.min(yMin, yMax), Math.max(yMin, yMax)];
    } else {
      yTicks = linearTicks(Math.min(yMin, yMax), Math.max(yMin, yMax), 5);
    }
    var allXInteger = allPoints.length > 0;
    for (i = 0; i < allPoints.length; i++) {
      if (Math.abs(allPoints[i].x - Math.round(allPoints[i].x)) > 1e-9) { allXInteger = false; break; }
    }
    var xTicks;
    if (allXInteger && xMax - xMin <= 16) {
      xTicks = [];
      var stepX = Math.max(1, Math.ceil((xMax - xMin) / 6));
      for (var xv = Math.ceil(xMin - 1e-9); xv <= Math.floor(xMax + 1e-9); xv += stepX) xTicks.push(xv);
      if (!xTicks.length) xTicks = [Math.round(xMin), Math.round(xMax)];
    } else {
      xTicks = linearTicks(xMin, xMax, 6);
      if (xTicks.length < 2) xTicks = [xMin, xMax];
    }

    /* ---- 8. 网格 ---- */
    ctx.strokeStyle = c.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < yTicks.length; i++) {
      var gy = yToPx(yTicks[i]);
      if (gy < plot.y - 0.5 || gy > plot.y + plot.h + 0.5) continue;
      ctx.moveTo(plot.x, Math.round(gy) + 0.5);
      ctx.lineTo(plot.x + plot.w, Math.round(gy) + 0.5);
    }
    for (i = 0; i < xTicks.length; i++) {
      var gx = xToPx(xTicks[i]);
      if (gx < plot.x - 0.5 || gx > plot.x + plot.w + 0.5) continue;
      ctx.moveTo(Math.round(gx) + 0.5, plot.y);
      ctx.lineTo(Math.round(gx) + 0.5, plot.y + plot.h);
    }
    ctx.stroke();

    /* ---- 9. 阈值虚线 ---- */
    for (i = 0; i < thresholds.length; i++) {
      var th = thresholds[i];
      var thy = yToPx(th.y);
      if (thy < plot.y - 0.5 || thy > plot.y + plot.h + 0.5) continue;
      ctx.save();
      ctx.strokeStyle = th.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = th.lineWidth;
      setDash(ctx, th.dash);
      ctx.beginPath();
      ctx.moveTo(plot.x, Math.round(thy) + 0.5);
      ctx.lineTo(plot.x + plot.w, Math.round(thy) + 0.5);
      ctx.stroke();
      ctx.restore();
    }

    /* ---- 10. 折线 + 数据点 ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    for (i = 0; i < series.length; i++) {
      var se = series[i];
      var pts = se.points;
      if (pts.length > 1) {
        ctx.strokeStyle = se.color;
        ctx.lineWidth = se.lineWidth;
        setDash(ctx, se.dash);
        ctx.beginPath();
        for (j = 0; j < pts.length; j++) {
          var px1 = xToPx(pts[j].x);
          var py1 = yToPx(pts[j].y);
          if (j === 0) ctx.moveTo(px1, py1);
          else ctx.lineTo(px1, py1);
        }
        ctx.stroke();
        setDash(ctx, null);
      }
      if (se.marker !== 'none') {
        for (j = 0; j < pts.length; j++) {
          var mx = xToPx(pts[j].x);
          var my = yToPx(pts[j].y);
          ctx.fillStyle = se.color;
          ctx.beginPath();
          ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (c.pointLabels) {
        ctx.font = font('9px ', family);
        ctx.textAlign = 'center';
        ctx.fillStyle = se.color;
        var labelMinX = plot.x + 10;
        var labelMaxX = plot.x + plot.w - 10;
        for (j = 0; j < pts.length; j++) {
          var labelText = null;
          if (typeof c.pointLabels === 'function') {
            try { labelText = c.pointLabels(se.cfg, pts[j]); } catch (err) { labelText = null; }
          } else {
            labelText = fmtTickDefault(pts[j].rawY);
          }
          if (labelText == null || labelText === '') continue;
          var lpx = xToPx(pts[j].x);
          if (lpx < labelMinX) lpx = labelMinX;
          else if (lpx > labelMaxX) lpx = labelMaxX;
          var lpy = yToPx(pts[j].y) - 5;
          if (lpy < plot.y + 9) {
            // 点靠近顶部时把数值标签放到点下方，避免被裁剪
            lpy = yToPx(pts[j].y) + 12;
            ctx.textBaseline = 'top';
          } else {
            ctx.textBaseline = 'bottom';
          }
          ctx.fillText(String(labelText), lpx, lpy);
        }
      }
    }
    ctx.restore();

    /* ---- 11. 坐标轴 + 刻度文本 ---- */
    ctx.strokeStyle = c.axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(plot.x) + 0.5, plot.y);
    ctx.lineTo(Math.round(plot.x) + 0.5, plot.y + plot.h);
    ctx.moveTo(plot.x, Math.round(plot.y + plot.h) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(plot.y + plot.h) + 0.5);
    ctx.stroke();

    ctx.font = font(c.tickFont, family);
    ctx.fillStyle = c.textColor;
    // y 轴刻度
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (i = 0; i < yTicks.length; i++) {
      var yv = yTicks[i];
      var ypy = yToPx(yv);
      if (ypy < plot.y - 0.5 || ypy > plot.y + plot.h + 0.5) continue;
      var yLabel;
      if (typeof c.yTickFormat === 'function') {
        yLabel = c.yTickFormat(yScale === 'log10' ? Math.pow(10, yv) : yv);
      } else {
        yLabel = yScale === 'log10' ? formatScientific(Math.pow(10, yv)) : fmtTickDefault(yv);
      }
      ctx.strokeStyle = c.axisColor;
      ctx.beginPath();
      ctx.moveTo(plot.x - 3, Math.round(ypy) + 0.5);
      ctx.lineTo(plot.x, Math.round(ypy) + 0.5);
      ctx.stroke();
      ctx.fillText(String(yLabel), plot.x - 6, ypy);
    }
    // x 轴刻度
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (i = 0; i < xTicks.length; i++) {
      var xv2 = xTicks[i];
      var xpx = xToPx(xv2);
      if (xpx < plot.x - 0.5 || xpx > plot.x + plot.w + 0.5) continue;
      ctx.strokeStyle = c.axisColor;
      ctx.beginPath();
      ctx.moveTo(Math.round(xpx) + 0.5, plot.y + plot.h);
      ctx.lineTo(Math.round(xpx) + 0.5, plot.y + plot.h + 3);
      ctx.stroke();
      var xLabel;
      if (typeof c.xTickFormat === 'function') xLabel = c.xTickFormat(xv2);
      else xLabel = allXInteger ? String(Math.round(xv2)) : fmtTickDefault(xv2);
      ctx.fillText(String(xLabel), xpx, plot.y + plot.h + 6);
    }

    /* ---- 12. 轴标题 ---- */
    ctx.fillStyle = c.textColor;
    ctx.font = font('10px ', family);
    if (c.xLabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(c.xLabel), plot.x + plot.w / 2, H - 2);
    }
    if (c.yLabel) {
      ctx.save();
      ctx.translate(10, plot.y + plot.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(c.yLabel), 0, 0);
      ctx.restore();
    }

    /* ---- 13. 空状态 ---- */
    if (!allPoints.length) {
      ctx.fillStyle = c.textColor;
      ctx.font = font('11px ', family);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var emptyText = c.emptyText || '—';
      ctx.fillText(String(emptyText), plot.x + plot.w / 2, plot.y + plot.h / 2);
    }

    return {
      ok: true,
      width: W,
      height: H,
      dpr: dpr,
      plot: plot,
      seriesCount: series.length,
      pointCount: allPoints.length,
      thresholdCount: thresholds.length,
      xTicks: xTicks,
      yTicks: yTicks
    };
  }

  /* ------------------------------- 挂载全局 ------------------------------- */

  var MolCharts = (root.MolCharts = root.MolCharts || {});
  MolCharts.version = VERSION;
  MolCharts.colors = COLORS;
  MolCharts.palette = SERIES_PALETTE.slice();
  MolCharts.defaults = DEFAULTS;
  MolCharts.drawLineChart = drawLineChart;
  MolCharts.draw = drawLineChart;
  MolCharts.formatScientific = formatScientific;
  MolCharts.formatTick = fmtTickDefault;

  if (typeof module === 'object' && module && module.exports) module.exports = MolCharts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
