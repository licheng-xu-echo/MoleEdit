/* MolEdit — tests/gausslog.test.mjs
 * js/gausslog.js（Gaussian LOG 深度解析）单元测试：Node 24 直接运行，无 npm 依赖。
 *
 * 运行：node tests/gausslog.test.mjs
 * 规则：失败打印 ❌ 并以 exit code 1 退出；全部通过 exit 0。
 * 覆盖：fixture 已知数值 / 帧索引 / 多 job / hpmodes / 坏文本 / CRLF+BOM / 性能 / 跨模块。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildOptFreqLog, buildMultiJobLog, buildHpmodesLog } from '../tools/gen-log-sample.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const SAMPLES = path.join(ROOT, 'samples');
const require = createRequire(import.meta.url);

const MolGaussLog = require('../js/gausslog.js');

/* ===========================================================================
 * 迷你断言框架
 * ========================================================================= */
let checks = 0;
let passed = 0;
let group = '';
const failures = [];

function suite(name, fn) {
  group = name;
  try {
    fn();
  } catch (err) {
    checks++;
    const detail = err && err.stack ? err.stack : String(err);
    failures.push({ group: group, name: '（测试组异常中断）', detail: detail });
    console.log('❌ [' + group + '] 测试组异常中断: ' + (err && err.message ? err.message : err));
  }
}

