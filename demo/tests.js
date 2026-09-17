/* =============================================================
   demo/tests.js
   -------------------------------------------------------------
   完整 API 测试（对应企划书 §69 的 22 组 + 防重复注册 + 密码登录）。
   跑的是 apps-script/*.gs 本体，不是复制品。

   执行： node demo/tests.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const suite = new Suite('YETIPSY · API 测试（27 组 + 防重复注册 + 密码登录 + 会员条码）');

/* -------------------------------------------------------------
   工具
   ------------------------------------------------------------- */

function newWorld() {
  const loaded = loadBackend();
  loaded.api.setupDatabase();
  loaded.api.bootstrapOwner(OWNER.username, OWNER.password);
  const login = loaded.api.doPost({
    action: 'staffLogin',
    data: { username: OWNER.username, password: OWNER.password },
    token: ''
  });
  loaded.ownerToken = login.data.token;
  loaded.ownerId = login.data.staff.staffId;
  return loaded;
}

function call(world, action, data, token) {
  return world.api.doPost({ action: action, data: data || {}, token: token || '' });
}

const DEFAULT_PASSWORD = 'test-pass-123';

/**
 * 模拟真实前端流程：先查号码 →
 *   没注册过  → customerRegister（设密码）
 *   已注册    → customerLogin（验密码）
 */
function register(world, phone, name, password) {
  const pwd = password || DEFAULT_PASSWORD;
  const check = call(world, 'checkCustomerPhone', { phone: phone });
  if (check.success && check.data.exists) {
    if (check.data.needsPasswordSetup) {
      return call(world, 'customerSetFirstPassword', { phone: phone, password: pwd });
    }
    return call(world, 'customerLogin', { phone: phone, password: pwd });
  }
  return call(world, 'customerRegister',
    { phone: phone, name: name || '', password: pwd });
}

function customersInSheet(world) {
  return world.api.inspect((DB) => DB.customers.filter((c) => c.status !== 'MERGED').length);
}

/* -------------------------------------------------------------
   01 · 新会员注册
   ------------------------------------------------------------- */
suite.group('01 · 新会员注册（号码 + 密码）', (t) => {
  const w = newWorld();

  const check = call(w, 'checkCustomerPhone', { phone: '0123456789' });
  t.okIs(check, '查号码成功');
  t.equal('还没注册 → exists = false', check.data.exists, false);
  t.equal('回传 E.164', check.data.phone, '+60123456789');
  t.equal('密码长度规则 = 8', check.data.passwordMinLength, 8);

  t.errorIs(call(w, 'customerRegister', { phone: '0123456789', password: '123' }),
    'PASSWORD_TOO_SHORT', '密码太短 → 拒绝');
  t.errorIs(call(w, 'customerRegister', { phone: '0123456789' }),
    'PASSWORD_REQUIRED', '没填密码 → 拒绝');
  t.equal('失败的注册不会留下会员', customersInSheet(w), 0);

  const res = register(w, '123456789', 'Jason');
  t.okIs(res, '注册成功');
  t.equal('isNewCustomer = true', res.data.isNewCustomer, true);
  t.equal('电话以 E.164 储存', res.data.customer.phone, '+60123456789');
  t.equal('初始积分 0', res.data.customer.currentPoints, 0);
  t.equal('初始等级 MEMBER', res.data.customer.membershipTier, 'MEMBER');
  t.equal('钱包余额 0', res.data.customer.walletBalance, 0);
  t.check('拿到 session token', !!res.data.token);
  t.equal('Customers Sheet 只有 1 列', customersInSheet(w), 1);
});

/* -------------------------------------------------------------
   02 · ★ 旧会员登录（同一个号码不会重复注册）
   ------------------------------------------------------------- */
suite.group('02 · 同一个号码重复登录 → 同一个会员', (t) => {
  const w = newWorld();
  const first = register(w, '123456789', 'Jason');
  const second = register(w, '123456789', 'Jason');
  const third = register(w, '123456789', '');

  t.equal('第二次是「已注册」不是新会员',
    call(w, 'checkCustomerPhone', { phone: '123456789' }).data.exists, true);

  t.equal('第二次不是新会员', second.data.isNewCustomer, false);
  t.equal('第三次不是新会员', third.data.isNewCustomer, false);
  t.equal('三次拿到同一个 CustomerID',
    [first.data.customer.customerId, second.data.customer.customerId, third.data.customer.customerId]
      .filter((v, i, a) => a.indexOf(v) === i).length, 1);
  t.equal('Customers Sheet 仍然只有 1 列 ★', customersInSheet(w), 1);
  t.equal('没有重复号码', w.api.reportDuplicatePhones().length, 0);
});

/* -------------------------------------------------------------
   03 · ★ 同一个号码的不同写法
   ------------------------------------------------------------- */
suite.group('03 · 同一个号码的 7 种写法 = 同一个会员', (t) => {
  const w = newWorld();
  const inputs = ['0123456789', '123456789', '60123456789', '+60123456789',
    '+60 12-345 6789', '0060 12 345 6789', '(+60) 12-345 6789'];

  const ids = inputs.map((p) => register(w, p, 'Jason').data.customer.customerId);
  t.equal('7 种写法都拿到同一个 CustomerID ★',
    ids.filter((v, i, a) => a.indexOf(v) === i).length, 1);
  t.equal('Customers Sheet 只有 1 列 ★', customersInSheet(w), 1);
  t.equal('duplicateDetected = false', register(w, '+60123456789').data.duplicateDetected, false);
});

/* -------------------------------------------------------------
   04 · 马来西亚与新加坡号码不会互相混淆
   ------------------------------------------------------------- */
suite.group('04 · +60 与 +65 是两个不同的人', (t) => {
  const w = newWorld();
  const my = register(w, '+60123456789');
  const sg = register(w, '+6581234567');

  t.okIs(sg, '新加坡号码注册成功');
  t.equal('新加坡号码以 +65 储存', sg.data.customer.phone, '+6581234567');
  t.check('两个号码是不同会员', my.data.customer.customerId !== sg.data.customer.customerId);
  t.equal('Customers Sheet 有 2 列', customersInSheet(w), 2);

  /* 6581234567（不带 +）也必须被认成同一个新加坡会员 */
  const sgLocal = register(w, '6581234567', 'Ah Sg');
  t.equal('本地写法也能找到同一个新加坡会员',
    sgLocal.data.customer.customerId, sg.data.customer.customerId);
  t.equal('新加坡号码仍然只有 1 列',
    w.api.inspect((DB) => DB.customers.filter((c) => c.phone === '+6581234567').length), 1);
});

