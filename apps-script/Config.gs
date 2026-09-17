/* =============================================================
   YETIPSY MINI APP 1.3 — Config.gs
   -------------------------------------------------------------
   所有「会变的东西」都放这里：Sheet 名称、栏位、默认设置。
   业务逻辑不应该 hardcode 任何栏位名称。

   这一份档案是前端（js/api.js）与后端唯一的共同契约来源：
   前端只知道 action 名称与 JSON 栏位，永远不知道 Sheet 结构。
   ============================================================= */

/** 版本（ping 会回传，方便确认线上跑的是哪一版） */
var APP_VERSION = '1.6.1';

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
