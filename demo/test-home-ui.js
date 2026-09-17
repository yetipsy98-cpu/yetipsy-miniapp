/* =============================================================
   demo/test-home-ui.js
   -------------------------------------------------------------
   ★ 会员端首页（index.html）的活动区块。

   为什么要有：顾客回报「promotion 不会载出在客户端」。
   查了后端与渲染都正常之后，真正的问题是 js/app.js 把失败回应
   跟「真的没有活动」画成同一个「暂无活动」—— 错误被吞掉，
   所以「看不到活动」有两种完全不同的原因，画面上却分不出来：
     A. 后端回成功但清单是空的（活动过期 / 没有活动）
     B. 后端根本回失败（线上贴的还是旧版、没有 getPromotions
        这个 action → UNKNOWN_ACTION；或 session 失效）
   这个测试就是盯住 B 不能被伪装成 A。

   执行： node demo/test-home-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3993;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 首页活动区块 DOM 测试（jsdom）');

const PWD = 'home-test-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping', data: {}, token: '' })
      });
      if (res.ok) return;
    } catch (e) { /* 还没起来 */ }
    await sleep(120);
  }
  throw new Error('demo server 起不来：' + BASE);
}

async function post(action, data, token) {
  const res = await fetch(BASE + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {}, token: token || '' })
  });
  return res.json();
}

/**
 * 开 index.html。
 * @param {string|null} fakeAction 若指定，这个 action 会被拦下来改成失败回应
 *                                 （用来模拟「线上后端是旧版」的情况）
 * @param {object} fakeError       要回的错误
 */
async function openHome(JSDOM, seed, fakeAction, fakeError) {
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.__calls = [];
      window.fetch = function (input, init) {
        const url = (typeof input === 'string' && !/^[a-z]+:\/\//i.test(input))
          ? new URL(input, window.location.href).href : input;

        /* 拦下指定 action，回一个失败回应（模拟旧后端 / 权限问题） */
        if (fakeAction && init && init.body) {
          let body = {};
          try { body = JSON.parse(init.body); } catch (e) { /* 忽略 */ }
          window.__calls.push(body.action);
          if (body.action === fakeAction) {
            /* jsdom 没有 Response；js/api.js 只用 ok / status / text() */
            return Promise.resolve({
              ok: true,
              status: 200,
              text: function () {
                return Promise.resolve(JSON.stringify(
                  { success: false, data: null, error: fakeError }));
              }
            });
          }
        }
        return globalThis.fetch(url, init);
      };
      if (seed) seed(window);
    }
  });
  const win = dom.window;
  const start = Date.now();
  while (!(win.API && win.UI) && Date.now() - start < 15000) await sleep(80);
  await sleep(600);
  return { dom, win, doc: win.document };
}

async function until(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 10000)) {
    if (fn()) return true;
    await sleep(80);
  }
  return false;
}

/* =============================================================
   测试
   ============================================================= */

suite.group('00 · 准备会员', async (t) => {
  await waitForServer(15000);
  global.__JSDOM = require('jsdom').JSDOM;

  const reg = await post('customerRegister', { phone: '0123456789', name: 'Jason', password: PWD });
  t.okIs(reg, '注册会员');
  global.__token = reg.data.token;
  global.__profile = reg.data.customer;

  const promos = await post('getPromotions', {}, reg.data.token);
  t.okIs(promos, '后端 getPromotions 正常');
  t.check('后端确实有活动可回传', promos.data.promotions.length >= 2,
    promos.data.promotions.length);
});

suite.group('01 · 后端有活动 → 首页要画出来', async (t) => {
  const { doc } = await openHome(global.__JSDOM, (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  });

  const ok = await until(() => doc.querySelectorAll('.promo').length > 0, 10000);
  t.check('★ 活动画出来了', ok, doc.querySelectorAll('.promo').length + ' 个 .promo');
  t.check('不是「暂无活动」',
    doc.getElementById('promoList').textContent.indexOf('暂无活动') === -1);
  t.check('有活动标题', doc.querySelectorAll('.promo-title').length > 0);
});

suite.group('02 · 后端回失败 → 不能伪装成「暂无活动」', async (t) => {
  /* 这就是顾客线上最可能的情况：贴的还是旧版后端，没有 getPromotions */
  const { doc, win } = await openHome(global.__JSDOM, (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  }, 'getPromotions', {
    code: 'UNKNOWN_ACTION',
    message: 'Unknown action. / 没有这个功能。'
  });

  const box = doc.getElementById('promoList');
  const settled = await until(() => box.textContent.trim().length > 0, 10000);
  t.check('活动区块有内容', settled);

  t.check('★ 不能再显示「暂无活动」（那会把故障说成没活动）',
    box.textContent.indexOf('暂无活动') === -1, box.textContent.slice(0, 60));
  t.check('★ 要讲出是载入失败', /载入失败|LOAD FAILED|无法载入/i.test(box.textContent),
    box.textContent.slice(0, 80));
  t.check('要显示错误码，方便回报', box.textContent.indexOf('UNKNOWN_ACTION') !== -1,
    box.textContent.slice(0, 120));
  t.check('确实呼叫过 getPromotions', win.__calls.indexOf('getPromotions') !== -1,
    win.__calls.join(','));
});