suite.group('05 · 无效号码', (t) => {
  const w = newWorld();
  t.errorIs(register(w, '123'), 'INVALID_PHONE', '太短 → INVALID_PHONE');
  t.errorIs(register(w, ''), 'INVALID_PHONE', '空白 → INVALID_PHONE');
  t.errorIs(register(w, '+14155551234'), 'INVALID_PHONE', '不支持的国家码 → INVALID_PHONE');
  t.equal('没有建立任何会员', customersInSheet(w), 0);
});

/* -------------------------------------------------------------
   06 · ★ 明确注册动作不允许重复
   ------------------------------------------------------------- */
suite.group('06 · customerRegister：号码已存在就拒绝', (t) => {
  const w = newWorld();
  const first = call(w, 'customerRegister',
    { phone: '123456789', name: 'Jason', password: 'pass-word-1' });
  t.okIs(first, '第一次注册成功');

  const again = call(w, 'customerRegister',
    { phone: '0123456789', password: 'another-pass-1' });
  t.errorIs(again, 'PHONE_ALREADY_REGISTERED', '同一个号码（不同写法）→ 拒绝');
  t.equal('Customers Sheet 只有 1 列 ★', customersInSheet(w), 1);
  t.equal('密码没有被改掉',
    call(w, 'customerLogin', { phone: '123456789', password: 'pass-word-1' }).success, true);
});

/* -------------------------------------------------------------
   07 · 员工登录
   ------------------------------------------------------------- */
suite.group('07 · 员工登录与失败锁定', (t) => {
  const w = newWorld();
  const okRes = call(w, 'staffLogin', { username: 'OWNER', password: OWNER.password });
  t.okIs(okRes, '账号大小写不影响登录');
  t.equal('角色 OWNER', okRes.data.staff.role, 'OWNER');

  const bad = call(w, 'staffLogin', { username: 'owner', password: 'wrong-password' });
  t.errorIs(bad, 'UNAUTHORIZED', '密码错误 → UNAUTHORIZED');

  for (let i = 0; i < 5; i++) call(w, 'staffLogin', { username: 'owner', password: 'wrong' });
  t.errorIs(call(w, 'staffLogin', { username: 'owner', password: OWNER.password }),
    'RATE_LIMITED', '失败 6 次后锁定 5 分钟');

  const staff = w.api.inspect((DB) => DB.staff.slice());
  t.check('密码不是明文', staff[0].passwordHash.indexOf(OWNER.password) === -1);
  t.equal('密码是 64 hex 的 SHA-256', staff[0].passwordHash.length, 64);
  t.equal('每个账号有独立 salt', staff[0].salt.length, 16);
});

/* -------------------------------------------------------------
   08–12 · Claim 建立与扫描
   ------------------------------------------------------------- */
suite.group('08 · 建立 Foodcourt Claim', (t) => {
  const w = newWorld();
  const res = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC8231', amount: 8600 }, w.ownerToken);

  t.okIs(res, '建立成功');
  t.equal('金额 RM86.00', res.data.amount, 8600);
  t.check('有 QR token', (res.data.token || '').length === 64);
  t.equal('Claim Code 4 位', res.data.claimCode.length, 4);

  const tokenRow = w.api.inspect((DB) => DB.claims[0]);
  t.check('资料库只存 token 的 hash，不存原文',
    tokenRow.claimTokenHash !== res.data.token && tokenRow.claimTokenHash.length === 64);

  t.errorIs(call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC8231', amount: 1000 }, w.ownerToken),
    'DUPLICATE_EXTERNAL_ORDER', '重复订单号 → 拒绝');

  t.errorIs(call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: '', amount: 1000 }, w.ownerToken),
    'INVALID_INPUT', 'Foodcourt 必填订单号');

  t.errorIs(call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'X1', amount: -5 }, w.ownerToken),
    'INVALID_AMOUNT', '负数金额 → 拒绝');

  t.errorIs(call(w, 'createClaim', { source: 'FOODCOURT', externalOrderId: 'X1', amount: 100 }, ''),
    'INVALID_SESSION', '没有员工 token → 拒绝');
});

suite.group('09 · 扫描 / 输入 Code', (t) => {
  const w = newWorld();
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  const member = register(w, '123456789', 'Jason');
  const mt = member.data.token;

  const byToken = call(w, 'getClaimByToken', { token: made.data.token }, mt);
  t.okIs(byToken, '扫 QR 成功');
  t.equal('金额正确', byToken.data.claim.amount, 8600);
  t.equal('订单号正确', byToken.data.claim.externalOrderId, 'FC1');

  const byCode = call(w, 'getClaimByCode', { code: made.data.claimCode.toLowerCase() }, mt);
  t.okIs(byCode, '输入 Code 成功（小写也可以）');

  t.errorIs(call(w, 'getClaimByToken', { token: 'deadbeef' }, mt),
    'INVALID_CLAIM_TOKEN', '无效 QR → 拒绝');
  t.errorIs(call(w, 'getClaimByCode', { code: 'ZZZZ' }, mt),
    'CLAIM_NOT_FOUND', '不存在的 Code → 拒绝');
  t.errorIs(call(w, 'getClaimByToken', { token: made.data.token }, ''),
    'INVALID_SESSION', '没登录不能扫');
});

suite.group('10 · 过期 Claim', (t) => {
  const w = newWorld();
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 5000 }, w.ownerToken);
  const mt = register(w, '123456789').data.token;

  w.api.mutate((DB) => {
    DB.claims[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  });

  t.errorIs(call(w, 'getClaimByToken', { token: made.data.token }, mt),
    'CLAIM_EXPIRED', '过期 → CLAIM_EXPIRED');
  t.errorIs(call(w, 'claimOrder', { token: made.data.token }, mt),
    'CLAIM_EXPIRED', '过期不能认领');
});

