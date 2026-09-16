/* =============================================================
   YETIPSY — activity.js (Visits / Points / Wallet history)
   ============================================================= */

var ACTIVITY = (function () {

  var current = 'orders';
  var cache = {};

  var POINT_LABEL = {
    EARN:       { zh: '获得积分', en: 'EARN' },
    REDEEM:     { zh: '使用积分', en: 'REDEEM' },
    BONUS:      { zh: '奖励积分', en: 'BONUS' },
    ADJUSTMENT: { zh: '积分调整', en: 'ADJUSTMENT' },
    EXPIRED:    { zh: '积分过期', en: 'EXPIRED' },
    REVERSAL:   { zh: '积分撤销', en: 'REVERSAL' }
  };

  var WALLET_LABEL = {
    REWARD:        { zh: '消费奖励', en: 'REWARD' },
    REDEEM:        { zh: '消费抵扣', en: 'REDEMPTION' },
    MANUAL_ADD:    { zh: '手动添加', en: 'MANUAL ADD' },
    MANUAL_DEDUCT: { zh: '手动扣除', en: 'MANUAL DEDUCT' },
    REFUND:        { zh: '退款',     en: 'REFUND' },
    REVERSAL:      { zh: '撤销',     en: 'REVERSAL' },
    EXPIRED:       { zh: '过期',     en: 'EXPIRED' }
  };

  var SOURCE_LABEL = {
    FOODCOURT:   'FOODCOURT 食阁',
    DIRECT:      'DIRECT 直接',
    YETIPSY_APP: 'YETIPSY APP',
    MANUAL:      'MANUAL 手动'
  };

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    document.getElementById('tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      if (tab === current) return;
      current = tab;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === current);
      });
      render();
    });

    loadAll();
  }

  function loadAll() {
    Promise.all([
      API.customer.getOrderHistory(50),
      API.customer.getPointHistory(50),
      API.customer.getWalletHistory(50)
    ]).then(function (r) {
      cache.orders = (r[0].success && r[0].data.orders) || [];
      cache.points = (r[1].success && r[1].data.transactions) || [];
      cache.wallet = (r[2].success && r[2].data.transactions) || [];
      if (!r[0].success && !AUTH.handleSessionError(r[0].error)) UI.toast(r[0].error.message, 'error');
      render();
    });
  }

  function render() {
    var box = document.getElementById('listBox');
    if (current === 'orders') box.innerHTML = renderOrders(cache.orders || []);
    if (current === 'points') box.innerHTML = renderPoints(cache.points || []);
    if (current === 'wallet') box.innerHTML = renderWallet(cache.wallet || []);
  }

  function renderOrders(list) {
    if (!list.length) {
      return UI.emptyState('还没有消费记录', 'NO VISITS YET', 'activity');
    }
    return '<div class="list">' + list.map(function (o) {
      return '<div class="list-item">' +
        '<div class="li-main">' +
          '<div class="li-title">' + UI.money(o.amount) + '</div>' +
          '<div class="li-sub">' +
            UI.esc(SOURCE_LABEL[o.source] || o.source) +
            (o.externalOrderId ? ' · #' + UI.esc(o.externalOrderId) : '') +
            ' · ' + UI.esc(UI.dateOnly(o.createdAt)) +
          '</div>' +
        '</div>' +
        '<div class="li-right">' +
          '<div class="li-value gold">+' + UI.points(o.pointsEarned) + ' PT</div>' +
          '<div class="li-meta">' +
            (o.rewardAmount ? 'REWARD ' + UI.money(o.rewardAmount) : '') +
            (o.walletUsed ? ' · WALLET -' + UI.money(o.walletUsed, false) : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderPoints(list) {
    if (!list.length) return UI.emptyState('还没有积分记录', 'NO POINTS ACTIVITY YET', 'activity');
    return '<div class="list">' + list.map(function (t) {
      var meta = POINT_LABEL[t.type] || { zh: t.type, en: t.type };
      var plus = (t.points >= 0);
      return '<div class="list-item">' +
        '<div class="li-main">' +
          '<div class="li-title">' + UI.esc(meta.zh) + ' <span class="tiny muted-2">' + UI.esc(meta.en) + '</span></div>' +
          '<div class="li-sub">' + UI.esc(t.description || '') + ' · ' + UI.esc(UI.dateTime(t.createdAt)) + '</div>' +
        '</div>' +
        '<div class="li-right">' +
          '<div class="li-value ' + (plus ? 'ok' : 'minus') + '">' +
            (plus ? '+' : '') + UI.points(t.points) +
          '</div>' +
          '<div class="li-meta">BALANCE ' + UI.points(t.balanceAfter) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderWallet(list) {
    if (!list.length) return UI.emptyState('还没有钱包记录', 'NO WALLET ACTIVITY YET', 'wallet');
    return '<div class="list">' + list.map(function (t) {
      var meta = WALLET_LABEL[t.type] || { zh: t.type, en: t.type };
      var plus = (t.amount >= 0);
      return '<div class="list-item">' +
        '<div class="li-main">' +
          '<div class="li-title">' + UI.esc(meta.zh) + ' <span class="tiny muted-2">' + UI.esc(meta.en) + '</span></div>' +
          '<div class="li-sub">' + UI.esc(t.description || '') + ' · ' + UI.esc(UI.dateTime(t.createdAt)) + '</div>' +
        '</div>' +
        '<div class="li-right">' +
          '<div class="li-value ' + (plus ? 'ok' : 'minus') + '">' +
            (plus ? '+' : '-') + UI.money(Math.abs(t.amount), false) +
          '</div>' +
          '<div class="li-meta">BALANCE ' + UI.money(t.balanceAfter) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  return { init: init };
})();
