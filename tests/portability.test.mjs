/* MolEdit — tests/portability.test.mjs
 * Linux / macOS 启动脚本验证（v2）。
 * - 静态检查：文件存在、LF、shebang、关键分支命令
 * - Git Bash 可用时：bash -n 语法检查 + launch.sh --dry-run 分支测试（linux/macos/server）
 * - Git Bash 因沙箱限制无法创建命名管道时：打印 SKIP（脚本本身仍保证静态检查通过）；
 *   Lead 会用更高权限重跑以获得 FULL PASS。
 * 运行：node tests/portability.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✅ ' + name);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/SKIP/.test(msg)) {
      failures.push({ name, error: e });
      console.log('⏭️  ' + name + ' :: ' + msg);
    } else {
      failures.push({ name, error: e });
      console.log('❌ ' + name + ' :: ' + msg);
    }
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/* ------------------------- 1. 文件存在 + LF + shebang ------------------------- */
const SHELL_FILES = [
  'launch.sh',
  'MolEdit.command',
  'start-server.sh',
  'tools/create-linux-desktop-shortcut.sh'
];

test('POSIX 启动脚本全部存在', () => {
  for (const f of SHELL_FILES) assert(exists(f), '缺少文件: ' + f);
});

test('POSIX 启动脚本使用 LF 换行（无 CR）', () => {
  for (const f of SHELL_FILES) {
    const text = read(f);
    assert(text.indexOf('\r') === -1, f + ' 含 CRLF/CR，Linux/macOS 下会出错');
  }
});

test('POSIX 启动脚本以 #!/usr/bin/env bash 开头', () => {
  for (const f of SHELL_FILES) {
    const text = read(f);
    assert(text.startsWith('#!/usr/bin/env bash'), f + ' 缺少正确 shebang');
  }
});

test('launch.sh 含必需分支：open / xdg-open / python3 / node / --dry-run / --server', () => {
  const text = read('launch.sh');
  for (const token of ['open', 'xdg-open', 'python3', 'node', '--dry-run', '--server', 'http.server', 'server.mjs']) {
    assert(text.includes(token), 'launch.sh 缺少: ' + token);
  }
  assert(text.includes('MOLEDIT_PORT'), 'launch.sh 应支持 MOLEDIT_PORT');
});

test('MolEdit.command 调用 launch.sh（macOS 双击入口）', () => {
  const text = read('MolEdit.command');
  assert(text.includes('launch.sh'), 'MolEdit.command 未调用 launch.sh');
  assert(text.includes('exec bash'), 'MolEdit.command 应以 exec bash 启动');
});

test('start-server.sh 含 python3 回退 node 逻辑', () => {
  const text = read('start-server.sh');
  assert(text.includes('http.server'), 'start-server.sh 缺少 python http.server');
  assert(text.includes('server.mjs'), 'start-server.sh 缺少 node server.mjs 回退');
  assert(text.includes('127.0.0.1'), 'start-server.sh 应绑定 127.0.0.1');
});

test('Linux 桌面快捷方式脚本包含 .desktop 内容与 --dry-run', () => {
  const text = read('tools/create-linux-desktop-shortcut.sh');
  assert(text.includes('[Desktop Entry]'), '缺少 [Desktop Entry]');
  assert(text.includes('moledit.desktop'), '缺少目标文件名');
  assert(text.includes('--dry-run'), '缺少 --dry-run');
  assert(text.includes('Exec=bash'), '缺少 Exec=bash');
});

test('README 包含 Linux / macOS 启动说明', () => {
  const text = read('README.md');
  assert(/Linux/i.test(text), 'README 缺少 Linux 说明');
  assert(/macOS|Mac OS/i.test(text), 'README 缺少 macOS 说明');
});

/* ------------------------- 2. bash 检测 ------------------------- */
function findBash() {
  const candidates = [
    process.env.GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    '/bin/bash',
    '/usr/bin/bash',
    'bash'
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'bash') return c;
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const bash = findBash();
const bashResult = { mode: 'SKIP', detail: '未找到 bash' };
let bashUsable = false;

if (bash) {
  const probe = spawnSync(bash, ['-c', 'echo bash-ok'], { encoding: 'utf8', timeout: 15000 });
  if (probe.status === 0 && (probe.stdout || '').includes('bash-ok')) {
    bashUsable = true;
    bashResult.mode = 'FULL';
    bashResult.detail = bash;
  } else {
    bashResult.detail =
      'bash 存在但无法运行（沙箱命名管道限制: ' +
      String((probe.stderr || probe.error || '').toString().split('\n')[0]).slice(0, 160) +
      '）';
  }
}

if (!bashUsable) {
  console.log('\n⚠️  SKIP bash 动态检查：' + bashResult.detail);
  console.log('   （静态检查仍全部执行；Lead 会用 escalated 权限重跑以获得 FULL PASS）');
}

function runBash(args, opts = {}) {
  const res = spawnSync(bash, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
    env: Object.assign({}, process.env, opts.env || {})
  });
  return res;
}

/* ------------------------- 3. bash -n 语法检查 ------------------------- */
test('bash -n 语法检查（全部 POSIX 脚本）', () => {
  if (!bashUsable) throw new Error('SKIP(bash 不可用: ' + bashResult.detail + ')');
  for (const f of SHELL_FILES) {
    const res = runBash(['-n', f]);
    assert(res.status === 0, f + ' 语法错误: ' + (res.stderr || res.error));
  }
});