/* -------------------------------------------------------------
   11–15 · 认领与积分
   ------------------------------------------------------------- */
suite.group('11 · 认领订单 → 积分', (t) => {
  const w = newWorld();
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC8231', amount: 8600 }, w.ownerToken);
  const mt = register(w, '123456789', 'Jason').data.token;

  const res = call(w, 'claimOrder', { token: made.data.token }, mt);
  t.okIs(res, '认领成功');
  t.equal('RM86.00 → 86 分', res.data.pointsEarned, 86);
  t.equal('累计消费 RM86.00', res.data.customer.totalSpend, 8600);
  t.equal('到店 1 次', res.data.customer.totalVisits, 1);
  t.equal('积分余额 86', res.data.customer.currentPoints, 86);
  t.check('产生奖励', !!res.data.reward);

  t.errorIs(call(w, 'claimOrder', { token: made.data.token }, mt),
    'CLAIM_ALREADY_USED', '重复认领 → 拒绝（幂等）');

  const again = call(w, 'getPoints', {}, mt);
  t.equal('重复认领没有加到积分', again.data.currentPoints, 86);
});

suite.group('12 · 两个人抢同一个 Claim，只有一个成功', (t) => {
  const w = newWorld();
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 10000 }, w.ownerToken);
  const a = register(w, '123456789', 'A').data.token;
  const b = register(w, '198765432', 'B').data.token;

  const first = call(w, 'claimOrder', { token: made.data.token }, a);
  const second = call(w, 'claimOrder', { token: made.data.token }, b);

  t.okIs(first, '第一个成功');
  t.errorIs(second, 'CLAIM_ALREADY_USED', '第二个被拒绝');
  t.equal('B 的积分还是 0', call(w, 'getPoints', {}, b).data.currentPoints, 0);
  t.equal('订单只属于 A',
    w.api.inspect((DB) => DB.orders[0].customerId), first.data.customer.customerId);
});

suite.group('13 · 会员等级更新', (t) => {
  const w = newWorld();
  const mt = register(w, '123456789', 'Jason').data.token;

  [50000, 50000].forEach((amount, i) => {
    const made = call(w, 'createClaim',
      { source: 'FOODCOURT', externalOrderId: 'FC' + i, amount: amount }, w.ownerToken);
    call(w, 'claimOrder', { token: made.data.token }, mt);
  });

  const points = call(w, 'getPoints', {}, mt);
  t.equal('累计 1000 分', points.data.currentPoints, 1000);
  t.equal('升到 SILVER', points.data.membership.tier, 'SILVER');
  t.equal('下一级 GOLD', points.data.membership.nextTier, 'GOLD');
  t.equal('还差 500 分', points.data.membership.pointsToNext, 500);
  t.equal('进度 50%', points.data.membership.progressPercent, 50);
});

/* -------------------------------------------------------------
   14–15 · 奖励
   ------------------------------------------------------------- */
suite.group('14 · 奖励产生与打开', (t) => {
  const w = newWorld();
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  const mt = register(w, '123456789', 'Jason').data.token;
  const claimed = call(w, 'claimOrder', { token: made.data.token }, mt);

  const pending = call(w, 'getPendingReward', {}, mt);
  t.okIs(pending, '有等待打开的奖励');
  t.equal('rewardId 一致', pending.data.reward.rewardId, claimed.data.reward.rewardId);
  t.equal('状态 AVAILABLE', pending.data.reward.status, 'AVAILABLE');

  const opened = call(w, 'claimReward', { rewardId: pending.data.reward.rewardId }, mt);
  t.okIs(opened, '打开奖励成功');
  t.check('金额进入钱包', opened.data.walletBalance > 0);
  t.equal('钱包余额一致', call(w, 'getWallet', {}, mt).data.balance, opened.data.walletBalance);

  t.errorIs(call(w, 'claimReward', { rewardId: pending.data.reward.rewardId }, mt),
    'REWARD_ALREADY_CLAIMED', '重复打开 → 拒绝（幂等）');
  t.equal('钱包没有被加两次',
    call(w, 'getWallet', {}, mt).data.balance, opened.data.walletBalance);

  const other = register(w, '198765432', 'B').data.token;
  t.errorIs(call(w, 'claimReward', { rewardId: pending.data.reward.rewardId }, other),
    'REWARD_NOT_FOUND', '不能领别人的奖励');
});

suite.group('15 · 奖励预算', (t) => {
  const w = newWorld();
  w.api.mutate((DB, sb) => { sb.setSetting('DAILY_REWARD_BUDGET', '1'); });   // RM1 预算

  const amounts = [];
  for (let i = 0; i < 8; i++) {
    const mt = register(w, '1234567' + (10 + i), 'M' + i).data.token;
    const made = call(w, 'createClaim',
      { source: 'FOODCOURT', externalOrderId: 'FC' + i, amount: 8600 }, w.ownerToken);
    const res = call(w, 'claimOrder', { token: made.data.token }, mt);
    amounts.push(res.data.reward ? 1 : 0);
  }
  const given = w.api.inspect((DB) =>
    DB.rewards.reduce((sum, r) => sum + (r.status === 'CANCELLED' ? 0 : r.amount), 0));
  t.check('发放总额不超过每日预算 RM1.00', given <= 100, given);
  t.check('预算用完后停止发放', amounts.slice(-1)[0] === 0, amounts);
});

/* -------------------------------------------------------------
   16–19 · 钱包抵扣
   ------------------------------------------------------------- */
