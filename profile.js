/* =============================================================
   YETIPSY — profile.js (Customer Profile)
   ============================================================= */

var PROFILE = (function () {

  var profile = null;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    var cached = AUTH.getCustomerProfile();
    if (cached) render(cached);

    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('logoutBtn').addEventListener('click', logout);

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
