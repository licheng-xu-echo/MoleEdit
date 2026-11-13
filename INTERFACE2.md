# MolEdit v2 新功能契约（INTERFACE2.md）

> 本文件是 v2 的**权威契约**，与 `INTERFACE.md` 同时有效；v1 未涉及的内容以本文件为准。
> 所有成员动手前必须通读本文件 + `INTERFACE.md` §5/§7/§8/§10/§11。
> 不得擅自修改公共 API / DOM id / 全局对象名；确需变更先消息 Lead，由 Lead 更新本文件。

## 0. 本阶段目标（用户需求）

1. **中英文切换，默认英文**：整个界面（含动态状态/错误提示面板/`<title>`）可切换 EN / 中文，默认 `en`；语言选择持久化。
2. **Gaussian LOG 结果展示（类似 GaussView）**：打开 `.log` 时解析并展示：
   - 单点能（最终 SCF 能量，Hartree）
   - 热化学校正能（ZPE 校正、thermal corrections、Sum of electronic and …）
   - 优化收敛曲线（能量 vs 优化步 + 4 项收敛判据 vs 阈值曲线）
   - 频率分析各模式的**振动动画**（在 3D 视口中播放）
3. **支持 Linux / macOS 打开**：提供 POSIX shell 启动器（自动 file:// 或本地服务器 + 浏览器），并更新 README。

## 1. 新文件与文件所有权（严格遵守）

| 文件 | 负责人 | 说明 |
| --- | --- | --- |
| `js/i18n.js` | i18n-dev | i18n 引擎 + index.html 静态文案字典（en/zh） |
| `js/gausslog.js` | log-dev | Gaussian log 深度解析（MolGaussLog） |
| `js/charts.js` | results-dev | 轻量 Canvas 2D 折线图（MolCharts，结果面板内部用） |
| `js/results.js` | results-dev | 计算结果面板组件（MolResults） |
| `css/results.css` | results-dev | 结果面板样式 |
| `index.html` | i18n-dev | 静态文案 data-i18n 化、新增 DOM、脚本/样式引用 |
| `css/app.css` | ui-dev | 新增侧栏 Tab / 语言按钮样式等 |
| `js/ui.js` | ui-dev | i18n 接入 + 结果面板集成 + MolApp API 扩展 |
| `js/renderer.js` | render-dev | 新增 `view.setDisplacements()` 振动位移渲染 |
| `js/samples.js` + `tools/gen-samples.mjs` | Lead | 示例加 `nameEn` + 新增 opt+freq 示例 |
| `launch.sh` / `MolEdit.command` / `start-server.sh` / `tools/create-linux-desktop-shortcut.sh` | Lead | Linux/macOS 启动器 |
| `tests/*.mjs`、`tests/*.html`、`screenshots/` | 各 owner（见任务） | 测试与截图 |
| `README.md`、`INTERFACE.md`、`INTERFACE2.md` | Lead | 文档 |

- 每人只写自己名下的文件；**index.html 只有 i18n-dev 能写**，ui-dev 需要 DOM 结构按 §7 由 i18n-dev 添加。
- 新增测试文件写在自己任务里说明。

## 2. 加载顺序（v2，index.html 底部必须严格按此顺序）

```html
<script src="js/core.js"></script>
<script src="js/parsers.js"></script>
<script src="js/gausslog.js"></script>
<script src="js/i18n.js"></script>
<script src="js/renderer.js"></script>
<script src="js/samples.js"></script>
<script src="js/charts.js"></script>
<script src="js/results.js"></script>
<script src="js/ui.js"></script>
```

- 顺序要求：`i18n.js` 必须先于 `charts/results/ui.js`（后三者加载时调用 `MolI18n.register`）；`gausslog.js` 先于 `ui.js`。
- `<head>` 新增 `<link rel="stylesheet" href="css/results.css">`（放在 `css/app.css` 之后）。
- `<html lang="en">`（JS 会按语言更新）。

## 3. 国际化 MolI18n（`js/i18n.js`，i18n-dev）

### 3.1 API

```js
MolI18n = {
  DEFAULT_LANG: 'en',
  LANGS: ['en', 'zh'],
  STORAGE_KEY: 'moledit.lang',
  init(opts?) -> 'en'|'zh'        // opts.defaultLang；读 localStorage；设置 <html lang>；translateDOM(document)；返回当前语言
  getLang() -> 'en'|'zh'
  setLang(lang) -> void           // 非法值忽略；写 localStorage；更新 <html lang>、document.title、translateDOM(document)；派发 onChange
  toggleLang() -> 'en'|'zh'
  onChange(fn) -> unsubscribe     // fn(lang)
  register(lang, dict) -> void    // 合并字典（模块加载时调用两次，en/zh 各一次）
  t(key, params?) -> string       // 插值 "{name}"；缺失 key 回退 en 字典，再回退 key 本身
  has(key) -> boolean
  translateDOM(root?) -> void     // 见 §3.2
};
```

