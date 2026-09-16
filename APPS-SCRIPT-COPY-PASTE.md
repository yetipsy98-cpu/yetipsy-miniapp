# YETIPSY · Google Apps Script 全部档案（复制贴上用）

**15 个档案 · 版本 1.3.0 · 会员登录 = 手机号码 + 密码（不用 WhatsApp OTP）**

> 这份文件由 `node demo/build-copypaste.js` 从 `apps-script/*.gs` 产生。
> 改了后端记得重跑，`npm test` 会检查两者是否同步。

---

## 怎么用这个档案

1. 打开 <https://script.google.com>，建立（或打开）你的 Apps Script 专案。
2. 预设会有一个 `Code.gs` → 点它右边三个点 → **删除**（下面第 15 个会取代它）。
3. 依照下表顺序新增 15 个档案：点 **+ → 指令码（Script）**，
   输入名称时**不要**打 `.gs`（例如输入 `Config`，不是 `Config.gs`）。
4. 在下面的每一节里，复制那个代码框里的**全部内容**，贴到对应的档案里
   （档案里已经有内容的话，先 Ctrl+A 全选删掉再贴）。
5. 每个档案贴完按 **💾 储存**（Ctrl+S）。
6. 全部贴完 → 选 `Database` 档案 → 执行 `setupDatabase()`
   → 授权（进阶 → 前往专案 → 允许）→ 再执行一次 `bootstrapOwner()`。
7. 回 Google Sheet 看是否出现 **12 个分页**：`Settings` `Sequences` `Customers`
   `Staff` `Sessions` `Orders` `Claims` `Rewards` `PointTx` `WalletTx`
   `Promotions` `AuditLogs`。

| 顺序 | Apps Script 里的档案名 | 行数 | 内容 |
|---|---|---|---|
| 1 | `Config` | 302 | 所有设定与 12 张表的栏位定义（要改规则就改这里） |
| 2 | `Utils` | 220 | 公用工具：E.164 电话正规化、错误码、日期、JSON 回应 |
| 3 | `Database` | 567 | setupDatabase()、补栏位、防重复注册工具、dedupeCustomers() |
| 4 | `Security` | 108 | Session Token、权限（STAFF/MANAGER/OWNER）、Rate Limit、登入锁定 |
| 5 | `Audit` | 18 | Audit Log 写入与查询（最多保留 5000 条） |
| 6 | `Points` | 83 | 积分累计 / 等级门槛计算 |
| 7 | `Rewards` | 70 | 奖励产生与状态流转 |
| 8 | `Wallet` | 180 | 钱包储值 / 抵扣 / 上限（金额一律 sen） |
| 9 | `Customers` | 488 | ★ 查号码 / 注册 / 密码登录 / 改密码 / 会员资料 |
| 10 | `Orders` | 134 | 消费纪录与统计 |
| 11 | `Claims` | 395 | QR / 4 位 Code 认领（只存 token 的 hash） |
| 12 | `Promotions` | 72 | 优惠规则 |
| 13 | `Admin` | 209 | 员工端：Dashboard、会员查询、手动调整、重设会员密码、设置 |
| 14 | `Auth` | 89 | ping / getPublicSettings / staffLogin / staffLogout |
| 15 | `Code` | 190 | ★ 唯一入口 doPost()：action 白名单、参数解析、错误包装 |

> ⚠️ **15 个档案全部贴完再执行**，少一个会报 `xxx is not defined`。

---

## 1. Config.gs

> Apps Script 里的档案名称：**`Config`**（不要打 .gs）
> 所有设定与 12 张表的栏位定义（要改规则就改这里） · 302 行 · SHA-256 `879dc0738ad2a615`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Config.gs
   -------------------------------------------------------------
   所有「会变的东西」都放这里：Sheet 名称、栏位、默认设置。
   业务逻辑不应该 hardcode 任何栏位名称。

   这一份档案是前端（js/api.js）与后端唯一的共同契约来源：
   前端只知道 action 名称与 JSON 栏位，永远不知道 Sheet 结构。
   ============================================================= */

/** 版本（ping 会回传，方便确认线上跑的是哪一版） */
var APP_VERSION = '1.3.0';

/**
 * 资料表定义。
 * 每张表 = 一张 Sheet；第一列是标题，资料从第 2 列开始。
 *   key    : JS 物件栏位名称（API 也用这个名称）
 *   header : Sheet 上的标题
 *   type   : 's' = 字串, 'n' = 数字（写回 Sheet 前会转成数字，方便你在 Sheet 里加总）
 *   maxRows: 超过就自动删掉最旧的列（只给 log 类使用，0 = 不限制）
 */
var SCHEMA = {

  settings: {
    sheet: 'Settings',
    maxRows: 0,
    columns: [
      ['key',         'Key',         's'],
      ['value',       'Value',       's'],
      ['description', 'Description', 's']
    ]
  },

  sequences: {
    sheet: 'Sequences',
    maxRows: 0,
    columns: [
      ['key',   'Key',   's'],
      ['value', 'Value', 'n']
    ]
  },

  customers: {
    sheet: 'Customers',
    maxRows: 0,
    columns: [
      ['customerId',     'CustomerID',     's'],
      ['phone',          'Phone',          's'],   // E.164，唯一（例如 +60123456789）
      ['name',           'Name',           's'],
      ['birthday',       'Birthday',       's'],
      ['currentPoints',  'CurrentPoints',  'n'],
      ['lifetimePoints', 'LifetimePoints', 'n'],
      ['walletBalance',  'WalletBalance',  'n'],   // sen
      ['membershipTier', 'MembershipTier', 's'],
      ['totalSpend',     'TotalSpend',     'n'],   // sen
      ['totalVisits',    'TotalVisits',    'n'],
      ['totalRewards',   'TotalRewards',   'n'],
      ['status',         'Status',         's'],
      ['source',         'Source',         's'],   // SELF_REGISTER / IMPORT / MERGED
      ['salt',           'Salt',           's'],   // 每个会员独立的 salt
      ['passwordHash',   'PasswordHash',   's'],   // sha256(salt|password|salt)，不存明文
      ['passwordSetAt',  'PasswordSetAt',  's'],
      ['lastLoginAt',    'LastLoginAt',    's'],
      ['createdAt',      'CreatedAt',      's'],
      ['lastVisitAt',    'LastVisitAt',    's']
    ]
  },

  staff: {
    sheet: 'Staff',
    maxRows: 0,
    columns: [
      ['staffId',      'StaffID',      's'],
      ['username',     'Username',     's'],
      ['salt',         'Salt',         's'],
      ['passwordHash', 'PasswordHash', 's'],
      ['role',         'Role',         's'],
      ['status',       'Status',       's'],
      ['lastLogin',    'LastLogin',    's'],
      ['createdAt',    'CreatedAt',    's']
    ]
  },

  sessions: {
    sheet: 'Sessions',
    maxRows: 3000,
    columns: [
      ['sessionId',  'SessionID',  's'],
      ['userType',   'UserType',   's'],
      ['userId',     'UserID',     's'],
      ['tokenHash',  'TokenHash',  's'],
      ['status',     'Status',     's'],
      ['createdAt',  'CreatedAt',  's'],
      ['expiresAt',  'ExpiresAt',  's'],
      ['lastUsedAt', 'LastUsedAt', 's']
    ]
  },

  orders: {
    sheet: 'Orders',
    maxRows: 0,
    columns: [
      ['orderId',         'OrderID',         's'],
      ['externalOrderId', 'ExternalOrderID', 's'],
      ['orderSource',     'OrderSource',     's'],
      ['billAmount',      'BillAmount',      'n'],   // sen
      ['customerId',      'CustomerID',      's'],
      ['claimStatus',     'ClaimStatus',     's'],
      ['pointsEarned',    'PointsEarned',    'n'],
      ['rewardAmount',    'RewardAmount',    'n'],
      ['rewardId',        'RewardID',        's'],
      ['walletUsed',      'WalletUsed',      'n'],
      ['finalAmount',     'FinalAmount',     'n'],
      ['orderStatus',     'OrderStatus',     's'],
      ['createdBy',       'CreatedBy',       's'],
      ['note',            'Note',            's'],
      ['createdAt',       'CreatedAt',       's'],
      ['claimedAt',       'ClaimedAt',       's'],
      ['completedAt',     'CompletedAt',     's']
    ]
  },

  claims: {
    sheet: 'Claims',
    maxRows: 0,
    columns: [
      ['claimId',        'ClaimID',        's'],
      ['orderId',        'OrderID',        's'],
      ['claimTokenHash', 'ClaimTokenHash', 's'],
      ['claimCode',      'ClaimCode',      's'],
      ['status',         'Status',         's'],
      ['customerId',     'CustomerID',     's'],
      ['expiresAt',      'ExpiresAt',      's'],
      ['createdAt',      'CreatedAt',      's'],
      ['claimedAt',      'ClaimedAt',      's'],
      ['createdBy',      'CreatedBy',      's']
    ]
  },

  rewards: {
    sheet: 'Rewards',
    maxRows: 0,
    columns: [
      ['rewardId',  'RewardID',  's'],
      ['orderId',   'OrderID',   's'],
      ['customerId','CustomerID','s'],
      ['amount',    'Amount',    'n'],   // sen
      ['status',    'Status',    's'],
      ['createdAt', 'CreatedAt', 's'],
      ['expiresAt', 'ExpiresAt', 's'],
      ['claimedAt', 'ClaimedAt', 's']
    ]
  },

  pointTx: {
    sheet: 'PointTx',
    maxRows: 0,
    columns: [
      ['transactionId', 'TransactionID', 's'],
      ['customerId',    'CustomerID',    's'],
      ['orderId',       'OrderID',       's'],
      ['type',          'Type',          's'],
      ['points',        'Points',        'n'],
      ['balanceBefore', 'BalanceBefore', 'n'],
      ['balanceAfter',  'BalanceAfter',  'n'],
      ['description',   'Description',   's'],
      ['createdAt',     'CreatedAt',     's'],
      ['createdBy',     'CreatedBy',     's']
    ]
  },

  walletTx: {
    sheet: 'WalletTx',
    maxRows: 0,
    columns: [
      ['transactionId', 'TransactionID', 's'],
      ['customerId',    'CustomerID',    's'],
      ['orderId',       'OrderID',       's'],
      ['type',          'Type',          's'],
      ['amount',        'Amount',        'n'],
      ['balanceBefore', 'BalanceBefore', 'n'],
      ['balanceAfter',  'BalanceAfter',  'n'],
      ['description',   'Description',   's'],
      ['createdAt',     'CreatedAt',     's'],
      ['createdBy',     'CreatedBy',     's']
    ]
  },

  promotions: {
    sheet: 'Promotions',
    maxRows: 0,
    columns: [
      ['promotionId', 'PromotionID', 's'],
      ['title',       'Title',       's'],
      ['subtitle',    'Subtitle',    's'],
      ['description', 'Description', 's'],
      ['imageUrl',    'ImageURL',    's'],
      ['startDate',   'StartDate',   's'],
      ['endDate',     'EndDate',     's'],
      ['minSpend',    'MinSpend',    'n'],
      ['status',      'Status',      's'],
      ['sortOrder',   'SortOrder',   'n'],
      ['createdAt',   'CreatedAt',   's']
    ]
  },

  audit: {
    sheet: 'AuditLogs',
    maxRows: 5000,
    columns: [
      ['logId',      'LogID',      's'],
      ['userId',     'UserID',     's'],
      ['userType',   'UserType',   's'],
      ['action',     'Action',     's'],
      ['targetType', 'TargetType', 's'],
      ['targetId',   'TargetID',   's'],
      ['oldValue',   'OldValue',   's'],
      ['newValue',   'NewValue',   's'],
      ['createdAt',  'CreatedAt',  's']
    ]
  }
};

