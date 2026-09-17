/* =============================================================
   demo/test-menu-ui.js
   -------------------------------------------------------------
   ★ 用 jsdom 真的把「酒单页 / 商品详情页 / 购物车页」开起来跑。

   为什么要有：1.2 那次 Service Worker 与活动区的教训 ——
   「后端测试通过」不等于「页面跑得起来」。这几页是全新的，
   规格没画出来 / 价格加总错 / 售罄还能加入清单这类问题，
   只有真的执行页面才抓得到。

   执行： node demo/test-menu-ui.js
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3996;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 2.0 点单页面 DOM 测试（jsdom）');

const PWD = 'menu-test-123';
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
      /* UI.go 会触发 jsdom 未实作的 navigation，包一层记下来就好 */
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
  global.__customerToken = reg.data.token;
  global.__customerProfile = reg.data.customer;

  const staff = await post('staffLogin', { username: 'owner', password: 'yetipsy123' });
  t.okIs(staff, '员工登入');
  global.__staffToken = staff.data.token;

  /* demo server 已播示范酒单；这里确认拿得到 */
  const menu = await post('getMenu', {}, global.__customerToken);
  t.okIs(menu, 'getMenu 成功');
  t.check('有商品', menu.data.products.length >= 4, menu.data.products.length);
  global.__menu = menu.data;
  global.__mojito = menu.data.products.find((p) => p.nameEN === 'Mojito');
  t.check('找得到 Mojito', !!global.__mojito);
  t.equal('Mojito RM22.00', global.__mojito.price, 2200);
});

/* -------------------------------------------------------------
   01 · 酒单页画得出商品
   ------------------------------------------------------------- */
suite.group('01 · menu.html 画出酒单', async (t) => {
  const page = await openPage(global.__JSDOM, '/menu.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
  });
  const { win, doc } = page;
  global.__menuPage = page;

  const ready = await until(() => doc.querySelectorAll('.product-card').length > 0, 12000);
  t.check('★ 商品卡画出来了', ready, doc.querySelectorAll('.product-card').length + ' cards');

  const cards = doc.querySelectorAll('.product-card');
  t.equal('4 张商品卡', cards.length, 4);

  const text = doc.getElementById('menuList').textContent;
  t.check('有 Mojito', text.indexOf('Mojito') !== -1);
  t.check('有中文名「经典莫希托」', text.indexOf('经典莫希托') !== -1);
  t.check('显示价格 RM 22.00', text.indexOf('22.00') !== -1, text.slice(0, 160));

  /* 分类条（§5，来自 Sheet 不是写死） */
  const cats = doc.querySelectorAll('#catStrip .cat-chip');
  t.check('分类条有项目（ALL + 4 个分类）', cats.length >= 5, cats.length + ' chips');
  t.check('分类有中文', doc.getElementById('catStrip').textContent.indexOf('经典鸡尾酒') !== -1);

  /* 底部导航要有 MENU（§4） */
  t.check('底部导航有 MENU',
    doc.querySelector('.bottom-nav') &&
    doc.querySelector('.bottom-nav').textContent.indexOf('MENU') !== -1);

  /* 没有全屏 loading overlay（沿用会员条码页的教训） */
  t.equal('没有 #loadingOverlay', doc.getElementById('loadingOverlay'), null);
});

/* -------------------------------------------------------------
   02 · 搜寻与筛选（§34 / §35）
   ------------------------------------------------------------- */
suite.group('02 · 搜寻与风味筛选', async (t) => {
  const { win, doc } = global.__menuPage;

  const input = doc.getElementById('menuSearch');
  t.check('有搜寻框', !!input);

  input.value = '莫希托';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const filtered = await until(() => doc.querySelectorAll('.product-card').length === 2, 12000);
  t.check('★ 搜中文「莫希托」→ 剩 2 张卡（§34）', filtered,
    doc.querySelectorAll('.product-card').length + ' cards');
  t.check('画面显示找到几款',
    (doc.getElementById('menuHint').textContent || '').indexOf('2') !== -1,
    doc.getElementById('menuHint').textContent);

  /* 搜不到时要说清楚，不能只写「没有商品」 */
  input.value = 'zzzznotfound';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  const empty = await until(() => doc.querySelectorAll('.product-card').length === 0, 12000);
  t.check('搜不到 → 0 张卡', empty);
  t.check('显示「找不到符合的酒」',
    doc.getElementById('menuList').textContent.indexOf('找不到符合的酒') !== -1,
    doc.getElementById('menuList').textContent.slice(0, 80));

  /* 清空恢复 */
  input.value = '';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  await until(() => doc.querySelectorAll('.product-card').length === 4, 12000);
  t.equal('清空搜寻后恢复 4 张', doc.querySelectorAll('.product-card').length, 4);
});

