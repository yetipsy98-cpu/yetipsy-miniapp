/* =============================================================
   YETIPSY — checkout.js（2.0 Phase 5）
   -------------------------------------------------------------
   结帐页（§10 §11 §13 §42 §43 §44）

   流程：Cart → createCheckoutQuote() → 显示确认 → PLACE ORDER

   2.1.12 起有两种呈现方式（同一套逻辑）；2.1.13 起抽屉改成小的：
   · 页面：checkout.html（桌牌 QR 的 ?table= 连结还是走这里）
   · 小抽屉：cart.html 底部滑上来的结帐抽屉（顾客最常走的路）
     抽屉不用换页 → 不会重新载入脚本；购物车一有变动就先在背景把
     报价算好（见 prefetch），预载结果还会存进 sessionStorage，
     所以「酒单 → 购物车 → 结帐」一路都不会再等后端。

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

  var timer = null;

  /* 呈现方式：'page'（checkout.html）或 'sheet'（cart.html 的大抽屉） */
  var host = { mode: 'page' };

  /**
   * 预先算好的报价（2.1.12 起；2.1.13 会跨页沿用）
   * ---------------------------------------------------------
   * 购物车一有变动就在背景呼叫 createCheckoutQuote，
   * 报价只存在后端的快取里（不会写 Sheet），所以多算几次没有负担。
   * 顾客按「结帐」时，如果购物车没变、报价还没过期 → 直接用，
   * 打开抽屉就是「已经有金额」的状态，不用等。
   */
  var memo = { sig: '', quote: null, at: 0, cid: '' };
  var MEMO_KEY = 'yt_quote_memo_v1';       // 只活在这次浏览（分页 / 关掉就没了）
  var soonTimer = null;

  function storage() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  function memoLoad() {
    var st = storage();
    if (!st) return;
    try {
      var raw = st.getItem(MEMO_KEY);
      if (!raw) return;
      var m = JSON.parse(raw);
      if (m && m.quote && m.sig) memo = m;
    } catch (e) {}
  }

  function memoSave() {
    var st = storage();
    if (!st) return;
    try {
      if (memo.quote && memo.sig) st.setItem(MEMO_KEY, JSON.stringify(memo));
      else st.removeItem(MEMO_KEY);
    } catch (e) {}
  }

  function memoClear() {
    memo = { sig: '', quote: null, at: 0, cid: '' };
    memoSave();
  }

  function currentCustomerId() {
    try {
      var p = AUTH.getCustomerProfile();
      return (p && p.customerId) || '';
    } catch (e) { return ''; }
  }

  memoLoad();                              // 上一页（酒单 / 购物车）算好的报价直接接手

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

  function bodyEl() { return document.getElementById('checkoutBody'); }

  /**
   * 「下单」按钮所在的页脚。抽屉模式一定要指到抽屉自己的 #sheetCta，
   * 否则「请填桌号 / 报错」时藏的是购物车底栏，抽屉底下旧金额的
   * PLACE ORDER 还露着，顾客会按到过期的报价。
   */
  function ctaWrap() {
    var sheetCta = document.getElementById('sheetCta');
    if (host.mode === 'sheet') return sheetCta || document.getElementById('checkoutSheet');
    return document.getElementById('stickyCta') || sheetCta ||
           document.getElementById('checkoutSheet');
  }
  function showCta(on) {
    var node = ctaWrap();
    if (node && node.id !== 'checkoutSheet') node.style.display = on ? '' : 'none';
  }

  /* ---------------------------------------------------------
     报价预载（让「结帐」不用等；2.1.13 起跨页沿用）
     --------------------------------------------------------- */

  /**
   * 预载时用的取餐方式：还没选桌号就先当作「柜台自取」
   * （抽屉打开时默认也是柜台，见 initSheet），这样预载的金额跟
   * 顾客一打开看到的一定一致。
   */
  function warmTarget() {
    if (state.orderType === 'TABLE' && !state.tableNumber) return { t: 'COUNTER', n: '' };
    return { t: state.orderType, n: state.tableNumber };
  }

  /** 现在购物车 + 取餐方式 + 钱包选择的指纹：变了就代表报价要重算 */
  function cartSig() {
    try {
      var t = warmTarget();
      return JSON.stringify({
        items: CART.items().map(function (it) {
          return [it.productId, it.quantity, (it.options || []).map(function (o) { return o.optionId; }), it.note || ''];
        }),
        cid: currentCustomerId(),
        t: t.t,
        table: t.n,
        w: !!state.useWallet
      });
    } catch (e) { return ''; }
  }

  /**
   * 先在背景把报价算好。顾客还在看购物车的时候，后端就已经算完了。
   * 没有商品 / 需要桌号 / 还没登录 → 不做，不要浪费请求。
   */
  function prefetch() {
    if (!AUTH.isCustomerLoggedIn()) return;
    if (!CART.items().length) { memoClear(); return; }

    var sig = cartSig();
    if (memo.sig === sig && memo.quote) return;          // 已经算过了

    var t = warmTarget();
    API.customer.createCheckoutQuote(quoteRequest({ orderType: t.t, tableNumber: t.n }))
      .then(function (res) {
        if (!res.success) return;                        // 预载失败就算了，打开时再算一次
        if (cartSig() !== sig) return;                   // 这中间购物车又变了 → 丢掉
        memo = { sig: sig, quote: res.data, at: Date.now(), cid: currentCustomerId() };
        memoSave();
      });
  }

  /**
   * 购物车一动就先预约预载（合并 400ms 内连续的操作）。
   * 酒单页（加购物车）跟购物车页都用这一个，不必各自写计时器。
   */
  function prefetchSoon() {
    if (soonTimer) clearTimeout(soonTimer);
    soonTimer = setTimeout(function () {
      soonTimer = null;
      prefetch();
    }, 400);
  }

  /** 购物车变了：把预载的报价丢掉（马上会再算一次） */
  function invalidate() {
    memoClear();
  }

  /** 预载的报价还能用吗？（没过期 + 购物车没变） */
  function memoQuote() {
    if (!memo.quote) return null;
    if (memo.sig !== cartSig()) return null;
    if ((memo.cid || '') !== currentCustomerId()) return null;   // 换会员登入 → 不沿用别人的报价
    var minutes = Number(memo.quote.expiresInMinutes) || 0;
    if (minutes <= 0) return null;
    var ageMin = (Date.now() - memo.at) / 60000;
    if (ageMin > minutes - 0.5) return null;             // 剩不到 30 秒就重算
    return memo.quote;
  }

  function quoteRequest(override) {
    var t = override || {};
    return {
      items: CART.items().map(function (it) {
        return {
          productId: it.productId,
          quantity: it.quantity,
          options: (it.options || []).map(function (o) { return o.optionId; }),
          note: it.note || ''
        };
      }),
      orderType: t.orderType || state.orderType,
      tableNumber: t.tableNumber !== undefined ? t.tableNumber : state.tableNumber,
      useWallet: state.useWallet,
      customerNote: state.note
    };
  }

  /* ---------------------------------------------------------
     报价（§42 / §43）
     --------------------------------------------------------- */

  /** 这笔报价还是现在购物车算出来的吗？抽屉开着还能改数量，别拿旧金额下单 */
  function quoteFresh() {
    if (!state.quote) return false;
    if (state.quote.orderType !== state.orderType) return false;
    if ((state.quote.tableNumber || '') !== (state.tableNumber || '')) return false;
    if (state.quoteSig && state.quoteSig !== cartSig()) return false;
    return true;
  }

  function loadQuote() {
    state.error = null;
    /* 旧报价立刻作废：这次算不出来就是算不出来，
       留着它会让抽屉底下那颗（已经藏起来的）PLACE ORDER 还能按出旧金额 */
    state.quote = null;
    state.quoteSig = null;

    /* 选了「桌号」但还没输入 → 先请顾客填，不要送一个注定失败的请求 */
    if (state.orderType === 'TABLE' && !state.tableNumber) {
      renderAskTable();
      return;
    }

    /* 已经预载好的报价 → 立刻画，不必等后端（顾客按「结帐」的体感） */
    var ready = memoQuote();
    if (ready) {
      state.quote = ready;
      state.quoteSig = cartSig();
      render();
      return;
    }

    renderSkeleton();

    API.customer.createCheckoutQuote(quoteRequest()).then(function (res) {
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error)) renderError();
        return;
      }
      state.quote = res.data;
      state.quoteSig = cartSig();
      memo = { sig: state.quoteSig, quote: res.data, at: Date.now(), cid: currentCustomerId() };
      memoSave();
      render();
    });
  }

  /* ---------------------------------------------------------
     下单（§44）
     --------------------------------------------------------- */

  function onPlaceOrder() {
    if (state.placing || !state.quote) return;

    /* 抽屉里改了数量 / 换了取餐方式 → 这张报价已经不能用了 */
    if (!quoteFresh()) {
      UI.toast('购物车刚有变动，正在重新算价…', 'info', 2400);
      invalidate();
      loadQuote();
      return;
    }

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
      if (res.success) invalidate();           // 这张报价用掉了 → 别留给下一张单
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
      var newOrder = res.data.order;
      CART.clear();                                   // 下单成功才清车
      invalidate();                                   // 车空了 → 预载报价作废
      API.cache.clear();                              // 积分 / 订单 / 钱包都变了 → 下次重新抓
      /* 刚下单的订单先写进快取：订单页一开就有画面，不用等后端 */
      API.cache.write('getAppOrder', { appOrderId: state.orderId }, { order: newOrder });
      if (timer) { clearInterval(timer); timer = null; }
      UI.go('order.html?id=' + encodeURIComponent(state.orderId));
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
    var box = bodyEl();
    if (box) {
      box.innerHTML = '<div class="menu-skeleton"></div>'.repeat(4);
    }
  }

  function renderEmpty() {
    var box = bodyEl();
    if (box) {
      box.innerHTML = UI.emptyState('购物车是空的', 'YOUR CART IS EMPTY', 'wallet') +
        '<a class="btn btn-primary mt-12" href="menu.html" style="display:block;text-align:center">' +
        '<span>去看看酒单<span class="btn-sub-label">VIEW MENU</span></span></a>';
    }
    showCta(false);
  }

  /** 选了桌号但还没输入 → 请顾客填，不要送注定失败的请求（§11） */
  function renderAskTable() {
    var box = bodyEl();
    if (!box) return;
    showCta(false);

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
    var box = bodyEl();
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

    showCta(false);

    var retry = document.getElementById('quoteRetryBtn');
    if (retry) retry.addEventListener('click', loadQuote);
  }

  function render() {
    var q = state.quote;
    var box = bodyEl();
    if (!box) return;

    showCta(true);
    setSheetSubtitle(q);

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

  /** 抽屉标题下面那行小字（页面模式没有这个元素，会自动忽略） */
  function setSheetSubtitle(q) {
    var node = document.getElementById('sheetSubtitle');
    if (!node || !q) return;
    node.textContent = q.itemCount + ' 杯 · 应付 ' + UI.money(q.finalAmount);
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
    var box = bodyEl();
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

  /* ---------------------------------------------------------
     大抽屉（cart.html）：不用换页的结帐
     --------------------------------------------------------- */

  /**
   * 在购物车页准备好抽屉。会先把取餐方式设好（?table= 自动带入），
   * 并按需要预载报价。
   */
  function initSheet() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    var sheet = document.getElementById('checkoutSheet');
    if (!sheet) return;
    host = { mode: 'sheet' };

    /* §12 桌牌 QR 也带进抽屉（cart.html?table=A12）；
       没有 ?table 就预设「柜台自取」——这样一按结帐就能马上算价，
       不会先问一个「你在哪一桌」。 */
    var qrTable = (UI.getParam('table') || '').toUpperCase().slice(0, 12);
    if (qrTable) { state.orderType = 'TABLE'; state.tableNumber = qrTable; }
    else { state.orderType = 'COUNTER'; state.tableNumber = ''; }

    /* #checkoutBtn 由 cart-page.js 绑（那边还要照顾没抽屉时的 fallback），
       这里不要再绑一次，否则一次点击 openSheet / loadQuote 会跑两遍 */
    var close = document.getElementById('sheetCloseBtn');
    if (close) close.addEventListener('click', closeSheet);
    var backdrop = document.getElementById('sheetBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeSheet);
    var place = document.getElementById('placeOrderBtn');
    if (place) place.addEventListener('click', onPlaceOrder);
    var retry = document.getElementById('quoteRetryBtn');
    if (retry) retry.addEventListener('click', loadQuote);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.style.display !== 'none') closeSheet();
    });

    prefetch();                       // 顾客还在看购物车就已经在算价
  }

  function openSheet() {
    var sheet = document.getElementById('checkoutSheet');
    if (!sheet) return;
    if (!CART.items().length) { UI.toast('购物车是空的 / Cart is empty', 'error'); return; }
    sheet.style.display = '';
    document.body.classList.add('sheet-open');
    state.error = null;
    loadQuote();                      // 有预载 → 瞬间画好；没有 → 骨架 + 后端
  }

  function closeSheet() {
    var sheet = document.getElementById('checkoutSheet');
    if (!sheet) return;
    sheet.style.display = 'none';
    document.body.classList.remove('sheet-open');
  }

  function isSheetOpen() {
    var sheet = document.getElementById('checkoutSheet');
    return !!sheet && sheet.style.display !== 'none';
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
    initSheet: initSheet,
    openSheet: openSheet,
    closeSheet: closeSheet,
    isSheetOpen: isSheetOpen,
    prefetch: prefetch,
    prefetchSoon: prefetchSoon,
    invalidate: invalidate,
    loadQuote: loadQuote,
    debugState: debugState
  };

})();
