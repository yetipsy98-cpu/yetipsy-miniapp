/* =============================================================
   YETIPSY — admin-customer.js
   -------------------------------------------------------------
   员工查找会员 → 查看资料 → 钱包抵扣（由员工发起/确认）
   Manager / Owner 额外：调整 Wallet / Points
   ============================================================= */

var ADMIN_CUSTOMER = (function () {

  var state = {
    customer: null,
    calc: null,
    calcTimer: null
  };

  var el = {};

  function init() {
    el.search     = document.getElementById('searchInput');
    el.results    = document.getElementById('searchResults');
    el.detail     = document.getElementById('detailView');
    el.bill       = document.getElementById('billInput');
    el.calcBox    = document.getElementById('calcBox');
    el.calcHint   = document.getElementById('calcHint');
    el.redeemBtn  = document.getElementById('redeemBtn');

    el.search.addEventListener('input', debounce(doSearch, 320));
    el.search.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    el.bill.addEventListener('input', onBillInput);
    el.redeemBtn.addEventListener('click', doRedeem);
    document.getElementById('backBtn').addEventListener('click', backToSearch);
    document.getElementById('adjustWalletBtn').addEventListener('click', function () { adjust('wallet'); });
    document.getElementById('adjustPointsBtn').addEventListener('click', function () { adjust('points'); });

    el.search.focus();
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /* ---------------- SEARCH ---------------- */

  function doSearch() {
    var keyword = el.search.value.trim();
    if (keyword.length < 3) {
      el.results.innerHTML = '';
      return;
    }
    API.staff.searchCustomer(keyword).then(function (res) {
      if (!res.success) { ADMIN.handleError(res.error); return; }
      var list = res.data.customers || [];
      if (!list.length) {
        el.results.innerHTML = '<div class="a-empty">No member found / 找不到会员<br>' +
          '<span class="tiny">可用手机号码注册新会员（顾客端）</span></div>';
        return;
      }
      el.results.innerHTML = '<div class="a-list">' + list.map(function (c) {
        return '<div class="a-item cust-card" data-id="' + UI.esc(c.customerId) + '">' +
          '<div class="a-main">' +
            '<div class="a-title">' + UI.esc(c.name || 'Yetipsy Friend') + '</div>' +
            '<div class="a-sub">' + UI.esc(c.customerId) + ' · ' + UI.esc(c.phone) + '</div>' +
          '</div>' +
          '<div class="a-right">' +
            '<div class="a-value" style="color:var(--a-gold)">' + UI.money(c.walletBalance) + '</div>' +
            '<div class="a-meta">' + UI.points(c.currentPoints) + ' PTS</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';

      Array.prototype.forEach.call(el.results.querySelectorAll('.cust-card'), function (node) {
        node.addEventListener('click', function () {
          openCustomer(node.getAttribute('data-id'));
        });
      });
    });
  }

  /* ---------------- DETAIL ---------------- */

  function openCustomer(customerId) {
    API.staff.getCustomer(customerId).then(function (res) {
      if (!res.success) { ADMIN.handleError(res.error); return; }
      state.customer = res.data.customer;
      renderDetail();
      loadHistory(customerId);
    });
  }

  function renderDetail() {
    var c = state.customer;
    el.results.style.display = 'none';
    el.search.style.display  = 'none';
    el.detail.style.display  = 'block';

    document.getElementById('cName').textContent   = c.name || 'Yetipsy Friend';
    document.getElementById('cId').textContent     = c.customerId;
    document.getElementById('cPhone').textContent  = c.phone;
    document.getElementById('cTier').innerHTML     = UI.tierBadge(c.membershipTier);
    document.getElementById('cPoints').textContent = UI.points(c.currentPoints);
    document.getElementById('cWallet').textContent = UI.money(c.walletBalance);
    document.getElementById('cSpend').textContent  = UI.money(c.totalSpend);
    document.getElementById('cVisits').textContent = c.totalVisits;

    if (ADMIN.isManager()) {
      document.getElementById('managerActions').style.display = 'block';
    }

    el.bill.value = '';
    el.calcBox.style.display = 'none';
    el.redeemBtn.style.display = 'none';
    state.calc = null;
    window.scrollTo(0, 0);
  }

  function backToSearch() {
    el.detail.style.display = 'none';
    el.search.style.display = 'block';
    el.results.style.display = 'block';
    el.search.value = '';
    el.results.innerHTML = '';
    state.customer = null;
    el.search.focus();
  }

  /* ---------------- REDEEM ---------------- */

  function onBillInput() {
    var v = this.value.replace(/[^0-9.]/g, '');
    var parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    if (v.indexOf('.') >= 0) {
      var seg = v.split('.');
      if (seg[1].length > 2) v = seg[0] + '.' + seg[1].slice(0, 2);
    }
    this.value = v;

    clearTimeout(state.calcTimer);
    state.calcTimer = setTimeout(calculate, 300);
  }

  function calculate() {
    var sen = UI.parseMoneyToSen(el.bill.value);
    if (!state.customer) return;
    if (sen === null || sen <= 0) {
      el.calcBox.style.display = 'none';
      el.redeemBtn.style.display = 'none';
      el.calcHint.textContent = '输入账单金额后自动计算 · Enter bill amount to calculate.';
      return;
    }
    API.staff.calculateWalletRedemption(state.customer.customerId, sen).then(function (res) {
      if (!res.success) { ADMIN.handleError(res.error); return; }
      state.calc = res.data;
      var d = res.data;
      document.getElementById('calcBill').textContent   = UI.money(d.billAmount);
      document.getElementById('calcWallet').textContent = UI.money(d.walletBalance);
      document.getElementById('calcMax').textContent    = UI.money(d.maxUsable);
      document.getElementById('calcPercent').textContent =
        '(' + d.maxPercent + '% · cap ' + UI.money(d.capAmount) + ')';
      document.getElementById('calcPay').textContent    = UI.money(d.customerPays);
      el.calcBox.style.display = 'block';
      el.calcHint.style.display = 'none';

      if (d.usableAmount > 0) {
        el.redeemBtn.style.display = 'flex';
        el.redeemBtn.innerHTML = 'USE ' + UI.money(d.usableAmount) + ' · 确认抵扣';
      } else {
        el.redeemBtn.style.display = 'none';
        el.calcHint.style.display = 'block';
        el.calcHint.textContent = '无法抵扣：' + (d.reason || '不可用') + ' / Cannot redeem: ' + (d.reasonEn || 'not applicable');
      }
    });
  }

  function doRedeem() {
    if (!state.customer || !state.calc) return;
    var d = state.calc;

    UI.confirmDialog(
      '确认使用 ' + UI.money(d.usableAmount) + ' 钱包余额？',
      'Redeem ' + UI.money(d.usableAmount) + ' from wallet? Customer pays ' + UI.money(d.customerPays) + '.',
      '确认 CONFIRM'
    ).then(function (yes) {
      if (!yes) return;
      UI.showLoading('PROCESSING');
      API.staff.redeemWallet(
        state.customer.customerId,
        d.billAmount,
        d.usableAmount,
        '',
        'DIRECT',
        'Staff redemption'
      ).then(function (res) {
        UI.hideLoading();
        if (!res.success) { ADMIN.handleError(res.error); return; }
        UI.toast('抵扣完成 · 顾客应付 ' + UI.money(res.data.customerPays), 'success');
        state.customer = res.data.customer;
        renderDetail();
        loadHistory(state.customer.customerId);
      });
    });
  }

  /* ---------------- HISTORY ---------------- */

  function loadHistory(customerId) {
    API.staff.getCustomerHistory(customerId).then(function (res) {
      var box = document.getElementById('cHistory');
      if (!res.success || !res.data.orders || !res.data.orders.length) {
        box.innerHTML = '<div class="a-empty">No visits yet / 还没有消费记录</div>';
        return;
      }
      box.innerHTML = '<div class="a-list">' + res.data.orders.map(function (o) {
        return '<div class="a-item">' +
          '<div class="a-main">' +
            '<div class="a-title">' + UI.money(o.amount) + '</div>' +
            '<div class="a-sub">' + UI.esc(o.source) +
              (o.externalOrderId ? ' · #' + UI.esc(o.externalOrderId) : '') +
              ' · ' + UI.esc(UI.dateTime(o.createdAt)) + '</div>' +
          '</div>' +
          '<div class="a-right">' +
            '<div class="a-value" style="color:var(--a-gold)">+' + UI.points(o.pointsEarned) + '</div>' +
            '<div class="a-meta">' +
              (o.rewardAmount ? 'RWD ' + UI.money(o.rewardAmount) : '') +
              (o.walletUsed ? ' · WLT -' + UI.money(o.walletUsed, false) : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    });
  }

  /* ---------------- MANAGER ADJUSTMENT ---------------- */

  function adjust(type) {
    if (!ADMIN.isManager()) { ADMIN.deny(); return; }
    var c = state.customer;
    if (!c) return;

    var isWallet = (type === 'wallet');
    var answer = window.prompt(
      isWallet
        ? 'Wallet adjustment (RM). Use - for deduction, e.g. -5.00\n钱包调整（RM），扣除请用负数，例如 -5.00'
        : 'Points adjustment. Use - for deduction, e.g. -50\n积分调整，扣除请用负数，例如 -50',
      isWallet ? '0.00' : '0'
    );
    if (answer === null) return;

    var amount;
    if (isWallet) {
      amount = UI.parseMoneyToSen(answer);
      if (amount === null || amount === 0) { UI.toast('Invalid amount / 金额无效', 'error'); return; }
    } else {
      amount = parseInt(answer, 10);
      if (isNaN(amount) || amount === 0) { UI.toast('Invalid points / 积分无效', 'error'); return; }
    }

    var reason = window.prompt('Reason 原因（会写入 Audit Log）', 'Manual adjustment') || '';

    UI.showLoading('PROCESSING');
    var p = isWallet
      ? API.admin.manualWalletAdjustment(c.customerId, amount, reason)
      : API.admin.manualPointAdjustment(c.customerId, amount, reason);

    p.then(function (res) {
      UI.hideLoading();
      if (!res.success) { ADMIN.handleError(res.error); return; }
      UI.toast('Adjusted / 已调整', 'success');
      state.customer = res.data.customer;
      renderDetail();
    });
  }

  return { init: init };
})();
