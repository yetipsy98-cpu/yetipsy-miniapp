/* =============================================================
   YETIPSY MINI APP 2.1.5 — AppOrders.gs（2.0 Phase 6）
   -------------------------------------------------------------
   建立订单 / 查询订单 / 取消请求（§60 / §75）

   状态流（§16）：SUBMITTED → CONFIRMED → PREPARING → READY → COMPLETED
                                                    └→ CANCELLED

   不能违反的规则：
   · §44 同一个 IdempotencyKey 只能产生一张订单。连按两次 PLACE ORDER
         第二次会拿回同一张订单，不会变成两单。
   · §41 金额一律来自 Quote（Quote 又是后端自己算的），前端送的金额被忽略。
   · §54 钱包在这一步只「记录」walletRequestedSen，**不扣钱**；
         真正扣钱在员工确认收款时，取消要能全额退回。
   · §22 SUBMITTED 不给积分、不给 Reward、不算 Visit。
         这些一律等到 COMPLETED（Phase 8）。
   · §45 OrderNumber（YT260917001）只是显示用，内部一律用 AppOrderID。
   · §49 等待时间由 CreatedAt 算，不额外写库。
   · §53 SUBMITTED 且未被 Accept 时，顾客可以 REQUEST CANCEL。
   ============================================================= */

/* -------------------------------------------------------------
   1. 对外形状
   ------------------------------------------------------------- */

function publicAppOrder(o, items) {
  var created = o.createdAt ? new Date(o.createdAt).getTime() : 0;
  return {
    appOrderId: o.appOrderId,
    orderNumber: o.orderNumber,
    orderType: o.orderType,
    tableNumber: o.tableNumber || '',
    itemCount: Number(o.itemCount) || 0,
    subtotal: Number(o.subtotalSen) || 0,
    walletRequested: Number(o.walletRequestedSen) || 0,
    walletUsed: Number(o.walletUsedSen) || 0,
    discount: Number(o.discountSen) || 0,
    finalAmount: Number(o.finalAmountSen) || 0,
    pointsEarned: Number(o.pointsEarned) || 0,
    orderStatus: o.orderStatus,
    paymentMethod: o.paymentMethod || '',
    paymentStatus: o.paymentStatus || 'UNPAID',
    customerNote: o.customerNote || '',
    channel: o.channel || 'YETIPSY_APP',
    createdAt: o.createdAt || '',
    confirmedAt: o.confirmedAt || '',
    readyAt: o.readyAt || '',
    completedAt: o.completedAt || '',
    cancelledAt: o.cancelledAt || '',
    cancelReason: o.cancelReason || '',
    /* §49 等待秒数由 CreatedAt 现算，不存库 */
    waitingSeconds: created ? Math.max(0, Math.floor((Date.now() - created) / 1000)) : 0,
    items: items || []
  };
}

function publicOrderItem(it) {
  return {
    orderItemId: it.orderItemId,
    productId: it.productId,
    name: it.productNameSnapshot || '',
    nameZH: it.productNameSnapshot && it.productNameZh ? it.productNameZh : '',
    unitPrice: Number(it.unitPriceSen) || 0,
    quantity: Number(it.quantity) || 0,
    options: parseOptionsJson(it.optionsJSON),
    optionsPrice: Number(it.optionsPriceSen) || 0,
    lineTotal: Number(it.lineTotalSen) || 0,
    note: it.customerNote || ''
  };
}