suite.group('16 · 员工查会员并计算抵扣', (t) => {
  const w = newWorld();
  const member = register(w, '123456789', 'Jason');
  const mt = member.data.token;
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  const claimed = call(w, 'claimOrder', { token: made.data.token }, mt);
  call(w, 'claimReward', { rewardId: claimed.data.reward.rewardId }, mt);

  const search = call(w, 'searchCustomer', { keyword: '0123456789' }, w.ownerToken);
  t.okIs(search, '用本地写法也搜得到会员');
  t.equal('搜到 1 位', search.data.customers.length, 1);
  t.equal('搜到的是同一个人', search.data.customers[0].customerId, member.data.customer.customerId);

  const calc = call(w, 'calculateWalletRedemption',
    { customerId: member.data.customer.customerId, billAmount: 6000 }, w.ownerToken);
  t.okIs(calc, '计算成功');
  t.equal('上限 = 账单 20%', calc.data.capAmount, 1200);
  t.equal('实际可用 = min(余额, 上限)', calc.data.usableAmount,
    Math.min(calc.data.walletBalance, 1200));
  t.equal('allowed = true', calc.data.allowed, true);

  const tooSmall = call(w, 'calculateWalletRedemption',
    { customerId: member.data.customer.customerId, billAmount: 2000 }, w.ownerToken);
  t.equal('账单未满 RM30 → 不能用', tooSmall.data.allowed, false);
  t.check('有原因说明', !!tooSmall.data.reason);
});

suite.group('17 · 钱包抵扣执行', (t) => {
  const w = newWorld();
  const member = register(w, '123456789', 'Jason');
  const mt = member.data.token;

  /* 先给 RM50 钱包余额（Manager 手动加） */
  call(w, 'manualWalletAdjustment',
    { customerId: member.data.customer.customerId, amount: 5000, reason: 'test' }, w.ownerToken);

  const before = call(w, 'getWallet', {}, mt).data.balance;
  t.equal('余额 RM50.00', before, 5000);

  /* 本版规则：抵扣前必须扫过这位顾客的会员条码（见第 26 组） */
  const code = call(w, 'getMemberCode', {}, mt);
  const scan = call(w, 'scanMemberCode', { payload: code.data.payload }, w.ownerToken);
  t.okIs(scan, '员工扫码确认身分');

  const res = call(w, 'redeemWallet', {
    customerId: member.data.customer.customerId,
    billAmount: 6000, walletAmount: 1200,
    source: 'FOODCOURT', externalOrderId: 'FC999',
    verifyToken: scan.data.verifyToken
  }, w.ownerToken);

  t.okIs(res, '抵扣成功');
  t.equal('用掉 RM12.00', res.data.walletUsed, 1200);
  t.equal('顾客实付 RM48.00', res.data.customerPays, 4800);
  t.equal('积分按实付 RM48.00 = 48 分', res.data.pointsEarned, 48);
  t.equal('余额剩 RM38.00', call(w, 'getWallet', {}, mt).data.balance, 3800);
  t.equal('累计消费算整张账单', res.data.customer.totalSpend, 6000);
});

suite.group('18 · 钱包抵扣上限', (t) => {
  const w = newWorld();
  const member = register(w, '123456789', 'Jason');
  const cid = member.data.customer.customerId;
  call(w, 'manualWalletAdjustment', { customerId: cid, amount: 50000, reason: 'test' }, w.ownerToken);

  t.errorIs(call(w, 'redeemWallet',
    { customerId: cid, billAmount: 6000, walletAmount: 2000 }, w.ownerToken),
    'WALLET_LIMIT_EXCEEDED', '超过账单 20% → 拒绝');

  t.errorIs(call(w, 'redeemWallet',
    { customerId: cid, billAmount: 2000, walletAmount: 400 }, w.ownerToken),
    'WALLET_LIMIT_EXCEEDED', '账单未满 RM30 → 拒绝');

  const poor = register(w, '198765432', 'Poor');
  t.errorIs(call(w, 'redeemWallet',
    { customerId: poor.data.customer.customerId, billAmount: 6000, walletAmount: 100 }, w.ownerToken),
    'INSUFFICIENT_WALLET', '余额不足 → 拒绝');

  t.errorIs(call(w, 'manualWalletAdjustment',
    { customerId: cid, amount: -99999999, reason: 'x' }, w.ownerToken),
    'INSUFFICIENT_WALLET', '手动扣超过余额 → 拒绝');
});

/* -------------------------------------------------------------
   19 · 权限
   ------------------------------------------------------------- */
suite.group('19 · 权限与 session', (t) => {
  const w = newWorld();
  const staffRes = call(w, 'createStaff',
    { username: 'bartender', password: 'staff-pass-123', role: 'STAFF' }, w.ownerToken);
  t.okIs(staffRes, 'Owner 建立员工');
  const staffToken = call(w, 'staffLogin',
    { username: 'bartender', password: 'staff-pass-123' }).data.token;

  const member = register(w, '123456789', 'Jason');
  const cid = member.data.customer.customerId;

  t.errorIs(call(w, 'manualWalletAdjustment', { customerId: cid, amount: 1000 }, staffToken),
    'UNAUTHORIZED', '员工不能手动调整钱包');
  t.errorIs(call(w, 'getSettings', {}, staffToken),
    'UNAUTHORIZED', '员工不能看设置');
  t.errorIs(call(w, 'listStaff', {}, staffToken),
    'UNAUTHORIZED', '员工不能看员工列表');
  t.errorIs(call(w, 'getDashboard', {}, member.data.token),
    'INVALID_SESSION', '会员 token 不能进员工端');
  t.errorIs(call(w, 'getProfile', {}, w.ownerToken),
    'INVALID_SESSION', '员工 token 不能当会员用');
  t.errorIs(call(w, 'getProfile', {}, 'not-a-real-token'),
    'INVALID_SESSION', '假 token → 拒绝');

  /* ★ 2.0 改动：建立 Claim（生成 QR）收紧到 MANAGER / OWNER。
     主流程改成员工扫会员码进分（grantOrder），QR 认领变成备用路径。 */
  t.errorIs(call(w, 'createClaim',
    { source: 'DIRECT', amount: 1000 }, staffToken),
    'UNAUTHORIZED', '★ 普通员工不能建立 Claim（2.0 收紧）');
  t.okIs(call(w, 'createClaim',
    { source: 'DIRECT', amount: 1000 }, w.ownerToken), '★ OWNER 仍可建立 Claim');
  /* 但普通员工仍能做主流程的扫码进分 */
  t.check('普通员工仍可调 grantOrder（权限不挡，另测验证）',
    ['grantOrder', 'setProductAvailability', 'setProductStatus', 'getAdminMenu']
      .every(function (a) {
        var r = call(w, a, {}, staffToken);
        return r.success || r.error.code !== 'UNAUTHORIZED';
      }));

  /* 停用账号后 session 立刻失效 */
  call(w, 'setStaffStatus', { staffId: staffRes.data.staffId, status: 'DISABLED' }, w.ownerToken);
  t.errorIs(call(w, 'getDashboard', {}, staffToken), 'INVALID_SESSION', '停用后 session 失效');
});

