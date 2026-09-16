/* =============================================================
   YETIPSY — admin-settings.js
   Settings（须 Manager / Owner）+ Promotions 管理
   ============================================================= */

var ADMIN_SETTINGS = (function () {

  var settings = [];
  var promotions = [];

  function init() {
    document.getElementById('addPromoBtn').addEventListener('click', addPromotion);
    load();
  }

  function load() {
    Promise.all([
      API.admin.getSettings(),
      API.admin.getPromotionsAdmin()
    ]).then(function (r) {
      if (r[0].success) { settings = r[0].data.settings || []; renderSettings(); }
      else ADMIN.handleError(r[0].error);

      if (r[1].success) { promotions = r[1].data.promotions || []; renderPromotions(); }
    });
  }

  function renderSettings() {
    var box = document.getElementById('settingsBox');
    if (!settings.length) {
      box.innerHTML = '<div class="a-empty">No settings / 没有设置</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + settings.map(function (s, i) {
      return '<div class="a-item" style="display:block">' +
        '<div class="a-sub" style="letter-spacing:.6px">' + UI.esc(s.description || s.key) + '</div>' +
        '<div class="row-between mt-8">' +
          '<div><span class="chip info">' + UI.esc(s.key) + '</span></div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input class="a-input" style="width:120px;padding:9px 10px;font-size:13px" ' +
              'id="set_' + i + '" value="' + UI.esc(s.value) + '">' +
            '<button class="btn btn-secondary btn-sm" style="width:auto;padding:0 12px" ' +
              'data-save="' + UI.esc(s.key) + '" data-index="' + i + '">SAVE</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-save]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-save');
        var idx = btn.getAttribute('data-index');
        var val = document.getElementById('set_' + idx).value.trim();
        UI.setLoading(btn, true, '…');
        API.admin.updateSetting(key, val).then(function (res) {
          UI.setLoading(btn, false);
          if (!res.success) { ADMIN.handleError(res.error); return; }
          UI.toast(key + ' updated / 已更新', 'success');
          load();
        });
      });
    });
  }

  function renderPromotions() {
    var box = document.getElementById('promoList');
    if (!promotions.length) {
      box.innerHTML = '<div class="a-empty">No promotions / 还没有活动</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + promotions.map(function (p) {
      var active = (p.status === 'ACTIVE');
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.esc(p.title) + '</div>' +
          '<div class="a-sub">' + UI.esc(p.subtitle || '') +
            (p.startDate || p.endDate ? ' · ' + UI.esc(p.startDate || '') + ' → ' + UI.esc(p.endDate || '') : '') +
          '</div>' +
        '</div>' +
        '<div class="a-right">' +
          '<button class="chip ' + (active ? 'ok' : '') + '" data-toggle="' + UI.esc(p.promotionId) + '" ' +
            'data-status="' + (active ? 'INACTIVE' : 'ACTIVE') + '" style="cursor:pointer">' +
            UI.esc(p.status) + '</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-toggle]'), function (btn) {
      btn.addEventListener('click', function () {
        API.admin.updatePromotion(btn.getAttribute('data-toggle'), {
          status: btn.getAttribute('data-status')
        }).then(function (res) {
          if (!res.success) { ADMIN.handleError(res.error); return; }
          UI.toast('Promotion updated / 已更新', 'success');
          load();
        });
      });
    });
  }

  function addPromotion() {
    var title    = document.getElementById('promoTitle').value.trim();
    var subtitle = document.getElementById('promoSubtitle').value.trim();
    var desc     = document.getElementById('promoDesc').value.trim();
    var start    = document.getElementById('promoStart').value;
    var end      = document.getElementById('promoEnd').value;

    if (!title) { UI.toast('Title required / 请填写标题', 'error'); return; }

    var btn = document.getElementById('addPromoBtn');
    UI.setLoading(btn, true, 'ADDING');
    API.admin.createPromotion({
      title: title, subtitle: subtitle, description: desc,
      startDate: start, endDate: end, status: 'ACTIVE'
    }).then(function (res) {
      UI.setLoading(btn, false);
      if (!res.success) { ADMIN.handleError(res.error); return; }
      UI.toast('Promotion added / 已新增', 'success');
      ['promoTitle', 'promoSubtitle', 'promoDesc', 'promoStart', 'promoEnd'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      load();
    });
  }

  return { init: init };
})();
