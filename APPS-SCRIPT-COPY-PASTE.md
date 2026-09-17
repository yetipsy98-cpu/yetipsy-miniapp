# YETIPSY · Google Apps Script 全部档案（复制贴上用）

**18 个档案 · 版本 1.4.0 · 会员登录 = 手机号码 + 密码（不用 WhatsApp OTP）**

> 这份文件由 `node demo/build-copypaste.js` 从 `apps-script/*.gs` 产生。
> 改了后端记得重跑，`npm test` 会检查两者是否同步。

---

## 怎么用这个档案

1. 打开 <https://script.google.com>，建立（或打开）你的 Apps Script 专案。
2. 预设会有一个 `Code.gs` → 点它右边三个点 → **删除**（下面第 18 个会取代它）。
3. 依照下表顺序新增 18 个档案：点 **+ → 指令码（Script）**，
   输入名称时**不要**打 `.gs`（例如输入 `Config`，不是 `Config.gs`）。
4. 在下面的每一节里，复制那个代码框里的**全部内容**，贴到对应的档案里
   （档案里已经有内容的话，先 Ctrl+A 全选删掉再贴）。
5. 每个档案贴完按 **💾 储存**（Ctrl+S）。
6. 全部贴完 → 选 `Database` 档案 → 执行 `setupDatabase()`
   → 授权（进阶 → 前往专案 → 允许）→ 再执行一次 `bootstrapOwner()`。
7. 回 Google Sheet 看是否出现 **17 个分页**：`Settings` `Sequences` `Customers` `Staff` `Sessions` `Orders` `Claims` `Rewards` `PointTx` `WalletTx` `Promotions` `Categories` `Products` `ProductOptions` `AppOrders` `OrderItems` `AuditLogs`。
8. **已经在跑 1.x 的老板看这里**：不要重跑 `setupDatabase()`，
   改执行 `upgradeToV2({ backup: true })` —— 它只会补建 2.0 的 5 张表
   （`Categories` `Products` `ProductOptions` `AppOrders` `OrderItems`）
   和 12 个新设定，**既有会员 / 积分 / 钱包 / Claim 一列都不会动**。
   想看升级状态就执行 `reportUpgradeStatus()`。

| 顺序 | Apps Script 里的档案名 | 行数 | 内容 |
|---|---|---|---|
| 1 | `Config` | 460 | 所有设定与 17 张表的栏位定义（要改规则就改这里） |
| 2 | `Utils` | 247 | 公用工具：E.164 电话正规化、错误码、日期、JSON 回应 |
| 3 | `Database` | 770 | setupDatabase()、upgradeToV2()、补栏位、防重复注册工具、dedupeCustomers() |
| 4 | `Security` | 108 | Session Token、权限（STAFF/MANAGER/OWNER）、Rate Limit、登入锁定 |
| 5 | `Audit` | 18 | Audit Log 写入与查询（最多保留 5000 条） |
| 6 | `Points` | 83 | 积分累计 / 等级门槛计算 |
| 7 | `Rewards` | 70 | 奖励产生与状态流转 |
| 8 | `Wallet` | 187 | 钱包储值 / 抵扣 / 上限（金额一律 sen） |
| 9 | `Customers` | 595 | ★ 查号码 / 注册 / 密码登录 / 改密码 / 会员资料 |
| 10 | `Orders` | 134 | 消费纪录与统计 |
| 11 | `Menu` | 721 | ★ 2.0 酒单：分类 / 商品 / 规格、促销价、售罄、菜单缓存（upgradeToV2() 后才用得到） |
| 12 | `Checkout` | 330 | ★ 2.0 结帐报价：后端重算价格、钱包上限、Quote 5 分钟有效期、防重复下单的识别码 |
| 13 | `AppOrders` | 370 | ★ 2.0 订单：placeOrder（幂等）、订单查询、取消、再点一次、名称与单价快照 |
| 14 | `Claims` | 395 | QR / 4 位 Code 认领（只存 token 的 hash） |
| 15 | `Promotions` | 154 | 优惠规则 |
| 16 | `Admin` | 209 | 员工端：Dashboard、会员查询、手动调整、重设会员密码、设置 |
| 17 | `Auth` | 89 | ping / getPublicSettings / staffLogin / staffLogout |
| 18 | `Code` | 219 | ★ 唯一入口 doPost()：action 白名单、参数解析、错误包装 |

> ⚠️ **18 个档案全部贴完再执行**，少一个会报 `xxx is not defined`。

---

## 1. Config.gs

> Apps Script 里的档案名称：**`Config`**（不要打 .gs）
> 所有设定与 17 张表的栏位定义（要改规则就改这里） · 460 行 · SHA-256 `9dfd2dd6318b69e9`

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
var APP_VERSION = '1.4.0';

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

  /* ============ 2.0 点单系统（新增，不动 1.x 任何表）============ */

  categories: {                              // 酒单分类（§27，后台可改，不 Hardcode）
    sheet: 'Categories',
    v2: true,          // 2.0 新增：Sheet 还没建时当空表，不影响 1.x
    maxRows: 0,
    columns: [
      ['categoryId', 'CategoryID', 's'],
      ['nameEN',     'NameEN',     's'],
      ['nameZH',     'NameZH',     's'],
      ['status',     'Status',     's'],     // ACTIVE / INACTIVE
      ['sortOrder',  'SortOrder',  'n'],
      ['createdAt',  'CreatedAt',  's'],
      ['updatedAt',  'UpdatedAt',  's']
    ]
  },

  products: {                                // 商品（§26；图片只存 URL §33）
    sheet: 'Products',
    v2: true,          // 2.0 新增：Sheet 还没建时当空表，不影响 1.x
    maxRows: 0,
    columns: [
      ['productId',        'ProductID',        's'],
      ['categoryId',       'CategoryID',       's'],
      ['nameEN',           'NameEN',           's'],
      ['nameZH',           'NameZH',           's'],
      ['descriptionEN',    'DescriptionEN',    's'],
      ['descriptionZH',    'DescriptionZH',    's'],
      ['priceSen',         'PriceSen',         'n'],   // 分为单位；Backend 唯一价格来源（§41）
      ['originalPriceSen', 'OriginalPriceSen', 'n'],   // 促销前原价（§40）
      ['promoPriceSen',    'PromoPriceSen',    'n'],
      ['promoStart',       'PromoStart',       's'],
      ['promoEnd',         'PromoEnd',         's'],
      ['tags',             'Tags',             's'],   // refreshing,citrus,mint（§35）
      ['strength',         'Strength',         's'],   // LIGHT / MEDIUM / STRONG（§36，可空）
      ['imageURL',         'ImageURL',         's'],   // GitHub /assets/menu/*.webp
      ['status',           'Status',           's'],   // ACTIVE / ARCHIVED
      ['available',        'Available',        's'],   // TRUE / FALSE = SOLD OUT（§31）
      ['sortOrder',        'SortOrder',        'n'],
      ['createdAt',        'CreatedAt',        's'],
      ['updatedAt',        'UpdatedAt',        's']
    ]
  },

  productOptions: {                          // Size / ICE / SWEETNESS（§8，不写死）
    sheet: 'ProductOptions',
    v2: true,          // 2.0 新增：Sheet 还没建时当空表，不影响 1.x
    maxRows: 0,
    columns: [
      ['optionId',           'OptionID',           's'],
      ['productId',          'ProductID',          's'],
      ['optionGroup',        'OptionGroup',        's'],   // SIZE / ICE / SWEETNESS / EXTRA
      ['optionGroupNameEN',  'OptionGroupNameEN',  's'],
      ['optionGroupNameZH',  'OptionGroupNameZH',  's'],
      ['nameEN',             'NameEN',             's'],
      ['nameZH',             'NameZH',             's'],
      ['priceAdjustmentSen', 'PriceAdjustmentSen', 'n'],   // 加价（分），0 = 不加价
      ['required',           'Required',           's'],   // TRUE = 必选
      ['status',             'Status',             's'],
      ['sortOrder',          'SortOrder',          'n'],
      ['createdAt',          'CreatedAt',          's'],
      ['updatedAt',          'UpdatedAt',          's']
    ]
  },

  appOrders: {                               // 点单订单主表（§29，与 1.x Orders 分开）
    sheet: 'AppOrders',
    v2: true,          // 2.0 新增：Sheet 还没建时当空表，不影响 1.x
    maxRows: 0,
    columns: [
      ['appOrderId',         'AppOrderID',         's'],
      ['orderNumber',        'OrderNumber',        's'],   // 显示用 YT260917001（§45）
      ['customerId',         'CustomerID',         's'],
      ['orderType',          'OrderType',          's'],   // TABLE / TAKEAWAY / COUNTER
      ['tableNumber',        'TableNumber',        's'],
      ['itemCount',          'ItemCount',          'n'],
      ['subtotalSen',        'SubtotalSen',        'n'],   // Backend 自己算（§41）
      ['walletRequestedSen', 'WalletRequestedSen', 'n'],   // Cart 阶段只是「要求」（§10）
      ['walletUsedSen',      'WalletUsedSen',      'n'],   // 真正扣掉才写（§54）
      ['discountSen',        'DiscountSen',        'n'],
      ['finalAmountSen',     'FinalAmountSen',     'n'],
      ['pointsEarned',       'PointsEarned',       'n'],
      ['orderStatus',        'OrderStatus',        's'],   // SUBMITTED→CONFIRMED→PREPARING→READY→COMPLETED/CANCELLED
      ['paymentMethod',      'PaymentMethod',      's'],   // COUNTER/CASH/DUITNOW/CARD/FOODCOURT/ONLINE
      ['paymentStatus',      'PaymentStatus',      's'],   // UNPAID/PENDING/PAID/REFUNDED/FAILED
      ['paymentReference',   'PaymentReference',   's'],
      ['quoteToken',         'QuoteToken',         's'],   // 对应 Checkout Quote（§43）
      ['idempotencyKey',     'IdempotencyKey',     's'],   // 防重复下单（§44）
      ['customerNote',       'CustomerNote',       's'],
      ['channel',            'Channel',            's'],   // YETIPSY_APP（§51 通路分析）
      ['ordersTxId',         'OrdersTxID',         's'],   // 完成后回写 1.x Orders 的纪录 ID
      ['handledBy',          'HandledBy',          's'],
      ['createdAt',          'CreatedAt',          's'],
      ['confirmedAt',        'ConfirmedAt',        's'],
      ['readyAt',            'ReadyAt',            's'],
      ['completedAt',        'CompletedAt',        's'],
      ['cancelledAt',        'CancelledAt',        's'],
      ['cancelledBy',        'CancelledBy',        's'],
      ['cancelReason',       'CancelReason',       's'],
      ['updatedAt',          'UpdatedAt',          's']
    ]
  },

  orderItems: {                              // 订单明细（§30，必须快照名称与单价）
    sheet: 'OrderItems',
    v2: true,          // 2.0 新增：Sheet 还没建时当空表，不影响 1.x
    maxRows: 0,
    columns: [
      ['orderItemId',         'OrderItemID',         's'],
      ['appOrderId',          'AppOrderID',          's'],
      ['productId',           'ProductID',           's'],
      ['productNameSnapshot', 'ProductNameSnapshot', 's'],  // 下单当时的名称（§30）
      ['unitPriceSen',        'UnitPriceSen',        'n'],  // 下单当时的单价（§30）
      ['quantity',            'Quantity',            'n'],
      ['optionsJSON',         'OptionsJSON',         's'],  // 选了哪些规格
      ['optionsPriceSen',     'OptionsPriceSen',     'n'],  // 规格加价合计
      ['lineTotalSen',        'LineTotalSen',        'n'],
      ['customerNote',        'CustomerNote',        's'],
      ['createdAt',           'CreatedAt',           's']
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

    /* 会员条码（员工扫码验证身分后才允许抵扣） */
    MEMBER_CODE_SECONDS: '60',            // 会员端条码多久换一次（秒）
    MEMBER_VERIFY_SECONDS: '180',         // 员工扫到后，几分钟内必须完成抵扣
    REQUIRE_MEMBER_CODE_SCAN: 'TRUE',     // TRUE = 抵扣前必须扫会员条码

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
    MIN_WALLET_REDEEM_BILL:   '30',

    /* ===== 2.0 点单系统（§63）===== */
    ORDERING_ENABLED:              'TRUE',   // FALSE = 顾客端不能下单
    ORDERING_PAUSED:               'FALSE',  // 员工紧急暂停接单（§64/§65）
    ORDERING_OPEN_TIME:            '18:30',  // 点单开放 HH:MM
    ORDERING_CLOSE_TIME:           '00:00',
    ALLOW_PICKUP:                  'TRUE',   // 允许 COUNTER PICKUP（§11）
    ALLOW_TABLE_ORDER:             'TRUE',   // 允许填桌号
    MAX_ORDER_ITEMS:               '20',     // 单张订单最多几项
    VISIT_SESSION_HOURS:           '6',      // 6 小时内多张订单算 1 次到店（§56）
    ORDER_POLL_SECONDS:            '8',      // 员工看板轮询（§46，不要 1 秒）
    CUSTOMER_ORDER_POLL_SECONDS:   '12',     // 顾客订单页轮询（§47）
    CHECKOUT_QUOTE_EXPIRY_MINUTES: '5',      // Checkout Quote 有效期（§43）
    MENU_CACHE_SECONDS:            '120'     // 菜单缓存（§82；钱包/余额绝不缓存）
  };
}