function parseOptionsJson(json) {
  try {
    var arr = JSON.parse(String(json || '[]'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/** 显示用订单编号 YT260917001（§45） */
function nextOrderNumber() {
  var d = new Date();
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  var ymd;
  try {
    ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz }).replace(/-/g, '');
  } catch (e) {
    ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  var yymmdd = ymd.slice(2);                       // 20260917 → 260917
  return dbNextId('YT' + yymmdd, 'ordernum:' + yymmdd, 3);
}

/* -------------------------------------------------------------
   2. placeOrder（§60 / §75）
   ------------------------------------------------------------- */

/**
 * data: { quoteToken, idempotencyKey, orderType, tableNumber,
 *         useWallet, paymentMethod, customerNote }
 *
 * 金额完全来自 Quote；前端送来的 subtotal / total / wallet 一律忽略。
 */
function placeOrder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  /* §44 幂等：同一个 key 已经下过单就直接回那一张 */
  var idemKey = String((data && data.idempotencyKey) || '').trim();
  if (!idemKey) {
    return err('INVALID_INPUT', 'Missing idempotency key. / 缺少防重复下单的识别码。');
  }
  var existing = dbFind('appOrders', function (o) {
    return o.idempotencyKey === idemKey && o.customerId === customer.customerId;
  });
  if (existing) {
    return ok({
      order: publicAppOrder(existing, orderItemsOf(existing.appOrderId)),
      duplicate: true,
      message: 'This order was already submitted. / 这张订单已经提交过了。'
    });
  }

  /* §64 点单开关（Quote 之后可能已经被员工暂停） */
  var win = orderingWindowState();
  if (!win.enabled) return err('ORDERING_CLOSED');
  if (win.paused) return err('ORDERING_PAUSED');
  if (!win.open) return err('ORDERING_CLOSED');

  /* §43 Quote 必须还在有效期内，而且属于这位会员 */
  var found = loadQuote(data && data.quoteToken, customer.customerId);
  if (!found.ok) return found.error;
  var quote = found.quote;

  /* Quote 里的 idempotencyKey 必须跟送来的一致，避免拿旧 Quote 配新 key 绕过 */
  if (quote.idempotencyKey !== idemKey) {
    return err('QUOTE_MISMATCH',
      'This checkout link has changed. Please review your cart again. / 结帐资讯已变动，请重新确认。');
  }

  /* §66 下单前再验一次库存（Quote 之后可能卖完） */
  for (var i = 0; i < quote.lines.length; i++) {
    var p = dbById('products', quote.lines[i].productId);
    if (!p || String(p.status).toUpperCase() !== 'ACTIVE') {
      return err('PRODUCT_NOT_FOUND', quote.lines[i].productNameSnapshot);
    }
    if (String(p.available).toUpperCase() === 'FALSE') {
      return err('PRODUCT_UNAVAILABLE',
        (p.nameEN || p.productId) + ' is sold out. / 已售完。');
    }
  }

  /* §54 钱包只「要求」，这一步不扣钱 */
  var walletRequested = Number(quote.walletAppliedSen) || 0;
  if (walletRequested > (Number(customer.walletBalance) || 0)) {
    /* Quote 之后余额被用掉了 → 请重新结帐，不要静默改金额 */
    return err('QUOTE_MISMATCH',
      'Wallet balance changed. Please checkout again. / 钱包余额已变动，请重新结帐。');
  }

  var paymentMethod = String((data && data.paymentMethod) || 'COUNTER').toUpperCase();
  if (['COUNTER', 'CASH', 'DUITNOW', 'CARD', 'FOODCOURT', 'ONLINE'].indexOf(paymentMethod) === -1) {
    paymentMethod = 'COUNTER';
  }

  var appOrder = {
    appOrderId: dbNextId('APO', 'apporder', 6),
    orderNumber: nextOrderNumber(),
    customerId: customer.customerId,
    orderType: quote.orderType,
    tableNumber: quote.tableNumber || '',
    itemCount: Number(quote.itemCount) || quote.lines.length,
    subtotalSen: Number(quote.subtotalSen) || 0,
    walletRequestedSen: walletRequested,
    walletUsedSen: 0,                 // §54 确认收款时才写
    discountSen: Number(quote.discountSen) || 0,
    finalAmountSen: Number(quote.finalAmountSen) || 0,
    pointsEarned: 0,                  // §22 完成后才发
    orderStatus: 'SUBMITTED',
    paymentMethod: paymentMethod,
    paymentStatus: 'UNPAID',
    paymentReference: '',
    quoteToken: quote.quoteToken,
    idempotencyKey: idemKey,
    customerNote: quote.customerNote || '',
    channel: 'YETIPSY_APP',
    ordersTxId: '',
    handledBy: '',
    createdAt: nowISO(),
    confirmedAt: '',
    readyAt: '',
    completedAt: '',
    cancelledAt: '',
    cancelledBy: '',
    cancelReason: '',
    updatedAt: nowISO()
  };
  dbInsert('appOrders', appOrder);

  /* §30 明细：名称与单价都在这一刻快照下来 */
  quote.lines.forEach(function (line) {
    dbInsert('orderItems', {
      orderItemId: dbNextId('OIT', 'orderitem', 6),
      appOrderId: appOrder.appOrderId,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      unitPriceSen: Number(line.unitPriceSen) || 0,
      quantity: Number(line.quantity) || 1,
      optionsJSON: JSON.stringify(line.options || []),
      optionsPriceSen: Number(line.optionsPriceSen) || 0,
      lineTotalSen: Number(line.lineTotalSen) || 0,
      customerNote: line.customerNote || '',
      createdAt: nowISO()
    });
  });

  consumeQuote(quote.quoteToken);      // 一张 Quote 只能用一次

  audit(customer.customerId, 'CUSTOMER', 'PLACE_ORDER', 'APP_ORDER', appOrder.appOrderId,
        '', appOrder.orderNumber + ' | ' + appOrder.finalAmountSen + ' | ' + appOrder.orderType +
        (appOrder.tableNumber ? ' ' + appOrder.tableNumber : ''));

  return ok({
    order: publicAppOrder(appOrder, orderItemsOf(appOrder.appOrderId)),
    duplicate: false
  });
}

function orderItemsOf(appOrderId) {
  return dbFilter('orderItems', function (it) {
    return it.appOrderId === appOrderId;
  }).map(publicOrderItem);
}

/* -------------------------------------------------------------
   3. 查询（§60）
   ------------------------------------------------------------- */

/** getAppOrder —— 顾客看自己的订单（§17 订单追踪） */
function getAppOrder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  /* 只能看自己的（§12 防伪造 CustomerID） */
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)) });
}

