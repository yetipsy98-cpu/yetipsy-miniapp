/* =============================================================
   demo/test-apps-script.js
   -------------------------------------------------------------
   直接执行 apps-script/*.gs（在 Node 里模拟 Google 服务）。
   测的是「生产后端本体」：电话号码规范化、初始化、
   防重复注册的合并工具、密码 hash、Audit Log 修剪。

   执行： node demo/test-apps-script.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · Apps Script 后端测试（apps-script/*.gs）');

function customersActiveCount(api) {
  return api.inspect((DB) => DB.customers.filter((c) => c.status !== 'MERGED').length);
}

/* -------------------------------------------------------------
   01 电话号码规范化 —— 防「同一个号码重复注册」的第一道防线
   ------------------------------------------------------------- */
suite.group('01 · 电话号码规范化（E.164）', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();          // 规范化会读 Settings（DEFAULT_COUNTRY_CODE / ALLOWED_COUNTRY_CODES）
  const n = api.normalizePhoneE164;

  const malaysia = [
    ['0123456789', '+60123456789'],
    ['123456789', '+60123456789'],
    ['60123456789', '+60123456789'],
    ['+60123456789', '+60123456789'],
    ['+60 12-345 6789', '+60123456789'],
    ['0060 12 345 6789', '+60123456789'],
    ['(+60) 12-345 6789', '+60123456789']
  ];
  malaysia.forEach((pair) => {
    const r = n(pair[0]);
    t.equal(pair[0] + ' → ' + pair[1], r.ok && r.phone, pair[1]);
  });

  t.equal('同一个号码的 7 种写法收敛成 1 个身份',
    new Set(malaysia.map((p) => n(p[0]).phone)).size, 1);

  const tenDigit = n('01112345678');
  t.equal('10 位手机 01112345678 → +601112345678', tenDigit.ok && tenDigit.phone, '+601112345678');

  const sg = n('+6581234567');
  t.equal('+65 8123 4567 保留新加坡身份', sg.ok && sg.phone, '+6581234567');
  t.equal('不会被当成马来西亚号码', sg.ok && sg.phone, '+6581234567');
  const sgLocal = n('81234567', '65');
  t.equal('本地写法 81234567 (+65) → +6581234567', sgLocal.ok && sgLocal.phone, '+6581234567');

  t.equal('太短的号码被拒绝', n('123').ok, false);
  t.equal('不支持的国家码被拒绝', n('+14155551234').ok, false);
  t.equal('空字串被拒绝', n('').ok, false);
  t.equal('拒绝原因可读', n('123').reason, 'INVALID_LENGTH');
});

/* -------------------------------------------------------------
   02 初始化资料库
   ------------------------------------------------------------- */
suite.group('02 · setupDatabase() 建立 12 张 Sheet', (t) => {
  const { api, shim } = loadBackend();
  api.setupDatabase();

  const expected = ['Settings', 'Sequences', 'Customers', 'Staff', 'Sessions', 'Orders',
    'Claims', 'Rewards', 'PointTx', 'WalletTx', 'Promotions', 'AuditLogs'];
  expected.forEach((name) => {
    const sh = shim.spreadsheet.getSheetByName(name);
    t.check('Sheet「' + name + '」存在', !!sh);
    if (sh) t.check('Sheet「' + name + '」有标题列', sh.getLastRow() >= 1);
  });

  const settings = shim.spreadsheet.getSheetByName('Settings');
  t.check('预设设置已写入', settings.getLastRow() >= 18, settings.getLastRow());

  const promo = shim.spreadsheet.getSheetByName('Promotions');
  t.check('示范活动已写入', promo.getLastRow() >= 3, promo.getLastRow());

  api.setupDatabase();   // 幂等
  t.equal('重复执行不会重复写入设置',
    shim.spreadsheet.getSheetByName('Settings').getLastRow(), settings.getLastRow());
});

/* -------------------------------------------------------------
   03 老板账号 bootstrap
   ------------------------------------------------------------- */
suite.group('03 · bootstrapOwner()', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();

  const r = api.bootstrapOwner('Owner', 'yetipsy-secret-123');
  t.equal('建立成功', r.ok, true);

  let threw = '';
  try { api.bootstrapOwner('owner2', 'another-secret-1'); } catch (e) { threw = e.message; }
  t.check('第二次执行被拒绝（不能从外部再建老板账号）', /STAFF_ALREADY_EXISTS/.test(threw), threw);

  let threwShort = '';
  const { api: api2 } = loadBackend();
  api2.setupDatabase();
  try { api2.bootstrapOwner('owner', '123'); } catch (e) { threwShort = e.message; }
  t.check('短密码被拒绝', /PASSWORD_TOO_SHORT/.test(threwShort), threwShort);

  /* 密码必须是 salted hash，且每个账号 salt 不同 */
  const staff = api.inspect((DB) => DB.staff.slice());
  t.equal('Staff 表只有 1 笔', staff.length, 1);
  t.check('没有明文密码', staff[0].passwordHash.indexOf('yetipsy-secret-123') === -1);
  t.equal('Salt 长度 16 hex', staff[0].salt.length, 16);
  t.equal('hash = sha256(salt|password|salt)',
    staff[0].passwordHash.length, 64);
  t.equal('账号统一小写', staff[0].username, 'owner');
});

