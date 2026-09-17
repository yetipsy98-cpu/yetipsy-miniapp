/* =============================================================
   demo/test-order-ui.js
   -------------------------------------------------------------
   ★ 用 jsdom 真的把「结帐页 / 订单追踪页 / 我的订单 / 员工看板」开起来跑。

   为什么要有：1.2 那次 Service Worker 的教训 ——「后端测试通过」
   不等于「页面跑得起来」。这几页涉及金额显示、钱包勾选、
   报价倒数、看板三栏与轮询，只有真的执行页面才抓得到问题。

   重点验：
     · 结帐页显示的每个金额都来自后端 Quote（§41/§42）
     · Quote 过期会自己重新报价（§43）
     · 下单只送一次，按钮按完锁死（§44）
     · 订单页的进度与等待计时（§17 §49）
     · 看板三栏、声音 MUTE、暂停接单（§19 §48 §65）

   执行： node demo/test-order-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3997;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 2.0 结帐与看板页面 DOM 测试（jsdom）');

const PWD = 'order-test-123';
const PHONE = '0129876543';

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
      /* jsdom 没有 AudioContext，看板响铃要能优雅降级（§48） */
      window.AudioContext = undefined;
      window.__nav = [];
      if (seed) seed(window);
    }
  });
  const win = dom.window;
  const start = Date.now();
  while (!(win.API && win.UI) && Date.now() - start < 15000) await sleep(80);
  await sleep(220);
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
  global.__token = reg.data.token;
  global.__profile = reg.data.customer;
  global.__customerId = reg.data.customer.customerId;

  const staff = await post('staffLogin', { username: 'owner', password: 'yetipsy123' });
  t.okIs(staff, '员工登入');
  global.__staffToken = staff.data.token;
  global.__staffProfile = staff.data.staff;

  /* 营业时间放开，否则白天跑测试会被 ORDERING_CLOSED 挡 */
  t.okIs(await post('updateSetting',
    { key: 'ORDERING_OPEN_TIME', value: '00:00' }, global.__staffToken), '放开开始时间');
  t.okIs(await post('updateSetting',
    { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, global.__staffToken), '放开结束时间');

  /* 钱包 RM8.68（§84 的那一笔） */
  t.okIs(await post('manualWalletAdjustment',
    { customerId: global.__customerId, amount: 868, reason: 'test' }, global.__staffToken),
    '存入钱包 RM8.68');

  const menu = await post('getMenu', {}, global.__token);
  t.okIs(menu, 'getMenu 成功');
  global.__menu = menu.data;
  global.__mojito = menu.data.products.find((p) => p.nameEN === 'Mojito');
  global.__longIsland = menu.data.products.find((p) => p.nameEN === 'Long Island Iced Tea');
  t.check('找得到 Mojito 与 Long Island', !!global.__mojito && !!global.__longIsland);

  /* Mojito 有必选规格 SIZE，购物车要带上 */
  const opts = menu.data.optionsByProduct[global.__mojito.productId] || [];
  const size = opts.filter((o) => o.optionGroup === 'SIZE')[0];
  t.check('Mojito 有 SIZE 规格', !!size);
  global.__sizeOption = size;
});

/* -------------------------------------------------------------
   01 · 空购物车的结帐页不能崩
   ------------------------------------------------------------- */