suite.group('03 · session 失效也一样要讲清楚', async (t) => {
  const { doc } = await openHome(global.__JSDOM, (w) => {
    w.localStorage.setItem('yt_customer_token', 'expired-token-000');
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  });

  /* session 失效时 getProfile 会先失败 → 应该跳登录，不是显示「暂无活动」 */
  const ok = await until(() => {
    const box = doc.getElementById('promoList');
    return box.textContent.indexOf('暂无活动') === -1;
  }, 8000);
  t.check('session 失效不会变成「暂无活动」', ok,
    doc.getElementById('promoList').textContent.slice(0, 60));
});

/* =============================================================
   起 server → 跑 → 收尾
   ============================================================= */

/* =============================================================
   04 · 2.0 会员端导览界面（登入后的第一个画面）
   ============================================================= */

suite.group('04 · 导览界面三张卡与右上角认领入口', async (t) => {
  const { win, doc } = await openHome(global.__JSDOM, (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  });

  /* 页面本身要跑得起来（不能一开就抛错） */
  t.check('页面载入且 API 可用', !!win.API);
  t.check('APP 模组存在', !!win.APP);

  /* 三张导览卡 */
  const cards = doc.querySelectorAll('.nav-grid .nav-card');
  t.equal('★ 导览界面有三张卡', cards.length, 3);

  const hrefs = Array.prototype.map.call(cards, (c) => c.getAttribute('href'));
  t.equal('★ 第一张是酒单', hrefs[0], 'menu.html');
  t.equal('★ 第二张是会员码', hrefs[1], 'code.html');
  t.equal('★ 第三张是会员中心', hrefs[2], 'profile.html');

  /* 图标真的渲染出来了（不是空的 span） */
  ['navMenu', 'navCode', 'navProfile'].forEach((id) => {
    const node = doc.getElementById(id);
    t.check('★ ' + id + ' 有图标', !!node && node.innerHTML.indexOf('svg') >= 0,
      node ? node.innerHTML.slice(0, 40) : '(元素不存在)');
  });

  /* 认领入口在右上角，不是页面中间的大 CTA */
  const topClaim = doc.getElementById('topClaimLink');
  t.check('★ 右上角有认领入口', !!topClaim);
  t.equal('★ 认领入口连到 claim.html', topClaim.getAttribute('href'), 'claim.html');
  t.check('★ 认领入口有图标',
    doc.getElementById('claimIcon').innerHTML.indexOf('svg') >= 0);
  /* 页面中间那个大 CTA 已经移除 */
  t.equal('★ 页面中间的大 CTA 已移除', doc.querySelectorAll('.cta-claim').length, 0);

  /* 原本的功能保留在下方 */
  ['wallet.html', 'activity.html', 'orders.html', 'profile.html'].forEach((href) => {
    t.check('★ 下方仍有 ' + href + ' 入口',
      !!doc.querySelector('.quick-grid a[href="' + href + '"]'));
  });
  ['qiOrders', 'qiAct', 'qiWallet', 'qiProfile'].forEach((id) => {
    const node = doc.getElementById(id);
    t.check('★ ' + id + ' 有图标', !!node && node.innerHTML.indexOf('svg') >= 0);
  });

  /* 底部导航：首页 / 酒单 / 会员码 / 会员中心 */
  const nav = doc.querySelectorAll('.bottom-nav .nav-item');
  t.equal('★ 底部导航 4 格', nav.length, 4);
  const navHrefs = Array.prototype.map.call(nav, (a) => a.getAttribute('href'));
  t.equal('底部导航含酒单', navHrefs.indexOf('menu.html') >= 0, true);
  t.equal('★ 底部导航含会员码', navHrefs.indexOf('code.html') >= 0, true);
  t.equal('★ 底部导航含会员中心', navHrefs.indexOf('profile.html') >= 0, true);
  t.equal('★ 底部导航不再有钱包那一格', navHrefs.indexOf('wallet.html') >= 0, false);

  /* 会员数字照常显示（改版没弄坏 hero） */
  t.check('★ hero 卡还在', !!doc.getElementById('heroCard'));
  t.check('积分有渲染', doc.getElementById('pointsValue').textContent.length > 0);
});

const server = spawn(process.execPath,
  [path.join(__dirname, 'server.js'), '--port', String(PORT), '--reset'],
  { cwd: path.join(__dirname, '..') });

/* harness 的 run() 回传 boolean：true = 全过 */
suite.run().then((pass) => {
  server.kill('SIGKILL');
  process.exit(pass ? 0 : 1);
}).catch((e) => {
  console.error('测试执行失败：', e && e.stack ? e.stack : e);
  server.kill('SIGKILL');
  process.exit(1);
});
