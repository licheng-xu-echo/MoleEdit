/**
 * parsers.test.mjs — MolCore 解析器单元测试（Node 内置，零第三方依赖）
 *
 * 运行：  cd moledit（项目根目录）
 *         node tests/parsers.test.mjs
 *
 * 覆盖 INTERFACE.md §6.7：
 *   - detectFormat / parseFile / parseXYZ / parseSDF / parseGJF / parseLOG
 *   - 四格式成功解析（原子数/键数/元素/坐标/帧数/charge/multiplicity/energy）
 *   - xyz 多帧、sdf 多记录、gjf --Link1-- 多 job、log 多 orientation 帧与 Input 回退
 *   - 坏文件抛 MolCore.ParseError（中文）、V3000 明确报错、Z-matrix 明确报错
 *   - BOM / CRLF / 科学计数法 / 前后空白 / 大文件
 *   - samples/ 示例文件回环
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

/* ---- 与 INTERFACE.md §4 一致的加载方式 ---- */
const MolCore = require(path.join(ROOT, 'js', 'core.js'));
require(path.join(ROOT, 'js', 'parsers.js'));

/* ============================ 迷你测试框架 ============================ */

let passed = 0;
const failures = [];
let currentGroup = '';

function group(title) {
  currentGroup = title;
  console.log('\n' + title);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    failures.push({ group: currentGroup, name: name, error: err });
    console.log('  ❌ ' + name);
    const message = err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n       ') : String(err);
    console.log('       ' + message);
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((label ? label + '：' : '') + '期望 ' + b + '，实际 ' + a);
}

function approx(actual, expected, tolerance, label) {
  const tol = tolerance == null ? 1e-6 : tolerance;
  if (typeof actual !== 'number' || !isFinite(actual)) {
    throw new Error((label ? label + '：' : '') + '期望数值 ' + expected + '，实际 ' + actual);
  }
  if (Math.abs(actual - expected) > tol) {
    throw new Error((label ? label + '：' : '') + '期望 ' + expected + ' ± ' + tol + '，实际 ' + actual);
  }
}

function throwsParseError(fn, pattern, label) {
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  if (!caught) throw new Error((label ? label + '：' : '') + '未抛出异常（期望 MolCore.ParseError）');
  if (!(caught instanceof MolCore.ParseError)) {
    throw new Error((label ? label + '：' : '') + '抛出的不是 MolCore.ParseError，而是 ' +
      (caught && caught.name) + ': ' + (caught && caught.message));
  }
  if (pattern && !pattern.test(caught.message)) {
    throw new Error((label ? label + '：' : '') + '错误信息不匹配 ' + pattern + '，实际："' + caught.message + '"');
  }
  return caught;
}

/* ============================ 数据 / 契约校验 ============================ */

const SOURCES = ['xyz', 'sdf', 'gjf', 'log', 'user'];

function validateMolecule(mol, label) {
  const tag = label ? '[' + label + '] ' : '';
  ok(mol && typeof mol === 'object', tag + 'Molecule 不是对象');
  ok(typeof mol.title === 'string', tag + 'title 不是字符串');
  ok(Array.isArray(mol.atoms) && mol.atoms.length > 0, tag + 'atoms 应为非空数组');
  ok(Array.isArray(mol.bonds), tag + 'bonds 不是数组');
  ok(typeof mol.charge === 'number' && Number.isInteger(mol.charge), tag + 'charge 应为整数');
  ok(typeof mol.multiplicity === 'number' && mol.multiplicity >= 1, tag + 'multiplicity 应 >= 1');
  ok(SOURCES.indexOf(mol.source) >= 0, tag + 'source 非法：' + mol.source);
  ok(mol.energy === null || typeof mol.energy === 'number', tag + 'energy 应为 null 或数字');
  ok(mol.bondSource === 'inferred' || mol.bondSource === 'explicit', tag + 'bondSource 非法：' + mol.bondSource);
  ok(typeof mol.frameIndex === 'number' && Number.isInteger(mol.frameIndex), tag + 'frameIndex 应为整数');
  ok(typeof mol.frameCount === 'number' && Number.isInteger(mol.frameCount) && mol.frameCount >= 1,
    tag + 'frameCount 应为 >=1 的整数');
  ok(mol.frameIndex >= 0 && mol.frameIndex < mol.frameCount, tag + 'frameIndex 超出 [0, frameCount)');

  for (let i = 0; i < mol.atoms.length; i++) {
    const atom = mol.atoms[i];
    ok(atom && typeof atom.symbol === 'string' && atom.symbol.length > 0, tag + '原子 ' + i + ' symbol 非法');
    if (MolCore.ELEMENTS && MolCore.ELEMENTS[atom.symbol]) {
      ok(true);
    } else if (MolCore.ELEMENTS) {
      throw new Error(tag + '原子 ' + i + ' 的元素符号 "' + atom.symbol + '" 不在 MolCore.ELEMENTS 中');
    }
    ok(typeof atom.x === 'number' && isFinite(atom.x), tag + '原子 ' + i + ' x 非法');
    ok(typeof atom.y === 'number' && isFinite(atom.y), tag + '原子 ' + i + ' y 非法');
    ok(typeof atom.z === 'number' && isFinite(atom.z), tag + '原子 ' + i + ' z 非法');
  }

  const seen = Object.create(null);
  for (let b = 0; b < mol.bonds.length; b++) {
    const bond = mol.bonds[b];
    ok(Number.isInteger(bond.i) && Number.isInteger(bond.j), tag + '键 ' + b + ' 索引不是整数');
    ok(bond.i >= 0 && bond.j < mol.atoms.length, tag + '键 ' + b + ' 索引越界');
    ok(bond.i < bond.j, tag + '键 ' + b + ' 未满足 i<j');
    ok(Number.isInteger(bond.order) && bond.order >= 1 && bond.order <= 4, tag + '键 ' + b + ' 键级非法：' + bond.order);
    const key = bond.i + ':' + bond.j;
    ok(!seen[key], tag + '键 ' + b + ' 重复');
    seen[key] = true;
  }
}

