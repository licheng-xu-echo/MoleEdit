/* MolEdit — tools/lead-styles.mjs
 * 验证样式切换的对称自适应取景（round-trip 后分子大小/视角稳定）。
 * 运行：node tools/lead-styles.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const page = await openPage('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'), { width: 1440, height: 900 });
try {
  await page.waitFor('document.readyState === "complete"', 20000);
  await page.waitFor('!!(window.MolApp && window.MolApp.ready)', 20000);
  await page.eval('MolApp.ready');

  const stats = () => page.eval(`(function(){
    var c = document.getElementById('viewport-canvas'), ctx = c.getContext('2d');
    var d = ctx.getImageData(0,0,c.width,c.height).data;
    var W=c.width,H=c.height,minX=W,minY=H,maxX=-1,maxY=-1,count=0;
    for (var y=0;y<H;y+=2){for(var x=0;x<W;x+=2){
      var i=(y*W+x)*4;
      if (d[i]<245||d[i+1]<245||d[i+2]<245){count++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
    }}
    return { fill: Math.round(Math.max((maxX-minX)/W,(maxY-minY)/H)*1000)/1000,
             bbox:[minX,minY,maxX,maxY], inCanvas: minX>=0 && minY>=0 && maxX<W && maxY<H,
             W:W,H:H };
  })()`);

  await page.eval('(async function(){ await MolApp.loadSample("benzene-sdf"); })()');
  await page.wait(500);
  const r = {};
  r.ballstick1 = await stats();
  for (const style of ['spacefill', 'ballstick', 'wireframe', 'stick', 'ballstick']) {
    await page.eval('MolApp.setStyle(' + JSON.stringify(style) + ')');
    await page.wait(450);
    r[style + '@' + Object.keys(r).length] = await stats();
  }
  console.log(JSON.stringify(r, null, 1));

  const bt = (v) => v.fill >= 0.50 && v.fill <= 0.85 && v.inCanvas;
  const checks = [
    ['ballstick 初始填充 50-85%', bt(r.ballstick1)],
    ['spacefill 完整可见且填充 50-85%', bt(r['spacefill@1'])],
    ['切回 ballstick 填充恢复 50-85%', bt(r['ballstick@2'])],
    ['wireframe 完整可见且填充 50-85%', bt(r['wireframe@3'])],
    ['stick 完整可见且填充 50-85%', bt(r['stick@4'])],
    ['再次切回 ballstick 填充 50-85%', bt(r['ballstick@5'])]
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log((pass ? '✅ ' : '❌ ') + name);
    if (!pass) ok = false;
  }
  console.log('页面错误:', JSON.stringify(page.errors.concat(page.consoleErrors)));
  if (!ok) process.exitCode = 1;
} finally {
  await page.close();
  await new Promise((r) => setTimeout(r, 300));
}