function check(name, cond, detail) {
  checks++;
  if (cond) {
    passed++;
    console.log('✅ [' + group + '] ' + name);
  } else {
    failures.push({ group: group, name: name, detail: detail === undefined ? '' : String(detail) });
    console.log('❌ [' + group + '] ' + name + (detail === undefined ? '' : '  → ' + detail));
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

function near(name, actual, expected, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  check(
    name,
    typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= t,
    '期望 ≈ ' + expected + '（±' + t + '），实际 ' + JSON.stringify(actual)
  );
}

function arrNear(name, actual, expected, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  const okLen = Array.isArray(actual) && actual.length === expected.length;
  const okVals = okLen && expected.every(function (v, i) {
    return typeof actual[i] === 'number' && Math.abs(actual[i] - v) <= t;
  });
  check(name, okVals, '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/* ===========================================================================
 * 固定期望值（与 tools/gen-log-sample.mjs 的 fixture 保持一致）
 * ========================================================================= */
const EXPECT = {
  energies: [-76.4088123456, -76.4091234567, -76.4093123456, -76.4093345678],
  cycles: [8, 6, 4, 3],
  step1: { maxForce: 0.004321, rmsForce: 0.001234, maxDisplacement: 0.012345, rmsDisplacement: 0.004321 },
  step2: { maxForce: 0.000876, rmsForce: 0.000245, maxDisplacement: 0.003456, rmsDisplacement: 0.000987 },
  step3: { maxForce: 0.000123, rmsForce: 0.000034, maxDisplacement: 0.000890, rmsDisplacement: 0.000234 },
  step4: { maxForce: 0.000021, rmsForce: 0.000006, maxDisplacement: 0.000120, rmsDisplacement: 0.000032 },
  thermo: {
    zeroPointCorrection: 0.021241,
    thermalCorrectionEnergy: 0.023456,
    thermalCorrectionEnthalpy: 0.023800,
    thermalCorrectionGibbs: 0.003124,
    sumElectronicZeroPoint: -76.388094,
    sumElectronicThermal: -76.385879,
    sumElectronicEnthalpy: -76.385535,
    sumElectronicGibbs: -76.406211
  },
  frequencies: [1600.1234, 3800.5678, 3900.1111],
  ir: [12.3456, 45.6789, 67.8901],
  reducedMass: [1.0820, 1.0772, 1.0910],
  forceConstant: [1.6342, 9.7863, 10.0893]
};

/* ===========================================================================
 * 合成日志小工具（用于边界格式）
 * ========================================================================= */
function baseHeader(route) {
  return [
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  999.',
    '',
    ' Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.',
    '',
    ' ---------------------------------------------------------------',
    ' ' + route,
    ' ---------------------------------------------------------------',
    ' Test molecule',
    '',
    ' Symbolic Z-matrix:',
    ' Charge =  0 Multiplicity = 1',
    ' NAtoms=      3',
    ''
  ].join('\n');
}

const ORIENTATION_3ATOMS = [
  '                         Standard orientation:',
  ' ---------------------------------------------------------------------',
  ' Center     Atomic      Atomic             Coordinates (Angstroms)',
  ' Number     Number       Type             X           Y           Z',
  ' ---------------------------------------------------------------------',
  '      1          8            0     0.000000     0.000000     0.117176',
  '      2          1            0     0.000000     0.756950    -0.468780',
  '      3          1            0     0.000000    -0.756950    -0.468780',
  ' ---------------------------------------------------------------------',
  ''
].join('\n');

function scfBlock(energy, cycles) {
  return ' SCF Done:  E(RB3LYP) =  ' + energy + '     A.U. after    ' + cycles + ' cycles\n';
}

function normalTermination() {
  return ' Normal termination of Gaussian 16 at Thu Nov 13 10:00:00 2025.\n';
}

/* ===========================================================================
 * 1. API 与 fixture 一致性
 * ========================================================================= */
suite('API 与 fixture', function () {
  eq('version 为 1.0.0', MolGaussLog.version, '1.0.0');
  eq('parse 是函数', typeof MolGaussLog.parse, 'function');
  eq('hasAnalysis 是函数', typeof MolGaussLog.hasAnalysis, 'function');

  const fixtureText = readFixture('water-opt-freq.log');
  eq('fixture 与 buildOptFreqLog() 完全一致', fixtureText, buildOptFreqLog());

  const results = MolGaussLog.parse(fixtureText);
  eq('fixture ok=true', results.ok, true);
  eq('fixture format=gaussian-log', results.format, 'gaussian-log');
  eq('fixture 只有 1 个 job', results.jobs.length, 1);
  eq('format: warnings 为数组', Array.isArray(results.warnings), true);
  eq('fixture 无 warnings', results.warnings.length, 0);
});

/* ===========================================================================
 * 2. route / 电荷 / 原子数
 * ========================================================================= */
suite('route / charge / multiplicity / natoms', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  const job = results.jobs[0];
  eq('route 去掉 #p 后的合并文本', job.route, 'b3lyp/6-31g(d) opt freq');
  eq('routeFull 保留原始 route 行', job.routeFull, '#p b3lyp/6-31g(d) opt freq');
  eq('charge = 0', job.charge, 0);
  eq('multiplicity = 1', job.multiplicity, 1);
  eq('natoms = 3', job.natoms, 3);
  eq('job.index = 0', job.index, 0);
  eq('summary.route 与 job 一致', results.summary.route, job.route);
  eq('summary.charge', results.summary.charge, 0);
  eq('summary.multiplicity', results.summary.multiplicity, 1);
  eq('summary.natoms', results.summary.natoms, 3);
});

/* ===========================================================================
 * 3. SCF Done 序列 / 单点能
 * ========================================================================= */
suite('SCF Done 序列与单点能', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  const job = results.jobs[0];
  eq('SCF Done 共 4 次', job.scfEnergies.length, 4);
  arrNear('4 个 SCF 能量值正确', job.scfEnergies.map(function (s) { return s.energy; }), EXPECT.energies);
  arrNear('SCF cycles 正确', job.scfEnergies.map(function (s) { return s.cycles; }), EXPECT.cycles);
  arrNear('SCF step 编号 1..4', job.scfEnergies.map(function (s) { return s.step; }), [1, 2, 3, 4]);
  let decreasing = true;
  for (let i = 1; i < job.scfEnergies.length; i++) {
    if (!(job.scfEnergies[i].energy < job.scfEnergies[i - 1].energy)) decreasing = false;
  }
  check('优化过程中 SCF 能量严格递减', decreasing);
  near('summary.finalEnergy 为最后一个 SCF Done', results.summary.finalEnergy, EXPECT.energies[3]);
  eq('normalTermination = true', job.normalTermination, true);
  eq('summary.normalTermination = true', results.summary.normalTermination, true);
  eq('hasAnalysis(results) = true', MolGaussLog.hasAnalysis(results), true);
  eq('hasAnalysis(null) = false', MolGaussLog.hasAnalysis(null), false);
  eq('hasAnalysis({}) = false', MolGaussLog.hasAnalysis({}), false);
  eq('hasAnalysis(ok:false) = false', MolGaussLog.hasAnalysis({ ok: false, summary: { hasAnalysis: true } }), false);
});

/* ===========================================================================
 * 4. 优化步骤 + 收敛判据表
 * ========================================================================= */
suite('优化收敛', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  const job = results.jobs[0];
  eq('optSteps 共 4 步', job.optSteps.length, 4);
  const s1 = job.optSteps[0];
  const s2 = job.optSteps[1];
  const s3 = job.optSteps[2];
  const s4 = job.optSteps[3];
  near('step1 Maximum Force', s1.maxForce, EXPECT.step1.maxForce);
  near('step1 RMS Force', s1.rmsForce, EXPECT.step1.rmsForce);
  near('step1 Maximum Displacement', s1.maxDisplacement, EXPECT.step1.maxDisplacement);
  near('step1 RMS Displacement', s1.rmsDisplacement, EXPECT.step1.rmsDisplacement);
  near('step2 Maximum Force', s2.maxForce, EXPECT.step2.maxForce);
  near('step3 RMS Displacement', s3.rmsDisplacement, EXPECT.step3.rmsDisplacement);
  near('step4 RMS Force', s4.rmsForce, EXPECT.step4.rmsForce);
  eq('step1 未收敛', s1.converged, false);
  eq('step2（部分 YES）未收敛', s2.converged, false);
  eq('step3 收敛', s3.converged, true);
  eq('step4 收敛', s4.converged, true);
  near('step1 Predicted change in Energy（D 指数）', s1.predictedDeltaEnergy, -1.234567e-7);
  near('step2 energy 对应第 2 个 SCF Done', s2.energy, EXPECT.energies[1]);
  arrNear('各步 frameIndex 为全局 Standard orientation 序号', job.optSteps.map(function (s) { return s.frameIndex; }), [0, 1, 2, 3]);
  eq('optimization.completed = true', job.optimization.completed, true);
  eq('optimization.stationaryPoint = true', job.optimization.stationaryPoint, true);
  eq('optimization.converged = true', job.optimization.converged, true);
  eq('summary.hasOptimization = true', results.summary.hasOptimization, true);
  eq('summary.opt.steps 长度 4', results.summary.opt.steps.length, 4);
  eq('summary.opt.completed', results.summary.opt.completed, true);
  eq('summary.opt.stationaryPoint', results.summary.opt.stationaryPoint, true);
  eq('summary.opt.converged', results.summary.opt.converged, true);
});

/* ===========================================================================
 * 5. 热化学 8 项
 * ========================================================================= */
suite('热化学', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  const job = results.jobs[0];
  const th = job.thermochemistry;
  check('thermochemistry 非 null', !!th);
  near('Temperature = 298.15 K', th.temperature, 298.15);
  near('Pressure = 1.0 Atm', th.pressure, 1.0);
  const keys = ['zeroPointCorrection', 'thermalCorrectionEnergy', 'thermalCorrectionEnthalpy',
    'thermalCorrectionGibbs', 'sumElectronicZeroPoint', 'sumElectronicThermal',
    'sumElectronicEnthalpy', 'sumElectronicGibbs'];
  keys.forEach(function (key) {
    near('thermochemistry.' + key, th[key], EXPECT.thermo[key]);
  });
  eq('summary.hasThermochemistry = true', results.summary.hasThermochemistry, true);
  near('summary.thermochemistry.sumElectronicGibbs', results.summary.thermochemistry.sumElectronicGibbs,
    EXPECT.thermo.sumElectronicGibbs);
});

