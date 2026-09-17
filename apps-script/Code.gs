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
    reorder: reorder,                           // §37

    /* ===== 2.0 点单：员工订单看板（Phase 7）===== */
    getIncomingOrders: getIncomingOrders,       // §19 NEW 栏
    getActiveOrders: getActiveOrders,           // §20 三栏看板 + §50 今日统计
    acceptOrder: acceptOrder,
    startPreparing: startPreparing,
    markReady: markReady,                       // §18 顾客端会显示取酒提示
    completeOrder: completeOrder,               // §55 幂等 · §22 这一步才发积分
    cancelAppOrder: cancelAppOrder,             // §54 已扣钱包要 REVERSAL
    markPaymentPaid: markPaymentPaid,           // §54 这一步才真的扣钱包
    setOrderingPaused: setOrderingPaused,       // §65 暂停 / 恢复接单

    /* ===== 2.0 点单：业绩分析（Phase 11）===== */
    getSalesAnalytics: getSalesAnalytics,       // §50 今日统计 + §51 通路业绩
    getProductAnalytics: getProductAnalytics,   // §50 TOP PRODUCTS
    getMemberAnalytics: getMemberAnalytics,     // §52 会员分析

    /* ★ 员工专用酒单：回传全部状态（含已下架）的商品，管理页才载得出来 */
    getAdminMenu: getAdminMenu,
    /* ★ 任何员工都能上下架商品（状态类操作，§32） */
    setProductStatus: setProductStatus,

    /* ★ 员工端主流程：扫会员码 → 输金额 → 自动发积分与 Reward（保留，备用） */
    grantOrder: grantOrder,

    /* ★ 2.1 员工端 POS 进单：foodcourt 单据 → 待进单队列 → 扫会员码进分 */
    createPosTicket: createPosTicket,
    getPosQueue: getPosQueue,
    bindPosTicket: bindPosTicket,
    cancelPosTicket: cancelPosTicket
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