/* -------------------------------------------------------------
   03 · 后端失败时不能伪装成「没有商品」
   ------------------------------------------------------------- */
suite.group('03 · 后端失败要讲清楚，不能伪装成空酒单', async (t) => {
  const page = await openPage(global.__JSDOM, '/menu.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
    /* 把 getMenu 换成失败 */
    const origFetch = w.fetch;
    w.fetch = function (input, init) {
      const body = init && init.body ? String(init.body) : '';
      if (body.indexOf('"getMenu"') !== -1) {
        /* 真实后端一律回 HTTP 200 + success:false（错误码在 body 里），
           所以这里也必须这样，不然 api.js 会当成 NETWORK_ERROR */
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({
            success: false, data: null,
            error: { code: 'UPGRADE_REQUIRED', message: 'Run upgradeToV2() first.' }
          }))
        });
      }
      return origFetch(input, init);
    };
  });
  const { doc } = page;

  const shown = await until(() => doc.getElementById('menuList').textContent.indexOf('载入失败') !== -1, 12000);
  t.check('★ 显示「酒单载入失败」而不是「没有商品」', shown,
    doc.getElementById('menuList').textContent.slice(0, 90));
  t.check('附上错误码 UPGRADE_REQUIRED',
    doc.getElementById('menuList').textContent.indexOf('UPGRADE_REQUIRED') !== -1);
  t.check('有重试按钮', !!doc.getElementById('menuRetryBtn'));
  t.equal('没有画出任何商品卡', doc.querySelectorAll('.product-card').length, 0);
});

/* -------------------------------------------------------------
   04 · 商品详情页：规格来自后端（§8）
   ------------------------------------------------------------- */
suite.group('04 · product.html 画出规格', async (t) => {
  const page = await openPage(global.__JSDOM,
    '/product.html?id=' + encodeURIComponent(global.__mojito.productId), (w) => {
      w.localStorage.setItem('yt_customer_token', global.__customerToken);
      w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
    });
  const { win, doc } = page;
  global.__productPage = page;

  const ready = await until(() => win.PRODUCT && win.PRODUCT.debugState().hasProduct, 12000);
  t.check('★ 商品载入完成', ready);

  const st = win.PRODUCT.debugState();
  t.equal('单价 RM22.00', st.price, 2200);
  t.equal('3 组规格（SIZE / ICE / SWEETNESS）', st.optionGroups, 3);
  t.equal('规格加价一开始是 0（都选了第一项）', st.optionsPrice, 0);

  const body = doc.getElementById('productBody').textContent;
  t.check('有 SIZE 区块', body.indexOf('Size') !== -1);
  t.check('有 Large 大杯', body.indexOf('Large') !== -1 && body.indexOf('大杯') !== -1);
  t.check('Large 显示 +RM 6.00', body.indexOf('6.00') !== -1);
  t.check('有 ICE 区块', body.indexOf('Less Ice') !== -1 || body.indexOf('少冰') !== -1);
  t.check('有备注框', !!doc.getElementById('productNote'));
  t.check('必选标记有显示', body.indexOf('必选') !== -1 || body.indexOf('REQUIRED') !== -1);

  /* 选 Large → 单价要变 RM28.00 */
  const largeRow = Array.prototype.filter.call(doc.querySelectorAll('.option-row'), (el) => {
    return el.textContent.indexOf('Large') !== -1;
  })[0];
  t.check('找得到 Large 那一列', !!largeRow);
  largeRow.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(120);

  const st2 = win.PRODUCT.debugState();
  t.equal('★ 选 Large 后单价 = RM28.00（22 + 6）', st2.unitPrice, 2800);
  t.equal('CTA 也显示 RM28.00', st2.lineTotal, 2800);
  t.check('按钮文字含 28.00',
    doc.getElementById('addToCartBtn').textContent.indexOf('28.00') !== -1,
    doc.getElementById('addToCartBtn').textContent);
  t.check('Large 那一列有 selected', largeRow.classList.contains('selected'));

  /* 数量 */
  win.PRODUCT.setQty(2);
  await sleep(80);
  t.equal('数量 2 → 小计 RM56.00', win.PRODUCT.debugState().lineTotal, 5600);
  t.check('按钮显示 56.00',
    doc.getElementById('addToCartBtn').textContent.indexOf('56.00') !== -1);
  win.PRODUCT.setQty(1);
  await sleep(60);
});

