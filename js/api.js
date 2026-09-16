/* =============================================================
   YETIPSY — api.js
   -------------------------------------------------------------
   前端唯一的后端通讯层。
   UI 永远不知道 Google Sheet / 栏位 / Spreadsheet ID。
   未来要换成 Supabase / PostgreSQL，只需要改这个文件。

   所有请求格式：
     POST { action: 'claimOrder', token: 'xxx', data: {} }
   所有响应格式：
     { success: true,  data: {...}, error: null }
     { success: false, data: null,  error: { code, message } }
   ============================================================= */

var API = (function () {

  var NETWORK_ERROR = {
    code: 'NETWORK_ERROR',
    message: 'Network error. Please try again. / 网络错误，请重试。'
  };

  function log() {
    if (YETIPSY_CONFIG.DEBUG) {
      console.log.apply(console, arguments);
    }
  }

  /**
   * 主请求函数
   * @param {string} action
   * @param {object} data
   * @param {object} options  { sessionType: 'customer'|'staff'|null, silent: bool }
   */
  function call(action, data, options) {
    options = options || {};
    var sessionType = options.sessionType || 'auto';

    var payload = {
      action: action,
      data: data || {}
    };

    // 自动带上 session token
    if (sessionType === 'auto') {
      payload.token = AUTH.getCustomerToken() || AUTH.getStaffToken() || '';
    } else if (sessionType === 'customer') {
      payload.token = AUTH.getCustomerToken() || '';
    } else if (sessionType === 'staff') {
      payload.token = AUTH.getStaffToken() || '';
    } else {
      payload.token = '';
    }

    log('[API]', action, payload);

    return fetch(YETIPSY_CONFIG.getApiUrl(), {
      method: 'POST',
      redirect: 'follow',
      // 使用 text/plain 避免 CORS 预检（Google Apps Script 需要）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: (function () {
        if (!window.AbortController) return undefined;
        var controller = new AbortController();
        setTimeout(function () { controller.abort(); }, YETIPSY_CONFIG.API_TIMEOUT_MS || 15000);
        return controller.signal;
      })()
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          log('[API] bad json:', text.slice(0, 200));
          throw new Error('BAD_JSON');
        }
        log('[API] response', action, json);
        return normalize(json);
      })
      .catch(function (err) {
        log('[API] error', action, err);
        return { success: false, data: null, error: NETWORK_ERROR };
      });
  }

  /** 统一响应结构 */
  function normalize(json) {
    if (!json) return { success: false, data: null, error: NETWORK_ERROR };
    if (json.success) {
      return { success: true, data: json.data || {}, error: null };
    }
    return {
      success: false,
      data: json.data || null,
      error: json.error || { code: 'UNKNOWN', message: 'Something went wrong.' }
    };
  }

  /* --------------------------------------------------------
     便捷封装：失败自动显示 toast
     -------------------------------------------------------- */
  function callWithToast(action, data, options) {
    return call(action, data, options).then(function (res) {
      if (!res.success && !(options && options.silent)) {
        UI.toast(res.error.message || res.error.code, 'error');
      }
      return res;
    });
  }

  /* ========================================================
     CUSTOMER API
     ======================================================== */
  var customer = {
    login: function (phone, name, otp) {
      return call('customerLogin', { phone: phone, name: name, verificationToken: otp || '' }, { sessionType: null });
    },
    requestOtp: function (phone) {
      return call('requestCustomerOtp', { phone: phone, channel: YETIPSY_CONFIG.OTP_CHANNEL || 'WHATSAPP' }, { sessionType: null });
    },
    verifyOtp: function (phone, code) {
      return call('verifyCustomerOtp', { phone: phone, code: code }, { sessionType: null });
    },
    logout: function () {
      return call('customerLogout', {}, { sessionType: 'customer' });
    },
    getProfile: function () {
      return call('getProfile', {}, { sessionType: 'customer' });
    },
    updateProfile: function (name, birthday) {
      return call('updateProfile', { name: name, birthday: birthday }, { sessionType: 'customer' });
    },
    getMembership: function () {
      return call('getMembership', {}, { sessionType: 'customer' });
    },
    getPoints: function () {
      return call('getPoints', {}, { sessionType: 'customer' });
    },
    getPointHistory: function (limit) {
      return call('getPointHistory', { limit: limit || 50 }, { sessionType: 'customer' });
    },
    getWallet: function () {
      return call('getWallet', {}, { sessionType: 'customer' });
    },
    getWalletHistory: function (limit) {
      return call('getWalletHistory', { limit: limit || 50 }, { sessionType: 'customer' });
    },
    getPromotions: function () {
      return call('getPromotions', {}, { sessionType: 'customer' });
    },
    getOrderHistory: function (limit) {
      return call('getOrderHistory', { limit: limit || 50 }, { sessionType: 'customer' });
    },
    getClaimByToken: function (token) {
      return call('getClaimByToken', { token: token }, { sessionType: 'auto' });
    },
    getClaimByCode: function (code) {
      return call('getClaimByCode', { code: code }, { sessionType: 'auto' });
    },

    claimOrder: function (tokenOrCode) {
      var payload = (typeof tokenOrCode === 'string')
        ? { token: tokenOrCode }
        : (tokenOrCode || {});
      return call('claimOrder', payload, { sessionType: 'auto' });
    },
    getPendingReward: function (rewardId) {
      return call('getPendingReward', { rewardId: rewardId || '' }, { sessionType: 'customer' });
    },
    claimReward: function (rewardId) {
      return call('claimReward', { rewardId: rewardId }, { sessionType: 'customer' });
    }
  };

  /* ========================================================
     STAFF API
     ======================================================== */
  var staff = {
    login: function (username, password) {
      return call('staffLogin', { username: username, password: password }, { sessionType: null });
    },
    logout: function () {
      return call('staffLogout', {}, { sessionType: 'staff' });
    },
    getSession: function () {
      return call('getStaffSession', {}, { sessionType: 'staff' });
    },
    getDashboard: function (date) {
      return call('getDashboard', { date: date || '' }, { sessionType: 'staff' });
    },
    createClaim: function (source, externalOrderId, amountSen, note) {
      return call('createClaim', {
        source: source,
        externalOrderId: externalOrderId,
        amount: amountSen,
        note: note || ''
      }, { sessionType: 'staff' });
    },
    cancelClaim: function (claimId) {
      return call('cancelClaim', { claimId: claimId }, { sessionType: 'staff' });
    },
    getClaim: function (claimId) {
      return call('getClaim', { claimId: claimId }, { sessionType: 'staff' });
    },
    listClaims: function (limit) {
      return call('listClaims', { limit: limit || 20 }, { sessionType: 'staff' });
    },
    searchCustomer: function (keyword) {
      return call('searchCustomer', { keyword: keyword }, { sessionType: 'staff' });
    },
    getCustomer: function (customerId) {
      return call('getCustomer', { customerId: customerId }, { sessionType: 'staff' });
    },
    getCustomerHistory: function (customerId) {
      return call('getCustomerHistory', { customerId: customerId }, { sessionType: 'staff' });
    },
    calculateWalletRedemption: function (customerId, billSen) {
      return call('calculateWalletRedemption', {
        customerId: customerId,
        billAmount: billSen
      }, { sessionType: 'staff' });
    },
    redeemWallet: function (customerId, billSen, walletSen, externalOrderId, source, note) {
      return call('redeemWallet', {
        customerId: customerId,
        billAmount: billSen,
        walletAmount: walletSen,
        externalOrderId: externalOrderId || '',
        source: source || 'DIRECT',
        note: note || ''
      }, { sessionType: 'staff' });
    },
    getOrders: function (limit, filters) {
      var d = { limit: limit || 30 };
      if (filters) {
        if (filters.status) d.status = filters.status;
        if (filters.from) d.from = filters.from;
        if (filters.to) d.to = filters.to;
        if (filters.keyword) d.keyword = filters.keyword;
      }
      return call('getOrders', d, { sessionType: 'staff' });
    },
    cancelOrder: function (orderId, reason) {
      return call('cancelOrder', { orderId: orderId, reason: reason || '' }, { sessionType: 'staff' });
    }
  };

  /* ========================================================
     MANAGER / OWNER API
     ======================================================== */
  var admin = {
    manualWalletAdjustment: function (customerId, amountSen, reason) {
      return call('manualWalletAdjustment', {
        customerId: customerId,
        amount: amountSen,
        reason: reason || ''
      }, { sessionType: 'staff' });
    },
    manualPointAdjustment: function (customerId, points, reason) {
      return call('manualPointAdjustment', {
        customerId: customerId,
        points: points,
        reason: reason || ''
      }, { sessionType: 'staff' });
    },
    getSettings: function () {
      return call('getSettings', {}, { sessionType: 'staff' });
    },
    updateSetting: function (key, value) {
      return call('updateSetting', { key: key, value: value }, { sessionType: 'staff' });
    },
    getPromotionsAdmin: function () {
      return call('getPromotionsAdmin', {}, { sessionType: 'staff' });
    },
    createPromotion: function (promo) {
      return call('createPromotion', promo, { sessionType: 'staff' });
    },
    updatePromotion: function (promotionId, patch) {
      patch.promotionId = promotionId;
      return call('updatePromotion', patch, { sessionType: 'staff' });
    },
    getAuditLogs: function (limit, filters) {
      var d = { limit: limit || 100 };
      if (filters) {
        if (filters.action) d.action = filters.action;
        if (filters.userId) d.userId = filters.userId;
      }
      return call('getAuditLogs', d, { sessionType: 'staff' });
    },
    listStaff: function () {
      return call('listStaff', {}, { sessionType: 'staff' });
    },
    createStaff: function (username, password, role) {
      return call('createStaff', {
        username: username,
        password: password,
        role: role
      }, { sessionType: 'staff' });
    },
    setStaffStatus: function (staffId, status) {
      return call('setStaffStatus', { staffId: staffId, status: status }, { sessionType: 'staff' });
    },
    resetStaffPassword: function (staffId, password) {
      return call('resetStaffPassword', { staffId: staffId, password: password }, { sessionType: 'staff' });
    }
  };

  /* ========================================================
     PUBLIC
     ======================================================== */
  var system = {
    ping: function () {
      return call('ping', {}, { sessionType: null });
    },
    getPublicSettings: function () {
      return call('getPublicSettings', {}, { sessionType: null });
    }
  };

  return {
    call: call,
    callWithToast: callWithToast,
    customer: customer,
    staff: staff,
    admin: admin,
    system: system
  };
})();
