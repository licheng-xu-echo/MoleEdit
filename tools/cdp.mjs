/* MolEdit — tools/cdp.mjs
 * 零依赖 Chrome DevTools Protocol 客户端（Node 24 内置 fetch + WebSocket）。
 * 前提：已有一个 headless Chrome 以 --remote-debugging-port=9222 常驻运行。
 *
 * 用法示例：
 *   import { openPage } from './cdp.mjs';
 *   const page = await openPage('file:///D:/.../index.html', { width: 1440, height: 900 });
 *   await page.waitFor('window.MolApp && window.MolApp.ready');
 *   await page.eval('MolApp.loadSample("water-xyz")');
 *   await page.screenshot('shots/water.png');
 *   console.log(page.errors); await page.close();
 */
import fs from 'node:fs';
import path from 'node:path';

export const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = 'http://127.0.0.1:' + CDP_PORT;

async function httpJson(url, method = 'GET') {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error('CDP HTTP ' + res.status + ': ' + url);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function browserVersion() {
  return httpJson(BASE + '/json/version');
}

/** 新建标签页，返回 target 对象 { id, webSocketDebuggerUrl, ... } */
export async function newTab(url = 'about:blank') {
  const encoded = encodeURIComponent(url);
  let target;
  try {
    target = await httpJson(BASE + '/json/new?' + encoded, 'PUT');
  } catch (e) {
    // 旧版 Chrome 用 GET
    target = await httpJson(BASE + '/json/new?' + encoded, 'GET');
  }
  if (typeof target === 'string') target = JSON.parse(target);
  if (!target.webSocketDebuggerUrl) throw new Error('无法创建标签页: ' + JSON.stringify(target));
  return target;
}

export async function listTabs() {
  return httpJson(BASE + '/json/list');
}

async function closeTab(id) {
  try { await httpJson(BASE + '/json/close/' + id, 'GET'); } catch { /* ignore */ }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map(); // method -> [fn]
    this.closed = false;
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message + ' (' + JSON.stringify(msg.error) + ')'));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method) {
        const fns = this.handlers.get(msg.method);
        if (fns) fns.slice().forEach((fn) => { try { fn(msg.params); } catch { /* ignore */ } });
      }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
    ws.addEventListener('error', () => {
      this.closed = true;
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function waitWsOpen(ws) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket 连接超时')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error('WebSocket 连接失败')); });
  });
}

/**
 * 打开页面并返回便捷对象。
 * options: { width=1440, height=900, deviceScaleFactor=1, url }
 */
export async function openPage(url, options = {}) {
  const width = options.width || 1440;
  const height = options.height || 900;
  const dsf = options.deviceScaleFactor || 1;
  const target = await newTab('about:blank');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitWsOpen(ws);
  const cdp = new CDP(ws);
  const errors = [];
  const consoleErrors = [];

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => {});
  await cdp.send('Network.enable').catch(() => {});
  // file:// 下浏览器可能缓存 JS，改代码后必须禁用缓存，否则会测到旧版本
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile: false
  }).catch(() => {});

  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p && p.exceptionDetails ? p.exceptionDetails : {};
    const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown exception';
    errors.push({ type: 'exception', text: String(text), url: d.url, line: d.lineNumber });
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert') {
      const text = (p.args || []).map((a) => a.value != null ? a.value : (a.description || a.type)).join(' ');
      consoleErrors.push({ type: 'console.' + p.type, text });
    }
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level === 'error') errors.push({ type: 'log', text: e.text, url: e.url });
  });

  if (url && url !== 'about:blank') {
    await cdp.send('Page.navigate', { url });
  }

  const page = {
    cdp, target, errors, consoleErrors,
    async eval(expression, opts = {}) {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: opts.awaitPromise !== false,
        returnByValue: true,
        userGesture: true
      });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        const text = (d.exception && (d.exception.description || d.exception.value)) || d.text;
        throw new Error('页面内执行出错: ' + text);
      }
      return res.result ? res.result.value : undefined;
    },
    async waitFor(expression, timeoutMs = 15000, intervalMs = 100) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        let ok = false;
        try { ok = !!(await page.eval(expression)); } catch { ok = false; }
        if (ok) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error('等待条件超时: ' + expression);
    },
    async navigate(url2) {
      await cdp.send('Page.navigate', { url: url2 });
    },
    async reload() {
      await cdp.send('Page.reload', { ignoreCache: true });
    },
    async wait(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },
    /** 截图到文件（自动创建目录）；返回文件路径 */
    async screenshot(outPath) {
      const dir = path.dirname(path.resolve(outPath));
      fs.mkdirSync(dir, { recursive: true });
      const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.resolve(outPath), Buffer.from(res.data, 'base64'));
      return path.resolve(outPath);
    },
    /** 读取 DOM 文本 */
    async text(selector) {
      return page.eval(`(function(){var e=document.querySelector(${JSON.stringify(selector)});return e?e.textContent:null;})()`);
    },
    async close() {
      cdp.close();
      await closeTab(target.id);
    }
  };
  return page;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