- 默认语言**必须**是 `en`，不读取浏览器语言。
- `document.title` 由 i18n.js 用 key `app.title` 设置；`<html lang>` 同步为 `en` / `zh-CN`。
- `register` 幂等合并；同一 key 后注册覆盖先注册（同名模块内）。
- 插值：`t('status.loaded', {file:'a.xyz', n:3})`，字典里 `"已加载 {file}（{n} 原子）"`；缺失参数保留 `{name}` 原文。

### 3.2 DOM 约定（index.html 静态文案）

- 文本：`<button data-i18n="toolbar.open">Open file</button>` → `textContent`
- 属性：`data-i18n-title="..."`、`data-i18n-placeholder="..."`、`data-i18n-aria-label="..."` → 对应 `title` / `placeholder` / `aria-label`
- 允许 `data-i18n-html` 仅用于含 `<em>` 等静态富文本（i18n-dev 自己控制，禁止用户数据）
- **缺字典时保留原 DOM 文本**，不得出现占位符闪烁。
- 切换语言后：`translateDOM(document)` 更新全部静态文案；ui.js/results.js 通过 `onChange` 重新渲染动态文案。

### 3.3 key 命名空间（模块各自负责自己的字典，禁止跨模块写同一命名空间）

- `app.*`、`toolbar.*`、`tools.*`、`panel.*`、`info.*`、`measure.*`、`edit.*`、`display.*`、`hints.*`、`empty.*` → i18n-dev（index.html）
- `ui.*`、`status.*`、`samples.*`、`dialogs.*` → ui-dev（写在 ui.js 内 register）
- `results.*` → results-dev（写在 results.js 内 register）
- `app.title` 必须在 i18n 字典里（en: "MolEdit — Molecular Editor"，zh: "MolEdit — 分子编辑器"）。

### 3.4 index.html 新增 DOM（必须原样存在）

1. 顶栏语言切换按钮（放在 export-group 之前或之后均可，建议 topbar 右侧）：
```html
<button id="lang-toggle" class="btn lang-toggle" type="button" title="切换到中文" aria-label="Switch language">中文</button>
```
   - 当前语言 en 时按钮文字 "中文"（点击切到 zh）；zh 时文字 "EN"；标题/aria 文案走 i18n。
2. 右侧面板顶部 Tab 与页面容器（**所有原有 section 移入 molecule 页**）：
```html
<aside id="sidepanel">
  <div id="side-tabs" class="side-tabs" role="tablist" aria-label="Sidebar tabs">
    <button id="tab-molecule" class="side-tab is-active" type="button" role="tab"
            aria-selected="true" aria-controls="tab-page-molecule" data-i18n="panel.tabMolecule">Molecule</button>
    <button id="tab-results" class="side-tab" type="button" role="tab"
            aria-selected="false" aria-controls="tab-page-results" disabled
            data-i18n="panel.tabResults">Results</button>
  </div>
  <div id="tab-page-molecule" class="side-page" role="tabpanel"> ...原有 5 个 section... </div>
  <div id="tab-page-results" class="side-page" role="tabpanel" hidden>
    <div id="results-panel"></div>
  </div>
</aside>
```
3. index.html 所有可见中文改为**英文初始文本 + data-i18n key**（默认英文直接可见；中文由 i18n 字典切换）。包括：`<title>` 文本（由 i18n 覆盖）、brand-sub、按钮 title、工具 title/文字、面板标题、字段 label、select 的 option 文本、占位符、空状态、鼠标/键盘提示、状态栏初始 "Ready" 等。
4. 语言切换按钮由 ui-dev 绑定事件（i18n-dev 只加 DOM + data-i18n）。

## 4. Gaussian LOG 深度解析 MolGaussLog（`js/gausslog.js`，log-dev）

### 4.1 全局与加载方式

经典脚本，挂 `globalThis.MolGaussLog`；Node 可 `require`（UMD 风格同 core.js）；不得依赖 DOM。
**不得修改** `js/parsers.js`（v1 解析器继续提供 frames/molecules）；本模块只做“计算结果的抽取”。

### 4.2 API

```js
MolGaussLog = {
  version: '1.0.0',
  parse(text) -> LogResults,          // 任意文本都不 throw；无结果时 ok:false / hasAnalysis:false + warnings
  hasAnalysis(results) -> boolean
};
```

