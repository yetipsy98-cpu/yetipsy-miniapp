/* =============================================================
   demo/test-admin-ui.js
   -------------------------------------------------------------
   ★ 用 jsdom 真的把「菜单管理页 / 业绩报表页」开起来跑。

   为什么要有：这两页是 Phase 10 / 11 新增的，之前只有 smoke-ui 做
   静态契约检查（比对 js 与 HTML 里的名称），从来没有被真正执行过。
   「后端 action 测过了」不等于「页面跑得起来」—— 1.2 那次
   Service Worker 的教训就是这个。

   重点验：
     · admin/menu.html 真的列出分类与商品
     · §32 权限分界：MANAGER / OWNER 看得到编辑 / 新增 / 分类按钮；
       普通 STAFF 只剩「售罄 / 有货」切换
     · 在页面上改价格 / 新增商品 / 新增分类，真的写回后端
     · admin/analytics.html 真的算出今日统计、通路业绩、热销、会员数字
     · 普通员工打开业绩报表要看到「需要经理权限」，不能看到数字

   执行： node demo/test-admin-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3996;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 2.0 菜单管理与业绩报表页面 DOM 测试（jsdom）');

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
      window.AudioContext = undefined;
      if (seed) seed(window);
    }
  });
  const win = dom.window;
  const start = Date.now();
  while (!(win.API && win.UI && win.ADMIN) && Date.now() - start < 15000) await sleep(80);
  await sleep(250);
  return { dom, win, doc: win.document };
}

async function until(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 12000)) {
    /* ★ 必须 await：传进来的可能是 async 函式，而 Promise 物件永远为真，
       写成 if (fn()) 会让第一次检查就「通过」，根本没真的等。 */
    if (await fn()) return true;
    await sleep(80);
  }
  return false;
}

/** 用某个员工身份开页面 */
function seedStaff(token, profile) {
  return (w) => {
    w.localStorage.setItem('yt_staff_token', token);
    w.localStorage.setItem('yt_staff_profile', JSON.stringify(profile));
  };
}

/* =============================================================
   测试
   ============================================================= */

suite.group('00 · 准备三个身份', async (t) => {
  await waitForServer(15000);
  global.__JSDOM = require('jsdom').JSDOM;

  /* 营业时间放开，否则白天跑测试会被 ORDERING_CLOSED 挡 */
  const boot = await post('staffLogin', { username: 'owner', password: 'yetipsy123' });
  t.okIs(boot, 'OWNER 预备登入');
  t.okIs(await post('updateSetting',
    { key: 'ORDERING_OPEN_TIME', value: '00:00' }, boot.data.token), '放开开始时间');
  t.okIs(await post('updateSetting',
    { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, boot.data.token), '放开结束时间');

  const owner = await post('staffLogin', { username: 'owner', password: 'yetipsy123' });
  t.okIs(owner, 'OWNER 登入');
  global.__ownerToken = owner.data.token;
  global.__ownerProfile = owner.data.staff;
  t.equal('角色是 OWNER', owner.data.staff.role, 'OWNER');

  const manager = await post('staffLogin', { username: 'manager', password: 'yetipsy123' });
  t.okIs(manager, 'MANAGER 登入');
  global.__managerToken = manager.data.token;
  global.__managerProfile = manager.data.staff;
  t.equal('角色是 MANAGER', manager.data.staff.role, 'MANAGER');

  const staff = await post('staffLogin', { username: 'staff', password: 'yetipsy123' });
  t.okIs(staff, 'STAFF 登入');
  global.__staffToken = staff.data.token;
  global.__staffProfile = staff.data.staff;
  t.equal('角色是 STAFF', staff.data.staff.role, 'STAFF');

  /* demo 已经种了酒单 */
  /* ★ 员工要用 getAdminMenu：getMenu 走 requireCustomer()，
     员工 token 一律 INVALID_SESSION，而且它只回 ACTIVE 的商品 */
  const asCustomer = await post('getMenu', {}, global.__ownerToken);
  t.check('★ 员工 token 打 getMenu 会被挡（确认那个 bug 的前提）',
    asCustomer.success === false && asCustomer.error.code === 'INVALID_SESSION');
  const menu = await post('getAdminMenu', {}, global.__ownerToken);
  t.okIs(menu, 'getAdminMenu 成功');
  t.check('★ 回传 canEdit', menu.data.canEdit === true, String(menu.data.canEdit));
  t.check('有 counts', !!menu.data.counts, JSON.stringify(menu.data.counts));
  t.check('有商品', menu.data.products.length >= 4, menu.data.products.length + ' 项');
  t.check('有分类', menu.data.categories.length >= 1, menu.data.categories.length + ' 个');
});

/* -------------------------------------------------------------
   01 · admin/menu.html 真的列得出来
   ------------------------------------------------------------- */

suite.group('01 · admin/menu.html 列出分类与商品', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;

  t.check('页面有 ADMIN_MENU', !!win.ADMIN_MENU);
  const loaded = await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);
  t.check('★ 商品载入完成', loaded, JSON.stringify(win.ADMIN_MENU.debugState()));

  const st = win.ADMIN_MENU.debugState();
  t.check('分类有载入', st.categories >= 1, st.categories);
  t.check('商品有载入', st.products >= 4, st.products);
  t.equal('没有错误', st.errorCode, null);

  /* DOM 真的渲染出来了 */
  const rows = doc.querySelectorAll('#menuAdminBody [data-row]');
  t.check('★ DOM 里有商品列', rows.length >= 4, rows.length + ' 列');
  const html = doc.getElementById('menuAdminBody').innerHTML;
  t.check('★ 画面上看得到 Mojito', html.indexOf('Mojito') >= 0);
  t.check('画面上看得到 Long Island', html.indexOf('Long Island') >= 0);

  /* 分类条 */
  const chips = doc.querySelectorAll('#catFilter .cat-chip');
  t.check('★ 有分类筛选条', chips.length >= 2, chips.length + ' 个');

  page.dom.window.close();
});

