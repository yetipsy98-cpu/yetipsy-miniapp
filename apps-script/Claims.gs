/* =============================================================
   YETIPSY MINI APP 1.3 — Claims.gs
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
  /*
   * ★ 改成只有 MANAGER / OWNER 能建立 Claim（生成 QR）。
   * 2.0 之后主流程是「员工进单 → 扫会员码进分」（grantOrder），
   * 生成 QR 给顾客自己认领变成备用路径，所以收紧到经理以上。
   */
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
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
  /*
   * §56 6 小时内完成多笔消费只算 1 次到店（与 App 点单共用同一个判断）。
   * 这里排除 order 自己，否则会永远判定「这次已经到店过了」。
   */
  if (shouldCountVisit(customer, null, order.orderId)) {
    customer.totalVisits = (Number(customer.totalVisits) || 0) + 1;
    customer.lastVisitAt = nowISO();
  }

  var points = pointsForAmount(order.billAmount, order.walletUsed);
  order.pointsEarned = points;
  issuePoints(customer, order, points,
              'Claim ' + (order.externalOrderId || order.orderId),
              customer.customerId, 'CUSTOMER', 'EARN');

  audit(customer.customerId, 'CUSTOMER', 'CLAIM_ORDER', 'ORDER', order.orderId, 'AVAILABLE', 'CLAIMED');

  var reward = generateReward(customer, order, order.billAmount);
  /* ★ totalRewards 一律 = 已发出的 Reward 数。
     之前这里是 0，要等顾客兑换（claimReward）才 +1，
     而 2.0 的 completeOrder 却是发出时就 +1 —— 两条通路数字对不上。 */
  if (reward) {
    customer.totalRewards = (Number(customer.totalRewards) || 0) + 1;
  }

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
  /* ★ 不再 +1：totalRewards 在 Reward「发出」时就已经算过了
     （claimOrder / completeOrder / grantOrder 三条发出路径）。
     这里再加一次会让同一个 Reward 被数两遍 —— 实测过：
     发出后 1、兑换后 2，但 Rewards 表只有 1 笔。 */

  audit(customer.customerId, 'CUSTOMER', 'CLAIM_REWARD', 'REWARD', reward.rewardId, '', reward.amount);

  return ok({
    rewardId: reward.rewardId,
    amount: reward.amount,
    walletBalance: customer.walletBalance,
    customer: publicCustomer(customer)
  });
}

/* =============================================================
   ★ 2.0 主流程：员工扫会员码 → 输消费金额 → 自动发积分与 Reward
   -------------------------------------------------------------
   这是 2.0 之后员工端的主要操作。取代原本「员工建立 Claim 生成 QR
   → 顾客自己扫码认领」的流程（那条路径保留，但收紧到 MANAGER / OWNER）。

   与 redeemWallet 的差别：
     · 不扣钱包（顾客没有要用钱包抵扣时走这条）
     · 任何员工都能操作（主流程不该卡在权限上）
     · §56 六小时内只算一次到店，不是无条件 +1

   与顾客自助认领（claimOrder）的差别：
     · 员工这边一次完成，顾客不需要再扫码确认
     · 所以必须扫过顾客的会员条码（REQUIRE_MEMBER_CODE_SCAN）

   入参：{ customerId, billAmount(sen), verifyToken, externalOrderId?,
           source?, note? }
   ============================================================= */