suite.group('01 · checkout.html 空车状态', async (t) => {
  const page = await openPage(global.__JSDOM, '/checkout.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  });
  const { win, doc } = page;

  const shown = await until(() =>
    (doc.getElementById('checkoutBody').textContent || '').indexOf('购物车是空的') !== -1, 12000);
  t.check('★ 空车时说明清楚，不是白页', shown,
    doc.getElementById('checkoutBody').textContent.slice(0, 60));
  t.check('给一个回酒单的按钮',
    doc.getElementById('checkoutBody').innerHTML.indexOf('menu.html') !== -1);
  t.equal('CTA 隐藏', doc.getElementById('stickyCta').style.display, 'none');
  t.equal('没有产生 Quote', win.CHECKOUT.debugState().hasQuote, false);
});

/* -------------------------------------------------------------
   02 · §84 那一车：结帐页显示后端算出来的金额
   ------------------------------------------------------------- */
suite.group('02 · checkout.html 显示后端报价（§41 §42 §43）', async (t) => {
  const cart = [
    {
      lineId: 'L1', productId: global.__mojito.productId,
      nameEN: 'Mojito', nameZH: '经典莫希托', unitPrice: 2200, quantity: 2,
      options: [{
        optionGroup: 'SIZE', optionId: global.__sizeOption.optionId,
        nameEN: global.__sizeOption.nameEN, nameZH: global.__sizeOption.nameZH
      }],
      note: '', addedAt: Date.now()
    },
    {
      lineId: 'L2', productId: global.__longIsland.productId,
      nameEN: 'Long Island Iced Tea', nameZH: '长岛冰茶', unitPrice: 2800, quantity: 1,
      options: [], note: 'Less ice please', addedAt: Date.now()
    }
  ];
  global.__cart = cart;

  /* §12 桌牌 QR：?table=A12 自动带入桌号，顾客不用重打 */
  const page = await openPage(global.__JSDOM, '/checkout.html?table=A12', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    w.localStorage.setItem('yt_cart_v2', JSON.stringify(cart));
  });
  const { win, doc } = page;
  global.__checkoutPage = page;

  const ready = await until(() => win.CHECKOUT && win.CHECKOUT.debugState().hasQuote, 15000);
  t.check('★ 结帐页拿到后端 Quote', ready, JSON.stringify(win.CHECKOUT.debugState()));

  const st = win.CHECKOUT.debugState();
  t.equal('小计 RM72.00（后端算的）', st.subtotal, 7200);
  t.equal('钱包抵扣 RM8.68', st.walletApplied, 868);
  t.equal('★ 应付 RM63.32', st.finalAmount, 6332);
  t.equal('预估积分 63（§57）', st.estimatedPoints, 63);
  t.equal('§43 报价 5 分钟', st.expiresInMinutes, 5);
  t.check('§44 有 IdempotencyKey', st.idempotencyKey.length >= 16);
  t.equal('桌号型态', st.orderType, 'TABLE');

  const text = doc.getElementById('checkoutBody').textContent;
  t.check('画面显示 72.00', text.indexOf('72.00') !== -1, text.slice(0, 120));
  t.check('画面显示 63.32', text.indexOf('63.32') !== -1);
  t.check('画面显示备注 Less ice please', text.indexOf('Less ice please') !== -1);
  t.check('画面显示商品名', text.indexOf('Mojito') !== -1);
  t.check('画面显示预计积分 63', text.indexOf('63') !== -1);

  /* CTA 按钮上的金额 */
  const btn = doc.getElementById('placeOrderBtn');
  t.check('下单按钮显示金额', btn.innerHTML.indexOf('63.32') !== -1, btn.innerHTML.slice(0, 90));
  t.equal('下单按钮可按', btn.disabled, false);

  /* 报价倒数（§43） */
  const timer = doc.getElementById('quoteTimer');
  t.check('有报价倒数显示', !!timer && /报价有效/.test(timer.textContent),
    timer ? timer.textContent : 'no #quoteTimer');
});

/* -------------------------------------------------------------
   03 · 前端不能改价：把购物车数字改坏，金额仍是后端算的
   ------------------------------------------------------------- */
suite.group('03 · §41 前端改价无效', async (t) => {
  const tampered = JSON.parse(JSON.stringify(global.__cart));
  tampered[0].unitPrice = 1;            // 假价格 RM0.01
  tampered[1].unitPrice = 1;

  const page = await openPage(global.__JSDOM, '/checkout.html?table=A12', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    w.localStorage.setItem('yt_cart_v2', JSON.stringify(tampered));
  });
  const { win, doc } = page;

  const ready = await until(() => win.CHECKOUT && win.CHECKOUT.debugState().hasQuote, 15000);
  t.check('改坏价格后仍然拿得到 Quote', ready);
  const st = win.CHECKOUT.debugState();
  t.equal('★ 小计仍是 RM72.00（假价被忽略）', st.subtotal, 7200);
  t.equal('★ 应付仍是 RM63.32', st.finalAmount, 6332);
  t.check('画面不会显示 0.01',
    doc.getElementById('checkoutBody').textContent.indexOf('0.01') === -1);
});

