/* MolEdit — tools/gen-log-sample.mjs
 * 生成“真实风格”的 Gaussian 16 输出日志夹具（用于 js/gausslog.js 深度解析 + UI 结果面板演示）。
 *
 * 运行：node tools/gen-log-sample.mjs
 *   写出 tests/fixtures/water-opt-freq.log    水分子 opt freq 完整日志（供 Lead 复制到 samples/）
 *         tests/fixtures/water-multi-job.log   两个 job（opt / freq，Entering Link 1 分区）
 *         tests/fixtures/water-hpmodes.log     freq=hpmodes 风格日志
 *
 * 仅供测试/示例使用，非真实计算结果（数值经过设计以便单测断言）。
 * 导出：buildOptFreqLog() / buildMultiJobLog() / buildHpmodesLog()
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');

const ATOMIC_NUMBER = { H: 1, C: 6, N: 7, O: 8, F: 9 };

/* ---------------------------------------------------------------------------
 * 固定数值（tests/gausslog.test.mjs 会断言这些值，改动需同步测试）
 * ------------------------------------------------------------------------- */

const STEP_ENERGIES = [
  '-76.4088123456',
  '-76.4091234567',
  '-76.4093123456',
  '-76.4093345678'
];
const STEP_CYCLES = [8, 6, 4, 3];

const STEP_GEOMS = [
  [['O', 0.000000, 0.000000, 0.119262], ['H', 0.000000, 0.763239, -0.477072], ['H', 0.000000, -0.763239, -0.477072]],
  [['O', 0.000000, 0.000000, 0.117800], ['H', 0.000000, 0.760500, -0.471100], ['H', 0.000000, -0.760500, -0.471100]],
  [['O', 0.000000, 0.000000, 0.117300], ['H', 0.000000, 0.757200, -0.469200], ['H', 0.000000, -0.757200, -0.469200]],
  [['O', 0.000000, 0.000000, 0.117176], ['H', 0.000000, 0.756950, -0.468780], ['H', 0.000000, -0.756950, -0.468780]]
];
const FINAL_GEOM = STEP_GEOMS[3];

/* 每个优化步的收敛表：顺序 = Maximum Force / RMS Force / Maximum Displacement / RMS Displacement */
const STEP_CONV = [
  {
    values: ['0.004321', '0.001234', '0.012345', '0.004321'],
    flags: ['NO', 'NO', 'NO', 'NO'],
    pred: '-1.234567D-07'
  },
  {
    values: ['0.000876', '0.000245', '0.003456', '0.000987'],
    flags: ['NO', 'YES', 'NO', 'YES'],
    pred: '-4.567890D-08'
  },
  {
    values: ['0.000123', '0.000034', '0.000890', '0.000234'],
    flags: ['YES', 'YES', 'YES', 'YES'],
    pred: '-2.345678D-09'
  },
  {
    values: ['0.000021', '0.000006', '0.000120', '0.000032'],
    flags: ['YES', 'YES', 'YES', 'YES'],
    pred: '-1.234567D-10'
  }
];

const THRESHOLDS = ['0.000450', '0.000300', '0.001800', '0.001200'];
const CONV_LABELS = ['Maximum Force', 'RMS     Force', 'Maximum Displacement', 'RMS     Displacement'];

const ROT_CONSTANTS = [
  ' Rotational constants (GHZ):     278.4962     49.8601     41.5451',
  ' Rotational constants (GHZ):     279.1234     49.9876     41.6789',
  ' Rotational constants (GHZ):     279.5001     49.9999     41.7001',
  ' Rotational constants (GHZ):     279.6123     50.0123     41.7123'
];

/* 热化学（Hartree / Kelvin / Atm）——完整 8 项 */
const THERMO = {
  temperature: '298.150',
  pressure: '1.00000',
  zeroPointCorrection: '0.021241',
  thermalCorrectionEnergy: '0.023456',
  thermalCorrectionEnthalpy: '0.023800',
  thermalCorrectionGibbs: '0.003124',
  sumElectronicZeroPoint: '-76.388094',
  sumElectronicThermal: '-76.385879',
  sumElectronicEnthalpy: '-76.385535',
  sumElectronicGibbs: '-76.406211'
};

