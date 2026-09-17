/* =============================================================
   demo/test-grant.js
   -------------------------------------------------------------
   ★ 2.0 员工端主流程：扫会员码 → 输消费金额 → 自动发积分与 Reward
   （grantOrder）+ 任何员工都能上下架商品（setProductStatus）

   重点验：
     · 员工只输金额，积分按 POINTS_PER_RM 自动算（§57）
     · 够门槛自动发 Reward（§58）
     · §56 六小时内只算一次到店 —— 同一位顾客连扫两次不能算两次
     · 必须扫过会员条码（REQUIRE_MEMBER_CODE_SCAN），且 verifyToken 一次性
     · 任何员工都能做（主流程不卡权限），但顾客 / 匿名不行
     · setProductStatus：任何员工都能上下架，下架后顾客看不到但管理页看得到
     · createClaim 已收紧到 MANAGER / OWNER

   执行： node demo/test-grant.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 员工扫码进分 + 商品状态（grantOrder / setProductStatus）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(w, action, data, token) {
  return w.api.doPost({ action: action, data: data || {}, token: token || '' });
}

function grantWorld(opts) {
  opts = opts || {};
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_CLOSE_TIME', value: '23:59' }, w.ownerToken);

  call(w, 'createStaff',
    { username: 'manager', password: 'manager-pass-1', role: 'MANAGER' }, w.ownerToken);
  call(w, 'createStaff',
    { username: 'bartender', password: 'staff-pass-12', role: 'STAFF' }, w.ownerToken);
  w.managerToken = call(w, 'staffLogin',
    { username: 'manager', password: 'manager-pass-1' }).data.token;
  w.staffToken = call(w, 'staffLogin',
    { username: 'bartender', password: 'staff-pass-12' }).data.token;

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  w.customerToken = reg.data.token;
  w.customerId = reg.data.customer.customerId;

  if (opts.wallet) {
    call(w, 'manualWalletAdjustment',
      { customerId: w.customerId, amount: opts.wallet, reason: 'test' }, w.ownerToken);
  }
  return w;
}

/** 完整的「员工扫会员码」：拿码 → 扫 → 回传 verifyToken */
function scanMember(w, staffToken) {
  var who = staffToken || w.staffToken;   // ★ 不传就用普通员工（主流程就是普通员工在做）
  const code = call(w, 'getMemberCode', {}, w.customerToken);
  if (!code.success) return { error: code.error };
  const scan = call(w, 'scanMemberCode', { payload: code.data.payload }, who);
  if (!scan.success) return { error: scan.error };
  return { verifyToken: scan.data.verifyToken };
}

/** 扫码 + 进分，一步到位 */
function grant(w, amountSen, staffToken, extra) {
  const s = scanMember(w, staffToken || w.staffToken);
  if (s.error) return { error: s.error };
  return call(w, 'grantOrder', Object.assign({
    customerId: w.customerId,
    billAmount: amountSen,
    verifyToken: s.verifyToken
  }, extra || {}), staffToken || w.staffToken);
}

/* -------------------------------------------------------------
   01 · 主流程：员工只输金额，积分自动算
   ------------------------------------------------------------- */

