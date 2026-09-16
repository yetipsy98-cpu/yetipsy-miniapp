/* =============================================================
   demo/tests.js
   -------------------------------------------------------------
   完整 API 测试（对应企划书 §69 的 22 组 + 防重复注册 + OTP）。
   跑的是 apps-script/*.gs 本体，不是复制品。

   执行： node demo/tests.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const suite = new Suite('YETIPSY · API 测试（22 组 + 防重复注册 + OTP）');

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

function register(world, phone, name, extra) {
  return call(world, 'customerLogin',
    Object.assign({ phone: phone, name: name || '' }, extra || {}));
}

function customersInSheet(world) {
  return world.api.inspect((DB) => DB.customers.filter((c) => c.status !== 'MERGED').length);
}

/* -------------------------------------------------------------
   01 · 新会员注册
   ------------------------------------------------------------- */
suite.group('01 · 新会员注册', (t) => {
  const w = newWorld();
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

  const sgLocal = register(w, '81234567', 'Ah Sg', { countryCode: '65' });
  t.equal('本地写法也能找到同一个新加坡会员',
    sgLocal.data.customer.customerId, sg.data.customer.customerId);
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
  const first = call(w, 'customerRegister', { phone: '123456789', name: 'Jason' });
  t.okIs(first, '第一次注册成功');

  const again = call(w, 'customerRegister', { phone: '0123456789' });
  t.errorIs(again, 'PHONE_ALREADY_REGISTERED', '同一个号码（不同写法）→ 拒绝');
  t.equal('Customers Sheet 只有 1 列 ★', customersInSheet(w), 1);
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

  const res = call(w, 'redeemWallet', {
    customerId: member.data.customer.customerId,
    billAmount: 6000, walletAmount: 1200,
    source: 'FOODCOURT', externalOrderId: 'FC999'
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

  t.okIs(call(w, 'createClaim',
    { source: 'DIRECT', amount: 1000 }, staffToken), '员工可以建立 Claim');

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
  t.errorIs(call(w, 'updateSetting', { key: 'OTP_ENABLED', value: 'TRUE' }, w.ownerToken),
    'OTP_NOT_CONFIGURED', '没配置 WhatsApp 不能开 OTP');

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
   23 · WhatsApp OTP（README §6.4）
   ------------------------------------------------------------- */
suite.group('23 · WhatsApp OTP 流程', (t) => {
  const w = newWorld();
  w.api.setProperty('WHATSAPP_TOKEN', 'EAAG-test-token');
  w.api.setProperty('WHATSAPP_PHONE_NUMBER_ID', '1234567890');
  t.okIs(call(w, 'updateSetting', { key: 'OTP_ENABLED', value: 'TRUE' }, w.ownerToken),
    '配置好 WhatsApp 后可以开 OTP');

  /* 没有 proof 不能登录 */
  t.errorIs(register(w, '123456789', 'Jason'), 'OTP_REQUIRED', '没有验证码不能登录');

  const req = call(w, 'requestCustomerOtp', { phone: '0123456789' });
  t.okIs(req, '发送验证码');
  t.equal('发送 1 次 WhatsApp API', w.shim.urlFetchCalls.length, 1);

  const payload = JSON.parse(w.shim.urlFetchCalls[0].params.payload);
  const code = (payload.text.body.match(/(\d{6})/) || [])[1];
  t.check('拿到 6 位验证码', /^\d{6}$/.test(code), payload.text.body);

  const stored = w.api.inspect((DB) => DB.otpCodes[0]);
  t.check('资料库只存 hash，不存明文验证码',
    stored.codeHash !== code && stored.codeHash.length === 64);

  t.errorIs(call(w, 'verifyCustomerOtp', { phone: '0123456789', code: '000000' }),
    'OTP_INVALID', '错误验证码 → 拒绝');

  const verified = call(w, 'verifyCustomerOtp', { phone: '0123456789', code: code });
  t.okIs(verified, '正确验证码通过');
  t.check('签发一次性 proof', !!verified.data.verificationToken);

  const login = register(w, '123456789', 'Jason', { verificationToken: verified.data.verificationToken });
  t.okIs(login, '带 proof 登录成功');
  t.equal('只建立 1 个会员', customersInSheet(w), 1);

  const replay = register(w, '123456789', 'Jason', { verificationToken: verified.data.verificationToken });
  t.errorIs(replay, 'OTP_REQUIRED', 'proof 用一次就失效');

  t.errorIs(call(w, 'requestCustomerOtp', { phone: '0123456789' }),
    'RATE_LIMITED', '60 秒内不能重发');
});

suite.group('24 · OTP 未配置时的行为', (t) => {
  const w = newWorld();
  w.api.mutate((DB, sb) => { sb.setSetting('OTP_ENABLED', 'TRUE'); });
  t.errorIs(call(w, 'requestCustomerOtp', { phone: '0123456789' }), 'OTP_NOT_CONFIGURED',
    '没配置 WhatsApp → 明确报错（不会静默放行）');
  t.errorIs(register(w, '123456789'), 'OTP_REQUIRED', '没有 proof 不能登录');
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

  const pub = w.api.doGet();
  t.okIs(pub, '浏览器直接打开 Web App URL 会回系统状态');
  t.equal('doGet 版本一致', pub.data.version, ping.data.version);
});

suite.run().then((pass) => process.exit(pass ? 0 : 1));
