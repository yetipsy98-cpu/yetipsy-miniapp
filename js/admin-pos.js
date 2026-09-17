/* =============================================================
   YETIPSY — admin-pos.js（员工端 POS 进单台）
   -------------------------------------------------------------
   现场动线（foodcourt 通路）：

     ① 录入 foodcourt 单据（单号 + 金额）→ 进「待进单」队列
     ② 顾客出示会员码 → 扫码
     ③ 确认会员 → 进分（积分 / Reward / 到店次数）

   为什么是这个顺序（跟旧的「输金额 → 扫会员码」不一样）：
     · 单是 foodcourt 出的，金额以单据为准，员工不该再抄一次
     · 值班时可以先把三五张单录进队列，顾客来了才逐张扫码
     · 扫码只是「这张单是谁的」，付款早在 foodcourt 完成了

   为什么扫到码还要按一下确认：
     积分与 Reward 会动到会员资料，扫错人（隔壁客人的码）代价大，
     多点一下比事后改帐便宜。

   Mini app 的订单不走这里 —— 顾客在 App 下单，员工完成订单时
   系统就会自动进分（admin/orderboard.html）。
   ============================================================= */

var ADMIN_POS = (function () {

  var state = {
    step: 'queue',           // queue | scan | confirm | result
    tickets: [],
    today: null,
    selected: null,
    customer: null,
    membership: null,
    verifyToken: '',
    verifyLeft: 0,
    bill: 0,
    result: null,
    errorCode: null,
    busy: false,
    pollSeconds: 8
  };

  var el = {};
  var pollTimer = null;
  var countdownTimer = null;

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */

  function init() {
    el.stepQueue   = document.getElementById('stepQueue');
    el.stepScan    = document.getElementById('stepScan');
    el.stepConfirm = document.getElementById('stepConfirm');
    el.stepResult  = document.getElementById('stepResult');
    el.scanBox     = document.getElementById('scanBox');
    el.video       = document.getElementById('scanVideo');
    el.hint        = document.getElementById('scanHint');
    el.support     = document.getElementById('scanSupport');

    on('refreshBtn', function () { loadQueue(true); });
    on('newTicketBtn', toggleForm);
    on('saveTicketBtn', saveTicket);
    on('cancelTicketBtn', function () { toggleForm(false); });
    on('ticketAmountInput', null, function (e) { if (e.key === 'Enter') saveTicket(); });
    on('ticketNoInput', null, function (e) { if (e.key === 'Enter') saveTicket(); });

    on('startScanBtn', startCamera);
    on('stopScanBtn', function () { MEMBER_SCANNER.stop(); });
    on('manualBtn', function () {
      var v = txt('manualInput');
      if (!v) { UI.toast('请输入条码内容 / Enter the code', 'error'); return; }
      handleCode(v);
    });
    on('backToQueueBtn', backToQueue);
    on('rescanBtn', function () { pickTicket(state.selected); });
    on('confirmBtn', confirm);
    on('nextTicketBtn', backToQueue);

    MEMBER_SCANNER.init();
    if (el.support) el.support.innerHTML = MEMBER_SCANNER.supportText();
    if (!MEMBER_SCANNER.hasCamera()) show('startScanBtn', false);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPolling();
      else if (state.step === 'queue') { loadQueue(false); startPolling(); }
    });

    show('queue');
    loadQueue(true);
    var amount = document.getElementById('ticketAmountInput');
    if (amount) amount.focus();
  }

  function on(id, fn, keyFn) {
    var node = document.getElementById(id);
    if (!node) return;
    if (fn) node.addEventListener('click', fn);
    if (keyFn) node.addEventListener('keydown', keyFn);
  }

  function txt(id) {
    var node = document.getElementById(id);
    return node ? node.value.trim() : '';
  }

  function set(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function showBtn(id, visible) {
    var node = document.getElementById(id);
    if (node) node.style.display = visible ? '' : 'none';
  }

  function show(step) {
    state.step = step;
    if (el.stepQueue)   el.stepQueue.style.display   = step === 'queue'   ? '' : 'none';
    if (el.stepScan)    el.stepScan.style.display    = step === 'scan'    ? '' : 'none';
    if (el.stepConfirm) el.stepConfirm.style.display = step === 'confirm' ? '' : 'none';
    if (el.stepResult)  el.stepResult.style.display  = step === 'result'  ? '' : 'none';
    if (step === 'queue') { startPolling(); } else { stopPolling(); }
  }

  /* ---------------------------------------------------------
     待进单队列
     --------------------------------------------------------- */

  function loadQueue(verbose) {
    if (!API.staff.getPosQueue) { UI.toast('API 未更新 / API out of date', 'error'); return; }
    return API.staff.getPosQueue().then(function (res) {
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error) && verbose) UI.toast(res.error.message, 'error');
        return res;
      }
      state.errorCode = null;
      state.tickets = res.data.pending || [];
      state.today = res.data.today || null;
      state.pollSeconds = Number(res.data.pollSeconds) || 8;
      renderQueue();
      return res;
    });
  }

  /* §46 轮询：只在队列页、页面开着的时候刷新 */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || state.step !== 'queue') return;
      loadQueue(false);
    }, Math.max(5, state.pollSeconds) * 1000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function renderQueue() {
    var box = document.getElementById('queueBody');
    if (!box) return;

    set('statOpen', state.tickets.length);
    set('statBound', state.today ? state.today.bound : 0);
    set('statPoints', state.today ? UI.points(state.today.points) : 0);

    var status = document.getElementById('queueStatus');
    if (status) {
      status.textContent = state.errorCode
        ? '载入失败 ' + state.errorCode
        : (state.tickets.length ? state.tickets.length + ' 张单据等着进单' : '目前没有待进单');
      status.className = 'a-sub' + (state.errorCode ? ' warn' : '');
    }

    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">' +
        '载入失败 / LOAD FAILED<br>' + UI.esc(state.errorCode) +
        '<br><button class="chip mt-16" id="retryBtn">重试 RETRY</button></div>';
      on('retryBtn', function () { loadQueue(true); });
      return;
    }

    if (!state.tickets.length) {
      box.innerHTML = '<div class="a-empty" style="padding:22px">' +
        '没有待进单 · 顾客来了就先按下面的「录入 FOODCOURT 单据」</div>';
    } else {
      box.innerHTML = state.tickets.map(ticketCard).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-scan]'), function (node) {
        node.addEventListener('click', function () {
          pickTicket(node.getAttribute('data-scan'));
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-cancel]'), function (node) {
        node.addEventListener('click', function () {
          cancelTicket(node.getAttribute('data-cancel'));
        });
      });
    }

    renderToday();
  }

  function ticketCard(t) {
    return '<div class="ticket" data-ticket="' + UI.esc(t.orderId) + '">' +
      '<div class="tk-top">' +
        '<span class="tk-num">' + UI.esc(t.orderNumber) + '</span>' +
        '<span class="tk-amt">' + UI.money(t.amount) + '</span>' +
      '</div>' +
      '<div class="tk-meta">' + UI.esc(t.source) + ' · ' + UI.esc(UI.timeOnly(t.createdAt)) + '</div>' +
      (t.note ? '<div class="tk-note">' + UI.esc(t.note) + '</div>' : '') +
      '<div class="tk-actions">' +
        '<button class="big-action" data-scan="' + UI.esc(t.orderId) + '">扫会员码进单 SCAN MEMBER</button>' +
        '<button class="chip" data-cancel="' + UI.esc(t.orderId) + '">取消 ✕</button>' +
      '</div>' +
    '</div>';
  }

  function renderToday() {
    var box = document.getElementById('todayBody');
    if (!box) return;
    var list = (state.today && state.today.recent) || [];
    if (!list.length) {
      box.innerHTML = '<div class="a-empty" style="padding:18px">今天还没有进单</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + list.map(function (t) {
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.esc(t.orderNumber) +
            ' · <span style="color:var(--a-gold)">' + UI.money(t.amount) + '</span></div>' +
          '<div class="a-sub">' + UI.esc(t.customerName || '—') +
            ' · +' + UI.points(t.pointsEarned) + ' 分 · ' + UI.esc(UI.timeOnly(t.boundAt)) + '</div>' +
        '</div>' +
        '<div class="a-right"><span class="chip ok">已进单</span></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------
     录入单据
     --------------------------------------------------------- */

  function toggleForm(force) {
    var box = document.getElementById('ticketForm');
    if (!box) return;
    var open = typeof force === 'boolean' ? force : box.style.display === 'none';
    box.style.display = open ? '' : 'none';
    if (open) {
      var amount = document.getElementById('ticketAmountInput');
      if (amount) amount.focus();
    }
  }

  function saveTicket() {
    if (state.busy) return;

    var rm = parseFloat(txt('ticketAmountInput').replace(/[^0-9.]/g, ''));
    if (!isFinite(rm) || rm <= 0) {
      UI.toast('请输入金额 / Enter the amount', 'error');
      return;
    }

    state.busy = true;
    UI.setLoading(document.getElementById('saveTicketBtn'), true, 'SAVING');

    API.staff.createPosTicket({
      amount: Math.round(rm * 100),
      externalOrderId: txt('ticketNoInput'),
      note: txt('ticketNoteInput')
    }).then(function (res) {
      state.busy = false;
      UI.setLoading(document.getElementById('saveTicketBtn'), false);

      if (!res.success) {
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }

      ['ticketNoInput', 'ticketAmountInput', 'ticketNoteInput'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.value = '';
      });
      toggleForm(false);
      UI.toast('已加入待进单 ' + UI.money(res.data.ticket.amount), 'success');
      loadQueue(false);
      var amount = document.getElementById('ticketAmountInput');
      if (amount) amount.focus();
    });
  }

  function cancelTicket(orderId) {
    var t = findTicket(orderId);
    UI.confirmDialog(
      '取消单据 ' + (t ? t.orderNumber : '') + '？',
      'Cancel this ticket?（还没进分才可以取消）',
      '取消 CANCEL'
    ).then(function (yes) {
      if (!yes) return;
      UI.showLoading('CANCELLING');
      API.staff.cancelPosTicket(orderId, 'Cancelled at POS').then(function (res) {
        UI.hideLoading();
        if (!res.success) {
          if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
          loadQueue(false);
          return;
        }
        UI.toast('已取消单据', 'success');
        loadQueue(false);
      });
    });
  }

  function findTicket(orderId) {
    var hit = null;
    state.tickets.forEach(function (t) { if (!hit && t.orderId === orderId) hit = t; });
    return hit;
  }

  /* ---------------------------------------------------------
     扫码
     --------------------------------------------------------- */

  function pickTicket(orderId) {
    var t = findTicket(orderId);
    if (!t) { UI.toast('找不到这张单据，请刷新 / Refresh the queue', 'error'); loadQueue(false); return; }

    state.selected = t;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;

    var box = document.getElementById('scanTicketBox');
    if (box) {
      box.innerHTML =
        '<div class="tk-top">' +
          '<span class="tk-num">' + UI.esc(t.orderNumber) + '</span>' +
          '<span class="tk-amt">' + UI.money(t.amount) + '</span>' +
        '</div>' +
        '<div class="tk-meta">' + UI.esc(t.source) +
          (t.note ? ' · ' + UI.esc(t.note) : '') + '</div>';
    }

    var manual = document.getElementById('manualInput');
    if (manual) manual.value = '';

    show('scan');

    /* 点「扫会员码进单」本身就是使用者手势，可以直接开相机 */
    if (MEMBER_SCANNER.hasCamera()) startCamera();
    else if (el.hint) el.hint.textContent = '这台装置没有相机，请用下面的手动输入';
  }

  function startCamera() {
    MEMBER_SCANNER.start({
      video: el.video,
      onStart: function (hasBarcode) {
        el.scanBox.style.display = '';
        showBtn('startScanBtn', false);
        showBtn('stopScanBtn', true);
        el.hint.textContent = hasBarcode
          ? '把顾客的会员条码对准框内'
          : '请扫会员条码下方的 QR';
      },
      onCode: handleCode,
      onError: function (why) {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
        if (el.support) el.support.innerHTML = MEMBER_SCANNER.supportText();
        if (why === 'CAMERA_DENIED') UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
      },
      onStop: function () {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
      }
    });
  }

  function handleCode(text) {
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToQueue(); return; }
    MEMBER_SCANNER.stop();
    UI.showLoading('VERIFYING');

    API.staff.scanMemberCode(text).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.errorCode = null;
      state.customer = res.data.customer;
      state.membership = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft = Number(res.data.verifySeconds) || 180;
      renderConfirm();
      show('confirm');
      startCountdown();
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
    });
  }

  function renderConfirm() {
    var c = state.customer || {};
    var t = state.selected || {};

    var box = document.getElementById('confirmCustomer');
    if (box) {
      box.innerHTML =
        '<div class="a-title">' + UI.esc(c.name || '—') + '</div>' +
        '<div class="a-sub">' + UI.esc(c.customerId || '') + ' · ' + UI.esc(c.phone || '') + '</div>' +
        '<div class="mt-8">' +
          row('等级 TIER', UI.esc((state.membership && state.membership.tier) || 'MEMBER')) +
          row('现有积分 POINTS', UI.esc(String(c.currentPoints || 0)) + ' 分') +
          row('钱包 WALLET', UI.money(c.walletBalance || 0)) +
          row('到店 VISITS', UI.esc(String(c.totalVisits || 0)) + ' 次') +
        '</div>';
    }

    var tk = document.getElementById('confirmTicket');
    if (tk) {
      tk.innerHTML =
        row('单据 TICKET', UI.esc(t.orderNumber || '—')) +
        row('消费金额 BILL', '<span style="font-size:18px;color:var(--a-gold)">' +
          UI.money(t.amount || 0) + '</span>') +
        row('积分 / Reward', '由后端按规则自动计算');
    }
  }

  function row(k, v) {
    return '<div class="pos-row"><span class="pos-k">' + k + '</span>' +
      '<span class="pos-v">' + v + '</span></div>';
  }

  function startCountdown() {
    stopCountdown();
    var left = document.getElementById('verifyLeft');
    if (left) { left.textContent = state.verifyLeft + ' 秒内有效'; left.style.color = ''; }
    countdownTimer = setInterval(function () {
      state.verifyLeft -= 1;
      if (left) {
        left.textContent = state.verifyLeft + ' 秒内有效';
        if (state.verifyLeft <= 30) left.style.color = '#E2696B';
      }
      if (state.verifyLeft <= 0) {
        stopCountdown();
        UI.toast('验证已过期，请重新扫码 / Verification expired', 'error');
        if (state.selected) pickTicket(state.selected.orderId);
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function backToQueue() {
    stopCountdown();
    MEMBER_SCANNER.stop();
    state.selected = null;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;
    show('queue');
    loadQueue(false);
  }

  /* ---------------------------------------------------------
     进单
     --------------------------------------------------------- */

  function confirm() {
    if (state.busy) return;
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToQueue(); return; }
    if (!state.verifyToken) { UI.toast('请先扫顾客的会员码 / Scan the member code first', 'error'); return; }

    state.busy = true;
    var btn = document.getElementById('confirmBtn');
    if (btn) btn.disabled = true;
    UI.showLoading('SAVING');

    API.staff.bindPosTicket({
      orderId: state.selected.orderId,
      customerId: state.customer.customerId,
      verifyToken: state.verifyToken
    }).then(function (res) {
      UI.hideLoading();
      state.busy = false;
      if (btn) btn.disabled = false;

      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        if (res.error.code === 'MEMBER_VERIFY_EXPIRED' ||
            res.error.code === 'MEMBER_VERIFY_REQUIRED' ||
            res.error.code === 'MEMBER_VERIFY_MISMATCH') {
          if (state.selected) pickTicket(state.selected.orderId);
        } else if (res.error.code === 'TICKET_ALREADY_BOUND') {
          backToQueue();
        }
        return;
      }

      state.errorCode = null;
      state.result = res.data;
      stopCountdown();
      renderResult();
      show('result');
      UI.toast('已进单 · +' + res.data.pointsEarned + ' 分', 'success');
    });
  }

  function renderResult() {
    var r = state.result || {};
    var t = state.selected || {};

    set('rName', (r.customer && r.customer.name) || '—');
    set('rPoints', '+' + (r.pointsEarned || 0) + ' 分');
    set('rTicket', t.orderNumber || '—');
    set('rBill', UI.money(r.billAmount || 0));
    set('rVisit', r.visitCounted ? '算一次到店' : '6 小时内已算过，不重复计');
    set('rTotal', (r.customer ? r.customer.currentPoints : 0) + ' 分');

    var box = document.getElementById('rReward');
    if (box) {
      box.innerHTML = r.reward
        ? '🎁 已发出 Reward ' + UI.money(r.reward.amount) + ' · 顾客可在会员端开启'
        : '<span class="muted-2">未达 Reward 门槛，本次只发积分</span>';
    }
  }

  /* ---------------- 测试用 ---------------- */

  function debugState() {
    return {
      step: state.step,
      queueCount: state.tickets.length,
      selectedOrderId: state.selected ? state.selected.orderId : null,
      hasVerifyToken: !!state.verifyToken,
      customerId: state.customer ? state.customer.customerId : null,
      pointsEarned: state.result ? state.result.pointsEarned : null,
      errorCode: state.errorCode,
      busy: state.busy
    };
  }

  return {
    init: init,
    loadQueue: loadQueue,
    handleCode: handleCode,
    debugState: debugState
  };
})();