/** 设置说明（员工端 Settings 页面会显示） */
var SETTING_DESC = {
  BAR_NAME:                 'Bar name / 品牌名称',
  CURRENCY:                 'Currency / 货币',
  TIMEZONE:                 'Timezone / 时区',
  MEMBER_CODE_SECONDS:      'Member code rotates every (sec) / 会员条码几秒换一次',
  MEMBER_VERIFY_SECONDS:    'Scan verify valid (sec) / 扫码验证有效秒数',
  REQUIRE_MEMBER_CODE_SCAN: 'Scan member code before redeem / 抵扣前必须扫会员条码',
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
  MIN_WALLET_REDEEM_BILL:   'Min bill for redemption (RM) / 最低抵扣账单',

  /* 2.0 点单系统 */
  ORDERING_ENABLED:              'Ordering enabled / 是否开放点单',
  ORDERING_PAUSED:               'Orders paused by staff / 员工暂停接单',
  ORDERING_OPEN_TIME:            'Ordering opens (HH:MM) / 点单开始时间',
  ORDERING_CLOSE_TIME:           'Ordering closes (HH:MM) / 点单结束时间',
  ALLOW_PICKUP:                  'Allow counter pickup / 允许柜台自取',
  ALLOW_TABLE_ORDER:             'Allow table orders / 允许桌号点单',
  MAX_ORDER_ITEMS:               'Max items per order / 单张订单上限',
  VISIT_SESSION_HOURS:           'Hours counted as one visit / 几小时内算同一次到店',
  ORDER_POLL_SECONDS:            'Staff polling seconds / 员工看板刷新秒数',
  CUSTOMER_ORDER_POLL_SECONDS:   'Customer polling seconds / 顾客订单刷新秒数',
  CHECKOUT_QUOTE_EXPIRY_MINUTES: 'Quote valid minutes / 结帐报价有效分钟',
  MENU_CACHE_SECONDS:            'Menu cache seconds / 菜单缓存秒数'
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
> 公用工具：E.164 电话正规化、错误码、日期、JSON 回应 · 247 行 · SHA-256 `6a0fefa697d55715`

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
  MEMBER_CODE_INVALID:     ['MEMBER_CODE_INVALID', 'This member code is not valid. / 这个会员条码无效。'],
  MEMBER_CODE_EXPIRED:     ['MEMBER_CODE_EXPIRED', 'Member code expired, please refresh. / 会员条码已过期，请顾客刷新后重扫。'],
  MEMBER_VERIFY_REQUIRED:  ['MEMBER_VERIFY_REQUIRED', 'Scan the customer barcode first. / 请先扫描顾客的会员条码。'],
  MEMBER_VERIFY_EXPIRED:   ['MEMBER_VERIFY_EXPIRED', 'Verification expired, scan again. / 验证已过期，请重新扫描顾客条码。'],
  MEMBER_VERIFY_MISMATCH:  ['MEMBER_VERIFY_MISMATCH', 'Verification is for another customer or staff. / 这个验证属于别的顾客或员工。'],
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
  BUSY:                    ['BUSY', 'System is busy. Please try again. / 系统忙碌中，请稍后再试。'],

  /* 2.0 点单系统 */
  UPGRADE_REQUIRED:        ['UPGRADE_REQUIRED', 'Run upgradeToV2() in Apps Script first. / 请先在 Apps Script 执行 upgradeToV2()。'],
  ORDERING_CLOSED:         ['ORDERING_CLOSED', 'Ordering is closed now. / 目前不在点单时间。'],
  ORDERING_PAUSED:         ['ORDERING_PAUSED', 'Orders are temporarily paused. / 目前暂停接单。'],
  MENU_EMPTY:              ['MENU_EMPTY', 'Menu is not set up yet. / 酒单尚未建立。'],
  PRODUCT_NOT_FOUND:       ['PRODUCT_NOT_FOUND', 'Product not found. / 找不到这个商品。'],
  PRODUCT_UNAVAILABLE:     ['PRODUCT_UNAVAILABLE', 'This item is sold out. / 这个商品已售完。'],
  CATEGORY_NOT_FOUND:      ['CATEGORY_NOT_FOUND', 'Category not found. / 找不到这个分类。'],
  OPTION_NOT_FOUND:        ['OPTION_NOT_FOUND', 'Product option not found. / 找不到这个规格。'],
  OPTION_REQUIRED:         ['OPTION_REQUIRED', 'Please choose a required option. / 请选择必选规格。'],
  INVALID_QUANTITY:        ['INVALID_QUANTITY', 'Invalid quantity. / 数量不正确。'],
  TOO_MANY_ITEMS:          ['TOO_MANY_ITEMS', 'Too many items in one order. / 单张订单项目过多。'],
  QUOTE_EXPIRED:           ['QUOTE_EXPIRED', 'Checkout quote expired. Please review your cart again. / 结帐报价已过期，请重新确认购物车。'],
  QUOTE_MISMATCH:          ['QUOTE_MISMATCH', 'Prices changed since checkout. / 价格已变动，请重新结帐。'],
  DUPLICATE_ORDER:         ['DUPLICATE_ORDER', 'This order was already submitted. / 这张订单已经提交过了。'],
  ORDER_NOT_FOUND:         ['ORDER_NOT_FOUND', 'Order not found. / 找不到这张订单。'],
  ORDER_STATUS_INVALID:    ['ORDER_STATUS_INVALID', 'This order cannot move to that status. / 这张订单不能变成这个状态。'],
  ORDER_NOT_PAID:          ['ORDER_NOT_PAID', 'Confirm payment before completing. / 请先确认收款再完成订单。'],
  ORDER_ALREADY_FINAL:     ['ORDER_ALREADY_FINAL', 'This order is already closed. / 这张订单已经结案。'],
  CANCEL_NOT_ALLOWED:      ['CANCEL_NOT_ALLOWED', 'This order can no longer be cancelled. / 这张订单已无法取消。'],
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
> setupDatabase()、upgradeToV2()、补栏位、防重复注册工具、dedupeCustomers() · 770 行 · SHA-256 `b58a934e52c52959`

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
      /* 2.0 新增的表还没建（老板尚未执行 upgradeToV2()）时当作空表，
         这样 1.x 的会员 / Claim / 钱包 / 积分照常运作（§68 向后相容）。
         真正的点单 API 会自己回 UPGRADE_REQUIRED，不会静默出错。 */
      if (def.v2) {
        DB_META.sheets[table] = null;
        DB[table] = [];
        return;
      }
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

    /* 2.0 的表还没建：只要没资料要写就直接跳过，
       有资料要写才报错（避免静默丢掉订单）。 */
    if (!sh) {
      if (DB[table].length) {
        throw new Error('UPGRADE_REQUIRED: Sheet「' + def.sheet +
          '」还不存在，请先在 Apps Script 执行 upgradeToV2()。');
      }
      return;
    }

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

/* -------------------------------------------------------------
   9. 2.0 升级（§67 / §71）—— 只加不减，绝不删资料
   ------------------------------------------------------------- */

/** 2.0 新增的序号键（与 1.x 的 customer/order/... 分开） */
var V2_SEQUENCE_KEYS = ['category', 'product', 'option', 'apporder', 'orderitem', 'ordernum'];

/**
 * 2.0 数据库升级。**只加不减**，可重复执行（幂等）。
 *
 * 与 setupDatabase() 的关键差别：
 *   setupDatabase() 会重写每张表的表头，并把「多出来的栏位」删掉 ——
 *   对已经跑了一阵子的线上 Sheet 那是危险动作，§67 明确禁止。
 *
 * upgradeToV2() 只做四件事：
 *   ① 记录升级前每张表的资料列数（升级后逐张比对，证明一列没少）
 *   ② 只建立「不存在」的 2.0 Sheet；已存在的一律不碰（连表头都不重写）
 *   ③ 只补「不存在」的设定键；既有的值一律不改
 *   ④ 只补「不存在」的序号键
 *
 * options.backup = true 时会试着复制一份 Spreadsheet（环境不支持就只提醒）。
 * 回传升级报告，可直接在 Apps Script 的「执行项目」里看 Logger 输出。
 */
function upgradeToV2(options) {
  var opts = options || {};
  var ss = dbSpreadsheet();

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(30000); } catch (e) { locked = false; }
  if (!locked) return err('BUSY', 'Upgrade is locked by another request. / 另一个升级正在执行，请稍后再试。');

  try {
    var report = {
      upgraded: true,
      version: '2.0',
      at: nowISO(),
      backup: null,
      createdSheets: [],
      skippedSheets: [],
      addedSettings: [],
      unchangedSettings: [],
      addedSequences: [],
      rowCounts: {},
      dataIntact: true,
      problems: []
    };

    /* ① 备份（§67）：能复制就复制，不能就明确提醒，不要假装备份过了 */
    if (opts.backup && typeof ss.copy === 'function') {
      try {
        var copy = ss.copy('Yetipsy BACKUP before 2.0 ' + nowISO().slice(0, 10));
        report.backup = { ok: true, name: 'Yetipsy BACKUP before 2.0 ' + nowISO().slice(0, 10), id: copy.getId ? copy.getId() : null };
      } catch (e2) {
        report.backup = { ok: false, reason: String(e2 && e2.message || e2) };
      }
    } else {
      report.backup = {
        ok: false,
        reason: '自动备份未执行。请手动在 Google Sheets 选「档案 → 建立副本」，' +
                '或用 upgradeToV2({ backup: true }) 再执行一次。'
      };
    }

    /* ① 升级前逐张记录资料列数 */
    ss.getSheets().forEach(function (sh) {
      report.rowCounts[sh.getName()] = { before: Math.max(0, sh.getLastRow() - 1), after: null };
    });

    /* ② 只建立不存在的 2.0 Sheet */
    Object.keys(SCHEMA).forEach(function (table) {
      var def = SCHEMA[table];
      if (!def.v2) return;                       // 1.x 的表完全不碰
      var sh = ss.getSheetByName(def.sheet);
      if (sh) { report.skippedSheets.push(def.sheet); return; }

      sh = ss.insertSheet(def.sheet);
      var headers = def.columns.map(function (c) { return c[1]; });
      var first = sh.getRange(1, 1, 1, headers.length);
      first.setValues([headers]);
      first.setFontWeight('bold');
      first.setBackground('#171717');
      first.setFontColor('#F4F1EA');
      sh.setFrozenRows(1);
      report.createdSheets.push(def.sheet);
      report.rowCounts[def.sheet] = { before: 0, after: 0 };
    });

    /* ③ 只补不存在的设定键（既有值一律不改） */
    var settingsSheet = ss.getSheetByName(SCHEMA.settings.sheet);
    if (settingsSheet) {
      var existing = {};
      var last = settingsSheet.getLastRow();
      if (last >= 2) {
        var vals = settingsSheet.getRange(2, 1, last - 1, 1).getValues();
        for (var i = 0; i < vals.length; i++) existing[String(vals[i][0])] = true;
      }
      var defs = defaultSettings();
      var addRows = [];
      Object.keys(defs).forEach(function (k) {
        if (existing[k]) { report.unchangedSettings.push(k); return; }
        addRows.push([k, String(defs[k]), SETTING_DESC[k] || '']);
        report.addedSettings.push(k);
      });
      if (addRows.length) {
        settingsSheet.getRange(last + 1, 1, addRows.length, 3).setValues(addRows);
      }
    } else {
      report.problems.push('找不到 Settings Sheet，无法补设定。请先确认 1.x 的 setupDatabase() 跑过。');
    }

    /* ④ 只补不存在的序号键 */
    var seqSheet = ss.getSheetByName(SCHEMA.sequences.sheet);
    if (seqSheet) {
      var haveSeq = {};
      var slast = seqSheet.getLastRow();
      if (slast >= 2) {
        var svals = seqSheet.getRange(2, 1, slast - 1, 1).getValues();
        for (var j = 0; j < svals.length; j++) haveSeq[String(svals[j][0])] = true;
      }
      var seqRows = [];
      V2_SEQUENCE_KEYS.forEach(function (k) {
        if (haveSeq[k]) return;
        seqRows.push([k, 0]);
        report.addedSequences.push(k);
      });
      if (seqRows.length) seqSheet.getRange(slast + 1, 1, seqRows.length, 2).setValues(seqRows);
    }

    /* ⑤ 升级后逐张比对，任何一张变少就是严重问题 */
    ss.getSheets().forEach(function (sh) {
      var name = sh.getName();
      var after = Math.max(0, sh.getLastRow() - 1);
      if (!report.rowCounts[name]) report.rowCounts[name] = { before: null, after: after };
      report.rowCounts[name].after = after;
      var before = report.rowCounts[name].before;
      if (before !== null && after < before) {
        report.dataIntact = false;
        report.problems.push('「' + name + '」资料列数从 ' + before + ' 变成 ' + after + '！');
      }
    });

    report.ok = report.dataIntact && !report.problems.length;

    Logger.log('upgradeToV2() → 新建 Sheet: ' + (report.createdSheets.join(', ') || '(无，都已存在)'));
    Logger.log('              已存在跳过: ' + (report.skippedSheets.join(', ') || '(无)'));
    Logger.log('              新增设定 ' + report.addedSettings.length + ' 个 / 保留 ' + report.unchangedSettings.length + ' 个');
    Logger.log('              新增序号键: ' + (report.addedSequences.join(', ') || '(无)'));
    Logger.log('              旧资料完整: ' + (report.dataIntact ? 'YES ✅' : 'NO ❌ ' + report.problems.join(' ')));
    if (!report.backup.ok) Logger.log('              备份: ' + report.backup.reason);

    return ok(report);
  } finally {
    lock.releaseLock();
  }
}