/* ------------------------- 4. launch.sh --dry-run 分支 ------------------------- */
function dryRun(env) {
  if (!bashUsable) throw new Error('SKIP(bash 不可用)');
  const res = runBash(['launch.sh', '--dry-run'], { env });
  assert(res.status === 0, 'launch.sh --dry-run 退出码 ' + res.status + ' stderr=' + res.stderr);
  return res.stdout || '';
}
function parseKV(out) {
  const obj = {};
  out.split('\n').forEach((line) => {
    const idx = line.indexOf('=');
    if (idx > 0) obj[line.slice(0, idx)] = line.slice(idx + 1);
  });
  return obj;
}

test('dry-run Linux + 有 opener → 直接 file:// 打开', () => {
  const kv = parseKV(dryRun({ MOLEDIT_LAUNCH_OS: 'linux', MOLEDIT_LAUNCH_FORCE_OPENER: 'xdg-open' }));
  assert(kv.mode === 'file', 'mode 应为 file，实际 ' + JSON.stringify(kv));
  assert(kv.opener === 'xdg-open', 'opener 应为 xdg-open，实际 ' + kv.opener);
  assert(/index\.html$/.test(kv.open_target || ''), 'open_target 应为 index.html 路径');
});

test('dry-run macOS + 有 opener → open index.html', () => {
  const kv = parseKV(dryRun({ MOLEDIT_LAUNCH_OS: 'macos', MOLEDIT_LAUNCH_FORCE_OPENER: 'open' }));
  assert(kv.mode === 'file', 'mode 应为 file');
  assert(kv.opener === 'open', 'opener 应为 open');
});

test('dry-run Linux 无 opener → 本地服务器模式，端口/URL 正确', () => {
  const kv = parseKV(dryRun({ MOLEDIT_LAUNCH_OS: 'linux', MOLEDIT_LAUNCH_NO_OPENERS: '1', MOLEDIT_PORT: '8899' }));
  assert(kv.mode === 'server', 'mode 应为 server，实际 ' + JSON.stringify(kv));
  assert(kv.port === '8899', 'port 应来自 MOLEDIT_PORT，实际 ' + kv.port);
  assert(kv.open_target === 'http://127.0.0.1:8899/', 'open_target 错误: ' + kv.open_target);
  assert(['python3', 'python', 'node'].includes(kv.interpreter), 'interpreter 非法: ' + kv.interpreter);
});

test('dry-run --server 强制服务器模式', () => {
  if (!bashUsable) throw new Error('SKIP(bash 不可用)');
  const res = runBash(['launch.sh', '--server', '--port', '9123', '--dry-run'], {
    env: { MOLEDIT_LAUNCH_OS: 'linux', MOLEDIT_LAUNCH_FORCE_OPENER: 'xdg-open' }
  });
  assert(res.status === 0, '--server --dry-run 失败: ' + res.stderr);
  const kv = parseKV(res.stdout || '');
  assert(kv.mode === 'server', '应强制 server，实际 ' + JSON.stringify(kv));
  assert(kv.port === '9123', 'port 应为 9123');
});

/* ------------------------- 5. 桌面快捷方式 --dry-run ------------------------- */
test('create-linux-desktop-shortcut.sh --dry-run 输出合法 .desktop 内容', () => {
  if (!bashUsable) throw new Error('SKIP(bash 不可用)');
  const res = runBash(['tools/create-linux-desktop-shortcut.sh', '--dry-run']);
  assert(res.status === 0, '退出码 ' + res.status + ' stderr=' + res.stderr);
  const out = res.stdout || '';
  assert(out.includes('[Desktop Entry]'), '缺少 [Desktop Entry]');
  assert(out.includes('Type=Application'), '缺少 Type=Application');
  assert(out.includes('Exec=bash'), '缺少 Exec=bash');
  assert(out.includes('launch.sh'), 'Exec 未指向 launch.sh');
});

/* ------------------------- 6. 静态检查 - 不能有 Windows 路径 ------------------------- */
test('POSIX 脚本不含 Windows 盘符硬编码路径', () => {
  for (const f of SHELL_FILES) {
    const text = read(f);
    assert(!/[A-Za-z]:\\/.test(text), f + ' 含 Windows 盘符路径，跨平台会失败');
  }
});

/* ------------------------- 汇总 ------------------------- */
const skipped = failures.filter((f) => /SKIP/.test(f.error.message));
const realFailures = failures.filter((f) => !/SKIP/.test(f.error.message));

console.log('\n========================================');
console.log(`静态/可运行检查：通过 ${passed} / ${passed + realFailures.length}` +
  (skipped.length ? `，SKIP ${skipped.length} 项（bash 不可用）` : ''));
if (bashUsable) {
  console.log('bash: ' + bashResult.detail + ' —— FULL PASS');
} else {
  console.log('bash: SKIP（' + bashResult.detail + '）');
}
if (realFailures.length) {
  realFailures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.error && f.error.stack ? f.error.stack.split('\n')[0] : f.error)));
  process.exit(1);
}
if (skipped.length) {
  skipped.forEach((f) => console.log('  - SKIP: ' + f.name));
  process.exit(0);
}
console.log('全部通过 ✅');