/* 3 个振动模式：~1600 / 3800 / 3900 cm^-1，每个模式 3 个原子位移 */
const MODES = [
  {
    label: 'A1', freq: '1600.1234', ir: '12.3456', mass: '1.0820', frc: '1.6342',
    disps: [[0.000000, 0.000000, 0.068000], [0.000000, 0.070000, -0.034000], [0.000000, -0.070000, -0.034000]]
  },
  {
    label: 'A1', freq: '3800.5678', ir: '45.6789', mass: '1.0772', frc: '9.7863',
    disps: [[0.000000, 0.000000, -0.054000], [0.000000, 0.065000, 0.027000], [0.000000, -0.065000, 0.027000]]
  },
  {
    label: 'B2', freq: '3900.1111', ir: '67.8901', mass: '1.0910', frc: '10.0893',
    disps: [[0.000000, 0.000000, 0.000000], [0.000000, 0.072000, 0.000000], [0.000000, -0.072000, 0.000000]]
  }
];

/* ---------------------------------------------------------------------------
 * 文本片段构造
 * ------------------------------------------------------------------------- */

function pad(v, width) {
  return String(v).padStart(width);
}

/** Gaussian “Standard orientation:” 坐标块（5 行表头 + N 行原子 + 分隔线）。 */
function orientationBlock(coords, rotLine) {
  const lines = [
    '                         Standard orientation:                         ',
    ' ---------------------------------------------------------------------',
    ' Center     Atomic      Atomic             Coordinates (Angstroms)',
    ' Number     Number       Type             X           Y           Z',
    ' ---------------------------------------------------------------------'
  ];
  coords.forEach((c, idx) => {
    lines.push(
      pad(idx + 1, 7) +
      pad(ATOMIC_NUMBER[c[0]], 11) +
      pad(0, 13) +
      pad(c[1].toFixed(6), 13) +
      pad(c[2].toFixed(6), 13) +
      pad(c[3].toFixed(6), 13)
    );
  });
  lines.push(' ---------------------------------------------------------------------');
  if (rotLine) lines.push(rotLine);
  lines.push('');
  return lines.join('\n');
}

/** SCF Done 行（Gaussian 16 格式）。 */
function scfDoneLine(energy, cycles) {
  return (
    ' SCF Done:  E(RB3LYP) =  ' + energy + '     A.U. after    ' + pad(cycles, 2) + ' cycles\n' +
    '             NFock=  ' + cycles + '  Conv=0.21D-08     -V/T= 2.0028'
  );
}

/** 优化收敛判据表（Item/Value/Threshold/Converged? + Predicted change in Energy）。 */
function convergenceTable(conv) {
  const lines = ['         Item               Value     Threshold  Converged?'];
  for (let i = 0; i < 4; i++) {
    lines.push(
      ' ' + CONV_LABELS[i].padEnd(24) + conv.values[i].padStart(10) +
      '     ' + THRESHOLDS[i].padStart(10) + '     ' + conv.flags[i]
    );
  }
  lines.push(' Predicted change in Energy=' + conv.pred);
  return lines.join('\n');
}

/** 一个优化步：几何 + SCF Done + 力/收敛表。 */
function optStep(stepIndex) {
  const parts = [
    orientationBlock(STEP_GEOMS[stepIndex], ROT_CONSTANTS[stepIndex]),
    scfDoneLine(STEP_ENERGIES[stepIndex], STEP_CYCLES[stepIndex]),
    '',
    ' GradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGrad',
    ' Berny optimization.',
    ' Cartesian Forces:  Max     ' + STEP_CONV[stepIndex].values[0] +
      ' RMS     ' + STEP_CONV[stepIndex].values[1],
    '',
    convergenceTable(STEP_CONV[stepIndex]),
    ''
  ];
  return parts.join('\n');
}

/** 频率段（普通 non-hpmodes 格式）：1 块 3 个模式。 */
function frequencySection() {
  const cols = MODES.length;
  const lines = [
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering',
    ' activities (A**4/AMU), depolarization ratios for plane and unpolarized',
    ' incident light, reduced masses (AMU), force constants (mDyne/A),',
    ' and normal coordinates:',
    ' ' + MODES.map((m, k) => pad(k + 1, 23)).join('').trimEnd(),
    ' ' + MODES.map((m) => pad(m.label, 23)).join('').trimEnd(),
    ' Frequencies -- ' + MODES.map((m) => pad(m.freq, 22)).join('').trimEnd(),
    ' Red. masses -- ' + MODES.map((m) => pad(m.mass, 22)).join('').trimEnd(),
    ' Frc consts  -- ' + MODES.map((m) => pad(m.frc, 22)).join('').trimEnd(),
    ' IR Inten    -- ' + MODES.map((m) => pad(m.ir, 22)).join('').trimEnd(),
    '  Atom  AN      X      Y      Z        X      Y      Z        X      Y      Z'
  ];
  for (let a = 0; a < 3; a++) {
    const row = [pad(a + 1, 6), pad(ATOMIC_NUMBER[STEP_GEOMS[0][a][0]], 5)];
    for (let k = 0; k < cols; k++) {
      const d = MODES[k].disps[a];
      row.push(pad(d[0].toFixed(6), 11), pad(d[1].toFixed(6), 11), pad(d[2].toFixed(6), 11));
    }
    lines.push(row.join(''));
  }
  lines.push('');
  return lines.join('\n');
}

