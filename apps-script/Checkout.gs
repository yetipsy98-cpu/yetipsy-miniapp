/* =============================================================
   YETIPSY MINI APP 2.1.5 — Checkout.gs（2.0 Phase 5）
   -------------------------------------------------------------
   结帐报价（§42 / §43 / §44）

   流程：Cart → createCheckoutQuote() → 顾客确认 → placeOrder()

   不能违反的规则：
   · §41/§42 前端只能送 ProductID / Quantity / Options。价格一律由
     Backend 读 Products 重算，前端送来的任何金额都被忽略。
   · §66 即使商品已在 Cart 里，Checkout 仍要再验一次库存。
   · §8 规格必须属于该商品、必须是 ACTIVE、必选组不能漏。
   · §43 Quote 有短效期（CHECKOUT_QUOTE_EXPIRY_MINUTES），过期要重新报价。
   · §44 每次 Quote 附一个 IdempotencyKey，placeOrder 用它防重复下单。
   · §10 这里只「记录」钱包要用多少，**不扣钱**；扣钱在订单确认时（§54）。
   · §82 报价里含钱包余额 → 绝不进 CacheService 的长期缓存，
     只用短效 Quote 键，且钱包数字每次现读。
   ============================================================= */

var QUOTE_CACHE_PREFIX = 'checkoutquote:';

/** Quote 有效秒数（§43，预设 5 分钟） */
function quoteTtlSeconds() {
  var minutes = numSetting('CHECKOUT_QUOTE_EXPIRY_MINUTES', 5);
  if (!isFinite(minutes) || minutes <= 0) minutes = 5;
  return Math.min(3600, Math.round(minutes * 60));      // 最多 1 小时
}

/* -------------------------------------------------------------
   1. 校验购物车（§42）
   ------------------------------------------------------------- */

/**
 * 把前端送的 cart 逐项对照 Products / ProductOptions 重算。
 * 回传 { ok:true, lines:[...], subtotalSen, itemCount } 或 { ok:false, error }
 *
 * 前端送来的每一项只认这几个栏位：
 *   { productId, quantity, options:[optionId...], note }
 * 其余（price / amount / total / discount…）一律忽略。
 */
function priceCart(cartItems) {
  var maxItems = numSetting('MAX_ORDER_ITEMS', 20);
  if (!cartItems || !cartItems.length) {
    return { ok: false, error: err('INVALID_INPUT', 'Cart is empty. / 购物车是空的。') };
  }
  if (cartItems.length > maxItems) {
    return { ok: false, error: err('TOO_MANY_ITEMS',
      'Max ' + maxItems + ' items per order. / 单张订单最多 ' + maxItems + ' 项。') };
  }

  var today = todayKeyOf();
  var lines = [];
  var subtotal = 0;
  var itemCount = 0;

  for (var i = 0; i < cartItems.length; i++) {
    var raw = cartItems[i] || {};
    var product = dbById('products', String(raw.productId || ''));

    if (!product || String(product.status).toUpperCase() !== 'ACTIVE') {
      return { ok: false, error: err('PRODUCT_NOT_FOUND',
        'Product not found: ' + String(raw.productId || '(empty)')) };
    }
    /* §66 已经放进 Cart 也要再验一次 */
    if (String(product.available).toUpperCase() === 'FALSE') {
      return { ok: false, error: err('PRODUCT_UNAVAILABLE',
        (product.nameEN || product.productId) + ' is sold out. / 已售完。') };
    }

    var qty = Math.round(Number(raw.quantity));
    if (!isFinite(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: err('INVALID_QUANTITY',
        'Invalid quantity for ' + (product.nameEN || product.productId)) };
    }

    /* 规格：必须属于这个商品、必须 ACTIVE、同组不能选两个、必选组不能漏 */
    var allOptions = dbFilter('productOptions', function (o) {
      return o.productId === product.productId && String(o.status).toUpperCase() === 'ACTIVE';
    });

    var wantedIds = {};
    (Array.isArray(raw.options) ? raw.options : []).forEach(function (id) {
      wantedIds[String(id)] = true;
    });

    var chosen = [];
    var seenGroups = {};
    var optionsPrice = 0;
    for (var j = 0; j < allOptions.length; j++) {
      var opt = allOptions[j];
      if (!wantedIds[opt.optionId]) continue;
      if (seenGroups[opt.optionGroup]) {
        return { ok: false, error: err('INVALID_INPUT',
          'Only one option per group (' + opt.optionGroup + '). / 同一组规格只能选一个。') };
      }
      seenGroups[opt.optionGroup] = true;
      chosen.push({
        optionId: opt.optionId,
        optionGroup: opt.optionGroup,
        nameEN: opt.nameEN || '',
        nameZH: opt.nameZH || ''
      });
      optionsPrice += Math.round(Number(opt.priceAdjustmentSen) || 0);
    }

    var requiredGroups = {};
    allOptions.forEach(function (o) {
      if (String(o.required).toUpperCase() === 'TRUE') requiredGroups[o.optionGroup] = true;
    });
    var missing = Object.keys(requiredGroups).filter(function (g) { return !seenGroups[g]; });
    if (missing.length) {
      return { ok: false, error: err('OPTION_REQUIRED',
        'Please choose ' + missing.join(', ') + '. / 请选择必选规格：' + missing.join('、')) };
    }

    /* §30 快照：名称与单价在下单当下就固定下来 */
    var price = effectivePriceSen(product, today);
    var unitPrice = price.priceSen;
    var lineTotal = (unitPrice + optionsPrice) * qty;

    subtotal += lineTotal;
    itemCount += qty;
    lines.push({
      productId: product.productId,
      productNameSnapshot: product.nameEN || product.nameZH || product.productId,
      productNameZhSnapshot: product.nameZH || '',
      unitPriceSen: unitPrice,
      quantity: qty,
      options: chosen,
      optionsPriceSen: optionsPrice,
      lineTotalSen: lineTotal,
      customerNote: String(raw.note || '').slice(0, 200),
      onPromo: price.onPromo
    });
  }

  if (subtotal <= 0) {
    return { ok: false, error: err('INVALID_AMOUNT', 'Order total must be above 0.') };
  }

  return { ok: true, lines: lines, subtotalSen: subtotal, itemCount: itemCount };
}

