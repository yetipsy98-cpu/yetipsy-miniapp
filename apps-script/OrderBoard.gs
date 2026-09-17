/* =============================================================
   YETIPSY — OrderBoard.gs（2.0 Phase 7）
   -------------------------------------------------------------
   员工端订单看板（§16 §19 §20 §21 §22 §46 §48 §49 §54 §55 §56 §61）

   状态流：SUBMITTED → CONFIRMED → PREPARING → READY → COMPLETED
                                                 └→ CANCELLED

   不能违反的规则：
   · §55 completeOrder() 必须幂等：连按两次只发一次积分、一次 Reward、
         加一次 Visit。第二次呼叫要回 alreadyCompleted，而不是再发一次。
   · §22 积分 / Reward / Visit 一律等到 COMPLETED 才发。
   · §54 钱包在下单时只是「要求」；markPaymentPaid 才真的扣。
         已经扣过又取消 → 必须 REVERSAL，WalletTransactions 留完整记录。
   · §56 1 张订单 ≠ 1 次到店：同一位会员在 VISIT_SESSION_HOURS 内
         完成多张订单只算 1 次 Visit。
   · §77 积分 / Reward / 钱包 / 等级一律呼叫 1.x 的引擎，不重写第二套。
   · §24/§51 完成时同时写一笔 1.x Orders（source = YETIPSY_APP），
         这样通路业绩分析看得到，Foodcourt 的流程也完全不受影响。
   · §46 回传 ORDER_POLL_SECONDS 给看板轮询用，不要 1 秒。
   ============================================================= */

/* -------------------------------------------------------------
   1. 状态流转表
   ------------------------------------------------------------- */

var ORDER_NEXT_STATUS = {
  SUBMITTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY:     ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

/** 看板用的订单形状：含会员与品项（§21） */
function boardOrder(o) {
  var customer = dbById('customers', o.customerId);
  var pub = publicAppOrder(o, orderItemsOf(o.appOrderId));
  pub.customer = customer ? {
    customerId: customer.customerId,
    name: customer.name || '',
    displayName: maskName(customer.name || ''),
    membershipTier: customer.membershipTier || 'MEMBER',
    currentPoints: Number(customer.currentPoints) || 0,
    walletBalance: Number(customer.walletBalance) || 0
  } : null;
  return pub;
}

function assertTransition(order, to) {
  var allowed = ORDER_NEXT_STATUS[order.orderStatus] || [];
  if (allowed.indexOf(to) === -1) {
    return err('ORDER_STATUS_INVALID',
      'Cannot move ' + order.orderStatus + ' → ' + to +
      '. / 订单不能从 ' + order.orderStatus + ' 变成 ' + to + '。');
  }
  return null;
}

function findBoardOrder(data, token, roles) {
  var ctx = requireStaff(token, roles);
  if (ctx.error) return { error: ctx.error };

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return { error: err('ORDER_NOT_FOUND') };
  return { ctx: ctx, order: o };
}

/* -------------------------------------------------------------
   2. 看板查询（§19 §20 §61）
   ------------------------------------------------------------- */

/** getIncomingOrders —— NEW 区（SUBMITTED） */
function getIncomingOrders(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var list = dbFilter('appOrders', function (o) { return o.orderStatus === 'SUBMITTED'; })
    .slice().reverse();

  return ok({
    orders: list.map(boardOrder),
    count: list.length,
    pollSeconds: numSetting('ORDER_POLL_SECONDS', 8),      // §46
    ordering: orderingWindowState()
  });
}

/** getActiveOrders —— NEW / PREPARING / READY 三栏（§20） */
function getActiveOrders(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var active = ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'];
  var list = dbFilter('appOrders', function (o) {
    return active.indexOf(o.orderStatus) >= 0;
  }).slice().reverse();

  var lanes = { NEW: [], CONFIRMED: [], PREPARING: [], READY: [] };
  list.forEach(function (o) {
    var pub = boardOrder(o);
    if (o.orderStatus === 'SUBMITTED') lanes.NEW.push(pub);
    else if (o.orderStatus === 'CONFIRMED') lanes.CONFIRMED.push(pub);
    else if (o.orderStatus === 'PREPARING') lanes.PREPARING.push(pub);
    else lanes.READY.push(pub);
  });

  /* §50 今日统计（看板顶部） */
  var today = todayKeyOf();
  var completedToday = dbFilter('appOrders', function (o) {
    return o.orderStatus === 'COMPLETED' &&
      String(o.completedAt || '').slice(0, 10) === today;
  });
  var salesToday = completedToday.reduce(function (s, o) {
    return s + (Number(o.finalAmountSen) || 0);
  }, 0);

  return ok({
    lanes: lanes,
    orders: list.map(boardOrder),
    count: list.length,
    today: {
      date: today,
      orders: completedToday.length,
      sales: salesToday,
      averageOrder: completedToday.length
        ? Math.round(salesToday / completedToday.length) : 0
    },
    pollSeconds: numSetting('ORDER_POLL_SECONDS', 8),
    ordering: orderingWindowState()
  });
}

/* -------------------------------------------------------------
   3. 状态推进（§61）
   ------------------------------------------------------------- */

/** acceptOrder —— SUBMITTED → CONFIRMED（§19） */
function acceptOrder(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  var bad = assertTransition(o, 'CONFIRMED');
  if (bad) return bad;

  o.orderStatus = 'CONFIRMED';
  o.confirmedAt = nowISO();
  o.handledBy = staff.staffId;
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'ACCEPT_ORDER', 'APP_ORDER', o.appOrderId,
        'SUBMITTED', 'CONFIRMED');
  return ok({ order: boardOrder(o) });
}