function renderMoleculeList(molecules) {
  return molecules.map(function (m, i) {
    return '#' + i + '[' + m.title + '] ' + m.atoms.length + '原子/' + m.bonds.length + '键';
  }).join('; ');
}

/* ============================ 夹具加载 ============================ */

function fx(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function addBomAndCrlf(text) {
  return '\uFEFF' + text.replace(/\r?\n/g, '\r\n');
}

const FIXTURE_FILES = ['water.xyz', 'water_traj.xyz', 'benzene.sdf', 'multi.sdf',
  'methanol.gjf', 'multi_job.gjf', 'water.log', 'failed.log'];

/* ============================ 开始测试 ============================ */

console.log('='.repeat(72));
console.log('MolEdit 解析器测试  |  node ' + process.version);
console.log('js/core.js 已加载：' + (typeof MolCore.inferBonds === 'function' ? '是（提供 inferBonds）' : '否'));
console.log('js/parsers.js 已加载：' + (typeof MolCore.parseFile === 'function' ? '是' : '否'));
console.log('='.repeat(72));

/* ---------------------------- 1. 全局 API 形状 ---------------------------- */
group('1. 全局 API / ParseError 形状');

test('MolCore 暴露 §6.7 全部 API', function () {
  ok(typeof MolCore.ParseError === 'function', '缺少 MolCore.ParseError');
  ok(typeof MolCore.detectFormat === 'function', '缺少 MolCore.detectFormat');
  ok(typeof MolCore.parseFile === 'function', '缺少 MolCore.parseFile');
  ok(typeof MolCore.parseXYZ === 'function', '缺少 MolCore.parseXYZ');
  ok(typeof MolCore.parseSDF === 'function', '缺少 MolCore.parseSDF');
  ok(typeof MolCore.parseGJF === 'function', '缺少 MolCore.parseGJF');
  ok(typeof MolCore.parseLOG === 'function', '缺少 MolCore.parseLOG');
});

test('ParseError 继承 Error 且 name 为 ParseError', function () {
  const err = new MolCore.ParseError('测试错误');
  ok(err instanceof Error, 'ParseError 不是 Error 子类');
  ok(err instanceof MolCore.ParseError, 'instanceof 失败');
  eq(err.name, 'ParseError');
  eq(err.message, '测试错误');
});

test('core.js 提供 inferBonds / ELEMENTS（联调前提）', function () {
  ok(typeof MolCore.inferBonds === 'function', 'MolCore.inferBonds 不可用，解析器将退回内置推断');
  ok(MolCore.ELEMENTS && Object.keys(MolCore.ELEMENTS).length > 50, 'MolCore.ELEMENTS 元素表异常');
  ok(typeof MolCore.element === 'function', 'MolCore.element 不可用');
});

/* ---------------------------- 2. detectFormat ---------------------------- */
group('2. detectFormat 格式检测');

test('扩展名检测：xyz/sdf/mol/gjf/com/log/out', function () {
  eq(MolCore.detectFormat(fx('water.xyz'), 'water.xyz'), 'xyz');
  eq(MolCore.detectFormat(fx('benzene.sdf'), 'benzene.sdf'), 'sdf');
  eq(MolCore.detectFormat(fx('benzene.sdf'), 'benzene.mol'), 'sdf');
  eq(MolCore.detectFormat(fx('methanol.gjf'), 'methanol.gjf'), 'gjf');
  eq(MolCore.detectFormat(fx('methanol.gjf'), 'methanol.com'), 'gjf');
  eq(MolCore.detectFormat(fx('water.log'), 'water.log'), 'log');
  eq(MolCore.detectFormat(fx('water.log'), 'water.out'), 'log');
});

test('内容启发式检测（无扩展名/未知扩展名）', function () {
  eq(MolCore.detectFormat(fx('water.xyz')), 'xyz');
  eq(MolCore.detectFormat(fx('benzene.sdf')), 'sdf');
  eq(MolCore.detectFormat(fx('methanol.gjf')), 'gjf');
  eq(MolCore.detectFormat(fx('water.log')), 'log');
  eq(MolCore.detectFormat(fx('water.xyz'), 'mystery.txt'), 'xyz');
  eq(MolCore.detectFormat(fx('water.log'), 'mystery.txt'), 'log');
});

test('空/不可识别内容返回 null', function () {
  eq(MolCore.detectFormat(''), null);
  eq(MolCore.detectFormat('   \n\n  '), null);
  eq(MolCore.detectFormat('hello world, nothing to parse here'), null);
  eq(MolCore.detectFormat(null), null);
});

test('扩展名大小写不敏感', function () {
  eq(MolCore.detectFormat('', 'WATER.XYZ'), 'xyz');
  eq(MolCore.detectFormat('', 'a.GjF'), 'gjf');
});

/* ---------------------------- 3. XYZ ---------------------------- */
group('3. parseXYZ / parseFile(.xyz)');

test('water.xyz：原子数/元素/坐标/推断键', function () {
  const molecules = MolCore.parseXYZ(fx('water.xyz'));
  eq(molecules.length, 1);
  const mol = molecules[0];
  validateMolecule(mol, 'water.xyz');
  eq(mol.atoms.length, 3, '原子数');
  eq(mol.atoms.map(function (a) { return a.symbol; }), ['O', 'H', 'H'], '元素');
  approx(mol.atoms[0].z, 0.1173, 1e-6, 'O.z');
  approx(mol.atoms[1].y, 0.7572, 1e-6, 'H1.y');
  approx(mol.atoms[2].y, -0.7572, 1e-6, 'H2.y');
  eq(mol.title, 'water molecule (H2O), B3LYP/6-31G(d) geometry', 'title 应保存注释行');
  eq(mol.source, 'xyz');
  eq(mol.bondSource, 'inferred', 'XYZ 无显式键应标记 inferred');
  eq(mol.bonds.length, 2, '水分子应有 2 根 O-H 键');
  eq(mol.charge, 0);
  eq(mol.multiplicity, 1);
  eq(mol.energy, null);
  eq(mol.frameCount, 1);
});

test('water_traj.xyz：多帧 + 原子序数 + 科学计数法 + 帧元信息', function () {
  const molecules = MolCore.parseXYZ(fx('water_traj.xyz'));
  eq(molecules.length, 2, '应解析出 2 帧');
  eq(molecules[0].frameIndex, 0);
  eq(molecules[1].frameIndex, 1);
  eq(molecules[0].frameCount, 2);
  eq(molecules[1].frameCount, 2);
  validateMolecule(molecules[0], 'frame1');
  validateMolecule(molecules[1], 'frame2');
  approx(molecules[0].atoms[0].z, 0.1173, 1e-6, 'frame1 O.z');
  eq(molecules[0].title, 'water - frame 1 (initial guess)');
  eq(molecules[1].atoms.map(function (a) { return a.symbol; }), ['O', 'H', 'H'], '第二帧原子序数应转为元素符号');
  approx(molecules[1].atoms[0].z, 0.118, 1e-6, 'frame2 O.z 科学计数法');
  approx(molecules[1].atoms[1].y, 0.76, 1e-6, 'frame2 H1.y');
  eq(molecules[1].bonds.length, 2);
});

test('parseFile(water.xyz)：返回 {format, molecules, warnings}', function () {
  const result = MolCore.parseFile(fx('water.xyz'), { filename: 'water.xyz' });
  eq(result.format, 'xyz');
  eq(result.molecules.length, 1);
  ok(Array.isArray(result.warnings), 'warnings 应为数组');
  eq(result.warnings, [], '合法 XYZ 不应产生警告');
  validateMolecule(result.molecules[0], 'parseFile water');
});

test('XYZ 内联：科学计数法坐标', function () {
  const text = '2\nsci notation\nO 1.0E-1 -2.0e-2 +3.0e+0\nH 0.0D+0 0.0d0 1.5D-1\n';
  const molecules = MolCore.parseXYZ(text);
  eq(molecules.length, 1);
  approx(molecules[0].atoms[0].x, 0.1, 1e-12, 'O.x');
  approx(molecules[0].atoms[0].y, -0.02, 1e-12, 'O.y');
  approx(molecules[0].atoms[0].z, 3.0, 1e-12, 'O.z');
  approx(molecules[0].atoms[1].z, 0.15, 1e-12, 'H.z (D 指数)');
});

test('XYZ 内联：帧间无空行的连续多帧', function () {
  const text = '1\na\nH 0 0 0\n1\nb\nH 0 0 1\n1\nc\nH 0 0 2\n';
  const molecules = MolCore.parseXYZ(text);
  eq(molecules.length, 3);
  eq(molecules[2].title, 'c');
  approx(molecules[2].atoms[0].z, 2, 1e-12);
});

test('XYZ 内联：原子序数元素写法', function () {
  const molecules = MolCore.parseXYZ('2\nnumbers\n6 0 0 0\n1 1.09 0 0\n');
  eq(molecules[0].atoms.map(function (a) { return a.symbol; }), ['C', 'H']);
});

test('BOM + CRLF 的 XYZ 可正常解析', function () {
  const text = addBomAndCrlf(fx('water.xyz'));
  const result = MolCore.parseFile(text, { filename: 'water.xyz' });
  eq(result.molecules.length, 1);
  eq(result.molecules[0].atoms.length, 3);
  approx(result.molecules[0].atoms[0].z, 0.1173, 1e-6);
});

test('前后空行/空白的 XYZ 可正常解析', function () {
  const text = '\n\n   \n' + fx('water.xyz') + '\n\n   \n';
  const result = MolCore.parseFile(text);
  eq(result.format, 'xyz');
  eq(result.molecules[0].atoms.length, 3);
});

test('坏 XYZ（声明 5 个原子只有 2 行坐标）抛 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseXYZ(fx('bad.xyz'));
  }, /XYZ/, 'bad.xyz');
});

