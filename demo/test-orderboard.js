/* =============================================================
   demo/test-orderboard.js
   -------------------------------------------------------------
   2.0 Phase 7 验收测试 —— 员工订单看板
   （§12 §16 §19 §20 §21 §22 §24 §46 §49 §50 §51 §54 §55 §56 §57 §58 §65 §77）

   重点是 §12 安全审计里跟订单有关的每一项：
     · Complete Unpaid Order   → 未收款不能完成
     · Double Complete Order   → 连按两次不会发两次积分（§55）
     · Unauthorized Completion → 顾客 token 动不了员工 action
     · Wallet Reuse / 余额     → 下单只记录、收款才扣、取消要退回（§54）
     · Visit 灌水              → 6 小时内多张订单只算 1 次到店（§56）

   执行： node demo/test-orderboard.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 员工订单看板测试（Phase 7 · §12 §54 §55 §56）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

/**
 * 建一个可以下单 + 有员工的世界。
 * 营业时间预设 18:30–00:00，测试多半在白天跑，所以放开成全天。
 */
function boardWorld(opts) {
  opts = opts || {};
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());

  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, w.ownerToken);

  /* 一名经理、一名普通员工（§12 权限测试用） */
  w.managerToken = w.ownerToken;
  call(w, 'createStaff', { username: 'manager', password: 'manager-pass-1', role: 'MANAGER' },
    w.ownerToken);
  call(w, 'createStaff', { username: 'bartender', password: 'staff-pass-12', role: 'STAFF' },
    w.ownerToken);
  w.managerLogin = call(w, 'staffLogin',
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

/**
 * Mojito 这类商品有必选规格（SIZE），漏选后端会回 OPTION_REQUIRED。
 * 这里自动挑每个必选类别的第一个选项（Regular），省得测试写死 optionId。
 */
function pick(w, product, quantity) {
  const opts = w.menu.optionsByProduct[product.productId] || [];
  const groups = [];
  opts.forEach((o) => {
    if (o.required && groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
  });
  const chosen = groups.map((g) => opts.filter((o) => o.optionGroup === g)[0].optionId);
  return { productId: product.productId, quantity: quantity, options: chosen };
}

/** §84 的那一车：Mojito ×2 + Long Island ×1 = RM72 */
function mvpCart(w) {
  return [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)];
}

/** 顾客下一张单 */
function place(w, opts) {
  opts = opts || {};
  const q = call(w, 'createCheckoutQuote', {
    items: opts.items || mvpCart(w),
    orderType: opts.orderType || 'TABLE',
    tableNumber: opts.tableNumber || 'A12',
    useWallet: opts.useWallet !== false
  }, w.customerToken);
  if (!q.success) return { error: q.error };
  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken,
    idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType,
    tableNumber: q.data.tableNumber,
    paymentMethod: 'COUNTER'
  }, w.customerToken);
  return o.success ? { order: o.data.order, quote: q.data } : { error: o.error };
}

/**
 * 员工把订单推到某个状态（COMPLETED 会先收款）。
 * 从订单「目前」的状态往后推，已经走过的步骤不重跑
 * （重跑 acceptOrder 会因为状态机而失败）。
 */
function advance(w, appOrderId, target, token) {
  token = token || w.staffToken;
  const path = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];
  const act = { CONFIRMED: 'acceptOrder', PREPARING: 'startPreparing',
                READY: 'markReady', COMPLETED: 'completeOrder' };
  const cur = w.api.inspect((DB) => {
    const row = DB.appOrders.find((o) => o.appOrderId === appOrderId);
    return row ? row.orderStatus : '';
  });
  let last = null;
  for (let i = path.indexOf(cur) + 1; i <= path.indexOf(target); i++) {
    if (path[i] === 'COMPLETED') {
      const pay = call(w, 'markPaymentPaid', { appOrderId: appOrderId }, token);
      if (!pay.success) return { error: pay.error };
    }
    last = call(w, act[path[i]], { appOrderId: appOrderId }, token);
    if (!last.success) return { error: last.error };
  }
  return { result: last };
}

