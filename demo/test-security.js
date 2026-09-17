/* =============================================================
   demo/test-security.js
   -------------------------------------------------------------
   2.0 Phase 9 + Phase 12 —— 安全审计（§12 §78 §81 §83）

   §81 要求主动测试的 12 项，这里一项一项跑：
     01 Change Product Price in Browser  改浏览器里的价格
     02 Fake Wallet Amount               假钱包金额
     03 Fake CustomerID                  假会员身分
     04 Fake Order Total                 假订单总额
     05 Double Place Order               重复下单
     06 Double Complete                  重复完成
     07 Complete Unpaid Order            完成未付款订单
     08 Use Wallet Twice                 同一笔钱包用两次
     09 Order Sold-Out Product           点已售完的商品
     10 Unauthorized Product Edit        未授权改商品
     11 Unauthorized Order Completion    未授权完成订单
     12 Replay API Request               重放 API 请求

   另外 §78 的钱包压力：Cancel / Failure / Double Submit / Race Condition
   与 §83 的 LockService（所有写钱的路径都必须在锁内）。

   执行： node demo/test-security.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 安全审计（Phase 9+12 · §78 §81 §83）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

function secWorld(opts) {
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
  w.staffToken = call(w, 'staffLogin',
    { username: 'bartender', password: 'staff-pass-12' }).data.token;

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  w.customerToken = reg.data.token;
  w.customerId = reg.data.customer.customerId;

  /* 第二位会员：用来试「拿别人的身分」 */
  const reg2 = call(w, 'customerRegister',
    { phone: '0198765432', name: 'Mina', password: PASSWORD });
  w.otherToken = reg2.data.token;
  w.otherId = reg2.data.customer.customerId;

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

/** Mojito 有必选 SIZE，自动挑第一个必选选项 */
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

const mvpCart = (w) => [pick(w, w.mojito, 2), pick(w, w.longIsland, 1)];

function quote(w, extra, token) {
  const body = Object.assign({
    items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12', useWallet: true
  }, extra || {});
  return call(w, 'createCheckoutQuote', body, token || w.customerToken);
}

function place(w, q, extra, token) {
  return call(w, 'placeOrder', Object.assign({
    quoteToken: q.quoteToken,
    idempotencyKey: q.idempotencyKey,
    orderType: q.orderType,
    tableNumber: q.tableNumber,
    paymentMethod: 'COUNTER'
  }, extra || {}), token || w.customerToken);
}

/** 员工把订单推到某状态 */
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

const balanceOf = (w, token) => call(w, 'getWallet', {}, token || w.customerToken).data.balance;
const pointsOf = (w, token) =>
  call(w, 'getProfile', {}, token || w.customerToken).data.customer.currentPoints;

/* =============================================================
   01 · §81 改浏览器里的价格
   ============================================================= */
suite.group('01 · §81 Change Product Price in Browser', (t) => {
  const w = secWorld({ wallet: 868 });

  /* 前端把单价改成 RM0.01，也把 lineTotal 改掉 */
  const items = mvpCart(w).map((it) => Object.assign({}, it, {
    unitPrice: 1, price: 1, lineTotal: 1, lineTotalSen: 1, subtotal: 2
  }));
  const q = call(w, 'createCheckoutQuote',
    { items: items, orderType: 'TABLE', tableNumber: 'A12', useWallet: false }, w.customerToken);
  t.okIs(q, '报价仍然成功（不是报错，是照后端价格算）');
  t.equal('★ 小计仍是 RM72.00', q.data.subtotal, 7200);
  t.equal('单价仍是 RM22.00', q.data.lines[0].unitPriceSen, 2200);

  /* 连 placeOrder 也塞假价 */
  const o = place(w, q.data, {
    items: items, subtotal: 2, finalAmount: 1, total: 1, subtotalSen: 2, finalAmountSen: 1
  });
  t.okIs(o, '下单成功');
  t.equal('★ 订单小计仍是 RM72.00', o.data.order.subtotal, 7200);
  t.equal('★ 订单总额仍是 RM72.00', o.data.order.finalAmount, 7200);

  /* OrderItem 上的快照单价也是后端读的 */
  const row = w.api.inspect((DB) => DB.orderItems[0]);
  t.equal('OrderItem 单价快照 RM22.00', row.unitPriceSen, 2200);
});