test('空 XYZ / 非数字首行 抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseXYZ(''); }, /XYZ/, '空文本');
  throwsParseError(function () { MolCore.parseXYZ('not-a-number\ncomment\nO 0 0 0\n'); }, /原子数/, '首行非数字');
});

test('XYZ 未知元素抛 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseXYZ('1\nxxx\nXx 0 0 0\n');
  }, /元素/, '未知元素');
});

/* ---------------------------- 4. SDF ---------------------------- */
group('4. parseSDF / parseFile(.sdf)');

test('benzene.sdf：12 原子 12 键 + 显式键 + 键级 1/2 + 1基转0基', function () {
  const molecules = MolCore.parseSDF(fx('benzene.sdf'));
  eq(molecules.length, 1);
  const mol = molecules[0];
  validateMolecule(mol, 'benzene.sdf');
  eq(mol.atoms.length, 12);
  eq(mol.bonds.length, 12, '键数应为 12');
  eq(mol.bondSource, 'explicit', 'SDF 有显式键应为 explicit');
  eq(mol.source, 'sdf');
  eq(mol.title, 'benzene');
  const carbonCount = mol.atoms.filter(function (a) { return a.symbol === 'C'; }).length;
  const hydrogenCount = mol.atoms.filter(function (a) { return a.symbol === 'H'; }).length;
  eq([carbonCount, hydrogenCount], [6, 6], '应为 C6H6');
  approx(mol.atoms[0].x, 1.396, 1e-6);
  eq(mol.bonds.filter(function (b) { return b.order === 2; }).length, 3, '应含 3 根双键');
  ok(mol.bonds.every(function (b) { return b.i < b.j; }), '所有键应满足 i<j');
});

