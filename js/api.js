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
    getOrderHistory:    60 * 1000,

    /* 员工端：打开就能用（现场网路慢的时候差很多） */
    getAdminMenu:        5 * 60 * 1000,
    getDashboard:       30 * 1000,
    getPosQueue:        30 * 1000,
    getActiveOrders:    20 * 1000,
    listClaims:         30 * 1000,

    /* 員工端其他页面：先给上次的资料，后端回来再补（打开就有东西看） */
    getOrders:          30 * 1000,
    getAuditLogs:       30 * 1000,
    getSettings:         5 * 60 * 1000,
    getPromotionsAdmin:  5 * 60 * 1000,
    listStaff:           5 * 60 * 1000,
    getSalesAnalytics:   90 * 1000,
    getProductAnalytics: 90 * 1000,
    getMemberAnalytics:  90 * 1000,
    getCustomer:         30 * 1000,
    getCustomerHistory:  30 * 1000,
    getPoints:           60 * 1000,
    getPublicSettings:    5 * 60 * 1000
  };

  var memCache = {};

  /* ----------------------------------------------------------
     这些动作本来就会慢（Apps Script 冷启动 + 扫整张表）：
     给它们更长的 timeout，不要 15 秒就判 NETWORK_ERROR。
     ---------------------------------------------------------- */
  var TIMEOUT_MS = {
    getActiveOrders:      30000,
    getDashboard:         30000,
    getPosQueue:          30000,
    getAdminMenu:         30000,
    getMenu:              30000,
    getAppOrder:          30000,
    getMyOrders:          30000,
    getOrderHistory:      30000,
    getPointHistory:      30000,
    getWalletHistory:     30000,
    listClaims:           30000,
    searchCustomer:       30000,
    getCustomerHistory:   30000,
    getSalesAnalytics:    40000,
    getProductAnalytics:  40000,
    getMemberAnalytics:   40000
  };

  /* 轮询用：快取比这个还新就不要再问后端（省掉一半以上的请求 → 现场稳很多） */
  /* 这几个动作是「现场即时状态」：
     绝对不要先把快取画出来（旧的栏位会让员工看到卡片跳回去），
     一律等后端；连线失败才用快取当后备。 */
  var LIVE_ONLY = {
    getActiveOrders: 1,
    getPosQueue:     1
  };

  var FRESH_MS = {
    /* 看板 / 待进单：每次轮询都往后端问一次。
       新订单早一秒看到就是早一秒开始做 —— 这两个动作本来就只有
       看板 / POS 在轮询（各 8 秒一次），不会增加后端负担。 */
    getActiveOrders: 0,
    getPosQueue:     0,
    getAppOrder:     4000,
    getMyOrders:    15000,
    getDashboard:   10000,
    listClaims:     10000
  };

  /* 只读动作：失败可以自动重试（写动作绝不重试，避免重复下单 / 重复进分） */
  var RETRY_SAFE = {
    ping: 1, getPublicSettings: 1, getProfile: 1, getMembership: 1, getPoints: 1,
    getPointHistory: 1, getWallet: 1, getWalletHistory: 1, getPromotions: 1,
    getOrderHistory: 1, getMenu: 1, getCategories: 1, getProducts: 1, getProduct: 1,
    getProductOptions: 1, getMyOrders: 1, getAppOrder: 1, getIncomingOrders: 1,
    getActiveOrders: 1, getDashboard: 1, getClaim: 1, listClaims: 1,
    getCustomer: 1, getCustomerHistory: 1, searchCustomer: 1, getOrders: 1,
    getSettings: 1, getPromotionsAdmin: 1, getAuditLogs: 1, listStaff: 1,
    getSalesAnalytics: 1, getProductAnalytics: 1, getMemberAnalytics: 1,
    getAdminMenu: 1, getPosQueue: 1, getStaffSession: 1
  };

  var RETRY_DELAYS = [800, 2200];        // 最多重试 2 次

  /* ----------------------------------------------------------
     连线状态：页面可以用 API.onNetwork(fn) 显示「连线不稳」提示
       'ok'      → 刚刚成功
       'slow'    → 第一次失败，正在重试
       'offline' → 重试用完了（有快取就继续显示上次资料）
     ---------------------------------------------------------- */
  var netState = 'ok';
  var netSubs = [];

  function netEmit(state) {
    if (state === netState) return;
    netState = state;
    for (var i = 0; i < netSubs.length; i++) {
      try { netSubs[i](state); } catch (e) {}
    }
  }

  function onNetwork(fn) {
    netSubs.push(fn);
    try { fn(netState); } catch (e) {}
    return function () {
      var i = netSubs.indexOf(fn);
      if (i >= 0) netSubs.splice(i, 1);
    };
  }

  function isNetworkError(res) {
    return !!res && !res.success && res.error &&
      (res.error.code === 'NETWORK_ERROR' || res.error.code === 'SERVER_BUSY');
  }

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

  function cacheReadAge(key, ttlMs) {
    var hit = memCache[key];
    if (!hit) {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw) hit = JSON.parse(raw);
      } catch (e) { hit = null; }
    }
    if (!hit || typeof hit.t !== 'number') return null;
    var age = Date.now() - hit.t;
    if (ttlMs && age > ttlMs) return null;
    memCache[key] = hit;
    return { v: clone(hit.v), age: age };
  }

  function cacheRead(key, ttlMs) {
    var hit = cacheReadAge(key, ttlMs);
    return hit ? hit.v : null;
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

  /**
   * 给页面用：把刚拿到的「权威资料」写进快取。
   * 例：员工按了「接单并制作」，后端回传最新看板快照 →
   *     顺手写进快取，之后任何快取优先的显示都会是新状态，
   *     不会又跳出旧的栏位。
   */
  function cachePut(action, data, value) {
    try { cacheWrite(cacheKey(action, data), value); } catch (e) {}
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
    var hit = cacheReadAge(key, ttl);
    var cached = hit ? hit.v : null;
    var freshFor = options.freshMs || FRESH_MS[action] || 0;
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
      /* 轮询：快取比设定还新就不要打扰后端（现场一半以上的请求可以省掉） */
      if (!options.force && hit && freshFor > 0 && hit.age < freshFor) return;
      started = true;
      send(action, data, options).then(function (res) {
        if (res.success) {
          cacheWrite(key, res.data);
          emit(res);
          return;
        }
        if (res.error && res.error.code === 'INVALID_SESSION') cacheDrop(action, data);
        /* 连线失败但有上次的资料 → 继续用，并标记 stale，不要整页变错误 */
        if (cached && isNetworkError(res)) {
          emit({ success: true, data: cached, error: null, cached: true, stale: true });
          return;
        }
        emit(res);
      });
    }

    var live = {
      then: function (onFulfilled) {
        if (cached && !options.noCachedEmit) {
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
      if (LIVE_ONLY[action]) {
        /* 复制一份设定，不要动到呼叫端传进来的物件 */
        var liveOpts = {};
        for (var k in options) if (options.hasOwnProperty(k)) liveOpts[k] = options[k];
        liveOpts.noCachedEmit = true;
        options = liveOpts;
      }
      return liveCall(action, data, options, cacheKey(action, data), ttl);
    }
    return send(action, data, options);
  }

  /* ----------------------------------------------------------
     同时最多 2 个请求（Apps Script 一次只能跑一个，硬塞只会互相拖慢），
     其余排队。再加上「完全相同的请求只送一次」的合并。
     ---------------------------------------------------------- */
  var MAX_CONCURRENT = 2;
  var running = 0;
  var waiting = [];
  var inflight = {};

  function pump() {
    while (running < MAX_CONCURRENT && waiting.length) {
      waiting.shift()();
    }
  }

  /**
   * 排队等一个发送名额。
   * priority = true（写动作：接单 / 做好了 / 收款…）→ 不排队，直接送，
   * 免得员工的点击卡在轮询后面等好几秒。
   */
  function withSlot(task, priority) {
    return new Promise(function (resolve) {
      function run() {
        running += 1;
        task().then(function (v) { running -= 1; pump(); resolve(v); },
                    function () { running -= 1; pump(); resolve({ success: false, data: null, error: NETWORK_ERROR }); });
      }
      if (priority) { run(); return; }
      waiting.push(run);
      pump();
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** 送一次（不含重试） */
  function attempt(payload, timeoutMs, priority) {
    var action = payload.action;
    return withSlot(function () {
      return fetch(YETIPSY_CONFIG.getApiUrl(), {
        method: 'POST',
        redirect: 'follow',
        // 使用 text/plain 避免 CORS 预检（Google Apps Script 需要）
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: (function () {
          if (!window.AbortController) return undefined;
          var controller = new AbortController();
          setTimeout(function () { controller.abort(); }, timeoutMs);
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
    }, priority);
  }

  /**
   * 主请求函数
   * @param {string} action
   * @param {object} data
   * @param {object} options  { sessionType: 'customer'|'staff'|null, silent: bool,
   *                            cache: bool, timeoutMs: number, retry: bool }
   */
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

    var timeoutMs = options.timeoutMs || TIMEOUT_MS[action] ||
                    YETIPSY_CONFIG.API_TIMEOUT_MS || 20000;
    var retries = (RETRY_SAFE[action] && options.retry !== false) ? RETRY_DELAYS.length : 0;

    /* 同一个请求（同 action + 同参数）已经在飞 → 共用它的结果，
       不要重复问后端（页面载入 + 预载 + 轮询常常会撞在一起） */
    var key = action + '|' + JSON.stringify(data || {});
    if (retries > 0 && inflight[key]) return inflight[key];

    /* 写动作（不在 RETRY_SAFE 里）优先送，不跟轮询抢名额 */
    var priority = !RETRY_SAFE[action];

    var run = function (left, attemptNo) {
      return attempt(payload, timeoutMs, priority).then(function (res) {
        if (res.success) {
          netEmit('ok');
          return res;
        }
        if (isNetworkError(res) && left > 0) {
          netEmit('slow');
          var wait = RETRY_DELAYS[Math.min(attemptNo - 1, RETRY_DELAYS.length - 1)];
          log('[API] retry #' + attemptNo + ' in ' + wait + 'ms:', action);
          return sleep(wait).then(function () { return run(left - 1, attemptNo + 1); });
        }
        if (isNetworkError(res)) netEmit('offline');
        else netEmit('ok');                    // 业务错误代表连线是好的
        return res;
      });
    };

    var promise = run(retries, 1);
    if (retries > 0) {
      inflight[key] = promise;
      promise.then(function () { delete inflight[key]; },
                   function () { delete inflight[key]; });
    }
    return promise;
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
      return call('getPoints', {}, { sessionType: 'customer', cache: true });
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
      return call('getDashboard', { date: date || '' }, { sessionType: 'staff', cache: true });
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
      return call('listClaims', { limit: limit || 20 }, { sessionType: 'staff', cache: true });
    },
    searchCustomer: function (keyword) {
      return call('searchCustomer', { keyword: keyword }, { sessionType: 'staff' });
    },
    getCustomer: function (customerId) {
      return call('getCustomer', { customerId: customerId }, { sessionType: 'staff', cache: true });
    },
    getCustomerHistory: function (customerId) {
      return call('getCustomerHistory', { customerId: customerId }, { sessionType: 'staff', cache: true });
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
      return call('getOrders', d, { sessionType: 'staff', cache: true });
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
      return call('getPosQueue', data || {}, { sessionType: 'staff', cache: true });
    },

    /**
     * 顾客没有会员码（手机没电 / 没带）时：员工用手机号搜寻会员 →
     * 当面核对 → 取得 verifyToken，之后 bindPosTicket 一样能进分。
     * 后端会写 AUDIT（POS_VERIFY_MANUAL）；可用 Settings
     * ALLOW_POS_MANUAL_VERIFY=FALSE 关掉。
     */
    posVerifyMember: function (customerId) {
      return call('posVerifyMember', { customerId: customerId }, { sessionType: 'staff' });
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
      return call('getIncomingOrders', {}, { sessionType: 'staff', cache: true });
    },
    getActiveOrders: function () {
      return call('getActiveOrders', {}, { sessionType: 'staff', cache: true });
    },
    /**
     * 接单。extra.startPreparing = true 时后端会在同一个请求里
     * 直接接到「制作中」（2.1.10：员工按一下就好，也少一个来回）。
     */
    acceptOrder: function (appOrderId, extra) {
      var d = { appOrderId: appOrderId };
      if (extra && extra.startPreparing) d.startPreparing = true;
      return call('acceptOrder', d, { sessionType: 'staff' });
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
      return call('getAdminMenu', {}, { sessionType: 'staff', cache: true });
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
      return call('getSettings', {}, { sessionType: 'staff', cache: true });
    },
    updateSetting: function (key, value) {
      return call('updateSetting', { key: key, value: value }, { sessionType: 'staff' });
    },
    getPromotionsAdmin: function () {
      return call('getPromotionsAdmin', {}, { sessionType: 'staff', cache: true });
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
      return call('getAuditLogs', d, { sessionType: 'staff', cache: true });
    },
    listStaff: function () {
      return call('listStaff', {}, { sessionType: 'staff', cache: true });
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
      return call('getSalesAnalytics', { days: days || 7 }, { sessionType: 'staff', cache: true });
    },
    getProductAnalytics: function (days, limit) {
      return call('getProductAnalytics',
        { days: days || 7, limit: limit || 10 }, { sessionType: 'staff', cache: true });
    },
    getMemberAnalytics: function (days) {
      return call('getMemberAnalytics', { days: days || 30 }, { sessionType: 'staff', cache: true });
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
    /** ping：永远问后端本人（不拿快取），版本徽章要用 */
    ping: function (options) {
      var opts = { sessionType: null, cache: false };
      if (options && typeof options === 'object') {
        for (var k in options) if (options.hasOwnProperty(k)) opts[k] = options[k];
      }
      return call('ping', {}, opts);
    },
    getPublicSettings: function () {
      return call('getPublicSettings', {}, { sessionType: null, cache: true });
    }
  };

  /* --------------------------------------------------------
     预载：会员端首页一有空就把最常用的资料先抓好，
     这样点进酒单 / 我的订单是「立刻」出来，不是「等一次」
     -------------------------------------------------------- */
  /**
   * 预载清单（2.1.17「全部预载」）
   * ---------------------------------------------------------
   * 规则：**每一个页面打开时会读的只读资料，都要在清单里**，
   * 而且参数要跟页面一模一样（快取键 = action + 参数）。
   * 有新增页面 / 换了参数，就同步改这里 —— tools/local/warm-check.js
   * 会逐页检查「打开时是不是 0 个请求就画好」。
   */
  var CUSTOMER_WARM = [
    ['getMenu',           function () { return {}; }],
    ['getMyOrders',       function () { return { limit: 30 }; }],
    ['getWallet',         function () { return {}; }],
    ['getWalletHistory',  function () { return { limit: 50 }; }],
    ['getOrderHistory',   function () { return { limit: 50 }; }],
    ['getPointHistory',   function () { return { limit: 50 }; }],
    ['getPendingReward',  function () { return { rewardId: '' }; }],
    ['getProfile',        function () { return {}; }],
    ['getPromotions',     function () { return {}; }],
    ['getPublicSettings', function () { return {}; }]
  ];

  /**
   * 员工端：现场最常用的四页 + 其他所有员工页会读的资料
   * （点餐台 / 待进单 / 首页看板 / 订单看板 / 订单 / 稽核 / 员工 /
   *   设定 / 促销 / 待进单队列 / 分析报表 / 认领）
   */
  var STAFF_WARM = [
    ['getAdminMenu',    function () { return {}; }],
    ['getPosQueue',     function () { return {}; }],
    ['getDashboard',    function () { return { date: '' }; }],
    ['getActiveOrders', function () { return {}; }],
    ['getOrders',          function () { return { limit: 60 }; }],
    ['getAuditLogs',       function () { return { limit: 150 }; }],
    ['listStaff',          function () { return {}; }],
    ['getSettings',        function () { return {}; }],
    ['getPromotionsAdmin', function () { return {}; }],
    ['getIncomingOrders',  function () { return {}; }],
    ['getSalesAnalytics',  function () { return { days: 7 }; }],
    ['getProductAnalytics', function () { return { days: 7, limit: 10 }; }],
    ['getMemberAnalytics', function () { return { days: 30 }; }],
    ['listClaims',         function () { return { limit: 12 }; }]
  ];

  /** 还没登入时也能先抓的公开资料（登入页 / 首页都要用） */
  var PUBLIC_WARM = [
    ['getPublicSettings', function () { return {}; }]
  ];

  /**
   * 预载：把某个角色「接下来一定会用到的」只读资料先抓好。
   * 逐笔依序抓（Apps Script 一次只回一个请求，一次全丢反而更慢）。
   */
  function prefetchJobs(jobs, sessionType, skipFresh) {
    var pending = jobs.slice();
    function next() {
      if (!pending.length) return;
      var job = pending.shift();
      var action = job[0];
      var data = job[1]();
      if (skipFresh && cachePeek(action, data)) return next();
      send(action, data, { sessionType: sessionType }).then(function (res) {
        if (res.success) cacheWrite(cacheKey(action, data), res.data);
        next();
      });
    }
    next();
  }

  function prefetchCustomer() {
    if (!AUTH.isCustomerLoggedIn || !AUTH.isCustomerLoggedIn()) return;
    prefetchJobs(CUSTOMER_WARM, 'customer', true);
  }

  var lastWarm = 0;
  /**
   * 员工端预载。20 秒内重复叫就直接跳过（换页 / 回到前景都会叫一次）。
   * 已经有的资料不会重抓（skipFresh），所以再叫一次很便宜。
   */
  function prefetchStaff(force) {
    if (!AUTH.isStaffLoggedIn || !AUTH.isStaffLoggedIn()) return;
    var now = Date.now();
    if (!force && now - lastWarm < 20000) return;
    lastWarm = now;
    prefetchJobs(STAFF_WARM, 'staff', !force);
  }

  /** 公开资料（未登入也能抓）：登入页一打开就先抓好，登入后直接就能用 */
  function prefetchPublic() {
    prefetchJobs(PUBLIC_WARM, null, true);
  }

  /**
   * 自动预载（2.1.17）
   * ---------------------------------------------------------
   * 以前只有会员首页（app.js）与员工外壳（admin.js）会叫预载，
   * 其他页打开时完全没有背景预载 → 换页还是要等。
   * 现在**所有页面**载入后都会自己叫一次：
   *   员工 → STAFF_WARM ｜ 会员 → CUSTOMER_WARM ｜ 都没登入 → 公开资料
   * （已在快取里的不会重抓，所以重复叫很便宜。）
   */
  var autoWarmed = false;
  function autoWarm() {
    if (autoWarmed) return;
    autoWarmed = true;
    try {
      if (AUTH.isStaffLoggedIn && AUTH.isStaffLoggedIn()) prefetchStaff();
      else if (AUTH.isCustomerLoggedIn && AUTH.isCustomerLoggedIn()) prefetchCustomer();
      else prefetchPublic();
    } catch (e) {}
  }

  function bindAutoWarm() {
    if (typeof document === 'undefined') return;
    var run = function () {
      var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 250); };
      idle(function () { autoWarm(); });
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') run();
    else document.addEventListener('DOMContentLoaded', run);
    /* 从别的 App / 锁屏回来 → 再温一次（20 秒内不会重复打后端） */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) autoWarm();
    });
  }
  bindAutoWarm();

  /* ----------------------------------------------------------
     轮询：上一次跑完才排下一次（绝不重叠），失败自动退避，
     页面看不到时等 1 秒再看。页面用：
       state.poll = API.poll(8, load)   /  state.poll.stop()
     ---------------------------------------------------------- */
  function poll(seconds, task) {
    var stopped = false;
    var timer = null;
    var backoff = 1;

    function schedule(ms) {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    }

    function run() {
      if (stopped) return;
      if (document.hidden) { schedule(1000); return; }
      var startedAt = Date.now();
      Promise.resolve()
        .then(function () { return task(); })
        .then(function (res) {
          var ok = !res || res.success !== false;
          backoff = ok ? 1 : Math.min(backoff * 2, 8);
          var tookSec = Math.round((Date.now() - startedAt) / 1000);
          var wait = Math.max(seconds, tookSec + 1) * backoff * 1000;
          schedule(wait);
        }, function () {
          backoff = Math.min(backoff * 2, 8);
          schedule(seconds * backoff * 1000);
        });
    }

    run();

    return {
      stop: function () { stopped = true; if (timer) clearTimeout(timer); },
      kick: function () { stopped = false; backoff = 1; schedule(0); }
    };
  }

  return {
    call: call,
    callWithToast: callWithToast,
    poll: poll,
    onNetwork: onNetwork,
    netState: function () { return netState; },
    cache: {
      peek: cachePeek,
      drop: cacheDrop,
      clear: cacheClear,
      prefetch: prefetchCustomer,
      prefetchStaff: prefetchStaff,
      prefetchPublic: prefetchPublic,
      autoWarm: autoWarm,
      warmList: function () {
        return {
          customer: CUSTOMER_WARM.map(function (j) { return j[0]; }),
          staff: STAFF_WARM.map(function (j) { return j[0]; })
        };
      },
      write: cachePut,
      TTL: READ_TTL
    },
    customer: customer,
    staff: staff,
    admin: admin,
    system: system
  };
})();
