/* =============================================================
   YETIPSY — checkout.js（2.0 Phase 5）
   -------------------------------------------------------------
   结帐页（§10 §11 §13 §42 §43 §44）

   流程：Cart → createCheckoutQuote() → 显示确认 → PLACE ORDER

   规则：
   · 页面上每个金额都来自后端 Quote，前端不做任何价格判断（§41/§42）
   · Quote 有期限，过期就重新报价（§43），不假装还能用
   · 下单一定带 IdempotencyKey，按钮按完立刻锁死（§44）
   · 钱包在这一步只是「要求」，真正扣款在员工确认收款时（§54）
   ============================================================= */

var CHECKOUT = (function () {

  var state = {
    quote: null,
    error: null,
    orderType: 'TABLE',
    tableNumber: '',
    useWallet: true,
    note: '',
    placing: false,
    orderId: null
  };

  var POLL_MS = 20000;          // 报价剩馀时间的显示刷新（不向后端要资料）
  var timer = null;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    /*
     * §12 桌牌 QR：/checkout.html?table=A12 → 自动带入桌号，不用重打。
     * 没有 ?table 时预设「柜台自取」——这样一进来就能算价，
     * 不会先弹一个「请输入桌号」的错误给顾客看。
     */
    var qrTable = (UI.getParam('table') || '').toUpperCase().slice(0, 12);
    if (qrTable) {
      state.orderType = 'TABLE';
      state.tableNumber = qrTable;
    } else {
      state.orderType = 'COUNTER';
      state.tableNumber = '';
    }

    bindEvents();
    if (!CART.items().length) {
      renderEmpty();
      return;
    }
    loadQuote();
  }

  function bindEvents() {
    var place = document.getElementById('placeOrderBtn');
    if (place) place.addEventListener('click', onPlaceOrder);
    var retry = document.getElementById('quoteRetryBtn');
    if (retry) retry.addEventListener('click', loadQuote);
  }

  /* ---------------------------------------------------------
     报价（§42 / §43）
     --------------------------------------------------------- */

  function loadQuote() {
    state.error = null;

    /* 选了「桌号」但还没输入 → 先请顾客填，不要送一个注定失败的请求 */
    if (state.orderType === 'TABLE' && !state.tableNumber) {
      renderAskTable();
      return;
    }

    renderSkeleton();

    API.customer.createCheckoutQuote({
      items: CART.items().map(function (it) {
        return {
          productId: it.productId,
          quantity: it.quantity,
          options: (it.options || []).map(function (o) { return o.optionId; }),
          note: it.note || ''
        };
      }),
      orderType: state.orderType,
      tableNumber: state.tableNumber,
      useWallet: state.useWallet,
      customerNote: state.note
    }).then(function (res) {
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error)) renderError();
        return;
      }
      state.quote = res.data;
      render();
    });
  }

  /* ---------------------------------------------------------
     下单（§44）
     --------------------------------------------------------- */

  function onPlaceOrder() {
    if (state.placing || !state.quote) return;
    state.placing = true;
    setPlacing(true);

    API.customer.placeOrder({
      quoteToken: state.quote.quoteToken,
      idempotencyKey: state.quote.idempotencyKey,     // §44 防重复下单
      orderType: state.quote.orderType,
      tableNumber: state.quote.tableNumber,
      paymentMethod: 'COUNTER'                        // §14 第一阶段柜台付款
    }).then(function (res) {
      state.placing = false;
      if (!res.success) {
        setPlacing(false);
        /* Quote 过期 / 价格变动 → 重新报价，不要静默改金额 */
        if (res.error && (res.error.code === 'QUOTE_EXPIRED' ||
                          res.error.code === 'QUOTE_MISMATCH' ||
                          res.error.code === 'PRODUCT_UNAVAILABLE')) {
          UI.toast(res.error.message, 'error', 4200);
          CART.clear();
          setTimeout(function () { UI.go('menu.html'); }, 1600);
          return;
        }
        if (!AUTH.handleSessionError(res.error)) {
          UI.toast(res.error.message, 'error', 4200);
        }
        return;
      }

      state.orderId = res.data.order.appOrderId;
      CART.clear();                                   // 下单成功才清车
      if (timer) { clearInterval(timer); timer = null; }
      UI.go('order.html?id=' + encodeURIComponent(res.data.order.appOrderId));
    });
  }

  function setPlacing(on) {
    var btn = document.getElementById('placeOrderBtn');
    if (!btn) return;
    btn.disabled = on || !state.quote;
    UI.setLoading(btn, on, '提交中… SUBMITTING');
    if (!on && state.quote) renderCta();
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function renderSkeleton() {
    var box = document.getElementById('checkoutBody');
    if (box) {
      box.innerHTML = '<div class="menu-skeleton"></div>'.repeat(4);
    }
  }

  function renderEmpty() {
    var box = document.getElementById('checkoutBody');
    if (box) {
      box.innerHTML = UI.emptyState('购物车是空的', 'YOUR CART IS EMPTY', 'wallet') +
        '<a class="btn btn-primary mt-12" href="menu.html" style="display:block;text-align:center">' +
        '<span>去看看酒单<span class="btn-sub-label">VIEW MENU</span></span></a>';
    }
    var cta = document.getElementById('stickyCta');
    if (cta) cta.style.display = 'none';
  }

  /** 选了桌号但还没输入 → 请顾客填，不要送注定失败的请求（§11） */
  function renderAskTable() {
    var box = document.getElementById('checkoutBody');
    if (!box) return;
    var cta = document.getElementById('stickyCta');
    if (cta) cta.style.display = 'none';

    box.innerHTML =
      '<div class="card" style="text-align:center;padding:24px 16px">' +
        '<div class="bilingual-zh">你在哪一桌？</div>' +
        '<div class="bilingual-en">WHICH TABLE ARE YOU AT?</div>' +
        '<div class="divider"></div>' +
        '<input class="input" id="askTableInput" placeholder="A12" maxlength="12" ' +
          'style="text-align:center;font-size:20px;letter-spacing:3px">' +
        '<div class="tiny muted mt-12">也可以改成柜台自取</div>' +
        '<button class="btn btn-secondary mt-12" id="askCounterBtn" style="width:100%">' +
          '柜台自取 COUNTER PICKUP</button>' +
      '</div>';

    var input = document.getElementById('askTableInput');
    if (input) {
      input.focus();
      input.addEventListener('change', function () {
        var v = input.value.trim().toUpperCase();
        if (!v) return;
        state.tableNumber = v;
        loadQuote();
      });
    }
    var counter = document.getElementById('askCounterBtn');
    if (counter) counter.addEventListener('click', function () {
      state.orderType = 'COUNTER';
      state.tableNumber = '';
      loadQuote();
    });
  }

  function renderError() {
    var box = document.getElementById('checkoutBody');
    if (!box) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    var hint = '';
    if (code === 'ORDERING_CLOSED' || code === 'ORDERING_PAUSED') {
      hint = '你可以先浏览酒单，等开放后再下单。';
    } else if (code === 'PRODUCT_UNAVAILABLE') {
      hint = '有商品刚卖完，请回酒单重新选择。';
    }

    box.innerHTML =
      '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div class="bilingual-zh">无法结帐</div>' +
        '<div class="bilingual-en">CHECKOUT UNAVAILABLE</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">错误码 ' + UI.esc(code) + '</div>' +
        '<div class="tiny muted mt-12" style="line-height:1.7">' +
          UI.esc(state.error && state.error.message || '') +
          (hint ? '<br><br>' + UI.esc(hint) : '') +
        '</div>' +
        '<button class="btn btn-secondary mt-12" id="quoteRetryBtn">重新计算 RETRY</button>' +
        '<a class="btn btn-ghost mt-12" href="cart.html" style="display:block;text-align:center">' +
          '回购物车 BACK TO CART</a>' +
      '</div>';

    var cta = document.getElementById('stickyCta');
    if (cta) cta.style.display = 'none';

    var retry = document.getElementById('quoteRetryBtn');
    if (retry) retry.addEventListener('click', loadQuote);
  }

  function render() {
    var q = state.quote;
    var box = document.getElementById('checkoutBody');
    if (!box) return;

    var cta = document.getElementById('stickyCta');
    if (cta) cta.style.display = '';

    /* 品项 */
    var lines = q.lines.map(function (l) {
      var opts = (l.options || []).map(function (o) {
        return UI.esc(o.nameZH || o.nameEN);
      }).filter(function (s) { return s; }).join(' · ');
      return '<div class="list-item">' +
        '<div class="li-main">' +
          '<div class="li-title">' + UI.esc(l.productNameSnapshot) + '</div>' +
          (opts ? '<div class="li-sub tiny muted">' + opts + '</div>' : '') +
          (l.customerNote ? '<div class="li-sub tiny muted">备注：' + UI.esc(l.customerNote) + '</div>' : '') +
          '<div class="li-sub tiny muted">' + UI.money(l.unitPriceSen) + ' × ' + l.quantity + '</div>' +
        '</div>' +
        '<div class="li-right"><div class="li-value">' + UI.money(l.lineTotalSen) + '</div></div>' +
      '</div>';
    }).join('');

    /* 取餐方式（§11） */
    var pickup =
      '<div class="card">' +
        '<div class="bilingual-zh">你在哪里？</div>' +
        '<div class="bilingual-en">WHERE ARE YOU SITTING?</div>' +
        '<div class="option-row' + (q.orderType === 'TABLE' ? ' selected' : '') + '" data-type="TABLE">' +
          '<div class="option-radio"></div>' +
          '<div class="option-name">桌号 Table Number</div>' +
        '</div>' +
        (q.orderType === 'TABLE'
          ? '<div style="padding:0 14px 12px"><input class="input" id="tableInput" ' +
            'value="' + UI.esc(q.tableNumber || '') + '" placeholder="A12" maxlength="12"></div>'
          : '') +
        '<div class="option-row' + (q.orderType === 'COUNTER' ? ' selected' : '') + '" data-type="COUNTER">' +
          '<div class="option-radio"></div>' +
          '<div class="option-name">柜台自取 Counter Pickup</div>' +
        '</div>' +
      '</div>';

    /* 钱包（§10 / §54） */
    var walletBox = '';
    var wallet = q.wallet || {};
    if (wallet.balance > 0) {
      walletBox = '<div class="card">' +
        '<div class="row-between">' +
          '<div>' +
            '<div class="bilingual-zh">Yetipsy 钱包</div>' +
            '<div class="bilingual-en">YETIPSY WALLET</div>' +
            '<div class="tiny muted mt-12">余额 ' + UI.money(wallet.balance) +
              ' · 本单最多可抵 ' + UI.money(wallet.maxUsable) +
              '（' + wallet.maxPercent + '%）</div>' +
          '</div>' +
          '<label class="option-radio" style="width:22px;height:22px;flex:0 0 22px;' +
            'border-radius:6px;cursor:pointer' +
            (wallet.requested ? ';border-color:var(--gold);background:var(--gold-soft)' : '') + '">' +
            '<input type="checkbox" id="useWalletChk"' + (wallet.requested ? ' checked' : '') +
              (wallet.allowed ? '' : ' disabled') +
              ' style="opacity:0;width:100%;height:100%;margin:0;cursor:pointer">' +
          '</label>' +
        '</div>' +
        (wallet.requested && wallet.applied > 0
          ? '<div class="tiny" style="color:var(--gold);margin-top:10px">' +
            '本单抵扣 ' + UI.money(wallet.applied) +
            '（员工确认收款时才会扣，取消会全额退回）</div>'
          : '') +
        (!wallet.allowed
          ? '<div class="tiny muted" style="margin-top:10px">' +
            UI.esc(wallet.reason || '本单不能使用钱包') + '</div>'
          : '') +
      '</div>';
    }

    /* 金额 */
    var totals = '<div class="card">' +
      row('小计 SUBTOTAL', UI.money(q.subtotal)) +
      (q.wallet && q.wallet.applied > 0
        ? row('钱包抵扣 WALLET', '−' + UI.money(q.wallet.applied), 'var(--gold)') : '') +
      (q.discount > 0 ? row('优惠 DISCOUNT', '−' + UI.money(q.discount)) : '') +
      '<div class="divider"></div>' +
      row('应付 TOTAL', UI.money(q.finalAmount), 'var(--gold)', true) +
      '<div class="tiny muted mt-12" style="line-height:1.7">' +
        '柜台付款 · PAY AT COUNTER<br>' +
        '预计可得 ' + q.estimatedPoints + ' 积分（完成订单后发放）' +
      '</div>' +
    '</div>';

    box.innerHTML =
      '<div class="list" style="border-radius:var(--radius);overflow:hidden;margin-bottom:12px">' +
        lines + '</div>' +
      pickup + walletBox + totals +
      '<div class="tiny muted" style="text-align:center;line-height:1.7" id="quoteTimer"></div>';

    bindPickup();
    bindWallet();
    renderCta();
    startTimer();
  }

  function row(zhEn, value, color, big) {
    var label = zhEn.split(' ');
    return '<div class="row-between" style="padding:5px 0">' +
      '<div class="' + (big ? 'bilingual-zh' : 'small muted') + '">' +
        UI.esc(label[0]) + '<span class="tiny muted"> ' + UI.esc(label.slice(1).join(' ')) + '</span></div>' +
      '<div style="' + (color ? 'color:' + color + ';' : '') +
        (big ? 'font-size:19px;font-weight:600' : 'font-size:14px') + '">' + value + '</div>' +
    '</div>';
  }

  function bindPickup() {
    var box = document.getElementById('checkoutBody');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-type]'), function (el) {
      el.addEventListener('click', function () {
        state.orderType = el.getAttribute('data-type');
        state.tableNumber = state.orderType === 'TABLE' ? (state.tableNumber || '') : '';
        loadQuote();               // 换方式要重新报价
      });
    });
    var tableInput = document.getElementById('tableInput');
    if (tableInput) {
      tableInput.addEventListener('change', function () {
        state.tableNumber = tableInput.value.trim();
        loadQuote();
      });
    }
  }

  function bindWallet() {
    var chk = document.getElementById('useWalletChk');
    if (!chk) return;
    chk.addEventListener('change', function () {
      state.useWallet = chk.checked;
      loadQuote();                 // 钱包要用多少由后端算，这里只回报意愿（§10）
    });
  }

  function renderCta() {
    var btn = document.getElementById('placeOrderBtn');
    if (!btn || !state.quote) return;
    var where = state.quote.orderType === 'TABLE' && state.quote.tableNumber
      ? '桌号 ' + UI.esc(state.quote.tableNumber)
      : (state.quote.orderType === 'TABLE' ? '柜台自取' : '柜台自取');
    btn.innerHTML = '<span>PLACE ORDER ' + UI.money(state.quote.finalAmount) +
      '<span class="btn-sub-label">下单 · ' + where + '</span></span>';
    btn.disabled = state.placing;
  }

  /** 报价剩馀时间（§43）——只用本地时间显示，不向后端要资料 */
  function startTimer() {
    if (timer) clearInterval(timer);
    var el = document.getElementById('quoteTimer');
    if (!el || !state.quote) return;
    var minutes = Number(state.quote.expiresInMinutes) || 0;
    var deadline = Date.now() + minutes * 60000;

    function tick() {
      var left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      var node = document.getElementById('quoteTimer');
      if (!node) { clearInterval(timer); timer = null; return; }
      if (left <= 0) {
        clearInterval(timer); timer = null;
        node.innerHTML = '<span style="color:var(--danger)">报价已过期，正在重新计算…</span>';
        setTimeout(loadQuote, 900);
        return;
      }
      var mm = Math.floor(left / 60), ss = left % 60;
      node.textContent = '报价有效 ' + mm + ':' + (ss < 10 ? '0' : '') + ss +
        ' · 价格以结帐时为准 · Quote valid ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  function debugState() {
    return {
      hasQuote: !!state.quote,
      errorCode: state.error ? state.error.code : null,
      orderType: state.quote ? state.quote.orderType : state.orderType,
      tableNumber: state.quote ? state.quote.tableNumber : '',
      subtotal: state.quote ? state.quote.subtotal : 0,
      walletApplied: state.quote ? state.quote.wallet.applied : 0,
      walletRequested: state.quote ? state.quote.wallet.requested : false,
      finalAmount: state.quote ? state.quote.finalAmount : 0,
      estimatedPoints: state.quote ? state.quote.estimatedPoints : 0,
      idempotencyKey: state.quote ? state.quote.idempotencyKey : '',
      expiresInMinutes: state.quote ? state.quote.expiresInMinutes : 0,
      orderId: state.orderId
    };
  }

  return {
    init: init,
    loadQuote: loadQuote,
    debugState: debugState
  };

})();
