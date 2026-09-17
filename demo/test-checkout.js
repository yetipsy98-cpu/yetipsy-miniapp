/* =============================================================
   demo/test-checkout.js
   -------------------------------------------------------------
   2.0 Phase 5 + 6 验收测试
   （§10 §11 §16 §22 §30 §37 §41 §42 §43 §44 §45 §53 §54 §57 §64 §66 §84）

   重点是「后端说了算」：
     · 前端送来的价格 / 金额一律被忽略，Quote 由后端重算（§41/§42）
     · Quote 5 分钟过期、只能用一次、不能拿别人的（§43）
     · IdempotencyKey 防重复下单（§44）
     · 钱包在下单时只「记录」不扣（§54）
     · SUBMITTED 不发积分 / 不算 Visit（§22）
     · OrderItem 快照名称与单价（§30）

   执行： node demo/test-checkout.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 结帐与订单测试（Phase 5+6 · §41–§57）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

/**
 * 建一个可以下单的世界。
 * 营业时间预设 18:30–00:00，测试多半在白天跑，所以放开成全天。
 */
function orderWorld(opts) {
  opts = opts || {};
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());

  if (opts.openHours !== false) {
    call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);
    call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, w.ownerToken);
  }

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
  w.mojitoOptions = menu.optionsByProduct[w.mojito.productId] || [];
  w.sizeRegular = w.mojitoOptions.filter((o) => o.optionGroup === 'SIZE' && o.nameEN === 'Regular')[0];
  w.sizeLarge = w.mojitoOptions.filter((o) => o.optionGroup === 'SIZE' && o.nameEN === 'Large')[0];
  return w;
}

/** §84 的那一车：Mojito ×2 + Long Island ×1 = RM72 */
function mvpCart(w) {
  return [
    { productId: w.mojito.productId, quantity: 2, options: [w.sizeRegular.optionId] },
    { productId: w.longIsland.productId, quantity: 1, options: [] }
  ];
}

/* -------------------------------------------------------------
   01 · §84 MVP：Jason 的那一单
   ------------------------------------------------------------- */
