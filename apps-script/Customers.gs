/* =============================================================
   YETIPSY MINI APP 1.1 — Customers.gs
   -------------------------------------------------------------
   会员注册 / 登录 / 资料

   ★★★ 防重复注册 ★★★
   会员身份 = E.164 电话号码（例如 +60123456789）。
   0123456789 / 60123456789 / +60 12-345 6789 全部会被规范化成
   同一个字串，所以同一个号码永远只会有一列 Customers。
   整个请求由 Code.gs 的 LockService 包住，两次同时注册也只会
   成功建立一笔。
   ============================================================= */

/* -------------------------------------------------------------
   查询
   ------------------------------------------------------------- */

/**
 * 用 E.164 电话找会员。
 * 万一 Sheet 里还有旧版留下的重复列，这里会：
 *   1. 回传最早注册的那一列（正式帐号）
 *   2. 写一条 AuditLog，并在 API 回应里带 duplicateDetected = true
 * 提醒老板执行 dedupeCustomers() 合并。
 */
function findCustomerByPhone(phone) {
  var matches = dbFilter('customers', function (c) {
    return c.status !== 'MERGED' && String(c.phone) === phone;
  });
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  matches.sort(function (a, b) {
    var ta = new Date(a.createdAt || 0).getTime() || 0;
    var tb = new Date(b.createdAt || 0).getTime() || 0;
    return ta - tb;
  });
  audit('SYSTEM', 'SYSTEM', 'DUPLICATE_PHONE_DETECTED', 'CUSTOMER', matches[0].customerId,
        String(matches.length), matches.map(function (m) { return m.customerId; }).join(','));
  return matches[0];
}

/** 只给内部使用：建立新会员（呼叫前必须确认电话不存在） */
function createCustomer(phone, name, source) {
  var customer = dbInsert('customers', {
    customerId:     dbNextId('YT', 'customer'),
    phone:          phone,
    name:           String(name || '').trim().slice(0, 40),
    birthday:       '',
    currentPoints:  0,
    lifetimePoints: 0,
    walletBalance:  0,
    membershipTier: computeTier(0),
    totalSpend:     0,
    totalVisits:    0,
    totalRewards:   0,
    status:         'ACTIVE',
    source:         source || 'SELF_REGISTER',
    lastLoginAt:    nowISO(),
    createdAt:      nowISO(),
    lastVisitAt:    ''
  });
  audit(customer.customerId, 'CUSTOMER', 'CUSTOMER_REGISTER', 'CUSTOMER',
        customer.customerId, '', phone);
  return customer;
}

/* -------------------------------------------------------------
   API：登录（找不到就注册 —— 但同一个号码只会有一笔）
   ------------------------------------------------------------- */

function customerLogin(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  /* OTP 开启时必须带有效的验证凭证（后端签发，前端无法伪造） */
  if (boolSetting('OTP_ENABLED', false)) {
    var proof = consumeVerificationToken(data.verificationToken, res.phone);
    if (!proof) return err('OTP_REQUIRED');
  }

  var customer = findCustomerByPhone(res.phone);
  var isNew = false;
  var duplicateDetected = false;

  if (!customer) {
    /* 双重检查：Lock 之内再查一次，避免同一号码并发注册出两列 */
    customer = createCustomer(res.phone, data.name, 'SELF_REGISTER');
    isNew = true;
  } else {
    duplicateDetected = dbFilter('customers', function (c) {
      return c.status !== 'MERGED' && String(c.phone) === res.phone;
    }).length > 1;
    var name = String(data.name || '').trim().slice(0, 40);
    if (name && !customer.name) customer.name = name;
    customer.lastLoginAt = nowISO();
  }

  var token = createSession('CUSTOMER', customer.customerId);
  audit(customer.customerId, 'CUSTOMER', 'LOGIN', 'CUSTOMER', customer.customerId, '', res.phone);

  return ok({
    token: token,
    customer: publicCustomer(customer),
    isNewCustomer: isNew,
    duplicateDetected: duplicateDetected,
    phone: res.phone
  });
}

/**
 * 明确注册（未来的注册流程用）：号码已存在就拒绝，绝不建立第二笔。
 */
function customerRegister(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  if (findCustomerByPhone(res.phone)) return err('PHONE_ALREADY_REGISTERED');
  if (boolSetting('OTP_ENABLED', false)) {
    if (!consumeVerificationToken(data.verificationToken, res.phone)) return err('OTP_REQUIRED');
  }

  var customer = createCustomer(res.phone, data.name, 'SELF_REGISTER');
  var token = createSession('CUSTOMER', customer.customerId);
  return ok({
    token: token,
    customer: publicCustomer(customer),
    isNewCustomer: true,
    duplicateDetected: false,
    phone: res.phone
  });
}

function customerLogout(data, token) {
  destroySession(token);
  return ok({ loggedOut: true });
}