### 4.3 LogResults 数据模型

```js
LogResults = {
  ok: true,
  format: 'gaussian-log',
  jobs: [Job],                        // 每个 Gaussian job 一项（按 "Entering Link 1"/route 分区启发式）
  summary: Summary,                   // UI 直接使用的聚合结果
  warnings: [string]                  // 英文或中文均可，UI 直接展示
}

Job = {
  index: 0,                           // 0 基
  route: 'opt freq b3lyp/6-31g(d)',   // 路由行去 '#'/空格后的合并文本
  routeFull: string,
  charge: 0, multiplicity: 1,         // 缺失为 null
  natoms: 3,                          // 优先 NAtoms=，其次频率/方向块行数
  normalTermination: true | false | null,
  scfEnergies: [ { step: 1, energy: -76.4089399955, cycles: 6 } ],  // 本 job 内 SCF Done 顺序
  optSteps: [ {
    step: 1,                          // 1 基
    energy: -76.40,                   // 该步 SCF 能量（可 null）
    maxForce: 0.000123, rmsForce: 0.000045,          // 可 null
    maxDisplacement: 0.000512, rmsDisplacement: 0.000203,
    converged: true | false | null,   // 该步 4 项是否全部 YES
    predictedDeltaEnergy: -1.2e-7,    // 可 null
    frameIndex: 0                     // 该步对应的全局 orientation 帧索引，未知 null
  } ],
  optimization: { completed: true|false, stationaryPoint: true|false, converged: true|false|null } | null,
  thermochemistry: {
    temperature: 298.15, pressure: 1.0,
    zeroPointCorrection, thermalCorrectionEnergy, thermalCorrectionEnthalpy, thermalCorrectionGibbs,
    sumElectronicZeroPoint, sumElectronicThermal, sumElectronicEnthalpy, sumElectronicGibbs
  } | null,                            // 单位 Hartree；缺失字段为 null
  frequencies: [ {
    modeIndex: 1,                      // 1 基（Gaussian 模式号）
    frequency: 1600.1234,              // cm^-1，负数=虚频
    irIntensity: 12.3 | null,          // KM/Mole
    reducedMass: 1.082 | null,
    forceConstant: 1.634 | null,
    imaginary: false,
    displacements: [ { atomIndex: 0, dx: 0.0, dy: 0.07, dz: 0.0 } ]   // 0 基；无数据时为 []
  } ],
  freqFrameIndex: 0 | null,            // 频率分析对应几何在“全局 Standard orientation 帧序列”中的索引
  orientationStartIndex: 0             // 本 job 第一个 orientation 的全局索引（可 null）
}

Summary = {
  hasAnalysis: true,                   // 有任何可展示结果
  jobCount: 1,
  route: string, charge, multiplicity, natoms,
  finalEnergy: -76.4089399955 | null,  // 单点能：全文最后一个 SCF Done
  normalTermination: true|false|null,
  hasFrequencies: bool, hasOptimization: bool, hasThermochemistry: bool,
  opt: Job.optimization 加 steps -> { steps:[...], completed, stationaryPoint, converged } | null,
  thermochemistry: {...} | null,
  frequencies: [...],
  freqFrameIndex: number|null,
  energySteps: [ {step, energy} ]      // 用于能量曲线：优先 optSteps.energy；否则 scfEnergies
}
```

`parse` 对非 log / 空文本：`{ok:false, format:'gaussian-log', jobs:[], summary:{hasAnalysis:false,...}, warnings:[...]}`，**不得抛异常**。

### 4.4 解析覆盖要求（必须实测）

1. route：`Entering Link 1` 之后、第一个空行之前的 `#` 行（多行 route 合并）；`--Link1--` 多 job。
2. `Charge =  0 Multiplicity = 1`（第一处）；`NAtoms=`。
3. **SCF Done**：`SCF Done:  E(RB3LYP) =  -76.4089399955     A.U. after    6 cycles`，按出现顺序收集（job 内）。
4. **优化收敛表**（每个优化步一张，可能重复多次）：
```
         Item               Value     Threshold  Converged?
 Maximum Force            0.000123     0.000450     YES
 RMS     Force            0.000045     0.000300     YES
 Maximum Displacement     0.000512     0.001800     YES
 RMS     Displacement     0.000203     0.001200     YES
 Predicted change in Energy=-1.234567D-07
```
   注意 `D` 指数、`**`、`RMS     Force` 多空格；表可能跨数次迭代，也可能只有 1 步。