test('multi.sdf：多记录 + M  CHG 电荷', function () {
  const result = MolCore.parseFile(fx('multi.sdf'), { filename: 'multi.sdf' });
  eq(result.format, 'sdf');
  eq(result.molecules.length, 2, '应解析出 2 条记录');
  eq(result.molecules.map(function (m) { return m.atoms.length; }), [3, 5]);
  eq(result.molecules.map(function (m) { return m.bonds.length; }), [2, 4]);
  eq(result.molecules[0].title, 'water');
  eq(result.molecules[1].title, 'ammonium cation');
  eq(result.molecules[0].charge, 0);
  eq(result.molecules[1].charge, 1, 'M  CHG 应解析出 +1 电荷');
  eq(result.molecules[0].frameIndex, 0);
  eq(result.molecules[1].frameIndex, 1);
  eq(result.molecules[0].frameCount, 2);
  validateMolecule(result.molecules[0], 'water record');
  validateMolecule(result.molecules[1], 'ammonium record');
});

test('SDF 内联：1 基转 0 基 + 芳香键级 4 + 去重', function () {
  const text = [
    'aromatic test',
    '  unit test',
    '',
    '  2  1  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.4000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '  2  1  4  0  0  0  0',
    'M  END',
    '$$$$'
  ].join('\n');
  const molecules = MolCore.parseSDF(text);
  eq(molecules.length, 1);
  eq(molecules[0].bonds.length, 1);
  eq(molecules[0].bonds[0], { i: 0, j: 1, order: 4 }, '键应为 0 基且芳香键级 4');
});

test('SDF 内联：最后一条缺少 $$$$ 时给出警告仍解析', function () {
  const text = [
    'no terminator',
    '  unit test',
    '',
    '  2  1  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.4000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    'M  END'
  ].join('\n');
  const warnings = [];
  const molecules = MolCore.parseSDF(text, warnings);
  eq(molecules.length, 1);
  eq(molecules[0].bonds.length, 1);
  ok(warnings.some(function (w) { return /\$\$\$\$/.test(w); }), '应提示缺少 $$$$ 结束标记：' + JSON.stringify(warnings));
});

test('SDF 内联：缺少 M  END 时给出警告', function () {
  const text = [
    'no mend',
    '  unit test',
    '',
    '  2  1  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.4000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    '$$$$'
  ].join('\n');
  const warnings = [];
  const molecules = MolCore.parseSDF(text, warnings);
  eq(molecules.length, 1);
  ok(warnings.some(function (w) { return /M\s+END/.test(w); }), '应提示缺少 M  END：' + JSON.stringify(warnings));
});

test('坏 SDF：V3000 抛明确中文 ParseError', function () {
  const err = throwsParseError(function () {
    MolCore.parseSDF(fx('bad_v3000.sdf'));
  }, /V3000/, 'V3000');
  ok(/暂不支持|仅支持 V2000/.test(err.message), '错误信息应说明仅支持 V2000：' + err.message);
});

test('坏 SDF：原子/键计数被截断抛 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseSDF('trunc\n prog\n\n  5  4  0  0  0  0  0  0  0  0999 V2000\n    0.0 0.0 0.0 C\n$$$$\n');
  }, /截断|不足/, '截断记录');
});

test('空 SDF 抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseSDF(''); }, /SDF/, '空文本');
});

test('BOM + CRLF 的 SDF 可正常解析', function () {
  const text = addBomAndCrlf(fx('benzene.sdf'));
  const result = MolCore.parseFile(text, { filename: 'benzene.sdf' });
  eq(result.format, 'sdf');
  eq(result.molecules[0].atoms.length, 12);
  eq(result.molecules[0].bonds.length, 12);
});

/* ---------------------------- 5. GJF ---------------------------- */
group('5. parseGJF / parseFile(.gjf/.com)');

test('methanol.gjf：%link0 / #p route / title / 电荷多重度 / connectivity', function () {
  const molecules = MolCore.parseGJF(fx('methanol.gjf'));
  eq(molecules.length, 1);
  const mol = molecules[0];
  validateMolecule(mol, 'methanol.gjf');
  eq(mol.atoms.length, 6);
  eq(mol.bonds.length, 5, '甲醇应有 5 根键（C-O、3×C-H、O-H）');
  eq(mol.bondSource, 'explicit', 'geom=connectivity 应给出显式键');
  eq(mol.charge, 0);
  eq(mol.multiplicity, 1);
  eq(mol.title, 'Methanol optimization (B3LYP/6-31G(d))');
  eq(mol.source, 'gjf');
  eq(mol.energy, null);
  /* 连接性段是双向列出的，必须去重 */
  ok(mol.bonds.every(function (b) { return b.i < b.j; }), '所有键应满足 i<j');
});

test('multi_job.gjf：--Link1-- 多 job、各自独立 charge/multiplicity', function () {
  const molecules = MolCore.parseGJF(fx('multi_job.gjf'));
  eq(molecules.length, 2, '应解析出 2 个 job');
  eq(molecules[0].atoms.length, 3);
  eq(molecules[1].atoms.length, 2);
  eq(molecules[0].charge, 0);
  eq(molecules[0].multiplicity, 1);
  eq(molecules[1].charge, -1, '第二个 job 电荷应为 -1');
  eq(molecules[1].multiplicity, 1);
  eq(molecules[0].bonds.length, 2);
  eq(molecules[1].bonds.length, 1);
  ok(/water/i.test(molecules[0].title), 'job1 标题：' + molecules[0].title);
  ok(/hydroxide/i.test(molecules[1].title), 'job2 标题：' + molecules[1].title);
  eq(molecules[0].frameCount, 2);
  eq(molecules[1].frameIndex, 1);
  eq(molecules[1].bondSource, 'explicit');
  validateMolecule(molecules[0], 'job1');
  validateMolecule(molecules[1], 'job2');
});

test('GJF 内联：无连接性段时按共价半径推断键（inferred）', function () {
  const text = [
    '#p hf/3-21g',
    '',
    'water without connectivity',
    '',
    '0 1',
    'O  0.000000  0.000000  0.117300',
    'H  0.000000  0.757200 -0.469200',
    'H  0.000000 -0.757200 -0.469200',
    ''
  ].join('\n');
  const molecules = MolCore.parseGJF(text);
  eq(molecules.length, 1);
  eq(molecules[0].bonds.length, 2);
  eq(molecules[0].bondSource, 'inferred');
});