/** getMyOrders —— 订单列表（§37 再点一次也要用） */
function getMyOrders(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var limit = Math.min(50, Math.max(1, Math.round(Number((data && data.limit) || 20)) || 20));
  var status = String((data && data.status) || '').trim().toUpperCase();

  var list = dbFilter('appOrders', function (o) {
    if (o.customerId !== ctx.customer.customerId) return false;
    if (status && o.orderStatus !== status) return false;
    return true;
  }).slice().reverse().slice(0, limit);

  return ok({
    orders: list.map(function (o) {
      var pub = publicAppOrder(o, orderItemsOf(o.appOrderId));
      /* 列表不需要完整明细，给前几项就够画卡片 */
      pub.items = pub.items.slice(0, 4);
      return pub;
    }),
    count: list.length
  });
}

/* -------------------------------------------------------------
   4. 取消（§53）
   ------------------------------------------------------------- */

/**
 * requestOrderCancellation —— SUBMITTED 且员工还没 Accept 时，顾客可以要求取消。
 * 已经 CONFIRMED / PREPARING 之后一律要员工处理（回 CANCEL_NOT_ALLOWED）。
 */
function requestOrderCancellation(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  if (o.orderStatus === 'CANCELLED') {
    return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)), alreadyCancelled: true });
  }
  if (o.orderStatus !== 'SUBMITTED') {
    return err('CANCEL_NOT_ALLOWED',
      'This order is already being prepared. Please ask our staff. / ' +
      '这张订单已开始制作，请联系店员。');
  }
  if (o.orderStatus === 'COMPLETED') return err('ORDER_ALREADY_FINAL');

  o.orderStatus = 'CANCELLED';
  o.cancelledAt = nowISO();
  o.cancelledBy = ctx.customer.customerId;
  o.cancelReason = String((data && data.reason) || 'Cancelled by customer').slice(0, 200);
  o.updatedAt = nowISO();
  /* §54 这一步没扣过钱包，所以不需要 reversal；walletUsedSen 保持 0 */

  audit(ctx.customer.customerId, 'CUSTOMER', 'REQUEST_ORDER_CANCEL', 'APP_ORDER',
        o.appOrderId, 'SUBMITTED', 'CANCELLED | ' + o.cancelReason);

  return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)) });
}

/* -------------------------------------------------------------
   5. 再点一次（§37）
   ------------------------------------------------------------- */

/**
 * reorder —— 把旧订单里「仍然有货」的商品整理成购物车，
 * 由前端放进 CART。价格用现在的价格（不是旧价格），因为要重新报价。
 */
function reorder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  var today = todayKeyOf();
  var available = [];
  var unavailable = [];

  orderItemsOf(o.appOrderId).forEach(function (it) {
    var p = dbById('products', it.productId);
    if (!p || String(p.status).toUpperCase() !== 'ACTIVE' ||
        String(p.available).toUpperCase() === 'FALSE') {
      unavailable.push({ productId: it.productId, name: it.name });
      return;
    }
    /* 规格也要还在，否则顾客会拿到选不到的选项 */
    var optionIds = (it.options || []).map(function (x) { return x.optionId; }).filter(function (id) {
      var opt = dbById('productOptions', String(id));
      return opt && opt.productId === p.productId && String(opt.status).toUpperCase() === 'ACTIVE';
    });
    var price = effectivePriceSen(p, today);
    available.push({
      productId: p.productId,
      nameEN: p.nameEN,
      nameZH: p.nameZH,
      unitPrice: price.priceSen,
      quantity: Number(it.quantity) || 1,
      options: optionIds,
      note: it.note || ''
    });
  });

  return ok({
    appOrderId: o.appOrderId,
    items: available,
    unavailable: unavailable,
    /* 价格可能已经变过，前端要重新走一次 Checkout Quote */
    priceChanged: available.some(function (it, i) {
      var old = orderItemsOf(o.appOrderId)[i];
      return old && Number(old.unitPrice) !== Number(it.unitPrice);
    })
  });
}