/* -------------------------------------------------------------
   02 · §32 权限分界（最关键的一组）
   ------------------------------------------------------------- */

suite.group('02 · §32 MANAGER 看得到编辑 / 新增 / 分类', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__managerToken, global.__managerProfile));
  const { win, doc } = page;

  await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);
  const st = win.ADMIN_MENU.debugState();
  t.equal('★ canEdit = true', st.canEdit, true);

  t.check('★ 看得到「新增商品」按钮',
    !!doc.getElementById('addProductBtn') &&
    doc.getElementById('addProductBtn').style.display !== 'none');
  t.check('★ 看得到「新增分类」按钮',
    !!doc.getElementById('addCategoryBtn') &&
    doc.getElementById('addCategoryBtn').style.display !== 'none');

  const editBtns = doc.querySelectorAll('#menuAdminBody [data-edit]');
  t.check('★ 每列都有编辑按钮', editBtns.length >= 4, editBtns.length + ' 个');

  /* 编辑表单里的价格栏位要存在（§32 能改价格） */
  win.ADMIN_MENU.openForm();
  await sleep(150);
  const form = doc.getElementById('productForm');
  t.check('★ 编辑表单打得开', !!form && form.style.display !== 'none');
  t.check('★ 有价格栏位', !!doc.getElementById('fPrice'));
  t.check('有名称栏位', !!doc.getElementById('fNameEN'));
  t.check('有分类栏位', !!doc.getElementById('fCategory'));
  t.check('★ 有促销价栏位（§40）', !!doc.getElementById('fPromo'));
  t.check('★ 有促销时间窗栏位（§40）',
    !!doc.getElementById('fPromoStart') && !!doc.getElementById('fPromoEnd'));
  t.check('★ 有原价栏位（§40）', !!doc.getElementById('fOriginal'));
  t.check('★ 有图片 URL 栏位（§33）', !!doc.getElementById('fImage'));
  t.check('有酒感栏位', !!doc.getElementById('fStrength'));
  t.check('有排序栏位', !!doc.getElementById('fSort'));

  page.dom.window.close();
});

suite.group('02b · §32 普通 STAFF 只剩售罄切换', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;

  await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);
  const st = win.ADMIN_MENU.debugState();
  t.equal('★ canEdit = false', st.canEdit, false);

  /* 新增按钮应该被隐藏或移除 */
  const addBtn = doc.getElementById('addProductBtn');
  const addVisible = addBtn && addBtn.offsetParent !== null &&
    addBtn.style.display !== 'none';
  t.check('★ 看不到「新增商品」', !addVisible);

  const catBtn = doc.getElementById('addCategoryBtn');
  const catVisible = catBtn && catBtn.offsetParent !== null &&
    catBtn.style.display !== 'none';
  t.check('★ 看不到「新增分类」', !catVisible);

  const editBtns = doc.querySelectorAll('#menuAdminBody [data-edit]');
  t.equal('★ 没有编辑按钮', editBtns.length, 0);

  /* 但售罄切换要还在（§32 说普通员工可以标售罄） */
  const toggles = doc.querySelectorAll('#menuAdminBody [data-toggle]');
  t.check('★ 仍有售罄 / 有货切换', toggles.length >= 4, toggles.length + ' 个');

  /* 强行呼叫 openForm 应该被挡下来，表单不会出现 */
  win.ADMIN_MENU.openForm(null);
  await sleep(200);
  const form = doc.getElementById('productForm');
  const formVisible = form && form.style.display !== 'none' &&
    !!form.querySelector('#fPrice');
  t.check('★ 强行开表单也被挡（没有价格栏位）', !formVisible);
  t.equal('state 仍没有进入编辑模式', win.ADMIN_MENU.debugState().editing, null);

  page.dom.window.close();
});

/* -------------------------------------------------------------
   03 · 在页面上改价格，真的写回后端
   ------------------------------------------------------------- */