/* =============================================================
   02 · §81 假钱包金额
   ============================================================= */
suite.group('02 · §81 Fake Wallet Amount', (t) => {
  const w = secWorld({ wallet: 868 });

  /* 声称自己有 RM999 钱包，还直接指定要抵多少 */
  const q = call(w, 'createCheckoutQuote', {
    items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12', useWallet: true,
    walletAmount: 99900, walletBalance: 99900, walletUsed: 99900,
    maxUsable: 99900, walletApplied: 99900
  }, w.customerToken);
  t.okIs(q, '报价成功');
  t.equal('★ 后端只认自己的余额 RM8.68', q.data.wallet.balance, 868);
  t.equal('★ 只抵扣 RM8.68', q.data.wallet.applied, 868);
  t.equal('★ 应付 RM63.32', q.data.finalAmount, 6332);

  /* 20% 上限也不能被前端放大（§10） */
  const q2 = call(w, 'createCheckoutQuote', {
    items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12', useWallet: true,
    maxPercent: 100, maxUsable: 7200
  }, w.customerToken);
  t.equal('★ 上限仍是 min(余额, 20%) = RM8.68', q2.data.wallet.maxUsable, 868);

  /* 下单时再塞一次假金额 */
  const o = place(w, q.data, { walletUsed: 7200, walletApplied: 7200, walletUsedSen: 7200 });
  t.okIs(o, '下单成功');
  t.equal('★ 订单只记录 RM8.68', o.data.order.walletRequested, 868);
  t.equal('下单时还没扣', o.data.order.walletUsed, 0);
  t.equal('余额没被动过', balanceOf(w), 868);
});

/* =============================================================
   03 · §81 假 CustomerID
   ============================================================= */
suite.group('03 · §81 Fake CustomerID', (t) => {
  const w = secWorld({ wallet: 868 });

  /* 用 Jason 的 token，但声称订单属于 Mina */
  const q = quote(w);
  const o = place(w, q.data, { customerId: w.otherId, customerID: w.otherId });
  t.okIs(o, '下单成功');
  const row = w.api.inspect((DB) => DB.appOrders[0]);
  t.equal('★ 订单仍挂在 Jason 名下（以 session 为准）', row.customerId, w.customerId);

  /* 查别人的订单 */
  const first = place(w, quote(w).data).data.order;
  const peek = call(w, 'getAppOrder', { appOrderId: first.appOrderId }, w.otherToken);
  t.check('Mina 看不到 Jason 的订单', peek.success === false);
  t.equal('错误码 ORDER_NOT_FOUND', peek.error.code, 'ORDER_NOT_FOUND');

  t.check('Mina 不能取消 Jason 的订单',
    call(w, 'requestOrderCancellation', { appOrderId: first.appOrderId }, w.otherToken).success === false);
  t.check('Mina 不能重下 Jason 的订单',
    call(w, 'reorder', { appOrderId: first.appOrderId }, w.otherToken).success === false);

  /* getMyOrders 只能拿到自己的 */
  const mine = call(w, 'getMyOrders', { customerId: w.otherId }, w.customerToken);
  t.equal('★ 塞别人的 customerId 也只回自己的订单', mine.data.orders.length, 2);
  t.check('全部属于 Jason',
    mine.data.orders.every((x) => x.appOrderId));

  /* 员工看板上的会员资料不能由前端指定 */
  const board = call(w, 'getActiveOrders', { customerId: w.otherId }, w.staffToken);
  t.equal('看板会员是 Jason', board.data.lanes.NEW[0].customer.customerId, w.customerId);
});

/* =============================================================
   04 · §81 假订单总额
   ============================================================= */