suite.group('01 · §84 MVP 场景：Mojito×2 + Long Island = RM72', (t) => {
  const w = orderWorld({ wallet: 868 });        // 钱包 RM8.68

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12', useWallet: true },
    w.customerToken);
  t.okIs(q, '取得结帐报价');
  const quote = q.data;

  t.equal('小计 RM72.00（后端自己算）', quote.subtotal, 7200);
  t.equal('2 项明细', quote.lines.length, 2);
  t.equal('共 3 杯', quote.itemCount, 3);
  t.equal('钱包余额 RM8.68', quote.wallet.balance, 868);
  t.equal('20% 上限 = RM14.40', quote.wallet.maxUsable, 868);   // min(868, 1440)
  t.equal('实际抵扣 RM8.68', quote.wallet.applied, 868);
  t.equal('★ 应付 RM63.32', quote.finalAmount, 6332);
  t.equal('★ 预估积分 63（§57 NET_PAID）', quote.estimatedPoints, 63);
  t.equal('Quote 5 分钟有效（§43）', quote.expiresInMinutes, 5);
  t.equal('桌号 A12', quote.tableNumber, 'A12');
  t.check('有 IdempotencyKey（§44）', (quote.idempotencyKey || '').length >= 16);
  t.check('有 quoteToken', (quote.quoteToken || '').length >= 16);

  /* 明细快照（§30） */
  const mLine = quote.lines.filter((l) => l.productId === w.mojito.productId)[0];
  t.equal('Mojito 单价快照 RM22.00', mLine.unitPriceSen, 2200);
  t.equal('名称快照 Mojito', mLine.productNameSnapshot, 'Mojito');
  t.equal('Mojito 小计 RM44.00', mLine.lineTotalSen, 4400);

  /* 下单 */
  const o = call(w, 'placeOrder',
    { quoteToken: quote.quoteToken, idempotencyKey: quote.idempotencyKey,
      paymentMethod: 'COUNTER' }, w.customerToken);
  t.okIs(o, '下单成功');
  const order = o.data.order;

  t.equal('订单号格式 YT260917001（§45）', order.orderNumber, 'YT260917001');
  t.check('内部 AppOrderID 是另一个（§45）',
    /^APO\d{6}$/.test(order.appOrderId), order.appOrderId);
  t.equal('状态 SUBMITTED（§16）', order.orderStatus, 'SUBMITTED');
  t.equal('付款状态 UNPAID（§15）', order.paymentStatus, 'UNPAID');
  t.equal('付款方式 COUNTER', order.paymentMethod, 'COUNTER');
  t.equal('总额 RM63.32', order.finalAmount, 6332);
  t.equal('订单类型 TABLE', order.orderType, 'TABLE');
  t.equal('桌号 A12', order.tableNumber, 'A12');
  t.equal('2 项明细', order.items.length, 2);

  /* §54 钱包只是「要求」，还没扣 */
  t.equal('walletRequested = RM8.68', order.walletRequested, 868);
  t.equal('★ walletUsed 还是 0（未扣款 §54）', order.walletUsed, 0);
  t.equal('★ 钱包余额没变', call(w, 'getWallet', {}, w.customerToken).data.balance, 868);

  /* §22 SUBMITTED 不发积分、不算 Visit */
  t.equal('★ 积分还是 0（§22 未完成不发）', order.pointsEarned, 0);
  const profile = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('★ 会员积分没变', profile.currentPoints, 0);
  t.equal('★ Visit 没增加（§22）', profile.totalVisits, 0);
  t.equal('★ 累计消费没增加（§22）', profile.totalSpend, 0);

  /* §49 等待时间由 CreatedAt 算 */
  t.check('有 waitingSeconds', order.waitingSeconds >= 0, order.waitingSeconds);

  /* 1.x 的 Orders 表不该被这单污染（App 订单走 AppOrders） */
  const ordersRows = w.api.inspect((DB) => DB.orders.length);
  t.equal('1.x Orders 表没有新增（两条通路分开 §24）', ordersRows, 0);
});

/* -------------------------------------------------------------
   02 · §41/§42 前端送来的价格一律被忽略
   ------------------------------------------------------------- */
