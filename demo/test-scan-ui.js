/* =============================================================
   demo/test-scan-ui.js
   -------------------------------------------------------------
   ★ 用 jsdom 真的把「会员条码页」与「员工扫码抵扣页」开起来，
     模拟顾客出示条码 → 员工输入/扫到条码 → 确认顾客 → 抵扣。

   为什么要有：上一轮 Service Worker 那次证明「代码看起来对」不等于
   「页面跑得起来」。这两页是新的，而且条码画不出来 / verifyToken
   没带过去这类问题，只有真的执行页面才抓得到。

   相机在 jsdom 里没有，所以走「手动输入」那条路 —— 它跟扫描
   读到字串之后走的是同一个 handleCode()。

   执行： node demo/test-scan-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3995;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 条码 / 扫码抵扣 DOM 测试（jsdom）');

const PWD = 'scan-test-123';
const PHONE = '0123456789';

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

async function openPage(JSDOM, pathname, seed) {
  const dom = await JSDOM.fromURL(BASE + pathname, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = function (input, init) {
        const url = (typeof input === 'string' && !/^[a-z]+:\/\//i.test(input))
          ? new URL(input, window.location.href).href : input;
        return globalThis.fetch(url, init);
      };
      window.__nav = [];
      if (seed) seed(window);
    }
  });
  const win = dom.window;
  const start = Date.now();
  while (!(win.API && win.UI) && Date.now() - start < 15000) await sleep(80);
  await sleep(200);
  return { dom, win, doc: win.document };
}

async function until(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 12000)) {
    if (fn()) return true;
    await sleep(80);
  }
  return false;
}

/* =============================================================
   测试
   ============================================================= */

suite.group('00 · 准备资料', async (t) => {
  await waitForServer(15000);
  global.__JSDOM = require('jsdom').JSDOM;

  const reg = await post('customerRegister', { phone: PHONE, name: 'Jason', password: PWD });
  t.okIs(reg, '注册会员');
  global.__customerToken = reg.data.token;
  global.__customerId = reg.data.customer.customerId;
  global.__customerProfile = reg.data.customer;

  const staff = await post('staffLogin', { username: 'owner', password: 'yetipsy123' });
  t.okIs(staff, '员工登入');
  global.__staffToken = staff.data.token;
  global.__staffProfile = staff.data.staff;

  /* 给钱包 RM50，不然没法抵扣 */
  const top = await post('manualWalletAdjustment',
    { customerId: global.__customerId, amount: 5000, reason: 'test' }, global.__staffToken);
  t.okIs(top, '储值 RM50');
  t.equal('钱包余额 5000 sen', top.data.customer.walletBalance, 5000);
});

suite.group('01 · 会员条码页（code.html）画得出条码', async (t) => {
  const page = await openPage(global.__JSDOM, '/code.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
  });
  const { win, doc } = page;
  global.__codePage = page;

  const drawn = await until(() => {
    const svg = doc.getElementById('barcode');
    return (svg && svg.childNodes.length > 0) ||
      (doc.getElementById('barcodeBox').textContent.indexOf('条码不可用') !== -1);
  }, 10000);
  t.check('条码区块有内容（画出来或显示备用讯息）', drawn);

  const svg = doc.getElementById('barcode');
  const hasBars = svg && svg.querySelectorAll('rect').length > 20;
  t.check('★ JsBarcode 真的画出一维条码（很多 rect）', hasBars,
    svg ? svg.querySelectorAll('rect').length + ' rects' : 'no svg');

  const qrOk = await until(() => doc.getElementById('qrBox').childNodes.length > 0, 8000);
  t.check('同内容的 QR 也画出来了（给不支援一维扫描的装置）', qrOk);

  t.equal('显示会员名字（遮罩）', doc.getElementById('memberName').textContent, 'J***',
    doc.getElementById('memberName').textContent);
  t.equal('显示 CustomerID', doc.getElementById('memberId').textContent, global.__customerId);
  t.check('有倒数计时', /\d+ 秒后更换/.test(doc.getElementById('codeTimer').textContent),
    doc.getElementById('codeTimer').textContent);

  /* 把条码内容抓出来给员工端用 */
  const code = await win.API.customer.getMemberCode();
  t.okIs(code, 'API 取得条码内容');
  global.__payload = code.data.payload;
  t.check('条码内容格式', /^YT1\|YT\d+\|[a-f0-9]{32}$/.test(code.data.payload), code.data.payload);
});