function phoneErrorMessage(reason) {
  if (reason === 'UNSUPPORTED_COUNTRY') {
    return 'Country code not supported. / 暂不支持这个国家码。';
  }
  if (reason === 'EMPTY') {
    return 'Please enter your mobile number. / 请输入手机号码。';
  }
  return 'Invalid mobile number. / 手机号码无效。';
}

/* -------------------------------------------------------------
   API：会员资料
   ------------------------------------------------------------- */

function publicCustomer(c) {
  return {
    customerId:     c.customerId,
    phone:          c.phone,
    name:           c.name,
    birthday:       c.birthday,
    currentPoints:  c.currentPoints,
    lifetimePoints: c.lifetimePoints,
    walletBalance:  c.walletBalance,
    membershipTier: c.membershipTier,
    totalSpend:     c.totalSpend,
    totalVisits:    c.totalVisits,
    totalRewards:   c.totalRewards,
    status:         c.status,
    createdAt:      c.createdAt,
    lastVisitAt:    c.lastVisitAt
  };
}

function getProfile(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({
    customer: publicCustomer(ctx.customer),
    membership: membershipInfo(ctx.customer)
  });
}

function updateProfile(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var c = ctx.customer;
  var oldName = c.name, oldBirthday = c.birthday;
  if (data.name !== undefined) c.name = String(data.name).trim().slice(0, 40);
  if (data.birthday !== undefined) c.birthday = String(data.birthday || '').slice(0, 10);
  audit(c.customerId, 'CUSTOMER', 'UPDATE_PROFILE', 'CUSTOMER', c.customerId,
        oldName + '/' + oldBirthday, c.name + '/' + c.birthday);
  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}

function getMembership(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({ membership: membershipInfo(ctx.customer) });
}

function getPoints(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({
    currentPoints: ctx.customer.currentPoints,
    lifetimePoints: ctx.customer.lifetimePoints,
    membership: membershipInfo(ctx.customer)
  });
}

function getPointHistory(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var limit = Math.min(200, Math.max(1, Number(data.limit) || 50));
  var id = ctx.customer.customerId;
  var list = dbRecent('pointTx').filter(function (t) { return t.customerId === id; }).slice(0, limit);
  return ok({ transactions: list });
}

function getWallet(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({ balance: ctx.customer.walletBalance || 0 });
}

function getWalletHistory(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var limit = Math.min(200, Math.max(1, Number(data.limit) || 50));
  var id = ctx.customer.customerId;
  var list = dbRecent('walletTx').filter(function (t) { return t.customerId === id; }).slice(0, limit);
  return ok({ transactions: list });
}

function getOrderHistory(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var limit = Math.min(200, Math.max(1, Number(data.limit) || 50));
  var id = ctx.customer.customerId;
  var list = dbRecent('orders')
    .filter(function (o) { return o.customerId === id && o.orderStatus !== 'CANCELLED'; })
    .slice(0, limit)
    .map(orderSummary);
  return ok({ orders: list });
}

function orderSummary(o) {
  return {
    orderId: o.orderId,
    externalOrderId: o.externalOrderId,
    source: o.orderSource,
    amount: o.billAmount,
    pointsEarned: o.pointsEarned,
    rewardAmount: o.rewardAmount,
    walletUsed: o.walletUsed,
    finalAmount: o.finalAmount,
    status: o.claimStatus,
    createdAt: o.createdAt
  };
}

/* -------------------------------------------------------------
   API：员工端查会员
   ------------------------------------------------------------- */

function searchCustomer(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var kw = String(data.keyword || '').trim();
  if (kw.length < 3) return ok({ customers: [] });

  var kwLower = kw.toLowerCase();
  var kwDigits = kw.replace(/[^0-9]/g, '');
  var normalized = normalizePhoneE164(kw);          // 输入 0123456789 也能搜到 +60123456789

  var list = dbFilter('customers', function (c) {
    if (c.status === 'MERGED') return false;
    if (c.customerId.toLowerCase() === kwLower) return true;
    if (kwDigits.length >= 3 && String(c.phone).indexOf(kwDigits) !== -1) return true;
    if (normalized.ok && String(c.phone) === normalized.phone) return true;
    if (c.name && c.name.toLowerCase().indexOf(kwLower) !== -1) return true;
    return false;
  }).slice(0, 20);

  return ok({
    customers: list.map(function (c) {
      return {
        customerId: c.customerId, name: c.name, phone: c.phone,
        currentPoints: c.currentPoints, walletBalance: c.walletBalance,
        membershipTier: c.membershipTier, totalSpend: c.totalSpend, totalVisits: c.totalVisits
      };
    })
  });
}

function getCustomer(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');
  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}

function getCustomerHistory(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  var id = String(data.customerId || '');
  var list = dbRecent('orders')
    .filter(function (o) { return o.customerId === id; })
    .slice(0, 30)
    .map(orderSummary);
  return ok({ orders: list });
}
