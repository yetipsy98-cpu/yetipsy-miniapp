/* =============================================================
   YETIPSY — orders.js（2.0 Phase 6）
   -------------------------------------------------------------
   我的订单列表（§17 §37）

   · 进行中的订单排前面，结案的排后面
   · 每张卡片可以直接进订单详情看进度
   · 完成的订单可以「再点一次」（§37）
   ============================================================= */

var ORDERS = (function () {

  var FILTERS = [
    { key: '',          zh: '全部',   en: 'ALL' },
    { key: 'SUBMITTED', zh: '进行中', en: 'ACTIVE' },
    { key: 'COMPLETED', zh: '已完成', en: 'COMPLETED' },
    { key: 'CANCELLED', zh: '已取消', en: 'CANCELLED' }
  ];

  var STATUS = {
    SUBMITTED: { zh: '已提交', en: 'SUBMITTED', color: 'var(--gold)' },
    CONFIRMED: { zh: '制作中', en: 'PREPARING', color: 'var(--gold)' },   // 2.1.13 不再显示「已确认」
    PREPARING: { zh: '制作中', en: 'PREPARING', color: 'var(--gold)' },
    READY:     { zh: '可以取酒', en: 'READY',   color: 'var(--ok)' },
    COMPLETED: { zh: '已完成', en: 'COMPLETED', color: 'var(--ok)' },
    CANCELLED: { zh: '已取消', en: 'CANCELLED', color: 'var(--muted-2)' }
  };

  var state = { orders: [], filter: '', error: null };

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    renderFilters();
    renderSkeleton();
    load();
  }

  function load() {
    API.customer.getMyOrders({ limit: 30 }).then(function (res) {
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error)) renderError();
        return;
      }
      state.error = null;
      state.orders = res.data.orders || [];
      render();
    });
  }

  function renderFilters() {
    var strip = document.getElementById('statusStrip');
    if (!strip) return;
    strip.innerHTML = FILTERS.map(function (f) {
      var active = f.key === state.filter ? ' active' : '';
      return '<div class="cat-chip' + active + '" data-key="' + f.key + '">' +
        UI.esc(f.zh) + ' ' + UI.esc(f.en) + '</div>';
    }).join('');
    Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (el) {
      el.addEventListener('click', function () {
        state.filter = el.getAttribute('data-key') || '';
        renderFilters();
        render();
      });
    });
  }

  function renderSkeleton() {
    var box = document.getElementById('ordersBody');
    if (box) box.innerHTML = '<div class="menu-skeleton"></div>'.repeat(3);
  }

  function renderError() {
    var box = document.getElementById('ordersBody');
    if (!box) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    box.innerHTML =
      '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div class="bilingual-zh">订单载入失败</div>' +
        '<div class="bilingual-en">ORDERS FAILED TO LOAD</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">错误码 ' + UI.esc(code) + '</div>' +
        '<div class="tiny muted mt-12">' + UI.esc(state.error && state.error.message || '') + '</div>' +
      '</div>';
  }

  function render() {
    var box = document.getElementById('ordersBody');
    if (!box) return;

    var list = state.filter === 'SUBMITTED'
      ? state.orders.filter(function (o) {
          return ['SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'].indexOf(o.orderStatus) >= 0;
        })
      : state.orders.filter(function (o) {
          return !state.filter || o.orderStatus === state.filter;
        });

    if (!list.length) {
      box.innerHTML = UI.emptyState(
        state.filter ? '这个分类还没有订单' : '还没有点过单',
        state.filter ? 'NO ORDERS HERE YET' : 'NO ORDERS YET', 'activity') +
        '<a class="btn btn-primary mt-12" href="menu.html" style="display:block;text-align:center">' +
        '<span>去看看酒单<span class="btn-sub-label">VIEW MENU</span></span></a>';
      return;
    }

    box.innerHTML = list.map(card).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-id]'), function (el) {
      el.addEventListener('click', function () {
        UI.go('order.html?id=' + encodeURIComponent(el.getAttribute('data-id')));
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-reorder]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        onReorder(el.getAttribute('data-reorder'));
      });
    });
  }

  function card(o) {
    var s = STATUS[o.orderStatus] || { zh: o.orderStatus, en: o.orderStatus, color: 'var(--muted)' };
    var names = (o.items || []).map(function (it) {
      return it.name + ' ×' + it.quantity;
    }).join('、');
    var where = o.orderType === 'TABLE' && o.tableNumber
      ? '桌号 ' + UI.esc(o.tableNumber)
      : (o.orderType === 'TAKEAWAY' ? '外带' : '柜台自取');

    return '<div class="card" data-id="' + UI.esc(o.appOrderId) + '" style="cursor:pointer">' +
      '<div class="row-between">' +
        '<div style="letter-spacing:1px">' + UI.esc(o.orderNumber) + '</div>' +
        '<div style="color:' + s.color + ';font-size:13px">' + UI.esc(s.zh) +
          '<span class="tiny muted"> ' + UI.esc(s.en) + '</span></div>' +
      '</div>' +
      '<div class="small muted mt-12" style="line-height:1.7">' + UI.esc(names) + '</div>' +
      '<div class="divider"></div>' +
      '<div class="row-between">' +
        '<div class="tiny muted">' + where + ' · ' + UI.dateTime(o.createdAt) + '</div>' +
        '<div class="product-price">' + UI.money(o.finalAmount) + '</div>' +
      '</div>' +
      (o.pointsEarned > 0
        ? '<div class="tiny mt-12" style="color:var(--gold)">+' + o.pointsEarned + ' 积分</div>' : '') +
      (o.orderStatus === 'COMPLETED'
        ? '<button class="btn btn-ghost btn-sm mt-12" data-reorder="' + UI.esc(o.appOrderId) +
          '" style="width:100%">再点一次 ORDER AGAIN</button>' : '') +
    '</div>';
  }

  /** §37 把旧订单里还有货的商品放回购物车 */
  function onReorder(appOrderId) {
    API.customer.reorder(appOrderId).then(function (res) {
      if (!res.success) { UI.toast(res.error.message, 'error'); return; }
      if (!res.data.items.length) {
        UI.toast('这些商品目前都卖完了 / All items sold out', 'error', 3500);
        return;
      }
      var added = 0;
      res.data.items.forEach(function (it) {
        var r = CART.add({
          productId: it.productId,
          nameEN: it.nameEN,
          nameZH: it.nameZH,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          options: (it.options || []).map(function (id) { return { optionId: id }; }),
          note: it.note || ''
        });
        if (r.ok) added += 1;
      });

      var skipped = (res.data.unavailable || []).length;
      UI.toast('已加入 ' + added + ' 项' + (skipped ? '（' + skipped + ' 项已售完）' : ''),
        'success', 3200);
      if (added) setTimeout(function () { UI.go('cart.html'); }, 700);
    });
  }

  function debugState() {
    return {
      total: state.orders.length,
      filter: state.filter,
      errorCode: state.error ? state.error.code : null,
      statuses: state.orders.map(function (o) { return o.orderStatus; })
    };
  }

  return { init: init, load: load, debugState: debugState };

})();
