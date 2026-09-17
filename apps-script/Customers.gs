/* =============================================================
   YETIPSY MINI APP 2.1.5 — Customers.gs
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

/* -------------------------------------------------------------
   密码
   ------------------------------------------------------------- */

function setPassword(customer, password) {
  var salt = randomToken(8);
  customer.salt = salt;
  customer.passwordHash = hashPassword(password, salt);
  customer.passwordSetAt = nowISO();
  return customer;
}

function verifyPassword(customer, password) {
  if (!customer.passwordHash || !customer.salt) return false;
  return customer.passwordHash === hashPassword(String(password || ''), customer.salt);
}

function passwordRuleError(password) {
  var pwd = String(password || '');
  var minLen = numSetting('CUSTOMER_PASSWORD_MIN', 8);
  if (!pwd) return err('PASSWORD_REQUIRED');
  if (pwd.length < minLen) {
    return err('PASSWORD_TOO_SHORT',
      'Password must be at least ' + minLen + ' characters. / 密码至少 ' + minLen + ' 位。');
  }
  return null;
}

/** 只给内部使用：建立新会员（呼叫前必须确认电话不存在） */
function createCustomer(phone, name, password, source) {
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
    salt:           '',
    passwordHash:   '',
    passwordSetAt:  '',
    lastLoginAt:    nowISO(),
    createdAt:      nowISO(),
    lastVisitAt:    ''
  });
  if (password) setPassword(customer, password);
  audit(customer.customerId, 'CUSTOMER', 'CUSTOMER_REGISTER', 'CUSTOMER',
        customer.customerId, '', phone);
  return customer;
}

/** 这个会员是否「还没有密码」（旧资料或员工建立的帐号） */
function needsPasswordSetup(customer) {
  return !customer.passwordHash;
}

/** 还没有任何消费/积分/钱包 → 允许自助补设密码（空帐号没有资料可以被偷） */
function hasNoActivity(customer) {
  var id = customer.customerId;
  if ((Number(customer.currentPoints) || 0) > 0) return false;
  if ((Number(customer.walletBalance) || 0) > 0) return false;
  if ((Number(customer.totalSpend) || 0) > 0) return false;
  return !dbFind('orders', function (o) { return o.customerId === id; });
}

/* -------------------------------------------------------------
   API 1：查号码（决定要「注册」还是「输入密码」）
   -------------------------------------------------------------
   只回 exists / needsPasswordSetup 两个布林值，不回任何会员资料。
   有 rate limit，避免被拿来批量查号码。
   ------------------------------------------------------------- */

function checkCustomerPhone(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  var key = 'checkphone:' + res.phone;
  if (rateLimitLocked(key)) {
    return err('RATE_LIMITED', 'Too many attempts, please wait. / 查询太频繁，请稍后再试。');
  }
  rateLimitFail(key, numSetting('LOGIN_MAX_ATTEMPTS', 6) * 5, 300);

  var customer = findCustomerByPhone(res.phone);
  return ok({
    phone: res.phone,
    exists: !!customer,
    needsPasswordSetup: customer ? needsPasswordSetup(customer) : false,
    /* 只给前端显示用，例如「欢迎回来，J***」 */
    displayName: customer ? maskName(customer.name) : '',
    passwordMinLength: numSetting('CUSTOMER_PASSWORD_MIN', 8)
  });
}

function maskName(name) {
  var n = String(name || '').trim();
  if (!n) return '';
  if (n.length <= 1) return n;
  return n.charAt(0) + new Array(Math.min(n.length, 4)).join('*');
}

/* -------------------------------------------------------------
   API 2：注册（号码还没被用过）
   ------------------------------------------------------------- */

function customerRegister(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  var pwdError = passwordRuleError(data.password);
  if (pwdError) return pwdError;

  /* ★ 号码已存在 → 绝不建立第二笔（防重复注册） */
  if (findCustomerByPhone(res.phone)) return err('PHONE_ALREADY_REGISTERED');

  var customer = createCustomer(res.phone, data.name, String(data.password), 'SELF_REGISTER');
  var token = createSession('CUSTOMER', customer.customerId);
  audit(customer.customerId, 'CUSTOMER', 'SET_PASSWORD', 'CUSTOMER', customer.customerId, '', 'REGISTER');

  return ok({
    token: token,
    customer: publicCustomer(customer),
    isNewCustomer: true,
    duplicateDetected: false,
    phone: res.phone
  });
}

/* -------------------------------------------------------------
   API 3：登录（号码已存在 → 必须密码正确）
   ------------------------------------------------------------- */

