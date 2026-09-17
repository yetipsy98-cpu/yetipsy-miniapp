/* =============================================================
   YETIPSY — admin-orderboard.js（2.0 Phase 7）
   -------------------------------------------------------------
   员工订单看板（§19 §20 §21 §46 §48 §49 §65）

   规则：
   · §19 三栏 NEW / PREPARING / READY，大按钮、一次点击就换状态
   · §46 每 ORDER_POLL_SECONDS（预设 8 秒）刷新，而且只在页面开着时刷新
   · §48 新订单要有声音，但必须可以 MUTE（员工整晚开着这页）
   · §49 等待时间只用后端的 waitingSeconds（CreatedAt 算的）往上加秒
   · §55 完成按钮连按两次也安全（后端幂等），但 UI 还是会先锁住
   ============================================================= */

var ADMIN_ORDERBOARD = (function () {

  var MUTE_KEY = 'yt_board_mute';

  var state = {
    lanes: { NEW: [], CONFIRMED: [], PREPARING: [], READY: [] },
    today: null,
    ordering: null,
    pollSeconds: 8,
    muted: false,
    loading: true,
    errorCode: null,
    knownIds: null,       // 第一次载入不响铃，否则一开页面就吵
    busy: {},             // appOrderId → true，避免连点
    ticking: 0
  };

  var pollTimer = null;
  var tickTimer = null;
  var beepCtx = null;

  function init() {
    state.muted = localStorage.getItem(MUTE_KEY) === '1';
    bindEvents();
    renderMuteBtn();
    load(true);
  }

  function bindEvents() {
    var mute = document.getElementById('muteBtn');
    if (mute) mute.addEventListener('click', toggleMute);

    var pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', onPauseToggle);

    var refresh = document.getElementById('refreshBtn');
    if (refresh) refresh.addEventListener('click', function () { load(false); });

    /* §46 页面看不到就不要轮询，也不要响铃 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopTimers();
      else { load(false); startTick(); }
    });
  }

  /* ---------------------------------------------------------
     载入
     --------------------------------------------------------- */

  function load(first) {
    return API.staff.getActiveOrders().then(function (res) {
      if (!res.success) {
        state.errorCode = res.error.code;
        state.loading = false;
        render();
        return res;
      }
      state.errorCode = null;
      state.loading = false;
      state.lanes = res.data.lanes;
      state.today = res.data.today;
      state.ordering = res.data.ordering;
      state.pollSeconds = Number(res.data.pollSeconds) || 8;
      state.ticking = 0;

      if (first) {
        /* 第一次载入记下现有订单，不当成新单响铃 */
        state.knownIds = allIds();
      } else {
        var fresh = allIds().filter(function (id) {
          return state.knownIds && state.knownIds.indexOf(id) === -1;
        });
        state.knownIds = allIds();
        if (fresh.length && !state.muted && !document.hidden) beep(fresh.length);
      }

      render();
      startPolling();
      startTick();
      return res;
    });
  }

  function allIds() {
    var out = [];
    ['NEW', 'CONFIRMED', 'PREPARING', 'READY'].forEach(function (k) {
      (state.lanes[k] || []).forEach(function (o) { out.push(o.appOrderId); });
    });
    return out;
  }

  /* §46 轮询 */
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      load(false);
    }, Math.max(5, state.pollSeconds) * 1000);
  }

  /* §49 等待秒数每秒 +1（基准来自后端的 waitingSeconds） */
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      state.ticking += 1;
      var nodes = document.querySelectorAll('[data-wait]');
      for (var i = 0; i < nodes.length; i++) {
        var base = Number(nodes[i].getAttribute('data-wait')) || 0;
        nodes[i].textContent = fmtWait(base + state.ticking);
      }
    }, 1000);
  }

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  /* ---------------------------------------------------------
     §48 新单提示音（Web Audio，不需要外部档案）
     --------------------------------------------------------- */

  function beep(times) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      beepCtx = beepCtx || new Ctx();
      if (beepCtx.state === 'suspended') beepCtx.resume();

      var n = Math.min(3, times || 1);
      for (var i = 0; i < n; i++) {
        var osc = beepCtx.createOscillator();
        var gain = beepCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i % 2 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, beepCtx.currentTime + i * 0.28);
        gain.gain.exponentialRampToValueAtTime(0.25, beepCtx.currentTime + i * 0.28 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, beepCtx.currentTime + i * 0.28 + 0.22);
        osc.connect(gain);
        gain.connect(beepCtx.destination);
        osc.start(beepCtx.currentTime + i * 0.28);
        osc.stop(beepCtx.currentTime + i * 0.28 + 0.24);
      }
    } catch (e) { /* 没有音效不影响看板 */ }
  }

  function toggleMute() {
    state.muted = !state.muted;
    localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0');
    renderMuteBtn();
    UI.toast(state.muted ? '已静音 MUTED' : '声音开启 SOUND ON', 'success', 1600);
  }

  function renderMuteBtn() {
    var btn = document.getElementById('muteBtn');
    if (!btn) return;
    btn.innerHTML = state.muted ? '🔇 静音 MUTED' : '🔔 声音 SOUND';
    btn.className = 'chip' + (state.muted ? '' : ' chip-on');
  }

  /* ---------------------------------------------------------
     §65 暂停接单
     --------------------------------------------------------- */

  function onPauseToggle() {
    var next = !(state.ordering && state.ordering.paused);
    var btn = document.getElementById('pauseBtn');
    if (btn) btn.disabled = true;
    API.staff.setOrderingPaused(next).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.success) { UI.toast(res.error.message, 'error'); return; }
      state.ordering = res.data.ordering;
      UI.toast(next ? '已暂停接单 / Paused' : '已恢复接单 / Resumed', 'success');
      render();
    });
  }

  /* ---------------------------------------------------------
     状态推进
     --------------------------------------------------------- */

  function act(appOrderId, action, label) {
    if (state.busy[appOrderId]) return;
    state.busy[appOrderId] = true;
    setCardBusy(appOrderId, true, label);

    API.staff[action](appOrderId).then(function (res) {
      state.busy[appOrderId] = false;
      if (!res.success) {
        setCardBusy(appOrderId, false);
        UI.toast(res.error.message, 'error', 3500);
        load(false);                 // 状态可能已被别的员工改过
        return;
      }
      if (action === 'completeOrder') {
        var d = res.data;
        UI.toast(d.alreadyCompleted
          ? '这张订单早已完成 / Already completed'
          : '完成 · +' + d.pointsIssued + ' 积分' + (d.reward ? ' · 有 Reward' : ''),
          'success', 3200);
      }
      load(false);
    });
  }

  function pay(appOrderId) {
    if (state.busy[appOrderId]) return;
    UI.confirmDialog('确认已收到付款？', 'Confirm payment received?（用钱包会在这一步扣款）',
      '确认收款 CONFIRM').then(function (yes) {
      if (!yes) return;
      state.busy[appOrderId] = true;
      setCardBusy(appOrderId, true, '收款中…');
      API.staff.markPaymentPaid(appOrderId, 'COUNTER').then(function (res) {
        state.busy[appOrderId] = false;
        if (!res.success) {
          setCardBusy(appOrderId, false);
          UI.toast(res.error.message, 'error', 3500);
          return;
        }
        UI.toast(res.data.walletUsed > 0
          ? '已收款 · 钱包扣 ' + UI.money(res.data.walletUsed)
          : '已收款 PAID', 'success');
        load(false);
      });
    });
  }

  function cancel(appOrderId, orderNumber) {
    UI.confirmDialog('取消订单 ' + orderNumber + '？', 'Cancel this order?（已扣的钱包会退回）',
      '取消订单 CANCEL').then(function (yes) {
      if (!yes) return;
      state.busy[appOrderId] = true;
      setCardBusy(appOrderId, true, '取消中…');
      API.staff.cancelAppOrder(appOrderId, 'Cancelled by staff').then(function (res) {
        state.busy[appOrderId] = false;
        if (!res.success) {
          setCardBusy(appOrderId, false);
          UI.toast(res.error.message, 'error', 3500);
          return;
        }
        UI.toast(res.data.refunded > 0
          ? '已取消 · 退回 ' + UI.money(res.data.refunded) : '已取消 CANCELLED', 'success');
        load(false);
      });
    });
  }

  function setCardBusy(appOrderId, on, label) {
    var card = document.querySelector('[data-card="' + appOrderId + '"]');
    if (!card) return;
    var btns = card.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = on;
      if (on && label && btns[i].classList.contains('big-action')) btns[i].textContent = label;
    }
    card.style.opacity = on ? '0.6' : '';
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function fmtWait(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function render() {
    var box = document.getElementById('boardBody');
    if (!box) return;

    renderTopbar();

    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">' +
        '<div class="a-section-title">看板载入失败</div>' +
        '<div class="a-sub">错误码 ' + UI.esc(state.errorCode) + '</div>' +
        '<button class="btn btn-secondary mt-16" id="retryBtn">重试 RETRY</button></div>';
      var retry = document.getElementById('retryBtn');
      if (retry) retry.addEventListener('click', function () { load(false); });
      return;
    }

    var lanes = [
      { key: 'NEW',       zh: '新订单',   en: 'NEW',       accent: 'var(--a-gold)' },
      { key: 'CONFIRMED', zh: '已确认',   en: 'CONFIRMED', accent: 'var(--a-line)' },
      { key: 'PREPARING', zh: '制作中',   en: 'PREPARING', accent: 'var(--a-line)' },
      { key: 'READY',     zh: '可取酒',   en: 'READY',     accent: '#7FC8A9' }
    ];

    box.innerHTML = lanes.map(function (lane) {
      var list = state.lanes[lane.key] || [];
      return '<section class="lane">' +
        '<div class="lane-head" style="border-color:' + lane.accent + '">' +
          '<span class="lane-zh">' + lane.zh + '</span>' +
          '<span class="lane-en">' + lane.en + '</span>' +
          '<span class="lane-count">' + list.length + '</span>' +
        '</div>' +
        (list.length ? list.map(function (o) { return card(o, lane.key); }).join('')
                     : '<div class="a-empty" style="padding:14px">—</div>') +
      '</section>';
    }).join('');

    bindCards();
  }

  function renderTopbar() {
    var o = state.ordering || {};
    var el = document.getElementById('boardStatus');
    if (el) {
      var txt;
      if (o.paused) txt = '⏸ 已暂停接单 PAUSED';
      else if (!o.open) txt = '🌙 目前不在营业时间 CLOSED';
      else txt = '● 接单中 OPEN ' + (o.openTime || '') + '–' + (o.closeTime || '');
      el.textContent = txt;
      el.className = 'a-sub' + (o.paused || !o.open ? ' warn' : '');
    }
    var stat = document.getElementById('boardToday');
    if (stat && state.today) {
      stat.innerHTML =
        '<div class="dash-card"><div class="dc-label">今日订单 ORDERS</div>' +
          '<div class="dc-value">' + state.today.orders + '</div></div>' +
        '<div class="dash-card"><div class="dc-label">今日业绩 SALES</div>' +
          '<div class="dc-value">' + UI.money(state.today.sales) + '</div></div>' +
        '<div class="dash-card"><div class="dc-label">平均客单 AVERAGE</div>' +
          '<div class="dc-value">' + UI.money(state.today.averageOrder) + '</div></div>';
    }
    var pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.textContent = o.paused ? '恢复接单 RESUME' : '暂停接单 PAUSE';
    }
  }

  function card(o, lane) {
    var cust = o.customer || {};
    var items = (o.items || []).map(function (it) {
      return '<div class="a-item"><span>' + UI.esc(it.quantity) + ' × ' + UI.esc(it.name) +
          (it.note ? ' <span class="bc-item-note">（' + UI.esc(it.note) + '）</span>' : '') +
        '</span>' +
        '<span>' + UI.money(it.lineTotal) + '</span></div>';
    }).join('');

    var where = o.orderType === 'TABLE' && o.tableNumber
      ? '桌号 ' + UI.esc(o.tableNumber)
      : (o.orderType === 'TAKEAWAY' ? '外带 TAKEAWAY' : '柜台 COUNTER');

    var payLine = o.paymentStatus === 'PAID'
      ? '<span class="chip chip-on">已付款 PAID</span>'
      : '<span class="chip">未付款 UNPAID</span>' +
        (o.walletRequested > 0
          ? '<span class="chip">钱包 ' + UI.money(o.walletRequested) + '</span>' : '');

    /* §19 每栏一个主要动作，按钮大、一次点击 */
    var main = '';
    if (lane === 'NEW') {
      main = '<button class="big-action" data-act="acceptOrder">接单 ACCEPT</button>';
    } else if (lane === 'CONFIRMED') {
      main = '<button class="big-action" data-act="startPreparing">开始制作 START</button>';
    } else if (lane === 'PREPARING') {
      main = '<button class="big-action" data-act="markReady">做好了 READY</button>';
    } else {
      main = o.paymentStatus === 'PAID'
        ? '<button class="big-action" data-act="completeOrder">完成订单 COMPLETE</button>'
        : '<button class="big-action" data-pay="1">收款并标记 PAID</button>';
    }

    return '<article class="board-card" data-card="' + UI.esc(o.appOrderId) + '">' +
      '<div class="bc-top">' +
        '<span class="bc-num">' + UI.esc(o.orderNumber) + '</span>' +
        '<span class="bc-wait" data-wait="' + (o.waitingSeconds || 0) + '">' +
          fmtWait(o.waitingSeconds) + '</span>' +
      '</div>' +
      '<div class="bc-meta">' + UI.esc(where) + ' · ' + UI.esc(o.itemCount) + ' 件</div>' +
      (cust.name
        /* §21 员工看板要能叫号，这里用真实姓名；
           displayName 是给顾客端看的遮罩版本，不用在员工页 */
        ? '<div class="bc-meta gold">👤 ' + UI.esc(cust.name) +
          ' · ' + UI.esc(cust.membershipTier || '') + '</div>' : '') +
      '<div class="bc-items">' + items + '</div>' +
      (o.customerNote ? '<div class="bc-note">备注：' + UI.esc(o.customerNote) + '</div>' : '') +
      '<div class="bc-pay">' + payLine +
        '<span class="bc-total">' + UI.money(o.finalAmount) + '</span></div>' +
      main +
      '<div class="bc-sub">' +
        (o.paymentStatus !== 'PAID' && lane !== 'READY'
          ? '<button class="chip" data-pay="1">收款 PAID</button>' : '') +
        (o.paymentStatus !== 'PAID'
          ? '<button class="chip" data-cancel="1">取消 CANCEL</button>'
          : '<span class="a-sub">已收款才能完成</span>') +
      '</div>' +
    '</article>';
  }

  function bindCards() {
    var cards = document.querySelectorAll('[data-card]');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var id = card.getAttribute('data-card');
        var number = (card.querySelector('.bc-num') || {}).textContent || '';

        var acts = card.querySelectorAll('[data-act]');
        for (var a = 0; a < acts.length; a++) {
          (function (btn) {
            btn.addEventListener('click', function () {
              act(id, btn.getAttribute('data-act'), '处理中…');
            });
          })(acts[a]);
        }
        var pays = card.querySelectorAll('[data-pay]');
        for (var p = 0; p < pays.length; p++) {
          pays[p].addEventListener('click', function () { pay(id); });
        }
        var cancels = card.querySelectorAll('[data-cancel]');
        for (var c = 0; c < cancels.length; c++) {
          cancels[c].addEventListener('click', function () { cancel(id, number); });
        }
      })(cards[i]);
    }
  }

  function debugState() {
    return {
      loading: state.loading,
      errorCode: state.errorCode,
      newCount: (state.lanes.NEW || []).length,
      confirmedCount: (state.lanes.CONFIRMED || []).length,
      preparingCount: (state.lanes.PREPARING || []).length,
      readyCount: (state.lanes.READY || []).length,
      totalToday: state.today ? state.today.orders : 0,
      salesToday: state.today ? state.today.sales : 0,
      pollSeconds: state.pollSeconds,
      muted: state.muted,
      polling: !!pollTimer,
      paused: !!(state.ordering && state.ordering.paused)
    };
  }

  return {
    init: init,
    load: load,
    stopTimers: stopTimers,
    toggleMute: toggleMute,
    debugState: debugState
  };

})();
