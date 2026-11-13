/* MolEdit — server.mjs
 * 零依赖静态文件服务器（可选；直接双击 index.html 也能用）。
 * 运行：node server.mjs [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xyz': 'text/plain; charset=utf-8',
  '.sdf': 'text/plain; charset=utf-8',
  '.mol': 'text/plain; charset=utf-8',
  '.gjf': 'text/plain; charset=utf-8',
  '.com': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.out': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(__dirname, urlPath));
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('MolEdit 已启动: http://127.0.0.1:' + PORT + '/');
  console.log('按 Ctrl+C 停止。');
});