/** startPreparing —— CONFIRMED → PREPARING */
function startPreparing(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  /* 员工从 SUBMITTED 直接按 START 也接受（§20 的看板就是这样用的） */
  if (o.orderStatus === 'SUBMITTED') {
    o.confirmedAt = o.confirmedAt || nowISO();
    o.orderStatus = 'CONFIRMED';
  }
  var bad = assertTransition(o, 'PREPARING');
  if (bad) return bad;

  o.orderStatus = 'PREPARING';
  o.handledBy = staff.staffId;
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'START_PREPARING', 'APP_ORDER', o.appOrderId,
        'CONFIRMED', 'PREPARING');
  return ok({ order: boardOrder(o) });
}

/** markReady —— PREPARING → READY（§18 顾客端会显示取酒提示） */
function markReady(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  if (o.orderStatus === 'CONFIRMED') o.orderStatus = 'PREPARING';   // 允许跳一步
  var bad = assertTransition(o, 'READY');
  if (bad) return bad;

  o.orderStatus = 'READY';
  o.readyAt = nowISO();
  o.handledBy = staff.staffId;
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'MARK_READY', 'APP_ORDER', o.appOrderId,
        'PREPARING', 'READY');
  return ok({ order: boardOrder(o) });
}

/* -------------------------------------------------------------
   4. 收款（§54：这一步才真的扣钱包）
   ------------------------------------------------------------- */

/**
 * markPaymentPaid —— 确认收款。
 * 若订单要求用钱包，这里才真的扣（§54），并写一笔 WalletTransaction。
 * 可重复呼叫：已经 PAID 就直接回传，不会扣两次。
 */
function markPaymentPaid(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  if (o.paymentStatus === 'PAID') {
    return ok({ order: boardOrder(o), alreadyPaid: true });
  }
  if (['COMPLETED'].indexOf(o.orderStatus) >= 0 && o.paymentStatus === 'PAID') {
    return ok({ order: boardOrder(o), alreadyPaid: true });
  }

  var customer = dbById('customers', o.customerId);
  if (!customer) return err('CUSTOMER_NOT_FOUND');

  var method = String((data && data.paymentMethod) || o.paymentMethod || 'COUNTER').toUpperCase();
  if (['COUNTER', 'CASH', 'DUITNOW', 'CARD', 'FOODCOURT', 'ONLINE'].indexOf(method) === -1) {
    method = 'COUNTER';
  }

  /* §54 现在才真的扣钱包 */
  var requested = Number(o.walletRequestedSen) || 0;
  var used = 0;
  if (requested > 0) {
    var balance = Number(customer.walletBalance) || 0;
    if (balance < requested) {
      return err('INSUFFICIENT_WALLET',
        'Wallet balance is lower than the reserved amount. / 钱包余额少于下单时预留的金额。');
    }
    /* 用 1.x 的引擎扣款，WalletTx 才会有完整纪录 */
    walletCredit(customer, null, -requested, 'REDEEM',
                 'App order ' + o.orderNumber, staff.staffId, 'STAFF');
    used = requested;
    o.walletUsedSen = requested;
  }

  o.paymentMethod = method;
  o.paymentStatus = 'PAID';
  o.paymentReference = String((data && data.paymentReference) || '').slice(0, 60);
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'MARK_PAYMENT_PAID', 'APP_ORDER', o.appOrderId,
        'UNPAID', 'PAID | ' + method + ' | wallet ' + used);

  return ok({ order: boardOrder(o), walletUsed: used });
}

