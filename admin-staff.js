/* =============================================================
   YETIPSY — admin-staff.js (OWNER only)
   ============================================================= */

var ADMIN_STAFF = (function () {

  function init() {
    document.getElementById('createStaffBtn').addEventListener('click', create);
    load();
  }

  function load() {
    API.admin.listStaff().then(function (res) {
      var box = document.getElementById('staffList');
      if (!res.success) { ADMIN.handleError(res.error); return; }

      var list = res.data.staff || [];
      if (!list.length) {
        box.innerHTML = '<div class="a-empty">No staff / 没有员工</div>';
        return;
      }

      box.innerHTML = '<div class="a-list">' + list.map(function (s) {
        var active = (s.status === 'ACTIVE');
        return '<div class="a-item">' +
          '<div class="a-main">' +
            '<div class="a-title">' + UI.esc(s.username) +
              ' <span class="role-pill">' + UI.esc(s.role) + '</span></div>' +
            '<div class="a-sub">' + UI.esc(s.staffId) +
              ' · last login ' + UI.esc(s.lastLogin ? UI.dateTime(s.lastLogin) : '—') + '</div>' +
          '</div>' +
          '<div class="a-right">' +
            '<button class="chip ' + (active ? 'ok' : 'danger') + '" style="cursor:pointer" ' +
              'data-toggle="' + UI.esc(s.staffId) + '" ' +
              'data-status="' + (active ? 'DISABLED' : 'ACTIVE') + '">' + UI.esc(s.status) + '</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';

      Array.prototype.forEach.call(box.querySelectorAll('[data-toggle]'), function (btn) {
        btn.addEventListener('click', function () {
          API.admin.setStaffStatus(btn.getAttribute('data-toggle'), btn.getAttribute('data-status'))
            .then(function (res) {
              if (!res.success) { ADMIN.handleError(res.error); return; }
              UI.toast('Updated / 已更新', 'success');
              load();
            });
        });
      });
    });
  }

  function create() {
    var username = document.getElementById('newUsername').value.trim();
    var password = document.getElementById('newPassword').value;
    var role     = document.getElementById('newRole').value;

    if (username.length < 3) { UI.toast('Username too short / 账号太短', 'error'); return; }
    if (password.length < 8) { UI.toast('Password min 8 chars / 密码至少 8 位', 'error'); return; }

    var btn = document.getElementById('createStaffBtn');
    UI.setLoading(btn, true, 'CREATING');
    API.admin.createStaff(username, password, role).then(function (res) {
      UI.setLoading(btn, false);
      if (!res.success) { ADMIN.handleError(res.error); return; }
      UI.toast('Staff created / 已建立', 'success');
      document.getElementById('newUsername').value = '';
      document.getElementById('newPassword').value = '';
      load();
    });
  }

  return { init: init };
})();