suite.group('01 · 员工扫码 → 输金额 → 自动发积分', (t) => {
  const w = grantWorld();

  /* POINTS_PER_RM 默认是 1 分 / RM，所以 RM86 = 86 分 */
  const perRM = call(w, 'getSettings', {}, w.ownerToken).data.settings
    .filter((s) => s.key === 'POINTS_PER_RM')[0];
  t.equal('POINTS_PER_RM 是 1', perRM.value, '1');

  const s = scanMember(w);
  t.check('员工扫会员码拿到 verifyToken', !s.error && !!s.verifyToken, s.error);

  const res = call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 8600, verifyToken: s.verifyToken
  }, w.staffToken);
  t.okIs(res, '★ 普通员工扫码进分成功');
  t.equal('★ 积分自动算出 86 分', res.data.pointsEarned, 86);
  t.equal('账单金额 RM86.00', res.data.billAmount, 8600);
  t.equal('★ 算一次到店', res.data.visitCounted, true);
  t.check('★ 够门槛自动发 Reward（RM86 ≥ RM30）', !!res.data.reward,
    JSON.stringify(res.data.reward));
  t.check('Reward 有金额', res.data.reward.amount > 0, res.data.reward.amount);
  t.check('Reward 状态 AVAILABLE', res.data.reward.status === 'AVAILABLE');

  /* 会员资料 */
  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('★ 会员积分 86', prof.currentPoints, 86);
  t.equal('★ 总消费 RM86.00', prof.totalSpend, 8600);
  t.equal('★ 到店 1 次', prof.totalVisits, 1);
  t.equal('★ Reward 数 1', prof.totalRewards, 1);

  /* 1.x Orders 要有一笔（通路业绩靠它） */
  const db = w.api.inspect((DB) => ({
    orders: DB.orders,
    pointTx: DB.pointTx,
    rewards: DB.rewards,
    audit: DB.audit
  }));
  t.equal('★ 1.x Orders 1 笔', db.orders.length, 1);
  t.equal('通路是 DIRECT', db.orders[0].orderSource, 'DIRECT');
  t.equal('认领状态 CLAIMED', db.orders[0].claimStatus, 'CLAIMED');
  t.equal('积分 86', db.orders[0].pointsEarned, 86);
  t.equal('★ 没用钱包', db.orders[0].walletUsed, 0);
  t.equal('★ PointTx 1 笔', db.pointTx.length, 1);
  t.equal('Rewards 1 笔', db.rewards.length, 1);
  t.check('★ AuditLog 有 GRANT_ORDER',
    db.audit.some((a) => a.action === 'GRANT_ORDER'));
});

suite.group('01b · 不同金额都按规则算', (t) => {
  const w = grantWorld();

  /* RM32 —— 低于 REWARD_MIN_SPEND（RM30 是门槛，32 > 30 所以会给） */
  const r1 = grant(w, 3200);
  t.okIs(r1, 'RM32 进分');
  t.equal('★ 32 分', r1.data.pointsEarned, 32);

  /* 第二笔 RM50 */
  const r2 = grant(w, 5000);
  t.okIs(r2, 'RM50 进分');
  t.equal('★ 50 分', r2.data.pointsEarned, 50);

  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('★ 积分累加 82', prof.currentPoints, 82);
  t.equal('★ 总消费 RM82.00', prof.totalSpend, 8200);
  t.equal('★ §56 六小时内仍只算 1 次到店', prof.totalVisits, 1);
});

suite.group('01c · 低于 Reward 门槛只给积分', (t) => {
  const w = grantWorld();
  /* REWARD_MIN_SPEND 默认 RM30，所以 RM20 不该有 Reward */
  const res = grant(w, 2000);
  t.okIs(res, 'RM20 进分');
  t.equal('★ 给 20 分', res.data.pointsEarned, 20);
  t.equal('★ 但没发 Reward（低于 RM30 门槛）', res.data.reward, null);

  const db = w.api.inspect((DB) => DB.rewards.length);
  t.equal('Rewards 表 0 笔', db, 0);
});

/* -------------------------------------------------------------
   02 · 会员条码验证（防冒用）
   ------------------------------------------------------------- */

suite.group('02 · 必须扫过会员条码', (t) => {
  const w = grantWorld();

  /* 不带 verifyToken */
  const noToken = call(w, 'grantOrder',
    { customerId: w.customerId, billAmount: 5000 }, w.staffToken);
  t.check('★ 没扫码不能进分', noToken.success === false);
  t.equal('错误码 MEMBER_VERIFY_REQUIRED', noToken.error.code, 'MEMBER_VERIFY_REQUIRED');

  /* 乱造的 verifyToken */
  const fake = call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 5000,
    verifyToken: 'not-a-real-verify-token-at-all-1234567890'
  }, w.staffToken);
  t.check('★ 假 verifyToken 被挡', fake.success === false);

  /* verifyToken 一次性 */
  const s = scanMember(w);
  t.okIs(call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 5000, verifyToken: s.verifyToken
  }, w.staffToken), '第一次用成功');

  const reuse = call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 5000, verifyToken: s.verifyToken
  }, w.staffToken);
  t.check('★ 同一个 verifyToken 不能重用', reuse.success === false);
  t.equal('错误码 MEMBER_VERIFY_EXPIRED', reuse.error.code, 'MEMBER_VERIFY_EXPIRED');
});

