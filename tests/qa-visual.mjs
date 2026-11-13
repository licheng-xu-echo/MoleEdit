/* qa-dev 辅助脚本（v2）：校验并刷新 tests/e2e-report.json 中的人工视觉质检结论 visualQA。
 *
 * 工作流：
 *   1) node tests/e2e.mjs                → 生成报告与 screenshots/e2e-*.png（保留上一份 visualQA）
 *   2) 用 read_image 逐张检查截图（+ 2x 细节裁剪）并更新报告中的 visualQA 结论文本
 *   3) node tests/qa-visual.mjs          → 校验 visualQA 覆盖全部 e2e 截图、刷新截图 sha256/bytes 与
 *                                          inspectedAt / inspectedProduct（取自报告的 product 快照）
 *
 * 本脚本只读写 tests/e2e-report.json，不修改产品文件。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const REPORT = ROOT + '/tests/e2e-report.json';
const SHOTS = ROOT + '/screenshots/';
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const qa = report.visualQA;
if (!qa || !Array.isArray(qa.checks) || !qa.checks.length) {
  console.error('report.visualQA.checks 为空：请先人工检查截图并把结论写入 report，再运行本脚本。');
  process.exit(2);
}

function shotInfo(file) {
  const name = String(file).replace(/^screenshots\//, '');
  const full = SHOTS + name;
  if (!fs.existsSync(full)) return { file: 'screenshots/' + name, exists: false };
  const buf = fs.readFileSync(full);
  return {
    file: 'screenshots/' + name,
    exists: true,
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  };
}
function productMd5(key) {
  const p = report.product && report.product[key];
  return p && p.md5 ? p.md5.toUpperCase() : null;
}

// 1) 刷新每个 check 的截图信息
for (const c of qa.checks) Object.assign(c, shotInfo(c.file));

// 2) 截图盘点：报告 screenshots 中每个唯一文件都必须有视觉 check
const shotNames = [...new Set((report.screenshots || []).map((s) => s.name))];
const checkedNames = new Set(qa.checks.map((c) => String(c.file).replace(/^screenshots\//, '')));
const missingChecks = shotNames.filter((n) => !checkedNames.has(n));
if (missingChecks.length) {
  console.error('以下截图缺少 visualQA.check：' + missingChecks.join(', '));
  process.exit(3);
}

// 3) 刷新元信息
qa.inspectedAt = new Date().toISOString();
qa.inspectedProduct = {
  'js/renderer.js': productMd5('js/renderer.js'),
  'js/ui.js': productMd5('js/ui.js'),
  'js/i18n.js': productMd5('js/i18n.js'),
  'js/gausslog.js': productMd5('js/gausslog.js'),
  'js/charts.js': productMd5('js/charts.js'),
  'js/results.js': productMd5('js/results.js'),
  'css/results.css': productMd5('css/results.css'),
  'index.html': productMd5('index.html'),
  'js/samples.js': productMd5('js/samples.js'),
  'INTERFACE2.md': productMd5('INTERFACE2.md')
};
qa.screenshotCount = shotNames.length;
qa.checkedCount = qa.checks.length;

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('visualQA refreshed:', qa.checks.length + '/' + shotNames.length + ' screenshots checked',
  '| openIssues:', (qa.openIssues || []).length, '| resolvedIssues:', (qa.resolvedIssues || []).length);