suite.group('04 · §81 Fake Order Total', (t) => {
  const w = secWorld({ wallet: 868 });
  const q = quote(w);
  const o = place(w, q.data, {
    finalAmount: 1, total: 1, subtotal: 1, discount: 7199,
    discountSen: 7199, finalAmountSen: 1, subtotalSen: 1, pointsEarned: 99999
  });
  t.okIs(o, '下单成功');
  t.equal('★ 总额仍是 RM63.32', o.data.order.finalAmount, 6332);
  t.equal('★ 小计仍是 RM72.00', o.data.order.subtotal, 7200);
  t.equal('★ 优惠没有被伪造', o.data.order.discount, 0);
  t.equal('★ 积分没有被伪造', o.data.order.pointsEarned, 0);

  /* 数量也不能是负数或超大 */
  const bad = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: -3, options: [] }],
    orderType: 'COUNTER'
  }, w.customerToken);
  t.check('负数数量被挡', bad.success === false);
  t.equal('错误码 INVALID_QUANTITY', bad.error.code, 'INVALID_QUANTITY');

  const many = call(w, 'createCheckoutQuote', {
    items: Array.from({ length: 21 }, () => pick(w, w.mojito, 1)),
    orderType: 'COUNTER'
  }, w.customerToken);
  t.equal('超过 MAX_ORDER_ITEMS', many.error.code, 'TOO_MANY_ITEMS');
});

/* =============================================================
   05 · §81 重复下单
   ============================================================= */
suite.group('05 · §81 Double Place Order', (t) => {
  const w = secWorld({ wallet: 868 });
  const q = quote(w).data;

  const a = place(w, q);
  const b = place(w, q);            // 完全相同的 payload 再送一次
  t.okIs(a, '第一次下单成功');
  t.okIs(b, '第二次不报错（幂等）');
  t.equal('★ 回报 duplicate', b.data.duplicate, true);
  t.equal('★ 同一张订单', b.data.order.appOrderId, a.data.order.appOrderId);
  t.equal('★ 数据库只有一张', w.api.inspect((DB) => DB.appOrders.length), 1);
  t.equal('OrderItem 没有重复', w.api.inspect((DB) => DB.orderItems.length), 2);

  /* 快速连按 5 次 */
  for (let i = 0; i < 5; i++) place(w, q);
  t.equal('连按 5 次后仍只有一张', w.api.inspect((DB) => DB.appOrders.length), 1);

  /* 没带 key 不行 */
  const noKey = call(w, 'placeOrder', {
    quoteToken: quote(w).data.quoteToken, orderType: 'TABLE', tableNumber: 'A12'
  }, w.customerToken);
  t.check('没带 IdempotencyKey 被挡', noKey.success === false);
});

/* =============================================================
   06 · §81 重复完成
   ============================================================= */
suite.group('06 · §81 Double Complete', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;
  advance(w, o.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);

  const first = call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.staffToken);
  t.equal('第一次发 63 分', first.data.pointsIssued, 63);

  /* 连按 5 次 */
  for (let i = 0; i < 5; i++) {
    const r = call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.staffToken);
    t.equal('第 ' + (i + 2) + ' 次回报已完成', r.data.alreadyCompleted, true);
  }

  t.equal('★ 积分只发一次', pointsOf(w), 63);
  t.equal('★ PointTx 只有一笔',
    w.api.inspect((DB) => DB.pointTx.filter((x) => x.customerId === w.customerId).length), 1);
  t.equal('★ Rewards 只有一笔',
    w.api.inspect((DB) => DB.rewards.filter((x) => x.customerId === w.customerId).length), 1);
  t.equal('★ 1.x Orders 只有一笔', w.api.inspect((DB) => DB.orders.length), 1);
  t.equal('★ COMPLETE_ORDER 审计只有一条',
    w.api.inspect((DB) => DB.audit.filter((a) => a.action === 'COMPLETE_ORDER').length), 1);
});

/* =============================================================
   07 · §81 完成未付款订单
   ============================================================= */
suite.group('07 · §81 Complete Unpaid Order', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;

  ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'].forEach((target) => {
    advance(w, o.appOrderId, target);
    const r = call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.staffToken);
    t.check(target + ' 未付款不能完成', r.success === false);
    /* 状态机先拦（CONFIRMED / PREPARING 本来就跳不到 COMPLETED），
       只有 READY 这一步才是真正的「未收款不能完成」 */
    t.equal(target + ' 的错误码', r.error.code,
      target === 'READY' ? 'ORDER_NOT_PAID' : 'ORDER_STATUS_INVALID');
  });

  t.equal('★ 没有发积分', pointsOf(w), 0);
  t.equal('★ 没有写 1.x Orders', w.api.inspect((DB) => DB.orders.length), 0);
  t.equal('★ 钱包没被扣', balanceOf(w), 868);
});

