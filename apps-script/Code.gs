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