function grantOrder(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');
  if (String(c.status || 'ACTIVE').toUpperCase() === 'BLOCKED') {
    return err('CUSTOMER_BLOCKED');
  }

  var bill = Math.round(Number(data.billAmount));
  if (!isFinite(bill) || bill <= 0) return err('INVALID_AMOUNT');

  var source = String(data.source || 'DIRECT').toUpperCase();
  var externalOrderId = String(data.externalOrderId || '').trim().toUpperCase();
  if (externalOrderId && findOrderByExternal(source, externalOrderId)) {
    return err('DUPLICATE_EXTERNAL_ORDER');
  }

  /* ★ 必须扫过这位顾客的会员条码。
     放在金额检查之后，避免验证次数被无效请求白白消耗掉。 */
  var verifyError = peekMemberVerify(data.verifyToken, c.customerId, ctx.staff.staffId);
  if (verifyError) return verifyError;

  var order = createMemberTransaction({
    source: source,
    externalOrderId: externalOrderId,
    amount: bill,
    customerId: c.customerId,
    createdBy: ctx.staff.staffId,
    actorType: 'STAFF',
    note: String(data.note || '').slice(0, 200)
  });

  order.walletUsed  = 0;
  order.finalAmount = bill;
  order.claimStatus = 'CLAIMED';
  order.claimedAt   = nowISO();
  order.completedAt = nowISO();

  var points = pointsForAmount(bill, 0);
  order.pointsEarned = points;

  c.totalSpend = (Number(c.totalSpend) || 0) + bill;

  /* §56 六小时内只算一次到店 —— 不能无条件 +1，
     否则同一位顾客同晚走 App 点单 + 员工扫码就会算两次 */
  var visitCounted = shouldCountVisit(c, order, order.orderId);
  if (visitCounted) {
    c.totalVisits = (Number(c.totalVisits) || 0) + 1;
    c.lastVisitAt = nowISO();
  }

  issuePoints(c, order, points, 'Purchase via staff scan',
              ctx.staff.staffId, 'STAFF', 'EARN');

  var reward = generateReward(c, order, bill);
  /* totalRewards = 已发出数，与 claimOrder / completeOrder 一致 */
  if (reward) {
    c.totalRewards = (Number(c.totalRewards) || 0) + 1;
  }

  consumeMemberVerify(data.verifyToken);   // 交易成立，这次验证用掉了

  audit(ctx.staff.staffId, 'STAFF', 'GRANT_ORDER', 'ORDER', order.orderId, '', points);

  return ok({
    orderId: order.orderId,
    billAmount: bill,
    pointsEarned: points,
    visitCounted: visitCounted,
    customer: publicCustomer(c),
    membership: membershipInfo(c),
    reward: reward ? { rewardId: reward.rewardId, status: reward.status, amount: reward.amount } : null
  });
}

/* =============================================================
   ★ 2.1 POS 进单：foodcourt 单据 → 扫会员码进分
   -------------------------------------------------------------
   与 1.x Claim 的差别：
     · Claim：员工建立单据 → 生成 QR → 顾客自己扫 → 认领进分
     · POS  ：员工录入 foodcourt 单据 → 进「待进单」队列 →
              当场扫顾客会员码 → 归属会员 + 发积分 / Reward

   付款一律在 foodcourt 完成，这条通路不动钱包：
     · walletUsed 恒为 0、finalAmount = billAmount
     · 要抵扣钱包仍然走 1.x 的 redeemWallet（扫码抵扣）

   权限：任何员工都能操作（现场主流程不该卡权限）。
   必须是 MANAGER / OWNER 才能用的，是 1.x 的 createClaim（生成 QR）。

   防重复：
     · createPosTicket 同一个 externalOrderId 只收一次
     · bindPosTicket 幂等 —— 已经归属过的单据一律回 TICKET_ALREADY_BOUND，
       不会重复发积分 / Reward / 到店次数（§55 的同一套原则）
   ============================================================= */

/** POS 单据的画面形状（员工端用；不含任何敏感资料） */
function posTicketView(o) {
  var cust = o.customerId ? dbById('customers', o.customerId) : null;
  var status = 'OPEN';
  if (o.orderStatus === 'CANCELLED' || o.orderStatus === 'VOID') status = 'CANCELLED';
  else if (o.claimStatus === 'CLAIMED' && o.customerId) status = 'BOUND';

  return {
    orderId:        o.orderId,
    orderNumber:    o.externalOrderId || o.orderId,
    externalOrderId: o.externalOrderId || '',
    source:         o.orderSource,
    amount:         Number(o.billAmount) || 0,
    note:           o.note || '',
    createdAt:      o.createdAt,
    status:         status,
    customerId:     o.customerId || '',
    customerName:   cust ? (cust.name || cust.phone || '') : '',
    customerTier:   cust ? (cust.membershipTier || 'MEMBER') : '',
    pointsEarned:   Number(o.pointsEarned) || 0,
    rewardAmount:   Number(o.rewardAmount) || 0,
    boundAt:        o.claimedAt || o.completedAt || ''
  };
}

