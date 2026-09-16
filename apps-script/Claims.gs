/* =============================================================
   YETIPSY MINI APP 1.1 — Claims.gs
   -------------------------------------------------------------
   一笔消费 → 一个 Claim（QR + 4 位 Code）→ 顾客认领 → 积分 + 奖励

   安全：
   - QR 内容是 32 bytes 随机 token，资料库只存 SHA-256 hash
   - 一个 Claim 只能被认领一次（幂等：重复认领回 CLAIM_ALREADY_USED）
   - 过期时间由 Settings.CLAIM_EXPIRY_HOURS 决定
   ============================================================= */

function generateClaimCode() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉容易看错的字符
  var code, guard = 0;
  do {
    var out = '';
    for (var i = 0; i < 4; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    code = out;
    guard++;
  } while (guard < 50 && dbFind('claims', function (c) {
    return c.claimCode === code && c.status === 'AVAILABLE';
  }));
  return code;
}

function createClaimForOrder(order, actorId, actorType) {
  var token = randomToken(32);
  var expiryHours = numSetting('CLAIM_EXPIRY_HOURS', 24);
  var claim = dbInsert('claims', {
    claimId:        dbNextId('CLM', 'claim'),
    orderId:        order.orderId,
    claimTokenHash: sha256(token),
    claimCode:      generateClaimCode(),
    status:         'AVAILABLE',
    customerId:     '',
    expiresAt:      new Date(Date.now() + expiryHours * 3600000).toISOString(),
    createdAt:      nowISO(),
    claimedAt:      '',
    createdBy:      actorId || ''
  });
  audit(actorId, actorType || 'STAFF', 'CREATE_CLAIM', 'CLAIM', claim.claimId, '', order.billAmount);
  return { claim: claim, token: token };
}

function claimView(claim, order, includeToken) {
  var view = {
    claimId: claim.claimId,
    claimCode: claim.claimCode,
    orderId: claim.orderId,
    externalOrderId: order ? order.externalOrderId : '',
    source: order ? order.orderSource : '',
    status: claim.status,
    amount: order ? order.billAmount : 0,
    createdAt: claim.createdAt,
    expiresAt: claim.expiresAt
  };
  if (includeToken) view.token = includeToken;
  return view;
}

function findClaimByTokenOrCode(rawToken, code) {
  if (rawToken) {
    var hash = sha256(rawToken);
    return dbFind('claims', function (c) { return c.claimTokenHash === hash; });
  }
  if (code) {
    var up = String(code).trim().toUpperCase();
    return dbFind('claims', function (c) { return c.claimCode === up; });
  }
  return null;
}

/* -------------------------------------------------------------
   API：员工端
   ------------------------------------------------------------- */

function createClaim(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var source = String(data.source || 'FOODCOURT').toUpperCase();
  if (ORDER_SOURCES.indexOf(source) === -1) {
    return err('INVALID_INPUT', 'Invalid order source. / 来源无效。');
  }

  var externalOrderId = String(data.externalOrderId || '').trim().toUpperCase().slice(0, 30);
  var amount = Math.round(Number(data.amount));

  if (!isFinite(amount) || amount <= 0) return err('INVALID_AMOUNT');
  if (amount > 100000000) return err('INVALID_AMOUNT', 'Amount too large. / 金额过大。');
  if (source === 'FOODCOURT' && !externalOrderId) {
    return err('INVALID_INPUT', 'Order number required. / 请输入订单号码。');
  }
  if (source !== 'DIRECT' && externalOrderId) {
    if (findOrderByExternal(source, externalOrderId)) return err('DUPLICATE_EXTERNAL_ORDER');
  }

  var order = createMemberTransaction({
    source: source,
    externalOrderId: externalOrderId,
    amount: amount,
    createdBy: ctx.staff.staffId,
    actorType: 'STAFF',
    note: String(data.note || '').slice(0, 200)
  });

  var made = createClaimForOrder(order, ctx.staff.staffId, 'STAFF');
  return ok({
    claimId: made.claim.claimId,
    orderId: order.orderId,
    externalOrderId: order.externalOrderId,
    source: order.orderSource,
    amount: order.billAmount,
    token: made.token,
    claimCode: made.claim.claimCode,
    expiresAt: made.claim.expiresAt,
    createdAt: made.claim.createdAt
  });
}

function cancelClaim(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var claim = dbById('claims', String(data.claimId || ''));
  if (!claim) return err('CLAIM_NOT_FOUND');
  if (claim.status !== 'AVAILABLE') {
    return err('CLAIM_ALREADY_USED', 'Only available claims can be cancelled. / 只能取消未认领的 Claim。');
  }

  claim.status = 'CANCELLED';
  var order = dbById('orders', claim.orderId);
  if (order) { order.orderStatus = 'CANCELLED'; order.claimStatus = 'CANCELLED'; }

  audit(ctx.staff.staffId, 'STAFF', 'CANCEL_ORDER', 'CLAIM', claim.claimId, 'AVAILABLE', 'CANCELLED');
  return ok({ claimId: claim.claimId, status: 'CANCELLED' });
}

