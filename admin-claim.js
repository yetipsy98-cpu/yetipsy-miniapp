/* =============================================================
   YETIPSY — admin-claim.js
   -------------------------------------------------------------
   员工最常用的功能：建立 Claim（5–10 秒完成）
   目标流程：来源 → 订单号 → 金额 → CREATE → QR / Code
   ============================================================= */

var ADMIN_CLAIM = (function () {

  var state = {
    source: 'FOODCOURT',
    lastClaim: null
  };

  var el = {};

  function init() {
    el.viewForm   = document.getElementById('viewForm');
    el.viewResult = document.getElementById('viewResult');
    el.orderNo    = document.getElementById('orderNoInput');
    el.amount     = document.getElementById('amountInput');
    el.createBtn  = document.getElementById('createBtn');
    el.resAmount  = document.getElementById('resAmount');
    el.resOrder   = document.getElementById('resOrder');
    el.resCode    = document.getElementById('resCode');
    el.resExpiry  = document.getElementById('resExpiry');
    el.qr         = document.getElementById('qrContainer');

    // 来源切换
    document.getElementById('sourceSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      state.source = btn.getAttribute('data-source');
      document.getElementById('orderNoHint').textContent =
        state.source === 'FOODCOURT'
          ? '输入 Foodcourt 订单号码 · Enter the Foodcourt order number'
          : '可留空，系统会自动产生 · Optional, auto-generated';
      el.orderNo.focus();
    });

    el.createBtn.addEventListener('click', create);
    document.getElementById('newClaimBtn').addEventListener('click', reset);
    document.getElementById('copyBtn').addEventListener('click', copyCode);
    document.getElementById('cancelBtn').addEventListener('click', cancelClaim);

    el.amount.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    el.orderNo.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.amount.focus(); });

    // 金额输入限制
    el.amount.addEventListener('input', function () {
      var v = this.value.replace(/[^0-9.]/g, '');
      var parts = v.split('.');
      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
      if (v.indexOf('.') >= 0) {
        var seg = v.split('.');
        if (seg[1].length > 2) v = seg[0] + '.' + seg[1].slice(0, 2);
      }
      this.value = v;
    });

    el.orderNo.focus();
    loadRecent();
  }

  function create() {
    var externalOrderId = el.orderNo.value.trim().toUpperCase();
    var amountSen = UI.parseMoneyToSen(el.amount.value);

    if (state.source === 'FOODCOURT' && !externalOrderId) {
      UI.toast('请输入订单号码 / Order number required', 'error');
      el.orderNo.focus();
      return;
    }
    if (amountSen === null || amountSen <= 0) {
      UI.toast('请输入有效金额 / Enter a valid amount', 'error');
      el.amount.focus();
      return;
    }
    if (amountSen > 100000000) {
      UI.toast('金额过大 / Amount too large', 'error');
      return;
    }

    UI.setLoading(el.createBtn, true, 'CREATING');

    API.staff.createClaim(state.source, externalOrderId, amountSen, '').then(function (res) {
      UI.setLoading(el.createBtn, false);
      if (!res.success) {
        ADMIN.handleError(res.error);
        return;
      }
      showResult(res.data);
      loadRecent();
    });
  }

  function showResult(claim) {
    state.lastClaim = claim;

    el.resAmount.textContent = UI.money(claim.amount);
    el.resOrder.textContent  =
      (claim.source === 'FOODCOURT' ? 'Order #' : 'Ref #') + (claim.externalOrderId || claim.orderId);
    el.resCode.textContent   = claim.claimCode;
    el.resExpiry.textContent = 'EXPIRES ' + UI.dateTime(claim.expiresAt);

    var url = YETIPSY_CONFIG.buildClaimUrl(claim.token);
    UI.renderQR(el.qr, url, 220);

    el.viewForm.style.display = 'none';
    el.viewResult.style.display = 'block';
    window.scrollTo(0, 0);
  }

  function reset() {
    state.lastClaim = null;
    el.orderNo.value = '';
    el.amount.value  = '';
    el.viewResult.style.display = 'none';
    el.viewForm.style.display = 'block';
    el.orderNo.focus();
  }

  function copyCode() {
    if (!state.lastClaim) return;
    UI.copyToClipboard(state.lastClaim.claimCode)
      .then(function () { UI.toast('Code copied / 已复制', 'success'); })
      .catch(function () { UI.toast('Copy failed / 复制失败', 'error'); });
  }

  function cancelClaim() {
    if (!state.lastClaim) return;
    UI.confirmDialog('确定要取消这个 Claim 吗？', 'Cancel this claim? Points cannot be issued afterwards.', '取消 CANCEL')
      .then(function (yes) {
        if (!yes) return;
        UI.showLoading('CANCELLING');
        API.staff.cancelClaim(state.lastClaim.claimId).then(function (res) {
          UI.hideLoading();
          if (!res.success) { ADMIN.handleError(res.error); return; }
          UI.toast('Claim cancelled / 已取消', 'success');
          reset();
          loadRecent();
        });
      });
  }

  function loadRecent() {
    API.staff.listClaims(12).then(function (res) {
      var box = document.getElementById('recentList');
      if (!res.success || !res.data.claims || !res.data.claims.length) {
        box.innerHTML = '<div class="a-empty">No claims yet / 还没有记录</div>';
        return;
      }
      box.innerHTML = '<div class="a-list">' + res.data.claims.map(function (c) {
        var chip =
          c.status === 'AVAILABLE' ? 'chip gold' :
          c.status === 'CLAIMED'   ? 'chip ok'   :
          c.status === 'EXPIRED'   ? 'chip'      : 'chip danger';
        return '<div class="a-item">' +
          '<div class="a-main">' +
            '<div class="a-title">' + UI.money(c.amount) +
              ' <span class="tiny muted-2">#' + UI.esc(c.externalOrderId || c.orderId) + '</span></div>' +
            '<div class="a-sub">' + UI.esc(c.source) + ' · ' + UI.esc(c.claimCode) +
              ' · ' + UI.esc(UI.timeOnly(c.createdAt)) +
              (c.customerName ? ' · ' + UI.esc(c.customerName) : '') +
            '</div>' +
          '</div>' +
          '<div class="a-right"><span class="' + chip + '">' + UI.esc(c.status) + '</span></div>' +
        '</div>';
      }).join('') + '</div>';
    });
  }

  return { init: init };
})();