5. `Optimization completed.` / `Stationary point found.` / `-- Stationary point found.`。
6. **热化学**：`Temperature   298.150 Kelvin.  Pressure   1.00000 Atm.`；8 个 `xxx=  value` 行（Zero-point correction / Thermal correction to Energy / Enthalpy / Gibbs Free Energy / Sum of electronic and zero-point Energies / thermal Energies / thermal Enthalpies / thermal Free Energies）。可出现在 `-- Thermochemistry --` 段。
7. **频率**：多个 `Frequencies --  a b c` 块（每块 1–3 个模式），每块后跟：
```
 Red. masses --      ...
 Frc consts  --      ...
 IR Inten    --      ...
  Atom  AN      X      Y      Z        X      Y      Z        X      Y      Z
     1   8     0.00   0.07   0.00     0.07   0.00   0.00 ...
```
   按块列数把位移分发给对应模式；行首 `Atom AN` 之后每个模式 3 列；`IR Inten` 可能缺失（如 `freq=(raman)`），需容错。检测 `Frequencies ---`（hpmodes）时至少提取频率数值；位移取不到时 `displacements: []` 并加 warning。
8. **freqFrameIndex**：统计全文 `Standard orientation:` 出现次数；频率段第一个 `Frequencies --` 或 `Harmonic frequencies` 之前最近一个 orientation 的全局索引即 freqFrameIndex；全文无 Standard orientation 时用最后一个 `Input orientation:`（此时为 null 或按解析器行为给出，注明）。若有多个 job，全局计数连续。
9. 正常终止：`Normal termination of Gaussian`；异常：`Error termination`。
10. 健壮性：CRLF/BOM、空行、科学计数法、NaN；大文件（≥1 MB、20 个频率块）性能 < 300ms（Node 计时）。

### 4.5 测试与样例（必须交付）

- 写 `tools/gen-log-sample.mjs`：导出 `buildOptFreqLog()`，生成一份**真实风格**的水分子 `opt freq` Gaussian 16 log 文本（3 原子；4 个优化步，含每步 orientation/SCF Done/收敛表/`Optimization completed`；3 个振动模式 ~1600/3800/3900 cm^-1，每个模式含 3 原子位移、Red. masses、Frc consts、IR Inten；完整热化学 8 项；`Normal termination`；route `#p b3lyp/6-31g(d) opt freq`），并写出 `tests/fixtures/water-opt-freq.log`（供 Lead 复制到 samples/ 并嵌入示例库）。
- `tests/gausslog.test.mjs`：断言 route/charge/multiplicity/natoms、SCF 能量数组、optSteps 4 步且能量递减、converged=true、4 项收敛值、thermochemistry 8 个数值、frequencies 3 个（频率/IR/位移数=3 原子）、freqFrameIndex 正确、finalEnergy 正确、非 log 文本不抛异常、多 job 夹具、hpmodes 容错、CRLF/BOM、性能。
- 运行：`node tests/gausslog.test.mjs`（Node 24，无 npm）。

## 5. 渲染器：振动位移（`js/renderer.js`，render-dev）

新增 API（不得破坏 v1 API）：

```js
view.setDisplacements(displacements | null)   // displacements[i] = [dx,dy,dz]（Å）；长度可小于原子数（缺省 0）。不修改 molecule。
view.getDisplacements() -> array|null          // 深拷贝
```

语义：
- 设置后，绘制/投影/拾取/标签/键/测量引导/`view.onRender` 回调中的 `project()` 全部使用 `atom + displacement`（键的端点也位移）。
- `setMolecule()` 时自动清空 displacements；`frameAll()`/取景使用未位移的原子（避免动画时抖动）。
- 播放动画时由 results.js 每帧设置并 `requestRender()`；renderer 不自己跑动画循环。
- 性能：2000 原子每帧仍可交互（复用现有投影缓存逻辑即可）。
- 自测：更新 `tests/renderer-preview.html`（新增 displacement 场景 + 自检项：project 位移前后差一致、setMolecule 后清空、null 恢复、位移时 bond 端点变化）；`node shots/_cdp_renderer_shots.mjs` 更新并通过（20+ 项）。可用 CDP 截图验证。

## 6. 计算结果面板（`css/results.css` + `js/charts.js` + `js/results.js`，results-dev）

### 6.1 MolResults API

