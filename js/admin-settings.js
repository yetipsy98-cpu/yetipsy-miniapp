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
      var badge  = visibilityBadge(p);
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.esc(p.title) + '</div>' +
          '<div class="a-sub">' + UI.esc(p.subtitle || '') + '</div>' +
          '<div class="a-sub" style="margin-top:4px">' +
            '📅 ' + UI.esc(p.startDate || '(不限)') + ' → ' + UI.esc(p.endDate || '(不限)') +
          '</div>' +
          '<div class="a-sub" style="margin-top:4px;color:' + badge.color + '">' +
            badge.text + '</div>' +
        '</div>' +
        '<div class="a-right" style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
          '<button class="chip ' + (active ? 'ok' : '') + '" data-toggle="' + UI.esc(p.promotionId) + '" ' +
            'data-status="' + (active ? 'INACTIVE' : 'ACTIVE') + '" style="cursor:pointer">' +
            UI.esc(p.status) + '</button>' +
          '<button class="chip" data-edit="' + UI.esc(p.promotionId) + '" style="cursor:pointer">改日期</button>' +
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

    Array.prototype.forEach.call(box.querySelectorAll('[data-edit]'), function (btn) {
      btn.addEventListener('click', function () {
        editPromotion(btn.getAttribute('data-edit'));
      });
    });
  }

  /**
   * 会员端看不看得到这条活动？后端已经算好 visibilityReason，
   * 这里只是把它翻译成人话 —— 「为什么客户端没有活动」九成是这里的答案。
   */
  function visibilityBadge(p) {
    if (p.visibilityReason === 'EXPIRED') {
      return { color: '#E2696B', text: '✗ 客户端看不到：已过期（结束日 ' + UI.esc(p.endDate) + '）' };
    }
    if (p.visibilityReason === 'NOT_STARTED') {
      return { color: '#E5B769', text: '⏳ 客户端看不到：还没开始（' + UI.esc(p.startDate) + '）' };
    }
    if (p.visibilityReason === 'INACTIVE') {
      return { color: '#8A8A8A', text: '○ 客户端看不到：已停用 INACTIVE' };
    }
    return { color: '#5FBF7F', text: '✓ 客户端看得到' };
  }

  /** 改日期 / 标题 —— 过期的示范活动就是靠这个救回来 */
  function editPromotion(promotionId) {
    var p = null;
    for (var i = 0; i < promotions.length; i++) {
      if (promotions[i].promotionId === promotionId) { p = promotions[i]; break; }
    }
    if (!p) return;

    var start = window.prompt(
      '开始日期 START DATE（YYYY-MM-DD，留空 = 不限）\n' +
      '目前是：' + (p.startDate || '(不限)'), p.startDate || '');
    if (start === null) return;

    var end = window.prompt(
      '结束日期 END DATE（YYYY-MM-DD，留空 = 不限）\n' +
      '目前是：' + (p.endDate || '(不限)') + '\n' +
      '提示：今天是 ' + todayText() + '，结束日必须在这天之后才会出现在客户端。',
      p.endDate || '');
    if (end === null) return;

    API.admin.updatePromotion(promotionId, { startDate: start, endDate: end })
      .then(function (res) {
        if (!res.success) { ADMIN.handleError(res.error); return; }
        UI.toast('已更新 / Updated', 'success');
        load();
      });
  }

  function todayText() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
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