/** 热化学段：Temperature/Pressure + 8 项校正能。 */
function thermochemistrySection() {
  return [
    ' ------------------',
    ' - Thermochemistry -',
    ' ------------------',
    ' Temperature   ' + THERMO.temperature + ' Kelvin.  Pressure   ' + THERMO.pressure + ' Atm.',
    ' Volume (1000 K):  24414.2 bohr^3',
    ' Molecular mass:    18.01514 amu.',
    ' Rotational constants (GHZ): 278.4962 49.8601 41.5451',
    ' Zero-point correction=                           ' + THERMO.zeroPointCorrection + ' (Hartree/Particle)',
    ' Thermal correction to Energy=                    ' + THERMO.thermalCorrectionEnergy,
    ' Thermal correction to Enthalpy=                  ' + THERMO.thermalCorrectionEnthalpy,
    ' Thermal correction to Gibbs Free Energy=         ' + THERMO.thermalCorrectionGibbs,
    ' Sum of electronic and zero-point Energies=             ' + THERMO.sumElectronicZeroPoint,
    ' Sum of electronic and thermal Energies=                ' + THERMO.sumElectronicThermal,
    ' Sum of electronic and thermal Enthalpies=              ' + THERMO.sumElectronicEnthalpy,
    ' Sum of electronic and thermal Free Energies=           ' + THERMO.sumElectronicGibbs,
    ''
  ].join('\n');
}

/** 文件头（Entering … + 版权 + route + title + charge/mult + NAtoms）。 */
function jobHeader(route, title) {
  return [
    ' Entering Gaussian System, Link 0=g16',
    ' Initial command:',
    ' /usr/local/g16/l1.exe "/tmp/scratch/Gau-12345.inp" -scrdir="/tmp/scratch/"',
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  12345.',
    '',
    ' Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.',
    '',
    ' ---------------------------------------------------------------',
    ' ' + route,
    ' ---------------------------------------------------------------',
    ' ' + title,
    '',
    ' Symbolic Z-matrix:',
    ' Charge =  0 Multiplicity = 1',
    ' O',
    ' H  1  0.96',
    ' H  1  0.96  2  104.5',
    '',
    ' NAtoms=      3 NActive=      3 NUniq=      2 SFac= 1.00D+00 NAtFMM=   60 NQMAtoms=      3',
    ''
  ].join('\n');
}

/** Normal termination 行（G16 风格）。 */
function normalTermination() {
  return ' Normal termination of Gaussian 16 at Thu Nov 13 10:15:00 2025.';
}

/* ---------------------------------------------------------------------------
 * 导出：三种夹具
 * ------------------------------------------------------------------------- */

/**
 * 水分子 B3LYP/6-31G(d) opt freq 完整日志（单 job）：
 * - 4 个优化步（每步 Standard orientation + SCF Done + 4 项收敛判据表）
 * - Optimization completed. / -- Stationary point found.
 * - 频率段：3 个模式（~1600 / 3800 / 3900 cm^-1，含每原子位移/Red.masses/Frc consts/IR Inten）
 * - 热化学 8 项 + Temperature/Pressure
 * - Normal termination
 * 全文共 5 个 Standard orientation（4 个优化步几何 + 频率计算前的最优几何），
 * 因此频率几何的全局帧索引 = 4。
 */
export function buildOptFreqLog() {
  const parts = [
    jobHeader('#p b3lyp/6-31g(d) opt freq', 'Water opt+freq calculation (B3LYP/6-31G(d))'),
    optStep(0),
    optStep(1),
    optStep(2),
    optStep(3),
    ' Optimization completed.',
    '    -- Stationary point found.',
    '',
    '                          Final structure in terms of initial Z-matrix:',
    '',
    orientationBlock(FINAL_GEOM, ROT_CONSTANTS[3]),
    frequencySection(),
    thermochemistrySection(),
    normalTermination(),
    ''
  ];
  return parts.join('\n');
}

/**
 * 两个 job 的日志（Entering Link 1 分区）：
 * job 0 = 2 步优化；job 1 = 频率 + 热化学（freqFrameIndex 应为全局帧 2）。
 */
