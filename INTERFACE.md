# MolEdit — 接口契约与协作规范（唯一权威）

> 本文件由 Lead 维护。所有成员必须以本文件为准实现；**不得擅自修改已定义的公共 API / DOM id / 全局对象名**。
> 如确需变更，先发消息给 Lead，由 Lead 更新本文件并通知所有人。

---

## 1. 项目目标

制作一个 GaussView 风格的离线分子可视化编辑器（纯前端，浏览器直接打开 `moledit/index.html`）：

- 支持打开/解析 4 种文件：`.xyz`、`.sdf`、`.gjf`（Gaussian 输入）、`.log`（Gaussian 输出）
- 3D 球棍模型显示，鼠标拖动旋转/平移/缩放分子，点击选择原子
- 测量并**精确修改**：两原子键长、三原子键角、四原子二面角
- 显示/导出为 `.xyz`、`.gjf`、`.sdf`

---

## 2. 硬性技术约束

- **纯静态、零依赖、零构建**：不得使用 npm / CDN / 网络资源 / ES module / 框架。只用原生 HTML + CSS + 经典 `<script>` + Canvas 2D。
- **必须支持 `file://` 直接双击打开**：因此不能使用 `fetch()` 读取本地文件、不能用 `import`/`export`、不能用 ESM 的 `<script type="module">`。
- 所有 JS 文件是**经典脚本**，通过挂到 `globalThis` 的全局对象协作；加载顺序固定（见 §4）。
- 界面文字用**简体中文**（可附带英文术语），代码注释中英文均可。
- 所有逻辑必须在浏览器可用；`js/core.js` 与 `js/parsers.js` 要能在 Node 中加载用于单元测试（见 §11）。
- 不允许写入项目目录以外的文件；浏览器 localStorage 可不用。

---

## 3. 目录结构与文件所有权（严格遵守，禁止越界写）

```
moledit/
├── index.html              # ui-dev
├── css/app.css             # ui-dev
├── js/core.js              # Lead
├── js/parsers.js           # parser-dev
├── js/renderer.js          # render-dev
├── js/samples.js           # Lead
├── js/ui.js                # ui-dev
├── tests/core.test.mjs     # Lead
├── tests/parsers.test.mjs  # parser-dev
├── tests/fixtures/*        # parser-dev（新建的测试夹具）
├── tests/e2e.mjs           # qa-dev
├── tests/e2e-report.json   # qa-dev
├── tests/renderer-preview.html  # render-dev（自测用页面）
├── screenshots/            # qa-dev 截图输出
├── samples/*               # Lead
├── tools/*                 # Lead
├── README.md               # Lead
└── INTERFACE.md            # Lead
```

- 只能写自己名下的文件；需要别处的信息就“读”。不要 `git`，不要删别人的文件。
- `js/core.js` 由 Lead 编写，其他成员只读（parser-dev 可调用其中的 `MolCore.inferBonds`、`MolCore.ELEMENTS`、`MolCore.export`）。

---

## 4. 全局对象与加载顺序

`index.html` 底部必须按此顺序引入（全部相对路径，经典脚本）：

```html
<script src="js/core.js"></script>
<script src="js/parsers.js"></script>
<script src="js/renderer.js"></script>
<script src="js/samples.js"></script>
<script src="js/ui.js"></script>
```

对应全局对象：

- `MolCore`  （`core.js` + `parsers.js` 共同挂载）
- `MolRender`（`renderer.js`）
- `MolSamples`（`samples.js`）
- `MolApp`   （`ui.js`，应用单例）

`core.js` / `parsers.js` 文件风格（必须能在 Node 中 require 后挂到 globalThis）：

```js
(function (root) {
  'use strict';
  const MolCore = (root.MolCore = root.MolCore || {});
  // ... 向 MolCore 挂属性 ...
  if (typeof module === 'object' && module.exports) module.exports = MolCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Node 测试加载方式：

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MolCore = require('../js/core.js');
require('../js/parsers.js'); // 挂到同一个 globalThis.MolCore
```

---

## 5. Molecule 数据模型（唯一真源）