/** 待进单队列 = 还没归属会员、24 小时内、没被取消的单据 */
function openPosTickets(limit) {
  var days = Math.max(1, numSetting('CLAIM_EXPIRY_HOURS', 24)) / 24;
  var cutoff = Date.now() - days * 86400000;

  return dbRecent('orders', 300).filter(function (o) {
    if (o.orderStatus === 'CANCELLED' || o.orderStatus === 'VOID') return false;
    if (o.claimStatus === 'CLAIMED' && o.customerId) return false;
    var at = new Date(o.createdAt).getTime();
    if (isFinite(at) && at < cutoff) return false;
    return true;
  }).slice(0, limit || 40);
}

/**
 * createPosTicket —— 员工录入一张 foodcourt 单据（这时还不知道是谁）。
 * @param {object} data { amount(sen), externalOrderId?, source?, note? }
 */
function createPosTicket(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var source = String((data && data.source) || 'FOODCOURT').toUpperCase();
  if (ORDER_SOURCES.indexOf(source) === -1) {
    return err('INVALID_INPUT', 'Invalid order source. / 来源无效。');
  }

  var externalOrderId = String((data && data.externalOrderId) || '').trim().toUpperCase().slice(0, 30);
  var amount = Math.round(Number(data && data.amount));

  if (!isFinite(amount) || amount <= 0) return err('INVALID_AMOUNT');
  if (amount > 100000000) return err('INVALID_AMOUNT', 'Amount too large. / 金额过大。');
  if (externalOrderId && findOrderByExternal(source, externalOrderId)) {
    return err('DUPLICATE_EXTERNAL_ORDER');
  }

  var order = createMemberTransaction({
    source:          source,
    externalOrderId: externalOrderId,
    amount:          amount,
    createdBy:       ctx.staff.staffId,
    actorType:       'STAFF',
    note:            String((data && data.note) || '').slice(0, 200)
  });

  audit(ctx.staff.staffId, 'STAFF', 'POS_TICKET', 'ORDER', order.orderId, '', amount);
  return ok({ ticket: posTicketView(order) });
}

/**
 * getPosQueue —— POS 台画面：待进单 + 今日已进单统计。
 */
function getPosQueue(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var today = todayKey();
  var limit = Math.min(80, Math.max(1, Number(data && data.limit) || 40));

  var pending = openPosTickets(limit);

  var boundToday = dbRecent('orders', 300).filter(function (o) {
    if (!o.customerId) return false;
    if (o.orderStatus === 'CANCELLED' || o.orderStatus === 'VOID') return false;
    return isoDateKey(o.claimedAt || o.completedAt || o.createdAt) === today;
  });

  var pointsToday = boundToday.reduce(function (s, o) { return s + (Number(o.pointsEarned) || 0); }, 0);
  var amountToday = boundToday.reduce(function (s, o) { return s + (Number(o.billAmount) || 0); }, 0);

  return ok({
    pending: pending.map(posTicketView),
    today: {
      date: today,
      bound: boundToday.length,
      points: pointsToday,
      amount: amountToday,
      recent: boundToday.slice(0, 12).map(posTicketView)
    },
    pollSeconds: numSetting('ORDER_POLL_SECONDS', 8)
  });
}

/**
 * bindPosTicket —— 扫过顾客会员码之后，把单据归给会员并进分。
 * @param {object} data { orderId, customerId, verifyToken }
 *
 * 幂等：同一张单第二次呼叫回 TICKET_ALREADY_BOUND，
 *       不会第二次发积分 / Reward，也不会多算一次到店。
 */