const profileOf = (w) => call(w, 'getProfile', {}, w.customerToken).data.customer;
const balanceOf = (w) => call(w, 'getWallet', {}, w.customerToken).data.balance;

/* -------------------------------------------------------------
   01 · §84 完整流程
   ------------------------------------------------------------- */
suite.group('01 · §84 下单 → 接单 → 制作 → 完成 → 积分 / Reward / Visit', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);

  t.equal('下单后 SUBMITTED', order.orderStatus, 'SUBMITTED');
  t.equal('§22 还没发积分', profileOf(w).currentPoints, 0);
  t.equal('§22 还没算到店', profileOf(w).totalVisits, 0);

  const a = call(w, 'acceptOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(a, '员工可以接单');
  t.equal('CONFIRMED', a.data.order.orderStatus, 'CONFIRMED');

  const p = call(w, 'startPreparing', { appOrderId: order.appOrderId }, w.staffToken);
  t.equal('PREPARING', p.data.order.orderStatus, 'PREPARING');

  const r = call(w, 'markReady', { appOrderId: order.appOrderId }, w.staffToken);
  t.equal('READY', r.data.order.orderStatus, 'READY');

  const pay = call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(pay, '确认收款');
  t.equal('付款状态 PAID', pay.data.order.paymentStatus, 'PAID');
  t.equal('§54 收款时才扣钱包 RM8.68', pay.data.walletUsed, 868);
  t.equal('钱包余额已扣为 0', balanceOf(w), 0);

  const c = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(c, '完成订单');
  t.equal('COMPLETED', c.data.order.orderStatus, 'COMPLETED');
  t.equal('不是重复完成', c.data.alreadyCompleted, false);
  t.equal('§57 按净额算积分 63', c.data.pointsIssued, 63);
  t.equal('§56 这次算 1 次到店', c.data.visitCounted, true);
  t.check('§58 产生 Reward', !!c.data.reward);

  const prof = profileOf(w);
  t.equal('积分 63', prof.currentPoints, 63);
  t.equal('到店 1 次', prof.totalVisits, 1);
  t.equal('总消费 RM72.00', prof.totalSpend, 7200);

  const od = call(w, 'getAppOrder', { appOrderId: order.appOrderId }, w.customerToken).data.order;
  t.equal('订单上记录积分', od.pointsEarned, 63);
  t.equal('订单上记录钱包已用', od.walletUsed, 868);
});

/* -------------------------------------------------------------
   02 · §55 幂等完成
   ------------------------------------------------------------- */
suite.group('02 · §55 completeOrder 幂等（连按两次不会发两次）', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);
  const to = advance(w, order.appOrderId, 'READY');
  t.check('推到 READY', !to.error, to.error);
  t.okIs(call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken), '收款');

  const first = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.equal('第一次完成发 63 分', first.data.pointsIssued, 63);

  const second = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(second, '第二次呼叫不报错（幂等）');
  t.equal('第二次回报已完成', second.data.alreadyCompleted, true);
  t.equal('第二次不再发积分', second.data.pointsIssued, 0);
  t.equal('第二次不再算到店', second.data.visitCounted, false);
  t.equal('第二次没有 Reward', second.data.reward, null);

  const prof = profileOf(w);
  t.equal('积分只有一次 63', prof.currentPoints, 63);
  t.equal('到店只有一次', prof.totalVisits, 1);

  t.equal('PointTx 只有一笔',
    w.api.inspect((DB) => DB.pointTx.filter((x) => x.customerId === w.customerId).length), 1);
  t.equal('Rewards 只有一笔',
    w.api.inspect((DB) => DB.rewards.filter((x) => x.customerId === w.customerId).length), 1);
  t.equal('AppOrders 只有一列', w.api.inspect((DB) => DB.appOrders.length), 1);
  t.equal('1.x Orders 只有一笔', w.api.inspect((DB) => DB.orders.length), 1);
  t.equal('完成订单的审计只有一条',
    w.api.inspect((DB) => DB.audit.filter((a) => a.action === 'COMPLETE_ORDER').length), 1);
});

