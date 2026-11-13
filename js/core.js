/* =============================================================================
 * MolEdit — js/core.js
 * 核心数据模型、元素表、向量运算、化学键推断、几何测量、几何编辑、导出。
 *
 * 依赖：无（纯 JS，可在浏览器经典脚本和 Node 中加载）
 * 全局：MolCore
 * 契约：见 INTERFACE.md §5 §6
 * ========================================================================== */
(function (root) {
  'use strict';

  const MolCore = (root.MolCore = root.MolCore || {});

  // ===========================================================================
  // 1. 元素表
  // ===========================================================================
  const SYMBOLS = [
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
    'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
    'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
    'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
    'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
    'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
    'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
    'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
    'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
  ];

  // [中文名, 相对原子质量, CPK/Jmol 颜色, vdW 半径 Å, 共价半径 Å]
  const ELEM_DATA = {
    H: ['氢', 1.008, '#ffffff', 1.20, 0.31],
    He: ['氦', 4.0026, '#d9ffff', 1.40, 0.28],
    Li: ['锂', 6.94, '#cc80ff', 1.82, 1.28],
    Be: ['铍', 9.0122, '#c2ff00', 1.53, 0.96],
    B: ['硼', 10.81, '#ffb5b5', 1.92, 0.84],
    C: ['碳', 12.011, '#404040', 1.70, 0.76],
    N: ['氮', 14.007, '#3050f8', 1.55, 0.71],
    O: ['氧', 15.999, '#ff0d0d', 1.52, 0.66],
    F: ['氟', 18.998, '#90e050', 1.47, 0.57],
    Ne: ['氖', 20.180, '#b3e3f5', 1.54, 0.58],
    Na: ['钠', 22.990, '#ab5cf2', 2.27, 1.66],
    Mg: ['镁', 24.305, '#8aff00', 1.73, 1.41],
    Al: ['铝', 26.982, '#bfa6a6', 1.84, 1.21],
    Si: ['硅', 28.085, '#f0c8a0', 2.10, 1.11],
    P: ['磷', 30.974, '#ff8000', 1.80, 1.07],
    S: ['硫', 32.060, '#ffff30', 1.80, 1.05],
    Cl: ['氯', 35.450, '#1ff01f', 1.75, 1.02],
    Ar: ['氩', 39.948, '#80d1e3', 1.88, 1.06],
    K: ['钾', 39.098, '#8f40d4', 2.75, 2.03],
    Ca: ['钙', 40.078, '#3dff00', 2.31, 1.76],
    Sc: ['钪', 44.956, '#e6e6e6', 2.15, 1.70],
    Ti: ['钛', 47.867, '#bfc2c7', 2.11, 1.60],
    V: ['钒', 50.942, '#a6a6ab', 2.07, 1.53],
    Cr: ['铬', 51.996, '#8a99c7', 2.06, 1.39],
    Mn: ['锰', 54.938, '#9c7ac7', 2.05, 1.39],
    Fe: ['铁', 55.845, '#e06633', 2.04, 1.32],
    Co: ['钴', 58.933, '#f090a0', 2.00, 1.26],
    Ni: ['镍', 58.693, '#50d050', 1.97, 1.24],
    Cu: ['铜', 63.546, '#c88033', 1.96, 1.32],
    Zn: ['锌', 65.380, '#7d80b0', 2.01, 1.22],
    Ga: ['镓', 69.723, '#c28f8f', 1.87, 1.22],
    Ge: ['锗', 72.630, '#668f8f', 2.11, 1.20],
    As: ['砷', 74.922, '#bd80e3', 1.85, 1.19],
    Se: ['硒', 78.971, '#ffa100', 1.90, 1.20],
    Br: ['溴', 79.904, '#a62929', 1.85, 1.20],
    Kr: ['氪', 83.798, '#5cb8d1', 2.02, 1.16],
    Rb: ['铷', 85.468, '#702eb0', 3.03, 2.20],
    Sr: ['锶', 87.620, '#00ff00', 2.49, 1.95],
    Y: ['钇', 88.906, '#94ffff', 2.32, 1.90],
    Zr: ['锆', 91.224, '#94e0e0', 2.23, 1.75],
    Nb: ['铌', 92.906, '#73c2c9', 2.18, 1.64],
    Mo: ['钼', 95.950, '#54b5b5', 2.17, 1.54],
    Tc: ['锝', 98.000, '#3b9e9e', 2.16, 1.47],
    Ru: ['钌', 101.070, '#248f8f', 2.13, 1.46],
    Rh: ['铑', 102.906, '#0a7d8c', 2.10, 1.42],
    Pd: ['钯', 106.420, '#006985', 2.05, 1.39],
    Ag: ['银', 107.868, '#c0c0c0', 2.03, 1.45],
    Cd: ['镉', 112.414, '#ffd98f', 2.18, 1.44],
    In: ['铟', 114.818, '#a67573', 1.93, 1.42],
    Sn: ['锡', 118.710, '#668080', 2.17, 1.39],
    Sb: ['锑', 121.760, '#9e63b5', 2.06, 1.39],
    Te: ['碲', 127.600, '#d47a00', 2.06, 1.38],
    I: ['碘', 126.904, '#940094', 1.98, 1.39],
    Xe: ['氙', 131.293, '#429eb0', 2.16, 1.40],
    Cs: ['铯', 132.905, '#57178f', 3.43, 2.44],
    Ba: ['钡', 137.327, '#00c900', 2.68, 2.15],
    La: ['镧', 138.905, '#70d4ff', 2.43, 2.07],
    Ce: ['铈', 140.116, '#ffffc7', 2.42, 2.04],
    Pr: ['镨', 140.908, '#d9ffc7', 2.40, 2.03],
    Nd: ['钕', 144.242, '#c7ffc7', 2.39, 2.01],
    Pm: ['钷', 145.000, '#a3ffc7', 2.38, 1.99],
    Sm: ['钐', 150.360, '#8fffc7', 2.36, 1.98],
    Eu: ['铕', 151.964, '#61ffc7', 2.35, 1.98],
    Gd: ['钆', 157.250, '#45ffc7', 2.34, 1.96],
    Tb: ['铽', 158.925, '#30ffc7', 2.33, 1.94],
    Dy: ['镝', 162.500, '#1fffc7', 2.31, 1.92],
    Ho: ['钬', 164.930, '#00ff9c', 2.30, 1.92],
    Er: ['铒', 167.259, '#00e675', 2.29, 1.89],
    Tm: ['铥', 168.934, '#00d452', 2.27, 1.90],
    Yb: ['镱', 173.045, '#00bf38', 2.26, 1.87],
    Lu: ['镥', 174.967, '#00ab24', 2.24, 1.87],
    Hf: ['铪', 178.490, '#4dc2ff', 2.23, 1.75],
    Ta: ['钽', 180.948, '#4da6ff', 2.22, 1.70],
    W: ['钨', 183.840, '#2194d6', 2.21, 1.62],
    Re: ['铼', 186.207, '#267dab', 2.20, 1.51],
    Os: ['锇', 190.230, '#266696', 2.19, 1.44],
    Ir: ['铱', 192.217, '#175487', 2.18, 1.41],
    Pt: ['铂', 195.084, '#d0d0e0', 2.13, 1.36],
    Au: ['金', 196.967, '#ffd123', 2.14, 1.36],
    Hg: ['汞', 200.592, '#b8b8d0', 2.23, 1.32],
    Tl: ['铊', 204.380, '#a6544d', 1.96, 1.45],
    Pb: ['铅', 207.200, '#575961', 2.02, 1.46],
    Bi: ['铋', 208.980, '#9e4fb5', 2.07, 1.48],
    Po: ['钋', 209.000, '#ab5c00', 1.97, 1.40],
    At: ['砹', 210.000, '#754f45', 2.02, 1.50],
    Rn: ['氡', 222.000, '#428296', 2.20, 1.50],
    Fr: ['钫', 223.000, '#420066', 3.48, 2.60],
    Ra: ['镭', 226.000, '#007d00', 2.83, 2.21],
    Ac: ['锕', 227.000, '#70abfa', 2.60, 2.15],
    Th: ['钍', 232.038, '#00baff', 2.37, 2.06],
    Pa: ['镤', 231.036, '#00a1ff', 2.43, 2.00],
    U: ['铀', 238.029, '#008fff', 2.40, 1.96],
    Np: ['镎', 237.000, '#0080ff', 2.39, 1.90],
    Pu: ['钚', 244.000, '#006bff', 2.43, 1.87],
    Am: ['镅', 243.000, '#545cf2', 2.44, 1.80],
    Cm: ['锔', 247.000, '#785ce3', 2.45, 1.69],
    Bk: ['锫', 247.000, '#8a4fe3', 2.44, 1.60],
    Cf: ['锎', 251.000, '#a136d4', 2.45, 1.60],
    Es: ['锿', 252.000, '#b31fd4', 2.45, 1.60],
    Fm: ['镄', 257.000, '#b31fba', 2.45, 1.60],
    Md: ['钔', 258.000, '#b30da6', 2.45, 1.60],
    No: ['锘', 259.000, '#bd0d87', 2.45, 1.60],
    Lr: ['铹', 266.000, '#c70066', 2.45, 1.60]
  };

  const DEFAULTS = { name: '', mass: 0, color: '#d0d0d0', vdw: 2.00, covalent: 1.50 };
  const ELEMENTS = {};
  const Z_TO_SYMBOL = [];
  const SYMBOL_LOOKUP = Object.create(null);

  SYMBOLS.forEach(function (sym, idx) {
    const z = idx + 1;
    const d = ELEM_DATA[sym] || [];
    ELEMENTS[sym] = {
      symbol: sym,
      name: d[0] || sym,
      atomicNumber: z,
      mass: d[1] != null ? d[1] : DEFAULTS.mass,
      color: d[2] || DEFAULTS.color,
      vdw: d[3] != null ? d[3] : DEFAULTS.vdw,
      covalent: d[4] != null ? d[4] : DEFAULTS.covalent
    };
    Z_TO_SYMBOL.push(sym);
    SYMBOL_LOOKUP[sym.toLowerCase()] = sym;
  });

  MolCore.ELEMENTS = ELEMENTS;

  /** 元素查询：接受符号（大小写不敏感）或原子序数；未知返回 null。 */
  MolCore.element = function (symbolOrNumber) {
    if (typeof symbolOrNumber === 'number') {
      if (!isFinite(symbolOrNumber)) return null;
      const z = Math.round(symbolOrNumber);
      const sym = Z_TO_SYMBOL[z - 1];
      return sym ? ELEMENTS[sym] : null;
    }
    if (symbolOrNumber == null) return null;
    const text = String(symbolOrNumber).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return MolCore.element(parseInt(text, 10));
    const sym = SYMBOL_LOOKUP[text.toLowerCase()];
    return sym ? ELEMENTS[sym] : null;
  };

  /** 由原子序数得到标准元素符号；未知返回 null。 */
  MolCore.symbolForZ = function (z) {
    if (!isFinite(z)) return null;
    return Z_TO_SYMBOL[Math.round(z) - 1] || null;
  };

  MolCore.getElements = function () {
    return SYMBOLS.map(function (s) { return ELEMENTS[s]; });
  };

  // 未知元素兜底数据
  const ELEMENT_FALLBACK = { symbol: '?', name: '', atomicNumber: 0, mass: 0, color: '#d0d0d0', vdw: 2.0, covalent: 1.5 };

  /** 规范化元素符号（大小写）；无法识别返回 null。 */
  MolCore.symbolFor = function (symbol) {
    const t = String(symbol == null ? '' : symbol).trim().toLowerCase();
    return SYMBOL_LOOKUP[t] || null;
  };
  MolCore.symbolForSymbol = MolCore.symbolFor;

  // ===========================================================================
  // 2. 向量工具
  // ===========================================================================
  const vec = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    neg: function (a) { return [-a[0], -a[1], -a[2]]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    },
    len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    norm: function (a) {
      const l = vec.len(a);
      return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
    },
    dist: function (a, b) {
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    lerp: function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; },
    /** 返回任意与 u 垂直的单位向量（u 为零向量时返回 [1,0,0]）。 */
    perpendicular: function (u) {
      const n = vec.norm(u);
      if (vec.len(n) < 1e-9) return [1, 0, 0];
      const axis = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      return vec.norm(vec.cross(n, axis));
    },
    /** 将 p 绕经过 center、方向 axisUnit 的轴旋转 angleRad 弧度（右手定则）。 */
    rotateAroundAxis: function (p, center, axisUnit, angleRad) {
      const u = vec.norm(axisUnit);
      if (vec.len(u) < 1e-9) return [p[0], p[1], p[2]];
      const v = vec.sub(p, center);
      const c = Math.cos(angleRad), s = Math.sin(angleRad);
      const uxv = vec.cross(u, v);
      const udotv = vec.dot(u, v);
      const rotated = [
        v[0] * c + uxv[0] * s + u[0] * udotv * (1 - c),
        v[1] * c + uxv[1] * s + u[1] * udotv * (1 - c),
        v[2] * c + uxv[2] * s + u[2] * udotv * (1 - c)
      ];
      return vec.add(rotated, center);
    }
  };
  MolCore.vec = vec;

  // ===========================================================================
  // 3. 内部工具
  // ===========================================================================
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  function wrap180(deg) {
    let d = deg;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }

  function atomPos(mol, idx) {
    const a = mol.atoms[idx];
    if (!a) throw new Error('原子索引越界: ' + idx);
    return [a.x, a.y, a.z];
  }

  function setAtomPos(atom, p) {
    atom.x = p[0]; atom.y = p[1]; atom.z = p[2];
  }

  function validIndex(mol, idx) {
    return typeof idx === 'number' && idx >= 0 && idx < mol.atoms.length && Math.floor(idx) === idx;
  }

  function checkIndices(mol, indices) {
    const seen = Object.create(null);
    for (let n = 0; n < indices.length; n++) {
      const idx = indices[n];
      if (!validIndex(mol, idx)) throw new Error('原子索引无效: ' + idx);
      if (seen[idx]) throw new Error('原子不能重复选择: ' + idx);
      seen[idx] = true;
    }
  }

  function distanceRaw(mol, i, j) {
    return vec.dist(atomPos(mol, i), atomPos(mol, j));
  }

  function wrapDegrees(d) { return wrap180(d); }
  MolCore.wrapDegrees = wrapDegrees;

  function uniqueSorted(arr) {
    const seen = Object.create(null);
    const out = [];
    for (let n = 0; n < arr.length; n++) {
      const v = arr[n];
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // ===========================================================================
  // 4. 化学键 / 片段
  // ===========================================================================
  const DEFAULT_INFER = { tolerance: 1.15, extra: 0.25 };

  /**
   * 按共价半径与距离推断化学键（不改动 mol）。
   * 判据：d(i,j) <= (r_i + r_j) * tolerance + extra，且 d > 0.35。
   */
  MolCore.inferBonds = function (mol, opts) {
    opts = opts || {};
    const tolerance = opts.tolerance != null ? opts.tolerance : DEFAULT_INFER.tolerance;
    const extra = opts.extra != null ? opts.extra : DEFAULT_INFER.extra;
    const atoms = mol.atoms || [];
    const bonds = [];
    const infos = atoms.map(function (a) {
      return ELEMENTS[MolCore.symbolFor(a && a.symbol)] || ELEMENT_FALLBACK;
    });
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = vec.dist(
          [atoms[i].x, atoms[i].y, atoms[i].z],
          [atoms[j].x, atoms[j].y, atoms[j].z]
        );
        if (d > 0.35 && d <= (infos[i].covalent + infos[j].covalent) * tolerance + extra) {
          bonds.push({ i: i, j: j, order: 1 });
        }
      }
    }
    return bonds;
  };

  /** 重新推断化学键，保留仍然存在原子对的键级。返回 mol。 */
  MolCore.rebond = function (mol) {
    const old = mol.bonds || [];
    const orderMap = Object.create(null);
    for (let n = 0; n < old.length; n++) {
      const b = old[n];
      const key = Math.min(b.i, b.j) + ':' + Math.max(b.i, b.j);
      orderMap[key] = b.order;
    }
    const nb = MolCore.inferBonds(mol);
    for (let n = 0; n < nb.length; n++) {
      const key = nb[n].i + ':' + nb[n].j;
      if (orderMap[key]) nb[n].order = orderMap[key];
    }
    mol.bonds = nb;
    mol.bondSource = 'inferred';
    return mol;
  };

  /** 按 bonds 求连通分量，返回原子索引数组的数组。 */
  MolCore.components = function (mol) {
    const n = mol.atoms.length;
    const adj = buildAdjacency(mol);
    const seen = new Array(n).fill(false);
    const comps = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const comp = [];
      const stack = [i];
      seen[i] = true;
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const nb = adj[cur];
        for (let k = 0; k < nb.length; k++) {
          if (!seen[nb[k]]) { seen[nb[k]] = true; stack.push(nb[k]); }
        }
      }
      comp.sort(function (a, b) { return a - b; });
      comps.push(comp);
    }
    return comps;
  };

  function buildAdjacency(mol) {
    const n = mol.atoms.length;
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    const bonds = mol.bonds || [];
    for (let k = 0; k < bonds.length; k++) {
      const b = bonds[k];
      if (b.i < 0 || b.j < 0 || b.i >= n || b.j >= n) continue;
      adj[b.i].push(b.j);
      adj[b.j].push(b.i);
    }
    return adj;
  }

  /** 断开 cutPair=[a,b]（若存在）后，atomIndex 所在的连通片段（升序数组）。 */
  MolCore.fragmentAfterCut = function (mol, atomIndex, cutPair) {
    if (!validIndex(mol, atomIndex)) throw new Error('原子索引无效: ' + atomIndex);
    const adj = buildAdjacency(mol);
    let pairKey = null;
    if (cutPair && cutPair.length === 2) {
      pairKey = Math.min(cutPair[0], cutPair[1]) + ':' + Math.max(cutPair[0], cutPair[1]);
    }
    const seen = new Array(mol.atoms.length).fill(false);
    const comp = [];
    const stack = [atomIndex];
    seen[atomIndex] = true;
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      const nb = adj[cur];
      for (let k = 0; k < nb.length; k++) {
        const other = nb[k];
        if (seen[other]) continue;
        if (pairKey && (Math.min(cur, other) + ':' + Math.max(cur, other)) === pairKey) continue;
        seen[other] = true;
        stack.push(other);
      }
    }
    comp.sort(function (a, b) { return a - b; });
    return comp;
  };

  /** 断开 a-b 键后两侧片段（a,b 可不相连）。 */
  MolCore.fragmentsForEdit = function (mol, a, b) {
    return {
      aFrag: MolCore.fragmentAfterCut(mol, a, [a, b]),
      bFrag: MolCore.fragmentAfterCut(mol, b, [a, b])
    };
  };

  MolCore.neighbors = function (mol, atomIndex) {
    const adj = buildAdjacency(mol);
    if (!validIndex(mol, atomIndex)) return [];
    return adj[atomIndex].slice().sort(function (a, b) { return a - b; });
  };

  MolCore.bondBetween = function (mol, i, j) {
    const bonds = mol.bonds || [];
    for (let k = 0; k < bonds.length; k++) {
      const b = bonds[k];
      if ((b.i === i && b.j === j) || (b.i === j && b.j === i)) return b;
    }
    return null;
  };

  /**
   * 取“移动侧”原子集合。avoid 中的原子若出现在片段里，则说明该片段包含固定侧，
   * 退化处理为只移动该原子本身。
   */
  function movingSide(mol, atomIndex, cutPair, avoid) {
    let frag = MolCore.fragmentAfterCut(mol, atomIndex, cutPair);
    if (avoid && avoid.length) {
      for (let k = 0; k < avoid.length; k++) {
        if (frag.indexOf(avoid[k]) !== -1) return [atomIndex];
      }
    }
    return frag;
  }

  // ===========================================================================
  // 5. 测量
  // ===========================================================================
  const measure = {
    distance: function (mol, i, j) {
      return distanceRaw(mol, i, j);
    },
    angle: function (mol, i, j, k) {
      const A = atomPos(mol, i), B = atomPos(mol, j), C = atomPos(mol, k);
      const u = vec.sub(A, B), v = vec.sub(C, B);
      const lu = vec.len(u), lv = vec.len(v);
      if (lu < 1e-9 || lv < 1e-9) return null;
      let cos = vec.dot(u, v) / (lu * lv);
      cos = Math.max(-1, Math.min(1, cos));
      return Math.acos(cos) * RAD;
    },
    dihedral: function (mol, i, j, k, l) {
      const A = atomPos(mol, i), B = atomPos(mol, j), C = atomPos(mol, k), D = atomPos(mol, l);
      const b1 = vec.sub(C, B);
      if (vec.len(b1) < 1e-9) return null;
      const b1u = vec.norm(b1);
      const b0 = vec.sub(A, B);
      const b2 = vec.sub(D, C);
      const v = vec.sub(b0, vec.scale(b1u, vec.dot(b0, b1u)));
      const w = vec.sub(b2, vec.scale(b1u, vec.dot(b2, b1u)));
      if (vec.len(v) < 1e-9 || vec.len(w) < 1e-9) return null;
      const x = vec.dot(v, w);
      const y = vec.dot(vec.cross(b1u, v), w);
      return Math.atan2(y, x) * RAD;
    }
  };
  MolCore.measure = measure;

  // ===========================================================================
  // 6. 几何编辑
  // ===========================================================================
  const edit = {};

  function requireFiniteNumber(value, name, min, max) {
    const v = typeof value === 'string' ? parseFloat(value) : value;
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(name + ' 必须是有效数字');
    if (min != null && v < min) throw new Error(name + ' 不能小于 ' + min);
    if (max != null && v > max) throw new Error(name + ' 不能大于 ' + max);
    return v;
  }

  /**
   * 设置键长：默认移动 j 侧片段，使其与 i 的距离等于 newLength。
   * opts.moveSide: 'j' | 'i' | 'smaller'
   */
  edit.setBondLength = function (mol, i, j, newLength, opts) {
    checkIndices(mol, [i, j]);
    if (i === j) throw new Error('键长需要两个不同的原子');
    const target = requireFiniteNumber(newLength, '目标键长', 1e-4, 1e4);
    const A = atomPos(mol, i), B = atomPos(mol, j);
    const delta = vec.sub(B, A);
    const cur = vec.len(delta);
    if (cur < 1e-9) throw new Error('两个原子位置重合，无法确定键长方向');
    const unit = vec.scale(delta, 1 / cur);
    const move = vec.scale(unit, target - cur);
    opts = opts || {};
    let side = opts.moveSide || 'j';

    if (side === 'smaller') {
      const jFrag = MolCore.fragmentAfterCut(mol, j, [i, j]);
      const iFrag = MolCore.fragmentAfterCut(mol, i, [i, j]);
      const jSize = jFrag.indexOf(i) === -1 ? jFrag.length : 1;
      const iSize = iFrag.indexOf(j) === -1 ? iFrag.length : 1;
      side = iSize < jSize ? 'i' : 'j';
    }

    let atoms, trans;
    if (side === 'i') {
      atoms = movingSide(mol, i, [i, j], [j]);
      trans = vec.neg(move);
    } else {
      atoms = movingSide(mol, j, [i, j], [i]);
      trans = move;
    }
    edit.translateFragment(mol, atoms, trans);
    return atoms;
  };

  /**
   * 设置键角（顶点为 j）：默认旋转 k 侧片段。
   * opts.moveSide: 'k' | 'i' | 'smaller'
   */
  edit.setBondAngle = function (mol, i, j, k, newAngleDeg, opts) {
    checkIndices(mol, [i, j, k]);
    if (i === j || j === k || i === k) throw new Error('键角需要三个不同的原子');
    const target = requireFiniteNumber(newAngleDeg, '目标键角', 0, 180);
    const A = atomPos(mol, i), B = atomPos(mol, j), C = atomPos(mol, k);
    const cur = measure.angle(mol, i, j, k);
    if (cur == null) throw new Error('当前几何退化（原子重合），无法计算键角');
    const delta = target - cur;
    if (Math.abs(delta) < 1e-12) return [];

    const axisCross = vec.cross(vec.sub(A, B), vec.sub(C, B));
    let axis;
    if (vec.len(axisCross) > 1e-9) {
      axis = vec.norm(axisCross);
    } else {
      // 共线退化：任取垂直于 B->C 的轴，旋转 delta 仍可使角度变为 target
      axis = vec.perpendicular(vec.sub(C, B));
    }

    opts = opts || {};
    let side = opts.moveSide || 'k';
    if (side === 'smaller') {
      const kFrag = MolCore.fragmentAfterCut(mol, k, [j, k]);
      const iFrag = MolCore.fragmentAfterCut(mol, i, [i, j]);
      const kSize = kFrag.indexOf(i) === -1 ? kFrag.length : 1;
      const iSize = iFrag.indexOf(k) === -1 ? iFrag.length : 1;
      side = iSize < kSize ? 'i' : 'k';
    }

    let atoms, angleDeg;
    if (side === 'i') {
      atoms = movingSide(mol, i, [i, j], [k]);
      angleDeg = -delta;
    } else {
      atoms = movingSide(mol, k, [j, k], [i]);
      angleDeg = delta;
    }
    edit.rotateFragment(mol, atoms, B, axis, angleDeg);
    return atoms;
  };

  /**
   * 设置二面角 A-B-C-D（轴 B->C）：默认旋转 D(l) 侧片段。
   * opts.moveSide: 'l' | 'a' | 'smaller'
   * 符号约定：绕 (C-B) 方向右手定则旋转 D 侧 +Δ 时，二面角增加 Δ。
   */
  edit.setDihedral = function (mol, i, j, k, l, newAngleDeg, opts) {
    checkIndices(mol, [i, j, k, l]);
    const uniq = uniqueSorted([i, j, k, l]);
    if (uniq.length !== 4) throw new Error('二面角需要四个不同的原子');
    const target = requireFiniteNumber(newAngleDeg, '目标二面角', -3600, 3600);
    const B = atomPos(mol, j), C = atomPos(mol, k);
    const axis = vec.sub(C, B);
    if (vec.len(axis) < 1e-9) throw new Error('B、C 两原子位置重合，无法确定二面角轴');
    const axisUnit = vec.norm(axis);
    const cur = measure.dihedral(mol, i, j, k, l);
    if (cur == null) throw new Error('当前几何退化（原子共线或重合），无法计算二面角');
    const delta = target - cur;
    if (Math.abs(delta) < 1e-12) return [];

    opts = opts || {};
    let side = opts.moveSide || 'l';
    if (side === 'smaller') {
      const lFrag = MolCore.fragmentAfterCut(mol, l, [k, l]);
      const aFrag = MolCore.fragmentAfterCut(mol, i, [i, j]);
      const lSize = lFrag.indexOf(i) === -1 ? lFrag.length : 1;
      const aSize = aFrag.indexOf(l) === -1 ? aFrag.length : 1;
      side = aSize < lSize ? 'a' : 'l';
    }

    let atoms, angleDeg;
    if (side === 'a') {
      atoms = movingSide(mol, i, [i, j], [l]);
      angleDeg = -delta;
    } else {
      atoms = movingSide(mol, l, [k, l], [i]);
      angleDeg = delta;
    }
    edit.rotateFragment(mol, atoms, B, axisUnit, angleDeg);
    return atoms;
  };

  /** 将 atoms 指定的原子绕经过 center、方向 axis 的轴旋转 angleDeg 度。 */
  edit.rotateFragment = function (mol, atoms, center, axis, angleDeg) {
    if (!atoms || !atoms.length) return;
    if (vec.len(axis) < 1e-9) throw new Error('旋转轴无效（零向量）');
    if (!isFinite(angleDeg)) throw new Error('旋转角度无效');
    const rad = angleDeg * DEG;
    const u = vec.norm(axis);
    for (let n = 0; n < atoms.length; n++) {
      const idx = atoms[n];
      if (!validIndex(mol, idx)) throw new Error('原子索引无效: ' + idx);
      const a = mol.atoms[idx];
      const p = vec.rotateAroundAxis([a.x, a.y, a.z], center, u, rad);
      setAtomPos(a, p);
    }
  };

  /** 平移 atoms 指定的原子。 */
  edit.translateFragment = function (mol, atoms, delta) {
    if (!atoms || !atoms.length) return;
    if (!delta || delta.length < 3) throw new Error('平移向量无效');
    for (let n = 0; n < atoms.length; n++) {
      const idx = atoms[n];
      if (!validIndex(mol, idx)) throw new Error('原子索引无效: ' + idx);
      const a = mol.atoms[idx];
      a.x += delta[0]; a.y += delta[1]; a.z += delta[2];
    }
  };

  /** 旋转整个分子。 */
  edit.rotateAll = function (mol, center, axis, angleDeg) {
    const all = mol.atoms.map(function (_, idx) { return idx; });
    edit.rotateFragment(mol, all, center, axis, angleDeg);
  };

  /** 设置原子元素符号。 */
  edit.setElement = function (mol, index, symbol) {
    if (!validIndex(mol, index)) throw new Error('原子索引无效: ' + index);
    const sym = MolCore.symbolFor(symbol);
    if (!sym) throw new Error('无法识别的元素符号: ' + symbol);
    mol.atoms[index].symbol = sym;
    return sym;
  };

  /** 添加原子，返回新原子索引。 */
  edit.addAtom = function (mol, symbol, x, y, z) {
    const sym = MolCore.symbolFor(symbol);
    if (!sym) throw new Error('无法识别的元素符号: ' + symbol);
    const pos = [Number(x), Number(y), Number(z)];
    if (pos.some(function (v) { return !isFinite(v); })) throw new Error('原子坐标无效');
    mol.atoms.push({ symbol: sym, x: pos[0], y: pos[1], z: pos[2] });
    return mol.atoms.length - 1;
  };

  /** 删除原子（及相连键），保持剩余原子顺序。 */
  edit.deleteAtoms = function (mol, indices) {
    if (!indices || !indices.length) return [];
    const kill = Object.create(null);
    indices.forEach(function (idx) {
      if (!validIndex(mol, idx)) throw new Error('原子索引无效: ' + idx);
      kill[idx] = true;
    });
    const remap = [];
    const newAtoms = [];
    for (let i = 0; i < mol.atoms.length; i++) {
      if (kill[i]) { remap.push(-1); continue; }
      remap.push(newAtoms.length);
      newAtoms.push(mol.atoms[i]);
    }
    const newBonds = [];
    (mol.bonds || []).forEach(function (b) {
      const ni = remap[b.i], nj = remap[b.j];
      if (ni < 0 || nj < 0) return;
      newBonds.push({ i: Math.min(ni, nj), j: Math.max(ni, nj), order: b.order });
    });
    mol.atoms = newAtoms;
    mol.bonds = newBonds;
    return remap;
  };

  MolCore.edit = edit;

  /** 深拷贝分子。 */
  MolCore.clone = function (mol) {
    return {
      title: mol.title || '',
      atoms: (mol.atoms || []).map(function (a) {
        return { symbol: a.symbol, x: a.x, y: a.y, z: a.z };
      }),
      bonds: (mol.bonds || []).map(function (b) { return { i: b.i, j: b.j, order: b.order }; }),
      charge: mol.charge != null ? mol.charge : 0,
      multiplicity: mol.multiplicity != null ? mol.multiplicity : 1,
      source: mol.source || 'user',
      energy: mol.energy != null ? mol.energy : null,
      bondSource: mol.bondSource || 'inferred',
      frameIndex: mol.frameIndex != null ? mol.frameIndex : 0,
      frameCount: mol.frameCount != null ? mol.frameCount : 1
    };
  };

  /** 分子式（Hill 排序），如 C6H6O。 */
  MolCore.formula = function (mol) {
    const counts = Object.create(null);
    (mol.atoms || []).forEach(function (a) {
      const sym = MolCore.symbolFor(a.symbol) || '?';
      counts[sym] = (counts[sym] || 0) + 1;
    });
    const syms = Object.keys(counts);
    syms.sort(function (a, b) {
      if (a === 'C') return -1;
      if (b === 'C') return 1;
      if (a === 'H') return -1;
      if (b === 'H') return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    let out = '';
    syms.forEach(function (s) {
      out += s + (counts[s] > 1 ? counts[s] : '');
    });
    return out || '—';
  };

  // ===========================================================================
  // 7. 导出
  // ===========================================================================
  function fmtFixed(value, digits) {
    if (!isFinite(value)) value = 0;
    return value.toFixed(digits);
  }

  function sanitizeTitle(title) {
    const t = String(title == null ? '' : title).replace(/[\r\n\t]+/g, ' ').trim();
    return t;
  }

  const exporter = {
    /** XYZ 文本。 */
    xyz: function (mol, opts) {
      opts = opts || {};
      const atoms = mol.atoms || [];
      const lines = [String(atoms.length)];
      lines.push(sanitizeTitle(opts.title != null ? opts.title : mol.title) || 'MolEdit export');
      atoms.forEach(function (a) {
        const sym = MolCore.symbolFor(a.symbol) || 'X';
        lines.push(sym + ' ' + fmtFixed(a.x, 8) + ' ' + fmtFixed(a.y, 8) + ' ' + fmtFixed(a.z, 8));
      });
      return lines.join('\n') + '\n';
    },

    /** Gaussian 输入文本（笛卡尔坐标 + 可选 connectivity）。 */
    gjf: function (mol, opts) {
      opts = opts || {};
      const atoms = mol.atoms || [];
      const connectivity = opts.connectivity !== false;
      const title = sanitizeTitle(opts.title != null ? opts.title : mol.title) || 'Molecule exported by MolEdit';
      const route = opts.route ||
        (connectivity ? '#p b3lyp/6-31g(d) opt geom=connectivity' : '#p b3lyp/6-31g(d) opt');
      const charge = mol.charge != null ? mol.charge : 0;
      const mult = mol.multiplicity != null ? mol.multiplicity : 1;
      const lines = [];
      if (opts.chk) lines.push('%chk=' + opts.chk);
      lines.push(route);
      lines.push('');
      lines.push(title);
      lines.push('');
      lines.push(charge + ' ' + mult);
      atoms.forEach(function (a) {
        const sym = MolCore.symbolFor(a.symbol) || 'X';
        lines.push(' ' + sym.padEnd(2) + '  ' +
          a.x.toFixed(12).padStart(20) + ' ' +
          a.y.toFixed(12).padStart(20) + ' ' +
          a.z.toFixed(12).padStart(20));
      });
      if (connectivity) {
        lines.push('');
        const n = atoms.length;
        const byAtom = new Array(n);
        for (let i = 0; i < n; i++) byAtom[i] = [];
        (mol.bonds || []).forEach(function (b) {
          if (b.i >= 0 && b.i < n) byAtom[b.i].push({ j: b.j, order: b.order });
          if (b.j >= 0 && b.j < n) byAtom[b.j].push({ j: b.i, order: b.order });
        });
        for (let i = 0; i < n; i++) {
          byAtom[i].sort(function (a, b) { return a.j - b.j; });
          const parts = [String(i + 1)];
          byAtom[i].forEach(function (b) {
            parts.push(String(b.j + 1));
            parts.push((b.order || 1).toFixed(1));
          });
          lines.push(' ' + parts.join(' '));
        }
        lines.push('');
      }
      return lines.join('\n') + '\n';
    },

    /** SDF V2000 文本。 */
    sdf: function (mol, opts) {
      opts = opts || {};
      const atoms = mol.atoms || [];
      const bonds = mol.bonds || [];
      const title = sanitizeTitle(opts.title != null ? opts.title : mol.title) || 'MolEdit';
      const lines = [];
      lines.push(title);
      lines.push('  MolEdit 1.0.0');
      lines.push('');
      lines.push(
        String(atoms.length).padStart(3) + String(bonds.length).padStart(3) +
        '  0  0  0  0  0  0  0  0999 V2000'
      );
      atoms.forEach(function (a) {
        const sym = MolCore.symbolFor(a.symbol) || 'X';
        lines.push(
          a.x.toFixed(4).padStart(10) + a.y.toFixed(4).padStart(10) + a.z.toFixed(4).padStart(10) +
          ' ' + sym.padEnd(3) + '0  0  0  0  0  0  0  0  0  0  0  0'
        );
      });
      bonds.forEach(function (b) {
        const order = b.order === 4 ? 4 : (b.order || 1);
        lines.push(
          String(b.i + 1).padStart(3) + String(b.j + 1).padStart(3) + String(order).padStart(3) +
          '  0  0  0  0'
        );
      });
      lines.push('M  END');
      lines.push('$$$$');
      return lines.join('\n') + '\n';
    }
  };
  if (MolCore.export && MolCore.export.xyz) {
    // 理论上不会出现；保留已有导出器，避免覆盖
  }
  MolCore.export = exporter;

  MolCore.version = '1.0.0';

  // Node 单元测试支持
  if (typeof module === 'object' && module.exports) module.exports = MolCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