/* ===========================================================================
 * 6. 频率 / 位移 / freqFrameIndex
 * ========================================================================= */
suite('频率与振动位移', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  const job = results.jobs[0];
  eq('频率模式数 = 3', job.frequencies.length, 3);
  arrNear('模式编号 1..3', job.frequencies.map(function (f) { return f.modeIndex; }), [1, 2, 3]);
  arrNear('频率值正确', job.frequencies.map(function (f) { return f.frequency; }), EXPECT.frequencies);
  arrNear('IR Inten 正确', job.frequencies.map(function (f) { return f.irIntensity; }), EXPECT.ir);
  arrNear('Red. masses 正确', job.frequencies.map(function (f) { return f.reducedMass; }), EXPECT.reducedMass);
  arrNear('Frc consts 正确', job.frequencies.map(function (f) { return f.forceConstant; }), EXPECT.forceConstant);
  eq('3 个模式均非虚频', job.frequencies.map(function (f) { return f.imaginary; }).join(','), 'false,false,false');
  eq('mode1 位移数 = 3 原子', job.frequencies[0].displacements.length, 3);
  eq('mode2 位移数 = 3 原子', job.frequencies[1].displacements.length, 3);
  eq('mode3 位移数 = 3 原子', job.frequencies[2].displacements.length, 3);
  arrNear('mode1 各原子位移 dx', job.frequencies[0].displacements.map(function (d) { return d.dx; }), [0, 0, 0]);
  near('mode1 atom0 dz', job.frequencies[0].displacements[0].dz, 0.068);
  near('mode1 atom1 dy', job.frequencies[0].displacements[1].dy, 0.070);
  near('mode1 atom1 dz', job.frequencies[0].displacements[1].dz, -0.034);
  near('mode2 atom0 dz', job.frequencies[1].displacements[0].dz, -0.054);
  near('mode3 atom1 dy', job.frequencies[2].displacements[1].dy, 0.072);
  arrNear('位移 atomIndex 为 0 基 0/1/2', job.frequencies[0].displacements.map(function (d) { return d.atomIndex; }), [0, 1, 2]);
  eq('freqFrameIndex = 4（5 个 Standard orientation 的最后一个）', job.freqFrameIndex, 4);
  eq('orientationStartIndex = 0', job.orientationStartIndex, 0);
  eq('summary.freqFrameIndex = 4', results.summary.freqFrameIndex, 4);
  eq('summary.hasFrequencies = true', results.summary.hasFrequencies, true);
  eq('summary.frequencies 长度 3', results.summary.frequencies.length, 3);
});

/* ===========================================================================
 * 7. 能量曲线
 * ========================================================================= */
suite('能量曲线数据', function () {
  const results = MolGaussLog.parse(readFixture('water-opt-freq.log'));
  eq('summary.energySteps 长度 4', results.summary.energySteps.length, 4);
  arrNear('energySteps.step', results.summary.energySteps.map(function (s) { return s.step; }), [1, 2, 3, 4]);
  arrNear('energySteps.energy 等于 optSteps 能量', results.summary.energySteps.map(function (s) { return s.energy; }), EXPECT.energies);
  eq('summary.hasAnalysis = true', results.summary.hasAnalysis, true);
  eq('summary.jobCount = 1', results.summary.jobCount, 1);
});

/* ===========================================================================
 * 8. 普通 log / 失败任务 / 无结果文本
 * ========================================================================= */
suite('普通 log 与终止状态', function () {
  const water = MolGaussLog.parse(readFixture('water.log'));
  eq('fixtures/water.log ok=true', water.ok, true);
  eq('fixtures/water.log 2 次 SCF Done', water.jobs[0].scfEnergies.length, 2);
  near('fixtures/water.log finalEnergy', water.summary.finalEnergy, -76.4091234567);
  eq('fixtures/water.log optimization.completed', water.jobs[0].optimization.completed, true);
  eq('fixtures/water.log 无频率', water.summary.hasFrequencies, false);
  eq('fixtures/water.log 无热化学', water.summary.hasThermochemistry, false);
  eq('fixtures/water.log hasAnalysis', MolGaussLog.hasAnalysis(water), true);
  eq('fixtures/water.log natoms 由 orientation 行数推断 = 3', water.jobs[0].natoms, 3);

  // samples/water.log 语义：2 帧轨迹演示（无热化学段），结果面板只应有单点能，
  // hasFrequencies/hasOptimization/hasThermochemistry 全 false（否则会误自动切 Results tab）。
  const sampleWater = MolGaussLog.parse(fs.readFileSync(path.join(SAMPLES, 'water.log'), 'utf8'));
  eq('samples/water.log ok=true', sampleWater.ok, true);
  near('samples/water.log finalEnergy = -76.4089399955', sampleWater.summary.finalEnergy, -76.4089399955);
  eq('samples/water.log thermochemistry === null（无热化学段）', sampleWater.jobs[0].thermochemistry, null);
  eq('samples/water.log summary.thermochemistry === null', sampleWater.summary.thermochemistry, null);
  eq('samples/water.log hasThermochemistry=false', sampleWater.summary.hasThermochemistry, false);
  eq('samples/water.log hasOptimization=false', sampleWater.summary.hasOptimization, false);
  eq('samples/water.log hasFrequencies=false', sampleWater.summary.hasFrequencies, false);
  eq('samples/water.log 不触发结果页自动切换', sampleWater.summary.hasFrequencies ||
    sampleWater.summary.hasOptimization || sampleWater.summary.hasThermochemistry, false);
  eq('samples/water.log hasAnalysis=true（仍有 SCF 能量）', MolGaussLog.hasAnalysis(sampleWater), true);

  const failed = MolGaussLog.parse(readFixture('failed.log'));
  eq('failed.log ok=true（仍可展示能量）', failed.ok, true);
  eq('failed.log normalTermination=false', failed.jobs[0].normalTermination, false);
  eq('failed.log summary.normalTermination=false', failed.summary.normalTermination, false);
  eq('failed.log natoms=4（Input orientation 回退）', failed.jobs[0].natoms, 4);
  near('failed.log finalEnergy', failed.summary.finalEnergy, -55.9887654321);
  check('failed.log warnings 含 Error termination',
    failed.warnings.join(' ').indexOf('Error termination') >= 0, JSON.stringify(failed.warnings));
});

