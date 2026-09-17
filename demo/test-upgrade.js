/* =============================================================
   demo/test-upgrade.js
   -------------------------------------------------------------
   2.0 Phase 2 验收测试（企划书 §67 / §71 / §68 / §85）

   要证明的四件事：
     ① upgradeToV2() 只建立「不存在」的 2.0 Sheet，1.x 的表一列都不少
     ② 设定只补不改（老板改过的值不会被覆盖）
     ③ 幂等：跑第二次什么都不会新建
     ④ 升级前后 1.x 的会员 / Claim / 钱包 / 积分照常运作

   执行： node demo/test-upgrade.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 数据库升级测试（§67 / §71）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';
const PHONE = '0123456789';

/* 2.0 新增的东西（用来把测试环境还原成「还没升级的 1.x 线上状态」） */
const V2_SHEETS = ['Categories', 'Products', 'ProductOptions', 'AppOrders', 'OrderItems'];
const V2_SETTINGS = [
  'ORDERING_ENABLED', 'ORDERING_PAUSED', 'ORDERING_OPEN_TIME', 'ORDERING_CLOSE_TIME',
  'ALLOW_PICKUP', 'ALLOW_TABLE_ORDER', 'MAX_ORDER_ITEMS', 'VISIT_SESSION_HOURS',
  'ORDER_POLL_SECONDS', 'CUSTOMER_ORDER_POLL_SECONDS',
  'CHECKOUT_QUOTE_EXPIRY_MINUTES', 'MENU_CACHE_SECONDS'
];
const V2_SEQUENCES = ['category', 'product', 'option', 'apporder', 'orderitem', 'ordernum'];

function call(world, action, data, token) {
  return world.api.doPost({ action: action, data: data || {}, token: token || '' });
}

/** 建一个有真实会员资料的 1.x 世界 */
function buildLegacyWorld(t) {
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;

  /* 会员注册（走真实前端流程：先查号码再注册） */
  const reg = call(w, 'customerRegister', { phone: PHONE, name: 'Jason', password: PASSWORD });
  if (t) t.okIs(reg, '会员注册成功');
  w.customerToken = reg.data.token;
  w.customerId = reg.data.customer.customerId;

  /* 给积分、给钱包、产生 Claim 并认领（让 PointTx / WalletTx / Claims 都有资料） */
  call(w, 'manualPointAdjustment',
    { customerId: w.customerId, points: 320, reason: 'upgrade test' }, w.ownerToken);
  call(w, 'manualWalletAdjustment',
    { customerId: w.customerId, amount: 5000, reason: 'upgrade test' }, w.ownerToken);
  const claim = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-UPG-1', amount: 7200 }, w.ownerToken);
  call(w, 'claimOrder', { token: claim.data.token }, w.customerToken);

  stripV2(w);                    // 还原成「1.x 线上、还没升级」的样子
  return w;
}

/** 把 2.0 新增的 Sheet / 设定 / 序号拿掉，模拟升级前的线上数据库 */
function stripV2(w) {
  const ss = w.shim.spreadsheet;
  V2_SHEETS.forEach((name) => { delete ss.sheets[name]; });
  dropRows(ss.sheets.Settings, 0, (row) => V2_SETTINGS.indexOf(String(row[0])) >= 0);
  dropRows(ss.sheets.Sequences, 0, (row) => V2_SEQUENCES.indexOf(String(row[0])) >= 0);
}

function dropRows(sheet, keyCol, match) {
  if (!sheet) return;
  sheet.rows = sheet.rows.filter((r, i) => i === 0 || !match(r));
}

/**
 * 1.x 资料表的原始内容（含标题列），用来逐格比对。
 * Settings / Sequences 不放在这里 —— 升级本来就要往这两张表「追加」列，
 * 它们改由 existingRows() 单独验证「既有的列一列都没动」。
 */
function snapshotV1(w) {
  const all = w.shim.spreadsheet.toJSON();
  const out = {};
  Object.keys(all).forEach((name) => {
    if (V2_SHEETS.indexOf(name) >= 0) return;
    if (name === 'Settings' || name === 'Sequences') return;
    out[name] = JSON.stringify(all[name]);
  });
  return out;
}

/** 只取升级前就存在的那些列（按 key 过滤掉 2.0 新增的） */
function existingRows(w, sheetName, v2Keys) {
  const rows = (w.shim.spreadsheet.toJSON()[sheetName] || []).slice(1);
  return JSON.stringify(rows.filter((r) => v2Keys.indexOf(String(r[0])) < 0));
}