/* -------------------------------------------------------------
   04 · 换桌号 / 关钱包会重新报价
   ------------------------------------------------------------- */
suite.group('04 · 换桌号与关钱包会重新报价', async (t) => {
  const { win, doc } = global.__checkoutPage;
  const before = win.CHECKOUT.debugState().idempotencyKey;

  /* 关掉钱包 → 应付变成全额 */
  const chk = doc.getElementById('useWalletChk');
  t.check('有钱包勾选框', !!chk);
  chk.checked = false;
  chk.dispatchEvent(new win.Event('change', { bubbles: true }));

  const off = await until(() => win.CHECKOUT.debugState().walletApplied === 0, 15000);
  t.check('★ 关钱包后不再抵扣', off, JSON.stringify(win.CHECKOUT.debugState()));
  t.equal('关钱包后应付 RM72.00', win.CHECKOUT.debugState().finalAmount, 7200);
  t.check('重新报价（key 换了）',
    win.CHECKOUT.debugState().idempotencyKey !== before);

  /* 再打开钱包 */
  const chk2 = doc.getElementById('useWalletChk');
  chk2.checked = true;
  chk2.dispatchEvent(new win.Event('change', { bubbles: true }));
  const on = await until(() => win.CHECKOUT.debugState().walletApplied === 868, 15000);
  t.check('重新勾选后又抵扣 RM8.68', on);
  t.equal('应付回到 RM63.32', win.CHECKOUT.debugState().finalAmount, 6332);
});

/* -------------------------------------------------------------
   04b · §11 取餐方式：桌号 ↔ 柜台自取
   -------------------------------------------------------------
   为什么要有：这段 UI 之前从来没被任何测试执行过。
   静态契约检查看得到 data-type 属性存在，但看不到「点了没反应」
   或「切过去后端报价没更新」—— 这一轮已经吃过两次这种亏。
   用独立页实例，不动 05 要下单的共用页。
   ------------------------------------------------------------- */