/* -------------------------------------------------------------
   03 · §54 钱包：记录 / 扣款 / 退回
   ------------------------------------------------------------- */
suite.group('03 · §54 钱包：下单只记录、收款才扣、未收款取消不用退', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);

  t.equal('下单后余额不变', balanceOf(w), 868);
  const od = call(w, 'getAppOrder', { appOrderId: order.appOrderId }, w.customerToken).data.order;
  t.equal('下单只记录 walletRequested', od.walletRequested, 868);
  t.equal('下单时 walletUsed 仍是 0', od.walletUsed, 0);

  const cancel = call(w, 'cancelAppOrder',
    { appOrderId: order.appOrderId, reason: 'Customer changed mind' }, w.staffToken);
  t.okIs(cancel, '员工可以取消');
  t.equal('状态 CANCELLED', cancel.data.order.orderStatus, 'CANCELLED');
  t.equal('没扣过就不用退', cancel.data.refunded, 0);
  t.equal('取消后余额仍是 RM8.68', balanceOf(w), 868);
  t.equal('没有多余的钱包流水',
    w.api.inspect((DB) => DB.walletTx.filter((x) => x.customerId === w.customerId).length), 1);
});

suite.group('03b · §54 已收款后取消 → REVERSAL 退回', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);
  advance(w, order.appOrderId, 'READY');
  const pay = call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken);
  t.equal('收款扣掉 RM8.68', pay.data.walletUsed, 868);
  t.equal('余额 0', balanceOf(w), 0);

  const cancel = call(w, 'cancelAppOrder',
    { appOrderId: order.appOrderId, reason: 'Item unavailable' }, w.staffToken);
  t.okIs(cancel, '员工可以取消已收款的订单');
  t.equal('退回 RM8.68', cancel.data.refunded, 868);
  t.equal('余额回到 RM8.68', balanceOf(w), 868);
  t.equal('付款状态改为 REFUNDED', cancel.data.order.paymentStatus, 'REFUNDED');

  const tx = w.api.inspect((DB) => DB.walletTx.filter((x) => x.customerId === w.customerId));
  t.equal('钱包流水共 3 笔', tx.length, 3);
  t.check('有一笔 REDEEM（扣款）', tx.some((x) => x.type === 'REDEEM'));
  t.check('有一笔 REVERSAL（退回）', tx.some((x) => x.type === 'REVERSAL'));

  const again = call(w, 'cancelAppOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.equal('重复取消回报已取消', again.data.alreadyCancelled, true);
  t.equal('重复取消不会退第二次', again.data.refunded, 0);
  t.equal('余额没有被退两次', balanceOf(w), 868);
});

/* -------------------------------------------------------------
   04 · §12 未收款不能完成订单
   ------------------------------------------------------------- */
suite.group('04 · §12 未收款不能完成订单', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);
  advance(w, order.appOrderId, 'READY');

  const c = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('未收款不能完成', c.success === false);
  t.equal('错误码 ORDER_NOT_PAID', c.error.code, 'ORDER_NOT_PAID');
  t.equal('没有发积分', profileOf(w).currentPoints, 0);
  t.equal('没有算到店', profileOf(w).totalVisits, 0);
  t.equal('订单还是 READY', w.api.inspect((DB) => DB.appOrders[0].orderStatus), 'READY');
  t.equal('没有写入 1.x Orders', w.api.inspect((DB) => DB.orders.length), 0);
});

/* -------------------------------------------------------------
   05 · §12 状态不能乱跳
   ------------------------------------------------------------- */