suite.group('01b · 换码不闪、不用全屏转圈（顾客要求）', async (t) => {
  const { win, doc } = global.__codePage;

  /* ① 这一页从头到尾不该出现全屏 loading 遮罩
        （UI.showLoading 是懒建立的：没呼叫过就不会有这个元素） */
  t.check('★ 页面上没有全屏 loading 遮罩',
    doc.getElementById('loadingOverlay') === null,
    doc.getElementById('loadingOverlay') ? '有遮罩元素' : '没有');

  const barsBefore = doc.querySelectorAll('#barcode rect').length;
  t.check('换码前条码已经在画面上', barsBefore > 20, barsBefore + ' rects');

  /* ② 装个计数器：换码过程若呼叫 UI.showLoading 就会被抓到 */
  let overlayCalls = 0;
  const realShow = win.UI.showLoading;
  win.UI.showLoading = function () { overlayCalls++; return realShow.apply(win.UI, arguments); };

  /* ③ 让 getMemberCode 慢一点（模拟线上 GAS），才有时间取样 */
  const realFetch = win.fetch;
  win.fetch = function (input, init) {
    const p = realFetch(input, init);
    let action = '';
    try { action = JSON.parse(init.body).action; } catch (e) { /* 忽略 */ }
    if (action !== 'getMemberCode') return p;
    return new Promise((resolve) => setTimeout(() => resolve(p), 900));
  };

  const payloadBefore = win.CODE.debugState().payload;
  doc.getElementById('refreshBtn').click();

  /* ④ 等的这段时间，旧条码必须一直在画面上（不能被清空、不能被盖住） */
  const samples = [];
  for (let i = 0; i < 7; i++) {
    await sleep(120);
    samples.push({
      bars: doc.querySelectorAll('#barcode rect').length,
      hint: doc.getElementById('codeHint').textContent,
      overlay: !!doc.getElementById('loadingOverlay')
    });
  }

  t.check('★ 等待期间旧条码一直可见（没有空白）',
    samples.every((x) => x.bars > 20), samples.map((x) => x.bars).join(','));
  t.check('★ 等待期间没有全屏遮罩', samples.every((x) => !x.overlay));
  t.equal('全程没有呼叫 UI.showLoading', overlayCalls, 0);
  t.check('等待期间条码区下方显示「更新中」',
    samples.some((x) => x.hint.indexOf('更新中') !== -1),
    samples.map((x) => x.hint).filter(Boolean).join('|') || '(空)');

  /* ⑤ 新码回来 → 直接覆盖 */
  const swapped = await until(() => win.CODE.debugState().payload !== payloadBefore, 8000);
  t.check('★ 新条码直接覆盖旧的', swapped);
  t.check('覆盖后条码还在画面上', doc.querySelectorAll('#barcode rect').length > 20);
  t.equal('更新中的小字已清掉', doc.getElementById('codeHint').textContent, '');
  t.check('倒数重新开始', /\d+ 秒后更换/.test(doc.getElementById('codeTimer').textContent),
    doc.getElementById('codeTimer').textContent);

  win.fetch = realFetch;
  win.UI.showLoading = realShow;
});

suite.group('02 · 员工扫码抵扣页（admin/redeem.html）', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/redeem.html', (w) => {
    w.localStorage.setItem('yt_staff_token', global.__staffToken);
    w.localStorage.setItem('yt_staff_profile', JSON.stringify(global.__staffProfile));
  });
  const { win, doc } = page;
  global.__redeemPage = page;

  t.check('ADMIN_REDEEM 载入了', typeof win.ADMIN_REDEEM === 'object' && !!win.ADMIN_REDEEM.init);
  t.check('jsdom 没相机时会讲清楚',
    doc.getElementById('scanSupport').textContent.indexOf('手动输入') !== -1,
    doc.getElementById('scanSupport').textContent.slice(0, 40));
  t.check('一开始停在扫描步骤',
    doc.getElementById('stepScan').style.display !== 'none' &&
    doc.getElementById('stepVerify').style.display === 'none');
});

suite.group('03 · 输入顾客条码 → 确认是本人', async (t) => {
  const { win, doc } = global.__redeemPage;

  /* 先试一条垃圾字串 */
  doc.getElementById('manualInput').value = 'hello world';
  doc.getElementById('manualBtn').click();
  await sleep(600);
  t.check('垃圾字串 → 还停在扫描步骤',
    doc.getElementById('stepVerify').style.display === 'none');

  /* 再输入真的条码内容（跟相机扫到的是同一条路） */
  doc.getElementById('manualInput').value = global.__payload;
  doc.getElementById('manualBtn').click();

  const ok = await until(() => doc.getElementById('stepVerify').style.display !== 'none', 10000);
  t.check('★ 扫到条码 → 跳到确认步骤', ok);
  t.equal('显示顾客名字', doc.getElementById('vName').textContent, 'Jason',
    doc.getElementById('vName').textContent);
  t.equal('显示 CustomerID', doc.getElementById('vId').textContent, global.__customerId);
  t.equal('显示钱包余额', doc.getElementById('vWallet').textContent, 'RM 50.00',
    doc.getElementById('vWallet').textContent);
  t.check('显示验证倒数', /验证有效 \d+ 秒/.test(doc.getElementById('vCount').textContent),
    doc.getElementById('vCount').textContent);
  t.check('抵扣区块同时打开', doc.getElementById('stepRedeem').style.display !== 'none');
});

