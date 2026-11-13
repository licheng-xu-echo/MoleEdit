/* MolEdit — tools/gen-samples.mjs
 * 生成示例分子（samples/*.xyz|.sdf|.gjf|.log）以及 js/samples.js。
 * 运行：node tools/gen-samples.mjs
 * 用标准键长/键角构建丁烷、苯、甲醇等的坐标，保证示例几何物理合理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOptFreqLog } from './gen-log-sample.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const DEG = Math.PI / 180;

// ---------------- 向量 ----------------
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  norm: (a) => { const l = V.len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
  perp: (u) => {
    const n = V.norm(u);
    const axis = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return V.norm(V.cross(n, axis));
  },
  rot: (p, center, axis, deg) => {
    const u = V.norm(axis);
    const v = V.sub(p, center);
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
    const uxv = V.cross(u, v);
    const d = V.dot(u, v);
    return V.add(center, [
      v[0] * c + uxv[0] * s + u[0] * d * (1 - c),
      v[1] * c + uxv[1] * s + u[1] * d * (1 - c),
      v[2] * c + uxv[2] * s + u[2] * d * (1 - c)
    ]);
  }
};

function fmt(v, d = 6) { return v.toFixed(d); }
function atom(symbol, x, y, z) { return { symbol, x, y, z }; }
function xyzText(title, atoms) {
  const lines = [String(atoms.length), title];
  atoms.forEach((a) => lines.push(`${a.symbol} ${fmt(a.x, 8)} ${fmt(a.y, 8)} ${fmt(a.z, 8)}`));
  return lines.join('\n') + '\n';
}

/** 在 C 上按四面体几何放置 3 个 H（terminal CH3，axis 指向唯一重原子）。 */
function methylHydrogens(cPos, neighborPos, chLen = 1.09) {
  const axis = V.norm(V.sub(neighborPos, cPos));
  const e1 = V.perp(axis);
  const e2 = V.norm(V.cross(axis, e1));
  const theta = 109.47 * DEG;
  const out = [];
  for (let k = 0; k < 3; k++) {
    const phi = k * 120 * DEG;
    const dir = [
      axis[0] * Math.cos(theta) + (e1[0] * Math.cos(phi) + e2[0] * Math.sin(phi)) * Math.sin(theta),
      axis[1] * Math.cos(theta) + (e1[1] * Math.cos(phi) + e2[1] * Math.sin(phi)) * Math.sin(theta),
      axis[2] * Math.cos(theta) + (e1[2] * Math.cos(phi) + e2[2] * Math.sin(phi)) * Math.sin(theta)
    ];
    out.push(V.add(cPos, V.scale(V.norm(dir), chLen)));
  }
  return out;
}

/** 在 C 上放置 2 个 H（CH2，两个重原子邻居），H-C-H ≈ 107.8°。 */
function methyleneHydrogens(cPos, n1, n2, chLen = 1.09) {
  const u1 = V.norm(V.sub(n1, cPos));
  const u2 = V.norm(V.sub(n2, cPos));
  const m = V.norm(V.scale(V.add(u1, u2), -1)); // 背向重原子的方向
  const w = V.norm(V.cross(u1, u2));
  const half = (107.8 / 2) * DEG;
  const p = (sign) => {
    const c = Math.cos(sign * half), s = Math.sin(sign * half);
    const mxc = V.cross(w, m);
    const d = [m[0] * c + mxc[0] * s, m[1] * c + mxc[1] * s, m[2] * c + mxc[2] * s];
    return V.add(cPos, V.scale(V.norm(d), chLen));
  };
  return [p(1), p(-1)];
}

