/* MolEdit — tests/core.test.mjs
 * 运行：node tests/core.test.mjs
 * 覆盖：元素表、向量、键推断、测量、几何编辑（键长/键角/二面角）、退化与非法输入、导出、片段。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MolCore = require('../js/core.js');

const DEG = Math.PI / 180;
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✅ ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('❌ ' + name + ' :: ' + (err && err.message ? err.message : err));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function near(actual, expected, tol, msg) {
  if (typeof actual !== 'number' || !isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error((msg || '数值不符') + `：期望 ${expected} ± ${tol}，实际 ${actual}`);
  }
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(msg || '应当抛出错误但没有');
}
function atom(symbol, x, y, z) { return { symbol, x, y, z }; }

// ---------- 元素表 ----------
test('元素表：118 个元素，编号/符号/中文名/颜色/半径齐全', () => {
  const els = MolCore.getElements();
  assert(els.length === 118, '元素数量应为 118，实际 ' + els.length);
  const h = MolCore.element('H');
  assert(h && h.atomicNumber === 1 && h.name === '氢' && h.color === '#ffffff', 'H 元素数据错误');
  const c = MolCore.element('c');
  assert(c && c.atomicNumber === 6 && c.covalent === 0.76, '大小写不敏感查询失败');
  const o = MolCore.element(8);
  assert(o && o.symbol === 'O', '原子序数查询失败');
  assert(MolCore.symbolForZ(26) === 'Fe', 'Z=26 应为 Fe');
  assert(MolCore.symbolForZ(118) === 'Og', 'Z=118 应为 Og');
  assert(MolCore.element('Xx') === null, '未知元素应返回 null');
  assert(els[0].atomicNumber === 1 && els[117].atomicNumber === 118, '元素顺序错误');
});

// ---------- 向量 ----------
test('向量：rotateAroundAxis 正确（右手定则）', () => {
  const p = MolCore.vec.rotateAroundAxis([1, 0, 0], [0, 0, 0], [0, 0, 1], 90 * DEG);
  near(p[0], 0, 1e-9); near(p[1], 1, 1e-9); near(p[2], 0, 1e-9);
  const q = MolCore.vec.rotateAroundAxis([1, 0, 0], [1, 0, 0], [1, 0, 0], 123);
  near(q[0], 1, 1e-9, '轴上点不动');
});

// ---------- 键推断 ----------
test('键推断：水 2 键、甲烷 4 键、苯环 12 键', () => {
  const water = {
    atoms: [atom('O', 0, 0, 0), atom('H', 0.9572, 0, 0), atom('H', -0.2395, 0.9275, 0)],
    bonds: []
  };
  const wb = MolCore.inferBonds(water);
  assert(wb.length === 2, '水应为 2 个键，实际 ' + wb.length);
  const methane = {
    atoms: [
      atom('C', 0, 0, 0),
      atom('H', 0.629, 0.629, 0.629), atom('H', -0.629, -0.629, 0.629),
      atom('H', -0.629, 0.629, -0.629), atom('H', 0.629, -0.629, -0.629)
    ],
    bonds: []
  };
  assert(MolCore.inferBonds(methane).length === 4, '甲烷应为 4 个键');
  // 苯环
  const atoms = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * DEG;
    atoms.push(atom('C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * DEG;
    atoms.push(atom('H', 2.48 * Math.cos(a), 2.48 * Math.sin(a), 0));
  }
  const benzene = { atoms, bonds: [] };
  assert(MolCore.inferBonds(benzene).length === 12, '苯应为 12 个键');
});

test('rebond 保留可存活键级', () => {
  const mol = {
    atoms: [atom('C', 0, 0, 0), atom('C', 0, 0, 1.4), atom('H', 1.09, 0, 0)],
    bonds: [{ i: 0, j: 1, order: 2 }, { i: 0, j: 2, order: 1 }]
  };
  MolCore.rebond(mol);
  assert(mol.bonds.length === 2, 'rebond 后应仍 2 键');
  const bb = MolCore.bondBetween(mol, 0, 1);
  assert(bb && bb.order === 2, 'C=C 键级应保留 2');
  assert(mol.bondSource === 'inferred', 'bondSource 应为 inferred');
});

// ---------- 测量 ----------
function waterMol() {
  const th = 104.52 * DEG;
  const r = 0.9572;
  return {
    atoms: [
      atom('O', 0, 0, 0),
      atom('H', r, 0, 0),
      atom('H', r * Math.cos(th), r * Math.sin(th), 0)
    ],
    bonds: [{ i: 0, j: 1, order: 1 }, { i: 0, j: 2, order: 1 }],
    bondSource: 'explicit', charge: 0, multiplicity: 1, source: 'xyz', title: 'water'
  };
}

test('测量：水键长 0.9572、键角 104.52', () => {
  const mol = waterMol();
  near(MolCore.measure.distance(mol, 0, 1), 0.9572, 1e-4);
  near(MolCore.measure.angle(mol, 1, 0, 2), 104.52, 1e-3);
});

test('测量：二面角符号（顺式 0、反式 180、旋转 +90）', () => {
  const mol = {
    atoms: [
      atom('A', 0, 1.5, 0),   // 实际上用 C/H 均可，元素不影响几何
      atom('B', 0, 0, 0),
      atom('C', 1.5, 0, 0),
      atom('D', 1.5, 1.2, 0)
    ],
    bonds: []
  };
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), 0, 1e-6, '顺式应为 0');
  mol.atoms[3].y = -1.2;
  near(Math.abs(MolCore.measure.dihedral(mol, 0, 1, 2, 3)), 180, 1e-6, '反式应为 180');
  mol.atoms[3].y = 0; mol.atoms[3].z = 1.2;
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), 90, 1e-6, 'D 在 +z 应为 +90');
  mol.atoms[3].z = -1.2;
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), -90, 1e-6, 'D 在 -z 应为 -90');
});

// ---------- 几何编辑 ----------
test('编辑：setBondLength 1.2 精确往返，其他键长不变', () => {
  const mol = waterMol();
  const before01 = MolCore.measure.distance(mol, 0, 1);
  MolCore.edit.setBondLength(mol, 0, 2, 1.2);
  near(MolCore.measure.distance(mol, 0, 2), 1.2, 1e-9);
  near(MolCore.measure.distance(mol, 0, 1), before01, 1e-12, '未参与编辑的键长不应变化');
});

test('编辑：setBondLength 移动 i 侧 / smaller 侧', () => {
  const mol = waterMol();
  MolCore.edit.setBondLength(mol, 0, 1, 1.5, { moveSide: 'i' });
  near(MolCore.measure.distance(mol, 0, 1), 1.5, 1e-9);
  const mol2 = waterMol();
  MolCore.edit.setBondLength(mol2, 0, 1, 1.1, { moveSide: 'smaller' });
  near(MolCore.measure.distance(mol2, 0, 1), 1.1, 1e-9);
});

test('编辑：setBondAngle 120 精确往返，键长不变', () => {
  const mol = waterMol();
  const r1 = MolCore.measure.distance(mol, 0, 1);
  const r2 = MolCore.measure.distance(mol, 0, 2);
  MolCore.edit.setBondAngle(mol, 1, 0, 2, 120);
  near(MolCore.measure.angle(mol, 1, 0, 2), 120, 1e-6);
  near(MolCore.measure.distance(mol, 0, 1), r1, 1e-9);
  near(MolCore.measure.distance(mol, 0, 2), r2, 1e-9);
  // 再改到 90，i 侧移动
  MolCore.edit.setBondAngle(mol, 1, 0, 2, 90, { moveSide: 'i' });
  near(MolCore.measure.angle(mol, 1, 0, 2), 90, 1e-6);
  near(MolCore.measure.distance(mol, 0, 2), r2, 1e-9, '移动 i 侧时 O-H2 键长不变');
});

test('编辑：共线原子（当前 0°）也能设置键角 90/150', () => {
  const mol = {
    atoms: [atom('C', 1, 0, 0), atom('C', 0, 0, 0), atom('C', 2, 0, 0)],
    bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }]
  };
  near(MolCore.measure.angle(mol, 0, 1, 2), 0, 1e-9);
  MolCore.edit.setBondAngle(mol, 0, 1, 2, 90);
  near(MolCore.measure.angle(mol, 0, 1, 2), 90, 1e-6);
  MolCore.edit.setBondAngle(mol, 0, 1, 2, 150);
  near(MolCore.measure.angle(mol, 0, 1, 2), 150, 1e-6);
});

test('编辑：setDihedral 60 / -60 / 180 / 0 精确往返，键长键角不变', () => {
  const mol = {
    atoms: [
      atom('C', 0, 1.4, -0.3),
      atom('C', 0, 0, 0),
      atom('C', 1.54, 0, 0),
      atom('C', 2.2, 1.2, 0.6)
    ],
    bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 }]
  };
  const r01 = MolCore.measure.distance(mol, 0, 1);
  const a012 = MolCore.measure.angle(mol, 0, 1, 2);
  const a123 = MolCore.measure.angle(mol, 1, 2, 3);
  for (const target of [60, -60, 180, 0, 135]) {
    MolCore.edit.setDihedral(mol, 0, 1, 2, 3, target);
    near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), target, 1e-6, '目标二面角 ' + target);
    near(MolCore.measure.distance(mol, 0, 1), r01, 1e-9, 'C-C 键长不变');
    near(MolCore.measure.angle(mol, 0, 1, 2), a012, 1e-9, '键角不变');
    near(MolCore.measure.angle(mol, 1, 2, 3), a123, 1e-9, '键角不变');
  }
  // a 侧旋转
  MolCore.edit.setDihedral(mol, 0, 1, 2, 3, -45, { moveSide: 'a' });
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), -45, 1e-6);
  // smaller 侧
  MolCore.edit.setDihedral(mol, 0, 1, 2, 3, 75, { moveSide: 'smaller' });
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), 75, 1e-6);
});

test('编辑：含支链片段旋转时其余几何保持（异丙醇风格）', () => {
  const mol = {
    atoms: [
      atom('C', 0, 0, 0), atom('C', 1.5, 0, 0), atom('C', 2.2, 1.2, 0), atom('O', 3.5, 1.0, 0),
      atom('H', -0.5, 1.0, 0), atom('H', 1.8, -0.8, 0.9), atom('H', 2.3, 1.5, 1.1)
    ],
    bonds: [
      { i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 },
      { i: 0, j: 4, order: 1 }, { i: 1, j: 5, order: 1 }, { i: 2, j: 6, order: 1 }
    ]
  };
  const r12 = MolCore.measure.distance(mol, 1, 2);
  const a012 = MolCore.measure.angle(mol, 0, 1, 2);
  MolCore.edit.setDihedral(mol, 0, 1, 2, 3, 120);
  near(MolCore.measure.dihedral(mol, 0, 1, 2, 3), 120, 1e-6);
  near(MolCore.measure.distance(mol, 1, 2), r12, 1e-9);
  near(MolCore.measure.angle(mol, 0, 1, 2), a012, 1e-9);
});

test('编辑：退化/非法输入抛错且不修改分子', () => {
  const mol = waterMol();
  const snapshot = JSON.stringify(mol.atoms);
  throws(() => MolCore.edit.setBondLength(mol, 0, 1, -1), '负键长应报错');
  throws(() => MolCore.edit.setBondLength(mol, 0, 1, NaN), 'NaN 应报错');
  throws(() => MolCore.edit.setBondAngle(mol, 0, 1, 2, 200), '键角 >180 应报错');
  throws(() => MolCore.edit.setBondAngle(mol, 0, 1, 0, 90), '重复原子应报错');
  throws(() => MolCore.edit.setDihedral(mol, 0, 1, 2, 3, 60), '索引越界应报错');
  assert(JSON.stringify(mol.atoms) === snapshot, '抛错后分子不应被修改');

  // B、C 重合
  const bad = { atoms: [atom('C', 0, 0, 0), atom('C', 1, 0, 0), atom('C', 1, 0, 0), atom('C', 2, 1, 0)], bonds: [] };
  throws(() => MolCore.edit.setDihedral(bad, 0, 1, 2, 3, 60), 'B=C 重合应报错');
  // 键长方向零向量
  const bad2 = { atoms: [atom('C', 1, 1, 1), atom('C', 1, 1, 1)], bonds: [] };
  throws(() => MolCore.edit.setBondLength(bad2, 0, 1, 1.2), '原子重合应报错');
});

// ---------- 片段 ----------
test('片段：fragmentAfterCut / components', () => {
  const mol = {
    atoms: [atom('C', 0, 0, 0), atom('C', 1.5, 0, 0), atom('C', 3.0, 0, 0), atom('C', 4.5, 0, 0)],
    bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 }]
  };
  assert(JSON.stringify(MolCore.fragmentAfterCut(mol, 3, [1, 2])) === '[2,3]', '切 1-2 后 3 侧片段应为 [2,3]');
  assert(JSON.stringify(MolCore.fragmentAfterCut(mol, 0, [1, 2])) === '[0,1]', '切 1-2 后 0 侧片段应为 [0,1]');
  const comps = MolCore.components(mol);
  assert(comps.length === 1 && comps[0].length === 4, '应为单个 4 原子连通分量');
});

test('clone 深拷贝，互不影响', () => {
  const mol = waterMol();
  const copy = MolCore.clone(mol);
  copy.atoms[0].x = 99;
  assert(mol.atoms[0].x === 0, '修改副本不应影响原分子');
  assert(MolCore.formula(mol) === 'H2O', '分子式应为 H2O，实际 ' + MolCore.formula(mol));
});

// ---------- 导出 ----------
test('导出：XYZ 格式正确', () => {
  const mol = waterMol();
  const text = MolCore.export.xyz(mol);
  const lines = text.trim().split('\n');
  assert(lines[0] === '3', 'XYZ 首行原子数错误: ' + lines[0]);
  assert(lines[1] === 'water', 'XYZ 标题错误');
  assert(lines[2].startsWith('O '), 'XYZ 第一行原子错误');
  near(parseFloat(lines[2].split(/\s+/)[1]), 0, 1e-8);
  assert(text.endsWith('\n'), 'XYZ 应以换行结尾');
});

test('导出：GJF 含路由/电荷多重度/原子行/连接性', () => {
  const mol = waterMol();
  const text = MolCore.export.gjf(mol, { title: 'water', chk: 'water.chk' });
  assert(text.includes('%chk=water.chk'), '缺少 %chk');
  assert(text.includes('#p b3lyp/6-31g(d) opt geom=connectivity'), '默认路由错误');
  const lines = text.split('\n');
  const idx = lines.indexOf('water');
  assert(idx > 0, '缺少 title');
  assert(lines[idx + 2].trim() === '0 1', '电荷多重度行错误: ' + lines[idx + 2]);
  assert(text.includes(' O '), '缺少 O 原子行');
  const connect = text.split('\n').slice(-6).join('\n');
  assert(/^\s*1 2 1\.0 3 1\.0/m.test(connect) || connect.includes('1 2 1.0 3 1.0'), '连接性段缺少 O 的键: ' + JSON.stringify(connect));
  assert(text.endsWith('\n'), 'GJF 应以换行结尾');
});

test('导出：SDF V2000 结构正确', () => {
  const mol = waterMol();
  const text = MolCore.export.sdf(mol);
  const lines = text.trim().split('\n');
  assert(lines[0] === 'water', 'SDF 标题行错误');
  const counts = lines[3];
  assert(counts.startsWith('  3  2'), 'SDF 计数行错误: ' + counts);
  assert(counts.endsWith('V2000'), 'SDF 版本错误');
  assert(lines[4].includes('O'), 'SDF 原子行缺少 O');
  assert(lines.includes('M  END'), 'SDF 缺少 M  END');
  assert(text.endsWith('$$$$\n'), 'SDF 应以 $$$$ 结尾');
});

// ---------- 汇总 ----------
console.log('\n========================================');
console.log(`通过 ${passed} / ${passed + failures.length}`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.err && f.err.stack ? f.err.stack.split('\n')[0] : f.err)));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
}