/* -------------------------------------------------------------
   2. 桌号 / 取餐方式（§11）
   ------------------------------------------------------------- */

/** 回传 { ok, orderType, tableNumber } 或 { ok:false, error } */
function resolveOrderType(data) {
  var type = String((data && data.orderType) || '').trim().toUpperCase();
  var table = String((data && data.tableNumber) || '').trim().toUpperCase().slice(0, 12);

  var allowTable = boolSetting('ALLOW_TABLE_ORDER', true);
  var allowPickup = boolSetting('ALLOW_PICKUP', true);

  if (!type) type = table ? 'TABLE' : 'COUNTER';

  if (type === 'TABLE') {
    if (!allowTable) {
      return { ok: false, error: err('INVALID_INPUT',
        'Table orders are not available. / 目前不提供桌号点单。') };
    }
    if (!table) {
      return { ok: false, error: err('INVALID_INPUT',
        'Please enter your table number. / 请输入桌号。') };
    }
  } else if (type === 'COUNTER' || type === 'PICKUP' || type === 'TAKEAWAY') {
    if (!allowPickup) {
      return { ok: false, error: err('INVALID_INPUT',
        'Pickup is not available. / 目前不提供自取。') };
    }
    type = (type === 'PICKUP') ? 'COUNTER' : type;
    table = '';
  } else {
    return { ok: false, error: err('INVALID_INPUT',
      'Unknown order type: ' + type + ' / 不正确的取餐方式。') };
  }

  return { ok: true, orderType: type, tableNumber: table };
}

/* -------------------------------------------------------------
   3. createCheckoutQuote（§43 / §60）
   ------------------------------------------------------------- */

/**
 * data: { items:[{productId, quantity, options:[optionId], note}],
 *         orderType:'TABLE'|'COUNTER'|'TAKEAWAY', tableNumber:'A12',
 *         useWallet:true|false, customerNote:'...' }
 */