suite.group('02 · 前端不能自己决定价格（§41/§42）', (t) => {
  const w = orderWorld();

  /* 顾客在 items 里塞假价格 */
  const q = call(w, 'createCheckoutQuote', {
    items: [{
      productId: w.mojito.productId, quantity: 1, options: [w.sizeRegular.optionId],
      price: 1, priceSen: 1, unitPrice: 1, lineTotal: 1, amount: 1
    }],
    orderType: 'COUNTER',
    subtotal: 1, total: 1, finalAmount: 1, discount: 99999
  }, w.customerToken);
  t.okIs(q, '带假价格也能取得报价');
  t.equal('★ 小计仍是 RM22.00（不是 1 sen）', q.data.subtotal, 2200);
  t.equal('明细单价仍是 2200', q.data.lines[0].unitPriceSen, 2200);
  t.equal('应付仍是 RM22.00', q.data.finalAmount, 2200);

  /* 送不存在的商品 */
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: [{ productId: 'PRD9999', quantity: 1 }], orderType: 'COUNTER' }, w.customerToken),
    'PRODUCT_NOT_FOUND', '不存在的商品被拒');

  /* 数量不合理 */
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: [{ productId: w.mojito.productId, quantity: 0 }], orderType: 'COUNTER' },
    w.customerToken), 'INVALID_QUANTITY', '数量 0 被拒');
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: [{ productId: w.mojito.productId, quantity: -3 }], orderType: 'COUNTER' },
    w.customerToken), 'INVALID_QUANTITY', '负数量被拒');
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: [{ productId: w.mojito.productId, quantity: 999 }], orderType: 'COUNTER' },
    w.customerToken), 'INVALID_QUANTITY', '数量 999 被拒');

  /* 空车 */
  t.errorIs(call(w, 'createCheckoutQuote', { items: [], orderType: 'COUNTER' }, w.customerToken),
    'INVALID_INPUT', '空车被拒');

  /* §63 MAX_ORDER_ITEMS */
  const many = [];
  for (let i = 0; i < 21; i++) {
    many.push({ productId: w.mojito.productId, quantity: 1, options: [] });
  }
  t.errorIs(call(w, 'createCheckoutQuote', { items: many, orderType: 'COUNTER' }, w.customerToken),
    'TOO_MANY_ITEMS', '超过 MAX_ORDER_ITEMS 被拒');

  /* 规格加价由后端算：Large 要 +RM6 */
  const large = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1, options: [w.sizeLarge.optionId] }],
    orderType: 'COUNTER'
  }, w.customerToken);
  t.okIs(large, 'Large 报价成功');
  t.equal('★ Large 小计 RM28.00（22 + 6）', large.data.subtotal, 2800);
  t.equal('规格加价 600', large.data.lines[0].optionsPriceSen, 600);

  /* 送别的商品的 optionId 不算数 */
  const wrongOpt = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1,
      options: ['OPT9999', w.sizeLarge.optionId] }],
    orderType: 'COUNTER'
  }, w.customerToken);
  t.okIs(wrongOpt, '含无效 optionId 仍可报价');
  t.equal('★ 无效规格被忽略，只算 Large', wrongOpt.data.subtotal, 2800);
});

/* -------------------------------------------------------------
   03 · §8 必选规格不能漏
   ------------------------------------------------------------- */
suite.group('03 · 必选规格（§8）', (t) => {
  const w = orderWorld();

  t.errorIs(call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1, options: [] }],
    orderType: 'COUNTER'
  }, w.customerToken), 'OPTION_REQUIRED', '没选 SIZE 被拒');

  /* 同一组选两个也不行 */
  t.errorIs(call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1,
      options: [w.sizeRegular.optionId, w.sizeLarge.optionId] }],
    orderType: 'COUNTER'
  }, w.customerToken), 'INVALID_INPUT', '同组选两个被拒');

  /* 非必选的 ICE 可以不选 */
  const ok = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1, options: [w.sizeRegular.optionId] }],
    orderType: 'COUNTER'
  }, w.customerToken);
  t.okIs(ok, '只选必选的 SIZE 就可以');
});

/* -------------------------------------------------------------
   04 · §44 IdempotencyKey：连按两次只有一张订单
   ------------------------------------------------------------- */
suite.group('04 · 防重复下单（§44）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;

  const first = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken);
  t.okIs(first, '第一次下单成功');
  t.equal('duplicate = false', first.data.duplicate, false);

  /* 连按第二次（同一个 key） */
  const second = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken);
  t.okIs(second, '第二次不报错');
  t.equal('★ duplicate = true', second.data.duplicate, true);
  t.equal('★ 拿回同一张订单', second.data.order.appOrderId, first.data.order.appOrderId);

  const count = w.api.inspect((DB) => DB.appOrders.length);
  t.equal('★ 数据库只有一张订单', count, 1);
  t.equal('getMyOrders 也只有一张', call(w, 'getMyOrders', {}, w.customerToken).data.count, 1);

  /* 没带 key 不行 */
  const q2 = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  t.errorIs(call(w, 'placeOrder', { quoteToken: q2.quoteToken }, w.customerToken),
    'INVALID_INPUT', '没带 IdempotencyKey 被拒');

  /* 拿 A 的 Quote 配一个「没下过单」的 key 也不行（防止绕过）。
     注意：幂等检查按设计先跑（§44），所以这里必须用全新的 key，
     否则会被上面那张已存在的订单当成重复下单直接回传。 */
  const q3 = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: q3.quoteToken, idempotencyKey: 'FRESH-KEY-NOT-FROM-QUOTE' }, w.customerToken),
    'QUOTE_MISMATCH', 'Quote 与 key 不匹配被拒');
  t.equal('被挡下后仍然只有一张订单', w.api.inspect((DB) => DB.appOrders.length), 1);

  /* 反过来：已下过单的 key 会先命中幂等，直接回原订单（这是 §44 要的） */
  const replay = call(w, 'placeOrder',
    { quoteToken: q3.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken);
  t.okIs(replay, '重放旧 key 不报错');
  t.equal('回的是原来那张', replay.data.order.appOrderId, first.data.order.appOrderId);
  t.equal('并标 duplicate', replay.data.duplicate, true);
});