/* =============================================================
   08 · §81 同一笔钱包用两次（§78 Race Condition）
   ============================================================= */
suite.group('08 · §81 Use Wallet Twice', (t) => {
  const w = secWorld({ wallet: 868 });

  /* 两张订单都要求用同一笔 RM8.68（此时都还没扣） */
  const q1 = quote(w).data;
  const q2 = quote(w).data;
  const o1 = place(w, q1).data.order;
  const o2 = place(w, q2).data.order;
  t.equal('两张订单都要求 RM8.68', o1.walletRequested + o2.walletRequested, 1736);
  t.equal('余额还是 RM8.68（没扣）', balanceOf(w), 868);

  /* 第一张收款成功 */
  advance(w, o1.appOrderId, 'READY');
  const pay1 = call(w, 'markPaymentPaid', { appOrderId: o1.appOrderId }, w.staffToken);
  t.okIs(pay1, '第一张收款成功');
  t.equal('扣掉 RM8.68', pay1.data.walletUsed, 868);
  t.equal('余额归零', balanceOf(w), 0);

  /* ★ 第二张不能再用同一笔钱 */
  advance(w, o2.appOrderId, 'READY');
  const pay2 = call(w, 'markPaymentPaid', { appOrderId: o2.appOrderId }, w.staffToken);
  t.check('★ 第二张收款被挡下', pay2.success === false);
  t.equal('★ 错误码 INSUFFICIENT_WALLET', pay2.error.code, 'INSUFFICIENT_WALLET');
  t.equal('★ 余额没有被扣成负数', balanceOf(w), 0);
  t.equal('钱包流水没有第二笔 REDEEM',
    w.api.inspect((DB) => DB.walletTx.filter((x) => x.type === 'REDEEM').length), 1);

  /* 第二张也不能完成 */
  const c2 = call(w, 'completeOrder', { appOrderId: o2.appOrderId }, w.staffToken);
  t.check('第二张不能完成', c2.success === false);
  t.equal('错误码 ORDER_NOT_PAID', c2.error.code, 'ORDER_NOT_PAID');

  /* 取消第二张：没扣过就不该退钱 */
  const cancel = call(w, 'cancelAppOrder', { appOrderId: o2.appOrderId }, w.staffToken);
  t.okIs(cancel, '可以取消第二张');
  t.equal('★ 没扣过就不退', cancel.data.refunded, 0);
  t.equal('★ 余额仍是 0（没有被凭空退钱）', balanceOf(w), 0);
});

suite.group('08b · §78 同一张订单重复收款', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;
  advance(w, o.appOrderId, 'READY');

  const p1 = call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  t.equal('第一次扣 RM8.68', p1.data.walletUsed, 868);
  for (let i = 0; i < 3; i++) {
    const p = call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
    t.equal('第 ' + (i + 2) + ' 次回报已付款', p.data.alreadyPaid, true);
  }
  t.equal('★ 只扣一次', balanceOf(w), 0);
  t.equal('★ REDEEM 只有一笔',
    w.api.inspect((DB) => DB.walletTx.filter((x) => x.type === 'REDEEM').length), 1);
});

suite.group('08c · §78 取消后钱包不能重复退回', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;
  advance(w, o.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  t.equal('已扣款', balanceOf(w), 0);

  const c1 = call(w, 'cancelAppOrder', { appOrderId: o.appOrderId }, w.staffToken);
  t.equal('第一次退回 RM8.68', c1.data.refunded, 868);
  for (let i = 0; i < 3; i++) {
    const c = call(w, 'cancelAppOrder', { appOrderId: o.appOrderId }, w.staffToken);
    t.equal('重复取消不再退', c.data.refunded, 0);
  }
  t.equal('★ 余额只退回一次', balanceOf(w), 868);
  t.equal('★ REVERSAL 只有一笔',
    w.api.inspect((DB) => DB.walletTx.filter((x) => x.type === 'REVERSAL').length), 1);
});