suite.group('04 · 计算可抵扣 → 确认抵扣', async (t) => {
  const { doc } = global.__redeemPage;

  doc.getElementById('billInput').value = '60.00';
  doc.getElementById('calcBtn').click();
  const calcOk = await until(() => doc.getElementById('walletInput').value !== '', 10000);
  t.check('★ 算出可抵扣金额并自动填入', calcOk, doc.getElementById('walletInput').value);
  t.equal('账单 RM60 → 上限 20% = RM12.00', doc.getElementById('walletInput').value, '12.00');
  t.check('提示里有顾客实付', doc.getElementById('calcLine').textContent.indexOf('48.00') !== -1,
    doc.getElementById('calcLine').textContent);

  const walletBefore = (await post('getWallet', {}, global.__customerToken)).data.balance;
  t.equal('抵扣前余额 RM50', walletBefore, 5000);

  doc.getElementById('redeemBtn').click();
  const done = await until(() => doc.getElementById('stepResult').style.display !== 'none', 12000);
  t.check('★ 抵扣完成，跳到结果页', done);
  t.equal('结果显示扣掉 RM12.00', doc.getElementById('rUsed').textContent, 'RM 12.00',
    doc.getElementById('rUsed').textContent);

  const walletAfter = (await post('getWallet', {}, global.__customerToken)).data.balance;
  t.equal('钱包真的扣了 RM12 → 剩 RM38', walletAfter, 3800, walletAfter);
});

suite.group('05 · 用过一次的验证不能再用（下一位顾客要重扫）', async (t) => {
  const { doc } = global.__redeemPage;

  doc.getElementById('againBtn').click();
  await sleep(400);
  t.check('按「下一位」回到扫描步骤',
    doc.getElementById('stepScan').style.display !== 'none' &&
    doc.getElementById('stepVerify').style.display === 'none');
  t.check('账单栏已清空', doc.getElementById('billInput').value === '');

  /* 旧条码已经被用掉，再输入一次应该被拒绝 */
  doc.getElementById('manualInput').value = global.__payload;
  doc.getElementById('manualBtn').click();
  await sleep(800);
  t.check('★ 旧条码不能再用（还停在扫描步骤）',
    doc.getElementById('stepVerify').style.display === 'none');
});

suite.group('06 · 页面元素齐全（契约检查）', (t) => {
  const fs = require('fs');
  const codeHtml = fs.readFileSync(path.join(__dirname, '..', 'code.html'), 'utf8');
  const redeemHtml = fs.readFileSync(path.join(__dirname, '..', 'admin', 'redeem.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');

  ['barcode', 'qrBox', 'codeTimer', 'memberName', 'refreshBtn'].forEach((id) => {
    t.check('code.html 有 #' + id, codeHtml.indexOf('id="' + id + '"') !== -1);
  });
  ['scanVideo', 'manualInput', 'vName', 'vWallet', 'billInput', 'walletInput',
    'redeemBtn', 'stepResult'].forEach((id) => {
    t.check('redeem.html 有 #' + id, redeemHtml.indexOf('id="' + id + '"') !== -1);
  });

  t.check('code.html 有载入 jsbarcode', codeHtml.indexOf('jsbarcode.min.js') !== -1);
  t.check('redeem.html 有载入 jsQR（QR 备用）', redeemHtml.indexOf('jsQR.js') !== -1);
  ['./code.html', './js/code.js', './admin/redeem.html', './js/admin-redeem.js',
    './js/vendor/jsbarcode.min.js'].forEach((f) => {
    t.check('Service Worker 快取有 ' + f, sw.indexOf("'" + f + "'") !== -1);
  });

  /* 入口：顾客端与员工端都点得到 */
  const wallet = fs.readFileSync(path.join(__dirname, '..', 'wallet.html'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'profile.html'), 'utf8');
  const adminHome = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  const more = fs.readFileSync(path.join(__dirname, '..', 'admin', 'more.html'), 'utf8');
  t.check('钱包页有入口', wallet.indexOf('code.html') !== -1);
  t.check('我的页有入口', profile.indexOf('code.html') !== -1);
  t.check('员工首页有入口', adminHome.indexOf('redeem.html') !== -1);
  t.check('员工 MORE 有入口', more.indexOf('redeem.html') !== -1);
});

/* =============================================================
   起 server → 跑 → 收尾
   ============================================================= */

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
