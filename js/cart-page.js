/* =============================================================
   YETIPSY — cart-page.js（2.0 Phase 4）
   -------------------------------------------------------------
   购物车页（§9）：清单 / 数量 / 移除 / 小计 → 去结帐

   ★ 这一页显示的金额只是「预览」。§42：结帐时后端会重新读
     Products 算价、验证库存与规格，前端送过去的金额一律被忽略。
     所以这里不做任何价格判断，只把 CART 里的数字加总显示。
   ============================================================= */

var CARTPAGE = (function () {

  var prefetchTimer = null;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    bindEvents();
    render();
  }

  /**
   * 购物车一有变动就（延后 400ms）请 CHECKOUT 先在背景算好报价。
   * 顾客改完数量、还在犹豫的时候，后端已经把金额算完了 →
   * 按「结帐」打开抽屉时是「已经有金额」的状态。
   */
  function schedulePrefetch() {
    if (typeof CHECKOUT === 'undefined' || !CHECKOUT.prefetch) return;
    /* 不在这里 invalidate：报价本身带着「购物车指纹」，
       购物车没变（例如刚从酒单页带过来的预载报价）就该直接沿用。
       真的变了的话，prefetch() 会自己重算。 */
    if (CHECKOUT.prefetchSoon) CHECKOUT.prefetchSoon();
    else CHECKOUT.prefetch();
  }

  function bindEvents() {
    var clearBtn = document.getElementById('clearCartBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      CART.clear();
      if (typeof CHECKOUT !== 'undefined' && CHECKOUT.invalidate) CHECKOUT.invalidate();
      render();
      UI.toast('已清空 / Cart cleared', 'success');
    });

    /* ★ 按「结帐」开小抽屉，不换页（2.1.13）。
       抽屉不存在时（万一）才退回旧结帐页。 */
    var checkout = document.getElementById('checkoutBtn');
    if (checkout) checkout.addEventListener('click', function () {
      if (!CART.items().length) return;
      if (typeof CHECKOUT !== 'undefined' && CHECKOUT.openSheet &&
          document.getElementById('checkoutSheet')) {
        CHECKOUT.openSheet();
        return;
      }
      UI.go('checkout.html');
    });
  }

  function render() {
    var list = CART.items();
    var box = document.getElementById('cartList');
    var cta = document.getElementById('stickyCta');
    if (!box) return;

    if (!list.length) {
      box.innerHTML = UI.emptyState('购物车是空的', 'YOUR CART IS EMPTY', 'wallet') +
        '<a class="btn btn-primary mt-12" href="menu.html" style="display:block;text-align:center">' +
        '<span>去看看酒单<span class="btn-sub-label">VIEW MENU</span></span></a>';
      if (cta) cta.style.display = 'none';
      var sub0 = document.getElementById('cartSubtotal');
      if (sub0) sub0.textContent = UI.money(0);
      return;
    }

    if (cta) cta.style.display = '';

    box.innerHTML = '<div class="list">' + list.map(row).join('') + '</div>' +
      '<div class="card mt-12 row-between">' +
        '<div class="bilingual-zh" style="font-size:14px">小计<span class="tiny muted"> SUBTOTAL</span></div>' +
        '<div class="product-price" id="cartSubtotal" style="font-size:18px">' +
          UI.money(CART.subtotalSen()) + '</div>' +
      '</div>' +
      '<div class="tiny muted mt-12" style="line-height:1.7;text-align:center">' +
        '结帐时价格会由系统重新确认<br>' +
        'Prices are re-confirmed by the system at checkout.' +
      '</div>' +
      '<button class="btn btn-ghost mt-12" id="clearCartBtn" style="width:100%">清空购物车 CLEAR CART</button>';

    bindRows();

    var clearBtn = document.getElementById('clearCartBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      CART.clear();
      render();
      UI.toast('已清空 / Cart cleared', 'success');
    });

    updateCta();
    schedulePrefetch();
  }

  function row(item) {
    var opts = (item.options || []).map(function (o) {
      return UI.esc(o.nameZH || o.nameEN);
    }).filter(function (s) { return s; }).join(' · ');

    return '<div class="list-item" data-line="' + UI.esc(item.lineId) + '">' +
      '<div class="li-main">' +
        '<div class="li-title">' + UI.esc(item.nameEN) + '</div>' +
        (item.nameZH ? '<div class="li-sub tiny muted">' + UI.esc(item.nameZH) + '</div>' : '') +
        (opts ? '<div class="li-sub tiny muted">' + opts + '</div>' : '') +
        (item.note ? '<div class="li-sub tiny muted">备注：' + UI.esc(item.note) + '</div>' : '') +
        '<div class="qty-ctrl" style="margin-top:9px">' +
          '<button class="qty-btn" data-act="minus">−</button>' +
          '<span class="qty-value">' + item.quantity + '</span>' +
          '<button class="qty-btn" data-act="plus">+</button>' +
        '</div>' +
      '</div>' +
      '<div class="li-right" style="text-align:right">' +
        '<div class="li-value">' + UI.money(CART.lineTotalSen(item)) + '</div>' +
        '<div class="tiny muted" style="margin-top:8px;cursor:pointer" data-act="remove">移除</div>' +
      '</div>' +
    '</div>';
  }

  function bindRows() {
    var box = document.getElementById('cartList');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.list-item'), function (el) {
      var lineId = el.getAttribute('data-line');
      Array.prototype.forEach.call(el.querySelectorAll('[data-act]'), function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          var current = CART.items().filter(function (it) { return it.lineId === lineId; })[0];
          if (!current) return;
          if (act === 'plus') CART.setQuantity(lineId, current.quantity + 1);
          else if (act === 'minus') CART.setQuantity(lineId, current.quantity - 1);
          else if (act === 'remove') CART.remove(lineId);
          render();
        });
      });
    });
  }

  function updateCta() {
    var btn = document.getElementById('checkoutBtn');
    if (!btn) return;
    var n = CART.count();
    btn.innerHTML = '<span>CHECKOUT ' + UI.money(CART.subtotalSen()) +
      '<span class="btn-sub-label">结帐 · ' + n + ' 杯</span></span>';
    btn.disabled = n === 0;
  }

  function debugState() {
    return {
      lines: CART.items().length,
      count: CART.count(),
      subtotal: CART.subtotalSen()
    };
  }

  return { init: init, render: render, prefetch: schedulePrefetch, debugState: debugState };

})();