/* -------------------------------------------------------------
   05 · §43 Quote 过期 / 只能用一次 / 不能共用
   ------------------------------------------------------------- */
suite.group('05 · Quote 有效期与一次性（§43）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;

  /* 用过一次就失效 */
  t.okIs(call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken), '下单成功');
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: 'ANOTHER-KEY-123456' }, w.customerToken),
    'QUOTE_EXPIRED', '★ 同一张 Quote 不能再用第二次');

  /* 乱写的 token */
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: 'not-a-real-token', idempotencyKey: 'X'.repeat(32) }, w.customerToken),
    'QUOTE_EXPIRED', '假 quoteToken 被拒');

  /* 别的会员不能用这张 Quote（§12 防伪造） */
  const other = call(w, 'customerRegister',
    { phone: '0129876543', name: 'Mina', password: PASSWORD });
  const q2 = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: q2.quoteToken, idempotencyKey: q2.idempotencyKey }, other.data.token),
    'QUOTE_EXPIRED', '★ 别人的 Quote 不能用');

  /* getCheckoutQuote 可以查回同一张报价 */
  const q3 = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  const read = call(w, 'getCheckoutQuote', { quoteToken: q3.quoteToken }, w.customerToken);
  t.okIs(read, 'getCheckoutQuote 成功');
  t.equal('金额一致', read.data.finalAmount, q3.finalAmount);
  t.equal('IdempotencyKey 一致', read.data.idempotencyKey, q3.idempotencyKey);
  t.check('剩馀时间 > 4 分钟', read.data.expiresInMinutes > 4, read.data.expiresInMinutes);
  t.errorIs(call(w, 'getCheckoutQuote', { quoteToken: 'bogus' }, w.customerToken),
    'QUOTE_EXPIRED', '查不存在的 Quote 报 QUOTE_EXPIRED');

  /* 有效期真的会到期：把 TTL 压到 0 秒 → 报价立刻失效（§43） */
  call(w, 'updateSetting', { key: 'CHECKOUT_QUOTE_EXPIRY_MINUTES', value: '0.001' }, w.ownerToken);
  t.equal('TTL 变成 0 秒', w.api.inspect((DB, sb) => sb.quoteTtlSeconds()), 0);
  const expired = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  t.errorIs(call(w, 'getCheckoutQuote', { quoteToken: expired.quoteToken }, w.customerToken),
    'QUOTE_EXPIRED', '★ 过了有效期就读不到');
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: expired.quoteToken, idempotencyKey: expired.idempotencyKey }, w.customerToken),
    'QUOTE_EXPIRED', '★ 过了有效期就不能下单');
  call(w, 'updateSetting', { key: 'CHECKOUT_QUOTE_EXPIRY_MINUTES', value: '5' }, w.ownerToken);
});

/* -------------------------------------------------------------
   06 · §66 售罄：Quote 之后再卖完也要挡住
   ------------------------------------------------------------- */
