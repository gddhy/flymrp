/* ============================================================================
 * flymrp · 飞牛 fnOS 应用服务端（零依赖，Node 内置模块）
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 flymrp contributors
 *
 * 职责：
 *  1. 托管 app/www 静态资源（彻底禁缓存 + 版本指纹）
 *  2. 统一网关接入：Unix Socket + 前缀剥离 + 无尾斜杠 302
 *  3. /api/open-file  读取 NAS 中已授权的 MRP 文件
 *  4. /api/save-file  把截图等产物写入用户授权的 NAS 目录
 *  5. /api/health     版本指纹（配合前端自刷新）
 * 日志只走 stdout/stderr（由 cmd/main 重定向到 info.log），禁止自写日志文件。
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW_ROOT = path.join(__dirname, '..', 'www');
const PORT = Number(process.env.PORT || 8099);
const SOCKET_PATH = process.env.SOCKET_PATH || '';
const DISABLE_TCP = process.env.VMRP_DISABLE_TCP === '1';
const DATA_SHARE_DIRS = String(process.env.TRIM_DATA_SHARE_PATHS || '')
  .split(':').map(s => s.trim()).filter(Boolean);
// 本地调试白名单（仅开发机使用，设备上不会设置）：分号分隔的额外目录前缀
// （Windows 盘符 C:/ 含冒号，不能用 ':' 作分隔符）
const EXTRA_ROOTS = String(process.env.FLYMRP_EXTRA_ROOTS || '')
  .split(';').map(s => s.trim()).filter(Boolean);

/* ---------------- 网关前缀（含 MSYS 路径转换容错） ---------------- */

function normalizeGatewayPrefix(raw) {
  if (!raw) return '/app/flymrp';
  const m = String(raw).trim().match(/(\/app\/[A-Za-z0-9_\-]+)\/?$/);
  if (m) return m[1];
  let s = String(raw).trim();
  if (s[0] !== '/') s = '/' + s;
  return s.replace(/\/+$/, '');
}
const GATEWAY_PREFIX = normalizeGatewayPrefix(process.env.GATEWAY_PREFIX);

function log(msg) { console.log(`[flymrp] ${new Date().toISOString()} - ${msg}`); }

/* ---------------- 版本指纹 ---------------- */

const WWW_STAMP = (function () {
  const names = ['main.html', 'player.js', 'fnos.js', 'vendor/trimjs-web-app.js'];
  let acc = '';
  for (const n of names) {
    try {
      const st = fs.statSync(path.join(WWW_ROOT, n));
      acc += n + ':' + st.size.toString(16) + ':' + Math.floor(st.mtimeMs).toString(16) + ';';
    } catch (e) { acc += n + ':missing;'; }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < acc.length; i++) { h ^= acc.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16);
})();

/* ---------------- 工具 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.dat': 'application/octet-stream',
  '.sys': 'application/octet-stream',
  '.mrp': 'application/octet-stream',
  '.uni': 'application/octet-stream',
  '.unf': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.uc2': 'application/octet-stream',
  '.adl': 'application/octet-stream',
  '.res': 'application/octet-stream',
  '.mid': 'audio/midi',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip'
};

const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0';

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': NO_STORE
  });
  res.end(body);
}

/** NAS 路径白名单：/vol 开头的盘符目录、应用数据共享目录或调试白名单。拒绝穿越。 */
function sanitizeNasPath(p) {
  if (typeof p !== 'string' || !p) return null;
  let cand = p;
  // 兜底：某些链路上来的值尚未解码（先按原样判断，失败再解一次）
  const tryNorm = (s) => {
    if (typeof s !== 'string' || !s) return null;
    const n = path.normalize(s).replace(/\\/g, '/');
    const segs = n.split('/');
    if (segs.some(seg => seg === '..')) return null;
    if (/^\/vol\d+\//.test(n)) return n;
    if (DATA_SHARE_DIRS.some(dir => n === dir || n.startsWith(dir + '/'))) return n;
    if (EXTRA_ROOTS.some(dir => {
      const d = path.normalize(dir).replace(/\\/g, '/').replace(/\/+$/, '');
      return n === d || n.startsWith(d + '/');
    })) return n;
    return null;
  };
  let ok = tryNorm(cand);
  if (ok) return ok;
  try { cand = decodeURIComponent(cand); } catch (e) { return null; }
  return tryNorm(cand);
}

const MAX_OPEN_BYTES = 64 * 1024 * 1024;   // MRP 上限
const MAX_SAVE_BYTES = 32 * 1024 * 1024;   // 截图等产物上限

/* ---------------- API 处理 ---------------- */

function handleOpenFile(req, res, query) {
  const p = sanitizeNasPath(query.get('path'));
  if (!p) return sendJson(res, 400, { ok: false, error: '路径不合法或不在授权范围内' });
  let st;
  try { st = fs.statSync(p); } catch (e) {
    return sendJson(res, 404, { ok: false, error: '文件不存在: ' + path.posix.basename(p) });
  }
  if (!st.isFile()) return sendJson(res, 400, { ok: false, error: '不是普通文件' });
  if (st.size > MAX_OPEN_BYTES) return sendJson(res, 413, { ok: false, error: '文件过大（超过 64 MB）' });
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': NO_STORE,
    'X-File-Name': encodeURIComponent(path.posix.basename(p))
  });
  const stream = fs.createReadStream(p);
  stream.on('error', () => { try { res.destroy(); } catch (e) { /* 忽略 */ } });
  stream.pipe(res);
}