```js
Molecule = {
  title: 'water',                 // string，可空
  atoms: [                        // 单位：Å
    { symbol: 'O', x: 0, y: 0, z: 0 },
    { symbol: 'H', x: 0.9572, y: 0, z: 0 }
  ],
  bonds: [                        // 显式化学键；i < j；order 1/2/3/4(芳香)
    { i: 0, j: 1, order: 1 }
  ],
  charge: 0,
  multiplicity: 1,
  source: 'xyz' | 'sdf' | 'gjf' | 'log' | 'user',
  energy: null,                   // log 中 SCF Done 能量（Hartree，可选）
  bondSource: 'inferred' | 'explicit', // xyz/log 通常 inferred；sdf/gjf 显式键则 explicit
  frameIndex: 0,                  // 可选元信息
  frameCount: 1
};
```

约定：

- `atoms[i]` 的索引就是原子序号（从 0 开始），UI/渲染/测量全部用 0 基索引。
- `bonds` 中 `i < j`，`order` 为整数或 4（芳香）。键唯一，不重复。
- 任何几何编辑后，若 `bondSource === 'inferred'` 需重新推断键；若为 `explicit` 保留原键但允许用户点“重新推断”切换。UI 负责调用 `MolCore.rebond(mol)`。
- `atoms` 数组顺序即数据顺序，编辑不得改变顺序（除非删/加原子操作）。

---

## 6. `MolCore` API

### 6.1 元素表（core.js）

```js
MolCore.ELEMENTS = {
  // symbol: { symbol, name, atomicNumber, mass, color: '#RRGGBB', vdw: 半径Å, covalent: 共价半径Å }
  H: { symbol:'H', name:'氢', atomicNumber:1, mass:1.008, color:'#ffffff', vdw:1.20, covalent:0.31 },
  C: { ... color:'#454545', vdw:1.70, covalent:0.76 }, ...
};
MolCore.getElements() -> 元素对象数组（按原子序数排序）
MolCore.element(symbolOrNumber) -> 元素对象 | null   // 大小写不敏感
```

### 6.2 向量工具（core.js）

```js
MolCore.vec = {
  add, sub, scale, dot, cross, len, norm, dist, lerp, neg,
  rotateAroundAxis(p, center, axisUnit, angleRad) -> [x,y,z],
  perpendicular(u) -> 单位垂直向量
};
```

### 6.3 化学键与片段（core.js）

```js
MolCore.inferBonds(mol, opts?) -> bonds[]   // 按共价半径 + 容差推断，不改 mol.bonds
   // opts: { tolerance: 1.15, extra: 0.25 }  => 键判据 d <= (r_i + r_j) * tolerance + extra
MolCore.rebond(mol) -> mol                  // 重算 mol.bonds（保留可存活键的 order），并设 bondSource='inferred'
MolCore.components(mol) -> number[][]       // 连通分量（按 bonds）
MolCore.fragmentAfterCut(mol, atomIndex, cutPair) -> number[]  // 删除 cutPair 键后 atomIndex 所在片段
MolCore.fragmentsForEdit(mol, a, b) -> { aFrag, bFrag }        // 断开 a-b 键（若存在）后两侧片段
MolCore.neighbors(mol, atomIndex) -> number[]
MolCore.bondBetween(mol, i, j) -> bond | null
```

### 6.4 测量（core.js）

```js
MolCore.measure = {
  distance(mol, i, j) -> Å,
  angle(mol, i, j, k) -> 度，0..180，顶点为 j,
  dihedral(mol, i, j, k, l) -> 度，-180..180，轴为 j-k
};
```

补充（2026-11-13，Lead 澄清）：几何退化时（重合原子导致向量为零、二面角中 A 或 D 落在 B-C 轴线上等）`angle`/`dihedral` 返回 `null`，UI 显示 `—`；正常数值不返回 null。`MolApp.getMeasurements()` 同样可能为 null。

二面角符号约定（必须与 `setDihedral` 一致，采用下式）：

```js
b0 = A - B;  b1 = C - B;  b2 = D - C;
b1u = normalize(b1);
v = b0 - dot(b0, b1u) * b1u;          // A 侧垂直分量
w = b2 - dot(b2, b1u) * b1u;          // D 侧垂直分量
phi = atan2( dot(cross(b1u, v), w), dot(v, w) ) * 180/PI
```

对同侧（顺式/syn）为 0°，反式（anti）为 ±180°。旋转 D 侧片段绕 **(C-B) 方向轴**（右手定则）+Δ 时 phi 增加 Δ。

### 6.5 几何编辑（core.js，全部原地修改并返回受影响原子索引数组）

