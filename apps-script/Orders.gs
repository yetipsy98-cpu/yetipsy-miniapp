/* =============================================================
   YETIPSY MINI APP 2.1.5 — Orders.gs
   -------------------------------------------------------------
   「已验证会员消费记录」= 积分的唯一来源。
   未来接 Foodcourt API / Webhook / CSV 汇入，也走 createMemberTransaction()。
   ============================================================= */

function findOrderByExternal(source, externalOrderId) {
  if (!externalOrderId) return null;
  var key = String(externalOrderId).trim().toUpperCase();
  return dbFind('orders', function (o) {
    return o.orderSource === source &&
      String(o.externalOrderId || '').trim().toUpperCase() === key &&
      o.orderStatus !== 'CANCELLED' &&
      o.orderStatus !== 'VOID';
  });
}

function createMemberTransaction(opts) {
  var order = dbInsert('orders', {
    orderId:         dbNextId('YTORD', 'order'),
    externalOrderId: opts.externalOrderId || '',
    orderSource:     opts.source || 'DIRECT',
    billAmount:      opts.amount,
    customerId:      opts.customerId || '',
    claimStatus:     opts.customerId ? 'CLAIMED' : 'AVAILABLE',
    pointsEarned:    0,
    rewardAmount:    0,
    rewardId:        '',
    walletUsed:      0,
    finalAmount:     opts.amount,
    orderStatus:     'ACTIVE',
    createdBy:       opts.createdBy || '',
    note:            opts.note || '',
    createdAt:       nowISO(),
    claimedAt:       opts.customerId ? nowISO() : '',
    completedAt:     opts.customerId ? nowISO() : ''
  });
  audit(opts.createdBy, opts.actorType || 'STAFF', 'CREATE_ORDER', 'ORDER',
        order.orderId, '', opts.amount);
  return order;
}

/* -------------------------------------------------------------
   API
   ------------------------------------------------------------- */

function getOrders(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var limit  = Math.min(200, Math.max(1, Number(data.limit) || 30));
  var status = String(data.status || '').toUpperCase();
  var kw     = String(data.keyword || '').trim().toUpperCase();
  var from   = String(data.from || '');
  var to     = String(data.to || '');

  var list = dbRecent('orders');

  if (status === 'CLAIMED')        list = list.filter(function (o) { return o.claimStatus === 'CLAIMED'; });
  else if (status === 'PENDING')   list = list.filter(function (o) { return o.claimStatus === 'AVAILABLE'; });
  else if (status === 'CANCELLED') list = list.filter(function (o) { return o.orderStatus === 'CANCELLED' || o.orderStatus === 'VOID'; });
  else if (status)                 list = list.filter(function (o) { return o.claimStatus === status; });

  if (kw) {
    list = list.filter(function (o) {
      return String(o.externalOrderId || '').toUpperCase().indexOf(kw) !== -1 ||
             String(o.orderId).toUpperCase().indexOf(kw) !== -1;
    });
  }
  if (from) list = list.filter(function (o) { return isoDateKey(o.createdAt) >= from; });
  if (to)   list = list.filter(function (o) { return isoDateKey(o.createdAt) <= to; });

  list = list.slice(0, limit);

  return ok({
    orders: list.map(function (o) {
      var cust = o.customerId ? dbById('customers', o.customerId) : null;
      var v = orderSummary(o);
      v.claimStatus  = o.claimStatus;
      v.orderStatus  = o.orderStatus;
      v.customerId   = o.customerId;
      v.customerName = cust ? cust.name : '';
      return v;
    })
  });
}

/** 取消订单：撤销积分、消费、到店次数与已领奖励（Manager+） */
function cancelOrder(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var order = dbById('orders', String(data.orderId || ''));
  if (!order) return err('ORDER_NOT_FOUND');
  if (order.orderStatus === 'CANCELLED') {
    return err('ORDER_NOT_FOUND', 'Order already cancelled. / 订单已取消。');
  }

  var customer = order.customerId ? dbById('customers', order.customerId) : null;

  order.orderStatus = 'CANCELLED';
  order.claimStatus = 'CANCELLED';

  var claim = dbFind('claims', function (c) { return c.orderId === order.orderId; });
  if (claim && claim.status === 'AVAILABLE') claim.status = 'CANCELLED';

  if (customer) {
    if (order.pointsEarned) {
      issuePoints(customer, order, -order.pointsEarned, 'Reversal of ' + order.orderId,
                  ctx.staff.staffId, 'STAFF', 'REVERSAL');
    }
    customer.totalSpend  = Math.max(0, (Number(customer.totalSpend) || 0) - order.billAmount);
    customer.totalVisits = Math.max(0, (Number(customer.totalVisits) || 0) - 1);

    var claimed = dbFind('rewards', function (r) {
      return r.orderId === order.orderId && r.status === 'CLAIMED';
    });
    if (claimed) {
      claimed.status = 'CANCELLED';
      walletCredit(customer, order, -claimed.amount, 'REVERSAL',
                   'Reversal of reward ' + claimed.rewardId, ctx.staff.staffId, 'STAFF');
      customer.totalRewards = Math.max(0, (Number(customer.totalRewards) || 0) - 1);
    }
    var pending = dbFind('rewards', function (r) {
      return r.orderId === order.orderId && r.status === 'AVAILABLE';
    });
    if (pending) {
      pending.status = 'CANCELLED';
      /* ★ totalRewards 是「已发出数」，发出时已经 +1 了，
         所以取消一个还没兑换的 Reward 也要 -1，
         否则会员资料上的数字会比 Rewards 表多。 */
      customer.totalRewards = Math.max(0, (Number(customer.totalRewards) || 0) - 1);
    }
  }

  audit(ctx.staff.staffId, 'STAFF', 'CANCEL_ORDER', 'ORDER', order.orderId, 'ACTIVE',
        'CANCELLED: ' + String(data.reason || '').slice(0, 100));
  return ok({ orderId: order.orderId, status: 'CANCELLED' });
}
