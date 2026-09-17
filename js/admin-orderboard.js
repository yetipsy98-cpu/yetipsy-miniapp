/* =============================================================
   YETIPSY — admin-orderboard.js（2.0 Phase 7）
   -------------------------------------------------------------
   员工订单看板（§19 §20 §21 §46 §48 §49 §65）

   规则：
   · §19 看板三栏 NEW / PREPARING / READY，大按钮、一次点击就换状态
     （2.1.13：不再有「已确认」栏 —— 按一下就是制作中）
   · §46 每 BOARD_POLL_SECONDS（预设 4 秒）刷新，而且只在页面开着时刷新
     2.1.14：状态推进不再有「处理中…」那一段 —— 按下去卡片立刻在新栏、
     按钮已经是下一个动作（只留一点点还在跑的提示）。
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
    todaySig: '',
    laneSig: {},          // 每一栏的内容指纹：没变就不重画（现场反应快很多）
    /* 2.1.12 防「卡片跳回去」：
       mutationAt = 员工最后一次动状态的时间（比它还早发出的读取一律丢掉，
       因为那些回应是「动之前」的资料）；
       expect     = 我们刚把这张单放到哪一栏（后端旧资料不许把它搬回去） */
    mutationAt: 0,
    mutating: 0,
    expect: {},
    autoPushed: {},       // 2.1.13：残留的 CONFIRMED 只自动推一次
    busyLabel: {}         // 只有「收款 / 取消」这种要确认的动作才换按钮文字
  };

  /* 状态高低顺序：数字大的比较新。后端回来的比我们刚才做的旧 → 不采信 */
  var RANK = { SUBMITTED: 0, CONFIRMED: 1, PREPARING: 2, READY: 3, COMPLETED: 4, CANCELLED: 4 };
  var LANE_OF_STATUS = { SUBMITTED: 'NEW', CONFIRMED: 'CONFIRMED', PREPARING: 'PREPARING', READY: 'READY' };

  /**
   * 2.1.13：看板不再有「已确认」这一栏
   * ---------------------------------------------------------
   * 员工的流程是「按确认 → 直接制作中」，中间那个「已确认」状态对现场
   * 没有意义，还会让卡片停在那里等第二次点击。所以画面上只有
   * 新订单 → 制作中 → 可取酒；后端万一还停在 CONFIRMED（旧版
   * Apps Script、或之前留下的单），卡片就并进「制作中」栏，
   * 并按它真正的状态给「开始制作 START」按钮（不是「做好了」）。
   */
  var FOLD_LANE = { CONFIRMED: 'PREPARING' };
  var LANE_ORDER = ['NEW', 'PREPARING', 'CONFIRMED', 'READY'];   // 折叠时 PREPARING 在前
  function displayLane(key) { return FOLD_LANE[key] || key; }
  var GUARD_MS = 25000;    // 这么久的「保护期」内不让旧资料把卡片搬回去

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
    var startedAt = Date.now();
    return API.staff.getActiveOrders().then(function (res) {
      /* 这个请求是在员工按下去之前发出的 → 它带回来的是旧状态，
         直接丢掉，不要用它把卡片搬回原本那一栏。 */
      if (!first && res.success && startedAt < state.mutationAt) return res;
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
      state.lanes = reconcile(res.data.lanes);
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
      pushConfirmed();          // 有单还停在「已确认」→ 自动帮它进制作中
      startPolling();
      startTick();
      return res;
    });
  }

  /**
   * 对帐：把「员工刚动过的」保护起来
   * ---------------------------------------------------------
   * 现场会发生：员工按了「接单并制作」→ 卡片立刻移到制作中 →
   * 但这时候可能有一个「按之前就发出去」的读取回来（或快取优先的
   * 旧资料）→ 内容还是 CONFIRMED → 卡片就跳回「已确认」，员工得
   * 再按一次。这里用 RANK 判断：后端回来的比我们刚做的还旧，
   * 就维持我们刚放的位置；等后端跟上（或超过保护期）才放行。
   */
  function reconcile(lanes) {
    var now = Date.now();
    var out = { NEW: [], CONFIRMED: [], PREPARING: [], READY: [] };
    var blocked = 0;

    ['NEW', 'CONFIRMED', 'PREPARING', 'READY'].forEach(function (key) {
      (lanes[key] || []).forEach(function (o) {
        var exp = state.expect[o.appOrderId];
        if (!exp) { out[key].push(o); return; }

        if (now - exp.at > GUARD_MS) { delete state.expect[o.appOrderId]; out[key].push(o); return; }

        var expLane = LANE_OF_STATUS[exp.status];
        if (RANK[exp.status] === undefined) {   // 记到看不懂的状态 → 不挡
          delete state.expect[o.appOrderId];
          out[key].push(o);
          return;
        }
        if (!expLane) {                      // 我们预期它应该消失（完成 / 取消）
          blocked += 1;                      // 旧资料还想显示它 → 忽略
          return;
        }
        if (RANK[key === 'NEW' ? 'SUBMITTED' : key] >= RANK[exp.status]) {
          delete state.expect[o.appOrderId];  // 后端跟上了（或更新）→ 放行
          out[key].push(o);
          return;
        }
        /* 后端资料比我们刚做的旧 → 维持我们刚放的位置 */
        o.orderStatus = exp.status;
        out[expLane].push(o);
        blocked += 1;
      });
    });

    if (blocked && !state.refreshSoon) {
      /* 有旧资料被挡掉：稍微晚一点再问一次后端，拿到真正的状态 */
      state.refreshSoon = setTimeout(function () {
        state.refreshSoon = null;
        load(false);
      }, 1200);
    }
    return out;
  }

  /** 目前这一张单在前端看到的状态（用来记「保护」用） */
  function cardStatus(appOrderId) {
    var found = null;
    Object.keys(state.lanes).forEach(function (key) {
      (state.lanes[key] || []).forEach(function (o) {
        if (o.appOrderId === appOrderId) found = o.orderStatus;
      });
    });
    return found;
  }

  function allIds() {
    var out = [];
    ['NEW', 'CONFIRMED', 'PREPARING', 'READY'].forEach(function (k) {
      (state.lanes[k] || []).forEach(function (o) { out.push(o.appOrderId); });
    });
    return out;
  }

  /* §46 轮询：上一次跑完才排下一次（不重叠）+ 失败自动退避 */
  /** 看板刷新间隔（秒）：预设 4 秒，最快不低于 3 秒（Apps Script 一次往返要约 1~2 秒） */
  function pollEverySeconds() {
    var want = Number((window.YETIPSY_CONFIG || {}).BOARD_POLL_SECONDS) || 4;
    var server = Number(state.pollSeconds) || 8;
    return Math.max(3, Math.min(server, want));
  }

  function startPolling() {
    if (poller) return;
    poller = API.poll(pollEverySeconds(), function () {
      /* 员工刚按下去、还在等后端 → 这一次轮询跳过（不要跟写动作抢） */
      if (state.mutating) return Promise.resolve({ success: true });
      return load(false);
    });
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

    /* 后端刚给的是「权威」状态：用它更新每一张「刚动过的单」的保护，
       并写进快取，之后任何快取显示都会是新状态 */
    Object.keys(state.expect).forEach(function (id) {
      var found = null;
      ['NEW', 'CONFIRMED', 'PREPARING', 'READY'].forEach(function (key) {
        (snap.lanes[key] || []).forEach(function (o) {
          if (o.appOrderId === id) found = o.orderStatus;
        });
      });
      /* 快照里已经没有它 = 完成 / 取消 → 之后旧资料也别让它跑回来 */
      state.expect[id] = { status: found || 'CANCELLED', at: Date.now() };
    });

    API.cache.write('getActiveOrders', {}, snap);   // 快取跟着更新
    state.lanes = snap.lanes;
    state.today = snap.today;
    state.ordering = snap.ordering;
    if (snap.pollSeconds) state.pollSeconds = Number(snap.pollSeconds) || state.pollSeconds;
    state.ticking = 0;
    state.knownIds = allIds();               // 自己刚处理过的单不算「新订单」
    render();                                // 只有内容真的变的栏位会重画
    pushConfirmed();
    return true;
  }

  /**
   * 2.1.13：后端若有单停在「已确认」（旧版 Apps Script 没跟着推一步），
   * 看板自己帮它推到「制作中」—— 每张单只推一次，后端不支援就留按钮给员工。
   */
  function pushConfirmed() {
    if (state.mutating) return;
    (state.lanes.CONFIRMED || []).forEach(function (o) {
      var id = o.appOrderId;
      if (!id || state.autoPushed[id]) return;
      state.autoPushed[id] = true;
      API.staff.startPreparing(id).then(function (res) {
        if (!res.success) return;                    // 旧后端没有这个 action → 员工自己按
        dropOrdersCache();
        if (applySnapshot(res.data && res.data.snapshot)) return;
        state.expect[id] = { status: 'PREPARING', at: Date.now() };
        state.laneSig = {};
        load(false);
      });
    });
  }

  function act(appOrderId, action) {
    if (state.busy[appOrderId]) {
      /* 上一个动作还在跑：不要静悄悄没反应，也不要重复送一次 */
      UI.toast('上一个动作还在处理中 / Still processing', 'info', 1600);
      return;
    }
    var target = LANE_OF_ACTION[action];
    var moved = null;

    state.busy[appOrderId] = true;
    state.mutating += 1;
    state.mutationAt = Date.now();               // 比这时间早发出的读取一律丢掉
    /* 先记下「我们把这张单放到哪一栏」：等一下任何旧资料（慢回应、旧快取）
       回来都不淮把它搬回去。后端回传的权威快照会再更新这张保护卡。 */
    if (target && target !== 'DONE') {
      state.expect[appOrderId] = { status: target, at: Date.now(), guess: true };
    }
    if (target) moved = moveCardLocal(appOrderId, target);
    /* 没有 label → 不换按钮文字：卡片直接就是「下一个动作」的样子 */
    setCardBusy(appOrderId, true);
    render();

    dropOrdersCache();
    var call = action === 'acceptAndStart'
      ? API.staff.acceptOrder(appOrderId, { startPreparing: true })
      : API.staff[action](appOrderId);

    function failed(res) {
      state.busy[appOrderId] = false;
      state.mutating = Math.max(0, state.mutating - 1);
      delete state.expect[appOrderId];
      UI.toast(res.error.message, 'error', 3500);
      state.mutationAt = Date.now();             // 之前的读取也一起作废
      state.laneSig = {};
      load(false);
    }

    function done(res) {
      state.busy[appOrderId] = false;
      state.mutating = Math.max(0, state.mutating - 1);

      if (action === 'completeOrder') {
        var d = res.data;
        UI.toast(d.alreadyCompleted
          ? '这张订单早已完成 / Already completed'
          : '完成 · +' + d.pointsIssued + ' 积分' + (d.reward ? ' · 有 Reward' : ''),
          'success', 3200);
      }

      /* 后端回传的最新看板直接用（没有就自己抓一次） */
      if (applySnapshot(res.data && res.data.snapshot)) return;

      /* 后端没给快照（旧版后端）：把这一张单钉在我们刚放的位置，等轮询对上 */
      var snapOrder = res.data && res.data.order;
      state.expect[appOrderId] = {
        status: (snapOrder && snapOrder.orderStatus) || (target === 'DONE' ? 'CANCELLED' : target),
        at: Date.now()
      };
      state.laneSig = {};
      load(false);
    }

    call.then(function (res) {
      if (!res.success) { failed(res); return; }

      /* ★ 「确认后一定要进制作中」
         万一后端还没有支援一步到位（旧的 Code.gs 会把单停在 CONFIRMED），
         这里立刻自己补第二个请求把它推进 PREPARING —— 员工只按一次，
         卡片也不会停在「已确认」。 */
      if (action === 'acceptAndStart' && target === 'PREPARING') {
        var st = res.data && res.data.order && res.data.order.orderStatus;
        if (st === 'CONFIRMED' || st === 'SUBMITTED') {
          API.staff.startPreparing(appOrderId).then(function (res2) {
            if (!res2.success) { failed(res2); return; }
            done(res2);
          });
          return;
        }
      }
      done(res);
    });
  }

  function pay(appOrderId) {
    if (state.busy[appOrderId]) return;
    UI.confirmDialog('确认已收到付款？', 'Confirm payment received?（用钱包会在这一步扣款）',
      '确认收款 CONFIRM').then(function (yes) {
      if (!yes) return;
      state.busy[appOrderId] = true;
      state.mutating += 1;
      state.mutationAt = Date.now();
      setCardBusy(appOrderId, true, '收款中…');
      dropOrdersCache();
      API.staff.markPaymentPaid(appOrderId, 'COUNTER').then(function (res) {
        state.busy[appOrderId] = false;
        state.mutating = Math.max(0, state.mutating - 1);
        if (res.success) {
          var known = cardStatus(appOrderId);
          state.expect[appOrderId] = { status: known || 'CONFIRMED', at: Date.now() };
        }
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
      state.mutating += 1;
      state.mutationAt = Date.now();
      setCardBusy(appOrderId, true, '取消中…');
      dropOrdersCache();
      API.staff.cancelAppOrder(appOrderId, 'Cancelled by staff').then(function (res) {
        state.busy[appOrderId] = false;
        state.mutating = Math.max(0, state.mutating - 1);
        if (res.success) { state.expect[appOrderId] = { status: 'CANCELLED', at: Date.now() }; moveCardLocal(appOrderId, 'DONE'); render(); }
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

  /**
   * 「送出去了、还在等后端」的视觉（2.1.14）
   * ---------------------------------------------------------
   * 以前这里会把按钮换成「处理中…」并锁住所有按钮 —— 员工看到的就是
   * 一段空等。现在：卡片已经在新栏、按钮已经是下一个动作，只留一点点
   * 「还在跑」的提示；连点由 state.busy 挡住并给一句提示。
   * 只有要确认的动作（收款 / 取消）才真的换文字。
   */
  function setCardBusy(appOrderId, on, label) {
    var card = document.querySelector('[data-card="' + appOrderId + '"]');
    if (!card) return;
    card.setAttribute('data-pending', on ? '1' : '0');
    if (label) state.busyLabel[appOrderId] = label;
    else delete state.busyLabel[appOrderId];
    if (!label) {
      card.style.opacity = on ? '0.88' : '';     // 状态推进：只轻微淡化，按钮照常
      return;
    }
    var btns = card.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = on;
      if (on && btns[i].classList.contains('big-action')) btns[i].textContent = label;
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
    { key: 'PREPARING', zh: '制作中',   en: 'PREPARING', accent: 'var(--a-line)' },
    { key: 'READY',     zh: '可取酒',   en: 'READY',     accent: '#7FC8A9' }
  ];

  /** 画面上这一栏要显示的卡片（CONFIRMED 并进 PREPARING） */
  function laneList(key) {
    var out = [];
    LANE_ORDER.forEach(function (k) {
      if (displayLane(k) !== key) return;
      (state.lanes[k] || []).forEach(function (o) { out.push(o); });
    });
    return out;
  }

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
        act(id, t.getAttribute('data-act'));
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

  /**
   * 等待秒数：后端每次都会给新的 waitingSeconds，但卡片不会因此重画
   * （重画才是「卡」的原因）。所以这里只更新 data-wait 基准 + 文字，
   * 每秒的 tick 会接着往上加。
   */
  function refreshWaitBases() {
    var map = {};
    Object.keys(state.lanes).forEach(function (key) {
      (state.lanes[key] || []).forEach(function (o) {
        map[o.appOrderId] = Number(o.waitingSeconds) || 0;
      });
    });
    var cards = document.querySelectorAll('.board-card[data-card]');
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-card');
      var base = map[id];
      if (base === undefined) continue;
      var node = cards[i].querySelector('.bc-wait');
      if (!node) continue;
      if (node.getAttribute('data-wait') !== String(base)) {
        node.setAttribute('data-wait', base);
        node.textContent = fmtWait(base + state.ticking);
      }
    }
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
      var list = laneList(lane.key);
      var section = box.querySelector('.lane[data-lane="' + lane.key + '"]');
      if (!section) return;

      var count = section.querySelector('.lane-count');
      if (count) count.textContent = list.length;

      /* ★ 指纹只算「真正会影响画面」的栏位。
         waitingSeconds 每次轮询都会变，如果算进去，每 8 秒每一栏都会
         整块重画（现场感觉就是「很卡」）。等待时间交给每秒的 tick 更新。 */
      var sig = list.map(function (o) {
        return [o.appOrderId, o.orderStatus, o.paymentStatus, o.itemCount,
                o.finalAmount, o.walletRequested || 0, o.customerNote || '',
                (o.customer && o.customer.name) || '',
                state.busy[o.appOrderId] ? 'B' : ''].join('~');
      }).join('|');
      if (state.laneSig[lane.key] === sig) return;
      state.laneSig[lane.key] = sig;

      var body = section.querySelector('.lane-body');
      body.innerHTML = list.length
        ? list.map(function (o) { return card(o, lane.key); }).join('')
        : '<div class="a-empty" style="padding:14px">—</div>';
    });

    refreshWaitBases();       // 没重画的卡片也要把等待基准对上后端
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
    var statSig = state.today ? JSON.stringify(state.today) : '';
    if (stat && state.today && state.todaySig !== statSig) {
      state.todaySig = statSig;
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
    /* 卡片自己还停在 CONFIRMED（后端没跟上）→ 给「开始制作」，
       不要因为在「制作中」栏里就给「做好了」。 */
    var stage = o.orderStatus === 'CONFIRMED' ? 'CONFIRMED' : lane;
    if (stage === 'NEW') {
      /* 2.1.10 员工要的是「确认后直接进制作」：一次按下去 = 接单 + 制作中 */
      main = '<button class="big-action" data-act="acceptAndStart">接单并制作 ACCEPT &amp; START</button>';
    } else if (stage === 'CONFIRMED') {
      main = '<button class="big-action" data-act="startPreparing">开始制作 START</button>';
    } else if (lane === 'PREPARING') {
      main = '<button class="big-action" data-act="markReady">做好了 READY</button>';
    } else {
      main = o.paymentStatus === 'PAID'
        ? '<button class="big-action" data-act="completeOrder">完成订单 COMPLETE</button>'
        : '<button class="big-action" data-pay="1">收款并标记 PAID</button>';
    }

    var busy = !!state.busy[o.appOrderId];
    var busyLabel = busy ? (state.busyLabel[o.appOrderId] || '') : '';
    if (busyLabel) {
      /* 收款 / 取消：这几个要等后端确定，才显示「处理中」文字 */
      main = '<button class="big-action" disabled>' + UI.esc(busyLabel) + '</button>';
    }

    return '<article class="board-card' + (busyLabel ? ' is-busy' : '') +
      (busy ? ' is-pending' : '') + '" data-pending="' + (busy ? '1' : '0') +
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
      confirmedCount: (state.lanes.CONFIRMED || []).length,   // 内部状态还在，只是并进「制作中」显示
      preparingCount: laneList('PREPARING').length,
      readyCount: (state.lanes.READY || []).length,
      laneKeys: LANES.map(function (l) { return l.key; }),
      totalToday: state.today ? state.today.orders : 0,
      salesToday: state.today ? state.today.sales : 0,
      pollSeconds: state.pollSeconds,
      pollEverySeconds: pollEverySeconds(),
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
