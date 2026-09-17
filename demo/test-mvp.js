/* =============================================================
   demo/test-mvp.js
   -------------------------------------------------------------
   ★ §84 MVP SUCCESS TEST —— 计划书最后那条现场验收流程，一步不漏跑一遍。

     Jason Login
       → MENU
       → Mojito RM22 ×2
       → Long Island RM28
       → CART RM72
       → Wallet RM8
       → Checkout → Table A12 → PLACE ORDER
       → Staff receives → ACCEPT → PREPARING → READY → COMPLETED
       → Wallet deducted once
       → Points issued once
       → Visit counted once
       → Reward generated once
       → Jason opens reward
       → Wallet receives reward          ← 这一步是整条链的终点

     同时 Google Sheets 要正确产生：
       AppOrder · OrderItems · PointTransaction · WalletTransaction · AuditLog

   ★ §85 FOODCOURT TEST —— 升级后 Foodcourt 的 Create Claim → Claim →
     Points → Reward 必须照常运作，不允许 2.0 破坏 1.x。

   注意：这里用 §84 的钱包 RM8.00（不是 RM8.68），所以净额 RM64.00、
   积分 64 —— 正好对上 §57 举的例子。

   执行： node demo/test-mvp.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · §84 MVP 现场验收 + §85 Foodcourt 不破坏 1.x');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

/* =============================================================
   §84 MVP
   ============================================================= */