/** 系统默认设置（第一次 setupDatabase() 时写入 Settings Sheet，之后以 Sheet 为准） */
function defaultSettings() {
  return {
    BAR_NAME:                 'Yetipsy',
    CURRENCY:                 'MYR',
    TIMEZONE:                 'Asia/Kuala_Lumpur',

    /* 会员身份（手机号码 + 密码登录，不使用 WhatsApp / SMS OTP） */
    DEFAULT_COUNTRY_CODE:     '60',        // 60 = Malaysia, 65 = Singapore
    ALLOWED_COUNTRY_CODES:    '60,65',
    CUSTOMER_PASSWORD_MIN:    '8',         // 会员密码最少字符
    /* 迁移期开关：TRUE = 还没有密码的旧会员可以自己补设密码。
       等旧会员都补设完成后，建议改成 FALSE（之后只能由店员重设）。 */
    PASSWORD_SELFSERVICE_SETUP: 'TRUE',
    LOGIN_MAX_ATTEMPTS:       '6',         // 连续失败几次就锁定
    LOGIN_LOCK_MINUTES:       '5',         // 锁定几分钟

    /* 积分 */
    POINTS_PER_RM:            '1',
    POINTS_CALCULATION:       'NET_PAID',  // NET_PAID | GROSS_BILL
    MEMBER_THRESHOLD:         '0',
    SILVER_THRESHOLD:         '500',
    GOLD_THRESHOLD:           '1500',

    /* Claim */
    CLAIM_EXPIRY_HOURS:       '24',

    /* 奖励 */
    REWARD_ENABLED:           'TRUE',
    REWARD_MIN_SPEND:         '30',
    DAILY_REWARD_BUDGET:      '50',
    LOW_REWARD_MODE_MAX:      '100',       // sen = RM1.00
    REWARD_TIERS:             '[{"min":3000,"max":4999,"from":50,"to":200},' +
                              '{"min":5000,"max":9999,"from":100,"to":500},' +
                              '{"min":10000,"max":19999,"from":200,"to":1000},' +
                              '{"min":20000,"max":99999999,"from":300,"to":2000}]',
    REWARD_WEIGHTS:           '{"small":70,"medium":25,"big":5}',
    REWARD_EXPIRY_DAYS:       '7',

    /* 钱包 */
    MAX_WALLET_USAGE_PERCENT: '20',
    MIN_WALLET_REDEEM_BILL:   '30'
  };
}

/** 设置说明（员工端 Settings 页面会显示） */
var SETTING_DESC = {
  BAR_NAME:                 'Bar name / 品牌名称',
  CURRENCY:                 'Currency / 货币',
  TIMEZONE:                 'Timezone / 时区',
  DEFAULT_COUNTRY_CODE:     'Default country code / 预设国家码（60=MY, 65=SG）',
  ALLOWED_COUNTRY_CODES:    'Allowed country codes (comma separated) / 允许的国家码',
  CUSTOMER_PASSWORD_MIN:    'Member password min length / 会员密码最少字符',
  PASSWORD_SELFSERVICE_SETUP: 'TRUE = members without a password can set one themselves (migration)',
  LOGIN_MAX_ATTEMPTS:       'Login failures before lock / 登录失败几次后锁定',
  LOGIN_LOCK_MINUTES:       'Login lock minutes / 登录锁定分钟',
  POINTS_PER_RM:            'Points per RM1 / 每 RM1 获得积分',
  POINTS_CALCULATION:       'NET_PAID or GROSS_BILL / 积分计算基础',
  MEMBER_THRESHOLD:         'MEMBER threshold points',
  SILVER_THRESHOLD:         'SILVER threshold points',
  GOLD_THRESHOLD:           'GOLD threshold points',
  CLAIM_EXPIRY_HOURS:       'Claim expiry hours / 认领有效时数',
  REWARD_ENABLED:           'Enable rewards / 启用奖励',
  REWARD_MIN_SPEND:         'Min spend for reward (RM) / 奖励最低消费',
  DAILY_REWARD_BUDGET:      'Daily reward budget (RM) / 每日奖励预算',
  LOW_REWARD_MODE_MAX:      'Low reward mode max (sen)',
  REWARD_TIERS:             'Reward bands JSON',
  REWARD_WEIGHTS:           'Reward probability weights JSON',
  REWARD_EXPIRY_DAYS:       'Reward validity days / 奖励有效天数',
  MAX_WALLET_USAGE_PERCENT: 'Max wallet usage % of bill / 钱包最高抵扣比例',
  MIN_WALLET_REDEEM_BILL:   'Min bill for redemption (RM) / 最低抵扣账单'
};

/** Session 有效期 */
var CUSTOMER_SESSION_HOURS = 24 * 30;   // 30 天
var STAFF_SESSION_HOURS    = 12;        // 当班

/** 允许的订单来源 */
var ORDER_SOURCES = ['FOODCOURT', 'DIRECT', 'YETIPSY_APP', 'MANUAL', 'FOODCOURT_API', 'IMPORT'];
```

---

## 2. Utils.gs

> Apps Script 里的档案名称：**`Utils`**（不要打 .gs）
> 公用工具：E.164 电话正规化、错误码、日期、JSON 回应 · 220 行 · SHA-256 `b11b215333cd457a`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Utils.gs
   -------------------------------------------------------------
   时间 · 金额(SEN) · Hash · ID · 电话号码规范化 · 错误讯息
   ============================================================= */

/* -------------------------------------------------------------
   1. 基本工具
   ------------------------------------------------------------- */

function pad(n, len) {
  var s = String(n);
  while (s.length < (len || 6)) s = '0' + s;
  return s;
}

function nowISO() { return new Date().toISOString(); }

/** 随机 token（64 hex = 32 bytes）。资料库只存 hash，不存原文。 */
function randomToken(bytes) {
  var n = bytes || 24;
  var raw = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  // Utilities.getUuid() 只有 122 bits 熵，补上 Math.random 提高不可预测性
  var extra = '';
  while (extra.length < n * 2) extra += Math.floor(Math.random() * 1e16).toString(16);
  return (raw + extra).slice(0, n * 2);
}

function sha256(str) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function hashPassword(password, salt) {
  return sha256(salt + '|' + password + '|' + salt);
}

/** 金额：RM 字串 → sen 整数。非法回传 null */
function toSen(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Math.round(Number(value));
  return isFinite(n) ? n : null;
}

function timezone() {
  try { return String(setting('TIMEZONE', 'Asia/Kuala_Lumpur')); }
  catch (e) { return 'Asia/Kuala_Lumpur'; }
}

/** 当地「今天」YYYY-MM-DD */
function todayKey(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return dateKey(d);
}

/** 任意 ISO 时间 → 当地日期 YYYY-MM-DD */
function isoDateKey(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return dateKey(d);
}

function dateKey(d) {
  try {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    var y = '', m = '', dd = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') dd = p.value;
    });
    return y + '-' + m + '-' + dd;
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

function safeJson(text, fallback) {
  try {
    var v = JSON.parse(text);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) { return fallback; }
}

/* -------------------------------------------------------------
   2. 电话号码规范化（★ 防重复注册的核心）
   -------------------------------------------------------------
   会员身份 = 电话号码。同一个人可能用很多种写法输入同一个号码：

     0123456789  /  60123456789  /  +60123456789  /  0060 12-345 6789

   全部必须被规范化成同一个 E.164 字串：  +60123456789

   否则「同一个号码」会在 Customers Sheet 产生多列（重复注册），
   积分与钱包也会被拆到不同的会员帐号上。
   ------------------------------------------------------------- */

/**
 * @param {string} input 使用者输入的任何格式
 * @param {string} [defaultCountry] 预设国家码（不带 +），例如 '60'
 * @return {{ok:boolean, phone:string, countryCode:string, reason:string}}
 */
function normalizePhoneE164(input, defaultCountry) {
  var raw = String(input === null || input === undefined ? '' : input).trim();
  var hadPlus = raw.indexOf('+') === 0;
  var digits = raw.replace(/[^0-9]/g, '');

  var def = String(defaultCountry || setting('DEFAULT_COUNTRY_CODE', '60')).replace(/[^0-9]/g, '');
  var allowed = String(setting('ALLOWED_COUNTRY_CODES', '60,65'))
    .split(',').map(function (c) { return c.replace(/[^0-9]/g, ''); })
    .filter(function (c) { return c.length > 0; });
  if (allowed.indexOf(def) === -1) allowed.unshift(def);

  if (!digits) return phoneFail('EMPTY');

  /* 00xx = 国际拨号前缀 */
  if (!hadPlus && digits.indexOf('00') === 0) {
    digits = digits.slice(2);
    hadPlus = true;
  }

  var country = '';
  var local = digits;

  if (hadPlus) {
    /* 带 + ：从最长（3 位）到最短（1 位）尝试匹配允许的国家码 */
    var matched = false;
    [3, 2, 1].forEach(function (len) {
      if (matched) return;
      var cand = digits.slice(0, len);
      if (allowed.indexOf(cand) !== -1 && digits.length > len) {
        country = cand;
        local = digits.slice(len);
        matched = true;
      }
    });
    if (!matched) return phoneFail('UNSUPPORTED_COUNTRY');
  } else {
    /* 没有 + ：可能是 60123456789 / 0123456789 / 123456789 */
    var hit = null;
    allowed.forEach(function (c) {
      if (!hit && digits.indexOf(c) === 0 && digits.length > c.length + 6) hit = c;
    });
    if (hit) {
      country = hit;
      local = digits.slice(hit.length);
    } else {
      country = def;
      local = digits.replace(/^0+/, '');       // 本地写法：去掉前面的 0
    }
  }

  if (!local) return phoneFail('EMPTY');

  /* 本地号码长度 / 开头检查 */
  if (country === '60') {
    // 马来西亚手机：1x-xxxxxxx / 1x-xxxxxxxx（9–10 位，1 开头）
    if (!/^1[0-9]{8,9}$/.test(local)) return phoneFail('INVALID_LENGTH');
  } else if (country === '65') {
    // 新加坡手机：8 或 9 位，8/9 开头
    if (!/^[89][0-9]{7,8}$/.test(local)) return phoneFail('INVALID_LENGTH');
  } else {
    if (local.length < 7 || local.length > 12) return phoneFail('INVALID_LENGTH');
  }

  return { ok: true, phone: '+' + country + local, countryCode: country, reason: '' };
}

function phoneFail(reason) {
  return { ok: false, phone: '', countryCode: '', reason: reason };
}

/* -------------------------------------------------------------
   3. 统一回应格式
   ------------------------------------------------------------- */

function ok(data) { return { success: true, data: data || {}, error: null }; }
function fail(code, msg) {
  return { success: false, data: null, error: { code: code, message: msg || code } };
}

var ERR = {
  INVALID_SESSION:         ['INVALID_SESSION', 'Session expired. Please log in again. / 请重新登录。'],
  UNAUTHORIZED:            ['UNAUTHORIZED', 'You do not have permission. / 权限不足。'],
  INVALID_PHONE:           ['INVALID_PHONE', 'Invalid mobile number. / 手机号码无效。'],
  PHONE_ALREADY_REGISTERED:['PHONE_ALREADY_REGISTERED', 'This number is already registered. / 此号码已注册，请直接登录。'],
  WRONG_PASSWORD:          ['WRONG_PASSWORD', 'Wrong password. / 密码错误。'],
  PASSWORD_REQUIRED:       ['PASSWORD_REQUIRED', 'Password required. / 请输入密码。'],
  PASSWORD_TOO_SHORT:      ['PASSWORD_TOO_SHORT', 'Password is too short. / 密码太短。'],
  PASSWORD_SETUP_REQUIRED: ['PASSWORD_SETUP_REQUIRED', 'Please set your password first. / 请先设定密码。'],
  PASSWORD_CHANGE_STAFF:   ['PASSWORD_CHANGE_STAFF', 'Please ask our staff to reset your password. / 请联系店员重设密码。'],
  INVALID_AMOUNT:          ['INVALID_AMOUNT', 'Invalid amount. / 金额无效。'],
  INVALID_INPUT:           ['INVALID_INPUT', 'Invalid input. / 输入无效。'],
  ORDER_NOT_FOUND:         ['ORDER_NOT_FOUND', 'Order not found. / 找不到订单。'],
  DUPLICATE_EXTERNAL_ORDER:['DUPLICATE_EXTERNAL_ORDER', 'This order number already exists. / 此订单号已存在。'],
  CLAIM_NOT_FOUND:         ['CLAIM_NOT_FOUND', 'Claim not found. / 找不到此认领。'],
  CLAIM_EXPIRED:           ['CLAIM_EXPIRED', 'This claim has expired. / 此认领已过期。'],
  CLAIM_ALREADY_USED:      ['CLAIM_ALREADY_USED', 'This order has already been claimed. / 此订单已被认领。'],
  INVALID_CLAIM_TOKEN:     ['INVALID_CLAIM_TOKEN', 'Invalid QR code. / 二维码无效。'],
  REWARD_NOT_FOUND:        ['REWARD_NOT_FOUND', 'Reward not found. / 找不到奖励。'],
  REWARD_ALREADY_CLAIMED:  ['REWARD_ALREADY_CLAIMED', 'Reward already claimed. / 奖励已被领取。'],
  INSUFFICIENT_WALLET:     ['INSUFFICIENT_WALLET', 'Insufficient wallet balance. / 钱包余额不足。'],
  WALLET_LIMIT_EXCEEDED:   ['WALLET_LIMIT_EXCEEDED', 'Wallet usage exceeds the allowed limit. / 超出钱包可抵扣上限。'],
  CUSTOMER_NOT_FOUND:      ['CUSTOMER_NOT_FOUND', 'Member not found. / 找不到会员。'],
  INVALID_ROLE:            ['INVALID_ROLE', 'Invalid role. / 角色无效。'],
  RATE_LIMITED:            ['RATE_LIMITED', 'Too many attempts. Please wait. / 尝试次数过多，请稍后再试。'],
  STAFF_NOT_FOUND:         ['STAFF_NOT_FOUND', 'Staff account not found. / 找不到员工账号。'],
  USERNAME_TAKEN:          ['USERNAME_TAKEN', 'Username already exists. / 账号已存在。'],
  SETUP_REQUIRED:          ['SETUP_REQUIRED', 'Database is not set up yet. Run setupDatabase() first. / 资料库尚未初始化。'],
  UNKNOWN_ACTION:          ['UNKNOWN_ACTION', 'Unknown action. / 未知的 API 动作。']
};

function err(key, customMessage) {
  var e = ERR[key] || ['UNKNOWN', 'Unknown error.'];
  return fail(e[0], customMessage || e[1]);
}
```