suite.group('04b · §11 桌号 ↔ 柜台自取 切换会重新报价', async (t) => {
  const page = await openPage(global.__JSDOM, '/checkout.html?table=A12', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    w.localStorage.setItem('yt_cart_v2', JSON.stringify(global.__cart));
  });
  const { win, doc } = page;

  const ready = await until(() => win.CHECKOUT && win.CHECKOUT.debugState().hasQuote, 15000);
  t.check('结帐页拿到报价', ready);
  t.equal('★ 桌牌 QR 带入桌号 A12', win.CHECKOUT.debugState().tableNumber, 'A12');
  t.equal('★ 型态是 TABLE', win.CHECKOUT.debugState().orderType, 'TABLE');

  /* 两个选项都画出来了 */
  t.check('★ 画面有「桌号」选项',
    !!doc.querySelector('#checkoutBody [data-type="TABLE"]'));
  t.check('★ 画面有「柜台自取」选项',
    !!doc.querySelector('#checkoutBody [data-type="COUNTER"]'));
  t.check('★ 选中的是桌号',
    /selected/.test(doc.querySelector('#checkoutBody [data-type="TABLE"]').className));

  /* ① 切到柜台自取 → 桌号要清空、报价要换一张 */
  const keyA = win.CHECKOUT.debugState().idempotencyKey;
  doc.querySelector('#checkoutBody [data-type="COUNTER"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));

  const toCounter = await until(() => win.CHECKOUT.debugState().orderType === 'COUNTER', 15000);
  t.check('★ 切成柜台自取', toCounter, JSON.stringify(win.CHECKOUT.debugState()));
  t.equal('★ 桌号已清空', win.CHECKOUT.debugState().tableNumber, '');
  t.check('★ 重新报价（key 换了）',
    win.CHECKOUT.debugState().idempotencyKey !== keyA);
  t.check('★ 切到自取后桌号输入框消失',
    !doc.getElementById('tableInput'));

  /* ② 切回桌号 → 没填桌号要弹「你在哪一桌？」，不是送一个注定失败的请求 */
  doc.querySelector('#checkoutBody [data-type="TABLE"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));

  const asked = await until(() => !!doc.getElementById('askTableInput'), 15000);
  t.check('★ 切回桌号会问「你在哪一桌？」', asked,
    doc.getElementById('checkoutBody').textContent.slice(0, 60));
  const askText = doc.getElementById('checkoutBody').textContent;
  t.check('★ 问句是中文的', askText.indexOf('你在哪一桌') !== -1);
  t.check('★ 也提供「柜台自取」出口', !!doc.getElementById('askCounterBtn'));

  /* ③ 填桌号 → 正常报价 */
  const askInput = doc.getElementById('askTableInput');
  askInput.value = 'b07';                       /* 小写要转大写 */
  askInput.dispatchEvent(new win.Event('change', { bubbles: true }));

  const quoted = await until(() => win.CHECKOUT.debugState().hasQuote &&
    win.CHECKOUT.debugState().tableNumber === 'B07', 15000);
  t.check('★ 填了桌号就正常报价', quoted, JSON.stringify(win.CHECKOUT.debugState()));
  t.equal('★ 桌号转成大写 B07', win.CHECKOUT.debugState().tableNumber, 'B07');
  t.equal('型态 TABLE', win.CHECKOUT.debugState().orderType, 'TABLE');
  t.check('金额算出来了', win.CHECKOUT.debugState().finalAmount > 0);

  /* ④ 从「你在哪一桌？」直接选柜台自取 */
  const page2 = await openPage(global.__JSDOM, '/checkout.html?table=A12', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    w.localStorage.setItem('yt_cart_v2', JSON.stringify(global.__cart));
  });
  const win2 = page2.win, doc2 = page2.doc;
  await until(() => win2.CHECKOUT && win2.CHECKOUT.debugState().hasQuote, 15000);
  doc2.querySelector('#checkoutBody [data-type="COUNTER"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  await until(() => win2.CHECKOUT.debugState().orderType === 'COUNTER', 15000);
  doc2.querySelector('#checkoutBody [data-type="TABLE"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  await until(() => !!doc2.getElementById('askCounterBtn'), 15000);

  doc2.getElementById('askCounterBtn').dispatchEvent(new win.Event('click', { bubbles: true }));
  const backToCounter = await until(() => win2.CHECKOUT.debugState().orderType === 'COUNTER' &&
    win2.CHECKOUT.debugState().hasQuote, 15000);
  t.check('★ 从问句直接选柜台自取也能报价', backToCounter,
    JSON.stringify(win2.CHECKOUT.debugState()));

  page.dom.window.close();
  page2.dom.window.close();
});

/* -------------------------------------------------------------
   05 · 下单 → 跳到订单页 → 购物车清空
   ------------------------------------------------------------- */
suite.group('05 · 下单成功并跳转（§44 §45）', async (t) => {
  const { win, doc } = global.__checkoutPage;

  /* UI.go 在 jsdom 不能真的导航，包一层记下来 */
  win.__nav = [];
  win.UI.go = function (url) { win.__nav.push(url); };

  doc.getElementById('placeOrderBtn').dispatchEvent(new win.Event('click', { bubbles: true }));

  const done = await until(() => win.__nav.length > 0, 15000);
  t.check('★ 下单后跳去订单页', done, JSON.stringify(win.__nav));
  t.check('跳去 order.html?id=...', /^order\.html\?id=APO/.test(win.__nav[0] || ''), win.__nav[0]);
  global.__appOrderId = (win.__nav[0] || '').split('id=')[1];
  t.check('拿到 AppOrderID', !!global.__appOrderId);

  t.equal('购物车已清空', win.CART.items().length, 0);
  t.equal('localStorage 里的车也清了',
    JSON.parse(win.localStorage.getItem('yt_cart_v2') || '[]').length, 0);

  /* §44 连按第二次不应该再下一张单 */
  const orders = await post('getMyOrders', { limit: 30 }, global.__token);
  t.equal('★ 数据库只有一张订单', orders.data.orders.length, 1);
  global.__orderNumber = orders.data.orders[0].orderNumber;
  t.check('订单号格式 YT + 日期 + 序号（§45）',
    /^YT\d{6}\d{3}$/.test(global.__orderNumber), global.__orderNumber);
  t.equal('SUBMITTED', orders.data.orders[0].orderStatus, 'SUBMITTED');
  t.equal('UNPAID', orders.data.orders[0].paymentStatus, 'UNPAID');
});

/* -------------------------------------------------------------
   06 · 订单追踪页（§17 §49 §53）
   ------------------------------------------------------------- */
suite.group('06 · order.html 订单追踪', async (t) => {
  const page = await openPage(global.__JSDOM,
    '/order.html?id=' + encodeURIComponent(global.__appOrderId), (w) => {
      w.localStorage.setItem('yt_customer_token', global.__token);
      w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    });
  const { win, doc } = page;
  global.__orderPage = page;

  const ready = await until(() => win.ORDER && win.ORDER.debugState().hasOrder, 15000);
  t.check('★ 订单页载入订单', ready, JSON.stringify(win.ORDER.debugState()));

  const st = win.ORDER.debugState();
  t.equal('状态 SUBMITTED', st.status, 'SUBMITTED');
  t.equal('订单号一致', st.orderNumber, global.__orderNumber);
  t.equal('总额 RM63.32', st.finalAmount, 6332);
  t.equal('§22 还没发积分', st.pointsEarned, 0);
  t.equal('§47 正在轮询', st.polling, true);
  t.equal('§47 轮询 12 秒', st.pollSeconds, 12);

  const text = doc.getElementById('orderBody').textContent;
  t.check('显示订单号', text.indexOf(global.__orderNumber) !== -1);
  t.check('显示已提交', text.indexOf('已提交') !== -1);
  t.check('显示桌号 A12', text.indexOf('A12') !== -1);
  t.check('显示商品', text.indexOf('Mojito') !== -1);
  t.check('§49 有等待计时', !!doc.getElementById('waitingTimer'));

  /* §53 SUBMITTED 可以自己取消 */
  t.check('§53 有取消按钮', !!doc.getElementById('cancelOrderBtn'));
});

/* -------------------------------------------------------------
   07 · 我的订单列表（§17 §37）
   ------------------------------------------------------------- */
suite.group('07 · orders.html 我的订单', async (t) => {
  const page = await openPage(global.__JSDOM, '/orders.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__token);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
  });
  const { win, doc } = page;

  const ready = await until(() => win.ORDERS && win.ORDERS.debugState().total > 0, 15000);
  t.check('★ 列出订单', ready, JSON.stringify(win.ORDERS.debugState()));
  t.equal('1 张订单', win.ORDERS.debugState().total, 1);

  const text = doc.getElementById('ordersBody').textContent;
  t.check('显示订单号', text.indexOf(global.__orderNumber) !== -1);
  t.check('显示商品与数量', text.indexOf('×2') !== -1, text.slice(0, 120));
  t.check('显示金额 63.32', text.indexOf('63.32') !== -1);

  /* 状态筛选（§17） */
  const chips = doc.querySelectorAll('#statusStrip .cat-chip');
  t.check('有状态筛选条', chips.length >= 4, chips.length + ' chips');

  /* 筛「已完成」应该是空的，且要说清楚 */
  const completedChip = Array.prototype.filter.call(chips,
    (c) => c.getAttribute('data-key') === 'COMPLETED')[0];
  completedChip.dispatchEvent(new win.Event('click', { bubbles: true }));
  const empty = await until(() =>
    doc.getElementById('ordersBody').textContent.indexOf('还没有订单') !== -1 ||
    doc.getElementById('ordersBody').textContent.indexOf('这个分类还没有订单') !== -1, 8000);
  t.check('筛选后空状态有说明', empty,
    doc.getElementById('ordersBody').textContent.slice(0, 60));
});

/* -------------------------------------------------------------
   08 · 员工看板（§19 §20 §48 §49 §65）
   ------------------------------------------------------------- */
suite.group('08 · admin/orderboard.html 员工看板', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/orderboard.html', (w) => {
    w.localStorage.setItem('yt_staff_token', global.__staffToken);
    w.localStorage.setItem('yt_staff_profile', JSON.stringify(global.__staffProfile));
  });
  const { win, doc } = page;
  global.__boardPage = page;

  const ready = await until(() =>
    win.ADMIN_ORDERBOARD && win.ADMIN_ORDERBOARD.debugState().newCount > 0, 15000);
  t.check('★ 看板 NEW 栏看到订单', ready,
    JSON.stringify(win.ADMIN_ORDERBOARD.debugState()));

  const st = win.ADMIN_ORDERBOARD.debugState();
  t.equal('NEW 栏 1 张', st.newCount, 1);
  t.equal('§46 轮询 8 秒', st.pollSeconds, 8);
  t.equal('正在轮询', st.polling, true);

  const text = doc.getElementById('boardBody').textContent;
  t.check('显示订单号', text.indexOf(global.__orderNumber) !== -1);
  t.check('显示桌号 A12', text.indexOf('A12') !== -1);
  t.check('§21 显示会员名', text.indexOf('Jason') !== -1, text.slice(0, 200));
  t.check('§21 显示会员等级', /MEMBER|GOLD|SILVER/.test(text));
  t.check('显示备注', text.indexOf('Less ice please') !== -1);
  t.check('显示未付款', text.indexOf('未付款') !== -1);
  t.check('§19 有 ACCEPT 按钮', text.indexOf('ACCEPT') !== -1);
  t.check('§49 有等待计时', !!doc.querySelector('[data-wait]'));

  /* §48 MUTE 按钮 */
  const mute = doc.getElementById('muteBtn');
  t.check('§48 有 MUTE 按钮', !!mute);
  mute.dispatchEvent(new win.Event('click', { bubbles: true }));
  t.equal('§48 可以静音', win.ADMIN_ORDERBOARD.debugState().muted, true);
  t.equal('静音状态记在 localStorage', win.localStorage.getItem('yt_board_mute'), '1');
  mute.dispatchEvent(new win.Event('click', { bubbles: true }));
  t.equal('可以再开声音', win.ADMIN_ORDERBOARD.debugState().muted, false);

  /* §65 暂停接单 */
  const pause = doc.getElementById('pauseBtn');
  t.check('§65 有暂停按钮', !!pause);
});