function handleSaveFile(req, res) {
  let chunks = [], size = 0, aborted = false;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_SAVE_BYTES) { aborted = true; sendJson(res, 413, { ok: false, error: '数据过大' }); req.destroy(); }
    else chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch (e) { return sendJson(res, 400, { ok: false, error: 'JSON 解析失败' }); }
    const dir = sanitizeNasPath(body.dir);
    const name = typeof body.name === 'string' ? path.posix.basename(body.name) : '';
    if (!dir) return sendJson(res, 400, { ok: false, error: '目录不合法或不在授权范围内' });
    if (!name || /^\.+$/.test(name)) return sendJson(res, 400, { ok: false, error: '文件名不合法' });
    if (typeof body.data !== 'string') return sendJson(res, 400, { ok: false, error: '缺少 data' });
    let buf;
    try { buf = Buffer.from(body.data, 'base64'); }
    catch (e) { return sendJson(res, 400, { ok: false, error: 'base64 解码失败' }); }
    if (!buf.length) return sendJson(res, 400, { ok: false, error: '内容为空' });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, name);
      fs.writeFileSync(target, buf);
      log(`saved ${target} (${buf.length} bytes)`);
      sendJson(res, 200, { ok: true, path: target, bytes: buf.length });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: '写入失败: ' + (e.code || e.message) });
    }
  });
}

/* ---------------- 静态资源 ---------------- */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/main.html';
  const target = path.normalize(path.join(WWW_ROOT, rel));
  if (!target.startsWith(WWW_ROOT + path.sep) && target !== WWW_ROOT) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }
  let st;
  try { st = fs.statSync(target); } catch (e) { return sendJson(res, 404, { ok: false, error: 'not found' }); }
  if (st.isDirectory()) {
    return serveStatic(req, res, pathname.replace(/\/$/, '') + '/main.html');
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': NO_STORE,
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"'
  });
  res.flushHeaders();
  const stream = fs.createReadStream(target);
  stream.on('error', () => { try { res.destroy(); } catch (e) { /* 忽略 */ } });
  stream.pipe(res);
}

/* ---------------- 路由 ---------------- */

function stripGatewayPrefix(p) {
  if (!GATEWAY_PREFIX) return p;
  if (p === GATEWAY_PREFIX || p === GATEWAY_PREFIX + '/') return '/';
  return p.indexOf(GATEWAY_PREFIX + '/') === 0 ? p.slice(GATEWAY_PREFIX.length) : p;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rawPathname = url.pathname;
  // 无尾斜杠 302（用剥离前的原始 pathname 判断）
  if (rawPathname === GATEWAY_PREFIX) {
    res.writeHead(302, { 'Location': GATEWAY_PREFIX + '/' + (url.search || ''), 'Cache-Control': NO_STORE });
    return res.end();
  }
  const pathname = stripGatewayPrefix(rawPathname);

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, wwwStamp: WWW_STAMP, version: '1.0.0', gatewayPrefix: GATEWAY_PREFIX });
  }
  if (pathname === '/api/open-file' && req.method === 'GET') {
    return handleOpenFile(req, res, url.searchParams);
  }
  if (pathname === '/api/save-file' && req.method === 'POST') {
    return handleSaveFile(req, res);
  }
  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, error: 'unknown api' });
  }
  serveStatic(req, res, pathname);
});

/* ---------------- 监听（socket 错误不吞原因） ---------------- */

let socketListenError = null;
server.on('error', (e) => {
  const code = (e && e.code) || '';
  if (SOCKET_PATH && (code === 'EACCES' || code === 'EADDRINUSE' || code === 'ENOENT')) {
    socketListenError = code + ' ' + e.message;
    log(`网关 socket 监听失败: ${socketListenError}`);
    if (code === 'EACCES') log(`原因: 无权在 ${path.dirname(SOCKET_PATH)} 创建 socket`);
    if (code === 'EADDRINUSE') log('原因: socket 被占用, 可能旧进程未退出');
    return;                                  // 不退出，交给延迟就绪自检判定
  }
  log(`服务异常: ${code} ${e.message}`);
  process.exit(1);
});

if (SOCKET_PATH) {
  try { if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH); } catch (e) { /* 忽略 */ }
  server.listen(SOCKET_PATH, () => {
    try { fs.chmodSync(SOCKET_PATH, 0o777); } catch (e) { /* 网关可能以其他用户连接 */ }
    log(`unix socket: ${SOCKET_PATH} (prefix ${GATEWAY_PREFIX}, stamp ${WWW_STAMP})`);
  });
  // 延迟就绪自检：socket 没创建成功就明确失败
  setTimeout(() => {
    if (fs.existsSync(SOCKET_PATH)) return;
    log(`致命错误: 网关 socket 未创建成功 (${SOCKET_PATH})` +
      (socketListenError ? ` 原因: ${socketListenError}` : ''));
    process.exit(1);
  }, 2000);
}

if (!SOCKET_PATH || !DISABLE_TCP) {
  server.listen(PORT, '0.0.0.0', () => {
    log(`tcp http://0.0.0.0:${PORT}${GATEWAY_PREFIX}/ (本地调试; stamp ${WWW_STAMP})`);
  });
}
