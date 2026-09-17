/* =============================================================
   demo/server.js
   -------------------------------------------------------------
   本机演示服务器（RM0，不需要 Google 账号）。

     node demo/server.js            → http://localhost:3000/
     node demo/server.js --port 4000
     node demo/server.js --reset    → 清掉 demo/demo-data.json 重新开始

   它做的事情：
     1. 静态伺服这个 repo（会员端 + 员工端）
     2. 把 POST /api 交给「真正的 apps-script 后端」处理
        （用 demo/google-shim.js 模拟 Google Sheets）
     3. 伺服 js/config.js 时把 API_URL 换成空字串 → 前端进入 DEMO 模式
        这样 repo 里的 config.js 可以一直保持线上 URL，不用为了试用改来改去

   资料存在 demo/demo-data.json（已在 .gitignore），删掉即重置。
   ============================================================= */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('./load-backend');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(__dirname, 'demo-data.json');

const args = process.argv.slice(2);
const PORT = Number((args.indexOf('--port') !== -1 ? args[args.indexOf('--port') + 1] : '') || process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const RESET = args.indexOf('--reset') !== -1;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

/* -------------------------------------------------------------
   启动后端
   ------------------------------------------------------------- */

if (RESET && fs.existsSync(DATA_FILE)) {
  fs.unlinkSync(DATA_FILE);
  console.log('[demo] 已删除 demo/demo-data.json（资料重置）');
}

const loaded = loadBackend();
const { api, shim } = loaded;

/* 第一次执行：建立资料表 + 三个员工账号（密码都是 yetipsy123） */
function bootstrap() {
  if (shim.loadFrom(DATA_FILE)) {
    console.log('[demo] 载入既有资料 ' + DATA_FILE);
    return;
  }
  api.setupDatabase();
  const owner = api.bootstrapOwner('owner', 'yetipsy123');
  const ownerToken = api.doPost({
    action: 'staffLogin', data: { username: 'owner', password: 'yetipsy123' }, token: ''
  }).data.token;

  [['manager', 'MANAGER'], ['staff', 'STAFF']].forEach((pair) => {
    api.doPost({
      action: 'createStaff',
      data: { username: pair[0], password: 'yetipsy123', role: pair[1] },
      token: ownerToken
    });
  });

  /* 2.0：播一份示范酒单（只在 Products 是空的时候，不会覆盖既有菜单） */
  try {
    api.mutate((DB, sb) => sb.seedDemoMenu());
  } catch (e) {
    console.log('[demo] 示范酒单未建立：' + (e && e.message));
  }

  persist();
  console.log('[demo] 已建立资料表与员工账号 owner / manager / staff（密码 yetipsy123）');
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { shim.saveTo(DATA_FILE); } catch (e) { console.warn('[demo] 存档失败', e.message); }
  }, 80);
}

/* -------------------------------------------------------------
   HTTP
   ------------------------------------------------------------- */

function patchConfigForDemo(source) {
  return source
    .replace(/API_URL:\s*'[^']*'/, "API_URL: ''")
    .replace(/REQUIRE_BACKEND:\s*(true|false)/, 'REQUIRE_BACKEND: false')
    .replace(/ENVIRONMENT:\s*'[^']*'/, "ENVIRONMENT: 'demo'");
}

/*
 * ★ 请求路径要能容忍畸形输入。
 * `new URL('//', base)` 会抛错（`//` 被当成 protocol-relative URL），
 * 而请求处理器里一个没接住的例外会把整个服务器进程杀掉 ——
 * 代理转发、路径拼接不当、或有人手动请求 `//foo` 都会让 demo 直接死掉。
 */
function safePathname(rawUrl) {
  let raw = String(rawUrl || '/');
  /* 把重复的斜线压成一个，并保证以 / 开头 */
  raw = raw.replace(/^([a-z][a-z0-9+.-]*:)?\/\//i, '/');
  while (raw.indexOf('//') !== -1) raw = raw.replace('//', '/');
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  try {
    return decodeURIComponent(new URL(raw, 'http://localhost').pathname);
  } catch (e) {
    return '/';
  }
}

const server = http.createServer((req, res) => {
  /* 任何一个坏请求都只回 400，不能把服务器带走 */
  try {
    return handleRequest(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('400 bad request: ' + e.message);
    return undefined;
  }
});

function handleRequest(req, res) {
  let pathname = safePathname(req.url);

  /* ---- API ---- */
  if (pathname === '/api' || pathname === '/api/') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let result;
      try {
        result = api.doPost(body || '{}');
      } catch (e) {
        result = { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: e.message } };
      }
      persist();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  /* ---- 静态档案 ---- */
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 not found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let payload = buffer;
    if (pathname.endsWith('js/config.js')) {
      payload = Buffer.from(patchConfigForDemo(buffer.toString('utf8')), 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(payload);
  });
}

/*
 * 最后一道防护：就算有没接住的异步例外，也只记一笔不要整个死掉。
 * demo 服务器死掉的话，手机上的页面就全部 404，很难查。
 */
process.on('uncaughtException', (e) => {
  console.error('[demo] 未接住的例外（已忽略，服务器继续跑）：', e && e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[demo] 未处理的 Promise（已忽略）：', e && e.message);
});

bootstrap();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  YETIPSY MINI APP · DEMO SERVER');
  console.log('  会员端  http://' + shown + ':' + PORT + '/');
  console.log('  员工端  http://' + shown + ':' + PORT + '/admin/login.html');
  console.log('  API     POST http://' + shown + ':' + PORT + '/api');
  console.log('  员工账号 owner / manager / staff · 密码 yetipsy123');
  console.log('  资料档  demo/demo-data.json（--reset 可重置）');
  console.log('');
  console.log('  注意：这是本机 DEMO。线上版请看 DEPLOYMENT.md。');
  console.log('');
});

process.on('SIGINT', () => {
  try { shim.saveTo(DATA_FILE); } catch (e) {}
  console.log('\n[demo] bye');
  process.exit(0);
});