/** 检查 2.0 是否已升级完成（诊断用，不修改任何资料） */
function reportUpgradeStatus() {
  var ss = dbSpreadsheet();
  var missing = [];
  Object.keys(SCHEMA).forEach(function (t) {
    if (!SCHEMA[t].v2) return;
    if (!ss.getSheetByName(SCHEMA[t].sheet)) missing.push(SCHEMA[t].sheet);
  });

  var settingsSheet = ss.getSheetByName(SCHEMA.settings.sheet);
  var have = {};
  if (settingsSheet && settingsSheet.getLastRow() >= 2) {
    var vals = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) have[String(vals[i][0])] = true;
  }
  var missingSettings = Object.keys(defaultSettings()).filter(function (k) { return !have[k]; });

  var lines = [];
  lines.push('=== YETIPSY 2.0 升级状态 ===');
  lines.push('缺少的 Sheet (' + missing.length + '): ' + (missing.join(', ') || '无'));
  lines.push('缺少的设定 (' + missingSettings.length + '): ' + (missingSettings.join(', ') || '无'));
  lines.push(missing.length || missingSettings.length
    ? '→ 还没升级完成。请执行 upgradeToV2()（建议 upgradeToV2({ backup: true })）。'
    : '→ 2.0 数据库已就绪，1.x 资料未被改动。');
  Logger.log(lines.join('\n'));
  return ok({ ready: !missing.length && !missingSettings.length, missingSheets: missing, missingSettings: missingSettings });
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
> 钱包储值 / 抵扣 / 上限（金额一律 sen） · 187 行 · SHA-256 `8f4a382a3cb79a93`

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

  /* ★ 必须扫过这位顾客的会员条码（REQUIRE_MEMBER_CODE_SCAN = TRUE 时）
     放在所有金额检查之后，避免验证被白白消耗掉 */
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

  consumeMemberVerify(data.verifyToken);   // 交易成立，这次验证用掉了

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
> ★ 查号码 / 注册 / 密码登录 / 改密码 / 会员资料 · 595 行 · SHA-256 `5cb51d3fef07f4bd`

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

## 11. Menu.gs

> Apps Script 里的档案名称：**`Menu`**（不要打 .gs）
> ★ 2.0 酒单：分类 / 商品 / 规格、促销价、售罄、菜单缓存（upgradeToV2() 后才用得到） · 721 行 · SHA-256 `881420c063880e28`

