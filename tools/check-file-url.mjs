/* 验证：普通浏览器（不带 --allow-file-access-from-files）打开 file:///.../index.html 时，
 * 全部经典脚本能加载、MolApp 能初始化、能加载示例并测量。用于开始菜单快捷方式的启动验证。
 * 运行：node tools/check-file-url.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const water = fs.readFileSync(path.join(ROOT, 'samples', 'water.xyz'), 'utf8');

const page = await openPage(APP_URL, { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.waitFor('typeof MolCore !== "undefined" && typeof MolRender !== "undefined" && typeof MolSamples !== "undefined"', 10000);
  await page.eval('MolApp.ready');
  const result = await page.eval(`(async function(){
    await MolApp.loadText(${JSON.stringify(water)}, {filename:'water.xyz'});
    MolApp.setSelection([1,0,2]);
    var s = MolApp.getState();
    return {
      atoms: s.atomCount, bonds: s.bondCount,
      distance: MolApp.getMeasurements().distance,
      angle: MolApp.getMeasurements().angle,
      scripts: (typeof MolCore) + '/' + (typeof MolRender) + '/' + (typeof MolSamples) + '/' + (typeof MolApp),
      canvas: (function(){ var c = document.getElementById('viewport-canvas'); return c ? c.width + 'x' + c.height : 'none'; })()
    };
  })()`);
  console.log('file://（无 --allow-file-access-from-files）测试结果:');
  console.log(JSON.stringify(result, null, 2));
  console.log('页面错误:', JSON.stringify(page.errors.concat(page.consoleErrors)));
  await page.screenshot(path.join(ROOT, 'shots', 'lead-file-nonoflag.png'));
  console.log('截图: shots/lead-file-nonoflag.png');
} catch (e) {
  console.error('❌ file:// 普通模式验证失败:', e && e.stack || e);
  console.error('页面错误:', JSON.stringify(page.errors.concat(page.consoleErrors)));
  process.exitCode = 1;
} finally {
  await page.close();
  await new Promise((r) => setTimeout(r, 300));
}