// ---------------- 丁烷 C4H10 ----------------
function buildButane() {
  const CC = 1.53, CCC = 112;
  const C1 = [0, 0, 0];
  const C2 = [CC, 0, 0];
  // C3：在 xy 平面内，C2 处 C1-C2-C3 角 112°
  const dir23 = [Math.cos((180 - CCC) * DEG), Math.sin((180 - CCC) * DEG), 0];
  const C3 = V.add(C2, V.scale(dir23, CC));
  // C4：二面角 C1-C2-C3-C4 = 180°
  const b1 = V.norm(V.sub(C3, C2));
  const v = V.sub(V.sub(C1, C2), V.scale(b1, V.dot(V.sub(C1, C2), b1)));
  const vhat = V.norm(v);
  const uBack = V.norm(V.sub(C2, C3));
  const dir34 = V.add(
    V.scale(uBack, Math.cos(CCC * DEG)),
    V.scale(vhat, -Math.sin(CCC * DEG))
  );
  const C4 = V.add(C3, V.scale(V.norm(dir34), CC));

  const atoms = [atom('C', ...C1), atom('C', ...C2), atom('C', ...C3), atom('C', ...C4)];
  [methylHydrogens(C1, C2), methylHydrogens(C4, C3), methyleneHydrogens(C2, C1, C3), methyleneHydrogens(C3, C2, C4)]
    .forEach((hs) => hs.forEach((h) => atoms.push(atom('H', ...h))));
  return atoms;
}

// ---------------- 苯 C6H6（SDF，凯库勒式交替双键） ----------------
function buildBenzeneSDF() {
  const atoms = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * DEG;
    atoms.push(atom('C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * DEG;
    atoms.push(atom('H', 2.48 * Math.cos(a), 2.48 * Math.sin(a), 0));
  }
  const bonds = [];
  for (let i = 0; i < 6; i++) bonds.push([i, (i + 1) % 6, i % 2 === 0 ? 2 : 1]);
  for (let i = 0; i < 6; i++) bonds.push([i, 6 + i, 1]);
  // 规范化 i<j
  bonds.forEach((b) => { if (b[0] > b[1]) b.splice(0, 2, b[1], b[0]); });
  const fmt4 = (v) => v.toFixed(4).padStart(10);
  const lines = [];
  lines.push('benzene');
  lines.push('  MolEdit samples');
  lines.push('');
  lines.push(String(atoms.length).padStart(3) + String(bonds.length).padStart(3) +
    '  0  0  0  0  0  0  0  0999 V2000');
  atoms.forEach((a) => {
    lines.push(fmt4(a.x) + fmt4(a.y) + fmt4(a.z) + ' ' + a.symbol.padEnd(3) +
      '0  0  0  0  0  0  0  0  0  0  0  0');
  });
  bonds.forEach((b) => {
    lines.push(String(b[0] + 1).padStart(3) + String(b[1] + 1).padStart(3) + String(b[2]).padStart(3) + '  0  0  0  0');
  });
  lines.push('M  END');
  lines.push('$$$$');
  return lines.join('\n') + '\n';
}

// ---------------- 甲醇 CH3OH（GJF，含 connectivity） ----------------
function buildMethanolGJF() {
  const CO = 1.43, CH = 1.09, OH = 0.96;
  const C = [0, 0, 0];
  const O = [CO, 0, 0];
  const Hc1 = [-0.3633, 1.0277, 0];
  const Hc2 = [-0.3633, -0.5139, 0.8900];
  const Hc3 = [-0.3633, -0.5139, -0.8900];
  const Ho = [CO + OH * Math.cos(71.5 * DEG), OH * Math.sin(71.5 * DEG), 0];
  const atoms = [
    atom('C', ...C), atom('O', ...O),
    atom('H', ...Hc1), atom('H', ...Hc2), atom('H', ...Hc3), atom('H', ...Ho)
  ];
  const bonds = [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1]];
  const conn = new Map();
  bonds.forEach(([i, j, o]) => {
    if (!conn.has(i)) conn.set(i, []);
    if (!conn.has(j)) conn.set(j, []);
    conn.get(i).push([j, o]);
    conn.get(j).push([i, o]);
  });
  const lines = [];
  lines.push('%chk=methanol.chk');
  lines.push('#p b3lyp/6-31g(d) opt geom=connectivity');
  lines.push('');
  lines.push('Methanol optimization');
  lines.push('');
  lines.push('0 1');
  atoms.forEach((a) => {
    lines.push(' ' + a.symbol.padEnd(2) + '  ' +
      a.x.toFixed(12).padStart(20) + ' ' + a.y.toFixed(12).padStart(20) + ' ' + a.z.toFixed(12).padStart(20));
  });
  lines.push('');
  atoms.forEach((_, i) => {
    const parts = [String(i + 1)];
    (conn.get(i) || []).sort((a, b) => a[0] - b[0]).forEach(([j, o]) => { parts.push(String(j + 1), o.toFixed(1)); });
    lines.push(' ' + parts.join(' '));
  });
  lines.push('');
  return lines.join('\n') + '\n';
}