function customerLogin(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  var key = 'customerlogin:' + res.phone;
  if (rateLimitLocked(key)) return err('RATE_LIMITED');

  var customer = findCustomerByPhone(res.phone);

  /* 号码没注册过 → 前端会改走注册流程（这里不会偷偷帮他建帐号） */
  if (!customer) {
    audit('', 'CUSTOMER', 'LOGIN_NO_ACCOUNT', 'CUSTOMER', '', res.phone, '');
    return err('CUSTOMER_NOT_FOUND',
      'This number is not registered yet. / 这个号码还没注册。');
  }

  if (needsPasswordSetup(customer)) {
    return err('PASSWORD_SETUP_REQUIRED');
  }

  var password = String(data.password || '');
  if (!password) return err('PASSWORD_REQUIRED');

  if (!verifyPassword(customer, password)) {
    var locked = rateLimitFail(key, numSetting('LOGIN_MAX_ATTEMPTS', 6),
                               numSetting('LOGIN_LOCK_MINUTES', 5) * 60);
    audit(customer.customerId, 'CUSTOMER', 'LOGIN_FAILED', 'CUSTOMER',
          customer.customerId, res.phone, locked ? 'LOCKED' : '');
    if (locked) return err('RATE_LIMITED');
    return err('WRONG_PASSWORD');
  }

  rateLimitClear(key);

  var duplicateDetected = dbFilter('customers', function (c) {
    return c.status !== 'MERGED' && String(c.phone) === res.phone;
  }).length > 1;

  /* 名字可以在登录时补上（只在原本是空的时候） */
  var name = String(data.name || '').trim().slice(0, 40);
  if (name && !customer.name) customer.name = name;
  customer.lastLoginAt = nowISO();

  var token = createSession('CUSTOMER', customer.customerId);
  audit(customer.customerId, 'CUSTOMER', 'LOGIN', 'CUSTOMER', customer.customerId, '', res.phone);

  return ok({
    token: token,
    customer: publicCustomer(customer),
    isNewCustomer: false,
    duplicateDetected: duplicateDetected,
    phone: res.phone
  });
}

/* -------------------------------------------------------------
   API 4：还没有密码的会员，第一次设定密码
   -------------------------------------------------------------
   适用于「旧版无密码时期建立的会员」（包含合并后保留下来的帐号）。

   安全说明：此时唯一的身份证明就是手机号码本身，跟旧版无密码登录一样，
   所以设完密码之后安全性只会变好、不会变差。
   等旧会员都补设完成，把 Settings 的 PASSWORD_SELFSERVICE_SETUP 改成
   FALSE，之后就只能由店员用 resetCustomerPassword 重设。

   已经有消费记录的帐号补设密码时会额外写一条 AuditLog，方便追查。
   ------------------------------------------------------------- */

function customerSetFirstPassword(data) {
  var res = normalizePhoneE164(data.phone, data.countryCode);
  if (!res.ok) return err('INVALID_PHONE', phoneErrorMessage(res.reason));

  var pwdError = passwordRuleError(data.password);
  if (pwdError) return pwdError;

  var customer = findCustomerByPhone(res.phone);
  if (!customer) return err('CUSTOMER_NOT_FOUND');
  if (!needsPasswordSetup(customer)) return err('PHONE_ALREADY_REGISTERED');

  if (!hasNoActivity(customer) && !boolSetting('PASSWORD_SELFSERVICE_SETUP', true)) {
    return err('PASSWORD_CHANGE_STAFF');
  }

  setPassword(customer, String(data.password));
  var name = String(data.name || '').trim().slice(0, 40);
  if (name && !customer.name) customer.name = name;

  var token = createSession('CUSTOMER', customer.customerId);
  audit(customer.customerId, 'CUSTOMER', 'SET_PASSWORD', 'CUSTOMER',
        customer.customerId, '', hasNoActivity(customer) ? 'FIRST_TIME' : 'MIGRATION_ON_ACTIVE_ACCOUNT');

  return ok({
    token: token,
    customer: publicCustomer(customer),
    isNewCustomer: false,
    phone: res.phone
  });
}

/* -------------------------------------------------------------
   API 5：会员自己改密码（需要当前密码 + 有效 session）
   ------------------------------------------------------------- */

