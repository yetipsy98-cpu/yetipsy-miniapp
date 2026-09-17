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
    if (fn()) return true;
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