suite.group('02b · 不能拿别人的码给这位顾客进分', (t) => {
  const w = grantWorld();

  /* 第二位会员 */
  const other = call(w, 'customerRegister',
    { phone: '0198765432', name: 'Mina', password: PASSWORD });
  t.okIs(other, '第二位会员注册');

  /* 扫 Mina 的码，却想给 Jason 进分 */
  const code = call(w, 'getMemberCode', {}, other.data.token);
  const scan = call(w, 'scanMemberCode', { payload: code.data.payload }, w.staffToken);
  t.okIs(scan, '扫 Mina 的码');

  const res = call(w, 'grantOrder', {
    customerId: w.customerId,          // Jason
    billAmount: 5000,
    verifyToken: scan.data.verifyToken // 但扫的是 Mina
  }, w.staffToken);
  t.check('★ 张冠李戴被挡', res.success === false);
  t.equal('错误码 MEMBER_VERIFY_MISMATCH', res.error.code, 'MEMBER_VERIFY_MISMATCH');

  /* Jason 的积分没被动过 */
  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('Jason 积分仍是 0', prof.currentPoints, 0);
  t.equal('Jason 到店仍是 0', prof.totalVisits, 0);
});

/* -------------------------------------------------------------
   03 · §56 六小时内只算一次到店
   ------------------------------------------------------------- */

suite.group('03 · §56 连扫两次只算一次到店', (t) => {
  const w = grantWorld();

  const r1 = grant(w, 4000);
  t.okIs(r1, '第一笔 RM40');
  t.equal('★ 第一笔算到店', r1.data.visitCounted, true);

  const r2 = grant(w, 4000);
  t.okIs(r2, '第二笔 RM40');
  t.equal('★ 第二笔不算到店（6 小时内）', r2.data.visitCounted, false);

  const r3 = grant(w, 4000);
  t.equal('第三笔也不算', r3.data.visitCounted, false);

  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('★ 到店仍只有 1 次', prof.totalVisits, 1);
  t.equal('★ 但积分照给（3 × 40 = 120）', prof.currentPoints, 120);
  t.equal('总消费 RM120.00', prof.totalSpend, 12000);
});

suite.group('03b · 跟 App 点单共用同一条 §56 规则', (t) => {
  const w = grantWorld();
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);

  /* 先走一张 App 订单到 COMPLETED */
  const menu = call(w, 'getMenu', {}, w.customerToken).data;
  const sunset = menu.products.find((p) => p.nameEN === 'Yetipsy Sunset');
  const req = (menu.optionsByProduct[sunset.productId] || []).filter((o) => o.required);
  const groups = [];
  req.forEach((o) => {
    if (groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
  });
  const q = call(w, 'createCheckoutQuote', {
    items: [{
      productId: sunset.productId, quantity: 1,
      options: groups.map((g) => req.filter((o) => o.optionGroup === g)[0].optionId)
    }],
    orderType: 'COUNTER', useWallet: false
  }, w.customerToken);
  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, paymentMethod: 'COUNTER'
  }, w.customerToken);
  const id = o.data.order.appOrderId;
  ['acceptOrder', 'startPreparing', 'markReady', 'markPaymentPaid']
    .forEach((a) => call(w, a, { appOrderId: id }, w.ownerToken));
  const done = call(w, 'completeOrder', { appOrderId: id }, w.ownerToken);
  t.equal('App 订单算了一次到店', done.data.visitCounted, true);

  /* 同一晚再用员工扫码进分 —— 不能再算一次 */
  const g = grant(w, 5000);
  t.okIs(g, '员工扫码进分');
  t.equal('★ 不再重复算到店', g.data.visitCounted, false);

  const prof = call(w, 'getProfile', {}, w.customerToken).data.customer;
  t.equal('★ 到店总共 1 次', prof.totalVisits, 1);
  t.equal('积分 = 32（App）+ 50（扫码）', prof.currentPoints, 82);
});