test('GJF 内联：原子序数坐标 + 行尾额外字段容忍', function () {
  const text = [
    '%mem=1GB',
    '#p hf/3-21g',
    '',
    'atomic numbers with extra fields',
    '',
    '0 1',
    '8  0.000000  0.000000  0.117300   0  0',
    '1  0.000000  0.757200 -0.469200   0  0',
    '1  0.000000 -0.757200 -0.469200   0  0',
    ''
  ].join('\n');
  const molecules = MolCore.parseGJF(text);
  eq(molecules[0].atoms.map(function (a) { return a.symbol; }), ['O', 'H', 'H']);
  eq(molecules[0].bonds.length, 2);
});

test('GJF 内联：连接性段键级 2.0 -> order 2（双向去重）', function () {
  const text = [
    '#p hf/3-21g geom=connectivity',
    '',
    'formaldehyde',
    '',
    '0 1',
    'C  0.000000  0.000000  0.000000',
    'O  0.000000  0.000000  1.210000',
    'H -0.940000  0.000000 -0.540000',
    'H  0.940000  0.000000 -0.540000',
    '',
    '1 2 2.0 3 1.0 4 1.0',
    '2 1 2.0',
    '3 1 1.0',
    '4 1 1.0',
    ''
  ].join('\n');
  const molecules = MolCore.parseGJF(text);
  eq(molecules.length, 1);
  eq(molecules[0].bonds.length, 3, 'C=O + 2×C-H = 3 根键');
  const doubleBond = molecules[0].bonds.filter(function (b) { return b.order === 2; });
  eq(doubleBond.length, 1, '应恰有 1 根双键');
});

test('坏 GJF：Z-matrix 输入抛明确中文 ParseError', function () {
  const err = throwsParseError(function () {
    MolCore.parseGJF(fx('bad_zmatrix.gjf'));
  }, /Z-matrix/, 'Z-matrix');
  ok(/笛卡尔|内坐标/.test(err.message), '错误信息应说明仅支持笛卡尔坐标：' + err.message);
});

test('GJF 内联：空标题（route 后直接电荷行）可解析', function () {
  const text = '#p hf/3-21g\n\n0 1\nH 0.000000 0.000000 0.000000\n\n';
  const molecules = MolCore.parseGJF(text);
  eq(molecules.length, 1);
  eq(molecules[0].title, '');
  eq(molecules[0].atoms.length, 1);
});

test('GJF 内联：geom=allcheck 的 Link1 job 跳过并给警告', function () {
  const text = [
    '%chk=allcheck.chk',
    '#p hf/3-21g',
    '',
    'job 1',
    '',
    '0 1',
    'H 0.000000 0.000000 0.000000',
    '',
    '--Link1--',
    '%chk=allcheck.chk',
    '#p hf/3-21g geom=allcheck guess=read',
    '',
    'job 2 reuses geometry',
    ''
  ].join('\n');
  const warnings = [];
  const molecules = MolCore.parseGJF(text, warnings);
  eq(molecules.length, 1, 'allcheck job 无内嵌几何应跳过');
  eq(molecules[0].atoms.length, 1);
  ok(warnings.some(function (w) { return /allcheck/.test(w); }), '应警告跳过 allcheck job：' + JSON.stringify(warnings));
});

test('坏 GJF：缺少 route 抛 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseGJF('no route here\n\njust some text\n\n0 1\nC 0 0 0\n');
  }, /route|路由/, '缺少 route');
});

test('空 GJF 抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseGJF(''); }, /Gaussian 输入/, '空文本');
});

test('parseFile(methanol.gjf / .com)：格式与结果正确', function () {
  const result = MolCore.parseFile(fx('methanol.gjf'), { filename: 'methanol.gjf' });
  eq(result.format, 'gjf');
  eq(result.molecules[0].atoms.length, 6);
  eq(result.molecules[0].bonds.length, 5);
  const viaCom = MolCore.parseFile(fx('methanol.gjf'), { filename: 'methanol.com' });
  eq(viaCom.format, 'gjf', '.com 应归一化为 gjf');
  const viaFormat = MolCore.parseFile(fx('methanol.gjf'), { format: 'com' });
  eq(viaFormat.format, 'gjf', 'format 别名 com 应归一化为 gjf');
});

test('BOM + CRLF 的 GJF 可正常解析', function () {
  const text = addBomAndCrlf(fx('methanol.gjf'));
  const result = MolCore.parseFile(text, { filename: 'methanol.gjf' });
  eq(result.molecules[0].atoms.length, 6);
  eq(result.molecules[0].bonds.length, 5);
});

/* ---------------------------- 6. LOG ---------------------------- */
group('6. parseLOG / parseFile(.log)');

test('water.log：2 个 Standard orientation 帧 + 能量 + charge/multiplicity', function () {
  const result = MolCore.parseFile(fx('water.log'), { filename: 'water.log' });
  eq(result.format, 'log');
  eq(result.molecules.length, 2, '2 个 Standard orientation 块应产生 2 帧');
  const first = result.molecules[0];
  const last = result.molecules[1];
  validateMolecule(first, 'log frame1');
  validateMolecule(last, 'log frame2');
  eq(first.atoms.length, 3);
  eq(last.atoms.length, 3);
  eq(first.atoms.map(function (a) { return a.symbol; }), ['O', 'H', 'H']);
  eq(first.source, 'log');
  eq(first.charge, 0);
  eq(first.multiplicity, 1);
  eq(first.bondSource, 'inferred', 'LOG 无显式键应为 inferred');
  eq(first.bonds.length, 2);
  eq(last.bonds.length, 2, '最后一帧也应有 2 根键');
  eq(first.frameIndex, 0);
  eq(last.frameIndex, 1);
  eq(first.frameCount, 2);
  eq(last.frameCount, 2);
  approx(first.energy, -76.4087956321, 1e-9, '第一帧 SCF 能量');
  approx(last.energy, -76.4091234567, 1e-9, '最后一帧 SCF 能量');
  /* 最后一帧是最终（优化后）结构 */
  approx(last.atoms[0].z, 0.118, 1e-9, '最后一帧 O.z');
  approx(last.atoms[1].y, 0.76, 1e-9, '最后一帧 H1.y');
  ok(/water/i.test(first.title), '应从日志提取标题，实际："' + first.title + '"');
});