---

## 3. Database.gs

> Apps Script 里的档案名称：**`Database`**（不要打 .gs）
> setupDatabase()、补栏位、防重复注册工具、dedupeCustomers() · 567 行 · SHA-256 `f1d3c15495800d63`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Database.gs
   -------------------------------------------------------------
   Google Sheets 存取层。

   设计：
   - 每个 API 请求开始时 dbLoad() 把 Sheet 读进记忆体（DB）
   - 业务逻辑只操作记忆体物件（跟 demo 后端完全一样的写法）
   - 请求结束时 dbFlush() 只把「有变动的列」写回 Sheet
   - 整个过程由 Code.gs 的 LockService 保护，不会互相踩到

   业务逻辑永远不直接碰 SpreadsheetApp。
   未来要换 Supabase / PostgreSQL，只需要改这个档案。
   ============================================================= */

var DB = null;
var DB_META = null;

/* -------------------------------------------------------------
   1. Spreadsheet
   ------------------------------------------------------------- */

function dbSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  }
  if (!ss) {
    throw new Error('SPREADSHEET_NOT_FOUND: 请把这个 Script 绑定到一个 Google Sheet，' +
      '或在 Script Properties 设定 SPREADSHEET_ID。');
  }
  return ss;
}

/* -------------------------------------------------------------
   2. 初始化（在 Apps Script 编辑器里手动执行一次）
   ------------------------------------------------------------- */

/**
 * 建立 12 张 Sheet 与预设设置。可重复执行（不会清掉资料）。
 */
function setupDatabase() {
  var ss = dbSpreadsheet();
  var created = [];

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) {
      sh = ss.insertSheet(def.sheet);
      created.push(def.sheet);
    }
    var headers = def.columns.map(function (c) { return c[1]; });
    var first = sh.getRange(1, 1, 1, headers.length);
    first.setValues([headers]);
    first.setFontWeight('bold');
    first.setBackground('#171717');
    first.setFontColor('#F4F1EA');
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    if (sh.getMaxColumns() > headers.length) {
      sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
    }
  });

  /* 预设设置（只在 Settings 是空的时候写入） */
  var settingsSheet = ss.getSheetByName(SCHEMA.settings.sheet);
  if (settingsSheet.getLastRow() < 2) {
    var defs = defaultSettings();
    var rows = Object.keys(defs).map(function (k) {
      return [k, String(defs[k]), SETTING_DESC[k] || ''];
    });
    settingsSheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  /* ID 序号 */
  var seqSheet = ss.getSheetByName(SCHEMA.sequences.sheet);
  if (seqSheet.getLastRow() < 2) {
    var seqRows = ['customer', 'staff', 'session', 'order', 'claim', 'reward',
                   'point', 'wallet', 'promo', 'audit'].map(function (k) { return [k, 0]; });
    seqSheet.getRange(2, 1, seqRows.length, 2).setValues(seqRows);
  }

  /* 示范促销（只在 Promotions 是空的时候写入） */
  var promoSheet = ss.getSheetByName(SCHEMA.promotions.sheet);
  if (promoSheet.getLastRow() < 2) {
    var tmp = { seq: { promo: 0 } };
    var seeds = [
      promoObject(tmp, 'Cocktail Night', 'EVERY WEDNESDAY',
        "Show this screen and enjoy our bartender's special selection.\n向店员出示此页面即可参与本周特调。",
        daysFromNow(-30), daysFromNow(60)),
      promoObject(tmp, 'Claim & Win', '每笔消费都有惊喜',
        "Claim your purchase and open tonight's mystery reward.\n认领消费即可打开今晚的神秘奖励。",
        daysFromNow(-10), daysFromNow(90))
    ];
    var promoDef = SCHEMA.promotions;
    promoSheet.getRange(2, 1, seeds.length, promoDef.columns.length)
      .setValues(seeds.map(function (p) { return objectToRow(promoDef, p); }));

    /* 把 promo 序号推到已使用的号码之后，避免之后建立活动时重号 */
    var seqSheet2 = ss.getSheetByName(SCHEMA.sequences.sheet);
    var seqValues = seqSheet2.getDataRange().getValues();
    for (var r = 1; r < seqValues.length; r++) {
      if (String(seqValues[r][0]) === 'promo') {
        seqSheet2.getRange(r + 1, 2).setValue(tmp.seq.promo);
        break;
      }
    }
  }

  Logger.log('setupDatabase() done. created sheets: ' + (created.length ? created.join(', ') : '(none, already existed)'));
  Logger.log('下一步：执行 bootstrapOwner("owner", "你的密码") 建立第一个老板账号。');
  return { ok: true, created: created };
}

/**
 * 建立第一个 OWNER 账号。只有在 Staff 表还是空的时候才能执行，
 * 之后一律由员工端 /admin/staff.html 管理（避免任何人从外部建立老板账号）。
 */
function bootstrapOwner(username, password) {
  dbLoad();
  try {
    if (DB.staff.length > 0) {
      throw new Error('STAFF_ALREADY_EXISTS: 老板账号已存在，请用 /admin/staff.html 管理。');
    }
    var uname = String(username || '').trim().toLowerCase();
    var pwd = String(password || '');
    if (uname.length < 3) throw new Error('USERNAME_TOO_SHORT: 账号至少 3 个字。');
    if (pwd.length < 8) throw new Error('PASSWORD_TOO_SHORT: 密码至少 8 位。');
    var salt = randomToken(8);
    var s = {
      staffId: dbNextId('STF', 'staff', 4),
      username: uname,
      salt: salt,
      passwordHash: hashPassword(pwd, salt),
      role: 'OWNER',
      status: 'ACTIVE',
      lastLogin: '',
      createdAt: nowISO()
    };
    dbInsert('staff', s);
    audit(s.staffId, 'STAFF', 'BOOTSTRAP_OWNER', 'STAFF', s.staffId, '', uname);
    dbFlush();
    Logger.log('Owner created: ' + uname);
    return { ok: true, username: uname };
  } finally {
    dbRelease();
  }
}