/* -------------------------------------------------------------
   04 · 输入校验
   ------------------------------------------------------------- */

suite.group('04 · 金额与参数校验', (t) => {
  const w = grantWorld();

  [[0, 'INVALID_AMOUNT'], [-100, 'INVALID_AMOUNT'], ['abc', 'INVALID_AMOUNT'],
   [null, 'INVALID_AMOUNT'], [undefined, 'INVALID_AMOUNT']].forEach((pair) => {
    const res = grant(w, pair[0]);
    t.check('金额 ' + JSON.stringify(pair[0]) + ' 被挡', res.success === false,
      JSON.stringify(res.error));
    t.equal('错误码 ' + pair[1], res.error.code, pair[1]);
  });

  /* 找不到会员 */
  const s = scanMember(w);
  const bad = call(w, 'grantOrder', {
    customerId: 'YT999999', billAmount: 5000, verifyToken: s.verifyToken
  }, w.staffToken);
  t.check('★ 假 CustomerID 被挡', bad.success === false);
  t.equal('错误码 CUSTOMER_NOT_FOUND', bad.error.code, 'CUSTOMER_NOT_FOUND');
});

suite.group('04b · 同一个 externalOrderId 不能重复登记', (t) => {
  const w = grantWorld();

  const r1 = grant(w, 5000, w.staffToken, { externalOrderId: 'BILL-001' });
  t.okIs(r1, '第一次登记 BILL-001');

  const r2 = grant(w, 5000, w.staffToken, { externalOrderId: 'BILL-001' });
  t.check('★ 重复登记被挡', r2.success === false);
  t.equal('错误码 DUPLICATE_EXTERNAL_ORDER', r2.error.code, 'DUPLICATE_EXTERNAL_ORDER');

  /* 换个单号就可以 */
  const r3 = grant(w, 5000, w.staffToken, { externalOrderId: 'BILL-002' });
  t.okIs(r3, '换个单号可以');

  const db = w.api.inspect((DB) => DB.orders.length);
  t.equal('Orders 只有 2 笔（重复的那笔没进去）', db, 2);
});

/* -------------------------------------------------------------
   05 · 权限
   ------------------------------------------------------------- */

suite.group('05 · 任何员工都能扫码进分，顾客与匿名不行', (t) => {
  const w = grantWorld();

  /* 普通员工、经理、老板都可以 */
  [['普通员工', w.staffToken], ['MANAGER', w.managerToken], ['OWNER', w.ownerToken]]
    .forEach((pair) => {
      const res = grant(w, 3500, pair[1]);
      t.check('★ ' + pair[0] + ' 可以扫码进分', res.success, JSON.stringify(res.error));
    });

  /* 顾客 token 不行 */
  const s = scanMember(w);
  const asCustomer = call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 5000, verifyToken: s.verifyToken
  }, w.customerToken);
  t.check('★ 顾客不能自己给自己进分', asCustomer.success === false);
  t.equal('错误码 INVALID_SESSION', asCustomer.error.code, 'INVALID_SESSION');

  /* 匿名不行 */
  const anon = call(w, 'grantOrder',
    { customerId: w.customerId, billAmount: 5000 }, '');
  t.check('★ 匿名不能进分', anon.success === false);
  t.equal('匿名错误码 INVALID_SESSION', anon.error.code, 'INVALID_SESSION');

  /* 假 token 不行 */
  const fake = call(w, 'grantOrder',
    { customerId: w.customerId, billAmount: 5000 }, 'not-a-real-token');
  t.check('★ 假 token 不能进分', fake.success === false);
});