```js
MolCore.edit = {
  // 目标键长：把 moveSide 指定的一侧片段沿 i->j 方向平移
  setBondLength(mol, i, j, newLength, opts?) -> movedIndices
  //   opts.moveSide: 'j' (默认，移动 j 侧) | 'i' | 'smaller'
  // 目标键角（顶点 j）：绕 j 处垂直于 A-B-C 平面的轴旋转指定侧片段
  setBondAngle(mol, i, j, k, newAngleDeg, opts?) -> movedIndices
  //   opts.moveSide: 'k' (默认，移动 k 侧) | 'i' | 'smaller'
  // 目标二面角：绕 j->k 轴旋转指定侧片段
  setDihedral(mol, i, j, k, l, newAngleDeg, opts?) -> movedIndices
  //   opts.moveSide: 'l' (默认，旋转 l 侧) | 'a' | 'smaller'
  rotateFragment(mol, atoms, center, axis, angleDeg) -> void
  translateFragment(mol, atoms, delta) -> void
  rotateAll(mol, center, axis, angleDeg) -> void
  setElement(mol, index, symbol) -> void
  addAtom(mol, symbol, x, y, z) -> index
  deleteAtoms(mol, indices) -> number[]   // 返回旧→新索引映射可不管；删除后自动重编号
};
MolCore.clone(mol) -> Molecule            // 深拷贝
```

要求：`set*` 返回后，`measure` 对同一组原子的读数应精确等于目标值（误差 < 1e-6 度/Å）；在退化情况下（共线、目标角 0/180、非法输入）抛 `Error('...')` 且不修改分子。

### 6.6 导出（core.js）

```js
MolCore.export = {
  xyz(mol, opts?) -> string           // 以换行结尾
  gjf(mol, opts?) -> string
  // opts: { title, chk: 'mol.chk'|null, route: string|null, connectivity: true }
  sdf(mol, opts?) -> string           // V2000 + $$$$，以换行结尾
};
MolCore.detectFormat 由 parsers.js 提供。
```

### 6.7 解析（parsers.js，parser-dev 负责）

```js
MolCore.ParseError = class extends Error {}   // 中文 message
MolCore.detectFormat(text, filename?) -> 'xyz'|'sdf'|'gjf'|'log'|null
MolCore.parseFile(text, { format?, filename? }) -> {
  format: 'xyz'|'sdf'|'gjf'|'log',
  molecules: Molecule[],      // 至少 1 个；xyz 多帧 / sdf 多记录 / log 多几何帧 / gjf 多 Link1 都要拆成多个
  warnings: string[]          // 中文警告，可空
}                              // 无法解析时 throw MolCore.ParseError（中文，说明原因）
MolCore.parseXYZ(text) -> Molecule[]
MolCore.parseSDF(text) -> Molecule[]
MolCore.parseGJF(text) -> Molecule[]
MolCore.parseLOG(text) -> Molecule[]
```

解析要求（必须全部覆盖、必须实测）：

- **XYZ**：首行原子数；第二行注释；随后为 `元素 x y z`（元素可为符号或原子序数）；支持多帧（帧间空行/新帧头）；单位 Å。
- **SDF**：V2000；从 `V2000` 计数行取原子数/键数；原子块 4 列（x y z 元素）；键块 3 列（a1 a2 order，1 基）；支持 `$$$$` 多记录；解析 `M  END` 前有效。V3000 至少给出明确中文错误。
- **GJF/COM**：跳过 `%` link0；route 行以 `#` 开头（可能 `#p`/`#n`）；其后空行 → title → 空行 → `charge multiplicity`（两个整数，可负数）→ 原子坐标行（支持 `元素 x y z`、`原子序数 x y z`、行尾多字段容忍）；空的几何行结束；若有 `geom=connectivity` 的连接性段（每行 `i j order j order ...`）则解析成 bonds 并置 `bondSource='explicit'`；支持 `--Link1--` 多 job（每个 job 一个 Molecule，取第一个的 charge/mult 各自独立）；**Z-matrix 输入**要检测并给出中文错误（不静默错乱）。
- **LOG**：Gaussian 03/09/16 输出；提取最后一次 `Standard orientation:`（若无则 `Input orientation:`）坐标表（3 列：Center Number / Atomic Number / Atomic Type / X Y Z，使用 Atomic Number 转元素）；解析 `Charge = n Multiplicity = m`（取第一处）；解析 `SCF Done:  E(...) =  -76.4...` 能量（第一处即可，或每帧对应）；每个 `Standard orientation:` 块作为一帧（opt 任务即轨迹），最后一帧为最终结构；`Normal termination` 与否都要尽量给出结构（失败任务用最后一个 orientation 块），无几何时 throw ParseError；支持原子数较大。`Molecule.frameIndex/frameCount` 要填。
- 所有解析出的 Molecule：xyz/log 无显式键时调用 `MolCore.inferBonds` 并置 `bondSource='inferred'`；sdf/gjf 有连接性时 `explicit`，无连接性时推断。
- **健壮性**：CRLF/UTF-8 BOM/前后空白/科学计数法坐标/空行都要处理；警告不要 throw，仅不可恢复错误 throw。