export function buildMultiJobLog() {
  const job1 = [
    jobHeader('#p opt b3lyp/6-31g(d)', 'Water optimization (job 1 of 2)'),
    optStep(0),
    optStep(3),
    ' Optimization completed.',
    '    -- Stationary point found.',
    '',
    normalTermination(),
    ''
  ].join('\n');

  const job2 = [
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  12346.',
    '',
    ' Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.',
    '',
    ' ---------------------------------------------------------------',
    ' #p freq b3lyp/6-31g(d)',
    ' ---------------------------------------------------------------',
    ' Water frequency (job 2 of 2)',
    '',
    ' Symbolic Z-matrix:',
    ' Charge =  0 Multiplicity = 1',
    ' O',
    ' H  1  0.96',
    ' H  1  0.96  2  104.5',
    '',
    ' NAtoms=      3 NActive=      3 NUniq=      2 SFac= 1.00D+00 NAtFMM=   60 NQMAtoms=      3',
    '',
    orientationBlock(FINAL_GEOM, ROT_CONSTANTS[3]),
    scfDoneLine(STEP_ENERGIES[3], STEP_CYCLES[3]),
    '',
    frequencySection(),
    thermochemistrySection(),
    normalTermination(),
    ''
  ].join('\n');

  return job1 + '\n' + job2;
}

/** freq=hpmodes 风格日志：Frequencies --- / Reduced masses --- / Coord Atom Element 分组。 */
export function buildHpmodesLog() {
  const hp = [
    ' Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering',
    ' activities (A**4/AMU), depolarization ratios for plane and unpolarized',
    ' incident light, reduced masses (AMU), force constants (mDyne/A),',
    ' and normal coordinates:',
    ' ' + MODES.map((m, k) => pad(k + 1, 23)).join('').trimEnd(),
    ' ' + MODES.map((m) => pad(m.label, 23)).join('').trimEnd(),
    ' Frequencies --- ' + MODES.map((m) => pad(m.freq, 22)).join('').trimEnd(),
    ' Reduced masses --- ' + MODES.map((m) => pad(m.mass, 22)).join('').trimEnd(),
    ' Force constants --- ' + MODES.map((m) => pad(m.frc, 22)).join('').trimEnd(),
    ' IR Intensities --- ' + MODES.map((m) => pad(m.ir, 22)).join('').trimEnd()
  ];
  MODES.forEach((m) => {
    hp.push(' Coord Atom Element:');
    for (let a = 0; a < 3; a++) {
      const d = m.disps[a];
      hp.push(
        ' ' + pad(a + 1, 4) + pad(a + 1, 6) + pad(ATOMIC_NUMBER[FINAL_GEOM[a][0]], 6) +
        pad(d[0].toFixed(6), 11) + pad(d[1].toFixed(6), 11) + pad(d[2].toFixed(6), 11)
      );
    }
  });
  hp.push('');

  const parts = [
    ' Entering Link 1 = /usr/local/g16/l1.exe pid=  12347.',
    '',
    ' Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.',
    '',
    ' ---------------------------------------------------------------',
    ' #p freq=hpmodes b3lyp/6-31g(d)',
    ' ---------------------------------------------------------------',
    ' Water frequency (hpmodes)',
    '',
    ' Symbolic Z-matrix:',
    ' Charge =  0 Multiplicity = 1',
    ' O',
    ' H  1  0.96',
    ' H  1  0.96  2  104.5',
    '',
    ' NAtoms=      3 NActive=      3 NUniq=      2 SFac= 1.00D+00 NAtFMM=   60 NQMAtoms=      3',
    '',
    orientationBlock(FINAL_GEOM, ROT_CONSTANTS[3]),
    scfDoneLine(STEP_ENERGIES[3], STEP_CYCLES[3]),
    '',
    hp.join('\n'),
    thermochemistrySection(),
    normalTermination(),
    ''
  ];
  return parts.join('\n');
}

/* ---------------------------------------------------------------------------
 * CLI：写出夹具文件
 * ------------------------------------------------------------------------- */

const FIXTURES = [
  { file: 'water-opt-freq.log', text: buildOptFreqLog },
  { file: 'water-multi-job.log', text: buildMultiJobLog },
  { file: 'water-hpmodes.log', text: buildHpmodesLog }
];

function main() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  FIXTURES.forEach((f) => {
    const text = f.text();
    const target = path.join(FIXTURE_DIR, f.file);
    fs.writeFileSync(target, text, 'utf8');
    const lines = text.split('\n').length;
    console.log('  - tests/fixtures/' + f.file + '  (' + text.length + ' chars, ' + lines + ' lines)');
  });
  console.log('已生成 Gaussian LOG 夹具（' + FIXTURES.length + ' 个）');
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch (err) {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
