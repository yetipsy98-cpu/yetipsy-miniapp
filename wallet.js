/* =============================================================
   YETIPSY — wallet.js (Customer Wallet)
   ============================================================= */

var WALLET = (function () {

  var TYPE_LABEL = {
    REWARD:       { zh: '消费奖励', en: 'REWARD',        sign: '+' },
    REDEEM:       { zh: '消费抵扣', en: 'REDEMPTION',    sign: '-' },
    MANUAL_ADD:   { zh: '手动添加', en: 'MANUAL ADD',    sign: '+' },
    MANUAL_DEDUCT:{ zh: '手动扣除', en: 'MANUAL DEDUCT', sign: '-' },
    REFUND:       { zh: '退款',     en: 'REFUND',        sign: '+' },
    REVERSAL:     { zh: '撤销',     en: 'REVERSAL',      sign: ''  },
    EXPIRED:      { zh: '过期',     en: 'EXPIRED',       sign: '-' }
  };

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    load();
  }

  function load() {
    Promise.all([
      API.customer.getWallet(),
      API.customer.getWalletHistory(50)
    ]).then(function (res) {
      var w = res[0], h = res[1];

      if (!w.success) {
        if (!AUTH.handleSessionError(w.error)) UI.toast(w.error.message, 'error');
        return;
      }
      document.getElementById('walletValue').textContent = UI.money(w.data.balance);

      var box = document.getElementById('walletHistory');
      if (!h.success || !h.data.transactions || !h.data.transactions.length) {
        box.innerHTML = UI.emptyState('还没有钱包记录', 'NO WALLET ACTIVITY YET', 'wallet');
        return;
      }
      box.innerHTML = '<div class="list">' +
        h.data.transactions.map(function (t) { return row(t); }).join('') +
        '</div>';
    });
  }

  function row(t) {
    var meta = TYPE_LABEL[t.type] || { zh: t.type, en: t.type, sign: '' };
    var isPlus = meta.sign === '+';
    return '<div class="list-item">' +
      '<div class="li-main">' +
        '<div class="li-title">' + UI.esc(meta.zh) + ' <span class="tiny muted-2">' + UI.esc(meta.en) + '</span></div>' +
        '<div class="li-sub">' + UI.esc(t.description || '') + ' · ' + UI.esc(UI.dateTime(t.createdAt)) + '</div>' +
      '</div>' +
      '<div class="li-right">' +
        '<div class="li-value ' + (isPlus ? 'ok' : 'minus') + '">' +
          (isPlus ? '+' : '-') + UI.money(Math.abs(t.amount), false) +
        '</div>' +
      '</div>' +
    '</div>';
  }

  return { init: init };
})();