```javascript
/* =============================================================
   YETIPSY — Menu.gs（2.0 Phase 3）
   -------------------------------------------------------------
   酒单：分类 / 商品 / 规格（§5–§8）

   几条不能违反的规则：
   · §41 价格只由 Backend 决定。前端只能送 ProductID / Quantity / Options，
         任何从前端来的价格一律忽略。
   · §40 促销价由 Backend 判断时间窗，前端不决定价格。
   · §31 SOLD OUT 由 Backend 判断；Checkout 会再验一次（§66）。
   · §82 菜单可以缓存（MENU_CACHE_SECONDS），但钱包 / 余额 / 订单一律不缓存。
   · §33 图片只存 ImageURL（GitHub /assets/menu/*.webp），不存进 Sheet。
   · §5 / §8 分类与规格一律来自 Sheet，不 Hardcode。
   ============================================================= */

var MENU_CACHE_KEY = 'menu:v2';

/* -------------------------------------------------------------
   1. 价格（唯一权威）
   ------------------------------------------------------------- */

/**
 * 算出「现在」的有效单价（sen）。
 * 促销只有在 start/end 都合法、且今天在窗口内、且促销价 > 0 时才生效。
 * 回传 { priceSen, originalPriceSen, onPromo }
 */
function effectivePriceSen(product, todayKey) {
  var base = Math.round(Number(product.priceSen) || 0);
  var today = todayKey || todayKeyOf();

  var promo = Math.round(Number(product.promoPriceSen) || 0);
  var start = String(product.promoStart || '').slice(0, 10);
  var end   = String(product.promoEnd || '').slice(0, 10);

  if (promo > 0 && start && end && start <= today && today <= end && promo < base) {
    return { priceSen: promo, originalPriceSen: base, onPromo: true };
  }
  return { priceSen: base, originalPriceSen: base, onPromo: false };
}

/** 后端时区的今天（YYYY-MM-DD） */
function todayKeyOf() {
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

/** 商品对外形状（不含内部栏位） */
function publicProduct(p, todayKey) {
  var price = effectivePriceSen(p, todayKey);
  var tags = String(p.tags || '').split(',').map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length; });
  return {
    productId:   p.productId,
    categoryId:  p.categoryId,
    nameEN:      p.nameEN || '',
    nameZH:      p.nameZH || '',
    descriptionEN: p.descriptionEN || '',
    descriptionZH: p.descriptionZH || '',
    price:       price.priceSen,
    originalPrice: price.onPromo ? price.originalPriceSen : 0,
    onPromo:     price.onPromo,
    tags:        tags,
    strength:    p.strength || '',
    imageURL:    p.imageURL || '',
    available:   String(p.available).toUpperCase() !== 'FALSE',
    sortOrder:   Number(p.sortOrder) || 0
  };
}

function publicCategory(c) {
  return {
    categoryId: c.categoryId,
    nameEN: c.nameEN || '',
    nameZH: c.nameZH || '',
    sortOrder: Number(c.sortOrder) || 0
  };
}

function publicOption(o) {
  return {
    optionId: o.optionId,
    productId: o.productId,
    optionGroup: o.optionGroup || '',
    optionGroupNameEN: o.optionGroupNameEN || '',
    optionGroupNameZH: o.optionGroupNameZH || '',
    nameEN: o.nameEN || '',
    nameZH: o.nameZH || '',
    priceAdjustment: Math.round(Number(o.priceAdjustmentSen) || 0),
    required: String(o.required).toUpperCase() === 'TRUE',
    sortOrder: Number(o.sortOrder) || 0
  };
}

/* -------------------------------------------------------------
   2. 组装菜单（一次读完，§82）
   ------------------------------------------------------------- */

function buildMenu() {
  var today = todayKeyOf();

  var categories = dbFilter('categories', function (c) {
    return String(c.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicCategory);

  var products = dbFilter('products', function (p) {
    return String(p.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(function (p) { return publicProduct(p, today); });

  var options = dbFilter('productOptions', function (o) {
    return String(o.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicOption);

  /* 规格依商品分组，前端一次就能画完 Product Detail */
  var optionsByProduct = {};
  options.forEach(function (o) {
    if (!optionsByProduct[o.productId]) optionsByProduct[o.productId] = [];
    optionsByProduct[o.productId].push(o);
  });

  return {
    categories: categories,
    products: products,
    optionsByProduct: optionsByProduct,
    today: today,
    counts: {
      categories: categories.length,
      products: products.length,
      available: products.filter(function (p) { return p.available; }).length
    }
  };
}

/** 菜单缓存：改过商品 / 分类 / 规格就要清掉 */
function clearMenuCache() {
  rateLimitClear(MENU_CACHE_KEY);
}

/* -------------------------------------------------------------
   3. 点单是否开放（§63 / §64）
   ------------------------------------------------------------- */

/**
 * 回传 { enabled, paused, open, reason, openTime, closeTime }
 * reason: '' | 'DISABLED' | 'PAUSED' | 'CLOSED'
 */
function orderingWindowState() {
  var enabled = boolSetting('ORDERING_ENABLED', true);
  var paused  = boolSetting('ORDERING_PAUSED', false);
  var openTime  = String(setting('ORDERING_OPEN_TIME', '18:30'));
  var closeTime = String(setting('ORDERING_CLOSE_TIME', '00:00'));

  var state = {
    enabled: enabled,
    paused: paused,
    open: enabled && !paused,
    reason: '',
    openTime: openTime,
    closeTime: closeTime
  };

  if (!enabled) { state.reason = 'DISABLED'; return state; }
  if (paused)   { state.reason = 'PAUSED';   return state; }

  /* 营业时间：close < open 代表跨午夜（18:30 → 00:00） */
  var now = new Date();
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  var hhmm;
  try {
    hhmm = new Date().toLocaleTimeString('en-GB',
      { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) {
    hhmm = now.toISOString().slice(11, 16);
  }
  var cur = toMinutes(hhmm);
  var openM = toMinutes(openTime);
  var closeM = toMinutes(closeTime);

  var within;
  if (closeM === 0 || closeM <= openM) {
    within = cur >= openM;                      // 开到午夜（或跨日）
  } else {
    within = cur >= openM && cur < closeM;
  }

  state.open = within;
  state.now = hhmm;
  if (!within) state.reason = 'CLOSED';
  return state;
}

function toMinutes(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/* -------------------------------------------------------------
   4. 顾客端 API（§60）
   ------------------------------------------------------------- */

/**
 * getMenu —— 一次拿 Categories + Products + Options（§82）。
 * 顾客必须登入（会员制酒吧），但不需要额外权限。
 */
function getMenu(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var ttl = numSetting('MENU_CACHE_SECONDS', 120);
  var cached = null;
  if (ttl > 0) cached = rateLimitGet(MENU_CACHE_KEY);

  var menu;
  if (cached && cached.categories) {
    menu = cached;
    menu.fromCache = true;
  } else {
    menu = buildMenu();
    menu.fromCache = false;
    if (ttl > 0) rateLimitSet(MENU_CACHE_KEY, menu, Math.min(300, ttl));   // §82 上限 300 秒
  }

  /* 点单开关不缓存，每次现算 */
  menu.ordering = orderingWindowState();
  menu.allowPickup = boolSetting('ALLOW_PICKUP', true);
  menu.allowTableOrder = boolSetting('ALLOW_TABLE_ORDER', true);
  menu.maxOrderItems = numSetting('MAX_ORDER_ITEMS', 20);

  /* 顾客端的筛选（§34 / §35）——在已组装好的菜单上做，不再读 Sheet */
  var q = String((data && data.search) || '').trim().toLowerCase();
  var tag = String((data && data.tag) || '').trim().toLowerCase();
  var categoryId = String((data && data.categoryId) || '').trim();

  var list = menu.products;
  if (q) {
    list = list.filter(function (p) {
      return String(p.nameEN).toLowerCase().indexOf(q) >= 0 ||
             String(p.nameZH).indexOf(q) >= 0 ||
             String(p.descriptionEN).toLowerCase().indexOf(q) >= 0 ||
             String(p.descriptionZH).indexOf(q) >= 0;
    });
  }
  if (tag) {
    list = list.filter(function (p) {
      return p.tags.some(function (t) { return t.toLowerCase() === tag; });
    });
  }
  if (categoryId) {
    list = list.filter(function (p) { return p.categoryId === categoryId; });
  }

  return ok({
    categories: menu.categories,
    products: list,
    optionsByProduct: menu.optionsByProduct,
    ordering: menu.ordering,
    allowPickup: menu.allowPickup,
    allowTableOrder: menu.allowTableOrder,
    maxOrderItems: menu.maxOrderItems,
    totalProducts: menu.products.length,
    shownProducts: list.length,
    fromCache: !!menu.fromCache,
    today: menu.today
  });
}

/** getCategories（§60） */
function getCategories(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({
    categories: dbFilter('categories', function (c) {
      return String(c.status).toUpperCase() === 'ACTIVE';
    }).sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    }).map(publicCategory)
  });
}

/** getProducts（§60） */
function getProducts(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var today = todayKeyOf();
  var categoryId = String((data && data.categoryId) || '').trim();

  var list = dbFilter('products', function (p) {
    if (String(p.status).toUpperCase() !== 'ACTIVE') return false;
    if (categoryId && p.categoryId !== categoryId) return false;
    return true;
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(function (p) { return publicProduct(p, today); });

  return ok({ products: list, today: today });
}

/** getProduct（§60）——含规格，Product Detail 一次就够 */
function getProduct(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p || String(p.status).toUpperCase() !== 'ACTIVE') return err('PRODUCT_NOT_FOUND');

  var options = dbFilter('productOptions', function (o) {
    return o.productId === p.productId && String(o.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicOption);

  /* 依 OptionGroup 分组，前端直接画区块 */
  var groups = [];
  var byGroup = {};
  options.forEach(function (o) {
    if (!byGroup[o.optionGroup]) {
      byGroup[o.optionGroup] = {
        optionGroup: o.optionGroup,
        nameEN: o.optionGroupNameEN,
        nameZH: o.optionGroupNameZH,
        required: o.required,
        options: []
      };
      groups.push(byGroup[o.optionGroup]);
    }
    byGroup[o.optionGroup].options.push(o);
  });

  return ok({
    product: publicProduct(p, todayKeyOf()),
    options: options,
    optionGroups: groups
  });
}

/** getProductOptions（§60） */
function getProductOptions(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var productId = String((data && data.productId) || '');
  if (!dbById('products', productId)) return err('PRODUCT_NOT_FOUND');

  return ok({
    options: dbFilter('productOptions', function (o) {
      return o.productId === productId && String(o.status).toUpperCase() === 'ACTIVE';
    }).map(publicOption)
  });
}

/* -------------------------------------------------------------
   5. 员工端：只能改 AVAILABLE / SOLD OUT（§32）
   ------------------------------------------------------------- */

/** setProductAvailability（§61）——Staff 也可以，这是他们唯一的菜单权限 */
function setProductAvailability(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p || String(p.status).toUpperCase() !== 'ACTIVE') return err('PRODUCT_NOT_FOUND');

  var available = data && data.available;
  if (typeof available === 'string') available = available.toUpperCase() !== 'FALSE';
  if (typeof available !== 'boolean') return err('INVALID_INPUT', 'available must be true or false.');

  var before = String(p.available).toUpperCase() !== 'FALSE';
  p.available = available ? 'TRUE' : 'FALSE';
  p.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', available ? 'PRODUCT_AVAILABLE' : 'PRODUCT_SOLD_OUT',
        'PRODUCT', p.productId, String(before), String(available));

  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/* -------------------------------------------------------------
   6. Owner / Manager：分类与商品管理（§62）
   ------------------------------------------------------------- */

/** createCategory（§62） */
function createCategory(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!nameEN && !nameZH) {
    return err('INVALID_INPUT', 'Category name is required. / 请输入分类名称。');
  }

  var c = {
    categoryId: dbNextId('CAT', 'category', 4),
    nameEN: nameEN,
    nameZH: nameZH,
    status: 'ACTIVE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('categories', c);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_CATEGORY', 'CATEGORY', c.categoryId, '',
        c.nameEN + ' / ' + c.nameZH);
  return ok({ category: publicCategory(c) });
}

/** updateCategory（§62） */
function updateCategory(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('categories', String((data && data.categoryId) || ''));
  if (!c) return err('CATEGORY_NOT_FOUND');

  var before = c.nameEN + ' / ' + c.nameZH + ' / ' + c.status;
  if (data.nameEN !== undefined) c.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) c.nameZH = String(data.nameZH).trim();
  if (data.status !== undefined) {
    c.status = String(data.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }
  if (data.sortOrder !== undefined) c.sortOrder = Number(data.sortOrder) || 0;
  c.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_CATEGORY', 'CATEGORY', c.categoryId, before,
        c.nameEN + ' / ' + c.nameZH + ' / ' + c.status);
  return ok({ category: publicCategory(c) });
}

/** createProduct（§62） */
function createProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!nameEN && !nameZH) {
    return err('INVALID_INPUT', 'Product name is required. / 请输入商品名称。');
  }
  if (!dbById('categories', String((data && data.categoryId) || ''))) {
    return err('CATEGORY_NOT_FOUND');
  }
  var price = Math.round(Number(data && data.price));
  if (!isFinite(price) || price <= 0) {
    return err('INVALID_INPUT', 'Price must be greater than 0. / 价格必须大于 0。');
  }

  var p = {
    productId:  dbNextId('PRD', 'product', 4),
    categoryId: String(data.categoryId),
    nameEN: nameEN,
    nameZH: nameZH,
    descriptionEN: String((data && data.descriptionEN) || '').trim(),
    descriptionZH: String((data && data.descriptionZH) || '').trim(),
    priceSen: price,
    originalPriceSen: 0,
    promoPriceSen: 0,
    promoStart: '',
    promoEnd: '',
    tags: normalizeTags(data && data.tags),
    strength: String((data && data.strength) || '').toUpperCase(),
    imageURL: String((data && data.imageURL) || '').trim(),
    status: 'ACTIVE',
    available: 'TRUE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('products', p);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PRODUCT', 'PRODUCT', p.productId, '',
        p.nameEN + ' | ' + price);
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** updateProduct（§62）——价格、图片、分类、排序、促销都在这里改 */
function updateProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p) return err('PRODUCT_NOT_FOUND');

  var before = JSON.stringify({
    price: p.priceSen, status: p.status, available: p.available,
    categoryId: p.categoryId, name: p.nameEN
  });

  if (data.categoryId !== undefined) {
    if (!dbById('categories', String(data.categoryId))) return err('CATEGORY_NOT_FOUND');
    p.categoryId = String(data.categoryId);
  }
  if (data.nameEN !== undefined) p.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) p.nameZH = String(data.nameZH).trim();
  if (data.descriptionEN !== undefined) p.descriptionEN = String(data.descriptionEN).trim();
  if (data.descriptionZH !== undefined) p.descriptionZH = String(data.descriptionZH).trim();
  if (data.price !== undefined) {
    var price = Math.round(Number(data.price));
    if (!isFinite(price) || price <= 0) {
      return err('INVALID_INPUT', 'Price must be greater than 0. / 价格必须大于 0。');
    }
    p.priceSen = price;
  }
  if (data.tags !== undefined) p.tags = normalizeTags(data.tags);
  if (data.strength !== undefined) p.strength = String(data.strength).toUpperCase();
  if (data.imageURL !== undefined) p.imageURL = String(data.imageURL).trim();
  if (data.sortOrder !== undefined) p.sortOrder = Number(data.sortOrder) || 0;
  if (data.status !== undefined) {
    p.status = String(data.status).toUpperCase() === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  }

  /* 促销（§40）：Backend 自己判断时间窗，前端不能直接指定「现在的价格」 */
  if (data.promoPrice !== undefined) {
    var promo = Math.round(Number(data.promoPrice));
    if (!isFinite(promo) || promo < 0) {
      return err('INVALID_INPUT', 'Promo price is invalid. / 促销价不正确。');
    }
    p.promoPriceSen = promo;
  }
  if (data.promoStart !== undefined) p.promoStart = String(data.promoStart).slice(0, 10);
  if (data.promoEnd !== undefined) p.promoEnd = String(data.promoEnd).slice(0, 10);

  p.updatedAt = nowISO();
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PRODUCT', 'PRODUCT', p.productId, before,
        JSON.stringify({ price: p.priceSen, status: p.status, available: p.available,
                         categoryId: p.categoryId, name: p.nameEN }));
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** archiveProduct（§62）——不删资料，只标 ARCHIVED（订单历史还要读得到名称） */
function archiveProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p) return err('PRODUCT_NOT_FOUND');
  if (p.status === 'ARCHIVED') return ok({ product: publicProduct(p, todayKeyOf()), alreadyArchived: true });

  p.status = 'ARCHIVED';
  p.updatedAt = nowISO();
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'ARCHIVE_PRODUCT', 'PRODUCT', p.productId, 'ACTIVE', 'ARCHIVED');
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** createProductOption（§62） */
function createProductOption(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var productId = String((data && data.productId) || '');
  if (!dbById('products', productId)) return err('PRODUCT_NOT_FOUND');

  var group = String((data && data.optionGroup) || '').trim().toUpperCase();
  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!group) return err('INVALID_INPUT', 'optionGroup is required. / 请选择规格类别。');
  if (!nameEN && !nameZH) return err('INVALID_INPUT', 'Option name is required. / 请输入规格名称。');

  var adjust = Math.round(Number((data && data.priceAdjustment) || 0));
  if (!isFinite(adjust)) adjust = 0;
  if (adjust < 0) {
    return err('INVALID_INPUT', 'Price adjustment cannot be negative. / 加价不能是负数。');
  }

  var o = {
    optionId: dbNextId('OPT', 'option', 4),
    productId: productId,
    optionGroup: group,
    optionGroupNameEN: String((data && data.optionGroupNameEN) || '').trim(),
    optionGroupNameZH: String((data && data.optionGroupNameZH) || '').trim(),
    nameEN: nameEN,
    nameZH: nameZH,
    priceAdjustmentSen: adjust,
    required: (data && data.required) ? 'TRUE' : 'FALSE',
    status: 'ACTIVE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('productOptions', o);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PRODUCT_OPTION', 'PRODUCT', productId, '',
        group + ' / ' + nameEN + ' / +' + adjust);
  return ok({ option: publicOption(o) });
}

/** updateProductOption（§62） */
function updateProductOption(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var o = dbById('productOptions', String((data && data.optionId) || ''));
  if (!o) return err('OPTION_NOT_FOUND');

  var before = o.nameEN + ' / ' + o.priceAdjustmentSen + ' / ' + o.status;
  if (data.nameEN !== undefined) o.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) o.nameZH = String(data.nameZH).trim();
  if (data.optionGroupNameEN !== undefined) o.optionGroupNameEN = String(data.optionGroupNameEN).trim();
  if (data.optionGroupNameZH !== undefined) o.optionGroupNameZH = String(data.optionGroupNameZH).trim();
  if (data.priceAdjustment !== undefined) {
    var adjust = Math.round(Number(data.priceAdjustment));
    if (!isFinite(adjust) || adjust < 0) {
      return err('INVALID_INPUT', 'Price adjustment cannot be negative. / 加价不能是负数。');
    }
    o.priceAdjustmentSen = adjust;
  }
  if (data.required !== undefined) o.required = data.required ? 'TRUE' : 'FALSE';
  if (data.sortOrder !== undefined) o.sortOrder = Number(data.sortOrder) || 0;
  if (data.status !== undefined) {
    o.status = String(data.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }
  o.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PRODUCT_OPTION', 'OPTION', o.optionId, before,
        o.nameEN + ' / ' + o.priceAdjustmentSen + ' / ' + o.status);
  return ok({ option: publicOption(o) });
}

/* -------------------------------------------------------------
   7. 小工具
   ------------------------------------------------------------- */

function normalizeTags(input) {
  if (!input) return '';
  var arr = Array.isArray(input) ? input : String(input).split(',');
  return arr.map(function (t) {
    return String(t).trim().toLowerCase().replace(/\s+/g, '-');
  }).filter(function (t) { return t.length; }).slice(0, 10).join(',');
}

/**
 * 示范酒单（§26 的例子）。只在 Products 还是空的时候写入，
 * 不会覆盖老板已经建好的菜单。
 */
function seedDemoMenu() {
  if (dbFilter('products', function () { return true; }).length) {
    return ok({ seeded: false, reason: 'Products 已有资料，不覆盖。' });
  }

  var cats = [
    ['SIGNATURE', '招牌特调', 1],
    ['CLASSIC', '经典鸡尾酒', 2],
    ['GIN', '金酒', 3],
    ['NON_ALCOHOL', '无酒精', 9]
  ];
  var catIds = {};
  cats.forEach(function (c) {
    var row = {
      categoryId: dbNextId('CAT', 'category', 4),
      nameEN: c[0].replace(/_/g, ' '), nameZH: c[1], status: 'ACTIVE',
      sortOrder: c[2], createdAt: nowISO(), updatedAt: nowISO()
    };
    dbInsert('categories', row);
    catIds[c[0]] = row.categoryId;
  });

  var items = [
    ['CLASSIC', 'Mojito', '经典莫希托', 'Mint · Lime · Rum', '清爽薄荷青柠', 2200, 'refreshing,citrus,mint', 'LIGHT'],
    ['CLASSIC', 'Long Island Iced Tea', '长岛冰茶', 'Five spirits · Cola', '五种基酒 · 可乐', 2800, 'strong,cola', 'STRONG'],
    ['SIGNATURE', 'Yetipsy Sunset', 'yetipsy 日落', 'House special', '本店特调', 3200, 'fruity,sweet', 'MEDIUM'],
    ['NON_ALCOHOL', 'Virgin Mojito', '无酒精莫希托', 'Mint · Lime · Soda', '清爽薄荷青柠', 1200, 'refreshing,citrus', 'LIGHT']
  ];
  var productIds = [];
  items.forEach(function (it, i) {
    var p = {
      productId: dbNextId('PRD', 'product', 4),
      categoryId: catIds[it[0]],
      nameEN: it[1], nameZH: it[2],
      descriptionEN: it[3], descriptionZH: it[4],
      priceSen: it[5], originalPriceSen: 0, promoPriceSen: 0, promoStart: '', promoEnd: '',
      tags: it[6], strength: it[7],
      imageURL: '/assets/menu/' + it[1].toLowerCase().replace(/[^a-z]+/g, '-') + '.webp',
      status: 'ACTIVE', available: 'TRUE', sortOrder: i + 1,
      createdAt: nowISO(), updatedAt: nowISO()
    };
    dbInsert('products', p);
    productIds.push(p.productId);
  });

  /* Mojito 的规格（§8：Size / ICE / SWEETNESS 都来自 Sheet） */
  var mojito = productIds[0];
  [
    ['SIZE', 'Size', '份量', 'Regular', '标准', 0, true, 1],
    ['SIZE', 'Size', '份量', 'Large', '大杯', 600, false, 2],
    ['ICE', 'Ice', '冰块', 'Normal', '正常冰', 0, false, 3],
    ['ICE', 'Ice', '冰块', 'Less Ice', '少冰', 0, false, 4],
    ['SWEETNESS', 'Sweetness', '甜度', 'Normal', '正常甜', 0, false, 5],
    ['SWEETNESS', 'Sweetness', '甜度', 'Less Sweet', '少甜', 0, false, 6]
  ].forEach(function (o) {
    dbInsert('productOptions', {
      optionId: dbNextId('OPT', 'option', 4),
      productId: mojito,
      optionGroup: o[0], optionGroupNameEN: o[1], optionGroupNameZH: o[2],
      nameEN: o[3], nameZH: o[4], priceAdjustmentSen: o[5],
      required: o[6] ? 'TRUE' : 'FALSE', status: 'ACTIVE', sortOrder: o[7],
      createdAt: nowISO(), updatedAt: nowISO()
    });
  });

  clearMenuCache();
  return ok({
    seeded: true,
    categories: cats.length,
    products: items.length,
    options: 6
  });
}
```