suite.group('06 · 下单前再验一次库存（§66）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  t.okIs(call(w, 'getCheckoutQuote', { quoteToken: q.quoteToken }, w.customerToken), 'Quote 有效');

  /* 报价之后员工把 Mojito 标成售罄 */
  call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.ownerToken);

  t.errorIs(call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken),
    'PRODUCT_UNAVAILABLE', '★ Quote 之后卖完 → 下单被挡');

  t.equal('没有产生订单', w.api.inspect((DB) => DB.appOrders.length), 0);

  /* 报价阶段就要挡住 */
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken),
    'PRODUCT_UNAVAILABLE', '售罄商品连报价都不给');
});

/* -------------------------------------------------------------
   07 · §64 / §65 点单关闭与暂停
   ------------------------------------------------------------- */
suite.group('07 · 点单关闭 / 暂停（§64/§65）', (t) => {
  const w = orderWorld({ openHours: false });     // 保持 18:30–00:00

  const menu = call(w, 'getMenu', {}, w.customerToken);
  t.okIs(menu, '★ 关闭时菜单仍可浏览（§64）');
  t.equal('商品照常列出', menu.data.products.length, 4);

  const win = menu.data.ordering;
  if (!win.open) {
    t.errorIs(call(w, 'createCheckoutQuote',
      { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken),
      'ORDERING_CLOSED', '★ 非营业时间不能报价');
  } else {
    t.check('现在正好在营业时间内（跳过关闭测试）', true);
  }

  /* 员工紧急暂停（§65） */
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, w.ownerToken);
  t.okIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken), '放开时间后可以报价');

  call(w, 'updateSetting', { key: 'ORDERING_PAUSED', value: 'TRUE' }, w.ownerToken);
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken),
    'ORDERING_PAUSED', '★ 暂停时不能报价');

  /* 已经拿到 Quote，之后才被暂停 → 下单也要挡 */
  call(w, 'updateSetting', { key: 'ORDERING_PAUSED', value: 'FALSE' }, w.ownerToken);
  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  call(w, 'updateSetting', { key: 'ORDERING_PAUSED', value: 'TRUE' }, w.ownerToken);
  t.errorIs(call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken),
    'ORDERING_PAUSED', '★ 报价后被暂停 → 下单被挡');
  t.equal('没有产生订单', w.api.inspect((DB) => DB.appOrders.length), 0);
});

/* -------------------------------------------------------------
   08 · §11 桌号 / 自取
   ------------------------------------------------------------- */
suite.group('08 · 桌号与自取（§11）', (t) => {
  const w = orderWorld();

  const table = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TABLE', tableNumber: 'a12' }, w.customerToken);
  t.okIs(table, '桌号订单报价成功');
  t.equal('桌号转大写 A12', table.data.tableNumber, 'A12');

  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TABLE' }, w.customerToken),
    'INVALID_INPUT', '选桌号却没填号码 → 被拒');

  const counter = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken);
  t.okIs(counter, '柜台自取报价成功');
  t.equal('自取没有桌号', counter.data.tableNumber, '');

  const takeaway = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TAKEAWAY' }, w.customerToken);
  t.okIs(takeaway, '外带报价成功');
  t.equal('类型 TAKEAWAY', takeaway.data.orderType, 'TAKEAWAY');

  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'DRONE' }, w.customerToken),
    'INVALID_INPUT', '不存在的类型被拒');

  /* 关掉桌号点单 */
  call(w, 'updateSetting', { key: 'ALLOW_TABLE_ORDER', value: 'FALSE' }, w.ownerToken);
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12' }, w.customerToken),
    'INVALID_INPUT', '★ 关掉桌号点单后不能再下桌号单');

  /* 关掉自取 */
  call(w, 'updateSetting', { key: 'ALLOW_TABLE_ORDER', value: 'TRUE' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ALLOW_PICKUP', value: 'FALSE' }, w.ownerToken);
  t.errorIs(call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken),
    'INVALID_INPUT', '★ 关掉自取后不能再下自取单');
});

/* -------------------------------------------------------------
   09 · §10 钱包上限（MAX_WALLET_USAGE_PERCENT = 20）
   ------------------------------------------------------------- */