```js
MolResults = {
  version: '1.0.0',
  create(containerEl, opts) -> panel
};
// opts = {
//   i18n: MolI18n（必需）,
//   getView: function() -> renderer view | null,
//   onRequestFrame: function(frameIndex) -> void|Promise   // 可选；UI 会切到该帧
// }
panel = {
  setResults(logResults | null) -> void,   // 渲染/清空
  refreshLanguage() -> void,               // 语言变化后重绘全部文案/图表标签
  setActive(active) -> void,               // tab 显示/隐藏；**隐藏时停止动画并清空位移（保留 selectedMode 高亮），避免 3D 视口残留形变**
  getState() -> {
    available, jobCount, frequencyCount, selectedMode, animating, paused,
    hasCharts, finalEnergy, freqFrameIndex
  },
  playFrequency(modeIndex) -> void,        // 0 基；未选择时默认 0；无位移数据 -> throw Error（本地化）
  stopAnimation() -> void,                 // 停止并清除位移
  setAmplitude(percent) -> void,           // 10–100，默认 50
  dispose() -> void
};
```

- 面板所有 DOM 由 `MolResults` 在 container 内创建（index.html 只提供 `#results-panel`）。
- 面板字典在 results.js 加载时 `MolI18n.register('en'/'zh', {...})`，key 前缀 `results.`。
- 无结果：只显示空状态提示（`#results-empty`），隐藏 `#results-content`。
- 有结果：显示以下结构（**id 必须原样存在，E2E 依赖**）：

```html
<div id="results-empty">…</div>              <!-- 无结果提示 -->
<div id="results-content">
  <select id="results-job-select">…</select> <!-- job 数 >1 且有多组结果时显示 -->
  <div id="results-summary">
    <!-- 每行: <div class="res-row" data-field="..."><span class="res-label">…</span><span class="res-value">…</span></div>
         data-field 必须包含：natoms, route, charge, multiplicity, final-energy, termination,
         optimization, temperature, pressure, zpe, thermal-energy, thermal-enthalpy, thermal-gibbs,
         sum-zpe, sum-energy, sum-enthalpy, sum-gibbs（缺数据显示 —） -->
  </div>
  <section id="results-energy-section"><h3 class="res-title">…</h3><canvas id="results-energy-canvas"></canvas></section>
  <section id="results-conv-section"><h3 class="res-title">…</h3><canvas id="results-conv-canvas"></canvas></section>
  <section id="results-freq-section">
    <h3 class="res-title">…</h3>
    <div id="results-freq-list">
      <!-- 每行: <button class="freq-row" data-mode-index="0" type="button">
                 <span class="freq-index">1</span><span class="freq-value">1600.12 cm⁻¹</span>
                 <span class="freq-ir">IR 12.3</span> …  （每个 mode 一行）
               </button> ; 虚频行加 class "is-imaginary"；当前播放行加 "is-active" -->
    </div>
    <div id="results-freq-controls">
      <button id="results-freq-play" type="button">▶</button>
      <button id="results-freq-stop" type="button">■</button>
      <label><span data-i18n?>Amplitude</span><input id="results-freq-amplitude" type="range" min="10" max="100" value="50"></label>
      <span id="results-freq-mode-label">—</span>
    </div>
    <p id="results-freq-note" class="res-note"></p>
  </section>
</div>
```

### 6.2 行为要求

- **概要**：`final-energy` 用 `summary.finalEnergy`（Hartree，6 位小数）；`termination` 显示 Normal/Error/Unknown 本地化；`optimization` 显示 Optimized / Not converged / —；热化学 8 项按 Hartree 显示（4–6 位小数）。
- **能量曲线**：用 `summary.energySteps` 画折线（x=步，y=相对能 ΔE kcal/mol，最后一步为 0；若只有 1 个点则画单点并标注绝对能量）；画轴、网格、数值标签；空数据隐藏 section 或显示本地化“无优化数据”。
- **收敛曲线**：若 opt.steps 含 4 项指标，画 4 条折线（y=log10(|值|)，带 4 条阈值水平虚线）；空数据隐藏 section 或显示“无收敛数据”。
- **频率列表**：每个 mode 一行；点击行 → 选中并播放该模式（等效 `playFrequency`）；`IR Inten` 缺失显示 —；虚频显示负数并标红（`.is-imaginary`）。
- **振动动画**：
  - 播放前若有 `summary.freqFrameIndex != null` 且 `opts.onRequestFrame` 存在，先调用它切帧（Promise 则 await），再 `getView()`；无 view 时抛错。
  - 归一化位移向量：取所有原子位移向量模长的最大值，将其放大到 `amplitudeÅ`（默认 50% ≈ 0.25 Å；10%≈0.05，100%≈0.5）；位移量 = A·sin(phase)·unitVector。
  - 用 `requestAnimationFrame` 循环（约 60fps，phase 速度 ~1.2π rad/s）；每帧 `view.setDisplacements(arr); view.requestRender();`
  - `play/pause` 切换；暂停保留当前位移；`stop` 清空位移（`setDisplacements(null)` + requestRender）并恢复按钮文案。
  - 切 tab 隐藏、换分子、setResults(null)、dispose 时停止动画。
  - 振幅滑块实时生效（播放中即时调整）。