---

## 12. Checkout.gs

> Apps Script 里的档案名称：**`Checkout`**（不要打 .gs）
> ★ 2.0 结帐报价：后端重算价格、钱包上限、Quote 5 分钟有效期、防重复下单的识别码 · 330 行 · SHA-256 `77e3fe37a9ea0736`

```javascript
/* =============================================================
   YETIPSY — Checkout.gs（2.0 Phase 5）
   -------------------------------------------------------------
   结帐报价（§42 / §43 / §44）

   流程：Cart → createCheckoutQuote() → 顾客确认 → placeOrder()

   不能违反的规则：
   · §41/§42 前端只能送 ProductID / Quantity / Options。价格一律由
     Backend 读 Products 重算，前端送来的任何金额都被忽略。
   · §66 即使商品已在 Cart 里，Checkout 仍要再验一次库存。
   · §8 规格必须属于该商品、必须是 ACTIVE、必选组不能漏。
   · §43 Quote 有短效期（CHECKOUT_QUOTE_EXPIRY_MINUTES），过期要重新报价。
   · §44 每次 Quote 附一个 IdempotencyKey，placeOrder 用它防重复下单。
   · §10 这里只「记录」钱包要用多少，**不扣钱**；扣钱在订单确认时（§54）。
   · §82 报价里含钱包余额 → 绝不进 CacheService 的长期缓存，
     只用短效 Quote 键，且钱包数字每次现读。
   ============================================================= */

var QUOTE_CACHE_PREFIX = 'checkoutquote:';

/** Quote 有效秒数（§43，预设 5 分钟） */
function quoteTtlSeconds() {
  var minutes = numSetting('CHECKOUT_QUOTE_EXPIRY_MINUTES', 5);
  if (!isFinite(minutes) || minutes <= 0) minutes = 5;
  return Math.min(3600, Math.round(minutes * 60));      // 最多 1 小时
}

/* -------------------------------------------------------------
   1. 校验购物车（§42）
   ------------------------------------------------------------- */

/**
 * 把前端送的 cart 逐项对照 Products / ProductOptions 重算。
 * 回传 { ok:true, lines:[...], subtotalSen, itemCount } 或 { ok:false, error }
 *
 * 前端送来的每一项只认这几个栏位：
 *   { productId, quantity, options:[optionId...], note }
 * 其余（price / amount / total / discount…）一律忽略。
 */
function priceCart(cartItems) {
  var maxItems = numSetting('MAX_ORDER_ITEMS', 20);
  if (!cartItems || !cartItems.length) {
    return { ok: false, error: err('INVALID_INPUT', 'Cart is empty. / 购物车是空的。') };
  }
  if (cartItems.length > maxItems) {
    return { ok: false, error: err('TOO_MANY_ITEMS',
      'Max ' + maxItems + ' items per order. / 单张订单最多 ' + maxItems + ' 项。') };
  }

  var today = todayKeyOf();
  var lines = [];
  var subtotal = 0;
  var itemCount = 0;

  for (var i = 0; i < cartItems.length; i++) {
    var raw = cartItems[i] || {};
    var product = dbById('products', String(raw.productId || ''));

    if (!product || String(product.status).toUpperCase() !== 'ACTIVE') {
      return { ok: false, error: err('PRODUCT_NOT_FOUND',
        'Product not found: ' + String(raw.productId || '(empty)')) };
    }
    /* §66 已经放进 Cart 也要再验一次 */
    if (String(product.available).toUpperCase() === 'FALSE') {
      return { ok: false, error: err('PRODUCT_UNAVAILABLE',
        (product.nameEN || product.productId) + ' is sold out. / 已售完。') };
    }

    var qty = Math.round(Number(raw.quantity));
    if (!isFinite(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: err('INVALID_QUANTITY',
        'Invalid quantity for ' + (product.nameEN || product.productId)) };
    }

    /* 规格：必须属于这个商品、必须 ACTIVE、同组不能选两个、必选组不能漏 */
    var allOptions = dbFilter('productOptions', function (o) {
      return o.productId === product.productId && String(o.status).toUpperCase() === 'ACTIVE';
    });

    var wantedIds = {};
    (Array.isArray(raw.options) ? raw.options : []).forEach(function (id) {
      wantedIds[String(id)] = true;
    });

    var chosen = [];
    var seenGroups = {};
    var optionsPrice = 0;
    for (var j = 0; j < allOptions.length; j++) {
      var opt = allOptions[j];
      if (!wantedIds[opt.optionId]) continue;
      if (seenGroups[opt.optionGroup]) {
        return { ok: false, error: err('INVALID_INPUT',
          'Only one option per group (' + opt.optionGroup + '). / 同一组规格只能选一个。') };
      }
      seenGroups[opt.optionGroup] = true;
      chosen.push({
        optionId: opt.optionId,
        optionGroup: opt.optionGroup,
        nameEN: opt.nameEN || '',
        nameZH: opt.nameZH || ''
      });
      optionsPrice += Math.round(Number(opt.priceAdjustmentSen) || 0);
    }

    var requiredGroups = {};
    allOptions.forEach(function (o) {
      if (String(o.required).toUpperCase() === 'TRUE') requiredGroups[o.optionGroup] = true;
    });
    var missing = Object.keys(requiredGroups).filter(function (g) { return !seenGroups[g]; });
    if (missing.length) {
      return { ok: false, error: err('OPTION_REQUIRED',
        'Please choose ' + missing.join(', ') + '. / 请选择必选规格：' + missing.join('、')) };
    }

    /* §30 快照：名称与单价在下单当下就固定下来 */
    var price = effectivePriceSen(product, today);
    var unitPrice = price.priceSen;
    var lineTotal = (unitPrice + optionsPrice) * qty;

    subtotal += lineTotal;
    itemCount += qty;
    lines.push({
      productId: product.productId,
      productNameSnapshot: product.nameEN || product.nameZH || product.productId,
      productNameZhSnapshot: product.nameZH || '',
      unitPriceSen: unitPrice,
      quantity: qty,
      options: chosen,
      optionsPriceSen: optionsPrice,
      lineTotalSen: lineTotal,
      customerNote: String(raw.note || '').slice(0, 200),
      onPromo: price.onPromo
    });
  }

  if (subtotal <= 0) {
    return { ok: false, error: err('INVALID_AMOUNT', 'Order total must be above 0.') };
  }

  return { ok: true, lines: lines, subtotalSen: subtotal, itemCount: itemCount };
}

/* -------------------------------------------------------------
   2. 桌号 / 取餐方式（§11）
   ------------------------------------------------------------- */

/** 回传 { ok, orderType, tableNumber } 或 { ok:false, error } */
function resolveOrderType(data) {
  var type = String((data && data.orderType) || '').trim().toUpperCase();
  var table = String((data && data.tableNumber) || '').trim().toUpperCase().slice(0, 12);

  var allowTable = boolSetting('ALLOW_TABLE_ORDER', true);
  var allowPickup = boolSetting('ALLOW_PICKUP', true);

  if (!type) type = table ? 'TABLE' : 'COUNTER';

  if (type === 'TABLE') {
    if (!allowTable) {
      return { ok: false, error: err('INVALID_INPUT',
        'Table orders are not available. / 目前不提供桌号点单。') };
    }
    if (!table) {
      return { ok: false, error: err('INVALID_INPUT',
        'Please enter your table number. / 请输入桌号。') };
    }
  } else if (type === 'COUNTER' || type === 'PICKUP' || type === 'TAKEAWAY') {
    if (!allowPickup) {
      return { ok: false, error: err('INVALID_INPUT',
        'Pickup is not available. / 目前不提供自取。') };
    }
    type = (type === 'PICKUP') ? 'COUNTER' : type;
    table = '';
  } else {
    return { ok: false, error: err('INVALID_INPUT',
      'Unknown order type: ' + type + ' / 不正确的取餐方式。') };
  }

  return { ok: true, orderType: type, tableNumber: table };
}

/* -------------------------------------------------------------
   3. createCheckoutQuote（§43 / §60）
   ------------------------------------------------------------- */

/**
 * data: { items:[{productId, quantity, options:[optionId], note}],
 *         orderType:'TABLE'|'COUNTER'|'TAKEAWAY', tableNumber:'A12',
 *         useWallet:true|false, customerNote:'...' }
 */
function createCheckoutQuote(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  /* §64 点单开关 */
  var win = orderingWindowState();
  if (!win.enabled) return err('ORDERING_CLOSED');
  if (win.paused) return err('ORDERING_PAUSED');
  if (!win.open) {
    return err('ORDERING_CLOSED',
      'Ordering hours ' + win.openTime + ' – ' + win.closeTime +
      '. / 点单时间 ' + win.openTime + ' – ' + win.closeTime + '。');
  }

  var priced = priceCart(data && data.items);
  if (!priced.ok) return priced.error;

  var placement = resolveOrderType(data);
  if (!placement.ok) return placement.error;

  /* §10 钱包：这里只「算」能用多少，不扣钱 */
  var useWallet = !!(data && data.useWallet);
  var plan = walletRedemptionPlan(customer, priced.subtotalSen);
  var walletApplied = useWallet && plan.allowed ? plan.usableAmount : 0;

  var finalAmount = priced.subtotalSen - walletApplied;
  if (finalAmount < 0) finalAmount = 0;

  var quoteToken = randomToken(16);
  var idempotencyKey = randomToken(16);
  var ttl = quoteTtlSeconds();
  var now = Date.now();

  var quote = {
    quoteToken: quoteToken,
    customerId: customer.customerId,
    lines: priced.lines,
    itemCount: priced.itemCount,
    subtotalSen: priced.subtotalSen,
    useWallet: useWallet,
    walletBalanceSen: plan.walletBalance,       // 报价当下的余额（§82 不做长期缓存）
    walletMaxUsableSen: plan.maxUsable,
    walletAppliedSen: walletApplied,
    walletReason: useWallet && !plan.allowed ? plan.reason : '',
    discountSen: 0,
    finalAmountSen: finalAmount,
    orderType: placement.orderType,
    tableNumber: placement.tableNumber,
    customerNote: String((data && data.customerNote) || '').slice(0, 200),
    idempotencyKey: idempotencyKey,
    createdAt: nowISO(),
    expiresAtMs: now + ttl * 1000
  };

  rateLimitSet(QUOTE_CACHE_PREFIX + quoteToken, quote, ttl);

  return ok({
    quoteToken: quoteToken,
    idempotencyKey: idempotencyKey,
    expiresInMinutes: Math.round(ttl / 60 * 10) / 10,
    lines: quote.lines,
    itemCount: quote.itemCount,
    subtotal: quote.subtotalSen,
    wallet: {
      requested: useWallet,
      balance: plan.walletBalance,
      maxUsable: plan.maxUsable,
      applied: walletApplied,
      maxPercent: plan.maxPercent,
      minBill: plan.minBill,
      allowed: plan.allowed,
      reason: quote.walletReason
    },
    discount: 0,
    finalAmount: finalAmount,
    customerPays: finalAmount,
    orderType: quote.orderType,
    tableNumber: quote.tableNumber,
    /* §57 预告积分。注意要传「毛额 + 钱包抵扣」，因为 pointsForAmount()
       在 NET_PAID 模式下自己会做 billAmount - walletUsed；
       传已经扣过钱包的 finalAmount 会扣两次。
       真正发放仍以完成订单时后端计算为准（§22）。 */
    estimatedPoints: pointsForAmount(priced.subtotalSen, walletApplied),
    ordering: win
  });
}

/* -------------------------------------------------------------
   4. 读取 / 校验 Quote（给 placeOrder 用）
   ------------------------------------------------------------- */

/** 取出并验证 Quote；回传 { ok, quote } 或 { ok:false, error } */
function loadQuote(quoteToken, customerId) {
  var key = QUOTE_CACHE_PREFIX + String(quoteToken || '');
  var quote = rateLimitGet(key);
  if (!quote || !quote.quoteToken) {
    return { ok: false, error: err('QUOTE_EXPIRED') };
  }
  if (String(quote.customerId) !== String(customerId)) {
    /* 别人的 Quote 不能用（§12 防伪造） */
    return { ok: false, error: err('QUOTE_EXPIRED', 'Quote does not match this member.') };
  }
  if (Number(quote.expiresAtMs) < Date.now()) {
    rateLimitClear(key);
    return { ok: false, error: err('QUOTE_EXPIRED') };
  }
  return { ok: true, quote: quote };
}

/** 用掉 Quote（下单成功或作废时呼叫），避免同一张被用两次 */
function consumeQuote(quoteToken) {
  rateLimitClear(QUOTE_CACHE_PREFIX + String(quoteToken || ''));
}

/**
 * 顾客可以主动重新取得报价（例如回到 Cart 改了东西）。
 * 单纯查询，不产生新的 IdempotencyKey。
 */
function getCheckoutQuote(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var found = loadQuote(data && data.quoteToken, ctx.customer.customerId);
  if (!found.ok) return found.error;
  var q = found.quote;

  return ok({
    quoteToken: q.quoteToken,
    idempotencyKey: q.idempotencyKey,
    expiresInMinutes: Math.max(0, Math.round((Number(q.expiresAtMs) - Date.now()) / 6000) / 10),
    lines: q.lines,
    itemCount: q.itemCount,
    subtotal: q.subtotalSen,
    walletApplied: q.walletAppliedSen,
    finalAmount: q.finalAmountSen,
    orderType: q.orderType,
    tableNumber: q.tableNumber
  });
}
```

