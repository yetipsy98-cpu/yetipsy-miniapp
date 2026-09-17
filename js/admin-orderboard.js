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
    loadFailed: false,
    errorCode: null,
    knownIds: null,       // 第一次载入不响铃，否则一开页面就吵
    busy: {},             // appOrderId → true，避免连点
    ticking: 0,
    laneSig: {}           // 每一栏的内容指纹：没变就不重画（现场反应快很多）
  };

  var poller = null;
  var tickTimer = null;
  var beepCtx = null;

  function init() {
    state.muted = localStorage.getItem(MUTE_KEY) === '1';
    UI.setVoice(!state.muted);
    /* 连线提示 = 这一页自己的载入结果 + 全局网络状态（见 UI.netPill） */
    API.onNetwork(function (st) { UI.netPill(state.loadFailed, st); });
    bindEvents();
    bindBoard();
    renderMuteBtn();
    load(true);
  }

  function bindEvents() {
    var mute = document.getElementById('muteBtn');
    if (mute) mute.addEventListener('click', toggleMute);

    var pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', onPauseToggle);

    var test = document.getElementById('testVoiceBtn');
    if (test) test.addEventListener('click', function () {
      UI.unlockVoice();
      var spoke = UI.say('您有新订单', { force: true });
      UI.voiceBanner('🔔 您有新订单');
      if (!spoke) { beep(1); UI.toast('这支装置不能念中文，改用提示音 / Using beep', 'error', 2600); }
      else UI.toast('有声音吗？没有的话把装置的媒体音量打开', 'success', 2600);
    });

    var refresh = document.getElementById('refreshBtn');
    if (refresh) refresh.addEventListener('click', function () {
      API.cache.drop('getActiveOrders', {});       // 手动刷新：不要吃快取
      load(false);
    });

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
        /* 已经有资料就继续显示（轮询失败很正常），只标连线不稳 */
        if (state.lanes && allIds().length) {
          /* 已经有资料：不清空、也不跳错误页，只显示连线提示 */
          state.loadFailed = true;
          UI.netPill(true);
          return res;
        }
        render();
        return res;
      }
      state.errorCode = null;
      state.loading = false;
      state.loadFailed = false;
      UI.netPill(false, 'ok');
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
        if (fresh.length && !state.muted && !document.hidden) {
          /* 2.1.10 新订单要「听得到 + 看得到」：
             先讲「您有新订单」＋跳大字横幅；浏览器讲不出话（没有语音
             合成 / 还没解锁）才退回哔声，所以一定有提示。 */
          var spoke = UI.announceNewOrder(fresh.length);
          if (!spoke) beep(fresh.length);
        }
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

  /* §46 轮询：上一次跑完才排下一次（不重叠）+ 失败自动退避 */
  function startPolling() {
    if (poller) return;
    poller = API.poll(Math.max(5, state.pollSeconds), function () { return load(false); });
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
    if (poller) { poller.stop(); poller = null; }
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
    UI.setVoice(!state.muted);
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

  /** 动过订单之后就不要再拿旧快取 */
  function dropOrdersCache() {
    if (API.cache && API.cache.drop) {
      API.cache.drop('getActiveOrders', {});
      API.cache.drop('getDashboard', { date: '' });
    }
  }

  /**
   * 状态推进（2.1.10 起「按下去立刻动」）
   * ---------------------------------------------------------
   * 以前：按一下 → 按钮锁住 → 等后端 → 再抓一次看板（两个来回，
   *       现场要等 1~3 秒，感觉就是「点了会延迟」）。
   * 现在：① 立刻把卡片移到下一栏（乐观更新，画面马上反应）
   *       ② 一个请求
   *       ③ 后端把最新看板快照一起回传 → 直接用，不再多抓一次
   *       ④ 只有失败才回头重抓（可能别的员工改过了）
   */
  var LANE_OF_ACTION = {
    acceptOrder: 'CONFIRMED',
    acceptAndStart: 'PREPARING',
    startPreparing: 'PREPARING',
    markReady: 'READY',
    completeOrder: 'DONE',
    cancelAppOrder: 'DONE'
  };

  /** 把一张卡片先搬到目标栏（回传旧的栏位，失败时搬回去） */
  function moveCardLocal(appOrderId, toLane) {
    var from = null, item = null;
    Object.keys(state.lanes).forEach(function (key) {
      var list = state.lanes[key] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].appOrderId === appOrderId) {
          from = key;
          item = list[i];
          list.splice(i, 1);
          break;
        }
      }
    });
    if (!item) return null;
    if (toLane === 'DONE') {
      state.laneSig[from] = null;              // 强制重画那一栏
      return { from: from, item: item };
    }
    /* 搬过去时先把状态改成目标状态，计时 / 徽章才会跟着对 */
    item.orderStatus = toLane === 'CONFIRMED' ? 'CONFIRMED'
                     : toLane === 'PREPARING' ? 'PREPARING' : 'READY';
    state.lanes[toLane] = state.lanes[toLane] || [];
    state.lanes[toLane].unshift(item);
    state.laneSig[from] = null;
    state.laneSig[toLane] = null;
    return { from: from, item: item };
  }

  /** 后端回来的快照：直接画，不用第二个请求 */
  function applySnapshot(snap) {
    if (!snap || !snap.lanes) return false;
    state.lanes = snap.lanes;
    state.today = snap.today;
    state.ordering = snap.ordering;
    if (snap.pollSeconds) state.pollSeconds = Number(snap.pollSeconds) || state.pollSeconds;
    state.ticking = 0;
    state.knownIds = allIds();               // 自己刚处理过的单不算「新订单」
    state.laneSig = {};                      // 快照来了就整块重画一次（很快）
    render();
    return true;
  }

  function act(appOrderId, action, label) {
    if (state.busy[appOrderId]) return;
    var target = LANE_OF_ACTION[action];
    var moved = null;

    state.busy[appOrderId] = true;
    if (target) moved = moveCardLocal(appOrderId, target);
    setCardBusy(appOrderId, true, label);
    render();

    dropOrdersCache();
    var call = action === 'acceptAndStart'
      ? API.staff.acceptOrder(appOrderId, { startPreparing: true })
      : API.staff[action](appOrderId);

    call.then(function (res) {
      state.busy[appOrderId] = false;
      if (!res.success) {
        /* 失败：搬回原位（可能已经被别人改过，所以重抓最准） */
        UI.toast(res.error.message, 'error', 3500);
        state.laneSig = {};
        load(false);
        return;
      }
      if (action === 'completeOrder') {
        var d = res.data;
        UI.toast(d.alreadyCompleted
          ? '这张订单早已完成 / Already completed'
          : '完成 · +' + d.pointsIssued + ' 积分' + (d.reward ? ' · 有 Reward' : ''),
          'success', 3200);
      }
      /* 后端回传的最新看板直接用（没有就自己抓一次） */
      if (!applySnapshot(res.data && res.data.snapshot)) {
        state.laneSig = {};
        load(false);
      }
    });
  }

  function pay(appOrderId) {
    if (state.busy[appOrderId]) return;
    UI.confirmDialog('确认已收到付款？', 'Confirm payment received?（用钱包会在这一步扣款）',
      '确认收款 CONFIRM').then(function (yes) {
      if (!yes) return;
      state.busy[appOrderId] = true;
      setCardBusy(appOrderId, true, '收款中…');
      dropOrdersCache();
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
        if (!applySnapshot(res.data && res.data.snapshot)) { state.laneSig = {}; load(false); }
      });
    });
  }

  function cancel(appOrderId, orderNumber) {
    UI.confirmDialog('取消订单 ' + orderNumber + '？', 'Cancel this order?（已扣的钱包会退回）',
      '取消订单 CANCEL').then(function (yes) {
      if (!yes) return;
      state.busy[appOrderId] = true;
      setCardBusy(appOrderId, true, '取消中…');
      dropOrdersCache();
      API.staff.cancelAppOrder(appOrderId, 'Cancelled by staff').then(function (res) {
        state.busy[appOrderId] = false;
        if (!res.success) {
          setCardBusy(appOrderId, false);
          UI.toast(res.error.message, 'error', 3500);
          return;
        }
        UI.toast(res.data.refunded > 0
          ? '已取消 · 退回 ' + UI.money(res.data.refunded) : '已取消 CANCELLED', 'success');
        if (!applySnapshot(res.data && res.data.snapshot)) { state.laneSig = {}; load(false); }
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

  var LANES = [
    { key: 'NEW',       zh: '新订单',   en: 'NEW',       accent: 'var(--a-gold)' },
    { key: 'CONFIRMED', zh: '已确认',   en: 'CONFIRMED', accent: 'var(--a-line)' },
    { key: 'PREPARING', zh: '制作中',   en: 'PREPARING', accent: 'var(--a-line)' },
    { key: 'READY',     zh: '可取酒',   en: 'READY',     accent: '#7FC8A9' }
  ];

  function laneShell(lane) {
    return '<section class="lane" data-lane="' + lane.key + '">' +
      '<div class="lane-head" style="border-color:' + lane.accent + '">' +
        '<span class="lane-zh">' + lane.zh + '</span>' +
        '<span class="lane-en">' + lane.en + '</span>' +
        '<span class="lane-count">0</span>' +
      '</div>' +
      '<div class="lane-body"></div>' +
    '</section>';
  }

  /** 事件只绑一次（委派）：重画卡片不用重新绑，也不会越绑越多 */
  function bindBoard() {
    var box = document.getElementById('boardBody');
    if (!box || box.getAttribute('data-bound') === '1') return;
    box.setAttribute('data-bound', '1');
    box.addEventListener('click', function (e) {
      var t = closest(e.target, '[data-act],[data-pay],[data-cancel]');
      if (!t) return;
      var card = closest(t, '[data-card]');
      if (!card) return;
      var id = card.getAttribute('data-card');
      var num = (card.querySelector('.bc-num') || {}).textContent || '';
      if (t.hasAttribute && t.hasAttribute('data-act')) {
        act(id, t.getAttribute('data-act'), '处理中…');
      } else if (t.hasAttribute && t.hasAttribute('data-pay')) {
        pay(id);
      } else if (t.hasAttribute && t.hasAttribute('data-cancel')) {
        cancel(id, num);
      }
    });
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches ? node.matches(selector) : false) return node;
      node = node.parentNode;
    }
    return null;
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
      if (retry) retry.addEventListener('click', function () {
        API.cache.drop('getActiveOrders', {});
        load(true);
      });
      return;
    }

    if (box.getAttribute('data-ready') !== '1') {
      box.innerHTML = LANES.map(laneShell).join('');
      box.setAttribute('data-ready', '1');
      state.laneSig = {};
    }

    /* 只有真的变动的栏位才重画 —— 每 8 秒整块重画会让现场感觉「卡」 */
    LANES.forEach(function (lane) {
      var list = state.lanes[lane.key] || [];
      var section = box.querySelector('.lane[data-lane="' + lane.key + '"]');
      if (!section) return;

      var count = section.querySelector('.lane-count');
      if (count) count.textContent = list.length;

      var sig = JSON.stringify(list) + '|' +
        list.map(function (o) { return state.busy[o.appOrderId] ? 1 : 0; }).join('');
      if (state.laneSig[lane.key] === sig) return;
      state.laneSig[lane.key] = sig;

      var body = section.querySelector('.lane-body');
      body.innerHTML = list.length
        ? list.map(function (o) { return card(o, lane.key); }).join('')
        : '<div class="a-empty" style="padding:14px">—</div>';
    });
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
      /* 2.1.10 员工要的是「确认后直接进制作」：一次按下去 = 接单 + 制作中 */
      main = '<button class="big-action" data-act="acceptAndStart">接单并制作 ACCEPT &amp; START</button>';
    } else if (lane === 'CONFIRMED') {
      main = '<button class="big-action" data-act="startPreparing">开始制作 START</button>';
    } else if (lane === 'PREPARING') {
      main = '<button class="big-action" data-act="markReady">做好了 READY</button>';
    } else {
      main = o.paymentStatus === 'PAID'
        ? '<button class="big-action" data-act="completeOrder">完成订单 COMPLETE</button>'
        : '<button class="big-action" data-pay="1">收款并标记 PAID</button>';
    }

    var busy = !!state.busy[o.appOrderId];
    if (busy) {
      main = '<button class="big-action" disabled>处理中…</button>';
    }

    return '<article class="board-card' + (busy ? ' is-busy' : '') +
      '" data-card="' + UI.esc(o.appOrderId) + '">' +
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
      voice: !!(window.speechSynthesis),
      polling: !!poller,
      paused: !!(state.ordering && state.ordering.paused)
    };
  }

  return {
    init: init,
    load: load,
    act: act,
    stopTimers: stopTimers,
    toggleMute: toggleMute,
    announceTest: function () { return UI.announceNewOrder(1); },
    debugState: debugState
  };

})();