suite('非 log / 空 / 非法输入不抛异常', function () {
  const xyz = '3\nwater\nO 0 0 0\nH 0.7572 0.5860 0\nH -0.7572 0.5860 0\n';
  const nonLog = MolGaussLog.parse(xyz);
  eq('xyz 文本 ok=false', nonLog.ok, false);
  eq('xyz 文本 jobs 为空', nonLog.jobs.length, 0);
  eq('xyz 文本 hasAnalysis=false', nonLog.summary.hasAnalysis, false);
  eq('xyz 文本 hasAnalysis(results)=false', MolGaussLog.hasAnalysis(nonLog), false);
  check('xyz 文本有 warning', nonLog.warnings.length > 0);

  const emptyInputs = ['', '   \n\t  ', null, undefined, 0, 42, true, {}];
  let allOk = true;
  let detail = '';
  emptyInputs.forEach(function (input) {
    let r;
    try {
      r = MolGaussLog.parse(input);
    } catch (err) {
      allOk = false;
      detail += '抛异常(' + String(input) + '): ' + err.message + '; ';
      return;
    }
    if (!r || r.ok !== false || !r.summary || r.summary.hasAnalysis !== false) {
      allOk = false;
      detail += '不符合失败结构: ' + String(input) + '; ';
    }
  });
  check('空/非法输入全部返回 ok:false 且不抛异常', allOk, detail);

  const hintOnly = MolGaussLog.parse('Gaussian, Inc.  All Rights Reserved.\n');
  eq('仅 Gaussian 特征文本 ok=true', hintOnly.ok, true);
  eq('仅 Gaussian 特征文本 jobs 为空', hintOnly.jobs.length, 0);
  eq('仅 Gaussian 特征文本 hasAnalysis=false', hintOnly.summary.hasAnalysis, false);
  check('仅 Gaussian 特征文本有 warning', hintOnly.warnings.join(' ').indexOf('No Gaussian job content') >= 0,
    JSON.stringify(hintOnly.warnings));

  // 所有既有 .log 夹具都不应抛异常
  const logFiles = fs.readdirSync(FIXTURES).filter(function (f) { return f.endsWith('.log'); });
  let noThrow = true;
  let badFile = '';
  logFiles.forEach(function (file) {
    try {
      const r = MolGaussLog.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
      if (!r || !Array.isArray(r.jobs) || !Array.isArray(r.warnings)) {
        noThrow = false;
        badFile = file;
      }
    } catch (err) {
      noThrow = false;
      badFile = file + ': ' + err.message;
    }
  });
  check('fixtures 下所有 .log 文件解析均不抛异常且结构完整（' + logFiles.length + ' 个）', noThrow, badFile);
});

/* ===========================================================================
 * 9. CRLF / BOM
 * ========================================================================= */
suite('CRLF / BOM 容错', function () {
  const text = readFixture('water-opt-freq.log');
  const plain = MolGaussLog.parse(text);
  const crlf = MolGaussLog.parse('\uFEFF' + text.replace(/\n/g, '\r\n'));
  eq('CRLF+BOM ok=true', crlf.ok, true);
  near('CRLF+BOM finalEnergy 一致', crlf.summary.finalEnergy, plain.summary.finalEnergy);
  eq('CRLF+BOM 频率数一致', crlf.summary.frequencies.length, plain.summary.frequencies.length);
  eq('CRLF+BOM freqFrameIndex 一致', crlf.summary.freqFrameIndex, plain.summary.freqFrameIndex);
  eq('CRLF+BOM route 一致', crlf.jobs[0].route, plain.jobs[0].route);
  near('CRLF+BOM 热化学项一致', crlf.summary.thermochemistry.sumElectronicZeroPoint,
    plain.summary.thermochemistry.sumElectronicZeroPoint);
  eq('仅 BOM 前缀 ok=true', MolGaussLog.parse('\uFEFF' + text).ok, true);
  eq('仅 CRLF 换行 ok=true', MolGaussLog.parse(text.replace(/\n/g, '\r\n')).ok, true);
});

/* ===========================================================================
 * 10. 多 job（Entering Link 1 / --Link1-- / route 分区回退）
 * ========================================================================= */