/* -------------------------------------------------------------
   05 · 加入购物车 → 购物车页（§9）
   ------------------------------------------------------------- */
suite.group('05 · 加入购物车并跳到 cart.html', async (t) => {
  const { win, doc } = global.__productPage;

  /* UI.go 会触发 jsdom 未实作的 navigation，包一层 */
  win.UI.go = function (url) { win.__nav.push(url); };

  doc.getElementById('addToCartBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(700);

  t.check('★ 跳去 cart.html', win.__nav.indexOf('cart.html') !== -1, win.__nav);

  const cart = JSON.parse(win.localStorage.getItem('yt_cart_v2') || '[]');
  t.equal('购物车有 1 列', cart.length, 1);
  t.equal('是 Mojito', cart[0].productId, global.__mojito.productId);
  t.equal('数量 1', cart[0].quantity, 1);
  t.equal('记录了 Large 规格', cart[0].options.length, 3);
  t.check('规格里有 SIZE',
    cart[0].options.some((o) => o.optionGroup === 'SIZE'), cart[0].options);
  t.equal('单价存 2200（后端给的）', cart[0].unitPrice, 2200);

  /* 打开购物车页 */
  const page = await openPage(global.__JSDOM, '/cart.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
    w.localStorage.setItem('yt_cart_v2', JSON.stringify(cart));
  });
  global.__cartPage = page;

  const ready = await until(() => page.doc.querySelectorAll('.list-item').length > 0, 10000);
  t.check('★ 购物车画出明细', ready);
  const text = page.doc.getElementById('cartList').textContent;
  t.check('显示 Mojito', text.indexOf('Mojito') !== -1);
  t.check('显示规格 Large', text.indexOf('Large') !== -1 || text.indexOf('大杯') !== -1);
  t.check('小计 RM 22.00', text.indexOf('22.00') !== -1, text.slice(0, 200));
  t.check('有结帐按钮', !!page.doc.getElementById('checkoutBtn'));
  t.check('结帐按钮显示金额',
    page.doc.getElementById('checkoutBtn').textContent.indexOf('22.00') !== -1);
});

/* -------------------------------------------------------------
   06 · 购物车数量与移除
   ------------------------------------------------------------- */
suite.group('06 · 购物车可以改数量与移除', async (t) => {
  const { win, doc } = global.__cartPage;

  const plus = doc.querySelector('.list-item [data-act="plus"]');
  t.check('有 + 按钮', !!plus);
  plus.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(150);

  t.equal('★ 数量变 2', win.CARTPAGE.debugState().count, 2);
  t.check('小计变 RM 44.00',
    doc.getElementById('cartList').textContent.indexOf('44.00') !== -1);

  const minus = doc.querySelector('.list-item [data-act="minus"]');
  minus.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(150);
  t.equal('数量回到 1', win.CARTPAGE.debugState().count, 1);

  const rm = doc.querySelector('.list-item [data-act="remove"]');
  rm.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  t.equal('★ 移除后 0 列', win.CARTPAGE.debugState().lines, 0);
  t.check('显示空车状态',
    doc.getElementById('cartList').textContent.indexOf('购物车是空的') !== -1);
  t.check('空车时有「去看看酒单」',
    doc.getElementById('cartList').textContent.indexOf('VIEW MENU') !== -1);
});

/* -------------------------------------------------------------
   07 · 售罄：顾客端不能加入清单（§31 / §66）
   ------------------------------------------------------------- */
suite.group('07 · 售罄的商品不能加入清单', async (t) => {
  const off = await post('setProductAvailability',
    { productId: global.__mojito.productId, available: false }, global.__staffToken);
  t.okIs(off, '员工把 Mojito 标成售罄');

  const page = await openPage(global.__JSDOM,
    '/product.html?id=' + encodeURIComponent(global.__mojito.productId), (w) => {
      w.localStorage.setItem('yt_customer_token', global.__customerToken);
      w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
    });
  const { win, doc } = page;

  await until(() => win.PRODUCT && win.PRODUCT.debugState().hasProduct, 12000);
  t.equal('★ 后端回报 available = false', win.PRODUCT.debugState().available, false);

  const btn = doc.getElementById('addToCartBtn');
  t.equal('加入清单按钮被停用', btn.disabled, true);
  t.check('按钮写 SOLD OUT', btn.textContent.indexOf('SOLD OUT') !== -1, btn.textContent);
  t.check('页面显示售罄标记',
    doc.getElementById('productBody').textContent.indexOf('售罄') !== -1);

  /* 就算硬点也不该写进购物车 */
  win.localStorage.removeItem('yt_cart_v2');
  btn.disabled = false;
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  t.equal('硬点也不会加入购物车',
    JSON.parse(win.localStorage.getItem('yt_cart_v2') || '[]').length, 0);

  /* 酒单页也要显示售罄 */
  const menuPage = await openPage(global.__JSDOM, '/menu.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
  });
  await until(() => menuPage.doc.querySelectorAll('.product-card').length > 0, 12000);
  t.check('★ 酒单页显示 SOLD OUT 售罄',
    menuPage.doc.getElementById('menuList').textContent.indexOf('SOLD OUT') !== -1);

  /* 收尾：恢复有货，免得影响后面的测试 */
  await post('setProductAvailability',
    { productId: global.__mojito.productId, available: true }, global.__staffToken);
});