/* -------------------------------------------------------------
   20 · 取消订单（撤销积分与奖励）
   ------------------------------------------------------------- */
suite.group('20 · 取消订单会撤销积分与奖励', (t) => {
  const w = newWorld();
  const member = register(w, '123456789', 'Jason');
  const mt = member.data.token;
  const cid = member.data.customer.customerId;

  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  const claimed = call(w, 'claimOrder', { token: made.data.token }, mt);
  call(w, 'claimReward', { rewardId: claimed.data.reward.rewardId }, mt);

  const walletBefore = call(w, 'getWallet', {}, mt).data.balance;
  t.check('钱包有奖励金额', walletBefore > 0);

  const cancel = call(w, 'cancelOrder',
    { orderId: made.data.orderId, reason: 'wrong order' }, w.ownerToken);
  t.okIs(cancel, 'Owner 取消订单');

  t.equal('积分归零', call(w, 'getPoints', {}, mt).data.currentPoints, 0);
  t.equal('钱包奖励被撤销', call(w, 'getWallet', {}, mt).data.balance, 0);
  t.equal('累计消费归零', call(w, 'getProfile', {}, mt).data.customer.totalSpend, 0);
  t.equal('到店次数归零', call(w, 'getProfile', {}, mt).data.customer.totalVisits, 0);

  t.errorIs(call(w, 'cancelOrder', { orderId: made.data.orderId }, w.ownerToken),
    'ORDER_NOT_FOUND', '重复取消 → 拒绝');
  t.errorIs(call(w, 'cancelOrder', { orderId: 'YTORD999999' }, w.ownerToken),
    'ORDER_NOT_FOUND', '不存在的订单 → 拒绝');
});

/* -------------------------------------------------------------
   21 · 设置与 Audit Log
   ------------------------------------------------------------- */
suite.group('21 · 设置与 Audit Log', (t) => {
  const w = newWorld();
  const settings = call(w, 'getSettings', {}, w.ownerToken);
  t.okIs(settings, '读取设置');
  t.check('设置项目 > 20', settings.data.settings.length > 20, settings.data.settings.length);

  t.okIs(call(w, 'updateSetting', { key: 'POINTS_PER_RM', value: '2' }, w.ownerToken), '改设置');
  const mt = register(w, '123456789').data.token;
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  t.equal('POINTS_PER_RM = 2 → RM86 得 172 分',
    call(w, 'claimOrder', { token: made.data.token }, mt).data.pointsEarned, 172);

  t.errorIs(call(w, 'updateSetting', { key: 'POINTS_PER_RM', value: 'abc' }, w.ownerToken),
    'INVALID_INPUT', '数字设置不接受文字');
  t.errorIs(call(w, 'updateSetting', { key: 'NOT_A_SETTING', value: '1' }, w.ownerToken),
    'INVALID_INPUT', '未知设置 → 拒绝');
  t.okIs(call(w, 'updateSetting', { key: 'CUSTOMER_PASSWORD_MIN', value: '10' }, w.ownerToken),
    '可以改密码长度规则');
  const shortPwd = call(w, 'customerRegister',
    { phone: '0123456789', password: '123456789' });
  t.errorIs(shortPwd, 'PASSWORD_TOO_SHORT', '新的密码长度规则立刻生效');

  const logs = call(w, 'getAuditLogs', { limit: 100 }, w.ownerToken);
  t.okIs(logs, '读取 Audit Log');
  const actions = logs.data.logs.map((l) => l.action);
  ['CUSTOMER_REGISTER', 'LOGIN', 'CREATE_CLAIM', 'CLAIM_ORDER', 'SETTINGS_CHANGE']
    .forEach((a) => t.check('Audit Log 有 ' + a, actions.indexOf(a) !== -1, actions.slice(0, 8)));

  const onlyClaim = call(w, 'getAuditLogs', { limit: 100, action: 'CLAIM_ORDER' }, w.ownerToken);
  t.equal('可以按动作过滤', onlyClaim.data.logs.every((l) => l.action === 'CLAIM_ORDER'), true);
});

/* -------------------------------------------------------------
   22 · Dashboard
   ------------------------------------------------------------- */
suite.group('22 · Dashboard 统计', (t) => {
  const w = newWorld();
  const mt = register(w, '123456789', 'Jason').data.token;
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC1', amount: 8600 }, w.ownerToken);
  call(w, 'claimOrder', { token: made.data.token }, mt);
  const pending = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC2', amount: 4000 }, w.ownerToken);

  const dash = call(w, 'getDashboard', {}, w.ownerToken);
  t.okIs(dash, '读取 Dashboard');
  t.equal('今日营业额 RM126.00', dash.data.sales, 12600);
  t.equal('会员消费 RM86.00', dash.data.memberSales, 8600);
  t.equal('订单数 2', dash.data.orderCount, 2);
  t.equal('已认领 1', dash.data.claims, 1);
  t.equal('未认领 1', dash.data.claimsPending, 1);
  t.equal('新会员 1', dash.data.newMembers, 1);
  t.equal('发放积分 86', dash.data.pointsIssued, 86);
  t.check('奖励预算正确', dash.data.rewardBudget === 5000, dash.data.rewardBudget);
  t.equal('最近 Claim 有 2 笔', dash.data.recentClaims.length, 2);
});

/* -------------------------------------------------------------
   23 · 密码登录（取代 WhatsApp OTP）
   ------------------------------------------------------------- */