/* -------------------------------------------------------------
   3. 读：把 Sheet 载入记忆体
   ------------------------------------------------------------- */

function dbLoad() {
  var ss = dbSpreadsheet();
  DB_META = { rows: new Map(), snap: new Map(), sheets: {}, writes: 0 };
  DB = {};

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) {
      throw new Error('SETUP_REQUIRED: 找不到 Sheet「' + def.sheet + '」，请先执行 setupDatabase()。');
    }
    DB_META.sheets[table] = sh;
    var arr = [];
    var last = sh.getLastRow();
    if (last >= 2) {
      var values = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
      for (var i = 0; i < values.length; i++) {
        var obj = rowToObject(def, values[i]);
        DB_META.rows.set(obj, i + 2);
        DB_META.snap.set(obj, JSON.stringify(obj));
        arr.push(obj);
      }
    }
    DB[table] = arr;
  });

  /* settings / sequences 另外做成快速查询表 */
  DB._settings = {};
  DB.settings.forEach(function (r) { DB._settings[r.key] = r.value; });
  DB.seq = {};
  DB.sequences.forEach(function (r) { DB.seq[r.key] = Number(r.value) || 0; });

  DB._index = {};
  Object.keys(SCHEMA).forEach(function (table) {
    var idKey = SCHEMA[table].columns[0][0];
    var map = {};
    DB[table].forEach(function (o) { if (o[idKey]) map[o[idKey]] = o; });
    DB._index[table] = { key: idKey, map: map };
  });

  return DB;
}

function dbRelease() { DB = null; DB_META = null; }

function rowToObject(def, values) {
  var obj = {};
  def.columns.forEach(function (c, i) {
    var v = values[i];
    if (v instanceof Date) v = v.toISOString();
    if (v === null || v === undefined) v = '';
    if (c[2] === 'n') {
      var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      obj[c[0]] = isFinite(n) ? n : 0;
    } else {
      obj[c[0]] = String(v);
    }
  });
  return obj;
}

function objectToRow(def, obj) {
  return def.columns.map(function (c) {
    var v = obj[c[0]];
    if (v === null || v === undefined) return '';
    if (c[2] === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
    return String(v);
  });
}

/* -------------------------------------------------------------
   4. 写：只写有变动的列
   ------------------------------------------------------------- */

function dbFlush() {
  if (!DB || !DB_META) return { written: 0 };
  var written = 0;

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = DB_META.sheets[table];
    var appends = [];
    var updates = [];

    DB[table].forEach(function (obj) {
      var rowNum = DB_META.rows.get(obj);
      var json = JSON.stringify(obj);
      if (!rowNum) {
        appends.push(objectToRow(def, obj));
        DB_META.snap.set(obj, json);
      } else if (DB_META.snap.get(obj) !== json) {
        updates.push([rowNum, objectToRow(def, obj)]);
        DB_META.snap.set(obj, json);
      }
    });

    if (appends.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, appends.length, def.columns.length).setValues(appends);
      written += appends.length;
    }
    updates.forEach(function (u) {
      sh.getRange(u[0], 1, 1, def.columns.length).setValues([u[1]]);
      written++;
    });

    /* log 类自动修剪最旧的列 */
    if (def.maxRows) {
      var total = sh.getLastRow() - 1;
      if (total > def.maxRows) sh.deleteRows(2, total - def.maxRows);
    }
  });

  DB_META.writes = written;
  return { written: written };
}

/* -------------------------------------------------------------
   5. 查询助手
   ------------------------------------------------------------- */

function dbInsert(table, obj) {
  DB[table].push(obj);
  var idKey = DB._index[table].key;
  if (obj[idKey]) DB._index[table].map[obj[idKey]] = obj;
  return obj;
}

function dbById(table, id) {
  if (!id) return null;
  return DB._index[table].map[String(id)] || null;
}