suite.group('08d · §78 1.x 钱包抵扣也不能超额', (t) => {
  const w = secWorld({ wallet: 868 });

  /* redeemWallet 是员工扫会员码抵扣，要员工 token */
  const asCustomer = call(w, 'redeemWallet',
    { customerId: w.customerId, walletAmount: 100, billAmount: 100000 }, w.customerToken);
  t.check('★ 顾客不能自己抵扣（要员工操作）', asCustomer.success === false);
  t.equal('错误码 INVALID_SESSION', asCustomer.error.code, 'INVALID_SESSION');

  /* 员工要求扣超过余额 */
  const over = call(w, 'redeemWallet',
    { customerId: w.customerId, walletAmount: 99900, billAmount: 100000 }, w.staffToken);
  t.check('★ 超额抵扣被挡', over.success === false);
  t.equal('错误码 INSUFFICIENT_WALLET', over.error.code, 'INSUFFICIENT_WALLET');
  t.equal('★ 余额不变', balanceOf(w), 868);

  /* 不存在的会员 */
  const nobody = call(w, 'redeemWallet',
    { customerId: 'YT999999', walletAmount: 100, billAmount: 100000 }, w.staffToken);
  t.check('不存在的会员被挡', nobody.success === false);
  t.equal('错误码 CUSTOMER_NOT_FOUND', nobody.error.code, 'CUSTOMER_NOT_FOUND');
});

/* =============================================================
   09 · §81 点已售完的商品
   ============================================================= */
suite.group('09 · §81 Order Sold-Out Product', (t) => {
  const w = secWorld({ wallet: 868 });
  const q = quote(w).data;

  /* 报价之后、下单之前，员工把它标成售罄 */
  t.okIs(call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.staffToken), '员工标售罄');

  const o = place(w, q);
  t.check('★ 下单被挡下', o.success === false);
  t.equal('★ 错误码 PRODUCT_UNAVAILABLE', o.error.code, 'PRODUCT_UNAVAILABLE');
  t.equal('★ 没有产生订单', w.api.inspect((DB) => DB.appOrders.length), 0);
  t.equal('★ 没有产生品项', w.api.inspect((DB) => DB.orderItems.length), 0);
  t.equal('★ 钱包没被扣', balanceOf(w), 868);

  /* 顾客端重报价也会被告知 */
  const q2 = quote(w);
  t.check('重新报价也被挡', q2.success === false);
  t.equal('错误码 PRODUCT_UNAVAILABLE', q2.error.code, 'PRODUCT_UNAVAILABLE');
});

/* =============================================================
   10 · §81 未授权改商品
   ============================================================= */
suite.group('10 · §81 Unauthorized Product Edit', (t) => {
  const w = secWorld();
  const pid = w.mojito.productId;

  const edits = [
    ['createProduct', { nameEN: 'Hacked', price: 1, categoryId: 'CAT000001' }],
    ['updateProduct', { productId: pid, price: 1, priceSen: 1 }],
    ['archiveProduct', { productId: pid }],
    ['createCategory', { nameEN: 'Hacked' }],
    ['updateCategory', { categoryId: 'CAT000001', nameEN: 'Hacked' }],
    ['createProductOption', { productId: pid, optionGroup: 'SIZE', nameEN: 'Free', priceAdjustment: 0 }],
    ['updateProductOption', { optionId: 'OPT000001', priceAdjustment: -99999 }],
    ['setProductAvailability', { productId: pid, available: false }]
  ];

  edits.forEach(([action, data]) => {
    /* 顾客 token */
    const asCustomer = call(w, action, data, w.customerToken);
    t.check('顾客不能 ' + action, asCustomer.success === false);
    t.equal(action + ' 顾客错误码', asCustomer.error.code, 'INVALID_SESSION');

    /* 没带 token */
    const anon = call(w, action, data);
    t.check('匿名不能 ' + action, anon.success === false);
  });

  /* 普通员工：只能改售罄，不能改价格 / 建档（§32） */
  t.okIs(call(w, 'setProductAvailability', { productId: pid, available: false }, w.staffToken),
    '★ 员工可以标售罄（§32 允许）');
  const priceEdit = call(w, 'updateProduct', { productId: pid, price: 1 }, w.staffToken);
  t.check('★ 员工不能改价格', priceEdit.success === false);
  t.equal('错误码 UNAUTHORIZED', priceEdit.error.code, 'UNAUTHORIZED');
  const create = call(w, 'createProduct',
    { nameEN: 'X', price: 1, categoryId: 'CAT000001' }, w.staffToken);
  t.check('★ 员工不能建商品', create.success === false);

  /* 商品资料没被改坏 */
  const row = w.api.inspect((DB) => DB.products.find((p) => p.productId === pid));
  t.equal('价格仍是 RM22.00', row.priceSen, 2200);
  t.equal('名称仍是 Mojito', row.nameEN, 'Mojito');
});