suite.group('05 · §12 状态不能乱跳', (t) => {
  const w = boardWorld();
  const { order } = place(w);

  const ready = call(w, 'markReady', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('SUBMITTED 不能直接变 READY', ready.success === false);
  t.equal('错误码 ORDER_STATUS_INVALID', ready.error.code, 'ORDER_STATUS_INVALID');

  const c = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('SUBMITTED 也不能直接完成', c.success === false);
  t.equal('错误码 ORDER_STATUS_INVALID', c.error.code, 'ORDER_STATUS_INVALID');

  t.okIs(call(w, 'acceptOrder', { appOrderId: order.appOrderId }, w.staffToken), '接单可以');
  const twice = call(w, 'acceptOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('不能重复接单', twice.success === false);
  t.equal('错误码 ORDER_STATUS_INVALID', twice.error.code, 'ORDER_STATUS_INVALID');
});

suite.group('05b · 已完成的订单不能再取消', (t) => {
  const w = boardWorld({ wallet: 868 });
  const { order } = place(w);
  advance(w, order.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken), '完成订单');

  const cancel = call(w, 'cancelAppOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('已完成的订单不能取消', cancel.success === false);
  t.equal('错误码 ORDER_ALREADY_FINAL', cancel.error.code, 'ORDER_ALREADY_FINAL');
  t.equal('积分没有被撤销', profileOf(w).currentPoints, 63);
});

suite.group('05c · SUBMITTED 可以一步跳到 PREPARING（看板实际用法）', (t) => {
  const w = boardWorld();
  const { order } = place(w);
  const p = call(w, 'startPreparing', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(p, '员工可以直接按 START');
  t.equal('直接进入 PREPARING', p.data.order.orderStatus, 'PREPARING');
  t.check('confirmedAt 被补上', (p.data.order.confirmedAt || '').length > 0);
});

/* -------------------------------------------------------------
   06 · §56 6 小时内多张订单只算 1 次 Visit
   ------------------------------------------------------------- */
suite.group('06 · §56 6 小时内多张订单只算 1 次 Visit', (t) => {
  const w = boardWorld({ wallet: 868 });

  const first = place(w);
  advance(w, first.order.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: first.order.appOrderId }, w.staffToken);
  const c1 = call(w, 'completeOrder', { appOrderId: first.order.appOrderId }, w.staffToken);
  t.equal('第一张订单算 1 次到店', c1.data.visitCounted, true);

  /* 第二张不用钱包，避免余额已被扣光 */
  const second = place(w, {
    items: [pick(w, w.sunset, 1)], useWallet: false, tableNumber: 'A12'
  });
  advance(w, second.order.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: second.order.appOrderId }, w.staffToken);
  const c2 = call(w, 'completeOrder', { appOrderId: second.order.appOrderId }, w.staffToken);
  t.okIs(c2, '第二张订单可以完成');
  t.equal('§56 第二张不再算到店', c2.data.visitCounted, false);
  t.check('第二张仍有积分', c2.data.pointsIssued > 0);

  const prof = profileOf(w);
  t.equal('到店仍只有 1 次', prof.totalVisits, 1);
  t.equal('总消费两张都算（7200 + 3200）', prof.totalSpend, 10400);
});

suite.group('06b · §56 把窗口设为 0 → 每张订单都算到店', (t) => {
  const w = boardWorld();
  call(w, 'updateSetting', { key: 'VISIT_SESSION_HOURS', value: '0' }, w.ownerToken);

  [w.mojito, w.sunset].forEach((prod) => {
    const o = place(w, { items: [pick(w, prod, 1)], useWallet: false });
    advance(w, o.order.appOrderId, 'READY');
    call(w, 'markPaymentPaid', { appOrderId: o.order.appOrderId }, w.staffToken);
    const c = call(w, 'completeOrder', { appOrderId: o.order.appOrderId }, w.staffToken);
    t.equal('窗口 0 时这张订单算到店', c.data.visitCounted, true);
  });
  t.equal('到店 2 次', profileOf(w).totalVisits, 2);
});

/* -------------------------------------------------------------
   07 · §12 权限
   ------------------------------------------------------------- */
suite.group('07 · §12 权限：顾客 token 不能动员工 action', (t) => {
  const w = boardWorld();
  const { order } = place(w);

  ['getIncomingOrders', 'getActiveOrders', 'acceptOrder', 'startPreparing',
   'markReady', 'completeOrder', 'cancelAppOrder', 'markPaymentPaid', 'setOrderingPaused']
    .forEach((action) => {
      const r = call(w, action, { appOrderId: order.appOrderId }, w.customerToken);
      t.check(action + ' 用顾客 token 会被拒绝', r.success === false);
      t.equal(action + ' 错误码', r.error.code, 'INVALID_SESSION');
    });

  const noToken = call(w, 'completeOrder', { appOrderId: order.appOrderId });
  t.check('没带 token 也不行', noToken.success === false);
  t.equal('不存在的订单',
    call(w, 'completeOrder', { appOrderId: 'APO999999' }, w.staffToken).error.code,
    'ORDER_NOT_FOUND');
});

suite.group('07b · 普通员工与经理都能推进订单', (t) => {
  const w = boardWorld();
  const { order } = place(w);
  t.okIs(call(w, 'acceptOrder', { appOrderId: order.appOrderId }, w.managerLogin), '经理可以接单');
  t.okIs(call(w, 'startPreparing', { appOrderId: order.appOrderId }, w.staffToken),
    '普通员工可以开始制作');
  t.okIs(call(w, 'markReady', { appOrderId: order.appOrderId }, w.staffToken),
    '普通员工可以标完成制作');
  const blocked = call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken);
  t.check('未收款时完成会被挡（不是权限问题）', blocked.success === false);
  t.equal('错误码是 ORDER_NOT_PAID', blocked.error.code, 'ORDER_NOT_PAID');
});