- **图表**：Canvas 2D 手写折线图（`js/charts.js` 可复用，无第三方库）；DPR 适配；窗口 resize 时重绘（results.js 监听 resize，dispose 移除）；颜色与 app 浅色主题一致、文字本地化；不得依赖 CSS 变量（canvas 内用固定色值）。
- 语言切换：`refreshLanguage()` 重新生成所有 label/图表文本（数字不变）。
- 不得修改 molecule 数据；不得调用 `view.setMolecule`（只允许 `onRequestFrame`/`setDisplacements`/`requestRender`/`getView` 上的其他只读方法）。

### 6.3 自测（results-dev）

- `tests/results-preview.html`：加载 core.js/parsers.js/gausslog.js/i18n.js/renderer.js/charts.js/results.js，内嵌 fixture log（从 tools/gen-log-sample.mjs 生成的文本内嵌或直接内嵌），创建视口 + `#results-panel`，自检：summary 行存在、两张 canvas 非空白、频率行数=3、点击播放后 `getState().animating === true`、停滞后 false、无 JS 异常。
- 用 CDP 截图（EN + ZH 各一张）到 `screenshots/results-*.png`，用 read_image 检查。
- 单独语法检查：`node --check js/charts.js js/results.js`（分别执行）。

## 7. index.html 结构变更（i18n-dev）

按 §3.4 + §2 执行；额外要求：

- 所有静态中文 → 英文初始文本 + data-i18n（见 §3.2）；新增的 Tab/语言按钮/结果容器。
- 保留全部 v1 DOM id 不变（#file-input、#btn-open、#sample-select、#tool-select…状态栏、错误横幅等）。
- 新增 DOM id：`#lang-toggle`、`#side-tabs`、`#tab-molecule`、`#tab-results`、`#tab-page-molecule`、`#tab-page-results`、`#results-panel`（其余结果面板内部 id 由 results.js 创建）。
- 空状态/鼠标提示/快捷键提示/面板标题等全部 i18n 化；初始文本为英文。
- 交付 `tests/i18n.test.mjs`（Node DOM shim 或纯引擎测试）：默认 en、register/fallback/插值、translateDOM 更新 static 元素、setLang 持久化模拟、en 字典覆盖 index.html 中所有 data-i18n key（扫描 index.html 提取 key 核对字典存在，两种语言都要有）——这个扫描测试很重要。
- i18n-dev 负责在 `screenshots/` 产出 en/zh 主界面截图（CDP）。

## 8. ui.js 集成 + MolApp API 扩展（ui-dev）

### 8.1 i18n 接入（ui.js 内所有用户可见动态字符串）

- 顶部 `MolI18n.register('en', {...}); MolI18n.register('zh', {...})`（命名空间 `ui.*`、`status.*`、`samples.*`）；启动时调用 `MolI18n.init()`（在 `MolApp.ready` resolve 前）。
- 所有动态文案（状态栏、选择列表、dataset 标签、错误前缀、应用成功提示、undo/redo 提示、导出提示、重新推断提示、键鼠提示、空状态副标题更新、示例下拉 placeholder/选项）走 `t()`；文件内不得残留硬编码可见中文（注释除外）。
- 语言按钮 `#lang-toggle`：点击 `MolI18n.toggleLang()`；`onChange` 时：更新按钮文字（en→"中文"，zh→"EN"）、title/aria、示例下拉 names（`nameEn`/`name`）、dataset 标签 "Frame i/n"、当前选择/测量/状态栏等动态区域，并调用 `resultsPanel.refreshLanguage()`、`refreshStatus()`。
- 示例下拉：`MolSamples.list` 项按语言取 `name`（zh）/`nameEn`（en，缺省回退 name）；placeholder 用 `samples.placeholder`。
- 已知例外（可保留中文）：解析器抛出的错误 message、用户文件名/分子标题。错误横幅可加本地化前缀。

### 8.2 结果面板集成

- 创建：`state.resultsPanel = MolResults.create(refs.resultsPanel, { i18n: MolI18n, getView: function(){return state.view;}, onRequestFrame: function(idx){ setDatasetIndexApi(idx); } });`
- `loadText` 成功后：
  - `state.logResults = (format === 'log' && global.MolGaussLog) ? MolGaussLog.parse(text) : null;`
  - `resultsPanel.setResults(state.logResults);`
  - `#tab-results` disabled = !results.available；
  - 若 `logResults.summary` 含 frequencies/optimization/thermochemistry（`hasFrequencies||hasOptimization||hasThermochemistry`）→ `setSideTab('results')` 自动切到结果页；否则 `setSideTab('molecule')`。
  - LoadResult 增加字段（见 §8.3）。