---

## 13. AppOrders.gs

> Apps Script 里的档案名称：**`AppOrders`**（不要打 .gs）
> ★ 2.0 订单：placeOrder（幂等）、订单查询、取消、再点一次、名称与单价快照 · 370 行 · SHA-256 `b01ff1543b7363eb`

```javascript
/* =============================================================
   YETIPSY — AppOrders.gs（2.0 Phase 6）
   -------------------------------------------------------------
   建立订单 / 查询订单 / 取消请求（§60 / §75）

   状态流（§16）：SUBMITTED → CONFIRMED → PREPARING → READY → COMPLETED
                                                    └→ CANCELLED

   不能违反的规则：
   · §44 同一个 IdempotencyKey 只能产生一张订单。连按两次 PLACE ORDER
         第二次会拿回同一张订单，不会变成两单。
   · §41 金额一律来自 Quote（Quote 又是后端自己算的），前端送的金额被忽略。
   · §54 钱包在这一步只「记录」walletRequestedSen，**不扣钱**；
         真正扣钱在员工确认收款时，取消要能全额退回。
   · §22 SUBMITTED 不给积分、不给 Reward、不算 Visit。
         这些一律等到 COMPLETED（Phase 8）。
   · §45 OrderNumber（YT260917001）只是显示用，内部一律用 AppOrderID。
   · §49 等待时间由 CreatedAt 算，不额外写库。
   · §53 SUBMITTED 且未被 Accept 时，顾客可以 REQUEST CANCEL。
   ============================================================= */

/* -------------------------------------------------------------
   1. 对外形状
   ------------------------------------------------------------- */

function publicAppOrder(o, items) {
  var created = o.createdAt ? new Date(o.createdAt).getTime() : 0;
  return {
    appOrderId: o.appOrderId,
    orderNumber: o.orderNumber,
    orderType: o.orderType,
    tableNumber: o.tableNumber || '',
    itemCount: Number(o.itemCount) || 0,
    subtotal: Number(o.subtotalSen) || 0,
    walletRequested: Number(o.walletRequestedSen) || 0,
    walletUsed: Number(o.walletUsedSen) || 0,
    discount: Number(o.discountSen) || 0,
    finalAmount: Number(o.finalAmountSen) || 0,
    pointsEarned: Number(o.pointsEarned) || 0,
    orderStatus: o.orderStatus,
    paymentMethod: o.paymentMethod || '',
    paymentStatus: o.paymentStatus || 'UNPAID',
    customerNote: o.customerNote || '',
    channel: o.channel || 'YETIPSY_APP',
    createdAt: o.createdAt || '',
    confirmedAt: o.confirmedAt || '',
    readyAt: o.readyAt || '',
    completedAt: o.completedAt || '',
    cancelledAt: o.cancelledAt || '',
    cancelReason: o.cancelReason || '',
    /* §49 等待秒数由 CreatedAt 现算，不存库 */
    waitingSeconds: created ? Math.max(0, Math.floor((Date.now() - created) / 1000)) : 0,
    items: items || []
  };
}

function publicOrderItem(it) {
  return {
    orderItemId: it.orderItemId,
    productId: it.productId,
    name: it.productNameSnapshot || '',
    nameZH: it.productNameSnapshot && it.productNameZh ? it.productNameZh : '',
    unitPrice: Number(it.unitPriceSen) || 0,
    quantity: Number(it.quantity) || 0,
    options: parseOptionsJson(it.optionsJSON),
    optionsPrice: Number(it.optionsPriceSen) || 0,
    lineTotal: Number(it.lineTotalSen) || 0,
    note: it.customerNote || ''
  };
}

function parseOptionsJson(json) {
  try {
    var arr = JSON.parse(String(json || '[]'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/** 显示用订单编号 YT260917001（§45） */
function nextOrderNumber() {
  var d = new Date();
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  var ymd;
  try {
    ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz }).replace(/-/g, '');
  } catch (e) {
    ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  var yymmdd = ymd.slice(2);                       // 20260917 → 260917
  return dbNextId('YT' + yymmdd, 'ordernum:' + yymmdd, 3);
}

/* -------------------------------------------------------------
   2. placeOrder（§60 / §75）
   ------------------------------------------------------------- */

/**
 * data: { quoteToken, idempotencyKey, orderType, tableNumber,
 *         useWallet, paymentMethod, customerNote }
 *
 * 金额完全来自 Quote；前端送来的 subtotal / total / wallet 一律忽略。
 */
function placeOrder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var customer = ctx.customer;

  /* §44 幂等：同一个 key 已经下过单就直接回那一张 */
  var idemKey = String((data && data.idempotencyKey) || '').trim();
  if (!idemKey) {
    return err('INVALID_INPUT', 'Missing idempotency key. / 缺少防重复下单的识别码。');
  }
  var existing = dbFind('appOrders', function (o) {
    return o.idempotencyKey === idemKey && o.customerId === customer.customerId;
  });
  if (existing) {
    return ok({
      order: publicAppOrder(existing, orderItemsOf(existing.appOrderId)),
      duplicate: true,
      message: 'This order was already submitted. / 这张订单已经提交过了。'
    });
  }

  /* §64 点单开关（Quote 之后可能已经被员工暂停） */
  var win = orderingWindowState();
  if (!win.enabled) return err('ORDERING_CLOSED');
  if (win.paused) return err('ORDERING_PAUSED');
  if (!win.open) return err('ORDERING_CLOSED');

  /* §43 Quote 必须还在有效期内，而且属于这位会员 */
  var found = loadQuote(data && data.quoteToken, customer.customerId);
  if (!found.ok) return found.error;
  var quote = found.quote;

  /* Quote 里的 idempotencyKey 必须跟送来的一致，避免拿旧 Quote 配新 key 绕过 */
  if (quote.idempotencyKey !== idemKey) {
    return err('QUOTE_MISMATCH',
      'This checkout link has changed. Please review your cart again. / 结帐资讯已变动，请重新确认。');
  }

  /* §66 下单前再验一次库存（Quote 之后可能卖完） */
  for (var i = 0; i < quote.lines.length; i++) {
    var p = dbById('products', quote.lines[i].productId);
    if (!p || String(p.status).toUpperCase() !== 'ACTIVE') {
      return err('PRODUCT_NOT_FOUND', quote.lines[i].productNameSnapshot);
    }
    if (String(p.available).toUpperCase() === 'FALSE') {
      return err('PRODUCT_UNAVAILABLE',
        (p.nameEN || p.productId) + ' is sold out. / 已售完。');
    }
  }

  /* §54 钱包只「要求」，这一步不扣钱 */
  var walletRequested = Number(quote.walletAppliedSen) || 0;
  if (walletRequested > (Number(customer.walletBalance) || 0)) {
    /* Quote 之后余额被用掉了 → 请重新结帐，不要静默改金额 */
    return err('QUOTE_MISMATCH',
      'Wallet balance changed. Please checkout again. / 钱包余额已变动，请重新结帐。');
  }

  var paymentMethod = String((data && data.paymentMethod) || 'COUNTER').toUpperCase();
  if (['COUNTER', 'CASH', 'DUITNOW', 'CARD', 'FOODCOURT', 'ONLINE'].indexOf(paymentMethod) === -1) {
    paymentMethod = 'COUNTER';
  }

  var appOrder = {
    appOrderId: dbNextId('APO', 'apporder', 6),
    orderNumber: nextOrderNumber(),
    customerId: customer.customerId,
    orderType: quote.orderType,
    tableNumber: quote.tableNumber || '',
    itemCount: Number(quote.itemCount) || quote.lines.length,
    subtotalSen: Number(quote.subtotalSen) || 0,
    walletRequestedSen: walletRequested,
    walletUsedSen: 0,                 // §54 确认收款时才写
    discountSen: Number(quote.discountSen) || 0,
    finalAmountSen: Number(quote.finalAmountSen) || 0,
    pointsEarned: 0,                  // §22 完成后才发
    orderStatus: 'SUBMITTED',
    paymentMethod: paymentMethod,
    paymentStatus: 'UNPAID',
    paymentReference: '',
    quoteToken: quote.quoteToken,
    idempotencyKey: idemKey,
    customerNote: quote.customerNote || '',
    channel: 'YETIPSY_APP',
    ordersTxId: '',
    handledBy: '',
    createdAt: nowISO(),
    confirmedAt: '',
    readyAt: '',
    completedAt: '',
    cancelledAt: '',
    cancelledBy: '',
    cancelReason: '',
    updatedAt: nowISO()
  };
  dbInsert('appOrders', appOrder);

  /* §30 明细：名称与单价都在这一刻快照下来 */
  quote.lines.forEach(function (line) {
    dbInsert('orderItems', {
      orderItemId: dbNextId('OIT', 'orderitem', 6),
      appOrderId: appOrder.appOrderId,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      unitPriceSen: Number(line.unitPriceSen) || 0,
      quantity: Number(line.quantity) || 1,
      optionsJSON: JSON.stringify(line.options || []),
      optionsPriceSen: Number(line.optionsPriceSen) || 0,
      lineTotalSen: Number(line.lineTotalSen) || 0,
      customerNote: line.customerNote || '',
      createdAt: nowISO()
    });
  });

  consumeQuote(quote.quoteToken);      // 一张 Quote 只能用一次

  audit(customer.customerId, 'CUSTOMER', 'PLACE_ORDER', 'APP_ORDER', appOrder.appOrderId,
        '', appOrder.orderNumber + ' | ' + appOrder.finalAmountSen + ' | ' + appOrder.orderType +
        (appOrder.tableNumber ? ' ' + appOrder.tableNumber : ''));

  return ok({
    order: publicAppOrder(appOrder, orderItemsOf(appOrder.appOrderId)),
    duplicate: false
  });
}

function orderItemsOf(appOrderId) {
  return dbFilter('orderItems', function (it) {
    return it.appOrderId === appOrderId;
  }).map(publicOrderItem);
}

/* -------------------------------------------------------------
   3. 查询（§60）
   ------------------------------------------------------------- */

/** getAppOrder —— 顾客看自己的订单（§17 订单追踪） */
function getAppOrder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  /* 只能看自己的（§12 防伪造 CustomerID） */
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)) });
}

/** getMyOrders —— 订单列表（§37 再点一次也要用） */
function getMyOrders(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var limit = Math.min(50, Math.max(1, Math.round(Number((data && data.limit) || 20)) || 20));
  var status = String((data && data.status) || '').trim().toUpperCase();

  var list = dbFilter('appOrders', function (o) {
    if (o.customerId !== ctx.customer.customerId) return false;
    if (status && o.orderStatus !== status) return false;
    return true;
  }).slice().reverse().slice(0, limit);

  return ok({
    orders: list.map(function (o) {
      var pub = publicAppOrder(o, orderItemsOf(o.appOrderId));
      /* 列表不需要完整明细，给前几项就够画卡片 */
      pub.items = pub.items.slice(0, 4);
      return pub;
    }),
    count: list.length
  });
}

/* -------------------------------------------------------------
   4. 取消（§53）
   ------------------------------------------------------------- */

/**
 * requestOrderCancellation —— SUBMITTED 且员工还没 Accept 时，顾客可以要求取消。
 * 已经 CONFIRMED / PREPARING 之后一律要员工处理（回 CANCEL_NOT_ALLOWED）。
 */
function requestOrderCancellation(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  if (o.orderStatus === 'CANCELLED') {
    return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)), alreadyCancelled: true });
  }
  if (o.orderStatus !== 'SUBMITTED') {
    return err('CANCEL_NOT_ALLOWED',
      'This order is already being prepared. Please ask our staff. / ' +
      '这张订单已开始制作，请联系店员。');
  }
  if (o.orderStatus === 'COMPLETED') return err('ORDER_ALREADY_FINAL');

  o.orderStatus = 'CANCELLED';
  o.cancelledAt = nowISO();
  o.cancelledBy = ctx.customer.customerId;
  o.cancelReason = String((data && data.reason) || 'Cancelled by customer').slice(0, 200);
  o.updatedAt = nowISO();
  /* §54 这一步没扣过钱包，所以不需要 reversal；walletUsedSen 保持 0 */

  audit(ctx.customer.customerId, 'CUSTOMER', 'REQUEST_ORDER_CANCEL', 'APP_ORDER',
        o.appOrderId, 'SUBMITTED', 'CANCELLED | ' + o.cancelReason);

  return ok({ order: publicAppOrder(o, orderItemsOf(o.appOrderId)) });
}

/* -------------------------------------------------------------
   5. 再点一次（§37）
   ------------------------------------------------------------- */

/**
 * reorder —— 把旧订单里「仍然有货」的商品整理成购物车，
 * 由前端放进 CART。价格用现在的价格（不是旧价格），因为要重新报价。
 */
function reorder(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var o = dbById('appOrders', String((data && data.appOrderId) || ''));
  if (!o) return err('ORDER_NOT_FOUND');
  if (o.customerId !== ctx.customer.customerId) return err('ORDER_NOT_FOUND');

  var today = todayKeyOf();
  var available = [];
  var unavailable = [];

  orderItemsOf(o.appOrderId).forEach(function (it) {
    var p = dbById('products', it.productId);
    if (!p || String(p.status).toUpperCase() !== 'ACTIVE' ||
        String(p.available).toUpperCase() === 'FALSE') {
      unavailable.push({ productId: it.productId, name: it.name });
      return;
    }
    /* 规格也要还在，否则顾客会拿到选不到的选项 */
    var optionIds = (it.options || []).map(function (x) { return x.optionId; }).filter(function (id) {
      var opt = dbById('productOptions', String(id));
      return opt && opt.productId === p.productId && String(opt.status).toUpperCase() === 'ACTIVE';
    });
    var price = effectivePriceSen(p, today);
    available.push({
      productId: p.productId,
      nameEN: p.nameEN,
      nameZH: p.nameZH,
      unitPrice: price.priceSen,
      quantity: Number(it.quantity) || 1,
      options: optionIds,
      note: it.note || ''
    });
  });

  return ok({
    appOrderId: o.appOrderId,
    items: available,
    unavailable: unavailable,
    /* 价格可能已经变过，前端要重新走一次 Checkout Quote */
    priceChanged: available.some(function (it, i) {
      var old = orderItemsOf(o.appOrderId)[i];
      return old && Number(old.unitPrice) !== Number(it.unitPrice);
    })
  });
}
```