/* -------------------------------------------------------------
   08 · §19/§20 看板查询 + §46 轮询 + §49 等待时间 + §50 统计
   ------------------------------------------------------------- */
suite.group('08 · §19/§20 看板三栏 + §46 轮询 + §49 等待 + §50 统计', (t) => {
  const w = boardWorld();
  const o1 = place(w);
  const o2 = place(w, { tableNumber: 'B7' });

  const inc = call(w, 'getIncomingOrders', {}, w.staffToken);
  t.okIs(inc, '取得 NEW 栏');
  t.equal('NEW 栏 2 张', inc.data.count, 2);
  t.equal('§46 轮询 8 秒', inc.data.pollSeconds, 8);
  t.check('§21 看板带会员资料', !!inc.data.orders[0].customer);
  t.equal('§21 会员等级', inc.data.orders[0].customer.membershipTier, 'MEMBER');
  t.equal('看板带品项', inc.data.orders[0].items.length, 2);

  call(w, 'acceptOrder', { appOrderId: o1.order.appOrderId }, w.staffToken);
  call(w, 'startPreparing', { appOrderId: o1.order.appOrderId }, w.staffToken);
  call(w, 'acceptOrder', { appOrderId: o2.order.appOrderId }, w.staffToken);

  const act = call(w, 'getActiveOrders', {}, w.staffToken);
  t.okIs(act, '取得看板三栏');
  t.equal('NEW 栏 0 张', act.data.lanes.NEW.length, 0);
  t.equal('CONFIRMED 栏 1 张', act.data.lanes.CONFIRMED.length, 1);
  t.equal('PREPARING 栏 1 张', act.data.lanes.PREPARING.length, 1);
  t.equal('READY 栏 0 张', act.data.lanes.READY.length, 0);
  t.equal('§50 今日完成 0 张', act.data.today.orders, 0);
  t.check('§49 等待秒数 >= 0', act.data.lanes.PREPARING[0].waitingSeconds >= 0);

  const r = call(w, 'markReady', { appOrderId: o1.order.appOrderId }, w.staffToken);
  t.equal('READY', r.data.order.orderStatus, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: o1.order.appOrderId }, w.staffToken);
  call(w, 'completeOrder', { appOrderId: o1.order.appOrderId }, w.staffToken);

  const act2 = call(w, 'getActiveOrders', {}, w.staffToken);
  t.equal('完成后离开看板', act2.data.count, 1);
  t.equal('§50 今日完成 1 张', act2.data.today.orders, 1);
  t.equal('§50 今日业绩 RM72.00', act2.data.today.sales, 7200);
  t.equal('§50 平均客单 RM72.00', act2.data.today.averageOrder, 7200);
});

/* -------------------------------------------------------------
   09 · §24/§51 完成时写一笔 1.x Orders，Foodcourt 不受影响
   ------------------------------------------------------------- */
