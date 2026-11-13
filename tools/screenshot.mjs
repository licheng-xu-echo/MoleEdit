/* MolEdit — tools/screenshot.mjs
 * 通过常驻 headless Chrome (CDP 127.0.0.1:9222) 给页面截图 / 执行 JS。
 *
 * 用法：
 *   node tools/screenshot.mjs <url> <out.png> [--wait=1500] [--eval="js"] [--width=1440] [--height=900]
 *   node tools/screenshot.mjs --shot-scenes ...  # 不提供，直接用 --eval 切换场景
 *
 * 示例：
 *   node tools/screenshot.mjs "file:///path/to/moledit/index.html" shots/ui.png --wait=2500
 *   node tools/screenshot.mjs "file:///path/to/moledit/tests/renderer-preview.html" shots/r.png --eval="changeScene('select')" --wait=800
 */
import { openPage } from './cdp.mjs';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node tools/screenshot.mjs <url> <out.png> [--wait=ms] [--eval=js] [--width=n] [--height=n]');
  process.exit(2);
}
const url = args[0];
const out = args[1];
const opts = { width: 1440, height: 900 };
let waitMs = 2000;
let evalScript = null;
for (const a of args.slice(2)) {
  const m = a.match(/^--(wait|eval|width|height)=(.*)$/s);
  if (!m) continue;
  if (m[1] === 'wait') waitMs = Number(m[2]) || 0;
  else if (m[1] === 'eval') evalScript = m[2];
  else if (m[1] === 'width') opts.width = Number(m[2]) || 1440;
  else if (m[1] === 'height') opts.height = Number(m[2]) || 900;
}

const page = await openPage(url, opts);
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.wait(300);
  if (evalScript) {
    const result = await page.eval(evalScript);
    if (result !== undefined) console.log('eval =>', typeof result === 'string' ? result : JSON.stringify(result));
  }
  await page.wait(1000);
  const file = await page.screenshot(out);
  console.log('screenshot:', file);
  if (page.errors.length) {
    console.error('页面错误 (' + page.errors.length + '):');
    for (const e of page.errors) console.error('  [' + e.type + '] ' + e.text);
  }
  if (page.consoleErrors.length) {
    console.error('console.error (' + page.consoleErrors.length + '):');
    for (const e of page.consoleErrors) console.error('  ' + e.text);
  }
  if (!page.errors.length && !page.consoleErrors.length) console.log('无页面错误');
  await page.wait(waitMs);
} finally {
  await page.close();
}