// ---------------- 水分子 Gaussian log（2 帧，含 SCF Done） ----------------
const Z = { H: 1, C: 6, N: 7, O: 8 };
function buildWaterLog() {
  const block = (center, z, x, y, zz) =>
    `${String(center).padStart(7)}${String(z).padStart(13)}${String(0).padStart(13)}` +
    `${fmt(x, 6).padStart(13)}${fmt(y, 6).padStart(13)}${fmt(zz, 6).padStart(13)}`;
  const oriBlock = (coords) => [
    '                         Standard orientation:                         ',
    ' ---------------------------------------------------------------------',
    ' Center     Atomic      Atomic             Coordinates (Angstroms)',
    ' Number     Number       Type             X           Y           Z',
    ' ---------------------------------------------------------------------'
  ].concat(coords.map((c, i) => block(i + 1, Z[c[0]], c[1], c[2], c[3])))
    .concat([' ---------------------------------------------------------------------', '']).join('\n');
  const frame1 = [['O', 0.000000, 0.000000, 0.000000], ['H', 0.763000, 0.586000, 0.000000], ['H', -0.763000, 0.586000, 0.000000]];
  const frame2 = [['O', 0.000000, 0.000000, 0.000000], ['H', 0.756800, 0.586000, 0.000000], ['H', -0.756800, 0.586000, 0.000000]];
  const prelude = [
    ' Entering Link 1 = C:\\G16W\\G16.exe pid=  4321  ...',
    '',
    ' Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.',
    '',
    ' ---------------------------------------------------------------',
    ' #p b3lyp/6-31g(d) opt',
    ' ---------------------------------------------------------------',
    ' Water optimization',
    '',
    ' Symbolic Z-matrix:',
    ' Charge =  0 Multiplicity = 1',
    ' O',
    ' H  1  0.96',
    ' H  1  0.96  2  104.5',
    ''
  ].join('\n');
  const tail = [
    ' SCF Done:  E(RB3LYP) =  -76.4089399955     A.U. after    6 cycles',
    '',
    ' Charge =  0 Multiplicity = 1',
    '',
    ' Job cpu time:       0 days  0 hours  0 minutes  3.2 seconds.',
    ' File lengths (MBytes):  RWF=      5 Int=      0 D2E=      0 Chk=      1 Scr=      1',
    '',
    ' Normal termination of Gaussian 16 at Thu Oct 30 12:34:56 2025.',
    ''
  ].join('\n');
  return prelude + '\n' + oriBlock(frame1) +
    ' SCF Done:  E(RB3LYP) =  -76.4094031546     A.U. after   10 cycles\n\n' +
    oriBlock(frame2) + tail;
}

function buildWaterXYZ() {
  return xyzText('water (H2O)', [
    atom('O', 0.000000, 0.000000, 0.000000),
    atom('H', 0.756800, 0.586000, 0.000000),
    atom('H', -0.756800, 0.586000, 0.000000)
  ]);
}

function buildMethaneGJF() {
  const d = 0.629;
  const atoms = [
    atom('C', 0, 0, 0),
    atom('H', d, d, d), atom('H', -d, -d, d), atom('H', -d, d, -d), atom('H', d, -d, -d)
  ];
  const lines = [];
  lines.push('#p b3lyp/6-31g(d) opt');
  lines.push('');
  lines.push('Methane optimization');
  lines.push('');
  lines.push('0 1');
  atoms.forEach((a) => {
    lines.push(' ' + a.symbol.padEnd(2) + '  ' +
      a.x.toFixed(12).padStart(20) + ' ' + a.y.toFixed(12).padStart(20) + ' ' + a.z.toFixed(12).padStart(20));
  });
  lines.push('');
  return lines.join('\n') + '\n';
}