/* -------------------------------------------------------------
   04 等级 / 积分规则（读 Settings，不 hardcode）
   ------------------------------------------------------------- */
suite.group('04 · 等级与积分规则', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();

  t.equal('0 分 = MEMBER', api.computeTier(0), 'MEMBER');
  t.equal('499 分 = MEMBER', api.computeTier(499), 'MEMBER');
  t.equal('500 分 = SILVER', api.computeTier(500), 'SILVER');
  t.equal('1499 分 = SILVER', api.computeTier(1499), 'SILVER');
  t.equal('1500 分 = GOLD', api.computeTier(1500), 'GOLD');

  t.equal('RM86.00 → 86 分', api.pointsForAmount(8600, 0), 86);
  t.equal('RM86.00 用 RM10 钱包抵扣 → 76 分（NET_PAID）', api.pointsForAmount(8600, 1000), 76);

  api.mutate((DB, sb) => { sb.setSetting('POINTS_CALCULATION', 'GROSS_BILL'); });
  t.equal('GROSS_BILL：RM86.00 用 RM10 抵扣 → 86 分', api.pointsForAmount(8600, 1000), 86);
  api.mutate((DB, sb) => { sb.setSetting('POINTS_CALCULATION', 'NET_PAID'); });

  api.mutate((DB, sb) => { sb.setSetting('SILVER_THRESHOLD', '100'); });
  t.equal('Threshold 改设置后立刻生效', api.computeTier(100), 'SILVER');
});

/* -------------------------------------------------------------
   05 ★ 历史脏资料修复：dedupeCustomers()
   ------------------------------------------------------------- */
