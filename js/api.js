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
    message: 'Cannot reach the server. Please check your connection. / 无法连接后端，请检查网络或 API URL。'
  };

  /* 线上版没有填 API_URL：不允许静默使用本机演示资料 */
  var NOT_CONFIGURED = {
    code: 'BACKEND_NOT_CONFIGURED',
    message: 'Backend API URL is not configured. Set API_URL in js/config.js. / ' +
             '尚未配置后端 API 地址，请在 js/config.js 填入 API_URL。'
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
  /* ==========================================================
     快取（stale-while-revalidate）
     ----------------------------------------------------------
     目的：会员端每点一次都等后端，太慢。做法是
       ① 有快取 → 立刻回快取（画面马上出来）
       ② 同时背景再问一次后端 → 有新资料就再回一次
     所以页面只要 .then(render) 写一次，快取与最新资料都会经过它，
     而且 render 本来就是幂等的（重画同一份资料没有副作用）。

     只用在「只读」的会员端资料上；钱包扣款、下单、扫码、
     条码这些一律不吃快取（一定问后端）。
     ========================================================== */

  var CACHE_PREFIX = 'yt_cache_v1:';

  /* 各种只读资料的保鲜期：过了就当没有，直接等后端 */
  var READ_TTL = {
    getMenu:           10 * 60 * 1000,   // 酒单：10 分钟（改菜单后叫一次就更新）
    getPromotions:      5 * 60 * 1000,
    getProfile:         90 * 1000,
    getMembership:      5 * 60 * 1000,
    getPendingReward:   60 * 1000,
    getMyOrders:        60 * 1000,
    getWallet:          60 * 1000,
    getWalletHistory:   60 * 1000,
    getPointHistory:    60 * 1000,
    getOrderHistory:    60 * 1000
  };

  var memCache = {};

  var SCOPE_KEY = 'yt_cache_scope';

  /**
   * 快取要分「谁的快取」：同手机换人登入时，绝不能拿到上一位会员的资料。
   * 每次登入 / 登出都会换一组 scope，旧资料自然读不到（也会被清掉）。
   */
  function cacheScope() {
    var v = '';
    try {
      v = window.localStorage.getItem(SCOPE_KEY) || '';
      if (!v) {
        v = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        window.localStorage.setItem(SCOPE_KEY, v);
      }
    } catch (e) { return 'mem'; }
    return v;
  }

  function newScope() {
    var v = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { window.localStorage.setItem(SCOPE_KEY, v); } catch (e) {}
    return v;
  }

  function cacheKey(action, data) {
    return CACHE_PREFIX + cacheScope() + ':' + action + ':' + JSON.stringify(data || {});
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
  }

  function cacheRead(key, ttlMs) {
    var hit = memCache[key];
    if (!hit) {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw) hit = JSON.parse(raw);
      } catch (e) { hit = null; }
    }
    if (!hit || typeof hit.t !== 'number') return null;
    if (ttlMs && (Date.now() - hit.t) > ttlMs) return null;
    memCache[key] = hit;
    return clone(hit.v);
  }

  function cacheWrite(key, value) {
    if (value === undefined || value === null) return;
    var size = 0;
    try { size = JSON.stringify(value).length; } catch (e) { return; }
    if (size > 200000) return;                     // 太大的不要塞进 localStorage
    var hit = { t: Date.now(), v: clone(value) };
    memCache[key] = hit;
    try { window.localStorage.setItem(key, JSON.stringify(hit)); } catch (e) {}
  }

  function cacheDrop(action, data) {
    var key = cacheKey(action, data);
    delete memCache[key];
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  /** 资料被改过（下单 / 兑奖 / 改资料）之后清掉全部只读快取，下次重新抓 */
  function cacheClear() {
    memCache = {};
    try {
      var keys = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) {}
    newScope();                       // 换一组 scope：旧资料绝对读不回来
  }

  /** 给页面用：同步拿快取（酒单页要立刻画清单与规格） */
  function cachePeek(action, data, ttlMs) {
    return cacheRead(cacheKey(action, data), ttlMs || READ_TTL[action] || 120000);
  }

  /**
   * 先画快取、再补最新资料。回传的是一个「可以回两次」的 thenable：
   * 有快取就先回一次（res.cached = true），后端回来再回一次。
   * 页面写 .then(render) 就同时吃到两者。
   */
  function liveCall(action, data, options, key, ttl) {
    var cached = cacheRead(key, ttl);
    var subs = [];
    var started = false;

    function emit(res) {
      var list = subs.slice();
      subs.length = 0;
      for (var i = 0; i < list.length; i++) {
        try { list[i](res); } catch (e) { log('[API] cached subscriber failed', e); }
      }
    }

    function refresh() {
      if (started) return;
      started = true;
      send(action, data, options).then(function (res) {
        if (res.success) cacheWrite(key, res.data);
        else if (res.error && res.error.code === 'INVALID_SESSION') cacheDrop(action, data);
        emit(res);
      });
    }

    var live = {
      then: function (onFulfilled) {
        if (cached) {
          var first = { success: true, data: cached, error: null, cached: true };
          Promise.resolve().then(function () { if (onFulfilled) onFulfilled(first); });
        }
        if (typeof onFulfilled === 'function') subs.push(onFulfilled);
        return live;
      },
      catch: function () { return live; },
      finally: function (fn) { if (typeof fn === 'function') fn(); return live; }
    };

    /* 不用等 .then：一开始就先去问后端（预载时没人订阅也要抓） */
    refresh();
    return live;
  }

  function call(action, data, options) {
    options = options || {};
    if (options.cache) {
      var ttl = options.cacheTtl || READ_TTL[action] || 120000;
      return liveCall(action, data, options, cacheKey(action, data), ttl);
    }
    return send(action, data, options);
  }

  function send(action, data, options) {
    options = options || {};
    var sessionType = options.sessionType || 'auto';

    /* 线上版没有 API_URL → 立刻报错，不假装成功 */
    if (YETIPSY_CONFIG.IS_MISCONFIGURED && YETIPSY_CONFIG.IS_MISCONFIGURED()) {
      log('[API] backend not configured');
      return Promise.resolve({ success: false, data: null, error: NOT_CONFIGURED });
    }

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
    /* ① 先查号码：exists = false → 跳注册；exists = true → 问密码 */
    checkPhone: function (phone) {
      return call('checkCustomerPhone', { phone: phone }, { sessionType: null });
    },
    /* ② 注册（号码还没被用过） */
    register: function (phone, name, password) {
      return call('customerRegister',
        { phone: phone, name: name || '', password: password }, { sessionType: null });
    },
    /* ③ 登录（号码已存在 → 必须密码正确） */
    login: function (phone, password) {
      return call('customerLogin', { phone: phone, password: password }, { sessionType: null });
    },
    /* ④ 旧会员（还没有密码）第一次设密码 */
    setFirstPassword: function (phone, password, name) {
      return call('customerSetFirstPassword',
        { phone: phone, password: password, name: name || '' }, { sessionType: null });
    },
    /* ⑤ 会员自己改密码 */
    /** 会员条码内容（员工扫码验证身分用；N 秒自动换一条） */
    getMemberCode: function () {
      return call('getMemberCode', {}, { sessionType: 'customer' });
    },

    changePassword: function (currentPassword, newPassword) {
      return call('changeCustomerPassword',
        { currentPassword: currentPassword, newPassword: newPassword }, { sessionType: 'customer' });
    },
    logout: function () {
      return call('customerLogout', {}, { sessionType: 'customer' });
    },
    getProfile: function () {
      return call('getProfile', {}, { sessionType: 'customer', cache: true });
    },
    updateProfile: function (name, birthday) {
      return call('updateProfile', { name: name, birthday: birthday }, { sessionType: 'customer' });
    },
    getMembership: function () {
      return call('getMembership', {}, { sessionType: 'customer', cache: true });
    },
    getPoints: function () {
      return call('getPoints', {}, { sessionType: 'customer' });
    },
    getPointHistory: function (limit) {
      return call('getPointHistory', { limit: limit || 50 }, { sessionType: 'customer', cache: true });
    },
    getWallet: function () {
      return call('getWallet', {}, { sessionType: 'customer', cache: true });
    },
    getWalletHistory: function (limit) {
      return call('getWalletHistory', { limit: limit || 50 }, { sessionType: 'customer', cache: true });
    },
    getPromotions: function () {
      return call('getPromotions', {}, { sessionType: 'customer', cache: true });
    },
    getOrderHistory: function (limit) {
      return call('getOrderHistory', { limit: limit || 50 }, { sessionType: 'customer', cache: true });
    },
    getClaimByToken: function (token) {
      return call('getClaimByToken', { token: token }, { sessionType: 'auto' });
    },
    getClaimByCode: function (code) {
      return call('getClaimByCode', { code: code }, { sessionType: 'auto' });
    },

    /* 认领一张 Foodcourt 小票。tokenOrCode 可以是三种形式：
         · 32 位 token（顾客扫店员 QR 取得）
         · 4 位短码（顾客手输，字母表刻意去掉易看错的 I / O / 0 / 1）
         · { token: ..., code: ... } 物件（js/claim.js 用这个）

       ★ 字串不能一律当 token 送：后端 findClaimByTokenOrCode 见到 token
         非空就只查 token 哈希、直接返回，永远不会退回查短码 ——
         把 4 位短码当 token 送会拿到 INVALID_CLAIM_TOKEN。
         参数名叫 tokenOrCode，行为就得真的两种都收。 */
    claimOrder: function (tokenOrCode) {
      var payload;
      if (typeof tokenOrCode === 'string') {
        var s = tokenOrCode.trim();
        payload = /^[A-Z2-9]{4}$/.test(s.toUpperCase())
          ? { code: s.toUpperCase() }
          : { token: s };
      } else {
        payload = tokenOrCode || {};
      }
      return call('claimOrder', payload, { sessionType: 'auto' });
    },
    getPendingReward: function (rewardId) {
      return call('getPendingReward', { rewardId: rewardId || '' }, { sessionType: 'customer', cache: true });
    },
    claimReward: function (rewardId) {
      return call('claimReward', { rewardId: rewardId }, { sessionType: 'customer' });
    },

    /* ============ 2.0 点单：菜单（Phase 3）============ */
    /**
     * 一次拿 Categories + Products + Options（§82）。
     * filter: { search, tag, categoryId }
     */
    getMenu: function (filter) {
      return call('getMenu', filter || {}, { sessionType: 'customer', cache: true });
    },
    getCategories: function () {
      return call('getCategories', {}, { sessionType: 'customer' });
    },
    getProducts: function (categoryId) {
      return call('getProducts', { categoryId: categoryId || '' }, { sessionType: 'customer' });
    },
    /** Product Detail：商品 + 规格分组，一次就够 */
    getProduct: function (productId) {
      return call('getProduct', { productId: productId }, { sessionType: 'customer', cache: true });
    },
    getProductOptions: function (productId) {
      return call('getProductOptions', { productId: productId }, { sessionType: 'customer' });
    },

    /* ============ 2.0 点单：结帐（Phase 5，§43）============ */
    /**
     * 取得结帐报价。价格由后端重算，这里送过去的金额一律被忽略（§41）。
     * @param {object} req { items:[{productId,quantity,options:[optionId],note}],
     *                       orderType:'TABLE'|'COUNTER'|'TAKEAWAY', tableNumber,
     *                       useWallet, customerNote }
     */
    createCheckoutQuote: function (req) {
      return call('createCheckoutQuote', req || {}, { sessionType: 'customer' });
    },
    getCheckoutQuote: function (quoteToken) {
      return call('getCheckoutQuote', { quoteToken: quoteToken }, { sessionType: 'customer' });
    },

    /* ============ 2.0 点单：订单（Phase 6，§44 §17）============ */
    /** 下单必须带 Quote 给的 idempotencyKey，连按两次也只会有一张订单 */
    placeOrder: function (req) {
      return call('placeOrder', req || {}, { sessionType: 'customer' });
    },
    getAppOrder: function (appOrderId) {
      return call('getAppOrder', { appOrderId: appOrderId }, { sessionType: 'customer' });
    },
    getMyOrders: function (filters) {
      return call('getMyOrders', filters || {}, { sessionType: 'customer', cache: true });
    },
    requestOrderCancellation: function (appOrderId, reason) {
      return call('requestOrderCancellation',
        { appOrderId: appOrderId, reason: reason || '' }, { sessionType: 'customer' });
    },
    reorder: function (appOrderId) {
      return call('reorder', { appOrderId: appOrderId }, { sessionType: 'customer' });
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
    /** 扫顾客的会员条码 → 回传顾客资料 + verifyToken（抵扣时必须带回） */
    scanMemberCode: function (payload) {
      return call('scanMemberCode', { payload: payload }, { sessionType: 'staff' });
    },

    calculateWalletRedemption: function (customerId, billSen) {
      return call('calculateWalletRedemption', {
        customerId: customerId,
        billAmount: billSen
      }, { sessionType: 'staff' });
    },
    redeemWallet: function (customerId, billSen, walletSen, externalOrderId, source, note, verifyToken) {
      return call('redeemWallet', {
        customerId: customerId,
        billAmount: billSen,
        walletAmount: walletSen,
        externalOrderId: externalOrderId || '',
        source: source || 'DIRECT',
        note: note || '',
        verifyToken: verifyToken || ''
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
    },

    /* ===== 2.0 点单：库存状态（§61，Staff 唯一的菜单权限 §32）===== */
    /** @param {boolean} available  false = SOLD OUT */
    setProductAvailability: function (productId, available) {
      return call('setProductAvailability',
        { productId: productId, available: !!available }, { sessionType: 'staff' });
    },
    /** 上架 / 下架（状态类操作，任何员工都能做 §32） */
    setProductStatus: function (productId, status) {
      return call('setProductStatus',
        { productId: productId, status: status }, { sessionType: 'staff' });
    },

    /* ============ 员工端 POS 进单：foodcourt 单据 → 扫会员码进分 ============ */

    /**
     * 录入一张 foodcourt 单据（这时还不知道是谁）。
     * @param {object} data { amount(sen), externalOrderId?, source?, note? }
     */
    createPosTicket: function (data) {
      return call('createPosTicket', data || {}, { sessionType: 'staff' });
    },

    /** POS 台画面：待进单队列 + 今日已进单统计 */
    getPosQueue: function (data) {
      return call('getPosQueue', data || {}, { sessionType: 'staff' });
    },

    /**
     * 扫过顾客会员码之后，把单据归给会员并进分。
     * 后端按 POINTS_PER_RM 与 REWARD_TIERS 自动发积分与 Reward（§57 §58），
     * 并按 §56 六小时内只算一次到店。
     * @param {object} data { orderId, customerId, verifyToken }
     */
    bindPosTicket: function (data) {
      return call('bindPosTicket', data || {}, { sessionType: 'staff' });
    },

    /** 录错单号 / 金额时取消（还没进分才可以） */
    cancelPosTicket: function (orderId, reason) {
      return call('cancelPosTicket',
        { orderId: orderId, reason: reason || '' }, { sessionType: 'staff' });
    },

    /* ===== 2.0 点单：菜单管理（§62，MANAGER / OWNER 限定）===== */
    createCategory: function (data) {
      return call('createCategory', data || {}, { sessionType: 'staff' });
    },
    updateCategory: function (data) {
      return call('updateCategory', data || {}, { sessionType: 'staff' });
    },
    createProduct: function (data) {
      return call('createProduct', data || {}, { sessionType: 'staff' });
    },
    updateProduct: function (data) {
      return call('updateProduct', data || {}, { sessionType: 'staff' });
    },
    archiveProduct: function (productId) {
      return call('archiveProduct', { productId: productId }, { sessionType: 'staff' });
    },
    createProductOption: function (data) {
      return call('createProductOption', data || {}, { sessionType: 'staff' });
    },
    updateProductOption: function (data) {
      return call('updateProductOption', data || {}, { sessionType: 'staff' });
    },

    /* ============ 2.0 点单：员工订单看板（Phase 7，§19 §20 §61）============ */
    getIncomingOrders: function () {
      return call('getIncomingOrders', {}, { sessionType: 'staff' });
    },
    getActiveOrders: function () {
      return call('getActiveOrders', {}, { sessionType: 'staff' });
    },
    acceptOrder: function (appOrderId) {
      return call('acceptOrder', { appOrderId: appOrderId }, { sessionType: 'staff' });
    },
    startPreparing: function (appOrderId) {
      return call('startPreparing', { appOrderId: appOrderId }, { sessionType: 'staff' });
    },
    markReady: function (appOrderId) {
      return call('markReady', { appOrderId: appOrderId }, { sessionType: 'staff' });
    },
    /** §54 这一步才真的扣钱包 */
    markPaymentPaid: function (appOrderId, paymentMethod, paymentReference) {
      return call('markPaymentPaid', {
        appOrderId: appOrderId,
        paymentMethod: paymentMethod || 'COUNTER',
        paymentReference: paymentReference || ''
      }, { sessionType: 'staff' });
    },
    /** §55 幂等：连按两次只会发一次积分 */
    completeOrder: function (appOrderId) {
      return call('completeOrder', { appOrderId: appOrderId }, { sessionType: 'staff' });
    },
    cancelAppOrder: function (appOrderId, reason) {
      return call('cancelAppOrder',
        { appOrderId: appOrderId, reason: reason || '' }, { sessionType: 'staff' });
    },
    /** §65 暂停 / 恢复接单 */
    setOrderingPaused: function (paused) {
      return call('setOrderingPaused', { paused: !!paused }, { sessionType: 'staff' });
    },
    /* 2.0 菜单管理（§32）—— 只有 MANAGER / OWNER 能改。
       用 getAdminMenu：回传全部状态（含已下架）的商品 */
    getAdminMenu: function () {
      return call('getAdminMenu', {}, { sessionType: 'staff' });
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
    },
    /* ============ 2.0 业绩分析（Phase 11，§50 §51 §52 §62）============ */
    getSalesAnalytics: function (days) {
      return call('getSalesAnalytics', { days: days || 7 }, { sessionType: 'staff' });
    },
    getProductAnalytics: function (days, limit) {
      return call('getProductAnalytics',
        { days: days || 7, limit: limit || 10 }, { sessionType: 'staff' });
    },
    getMemberAnalytics: function (days) {
      return call('getMemberAnalytics', { days: days || 30 }, { sessionType: 'staff' });
    },

    /* 会员忘记密码 / 号码被抢注 → Manager+ 在这里重设 */
    resetCustomerPassword: function (customerId, password) {
      return call('resetCustomerPassword',
        { customerId: customerId, password: password }, { sessionType: 'staff' });
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

  /* --------------------------------------------------------
     预载：会员端首页一有空就把最常用的资料先抓好，
     这样点进酒单 / 我的订单是「立刻」出来，不是「等一次」
     -------------------------------------------------------- */
  function prefetchCustomer(which) {
    if (!AUTH.isCustomerLoggedIn || !AUTH.isCustomerLoggedIn()) return;
    var jobs = which || ['getMenu', 'getMyOrders', 'getWallet'];
    if (jobs.indexOf('getMenu') >= 0) cachePeekAsync('getMenu', {});
    if (jobs.indexOf('getMyOrders') >= 0) cachePeekAsync('getMyOrders', { limit: 30 });
    if (jobs.indexOf('getWallet') >= 0) {
      cachePeekAsync('getWallet', {});
      cachePeekAsync('getWalletHistory', { limit: 50 });
    }
    if (jobs.indexOf('getHistory') >= 0) {
      cachePeekAsync('getOrderHistory', { limit: 50 });
      cachePeekAsync('getPointHistory', { limit: 50 });
    }
  }

  /** 已经新鲜就不用再问一次 */
  function cachePeekAsync(action, data) {
    if (cachePeek(action, data)) return;
    call(action, data, { sessionType: 'customer', cache: true });
  }

  return {
    call: call,
    callWithToast: callWithToast,
    cache: {
      peek: cachePeek,
      drop: cacheDrop,
      clear: cacheClear,
      prefetch: prefetchCustomer,
      TTL: READ_TTL
    },
    customer: customer,
    staff: staff,
    admin: admin,
    system: system
  };
})();