suite.group('03 · 页面上改价格 → 后端真的变了', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);

  const menuBefore = await post('getAdminMenu', {}, global.__ownerToken);
  const mojito = menuBefore.data.products.find((p) => p.nameEN === 'Mojito');
  t.equal('原本 RM22.00', mojito.price, 2200);

  /* 在页面上打开 Mojito 的编辑表单，把价格改成 25.90 */
  win.ADMIN_MENU.openForm(mojito);
  await sleep(180);
  doc.getElementById('fPrice').value = '25.90';
  doc.getElementById('fNameEN').value = 'Mojito';

  const saveBtn = doc.getElementById('saveProductBtn') ||
    doc.querySelector('#productForm .btn-primary, #productForm button[type=submit]');
  t.check('★ 找得到储存按钮', !!saveBtn);
  saveBtn.click();

  /* 等页面回报表单关闭 */
  const saved = await until(() => win.ADMIN_MENU.debugState().editing === null, 12000);
  t.check('★ 表单关闭（代表储存成功）', saved,
    JSON.stringify(win.ADMIN_MENU.debugState()));

  /* 后端真的变了吗 */
  const menuAfter = await post('getAdminMenu', {}, global.__ownerToken);
  const after = menuAfter.data.products.find((p) => p.productId === mojito.productId);
  t.equal('★ 后端价格变成 RM25.90', after.price, 2590);

  /* 顾客端也看得到新价格（顾客用 getMenu，这里用顾客 token 才能打） */
  const reg2 = await post('customerRegister',
    { phone: '0127778888', name: 'PriceChecker', password: 'test-pass-123' });
  const custMenu = await post('getMenu', {}, reg2.data.token);
  const cust = custMenu.data.products.find((p) => p.productId === mojito.productId);
  t.equal('★ 顾客端价格同步', cust.price, 2590);

  /* 改回去，别污染后面的测试 */
  await post('updateProduct', { productId: mojito.productId, price: 2200 }, global.__ownerToken);
  page.dom.window.close();
});

suite.group('03b · 页面上新增商品 → 后端多一笔', async (t) => {
  const before = await post('getAdminMenu', {}, global.__ownerToken);
  const countBefore = before.data.products.length;

  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);

  win.ADMIN_MENU.openForm(null);
  await sleep(180);
  doc.getElementById('fNameEN').value = 'Test Old Fashioned';
  doc.getElementById('fNameZH').value = '古典鸡尾酒';
  doc.getElementById('fPrice').value = '32';
  const cat = doc.getElementById('fCategory');
  if (cat && cat.options.length) cat.selectedIndex = 0;

  const saveBtn = doc.getElementById('saveProductBtn') ||
    doc.querySelector('#productForm .btn-primary, #productForm button[type=submit]');
  saveBtn.click();
  await until(() => win.ADMIN_MENU.debugState().editing === null, 12000);

  const after = await post('getAdminMenu', {}, global.__ownerToken);
  t.equal('★ 后端多了一笔商品', after.data.products.length, countBefore + 1);
  const created = after.data.products.find((p) => p.nameEN === 'Test Old Fashioned');
  t.check('★ 找得到新商品', !!created);
  t.equal('★ 价格 RM32.00', created.price, 3200);
  t.equal('中文名也存到了', created.nameZH, '古典鸡尾酒');

  page.dom.window.close();
});

/* -------------------------------------------------------------
   04 · admin/analytics.html 真的算得出数字
   ------------------------------------------------------------- */