test('failed.log：无 Standard orientation 时回退最后一个 Input orientation', function () {
  const warnings = [];
  const molecules = MolCore.parseLOG(fx('failed.log'), warnings);
  eq(molecules.length, 1, '回退应只产生 1 帧');
  const mol = molecules[0];
  validateMolecule(mol, 'failed.log');
  eq(mol.atoms.length, 4);
  eq(mol.atoms.map(function (a) { return a.symbol; }), ['N', 'H', 'H', 'H']);
  eq(mol.charge, 0);
  eq(mol.multiplicity, 1);
  eq(mol.bonds.length, 3, 'NH3 应有 3 根 N-H 键');
  ok(mol.energy !== null, '失败任务也应尽量给出 SCF 能量');
  approx(mol.energy, -55.9887654321, 1e-9);
  ok(warnings.some(function (w) { return /Input orientation/.test(w) && /回退/.test(w); }),
    '应警告已回退到 Input orientation：' + JSON.stringify(warnings));
});

test('failed.log：parseFile 警告含未正常终止提示', function () {
  const result = MolCore.parseFile(fx('failed.log'), { filename: 'failed.log' });
  eq(result.molecules.length, 1);
  ok(result.warnings.some(function (w) { return /Normal termination/.test(w); }),
    '警告应提到缺少 Normal termination：' + JSON.stringify(result.warnings));
  ok(result.warnings.some(function (w) { return /Input orientation/.test(w); }),
    '警告应提到 Input orientation 回退：' + JSON.stringify(result.warnings));
});

test('bad_empty.log：无几何结构抛中文 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseLOG(fx('bad_empty.log'));
  }, /Standard orientation|Input orientation/, '无几何日志');
});

test('空 LOG 抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseLOG(''); }, /Gaussian 日志/, '空文本');
});

test('LOG 内联：有 Standard orientation 但无 Normal termination 仍解析', function () {
  const log = [
    ' #p opt hf/3-21g',
    '',
    ' truncated job',
    '',
    ' 0 1',
    '',
    '                         Standard orientation:                         ',
    ' ---------------------------------------------------------------------',
    ' Center     Atomic      Atomic             Coordinates (Angstroms)',
    ' Number     Number       Type             X           Y           Z',
    ' ---------------------------------------------------------------------',
    '      1          8           0        0.000000    0.000000    0.117300',
    '      2          1           0        0.000000    0.757200   -0.469200',
    '      3          1           0        0.000000   -0.757200   -0.469200',
    ' ---------------------------------------------------------------------',
    '',
    ' SCF Done:  E(RHF) =  -75.1234567890     A.U. after    8 cycles',
    ''
  ].join('\n');
  const result = MolCore.parseFile(log, { format: 'log' });
  eq(result.molecules.length, 1);
  eq(result.molecules[0].atoms.length, 3);
  approx(result.molecules[0].energy, -75.1234567890, 1e-9);
  ok(result.warnings.some(function (w) { return /Normal termination/.test(w); }),
    '应警告缺少 Normal termination：' + JSON.stringify(result.warnings));
});

test('BOM + CRLF 的 LOG 可正常解析', function () {
  const text = addBomAndCrlf(fx('water.log'));
  const result = MolCore.parseFile(text, { filename: 'water.log' });
  eq(result.molecules.length, 2);
  eq(result.molecules[1].atoms.length, 3);
});

/* ---------------------------- 7. parseFile 边界/健壮性 ---------------------------- */
group('7. parseFile 健壮性与边界');

test('parseFile：未提供 format 时按内容自动识别四格式', function () {
  const cases = [
    ['water.xyz', 'xyz'],
    ['benzene.sdf', 'sdf'],
    ['methanol.gjf', 'gjf'],
    ['water.log', 'log']
  ];
  cases.forEach(function (pair) {
    const result = MolCore.parseFile(fx(pair[0]));
    eq(result.format, pair[1], pair[0] + ' 自动识别');
  });
});

test('parseFile：format 显式优先（错误 format 会按对应解析器报错）', function () {
  throwsParseError(function () {
    MolCore.parseFile(fx('water.xyz'), { format: 'sdf' });
  }, /SDF|V2000/, 'xyz 内容按 sdf 解析');
});

test('parseFile：不支持/未知的 format 抛 ParseError', function () {
  throwsParseError(function () {
    MolCore.parseFile('whatever', { format: 'pdb' });
  }, /不支持/, '未知 format');
});

test('parseFile：非字符串输入抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseFile(null); }, /不是文本/, 'null');
  throwsParseError(function () { MolCore.parseFile(undefined); }, /不是文本/, 'undefined');
});

test('parseFile：空文本且无 format 抛 ParseError', function () {
  throwsParseError(function () { MolCore.parseFile(''); }, /无法识别|无法解析/, '空文本');
  throwsParseError(function () { MolCore.parseFile('   \n\n '); }, /无法识别|无法解析/, '纯空白');
});

test('parseFile：空文本 + format 抛 ParseError（不是静默返回空）', function () {
  throwsParseError(function () { MolCore.parseFile('', { format: 'xyz' }); }, /XYZ/, '空 xyz');
});

test('parseFile 返回值恒含 warnings 数组且 molecules 至少 1 个', function () {
  const inputs = [
    ['water.xyz', { filename: 'water.xyz' }],
    ['benzene.sdf', { filename: 'benzene.sdf' }],
    ['methanol.gjf', { filename: 'methanol.gjf' }],
    ['water.log', { filename: 'water.log' }]
  ];
  inputs.forEach(function (pair) {
    const result = MolCore.parseFile(fx(pair[0]), pair[1]);
    ok(Array.isArray(result.warnings), pair[0] + ' warnings 应为数组');
    ok(result.molecules.length >= 1, pair[0] + ' molecules 至少 1 个');
    eq(result.molecules[0].frameCount, result.molecules.length, pair[0] + ' frameCount 应为记录数');
  });
});