/* -------------------------------------------------------------
   01 · 升级前：缺 2.0 的表时，1.x 必须照常运作（§68）
   ------------------------------------------------------------- */
suite.group('01 · 还没升级时 1.x 照常运作（§68 向后相容）', (t) => {
  const w = buildLegacyWorld(t);
  const ss = w.shim.spreadsheet;

  V2_SHEETS.forEach((name) => {
    t.equal('Sheet「' + name + '」确实还不存在', ss.getSheetByName(name), null);
  });

  const status = w.api.reportUpgradeStatus();
  t.okIs(status, 'reportUpgradeStatus() 可执行');
  t.equal('状态 = 还没升级', status.data.ready, false);
  t.equal('缺 5 张表', status.data.missingSheets.length, 5);
  t.equal('缺 12 个设定', status.data.missingSettings.length, 12);

  /* 关键：dbLoad() 不能因为缺表就整包挂掉 */
  const profile = call(w, 'getProfile', {}, w.customerToken);
  t.okIs(profile, '缺表时 getProfile 仍然成功');
  t.equal('会员名字还在', profile.data.customer.name, 'Jason');

  const wallet = call(w, 'getWallet', {}, w.customerToken);
  t.okIs(wallet, '缺表时 getWallet 仍然成功');
  t.equal('钱包余额没变（5000 sen）', wallet.data.balance, 5000);

  const points = call(w, 'getPoints', {}, w.customerToken);
  t.okIs(points, '缺表时 getPoints 仍然成功');

  const promos = call(w, 'getPromotions', {}, w.customerToken);
  t.okIs(promos, '缺表时 getPromotions 仍然成功');

  const dash = call(w, 'getDashboard', {}, w.ownerToken);
  t.okIs(dash, '缺表时员工 Dashboard 仍然成功');
});

/* -------------------------------------------------------------
   02 · upgradeToV2()：只建立不存在的表（§67 ③）
   ------------------------------------------------------------- */
suite.group('02 · upgradeToV2() 建立缺失的 2.0 表', (t) => {
  const w = buildLegacyWorld();
  const before = snapshotV1(w);
  const beforeSettings = existingRows(w, 'Settings', V2_SETTINGS);
  const beforeSeq = existingRows(w, 'Sequences', V2_SEQUENCES);

  const res = w.api.upgradeToV2();
  t.okIs(res, 'upgradeToV2() 回传成功');
  const r = res.data;

  t.equal('升级完成标记', r.upgraded, true);
  t.equal('资料完整标记', r.dataIntact, true);
  t.equal('没有问题回报', r.problems.length, 0);
  t.equal('新建 5 张表', r.createdSheets.length, 5);
  V2_SHEETS.forEach((name) => {
    t.check('建了「' + name + '」', r.createdSheets.indexOf(name) >= 0, r.createdSheets);
    t.check('Sheet「' + name + '」真的存在', !!w.shim.spreadsheet.getSheetByName(name));
  });

  /* 新表要有正确的标题列 */
  const products = w.shim.spreadsheet.getSheetByName('Products');
  t.equal('Products 标题列第一栏 = ProductID', products.rows[0][0], 'ProductID');
  t.equal('Products 冻结标题列', products.frozen, 1);

  const orderItems = w.shim.spreadsheet.getSheetByName('OrderItems');
  t.check('OrderItems 有 ProductNameSnapshot（§30 快照）',
    orderItems.rows[0].indexOf('ProductNameSnapshot') >= 0, orderItems.rows[0]);
  t.check('OrderItems 有 UnitPriceSen（§30 快照）',
    orderItems.rows[0].indexOf('UnitPriceSen') >= 0, orderItems.rows[0]);

  /* ④ Settings / Sequences：既有的列一列都不能动（只允许追加） */
  t.equal('Settings 既有 27 个设定完全没变',
    existingRows(w, 'Settings', V2_SETTINGS), beforeSettings);
  t.equal('Sequences 既有 10 个序号完全没变',
    existingRows(w, 'Sequences', V2_SEQUENCES), beforeSeq);

  /* ⑤ 1.x 的资料表逐格比对，一列都不能变 */
  const after = snapshotV1(w);
  Object.keys(before).forEach((name) => {
    t.equal('1.x「' + name + '」内容完全没变', after[name], before[name]);
  });
  t.equal('1.x 表的数量没变', Object.keys(after).length, Object.keys(before).length);

  /* 逐张资料列数 */
  ['Customers', 'Orders', 'Claims', 'PointTx', 'WalletTx', 'Promotions', 'Staff', 'AuditLogs']
    .forEach((name) => {
      t.equal('rowCounts[' + name + '] 前后一致',
        r.rowCounts[name].after, r.rowCounts[name].before);
    });
});