---

## 14. Claims.gs

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

## 15. Promotions.gs

> Apps Script 里的档案名称：**`Promotions`**（不要打 .gs）
> 优惠规则 · 154 行 · SHA-256 `097df3e93b5828af`

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

/**
 * 这条活动今天会不会出现在会员端？
 * 员工端最常问「为什么客户端看不到」，所以直接把原因算出来回传。
 */
function promotionVisibility(p, today) {
  if (p.status !== 'ACTIVE') return { visible: false, reason: 'INACTIVE' };
  if (p.startDate && p.startDate > today) return { visible: false, reason: 'NOT_STARTED' };
  if (p.endDate && p.endDate < today)     return { visible: false, reason: 'EXPIRED' };
  return { visible: true, reason: 'VISIBLE' };
}

function getPromotionsAdmin(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  var today = todayKey();
  var list = dbRecent('promotions').map(function (p) {
    var v = promotionVisibility(p, today);
    p.visibleToday = v.visible;
    p.visibilityReason = v.reason;
    return p;
  });
  return ok({ promotions: list, today: today });
}

/* 注意：没有「删除活动」。
   DB 层（dbFlush）只新增与更新，删掉一列会让下面所有列的行号错位。
   不想让会员看到就切成 INACTIVE，或把日期改到今天之后。 */

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