function dbFind(table, predicate) {
  var arr = DB[table];
  for (var i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return null;
}

function dbFilter(table, predicate) {
  return DB[table].filter(predicate);
}

/** 最新在前（Sheet 是旧的在上、新的在下，这里反过来给 API 用） */
function dbRecent(table, limit) {
  var arr = DB[table].slice().reverse();
  return limit ? arr.slice(0, limit) : arr;
}

/** ID 序号（存在 Sequences Sheet，重启不会重号） */
function dbNextId(prefix, key, len) {
  DB.seq[key] = (Number(DB.seq[key]) || 0) + 1;
  var row = dbFind('sequences', function (r) { return r.key === key; });
  if (row) row.value = DB.seq[key];
  else dbInsert('sequences', { key: key, value: DB.seq[key] });
  return prefix + pad(DB.seq[key], len || 6);
}

/* -------------------------------------------------------------
   6. Settings
   ------------------------------------------------------------- */

function setting(key, fallback) {
  if (!DB || !DB._settings) return fallback;
  var v = DB._settings[key];
  if (v === undefined || v === null || v === '') return fallback;
  return v;
}

function numSetting(key, fallback) {
  var v = Number(setting(key, fallback));
  return isFinite(v) ? v : fallback;
}

function boolSetting(key, fallback) {
  var v = String(setting(key, fallback ? 'TRUE' : 'FALSE')).toUpperCase();
  return v === 'TRUE' || v === '1' || v === 'YES';
}

function setSetting(key, value) {
  var row = dbFind('settings', function (r) { return r.key === key; });
  if (row) row.value = String(value);
  else dbInsert('settings', { key: key, value: String(value), description: SETTING_DESC[key] || '' });
  DB._settings[key] = String(value);
}

/* -------------------------------------------------------------
   7. 维护工具（在 Apps Script 编辑器里手动执行）
   ------------------------------------------------------------- */

/**
 * ★ 修复「同一个号码重复注册」造成的历史脏资料。
 *
 * 1. 先把所有 Phone 规范化成 E.164（migratePhonesToE164）
 * 2. 同一个号码的多列 → 保留最早注册的那一列为正式帐号
 * 3. 其余列的 Orders / Claims / Rewards / PointTx / WalletTx 全部转到正式帐号
 * 4. 用转帐明细重新算出积分、钱包、累计消费（不是相加，避免重复计算）
 * 5. 重复的列标记 Status = MERGED（保留下来当审计证据，不删除）
 *
 * @param {boolean} dryRun true = 只回报会改什么，不写入
 */
function dedupeCustomers(dryRun) {
  dbLoad();
  try {
    var report = { dryRun: !!dryRun, normalized: 0, groups: [], merged: 0 };

    /* 1) 规范化电话 */
    var norm = migratePhonesE164(true);
    report.normalized = norm.changed.length;

    /* 2) 用「规范化之后」的号码分组（此时还没写入，先算出来） */
    var byPhone = {};
    DB.customers.forEach(function (c) {
      if (c.status === 'MERGED') return;
      var res = normalizePhoneE164(String(c.phone || ''));
      var p = res.ok ? res.phone : ('RAW:' + String(c.phone || '').trim());
      if (!p) return;
      (byPhone[p] = byPhone[p] || []).push(c);
    });

    Object.keys(byPhone).forEach(function (phone) {
      var group = byPhone[phone];
      if (group.length < 2) return;

      group.sort(function (a, b) {
        var ta = new Date(a.createdAt || 0).getTime() || 0;
        var tb = new Date(b.createdAt || 0).getTime() || 0;
        if (ta !== tb) return ta - tb;                 // 最早注册的当正式帐号
        return (b.totalSpend || 0) - (a.totalSpend || 0);
      });

      var keep = group[0];
      var drop = group.slice(1);
      var moved = { orders: 0, claims: 0, rewards: 0, pointTx: 0, walletTx: 0 };

      drop.forEach(function (dup) {
        DB.orders.forEach(function (o) {
          if (o.customerId === dup.customerId) { o.customerId = keep.customerId; moved.orders++; }
        });
        DB.claims.forEach(function (c) {
          if (c.customerId === dup.customerId) { c.customerId = keep.customerId; moved.claims++; }
        });
        DB.rewards.forEach(function (r) {
          if (r.customerId === dup.customerId) { r.customerId = keep.customerId; moved.rewards++; }
        });
        DB.pointTx.forEach(function (t) {
          if (t.customerId === dup.customerId) { t.customerId = keep.customerId; moved.pointTx++; }
        });
        DB.walletTx.forEach(function (t) {
          if (t.customerId === dup.customerId) { t.customerId = keep.customerId; moved.walletTx++; }
        });
        /* 密码：正式帐号还没设密码时，沿用重复列的密码 */
        if (!keep.passwordHash && dup.passwordHash) {
          keep.salt = dup.salt;
          keep.passwordHash = dup.passwordHash;
          keep.passwordSetAt = dup.passwordSetAt || nowISO();
        }
        dup.status = 'MERGED';
      });

      recalcCustomerTotals(keep);
      report.groups.push({
        phone: phone,
        keep: keep.customerId,
        merged: drop.map(function (d) { return d.customerId; }),
        moved: moved,
        after: {
          currentPoints: keep.currentPoints,
          walletBalance: keep.walletBalance,
          totalSpend: keep.totalSpend,
          totalVisits: keep.totalVisits
        }
      });
      report.merged += drop.length;
    });

    if (!dryRun) {
      /* 把规范化后的电话真正写进物件 */
      applyPhoneNormalization();
      dbFlush();
    }
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    dbRelease();
  }
}

/** 依转帐明细重算会员的积分 / 钱包 / 累计消费（合并后使用） */
function recalcCustomerTotals(customer) {
  var id = customer.customerId;
  var points = 0, wallet = 0, spend = 0, visits = 0, rewards = 0;

  DB.pointTx.forEach(function (t) { if (t.customerId === id) points += (Number(t.points) || 0); });
  DB.walletTx.forEach(function (t) { if (t.customerId === id) wallet += (Number(t.amount) || 0); });
  DB.orders.forEach(function (o) {
    if (o.customerId !== id || o.orderStatus === 'CANCELLED') return;
    if (o.claimStatus === 'CLAIMED') {
      spend += (Number(o.billAmount) || 0);
      visits += 1;
    }
  });
  DB.rewards.forEach(function (r) {
    if (r.customerId === id && r.status === 'CLAIMED') rewards += 1;
  });

  customer.currentPoints  = Math.max(0, points);
  customer.walletBalance  = Math.max(0, wallet);
  customer.totalSpend     = spend;
  customer.totalVisits    = visits;
  customer.totalRewards   = rewards;
  customer.membershipTier = computeTier(customer.currentPoints);
  return customer;
}

/** 检查（不写入）：哪些 Phone 不是标准 E.164。呼叫前 DB 必须已载入。 */
function migratePhonesE164(dryRun) {
  dbLoadIfNeeded();
  var changed = [], invalid = [];
  DB.customers.forEach(function (c) {
    var raw = String(c.phone || '');
    var res = normalizePhoneE164(raw);
    if (!res.ok) { invalid.push({ customerId: c.customerId, phone: raw, reason: res.reason }); return; }
    if (res.phone !== raw) {
      changed.push({ customerId: c.customerId, from: raw, to: res.phone });
      if (!dryRun) c.phone = res.phone;
    }
  });
  return { changed: changed, invalid: invalid };
}

/**
 * 独立工具（Apps Script 编辑器执行）：把 Customers.Phone 全部改成 E.164。
 * @param {boolean} dryRun true = 只回报，不写入
 */
function migratePhonesToE164(dryRun) {
  dbLoad();
  try {
    var report = migratePhonesE164(dryRun);
    if (!dryRun) dbFlush();
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    dbRelease();
  }
}

/** 真正写入 E.164 电话（配合 dedupeCustomers 使用） */
function applyPhoneNormalization() {
  DB.customers.forEach(function (c) {
    var res = normalizePhoneE164(String(c.phone || ''));
    if (res.ok) c.phone = res.phone;
  });
}

/** 报表：找出重复的电话号码（MERGED 的列不算） */
function reportDuplicatePhones() {
  dbLoad();
  try {
    var counts = {};
    DB.customers.forEach(function (c) {
      if (c.status === 'MERGED') return;
      var res = normalizePhoneE164(String(c.phone || ''));
      var p = res.ok ? res.phone : ('RAW:' + c.phone);
      counts[p] = (counts[p] || 0) + 1;
    });
    var dups = Object.keys(counts).filter(function (k) { return counts[k] > 1; })
      .map(function (k) { return { phone: k, count: counts[k] }; });
    Logger.log(JSON.stringify(dups, null, 2));
    return dups;
  } finally {
    dbRelease();
  }
}

function dbLoadIfNeeded() {
  if (!DB) dbLoad();
  return DB;
}

/* -------------------------------------------------------------
   8. 促销（setupDatabase 与 Admin 共用）
   ------------------------------------------------------------- */

function promoObject(counter, title, subtitle, description, start, end) {
  counter.seq.promo = (counter.seq.promo || 0) + 1;
  return {
    promotionId: 'PRM' + pad(counter.seq.promo, 4),
    title: title,
    subtitle: subtitle,
    description: description,
    imageUrl: '',
    startDate: start,
    endDate: end,
    minSpend: 0,
    status: 'ACTIVE',
    sortOrder: counter.seq.promo,
    createdAt: nowISO()
  };
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
```

---

## 4. Security.gs

> Apps Script 里的档案名称：**`Security`**（不要打 .gs）
> Session Token、权限（STAFF/MANAGER/OWNER）、Rate Limit、登入锁定 · 108 行 · SHA-256 `3e43f9f65e3fac45`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Security.gs
   -------------------------------------------------------------
   Session · 角色权限 · Rate limit
   （Token 一律只存 SHA-256 hash，资料库里没有明文 token）
   ============================================================= */

/* -------------------------------------------------------------
   1. Session
   ------------------------------------------------------------- */

function createSession(userType, userId) {
  var token = randomToken(32);                      // 64 hex
  var hours = userType === 'STAFF' ? STAFF_SESSION_HOURS : CUSTOMER_SESSION_HOURS;
  dbInsert('sessions', {
    sessionId:  dbNextId('SES', 'session'),
    userType:   userType,
    userId:     userId,
    tokenHash:  sha256(token),
    status:     'ACTIVE',
    createdAt:  nowISO(),
    expiresAt:  new Date(Date.now() + hours * 3600000).toISOString(),
    lastUsedAt: nowISO()
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  var hash = sha256(token);
  var s = dbFind('sessions', function (x) { return x.tokenHash === hash && x.status === 'ACTIVE'; });
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    s.status = 'EXPIRED';
    return null;
  }
  s.lastUsedAt = nowISO();
  return s;
}

function destroySession(token) {
  var hash = sha256(token);
  var s = dbFind('sessions', function (x) { return x.tokenHash === hash; });
  if (s) s.status = 'LOGGED_OUT';
}

function requireCustomer(token) {
  var s = getSession(token);
  if (!s || s.userType !== 'CUSTOMER') return { error: err('INVALID_SESSION') };
  var c = dbById('customers', s.userId);
  if (!c || c.status === 'MERGED') return { error: err('INVALID_SESSION') };
  return { session: s, customer: c };
}

/**
 * @param {string[]} [roles] 需要的角色；空 = 任何在职员工
 */
function requireStaff(token, roles) {
  var s = getSession(token);
  if (!s || s.userType !== 'STAFF') return { error: err('INVALID_SESSION') };
  var st = dbById('staff', s.userId);
  if (!st || st.status !== 'ACTIVE') return { error: err('INVALID_SESSION') };
  if (roles && roles.length && roles.indexOf(st.role) === -1) {
    return { error: err('UNAUTHORIZED', 'Manager or Owner permission required. / 需要经理或老板权限。') };
  }
  return { session: s, staff: st };
}

/* -------------------------------------------------------------
   2. Rate limit（用 CacheService，跨请求有效）
   ------------------------------------------------------------- */

function rateLimitGet(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function rateLimitSet(key, value, ttlSeconds) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(value), Math.min(21600, ttlSeconds)); }
  catch (e) { /* cache 不可用时不阻断流程 */ }
}

function rateLimitClear(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

/**
 * 记录一次失败。回传 true = 已达上限（应拒绝）。
 */
function rateLimitFail(key, maxAttempts, lockSeconds) {
  var rec = rateLimitGet(key) || { count: 0, until: 0 };
  rec.count = (rec.count || 0) + 1;
  var locked = false;
  if (rec.count >= maxAttempts) {
    rec.until = Date.now() + lockSeconds * 1000;
    locked = true;
  }
  rateLimitSet(key, rec, lockSeconds * 2);
  return locked;
}

/** 回传 true = 目前被锁定 */
function rateLimitLocked(key) {
  var rec = rateLimitGet(key);
  return !!(rec && rec.until && Date.now() < rec.until);
}
```

---

## 5. Audit.gs

> Apps Script 里的档案名称：**`Audit`**（不要打 .gs）
> Audit Log 写入与查询（最多保留 5000 条） · 18 行 · SHA-256 `597494d0bfe7915e`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Audit.gs
   所有重要动作都写一条记录（AuditLogs Sheet，最多保留 5000 条）
   ============================================================= */

function audit(userId, userType, action, targetType, targetId, oldValue, newValue) {
  dbInsert('audit', {
    logId:      dbNextId('LOG', 'audit'),
    userId:     userId || '',
    userType:   userType || '',
    action:     action,
    targetType: targetType || '',
    targetId:   targetId || '',
    oldValue:   oldValue === undefined || oldValue === null ? '' : String(oldValue),
    newValue:   newValue === undefined || newValue === null ? '' : String(newValue),
    createdAt:  nowISO()
  });
}
```

---

## 6. Points.gs

> Apps Script 里的档案名称：**`Points`**（不要打 .gs）
> 积分累计 / 等级门槛计算 · 83 行 · SHA-256 `87b01ea7e9deedb2`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Points.gs
   积分 / 等级（Threshold 全部读 Settings，不 hardcode）
   ============================================================= */

function computeTier(points) {
  var gold   = numSetting('GOLD_THRESHOLD', 1500);
  var silver = numSetting('SILVER_THRESHOLD', 500);
  if (points >= gold) return 'GOLD';
  if (points >= silver) return 'SILVER';
  return 'MEMBER';
}

function membershipInfo(customer) {
  var p = Number(customer.currentPoints) || 0;
  var silver = numSetting('SILVER_THRESHOLD', 500);
  var gold   = numSetting('GOLD_THRESHOLD', 1500);
  var tier   = computeTier(p);

  var nextTier = '', pointsToNext = 0, floor = 0, ceiling = 0;
  if (p < silver)       { nextTier = 'SILVER'; floor = 0;      ceiling = silver; }
  else if (p < gold)    { nextTier = 'GOLD';   floor = silver; ceiling = gold;   }
  else                  { nextTier = '';       floor = gold;   ceiling = gold;   }

  pointsToNext = nextTier ? Math.max(0, ceiling - p) : 0;
  var progressPercent = nextTier
    ? Math.min(100, Math.round(((p - floor) / Math.max(1, ceiling - floor)) * 100))
    : 100;

  return {
    tier: tier,
    currentPoints: p,
    nextTier: nextTier,
    pointsToNext: pointsToNext,
    progressPercent: progressPercent,
    thresholds: {
      MEMBER: numSetting('MEMBER_THRESHOLD', 0),
      SILVER: silver,
      GOLD: gold
    },
    lifetimePoints: Number(customer.lifetimePoints) || 0
  };
}

/**
 * 发放 / 扣回积分（正数 = 发放，负数 = 撤销）
 * 余额永远不会低于 0。
 */
function issuePoints(customer, order, points, description, actorId, actorType, type) {
  if (!points) return null;
  var before = Number(customer.currentPoints) || 0;
  var after  = Math.max(0, before + points);

  customer.currentPoints = after;
  if (points > 0) customer.lifetimePoints = (Number(customer.lifetimePoints) || 0) + points;
  customer.membershipTier = computeTier(after);

  dbInsert('pointTx', {
    transactionId: dbNextId('PTS', 'point'),
    customerId:    customer.customerId,
    orderId:       order ? order.orderId : '',
    type:          type || (points >= 0 ? 'EARN' : 'ADJUSTMENT'),
    points:        points,
    balanceBefore: before,
    balanceAfter:  after,
    description:   description || '',
    createdAt:     nowISO(),
    createdBy:     actorId || ''
  });

  audit(actorId, actorType || 'SYSTEM', 'ISSUE_POINTS', 'CUSTOMER',
        customer.customerId, before, after);
  return { before: before, after: after };
}

/** 依 Settings 计算一笔消费应得积分 */
function pointsForAmount(billAmount, walletUsed) {
  var perRm = numSetting('POINTS_PER_RM', 1);
  var basis = setting('POINTS_CALCULATION', 'NET_PAID') === 'GROSS_BILL'
    ? billAmount
    : Math.max(0, billAmount - (walletUsed || 0));
  return Math.floor((basis / 100) * perRm);
}
```

---

## 7. Rewards.gs

> Apps Script 里的档案名称：**`Rewards`**（不要打 .gs）
> 奖励产生与状态流转 · 70 行 · SHA-256 `6002b37eed17c0e4`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Rewards.gs
   奖励只能由后端产生（前端不允许 Math.random）
   每日预算用完 → 停止发放；接近上限 → LOW_REWARD_MODE
   ============================================================= */

function rewardBand(amountSen) {
  var tiers = safeJson(setting('REWARD_TIERS', '[]'), []);
  var hit = null;
  tiers.forEach(function (t) {
    if (!hit && amountSen >= t.min && amountSen <= t.max) hit = t;
  });
  return hit;
}

function rewardsGivenToday() {
  var today = todayKey();
  return dbFilter('rewards', function (r) {
    return r.status !== 'CANCELLED' && isoDateKey(r.createdAt) === today;
  }).reduce(function (sum, r) { return sum + (Number(r.amount) || 0); }, 0);
}

function generateReward(customer, order, amountSen) {
  if (!boolSetting('REWARD_ENABLED', true)) return null;
  if (amountSen < numSetting('REWARD_MIN_SPEND', 30) * 100) return null;

  var band = rewardBand(amountSen);
  if (!band) return null;

  var budget = numSetting('DAILY_REWARD_BUDGET', 50) * 100;
  var used   = rewardsGivenToday();
  var left   = budget - used;
  if (left <= 0) return null;                      // 预算用尽

  var weights = safeJson(setting('REWARD_WEIGHTS', '{"small":70,"medium":25,"big":5}'),
                         { small: 70, medium: 25, big: 5 });
  var small  = Number(weights.small)  || 70;
  var medium = Number(weights.medium) || 25;

  var roll  = Math.random() * 100;
  var range = band.to - band.from;
  var amount;
  if (roll < small) {
    amount = band.from + Math.round(Math.random() * range * 0.30);
  } else if (roll < small + medium) {
    amount = band.from + Math.round(range * 0.30 + Math.random() * range * 0.40);
  } else {
    amount = band.from + Math.round(range * 0.70 + Math.random() * range * 0.30);
  }

  /* 预算接近上限 → LOW_REWARD_MODE（最多 LOW_REWARD_MODE_MAX） */
  if (used + amount > budget * 0.8) {
    amount = Math.min(amount, numSetting('LOW_REWARD_MODE_MAX', 100));
  }
  amount = Math.round(Math.max(10, Math.min(amount, left)));

  var reward = dbInsert('rewards', {
    rewardId:  dbNextId('RWD', 'reward'),
    orderId:   order ? order.orderId : '',
    customerId: customer ? customer.customerId : '',
    amount:    amount,
    status:    'AVAILABLE',
    createdAt: nowISO(),
    expiresAt: new Date(Date.now() + numSetting('REWARD_EXPIRY_DAYS', 7) * 86400000).toISOString(),
    claimedAt: ''
  });

  audit('SYSTEM', 'SYSTEM', 'ISSUE_REWARD', 'REWARD', reward.rewardId, '', amount);
  return reward;
}
```

---

## 8. Wallet.gs

> Apps Script 里的档案名称：**`Wallet`**（不要打 .gs）
> 钱包储值 / 抵扣 / 上限（金额一律 sen） · 180 行 · SHA-256 `aa13c4fabbe0a7fd`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Wallet.gs
   钱包余额只由后端改动，每一笔都留 WalletTx 明细。
   ============================================================= */

/**
 * 加钱（正数）或扣钱（负数）。余额不会低于 0。
 * type: REWARD | REDEEM | MANUAL_ADD | MANUAL_DEDUCT | REFUND | REVERSAL
 */
function walletCredit(customer, order, amountSen, type, description, actorId, actorType) {
  var before = Number(customer.walletBalance) || 0;
  var after  = Math.max(0, before + amountSen);
  customer.walletBalance = after;

  dbInsert('walletTx', {
    transactionId: dbNextId('WLT', 'wallet'),
    customerId:    customer.customerId,
    orderId:       order ? order.orderId : '',
    type:          type,
    amount:        amountSen,
    balanceBefore: before,
    balanceAfter:  after,
    description:   description || '',
    createdAt:     nowISO(),
    createdBy:     actorId || ''
  });

  audit(actorId, actorType || 'SYSTEM',
        type === 'REWARD' ? 'CLAIM_REWARD' : 'WALLET_' + type,
        'CUSTOMER', customer.customerId, before, after);

  return { before: before, after: after };
}

/** 计算这笔账单最多可以用钱包抵扣多少（员工端与会员端共用同一套规则） */
function walletRedemptionPlan(customer, billSen) {
  var percent = numSetting('MAX_WALLET_USAGE_PERCENT', 20);
  var minBill = numSetting('MIN_WALLET_REDEEM_BILL', 30) * 100;
  var wallet  = Number(customer.walletBalance) || 0;

  var capAmount = Math.floor(billSen * percent / 100);
  var maxUsable = Math.min(wallet, capAmount);
  var reason = '', reasonEn = '';

  if (billSen < minBill) {
    reason   = '账单未满 RM' + (minBill / 100).toFixed(2);
    reasonEn = 'bill below minimum RM' + (minBill / 100).toFixed(2);
  } else if (wallet <= 0) {
    reason   = '钱包没有余额';
    reasonEn = 'no wallet balance';
  }

  var usable = billSen < minBill ? 0 : maxUsable;

  return {
    billAmount:    billSen,
    walletBalance: wallet,
    maxPercent:    percent,
    capAmount:     capAmount,
    maxUsable:     maxUsable,
    usableAmount:  usable,
    customerPays:  billSen - usable,
    minBill:       minBill,
    reason:        reason,
    reasonEn:      reasonEn,
    allowed:       billSen >= minBill && usable > 0
  };
}

/* -------------------------------------------------------------
   API：员工端钱包抵扣
   ------------------------------------------------------------- */

function calculateWalletRedemption(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var bill = Math.round(Number(data.billAmount));
  if (!isFinite(bill) || bill <= 0) return err('INVALID_AMOUNT');

  return ok(walletRedemptionPlan(c, bill));
}

/** 员工确认抵扣：扣钱包 → 建立消费记录 → 发积分（NET_PAID） */
function redeemWallet(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var bill      = Math.round(Number(data.billAmount));
  var requested = Math.round(Number(data.walletAmount));
  if (!isFinite(bill) || bill <= 0) return err('INVALID_AMOUNT');
  if (!isFinite(requested) || requested < 0) return err('INVALID_AMOUNT');

  var minBill = numSetting('MIN_WALLET_REDEEM_BILL', 30) * 100;
  var wallet  = Number(c.walletBalance) || 0;

  if (bill < minBill) {
    return err('WALLET_LIMIT_EXCEEDED',
      'Bill must be at least RM' + (minBill / 100).toFixed(2) +
      '. / 账单需满 RM' + (minBill / 100).toFixed(2) + '。');
  }
  if (requested > wallet) return err('INSUFFICIENT_WALLET');

  var cap = Math.floor(bill * numSetting('MAX_WALLET_USAGE_PERCENT', 20) / 100);
  if (requested > cap) return err('WALLET_LIMIT_EXCEEDED');

  var source = String(data.source || 'DIRECT').toUpperCase();
  var externalOrderId = String(data.externalOrderId || '').trim().toUpperCase();
  if (externalOrderId && findOrderByExternal(source, externalOrderId)) {
    return err('DUPLICATE_EXTERNAL_ORDER');
  }

  var order = createMemberTransaction({
    source: source,
    externalOrderId: externalOrderId,
    amount: bill,
    customerId: c.customerId,
    createdBy: ctx.staff.staffId,
    actorType: 'STAFF',
    note: String(data.note || '').slice(0, 200)
  });

  order.walletUsed  = requested;
  order.finalAmount = bill - requested;
  order.claimStatus = 'CLAIMED';
  order.claimedAt   = nowISO();
  order.completedAt = nowISO();

  walletCredit(c, order, -requested, 'REDEEM',
    'Redemption for ' + (externalOrderId || order.orderId), ctx.staff.staffId, 'STAFF');
  audit(ctx.staff.staffId, 'STAFF', 'REDEEM_WALLET', 'ORDER', order.orderId, wallet, wallet - requested);

  var points = pointsForAmount(bill, requested);
  order.pointsEarned = points;

  c.totalSpend  = (Number(c.totalSpend) || 0) + bill;
  c.totalVisits = (Number(c.totalVisits) || 0) + 1;
  c.lastVisitAt = nowISO();
  issuePoints(c, order, points, 'Purchase with wallet redemption', ctx.staff.staffId, 'STAFF', 'EARN');

  var reward = generateReward(c, order, bill);

  return ok({
    orderId: order.orderId,
    billAmount: bill,
    walletUsed: requested,
    customerPays: bill - requested,
    pointsEarned: points,
    customer: publicCustomer(c),
    membership: membershipInfo(c),
    reward: reward ? { rewardId: reward.rewardId, status: reward.status } : null
  });
}

/** 手动加 / 扣钱包（Manager+） */
function manualWalletAdjustment(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var amount = Math.round(Number(data.amount));
  if (!isFinite(amount) || amount === 0) return err('INVALID_AMOUNT');
  if (amount < 0 && Math.abs(amount) > (Number(c.walletBalance) || 0)) return err('INSUFFICIENT_WALLET');

  var reason = String(data.reason || '').slice(0, 200);
  walletCredit(c, null, amount, amount > 0 ? 'MANUAL_ADD' : 'MANUAL_DEDUCT',
               reason || 'Manual adjustment', ctx.staff.staffId, 'STAFF');
  audit(ctx.staff.staffId, 'STAFF', 'MANUAL_WALLET_ADJUST', 'CUSTOMER', c.customerId, '',
        amount + ' | ' + reason);

  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}
```

---

## 9. Customers.gs

> Apps Script 里的档案名称：**`Customers`**（不要打 .gs）
> ★ 查号码 / 注册 / 密码登录 / 改密码 / 会员资料 · 488 行 · SHA-256 `5ce70aedc330eb44`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Customers.gs
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
```

---

## 10. Orders.gs

> Apps Script 里的档案名称：**`Orders`**（不要打 .gs）
> 消费纪录与统计 · 134 行 · SHA-256 `91582268a0a873fe`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Orders.gs
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
    if (pending) pending.status = 'CANCELLED';
  }

  audit(ctx.staff.staffId, 'STAFF', 'CANCEL_ORDER', 'ORDER', order.orderId, 'ACTIVE',
        'CANCELLED: ' + String(data.reason || '').slice(0, 100));
  return ok({ orderId: order.orderId, status: 'CANCELLED' });
}
```

---

## 11. Claims.gs

> Apps Script 里的档案名称：**`Claims`**（不要打 .gs）
> QR / 4 位 Code 认领（只存 token 的 hash） · 395 行 · SHA-256 `86d5ad15a7718205`

```javascript
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
```

---

## 12. Promotions.gs

> Apps Script 里的档案名称：**`Promotions`**（不要打 .gs）
> 优惠规则 · 72 行 · SHA-256 `5034d8b7f55edcfb`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Promotions.gs
   ============================================================= */

/** 会员端：只回传今天有效的活动 */
function getPromotions() {
  var today = todayKey();
  var list = dbFilter('promotions', function (p) {
    return p.status === 'ACTIVE' &&
      (!p.startDate || p.startDate <= today) &&
      (!p.endDate || p.endDate >= today);
  })
  .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
  .map(function (p) {
    return {
      promotionId: p.promotionId, title: p.title, subtitle: p.subtitle,
      description: p.description, imageUrl: p.imageUrl,
      startDate: p.startDate, endDate: p.endDate
    };
  });
  return ok({ promotions: list });
}

function getPromotionsAdmin(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  return ok({ promotions: dbRecent('promotions') });
}

function createPromotion(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var title = String(data.title || '').trim().slice(0, 80);
  if (!title) return err('INVALID_INPUT', 'Title required. / 请填写标题。');

  var p = dbInsert('promotions', {
    promotionId: dbNextId('PRM', 'promo', 4),
    title: title,
    subtitle: String(data.subtitle || '').slice(0, 80),
    description: String(data.description || '').slice(0, 500),
    imageUrl: String(data.imageUrl || '').slice(0, 300),
    startDate: String(data.startDate || '').slice(0, 10),
    endDate: String(data.endDate || '').slice(0, 10),
    minSpend: Math.max(0, Math.round(Number(data.minSpend) || 0)),
    status: String(data.status || 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    sortOrder: dbFilter('promotions', function () { return true; }).length,
    createdAt: nowISO()
  });

  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PROMOTION', 'PROMOTION', p.promotionId, '', title);
  return ok({ promotion: p });
}

function updatePromotion(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('promotions', String(data.promotionId || ''));
  if (!p) return err('INVALID_INPUT', 'Promotion not found. / 找不到活动。');

  var old = p.status;
  if (data.status !== undefined)      p.status = String(data.status) === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (data.title !== undefined)       p.title = String(data.title).slice(0, 80);
  if (data.subtitle !== undefined)    p.subtitle = String(data.subtitle).slice(0, 80);
  if (data.description !== undefined) p.description = String(data.description).slice(0, 500);
  if (data.startDate !== undefined)   p.startDate = String(data.startDate).slice(0, 10);
  if (data.endDate !== undefined)     p.endDate = String(data.endDate).slice(0, 10);

  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PROMOTION', 'PROMOTION', p.promotionId, old, p.status);
  return ok({ promotion: p });
}
```

---

## 13. Admin.gs

> Apps Script 里的档案名称：**`Admin`**（不要打 .gs）
> 员工端：Dashboard、会员查询、手动调整、重设会员密码、设置 · 209 行 · SHA-256 `668612dea354d975`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Admin.gs
   设置 · 积分调整 · Audit Log · 员工账号（Manager / Owner）
   ============================================================= */

function manualPointAdjustment(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var points = Math.round(Number(data.points));
  if (!isFinite(points) || points === 0) return err('INVALID_AMOUNT');
  if (points < 0 && Math.abs(points) > (Number(c.currentPoints) || 0)) {
    return err('INVALID_AMOUNT', 'Adjustment exceeds current points. / 调整超过现有积分。');
  }

  var reason = String(data.reason || '').slice(0, 200);
  var before = Number(c.currentPoints) || 0;
  issuePoints(c, null, points, reason || 'Manual adjustment',
              ctx.staff.staffId, 'STAFF', 'ADJUSTMENT');
  audit(ctx.staff.staffId, 'STAFF', 'POINT_ADJUST', 'CUSTOMER', c.customerId, before,
        c.currentPoints + ' | ' + reason);

  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}

/* -------------------------------------------------------------
   设置
   ------------------------------------------------------------- */

function getSettings(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  var list = DB.settings.map(function (r) {
    return { key: r.key, value: r.value, description: r.description || SETTING_DESC[r.key] || '' };
  });
  return ok({ settings: list });
}

var NUMERIC_SETTINGS = ['POINTS_PER_RM', 'CLAIM_EXPIRY_HOURS', 'REWARD_MIN_SPEND',
  'DAILY_REWARD_BUDGET', 'MAX_WALLET_USAGE_PERCENT', 'MIN_WALLET_REDEEM_BILL',
  'MEMBER_THRESHOLD', 'SILVER_THRESHOLD', 'GOLD_THRESHOLD', 'LOW_REWARD_MODE_MAX',
  'REWARD_EXPIRY_DAYS', 'CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS', 'LOGIN_LOCK_MINUTES'];

function updateSetting(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var key = String(data.key || '');
  var known = DB._settings[key] !== undefined || SETTING_DESC[key] !== undefined;
  if (!known) return err('INVALID_INPUT', 'Unknown setting. / 未知设置。');

  var oldValue = DB._settings[key];
  var value = String(data.value === undefined ? '' : data.value).trim();

  if (NUMERIC_SETTINGS.indexOf(key) !== -1) {
    if (!isFinite(Number(value)) || Number(value) < 0) {
      return err('INVALID_INPUT', 'Must be a number. / 必须是数字。');
    }
  }
  if (key === 'REWARD_ENABLED' && ['TRUE', 'FALSE'].indexOf(value.toUpperCase()) === -1) {
    return err('INVALID_INPUT', 'Must be TRUE or FALSE.');
  }
  if (key === 'ALLOWED_COUNTRY_CODES') {
    var codes = value.split(',').map(function (c) { return c.replace(/[^0-9]/g, ''); })
      .filter(function (c) { return c.length > 0; });
    if (!codes.length) return err('INVALID_INPUT', 'At least one country code. / 至少填一个国家码。');
    value = codes.join(',');
  }

  setSetting(key, value);
  audit(ctx.staff.staffId, 'STAFF', 'SETTINGS_CHANGE', 'SETTING', key, oldValue, value);
  return ok({ key: key, value: value });
}

/* -------------------------------------------------------------
   Audit Log
   ------------------------------------------------------------- */

function getAuditLogs(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var limit  = Math.min(500, Math.max(1, Number(data.limit) || 100));
  var action = String(data.action || '');
  var userId = String(data.userId || '');

  var list = dbRecent('audit');
  if (action) list = list.filter(function (l) { return l.action === action; });
  if (userId) list = list.filter(function (l) { return l.userId === userId; });

  return ok({ logs: list.slice(0, limit) });
}

/* -------------------------------------------------------------
   员工账号（Owner）
   ------------------------------------------------------------- */

function listStaff(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;
  return ok({
    staff: DB.staff.map(function (s) {
      return {
        staffId: s.staffId, username: s.username, role: s.role,
        status: s.status, lastLogin: s.lastLogin, createdAt: s.createdAt
      };
    })
  });
}

function createStaff(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var username = String(data.username || '').trim().toLowerCase();
  var password = String(data.password || '');
  var role = String(data.role || 'STAFF').toUpperCase();

  if (username.length < 3) return err('INVALID_INPUT', 'Username too short. / 账号太短。');
  if (password.length < 8) return err('INVALID_INPUT', 'Password min 8 chars. / 密码至少 8 位。');
  if (['OWNER', 'MANAGER', 'STAFF'].indexOf(role) === -1) return err('INVALID_ROLE');
  if (dbFind('staff', function (s) { return String(s.username).toLowerCase() === username; })) {
    return err('USERNAME_TAKEN');
  }

  var salt = randomToken(8);
  var s = dbInsert('staff', {
    staffId: dbNextId('STF', 'staff', 4),
    username: username,
    salt: salt,
    passwordHash: hashPassword(password, salt),
    role: role,
    status: 'ACTIVE',
    lastLogin: '',
    createdAt: nowISO()
  });
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_STAFF', 'STAFF', s.staffId, '', username + '/' + role);
  return ok({ staffId: s.staffId, username: s.username, role: s.role });
}

function setStaffStatus(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var s = dbById('staff', String(data.staffId || ''));
  if (!s) return err('STAFF_NOT_FOUND');
  if (s.role === 'OWNER' && s.staffId === ctx.staff.staffId) {
    return err('INVALID_INPUT', 'You cannot disable your own owner account. / 不能停用自己的老板账号。');
  }

  var old = s.status;
  s.status = String(data.status) === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
  if (s.status === 'DISABLED') {
    dbFilter('sessions', function (x) { return x.userId === s.staffId && x.status === 'ACTIVE'; })
      .forEach(function (x) { x.status = 'LOGGED_OUT'; });
  }
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_STAFF', 'STAFF', s.staffId, old, s.status);
  return ok({ staffId: s.staffId, status: s.status });
}

function resetStaffPassword(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var s = dbById('staff', String(data.staffId || ''));
  if (!s) return err('STAFF_NOT_FOUND');
  var password = String(data.password || '');
  if (password.length < 8) return err('INVALID_INPUT', 'Password min 8 chars. / 密码至少 8 位。');

  s.salt = randomToken(8);
  s.passwordHash = hashPassword(password, s.salt);
  dbFilter('sessions', function (x) { return x.userId === s.staffId && x.status === 'ACTIVE'; })
    .forEach(function (x) { x.status = 'LOGGED_OUT'; });
  audit(ctx.staff.staffId, 'STAFF', 'RESET_PASSWORD', 'STAFF', s.staffId, '', '');
  return ok({ staffId: s.staffId });
}

/* -------------------------------------------------------------
   会员密码（员工协助重设）
   -------------------------------------------------------------
   会员忘记密码、或号码被别人先注册时，由 Manager / Owner 在这里重设。
   重设之后该会员的所有 session 会立刻失效，必须用新密码重新登录。
   ------------------------------------------------------------- */

function resetCustomerPassword(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var password = String(data.password || '');
  var minLen = numSetting('CUSTOMER_PASSWORD_MIN', 8);
  if (password.length < minLen) {
    return err('PASSWORD_TOO_SHORT',
      'Password min ' + minLen + ' chars. / 密码至少 ' + minLen + ' 位。');
  }

  setPassword(c, password);
  dbFilter('sessions', function (x) {
    return x.userId === c.customerId && x.userType === 'CUSTOMER' && x.status === 'ACTIVE';
  }).forEach(function (x) { x.status = 'LOGGED_OUT'; });

  audit(ctx.staff.staffId, 'STAFF', 'RESET_CUSTOMER_PASSWORD', 'CUSTOMER', c.customerId, '', '');
  return ok({ customerId: c.customerId, passwordReset: true });
}
```

---

## 14. Auth.gs

> Apps Script 里的档案名称：**`Auth`**（不要打 .gs）
> ping / getPublicSettings / staffLogin / staffLogout · 89 行 · SHA-256 `02c0d70a4595e296`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Auth.gs
   -------------------------------------------------------------
   系统 ping · 员工登录（Salted Hash + 失败锁定）
   会员登录在 Customers.gs（因为要处理「同一个号码只注册一次」）
   ============================================================= */

function ping() {
  return ok({
    app: 'YETIPSY MINI APP',
    version: APP_VERSION,
    mode: 'PRODUCTION',
    backend: 'GOOGLE_APPS_SCRIPT',
    storage: 'GOOGLE_SHEETS',
    serverTime: nowISO(),
    timezone: timezone(),
    auth: 'PHONE_PASSWORD'
  });
}

function getPublicSettings() {
  return ok({
    barName: setting('BAR_NAME', 'Yetipsy'),
    currency: setting('CURRENCY', 'MYR'),
    timezone: timezone(),
    auth: 'PHONE_PASSWORD',
    passwordMinLength: numSetting('CUSTOMER_PASSWORD_MIN', 8),
    allowedCountryCodes: String(setting('ALLOWED_COUNTRY_CODES', '60,65'))
      .split(',').map(function (c) { return '+' + c.trim(); })
  });
}

/* -------------------------------------------------------------
   员工登录
   ------------------------------------------------------------- */

function staffLogin(data) {
  var username = String(data.username || '').trim().toLowerCase();
  var password = String(data.password || '');
  if (!username || !password) {
    return err('UNAUTHORIZED', 'Invalid username or password. / 账号或密码错误。');
  }

  var key = 'stafflogin:' + username;
  if (rateLimitLocked(key)) return err('RATE_LIMITED');

  var staff = dbFind('staff', function (s) { return String(s.username).toLowerCase() === username; });

  if (!staff || staff.status !== 'ACTIVE' ||
      staff.passwordHash !== hashPassword(password, staff.salt)) {
    rateLimitFail(key, 6, 300);                     // 6 次失败 → 锁 5 分钟
    audit(username, 'STAFF', 'LOGIN_FAILED', 'STAFF', username, '', '');
    return err('UNAUTHORIZED', 'Invalid username or password. / 账号或密码错误。');
  }

  rateLimitClear(key);
  staff.lastLogin = nowISO();
  var token = createSession('STAFF', staff.staffId);
  audit(staff.staffId, 'STAFF', 'LOGIN', 'STAFF', staff.staffId, '', staff.role);

  return ok({
    token: token,
    staff: {
      staffId: staff.staffId,
      username: staff.username,
      role: staff.role,
      name: staff.username
    }
  });
}

function staffLogout(data, token) {
  var ctx = requireStaff(token);
  if (!ctx.error) audit(ctx.staff.staffId, 'STAFF', 'LOGOUT', 'STAFF', ctx.staff.staffId, '', '');
  destroySession(token);
  return ok({ loggedOut: true });
}

function getStaffSession(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  return ok({
    staff: {
      staffId: ctx.staff.staffId,
      username: ctx.staff.username,
      role: ctx.staff.role
    }
  });
}
```

---

## 15. Code.gs

> Apps Script 里的档案名称：**`Code`**（不要打 .gs）
> ★ 唯一入口 doPost()：action 白名单、参数解析、错误包装 · 190 行 · SHA-256 `1ade1f1cf422135d`

```javascript
/* =============================================================
   YETIPSY MINI APP 1.3 — Code.gs
   -------------------------------------------------------------
   Web App 入口。

   前端（js/api.js）一律 POST：
     { action: 'claimOrder', data: {...}, token: 'session token' }
   后端一律回：
     { success: true,  data: {...}, error: null }
     { success: false, data: null,  error: { code, message } }

   部署方式见 DEPLOYMENT.md（推荐用 GitHub Actions + clasp 自动推送）。
   ============================================================= */

/** 不需要 session 的 action（其余一律要 token） */
var PUBLIC_ACTIONS = [
  'ping', 'getPublicSettings',
  'checkCustomerPhone', 'customerRegister', 'customerLogin',
  'customerSetFirstPassword', 'customerLogout',
  'staffLogin'
];

/** action → 处理函数（函数都在同专案的其他 .gs 档里） */
function getHandlers() {
  return {
    /* 系统 */
    ping: ping,
    getPublicSettings: getPublicSettings,

    /* 会员（手机号码 + 密码） */
    checkCustomerPhone: checkCustomerPhone,
    customerRegister: customerRegister,
    customerLogin: customerLogin,
    customerSetFirstPassword: customerSetFirstPassword,
    changeCustomerPassword: changeCustomerPassword,
    customerLogout: customerLogout,
    getProfile: getProfile,
    updateProfile: updateProfile,
    getMembership: getMembership,
    getPoints: getPoints,
    getPointHistory: getPointHistory,
    getWallet: getWallet,
    getWalletHistory: getWalletHistory,
    getPromotions: getPromotions,
    getOrderHistory: getOrderHistory,
    getClaimByToken: getClaimByToken,
    getClaimByCode: getClaimByCode,
    claimOrder: claimOrder,
    getPendingReward: getPendingReward,
    claimReward: claimReward,

    /* 员工 */
    staffLogin: staffLogin,
    staffLogout: staffLogout,
    getStaffSession: getStaffSession,
    getDashboard: getDashboard,
    createClaim: createClaim,
    cancelClaim: cancelClaim,
    getClaim: getClaim,
    listClaims: listClaims,
    searchCustomer: searchCustomer,
    getCustomer: getCustomer,
    getCustomerHistory: getCustomerHistory,
    calculateWalletRedemption: calculateWalletRedemption,
    redeemWallet: redeemWallet,
    getOrders: getOrders,
    cancelOrder: cancelOrder,

    /* Manager / Owner */
    manualWalletAdjustment: manualWalletAdjustment,
    manualPointAdjustment: manualPointAdjustment,
    resetCustomerPassword: resetCustomerPassword,
    getSettings: getSettings,
    updateSetting: updateSetting,
    getPromotionsAdmin: getPromotionsAdmin,
    createPromotion: createPromotion,
    updatePromotion: updatePromotion,
    getAuditLogs: getAuditLogs,
    listStaff: listStaff,
    createStaff: createStaff,
    setStaffStatus: setStaffStatus,
    resetStaffPassword: resetStaffPassword
  };
}

/* -------------------------------------------------------------
   Web App 入口
   ------------------------------------------------------------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(30000);
    if (!locked) {
      return jsonResponse(fail('SERVER_BUSY',
        'Server is busy, please try again. / 伺服器忙碌中，请重试。'));
    }

    var payload = parsePayload(e);
    var result = dispatch(payload);

    dbFlush();                      // 只写有变动的列
    return jsonResponse(result);

  } catch (error) {
    try { dbFlush(); } catch (ignored) {}
    logError('doPost', error);
    return jsonResponse(fail('INTERNAL_ERROR',
      'Internal error: ' + (error && error.message ? error.message : 'unknown')));
  } finally {
    if (locked) lock.releaseLock();
    dbRelease();
  }
}

/** 浏览器直接打开 URL 时显示系统状态（方便确认部署成功） */
function doGet() {
  try {
    dbLoad();
    var info = ping();
    dbFlush();
    return jsonResponse(info);
  } catch (error) {
    return jsonResponse(fail('SETUP_REQUIRED', error.message || String(error)));
  } finally {
    dbRelease();
  }
}

/* -------------------------------------------------------------
   分派
   ------------------------------------------------------------- */

function parsePayload(e) {
  var raw = '';
  if (e && e.postData && e.postData.contents) raw = e.postData.contents;
  else if (e && e.parameter && e.parameter.payload) raw = e.parameter.payload;

  if (!raw) {
    if (e && e.parameter && e.parameter.action) {
      return { action: e.parameter.action, data: e.parameter, token: '' };
    }
    return { action: '', data: {}, token: '' };
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { action: '', data: {}, token: '', parseError: true };
  }
  return {
    action: String(parsed.action || ''),
    data: parsed.data || {},
    token: String(parsed.token || '')
  };
}

function dispatch(payload) {
  if (payload.parseError) {
    return err('INVALID_INPUT', 'Request body is not valid JSON. / 请求内容不是有效的 JSON。');
  }

  var handlers = getHandlers();
  var fn = handlers[payload.action];
  if (!fn) return err('UNKNOWN_ACTION', 'Unknown action: ' + payload.action);

  /* 非公开 action 一律要带 token（各 handler 内部还会再验证一次） */
  if (PUBLIC_ACTIONS.indexOf(payload.action) === -1 && !payload.token) {
    return err('INVALID_SESSION');
  }

  dbLoad();
  return fn(payload.data, payload.token) || ok({});
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError(where, error) {
  try {
    console.error('[YETIPSY] ' + where + ': ' + (error && error.stack ? error.stack : error));
  } catch (e) {
    Logger.log('[YETIPSY] ' + where + ': ' + error);
  }
}
```

---

## 贴完之后

| 要做的事 | 怎么做 |
|---|---|
| 建立资料库 | 选 `Database` 档案 → 执行 `setupDatabase()`（可重复执行，不会清资料；少了栏位会自动补） |
| 建立老板帐号 | 执行 `bootstrapOwner()` → 用 `owner` / `yetipsy123` 登录员工端，**进去马上改密码** |
| 部署成 Web App | **部署 → 新增部署 → 网页应用程序** → 执行身分选「我」→ 存取权限「所有人」→ 复制 `/exec` 网址 |
| 前端接上 | 把那个 `/exec` 网址填进 repo 的 `js/config.js` 的 `API_URL`，push 到 GitHub |
| 检查有没有重复会员 | 执行 `reportDuplicatePhones()`（只看不改）→ 确认没问题再 `dedupeCustomers(true)`（预演）→ `dedupeCustomers(false)`（真的合并） |

### 会员登录规则（这版）

```
① 输入手机号码 → checkCustomerPhone
      ├── 没重复 → ② 设密码注册（customerRegister）
      └── 重复了 → ③ 输入密码（customerLogin）
                     └ 旧会员还没设过密码 → 第一次设密码（customerSetFirstPassword）
```

可调的设定（员工端 SETTINGS 或 `Settings` 分页）：

| Key | 预设 | 说明 |
|---|---|---|
| `CUSTOMER_PASSWORD_MIN` | `8` | 会员密码最少字符 |
| `LOGIN_MAX_ATTEMPTS` | `6` | 连续输错几次就锁定 |
| `LOGIN_LOCK_MINUTES` | `5` | 锁定几分钟 |
| `PASSWORD_SELFSERVICE_SETUP` | `TRUE` | 旧会员可否自己补设密码；**都补完后建议改 `FALSE`** |

- 密码存 Salted SHA-256（`Customers` 表的 `Salt` / `PasswordHash` 栏），Sheet 里看不到明文。
- 会员自己改密码：会员端 `我的 → 登录密码`。
- 会员忘记密码：员工端 `MEMBERS → RESET PASSWORD`（Manager / Owner）。

### 忘记贴了哪一个？

执行任何功能时报 `ReferenceError: xxx is not defined`，
`xxx` 就是少贴的那个档案里的函数名 —— 对照上面的表补上即可。