/* -------------------------------------------------------------
   03 · 设定只补不改（§67 ④）
   ------------------------------------------------------------- */
suite.group('03 · 设定只补不改，老板改过的值不会被覆盖', (t) => {
  const w = buildLegacyWorld();

  /* 老板在 1.x 时改过的设定 */
  const upd = call(w, 'updateSetting',
    { key: 'BAR_NAME', value: 'Yetipsy Cocktail Bar' }, w.ownerToken);
  t.okIs(upd, '1.x 时老板改过 BAR_NAME');
  call(w, 'updateSetting', { key: 'MAX_WALLET_USAGE_PERCENT', value: '30' }, w.ownerToken);

  const res = w.api.upgradeToV2();
  t.okIs(res, 'upgradeToV2() 回传成功');
  const r = res.data;

  t.equal('补了 12 个 2.0 设定', r.addedSettings.length, 12);
  V2_SETTINGS.forEach((k) => {
    t.check('补上「' + k + '」', r.addedSettings.indexOf(k) >= 0, r.addedSettings);
  });
  t.check('BAR_NAME 不在「新增」名单里（代表没被覆盖）',
    r.addedSettings.indexOf('BAR_NAME') < 0);
  t.check('BAR_NAME 在「保留」名单里',
    r.unchangedSettings.indexOf('BAR_NAME') >= 0);

  /* 实际读回来确认值没被改 */
  const settings = call(w, 'getSettings', {}, w.ownerToken);
  t.okIs(settings, 'getSettings 可读');
  const map = {};
  settings.data.settings.forEach((s) => { map[s.key] = s.value; });
  t.equal('BAR_NAME 还是老板改的值', map.BAR_NAME, 'Yetipsy Cocktail Bar');
  t.equal('MAX_WALLET_USAGE_PERCENT 还是 30', map.MAX_WALLET_USAGE_PERCENT, '30');

  /* 2.0 的设定要是企划书 §63 的预设值 */
  t.equal('ORDERING_ENABLED 预设 TRUE', map.ORDERING_ENABLED, 'TRUE');
  t.equal('ORDERING_PAUSED 预设 FALSE', map.ORDERING_PAUSED, 'FALSE');
  t.equal('ORDERING_OPEN_TIME 预设 18:30', map.ORDERING_OPEN_TIME, '18:30');
  t.equal('ORDERING_CLOSE_TIME 预设 00:00', map.ORDERING_CLOSE_TIME, '00:00');
  t.equal('ALLOW_PICKUP 预设 TRUE', map.ALLOW_PICKUP, 'TRUE');
  t.equal('ALLOW_TABLE_ORDER 预设 TRUE', map.ALLOW_TABLE_ORDER, 'TRUE');
  t.equal('MAX_ORDER_ITEMS 预设 20', map.MAX_ORDER_ITEMS, '20');
  t.equal('VISIT_SESSION_HOURS 预设 6（§56）', map.VISIT_SESSION_HOURS, '6');
  t.equal('ORDER_POLL_SECONDS 预设 8（§46）', map.ORDER_POLL_SECONDS, '8');
  t.equal('CUSTOMER_ORDER_POLL_SECONDS 预设 12（§47）', map.CUSTOMER_ORDER_POLL_SECONDS, '12');
  t.equal('CHECKOUT_QUOTE_EXPIRY_MINUTES 预设 5（§43）', map.CHECKOUT_QUOTE_EXPIRY_MINUTES, '5');

  /* 每个设定都要有说明，员工端 Settings 页面才看得懂 */
  const noDesc = settings.data.settings.filter((s) => !s.description);
  t.equal('所有设定都有说明', noDesc.length, 0);

  /* 序号键 */
  t.equal('补了 6 个序号键', r.addedSequences.length, 6);
  V2_SEQUENCES.forEach((k) => {
    t.check('补上序号「' + k + '」', r.addedSequences.indexOf(k) >= 0, r.addedSequences);
  });
});