function changeCustomerPassword(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  if (!verifyPassword(customer, String(data.currentPassword || ''))) {
    audit(customer.customerId, 'CUSTOMER', 'CHANGE_PASSWORD_FAILED', 'CUSTOMER',
          customer.customerId, '', '');
    return err('WRONG_PASSWORD', 'Current password is wrong. / 目前的密码不正确。');
  }

  var pwdError = passwordRuleError(data.newPassword);
  if (pwdError) return pwdError;

  setPassword(customer, String(data.newPassword));

  /* 其他装置的 session 全部失效（这一台保留） */
  var currentHash = sha256(token);
  dbFilter('sessions', function (x) {
    return x.userId === customer.customerId && x.userType === 'CUSTOMER' &&
           x.status === 'ACTIVE' && x.tokenHash !== currentHash;
  }).forEach(function (x) { x.status = 'LOGGED_OUT'; });

  audit(customer.customerId, 'CUSTOMER', 'CHANGE_PASSWORD', 'CUSTOMER',
        customer.customerId, '', '');
  return ok({ changed: true });
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

/* =============================================================
   会员条码（Member Code）
   -------------------------------------------------------------
   顾客在手机上出示条码 → 员工扫 → 确认是本人 → 才允许抵扣。

   安全设计：
   · 条码里只有 CustomerID + 一次性随机码，没有电话、没有密码
   · 随机码的 SHA-256 存在 CacheService，MEMBER_CODE_SECONDS 秒后失效
   · 扫过就作废（一次性），画面每 N 秒自动换一条
   · 员工扫到后拿到 verifyToken（MEMBER_VERIFY_SECONDS 秒内有效），
     redeemWallet 必须带回这个 token，且只能用于同一个顾客 + 同一个员工
   ============================================================= */

/** 拆解会员条码内容：'YT1|YT000001|<32 hex>' */
function parseMemberCode(payload) {
  var raw = String(payload || '').trim();
  var parts = raw.split('|');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'YT1') return null;
  var customerId = String(parts[1]).trim().toUpperCase();
  var secret = String(parts[2]).trim();
  if (!/^[A-Z]{2,4}\d{4,10}$/.test(customerId)) return null;
  if (!/^[a-f0-9]{16,128}$/i.test(secret)) return null;
  return { customerId: customerId, secret: secret };
}

/** 会员端：取得条码内容（顾客 session） */
function getMemberCode(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var c = ctx.customer;

  var seconds = numSetting('MEMBER_CODE_SECONDS', 60);
  var secret  = randomToken(16);                       // 32 hex
  rateLimitSet('membercode:' + sha256(secret),
    { customerId: c.customerId, at: Date.now() }, seconds);

  return ok({
    payload: 'YT1|' + c.customerId + '|' + secret,
    format: 'CODE128',
    seconds: seconds,
    customerId: c.customerId,
    displayName: maskName(c.name),
    membershipTier: c.membershipTier,
    currentPoints: Number(c.currentPoints) || 0,
    walletBalance: Number(c.walletBalance) || 0
  });
}

/** 员工端：扫到条码 → 验证 → 回传顾客资料 + verifyToken */
function scanMemberCode(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var parsed = parseMemberCode(data.payload || data.code);
  if (!parsed) return err('MEMBER_CODE_INVALID');

  var key = 'membercode:' + sha256(parsed.secret);
  var rec = rateLimitGet(key);
  if (!rec) return err('MEMBER_CODE_EXPIRED');
  rateLimitClear(key);                                  // 一次性：扫过即作废

  var c = dbById('customers', parsed.customerId);
  if (!c || c.status !== 'ACTIVE') return err('CUSTOMER_NOT_FOUND');

  var verifySeconds = numSetting('MEMBER_VERIFY_SECONDS', 180);
  var verifyToken   = randomToken(16);
  rateLimitSet('memberverify:' + sha256(verifyToken), {
    customerId: c.customerId,
    staffId: ctx.staff.staffId,
    at: Date.now()
  }, verifySeconds);

  audit(ctx.staff.staffId, 'STAFF', 'SCAN_MEMBER_CODE', 'CUSTOMER',
    c.customerId, '', maskName(c.name));

  return ok({
    customer: publicCustomer(c),
    membership: membershipInfo(c),
    verifyToken: verifyToken,
    verifySeconds: verifySeconds
  });
}

/**
 * 检查 verifyToken（不消耗）。回传 null = 通过；否则回传错误回应。
 * @param {string} verifyToken
 * @param {string} customerId
 * @param {string} staffId
 */
function peekMemberVerify(verifyToken, customerId, staffId) {
  if (!boolSetting('REQUIRE_MEMBER_CODE_SCAN', true)) return null;
  if (!verifyToken) return err('MEMBER_VERIFY_REQUIRED');

  var rec = rateLimitGet('memberverify:' + sha256(String(verifyToken)));
  if (!rec) return err('MEMBER_VERIFY_EXPIRED');
  if (rec.customerId !== customerId) return err('MEMBER_VERIFY_MISMATCH');
  if (staffId && rec.staffId && rec.staffId !== staffId) return err('MEMBER_VERIFY_MISMATCH');
  return null;
}

/** 真的用掉 verifyToken（在交易确定会成功之后才呼叫） */
function consumeMemberVerify(verifyToken) {
  if (!verifyToken) return;
  rateLimitClear('memberverify:' + sha256(String(verifyToken)));
}