function bindPosTicket(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var order = dbById('orders', String((data && data.orderId) || ''));
  if (!order) return err('ORDER_NOT_FOUND');
  if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'VOID') {
    return err('ORDER_CANCELLED', 'This ticket was cancelled. / 这张单已被取消。');
  }

  var c = dbById('customers', String((data && data.customerId) || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');
  if (String(c.status || 'ACTIVE').toUpperCase() === 'BLOCKED') {
    return err('CUSTOMER_BLOCKED');
  }

  if (order.claimStatus === 'CLAIMED' && order.customerId) {
    var already = dbById('customers', order.customerId);
    if (order.customerId === c.customerId) {
      /* 同一位会员 → 当成重复点击，安全回同一份结果 */
      return ok({
        orderId: order.orderId,
        billAmount: Number(order.billAmount) || 0,
        pointsEarned: Number(order.pointsEarned) || 0,
        alreadyBound: true,
        visitCounted: false,
        customer: publicCustomer(c),
        membership: membershipInfo(c),
        reward: null
      });
    }
    return err('TICKET_ALREADY_BOUND',
      'This ticket is already credited to ' +
      ((already && (already.name || already.phone)) || order.customerId) +
      '. / 这张单已经进给别的会员了。');
  }

  /* ★ 必须扫过这位顾客的会员条码（与 grantOrder 同一套验证） */
  var verifyError = peekMemberVerify(data.verifyToken, c.customerId, ctx.staff.staffId);
  if (verifyError) return verifyError;

  var bill = Number(order.billAmount) || 0;
  if (bill <= 0) return err('INVALID_AMOUNT');

  order.customerId  = c.customerId;
  order.claimStatus = 'CLAIMED';
  order.claimedAt   = nowISO();
  order.completedAt = nowISO();
  order.walletUsed  = 0;              // 付款在 foodcourt，这里不动钱包
  order.finalAmount = bill;

  c.totalSpend = (Number(c.totalSpend) || 0) + bill;

  /* §56 六小时内只算一次到店（与 App 点单、1.x 认领共用同一个判断） */
  var visitCounted = shouldCountVisit(c, null, order.orderId);
  if (visitCounted) {
    c.totalVisits = (Number(c.totalVisits) || 0) + 1;
    c.lastVisitAt = nowISO();
  }

  var points = pointsForAmount(bill, 0);
  order.pointsEarned = points;
  issuePoints(c, order, points,
              'Foodcourt ticket ' + (order.externalOrderId || order.orderId),
              ctx.staff.staffId, 'STAFF', 'EARN');

  var reward = generateReward(c, order, bill);
  if (reward) {
    order.rewardAmount = Number(reward.amount) || 0;
    order.rewardId = reward.rewardId;
    /* totalRewards = 已发出数，与 claimOrder / completeOrder / grantOrder 一致 */
    c.totalRewards = (Number(c.totalRewards) || 0) + 1;
  }

  /* 这张单若有 AVAILABLE 的 1.x Claim（顾客还没自己扫），一并结掉，
     否则顾客之后扫那张 QR 会看到一张已进分单据 */
  dbFilter('claims', function (cl) {
    return cl.orderId === order.orderId && cl.status === 'AVAILABLE';
  }).forEach(function (cl) {
    cl.status = 'CLAIMED';
    cl.customerId = c.customerId;
    cl.claimedAt = nowISO();
  });

  consumeMemberVerify(data.verifyToken);   // 交易成立，这次验证用掉了

  audit(ctx.staff.staffId, 'STAFF', 'POS_BIND', 'ORDER', order.orderId,
        'AVAILABLE', 'CLAIMED | ' + c.customerId + ' | points ' + points);

  return ok({
    orderId:      order.orderId,
    billAmount:   bill,
    pointsEarned: points,
    visitCounted: visitCounted,
    alreadyBound: false,
    customer:     publicCustomer(c),
    membership:   membershipInfo(c),
    reward:       reward ? { rewardId: reward.rewardId, amount: reward.amount, status: reward.status } : null
  });
}

/**
 * cancelPosTicket —— 录错单号 / 金额时把单据取消（还没进分才可以）。
 */
function cancelPosTicket(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var order = dbById('orders', String((data && data.orderId) || ''));
  if (!order) return err('ORDER_NOT_FOUND');

  if (order.claimStatus === 'CLAIMED' && order.customerId) {
    return err('TICKET_ALREADY_BOUND',
      'This ticket already has points issued. / 这张单已经进分了，不能在这里取消。');
  }
  if (order.orderStatus === 'CANCELLED') {
    return ok({ ticket: posTicketView(order), alreadyCancelled: true });
  }

  var reason = String((data && data.reason) || 'Cancelled at POS').slice(0, 200);
  order.orderStatus = 'CANCELLED';
  order.cancelledAt = nowISO();
  order.cancelledBy = ctx.staff.staffId;
  order.cancelReason = reason;

  dbFilter('claims', function (cl) {
    return cl.orderId === order.orderId && cl.status === 'AVAILABLE';
  }).forEach(function (cl) { cl.status = 'CANCELLED'; });

  audit(ctx.staff.staffId, 'STAFF', 'CANCEL_POS_TICKET', 'ORDER', order.orderId, 'ACTIVE', 'CANCELLED | ' + reason);

  return ok({ ticket: posTicketView(order), alreadyCancelled: false });
}
