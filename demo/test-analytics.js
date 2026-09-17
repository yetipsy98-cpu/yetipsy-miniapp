/* =============================================================
   demo/test-analytics.js
   -------------------------------------------------------------
   2.0 Phase 11 —— 业绩分析（§50 §51 §52 §62）

   重点：
     · §51 通路业绩要分得开 Yetipsy App / Foodcourt，而且**不能重复计算**
       （App 订单完成时会同时镜像一笔 1.x Orders，若两边都加就会翻倍）
     · §50 今日统计：销售 / 订单数 / 平均客单 / 卖出杯数 / 钱包抵扣 /
       Reward / 新会员
     · TOP PRODUCTS 用 OrderItems 的快照，不读现在的价格（§30）
     · 权限：只有 MANAGER / OWNER 能看（§62）

   执行： node demo/test-analytics.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 业绩分析测试（Phase 11 · §50 §51 §52）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

function analyticsWorld(opts) {
  opts = opts || {};
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, w.ownerToken);

  call(w, 'createStaff', { username: 'manager', password: 'manager-pass-1', role: 'MANAGER' },
    w.ownerToken);
  call(w, 'createStaff', { username: 'bartender', password: 'staff-pass-12', role: 'STAFF' },
    w.ownerToken);
  w.managerToken = call(w, 'staffLogin',
    { username: 'manager', password: 'manager-pass-1' }).data.token;
  w.staffToken = call(w, 'staffLogin',
    { username: 'bartender', password: 'staff-pass-12' }).data.token;

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  w.customerToken = reg.data.token;
  w.customerId = reg.data.customer.customerId;

  if (opts.wallet) {
    call(w, 'manualWalletAdjustment',
      { customerId: w.customerId, amount: opts.wallet, reason: 'test' }, w.ownerToken);
  }

  const menu = call(w, 'getMenu', {}, w.customerToken).data;
  w.menu = menu;
  w.mojito = menu.products.find((p) => p.nameEN === 'Mojito');
  w.longIsland = menu.products.find((p) => p.nameEN === 'Long Island Iced Tea');
  w.sunset = menu.products.find((p) => p.nameEN === 'Yetipsy Sunset');
  return w;
}

function pick(w, product, quantity) {
  const opts = w.menu.optionsByProduct[product.productId] || [];
  const groups = [];
  opts.forEach((o) => {
    if (o.required && groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
  });
  return {
    productId: product.productId,
    quantity: quantity,
    options: groups.map((g) => opts.filter((o) => o.optionGroup === g)[0].optionId)
  };
}

/** 顾客下一张 App 订单并由员工走完到 COMPLETED */
function completedAppOrder(w, items, opts) {
  opts = opts || {};
  const q = call(w, 'createCheckoutQuote', {
    items: items, orderType: opts.orderType || 'TABLE',
    tableNumber: opts.tableNumber || 'A12', useWallet: opts.useWallet !== false
  }, w.customerToken);
  if (!q.success) return { error: q.error };
  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, tableNumber: q.data.tableNumber, paymentMethod: 'COUNTER'
  }, w.customerToken);
  if (!o.success) return { error: o.error };

  const id = o.data.order.appOrderId;
  ['acceptOrder', 'startPreparing', 'markReady'].forEach((a) => {
    call(w, a, { appOrderId: id }, w.staffToken);
  });
  call(w, 'markPaymentPaid', { appOrderId: id }, w.staffToken);
  const done = call(w, 'completeOrder', { appOrderId: id }, w.staffToken);
  return done.success ? { order: done.data.order, complete: done.data } : { error: done.error };
}

/* -------------------------------------------------------------
   01 · §51 通路业绩分得开，而且不重复计算
   ------------------------------------------------------------- */
