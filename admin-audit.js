/* =============================================================
   YETIPSY — admin-audit.js (Audit Logs · Manager / Owner)
   ============================================================= */

var ADMIN_AUDIT = (function () {

  function init() {
    document.getElementById('actionFilter').addEventListener('change', load);
    load();
  }

  function load() {
    var action = document.getElementById('actionFilter').value;
    API.admin.getAuditLogs(150, { action: action }).then(function (res) {
      var box = document.getElementById('logList');
      if (!res.success) { ADMIN.handleError(res.error); return; }

      var list = res.data.logs || [];
      if (!list.length) {
        box.innerHTML = '<div class="a-empty">No logs / 没有记录</div>';
        return;
      }

      box.innerHTML = '<div class="a-list">' + list.map(function (l) {
        return '<div class="a-item">' +
          '<div class="a-main">' +
            '<div class="a-title" style="font-size:12px">' + UI.esc(l.action) +
              ' <span class="tiny muted-2">' + UI.esc(l.targetType || '') +
              (l.targetId ? ' · ' + UI.esc(l.targetId) : '') + '</span></div>' +
            '<div class="a-sub">' + UI.esc(l.userType || '') + ' ' + UI.esc(l.userId || '') +
              ' · ' + UI.esc(UI.dateTime(l.createdAt)) +
              (l.newValue ? ' · ' + short(l.newValue) : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    });
  }

  function short(v) {
    v = String(v || '');
    return v.length > 60 ? v.slice(0, 60) + '…' : v;
  }

  return { init: init };
})();