/* =============================================================
   11 · §81 未授权完成订单
   ============================================================= */
suite.group('11 · §81 Unauthorized Order Completion', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;
  advance(w, o.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);

  const staffActions = ['acceptOrder', 'startPreparing', 'markReady', 'completeOrder',
    'cancelAppOrder', 'markPaymentPaid', 'getIncomingOrders', 'getActiveOrders',
    'setOrderingPaused'];

  staffActions.forEach((action) => {
    const asCustomer = call(w, action, { appOrderId: o.appOrderId }, w.customerToken);
    t.check('顾客不能 ' + action, asCustomer.success === false);
    t.equal(action + ' 顾客错误码', asCustomer.error.code, 'INVALID_SESSION');

    const anon = call(w, action, { appOrderId: o.appOrderId });
    t.check('匿名不能 ' + action, anon.success === false);

    /* 用假的员工 token */
    const fake = call(w, action, { appOrderId: o.appOrderId }, 'deadbeef'.repeat(8));
    t.check('假 token 不能 ' + action, fake.success === false);
  });

  /* 用 Mina 的顾客 token 也不行 */
  const asOther = call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.otherToken);
  t.check('别的会员不能完成', asOther.success === false);

  t.equal('★ 订单还在 READY', w.api.inspect((DB) => DB.appOrders[0].orderStatus), 'READY');
  t.equal('★ 没有发积分', pointsOf(w), 0);
});

/* =============================================================
   12 · §81 重放 API 请求
   ============================================================= */
suite.group('12 · §81 Replay API Request', (t) => {
  const w = secWorld({ wallet: 868 });
  const q = quote(w).data;

  /* 完整重放下单 payload 10 次 */
  const payload = {
    quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey,
    orderType: q.orderType, tableNumber: q.tableNumber, paymentMethod: 'COUNTER'
  };
  const first = call(w, 'placeOrder', payload, w.customerToken);
  t.okIs(first, '第一次成功');
  for (let i = 0; i < 10; i++) {
    const r = call(w, 'placeOrder', payload, w.customerToken);
    t.equal('重放第 ' + (i + 1) + ' 次仍是同一张', r.data.order.appOrderId,
      first.data.order.appOrderId);
  }
  t.equal('★ 数据库只有一张订单', w.api.inspect((DB) => DB.appOrders.length), 1);

  /* Quote 用掉就失效：换新 key 也重放不了 */
  const replayNewKey = call(w, 'placeOrder',
    Object.assign({}, payload, { idempotencyKey: 'x'.repeat(40) }), w.customerToken);
  t.check('★ 换 key 重放被挡', replayNewKey.success === false);
  t.equal('错误码 QUOTE_EXPIRED', replayNewKey.error.code, 'QUOTE_EXPIRED');

  /* 拿别人的 Quote 重放 */
  const w2 = secWorld();
  const stolen = quote(w2).data;
  const cross = call(w, 'placeOrder', {
    quoteToken: stolen.quoteToken, idempotencyKey: stolen.idempotencyKey,
    orderType: 'TABLE', tableNumber: 'A1'
  }, w.customerToken);
  t.check('★ 拿别人的 Quote 被挡', cross.success === false);

  /* 收款与完成也不能靠重放多做一次 */
  const o = first.data.order;
  advance(w, o.appOrderId, 'READY');
  for (let i = 0; i < 3; i++) {
    call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  }
  t.equal('★ 重放收款只扣一次', balanceOf(w), 0);
  for (let i = 0; i < 3; i++) {
    call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.staffToken);
  }
  t.equal('★ 重放完成只发一次积分', pointsOf(w), 63);
  t.equal('★ PointTx 只有一笔',
    w.api.inspect((DB) => DB.pointTx.filter((x) => x.customerId === w.customerId).length), 1);
});