suite('多 job 解析', function () {
  const text = readFixture('water-multi-job.log');
  eq('multi-job fixture 与 buildMultiJobLog() 一致', text, buildMultiJobLog());
  const results = MolGaussLog.parse(text);
  eq('多 job ok=true', results.ok, true);
  eq('识别出 2 个 job', results.jobs.length, 2);
  eq('summary.jobCount = 2', results.summary.jobCount, 2);
  eq('job0 route 为 opt', results.jobs[0].route, 'opt b3lyp/6-31g(d)');
  eq('job1 route 为 freq', results.jobs[1].route, 'freq b3lyp/6-31g(d)');
  eq('job0 optSteps 2 步', results.jobs[0].optSteps.length, 2);
  eq('job0 第 1 步未收敛', results.jobs[0].optSteps[0].converged, false);
  eq('job0 第 2 步收敛', results.jobs[0].optSteps[1].converged, true);
  arrNear('job0 frameIndex [0,1]', results.jobs[0].optSteps.map(function (s) { return s.frameIndex; }), [0, 1]);
  eq('job0 orientationStartIndex = 0', results.jobs[0].orientationStartIndex, 0);
  eq('job0 无频率 freqFrameIndex=null', results.jobs[0].freqFrameIndex, null);
  eq('job1 频率模式数 3', results.jobs[1].frequencies.length, 3);
  eq('job1 freqFrameIndex = 2', results.jobs[1].freqFrameIndex, 2);
  eq('job1 orientationStartIndex = 2', results.jobs[1].orientationStartIndex, 2);
  eq('summary.hasOptimization', results.summary.hasOptimization, true);
  eq('summary.hasFrequencies', results.summary.hasFrequencies, true);
  eq('summary.hasThermochemistry', results.summary.hasThermochemistry, true);
  eq('summary.opt.steps 来自 job0', results.summary.opt.steps.length, 2);
  eq('summary.freqFrameIndex 来自 job1', results.summary.freqFrameIndex, 2);
  near('多 job finalEnergy = 最后一个 SCF Done', results.summary.finalEnergy, -76.4093345678);
  eq('多 job normalTermination=true', results.summary.normalTermination, true);

  // --Link1-- 分隔
  const link1Text = text.replace(' Entering Link 1 = /usr/local/g16/l1.exe pid=  12346.', ' --Link1--');
  const link1 = MolGaussLog.parse(link1Text);
  eq('--Link1-- 分隔识别 2 个 job', link1.jobs.length, 2);
  eq('--Link1-- job0 route', link1.jobs[0].route, 'opt b3lyp/6-31g(d)');
  eq('--Link1-- job1 route', link1.jobs[1].route, 'freq b3lyp/6-31g(d)');

  // 无 Entering 标记时按 route 分区回退
  const twoRoutes = [
    '#p opt hf/3-21g',
    '',
    ORIENTATION_3ATOMS,
    scfBlock('-76.0000000000', 5),
    '',
    normalTermination(),
    '#p freq hf/3-21g',
    '',
    ORIENTATION_3ATOMS,
    scfBlock('-76.0001000000', 4),
    '',
    normalTermination()
  ].join('\n');
  const fallback = MolGaussLog.parse(twoRoutes);
  eq('无 Entering 标记时 route 分区识别 2 个 job', fallback.jobs.length, 2);
  eq('route 分区 job0 route', fallback.jobs[0].route, 'opt hf/3-21g');
  eq('route 分区 job1 route', fallback.jobs[1].route, 'freq hf/3-21g');
  near('route 分区 finalEnergy', fallback.summary.finalEnergy, -76.0001);
});

/* ===========================================================================
 * 11. 收敛表格式容错（D 指数 / ** / 多空格）
 * ========================================================================= */
suite('收敛表格式容错', function () {
  const text = baseHeader('#p opt b3lyp/3-21g') + ORIENTATION_3ATOMS + '\n' +
    scfBlock('-76.4000000000', 5) + '\n' +
    '         Item               Value     Threshold  Converged?\n' +
    ' Maximum Force            1.234567D-04     0.000450     YES\n' +
    ' RMS     Force            4.5D-05          0.000300     YES\n' +
    ' Maximum Displacement     **               0.001800     NO\n' +
    ' RMS     Displacement     1.23E-04         0.001200     YES\n' +
    ' Predicted change in Energy=-1.234D-08\n\n' +
    normalTermination();
  const results = MolGaussLog.parse(text);
  eq('格式容错日志 ok=true', results.ok, true);
  eq('格式容错 optSteps 1 步', results.jobs[0].optSteps.length, 1);
  const step = results.jobs[0].optSteps[0];
  near('D 指数 Maximum Force', step.maxForce, 1.234567e-4);
  near('D 指数 RMS Force', step.rmsForce, 4.5e-5);
  eq('** 溢出值解析为 null', step.maxDisplacement, null);
  near('E 指数 RMS Displacement', step.rmsDisplacement, 1.23e-4);
  eq('含 NO 时 converged=false', step.converged, false);
  near('Predicted change in Energy', step.predictedDeltaEnergy, -1.234e-8);
  eq('格式容错 frameIndex=0', step.frameIndex, 0);
  near('格式容错 step.energy 取前一个 SCF Done', step.energy, -76.4);
});

/* ===========================================================================
 * 12. 频率块容错（1–3 模式 / IR 缺失 / 虚频）
 * ========================================================================= */