suite.group('05b · 被封锁的会员不能进分', (t) => {
  const w = grantWorld();

  /* ★ 要在封锁之前先扫码拿到 verifyToken，否则 getMemberCode 自己就先失败了，
     grantOrder 根本没被呼叫到，测的就不是 CUSTOMER_BLOCKED 这条路。 */
  const s = scanMember(w);
  t.check('封锁前扫码成功', !s.error && !!s.verifyToken, s.error);

  w.api.mutate((DB) => {
    DB.customers.find((c) => c.customerId === w.customerId).status = 'BLOCKED';
  });

  const res = call(w, 'grantOrder', {
    customerId: w.customerId, billAmount: 5000, verifyToken: s.verifyToken
  }, w.staffToken);
  t.check('★ 封锁会员被挡', res.success === false);
  t.equal('错误码 CUSTOMER_BLOCKED', res.error.code, 'CUSTOMER_BLOCKED');

  const db = w.api.inspect((DB) => DB.orders.length);
  t.equal('没写进 Orders', db, 0);
});

/* -------------------------------------------------------------
   06 · createClaim 已收紧
   ------------------------------------------------------------- */

suite.group('06 · 建立 Claim 收紧到 MANAGER / OWNER', (t) => {
  const w = grantWorld();

  const asStaff = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'X-1', amount: 5000 }, w.staffToken);
  t.check('★ 普通员工不能建立 Claim', asStaff.success === false);
  t.equal('错误码 UNAUTHORIZED', asStaff.error.code, 'UNAUTHORIZED');

  t.okIs(call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'X-2', amount: 5000 }, w.managerToken),
    '★ MANAGER 可以');
  t.okIs(call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'X-3', amount: 5000 }, w.ownerToken),
    '★ OWNER 可以');

  /* 但 Foodcourt 认领整条链仍然可用（§85） */
  const made = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'X-4', amount: 5000 }, w.ownerToken);
  const claim = call(w, 'claimOrder', { token: made.data.token }, w.customerToken);
  t.okIs(claim, '★ 顾客认领照旧可用（§85）');
  t.equal('得到 50 分', claim.data.pointsEarned, 50);
});

/* -------------------------------------------------------------
   07 · setProductStatus：任何员工都能上下架
   ------------------------------------------------------------- */

suite.group('07 · 任何员工都能上下架商品', (t) => {
  const w = grantWorld();
  const menu = call(w, 'getAdminMenu', {}, w.staffToken).data;
  const mojito = menu.products.find((p) => p.nameEN === 'Mojito');
  t.equal('原本 ACTIVE', mojito.status, 'ACTIVE');

  /* 普通员工下架 */
  const off = call(w, 'setProductStatus',
    { productId: mojito.productId, status: 'ARCHIVED' }, w.staffToken);
  t.okIs(off, '★ 普通员工可以下架');
  t.equal('状态变 ARCHIVED', off.data.status, 'ARCHIVED');

  /* 顾客端看不到了 */
  const custMenu = call(w, 'getMenu', {}, w.customerToken).data;
  t.check('★ 顾客端酒单不再有 Mojito',
    !custMenu.products.some((p) => p.productId === mojito.productId));

  /* 但管理页还看得到（这就是 getAdminMenu 的意义） */
  const adminMenu = call(w, 'getAdminMenu', {}, w.staffToken).data;
  const still = adminMenu.products.find((p) => p.productId === mojito.productId);
  t.check('★ 管理页仍看得到（才能恢复）', !!still);
  t.equal('管理页显示 ARCHIVED', still.status, 'ARCHIVED');

  /* 恢复上架 */
  const on = call(w, 'setProductStatus',
    { productId: mojito.productId, status: 'ACTIVE' }, w.staffToken);
  t.okIs(on, '★ 普通员工可以恢复上架');
  t.equal('状态变回 ACTIVE', on.data.status, 'ACTIVE');

  const back = call(w, 'getMenu', {}, w.customerToken).data;
  t.check('★ 顾客端又能看到了',
    back.products.some((p) => p.productId === mojito.productId));

  /* 审计 */
  const db = w.api.inspect((DB) => DB.audit);
  t.equal('★ 两次状态变更都有审计',
    db.filter((a) => a.action === 'SET_PRODUCT_STATUS').length, 2);
});