/* -------------------------------------------------------------
   09 · 看板推进订单 → 顾客页跟着变
   ------------------------------------------------------------- */
suite.group('09 · 看板 ACCEPT → 顾客订单页更新（§16 §17）', async (t) => {
  const { win, doc } = global.__boardPage;

  const accept = doc.querySelector('[data-act="acceptOrder"]');
  t.check('看板有 ACCEPT 按钮', !!accept);
  accept.dispatchEvent(new win.Event('click', { bubbles: true }));

  const moved = await until(() =>
    win.ADMIN_ORDERBOARD.debugState().confirmedCount === 1, 15000);
  t.check('★ 接单后进入 CONFIRMED 栏', moved,
    JSON.stringify(win.ADMIN_ORDERBOARD.debugState()));
  t.equal('NEW 栏清空', win.ADMIN_ORDERBOARD.debugState().newCount, 0);

  /* 顾客端重新载入订单页应该看到新状态 */
  const check = await post('getAppOrder', { appOrderId: global.__appOrderId }, global.__token);
  t.equal('后端状态 CONFIRMED', check.data.order.orderStatus, 'CONFIRMED');
});

/* -------------------------------------------------------------
   10 · 收款 + 完成 → 积分只发一次（§22 §54 §55）
   ------------------------------------------------------------- */