suite.group('04 · admin/analytics.html 业绩报表', async (t) => {
  /* 先造一单完成的 App 订单，报表才有东西可算 */
  const reg = await post('customerRegister',
    { phone: '0128889999', name: 'AnalyticsTester', password: 'test-pass-123' });
  t.okIs(reg, '注册会员');
  const ct = reg.data.token;
  await post('manualWalletAdjustment',
    { customerId: reg.data.customer.customerId, amount: 800, reason: 'test' },
    global.__ownerToken);

  const menu = await post('getMenu', {}, ct);
  const mojito = menu.data.products.find((p) => p.nameEN === 'Mojito');
  const opts = menu.data.optionsByProduct[mojito.productId] || [];
  const groups = [];
  opts.filter((o) => o.required).forEach((o) => {
    if (groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
  });

  const q = await post('createCheckoutQuote', {
    items: [{
      productId: mojito.productId, quantity: 2,
      options: groups.map((g) => opts.filter((o) => o.optionGroup === g)[0].optionId)
    }],
    orderType: 'COUNTER', useWallet: false
  }, ct);
  t.okIs(q, '报价');
  const o = await post('placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, paymentMethod: 'COUNTER'
  }, ct);
  t.okIs(o, '下单');
  const id = o.data.order.appOrderId;
  ['acceptOrder', 'startPreparing', 'markReady', 'markPaymentPaid']
    .forEach(async (a) => { await post(a, { appOrderId: id }, global.__ownerToken); });
  await sleep(400);
  ['acceptOrder', 'startPreparing', 'markReady', 'markPaymentPaid'].reduce(
    (p, a) => p.then(() => post(a, { appOrderId: id }, global.__ownerToken)), Promise.resolve());
  await sleep(300);
  t.okIs(await post('completeOrder', { appOrderId: id }, global.__ownerToken), '完成订单');

  /* ---- 开报表页 ---- */
  const page = await openPage(global.__JSDOM, '/admin/analytics.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  t.check('页面有 ADMIN_ANALYTICS', !!win.ADMIN_ANALYTICS);

  const loaded = await until(() => {
    const st = win.ADMIN_ANALYTICS.debugState();
    return st.todaySales !== null && !st.loading;
  }, 15000);
  t.check('★ 报表载入完成', loaded, JSON.stringify(win.ADMIN_ANALYTICS.debugState()));

  const st = win.ADMIN_ANALYTICS.debugState();
  t.equal('没有错误', st.errorCode, null);
  t.equal('★ 今日销售 RM44.00', st.todaySales, 4400);
  t.equal('★ 今日 1 张订单', st.todayOrders, 1);
  t.check('★ 通路清单里有 YETIPSY_APP', st.channels.indexOf('YETIPSY_APP') >= 0,
    st.channels.join(','));
  t.equal('★ 通路合计 RM44.00', st.channelTotal, 4400);
  t.check('★ 有热销商品', st.topProducts >= 1, st.topProducts);
  t.equal('★ 会员数算得出来', st.totalMembers >= 1, true);

  /* DOM 真的渲染 */
  const html = doc.getElementById('analyticsBody').innerHTML;
  t.check('★ 画面上有「通路业绩」', html.indexOf('通路业绩') >= 0);
  t.check('★ 画面上有「热销商品」', html.indexOf('热销商品') >= 0);
  t.check('★ 画面上有「会员分析」', html.indexOf('会员分析') >= 0);
  t.check('画面上有趋势图', html.indexOf('tr-chart') >= 0);
  t.check('★ 画面上看得到 Yetipsy App 通路', html.indexOf('Yetipsy App') >= 0);
  t.check('★ 画面上看得到 Mojito', html.indexOf('Mojito') >= 0);
  t.check('画面上有 RM44.00', html.indexOf('44.00') >= 0);

  page.dom.window.close();
});

suite.group('04b · 普通员工开业绩报表看不到数字', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/analytics.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;
  await sleep(500);

  /* ADMIN.requireManager() 对普通员工是「弹提示 + 900ms 后跳回 index.html」，
     所以 ADMIN_ANALYTICS.init() 根本不会跑，报表区保持空白 */
  const html = doc.getElementById('analyticsBody').innerHTML;
  t.equal('★ 报表区是空的（init 没跑）', html, '');
  t.check('★ 没有通路业绩', html.indexOf('通路业绩') < 0);
  t.check('★ 没有会员分析', html.indexOf('会员分析') < 0);

  const st = win.ADMIN_ANALYTICS.debugState();
  t.equal('没有载入任何销售数字', st.todaySales, null);
  t.equal('没有载入会员数', st.totalMembers, null);

  page.dom.window.close();
});

/* -------------------------------------------------------------
   05 · §68 旧页面没被弄坏
   ------------------------------------------------------------- */

suite.group('05 · §68 旧的员工页面照常可开', async (t) => {
  const pages = ['/admin/index.html', '/admin/claim.html', '/admin/customers.html',
    '/admin/orders.html', '/admin/more.html', '/admin/login.html'];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p === '/admin/login.html') {
      const res = await fetch(BASE + p);
      t.equal(p + ' 回 200', res.status, 200);
      continue;
    }
    const page = await openPage(global.__JSDOM, p,
      seedStaff(global.__ownerToken, global.__ownerProfile));
    t.check(p + ' 页面跑得起来', !!page.win.API, p);
    page.dom.window.close();
  }

  /* 新加的入口确实在页面上 */
  const idx = await openPage(global.__JSDOM, '/admin/index.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const idxHtml = idx.doc.body.innerHTML;
  t.check('★ 员工首页有订单看板入口', idxHtml.indexOf('orderboard.html') >= 0);
  idx.dom.window.close();

  const more = await openPage(global.__JSDOM, '/admin/more.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const moreHtml = more.doc.body.innerHTML;
  t.check('★ 更多页有菜单管理入口', moreHtml.indexOf('menu.html') >= 0);
  t.check('★ 更多页有业绩报表入口', moreHtml.indexOf('analytics.html') >= 0);
  more.dom.window.close();
});

/* -------------------------------------------------------------
   06 · 之前从来没被执行过的页面
   ------------------------------------------------------------- */