suite.group('23 · 密码登录与安全', (t) => {
  const w = newWorld();

  const check = call(w, 'checkCustomerPhone', { phone: '0123456789' });
  t.equal('新号码 → 前端会跳到注册', check.data.exists, false);

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: 'pass-word-1' });
  t.okIs(reg, '注册成功并直接登录');
  t.check('拿到 session token', !!reg.data.token);

  /* 已注册 → 前端改问密码 */
  const check2 = call(w, 'checkCustomerPhone', { phone: '+60 12-345 6789' });
  t.equal('同一个号码（另一种写法）→ exists = true', check2.data.exists, true);
  t.equal('已经有密码 → 不用再设', check2.data.needsPasswordSetup, false);
  t.equal('显示名称遮罩', check2.data.displayName, 'J***');

  t.errorIs(call(w, 'customerLogin', { phone: '0123456789', password: 'wrong-pass-1' }),
    'WRONG_PASSWORD', '密码错误 → 拒绝');
  t.errorIs(call(w, 'customerLogin', { phone: '0123456789' }),
    'PASSWORD_REQUIRED', '没填密码 → 拒绝');
  t.errorIs(call(w, 'customerLogin', { phone: '0198765432', password: 'pass-word-1' }),
    'CUSTOMER_NOT_FOUND', '没注册的号码不会偷偷建帐号');
  t.equal('失败的登录不会多建会员', customersInSheet(w), 1);

  const okLogin = call(w, 'customerLogin', { phone: '0123456789', password: 'pass-word-1' });
  t.okIs(okLogin, '密码正确 → 登录成功');
  t.equal('拿到同一个 CustomerID', okLogin.data.customer.customerId, reg.data.customer.customerId);

  /* 连续失败 → 锁定 */
  for (let i = 0; i < 6; i++) {
    call(w, 'customerLogin', { phone: '0123456789', password: 'bad' });
  }
  t.errorIs(call(w, 'customerLogin', { phone: '0123456789', password: 'pass-word-1' }),
    'RATE_LIMITED', '失败 6 次后锁定 5 分钟');

  /* 密码以 salted hash 储存 */
  const row = w.api.inspect((DB) => DB.customers[0]);
  t.check('Sheet 里没有明文密码', String(row.passwordHash).indexOf('pass-word-1') === -1);
  t.equal('hash 是 64 hex', row.passwordHash.length, 64);
  t.equal('每个会员有独立 salt', row.salt.length, 16);

  /* 锁定只锁这个号码，不影响其他会员 */
  const other = call(w, 'customerRegister',
    { phone: '0198765432', name: 'Other', password: 'other-pass-1' });
  t.okIs(other, '其他号码不受影响');
  t.okIs(call(w, 'customerLogin', { phone: '0198765432', password: 'other-pass-1' }),
    '其他号码仍可正常登录');
  t.equal('两个号码 = 两个会员', customersInSheet(w), 2);
});

suite.group('24 · 会员自己改密码', (t) => {
  const w = newWorld();
  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: 'pass-word-1' });
  const token = reg.data.token;

  t.errorIs(call(w, 'changeCustomerPassword',
    { currentPassword: 'nope', newPassword: 'brand-new-1' }, token),
    'WRONG_PASSWORD', '当前密码错 → 拒绝');
  t.errorIs(call(w, 'changeCustomerPassword',
    { currentPassword: 'pass-word-1', newPassword: '123' }, token),
    'PASSWORD_TOO_SHORT', '新密码太短 → 拒绝');

  const changed = call(w, 'changeCustomerPassword',
    { currentPassword: 'pass-word-1', newPassword: 'brand-new-1' }, token);
  t.okIs(changed, '改密码成功');

  t.errorIs(call(w, 'customerLogin', { phone: '0123456789', password: 'pass-word-1' }),
    'WRONG_PASSWORD', '旧密码失效');
  t.okIs(call(w, 'customerLogin', { phone: '0123456789', password: 'brand-new-1' }),
    '新密码可以登录');

  /* 员工重设密码（会员忘记密码时的解方） */
  const byStaff = call(w, 'resetCustomerPassword',
    { customerId: reg.data.customer.customerId, password: 'staff-set-1' }, w.ownerToken);
  t.okIs(byStaff, 'Manager/Owner 可以重设会员密码');
  t.okIs(call(w, 'customerLogin', { phone: '0123456789', password: 'staff-set-1' }),
    '重设后的密码可以登录');
  t.errorIs(call(w, 'resetCustomerPassword',
    { customerId: reg.data.customer.customerId, password: 'x' }, w.ownerToken),
    'PASSWORD_TOO_SHORT', '员工重设也要符合密码规则');
});

suite.group('24b · 旧会员（无密码）第一次设密码', (t) => {
  const w = newWorld();
  /* 模拟旧版无密码时期留下的会员（有积分，没有 passwordHash） */
  w.api.mutate((DB) => {
    DB.customers.push({
      customerId: 'YT000009', phone: '+60123456789', name: 'Old Member', birthday: '',
      currentPoints: 120, lifetimePoints: 120, walletBalance: 0, membershipTier: 'MEMBER',
      totalSpend: 12000, totalVisits: 2, totalRewards: 0, status: 'ACTIVE',
      source: 'IMPORT', salt: '', passwordHash: '', passwordSetAt: '',
      lastLoginAt: '', createdAt: '2026-01-01T00:00:00.000Z', lastVisitAt: ''
    });
    DB.seq.customer = 9;
  });

  const check = call(w, 'checkCustomerPhone', { phone: '0123456789' });
  t.equal('号码已存在', check.data.exists, true);
  t.equal('但还没有密码 → needsPasswordSetup', check.data.needsPasswordSetup, true);

  t.errorIs(call(w, 'customerLogin', { phone: '0123456789', password: 'anything1' }),
    'PASSWORD_SETUP_REQUIRED', '没密码的帐号不能用密码登录');

  const setup = call(w, 'customerSetFirstPassword',
    { phone: '0123456789', password: 'my-first-pass' });
  t.okIs(setup, '补设密码成功（迁移期）');
  t.equal('保留原本的积分', setup.data.customer.currentPoints, 120);
  t.equal('还是同一个 CustomerID', setup.data.customer.customerId, 'YT000009');
  t.equal('Customers Sheet 没有多出一列 ★', customersInSheet(w), 1);

  t.errorIs(call(w, 'customerSetFirstPassword',
    { phone: '0123456789', password: 'second-pass-1' }),
    'PHONE_ALREADY_REGISTERED', '已经有密码就不能再重设（要用旧密码或找店员）');

  /* 关掉迁移开关后，有资料的帐号只能由店员重设 */
  w.api.mutate((DB, sb) => { sb.setSetting('PASSWORD_SELFSERVICE_SETUP', 'FALSE'); });
  w.api.mutate((DB) => {
    DB.customers[0].salt = ''; DB.customers[0].passwordHash = ''; DB.customers[0].passwordSetAt = '';
  });
  t.errorIs(call(w, 'customerSetFirstPassword',
    { phone: '0123456789', password: 'another-pass1' }),
    'PASSWORD_CHANGE_STAFF', '迁移期结束后 → 请找店员');
});