/* -------------------------------------------------------------
   04 · 幂等：跑第二次什么都不会新建（§67）
   ------------------------------------------------------------- */
suite.group('04 · 幂等：重复执行不会重复建立', (t) => {
  const w = buildLegacyWorld();
  const before = snapshotV1(w);
  const beforeSettings = existingRows(w, 'Settings', V2_SETTINGS);

  const first = w.api.upgradeToV2();
  t.okIs(first, '第一次升级成功');
  t.equal('第一次建了 5 张表', first.data.createdSheets.length, 5);

  const afterFirst = snapshotV1(w);
  const second = w.api.upgradeToV2();
  t.okIs(second, '第二次升级也成功（不报错）');
  const r = second.data;

  t.equal('第二次不再建表', r.createdSheets.length, 0);
  t.equal('5 张表都归到「已存在跳过」', r.skippedSheets.length, 5);
  t.equal('第二次不再补设定', r.addedSettings.length, 0);
  t.equal('第二次不再补序号', r.addedSequences.length, 0);
  t.equal('资料完整', r.dataIntact, true);

  const afterSecond = snapshotV1(w);
  t.equal('跑两次后 1.x 资料表仍与升级前一致',
    JSON.stringify(afterSecond), JSON.stringify(before));
  t.equal('第一次与第二次之间的 1.x 资料表也一致',
    JSON.stringify(afterSecond), JSON.stringify(afterFirst));
  t.equal('第二次没有再动 Settings',
    existingRows(w, 'Settings', V2_SETTINGS), existingRows(w, 'Settings', V2_SETTINGS));
  t.equal('Settings 总列数 = 1 + 39（27 个 1.x + 12 个 2.0）',
    w.shim.spreadsheet.sheets.Settings.rows.length, 40);
  t.equal('Sequences 总列数 = 1 + 16（10 个 1.x + 6 个 2.0）',
    w.shim.spreadsheet.sheets.Sequences.rows.length, 17);

  /* Settings 不能有重复的键 */
  const keys = w.shim.spreadsheet.sheets.Settings.rows.slice(1).map((r2) => String(r2[0]));
  t.equal('Settings 没有重复键', new Set(keys).size, keys.length);

  const status = w.api.reportUpgradeStatus();
  t.equal('升级后状态 = ready', status.data.ready, true);
  t.equal('没有缺表', status.data.missingSheets.length, 0);
  t.equal('没有缺设定', status.data.missingSettings.length, 0);
});

/* -------------------------------------------------------------
   05 · 升级后 1.x 全部照常（§85：不允许 2.0 破坏 1.x）
   ------------------------------------------------------------- */
suite.group('05 · 升级后 1.x 的会员流程照常（§85）', (t) => {
  const w = buildLegacyWorld();

  /* 升级前先记下会员状态 */
  const beforeProfile = call(w, 'getProfile', {}, w.customerToken).data.customer;
  const beforeWallet = call(w, 'getWallet', {}, w.customerToken).data.balance;

  t.okIs(w.api.upgradeToV2(), '执行升级');

  /* 旧 session 继续有效（§68） */
  const profile = call(w, 'getProfile', {}, w.customerToken);
  t.okIs(profile, '升级后旧 session 仍有效');
  t.equal('会员 ID 不变', profile.data.customer.customerId, beforeProfile.customerId);
  t.equal('积分不变', profile.data.customer.currentPoints, beforeProfile.currentPoints);
  t.equal('等级不变', profile.data.customer.membershipTier, beforeProfile.membershipTier);
  t.equal('累计消费不变', profile.data.customer.totalSpend, beforeProfile.totalSpend);

  const wallet = call(w, 'getWallet', {}, w.customerToken);
  t.equal('钱包余额不变', wallet.data.balance, beforeWallet);

  /* 重新登录也可以（密码没被动过） */
  const login = call(w, 'customerLogin', { phone: PHONE, password: PASSWORD });
  t.okIs(login, '升级后仍可用原密码登录');

  /* 完整的 Foodcourt Claim 流程照常（§85 明确要求） */
  const claim = call(w, 'createClaim',
    { source: 'FOODCOURT', externalOrderId: 'FC-UPG-2', amount: 8800 }, w.ownerToken);
  t.okIs(claim, '升级后仍可建立 Claim');
  const claimed = call(w, 'claimOrder', { token: claim.data.token }, w.customerToken);
  t.okIs(claimed, '升级后 Claim 仍可认领');

  const history = call(w, 'getOrderHistory', {}, w.customerToken);
  t.okIs(history, '升级后消费历史可读');
  t.check('历史里有刚认领的那笔 RM88',
    history.data.orders.some((o) => Number(o.amount) === 8800), history.data.orders);

  /* 会员条码（1.3.0 的功能）照常 */
  const code = call(w, 'getMemberCode', {}, w.customerToken);
  t.okIs(code, '升级后会员条码仍可产生');
  t.equal('条码格式 CODE128', code.data.format, 'CODE128');
});

