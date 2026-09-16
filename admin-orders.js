/* =============================================================
   YETIPSY — admin-orders.js (Order / Transaction list)
   ============================================================= */

var ADMIN_ORDERS = (function () {

  var state = { status: 'ALL', keyword: '' };

  function init() {
    document.getElementById('filterSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      state.status = btn.getAttribute('data-status');
      load();
    });

    var kw = document.getElementById('keywordInput');
    var timer;
    kw.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.keyword = kw.value.trim();
        load();
      }, 320);
    });

    load();
  }

  function load() {
    API.staff.getOrders(60, {
      status: state.status === 'ALL' ? '' : state.status,
      keyword: state.keyword
    }).then(function (res) {
      var box = document.getElementById('ordersList');
      if (!res.success) { ADMIN.handleError(res.error); return; }

      var list = res.data.orders || [];
      if (!list.length) {
        box.innerHTML = '<div class="a-empty">No orders found / 没有订单</div>';
        return;
      }

      box.innerHTML = '<div class="a-list">' + list.map(function (o) {
        var chip =
          o.claimStatus === 'CLAIMED' ? 'chip ok' :
          o.claimStatus === 'AVAILABLE' ? 'chip gold' :
          o.claimStatus === 'EXPIRED' ? 'chip' : 'chip danger';

        return '<div class="a-item" ' + (ADMIN.isManager() && o.orderStatus === 'ACTIVE'
                ? 'data-cancel="' + UI.esc(o.orderId) + '"' : '') + '>' +
          '<div class="a-main">' +
            '<div class="a-title">' + UI.money(o.amount) +
              ' <span class="tiny muted-2">#' + UI.esc(o.externalOrderId || o.orderId) + '</span></div>' +
            '<div class="a-sub">' + UI.esc(o.source) +
              ' · ' + UI.esc(UI.dateTime(o.createdAt)) +
              (o.customerName ? ' · ' + UI.esc(o.customerName) : ' · unclaimed') +
            '</div>' +
          '</div>' +
          '<div class="a-right">' +
            '<span class="' + chip + '">' + UI.esc(o.claimStatus) + '</span>' +
            '<div class="a-meta">+' + UI.points(o.pointsEarned) + ' PT' +
              (o.walletUsed ? ' · -' + UI.money(o.walletUsed, false) : '') + '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';

      // 取消订单（Manager / Owner）
      Array.prototype.forEach.call(box.querySelectorAll('[data-cancel]'), function (node) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', function () {
          cancelOrder(node.getAttribute('data-cancel'));
        });
      });
    });
  }

  function cancelOrder(orderId) {
    if (!ADMIN.isManager()) { ADMIN.deny(); return; }
    var reason = window.prompt('Cancel this order? Points and rewards will be reversed.\n取消此订单？积分与奖励将被撤销。\n\nReason 原因：', 'Mistake');
    if (reason === null) return;

    UI.showLoading('CANCELLING');
    API.staff.cancelOrder(orderId, reason).then(function (res) {
      UI.hideLoading();
      if (!res.success) { ADMIN.handleError(res.error); return; }
      UI.toast('Order cancelled / 已取消', 'success');
      load();
    });
  }

  return { init: init };
})();