test('大文件：300 原子 XYZ 能解析且键数合理', function () {
  const atomCount = 300;
  const lines = [String(atomCount), 'large linear carbon chain'];
  for (let i = 0; i < atomCount; i++) {
    lines.push('C ' + (i * 1.5).toFixed(6) + ' 0.000000 0.000000');
  }
  const started = Date.now();
  const molecules = MolCore.parseXYZ(lines.join('\n') + '\n');
  const elapsed = Date.now() - started;
  eq(molecules.length, 1);
  eq(molecules[0].atoms.length, atomCount);
  /* 相邻 C-C 1.5Å 成键，次近邻 3.0Å 不成键 */
  eq(molecules[0].bonds.length, atomCount - 1, '线性碳链应推断出 ' + (atomCount - 1) + ' 根键');
  console.log('       ℹ️  300 原子解析 + 键推断耗时 ' + elapsed + ' ms');
});

test('大日志：200 个 orientation 帧可解析且帧元信息正确', function () {
  const frameCount = 200;
  const parts = [
    ' Entering Gaussian System, Link 0=g16',
    ' ******************************************',
    ' Gaussian 16:  ES64L-G16RevA.03 25-Dec-2016',
    ' ******************************************',
    ' #p opt hf/3-21g',
    '',
    ' large log test',
    '',
    ' 0 1'
  ];
  for (let f = 0; f < frameCount; f++) {
    const z = (0.1 + f * 0.001).toFixed(6);
    parts.push('                         Standard orientation:                         ');
    parts.push(' ---------------------------------------------------------------------');
    parts.push(' Center     Atomic      Atomic             Coordinates (Angstroms)');
    parts.push(' Number     Number       Type             X           Y           Z');
    parts.push(' ---------------------------------------------------------------------');
    parts.push('      1          8           0        0.000000    0.000000    ' + z);
    parts.push('      2          1           0        0.000000    0.757200   -0.469200');
    parts.push('      3          1           0        0.000000   -0.757200   -0.469200');
    parts.push(' ---------------------------------------------------------------------');
    parts.push(' SCF Done:  E(RHF) =  -76.4000' + String(f).padStart(4, '0') + '     A.U. after    6 cycles');
    parts.push('');
  }
  parts.push(' Normal termination of Gaussian 16 at Thu Nov 13 10:10:00 2025.');
  const started = Date.now();
  const molecules = MolCore.parseLOG(parts.join('\n'));
  const elapsed = Date.now() - started;
  eq(molecules.length, frameCount, '应解析出 ' + frameCount + ' 帧');
  eq(molecules[0].frameIndex, 0);
  eq(molecules[frameCount - 1].frameIndex, frameCount - 1);
  eq(molecules[frameCount - 1].frameCount, frameCount);
  eq(molecules[frameCount - 1].atoms.length, 3);
  approx(molecules[frameCount - 1].atoms[0].z, 0.1 + (frameCount - 1) * 0.001, 1e-9, '最后一帧坐标');
  ok(molecules[frameCount - 1].energy !== null, '最后一帧应有 SCF 能量');
  console.log('       ℹ️  ' + frameCount + ' 帧日志解析耗时 ' + elapsed + ' ms');
});

test('bind fallback：core.inferBonds 不可用时会回退内置推断并给警告', function () {
  const original = MolCore.inferBonds;
  const warnings = [];
  try {
    MolCore.inferBonds = undefined;
    const molecules = MolCore.parseXYZ(fx('water.xyz'), warnings);
    eq(molecules[0].bonds.length, 2, '内置回退也应推断出 2 根 O-H 键');
    eq(molecules[0].bondSource, 'inferred');
    ok(warnings.some(function (w) { return /内置/.test(w); }), '应提示使用内置回退：' + JSON.stringify(warnings));
  } finally {
    MolCore.inferBonds = original;
  }
  ok(typeof MolCore.inferBonds === 'function', 'inferBonds 应已恢复');
});

test('坐标数值有限性：解析结果不含 NaN/Infinity', function () {
  const result = MolCore.parseFile(fx('multi_job.gjf'), { filename: 'multi_job.gjf' });
  result.molecules.forEach(function (mol) {
    mol.atoms.forEach(function (atom) {
      ok(isFinite(atom.x) && isFinite(atom.y) && isFinite(atom.z), '出现非法坐标：' + JSON.stringify(atom));
    });
  });
});

test('垃圾输入：detectFormat 不抛异常，解析器只抛 ParseError', function () {
  const junkInputs = [
    '\u0000\u0001garbage\u0002',
    '3\n\n',
    'V2000',
    '$$$$',
    '%chk=x',
    '#p opt\n',
    '1\nH\n',
    'Standard orientation:\n',
    'Center Atomic Coordinates\n',
    '-----\n-----',
    '99999999999\nhuge count\nC 0 0 0\n',
    '-1\nnegative count\n'
  ];
  junkInputs.forEach(function (junk) {
    /* detectFormat 必须安全返回 null 或四种格式之一 */
    let detected = null;
    try {
      detected = MolCore.detectFormat(junk);
    } catch (err) {
      throw new Error('detectFormat 对垃圾输入抛异常：' + JSON.stringify(junk) + ' -> ' + err);
    }
    ok(detected === null || ['xyz', 'sdf', 'gjf', 'log'].indexOf(detected) >= 0,
      'detectFormat 返回非法值：' + detected);
  });

  const parsers = [
    ['parseXYZ', MolCore.parseXYZ],
    ['parseSDF', MolCore.parseSDF],
    ['parseGJF', MolCore.parseGJF],
    ['parseLOG', MolCore.parseLOG]
  ];
  parsers.forEach(function (entry) {
    junkInputs.forEach(function (junk) {
      try {
        entry[1](junk);
      } catch (err) {
        if (!(err instanceof MolCore.ParseError)) {
          throw new Error(entry[0] + ' 对垃圾输入抛出了非 ParseError：' +
            JSON.stringify(junk) + ' -> ' + (err && err.name) + ': ' + (err && err.message));
        }
      }
    });
  });
});

