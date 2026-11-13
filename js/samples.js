/* =============================================================================
 * MolEdit — js/samples.js（由 tools/gen-samples.mjs 生成，请勿手改）
 * 内置示例分子；file:// 下无法 fetch，示例文本直接内嵌。
 * 全局：MolSamples = { list: [{key,name,nameEn,format,filename}], get(key), all }
 * ========================================================================== */
(function (root) {
  'use strict';
  const SAMPLES = [
    {
      key: "water-xyz",
      name: "水 H₂O（XYZ）",
      nameEn: "Water H₂O (XYZ)",
      format: "xyz",
      filename: "water.xyz",
      text: "3\nwater (H2O)\nO 0.00000000 0.00000000 0.00000000\nH 0.75680000 0.58600000 0.00000000\nH -0.75680000 0.58600000 0.00000000\n"
    },
    {
      key: "methane-gjf",
      name: "甲烷 CH₄（GJF）",
      nameEn: "Methane CH₄ (GJF)",
      format: "gjf",
      filename: "methane.gjf",
      text: "#p b3lyp/6-31g(d) opt\n\nMethane optimization\n\n0 1\n C         0.000000000000       0.000000000000       0.000000000000\n H         0.629000000000       0.629000000000       0.629000000000\n H        -0.629000000000      -0.629000000000       0.629000000000\n H        -0.629000000000       0.629000000000      -0.629000000000\n H         0.629000000000      -0.629000000000      -0.629000000000\n\n"
    },
    {
      key: "methanol-gjf",
      name: "甲醇 CH₃OH（GJF，含连接性）",
      nameEn: "Methanol CH₃OH (GJF, with connectivity)",
      format: "gjf",
      filename: "methanol.gjf",
      text: "%chk=methanol.chk\n#p b3lyp/6-31g(d) opt geom=connectivity\n\nMethanol optimization\n\n0 1\n C         0.000000000000       0.000000000000       0.000000000000\n O         1.430000000000       0.000000000000       0.000000000000\n H        -0.363300000000       1.027700000000       0.000000000000\n H        -0.363300000000      -0.513900000000       0.890000000000\n H        -0.363300000000      -0.513900000000      -0.890000000000\n H         1.734612470149       0.910390708998       0.000000000000\n\n 1 2 1.0 3 1.0 4 1.0 5 1.0\n 2 1 1.0 6 1.0\n 3 1 1.0\n 4 1 1.0\n 5 1 1.0\n 6 2 1.0\n\n"
    },
    {
      key: "benzene-sdf",
      name: "苯 C₆H₆（SDF）",
      nameEn: "Benzene C₆H₆ (SDF)",
      format: "sdf",
      filename: "benzene.sdf",
      text: "benzene\n  MolEdit samples\n\n 12 12  0  0  0  0  0  0  0  0999 V2000\n    1.3900    0.0000    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n    0.6950    1.2038    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n   -0.6950    1.2038    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n   -1.3900    0.0000    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n   -0.6950   -1.2038    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n    0.6950   -1.2038    0.0000 C  0  0  0  0  0  0  0  0  0  0  0  0\n    2.4800    0.0000    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n    1.2400    2.1477    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n   -1.2400    2.1477    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n   -2.4800    0.0000    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n   -1.2400   -2.1477    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n    1.2400   -2.1477    0.0000 H  0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  2  0  0  0  0\n  2  3  1  0  0  0  0\n  3  4  2  0  0  0  0\n  4  5  1  0  0  0  0\n  5  6  2  0  0  0  0\n  1  6  1  0  0  0  0\n  1  7  1  0  0  0  0\n  2  8  1  0  0  0  0\n  3  9  1  0  0  0  0\n  4 10  1  0  0  0  0\n  5 11  1  0  0  0  0\n  6 12  1  0  0  0  0\nM  END\n$$$$\n"
    },
    {
      key: "butane-xyz",
      name: "丁烷 C₄H₁₀（XYZ，二面角练习）",
      nameEn: "Butane C₄H₁₀ (XYZ, dihedral practice)",
      format: "xyz",
      filename: "butane.xyz",
      text: "14\nbutane (anti)\nC 0.00000000 0.00000000 0.00000000\nC 1.53000000 0.00000000 0.00000000\nC 2.10314809 1.41859130 0.00000000\nC 3.63314809 1.41859130 0.00000000\nH -0.36331144 0.00000000 1.02766960\nH -0.36331144 -0.88998798 -0.51383480\nH -0.36331144 0.88998798 -0.51383480\nH 3.99645953 1.41859130 -1.02766960\nH 3.99645953 0.52860332 0.51383480\nH 3.99645953 2.30857927 0.51383480\nH 1.15898629 -1.02491406 0.00000000\nH 2.61926795 -0.03994164 0.00000000\nH 1.01388014 1.45853294 0.00000000\nH 2.47416180 2.44350536 0.00000000\n"
    },
    {
      key: "water-log",
      name: "水分子 Gaussian 输出（LOG，2 帧轨迹）",
      nameEn: "Water Gaussian log (2-frame trajectory)",
      format: "log",
      filename: "water.log",
      text: " Entering Link 1 = C:\\G16W\\G16.exe pid=  4321  ...\n\n Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.\n\n ---------------------------------------------------------------\n #p b3lyp/6-31g(d) opt\n ---------------------------------------------------------------\n Water optimization\n\n Symbolic Z-matrix:\n Charge =  0 Multiplicity = 1\n O\n H  1  0.96\n H  1  0.96  2  104.5\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1            8            0     0.000000     0.000000     0.000000\n      2            1            0     0.763000     0.586000     0.000000\n      3            1            0    -0.763000     0.586000     0.000000\n ---------------------------------------------------------------------\n SCF Done:  E(RB3LYP) =  -76.4094031546     A.U. after   10 cycles\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1            8            0     0.000000     0.000000     0.000000\n      2            1            0     0.756800     0.586000     0.000000\n      3            1            0    -0.756800     0.586000     0.000000\n ---------------------------------------------------------------------\n SCF Done:  E(RB3LYP) =  -76.4089399955     A.U. after    6 cycles\n\n Charge =  0 Multiplicity = 1\n\n Job cpu time:       0 days  0 hours  0 minutes  3.2 seconds.\n File lengths (MBytes):  RWF=      5 Int=      0 D2E=      0 Chk=      1 Scr=      1\n\n Normal termination of Gaussian 16 at Thu Oct 30 12:34:56 2025.\n"
    },
    {
      key: "water-opt-freq",
      name: "水分子 opt+freq 计算（LOG，结果演示）",
      nameEn: "Water opt+freq log (results demo)",
      format: "log",
      filename: "water-opt-freq.log",
      text: " Entering Gaussian System, Link 0=g16\n Initial command:\n /usr/local/g16/l1.exe \"/tmp/scratch/Gau-12345.inp\" -scrdir=\"/tmp/scratch/\"\n Entering Link 1 = /usr/local/g16/l1.exe pid=  12345.\n\n Copyright (c) 1988-2019, Gaussian, Inc.  All Rights Reserved.\n\n ---------------------------------------------------------------\n #p b3lyp/6-31g(d) opt freq\n ---------------------------------------------------------------\n Water opt+freq calculation (B3LYP/6-31G(d))\n\n Symbolic Z-matrix:\n Charge =  0 Multiplicity = 1\n O\n H  1  0.96\n H  1  0.96  2  104.5\n\n NAtoms=      3 NActive=      3 NUniq=      2 SFac= 1.00D+00 NAtFMM=   60 NQMAtoms=      3\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1          8            0     0.000000     0.000000     0.119262\n      2          1            0     0.000000     0.763239    -0.477072\n      3          1            0     0.000000    -0.763239    -0.477072\n ---------------------------------------------------------------------\n Rotational constants (GHZ):     278.4962     49.8601     41.5451\n\n SCF Done:  E(RB3LYP) =  -76.4088123456     A.U. after     8 cycles\n             NFock=  8  Conv=0.21D-08     -V/T= 2.0028\n\n GradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGrad\n Berny optimization.\n Cartesian Forces:  Max     0.004321 RMS     0.001234\n\n         Item               Value     Threshold  Converged?\n Maximum Force             0.004321       0.000450     NO\n RMS     Force             0.001234       0.000300     NO\n Maximum Displacement      0.012345       0.001800     NO\n RMS     Displacement      0.004321       0.001200     NO\n Predicted change in Energy=-1.234567D-07\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1          8            0     0.000000     0.000000     0.117800\n      2          1            0     0.000000     0.760500    -0.471100\n      3          1            0     0.000000    -0.760500    -0.471100\n ---------------------------------------------------------------------\n Rotational constants (GHZ):     279.1234     49.9876     41.6789\n\n SCF Done:  E(RB3LYP) =  -76.4091234567     A.U. after     6 cycles\n             NFock=  6  Conv=0.21D-08     -V/T= 2.0028\n\n GradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGrad\n Berny optimization.\n Cartesian Forces:  Max     0.000876 RMS     0.000245\n\n         Item               Value     Threshold  Converged?\n Maximum Force             0.000876       0.000450     NO\n RMS     Force             0.000245       0.000300     YES\n Maximum Displacement      0.003456       0.001800     NO\n RMS     Displacement      0.000987       0.001200     YES\n Predicted change in Energy=-4.567890D-08\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1          8            0     0.000000     0.000000     0.117300\n      2          1            0     0.000000     0.757200    -0.469200\n      3          1            0     0.000000    -0.757200    -0.469200\n ---------------------------------------------------------------------\n Rotational constants (GHZ):     279.5001     49.9999     41.7001\n\n SCF Done:  E(RB3LYP) =  -76.4093123456     A.U. after     4 cycles\n             NFock=  4  Conv=0.21D-08     -V/T= 2.0028\n\n GradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGrad\n Berny optimization.\n Cartesian Forces:  Max     0.000123 RMS     0.000034\n\n         Item               Value     Threshold  Converged?\n Maximum Force             0.000123       0.000450     YES\n RMS     Force             0.000034       0.000300     YES\n Maximum Displacement      0.000890       0.001800     YES\n RMS     Displacement      0.000234       0.001200     YES\n Predicted change in Energy=-2.345678D-09\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1          8            0     0.000000     0.000000     0.117176\n      2          1            0     0.000000     0.756950    -0.468780\n      3          1            0     0.000000    -0.756950    -0.468780\n ---------------------------------------------------------------------\n Rotational constants (GHZ):     279.6123     50.0123     41.7123\n\n SCF Done:  E(RB3LYP) =  -76.4093345678     A.U. after     3 cycles\n             NFock=  3  Conv=0.21D-08     -V/T= 2.0028\n\n GradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGradGrad\n Berny optimization.\n Cartesian Forces:  Max     0.000021 RMS     0.000006\n\n         Item               Value     Threshold  Converged?\n Maximum Force             0.000021       0.000450     YES\n RMS     Force             0.000006       0.000300     YES\n Maximum Displacement      0.000120       0.001800     YES\n RMS     Displacement      0.000032       0.001200     YES\n Predicted change in Energy=-1.234567D-10\n\n Optimization completed.\n    -- Stationary point found.\n\n                          Final structure in terms of initial Z-matrix:\n\n                         Standard orientation:                         \n ---------------------------------------------------------------------\n Center     Atomic      Atomic             Coordinates (Angstroms)\n Number     Number       Type             X           Y           Z\n ---------------------------------------------------------------------\n      1          8            0     0.000000     0.000000     0.117176\n      2          1            0     0.000000     0.756950    -0.468780\n      3          1            0     0.000000    -0.756950    -0.468780\n ---------------------------------------------------------------------\n Rotational constants (GHZ):     279.6123     50.0123     41.7123\n\n Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering\n activities (A**4/AMU), depolarization ratios for plane and unpolarized\n incident light, reduced masses (AMU), force constants (mDyne/A),\n and normal coordinates:\n                       1                      2                      3\n                      A1                     A1                     B2\n Frequencies --              1600.1234             3800.5678             3900.1111\n Red. masses --                 1.0820                1.0772                1.0910\n Frc consts  --                 1.6342                9.7863               10.0893\n IR Inten    --                12.3456               45.6789               67.8901\n  Atom  AN      X      Y      Z        X      Y      Z        X      Y      Z\n     1    8   0.000000   0.000000   0.068000   0.000000   0.000000  -0.054000   0.000000   0.000000   0.000000\n     2    1   0.000000   0.070000  -0.034000   0.000000   0.065000   0.027000   0.000000   0.072000   0.000000\n     3    1   0.000000  -0.070000  -0.034000   0.000000  -0.065000   0.027000   0.000000  -0.072000   0.000000\n\n ------------------\n - Thermochemistry -\n ------------------\n Temperature   298.150 Kelvin.  Pressure   1.00000 Atm.\n Volume (1000 K):  24414.2 bohr^3\n Molecular mass:    18.01514 amu.\n Rotational constants (GHZ): 278.4962 49.8601 41.5451\n Zero-point correction=                           0.021241 (Hartree/Particle)\n Thermal correction to Energy=                    0.023456\n Thermal correction to Enthalpy=                  0.023800\n Thermal correction to Gibbs Free Energy=         0.003124\n Sum of electronic and zero-point Energies=             -76.388094\n Sum of electronic and thermal Energies=                -76.385879\n Sum of electronic and thermal Enthalpies=              -76.385535\n Sum of electronic and thermal Free Energies=           -76.406211\n\n Normal termination of Gaussian 16 at Thu Nov 13 10:15:00 2025.\n"
    }
  ];

  const byKey = Object.create(null);
  const list = SAMPLES.map(function (s) {
    byKey[s.key] = s;
    return { key: s.key, name: s.name, nameEn: s.nameEn, format: s.format, filename: s.filename };
  });

  root.MolSamples = {
    list: list,
    all: SAMPLES,
    get: function (key) { return byKey[key] || null; },
    has: function (key) { return !!byKey[key]; }
  };

  if (typeof module === 'object' && module.exports) module.exports = root.MolSamples;
})(typeof globalThis !== 'undefined' ? globalThis : this);
