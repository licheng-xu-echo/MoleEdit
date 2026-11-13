/* MolEdit — tools/gen-docs-shots.mjs
 * 生成 README 用的 v2 截图（docs/*.png）：默认英文主界面、选中测量、二面角编辑、
 * 空间填充、Gaussian 结果面板（EN/ZH）、频率列表、振动动画、中文主界面。
 * 运行：node tools/gen-docs-shots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const APP_URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const logText = fs.readFileSync(path.join(ROOT, 'samples', 'water-opt-freq.log'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  [' + detail + ']' : ''));
}
fs.mkdirSync(DOCS, { recursive: true });

async function runShot(name, prepare) {
  const page = await openPage(APP_URL, { width: 1440, height: 900 });
  try {
    await page.waitFor('document.readyState === "complete"', 20000);
    await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
    await page.eval('MolApp.ready');
    await page.eval('localStorage.clear()');
    await page.eval('MolApp.setLanguage("en")');
    await sleep(400);
    await prepare(page);
    const file = await page.screenshot(path.join(DOCS, name));
    const st = fs.statSync(file);
    console.log('  → docs/' + name + '  (' + st.size + ' bytes)');
    return st.size;
  } finally {
    await page.close();
    await sleep(200);
  }
}

// 1) 主界面：英文默认 + 苯环选中 4 原子
{
  const size = await runShot('main.png', async (p) => {
    await p.eval('MolApp.loadSample("benzene-sdf")');
    await sleep(500);
    await p.eval('MolApp.setSelection([0,1,2,3])');
    await sleep(500);
  });
  check('docs/main.png 英文主界面', size > 50000);
}

// 2) 选中与测量（水，键角）
{
  const size = await runShot('select.png', async (p) => {
    await p.eval('MolApp.loadSample("water-xyz")');
    await sleep(400);
    await p.eval('MolApp.setSelection([1,0,2])');
    await sleep(500);
  });
  check('docs/select.png 选中测量', size > 50000);
}

// 3) 二面角编辑（丁烷改成 60°）
{
  const size = await runShot('dihedral.png', async (p) => {
    await p.eval('MolApp.loadSample("butane-xyz")');
    await sleep(400);
    await p.eval('MolApp.setSelection([0,1,2,3])');
    await sleep(200);
    await p.eval('MolApp.applyBondDihedral(60)');
    await sleep(500);
  });
  check('docs/dihedral.png 二面角编辑', size > 50000);
}

// 4) 空间填充样式
{
  const size = await runShot('spacefill.png', async (p) => {
    await p.eval('MolApp.loadSample("benzene-sdf")');
    await sleep(400);
    await p.eval('MolApp.setStyle("spacefill")');
    await sleep(600);
  });
  check('docs/spacefill.png 空间填充', size > 50000);
}

// 5) Gaussian 结果面板（英文，概览 + 两张曲线）
{
  const size = await runShot('results-en.png', async (p) => {
    await p.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:'water-opt-freq.log'})`);
    await sleep(900);
    await p.eval('MolApp.setLanguage("en"); document.getElementById("sidepanel").scrollTop = 0;');
    await sleep(500);
  });
  check('docs/results-en.png 结果面板 EN', size > 50000);
}

// 6) Gaussian 结果面板（中文）
{
  const size = await runShot('results-zh.png', async (p) => {
    await p.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:'water-opt-freq.log'})`);
    await sleep(900);
    await p.eval('MolApp.setLanguage("zh"); document.getElementById("sidepanel").scrollTop = 0;');
    await sleep(600);
  });
  check('docs/results-zh.png 结果面板 ZH', size > 50000);
}

// 7) 频率列表 + 控件（滚动到底，英文）
{
  const size = await runShot('freq-list.png', async (p) => {
    await p.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:'water-opt-freq.log'})`);
    await sleep(900);
    await p.eval('MolApp.setFrequencyAmplitude(50); (function(){var sp=document.getElementById("sidepanel"); if(sp) sp.scrollTop=99999; var pg=document.getElementById("tab-page-results"); if(pg) pg.scrollTop=99999;})();');
    await sleep(500);
  });
  check('docs/freq-list.png 频率列表', size > 50000);
}

// 8) 振动动画播放中（模式 3，100% 振幅，明显相位）
{
  const size = await runShot('freq-anim.png', async (p) => {
    await p.eval(`MolApp.loadText(${JSON.stringify(logText)}, {filename:'water-opt-freq.log'})`);
    await sleep(900);
    await p.eval('MolApp.setFrequencyAmplitude(100); (function(){var sp=document.getElementById("sidepanel"); if(sp) sp.scrollTop=99999; var pg=document.getElementById("tab-page-results"); if(pg) pg.scrollTop=99999;})();');
    await sleep(300);
    await p.eval('MolApp.playFrequency(2)');
    await sleep(320);
    const st = await p.eval('MolApp.getFrequencyAnimationState()');
    console.log('  animation state:', JSON.stringify(st));
  });
  check('docs/freq-anim.png 振动动画', size > 50000);
}

// 9) 中文主界面
{
  const size = await runShot('main-zh.png', async (p) => {
    await p.eval('MolApp.setLanguage("zh")');
    await p.eval('MolApp.loadSample("benzene-sdf")');
    await sleep(500);
    await p.eval('MolApp.setSelection([0,1,2,3])');
    await sleep(500);
  });
  check('docs/main-zh.png 中文主界面', size > 50000);
}

console.log('\n完成：' + results.filter((r) => r.ok).length + ' / ' + results.length);
if (results.some((r) => !r.ok)) process.exitCode = 1;