suite.group('§84 · Jason 的完整现场流程', (t) => {
  /* ---------- 准备一个刚升级完的世界 ---------- */
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  const ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, ownerToken);
  call(w, 'createStaff',
    { username: 'bartender', password: 'staff-pass-12', role: 'STAFF' }, ownerToken);
  const staffToken = call(w, 'staffLogin',
    { username: 'bartender', password: 'staff-pass-12' }).data.token;

  /* ---------- Jason Login ---------- */
  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  t.okIs(reg, '① Jason 注册 / 登入');
  const jt = reg.data.token;
  const jasonId = reg.data.customer.customerId;
  t.equal('会员名 Jason', reg.data.customer.name, 'Jason');

  /* 钱包先有 RM8.00（§84 的数字） */
  t.okIs(call(w, 'manualWalletAdjustment',
    { customerId: jasonId, amount: 800, reason: 'top up' }, ownerToken), '钱包存入 RM8.00');
  t.equal('钱包余额 RM8.00', call(w, 'getWallet', {}, jt).data.balance, 800);

  /* ---------- MENU ---------- */
  const menu = call(w, 'getMenu', {}, jt);
  t.okIs(menu, '② MENU 载入');
  t.check('酒单有商品', menu.data.products.length >= 4, menu.data.products.length + ' 项');
  const mojito = menu.data.products.find((p) => p.nameEN === 'Mojito');
  const longIsland = menu.data.products.find((p) => p.nameEN === 'Long Island Iced Tea');
  t.equal('③ Mojito RM22.00', mojito.price, 2200);
  t.equal('③ Long Island RM28.00', longIsland.price, 2800);

  /* Mojito 有必选规格 SIZE */
  const opts = menu.data.optionsByProduct[mojito.productId] || [];
  const size = opts.filter((o) => o.optionGroup === 'SIZE' && o.required)[0];
  t.check('Mojito 有必选 SIZE', !!size);

  /* ---------- CART RM72 ---------- */
  const cart = [
    { productId: mojito.productId, quantity: 2, options: [size.optionId] },
    { productId: longIsland.productId, quantity: 1, options: [] }
  ];
  const cartTotal = mojito.price * 2 + longIsland.price * 1;
  t.equal('④ CART 小计 RM72.00', cartTotal, 7200);

  /* ---------- Checkout：Wallet RM8 + Table A12 ---------- */
  const q = call(w, 'createCheckoutQuote', {
    items: cart, orderType: 'TABLE', tableNumber: 'A12', useWallet: true
  }, jt);
  t.okIs(q, '⑤ Checkout 报价');
  t.equal('小计 RM72.00', q.data.subtotal, 7200);
  t.equal('⑥ 钱包抵扣 RM8.00', q.data.wallet.applied, 800);
  t.equal('★ 应付 RM64.00', q.data.finalAmount, 6400);
  t.equal('★ §57 积分 64（净额 RM64）', q.data.estimatedPoints, 64);
  t.equal('桌号 A12', q.data.tableNumber, 'A12');

  /* ---------- PLACE ORDER ---------- */
  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken,
    idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType,
    tableNumber: q.data.tableNumber,
    paymentMethod: 'COUNTER'
  }, jt);
  t.okIs(o, '⑦ PLACE ORDER');
  const appOrderId = o.data.order.appOrderId;
  t.equal('订单号格式 YT260917001', o.data.order.orderNumber, 'YT260917001');
  t.equal('状态 SUBMITTED', o.data.order.orderStatus, 'SUBMITTED');
  t.equal('付款 UNPAID', o.data.order.paymentStatus, 'UNPAID');
  t.equal('桌号写进订单', o.data.order.tableNumber, 'A12');
  t.equal('钱包只是「要求」，还没扣', o.data.order.walletUsed, 0);

  /* ---------- Staff receives ---------- */
  const board = call(w, 'getIncomingOrders', {}, staffToken);
  t.okIs(board, '⑧ Staff 收到订单');
  t.equal('NEW 栏看到 1 张', board.data.count, 1);
  t.equal('是 Jason 的订单', board.data.orders[0].customer.name, 'Jason');

  /* ---------- ACCEPT → PREPARING → READY → COMPLETED ---------- */
  t.equal('⑨ ACCEPT → CONFIRMED',
    call(w, 'acceptOrder', { appOrderId: appOrderId }, staffToken).data.order.orderStatus,
    'CONFIRMED');
  t.equal('⑩ PREPARING',
    call(w, 'startPreparing', { appOrderId: appOrderId }, staffToken).data.order.orderStatus,
    'PREPARING');
  t.equal('⑪ READY',
    call(w, 'markReady', { appOrderId: appOrderId }, staffToken).data.order.orderStatus,
    'READY');

  const pay = call(w, 'markPaymentPaid', { appOrderId: appOrderId }, staffToken);
  t.okIs(pay, '⑫ 确认收款');
  t.equal('★ 收款时才扣钱包 RM8.00', pay.data.walletUsed, 800);

  const done = call(w, 'completeOrder', { appOrderId: appOrderId }, staffToken);
  t.okIs(done, '⑬ COMPLETED');
  t.equal('订单状态 COMPLETED', done.data.order.orderStatus, 'COMPLETED');

  /* ---------- 四个「只有一次」 ---------- */
  t.equal('★ Wallet deducted once：余额 0', call(w, 'getWallet', {}, jt).data.balance, 0);
  t.equal('★ Points issued once：64 分', done.data.pointsIssued, 64);
  t.equal('★ Visit counted once', done.data.visitCounted, true);
  t.check('★ Reward generated once', !!done.data.reward, JSON.stringify(done.data.reward));

  const prof = call(w, 'getProfile', {}, jt).data.customer;
  t.equal('会员积分 64', prof.currentPoints, 64);
  t.equal('★ 到店只有 1 次', prof.totalVisits, 1);
  t.equal('总消费 RM72.00', prof.totalSpend, 7200);
  t.equal('Reward 数 1', prof.totalRewards, 1);

  const rewardId = done.data.reward.rewardId;
  const rewardAmount = done.data.reward.amount;
  t.check('Reward 有金额', rewardAmount > 0, rewardAmount);

  /* ---------- Jason opens reward → Wallet receives reward ---------- */
  const before = call(w, 'getWallet', {}, jt).data.balance;
  t.equal('开 Reward 前钱包是 0', before, 0);

  const claimed = call(w, 'claimReward', { rewardId: rewardId }, jt);
  t.okIs(claimed, '⑭ Jason 打开 Reward');
  t.equal('★ Wallet receives reward：余额 = Reward 金额',
    call(w, 'getWallet', {}, jt).data.balance, rewardAmount);

  /* 重复打开不会再进帐 */
  const again = call(w, 'claimReward', { rewardId: rewardId }, jt);
  t.check('重复打开被挡', again.success === false);
  t.equal('错误码 REWARD_ALREADY_CLAIMED', again.error.code, 'REWARD_ALREADY_CLAIMED');
  t.equal('★ 钱包没有进帐两次', call(w, 'getWallet', {}, jt).data.balance, rewardAmount);

  /* ---------- Google Sheets 要正确产生这几张表 ---------- */
  const db = w.api.inspect((DB) => ({
    appOrders: DB.appOrders,
    orderItems: DB.orderItems,
    pointTx: DB.pointTx,
    walletTx: DB.walletTx,
    audit: DB.audit,
    rewards: DB.rewards,
    orders: DB.orders,
    customers: DB.customers
  }));

  t.equal('★ AppOrder 1 张', db.appOrders.length, 1);
  t.equal('★ OrderItems 2 笔', db.orderItems.length, 2);
  t.equal('★ PointTransaction 1 笔', db.pointTx.length, 1);
  t.equal('★ 积分流水 64 分', db.pointTx[0].points, 64);
  /* TOPUP + REDEEM + REWARD = 3 笔 */
  t.equal('★ WalletTransaction 3 笔（存入 / 抵扣 / Reward）', db.walletTx.length, 3);
  t.check('有一笔 REDEEM（抵扣 RM8.00）',
    db.walletTx.some((x) => x.type === 'REDEEM' && x.amount === -800));
  t.check('有一笔 REWARD（进帐）',
    db.walletTx.some((x) => x.type === 'REWARD' && x.amount === rewardAmount));
  t.equal('★ Rewards 1 笔且已兑换', db.rewards[0].status, 'CLAIMED');
  t.equal('★ 1.x Orders 也有一笔（通路业绩）', db.orders.length, 1);
  t.equal('通路标记 YETIPSY_APP', db.orders[0].orderSource, 'YETIPSY_APP');
  t.check('★ AuditLog 有记录', db.audit.length >= 5, db.audit.length + ' 笔');

  const actions = db.audit.map((a) => a.action);
  ['PLACE_ORDER', 'ACCEPT_ORDER', 'START_PREPARING', 'MARK_READY',
   'MARK_PAYMENT_PAID', 'COMPLETE_ORDER', 'ISSUE_POINTS', 'ISSUE_REWARD', 'CLAIM_REWARD']
    .forEach((name) => t.check('审计有 ' + name, actions.indexOf(name) >= 0));

  /* 品项快照（§30） */
  const mojitoItem = db.orderItems.find((it) => it.productId === mojito.productId);
  t.equal('快照名称 Mojito', mojitoItem.productNameSnapshot, 'Mojito');
  t.equal('快照单价 RM22.00', mojitoItem.unitPriceSen, 2200);
  t.equal('数量 2', mojitoItem.quantity, 2);
  t.equal('小计 RM44.00', mojitoItem.lineTotalSen, 4400);

  /* 会员资料 */
  t.equal('会员积分写进资料库', db.customers[0].currentPoints, 64);
  t.equal('钱包余额写进资料库', db.customers[0].walletBalance, rewardAmount);
});

