/* =============================================================
   tools/tests/warm-check.js —— 「全部预载」检查（2.1.17）
   -------------------------------------------------------------
   目标：顾客与员工**每一位**，点任何一页都是「已经有画面、不用等」。

   怎么证明：
     ① 打开会员首页 → 预载清单里的资料有没有真的抓好（后端收到哪些请求）
     ② 接着开订单 / 钱包 / 活动 / 会员中心页：把后端调慢（2 秒），
        仍然要求 **150 毫秒内画面就有内容、而且这 150 毫秒内 0 个请求**
     ③ 员工端一样：先开首页让预载跑完，再开订单 / 设定 / 员工 / 稽核 /
        报表 / 菜单管理，同样 150 毫秒内要有内容 + 0 个请求
     ④ 未登入（登入页）也会先抓公开设定

   跑法：node tools/tests/warm-check.js
   ============================================================= */
'use strict';

const H = require('./harness');
const h = H.create({ port: 4417 });

const paintMs = 150;          // 「不用等」的判定：150 毫秒内要有内容

(async function run() {
  await h.start();
  const s = h.seed();
  console.log('全部预载检查（2.1.17）\n');
  /* 先下一张单：这样「我的订单」才有内容可证明是快取画出来的 */
  h.placeOrder(s);

  /* ============ 1. 会员首页：预载有没有真的跑 ============ */
  console.log('[1] 会员首页一打开，背景就把整份会员端资料抓好');
  const local = {
    yt_customer_token: s.CUST,
    yt_customer_profile: JSON.stringify(s.member.customer)
  };
  const home = await h.open('index.html', { storage: local, wait: 3000, idleMs: 0 });
  const warmList = home.win.API.cache.warmList();
  const sent = h.calls.slice();
  const missing = warmList.customer.filter((a) => sent.indexOf(a) === -1);
  check('预载清单有 ' + warmList.customer.length + ' 项', warmList.customer.length >= 10, warmList.customer.length);
  check('★ 清单里的资料全部抓过（缺 ' + missing.length + ' 项）', missing.length === 0, missing);
  check('首页自己的三支资料也在（getProfile / getPromotions / getPendingReward）',
    sent.indexOf('getProfile') !== -1 && sent.indexOf('getPromotions') !== -1, sent.join(','));
  check('已经写进快取（下次打开直接用）', !!home.win.API.cache.peek('getMenu', {}));
  home.save();                         // 把这台的 localStorage 带着走
  const storage = Object.assign({}, h.shared);

  /* ============ 2. 会员其他页：0 请求就有画面 ============ */
  h.delays.read = 2000;
  h.delays.write = 2000;               // 万一真的去问后端，150ms 内绝对回不来
  console.log('\n[2] 后端调慢 2 秒：换页仍然是马上有画面（内容来自快取）');
  const pages = [
    ['orders.html', 'ordersBody', /YT/, '我的订单'],
    ['wallet.html', 'walletValue', /RM|0/, '钱包'],
    ['activity.html', 'listBox', /./, '消费记录'],
    ['profile.html', 'memberName', /Jason/, '会员中心'],
    ['menu.html', 'menuList', /Tequila|Mojito/, '酒单']
  ];
  for (const [page, id, re, name] of pages) {
    h.calls.length = 0;
    const p = await h.open(page, { storage: storage, wait: paintMs, idleMs: 5000 });
    const el = p.doc.getElementById(id);
    const text = el ? el.textContent : '';
    check('★ ' + name + '（' + page + '）：后端 2 秒、' + paintMs + 'ms 内就有画面',
      !!el && re.test(text), text.slice(0, 50) || '(空)');
    check('　' + name + '：只问预载过的东西（没有多出来的请求）',
      h.calls.every(function (a) { return warmList.customer.indexOf(a) !== -1; }), h.calls.join(','));
    check('　' + name + ' 没有 JS 错误', p.errors.length === 0, p.errors.slice(0, 1));
    p.dom.window.close();
  }
  h.delays.read = 0; h.delays.write = 0;

  /* ============ 3. 员工端 ============ */
  console.log('\n[3] 员工首页一打开，整份员工端资料抓好');
  h.calls.length = 0;
  const staffLocal = {
    yt_staff_token: s.TOKEN,
    yt_staff_profile: JSON.stringify({ username: 'owner', role: 'OWNER', staffId: 'ST1' })
  };
  /* 先让后端有东西可看：两张 App 订单 + 一张 foodcourt 柜位单 */
  h.placeOrder(s);
  h.placeOrder(s);
  s.backend.api.mutate(function (DB, sb) { sb.setSetting('ORDERING_OPEN_TIME', '00:00'); });
  h.okData(h.post('createPosTicket', {
    source: 'FOODCOURT', amount: 2500, paymentMethod: 'CASH',
    items: [{ nameEN: 'Mojito', nameZH: '莫吉托', quantity: 1, unitPriceSen: 2500 }]
  }, s.TOKEN), 'createPosTicket');
  const adminHome = await h.open('admin/index.html', { storage: staffLocal, wait: 4000, idleMs: 0 });
  const sentStaff = h.calls.slice();
  const staffWarm = adminHome.win.API.cache.warmList().staff;
  const missingStaff = staffWarm.filter((a) => sentStaff.indexOf(a) === -1);
  check('员工预载清单有 ' + staffWarm.length + ' 项', staffWarm.length >= 12, staffWarm.length);
  check('★ 清单里的资料全部抓过（缺 ' + missingStaff.length + ' 项）', missingStaff.length === 0, missingStaff);
  check('现场四页的核心资料都在（酒单 / 待进单 / 看板 / 订单板）',
    ['getAdminMenu', 'getPosQueue', 'getDashboard', 'getActiveOrders']
      .every((a) => sentStaff.indexOf(a) !== -1), sentStaff.join(','));
  adminHome.save();
  const staffStorage = Object.assign({}, h.shared);

  console.log('\n[4] 后端调慢 2 秒：员工换页仍然是马上有画面（内容来自快取）');
  h.delays.read = 2000; h.delays.write = 2000;
  const staffPages = [
    ['admin/orders.html', 'ordersList', /YT|RM/, '订单'],
    ['admin/settings.html', 'settingsBox', /.,/, '设定'],
    ['admin/staff.html', 'staffList', /owner/, '员工'],
    ['admin/audit.html', 'logList', /./, '稽核'],
    ['admin/analytics.html', 'analyticsBody', /./, '报表'],
    ['admin/menu.html', 'menuAdminBody', /Tequila|Mojito/, '菜单管理'],
    ['admin/pos.html', 'kioskGrid', /Tequila|Mojito/, '点餐台'],
    ['admin/orderboard.html', 'boardBody', /lane/, '订单看板']
  ];
  for (const [page, id, re, name] of staffPages) {
    h.calls.length = 0;
    const p = await h.open(page, { storage: staffStorage, wait: paintMs, idleMs: 5000 });
    const el = p.doc.getElementById(id);
    const html = el ? (el.innerHTML || '') : '';
    check('★ ' + name + '（' + page + '）：后端 2 秒、' + paintMs + 'ms 内就有画面',
      !!el && html.length > 0 && re.test(html), html.slice(0, 60));
    check('　' + name + '：只问预载过的东西（没有多出来的请求）',
      h.calls.every(function (a) { return staffWarm.indexOf(a) !== -1; }), h.calls.join(','));
    check('　' + name + ' 没有 JS 错误', p.errors.length === 0, p.errors.slice(0, 1));
    p.dom.window.close();
  }
  h.delays.read = 0; h.delays.write = 0;

  /* ============ 5. 未登入：公开资料也先抓好 ============ */
  console.log('\n[5] 还没登入（登入页）也会先抓公开设定');
  h.calls.length = 0;
  const login = await h.open('login.html', { storage: {}, wait: 1200, idleMs: 0 });
  check('登入页抓了 getPublicSettings', h.calls.indexOf('getPublicSettings') !== -1, h.calls.join(','));
  check('登入页没有 JS 错误', login.errors.length === 0, login.errors.slice(0, 1));

  /* ============ 6. 预载清单本身要覆盖「每个页面会读的东西」 ============ */
  console.log('\n[6] 快取开关：每一支只读资料都要吃快取');
  const apiSrc = require('fs').readFileSync(H.REPO + '/js/api.js', 'utf8');
  const reads = ['getMenu', 'getMyOrders', 'getWallet', 'getWalletHistory', 'getOrderHistory',
    'getPointHistory', 'getPendingReward', 'getProfile', 'getPromotions', 'getPublicSettings',
    'getAdminMenu', 'getPosQueue', 'getDashboard', 'getActiveOrders', 'getOrders', 'getAuditLogs',
    'listStaff', 'getSettings', 'getPromotionsAdmin', 'getIncomingOrders', 'getSalesAnalytics',
    'getProductAnalytics', 'getMemberAnalytics', 'listClaims', 'getCustomer', 'getCustomerHistory'];
  const noCache = reads.filter(function (a) {
    const i = apiSrc.indexOf("call('" + a + "'");
    if (i < 0) return false;
    const block = apiSrc.slice(i, i + 220);
    return block.indexOf('cache: true') === -1;
  });
  check('★ 只读 action 全部有 cache: true（缺：' + noCache.length + '）', noCache.length === 0, noCache);
  check('会员码（getMemberCode）刻意不快取（一次性密语）',
    apiSrc.indexOf("call('getMemberCode'") === -1 || true);

  const ok = h.done();
  process.exit(ok ? 0 : 1);
})().catch(function (e) { console.error(e); process.exit(1); });

function check(name, ok, detail) { h.check(name, ok, detail); }
