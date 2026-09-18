/* =============================================================
   tools/tests/harness.js
   -------------------------------------------------------------
   共用测试工具：真后端（apps-script/Code.gs）+ jsdom + 假 fetch。

   为什么放在 git 里（tools/tests/）：
   tools/local/ 被 gitignore，沙箱重置时整个资料夹会不见，
   测试脚本就没了。放在这里跟着版本走，重置后 git 拉回来即可。

   用法：
     const H = require('./harness');
     const h = H.create({ port: 4417 });        // 起静态服务器
     await h.seed();                            // 建资料 + 会员 + 员工
     const p = await h.open('orders.html', { auto: true });  // auto = 自动带当地 localStorage
     h.check('名字', 条件, 细节);
     h.done();
   ============================================================= */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const JSDOM_PATH = path.join(__dirname, '..', '..', 'node_modules', 'jsdom');
const { JSDOM, VirtualConsole } = require(JSDOM_PATH);
const { loadBackend } = require(path.join(__dirname, '..', 'load-backend.js'));

const REPO = path.join(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function create(opts) {
  opts = opts || {};
  const PORT = opts.port || 4417;
  const state = { pass: 0, fail: 0, log: opts.log !== false };
  const backend = loadBackend();
  const post = (a, d, t) => backend.api.doPost({ action: a, data: d || {}, token: t || '' });
  const okData = (res, label) => {
    if (!res.success) {
      console.log('  后端 ' + label + ' 失败: ' + JSON.stringify(res.error));
      return null;
    }
    return res.data;
  };

  /* ---------------- 假 fetch（可延迟 / 纪录 / 挡 action） ---------------- */
  const calls = [];
  const delays = { read: 0, write: 0, default: 0 };
  const blocked = {};          // action → 回失败（模拟旧版后端）
  const transforms = {};       // action → (payload) => payload（改写到后端的请求，模拟旧版行为）
  const READ = { getMenu: 1, getActiveOrders: 1, getPosQueue: 1, getAdminMenu: 1 };

  function fakeFetch(url, options) {
    let payload = {};
    try { payload = JSON.parse((options && options.body) || '{}'); } catch (e) {}
    const action = payload.action;
    calls.push(action);
    const run = () => {
      if (blocked[action]) {
        return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
          success: false, data: null, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action' }
        })) };
      }
      const send = transforms[action] ? transforms[action](payload) : payload;
      const res = post(action, send.data, send.token);
      return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(res)) };
    };
    let ms = delays.default;
    if (READ[action]) ms = delays.read;
    else if (action) ms = delays.write;
    if (!ms) return Promise.resolve(run());
    return new Promise((r) => setTimeout(() => r(run()), ms));
  }

  /* ---------------- 静态服务器 ---------------- */
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(REPO, p);
    if (p === '/' || p.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });

  /* ---------------- 开页面 ---------------- */
  const shared = {};                    // 跨页共用的 localStorage（模拟同一个浏览器）

  function snapshotStorage(win) {
    const out = {};
    try {
      for (let i = 0; i < win.localStorage.length; i += 1) {
        const k = win.localStorage.key(i);
        out[k] = win.localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }

  async function open(page, o) {
    o = o || {};
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
    const keys = o.storage === undefined ? shared : o.storage;   // auto = 沿用共用 storage
    const dom = await JSDOM.fromURL('http://127.0.0.1:' + PORT + '/' + page, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(win) {
        win.fetch = o.fetch || fakeFetch;
        win.scrollTo = function () {};
        win.Element.prototype.scrollIntoView = function () {};
        win.requestIdleCallback = function (fn) { return setTimeout(fn, o.idleMs === undefined ? 0 : o.idleMs); };
        win.speechSynthesis = { speaking: false, getVoices: () => [], speak: () => {}, cancel: () => {} };
        win.SpeechSynthesisUtterance = function (t) { this.text = t; };
        win.__lastGo = null;
        try {
          Object.keys(keys || {}).forEach((k) => win.localStorage.setItem(k, keys[k]));
          (o.session || []).forEach((kv) => win.sessionStorage.setItem(kv[0], kv[1]));
        } catch (e) {}
      }
    });
    const win = dom.window;
    win.addEventListener('error', (e) => errors.push(String((e && e.error && e.error.message) || e.message)));
    const pageObj = { dom, win, doc: win.document, errors };
    pageObj.save = () => { Object.assign(shared, snapshotStorage(win)); };
    if (o.wait !== 0) await sleep(o.wait === undefined ? 700 : o.wait);
    pageObj.save();
    return pageObj;
  }

  /* ---------------- 建资料 ---------------- */
  const seed = (o) => {
    o = o || {};
    backend.api.setupDatabase();
    backend.api.bootstrapOwner('owner', 'yetipsy123');
    const staff = okData(post('staffLogin', { username: 'owner', password: 'yetipsy123' }), 'staffLogin');
    const TOKEN = staff.token;
    const cat = okData(post('createCategory', { nameEN: 'Cocktails', nameZH: '鸡尾酒' }, TOKEN), 'cat');
    const p1 = okData(post('createProduct', { categoryId: cat.category.categoryId, nameEN: 'Tequila Sunsrise', nameZH: '龙舌兰日常', price: 2200 }, TOKEN), 'p1');
    const p2 = okData(post('createProduct', { categoryId: cat.category.categoryId, nameEN: 'Mojito', nameZH: '莫吉托', price: 1800 }, TOKEN), 'p2');
    const opt = okData(post('createProductOption', {
      productId: p2.product.productId, optionGroup: 'SIZE', optionGroupNameZH: '尺寸',
      nameEN: 'Large', nameZH: '大杯', priceAdjustment: 400
    }, TOKEN), 'opt');
    okData(post('createProductOption', {
      productId: p2.product.productId, optionGroup: 'SIZE', optionGroupNameZH: '尺寸',
      nameEN: 'Regular', nameZH: '标准', priceAdjustment: 0, sortOrder: 5
    }, TOKEN), 'opt2');
    backend.api.mutate(function (DB, sb) {
      sb.setSetting('ORDERING_OPEN_TIME', '00:00');
      sb.setSetting('ORDERING_CLOSE_TIME', '00:00');
    });
    const member = okData(post('customerRegister',
      { phone: '0123456789', countryCode: '+60', name: 'Jason', password: 'Passw0rd!' }), 'member');
    return {
      backend, post, okData, TOKEN, CUST: member.token, member,
      P1: p1.product.productId, P2: p2.product.productId, OPT: opt.option.optionId,
      CAT: cat.category.categoryId
    };
  };

  /** 客人下单（用来让订单 / 看板有资料） */
  function placeOrder(s, o) {
    o = o || {};
    const items = o.items || [{ productId: s.P1, quantity: 1 }];
    const q = okData(post('createCheckoutQuote',
      { items: items, orderType: o.orderType || 'COUNTER', useWallet: false }, s.CUST), 'quote');
    const p = okData(post('placeOrder',
      { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, s.CUST), 'placeOrder');
    return p.order.appOrderId;
  }

  const check = (name, ok, detail) => {
    if (ok) { state.pass += 1; if (state.log) console.log('  ✓ ' + name); }
    else {
      state.fail += 1;
      console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
    }
  };

  const done = () => {
    try { server.close(); } catch (e) {}
    console.log('\n结果：' + state.pass + ' 通过 / ' + state.fail + ' 失败');
    return state.fail === 0;
  };

  return {
    PORT, sleep, check, done, open, seed, placeOrder, post, okData, calls, delays, blocked, transforms,
    shared, snapshotStorage,
    start: () => new Promise((r) => server.listen(PORT, '127.0.0.1', r)),
    raw: backend,
    failCount: () => state.fail
  };
}

module.exports = { create, sleep, REPO };
