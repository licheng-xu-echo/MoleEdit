/* MolEdit — tools/lead-overlay.mjs
 * 检查测量叠加层与当前分子/选择是否同步（防止旧状态残留）。
 * 运行：node tools/lead-overlay.mjs
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
  await page.eval('MolApp.ready');
  await page.wait(300);

  const result = await page.eval(`(async function(){
    var z = {};
    await MolApp.loadText(${JSON.stringify(water)}, {filename:'water.xyz'});
    z.loadedAtoms = MolApp.getState().atomCount;
    MolApp.setSelection([1,0,2]);
    z.meas = MolApp.getMeasurements();
    z.overlayAfterSelect = document.getElementById('viewport-overlay').textContent;
    MolApp.setStyle('spacefill');
    await new Promise(function(res){ requestAnimationFrame(function(){ setTimeout(res, 150); }); });
    z.overlayAfterStyle = document.getElementById('viewport-overlay').textContent;
    z.overlayChildren = document.getElementById('viewport-overlay').childElementCount;
    z.domDistance = document.getElementById('measure-distance').textContent;
    z.domAngle = document.getElementById('measure-angle').textContent;
    z.state = MolApp.getState();
    return z;
  })()`);
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot(path.join(ROOT, 'shots', 'lead-overlay.png'));
  console.log('页面错误:', JSON.stringify(page.errors.concat(page.consoleErrors)));
} finally {
  await page.close();
  await new Promise((r) => setTimeout(r, 300));
}