suite('频率块格式容错', function () {
  const text = baseHeader('#p freq b3lyp/3-21g') + ORIENTATION_3ATOMS + '\n' +
    scfBlock('-76.4000000000', 8) + '\n' +
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering\n' +
    ' and normal coordinates:\n' +
    '                      1                      2\n' +
    '                     A1                     B2\n' +
    ' Frequencies --     -123.4567   456.7890\n' +
    ' Red. masses --       1.1111      2.2222\n' +
    ' Frc consts  --       3.3333      4.4444\n' +
    ' IR Inten    --       5.5555      6.6666\n' +
    '  Atom  AN      X      Y      Z        X      Y      Z\n' +
    '     1   8     0.100000   0.000000   0.000000   0.200000   0.000000   0.000000\n' +
    '     2   1     0.000000   0.300000   0.000000   0.000000   0.400000   0.000000\n' +
    '     3   1     0.000000   0.000000   0.500000   0.000000   0.000000   0.600000\n' +
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering\n' +
    '                      1\n' +
    '                     A1\n' +
    ' Frequencies --     700.0000\n' +
    ' Red. masses --       1.5000\n' +
    ' Frc consts  --       2.5000\n' +
    '  Atom  AN      X      Y      Z\n' +
    '     1   8     0.010000   0.000000   0.000000\n' +
    '     2   1     0.000000   0.020000   0.000000\n' +
    '     3   1     0.000000   0.000000   0.030000\n\n' +
    normalTermination();
  const results = MolGaussLog.parse(text);
  eq('2 个频率块共 3 个模式', results.jobs[0].frequencies.length, 3);
  arrNear('跨块频率顺序正确', results.jobs[0].frequencies.map(function (f) { return f.frequency; }),
    [-123.4567, 456.7890, 700.0]);
  eq('负频率标记为虚频', results.jobs[0].frequencies[0].imaginary, true);
  near('虚频值保留负数', results.jobs[0].frequencies[0].frequency, -123.4567);
  near('2 模式块 mode1 IR', results.jobs[0].frequencies[0].irIntensity, 5.5555);
  near('2 模式块 mode2 IR', results.jobs[0].frequencies[1].irIntensity, 6.6666);
  near('2 模式块 mode2 Red. mass', results.jobs[0].frequencies[1].reducedMass, 2.2222);
  near('mode1 atom0 dx（2 列分发）', results.jobs[0].frequencies[0].displacements[0].dx, 0.1);
  near('mode2 atom1 dy（2 列分发）', results.jobs[0].frequencies[1].displacements[1].dy, 0.4);
  near('块 2 atom2 dz（单模式）', results.jobs[0].frequencies[2].displacements[2].dz, 0.03);
  eq('IR 缺失的块置 null', results.jobs[0].frequencies[2].irIntensity, null);
  check('IR 缺失产生 warning', results.warnings.join(' ').indexOf('IR intensities') >= 0,
    JSON.stringify(results.warnings));
  eq('频率日志 freqFrameIndex=0', results.jobs[0].freqFrameIndex, 0);
});

/* ===========================================================================
 * 13. hpmodes
 * ========================================================================= */
suite('hpmodes 容错', function () {
  const text = readFixture('water-hpmodes.log');
  eq('hpmodes fixture 与 buildHpmodesLog() 一致', text, buildHpmodesLog());
  const results = MolGaussLog.parse(text);
  eq('hpmodes ok=true', results.ok, true);
  eq('hpmodes route 含 freq=hpmodes', results.jobs[0].route, 'freq=hpmodes b3lyp/6-31g(d)');
  eq('hpmodes 提取 3 个频率', results.jobs[0].frequencies.length, 3);
  arrNear('hpmodes 频率值', results.jobs[0].frequencies.map(function (f) { return f.frequency; }), EXPECT.frequencies);
  near('hpmodes Reduced masses', results.jobs[0].frequencies[0].reducedMass, 1.0820);
  near('hpmodes Force constants', results.jobs[0].frequencies[1].forceConstant, 9.7863);
  near('hpmodes IR Intensities', results.jobs[0].frequencies[2].irIntensity, 67.8901);
  eq('hpmodes freqFrameIndex=0', results.jobs[0].freqFrameIndex, 0);
  eq('hpmodes summary.hasFrequencies', results.summary.hasFrequencies, true);

  // hpmodes 但无 Coord Atom Element 位移数据 -> displacements:[] + warning
  const noDisp = baseHeader('#p freq=hpmodes b3lyp/3-21g') + ORIENTATION_3ATOMS + '\n' +
    scfBlock('-76.4000000000', 8) + '\n' +
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering\n' +
    ' and normal coordinates:\n' +
    '                      1                      2\n' +
    '                     A1                     B2\n' +
    ' Frequencies ---     1650.1111   3900.2222\n' +
    ' Reduced masses ---    1.0820      1.0910\n' +
    ' Force constants ---   1.6342     10.0893\n' +
    ' IR Intensities ---   12.3456     67.8901\n\n' +
    normalTermination();
  const r2 = MolGaussLog.parse(noDisp);
  eq('无位移 hpmodes 仍提取 2 个频率', r2.jobs[0].frequencies.length, 2);
  eq('无位移 hpmodes displacements=[]', r2.jobs[0].frequencies[0].displacements.length, 0);
  check('无位移 hpmodes 产生 warning', r2.warnings.join(' ').indexOf('displacements') >= 0,
    JSON.stringify(r2.warnings));
});

/* ===========================================================================
 * 14. 无 Standard orientation 的帧索引回退
 * ========================================================================= */