---

## 7. `MolRender` API（renderer.js，render-dev 负责）

Canvas 2D 软件渲染，GaussView 风格球棍模型。**不得修改 molecule 数据**，不得依赖 `MolCore`（可以读取 `MolCore.ELEMENTS`，若存在）。不注册 window 事件（UI 负责）。

```js
MolRender.createView(canvas, options?) -> view
```

`options` 默认值：

```js
{
  style: 'ballstick',      // 'ballstick' | 'spacefill' | 'stick' | 'wireframe'
  labels: true,            // 原子上显示元素符号
  indices: false,          // 显示原子序号
  showAxes: true,          // 左下角坐标轴
  background: '#ffffff',
  selectionColor: '#ff7a00',
  hoverColor: '#ffd166',
  measurementColor: '#0f9d9d',
  bondWidth: 1.0,          // 键粗细倍率
  labelMinScreenRadius: 9  // 屏幕半径小于此值不画元素符号
}
```

`view` 对象方法（必须全部实现）：

```js
view.setMolecule(mol | null)      // 换分子 -> 自动 frameAll + requestRender
view.setOptions(partial)          // 局部更新并重绘
view.setOption(key, value)
view.getOptions() -> options 副本
view.setSelection(indicesArray)   // 选中高亮 + 序号徽标（1,2,3,4...）
view.setHover(index|null)
view.setMeasurement({ atoms: [i,j,...], type: 'distance'|'angle'|'dihedral'|null })
                                  // 画虚线引导 + 顶点圆弧（颜色 measurementColor）
view.resize()                     // 从 canvas.clientWidth/Height 同步尺寸（含 DPR），重绘
view.render()                     // 立即同步绘制
view.requestRender()              // rAF 合并绘制
view.frameAll()                   // 让分子充满视口（含留白）
view.resetCamera()                // 等价 frameAll + 默认朝向
view.rotate(dxPx, dyPx)           // 鼠标拖动旋转（dx/ dy 为像素增量）
view.pan(dxPx, dyPx)              // 屏幕平面平移
view.zoom(factor)                 // factor>1 放大
view.pick(cssX, cssY) -> index|null          // cssX/cssY 为相对 canvas 左上角的 CSS 像素
view.project(atomIndex) -> { x, y, depth, visible }  // 同上坐标系；visible 表示在画布内
view.projectAll() -> 上述数组
view.screenRadius(atomIndex) -> px            // 当前样式下原子绘制半径
view.screenDeltaToWorld(dxPx, dyPx) -> [dx,dy,dz]  // 屏幕像素增量 -> 世界坐标增量（用于拖动原子）
view.onRender = function (view) {}            // 每次绘制完成后回调（UI 用它更新 HTML 叠加标注）
view.dispose()
```

渲染要求：

- 透视/正交均可，但拖动旋转要自然（水平拖 = 绕屏幕竖直轴，垂直拖 = 绕屏幕水平轴）；支持任意角度、无万向节卡死。
- 深度排序：远景先画；原子覆盖其背后键；选中原子高亮环和序号徽标必须始终最上层。
- 球体用径向渐变（高光在左上方）+ 深色描边；键按原子颜色分两半绘制，带描边；多重键（order 2/3/4）用平行线表示。
- 样式：ballstick 原子半径≈0.30×vdw，键粗≈0.11Å×scale；spacefill 原子半径=vdw；stick 原子半径小、键粗；wireframe 细线。切换样式不能丢失相机视角。
- 空白状态（mol=null）只画背景 + 坐标轴，不报错。
- 性能：≤2000 原子仍可交互（rAF 合并、离屏缓存可选）。
- 坐标系手性正确：右手系，z 轴朝向观察者的初始视角要合理（例如沿 -z 看，保持分子正面）。
- 所有 canvas 尺寸变化必须用 DPR 缩放（高分屏不模糊）。