suite.group('10 · 收款与完成（§54 §55 §22）', async (t) => {
  const id = global.__appOrderId;

  t.okIs(await post('startPreparing', { appOrderId: id }, global.__staffToken), '开始制作');
  t.okIs(await post('markReady', { appOrderId: id }, global.__staffToken), '标为可取酒');

  /* 未收款不能完成（§12） */
  const early = await post('completeOrder', { appOrderId: id }, global.__staffToken);
  t.equal('§12 未收款不能完成', early.error.code, 'ORDER_NOT_PAID');

  const pay = await post('markPaymentPaid', { appOrderId: id }, global.__staffToken);
  t.okIs(pay, '确认收款');
  t.equal('§54 收款时才扣钱包 RM8.68', pay.data.walletUsed, 868);

  const wallet = await post('getWallet', {}, global.__token);
  t.equal('钱包余额已扣为 0', wallet.data.balance, 0);

  const c1 = await post('completeOrder', { appOrderId: id }, global.__staffToken);
  t.okIs(c1, '完成订单');
  t.equal('§57 积分 63', c1.data.pointsIssued, 63);
  t.equal('§56 算 1 次到店', c1.data.visitCounted, true);
  t.check('§58 有 Reward', !!c1.data.reward);

  /* §55 连按两次 */
  const c2 = await post('completeOrder', { appOrderId: id }, global.__staffToken);
  t.equal('§55 第二次回报已完成', c2.data.alreadyCompleted, true);
  t.equal('§55 第二次不发积分', c2.data.pointsIssued, 0);

  const prof = await post('getProfile', {}, global.__token);
  t.equal('★ 积分只发一次 63', prof.data.customer.currentPoints, 63);
  t.equal('★ 到店只算一次', prof.data.customer.totalVisits, 1);
  t.equal('总消费 RM72.00', prof.data.customer.totalSpend, 7200);
});