- 非 log / 加载失败：`resultsPanel.setResults(null)`、禁用 results tab、回到 molecule tab。
- Tab 切换：`setSideTab('molecule'|'results')` 切换 `.is-active` / `hidden` / `aria-selected`，results 隐藏时 `resultsPanel.setActive(false)`（暂停动画），显示时 `setActive(true)`。
- `onRequestFrame(idx)`：若 idx 为合法 number → 调 `setDatasetIndexApi(idx)`（不要动画冲突：若已禁用则忽略）。
- 窗口 resize 由 results.js 自理，ui.js 不需要管。

### 8.3 MolApp API 扩展（必须）

```js
MolApp.setLanguage(lang) -> void          // 'en'|'zh'，等价 MolI18n.setLang + 全部 UI 刷新
MolApp.getLanguage() -> 'en'|'zh'
MolApp.getLogResults() -> LogResults|null
MolApp.getResultsState() -> {
  available, activeTab: 'molecule'|'results', jobCount, frequencyCount,
  hasFrequencies, hasOptimization, hasThermochemistry,
  animating, paused, selectedMode, amplitude, freqFrameIndex, finalEnergy
}
MolApp.setSideTab(name) -> void           // 'molecule'|'results'
MolApp.playFrequency(modeIndex) -> void   // 失败抛本地化 Error
MolApp.stopFrequencyAnimation() -> void
MolApp.getFrequencyAnimationState() -> { animating, paused, selectedMode, amplitude, freqFrameIndex }
MolApp.setFrequencyAmplitude(percent) -> void
```

`loadText`/`loadSample` 的 LoadResult 增加：`hasLogResults`、`logJobCount`、`frequencyCount`、`hasFrequencies`、`hasThermochemistry`、`hasOptimization`。

### 8.4 css/app.css

- `#side-tabs`（两个等宽 tab、active 下划线/底色、disabled 灰显）、`.side-page`（隐藏时 display:none）、`#lang-toggle` 样式、与现有浅色主题一致；1440×900 下结果面板可滚动；侧栏 tab 不破坏 v1 布局。

### 8.5 测试更新（ui-dev）

- 更新 `tests/ui-cdp-smoke.mjs`、`tests/ui-logic-smoke.mjs`：适配默认英文（或先 `MolApp.setLanguage('zh')` 保留原中文断言）；新增断言：默认 en、切换 zh 后关键 label 变中文、示例名切换、语言持久化（同页 reload 用 CDP）、log 加载后 results tab 可用/自动切换、playFrequency/stop、getResultsState。
- 截图刷新 `shots/ui2-*.png`（EN 默认 + 中文各一组关键页）。

## 9. samples.js / MolSamples 变更（Lead）

```js
MolSamples.list = [ { key, name, nameEn, format, filename }, ... ]
```
- 每个示例新增 `nameEn`（英文名）；UI en 模式用 nameEn、zh 用 name。
- 新增示例 `water-opt-freq`：format `log`、filename `water-opt-freq.log`、name "水分子 opt+freq 计算（LOG，结果演示）"、nameEn "Water opt+freq log (results demo)"，文本由 `tools/gen-log-sample.mjs` 生成并嵌入。
- 现有 6 个示例保持 key 不变；`samples/water-opt-freq.log` 同步写出。

## 10. Linux / macOS 支持（Lead）

必须交付（ASCII 文件名、LF 换行、`#!/usr/bin/env bash`）：

1. `launch.sh`：POSIX 友好启动器
   - 解析脚本所在目录（支持软链）；校验 index.html；
   - `--dry-run`：只打印检测结果不启动（供测试）；
   - 默认：优先用系统默认方式直接打开 `index.html`（macOS `open`，Linux `xdg-open` / `gio open` / `sensible-browser`）；
   - 无可用 opener 或 `--server`：启动本地服务器（优先 `python3 -m http.server`，回退 `python`、`node server.mjs`），端口 `MOLEDIT_PORT` 或 8777（被占用则尝试 8778…），后台运行 + trap 退出清理，再打开 `http://127.0.0.1:PORT/`；
   - 终端停留并提示 Ctrl+C 停止（server 模式）。
