# Credits / 致谢

## Project / 项目

**MolEdit — a GaussView-style molecular editor (bilingual web app)**

- Repository: [https://github.com/licheng-xu-echo/MoleEdit](https://github.com/licheng-xu-echo/MoleEdit)
- Version: v2 (November 2026)
- License: see the repository's `LICENSE` file if present.

## Human developer / 人类开发者

- **Li-Cheng Xu** ([@licheng-xu-echo](https://github.com/licheng-xu-echo)) — project owner, requirements, review, integration, testing and release.

## AI-assisted development / AI 辅助开发

This project was developed with AI assistance from **DeepSeek**, using model **`deepseek-flash`** running inside the **DeepSeek Harness (DSH) agent** (multi-agent coding session, November 2026).

AI-assisted scope / AI 参与范围:

- Molecular data model, element table, bond inference, measurements and geometry editing algorithms (`js/core.js`)
- XYZ / SDF / GJF / LOG parsers (`js/parsers.js`)
- Gaussian LOG result analysis: SCF energies, thermochemistry, optimization convergence, frequencies and normal-mode displacements (`js/gausslog.js`)
- Canvas 2D ball-and-stick renderer, camera/projection, picking and vibration displacements (`js/renderer.js`)
- UI, interactions, undo/redo, i18n integration and the `MolApp` API (`js/ui.js`, `index.html`, `css/`)
- Results panel with charts and normal-mode animation (`js/charts.js`, `js/results.js`, `css/results.css`)
- Internationalization engine and dictionaries (`js/i18n.js`)
- Cross-platform launchers and documentation (`launch.sh`, `start-server.sh`, `MolEdit.command`, `*.bat`, README)
- Automated test suites and verification (`tests/`, `tools/`)

All AI-generated code was integrated, executed and verified with real tests during the session
(unit tests, CDP end-to-end tests and visual checks). The human developer is responsible for the
final content of this repository.

本项目由 **DeepSeek**（模型 `deepseek-flash`，运行于 **DeepSeek Harness / DSH Agent**）协助开发，
涵盖分子核心算法、文件解析、Gaussian 结果分析、3D 渲染、界面与结果面板、国际化、跨平台启动脚本及自动化测试。
AI 生成的代码在开发会话中均经过真实运行与测试验证；仓库最终内容由人类开发者负责。

## Third-party components / 第三方组件

**None.** The application uses only vanilla HTML / CSS / JavaScript and a hand-written Canvas 2D renderer.
No CDN, no front-end framework, no npm runtime dependencies. The app icon (`assets/moledit.ico`) was
generated in-house with Python Pillow; screenshots were taken with headless Chrome via the DevTools Protocol.

**无。** 应用仅使用原生 HTML / CSS / JavaScript 与手写 Canvas 2D 渲染器，无 CDN、无前端框架、无 npm 运行时依赖。
应用图标由 Python Pillow 在本项目内生成；测试截图通过 headless Chrome 的 DevTools Protocol 获取。