/* =============================================================
   诊断工具（在 Apps Script 编辑器里手动执行）
   -------------------------------------------------------------
   顾客说「客户端看不到活动」时跑这个，10 秒就知道原因：
     · 表是空的        → 会员端当然没有活动
     · 全部过期/未开始 → 改日期
     · 全部 INACTIVE   → 切回 ACTIVE
     · 有 VISIBLE 的   → 后端没问题，是前端/后端版本或连线的问题
   ============================================================= */
function reportPromotions() {
  dbLoad();
  try {
    var today = todayKey();
    var all = dbFilter('promotions', function () { return true; });
    var lines = [];
    var visible = 0;

    lines.push('════ YETIPSY · Promotions 诊断 ════');
    lines.push('今天（后端时区）= ' + today);
    lines.push('Promotions 表共 ' + all.length + ' 条');

    if (!all.length) {
      lines.push('');
      lines.push('→ 这张表是空的，所以会员端「暂无活动」是正常的。');
      lines.push('  请在员工端 SETTINGS → Promotions 新增一条活动。');
    }

    all.forEach(function (p) {
      var v = promotionVisibility(p, today);
      if (v.visible) visible++;
      lines.push('  ' + (v.visible ? '✓' : '✗') + ' ' + p.promotionId +
        ' | ' + p.title +
        ' | status=' + p.status +
        ' | ' + (p.startDate || '(不限)') + ' → ' + (p.endDate || '(不限)') +
        ' | ' + v.reason);
    });

    lines.push('');
    lines.push('会员端现在会显示 ' + visible + ' 条活动。');
    if (all.length && !visible) {
      lines.push('→ 有活动但一条都看不到：');
      lines.push('  EXPIRED      = 结束日早于今天 → 员工端「改日期」');
      lines.push('  NOT_STARTED  = 开始日晚于今天 → 改开始日');
      lines.push('  INACTIVE     = 已停用 → 员工端切回 ACTIVE');
    }
    if (visible) {
      lines.push('→ 后端有活动可回传。若会员端还是看不到：');
      lines.push('  1) 会员端首页现在会显示「活动载入失败 + 错误码」，把错误码记下来');
      lines.push('  2) UNKNOWN_ACTION = 线上 Apps Script 还是旧版 → 重新贴 Code.gs 并重新部署');
      lines.push('  3) 部署后记得在「管理部署」选新版本，旧 /exec 网址会继续跑旧代码');
    }

    var text = lines.join('\n');
    Logger.log(text);
    return text;
  } finally {
    dbRelease();
  }
}
```

---

## 16. Admin.gs

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

## 17. Auth.gs

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

## 18. Code.gs

> Apps Script 里的档案名称：**`Code`**（不要打 .gs）
> ★ 唯一入口 doPost()：action 白名单、参数解析、错误包装 · 219 行 · SHA-256 `43c9d87632684876`

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
    getMemberCode: getMemberCode,
    scanMemberCode: scanMemberCode,
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
    resetStaffPassword: resetStaffPassword,

    /* ===== 2.0 点单：菜单（Phase 3）===== */
    /* 顾客端（§60） */
    getMenu: getMenu,
    getCategories: getCategories,
    getProducts: getProducts,
    getProduct: getProduct,
    getProductOptions: getProductOptions,
    /* 员工端（§61）——只能改库存状态 */
    setProductAvailability: setProductAvailability,
    /* Owner / Manager（§62） */
    createCategory: createCategory,
    updateCategory: updateCategory,
    createProduct: createProduct,
    updateProduct: updateProduct,
    archiveProduct: archiveProduct,
    createProductOption: createProductOption,
    updateProductOption: updateProductOption,

    /* ===== 2.0 点单：结帐与订单（Phase 5 / 6）===== */
    createCheckoutQuote: createCheckoutQuote,   // §43 后端重算价格 + 5 分钟 Quote
    getCheckoutQuote: getCheckoutQuote,
    placeOrder: placeOrder,                     // §44 IdempotencyKey 防重复下单
    getAppOrder: getAppOrder,                   // §17 订单追踪
    getMyOrders: getMyOrders,
    requestOrderCancellation: requestOrderCancellation,   // §53
    reorder: reorder                            // §37
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
