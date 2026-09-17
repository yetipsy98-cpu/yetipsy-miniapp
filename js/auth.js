/* =============================================================
   YETIPSY — auth.js
   -------------------------------------------------------------
   Session 管理（前端只保存 token，一切权限由后端判定）

   登录方式：手机号码 + 密码（不使用 WhatsApp / SMS OTP）。
   密码只存后端的 Salted SHA-256 hash，前端只拿 session token。

   ⚠️ 安全说明：
   会员 session 不允许：
     - 手动转账 Wallet（必须由店员确认）
     - 任何 Admin 功能
   详见 README.md §6
   ============================================================= */

var AUTH = (function () {

  var S = YETIPSY_CONFIG.STORAGE;

  function get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function del(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  /* ---------------- CUSTOMER ---------------- */

  function getCustomerToken() {
    return get(S.CUSTOMER_TOKEN) || '';
  }

  function setCustomerSession(token, profile) {
    set(S.CUSTOMER_TOKEN, token);
    if (profile) set(S.CUSTOMER_PROFILE, JSON.stringify(profile));
    dropReadCache();          // 换人登入 → 不能拿到上一位会员的快取
  }

  function getCustomerProfile() {
    var raw = get(S.CUSTOMER_PROFILE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function setCustomerProfile(profile) {
    set(S.CUSTOMER_PROFILE, JSON.stringify(profile));
  }

  function clearCustomer() {
    del(S.CUSTOMER_TOKEN);
    del(S.CUSTOMER_PROFILE);
    dropReadCache();
  }

  /** 只读快取由 API 层管；auth 只负责在换人时叫它清掉 */
  function dropReadCache() {
    try {
      if (typeof API !== 'undefined' && API.cache && API.cache.clear) API.cache.clear();
    } catch (e) {}
  }

  function isCustomerLoggedIn() {
    return !!getCustomerToken();
  }

  /**
   * 会员页面守卫：未登录 → 去登录页（记住回跳地址）
   */
  function requireCustomer(redirectBack) {
    if (!isCustomerLoggedIn()) {
      var url = 'login.html';
      if (redirectBack !== false) {
        url += '?redirect=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
      }
      location.replace(url);
      return false;
    }
    return true;
  }

  /* ---------------- STAFF ---------------- */

  function getStaffToken() {
    return get(S.STAFF_TOKEN) || '';
  }

  function setStaffSession(token, profile) {
    set(S.STAFF_TOKEN, token);
    if (profile) set(S.STAFF_PROFILE, JSON.stringify(profile));
  }

  function getStaffProfile() {
    var raw = get(S.STAFF_PROFILE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function clearStaff() {
    del(S.STAFF_TOKEN);
    del(S.STAFF_PROFILE);
    dropReadCache();
  }

  function isStaffLoggedIn() {
    return !!getStaffToken();
  }

  function requireStaff() {
    if (!isStaffLoggedIn()) {
      location.replace('login.html');
      return false;
    }
    return true;
  }

  /** 角色判断（仅用于 UI 显示隐藏，后端仍会再验证一次） */
  function hasRole(role) {
    var p = getStaffProfile();
    if (!p) return false;
    if (role === 'STAFF') return true;
    if (role === 'MANAGER') return p.role === 'MANAGER' || p.role === 'OWNER';
    if (role === 'OWNER') return p.role === 'OWNER';
    return false;
  }

  /* ---------------- 共用 ---------------- */

  function handleSessionError(error) {
    if (!error) return false;
    if (error.code === 'INVALID_SESSION' || error.code === 'SESSION_EXPIRED') {
      var isAdmin = location.pathname.indexOf('/admin/') !== -1;
      if (isAdmin) {
        clearStaff();
        location.replace('login.html');
      } else {
        clearCustomer();
        location.replace('login.html?redirect=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
      }
      return true;
    }
    return false;
  }

  return {
    getCustomerToken: getCustomerToken,
    setCustomerSession: setCustomerSession,
    getCustomerProfile: getCustomerProfile,
    setCustomerProfile: setCustomerProfile,
    clearCustomer: clearCustomer,
    isCustomerLoggedIn: isCustomerLoggedIn,
    requireCustomer: requireCustomer,

    getStaffToken: getStaffToken,
    setStaffSession: setStaffSession,
    getStaffProfile: getStaffProfile,
    clearStaff: clearStaff,
    isStaffLoggedIn: isStaffLoggedIn,
    requireStaff: requireStaff,
    hasRole: hasRole,

    handleSessionError: handleSessionError
  };
})();
