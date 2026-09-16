/* =============================================================
   YETIPSY — admin.js
   -------------------------------------------------------------
   Staff Admin 共用逻辑：
     · Session 守卫
     · Header / Bottom Nav 渲染
     · 权限（UI 层；后端仍会再验证一次）
   ============================================================= */

var ADMIN = (function () {

  var NAV = [
    { page: 'index.html',     zh: '首页',   en: 'HOME' },
    { page: 'claim.html',     zh: '开单',   en: 'CLAIM' },
    { page: 'customers.html', zh: '顾客',   en: 'MEMBERS' },
    { page: 'more.html',      zh: '更多',   en: 'MORE' }
  ];

  /* ---------------- 守卫 ---------------- */

  function requireAuth() {
    if (!AUTH.isStaffLoggedIn()) {
      location.replace('login.html');
      return false;
    }
    return true;
  }

  /** 页面需要 MANAGER / OWNER 才能看（UI 层） */
  function requireManager() {
    if (!requireAuth()) return false;
    if (!AUTH.hasRole('MANAGER')) {
      UI.toast('需要经理权限 / Manager permission required', 'error');
      setTimeout(function () { location.replace('index.html'); }, 900);
      return false;
    }
    return true;
  }

  /* ---------------- Shell ---------------- */

  function renderShell(options) {
    options = options || {};
    var staff = AUTH.getStaffProfile() || { username: '', role: '' };

    var header = document.createElement('div');
    header.className = 'admin-header';
    header.innerHTML =
      '<div class="admin-header-inner">' +
        '<div class="admin-logo">YETIPSY</div>' +
        '<div class="ah-title">' + UI.esc(options.title || '') + '</div>' +
        '<div class="ah-right">' +
          '<span class="role-pill">' + UI.esc(staff.role || '') + '</span>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('afterbegin', header.outerHTML);

    var current = location.pathname.split('/').pop() || 'index.html';
    var nav = '<nav class="admin-nav">';
    NAV.forEach(function (n) {
      nav += '<a href="' + n.page + '" class="' + (n.page === current ? 'active' : '') + '">' +
               '<span>' + n.zh + '</span><span class="an-en">' + n.en + '</span>' +
             '</a>';
    });
    nav += '</nav>';
    document.body.insertAdjacentHTML('beforeend', nav);
    document.body.classList.add('has-admin-nav');

    if (options.onLogout) {
      // header 右侧点击登出由各页面自行绑定
    }
  }

  /* ---------------- 登出 ---------------- */

  function logout() {
    UI.confirmDialog('确定要登出吗？', 'Sign out of staff app?', '登出 SIGN OUT')
      .then(function (yes) {
        if (!yes) return;
        API.staff.logout().then(function () {
          AUTH.clearStaff();
          location.replace('login.html');
        });
      });
  }

  /* ---------------- 工具 ---------------- */

  /** API 错误统一处理（session 过期自动登出） */
  function handleError(error) {
    if (!error) return;
    if (AUTH.handleSessionError(error)) return;
    UI.toast(error.message || error.code, 'error');
  }

  function isManager() { return AUTH.hasRole('MANAGER'); }
  function isOwner()   { return AUTH.hasRole('OWNER'); }

  /** 显示权限不足 */
  function deny() {
    UI.toast('权限不足 / Permission denied', 'error');
  }

  return {
    NAV: NAV,
    requireAuth: requireAuth,
    requireManager: requireManager,
    renderShell: renderShell,
    logout: logout,
    handleError: handleError,
    isManager: isManager,
    isOwner: isOwner,
    deny: deny
  };
})();