suite.group('07b · setProductStatus 的输入与权限', (t) => {
  const w = grantWorld();
  const menu = call(w, 'getAdminMenu', {}, w.staffToken).data;
  const mojito = menu.products.find((p) => p.nameEN === 'Mojito');

  /* 无效状态 */
  const bad = call(w, 'setProductStatus',
    { productId: mojito.productId, status: 'DELETED' }, w.staffToken);
  t.check('★ 无效状态被挡', bad.success === false);
  t.equal('错误码 INVALID_INPUT', bad.error.code, 'INVALID_INPUT');

  /* 找不到商品 */
  const noProd = call(w, 'setProductStatus',
    { productId: 'P999999', status: 'ACTIVE' }, w.staffToken);
  t.check('★ 假商品被挡', noProd.success === false);
  t.equal('错误码 PRODUCT_NOT_FOUND', noProd.error.code, 'PRODUCT_NOT_FOUND');

  /* 顾客不能改 */
  const asCustomer = call(w, 'setProductStatus',
    { productId: mojito.productId, status: 'ARCHIVED' }, w.customerToken);
  t.check('★ 顾客不能上下架', asCustomer.success === false);
  t.equal('顾客错误码 INVALID_SESSION', asCustomer.error.code, 'INVALID_SESSION');

  /* 匿名不能改 */
  const anon = call(w, 'setProductStatus',
    { productId: mojito.productId, status: 'ARCHIVED' }, '');
  t.check('★ 匿名不能上下架', anon.success === false);

  /* 状态没被上面的失败请求改掉 */
  const after = call(w, 'getAdminMenu', {}, w.staffToken).data;
  t.equal('Mojito 仍是 ACTIVE',
    after.products.find((p) => p.productId === mojito.productId).status, 'ACTIVE');
});

suite.group('07c · 下架不影响已下的订单', (t) => {
  const w = grantWorld();
  call(w, 'updateSetting', { key: 'ORDERING_OPEN_TIME', value: '00:00' }, w.ownerToken);

  const menu = call(w, 'getMenu', {}, w.customerToken).data;
  const sunset = menu.products.find((p) => p.nameEN === 'Yetipsy Sunset');
  const req = (menu.optionsByProduct[sunset.productId] || []).filter((o) => o.required);
  const groups = [];
  req.forEach((o) => {
    if (groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
  });
  const items = [{
    productId: sunset.productId, quantity: 1,
    options: groups.map((g) => req.filter((o) => o.optionGroup === g)[0].optionId)
  }];

  const q = call(w, 'createCheckoutQuote',
    { items: items, orderType: 'COUNTER', useWallet: false }, w.customerToken);
  const o = call(w, 'placeOrder', {
    quoteToken: q.data.quoteToken, idempotencyKey: q.data.idempotencyKey,
    orderType: q.data.orderType, paymentMethod: 'COUNTER'
  }, w.customerToken);
  t.okIs(o, '下单成功');
  const id = o.data.order.appOrderId;

  /* 下单之后员工把它下架 */
  t.okIs(call(w, 'setProductStatus',
    { productId: sunset.productId, status: 'ARCHIVED' }, w.staffToken), '员工下架商品');

  /* 订单仍要走完，积分照给（快照的意义 §30） */
  ['acceptOrder', 'startPreparing', 'markReady', 'markPaymentPaid']
    .forEach((a) => call(w, a, { appOrderId: id }, w.ownerToken));
  const done = call(w, 'completeOrder', { appOrderId: id }, w.ownerToken);
  t.okIs(done, '★ 下架后订单仍能完成');
  t.equal('★ 积分照给 32 分', done.data.pointsIssued, 32);

  const db = w.api.inspect((DB) => DB.orderItems[0]);
  t.equal('★ 快照名称仍是旧名', db.productNameSnapshot, 'Yetipsy Sunset');
  t.equal('快照单价不变', db.unitPriceSen, 3200);
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