function createCheckoutQuote(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  /* §64 点单开关 */
  var win = orderingWindowState();
  if (!win.enabled) return err('ORDERING_CLOSED');
  if (win.paused) return err('ORDERING_PAUSED');
  if (!win.open) {
    return err('ORDERING_CLOSED',
      'Ordering hours ' + win.openTime + ' – ' + win.closeTime +
      '. / 点单时间 ' + win.openTime + ' – ' + win.closeTime + '。');
  }

  var priced = priceCart(data && data.items);
  if (!priced.ok) return priced.error;

  var placement = resolveOrderType(data);
  if (!placement.ok) return placement.error;

  /* §10 钱包：这里只「算」能用多少，不扣钱 */
  var useWallet = !!(data && data.useWallet);
  var plan = walletRedemptionPlan(customer, priced.subtotalSen);
  var walletApplied = useWallet && plan.allowed ? plan.usableAmount : 0;

  var finalAmount = priced.subtotalSen - walletApplied;
  if (finalAmount < 0) finalAmount = 0;

  var quoteToken = randomToken(16);
  var idempotencyKey = randomToken(16);
  var ttl = quoteTtlSeconds();
  var now = Date.now();

  var quote = {
    quoteToken: quoteToken,
    customerId: customer.customerId,
    lines: priced.lines,
    itemCount: priced.itemCount,
    subtotalSen: priced.subtotalSen,
    useWallet: useWallet,
    walletBalanceSen: plan.walletBalance,       // 报价当下的余额（§82 不做长期缓存）
    walletMaxUsableSen: plan.maxUsable,
    walletAppliedSen: walletApplied,
    walletReason: useWallet && !plan.allowed ? plan.reason : '',
    discountSen: 0,
    finalAmountSen: finalAmount,
    orderType: placement.orderType,
    tableNumber: placement.tableNumber,
    customerNote: String((data && data.customerNote) || '').slice(0, 200),
    idempotencyKey: idempotencyKey,
    createdAt: nowISO(),
    expiresAtMs: now + ttl * 1000
  };

  rateLimitSet(QUOTE_CACHE_PREFIX + quoteToken, quote, ttl);

  return ok({
    quoteToken: quoteToken,
    idempotencyKey: idempotencyKey,
    expiresInMinutes: Math.round(ttl / 60 * 10) / 10,
    lines: quote.lines,
    itemCount: quote.itemCount,
    subtotal: quote.subtotalSen,
    wallet: {
      requested: useWallet,
      balance: plan.walletBalance,
      maxUsable: plan.maxUsable,
      applied: walletApplied,
      maxPercent: plan.maxPercent,
      minBill: plan.minBill,
      allowed: plan.allowed,
      reason: quote.walletReason
    },
    discount: 0,
    finalAmount: finalAmount,
    customerPays: finalAmount,
    orderType: quote.orderType,
    tableNumber: quote.tableNumber,
    /* §57 预告积分。注意要传「毛额 + 钱包抵扣」，因为 pointsForAmount()
       在 NET_PAID 模式下自己会做 billAmount - walletUsed；
       传已经扣过钱包的 finalAmount 会扣两次。
       真正发放仍以完成订单时后端计算为准（§22）。 */
    estimatedPoints: pointsForAmount(priced.subtotalSen, walletApplied),
    ordering: win
  });
}

/* -------------------------------------------------------------
   4. 读取 / 校验 Quote（给 placeOrder 用）
   ------------------------------------------------------------- */

/** 取出并验证 Quote；回传 { ok, quote } 或 { ok:false, error } */
function loadQuote(quoteToken, customerId) {
  var key = QUOTE_CACHE_PREFIX + String(quoteToken || '');
  var quote = rateLimitGet(key);
  if (!quote || !quote.quoteToken) {
    return { ok: false, error: err('QUOTE_EXPIRED') };
  }
  if (String(quote.customerId) !== String(customerId)) {
    /* 别人的 Quote 不能用（§12 防伪造） */
    return { ok: false, error: err('QUOTE_EXPIRED', 'Quote does not match this member.') };
  }
  /* 「在 T 时刻到期」= T 时刻就失效，所以用 <=。
     用 < 的话，到期那一毫秒仍会被当成有效（TTL 0 时会变成随机结果）。 */
  if (Number(quote.expiresAtMs) <= Date.now()) {
    rateLimitClear(key);
    return { ok: false, error: err('QUOTE_EXPIRED') };
  }
  return { ok: true, quote: quote };
}

/** 用掉 Quote（下单成功或作废时呼叫），避免同一张被用两次 */
function consumeQuote(quoteToken) {
  rateLimitClear(QUOTE_CACHE_PREFIX + String(quoteToken || ''));
}

/**
 * 顾客可以主动重新取得报价（例如回到 Cart 改了东西）。
 * 单纯查询，不产生新的 IdempotencyKey。
 */
function getCheckoutQuote(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var found = loadQuote(data && data.quoteToken, ctx.customer.customerId);
  if (!found.ok) return found.error;
  var q = found.quote;

  return ok({
    quoteToken: q.quoteToken,
    idempotencyKey: q.idempotencyKey,
    expiresInMinutes: Math.max(0, Math.round((Number(q.expiresAtMs) - Date.now()) / 6000) / 10),
    lines: q.lines,
    itemCount: q.itemCount,
    subtotal: q.subtotalSen,
    walletApplied: q.walletAppliedSen,
    finalAmount: q.finalAmountSen,
    orderType: q.orderType,
    tableNumber: q.tableNumber
  });
}