/* -------------------------------------------------------------
   5. 完成订单（§22 §55 §56 §57 §58）
   ------------------------------------------------------------- */

/**
 * completeOrder —— READY → COMPLETED。
 *
 * §55 幂等：已经 COMPLETED 就回 alreadyCompleted，绝不再发一次积分 / Reward。
 * §22 这一步才发积分、算 Visit、产生 Reward。
 * §56 6 小时内完成多张订单只算 1 次 Visit。
 * 未收款不能完成（§12 安全审计：Complete Unpaid Order）。
 */
function completeOrder(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  /* §55 幂等：第二次按 COMPLETE 不能再发一次 */
  if (o.orderStatus === 'COMPLETED') {
    return ok({
      order: boardOrder(o),
      alreadyCompleted: true,
      pointsIssued: 0,
      reward: null,
      visitCounted: false,
      message: 'This order was already completed. / 这张订单已经完成过了。'
    });
  }

  /* 未收款不能完成（§12）——先看状态机，再看付款，错误码才精准 */
  var bad = assertTransition(o, 'COMPLETED');
  if (bad) return bad;

  if (o.paymentStatus !== 'PAID') {
    return err('ORDER_NOT_PAID',
      'Confirm payment before completing. / 请先确认收款再完成订单。');
  }

  var customer = dbById('customers', o.customerId);
  if (!customer) return err('CUSTOMER_NOT_FOUND');

  var bill = Number(o.subtotalSen) || 0;              // 毛额
  var walletUsed = Number(o.walletUsedSen) || 0;
  var netPaid = Math.max(0, bill - walletUsed);       // §57 NET_PAID 的基础

  /* §24/§51 同时写一笔 1.x Orders，通路业绩才看得到 */
  var tx = createMemberTransaction({
    externalOrderId: o.orderNumber,
    source: 'YETIPSY_APP',
    amount: bill,
    customerId: customer.customerId,
    createdBy: staff.staffId,
    actorType: 'STAFF',
    note: (o.orderType === 'TABLE' ? 'Table ' + o.tableNumber : o.orderType) +
          (o.customerNote ? ' | ' + o.customerNote : '')
  });
  tx.walletUsed = walletUsed;
  tx.finalAmount = netPaid;
  o.ordersTxId = tx.orderId;

  /*
   * §56 6 小时内完成多张订单只算 1 次 Visit。
   * 注意：上面刚建立的 tx 本身就是一笔「刚完成的订单」，
   * 必须排除掉，否则连第一张订单都会被判定成「这次已经到店过了」。
   */
  var visitCounted = shouldCountVisit(customer, o, tx.orderId);
  customer.totalSpend = (Number(customer.totalSpend) || 0) + bill;
  if (visitCounted) {
    customer.totalVisits = (Number(customer.totalVisits) || 0) + 1;
    customer.lastVisitAt = nowISO();
  }

  /* §22 / §57 积分：呼叫 1.x 的引擎，不自己算第二套 */
  var points = pointsForAmount(bill, walletUsed);
  o.pointsEarned = points;
  tx.pointsEarned = points;
  issuePoints(customer, tx, points,
              'App order ' + o.orderNumber, staff.staffId, 'STAFF', 'EARN');

  /* §58 Reward：继续用 1.x 的 Reward 系统 */
  var reward = generateReward(customer, tx, bill);
  if (reward) {
    tx.rewardId = reward.rewardId;
    tx.rewardAmount = Number(reward.amount) || 0;
    customer.totalRewards = (Number(customer.totalRewards) || 0) + 1;
  }

  o.orderStatus = 'COMPLETED';
  o.completedAt = nowISO();
  o.handledBy = staff.staffId;
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'COMPLETE_ORDER', 'APP_ORDER', o.appOrderId,
        'READY', 'COMPLETED | points ' + points + ' | visit ' + (visitCounted ? 'YES' : 'NO') +
        (reward ? ' | reward ' + reward.rewardId : ''));

  return ok({
    order: boardOrder(o),
    alreadyCompleted: false,
    pointsIssued: points,
    visitCounted: visitCounted,
    reward: reward ? { rewardId: reward.rewardId, amount: reward.amount, status: reward.status } : null,
    membership: membershipInfo(customer),
    customer: publicCustomer(customer)
  });
}