---

## 8. `MolApp` + DOM 契约（index.html / css/app.css / js/ui.js，ui-dev 负责）

### 8.1 布局（GaussView 风格，中文界面）

```
┌─────────────────────────────────────────────────────────────────────┐
│ 顶栏：MolEdit 分子编辑器 | 打开文件 | 示例选择 | 撤销/重做 | 导出▼     │
├──────┬──────────────────────────────────────────────┬───────────────┤
│ 工具 │                                              │ 右侧面板       │
│ 竖栏 │            Canvas 3D 视口                     │ 文件信息       │
│      │  （左上角分子信息浮层；左下角鼠标提示）        │ 选中原子/测量  │
│      │                                              │ 几何编辑×3     │
│      │                                              │ 显示设置       │
├──────┴──────────────────────────────────────────────┴───────────────┤
│ 底部状态栏：原子数/键数/选择数/操作提示                              │
└─────────────────────────────────────────────────────────────────────┘
```

- 深色或浅色主题均可，但要接近 GaussView 观感（浅色背景、白底画布、灰色球棍）。整体必须美观：字体 `system-ui`，8px 网格间距，圆角 6–8px，无明显错位。
- 右侧面板宽约 320–360px，可滚动；窗口最小 1100×700 下可用。
- 空状态：视口中央提示“打开 .xyz / .sdf / .gjf / .log 文件，或从示例库加载”。

### 8.2 必须存在的 DOM id（E2E 稳定选择器，不得改名）

```html
<!-- 顶栏 -->
<input id="file-input" type="file" accept=".xyz,.sdf,.mol,.gjf,.com,.log,.out,.txt" hidden>
<button id="btn-open">打开文件</button>
<select id="sample-select"></select>
<button id="btn-undo"></button> <button id="btn-redo"></button>
<button id="btn-export-xyz"></button> <button id="btn-export-gjf"></button> <button id="btn-export-sdf"></button>

<!-- 工具竖栏：单选，默认 select -->
<button id="tool-select" data-tool="select"></button>
<button id="tool-rotate" data-tool="rotate"></button>
<button id="tool-move-atom" data-tool="move-atom"></button>
<button id="tool-move-fragment" data-tool="move-fragment"></button>
<button id="tool-pan" data-tool="pan"></button>

<!-- 视口 -->
<div id="viewport"><canvas id="viewport-canvas"></canvas>
  <div id="viewport-overlay"></div>   <!-- 绝对定位；测量数值/原子标注浮层 -->
  <div id="empty-hint"></div>
</div>

<!-- 文件信息 -->
<div id="mol-title"></div> <div id="mol-format"></div>
<select id="dataset-select"></select> <div id="dataset-label"></div>
<div id="atom-count"></div> <div id="bond-count"></div>
<input id="charge-input" type="number"> <input id="multiplicity-input" type="number">

<!-- 选择与测量 -->
<div id="selection-count"></div> <div id="selection-list"></div>
<div id="measure-distance"></div> <div id="measure-angle"></div> <div id="measure-dihedral"></div>

<!-- 几何编辑 -->
<input id="bond-length-input" type="number" step="0.001">
<select id="bond-length-move"><option value="j">移动原子2一侧</option><option value="i">移动原子1一侧</option><option value="smaller">移动较小片段</option></select>
<button id="btn-apply-bond-length">应用</button>

<input id="angle-input" type="number" step="0.01">
<select id="angle-move"><option value="k">移动原子3一侧</option><option value="i">移动原子1一侧</option><option value="smaller">移动较小片段</option></select>
<button id="btn-apply-angle">应用</button>

<input id="dihedral-input" type="number" step="0.01">
<select id="dihedral-move"><option value="l">旋转原子4一侧</option><option value="a">旋转原子1一侧</option><option value="smaller">旋转较小片段</option></select>
<button id="btn-apply-dihedral">应用</button>

<!-- 显示设置 -->
<select id="style-select"><option value="ballstick">球棍模型</option><option value="spacefill">空间填充</option><option value="stick">棍状</option><option value="wireframe">线框</option></select>
<input id="toggle-labels" type="checkbox"> <input id="toggle-indices" type="checkbox"> <input id="toggle-axes" type="checkbox">
<button id="btn-rebond">重新推断化学键</button>
<button id="btn-clear-selection">清除选择</button>
<button id="btn-reset-view">重置视角</button>

<!-- 状态与错误 -->
<div id="status-bar"></div>
<div id="error-banner" hidden></div>
```