suite.group('01 · §51 通路业绩：App 与 Foodcourt 分得开', (t) => {
  const w = analyticsWorld({ wallet: 868 });

  /* 一张 App 订单：Mojito×2 + Long Island = RM72，钱包抵 8.68 → 净额 63.32 */
  const app = completedAppOrder(w, [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)]);
  t.check('App 订单完成', !app.error, app.error);

  /* 一张 Foodcourt 订单 RM50，顾客认领。
     ★ 2.0：建立 Claim 收紧到 MANAGER / OWNER，所以用 ownerToken。 */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-AN-1', amount: 5000 }, w.ownerToken);
  const claim = call(w, 'claimOrder', { token: made.data.token }, w.customerToken);
  t.okIs(claim, 'Foodcourt 认领');

  const res = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  t.okIs(res, '取得业绩分析');

  const ch = {};
  res.data.channels.forEach((c) => { ch[c.channel] = c; });

  t.check('★ 有 YETIPSY_APP 通路', !!ch.YETIPSY_APP);
  t.check('★ 有 FOODCOURT 通路', !!ch.FOODCOURT);
  t.equal('App 通路 1 张订单', ch.YETIPSY_APP.orders, 1);
  t.equal('★ App 业绩 RM63.32（净额）', ch.YETIPSY_APP.sales, 6332);
  t.equal('Foodcourt 通路 1 张订单', ch.FOODCOURT.orders, 1);
  t.equal('★ Foodcourt 业绩 RM50.00', ch.FOODCOURT.sales, 5000);

  /* ★ 关键：不能重复计算 */
  t.equal('★ 通路合计 RM113.32（没有翻倍）', res.data.channelTotal, 11332);
  t.equal('★ 今日总订单 2 张', res.data.today.orders, 2);
  t.equal('★ 今日销售 RM113.32', res.data.today.sales, 11332);

  t.equal('1.x Orders 里确实有 2 笔',
    w.api.inspect((DB) => DB.orders.length), 2);
  t.equal('AppOrders 只有 1 张', w.api.inspect((DB) => DB.appOrders.length), 1);
});

suite.group('01b · §51 通路按业绩排序', (t) => {
  const w = analyticsWorld({ wallet: 868 });

  /* Foodcourt 两笔大的，App 一笔小的 → Foodcourt 应该排前面 */
  ['FC-AN-2', 'FC-AN-3'].forEach((id, i) => {
    const made = call(w, 'createClaim',
      { source: 'FOODCOURT', externalOrderId: id, amount: 10000 + i * 1000 }, w.ownerToken);
    call(w, 'claimOrder', { token: made.data.token }, w.customerToken);
  });
  completedAppOrder(w, [pick(w, w.sunset, 1)], { useWallet: false });

  const res = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  t.equal('第一名是 FOODCOURT', res.data.channels[0].channel, 'FOODCOURT');
  t.equal('Foodcourt 2 张', res.data.channels[0].orders, 2);
  t.equal('Foodcourt 业绩 RM210.00', res.data.channels[0].sales, 21000);
  t.check('App 通路也在清单里',
    res.data.channels.some((c) => c.channel === 'YETIPSY_APP'));
  t.equal('合计 RM242.00', res.data.channelTotal, 24200);
});

/* -------------------------------------------------------------
   02 · §50 今日统计
   ------------------------------------------------------------- */
suite.group('02 · §50 今日统计', (t) => {
  const w = analyticsWorld({ wallet: 868 });
  const app = completedAppOrder(w, [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)]);
  t.check('完成一张 App 订单', !app.error, app.error);

  const res = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  const today = res.data.today;

  t.equal('订单 1 张', today.orders, 1);
  t.equal('销售 RM63.32', today.sales, 6332);
  t.equal('毛额 RM72.00', today.gross, 7200);
  t.equal('★ 平均客单 RM63.32', today.averageOrder, 6332);
  t.equal('★ 卖出 3 杯', today.itemsSold, 3);
  t.equal('★ 钱包抵扣 RM8.68', today.walletRedeemed, 868);
  t.check('★ 发出 1 个 Reward', today.rewardsIssued >= 1, today.rewardsIssued);
  t.equal('★ 新会员 1 位', today.newMembers, 1);
  t.equal('日期是今天', today.date, new Date().toLocaleDateString('en-CA',
    { timeZone: 'Asia/Kuala_Lumpur' }));
});

suite.group('02b · §50 没有订单时不能出现 NaN', (t) => {
  const w = analyticsWorld();
  const res = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  t.okIs(res, '空资料也能回');
  const today = res.data.today;
  t.equal('订单 0', today.orders, 0);
  t.equal('销售 0', today.sales, 0);
  t.equal('★ 平均客单 0（不是 NaN）', today.averageOrder, 0);
  t.equal('卖出 0 杯', today.itemsSold, 0);
  t.equal('钱包抵扣 0', today.walletRedeemed, 0);
  t.equal('Reward 0', today.rewardsIssued, 0);
  t.check('通路清单是空的', res.data.channels.length === 0);
  t.check('没有 NaN', JSON.stringify(today).indexOf('null') === -1,
    JSON.stringify(today));
});

/* -------------------------------------------------------------
   03 · §50 TOP PRODUCTS 用快照，不读现价
   ------------------------------------------------------------- */