suite.group('06 · admin/settings.html 能存设置（§63 开点单开关）', async (t) => {
  /* 先把点单关掉，再从页面上打开 —— 证明页面真的写回后端 */
  t.okIs(await post('updateSetting',
    { key: 'ORDERING_ENABLED', value: 'false' }, global.__ownerToken), '先关掉点单');
  const off = await post('getSettings', {}, global.__ownerToken);
  const beforeVal = (off.data.settings || []).filter((x) => x.key === 'ORDERING_ENABLED')[0];
  t.equal('后端确实是 false', String(beforeVal.value).toLowerCase(), 'false');

  const page = await openPage(global.__JSDOM, '/admin/settings.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  await until(() => doc.querySelectorAll('#settingsBox [data-save]').length > 0, 12000);

  const saveBtns = doc.querySelectorAll('#settingsBox [data-save]');
  t.check('★ 设置列表渲染出来', saveBtns.length >= 20, saveBtns.length + ' 个设置');

  /* 画面上要能看到 2.0 的新设置（§63） */
  const html = doc.getElementById('settingsBox').innerHTML;
  ['ORDERING_ENABLED', 'ORDERING_OPEN_TIME', 'ORDERING_CLOSE_TIME', 'MAX_ORDER_ITEMS',
   'VISIT_SESSION_HOURS', 'CHECKOUT_QUOTE_EXPIRY_MINUTES', 'MAX_WALLET_USAGE_PERCENT']
    .forEach((k) => t.check('★ 设置页有 ' + k, html.indexOf(k) >= 0));

  /* 找到 ORDERING_ENABLED 那一列，改成 true 并点 SAVE */
  const btn = doc.querySelector('#settingsBox [data-save="ORDERING_ENABLED"]');
  t.check('★ 找得到 ORDERING_ENABLED 的储存钮', !!btn);
  const input = doc.getElementById('set_' + btn.getAttribute('data-index'));
  t.check('找得到对应的输入框', !!input);
  input.value = 'true';
  btn.click();

  const saved = await until(async () => {
    const r = await post('getSettings', {}, global.__ownerToken);
    const row = (r.data.settings || []).filter((x) => x.key === 'ORDERING_ENABLED')[0];
    return row && String(row.value).toLowerCase() === 'true';
  }, 12000);
  t.check('★ 从页面上把点单打开了', saved);

  page.dom.window.close();
});

suite.group('06b · admin/staff.html 能建账号（§32 的前提）', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/staff.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  await until(() => doc.querySelectorAll('#staffList .a-item').length > 0, 12000);

  t.check('★ 员工列表渲染出来',
    doc.querySelectorAll('#staffList .a-item').length >= 3,
    doc.querySelectorAll('#staffList .a-item').length + ' 位');

  /* 建一个 MANAGER */
  doc.getElementById('newUsername').value = 'uitestmgr';
  doc.getElementById('newPassword').value = 'mgr-pass-123';
  const roleSel = doc.getElementById('newRole');
  roleSel.value = 'MANAGER';
  doc.getElementById('createStaffBtn').click();

  const created = await until(async () => {
    const r = await post('staffLogin', { username: 'uitestmgr', password: 'mgr-pass-123' });
    return r.success && r.data.staff.role === 'MANAGER';
  }, 12000);
  t.check('★ 建出来的 MANAGER 能登入', created);

  /* 建一个 STAFF */
  doc.getElementById('newUsername').value = 'uiteststaff';
  doc.getElementById('newPassword').value = 'stf-pass-123';
  doc.getElementById('newRole').value = 'STAFF';
  doc.getElementById('createStaffBtn').click();

  const created2 = await until(async () => {
    const r = await post('staffLogin', { username: 'uiteststaff', password: 'stf-pass-123' });
    return r.success && r.data.staff.role === 'STAFF';
  }, 12000);
  t.check('★ 建出来的 STAFF 能登入', created2);

  /* 角色下拉必须有这三个（§32 权限分界靠它） */
  const roles = Array.prototype.map.call(roleSel.options, (o) => o.value);
  ['OWNER', 'MANAGER', 'STAFF'].forEach((r) =>
    t.check('★ 角色下拉有 ' + r, roles.indexOf(r) >= 0, roles.join(',')));

  page.dom.window.close();
});

suite.group('06c · admin/audit.html 操作记录页', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/audit.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  const { win, doc } = page;
  await until(() => doc.getElementById('logList').innerHTML.trim().length > 0, 12000);

  const html = doc.getElementById('logList').innerHTML;
  t.check('★ 有记录列出来', html.indexOf('a-item') >= 0, html.slice(0, 80));
  t.check('★ 看得到刚才的设置变更', html.indexOf('UPDATE_SETTING') >= 0 ||
    html.indexOf('SETTING') >= 0);
  t.check('有筛选下拉', !!doc.getElementById('actionFilter'));

  page.dom.window.close();
});