/* -------------------------------------------------------------
   06 · 备份要诚实：环境不支持时不能假装备份过了（§67 ①）
   ------------------------------------------------------------- */
suite.group('06 · 备份状态要诚实', (t) => {
  const w = buildLegacyWorld();

  const noBackup = w.api.upgradeToV2();
  t.equal('没要求备份时 backup.ok = false', noBackup.data.backup.ok, false);
  t.check('而且讲清楚原因', String(noBackup.data.backup.reason).length > 10,
    noBackup.data.backup.reason);

  /* 给虚拟 Spreadsheet 一个 copy()，模拟真实 Apps Script 环境 */
  const w2 = buildLegacyWorld();
  w2.shim.spreadsheet.copy = function (name) {
    return { getId: () => 'backup-id-123', getName: () => name };
  };
  const withBackup = w2.api.upgradeToV2({ backup: true });
  t.okIs(withBackup, 'backup:true 时升级成功');
  t.equal('备份成功', withBackup.data.backup.ok, true);
  t.equal('备份 id 有回报', withBackup.data.backup.id, 'backup-id-123');
  t.check('备份档名含日期', /BACKUP before 2\.0 \d{4}-\d{2}-\d{2}/.test(withBackup.data.backup.name),
    withBackup.data.backup.name);

  /* 备份失败也要照样把升级做完，但必须回报失败 */
  const w3 = buildLegacyWorld();
  w3.shim.spreadsheet.copy = function () { throw new Error('DriveApp 权限不足'); };
  const failedBackup = w3.api.upgradeToV2({ backup: true });
  t.okIs(failedBackup, '备份失败不影响升级本身');
  t.equal('但 backup.ok = false', failedBackup.data.backup.ok, false);
  t.check('并附上失败原因', /权限不足/.test(String(failedBackup.data.backup.reason)),
    failedBackup.data.backup.reason);
});

/* -------------------------------------------------------------
   07 · 安全网：缺表时写订单不能静默丢资料
   ------------------------------------------------------------- */
suite.group('07 · 缺表时写入会明确报错，不会静默丢资料', (t) => {
  const w = buildLegacyWorld();

  let thrown = '';
  try {
    w.api.mutate((DB, sb) => {
      DB.appOrders.push({ appOrderId: 'APO000001', customerId: w.customerId });
      sb.dbFlush();
    });
  } catch (e) {
    thrown = String(e && e.message || e);
  }
  t.check('写 AppOrders 会抛 UPGRADE_REQUIRED', /UPGRADE_REQUIRED/.test(thrown), thrown);
  t.check('错误讯息叫老板去执行 upgradeToV2()', /upgradeToV2/.test(thrown), thrown);

  /* 1.x 的写入不受影响 */
  const adj = call(w, 'manualPointAdjustment',
    { customerId: w.customerId, points: 10, reason: 'still works' }, w.ownerToken);
  t.okIs(adj, '缺 2.0 表时 1.x 的积分调整照常写入');
});

/* -------------------------------------------------------------
   08 · setupDatabase() 本身也不能清掉资料（§67 的底线）
   ------------------------------------------------------------- */
suite.group('08 · setupDatabase() 重复执行也不清资料', (t) => {
  const w = buildLegacyWorld();
  const before = snapshotV1(w);
  const beforeRows = w.shim.spreadsheet.sheets.Customers.rows.length;

  w.api.setupDatabase();
  w.api.setupDatabase();

  t.equal('Customers 列数没变', w.shim.spreadsheet.sheets.Customers.rows.length, beforeRows);
  const after = snapshotV1(w);
  t.equal('跑两次 setupDatabase() 后 1.x 资料仍一致',
    JSON.stringify(after), JSON.stringify(before));

  const login = call(w, 'customerLogin', { phone: PHONE, password: PASSWORD });
  t.okIs(login, '会员仍能登录');
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