/* =============================================================
   13 · §83 所有写钱的路径都在锁内
   ============================================================= */
suite.group('13 · §83 LockService：写钱的路径都在锁内', (t) => {
  const w = secWorld({ wallet: 868 });
  const o = place(w, quote(w).data).data.order;

  /* 抓住锁不放，再来一个请求 → 应该回 SERVER_BUSY，而不是把资料写坏 */
  t.check('一开始锁是干净的', w.shim.isLockHeld() === false);
  const lock = w.sandbox.LockService.getScriptLock();
  t.check('可以取得锁', lock.tryLock());
  t.check('锁确实被占住', w.shim.isLockHeld() === true);

  const busy = call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  t.check('★ 锁被占时回 SERVER_BUSY', busy.success === false);
  t.equal('错误码 SERVER_BUSY', busy.error.code, 'SERVER_BUSY');

  /* 锁被占住时任何请求（含 getWallet）都会 BUSY，所以这里直接读库 */
  t.equal('★ 钱包没有被扣',
    w.api.inspect((DB) => DB.customers.find((c) => c.customerId === w.customerId).walletBalance),
    868);
  t.equal('★ 订单还是 UNPAID',
    w.api.inspect((DB) => DB.appOrders[0].paymentStatus), 'UNPAID');

  lock.releaseLock();

  /* 放锁后一切正常 */
  const ok = call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  t.okIs(ok, '放锁后可以收款');
  t.equal('扣掉 RM8.68', ok.data.walletUsed, 868);

  /* 每个请求跑完都要把锁放掉，否则会一路 BUSY */
  call(w, 'getWallet', {}, w.customerToken);
  const after = call(w, 'getWallet', {}, w.customerToken);
  t.okIs(after, '★ 请求结束后锁有被释放');
  t.check('★ 锁没有被留着（否则会一路 SERVER_BUSY）', w.shim.isLockHeld() === false);
});

/* =============================================================
   14 · §68 1.x 完全不受影响
   ============================================================= */
suite.group('14 · §68 升级后 1.x 仍然正常', (t) => {
  const w = secWorld({ wallet: 868 });

  /* Foodcourt 开单 + 认领。
     ★ 2.0：建立 Claim 收紧到 MANAGER / OWNER，所以用 ownerToken。 */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-SEC-1', amount: 5000 }, w.ownerToken);
  t.okIs(made, '经理开单照旧');
  const staffDenied = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-SEC-2', amount: 1000 }, w.staffToken);
  t.check('★ 普通员工建立 Claim 被挡（2.0 收紧）', staffDenied.success === false);
  t.equal('错误码 UNAUTHORIZED', staffDenied.error.code, 'UNAUTHORIZED');
  const claim = call(w, 'claimOrder', { token: made.data.token }, w.customerToken);
  t.okIs(claim, '顾客认领照旧');
  t.equal('Foodcourt 得到 50 分', claim.data.pointsEarned, 50);

  /* 会员条码 */
  const code = call(w, 'getMemberCode', {}, w.customerToken);
  t.okIs(code, '会员条码照旧可用');

  /* 钱包页 */
  const wallet = call(w, 'getWallet', {}, w.customerToken);
  t.equal('钱包余额 RM8.68', wallet.data.balance, 868);

  /* 走完 App 订单，确认两条通路共存（§24） */
  const o = place(w, quote(w).data).data.order;
  advance(w, o.appOrderId, 'READY');
  call(w, 'markPaymentPaid', { appOrderId: o.appOrderId }, w.staffToken);
  const done = call(w, 'completeOrder', { appOrderId: o.appOrderId }, w.staffToken);
  t.okIs(done, 'App 订单完成');

  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('两条通路积分累加 50 + 63 = 113', prof.currentPoints, 113);
  t.equal('§56 6 小时内只算 1 次到店', prof.totalVisits, 1);

  /* 1.x 的 Orders 里两条通路都有 */
  const sources = w.api.inspect((DB) => DB.orders.map((r) => r.orderSource).sort());
  t.equal('1.x Orders 有 2 笔', sources.length, 2);
  t.check('有 FOODCOURT', sources.indexOf('FOODCOURT') >= 0);
  t.check('有 YETIPSY_APP', sources.indexOf('YETIPSY_APP') >= 0);
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