/* -------------------------------------------------------------
   08 · 点单时间外：菜单仍可浏览，但要说清楚（§64）
   ------------------------------------------------------------- */
suite.group('08 · 点单关闭时仍可浏览菜单', async (t) => {
  /* 预设 18:30–00:00，测试当下多半是关闭的 */
  const page = await openPage(global.__JSDOM, '/menu.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
  });
  const { win, doc } = page;

  await until(() => doc.querySelectorAll('.product-card').length > 0, 12000);
  const ordering = win.MENU.debugState().ordering;
  t.check('后端有点单状态', !!ordering);
  t.equal('开放时间 18:30', ordering.openTime, '18:30');

  if (!ordering.open) {
    t.check('★ 关闭时显示横幅',
      doc.getElementById('orderingBanner').textContent.indexOf('点单时间') !== -1 ||
      doc.getElementById('orderingBanner').textContent.indexOf('ORDERING CLOSED') !== -1,
      doc.getElementById('orderingBanner').textContent);
  } else {
    t.equal('营业中就不显示横幅', doc.getElementById('orderingBanner').textContent.trim(), '');
  }
  t.check('★ 关闭时商品照样列出来（§64）',
    doc.querySelectorAll('.product-card').length === 4);

  /* 暂停接单（§65） */
  await post('updateSetting', { key: 'ORDERING_PAUSED', value: 'TRUE' }, global.__staffToken);
  const paused = await openPage(global.__JSDOM, '/menu.html', (w) => {
    w.localStorage.setItem('yt_customer_token', global.__customerToken);
    w.localStorage.setItem('yt_customer_profile', JSON.stringify(global.__customerProfile));
  });
  await until(() => paused.doc.querySelectorAll('.product-card').length > 0, 12000);
  t.check('★ 暂停时显示「暂停接单」',
    paused.doc.getElementById('orderingBanner').textContent.indexOf('暂停接单') !== -1,
    paused.doc.getElementById('orderingBanner').textContent);
  await post('updateSetting', { key: 'ORDERING_PAUSED', value: 'FALSE' }, global.__staffToken);
});

/* -------------------------------------------------------------
   09 · 页面之间接得起来（§4 / §69）
   ------------------------------------------------------------- */
suite.group('09 · 页面互连', async (t) => {
  const fs = require('fs');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  const index = read('index.html');
  const menu = read('menu.html');
  const product = read('product.html');
  const cart = read('cart.html');

  t.check('menu.html 引 js/menu.js', menu.indexOf('js/menu.js') !== -1);
  t.check('product.html 引 js/product.js', product.indexOf('js/product.js') !== -1);
  t.check('cart.html 引 js/cart-page.js', cart.indexOf('js/cart-page.js') !== -1);
  t.check('menu.html 有购物车入口', menu.indexOf('cart.html') !== -1);
  t.check('底部导航含 menu.html', read('js/ui.js').indexOf("page: 'menu.html'") !== -1);

  /* 载入顺序：cart.js 必须在 product.js / cart-page.js 之前 */
  t.check('product.html 里 cart.js 在 product.js 之前',
    product.indexOf('js/cart.js') < product.indexOf('js/product.js'));
  t.check('cart.html 里 cart.js 在 cart-page.js 之前',
    cart.indexOf('js/cart.js') < cart.indexOf('js/cart-page.js'));

  /* 1.x 的页面没被动到（§68） */
  ['index.html', 'claim.html', 'activity.html', 'wallet.html', 'profile.html', 'code.html']
    .forEach((f) => {
      t.check('1.x 的 ' + f + ' 还在', fs.existsSync(path.join(__dirname, '..', f)));
    });
  t.check('index.html 仍然完整', index.indexOf('YETIPSY') !== -1);
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