/* -------------------------------------------------------------
   25 · 系统状态
   ------------------------------------------------------------- */
suite.group('25 · ping / 公开设置', (t) => {
  const w = newWorld();
  const ping = call(w, 'ping', {});
  t.okIs(ping, 'ping 成功');
  t.equal('模式是 PRODUCTION（不是 DEMO）', ping.data.mode, 'PRODUCTION');
  t.equal('储存是 GOOGLE_SHEETS', ping.data.storage, 'GOOGLE_SHEETS');
  t.equal('时区', ping.data.timezone, 'Asia/Kuala_Lumpur');
  t.equal('登录方式是手机号码 + 密码', ping.data.auth, 'PHONE_PASSWORD');

  const pub = w.api.doGet();
  t.okIs(pub, '浏览器直接打开 Web App URL 会回系统状态');
  t.equal('doGet 版本一致', pub.data.version, ping.data.version);
});

/* -------------------------------------------------------------
   26 · 会员条码 → 员工扫码 → 才能抵扣
   ------------------------------------------------------------- */
suite.group('26 · 会员条码与扫码抵扣', (t) => {
  const w = newWorld();
  const reg = register(w, '0123456789', 'Jason');
  t.okIs(reg, '会员注册');
  const ct = reg.data.token;
  const cid = reg.data.customer.customerId;

  /* 先给钱包一点钱，不然没法抵扣 */
  t.okIs(call(w, 'manualWalletAdjustment',
    { customerId: cid, amount: 5000, reason: 'test top up' }, w.ownerToken), '储值 RM50');

  /* ① 会员取条码 */
  const mc = call(w, 'getMemberCode', {}, ct);
  t.okIs(mc, '取得会员条码');
  t.equal('条码格式 YT1|CustomerID|secret', /^YT1\|YT\d+\|[a-f0-9]{32}$/.test(mc.data.payload), true,
    mc.data.payload);
  t.equal('条码有有效期', mc.data.seconds > 0, true, mc.data.seconds);
  t.equal('条码里不含电话号码', mc.data.payload.indexOf('60123456789') === -1, true);

  /* ② 没扫码就抵扣 → 挡下 */
  t.errorIs(call(w, 'redeemWallet',
    { customerId: cid, billAmount: 10000, walletAmount: 2000 }, w.ownerToken),
    'MEMBER_VERIFY_REQUIRED', '没扫条码不能抵扣 ★');

  /* ③ 垃圾字串 / 伪造条码 */
  t.errorIs(call(w, 'scanMemberCode', { payload: 'hello world' }, w.ownerToken),
    'MEMBER_CODE_INVALID', '垃圾字串 → 无效');
  t.errorIs(call(w, 'scanMemberCode',
    { payload: 'YT1|YT999999|deadbeefdeadbeefdeadbeefdeadbeef' }, w.ownerToken),
    'MEMBER_CODE_EXPIRED', '伪造条码 → 过期（不泄漏有没有这个会员）');

  /* ④ 没登录的顾客拿不到条码 */
  t.errorIs(call(w, 'getMemberCode', {}, 'not-a-real-token'),
    'INVALID_SESSION', '没 session 拿不到条码');

  /* ⑤ 员工扫码 */
  const scan = call(w, 'scanMemberCode', { payload: mc.data.payload }, w.ownerToken);
  t.okIs(scan, '员工扫码成功');
  t.equal('扫到的是同一位顾客', scan.data.customer.customerId, cid);
  t.equal('有 verifyToken', typeof scan.data.verifyToken === 'string' && scan.data.verifyToken.length >= 32, true);
  t.equal('verify 有时效', scan.data.verifySeconds > 0, true, scan.data.verifySeconds);

  /* ⑥ 同一条码不能重扫（一次性） */
  t.errorIs(call(w, 'scanMemberCode', { payload: mc.data.payload }, w.ownerToken),
    'MEMBER_CODE_EXPIRED', '条码扫过就作废 ★');

  /* ⑦ 带 verifyToken 抵扣 → 成功 */
  const okRes = call(w, 'redeemWallet', {
    customerId: cid, billAmount: 10000, walletAmount: 2000,
    verifyToken: scan.data.verifyToken
  }, w.ownerToken);
  t.okIs(okRes, '扫码后抵扣成功 ★');
  t.equal('扣了 RM20', okRes.data.walletUsed, 2000);
  t.equal('顾客付 RM80', okRes.data.customerPays, 8000);

  /* ⑧ verifyToken 用过就失效 */
  t.errorIs(call(w, 'redeemWallet', {
    customerId: cid, billAmount: 10000, walletAmount: 1000,
    verifyToken: scan.data.verifyToken
  }, w.ownerToken), 'MEMBER_VERIFY_EXPIRED', 'verifyToken 一次性 ★');

  /* ⑨ 乱造的 verifyToken */
  t.errorIs(call(w, 'redeemWallet', {
    customerId: cid, billAmount: 10000, walletAmount: 1000,
    verifyToken: 'deadbeefdeadbeefdeadbeefdeadbeef'
  }, w.ownerToken), 'MEMBER_VERIFY_EXPIRED', '伪造 verifyToken → 过期');

  /* ⑩ verifyToken 不能用在别的顾客身上 */
  const other = register(w, '0198765432', 'Ah Sg');
  const mc2 = call(w, 'getMemberCode', {}, other.data.token);
  const scan2 = call(w, 'scanMemberCode', { payload: mc2.data.payload }, w.ownerToken);
  t.okIs(scan2, '扫第二位顾客的码');
  t.errorIs(call(w, 'redeemWallet', {
    customerId: cid, billAmount: 10000, walletAmount: 1000,
    verifyToken: scan2.data.verifyToken
  }, w.ownerToken), 'MEMBER_VERIFY_MISMATCH', 'A 的验证不能用在 B 身上 ★');

  /* ⑪ 关掉开关就不需要扫码（给不想用的分店留退路） */
  w.api.mutate((DB, sb) => { sb.setSetting('REQUIRE_MEMBER_CODE_SCAN', 'FALSE'); });
  const noScan = call(w, 'redeemWallet',
    { customerId: cid, billAmount: 10000, walletAmount: 1000 }, w.ownerToken);
  t.okIs(noScan, '关掉 REQUIRE_MEMBER_CODE_SCAN 后可以直接抵扣');

  /* ⑫ 会员端不能扫别人的条码（需要员工 session） */
  w.api.mutate((DB, sb) => { sb.setSetting('REQUIRE_MEMBER_CODE_SCAN', 'TRUE'); });
  const mc3 = call(w, 'getMemberCode', {}, ct);
  t.errorIs(call(w, 'scanMemberCode', { payload: mc3.data.payload }, ct),
    'INVALID_SESSION', '会员 session 不能呼叫员工端的扫码');
});

