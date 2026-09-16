/* =============================================================
   demo/e2e-ui.js
   -------------------------------------------------------------
   端到端测试：真的把 demo/server.js 起起来，用 HTTP 走完
   「员工建立 Claim → 顾客注册 → 认领 → 打开奖励 → 钱包抵扣」，
   并且验证同一个号码用不同写法登录不会重复注册。

   执行： node demo/e2e-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3999;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 端到端 HTTP 测试（demo/server.js + apps-script）');

async function post(action, data, token) {
  const res = await fetch(BASE + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 和 js/api.js 一样，避免 CORS 预检
    body: JSON.stringify({ action: action, data: data || {}, token: token || '' })
  });
  return res.json();
}

async function get(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
}

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping', data: {}, token: '' })
      });
      if (res.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

(async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--port', String(PORT), '--reset'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  const up = await waitForServer(15000);

  /* --------------------------------------------------------- */
  suite.group('00 · 服务器', (t) => {
    t.check('demo server 有回应', up, serverLog.slice(0, 400));
  });

  if (up) {
    /* --------------------------------------------------------- */
    suite.group('01 · 静态页面（GitHub Pages 会伺服的这些档案）', async (t) => {
      const pages = ['/', '/login.html', '/claim.html', '/wallet.html', '/activity.html',
        '/profile.html', '/reward.html', '/admin/login.html', '/js/config.js', '/css/app.css'];
      for (const p of pages) {
        const r = await get(p);
        t.equal('GET ' + p + ' → 200', r.status, 200);
      }
      const cfg = await get('/js/config.js');
      t.check('DEMO 服务器把 API_URL 换成空字串', /API_URL:\s*''/.test(cfg.text));
      t.check('DEMO 服务器关掉 REQUIRE_BACKEND', /REQUIRE_BACKEND:\s*false/.test(cfg.text));
      const home = await get('/');
      t.check('首页是正式版（载入 js/app.js）', /js\/app\.js/.test(home.text));
      t.check('首页不含 MOCK_BACKEND（不是离线 demo 档）', !/MOCK_BACKEND/.test(home.text));
    });

    /* --------------------------------------------------------- */
    suite.group('02 · 系统状态', async (t) => {
      const ping = await post('ping');
      t.okIs(ping, 'ping');
      t.equal('后端是 Google Apps Script', ping.data.backend, 'GOOGLE_APPS_SCRIPT');
      t.equal('储存是 Google Sheets', ping.data.storage, 'GOOGLE_SHEETS');
      t.equal('不是 DEMO 模式', ping.data.mode, 'PRODUCTION');
    });

    /* --------------------------------------------------------- */
    suite.group('03 · 员工建立 Claim', async (t) => {
      const login = await post('staffLogin', { username: 'staff', password: 'yetipsy123' });
      t.okIs(login, '员工登录');
      const token = login.data.token;

      const made = await post('createClaim',
        { source: 'FOODCOURT', externalOrderId: 'FC8231', amount: 8600 }, token);
      t.okIs(made, '建立 Claim');
      t.equal('金额 RM86.00', made.data.amount, 8600);
      global.__claim = made.data;
      global.__staffToken = token;
    });

    /* --------------------------------------------------------- */
    suite.group('04 · ★ 顾客注册（同一个号码不会重复注册）', async (t) => {
      const a = await post('customerLogin', { phone: '0123456789', name: 'Jason' });
      const b = await post('customerLogin', { phone: '+60 12-345 6789' });
      const c = await post('customerLogin', { phone: '60123456789' });

      t.okIs(a, '第一次注册');
      t.equal('isNewCustomer = true', a.data.isNewCustomer, true);
      t.equal('第二次是旧会员', b.data.isNewCustomer, false);
      t.equal('三次都是同一个 CustomerID ★',
        [a, b, c].map((r) => r.data.customer.customerId).filter((v, i, arr) => arr.indexOf(v) === i).length, 1);
      t.equal('电话统一为 E.164', a.data.customer.phone, '+60123456789');
      global.__customerToken = a.data.token;
      global.__customerId = a.data.customer.customerId;
    });

    /* --------------------------------------------------------- */
    suite.group('05 · 认领 → 奖励 → 钱包抵扣', async (t) => {
      const ct = global.__customerToken;

      const scan = await post('getClaimByToken', { token: global.__claim.token }, ct);
      t.okIs(scan, '扫 QR');

      const claimed = await post('claimOrder', { token: global.__claim.token }, ct);
      t.okIs(claimed, '认领成功');
      t.equal('得到 86 分', claimed.data.pointsEarned, 86);
      t.errorIs(await post('claimOrder', { token: global.__claim.token }, ct),
        'CLAIM_ALREADY_USED', '重复认领被拒绝');

      const pending = await post('getPendingReward', {}, ct);
      t.check('有奖励可打开', !!(pending.data && pending.data.reward));
      const opened = await post('claimReward', { rewardId: pending.data.reward.rewardId }, ct);
      t.okIs(opened, '打开奖励');
      t.check('奖励进入钱包', opened.data.walletBalance > 0);

      /* 员工加 RM50 再抵扣 */
      const ownerToken = (await post('staffLogin', { username: 'owner', password: 'yetipsy123' })).data.token;
      await post('manualWalletAdjustment',
        { customerId: global.__customerId, amount: 5000, reason: 'e2e' }, ownerToken);

      const calc = await post('calculateWalletRedemption',
        { customerId: global.__customerId, billAmount: 6000 }, global.__staffToken);
      t.okIs(calc, '计算抵扣');
      t.equal('上限 = 20% = RM12.00', calc.data.capAmount, 1200);

      const redeem = await post('redeemWallet', {
        customerId: global.__customerId,
        billAmount: 6000,
        walletAmount: calc.data.usableAmount,
        source: 'FOODCOURT',
        externalOrderId: 'FC9001'
      }, global.__staffToken);
      t.okIs(redeem, '员工确认抵扣');
      t.equal('顾客实付 RM48.00', redeem.data.customerPays, 4800);
      t.equal('积分按实付计算 = 48', redeem.data.pointsEarned, 48);
    });

    /* --------------------------------------------------------- */
    suite.group('06 · 员工端看到这位会员', async (t) => {
      const search = await post('searchCustomer', { keyword: '0123456789' }, global.__staffToken);
      t.okIs(search, '搜索会员');
      t.equal('搜到 1 位（不是 3 位）★', search.data.customers.length, 1);
      const dash = await post('getDashboard', {}, global.__staffToken);
      t.okIs(dash, 'Dashboard');
      t.equal('今日新会员 1', dash.data.newMembers, 1);
      t.check('今日营业额 > 0', dash.data.sales > 0, dash.data.sales);
    });
  }

  /* 先跑完所有测试，再关服务器（suite.group 只是登记，真正执行在 run()） */
  const pass = await suite.run();
  server.kill('SIGKILL');
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('e2e failed:', e);
  process.exit(1);
});