/**
 * §56 这位会员在 VISIT_SESSION_HOURS 内是否已经算过一次到店？
 * 看 AppOrders（COMPLETED）与 1.x Orders 两边，任何一边有就算过了。
 */
/**
 * §56 这位会员在 VISIT_SESSION_HOURS 内是否已经算过一次到店？
 * 看 AppOrders（COMPLETED）与 1.x Orders 两边，任何一边有就算过了。
 *
 * 两条通路共用这一个判断（§24）：
 *   · App 订单完成时 currentOrder 传该订单、excludeOrderId 传刚建立的 1.x 订单
 *   · Foodcourt 认领时 currentOrder 传 null、excludeOrderId 传该认领对应的订单
 */
function shouldCountVisit(customer, currentOrder, excludeOrderId) {
  var hours = numSetting('VISIT_SESSION_HOURS', 6);
  if (hours <= 0) return true;
  var windowMs = hours * 3600000;
  var now = Date.now();

  var appHit = dbFind('appOrders', function (o) {
    if (currentOrder && o.appOrderId === currentOrder.appOrderId) return false;   // 自己不算
    if (o.customerId !== customer.customerId) return false;
    if (o.orderStatus !== 'COMPLETED' || !o.completedAt) return false;
    return (now - new Date(o.completedAt).getTime()) <= windowMs;
  });
  if (appHit) return false;

  var orderHit = dbFind('orders', function (r) {
    if (excludeOrderId && r.orderId === excludeOrderId) return false;   // 刚建立的那笔不算
    if (r.customerId !== customer.customerId) return false;
    var at = r.completedAt || r.claimedAt || r.createdAt;
    if (!at) return false;
    return (now - new Date(at).getTime()) <= windowMs;
  });
  return !orderHit;
}

/* -------------------------------------------------------------
   6. 员工取消（§54 已扣钱包要退回）
   ------------------------------------------------------------- */

/** cancelAppOrder —— 员工取消。已经扣过钱包就 REVERSAL 退回。 */
function cancelAppOrder(data, token) {
  var found = findBoardOrder(data, token);
  if (found.error) return found.error;
  var o = found.order, staff = found.ctx.staff;

  if (o.orderStatus === 'CANCELLED') {
    return ok({ order: boardOrder(o), alreadyCancelled: true, refunded: 0 });
  }
  if (o.orderStatus === 'COMPLETED') {
    return err('ORDER_ALREADY_FINAL',
      'Completed orders cannot be cancelled. / 已完成的订单不能取消。');
  }

  var before = o.orderStatus;
  var refunded = 0;

  /* §54 已经扣过钱包 → 全额退回，并留下 REVERSAL 纪录 */
  var used = Number(o.walletUsedSen) || 0;
  if (used > 0) {
    var customer = dbById('customers', o.customerId);
    if (customer) {
      walletCredit(customer, null, used, 'REVERSAL',
                   'Cancelled app order ' + o.orderNumber, staff.staffId, 'STAFF');
      refunded = used;
      o.walletUsedSen = 0;
    }
  }
  if (o.paymentStatus === 'PAID') o.paymentStatus = 'REFUNDED';

  o.orderStatus = 'CANCELLED';
  o.cancelledAt = nowISO();
  o.cancelledBy = staff.staffId;
  o.cancelReason = String((data && data.reason) || 'Cancelled by staff').slice(0, 200);
  o.updatedAt = nowISO();

  audit(staff.staffId, 'STAFF', 'CANCEL_APP_ORDER', 'APP_ORDER', o.appOrderId,
        before, 'CANCELLED | refund ' + refunded + ' | ' + o.cancelReason);

  return ok({ order: boardOrder(o), refunded: refunded });
}

/* -------------------------------------------------------------
   7. 暂停 / 恢复接单（§65）
   ------------------------------------------------------------- */

/** setOrderingPaused —— 员工一键暂停新单，现有订单继续处理 */
function setOrderingPaused(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var paused = !!(data && data.paused);
  var before = setting('ORDERING_PAUSED', 'FALSE');
  setSetting('ORDERING_PAUSED', paused ? 'TRUE' : 'FALSE');

  audit(ctx.staff.staffId, 'STAFF', paused ? 'PAUSE_ORDERS' : 'RESUME_ORDERS',
        'SETTING', 'ORDERING_PAUSED', before, paused ? 'TRUE' : 'FALSE');

  return ok({ paused: paused, ordering: orderingWindowState() });
}