suite.group('06d · reward.html 顾客开 Reward', async (t) => {
  /* 造一个有待领 Reward 的会员 */
  const reg = await post('customerRegister',
    { phone: '0126665555', name: 'RewardTester', password: 'test-pass-123' });
  t.okIs(reg, '注册会员');
  const ct = reg.data.token;
  const made = await post('createClaim',
    { source: 'FOODCOURT', externalOrderId: 'RW-1', amount: 8600 }, global.__ownerToken);
  t.okIs(made, '建立 Claim');
  const claim = await post('claimOrder', { token: made.data.token }, ct);
  t.okIs(claim, '认领');
  t.check('产生了 Reward', !!claim.data.reward, JSON.stringify(claim.data.reward));

  const seedCustomer = (w) => {
    w.localStorage.setItem('yt_customer_token', ct);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(reg.data.customer));
  };
  const page = await openPage(global.__JSDOM, '/reward.html', seedCustomer);
  const { win, doc } = page;

  /* ★ 断言要能分辨「静态标记」与「真的载入成功」。
     reward.html 的静态值就是 closedMeta = '—'、rewardAmount = 'RM 0.00'、
     walletAfter = 'RM 0.00'，所以「非空」和「含 RM」都会假通过。 */
  const ready = await until(() => {
    const meta = doc.getElementById('closedMeta').textContent;
    return meta !== '—' && meta.indexOf('RW-1') >= 0;
  }, 12000);
  t.check('★ 信封画面出现了（closedMeta 有真实订单资料）', ready,
    JSON.stringify(doc.getElementById('closedMeta').textContent));
  t.check('★ closedMeta 显示订单金额 RM 86.00',
    doc.getElementById('closedMeta').textContent.indexOf('86.00') >= 0);
  t.equal('没有错误状态', doc.getElementById('stateError').style.display, 'none');

  const walletBefore = (await post('getWallet', {}, ct)).data.balance;
  t.equal('开之前钱包是 0', walletBefore, 0);
  doc.getElementById('envelope').click();

  const opened = await until(() => {
    const el = doc.getElementById('rewardAmount').textContent;
    return el !== 'RM 0.00' && el.length > 0;
  }, 12000);
  t.check('★ 打开后显示真实金额（不是静态的 RM 0.00）', opened,
    JSON.stringify(doc.getElementById('rewardAmount').textContent));

  const walletAfter = (await post('getWallet', {}, ct)).data.balance;
  t.check('★ 钱包真的进帐了', walletAfter > 0, walletBefore + ' → ' + walletAfter);
  /* 画面显示的余额要跟后端一致 */
  const shown = doc.getElementById('walletAfter').textContent.replace(/[^0-9.]/g, '');
  t.equal('★ 画面余额与后端一致', Math.round(parseFloat(shown) * 100), walletAfter,
    shown + ' vs ' + walletAfter);

  /* 再点一次不会进帐两次（后端 claimReward 幂等） */
  doc.getElementById('envelope').click();
  await sleep(600);
  t.equal('★ 重复点击不会进帐两次',
    (await post('getWallet', {}, ct)).data.balance, walletAfter);

  page.dom.window.close();
});

suite.group('06e · preview.html 总览页跑得起来', async (t) => {
  const page = await openPage(global.__JSDOM, '/preview.html',
    seedStaff(global.__ownerToken, global.__ownerProfile));
  t.check('★ preview.html 载入且 API 可用', !!page.win.API);
  page.dom.window.close();
});

/* -------------------------------------------------------------
   08 · admin/grant.html 员工扫会员码进分（2.0 主流程）
   ------------------------------------------------------------- */