/* =============================================================
   §85 FOODCOURT TEST
   ============================================================= */

suite.group('§85 · Foodcourt 认领照常运作（不破坏 1.x）', (t) => {
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  const ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, ownerToken);

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  const jt = reg.data.token;

  /* ---- Foodcourt Order → Existing Create Claim ---- */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC8231', amount: 8600 }, ownerToken);
  t.okIs(made, '① 员工建立 Foodcourt Claim（1.x 功能）');
  t.equal('金额 RM86.00', made.data.amount, 8600);
  t.equal('Claim Code 4 位', made.data.claimCode.length, 4);

  /* ---- Customer Claim ---- */
  const claim = call(w, 'claimOrder', { token: made.data.token }, jt);
  t.okIs(claim, '② 顾客认领');
  t.equal('③ Points 发放', claim.data.pointsEarned, 86);
  t.check('④ Reward 产生', !!claim.data.reward, JSON.stringify(claim.data.reward));

  const prof = call(w, 'getProfile', {}, jt).data.customer;
  t.equal('积分 86', prof.currentPoints, 86);
  t.equal('到店 1 次', prof.totalVisits, 1);
  t.equal('总消费 RM86.00', prof.totalSpend, 8600);

  /* ---- 1.x 的其他功能也照常 ---- */
  t.okIs(call(w, 'getMemberCode', {}, jt), '会员条码照常可用');
  t.okIs(call(w, 'getWallet', {}, jt), '钱包页照常可用');
  t.okIs(call(w, 'getOrderHistory', {}, jt), '消费记录照常可用');
  t.okIs(call(w, 'getPoints', {}, jt), '积分页照常可用');
  t.okIs(call(w, 'getPendingReward', {}, jt), 'Reward 页照常可用');
  t.okIs(call(w, 'getProfile', {}, jt), '会员页照常可用');

  /* ---- Reward 兑换也照常（getPendingReward 回传单一物件，不是清单） ---- */
  const pending = call(w, 'getPendingReward', {}, jt).data;
  t.check('有可兑换的 Reward', !!pending.reward, JSON.stringify(pending));
  const claimed = call(w, 'claimReward', { rewardId: pending.reward.rewardId }, jt);
  t.okIs(claimed, 'Foodcourt 的 Reward 也能兑换进钱包');
  /* getPendingReward 刻意不回传金额（避免前端显示未经确认的数字），
     金额要从 claimReward 的回传或资料库拿 */
  t.check('Reward 有金额', claimed.data.amount > 0, claimed.data.amount);
  t.equal('★ 钱包收到 Reward 全额',
    call(w, 'getWallet', {}, jt).data.balance, claimed.data.amount);
  t.equal('claimReward 回传的余额一致',
    claimed.data.walletBalance, claimed.data.amount);
  t.equal('兑换后没有待领 Reward',
    call(w, 'getPendingReward', {}, jt).data.reward, null);

  /* ---- 1.x 的表没有被 2.0 动过 ---- */
  const db = w.api.inspect((DB) => ({
    claims: DB.claims,
    orders: DB.orders,
    pointTx: DB.pointTx,
    walletTx: DB.walletTx,
    appOrders: DB.appOrders
  }));
  t.equal('Claims 1 笔', db.claims.length, 1);
  t.equal('1.x Orders 1 笔', db.orders.length, 1);
  t.equal('通路是 FOODCOURT', db.orders[0].orderSource, 'FOODCOURT');
  t.equal('PointTx 1 笔', db.pointTx.length, 1);
  t.equal('WalletTx 1 笔（Reward 进帐）', db.walletTx.length, 1);
  t.equal('AppOrders 0 张（没走点单流程）', db.appOrders.length, 0);
});