/* -------------------------------------------------------------
   27 · 活动可见性（为什么客户端看不到 promotion）
   ------------------------------------------------------------- */
suite.group('27 · Promotion 可见性诊断', (t) => {
  const w = newWorld();
  const reg = register(w, '0123456789', 'Jason');
  const ct = reg.data.token;

  const before = call(w, 'getPromotions', {}, ct);
  t.okIs(before, '会员端取得活动');
  const seedCount = before.data.promotions.length;
  t.check('setupDatabase 会种示范活动', seedCount >= 2, seedCount);

  /* 新增一条已经过期的活动 */
  const past = call(w, 'createPromotion', {
    title: 'Expired Promo', subtitle: 'test',
    startDate: '2020-01-01', endDate: '2020-12-31', status: 'ACTIVE'
  }, w.ownerToken);
  t.okIs(past, '建立一条已过期的活动');
  const pid = past.data.promotion.promotionId;

  const afterCreate = call(w, 'getPromotions', {}, ct);
  t.equal('过期的活动不会出现在会员端 ★', afterCreate.data.promotions.length, seedCount);

  /* 员工端要直接讲出原因 */
  const admin = call(w, 'getPromotionsAdmin', {}, w.ownerToken);
  t.okIs(admin, '员工端取得活动清单');
  const row = admin.data.promotions.filter((p) => p.promotionId === pid)[0];
  t.equal('员工端标成 EXPIRED', row.visibilityReason, 'EXPIRED');
  t.equal('员工端标成看不到', row.visibleToday, false);
  t.check('回传今天日期', /^\d{4}-\d{2}-\d{2}$/.test(admin.data.today), admin.data.today);

  /* 诊断工具（Apps Script 编辑器里手动执行）：一眼看出为什么客户端没活动 */
  const report = w.api.reportPromotions();
  t.check('reportPromotions 回传文字', typeof report === 'string' && report.length > 50);
  t.check('诊断里有今天日期', report.indexOf(admin.data.today) !== -1);
  t.check('诊断里标出 EXPIRED 那一条', report.indexOf('EXPIRED') !== -1);
  t.check('诊断里讲出会员端会显示几条', /会员端现在会显示 \d+ 条活动/.test(report),
    (report.match(/会员端现在会显示 \d+ 条活动/) || [])[0]);
  t.check('诊断里有修法提示', report.indexOf('改日期') !== -1 || report.indexOf('ACTIVE') !== -1);

  /* 改日期 → 立刻出现 */
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  t.okIs(call(w, 'updatePromotion',
    { promotionId: pid, endDate: future }, w.ownerToken), '把结束日改到未来');

  const afterFix = call(w, 'getPromotions', {}, ct);
  t.equal('改完日期就出现在会员端 ★', afterFix.data.promotions.length, seedCount + 1);

  /* 停用 → 又消失 */
  t.okIs(call(w, 'updatePromotion',
    { promotionId: pid, status: 'INACTIVE' }, w.ownerToken), '停用活动');
  const afterOff = call(w, 'getPromotions', {}, ct);
  t.equal('停用后会员端看不到', afterOff.data.promotions.length, seedCount);

  const admin2 = call(w, 'getPromotionsAdmin', {}, w.ownerToken);
  const row2 = admin2.data.promotions.filter((p) => p.promotionId === pid)[0];
  t.equal('员工端标成 INACTIVE', row2.visibilityReason, 'INACTIVE');

  /* 还没开始的活动 */
  const soon = call(w, 'createPromotion', {
    title: 'Next Month', startDate: '2099-01-01', endDate: '2099-12-31'
  }, w.ownerToken);
  const admin3 = call(w, 'getPromotionsAdmin', {}, w.ownerToken);
  const row3 = admin3.data.promotions.filter((p) => p.promotionId === soon.data.promotion.promotionId)[0];
  t.equal('未来的活动标成 NOT_STARTED', row3.visibilityReason, 'NOT_STARTED');
  t.check('诊断也会标出 NOT_STARTED',
    w.api.reportPromotions().indexOf('NOT_STARTED') !== -1);

  /* STAFF 不能建活动（要 Manager / Owner） */
  w.api.mutate((DB) => {
    DB.staff.push({
      staffId: 'STF9001', username: 'cashier', passwordHash: DB.staff[0].passwordHash,
      salt: DB.staff[0].salt, name: 'Cashier', role: 'STAFF', pin: '',
      status: 'ACTIVE', createdAt: new Date().toISOString(), lastLoginAt: ''
    });
  });
  const staffLogin = call(w, 'staffLogin', { username: 'cashier', password: OWNER.password });
  if (staffLogin.success) {
    t.errorIs(call(w, 'createPromotion', { title: 'nope' }, staffLogin.data.token),
      'UNAUTHORIZED', 'STAFF 不能建活动');
  }
});

suite.run().then((pass) => process.exit(pass ? 0 : 1));