suite.group('09 · §24/§51 完成时写一笔 1.x Orders（通路业绩）', (t) => {
  const w = boardWorld({ wallet: 868 });

  /* 先走一遍 Foodcourt 认领，确认 1.x 流程照旧。
     ★ 2.0：建立 Claim 收紧到 MANAGER / OWNER，所以这里用 ownerToken。 */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-1', amount: 5000 }, w.ownerToken);
  const claim = call(w, 'claimOrder', { token: made.data.token }, w.customerToken);
  t.okIs(claim, 'Foodcourt 认领照旧可用');
  t.equal('Foodcourt 得到 50 分', claim.data.pointsEarned, 50);

  const { order } = place(w);
  advance(w, order.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken), 'App 订单完成');

  const orders = w.api.inspect((DB) => DB.orders);
  t.equal('1.x Orders 共 2 笔', orders.length, 2);
  const appTx = orders.find((o) => o.orderSource === 'YETIPSY_APP');
  t.check('有一笔 source = YETIPSY_APP', !!appTx);
  t.equal('§51 externalOrderId 用订单号', appTx.externalOrderId, 'YT260917001');
  t.equal('毛额 RM72.00', appTx.billAmount, 7200);
  t.equal('钱包抵扣 RM8.68', appTx.walletUsed, 868);
  t.equal('净额 RM63.32', appTx.finalAmount, 6332);
  t.equal('积分 63', appTx.pointsEarned, 63);
  t.equal('已认领状态', appTx.claimStatus, 'CLAIMED');

  t.equal('AppOrders 回指 1.x 订单',
    w.api.inspect((DB) => DB.appOrders[0].ordersTxId), appTx.orderId);

  const prof = profileOf(w);
  t.equal('总积分 50 + 63 = 113', prof.currentPoints, 113);
  t.equal('§56 Foodcourt 与 App 订单在 6 小时内只算 1 次到店', prof.totalVisits, 1);
  t.equal('总消费 RM50 + RM72 = RM122', prof.totalSpend, 12200);
});

/* -------------------------------------------------------------
   10 · §65 暂停接单
   ------------------------------------------------------------- */
suite.group('10 · §65 暂停接单不影响现有订单', (t) => {
  const w = boardWorld();
  const { order } = place(w);

  const pause = call(w, 'setOrderingPaused', { paused: true }, w.staffToken);
  t.okIs(pause, '员工可以暂停接单');
  t.equal('ordering.paused', pause.data.ordering.paused, true);
  t.equal('reason PAUSED', pause.data.ordering.reason, 'PAUSED');

  const items = [pick(w, w.mojito, 1)];
  const q = call(w, 'createCheckoutQuote',
    { items: items, orderType: 'TABLE', tableNumber: 'A1' }, w.customerToken);
  t.check('暂停后不能报价', q.success === false);
  t.equal('错误码 ORDERING_PAUSED', q.error.code, 'ORDERING_PAUSED');

  t.okIs(call(w, 'acceptOrder', { appOrderId: order.appOrderId }, w.staffToken),
    '暂停不影响现有订单');
  advance(w, order.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: order.appOrderId }, w.staffToken);
  t.okIs(call(w, 'completeOrder', { appOrderId: order.appOrderId }, w.staffToken),
    '暂停期间仍可完成订单');

  const resume = call(w, 'setOrderingPaused', { paused: false }, w.staffToken);
  t.equal('恢复接单', resume.data.ordering.paused, false);
  t.okIs(call(w, 'createCheckoutQuote',
    { items: items, orderType: 'TABLE', tableNumber: 'A1' }, w.customerToken), '恢复后可以下单');

  const actions = w.api.inspect((DB) => DB.audit.map((a) => a.action));
  ['PAUSE_ORDERS', 'RESUME_ORDERS', 'COMPLETE_ORDER', 'MARK_PAYMENT_PAID',
   'ACCEPT_ORDER', 'MARK_READY'].forEach((name) => {
    t.check('审计记下 ' + name, actions.indexOf(name) >= 0);
  });
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