/* -------------------------------------------------------------
   11 · 完成后的订单页与看板
   ------------------------------------------------------------- */
suite.group('11 · 完成后顾客页与看板收尾', async (t) => {
  const page = await openPage(global.__JSDOM,
    '/order.html?id=' + encodeURIComponent(global.__appOrderId), (w) => {
      w.localStorage.setItem('yt_customer_token', global.__token);
      w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__profile));
    });
  const { win, doc } = page;

  const ready = await until(() => win.ORDER && win.ORDER.debugState().hasOrder, 15000);
  t.check('订单页重新载入', ready);
  const st = win.ORDER.debugState();
  t.equal('状态 COMPLETED', st.status, 'COMPLETED');
  t.equal('★ 钱包已扣 RM8.68', st.walletUsed, 868);
  t.equal('★ 积分 63', st.pointsEarned, 63);
  t.equal('§47 结案后停止轮询', st.polling, false);
  t.check('画面显示已完成',
    doc.getElementById('orderBody').textContent.indexOf('已完成') !== -1);
  t.check('画面显示已获得积分',
    doc.getElementById('orderBody').textContent.indexOf('63') !== -1);
  t.check('完成后不再给取消按钮', !doc.getElementById('cancelOrderBtn'));

  /* 看板：完成的订单要离开看板 */
  const board = await openPage(global.__JSDOM, '/admin/orderboard.html', (w) => {
    w.localStorage.setItem('yt_staff_token', global.__staffToken);
    w.localStorage.setItem('yt_staff_profile', JSON.stringify(global.__staffProfile));
  });
  await until(() => board.win.ADMIN_ORDERBOARD &&
    board.win.ADMIN_ORDERBOARD.debugState().loading === false, 15000);
  const bst = board.win.ADMIN_ORDERBOARD.debugState();
  t.equal('完成的订单离开 NEW 栏', bst.newCount, 0);
  t.equal('也不在 READY 栏', bst.readyCount, 0);
  t.check('§50 今日统计有数字', bst.salesToday >= 6332, bst.salesToday);
});

/* -------------------------------------------------------------
   12 · §85 Foodcourt 认领仍然正常
   ------------------------------------------------------------- */
suite.group('12 · §85 Foodcourt 认领不受影响', async (t) => {
  const made = await post('createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-UI-1', amount: 5000 }, global.__staffToken);
  t.okIs(made, '员工开单照旧可用');

  const claim = await post('claimOrder', { token: made.data.token }, global.__token);
  t.okIs(claim, '顾客认领照旧可用');
  t.equal('Foodcourt 得到 50 分', claim.data.pointsEarned, 50);

  const prof = await post('getProfile', {}, global.__token);
  t.equal('两条通路积分累加 63 + 50 = 113', prof.data.customer.currentPoints, 113);
  t.equal('§56 6 小时内仍只算 1 次到店', prof.data.customer.totalVisits, 1);
});

/* =============================================================
   起 server → 跑 → 收尾
   ============================================================= */

const server = spawn(process.execPath,
  [path.join(__dirname, 'server.js'), '--port', String(PORT), '--reset'],
  { cwd: path.join(__dirname, '..') });

suite.run().then((pass) => {
  server.kill('SIGKILL');
  process.exit(pass ? 0 : 1);
}).catch((e) => {
  console.error('测试执行失败：', e && e.stack ? e.stack : e);
  server.kill('SIGKILL');
  process.exit(1);
});