### 8.3 交互规范

- **鼠标**：
  - `tool=select`（默认）：左键点原子 = 选中（替换选择）；Shift/Ctrl+左键 = 追加；点空白 = 清除选择；拖动空白 = 旋转（等同 rotate 工具）；滚轮 = 缩放；Shift+拖动/中键拖动 = 平移。
  - `tool=rotate`：左键拖动始终旋转；点原子不选择？——**仍允许点选**（单击视为选择，拖动视为旋转）。
  - `tool=move-atom`：按住原子拖动 → 仅移动该原子（`screenDeltaToWorld` 映射后 update atom 坐标，编辑后 rebond）；空白拖动 = 旋转。
  - `tool=move-fragment`：按住原子拖动 → 移动该原子所在连通片段；空白拖动 = 旋转。
  - `tool=pan`：拖动 = 平移，滚轮 = 缩放。
  - 所有原子拖动都必须记录 undo（一次拖动 = 一步 undo）。
  - 鼠标悬停原子变 pointer 光标并高亮。
- **选择上限 4 个原子**（按点击顺序，用于键长/键角/二面角）；已选原子再点（无 Shift）= 取消选择；Shift 追加超过 4 个时状态栏提示“最多选择 4 个原子”。
- **测量联动**：
  - 选 2 原子 → `#measure-distance` 显示 `d = 1.234 Å`；3 原子 → 键角；4 原子 → 二面角。未满足条件显示 `—`。
  - 选择变化时，三个编辑输入框自动填入当前测量值（number input，保留 4 位小数）；不足原子数的编辑卡片置灰（按钮 `disabled`）。
  - 点“应用”后：调用对应 `MolApp.apply*`，成功则在状态栏/浮层提示新值，并刷新所有测量值；失败显示中文错误（`#error-banner` 或状态栏）。
- **视口叠加层** `#viewport-overlay`：用 `view.project()` 显示选中原子的序号徽标（1–4）与测量数值标签（如 `d=1.234`、`∠=104.52°`、`τ=60.00°`）；`view.onRender` 回调里更新位置；选择/相机变化时刷新。
- **文件**：`#file-input` change 与整个视口拖放都能加载；读文件用 `FileReader.readAsText`（UTF-8）；加载成功清空选择、重置 undo、`frameAll`、状态栏提示；解析错误捕获后显示中文错误横幅，不清空当前分子。
- **数据集**：`parseFile` 返回多个 Molecule 时（多帧/多记录），用 `#dataset-select` 显示“帧 1/3”可切换；切换时重设当前分子（保留各帧已做的编辑亦可，但不是必须）、清空选择、重置 undo、刷新。
- **示例库**：从 `MolSamples.list` 填充 `#sample-select`（首项“加载示例…”），change 后 `loadSample(key)`。页面初始不自动加载任何分子（保持空状态）。
- **导出**：点击按钮触发浏览器下载（Blob + a.download），文件名用分子标题（过滤非法字符）后缀 `.xyz` / `.gjf` / `.sdf`；同时状态栏提示“已导出”。
- **键盘**：Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做，Esc 清空选择，F 重置视角；输入框聚焦时不拦截。
- **撤销/重做**：分子几何/电荷/多重度/元素变更前快照（深拷贝 atoms+bonds+charge+multiplicity），最多 50 步；按钮 disabled 状态正确。
- **右键菜单**：禁用浏览器默认右键菜单（视口内），无自定义菜单。

### 8.4 `MolApp` 公共 API（E2E 直接调用，必须与 DOM 行为一致）

