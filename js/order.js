/* =============================================================
   YETIPSY — order.js（2.0 Phase 6）
   -------------------------------------------------------------
   订单追踪（§16 §17 §18 §47 §49 §53）

   规则：
   · §47 只在页面开着时轮询；订单结案（COMPLETED / CANCELLED）就停止
   · §49 等待时间由后端给的 waitingSeconds（CreatedAt 算的）显示，
         本地只做秒数递增，不额外写库
   · §18 READY 时要有明显的取酒提示
   ============================================================= */

var ORDER = (function () {

  /* 2.1.13：中间不再有「已确认」这一步 —— 员工按一下就是制作中。
     后端如果还停在 CONFIRMED，对顾客来说就是「制作中」。 */
  var STEPS = [
    { key: 'SUBMITTED', zh: '已收到订单', en: 'ORDER RECEIVED' },
    { key: 'PREPARING', zh: '制作中',       en: 'PREPARING' },
    { key: 'READY',     zh: '可以取酒',     en: 'READY' },
    { key: 'COMPLETED', zh: '已完成',       en: 'COMPLETED' }
  ];

  /** 后端状态 → 进度条上的那一步（CONFIRMED 并进 PREPARING） */
  var STEP_OF_STATUS = {
    SUBMITTED: 'SUBMITTED', CONFIRMED: 'PREPARING', PREPARING: 'PREPARING',
    READY: 'READY', COMPLETED: 'COMPLETED'
  };

  var STATUS_LABEL = {
    SUBMITTED: { zh: '已提交', en: 'SUBMITTED' },
    CONFIRMED: { zh: '制作中', en: 'PREPARING' },
    PREPARING: { zh: '制作中', en: 'PREPARING' },
    READY:     { zh: '可以取酒', en: 'READY' },
    COMPLETED: { zh: '已完成', en: 'COMPLETED' },
    CANCELLED: { zh: '已取消', en: 'CANCELLED' }
  };

  var PAY_LABEL = {
    UNPAID:   { zh: '未付款', en: 'UNPAID' },
    PENDING:  { zh: '待确认', en: 'PENDING' },
    PAID:     { zh: '已付款', en: 'PAID' },
    REFUNDED: { zh: '已退款', en: 'REFUNDED' },
    FAILED:   { zh: '付款失败', en: 'FAILED' }
  };

  var state = {
    appOrderId: '',
    order: null,
    error: null,
    loadFailed: false,
    pollSeconds: 3,
    ticking: 0,
    lastNotifiedStatus: null
  };

  var poller = null;
  var tickTimer = null;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    state.appOrderId = UI.getParam('id') || '';
    if (!state.appOrderId) {
      UI.toast('缺少订单编号 / Missing order id', 'error');
      return;
    }
    bindEvents();
    /* 连线提示 = 这一页自己的载入结果 + 全局网络状态（见 UI.netPill） */
    API.onNetwork(function (st) { UI.netPill(state.loadFailed, st); });

    renderSkeleton();
    load(true);

    /* 手动重新载入（连线恢复后不用重开页面） */
    var retry = document.getElementById('retryBtn');
    if (retry) retry.addEventListener('click', function () { load(true); });
  }

  function bindEvents() {
    var cancel = document.getElementById('cancelOrderBtn');
    if (cancel) cancel.addEventListener('click', onCancel);

    /* §47 页面看不到时就不要再轮询 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPolling();
      else if (state.order && !isFinal(state.order.orderStatus)) load(false);
    });
  }

  function isFinal(status) {
    return status === 'COMPLETED' || status === 'CANCELLED';
  }

  function load(first) {
    return API.customer.getAppOrder(state.appOrderId, { force: !!first || first === true })
      .then(function (res) {
        if (!res.success) {
          state.error = res.error;
          /* 已经有资料：留著画面继续显示，只提示连线不稳（不要跳错误页） */
          if (state.order) { state.loadFailed = true; UI.netPill(true); return res; }
          if (!AUTH.handleSessionError(res.error)) renderError();
          stopPolling();
          return res;
        }
        state.error = null;
        state.loadFailed = false;
        UI.netPill(false, 'ok');
        state.order = res.data.order;
        render();
        startPolling();                    // 由 API.poll 自己判断要不要继续
        if (isFinal(state.order.orderStatus)) stopPolling();
        return res;
      });
  }

  /* §47 轮询：预设 12 秒，只在页面开着、订单未结案时跑 */
  function startPolling() {
    if (poller) return;                    // 已经在跑就不要重复挂
    /* 2.1.14：取餐状态要更快看到 → 预设 3 秒（以前 12 秒），最低不低于 3 秒 */
    state.pollSeconds = Number(YETIPSY_CONFIG.CUSTOMER_ORDER_POLL_SECONDS || 3);
    poller = API.poll(Math.max(3, state.pollSeconds), function () {
      if (isFinal(state.order && state.order.orderStatus)) { stopPolling(); return Promise.resolve({ success: true }); }
      return load(false);
    });

    /* 等待秒数每秒 +1（§49：由 CreatedAt 算出来的基准，不在本地重算时间） */
    if (!tickTimer) {
      tickTimer = setInterval(function () {
        state.ticking += 1;
        var el = document.getElementById('waitingTimer');
        if (el && state.order) el.textContent = fmtWait(state.order.waitingSeconds + state.ticking);
      }, 1000);
    }
  }

  function stopPolling() {
    if (poller) { poller.stop(); poller = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function fmtWait(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function onCancel() {
    API.customer.requestOrderCancellation(state.appOrderId, 'Cancelled from app').then(function (res) {
      if (!res.success) {
        UI.toast(res.error.message, 'error', 4000);
        return;
      }
      UI.toast('订单已取消 / Order cancelled', 'success');
      state.order = res.data.order;
      render();
      stopPolling();
    });
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function renderSkeleton() {
    var box = document.getElementById('orderBody');
    if (box) box.innerHTML = '<div class="menu-skeleton" style="height:120px"></div>' +
      '<div class="menu-skeleton"></div><div class="menu-skeleton"></div>';
  }

  function renderError() {
    var box = document.getElementById('orderBody');
    if (!box) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    box.innerHTML =
      '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div class="bilingual-zh">找不到这张订单</div>' +
        '<div class="bilingual-en">ORDER NOT FOUND</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">错误码 ' + UI.esc(code) + '</div>' +
        '<a class="btn btn-secondary mt-12" href="orders.html" style="display:block;text-align:center">' +
          '我的订单 MY ORDERS</a>' +
      '</div>';
  }

  function render() {
    var o = state.order;
    var box = document.getElementById('orderBody');
    if (!box) return;
    state.ticking = 0;

    var label = STATUS_LABEL[o.orderStatus] || { zh: o.orderStatus, en: o.orderStatus };
    var pay = PAY_LABEL[o.paymentStatus] || { zh: o.paymentStatus, en: o.paymentStatus };

    /* §18 READY 的取酒提示 */
    var readyBanner = '';
    if (o.orderStatus === 'READY') {
      readyBanner = '<div class="ordering-banner" style="text-align:center">' +
        '<div style="font-size:26px">🍸</div>' +
        '<div class="ordering-banner-zh">你的酒好了！</div>' +
        '<div class="ordering-banner-en">YOUR DRINKS ARE READY</div>' +
        '<div class="tiny muted mt-12">请到 Yetipsy 吧台取酒<br>' +
          'Please collect your drinks at the Yetipsy bar.</div>' +
      '</div>';
    }
    if (o.orderStatus === 'CANCELLED') {
      readyBanner = '<div class="ordering-banner" style="border-color:rgba(226,105,107,.4)">' +
        '<div class="ordering-banner-zh" style="color:var(--danger)">订单已取消</div>' +
        '<div class="ordering-banner-en">ORDER CANCELLED</div>' +
        (o.cancelReason ? '<div class="tiny muted mt-12">' + UI.esc(o.cancelReason) + '</div>' : '') +
      '</div>';
    }

    /* 进度（§17） */
    var progress = '';
    if (o.orderStatus !== 'CANCELLED') {
      var reached = STEPS.map(function (s) { return s.key; })
        .indexOf(STEP_OF_STATUS[o.orderStatus] || o.orderStatus);
      progress = '<div class="card">' + STEPS.map(function (s, i) {
        var done = i < reached;
        var active = i === reached;
        var mark = done ? '✓' : (active ? '●' : '○');
        var color = done ? 'var(--ok)' : (active ? 'var(--gold)' : 'var(--muted-2)');
        return '<div class="row-between" style="padding:6px 0">' +
          '<div style="color:' + color + ';font-size:14px">' + mark + ' ' +
            UI.esc(s.zh) + '<span class="tiny muted"> ' + UI.esc(s.en) + '</span></div>' +
        '</div>';
      }).join('') + '</div>';
    }

    /* 品项 */
    var items = (o.items || []).map(function (it) {
      var opts = (it.options || []).map(function (x) {
        return UI.esc(x.nameZH || x.nameEN);
      }).filter(function (s) { return s; }).join(' · ');
      return '<div class="list-item">' +
        '<div class="li-main">' +
          '<div class="li-title">' + UI.esc(it.name) + '</div>' +
          (opts ? '<div class="li-sub tiny muted">' + opts + '</div>' : '') +
          (it.note ? '<div class="li-sub tiny muted">备注：' + UI.esc(it.note) + '</div>' : '') +
          '<div class="li-sub tiny muted">' + UI.money(it.unitPrice) + ' × ' + it.quantity + '</div>' +
        '</div>' +
        '<div class="li-right"><div class="li-value">' + UI.money(it.lineTotal) + '</div></div>' +
      '</div>';
    }).join('');

    /* 金额 */
    var totals = '<div class="card">' +
      line('小计 SUBTOTAL', UI.money(o.subtotal)) +
      (o.walletUsed > 0 ? line('钱包已抵扣 WALLET USED', '−' + UI.money(o.walletUsed), 'var(--gold)')
        : (o.walletRequested > 0
          ? line('钱包待抵扣 WALLET', '−' + UI.money(o.walletRequested), 'var(--muted)') : '')) +
      '<div class="divider"></div>' +
      line('总额 TOTAL', UI.money(o.finalAmount), 'var(--gold)', true) +
      '<div class="tiny muted mt-12">付款方式 ' + UI.esc(o.paymentMethod || 'COUNTER') +
        ' · ' + UI.esc(pay.zh) + ' ' + UI.esc(pay.en) + '</div>' +
      (o.pointsEarned > 0
        ? '<div class="tiny mt-12" style="color:var(--gold)">已获得 ' + o.pointsEarned +
          ' 积分 POINTS EARNED</div>' : '') +
    '</div>';

    /* 取消按钮（§53 只有 SUBMITTED 可以自己取消） */
    var cancelBtn = '';
    if (o.orderStatus === 'SUBMITTED') {
      cancelBtn = '<button class="btn btn-ghost mt-12" id="cancelOrderBtn" style="width:100%">' +
        '取消订单 REQUEST CANCEL</button>';
    }

    box.innerHTML =
      '<div class="card" style="text-align:center">' +
        '<div class="tiny muted">ORDER 订单</div>' +
        '<div style="font-size:24px;letter-spacing:2px;margin:4px 0">' + UI.esc(o.orderNumber) + '</div>' +
        '<div class="bilingual-zh" style="color:var(--gold)">' + UI.esc(label.zh) + '</div>' +
        '<div class="bilingual-en">' + UI.esc(label.en) + '</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">' +
          (o.orderType === 'TABLE' && o.tableNumber
            ? '桌号 TABLE ' + UI.esc(o.tableNumber)
            : (o.orderType === 'TAKEAWAY' ? '外带 TAKEAWAY' : '柜台自取 COUNTER PICKUP')) +
        '</div>' +
        (!isFinal(o.orderStatus)
          ? '<div class="tiny muted mt-12">已等待 <span id="waitingTimer">' +
            fmtWait(o.waitingSeconds) + '</span></div>'
          : '') +
      '</div>' +
      readyBanner + progress +
      '<div class="list" style="border-radius:var(--radius);overflow:hidden;margin-bottom:12px">' +
        items + '</div>' +
      totals + cancelBtn +
      '<a class="btn btn-ghost mt-12" href="orders.html" style="display:block;text-align:center">' +
        '我的订单 MY ORDERS</a>';

    var btn = document.getElementById('cancelOrderBtn');
    if (btn) btn.addEventListener('click', onCancel);

    /* 状态变了给个提示（§18），但同一个状态不重复提示 */
    if (state.lastNotifiedStatus && state.lastNotifiedStatus !== o.orderStatus) {
      if (o.orderStatus === 'READY') UI.toast('你的酒好了！YOUR DRINKS ARE READY 🍸', 'success', 5000);
      else if (o.orderStatus === 'COMPLETED') UI.toast('订单已完成 · 感谢光临', 'success', 4000);
    }
    state.lastNotifiedStatus = o.orderStatus;
  }

  function line(zhEn, value, color, big) {
    var parts = zhEn.split(' ');
    return '<div class="row-between" style="padding:5px 0">' +
      '<div class="' + (big ? 'bilingual-zh' : 'small muted') + '">' + UI.esc(parts[0]) +
        '<span class="tiny muted"> ' + UI.esc(parts.slice(1).join(' ')) + '</span></div>' +
      '<div style="' + (color ? 'color:' + color + ';' : '') +
        (big ? 'font-size:19px;font-weight:600' : 'font-size:14px') + '">' + value + '</div>' +
    '</div>';
  }

  function debugState() {
    return {
      appOrderId: state.appOrderId,
      hasOrder: !!state.order,
      errorCode: state.error ? state.error.code : null,
      status: state.order ? state.order.orderStatus : null,
      paymentStatus: state.order ? state.order.paymentStatus : null,
      orderNumber: state.order ? state.order.orderNumber : '',
      finalAmount: state.order ? state.order.finalAmount : 0,
      walletUsed: state.order ? state.order.walletUsed : 0,
      pointsEarned: state.order ? state.order.pointsEarned : 0,
      polling: !!poller,
      pollSeconds: state.pollSeconds,
      waiting: state.order ? state.order.waitingSeconds : 0
    };
  }

  return {
    init: init,
    load: load,
    stopPolling: stopPolling,
    debugState: debugState
  };

})();