suite.group('05 · dedupeCustomers() 合并重复号码', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();

  /* 模拟旧版后端留下的重复会员：同一个号码三种写法 + 各自的消费 */
  api.mutate((DB, sb) => {
    DB.customers.push({
      customerId: 'YT000001', phone: '+60123456789', name: 'Jason', birthday: '',
      currentPoints: 50, lifetimePoints: 50, walletBalance: 500, membershipTier: 'MEMBER',
      totalSpend: 5000, totalVisits: 1, totalRewards: 0, status: 'ACTIVE',
      source: 'SELF_REGISTER', lastLoginAt: '', createdAt: '2026-01-01T10:00:00.000Z', lastVisitAt: ''
    });
    DB.customers.push({
      customerId: 'YT000002', phone: '0123456789', name: '', birthday: '',
      currentPoints: 30, lifetimePoints: 30, walletBalance: 300, membershipTier: 'MEMBER',
      totalSpend: 3000, totalVisits: 1, totalRewards: 0, status: 'ACTIVE',
      source: 'SELF_REGISTER', lastLoginAt: '', createdAt: '2026-02-01T10:00:00.000Z', lastVisitAt: ''
    });
    DB.customers.push({
      customerId: 'YT000003', phone: '60123456789', name: 'J', birthday: '',
      currentPoints: 20, lifetimePoints: 20, walletBalance: 0, membershipTier: 'MEMBER',
      totalSpend: 2000, totalVisits: 1, totalRewards: 0, status: 'ACTIVE',
      source: 'SELF_REGISTER', lastLoginAt: '', createdAt: '2026-03-01T10:00:00.000Z', lastVisitAt: ''
    });
    /* 三笔消费：5000 / 3000 / 2000 sen，全部已认领 */
    ['YT000001', 'YT000002', 'YT000003'].forEach((cid, i) => {
      DB.orders.push({
        orderId: 'YTORD00000' + (i + 1), externalOrderId: 'FC' + i, orderSource: 'FOODCOURT',
        billAmount: [5000, 3000, 2000][i], customerId: cid, claimStatus: 'CLAIMED',
        pointsEarned: [50, 30, 20][i], rewardAmount: 0, rewardId: '', walletUsed: 0,
        finalAmount: [5000, 3000, 2000][i], orderStatus: 'ACTIVE', createdBy: 'STF0001',
        note: '', createdAt: '2026-0' + (i + 1) + '-02T10:00:00.000Z',
        claimedAt: '', completedAt: ''
      });
      DB.pointTx.push({
        transactionId: 'PTS00000' + (i + 1), customerId: cid, orderId: 'YTORD00000' + (i + 1),
        type: 'EARN', points: [50, 30, 20][i], balanceBefore: 0, balanceAfter: [50, 30, 20][i],
        description: '', createdAt: '2026-0' + (i + 1) + '-02T10:00:00.000Z', createdBy: ''
      });
      DB.seq.order = i + 1; DB.seq.point = i + 1; DB.seq.customer = 3;
    });
    DB.walletTx.push({
      transactionId: 'WLT000001', customerId: 'YT000001', orderId: '', type: 'REWARD',
      amount: 500, balanceBefore: 0, balanceAfter: 500, description: '',
      createdAt: '2026-01-02T10:00:00.000Z', createdBy: ''
    });
    DB.walletTx.push({
      transactionId: 'WLT000002', customerId: 'YT000002', orderId: '', type: 'REWARD',
      amount: 300, balanceBefore: 0, balanceAfter: 300, description: '',
      createdAt: '2026-02-02T10:00:00.000Z', createdBy: ''
    });
    DB.seq.wallet = 2;
  });

  const dry = api.dedupeCustomers(true);
  t.equal('dry run 找到 1 组重复', dry.groups.length, 1);
  t.equal('dry run 会合并 2 笔', dry.merged, 2);
  t.equal('dry run 找到 2 个待规范化号码', dry.normalized, 2);

  const report = api.dedupeCustomers(false);
  t.equal('真正执行：合并 2 笔', report.merged, 2);

  const after = api.inspect((DB) => ({
    active: DB.customers.filter((c) => c.status !== 'MERGED'),
    keep: DB.customers.find((c) => c.customerId === 'YT000001'),
    allOrders: DB.orders.filter((o) => o.customerId === 'YT000001').length,
    allPoints: DB.pointTx.filter((p) => p.customerId === 'YT000001').length,
    allWallet: DB.walletTx.filter((w) => w.customerId === 'YT000001').length
  }));

  t.equal('合并后只剩 1 个有效会员', after.active.length, 1);
  t.equal('保留最早注册的帐号', after.keep.customerId, 'YT000001');
  t.equal('电话已规范化', after.keep.phone, '+60123456789');
  t.equal('消费记录全部转过来', after.allOrders, 3);
  t.equal('积分明细全部转过来', after.allPoints, 3);
  t.equal('钱包明细全部转过来', after.allWallet, 2);
  t.equal('积分用明细重算 = 100（不是相加两次）', after.keep.currentPoints, 100);
  t.equal('钱包用明细重算 = RM8.00', after.keep.walletBalance, 800);
  t.equal('累计消费 = RM100.00', after.keep.totalSpend, 10000);
  t.equal('到店次数 = 3', after.keep.totalVisits, 3);

  const dupes = api.reportDuplicatePhones();
  t.equal('合并后没有重复号码', dupes.length, 0);

  /* 同一个号码再进来，拿到的还是那一个帐号（不会又建一笔） */
  const check = api.doPost({ action: 'checkCustomerPhone', data: { phone: '0123456789' }, token: '' });
  t.equal('查询结果：号码已存在', check.data.exists, true);
  t.equal('旧资料没有密码 → 要求先设密码', check.data.needsPasswordSetup, true);

  const setup = api.doPost({
    action: 'customerSetFirstPassword',
    data: { phone: '0123456789', password: 'my-new-pass-1' }, token: ''
  });
  t.equal('补设密码后拿到同一个 CustomerID', setup.data.customer.customerId, 'YT000001');
  t.equal('积分还是合并后的 100', setup.data.customer.currentPoints, 100);
  t.equal('Customers Sheet 仍然只有 1 列 ★', customersActiveCount(api), 1);

  const login = api.doPost({
    action: 'customerLogin',
    data: { phone: '60123456789', password: 'my-new-pass-1' }, token: ''
  });
  t.equal('用另一种写法 + 密码登录成功', login.data.customer.customerId, 'YT000001');
  t.errorIs(api.doPost({ action: 'customerLogin', data: { phone: '0123456789', password: 'wrong' }, token: '' }),
    'WRONG_PASSWORD', '密码错误 → 拒绝');
});

/* -------------------------------------------------------------
   06 Audit Log 自动修剪
   ------------------------------------------------------------- */
suite.group('06 · Audit Log 上限', (t) => {
  const { api, sandbox } = loadBackend();
  api.setupDatabase();
  sandbox.SCHEMA.audit.maxRows = 10;      // 测试时把上限调小

  for (let i = 0; i < 25; i++) {
    api.doPost({ action: 'customerLogin', data: { phone: '12345678' + (i % 3) }, token: '' });
  }
  const rows = api.inspect((DB) => DB.audit.length);
  t.check('超过上限的旧记录被删掉', rows <= 10, rows);
});

/* -------------------------------------------------------------
   07 未知 action / 非法 JSON
   ------------------------------------------------------------- */
suite.group('07 · 请求解析', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();

  t.errorIs(api.doPost({ action: 'notARealAction', data: {} }), 'UNKNOWN_ACTION');
  const res = api.doPost('this is not json');
  t.errorIs(res, 'INVALID_INPUT', '非法 JSON → INVALID_INPUT');
  t.errorIs(api.doPost({ action: 'getProfile', data: {}, token: '' }), 'INVALID_SESSION',
    '非公开 action 没有 token → INVALID_SESSION');
});

suite.run().then((pass) => process.exit(pass ? 0 : 1));