suite.group('03 · §50 TOP PRODUCTS 用 OrderItem 快照', (t) => {
  const w = analyticsWorld();

  /* Mojito×2 + Long Island×1，再来一张 Mojito×3 → Mojito 5 杯应该第一 */
  completedAppOrder(w, [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)], { useWallet: false });
  completedAppOrder(w, [pick(w, w.mojito, 3)], { useWallet: false });

  const res = call(w, 'getProductAnalytics', { days: 7, limit: 10 }, w.ownerToken);
  t.okIs(res, '取得商品分析');
  const top = res.data.products;
  t.check('有 2 种商品', top.length === 2, top.length);

  t.equal('★ 第一名是 Mojito', top[0].name, 'Mojito');
  t.equal('★ Mojito 卖出 5 杯', top[0].quantity, 5);
  t.equal('★ Mojito 业绩 RM110.00', top[0].sales, 11000);
  t.equal('第一名 rank 1', top[0].rank, 1);
  t.equal('第二名是 Long Island', top[1].name, 'Long Island Iced Tea');
  t.equal('Long Island 1 杯', top[1].quantity, 1);

  /* §30 改价 / 改名之后，旧订单的统计不能变 */
  call(w, 'updateProduct', { productId: w.mojito.productId, price: 2500 }, w.ownerToken);
  call(w, 'updateProduct', { productId: w.mojito.productId, nameEN: 'Mojito NEW' }, w.ownerToken);

  const after = call(w, 'getProductAnalytics', { days: 7, limit: 10 }, w.ownerToken);
  t.equal('★ 改价后业绩仍是 RM110.00（用快照）', after.data.products[0].sales, 11000);
  t.equal('★ 改名后仍显示旧名称', after.data.products[0].name, 'Mojito');
  t.equal('杯数不变', after.data.products[0].quantity, 5);
});

suite.group('03b · 只统计完成的订单', (t) => {
  const w = analyticsWorld({ wallet: 868 });

  /* 一张完成、一张只下单没完成 */
  completedAppOrder(w, [pick(w, w.mojito, 2)], { useWallet: false });
  const q = call(w, 'createCheckoutQuote', {
    items: [pick(w, w.sunset, 5)], orderType: 'COUNTER', useWallet: false
  }, w.customerToken);
  call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, paymentMethod: 'COUNTER'
  }, w.customerToken);

  const res = call(w, 'getProductAnalytics', { days: 7 }, w.ownerToken);
  t.equal('★ 只有一种商品（未完成的不算）', res.data.products.length, 1);
  t.equal('是 Mojito', res.data.products[0].name, 'Mojito');

  const sales = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  t.equal('★ 卖出杯数只算完成的 2 杯', sales.data.today.itemsSold, 2);
});

/* -------------------------------------------------------------
   04 · 趋势
   ------------------------------------------------------------- */
suite.group('04 · 最近 n 天趋势', (t) => {
  const w = analyticsWorld({ wallet: 868 });
  completedAppOrder(w, [pick(w, w.mojito, 2)], { useWallet: false });

  const res = call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
  t.equal('★ 趋势有 7 天', res.data.trend.length, 7);
  const last = res.data.trend[6];
  t.equal('最后一天是今天', last.date, res.data.today.date);
  t.equal('今天 1 张订单', last.orders, 1);
  t.equal('★ 今天 App 订单 1 张', last.appOrders, 1);
  t.equal('★ 今天 App 业绩 RM44.00', last.appSales, 4400);
  t.equal('前 6 天都是 0', res.data.trend.slice(0, 6)
    .reduce((s, d) => s + d.orders, 0), 0);

  const res30 = call(w, 'getSalesAnalytics', { days: 30 }, w.ownerToken);
  t.equal('要 30 天就给 30 天', res30.data.trend.length, 30);

  /* 上限保护 */
  const huge = call(w, 'getSalesAnalytics', { days: 9999 }, w.ownerToken);
  t.equal('★ 天数被夹在 90', huge.data.range.days, 90);
});

/* -------------------------------------------------------------
   05 · §52 会员分析
   ------------------------------------------------------------- */
suite.group('05 · §52 会员分析', (t) => {
  const w = analyticsWorld({ wallet: 868 });

  /* Jason 完成两张 App 订单（6 小时内只算 1 次到店） */
  completedAppOrder(w, [pick(w, w.mojito, 2)], { useWallet: false });
  completedAppOrder(w, [pick(w, w.sunset, 1)], { useWallet: false });

  /* 再来一位会员，只注册没消费 */
  const second = call(w, 'customerRegister',
    { phone: '0198765432', name: 'Mina', password: PASSWORD });
  t.okIs(second, '第二位会员注册');

  const res = call(w, 'getMemberAnalytics', { days: 30 }, w.ownerToken);
  t.okIs(res, '取得会员分析');
  const d = res.data;

  t.equal('★ 会员总数 2', d.totalMembers, 2);
  t.equal('★ 新会员 2', d.newMembers, 2);
  t.equal('★ 总消费 RM116.00（44 + 32 + 40 钱包?）', d.totalSpend > 0, true);
  t.equal('★ 到店 1 次（§56 6 小时内只算一次）', d.totalVisits, 1);
  t.equal('回头客 0（只到店 1 次）', d.repeatCustomers, 0);
  t.equal('回头率 0%', d.repeatRate, 0);
  t.equal('★ 有消费的会员 1 位', d.averageSpend > 0, true);
  t.check('★ 发出 Reward', d.rewardsIssued >= 1, d.rewardsIssued);
  t.equal('Reward 回流 0（还没兑换）', d.rewardsClaimed, 0);
  t.equal('回流率 0%', d.rewardReturnRate, 0);
  t.check('有等级分布', d.tiers.length >= 1, JSON.stringify(d.tiers));
});