suite.group('09 · 钱包抵扣上限（§10）', (t) => {
  /* 钱包很多，但只能用 20% */
  const w = orderWorld({ wallet: 100000 });       // RM1000
  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER', useWallet: true }, w.customerToken);
  t.okIs(q, '报价成功');
  t.equal('账单 RM72.00', q.data.subtotal, 7200);
  t.equal('★ 20% 上限 = RM14.40', q.data.wallet.maxUsable, 1440);
  t.equal('★ 实际抵扣 RM14.40（不是全部 RM1000）', q.data.wallet.applied, 1440);
  t.equal('应付 RM57.60', q.data.finalAmount, 5760);
  t.equal('上限百分比回报 20', q.data.wallet.maxPercent, 20);

  /* 不勾钱包就完全不抵扣 */
  const no = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER', useWallet: false }, w.customerToken);
  t.equal('没勾钱包 → 抵扣 0', no.data.wallet.applied, 0);
  t.equal('应付全额 RM72.00', no.data.finalAmount, 7200);

  /* 账单未满最低门槛（MIN_WALLET_REDEEM_BILL = RM30） */
  const small = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1, options: [w.sizeRegular.optionId] }],
    orderType: 'COUNTER', useWallet: true
  }, w.customerToken);
  t.okIs(small, '小额订单报价成功');
  t.equal('账单 RM22.00 未满 RM30', small.data.subtotal, 2200);
  t.equal('★ 不能用钱包', small.data.wallet.applied, 0);
  t.equal('allowed = false', small.data.wallet.allowed, false);
  t.check('并说明原因', /未满/.test(String(small.data.wallet.reason)), small.data.wallet.reason);

  /* 钱包 0 元 —— 注意要用同一个世界（w2 的 API 配 w2 的 token） */
  const w2 = orderWorld();
  const zero = call(w2, 'createCheckoutQuote',
    { items: mvpCart(w2), orderType: 'COUNTER', useWallet: true }, w2.customerToken);
  t.okIs(zero, '没钱包也能报价');
  t.equal('没余额 → 抵扣 0', zero.data.wallet.applied, 0);
  t.check('原因写「没有余额」', /没有余额/.test(String(zero.data.wallet.reason)),
    zero.data.wallet.reason);
});

/* -------------------------------------------------------------
   10 · §53 取消订单
   ------------------------------------------------------------- */
suite.group('10 · 取消订单（§53）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  const o = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken).data.order;

  t.equal('一开始是 SUBMITTED', o.orderStatus, 'SUBMITTED');

  const cancel = call(w, 'requestOrderCancellation',
    { appOrderId: o.appOrderId, reason: '改变主意' }, w.customerToken);
  t.okIs(cancel, 'SUBMITTED 可以取消');
  t.equal('★ 状态变 CANCELLED', cancel.data.order.orderStatus, 'CANCELLED');
  t.check('记了取消原因', /改变主意/.test(String(cancel.data.order.cancelReason)));
  t.equal('★ 钱包没被扣过，所以还是 0', cancel.data.order.walletUsed, 0);

  /* 重复取消 */
  const again = call(w, 'requestOrderCancellation',
    { appOrderId: o.appOrderId }, w.customerToken);
  t.okIs(again, '重复取消不报错');
  t.equal('回报 alreadyCancelled', again.data.alreadyCancelled, true);

  /* 已经开始制作就不能自己取消 */
  const w2 = orderWorld();
  const q2 = call(w2, 'createCheckoutQuote',
    { items: mvpCart(w2), orderType: 'COUNTER' }, w2.customerToken).data;
  const o2 = call(w2, 'placeOrder',
    { quoteToken: q2.quoteToken, idempotencyKey: q2.idempotencyKey }, w2.customerToken).data.order;
  w2.api.mutate((DB) => {
    DB.appOrders.find((x) => x.appOrderId === o2.appOrderId).orderStatus = 'PREPARING';
  });
  t.errorIs(call(w2, 'requestOrderCancellation',
    { appOrderId: o2.appOrderId }, w2.customerToken),
    'CANCEL_NOT_ALLOWED', '★ PREPARING 之后顾客不能自己取消');

  /* 别人的订单不能取消（§12） */
  const other = call(w2, 'customerRegister',
    { phone: '0129876543', name: 'Mina', password: PASSWORD });
  t.errorIs(call(w2, 'requestOrderCancellation',
    { appOrderId: o2.appOrderId }, other.data.token),
    'ORDER_NOT_FOUND', '★ 别人的订单查不到也取消不了');
  t.errorIs(call(w2, 'getAppOrder',
    { appOrderId: o2.appOrderId }, other.data.token),
    'ORDER_NOT_FOUND', '★ 别人的订单读不到');
});

