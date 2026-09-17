/* =============================================================
   YETIPSY — profile.js (Customer Profile)
   ============================================================= */

var PROFILE = (function () {

  var profile = null;
  var passwordMin = 8;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    var cached = AUTH.getCustomerProfile();
    if (cached) render(cached);

    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('changePwBtn').addEventListener('click', changePassword);

    passwordMin = YETIPSY_CONFIG.PASSWORD_MIN_LENGTH || 8;
    API.system.getPublicSettings().then(function (res) {
      if (res.success && res.data && res.data.passwordMinLength) {
        passwordMin = Number(res.data.passwordMinLength) || passwordMin;
      }
      document.getElementById('pwRuleHint').innerHTML =
        '至少 ' + passwordMin + ' 位 · At least ' + passwordMin + ' characters';
    });

    API.customer.getProfile().then(function (res) {
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      render(res.data.customer);
      AUTH.setCustomerProfile(res.data.customer);
    });
  }

  function render(c) {
    profile = c;
    document.getElementById('memberName').textContent = c.name || 'Yetipsy Friend';
    document.getElementById('memberId').textContent   = c.customerId;
    document.getElementById('memberTier').innerHTML   = UI.tierBadge(c.membershipTier);
    document.getElementById('statPoints').textContent = UI.points(c.currentPoints);
    document.getElementById('statWallet').textContent = UI.money(c.walletBalance);
    document.getElementById('statSpend').textContent  = UI.money(c.totalSpend);
    document.getElementById('statVisits').textContent = UI.points(c.totalVisits);

    /* 「钱包与记录」那一列的余额（首页只有四个入口，这里也让顾客看得到钱包） */
    var walletRow = document.getElementById('walletRowValue');
    if (walletRow) walletRow.textContent = UI.money(c.walletBalance);

    document.getElementById('nameInput').value     = c.name || '';
    document.getElementById('birthdayInput').value = c.birthday || '';
    document.getElementById('phoneInput').value    = c.phone || '';
  }

  function save() {
    var name     = document.getElementById('nameInput').value.trim();
    var birthday = document.getElementById('birthdayInput').value;
    var btn      = document.getElementById('saveBtn');

    UI.setLoading(btn, true, 'SAVING');
    API.customer.updateProfile(name, birthday).then(function (res) {
      if (res.success && API.cache) API.cache.clear();
      UI.setLoading(btn, false);
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      UI.toast('已保存 / Profile saved', 'success');
      render(res.data.customer);
      AUTH.setCustomerProfile(res.data.customer);
    });
  }

  function changePassword() {
    var current = document.getElementById('currentPwInput').value;
    var next    = document.getElementById('newPwInput').value;
    var confirmPw = document.getElementById('newPw2Input').value;
    var btn     = document.getElementById('changePwBtn');

    if (!current) { UI.toast('请输入目前的密码 / Current password required', 'error'); return; }
    if (next.length < passwordMin) {
      UI.toast('新密码至少 ' + passwordMin + ' 位 / Min ' + passwordMin + ' characters', 'error');
      return;
    }
    if (next !== confirmPw) {
      UI.toast('两次输入的密码不一样 / Passwords do not match', 'error');
      return;
    }

    UI.setLoading(btn, true, 'SAVING');
    API.customer.changePassword(current, next).then(function (res) {
      UI.setLoading(btn, false);
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      document.getElementById('currentPwInput').value = '';
      document.getElementById('newPwInput').value = '';
      document.getElementById('newPw2Input').value = '';
      UI.toast('密码已修改 / Password changed', 'success');
    });
  }

  function logout() {
    UI.confirmDialog('确定要登出吗？', 'Log out from this device?', '登出 LOG OUT')
      .then(function (yes) {
        if (!yes) return;
        API.customer.logout().then(function () {
          AUTH.clearCustomer();
          location.replace('login.html');
        });
      });
  }

  return { init: init };
})();