suite('orientation 回退', function () {
  const inputOrientation = [
    '                          Input orientation:',
    ' ---------------------------------------------------------------------',
    ' Center     Atomic      Atomic             Coordinates (Angstroms)',
    ' Number     Number       Type             X           Y           Z',
    ' ---------------------------------------------------------------------',
    '      1          8            0     0.000000     0.000000     0.117176',
    '      2          1            0     0.000000     0.756950    -0.468780',
    '      3          1            0     0.000000    -0.756950    -0.468780',
    ' ---------------------------------------------------------------------',
    ''
  ].join('\n');

  const text = baseHeader('#p freq hf/3-21g') + inputOrientation + '\n' +
    scfBlock('-76.4000000000', 8) + '\n' +
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering\n' +
    '                      1\n' +
    '                     A1\n' +
    ' Frequencies --     1600.0000\n' +
    ' Red. masses --       1.0820\n' +
    ' Frc consts  --       1.6342\n' +
    ' IR Inten    --      12.3456\n' +
    '  Atom  AN      X      Y      Z\n' +
    '     1   8     0.000000   0.000000   0.068000\n' +
    '     2   1     0.000000   0.070000  -0.034000\n' +
    '     3   1     0.000000  -0.070000  -0.034000\n\n' +
    normalTermination();
  const parsed = MolGaussLog.parse(text);
  eq('仅 Input orientation 时 ok=true', parsed.ok, true);
  eq('仅 Input orientation 仍有 1 个频率', parsed.jobs[0].frequencies.length, 1);
  eq('仅 Input orientation 时 freqFrameIndex 回退为 0', parsed.jobs[0].freqFrameIndex, 0);
  check('仅 Input orientation 时产生 warning',
    parsed.warnings.join(' ').indexOf('Input orientation') >= 0, JSON.stringify(parsed.warnings));

  // 完全无几何：freqFrameIndex 应为 null，且不抛异常
  const noGeometry = [
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  999.',
    '',
    ' ---------------------------------------------------------------',
    ' #p freq hf/3-21g',
    ' ---------------------------------------------------------------',
    '',
    scfBlock('-76.4000000000', 8) + '\n',
    ' Frequencies --     1600.0000\n',
    ' Normal termination of Gaussian 16 at Thu Nov 13 10:00:00 2025.\n'
  ].join('\n');
  const ng = MolGaussLog.parse(noGeometry);
  eq('无几何日志 ok=true', ng.ok, true);
  eq('无几何日志 freqFrameIndex=null', ng.jobs[0].freqFrameIndex, null);
  eq('无几何日志 natoms=null', ng.jobs[0].natoms, null);
});

/* ===========================================================================
 * 15. 性能（≥1 MB、20 个频率块 < 300ms）
 * ========================================================================= */
suite('大文件性能', function () {
  function largeLog() {
    const chunks = [baseHeader('#p freq b3lyp/3-21g') + ORIENTATION_3ATOMS + '\n' +
      scfBlock('-76.4093345678', 6) + '\n'];
    let size = chunks[0].length;
    for (let b = 0; b < 20; b++) {
      const f1 = (1600 + b * 10 + 0.1111).toFixed(4);
      const f2 = (3800 + b * 1.1111).toFixed(4);
      const f3 = (3900 + b * 2.2222).toFixed(4);
      const block = [
        ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering',
        '                      1                      2                      3',
        '                     A1                     A1                     B2',
        ' Frequencies --   ' + f1 + '   ' + f2 + '   ' + f3,
        ' Red. masses --      1.0820                 1.0772                 1.0910',
        ' Frc consts  --      1.6342                 9.7863                10.0893',
        ' IR Inten    --     12.3456                45.6789                67.8901',
        '  Atom  AN      X      Y      Z        X      Y      Z        X      Y      Z',
        '     1   8     0.000000   0.000000   0.068000   0.000000   0.000000  -0.054000   0.000000   0.000000   0.000000',
        '     2   1     0.000000   0.070000  -0.034000   0.000000   0.065000   0.027000   0.000000   0.072000   0.000000',
        '     3   1     0.000000  -0.070000  -0.034000   0.000000  -0.065000   0.027000   0.000000  -0.072000   0.000000',
        ''
      ].join('\n');
      chunks.push(block);
      size += block.length;
    }
    const pad = ' Leave Link  701 at Thu Nov 13 10:00:00 2025, MaxMem=  1048576 cpu:    0.0 sec\n';
    while (size < 1.05e6) {
      chunks.push(pad);
      size += pad.length;
    }
    chunks.push(normalTermination());
    return chunks.join('');
  }

  const text = largeLog();
  check('大日志长度 ≥ 1 MB（实际 ' + text.length + ' chars）', text.length >= 1e6);
  const start = process.hrtime.bigint();
  const results = MolGaussLog.parse(text);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  eq('大日志解析 ok=true', results.ok, true);
  eq('大日志提取 60 个频率模式', results.jobs[0].frequencies.length, 60);
  eq('大日志每个模式 3 个原子位移', results.jobs[0].frequencies[59].displacements.length, 3);
  near('大日志最后一块频率', results.jobs[0].frequencies[59].frequency, 3900 + 19 * 2.2222, 1e-6);
  check('大日志解析耗时 < 300ms（实际 ' + elapsedMs.toFixed(1) + 'ms）', elapsedMs < 300, elapsedMs + 'ms');
});

/* ===========================================================================
 * 16. 极端/畸形输入
 * ========================================================================= */