/* -------------------------------------------------------------
   11 · §30 价格快照：改价不影响旧订单
   ------------------------------------------------------------- */
suite.group('11 · 订单快照（§30）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  const o = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken).data.order;

  t.equal('下单时 Mojito RM22.00',
    o.items.filter((i) => i.name === 'Mojito')[0].unitPrice, 2200);

  /* 老板把 Mojito 改成 RM25 */
  call(w, 'updateProduct', { productId: w.mojito.productId, price: 2500 }, w.ownerToken);

  const after = call(w, 'getAppOrder', { appOrderId: o.appOrderId }, w.customerToken).data.order;
  t.equal('★ 旧订单仍显示 RM22.00（§30）',
    after.items.filter((i) => i.name === 'Mojito')[0].unitPrice, 2200);
  t.equal('★ 旧订单总额不变', after.finalAmount, 7200);

  /* 新报价要用新价格 */
  const q2 = call(w, 'createCheckoutQuote', {
    items: [{ productId: w.mojito.productId, quantity: 1, options: [w.sizeRegular.optionId] }],
    orderType: 'COUNTER'
  }, w.customerToken);
  t.equal('新订单用 RM25.00', q2.data.subtotal, 2500);

  /* 商品下架后旧订单还是读得到名称 */
  call(w, 'archiveProduct', { productId: w.mojito.productId }, w.ownerToken);
  const still = call(w, 'getAppOrder', { appOrderId: o.appOrderId }, w.customerToken).data.order;
  t.equal('★ 下架后旧订单名称还在', still.items[0].name, 'Mojito');
});

/* -------------------------------------------------------------
   12 · §37 再点一次
   ------------------------------------------------------------- */
suite.group('12 · 再点一次（§37）', (t) => {
  const w = orderWorld();

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken).data;
  const o = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken).data.order;

  const re = call(w, 'reorder', { appOrderId: o.appOrderId }, w.customerToken);
  t.okIs(re, 'reorder 成功');
  t.equal('★ 2 项都还能再点', re.data.items.length, 2);
  t.equal('没有不可用的', re.data.unavailable.length, 0);
  t.equal('Mojito 数量保留 2',
    re.data.items.filter((i) => i.productId === w.mojito.productId)[0].quantity, 2);
  t.check('带着原来的规格',
    re.data.items.filter((i) => i.productId === w.mojito.productId)[0].options.length >= 1);

  /* 卖完的商品不能重新加入 */
  call(w, 'setProductAvailability',
    { productId: w.longIsland.productId, available: false }, w.ownerToken);
  const re2 = call(w, 'reorder', { appOrderId: o.appOrderId }, w.customerToken);
  t.equal('★ 售罄的那项被排除', re2.data.items.length, 1);
  t.equal('并列在 unavailable', re2.data.unavailable.length, 1);
  t.equal('unavailable 是 Long Island',
    re2.data.unavailable[0].productId, w.longIsland.productId);

  /* 别人的订单不能 reorder */
  const other = call(w, 'customerRegister',
    { phone: '0129876543', name: 'Mina', password: PASSWORD });
  t.errorIs(call(w, 'reorder', { appOrderId: o.appOrderId }, other.data.token),
    'ORDER_NOT_FOUND', '别人的订单不能 reorder');
});