2. `MolEdit.command`：macOS 双击入口（内部 exec launch.sh），并提示 `chmod +x`（README 说明）。
3. `start-server.sh`：Linux/macOS 本地静态服务器脚本（python3/python/node 回退；前台运行，打印 URL）。
4. `tools/create-linux-desktop-shortcut.sh`：生成 `~/.local/share/applications/moledit.desktop`（Exec 指向 launch.sh、Icon 指向 assets/moledit-256.png），支持 `--dry-run` 打印内容。
5. `tests/portability.test.mjs`：静态断言（存在、LF、shebang、关键分支命令、中文路径无问题）+ 有 Git Bash 时用其 `bash -n` 语法检查；并用临时 fake PATH（mock uname/xdg-open/open/python3）测试 `launch.sh --dry-run` 的输出分支（Linux file 打开 / macOS file 打开 / 无 opener 时 server 分支）。
   - 若本机无可用 bash，测试打印 SKIP 并以 0 退出（报告中说明）。
6. README 增补 Linux/macOS 章节（bash launch.sh、chmod +x、macOS .command、桌面快捷方式、Windows 开始菜单已有）。

## 11. 验证与验收

### 11.1 环境

- Node v24；**常驻 headless Chrome（CDP 127.0.0.1:9222）由 Lead 启动**；使用 `moledit/tools/cdp.mjs`（已禁用缓存）或 `node tools/screenshot.mjs`。
- 浏览器测试：`file:///path/to/moledit/index.html`；HTTP：`node server.mjs 8777`。
- 每人自测必须真跑命令并报告结果；截图用 read_image 检查。

### 11.2 各自测试命令（必须通过）

- i18n-dev：`node tests/i18n.test.mjs`（含 index.html key 覆盖扫描）；CDP 截图 EN/ZH。
- log-dev：`node tests/gausslog.test.mjs`（≥20 项断言）。
- results-dev：`node tests/results-preview.html` 自检（CDP `--eval="window.__resultsChecks"`）+ 截图；`node --check js/charts.js`、`node --check js/results.js`。
- render-dev：`node shots/_cdp_renderer_shots.mjs`（含 displacement 用例）。
- ui-dev：`node tests/ui-logic-smoke.mjs`、`node tests/ui-cdp-smoke.mjs`（EN/ZH）。
- qa-dev：`node tests/e2e.mjs` 扩展（i18n + log 结果 + 动画 + 跨平台静态检查），最终 ≥40 用例通过、0 页面错误；更新 `tests/e2e-report.json` + screenshots + visualQA。
- Lead：`node tests/portability.test.mjs`、`node tests/core.test.mjs`、`node tests/parsers.test.mjs`、`node tests/gausslog.test.mjs`、`node tests/e2e.mjs`、全量截图复核。

### 11.3 验收矩阵

| # | 验收项 | 证据 |
| --- | --- | --- |
| 1 | 默认英文：首开页面标题/按钮/面板/选项/提示全英文 | E2E + 截图 |
| 2 | 切换中文：所有静态+动态文案、示例名、结果面板、图表标签切换为中文；持久化 | E2E + 截图 |
| 3 | EN 模式下应用 chrome UI 无中文残留（豁免：#error-banner 解析错误、用户数据 #mol-title/#selection-list、**#lang-toggle**（语言按钮按惯例用目标语言显示"中文"，其余 EN 文案为英文）） | E2E CJK 扫描 |
| 4 | 打开 opt+freq log：单点能、热化学 8 项、能量曲线、收敛曲线、频率列表显示正确 | E2E DOM + 图表像素 + 截图 |
| 5 | 频率动画：播放/暂停/停止/振幅、位移作用于视口且不修改分子、停止后恢复 | E2E + 截图 |
| 6 | 普通 log（water.log）结果面板可用（能量值），无结果格式时 results tab 禁用 | E2E |
| 7 | Linux/macOS：launch.sh 语法/分支测试通过，README 说明完整；Windows file:// 与 HTTP 均正常 | portability test + 截图 |
| 8 | v1 功能回归：四格式加载、测量、三种几何编辑、undo、导出回环全部仍通过 | 既有测试 + E2E |

## 12. 协作规则

- 先 claim 共享任务再动手，完成即 complete；遇到契约矛盾先消息 Lead，不擅自改公共 API / 别人的文件。
- 只写自己名下文件；`index.html` 只有 i18n-dev 可写；`js/ui.js`/`css/app.css` 只有 ui-dev；`js/gausslog.js` 只有 log-dev；`js/charts.js`+`js/results.js`+`css/results.css` 只有 results-dev；`js/renderer.js` 只有 render-dev。
- 新模块加载顺序/全局名不得偏差；所有新 JS 为经典脚本（无 ESM、无 fetch、无外部依赖），`node --check` 通过；`gausslog.js`/`i18n.js` 必须能在 Node 中 require/加载用于测试。
- 报告格式：状态 | 文件 | 已实现要点 | 测试命令与真实结果 | 截图路径 | 已知问题/待决策。
