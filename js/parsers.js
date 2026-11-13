/*!
 * parsers.js — MolEdit 文件解析器（经典脚本，零依赖）
 *
 * 负责 .xyz / .sdf(MOL V2000) / .gjf(.com) / .log(.out) 的格式检测与解析，
 * 并把全部 API 挂载到 globalThis.MolCore 上（见 INTERFACE.md §6.7）。
 *
 * 本文件可被 Node 直接 require：
 *   const MolCore = require('../js/core.js');
 *   require('../js/parsers.js');
 * 也可在浏览器 file:// 下以经典 <script> 方式加载。
 *
 * 设计原则：
 *   - 可恢复的问题写入 warnings（中文），不抛异常；
 *   - 不可恢复的问题抛 MolCore.ParseError（中文 message，尽量带行号）；
 *   - 所有解析出的 Molecule 满足 INTERFACE.md §5 的数据模型；
 *   - xyz/log 没有显式键时调用 MolCore.inferBonds 并置 bondSource='inferred'。
 */
(function (root) {
  'use strict';

  const MolCore = (root.MolCore = root.MolCore || {});

  /* 防御性上限：防止损坏文件里的超大原子数把内存打爆（正常文件远小于此值）。 */
  const MAX_ATOMS_PER_RECORD = 5000000;

  /* ------------------------------------------------------------------ *
   *  1. 错误类型
   * ------------------------------------------------------------------ */

  class ParseError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ParseError';
    }
  }

  /* ------------------------------------------------------------------ *
   *  2. 元素表（仅当 core.js 的 ELEMENTS / element() 不可用时作为回退）
   * ------------------------------------------------------------------ */

  const FALLBACK_SYMBOLS = [
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

  /* Cordero 等共价半径（Å），用于 core.js 缺失时的回退键推断。 */
  const FALLBACK_COVALENT = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66,
    F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05,
    Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39,
    Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20,
    As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16, Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75,
    Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
    In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15,
    La: 2.07, Ce: 2.04, Pr: 2.03, Nd: 2.01, Pm: 1.99, Sm: 1.98, Eu: 1.98, Gd: 1.96,
    Tb: 1.94, Dy: 1.92, Ho: 1.92, Er: 1.89, Tm: 1.90, Yb: 1.87, Lu: 1.87, Hf: 1.75,
    Ta: 1.70, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32,
    Tl: 1.45, Pb: 1.46, Bi: 1.48, Po: 1.40, At: 1.50, Rn: 1.50, Fr: 2.60, Ra: 2.21,
    Ac: 2.15, Th: 2.06, Pa: 2.00, U: 1.96, Np: 1.90, Pu: 1.87, Am: 1.80, Cm: 1.69
  };

  const radiusCache = Object.create(null);

  function fallbackLookupElement(token) {
    if (token == null) return null;
    const raw = String(token).trim();
    if (raw === '') return null;
    if (/^\d+$/.test(raw)) {
      const number = parseInt(raw, 10);
      if (number < 1 || number > FALLBACK_SYMBOLS.length) return null;
      const symbol = FALLBACK_SYMBOLS[number - 1];
      return {
        symbol: symbol,
        atomicNumber: number,
        covalent: FALLBACK_COVALENT[symbol] || 1.5
      };
    }
    const symbol = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const index = FALLBACK_SYMBOLS.indexOf(symbol);
    if (index < 0) return null;
    return {
      symbol: symbol,
      atomicNumber: index + 1,
      covalent: FALLBACK_COVALENT[symbol] || 1.5
    };
  }

  /**
   * 解析元素记号（符号如 "C" / "cl" 或原子序数如 "6"）。
   * 优先使用 core.js 的 MolCore.element()，缺失时回退到内置表。
   * 返回 { symbol, atomicNumber, ... } 或 null。
   */
  function lookupElement(token) {
    if (token == null) return null;
    let raw = String(token).trim();
    if (raw === '') return null;
    /* 同位素记号 D/T（氘/氚）按氢处理 */
    if (/^[dDtT]$/.test(raw)) raw = 'H';

    const core = root.MolCore;
    if (core && typeof core.element === 'function') {
      try {
        const info = core.element(raw);
        if (info && info.symbol) return info;
      } catch (err) {
        /* 忽略，走内置回退 */
      }
    }
    return fallbackLookupElement(raw);
  }

  function covalentRadius(symbol) {
    if (radiusCache[symbol] != null) return radiusCache[symbol];
    let radius = 1.5;
    const info = lookupElement(symbol);
    if (info) {
      if (typeof info.covalent === 'number' && info.covalent > 0) {
        radius = info.covalent;
      } else if (typeof info.vdw === 'number' && info.vdw > 0) {
        radius = Math.max(0.3, info.vdw * 0.55);
      }
    }
    radiusCache[symbol] = radius;
    return radius;
  }

  /* ------------------------------------------------------------------ *
   *  3. 通用小工具
   * ------------------------------------------------------------------ */

  /** 去掉 UTF-8 BOM，统一换行，返回文本（非字符串输入返回空串）。 */
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    let out = text;
    if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
    return out.replace(/\r\n?/g, '\n');
  }

  /** 单行摘要，用于错误信息展示。 */
  function clip(value, maxLength) {
    const limit = maxLength || 60;
    let text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (text.length > limit) text = text.slice(0, limit) + '…';
    return text;
  }

  const NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?$/;

  /** 严格解析数字，支持科学计数法与 Fortran 的 D 指数；失败返回 null。 */
  function parseNumber(token) {
    if (token == null) return null;
    const text = String(token).trim();
    if (text === '' || !NUMBER_RE.test(text)) return null;
    const value = parseFloat(text.replace(/[dD]/, 'e'));
    return isFinite(value) ? value : null;
  }

  /** 严格解析整数记号（不接受小数）；失败返回 null。 */
  function parseInteger(token) {
    if (token == null) return null;
    const text = String(token).trim();
    if (!/^[-+]?\d+$/.test(text)) return null;
    const value = parseInt(text, 10);
    return isFinite(value) ? value : null;
  }

  function tokenizeLine(line) {
    const text = String(line == null ? '' : line).trim();
    if (text === '') return [];
    return text.split(/\s+/);
  }

  function isBlankLine(line) {
    return String(line == null ? '' : line).trim() === '';
  }

  /* ------------------------------------------------------------------ *
   *  4. Molecule 构造 / 键规范化 / 键推断
   * ------------------------------------------------------------------ */

  function makeMolecule(source) {
    return {
      title: '',
      atoms: [],
      bonds: [],
      charge: 0,
      multiplicity: 1,
      source: source,
      energy: null,
      bondSource: 'inferred',
      frameIndex: 0,
      frameCount: 1
    };
  }

  /** 键级规范化：1/2/3 整数，1.5 视为芳香（4），越界夹紧。 */
  function normalizeOrder(order) {
    const raw = Number(order);
    if (!isFinite(raw)) return 1;
    if (raw === 1.5) return 4;
    const rounded = Math.round(raw);
    if (rounded < 1) return 1;
    if (rounded > 4) return 4;
    return rounded;
  }

  /**
   * 规范化键列表：0 基、i<j、去重、稳定排序。
   * @param {Array} list
   * @param {string[]} [warnings]
   */
  function normalizeBonds(list, warnings) {
    const out = [];
    const seen = Object.create(null);
    if (!Array.isArray(list)) return out;
    for (let k = 0; k < list.length; k++) {
      const bond = list[k];
      if (!bond || typeof bond !== 'object') continue;
      let i = Number(bond.i);
      let j = Number(bond.j);
      if (!isFinite(i) || !isFinite(j)) continue;
      i = Math.trunc(i);
      j = Math.trunc(j);
      if (i < 0 || j < 0) continue;
      if (i === j) {
        if (warnings) warnings.push('忽略了一个两端为同一原子的非法化学键（原子索引 ' + i + '）');
        continue;
      }
      if (i > j) {
        const temp = i;
        i = j;
        j = temp;
      }
      const order = normalizeOrder(bond.order);
      const key = i + ',' + j;
      if (seen[key] != null) {
        if (warnings && seen[key] !== order) {
          warnings.push('键 (' + i + ',' + j + ') 重复出现且键级不一致，已保留首次出现的键级 ' + seen[key]);
        }
        continue;
      }
      seen[key] = order;
      out.push({ i: i, j: j, order: order });
    }
    out.sort(function (a, b) {
      return a.i - b.i || a.j - b.j;
    });
    return out;
  }

  /* 内置回退键推断（仅在 core.js 缺失或出错时使用；判据与契约一致）。 */
  function fallbackInferBonds(mol) {
    const atoms = mol && mol.atoms ? mol.atoms : [];
    const bonds = [];
    const count = atoms.length;
    for (let i = 0; i < count; i++) {
      const atomA = atoms[i];
      if (!atomA) continue;
      const radiusA = covalentRadius(atomA.symbol);
      for (let j = i + 1; j < count; j++) {
        const atomB = atoms[j];
        if (!atomB) continue;
        const radiusB = covalentRadius(atomB.symbol);
        const dx = atomA.x - atomB.x;
        const dy = atomA.y - atomB.y;
        const dz = atomA.z - atomB.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const cutoff = (radiusA + radiusB) * 1.15 + 0.25;
        if (distanceSq > 1e-8 && distanceSq <= cutoff * cutoff) {
          bonds.push({ i: i, j: j, order: 1 });
        }
      }
    }
    return bonds;
  }

  /** 推断化学键：优先调用 MolCore.inferBonds（core.js），失败时内置回退。 */
  function inferBonds(mol, warnings) {
    const core = root.MolCore;
    if (core && typeof core.inferBonds === 'function') {
      try {
        const result = core.inferBonds(mol);
        if (Array.isArray(result)) return normalizeBonds(result, warnings);
      } catch (err) {
        if (warnings) {
          warnings.push('MolCore.inferBonds 调用失败，已改用内置共价半径回退推断：' +
            (err && err.message ? err.message : String(err)));
        }
      }
    } else if (warnings) {
      warnings.push('未找到 MolCore.inferBonds（core.js 可能未加载），已使用内置共价半径回退推断化学键');
    }
    return fallbackInferBonds(mol);
  }

  /**
   * 收尾：规范化键，并决定 bondSource。
   * 有显式键 -> explicit；没有显式键 -> 推断并置 inferred。
   */
  function finishMolecule(mol, warnings) {
    mol.atoms = Array.isArray(mol.atoms) ? mol.atoms : [];
    mol.bonds = normalizeBonds(mol.bonds, warnings);
    if (mol.bonds.length > 0) {
      mol.bondSource = 'explicit';
    } else {
      mol.bonds = inferBonds(mol, warnings);
      mol.bondSource = 'inferred';
    }
    if (typeof mol.title !== 'string') mol.title = mol.title == null ? '' : String(mol.title);
    return mol;
  }

  /* 给一批多帧/多记录分子的 frameIndex / frameCount 填好。 */
  function assignFrameInfo(molecules) {
    const total = molecules.length;
    for (let i = 0; i < total; i++) {
      molecules[i].frameIndex = i;
      molecules[i].frameCount = total;
    }
    return molecules;
  }

  /* 元素记号 -> 原子；失败抛中文 ParseError。 */
  function atomFromToken(token, location) {
    const info = lookupElement(token);
    if (!info) {
      throw new ParseError(location + '：无法识别的元素符号或原子序数 "' + clip(token) + '"');
    }
    return info.symbol;
  }

  /* ------------------------------------------------------------------ *
   *  5. XYZ 解析
   * ------------------------------------------------------------------ */

  function parseXyzAtomLine(line, lineNumber) {
    const tokens = tokenizeLine(line);
    if (tokens.length < 4) {
      throw new ParseError('XYZ 文件第 ' + lineNumber + ' 行坐标格式错误（应为“元素 x y z”）："' + clip(line) + '"');
    }
    const symbol = atomFromToken(tokens[0], 'XYZ 文件第 ' + lineNumber + ' 行');
    const x = parseNumber(tokens[1]);
    const y = parseNumber(tokens[2]);
    const z = parseNumber(tokens[3]);
    if (x === null || y === null || z === null) {
      throw new ParseError('XYZ 文件第 ' + lineNumber + ' 行坐标不是合法数字（支持科学计数法）："' + clip(line) + '"');
    }
    return { symbol: symbol, x: x, y: y, z: z };
  }

  /**
   * 解析 XYZ 文本（支持多帧）。
   * @param {string} text
   * @param {string[]} [warnings]
   * @returns {Array} Molecule[]
   */
  function parseXYZ(text, warnings) {
    warnings = warnings || [];
    const lines = normalizeText(text).split('\n');
    const molecules = [];
    let index = 0;

    while (index < lines.length) {
      while (index < lines.length && isBlankLine(lines[index])) index++;
      if (index >= lines.length) break;

      const countLine = lines[index];
      const frameNo = molecules.length + 1;
      const match = /^\s*(\d+)\s*(?:#.*)?$/.exec(countLine);
      if (!match) {
        if (molecules.length === 0) {
          throw new ParseError('XYZ 文件第 ' + (index + 1) + ' 行应为原子数（整数），实际为："' + clip(countLine) + '"');
        }
        warnings.push('XYZ 文件第 ' + (index + 1) + ' 行之后存在无法识别的尾部内容，已忽略');
        break;
      }
      const atomCount = parseInt(match[1], 10);
      if (atomCount > MAX_ATOMS_PER_RECORD) {
        throw new ParseError('XYZ 第 ' + frameNo + ' 帧声明的原子数 ' + atomCount + ' 过大，文件可能已损坏');
      }
      index++;
      if (index >= lines.length) {
        throw new ParseError('XYZ 第 ' + frameNo + ' 帧缺少注释行（原子数行之后应为注释行）');
      }
      const molecule = makeMolecule('xyz');
      molecule.title = lines[index].trim();
      index++;

      if (atomCount === 0) {
        warnings.push('XYZ 第 ' + frameNo + ' 帧声明的原子数为 0，已跳过该帧');
        continue;
      }

      for (let k = 0; k < atomCount; k++) {
        if (index >= lines.length) {
          throw new ParseError('XYZ 第 ' + frameNo + ' 帧声明 ' + atomCount +
            ' 个原子，但文件在第 ' + (k + 1) + ' 个原子之前结束（共找到 ' + k + ' 个）');
        }
        molecule.atoms.push(parseXyzAtomLine(lines[index], index + 1));
        index++;
      }
      molecules.push(molecule);
    }

    if (molecules.length === 0) {
      throw new ParseError('XYZ 文件中没有找到任何原子结构：文件应以“原子数 / 注释行 / 元素 x y z…”开头');
    }
    for (let i = 0; i < molecules.length; i++) finishMolecule(molecules[i], warnings);
    return assignFrameInfo(molecules);
  }

  /* ------------------------------------------------------------------ *
   *  6. SDF / MOL V2000 解析
   * ------------------------------------------------------------------ */

  /** 解析一条 SDF 记录（不含 $$$$ 行）；空记录返回 null。 */
  function parseSdfRecord(recordLines, recordNo, warnings) {
    const lines = recordLines;
    const recordLabel = 'SDF 第 ' + recordNo + ' 条记录';

    /* 计数行：标准 Molfile 前 3 行是 title/program/comment，第 4 行是 counts。
     * 容错：在前 8 行内寻找含 V2000/V3000 的行。 */
    let countsIndex = -1;
    for (let k = 0; k < Math.min(lines.length, 8); k++) {
      if (/V3000/i.test(lines[k])) {
        throw new ParseError(recordLabel + '使用 V3000 格式，当前版本仅支持 V2000；' +
          '请用 ChemDraw / OpenBabel 等工具另存为 V2000 后再导入');
      }
      if (/V2000/i.test(lines[k])) {
        countsIndex = k;
        break;
      }
    }
    if (countsIndex < 0) {
      throw new ParseError(recordLabel + '缺少 V2000 计数行（文件可能损坏或不是 SDF/MOL 格式）');
    }

    const countsTokens = tokenizeLine(lines[countsIndex]);
    const atomCount = parseInteger(countsTokens[0]);
    const bondCount = parseInteger(countsTokens[1]);
    if (atomCount === null || bondCount === null) {
      throw new ParseError(recordLabel + '第 ' + (countsIndex + 1) + ' 行计数信息无法解析："' + clip(lines[countsIndex]) + '"');
    }
    if (atomCount < 0 || bondCount < 0) {
      throw new ParseError(recordLabel + '计数行为负数（原子数 ' + atomCount + '，键数 ' + bondCount + '）');
    }
    if (atomCount > MAX_ATOMS_PER_RECORD) {
      throw new ParseError(recordLabel + '声明的原子数 ' + atomCount + ' 过大，文件可能已损坏');
    }
    const atomBlockStart = countsIndex + 1;
    const bondBlockStart = atomBlockStart + atomCount;
    const requiredLines = bondBlockStart + bondCount;
    if (lines.length < requiredLines) {
      throw new ParseError(recordLabel + '被截断：声明 ' + atomCount + ' 个原子、' + bondCount +
        ' 根键，至少需要 ' + requiredLines + ' 行，实际只有 ' + lines.length + ' 行');
    }

    const molecule = makeMolecule('sdf');
    molecule.title = (lines[0] || '').trim();

    if (atomCount === 0) {
      warnings.push(recordLabel + '不含原子，已跳过');
      return null;
    }

    /* 原子块：x y z 元素（元素允许为原子序数） */
    for (let k = 0; k < atomCount; k++) {
      const lineIndex = atomBlockStart + k;
      const line = lines[lineIndex];
      const tokens = tokenizeLine(line);
      if (tokens.length < 4) {
        throw new ParseError(recordLabel + '第 ' + (lineIndex + 1) + ' 行（原子 ' + (k + 1) +
          '）格式错误（应为“x y z 元素”）："' + clip(line) + '"');
      }
      const x = parseNumber(tokens[0]);
      const y = parseNumber(tokens[1]);
      const z = parseNumber(tokens[2]);
      if (x === null || y === null || z === null) {
        throw new ParseError(recordLabel + '第 ' + (lineIndex + 1) + ' 行（原子 ' + (k + 1) +
          '）坐标不是合法数字：' + '"' + clip(line) + '"');
      }
      const symbol = atomFromToken(tokens[3], recordLabel + '第 ' + (lineIndex + 1) + ' 行');
      molecule.atoms.push({ symbol: symbol, x: x, y: y, z: z });
    }

    /* 键块：a1 a2 order（1 基），转为 0 基并规范化 */
    const rawBonds = [];
    for (let k = 0; k < bondCount; k++) {
      const lineIndex = bondBlockStart + k;
      const line = lines[lineIndex];
      const tokens = tokenizeLine(line);
      if (tokens.length < 3) {
        throw new ParseError(recordLabel + '第 ' + (lineIndex + 1) + ' 行（键 ' + (k + 1) +
          '）格式错误（应为“原子1 原子2 键级”）："' + clip(line) + '"');
      }
      const a1 = parseInteger(tokens[0]);
      const a2 = parseInteger(tokens[1]);
      const orderRaw = parseNumber(tokens[2]);
      if (a1 === null || a2 === null || orderRaw === null) {
        throw new ParseError(recordLabel + '第 ' + (lineIndex + 1) + ' 行（键 ' + (k + 1) +
          '）包含非法数字："' + clip(line) + '"');
      }
      if (a1 < 1 || a1 > atomCount || a2 < 1 || a2 > atomCount) {
        throw new ParseError(recordLabel + '第 ' + (lineIndex + 1) + ' 行键原子索引超出范围：' +
          a1 + '-' + a2 + '（有效范围 1..' + atomCount + '）');
      }
      if (a1 === a2) {
        warnings.push(recordLabel + '第 ' + (lineIndex + 1) + ' 行的键两端为同一原子，已忽略');
        continue;
      }
      rawBonds.push({ i: a1 - 1, j: a2 - 1, order: orderRaw });
    }
    molecule.bonds = rawBonds;

    /* M  END / M  CHG（电荷是可选的增强信息） */
    let sawEnd = false;
    let chargeSum = 0;
    let sawCharge = false;
    for (let k = requiredLines; k < lines.length; k++) {
      const trimmed = String(lines[k] == null ? '' : lines[k]).trim();
      if (trimmed === '') continue;
      if (/^M\s+END\b/i.test(trimmed)) {
        sawEnd = true;
        break;
      }
      if (/^M\s+CHG\b/i.test(trimmed)) {
        const tokens = tokenizeLine(trimmed);
        const pairCount = parseInteger(tokens[2]);
        if (pairCount === null || pairCount < 0) {
          warnings.push(recordLabel + '的 M  CHG 行格式无法解析，已忽略："' + clip(trimmed) + '"');
          continue;
        }
        for (let p = 0; p < pairCount; p++) {
          const atomPos = 3 + p * 2;
          const atomIndex = parseInteger(tokens[atomPos]);
          const chargeValue = parseInteger(tokens[atomPos + 1]);
          if (atomIndex === null || chargeValue === null || atomIndex < 1 || atomIndex > atomCount) {
            warnings.push(recordLabel + '的 M  CHG 数据不完整，已忽略剩余部分');
            break;
          }
          chargeSum += chargeValue;
          sawCharge = true;
        }
      }
    }
    if (!sawEnd) {
      warnings.push(recordLabel + '缺少 M  END 结束标记（仍按原子/键计数解析）');
    }
    if (sawCharge) molecule.charge = chargeSum;

    return molecule;
  }

  /**
   * 解析 SDF 文本（支持 $$$$ 分隔的多记录）。
   * @param {string} text
   * @param {string[]} [warnings]
   * @returns {Array} Molecule[]
   */
  function parseSDF(text, warnings) {
    warnings = warnings || [];
    const lines = normalizeText(text).split('\n');

    const records = [];
    let current = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\$\$\$\$\s*$/.test(lines[i])) {
        records.push(current);
        current = [];
      } else {
        current.push(lines[i]);
      }
    }
    if (current.length > 0 && current.some(function (line) { return !isBlankLine(line); })) {
      records.push(current);
      warnings.push('SDF 文件末尾的记录缺少 $$$$ 结束标记，已尝试解析');
    }
    if (records.length === 0) {
      throw new ParseError('SDF 文件中没有找到任何记录（V2000 记录应以 $$$$ 结束）');
    }

    const molecules = [];
    let recordNo = 0;
    for (let r = 0; r < records.length; r++) {
      const record = records[r];
      if (!record.some(function (line) { return !isBlankLine(line); })) continue;
      recordNo++;
      const molecule = parseSdfRecord(record, recordNo, warnings);
      if (molecule) molecules.push(molecule);
    }
    if (molecules.length === 0) {
      throw new ParseError('SDF 文件中没有包含原子的有效 V2000 记录');
    }
    for (let i = 0; i < molecules.length; i++) finishMolecule(molecules[i], warnings);
    return assignFrameInfo(molecules);
  }

  /* ------------------------------------------------------------------ *
   *  7. Gaussian 输入文件（.gjf / .com）解析
   * ------------------------------------------------------------------ */

  /** 判断一行是否像“电荷 多重度”行（两个整数，可负数）。 */
  function parseChargeMultiplicityLine(line) {
    if (typeof line !== 'string') return null;
    const match = /^\s*(-?\d+)[ \t,]+(-?\d+)\s*$/.exec(line);
    if (!match) return null;
    const charge = parseInt(match[1], 10);
    const multiplicity = parseInt(match[2], 10);
    if (!isFinite(charge) || !isFinite(multiplicity) || multiplicity < 1) return null;
    return { charge: charge, multiplicity: multiplicity };
  }

  /** 判断一行是否像笛卡尔坐标行（元素 + 三个数字，允许行尾额外字段）。 */
  function looksLikeCartesianAtomLine(line) {
    const tokens = tokenizeLine(line);
    if (tokens.length < 4) return false;
    if (!lookupElement(tokens[0])) return false;
    return parseNumber(tokens[1]) !== null &&
      parseNumber(tokens[2]) !== null &&
      parseNumber(tokens[3]) !== null;
  }

  /** 判断一行是否像高斯连接性段的数据行（“i j order j order …”）。 */
  function looksLikeConnectivityLine(line) {
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) return false;
    if (!/^\d+$/.test(tokens[0])) return false;
    if (tokens.length === 1) return true; /* 孤立原子：只有原子序号 */
    return /^\d+$/.test(tokens[1]);
  }

  /** 判断几何段是否其实是 Z-matrix（内坐标）输入。 */
  function looksLikeZMatrix(geoLines) {
    for (let k = 0; k < geoLines.length; k++) {
      const tokens = tokenizeLine(geoLines[k].text);
      if (tokens.length === 1 || tokens.length === 2 || tokens.length === 3) return true;
      /* “H 1 0.9572 2 104.52” 这类：奇数个字段，第 1、3、5… 个是整数原子索引 */
      if (tokens.length >= 5 && tokens.length % 2 === 1) {
        let ok = true;
        for (let p = 1; p < tokens.length; p += 2) {
          if (!/^\d+$/.test(tokens[p])) { ok = false; break; }
        }
        if (ok) {
          for (let p = 2; p < tokens.length; p += 2) {
            if (parseNumber(tokens[p]) === null) { ok = false; break; }
          }
        }
        if (ok) return true;
      }
    }
    return false;
  }

  /** 解析笛卡尔几何段；Z-matrix 给明确中文错误；其余格式错误也报错。 */
  function parseGjfGeometry(geoLines, jobNo) {
    const parsed = [];
    for (let k = 0; k < geoLines.length; k++) {
      const entry = geoLines[k];
      const line = entry.text;
      const tokens = tokenizeLine(line);
      const x = tokens.length >= 4 ? parseNumber(tokens[1]) : null;
      const y = tokens.length >= 4 ? parseNumber(tokens[2]) : null;
      const z = tokens.length >= 4 ? parseNumber(tokens[3]) : null;
      const symbolInfo = tokens.length >= 1 ? lookupElement(tokens[0]) : null;
      if (symbolInfo && x !== null && y !== null && z !== null) {
        parsed.push({ symbol: symbolInfo.symbol, x: x, y: y, z: z });
      } else {
        break;
      }
    }
    if (parsed.length === geoLines.length) return parsed;

    /* 首行本身不是笛卡尔坐标时，优先判断是否为 Z-matrix（Z-matrix 首行通常只有元素符号） */
    const firstTokens = tokenizeLine(geoLines[0].text);
    const firstIsCartesian = firstTokens.length >= 4 &&
      lookupElement(firstTokens[0]) &&
      parseNumber(firstTokens[1]) !== null &&
      parseNumber(firstTokens[2]) !== null &&
      parseNumber(firstTokens[3]) !== null;
    if (!firstIsCartesian && looksLikeZMatrix(geoLines)) {
      const zLine = geoLines[Math.min(parsed.length, geoLines.length - 1)];
      throw new ParseError('检测到 Z-matrix（内坐标）输入：当前解析器仅支持笛卡尔坐标，' +
        '请把 Gaussian 输入中的分子坐标改写为“元素 x y z”形式（或先转换为 .xyz 再导入）。' +
        '相关行：第 ' + zLine.lineNo + ' 行 "' + clip(zLine.text) + '"');
    }
    const badEntry = geoLines[Math.min(parsed.length, geoLines.length - 1)];
    throw new ParseError('Gaussian 输入第 ' + jobNo + ' 个 job 第 ' + badEntry.lineNo +
      ' 行坐标格式无法识别："' + clip(badEntry.text) + '"');
  }

  /** 解析连接性段：每行 “i j order j order …”，1 基转 0 基，双向重复去重。 */
  function parseGjfConnectivity(connLines, atomCount, jobNo, warnings) {
    const rawBonds = [];
    const jobLabel = 'Gaussian 输入第 ' + jobNo + ' 个 job';
    for (let k = 0; k < connLines.length; k++) {
      const entry = connLines[k];
      const tokens = tokenizeLine(entry.text);
      if (tokens.length === 0) continue;
      if (tokens.length % 2 === 0) {
        warnings.push(jobLabel + '第 ' + entry.lineNo + ' 行连接性数据成对不完整，已忽略最后一个字段');
      }
      const center = parseInteger(tokens[0]);
      if (center === null) continue;
      if (center < 1 || center > atomCount) {
        warnings.push(jobLabel + '第 ' + entry.lineNo + ' 行连接性段原子序号 ' + center +
          ' 超出范围 1..' + atomCount + '，已忽略该行');
        continue;
      }
      for (let p = 1; p + 1 < tokens.length; p += 2) {
        const other = parseInteger(tokens[p]);
        const orderRaw = parseNumber(tokens[p + 1]);
        if (other === null || orderRaw === null) {
          warnings.push(jobLabel + '第 ' + entry.lineNo + ' 行连接性数据非法，已忽略一段："' +
            clip(entry.text) + '"');
          continue;
        }
        if (other < 1 || other > atomCount || other === center) {
          warnings.push(jobLabel + '第 ' + entry.lineNo + ' 行键 ' + center + '-' + other +
            ' 非法（原子序号越界或自环），已忽略');
          continue;
        }
        rawBonds.push({ i: center - 1, j: other - 1, order: orderRaw });
      }
    }
    return rawBonds;
  }

  /** 按 “--Link1--” 切分多 job 输入。 */
  function splitGjfJobs(lines) {
    const jobs = [];
    let current = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*--\s*Link1\s*--\s*$/i.test(lines[i])) {
        if (current.some(function (line) { return !isBlankLine(line); })) jobs.push(current);
        current = [];
      } else {
        current.push(lines[i]);
      }
    }
    if (current.some(function (line) { return !isBlankLine(line); })) jobs.push(current);
    return jobs;
  }

  /** 解析单个 GJF job；空 job（例如 geom=allcheck 复用上一步几何）返回 null。 */
  function parseGjfJob(lines, jobNo, warnings) {
    const total = lines.length;
    let index = 0;
    const skipBlanks = function () {
      while (index < total && isBlankLine(lines[index])) index++;
    };
    skipBlanks();

    /* Link 0（%chk、%mem、%nprocshared…），可能有多行，允许中间夹空行 */
    while (true) {
      skipBlanks();
      if (index >= total) break;
      if (/^\s*%/.test(lines[index])) { index++; continue; }
      break;
    }
    skipBlanks();
    if (index >= total) {
      warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 为空，已跳过');
      return null;
    }

    /* Route：# 开头的行（可 #p / #n / #t），直到空行为止 */
    if (lines[index].trim().charAt(0) !== '#') {
      throw new ParseError('Gaussian 输入第 ' + jobNo + ' 个 job 缺少以 # 开头的路由行（route），' +
        '第 ' + (index + 1) + ' 行为："' + clip(lines[index]) + '"');
    }
    const routeLines = [];
    while (index < total) {
      const raw = lines[index];
      if (isBlankLine(raw)) { index++; break; }
      const trimmed = raw.trim();
      if (routeLines.length > 0) {
        /* 容错：缺少空行时，遇到电荷/坐标/连接性行即视为 route 结束 */
        if (parseChargeMultiplicityLine(trimmed) || looksLikeConnectivityLine(trimmed) ||
            looksLikeCartesianAtomLine(trimmed)) {
          break;
        }
      }
      routeLines.push(trimmed);
      index++;
    }
    const route = routeLines.join(' ');
    skipBlanks();

    /* Title（可多行；空标题也允许） */
    let title = '';
    if (index < total && !parseChargeMultiplicityLine(lines[index])) {
      const titleParts = [];
      while (index < total && !isBlankLine(lines[index])) {
        titleParts.push(lines[index].trim());
        index++;
      }
      title = titleParts.join(' ');
    }
    skipBlanks();

    if (index >= total) {
      if (/geom\s*=\s*allcheck/i.test(route)) {
        warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 使用 geom=allcheck，未内嵌几何坐标，已跳过');
        return null;
      }
      throw new ParseError('Gaussian 输入第 ' + jobNo + ' 个 job 在标题之后缺少“电荷 多重度”行');
    }

    /* 电荷 / 多重度（两个整数，可负数） */
    const chargeInfo = parseChargeMultiplicityLine(lines[index]);
    if (!chargeInfo) {
      if (/geom\s*=\s*allcheck/i.test(route)) {
        warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 使用 geom=allcheck，未内嵌几何坐标，已跳过');
        return null;
      }
      throw new ParseError('Gaussian 输入第 ' + jobNo + ' 个 job 第 ' + (index + 1) +
        ' 行应为“电荷 多重度”两个整数，实际为："' + clip(lines[index]) + '"');
    }
    index++;
    skipBlanks();

    /* 几何段：直到空行 */
    const geoLines = [];
    while (index < total && !isBlankLine(lines[index])) {
      geoLines.push({ text: lines[index], lineNo: index + 1 });
      index++;
    }
    if (geoLines.length === 0) {
      if (/geom\s*=\s*allcheck/i.test(route)) {
        warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 使用 geom=allcheck，未内嵌几何坐标，已跳过');
        return null;
      }
      throw new ParseError('Gaussian 输入第 ' + jobNo + ' 个 job 的电荷/多重度行之后没有坐标行');
    }
    const atoms = parseGjfGeometry(geoLines, jobNo);
    skipBlanks();

    /* 连接性段（若存在）：每行 i j order j order … */
    const connectivityLines = [];
    while (index < total) {
      if (isBlankLine(lines[index])) {
        index++;
        if (connectivityLines.length > 0) break;
        continue;
      }
      if (!looksLikeConnectivityLine(lines[index])) break;
      connectivityLines.push({ text: lines[index], lineNo: index + 1 });
      index++;
    }

    const molecule = makeMolecule('gjf');
    molecule.title = title;
    molecule.charge = chargeInfo.charge;
    molecule.multiplicity = chargeInfo.multiplicity;
    molecule.atoms = atoms;

    if (connectivityLines.length > 0) {
      molecule.bonds = parseGjfConnectivity(connectivityLines, atoms.length, jobNo, warnings);
      if (molecule.bonds.length === 0) {
        warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 的连接性段没有有效键，已改按共价半径推断化学键');
      }
    } else if (/geom\s*=\s*connectivity/i.test(route)) {
      warnings.push('Gaussian 输入第 ' + jobNo + ' 个 job 的路由指定 geom=connectivity，' +
        '但未找到连接性段，已按共价半径推断化学键');
    }
    return molecule;
  }

  /**
   * 解析 Gaussian 输入文本（.gjf/.com，支持 --Link1-- 多 job）。
   * @param {string} text
   * @param {string[]} [warnings]
   * @returns {Array} Molecule[]
   */
  function parseGJF(text, warnings) {
    warnings = warnings || [];
    const lines = normalizeText(text).split('\n');
    const jobs = splitGjfJobs(lines);
    if (jobs.length === 0) {
      throw new ParseError('Gaussian 输入文件为空，未找到任何 job 内容');
    }
    const molecules = [];
    for (let j = 0; j < jobs.length; j++) {
      const molecule = parseGjfJob(jobs[j], j + 1, warnings);
      if (molecule) molecules.push(molecule);
    }
    if (molecules.length === 0) {
      throw new ParseError('Gaussian 输入文件中没有找到可用的笛卡尔坐标几何结构');
    }
    for (let i = 0; i < molecules.length; i++) finishMolecule(molecules[i], warnings);
    return assignFrameInfo(molecules);
  }

  /* ------------------------------------------------------------------ *
   *  8. Gaussian 输出日志（.log / .out）解析
   * ------------------------------------------------------------------ */

  const LOG_ORIENTATION_HEADER = /^(?:Standard|Input)\s+orientation\s*:/i;
  const LOG_ATOM_ROW = new RegExp(
    '^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+' +
    '(-?\\d+(?:\\.\\d*)?(?:[eEdD][-+]?\\d+)?)\\s+' +
    '(-?\\d+(?:\\.\\d*)?(?:[eEdD][-+]?\\d+)?)\\s+' +
    '(-?\\d+(?:\\.\\d*)?(?:[eEdD][-+]?\\d+)?)\\s*$'
  );

  /** 从 orientation 标题行向后抓取坐标表，返回 { atoms, endIndex }。 */
  function extractLogOrientation(lines, headerIndex) {
    const atoms = [];
    let index = headerIndex + 1;
    let started = false;
    const scanLimit = headerIndex + 22;
    while (index < lines.length) {
      const line = lines[index];
      if (isBlankLine(line)) {
        if (started) break;
        index++;
        continue;
      }
      const match = LOG_ATOM_ROW.exec(line);
      if (match) {
        const atomicNumber = parseInt(match[2], 10);
        const info = lookupElement(String(atomicNumber));
        if (!info) {
          throw new ParseError('Gaussian 日志第 ' + (index + 1) + ' 行：无法识别的原子序数 ' + atomicNumber);
        }
        const x = parseNumber(match[4]);
        const y = parseNumber(match[5]);
        const z = parseNumber(match[6]);
        if (x === null || y === null || z === null) {
          throw new ParseError('Gaussian 日志第 ' + (index + 1) + ' 行坐标不是合法数字："' + clip(line) + '"');
        }
        atoms.push({ symbol: info.symbol, x: x, y: y, z: z });
        started = true;
        index++;
        continue;
      }
      if (started) break;
      index++;
      if (index > scanLimit) break;
    }
    return { atoms: atoms, endIndex: index };
  }

  /** 在 [start, end) 行范围内查找第一处 SCF Done 能量（Hartree）。 */
  function findScfEnergy(lines, start, end) {
    const limit = Math.min(end, lines.length);
    for (let i = start; i < limit; i++) {
      const match = /SCF Done:\s+E\([^)]*\)\s*=\s*(-?\d+(?:\.\d*)?(?:[eEdD][-+]?\d+)?)/.exec(lines[i]);
      if (match) {
        const value = parseNumber(match[1]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  function findFirstScfEnergy(lines) {
    return findScfEnergy(lines, 0, lines.length);
  }

  /** 提取日志里的标题（route 行之后第一行非空内容）。 */
  function extractLogTitle(lines) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.charAt(0) !== '#') continue;
      if (/^#+$/.test(trimmed)) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (candidate === '' || candidate.charAt(0) === '%' || candidate.charAt(0) === '#') continue;
        if (/^[-=*_~+|#\s]+$/.test(candidate)) continue; /* 跳过装饰分隔线 */
        if (parseChargeMultiplicityLine(candidate)) return '';
        if (/^(Symbolic Z-matrix|Standard basis|Charge\s*=|NAtoms|Standard orientation|Input orientation)/i.test(candidate)) {
          return '';
        }
        return candidate.slice(0, 200);
      }
      return '';
    }
    return '';
  }

  /**
   * 解析 Gaussian 输出日志（Gaussian 03/09/16）。
   * 每个 Standard orientation 块是一帧；没有 Standard 时回退到最后一个 Input orientation。
   * @param {string} text
   * @param {string[]} [warnings]
   * @returns {Array} Molecule[]
   */
  function parseLOG(text, warnings) {
    warnings = warnings || [];
    const lines = normalizeText(text).split('\n');

    const standardHeaders = [];
    const inputHeaders = [];
    for (let i = 0; i < lines.length; i++) {
      const match = LOG_ORIENTATION_HEADER.exec(lines[i].trim());
      if (!match) continue;
      if (/^Standard/i.test(match[0])) standardHeaders.push(i);
      else inputHeaders.push(i);
    }

    let frameHeaders;
    if (standardHeaders.length > 0) {
      frameHeaders = standardHeaders;
    } else if (inputHeaders.length > 0) {
      frameHeaders = [inputHeaders[inputHeaders.length - 1]];
      warnings.push('日志中没有 Standard orientation，已回退使用最后一个 Input orientation 几何结构');
    } else {
      throw new ParseError('未在 Gaussian 日志中找到几何结构块（Standard orientation / Input orientation），' +
        '无法解析原子坐标；请确认这是完整的 Gaussian 输出文件');
    }

    /* Charge / Multiplicity：取第一处出现（契约要求） */
    let globalCharge = 0;
    let globalMultiplicity = 1;
    for (let i = 0; i < lines.length; i++) {
      const match = /Charge\s*=\s*(-?\d+)\s+Multiplicity\s*=\s*(-?\d+)/.exec(lines[i]);
      if (match) {
        globalCharge = parseInt(match[1], 10);
        globalMultiplicity = parseInt(match[2], 10);
        break;
      }
    }
    const title = extractLogTitle(lines);
    const firstEnergy = findFirstScfEnergy(lines);

    const molecules = [];
    for (let f = 0; f < frameHeaders.length; f++) {
      const headerIndex = frameHeaders[f];
      const nextHeaderIndex = f + 1 < frameHeaders.length ? frameHeaders[f + 1] : lines.length;
      let extracted;
      try {
        extracted = extractLogOrientation(lines, headerIndex);
      } catch (err) {
        if (err instanceof ParseError) throw err;
        throw new ParseError('解析第 ' + (f + 1) + ' 个几何结构块（第 ' + (headerIndex + 1) +
          ' 行）时出错：' + (err && err.message ? err.message : String(err)));
      }
      if (extracted.atoms.length === 0) {
        warnings.push('第 ' + (f + 1) + ' 个几何结构块（第 ' + (headerIndex + 1) +
          ' 行）未包含可解析的原子坐标，已跳过');
        continue;
      }
      const molecule = makeMolecule('log');
      molecule.title = title;
      molecule.atoms = extracted.atoms;
      molecule.charge = globalCharge;
      molecule.multiplicity = globalMultiplicity;
      let energy = findScfEnergy(lines, headerIndex + 1, nextHeaderIndex);
      if (energy === null) energy = firstEnergy;
      molecule.energy = energy;
      molecules.push(molecule);
    }

    if (molecules.length === 0) {
      throw new ParseError('Gaussian 日志中找到了几何结构标题，但没有解析出任何原子坐标（文件可能被截断）');
    }

    for (let i = 0; i < molecules.length; i++) finishMolecule(molecules[i], warnings);
    assignFrameInfo(molecules);

    if (!/Normal termination/i.test(text)) {
      warnings.push('日志中未检测到 Normal termination，任务可能异常终止或文件被截断；已尽量解析可用的几何结构');
    } else if (/Error termination/i.test(text)) {
      warnings.push('日志中检测到 Error termination，任务未正常结束；已解析可用的几何结构');
    }
    return molecules;
  }

  /* ------------------------------------------------------------------ *
   *  9. 格式检测
   * ------------------------------------------------------------------ */

  function formatFromFilename(filename) {
    if (typeof filename !== 'string' || filename === '') return null;
    const match = /\.([A-Za-z][A-Za-z0-9]*)\s*$/.exec(filename.trim());
    if (!match) return null;
    switch (match[1].toLowerCase()) {
      case 'xyz': return 'xyz';
      case 'sdf': case 'mol': case 'sd': return 'sdf';
      case 'gjf': case 'com': case 'gj': return 'gjf';
      case 'log': case 'out': return 'log';
      default: return null;
    }
  }

  /** 内容启发式判断格式；返回 'xyz'|'sdf'|'gjf'|'log'|null。 */
  function sniffFormat(text) {
    const normalized = normalizeText(text);
    if (normalized.trim() === '') return null;

    /* 1) Gaussian 日志特征（优先于 gjf，因为日志里也会回显 route 行） */
    if (/Standard orientation\s*:|Input orientation\s*:|SCF Done\s*:|Normal termination of Gaussian|Error termination of Gaussian|Entering Gaussian System|Gaussian, Inc\./i.test(normalized)) {
      return 'log';
    }
    /* 2) SDF / MOL 特征 */
    if (/\$\$\$\$/m.test(normalized) || /\bV2000\b/.test(normalized) || /\bV3000\b/.test(normalized)) {
      return 'sdf';
    }
    /* 3) Gaussian 输入特征：--Link1-- / Link0 + route / route + 电荷行 */
    if (/^\s*--\s*Link1\s*--\s*$/im.test(normalized)) return 'gjf';
    const lines = normalized.split('\n');
    let hasRoute = false;
    let hasLink0 = false;
    let hasChargeLine = false;
    let firstNonEmpty = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '') continue;
      if (firstNonEmpty < 0) firstNonEmpty = i;
      if (trimmed.charAt(0) === '%' && !hasLink0) hasLink0 = true;
      if (trimmed.charAt(0) === '#' && !hasRoute && !/^#+$/.test(trimmed)) hasRoute = true;
      if (!hasChargeLine && parseChargeMultiplicityLine(trimmed)) hasChargeLine = true;
      if (hasRoute && hasChargeLine && hasLink0) break;
    }
    if (hasRoute && (hasLink0 || hasChargeLine)) return 'gjf';

    /* 4) XYZ：首行是原子数，随后有“元素 x y z”行 */
    if (firstNonEmpty >= 0) {
      const firstLine = lines[firstNonEmpty].trim();
      if (/^\d+$/.test(firstLine)) {
        for (let i = firstNonEmpty + 2; i < Math.min(lines.length, firstNonEmpty + 14); i++) {
          if (looksLikeCartesianAtomLine(lines[i])) return 'xyz';
        }
      }
    }
    return null;
  }

  /**
   * 检测文件格式。
   * @param {string} text
   * @param {string} [filename]
   * @returns {'xyz'|'sdf'|'gjf'|'log'|null}
   */
  function detectFormat(text, filename) {
    if (typeof text !== 'string') return null;
    const byExtension = formatFromFilename(filename);
    if (byExtension) return byExtension;
    return sniffFormat(text);
  }

  /* ------------------------------------------------------------------ *
   *  10. parseFile 高层入口
   * ------------------------------------------------------------------ */

  function normalizeFormatName(value) {
    if (value == null) return null;
    const key = String(value).trim().toLowerCase().replace(/^\./, '');
    switch (key) {
      case 'xyz': return 'xyz';
      case 'sdf': case 'mol': case 'sd': return 'sdf';
      case 'gjf': case 'com': case 'gj': return 'gjf';
      case 'log': case 'out': return 'log';
      default: return null;
    }
  }

  const FORMAT_LABELS = { xyz: 'XYZ', sdf: 'SDF/MOL', gjf: 'Gaussian 输入', log: 'Gaussian 日志' };

  /**
   * 统一解析入口。
   * @param {string} text 文件文本
   * @param {{format?: string, filename?: string}} [opts]
   * @returns {{format: string, molecules: Array, warnings: string[]}}
   */
  function parseFile(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') {
      throw new ParseError('无法解析文件：输入内容不是文本');
    }

    let format = null;
    if (opts.format != null && opts.format !== '') {
      format = normalizeFormatName(opts.format);
      if (!format) {
        throw new ParseError('不支持的文件格式："' + String(opts.format) +
          '"（支持 xyz / sdf / gjf / log，也接受 mol / com / out 扩展名）');
      }
    } else {
      format = detectFormat(text, opts.filename);
      if (!format) {
        throw new ParseError('无法识别文件格式：未提供 format，且无法根据文件扩展名或内容判断；' +
          '请提供 .xyz / .sdf / .mol / .gjf / .com / .log / .out 文件，或显式指定 format');
      }
    }

    const warnings = [];
    let molecules;
    try {
      switch (format) {
        case 'xyz': molecules = parseXYZ(text, warnings); break;
        case 'sdf': molecules = parseSDF(text, warnings); break;
        case 'gjf': molecules = parseGJF(text, warnings); break;
        case 'log': molecules = parseLOG(text, warnings); break;
        default:
          throw new ParseError('不支持的格式：' + format);
      }
    } catch (err) {
      if (err instanceof ParseError) throw err;
      throw new ParseError('解析 ' + (FORMAT_LABELS[format] || format) + ' 文件时发生内部错误：' +
        (err && err.message ? err.message : String(err)));
    }

    molecules = molecules.filter(function (molecule) {
      return molecule && Array.isArray(molecule.atoms) && molecule.atoms.length > 0;
    });
    if (molecules.length === 0) {
      throw new ParseError('未能从文件中解析出任何原子结构（文件可能为空或格式不符）');
    }
    assignFrameInfo(molecules);

    return { format: format, molecules: molecules, warnings: warnings };
  }

  /* ------------------------------------------------------------------ *
   *  11. 挂载到 globalThis.MolCore
   * ------------------------------------------------------------------ */

  MolCore.ParseError = ParseError;
  MolCore.detectFormat = detectFormat;
  MolCore.parseFile = parseFile;
  MolCore.parseXYZ = parseXYZ;
  MolCore.parseSDF = parseSDF;
  MolCore.parseGJF = parseGJF;
  MolCore.parseLOG = parseLOG;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = MolCore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