function getClaim(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  var claim = dbById('claims', String(data.claimId || ''));
  if (!claim) return err('CLAIM_NOT_FOUND');
  return ok({ claim: claimView(claim, dbById('orders', claim.orderId), '') });
}

function listClaims(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  var limit = Math.min(100, Math.max(1, Number(data.limit) || 20));
  var list = dbRecent('claims', limit).map(function (c) {
    var o = dbById('orders', c.orderId);
    var cust = c.customerId ? dbById('customers', c.customerId) : null;
    return {
      claimId: c.claimId, orderId: c.orderId,
      externalOrderId: o ? o.externalOrderId : '',
      source: o ? o.orderSource : '',
      amount: o ? o.billAmount : 0,
      claimCode: c.claimCode, status: c.status,
      createdAt: c.createdAt, expiresAt: c.expiresAt,
      customerName: cust ? cust.name : ''
    };
  });
  return ok({ claims: list });
}

function getDashboard(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var today = todayKey();
  var todays = dbFilter('orders', function (o) {
    return isoDateKey(o.createdAt) === today && o.orderStatus !== 'CANCELLED';
  });
  var claimed = todays.filter(function (o) { return o.claimStatus === 'CLAIMED'; });
  var claims = dbFilter('claims', function (c) { return isoDateKey(c.createdAt) === today; });
  var newMembers = dbFilter('customers', function (c) { return isoDateKey(c.createdAt) === today; });

  var pointsIssued = dbFilter('pointTx', function (t) {
    return isoDateKey(t.createdAt) === today && t.type === 'EARN';
  }).reduce(function (s, t) { return s + t.points; }, 0);

  var rewardsGiven = dbFilter('rewards', function (r) {
    return isoDateKey(r.createdAt) === today && r.status !== 'CANCELLED';
  }).reduce(function (s, r) { return s + r.amount; }, 0);

  var walletRedeemed = dbFilter('walletTx', function (t) {
    return isoDateKey(t.createdAt) === today && t.type === 'REDEEM';
  }).reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);

  var budget = numSetting('DAILY_REWARD_BUDGET', 50) * 100;

  var recentClaims = dbRecent('claims', 8).map(function (c) {
    var o = dbById('orders', c.orderId);
    var cust = c.customerId ? dbById('customers', c.customerId) : null;
    return {
      claimId: c.claimId, orderId: c.orderId,
      externalOrderId: o ? o.externalOrderId : '',
      source: o ? o.orderSource : '',
      amount: o ? o.billAmount : 0,
      claimCode: c.claimCode, status: c.status,
      createdAt: c.createdAt,
      customerName: cust ? cust.name : ''
    };
  });

  return ok({
    date: today,
    sales: todays.reduce(function (s, o) { return s + o.billAmount; }, 0),
    memberSales: claimed.reduce(function (s, o) { return s + o.billAmount; }, 0),
    orderCount: todays.length,
    claims: claims.filter(function (c) { return c.status === 'CLAIMED'; }).length,
    claimsPending: claims.filter(function (c) { return c.status === 'AVAILABLE'; }).length,
    claimsExpired: claims.filter(function (c) { return c.status === 'EXPIRED'; }).length,
    newMembers: newMembers.length,
    pointsIssued: pointsIssued,
    rewardsGiven: rewardsGiven,
    rewardBudget: budget,
    rewardBudgetLeft: Math.max(0, budget - rewardsGiven),
    lowRewardMode: rewardsGiven >= budget * 0.8,
    walletRedeemed: walletRedeemed,
    recentClaims: recentClaims
  });
}

/* -------------------------------------------------------------
   API：会员端扫码 / 输入 Code
   ------------------------------------------------------------- */

function claimStatusError(claim) {
  if (claim.status === 'CLAIMED') return err('CLAIM_ALREADY_USED');
  if (claim.status === 'CANCELLED') return err('CLAIM_NOT_FOUND');
  if (claim.status === 'EXPIRED' || new Date(claim.expiresAt).getTime() < Date.now()) {
    if (claim.status === 'AVAILABLE') claim.status = 'EXPIRED';
    return err('CLAIM_EXPIRED');
  }
  return null;
}

function getClaimByToken(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var raw = String(data.token || '');
  if (!raw) return err('INVALID_CLAIM_TOKEN');
  var claim = findClaimByTokenOrCode(raw, '');
  if (!claim) return err('INVALID_CLAIM_TOKEN');

  var order = dbById('orders', claim.orderId);
  if (!order) return err('ORDER_NOT_FOUND');

  var e = claimStatusError(claim);
  if (e) return e;
  return ok({ claim: claimView(claim, order, raw) });
}