/* =============================================================
   §86 两条通路并存，共用同一套会员引擎
   ============================================================= */

suite.group('§86 · 两条通路并存（Foodcourt + Yetipsy App）', (t) => {
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  const ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, ownerToken);

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  const jt = reg.data.token;

  /* 通路 A：Foodcourt RM50 */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-1', amount: 5000 }, ownerToken);
  const claim = call(w, 'claimOrder', { token: made.data.token }, jt);
  t.equal('Foodcourt 得 50 分', claim.data.pointsEarned, 50);

  /* 通路 B：Yetipsy App RM32（Yetipsy Sunset） */
  const menu = call(w, 'getMenu', {}, jt).data;
  const sunset = menu.products.find((p) => p.nameEN === 'Yetipsy Sunset');
  const sunsetOpts = menu.data ? [] : [];
  const req = (menu.optionsByProduct[sunset.productId] || [])
    .filter((o) => o.required);
  const groups = [];
  req.forEach((o) => { if (groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup); });

  const q = call(w, 'createCheckoutQuote', {
    items: [{
      productId: sunset.productId, quantity: 1,
      options: groups.map((g) => req.filter((o) => o.optionGroup === g)[0].optionId)
    }],
    orderType: 'COUNTER', useWallet: false
  }, jt);
  t.okIs(q, 'App 报价');
  t.equal('Yetipsy Sunset RM32.00', q.data.subtotal, 3200);

  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, paymentMethod: 'COUNTER'
  }, jt);
  t.okIs(o, 'App 下单');
  const id = o.data.order.appOrderId;
  ['acceptOrder', 'startPreparing', 'markReady'].forEach((a) => {
    call(w, a, { appOrderId: id }, ownerToken);
  });
  call(w, 'markPaymentPaid', { appOrderId: id }, ownerToken);
  const done = call(w, 'completeOrder', { appOrderId: id }, ownerToken);
  t.okIs(done, 'App 完成');
  t.equal('App 得 32 分', done.data.pointsIssued, 32);

  /* 两条通路共用同一个会员引擎 */
  const prof = call(w, 'getProfile', {}, jt).data.customer;
  t.equal('★ 积分累加 50 + 32 = 82', prof.currentPoints, 82);
  t.equal('★ §56 6 小时内只算 1 次到店', prof.totalVisits, 1);
  t.equal('★ 总消费 RM82.00', prof.totalSpend, 8200);

  /* 通路业绩分得开 */
  const an = call(w, 'getSalesAnalytics', { days: 7 }, ownerToken);
  const ch = {};
  an.data.channels.forEach((c) => { ch[c.channel] = c; });
  t.equal('★ Foodcourt 业绩 RM50.00', ch.FOODCOURT.sales, 5000);
  t.equal('★ Yetipsy App 业绩 RM32.00', ch.YETIPSY_APP.sales, 3200);
  t.equal('★ 合计 RM82.00（没重复计算）', an.data.channelTotal, 8200);

  const db = w.api.inspect((DB) => DB.orders.map((r) => r.orderSource).sort());
  t.equal('1.x Orders 2 笔', db.length, 2);
  t.equal('一笔 FOODCOURT', db[0], 'FOODCOURT');
  t.equal('一笔 YETIPSY_APP', db[1], 'YETIPSY_APP');
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