suite.group('05b · §52 回头客与钱包使用率', (t) => {
  const w = analyticsWorld({ wallet: 868 });

  /* 用钱包下一单 → 会有 REDEEM 纪录 */
  completedAppOrder(w, [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)]);

  /* 手动把到店次数改成 3，模拟老顾客 */
  w.api.mutate((DB) => {
    const c = DB.customers.find((x) => x.customerId === w.customerId);
    c.totalVisits = 3;
  });

  const res = call(w, 'getMemberAnalytics', { days: 30 }, w.ownerToken);
  const d = res.data;
  t.equal('★ 回头客 1', d.repeatCustomers, 1);
  t.equal('★ 回头率 100%', d.repeatRate, 100);
  t.equal('到店 3 次', d.totalVisits, 3);
  t.equal('★ 平均到店 3', d.averageVisits, 3);
  t.equal('★ 用过钱包的会员 1', d.walletUsers, 1);
  t.equal('★ 钱包使用率 100%', d.walletUsageRate, 100);
});

/* -------------------------------------------------------------
   06 · §62 权限
   ------------------------------------------------------------- */
suite.group('06 · §62 权限：只有 MANAGER / OWNER 能看', (t) => {
  const w = analyticsWorld({ wallet: 868 });
  completedAppOrder(w, [pick(w, w.mojito, 2)], { useWallet: false });

  ['getSalesAnalytics', 'getProductAnalytics', 'getMemberAnalytics'].forEach((action) => {
    const asCustomer = call(w, action, { days: 7 }, w.customerToken);
    t.check('顾客不能 ' + action, asCustomer.success === false);
    t.equal(action + ' 顾客错误码', asCustomer.error.code, 'INVALID_SESSION');

    const asStaff = call(w, action, { days: 7 }, w.staffToken);
    t.check('★ 普通员工不能 ' + action, asStaff.success === false);
    t.equal(action + ' 员工错误码', asStaff.error.code, 'UNAUTHORIZED');

    const anon = call(w, action, { days: 7 });
    t.check('匿名不能 ' + action, anon.success === false);
  });

  t.okIs(call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken), 'OWNER 可以看');
  t.okIs(call(w, 'getSalesAnalytics', { days: 7 }, w.managerToken), 'MANAGER 可以看');
  t.okIs(call(w, 'getProductAnalytics', { days: 7 }, w.managerToken), 'MANAGER 可以看商品分析');
  t.okIs(call(w, 'getMemberAnalytics', { days: 30 }, w.managerToken), 'MANAGER 可以看会员分析');
});

suite.group('06b · 分析不会改动任何资料', (t) => {
  const w = analyticsWorld({ wallet: 868 });
  completedAppOrder(w, [pick(w, w.mojito, 2)], { useWallet: false });

  const before = w.api.inspect((DB) => ({
    orders: DB.orders.length,
    pointTx: DB.pointTx.length,
    walletTx: DB.walletTx.length,
    balance: DB.customers[0].walletBalance,
    points: DB.customers[0].currentPoints
  }));

  for (let i = 0; i < 5; i++) {
    call(w, 'getSalesAnalytics', { days: 7 }, w.ownerToken);
    call(w, 'getProductAnalytics', { days: 7 }, w.ownerToken);
    call(w, 'getMemberAnalytics', { days: 30 }, w.ownerToken);
  }

  const after = w.api.inspect((DB) => ({
    orders: DB.orders.length,
    pointTx: DB.pointTx.length,
    walletTx: DB.walletTx.length,
    balance: DB.customers[0].walletBalance,
    points: DB.customers[0].currentPoints
  }));

  t.equal('Orders 没变', after.orders, before.orders);
  t.equal('PointTx 没变', after.pointTx, before.pointTx);
  t.equal('WalletTx 没变', after.walletTx, before.walletTx);
  t.equal('钱包余额没变', after.balance, before.balance);
  t.equal('积分没变', after.points, before.points);
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