suite('畸形输入健壮性', function () {
  const nanLog = baseHeader('#p hf/3-21g') + ORIENTATION_3ATOMS + '\n' +
    ' SCF Done:  E(RHF) =  NaN     A.U. after   10 cycles\n' +
    ' SCF Done:  E(RHF) =  -76.1234567890     A.U. after   12 cycles\n\n' +
    normalTermination();
  let r;
  let threw = false;
  try {
    r = MolGaussLog.parse(nanLog);
  } catch (err) {
    threw = true;
  }
  check('SCF Done 含 NaN 时不抛异常', !threw);
  eq('NaN 能量被跳过、保留有效能量', threw ? -1 : r.jobs[0].scfEnergies.length, 1);

  const garbage = ' Entering Link 1 = test\n' + ' ~~~~@@@### $$$ %%%\n'.repeat(200) + ' Normal termination of Gaussian 16\n';
  let threw2 = false;
  try {
    MolGaussLog.parse(garbage);
  } catch (err) {
    threw2 = true;
  }
  check('乱码行不抛异常', !threw2);

  const clipped = readFixture('water-opt-freq.log').slice(0, 2500);
  let threw3 = false;
  try {
    const cr = MolGaussLog.parse(clipped);
    check('截断日志返回合法结构', cr && Array.isArray(cr.jobs) && Array.isArray(cr.warnings));
  } catch (err) {
    threw3 = true;
  }
  check('截断日志不抛异常', !threw3);

  // 确定性模糊测试 1：fixture 所有截断切片
  const full = readFixture('water-opt-freq.log');
  let sliceOk = true;
  let sliceDetail = '';
  for (let cut = 0; cut < full.length; cut += 211) {
    try {
      const r = MolGaussLog.parse(full.slice(cut));
      if (!r || typeof r.ok !== 'boolean' || !Array.isArray(r.jobs) ||
          !Array.isArray(r.warnings) || !r.summary) {
        sliceOk = false;
        sliceDetail = 'slice ' + cut + ' 结构不合法';
        break;
      }
    } catch (err) {
      sliceOk = false;
      sliceDetail = 'slice ' + cut + ': ' + err.message;
      break;
    }
  }
  check('fixture 全部截断切片解析不抛异常且结构合法（' + Math.ceil(full.length / 211) + ' 个切片）', sliceOk, sliceDetail);

  // 确定性模糊测试 2：伪随机乱码（含 Gaussian 关键词）
  let seed = 20251113;
  function rand() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }
  let fuzzOk = true;
  let fuzzDetail = '';
  for (let k = 0; k < 20; k++) {
    let garbage = '';
    const len = Math.floor(rand() * 1500);
    for (let j = 0; j < len; j++) garbage += String.fromCharCode(32 + Math.floor(rand() * 95));
    const prefix = [' SCF Done:  E(RB3LYP) =  -76.4     A.U. after    6 cycles\n',
      ' Frequencies --   1600.1234\n',
      ' Normal termination of Gaussian 16\n'][k % 3];
    try {
      const r = MolGaussLog.parse(prefix + garbage);
      if (!r || typeof r.ok !== 'boolean' || !Array.isArray(r.jobs)) {
        fuzzOk = false;
        fuzzDetail = '第 ' + (k + 1) + ' 次乱码结构不合法';
        break;
      }
    } catch (err) {
      fuzzOk = false;
      fuzzDetail = '第 ' + (k + 1) + ' 次乱码抛异常: ' + err.message;
      break;
    }
  }
  check('20 组伪随机乱码文本解析不抛异常', fuzzOk, fuzzDetail);

  // 纯 route + 无结果：ok=true 但 hasAnalysis=false
  const noResults = [
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  999.',
    '',
    ' ---------------------------------------------------------------',
    ' #p hf/3-21g',
    ' ---------------------------------------------------------------',
    ' Single point',
    '',
    ' Charge =  0 Multiplicity = 1',
    '',
    ' Normal termination of Gaussian 16 at Thu Nov 13 10:00:00 2025.'
  ].join('\n');
  const nr = MolGaussLog.parse(noResults);
  eq('无结果日志 ok=true', nr.ok, true);
  eq('无结果日志 hasAnalysis=false', nr.summary.hasAnalysis, false);
  eq('无结果日志 hasAnalysis(results)=false', MolGaussLog.hasAnalysis(nr), false);
});

/* ===========================================================================
 * 17. 跨模块：js/parsers.js 可解析同一 fixture
 * ========================================================================= */
suite('跨模块兼容（parsers.js）', function () {
  const MolCore = require('../js/core.js');
  require('../js/parsers.js');
  const fixtureText = readFixture('water-opt-freq.log');
  eq('parsers.detectFormat(fixture) = log', MolCore.detectFormat(fixtureText), 'log');
  const parsed = MolCore.parseFile(fixtureText, { format: 'log' });
  eq('parsers 解析出 5 帧（5 个 Standard orientation）', parsed.molecules.length, 5);
  eq('每帧 3 个原子', parsed.molecules.every(function (m) { return m.atoms.length === 3; }), true);
  near('第 1 帧 H 原子 y 坐标', parsed.molecules[0].atoms[1].y, 0.763239);
  near('最后 1 帧 H 原子 y 坐标', parsed.molecules[4].atoms[1].y, 0.75695);
  eq('charge 0 / multiplicity 1', parsed.molecules[0].charge + '/' + parsed.molecules[0].multiplicity, '0/1');
});

/* ===========================================================================
 * 结果汇总
 * ========================================================================= */
console.log('\n' + '='.repeat(60));
if (failures.length > 0) {
  console.log('失败明细：');
  failures.forEach(function (f, i) {
    console.log('  ' + (i + 1) + '. [' + f.group + '] ' + f.name + (f.detail ? '\n     ' + f.detail : ''));
  });
  console.log('\n❌ 总计：通过 ' + passed + '/' + checks + '，失败 ' + failures.length + ' 项');
  process.exit(1);
} else {
  console.log('✅ 全部通过：' + passed + '/' + checks + ' 项断言');
  console.log('✅ gausslog 测试完成，退出码 0');
  process.exit(0);
}