```js
window.MolApp = {
  ready: Promise,            // DOM 初始化完成（含 MolSamples 填充）后 resolve；E2E 用 await MolApp.ready
  version: '1.0.0',

  loadText(text, { format, filename, name } = {}) -> Promise<LoadResult>,
  loadSample(key) -> Promise<LoadResult>,
  listSamples() -> [{ key, name, format }],

  getState() -> {
    hasMolecule, atomCount, bondCount, selection: number[], style, format, title,
    datasetIndex, datasetCount, charge, multiplicity, filename, warnings
  },
  getMeasurements() -> { distance: number|null, angle: number|null, dihedral: number|null, atoms: number[] },
  getAtom(index) -> { symbol, x, y, z } | null,
  getBonds() -> [{ i, j, order }],

  setSelection(indices) -> void,     // 覆盖式，最多 4 个；会触发 UI 刷新
  selectAtom(index, { add } = {}) -> void,
  clearSelection() -> void,

  setStyle(style) -> void,
  setOption(key, value) -> void,     // 显示选项（labels/indices/showAxes/bondWidth 等）
  resetView() -> void,
  setDatasetIndex(index) -> void,

  applyBondLength(value, { atoms, moveSide } = {}) -> { before, after, moved: number[] },
  applyBondAngle(value, { atoms, moveSide } = {}) -> { before, after, moved: number[] },
  applyBondDihedral(value, { atoms, moveSide } = {}) -> { before, after, moved: number[] },
  // atoms 省略时用当前选择；原子数不足 / 非法数值 / 退化几何 -> throw Error(中文)
  // 成功后自动：rebond（若 inferred）、刷新测量与 UI、记录 undo

  undo() -> boolean,
  redo() -> boolean,
  exportText(format /* 'xyz'|'gjf'|'sdf' */) -> string,
  getLastError() -> string | null,
  rebond() -> void
};

LoadResult = { format, moleculeCount, datasetIndex, atomCount, bondCount, title, filename, warnings: string[] }
```

`getMeasurements()` 返回基于**当前选择顺序**的前 2/3/4 个原子计算的值；不足返回 null。

---

## 9. 渲染与 UI 质量基准（截图必须达到）

1. 球棍模型清晰有立体感：球有高光/描边，键有描边，远近有轻微雾化。
2. 白底，分子居中充满视口约 60–70%。
3. 选中原子有明显橙色高亮环 + 顶部序号徽标；测量引导线可见。
4. 中文标签无乱码（文件全部 UTF-8，`<meta charset="utf-8">`）。
5. 右侧面板分区标题清晰，数字对齐，按钮禁用态明显。
6. 无控制台错误（E2E 会采集 Runtime.exceptionThrown / console error）。

---

## 10. 测试与验证方式

环境（Windows）：

- Node：`node`（v24，已装）。**npm 被策略禁用、无网络**，只能用 Node 内置模块。
- Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`（可用 headless）。
- PowerShell 5.1；文件写操作仅限项目根目录内。

### 10.1 Node 单元测试

```powershell
cd <moledit 项目根目录>
node tests/core.test.mjs
node tests/parsers.test.mjs
```

测试必须是**断言式**（自写 assert，失败 `process.exit(1)`，输出 ✅/❌ 明细），覆盖：

- core：4 种格式对应的模型、键推断、测量数值、set* 往返精度（键长 1.05/1.5；键角 90/120；二面角 0/60/-60/180）、退化输入报错、导出后再解析回环、`fragmentAfterCut`。
- parsers：4 种格式成功解析 + 多帧/多记录 + 坏文件报错 + BOM/CRLF/科学计数法；用 `tests/fixtures/` 与 `samples/` 真实文件。

### 10.2 浏览器自测（headless Chrome 截图）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars `
  --force-device-scale-factor=1 --window-size=1440,900 --virtual-time-budget=5000 `
  --screenshot="shots\preview.png" `
  "file:///path/to/moledit/index.html"
```

需要交互/采集控制台错误的，用 Node 内置 `fetch` + `WebSocket` 驱动 Chrome DevTools Protocol（qa-dev 负责 `tests/e2e.mjs`）。自测可用 `--allow-file-access-from-files`。

---

## 11. 协作规则

- **先认领共享任务再动手**（team_task_list → team_task_get → team_task_update claim），完成后 complete，并给 Lead 发消息。
- 只写自己文件；发现契约问题 → 消息 Lead，不要私自改公共 API。
- 每完成一个阶段自己跑测试/截图验证；**报告里必须给出你运行过的命令与结果**，不能只说“已完成”。
- 若依赖文件尚未出现（例如 ui-dev 等 core.js），先按契约写，等文件出现后再联调；必要时读现有实现确认。
- 最终报告格式：`状态 | 文件 | 已实现要点 | 测试命令与结果 | 已知问题/待 Lead 决策`。
- 消息用中文，简洁。禁止修改 `INTERFACE.md`。