function getClaimByCode(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var code = String(data.code || '').trim().toUpperCase();
  if (!code) return err('CLAIM_NOT_FOUND');
  var claim = findClaimByTokenOrCode('', code);
  if (!claim) return err('CLAIM_NOT_FOUND');

  var order = dbById('orders', claim.orderId);
  if (!order) return err('ORDER_NOT_FOUND');

  var e = claimStatusError(claim);
  if (e) return e;
  return ok({ claim: claimView(claim, order, '') });
}

/** 认领消费：写入会员、发放积分、产生奖励（幂等） */
function claimOrder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  var claim = findClaimByTokenOrCode(String(data.token || ''), String(data.code || ''));
  if (!claim) return err('INVALID_CLAIM_TOKEN');

  var e = claimStatusError(claim);
  if (e) return e;

  var order = dbById('orders', claim.orderId);
  if (!order) return err('ORDER_NOT_FOUND');
  if (order.claimStatus === 'CLAIMED') {
    claim.status = 'CLAIMED';
    return err('CLAIM_ALREADY_USED');
  }

  /* ---- 写入（整段由 LockService 保护，不会两个人同时认领成功） ---- */
  claim.status = 'CLAIMED';
  claim.customerId = customer.customerId;
  claim.claimedAt = nowISO();

  order.customerId  = customer.customerId;
  order.claimStatus = 'CLAIMED';
  order.claimedAt   = nowISO();
  order.completedAt = nowISO();
  order.finalAmount = order.billAmount - (order.walletUsed || 0);

  customer.totalSpend  = (Number(customer.totalSpend) || 0) + order.billAmount;
  customer.totalVisits = (Number(customer.totalVisits) || 0) + 1;
  customer.lastVisitAt = nowISO();

  var points = pointsForAmount(order.billAmount, order.walletUsed);
  order.pointsEarned = points;
  issuePoints(customer, order, points,
              'Claim ' + (order.externalOrderId || order.orderId),
              customer.customerId, 'CUSTOMER', 'EARN');

  audit(customer.customerId, 'CUSTOMER', 'CLAIM_ORDER', 'ORDER', order.orderId, 'AVAILABLE', 'CLAIMED');

  var reward = generateReward(customer, order, order.billAmount);

  return ok({
    orderId: order.orderId,
    amount: order.billAmount,
    pointsEarned: points,
    customer: publicCustomer(customer),
    membership: membershipInfo(customer),
    reward: reward ? { rewardId: reward.rewardId, status: reward.status } : null
  });
}

/* -------------------------------------------------------------
   API：奖励
   ------------------------------------------------------------- */

function getPendingReward(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var id = String(data.rewardId || '');
  var list = dbFilter('rewards', function (r) {
    return r.customerId === ctx.customer.customerId && r.status === 'AVAILABLE';
  });
  var reward = null;
  if (id) {
    list.forEach(function (r) { if (!reward && r.rewardId === id) reward = r; });
  } else {
    reward = list[0] || null;
  }
  if (!reward) return ok({ reward: null });

  var order = dbById('orders', reward.orderId);
  return ok({
    reward: {
      rewardId: reward.rewardId,
      status: reward.status,
      createdAt: reward.createdAt,
      expiresAt: reward.expiresAt,
      orderInfo: order
        ? { externalOrderId: order.externalOrderId, amountText: 'RM ' + (order.billAmount / 100).toFixed(2) }
        : null
    }
  });
}

function claimReward(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  var reward = dbById('rewards', String(data.rewardId || ''));
  if (!reward || reward.customerId !== customer.customerId) return err('REWARD_NOT_FOUND');
  if (reward.status === 'CLAIMED') return err('REWARD_ALREADY_CLAIMED');     // 幂等
  if (reward.status !== 'AVAILABLE') return err('REWARD_NOT_FOUND');
  if (reward.expiresAt && new Date(reward.expiresAt).getTime() < Date.now()) {
    reward.status = 'EXPIRED';
    return err('REWARD_NOT_FOUND');
  }

  reward.status = 'CLAIMED';
  reward.claimedAt = nowISO();

  var order = dbById('orders', reward.orderId);
  if (order) { order.rewardAmount = reward.amount; order.rewardId = reward.rewardId; }

  walletCredit(customer, order, reward.amount, 'REWARD',
               'Reward from ' + (order ? (order.externalOrderId || order.orderId) : 'Yetipsy'),
               customer.customerId, 'CUSTOMER');
  customer.totalRewards = (Number(customer.totalRewards) || 0) + 1;

  audit(customer.customerId, 'CUSTOMER', 'CLAIM_REWARD', 'REWARD', reward.rewardId, '', reward.amount);

  return ok({
    rewardId: reward.rewardId,
    amount: reward.amount,
    walletBalance: customer.walletBalance,
    customer: publicCustomer(customer)
  });
}