/* ---------------------------- 8. 与 core.js 导出回环 ---------------------------- */
group('8. 与 core.js 导出回环（export -> parse）');

const hasExport = MolCore.export && typeof MolCore.export.xyz === 'function' &&
  typeof MolCore.export.gjf === 'function' && typeof MolCore.export.sdf === 'function';
if (!hasExport) {
  console.log('  ⚠️  MolCore.export 不可用，跳过导出回环测试');
} else {
  test('export.xyz -> parseXYZ 回环（坐标/键一致）', function () {
    const source = MolCore.parseFile(fx('water.xyz'), { filename: 'water.xyz' }).molecules[0];
    const text = MolCore.export.xyz(source);
    const molecules = MolCore.parseXYZ(text);
    eq(molecules.length, 1);
    eq(molecules[0].atoms.length, 3);
    eq(molecules[0].atoms.map(function (a) { return a.symbol; }),
      source.atoms.map(function (a) { return a.symbol; }));
    for (let i = 0; i < 3; i++) {
      approx(molecules[0].atoms[i].x, source.atoms[i].x, 1e-6, 'atom' + i + '.x');
      approx(molecules[0].atoms[i].y, source.atoms[i].y, 1e-6, 'atom' + i + '.y');
      approx(molecules[0].atoms[i].z, source.atoms[i].z, 1e-6, 'atom' + i + '.z');
    }
    eq(molecules[0].bonds.length, 2);
  });

  test('export.gjf -> parseGJF 回环（显式键 + 键级保留）', function () {
    const source = MolCore.parseFile(fx('benzene.sdf'), { filename: 'benzene.sdf' }).molecules[0];
    const text = MolCore.export.gjf(source);
    const molecules = MolCore.parseGJF(text);
    eq(molecules.length, 1);
    eq(molecules[0].atoms.length, 12);
    eq(molecules[0].bonds.length, 12);
    eq(molecules[0].bondSource, 'explicit', '导出的 gjf 带 connectivity 应解析为显式键');
    eq(molecules[0].bonds.filter(function (b) { return b.order === 2; }).length, 3, '双键键级应保留');
    eq(molecules[0].charge, source.charge);
    eq(molecules[0].multiplicity, source.multiplicity);
  });

  test('export.sdf -> parseSDF 回环（V2000 显式键）', function () {
    const source = MolCore.parseFile(fx('benzene.sdf'), { filename: 'benzene.sdf' }).molecules[0];
    const text = MolCore.export.sdf(source);
    const molecules = MolCore.parseSDF(text);
    eq(molecules.length, 1);
    eq(molecules[0].atoms.length, 12);
    eq(molecules[0].bonds.length, 12);
    eq(molecules[0].bondSource, 'explicit');
    eq(molecules[0].bonds.filter(function (b) { return b.order === 2; }).length, 3);
  });
}

/* ---------------------------- 9. samples/ 示例回环 ---------------------------- */
group('9. samples/ 示例文件解析');

const SAMPLES_DIR = path.join(ROOT, 'samples');
let sampleFiles = [];
if (fs.existsSync(SAMPLES_DIR)) {
  sampleFiles = fs.readdirSync(SAMPLES_DIR).filter(function (name) {
    return /\.(xyz|sdf|mol|gjf|com|log|out)$/i.test(name);
  });
}

if (sampleFiles.length === 0) {
  console.log('  ⚠️  samples/ 目录不存在或没有示例文件，跳过示例解析测试');
} else {
  const EXPECTED_SAMPLES = {
    'water.xyz': { format: 'xyz', atoms: 3 },
    'butane.xyz': { format: 'xyz', atoms: 14 },
    'benzene.sdf': { format: 'sdf', atoms: 12, bonds: 12, bondSource: 'explicit' },
    'methane.gjf': { format: 'gjf', atoms: 5, bonds: 4, bondSource: 'inferred' },
    'methanol.gjf': { format: 'gjf', atoms: 6, bonds: 5, bondSource: 'explicit' },
    'water.log': { format: 'log', atoms: 3, minFrames: 2 }
  };
  sampleFiles.forEach(function (name) {
    test('samples/' + name, function () {
      const text = fs.readFileSync(path.join(SAMPLES_DIR, name), 'utf8');
      const result = MolCore.parseFile(text, { filename: name });
      ok(result.molecules.length >= 1, name + ' 未解析出分子');
      result.molecules.forEach(function (mol, idx) {
        validateMolecule(mol, name + '#' + idx);
      });
      const expected = EXPECTED_SAMPLES[name];
      if (expected) {
        eq(result.format, expected.format, name + ' format');
        eq(result.molecules[0].atoms.length, expected.atoms, name + ' 首帧原子数');
        if (expected.bonds != null) eq(result.molecules[0].bonds.length, expected.bonds, name + ' 键数');
        if (expected.bondSource) eq(result.molecules[0].bondSource, expected.bondSource, name + ' bondSource');
        if (expected.minFrames) ok(result.molecules.length >= expected.minFrames,
          name + ' 帧数应 >= ' + expected.minFrames + '，实际 ' + result.molecules.length);
      }
      console.log('       ℹ️  ' + name + ' -> ' + result.format + '，' +
        result.molecules.length + ' 个分子/帧；' + renderMoleculeList(result.molecules) +
        (result.warnings.length ? '；警告 ' + result.warnings.length + ' 条' : '；无警告'));
    });
  });
}

/* ---------------------------- 汇总 ---------------------------- */
console.log('\n' + '='.repeat(72));
if (failures.length > 0) {
  console.log('❌ 测试失败：' + failures.length + ' 个失败 / ' + passed + ' 个通过');
  failures.forEach(function (failure, index) {
    console.log('   ' + (index + 1) + ') [' + failure.group + '] ' + failure.name);
    console.log('      ' + (failure.error && failure.error.message ? failure.error.message : failure.error));
  });
  process.exit(1);
} else {
  console.log('✅ 全部测试通过：' + passed + ' / ' + passed);
  process.exit(0);
}