// ---------------- 写出 ----------------
const samples = [
  { key: 'water-xyz', name: '水 H₂O（XYZ）', nameEn: 'Water H₂O (XYZ)', format: 'xyz', filename: 'water.xyz', text: buildWaterXYZ() },
  { key: 'methane-gjf', name: '甲烷 CH₄（GJF）', nameEn: 'Methane CH₄ (GJF)', format: 'gjf', filename: 'methane.gjf', text: buildMethaneGJF() },
  { key: 'methanol-gjf', name: '甲醇 CH₃OH（GJF，含连接性）', nameEn: 'Methanol CH₃OH (GJF, with connectivity)', format: 'gjf', filename: 'methanol.gjf', text: buildMethanolGJF() },
  { key: 'benzene-sdf', name: '苯 C₆H₆（SDF）', nameEn: 'Benzene C₆H₆ (SDF)', format: 'sdf', filename: 'benzene.sdf', text: buildBenzeneSDF() },
  { key: 'butane-xyz', name: '丁烷 C₄H₁₀（XYZ，二面角练习）', nameEn: 'Butane C₄H₁₀ (XYZ, dihedral practice)', format: 'xyz', filename: 'butane.xyz', text: xyzText('butane (anti)', buildButane()) },
  { key: 'water-log', name: '水分子 Gaussian 输出（LOG，2 帧轨迹）', nameEn: 'Water Gaussian log (2-frame trajectory)', format: 'log', filename: 'water.log', text: buildWaterLog() },
  {
    key: 'water-opt-freq',
    name: '水分子 opt+freq 计算（LOG，结果演示）',
    nameEn: 'Water opt+freq log (results demo)',
    format: 'log',
    filename: 'water-opt-freq.log',
    text: buildOptFreqLog()
  }
];

fs.mkdirSync(SAMPLES_DIR, { recursive: true });
samples.forEach((s) => {
  fs.writeFileSync(path.join(SAMPLES_DIR, s.filename), s.text, 'utf8');
});

// 生成 js/samples.js
const js = [];
js.push('/* =============================================================================');
js.push(' * MolEdit — js/samples.js（由 tools/gen-samples.mjs 生成，请勿手改）');
js.push(' * 内置示例分子；file:// 下无法 fetch，示例文本直接内嵌。');
js.push(' * 全局：MolSamples = { list: [{key,name,nameEn,format,filename}], get(key), all }');
js.push(' * ========================================================================== */');
js.push('(function (root) {');
js.push("  'use strict';");
js.push('  const SAMPLES = [');
samples.forEach((s) => {
  js.push('    {');
  js.push('      key: ' + JSON.stringify(s.key) + ',');
  js.push('      name: ' + JSON.stringify(s.name) + ',');
  js.push('      nameEn: ' + JSON.stringify(s.nameEn) + ',');
  js.push('      format: ' + JSON.stringify(s.format) + ',');
  js.push('      filename: ' + JSON.stringify(s.filename) + ',');
  js.push('      text: ' + JSON.stringify(s.text) + '');
  js.push('    }' + (','));
});
js[js.length - 1] = js[js.length - 1].replace(/,$/, '');
js.push('  ];');
js.push('');
js.push('  const byKey = Object.create(null);');
js.push('  const list = SAMPLES.map(function (s) {');
js.push('    byKey[s.key] = s;');
js.push('    return { key: s.key, name: s.name, nameEn: s.nameEn, format: s.format, filename: s.filename };');
js.push('  });');
js.push('');
js.push('  root.MolSamples = {');
js.push('    list: list,');
js.push('    all: SAMPLES,');
js.push('    get: function (key) { return byKey[key] || null; },');
js.push('    has: function (key) { return !!byKey[key]; }');
js.push('  };');
js.push('');
js.push("  if (typeof module === 'object' && module.exports) module.exports = root.MolSamples;");
js.push("})(typeof globalThis !== 'undefined' ? globalThis : this);");
js.push('');
fs.writeFileSync(path.join(ROOT, 'js', 'samples.js'), js.join('\n'), 'utf8');

console.log('已生成 samples/:');
samples.forEach((s) => console.log('  - ' + s.filename + '  (' + s.format + ', ' + s.text.split('\n')[0] + ' …)'));
console.log('已生成 js/samples.js（含 nameEn + ' + samples.length + ' 个示例）');