suite.group('08 · admin/grant.html 扫码 → 输金额 → 进分', async (t) => {
  /* 先准备一位会员 */
  const reg = await post('customerRegister',
    { phone: '0124445555', name: 'GrantTester', password: 'test-pass-123' });
  t.okIs(reg, '注册会员');
  const ct = reg.data.token;
  const before = (await post('getProfile', {}, ct)).data.customer;
  t.equal('起始积分 0', before.currentPoints, 0);

  const page = await openPage(global.__JSDOM, '/admin/grant.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;

  t.check('页面跑得起来（API 可用）', !!win.API);
  t.check('★ ADMIN_GRANT 模组存在', !!win.ADMIN_GRANT);
  t.check('★ SCANNER 共用模组存在', !!win.SCANNER);

  const st0 = win.ADMIN_GRANT.debugState();
  t.equal('★ 一开始在「输金额」步骤', st0.step, 'bill');
  t.equal('还没有会员', st0.hasCustomer, false);

  /* ① 输金额步骤先显示，扫码步骤先隐藏 */
  t.check('★ 输金额步骤可见',
    doc.getElementById('stepBill').style.display !== 'none');
  t.check('★ 扫码步骤先隐藏',
    doc.getElementById('stepScan').style.display === 'none');
  t.check('确认步骤先隐藏',
    doc.getElementById('stepVerify').style.display === 'none');

  /* ② 输金额 → 下一步 */
  doc.getElementById('billInput').value = '86';
  doc.getElementById('nextBtn').click();
  await sleep(200);
  t.equal('★ 金额换算成 sen', win.ADMIN_GRANT.debugState().bill, 8600);
  t.equal('★ 进到扫码步骤', win.ADMIN_GRANT.debugState().step, 'scan');
  t.check('扫码步骤现在可见',
    doc.getElementById('stepScan').style.display !== 'none');
  t.check('★ 有支援说明文字',
    doc.getElementById('scanSupport').innerHTML.length > 0);
  t.check('★ 扫码步骤显示这一单的金额',
    doc.getElementById('scanAmount').textContent.indexOf('86.00') >= 0,
    doc.getElementById('scanAmount').textContent);

  /* ③ 扫码（用手动输入，相机在 jsdom 里开不了） */
  const code = await post('getMemberCode', {}, ct);
  t.okIs(code, '取得会员条码');
  doc.getElementById('manualInput').value = code.data.payload;
  doc.getElementById('manualBtn').click();

  const verified = await until(() => win.ADMIN_GRANT.debugState().step === 'verify', 12000);
  t.check('★ 扫码后进入确认步骤', verified,
    JSON.stringify(win.ADMIN_GRANT.debugState()));

  const st1 = win.ADMIN_GRANT.debugState();
  t.equal('★ 认出是这位会员', st1.customerId, reg.data.customer.customerId);
  t.equal('★ 拿到 verifyToken', st1.hasVerifyToken, true);
  t.check('验证有倒数', st1.verifyLeft > 0, st1.verifyLeft);

  /* 会员资料显示出来了 */
  t.equal('★ 画面显示会员名', doc.getElementById('vName').textContent, 'GrantTester');
  t.equal('画面显示会员编号', doc.getElementById('vId').textContent,
    reg.data.customer.customerId);
  /* 确认页要显示这一单多少钱（金额在扫码前就输好了） */
  t.check('★ 确认页显示消费金额 RM86.00',
    doc.getElementById('cBill').textContent.indexOf('86.00') >= 0,
    doc.getElementById('cBill').textContent);

  /* 送出 */
  doc.getElementById('grantBtn').click();
  const done = await until(() => win.ADMIN_GRANT.debugState().step === 'result', 12000);
  t.check('★ 进入结果步骤', done, JSON.stringify(win.ADMIN_GRANT.debugState()));

  const st2 = win.ADMIN_GRANT.debugState();
  t.equal('★ 后端算出 86 分', st2.pointsEarned, 86);
  t.equal('★ 算了一次到店', st2.visitCounted, true);
  t.check('★ 发了 Reward（RM86 ≥ RM30）', st2.rewardAmount > 0, st2.rewardAmount);

  /* 结果显示 */
  t.equal('★ 画面显示 +86 分', doc.getElementById('rPoints').textContent, '+86 分');
  t.equal('画面显示消费 RM86.00', doc.getElementById('rBill').textContent, 'RM 86.00');
  t.check('画面说明到店', doc.getElementById('rVisit').textContent.indexOf('到店') >= 0);
  t.check('★ 画面显示 Reward 金额',
    doc.getElementById('rReward').innerHTML.indexOf('Reward') >= 0);

  /* 后端真的写进去了 */
  const after = (await post('getProfile', {}, ct)).data.customer;
  t.equal('★ 会员积分变 86', after.currentPoints, 86);
  t.equal('★ 总消费 RM86.00', after.totalSpend, 8600);
  t.equal('★ 到店 1 次', after.totalVisits, 1);
  t.equal('★ totalRewards 1（发出时就算）', after.totalRewards, 1);

  page.dom.window.close();
});

suite.group('08b · verifyToken 一次性，用过要重扫', async (t) => {
  const reg = await post('customerRegister',
    { phone: '0125556666', name: 'ReuseTester', password: 'test-pass-123' });
  const ct = reg.data.token;

  const page = await openPage(global.__JSDOM, '/admin/grant.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;

  doc.getElementById('billInput').value = '50';
  doc.getElementById('nextBtn').click();
  await sleep(150);

  const code = await post('getMemberCode', {}, ct);
  doc.getElementById('manualInput').value = code.data.payload;
  doc.getElementById('manualBtn').click();
  await until(() => win.ADMIN_GRANT.debugState().step === 'verify', 12000);

  doc.getElementById('grantBtn').click();
  await until(() => win.ADMIN_GRANT.debugState().step === 'result', 12000);
  t.equal('第一次成功', win.ADMIN_GRANT.debugState().pointsEarned, 50);

  /* 用「再来一单」回到输金额步骤 —— 不能沿用旧的 verifyToken */
  doc.getElementById('againBtn').click();
  await sleep(250);
  const st = win.ADMIN_GRANT.debugState();
  t.equal('★ 回到输金额步骤', st.step, 'bill');
  t.equal('★ verifyToken 已清掉', st.hasVerifyToken, false);
  t.equal('★ 会员已清掉', st.hasCustomer, false);
  t.equal('★ 金额已清空', st.bill, 0);
  t.equal('金额输入框也清空了', doc.getElementById('billInput').value, '');
  t.equal('输金额步骤可见', doc.getElementById('stepBill').style.display, '');

  page.dom.window.close();
});

suite.group('08c · 没扫码就不能送出', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/grant.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;

  /* 直接呼叫 submit（模拟有人用 devtools 跳过扫码） */
  const st = win.ADMIN_GRANT.debugState();
  t.equal('没有会员', st.hasCustomer, false);
  t.equal('没有 verifyToken', st.hasVerifyToken, false);

  /* 输金额也不该能送出（金额可以先输，但没有 verifyToken 就进不了分） */
  doc.getElementById('billInput').value = '100';
  doc.getElementById('nextBtn').click();
  await sleep(150);
  t.equal('金额算出来了', win.ADMIN_GRANT.debugState().bill, 10000);
  t.equal('★ 只走到扫码步骤，没有会员', win.ADMIN_GRANT.debugState().step, 'scan');
  t.equal('★ 仍然没有 verifyToken', win.ADMIN_GRANT.debugState().hasVerifyToken, false);

  /* 硬按确认也送不出去 */
  doc.getElementById('grantBtn').click();
  await sleep(200);
  t.equal('★ 按了确认也没送出（step 没变）',
    win.ADMIN_GRANT.debugState().step, 'scan');

  /* 没输金额就想扫码 → 要被挡回输金额步骤 */
  doc.getElementById('editBillBtn').click();
  await sleep(100);
  t.equal('回去改金额 → 回到输金额步骤', win.ADMIN_GRANT.debugState().step, 'bill');
  const empty = win.ADMIN_GRANT.debugState();
  doc.getElementById('billInput').value = '';
  doc.getElementById('nextBtn').click();
  await sleep(150);
  t.equal('★ 空金额按下一步不会前进',
    win.ADMIN_GRANT.debugState().step, 'bill');
  t.check('（前一个状态的金额还在）', empty.bill >= 0);

  /* 后端也会挡：没有 verifyToken 直接呼叫 grantOrder */
  const res = await post('grantOrder', { customerId: 'YT000001', billAmount: 10000 },
    global.__staffToken);
  t.check('★ 后端挡下没扫码的请求', res.success === false);
  t.equal('错误码 MEMBER_VERIFY_REQUIRED', res.error.code, 'MEMBER_VERIFY_REQUIRED');

  page.dom.window.close();
});

suite.group('08d · 员工首页：扫码进分是主操作，Claim 限经理', async (t) => {
  /* 普通员工 */
  const asStaff = await openPage(global.__JSDOM, '/admin/index.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  await sleep(400);
  const staffHtml = asStaff.doc.body.innerHTML;
  t.check('★ 员工首页有扫码进分入口', staffHtml.indexOf('grant.html') >= 0);
  t.check('★ 扫码进分排在最前面',
    staffHtml.indexOf('grant.html') < staffHtml.indexOf('orderboard.html'));
  const hidden = asStaff.doc.getElementById('createClaimAction');
  t.check('★ 普通员工看不到建立 Claim',
    !!hidden && hidden.style.display === 'none',
    hidden ? hidden.style.display : '(元素不存在)');
  asStaff.dom.window.close();

  /* 经理 */
  const asMgr = await openPage(global.__JSDOM, '/admin/index.html',
    seedStaff(global.__managerToken, global.__managerProfile));
  await sleep(400);
  const shown = asMgr.doc.getElementById('createClaimAction');
  t.check('★ 经理看得到建立 Claim',
    !!shown && shown.style.display !== 'none',
    shown ? shown.style.display : '(元素不存在)');
  asMgr.dom.window.close();
});

suite.group('08e · 员工菜单页：普通员工也能上下架', async (t) => {
  const page = await openPage(global.__JSDOM, '/admin/menu.html',
    seedStaff(global.__staffToken, global.__staffProfile));
  const { win, doc } = page;
  await until(() => win.ADMIN_MENU.debugState().products > 0, 12000);

  const st = win.ADMIN_MENU.debugState();
  t.equal('★ 普通员工 canEdit = false', st.canEdit, false);

  /* 上下架按钮对所有员工都在（状态类操作） */
  const statusBtns = doc.querySelectorAll('#menuAdminBody [data-status]');
  t.check('★ 普通员工有上下架按钮', statusBtns.length >= 4, statusBtns.length + ' 个');
  const toggles = doc.querySelectorAll('#menuAdminBody [data-toggle]');
  t.check('★ 售罄切换也在', toggles.length >= 4, toggles.length + ' 个');
  t.equal('★ 但没有编辑按钮',
    doc.querySelectorAll('#menuAdminBody [data-edit]').length, 0);

  /* 真的点一下下架，后端要变 */
  const menu0 = await post('getAdminMenu', {}, global.__staffToken);
  const target = menu0.data.products[0];
  const btn = doc.querySelector('#menuAdminBody [data-status="' + target.productId + '"]');
  t.check('★ 找得到那一列的上下架钮', !!btn);
  btn.click();

  const changed = await until(async () => {
    const m = await post('getAdminMenu', {}, global.__staffToken);
    const p = m.data.products.filter((x) => x.productId === target.productId)[0];
    return p && p.status === 'ARCHIVED';
  }, 12000);
  t.check('★ 普通员工真的把商品下架了', changed);

  /* 恢复回去，别污染后面的测试 */
  await post('setProductStatus',
    { productId: target.productId, status: 'ACTIVE' }, global.__staffToken);
  page.dom.window.close();
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