/* -------------------------------------------------------------
   13 · 权限与审计
   ------------------------------------------------------------- */
suite.group('13 · 权限与审计留痕', (t) => {
  const w = orderWorld();

  /* 没登入不能报价 / 下单 */
  t.errorIs(call(w, 'createCheckoutQuote', { items: mvpCart(w) }, ''),
    'INVALID_SESSION', '没登入不能报价');
  t.errorIs(call(w, 'placeOrder', { quoteToken: 'x', idempotencyKey: 'y' }, ''),
    'INVALID_SESSION', '没登入不能下单');
  t.errorIs(call(w, 'getMyOrders', {}, ''), 'INVALID_SESSION', '没登入不能看订单');

  /* 员工 token 不能当会员用 */
  t.errorIs(call(w, 'createCheckoutQuote', { items: mvpCart(w) }, w.ownerToken),
    'INVALID_SESSION', '员工 token 不能当会员用');

  /* 下单要留审计 */
  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'TABLE', tableNumber: 'A12' }, w.customerToken).data;
  const o = call(w, 'placeOrder',
    { quoteToken: q.quoteToken, idempotencyKey: q.idempotencyKey }, w.customerToken).data.order;
  call(w, 'requestOrderCancellation', { appOrderId: o.appOrderId }, w.customerToken);

  const logs = call(w, 'getAuditLogs', {}, w.ownerToken).data.logs;
  const actions = logs.map((l) => l.action);
  t.check('有 PLACE_ORDER', actions.indexOf('PLACE_ORDER') >= 0, actions.slice(0, 10));
  t.check('有 REQUEST_ORDER_CANCEL', actions.indexOf('REQUEST_ORDER_CANCEL') >= 0);

  const placeLog = logs.filter((l) => l.action === 'PLACE_ORDER')[0];
  t.check('PLACE_ORDER 记了订单号',
    String(placeLog.newValue).indexOf(o.orderNumber) !== -1, placeLog.newValue);

  /* OrderItems 有快照栏位 */
  const itemRow = w.api.inspect((DB) => DB.orderItems[0]);
  t.check('OrderItems 有 productNameSnapshot', !!itemRow.productNameSnapshot);
  t.check('OrderItems 有 unitPriceSen', Number(itemRow.unitPriceSen) > 0);
  t.check('OrderItems 有 optionsJSON', typeof itemRow.optionsJSON === 'string');
});

/* -------------------------------------------------------------
   14 · 2.0 的表还没建时要回 UPGRADE_REQUIRED
   ------------------------------------------------------------- */
suite.group('14 · 还没升级时的行为（§67/§68）', (t) => {
  const w = orderWorld();
  ['AppOrders', 'OrderItems'].forEach((n) => { delete w.shim.spreadsheet.sheets[n]; });

  const q = call(w, 'createCheckoutQuote',
    { items: mvpCart(w), orderType: 'COUNTER' }, w.customerToken);
  t.okIs(q, '★ 缺 AppOrders 表时报价仍可算（报价不落库）');

  const o = call(w, 'placeOrder',
    { quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey }, w.customerToken);
  t.equal('下单会失败', o.success, false);
  t.check('★ 而且明确讲要 upgradeToV2()',
    /upgradeToV2|UPGRADE_REQUIRED/.test(JSON.stringify(o.error) + String(o.message)),
    o.error);

  /* 1.x 照常（§68） */
  t.okIs(call(w, 'getProfile', {}, w.customerToken), '缺表时 getProfile 照常');
  t.okIs(call(w, 'getWallet', {}, w.customerToken), '缺表时 getWallet 照常');
  t.okIs(call(w, 'getMenu', {}, w.customerToken), '缺表时菜单照常');
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
