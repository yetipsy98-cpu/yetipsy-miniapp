/* =============================================================
   YETIPSY — admin-grant.js（2.0 员工端主流程）
   -------------------------------------------------------------
   点单后扫会员码 → 输消费金额 → 系统自动发积分与 Reward

   为什么这样设计（取代原本的「建立 Claim 生成 QR」）：
     · 员工只需要输金额，积分按 POINTS_PER_RM 自动算（§57），
       够门槛自动发 Reward（§58），不需要员工自己算
     · §56 六小时内只算一次到店，后端负责，员工不用记
     · 必须扫过顾客的会员条码（REQUIRE_MEMBER_CODE_SCAN），
       而且 verifyToken 一次性 —— 不能事后补登

   四步：扫码 → 确认会员并输金额 → 结果 → 再来一单
   ============================================================= */

var ADMIN_GRANT = (function () {

  var state = {
    step: 'scan',            // scan | verify | result
    customer: null,
    verifyToken: '',
    verifyLeft: 0,
    bill: 0,
    result: null,
    errorCode: null,
    busy: false
  };

  var el = {};
  var countdownTimer = null;

  function init() {
    el.stepScan   = document.getElementById('stepScan');
    el.stepVerify = document.getElementById('stepVerify');
    el.stepResult = document.getElementById('stepResult');
    el.scanBox    = document.getElementById('scanBox');
    el.video      = document.getElementById('scanVideo');
    el.hint       = document.getElementById('scanHint');
    el.support    = document.getElementById('scanSupport');

    on('startScanBtn', function () {
      SCANNER.start({
        video: el.video,
        onStart: function (hasBarcode) {
          el.scanBox.style.display = '';
          showBtn('startScanBtn', false);
          showBtn('stopScanBtn', true);
          el.hint.textContent = hasBarcode ? '把顾客的会员条码对准框内'
                                           : '请扫会员条码下方的 QR';
        },
        onCode: handleCode,
        onError: function (why) {
          el.scanBox.style.display = 'none';
          showBtn('startScanBtn', false);
          el.support.innerHTML = SCANNER.supportText();
          if (why === 'CAMERA_DENIED') {
            UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
          }
        },
        onStop: function () {
          el.scanBox.style.display = 'none';
          showBtn('startScanBtn', true);
          showBtn('stopScanBtn', false);
        }
      });
    });
    on('stopScanBtn', function () { SCANNER.stop(); });
    on('manualBtn', function () {
      var v = txt('manualInput');
      if (!v) { UI.toast('请输入条码内容 / Enter the code', 'error'); return; }
      handleCode(v);
    });
    on('rescanBtn', backToScan);

    on('calcBtn', calculate);
    on('grantBtn', submit);
    on('billInput', null, function (e) {
      if (e.key === 'Enter') calculate();
    });
    on('againBtn', reset);

    /* 支援提示 + 没有相机就直接把扫码按钮收起来 */
    SCANNER.init();
    el.support.innerHTML = SCANNER.supportText();
    if (!SCANNER.hasCamera()) showBtn('startScanBtn', false);

    show('scan');
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

  function showBtn(id, visible) {
    var node = document.getElementById(id);
    if (node) node.style.display = visible ? '' : 'none';
  }

  /* ---------------- 步骤切换 ---------------- */

  function show(step) {
    state.step = step;
    if (el.stepScan)   el.stepScan.style.display   = step === 'scan'   ? '' : 'none';
    if (el.stepVerify) el.stepVerify.style.display = step === 'verify' ? '' : 'none';
    if (el.stepResult) el.stepResult.style.display = step === 'result' ? '' : 'none';
  }

  /* ---------------- ① 扫码 → 确认身分 ---------------- */

  function handleCode(text) {
    SCANNER.stop();
    UI.showLoading('VERIFYING');
    API.staff.scanMemberCode(text).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.errorCode = null;
      state.customer    = res.data.customer;
      state.membership  = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft  = Number(res.data.verifySeconds) || 180;
      renderVerify();
      show('verify');
      startCountdown();
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
      var bill = document.getElementById('billInput');
      if (bill) bill.focus();
    });
  }

  function renderVerify() {
    var c = state.customer || {};
    set('vName',  c.name || '—');
    set('vId',    c.customerId || '—');
    set('vPhone', UI.esc(c.phone || '—'));
    set('vTier',  (state.membership && state.membership.tier) || 'MEMBER');
    set('vPoints', (c.currentPoints || 0) + ' 分');
    set('vWallet', UI.money(c.walletBalance || 0));
    set('vCount', (c.totalVisits || 0) + ' 次');
  }

  function set(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(function () {
      state.verifyLeft -= 1;
      var node = document.getElementById('vLeft');
      if (node) {
        node.textContent = state.verifyLeft + ' 秒内有效';
        if (state.verifyLeft <= 30) node.style.color = '#E2696B';
      }
      if (state.verifyLeft <= 0) {
        stopCountdown();
        UI.toast('验证已过期，请重新扫码 / Verification expired', 'error');
        backToScan();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function backToScan() {
    stopCountdown();
    state.customer = null;
    state.verifyToken = '';
    state.result = null;
    var bill = document.getElementById('billInput');
    if (bill) bill.value = '';
    show('scan');
  }

  /* ---------------- ② 输金额 → 预算 ---------------- */

  function calculate() {
    var raw = txt('billInput').replace(/[^0-9.]/g, '');
    var rm = parseFloat(raw);
    if (!isFinite(rm) || rm <= 0) {
      UI.toast('请输入消费金额 / Enter the bill amount', 'error');
      return;
    }
    state.bill = Math.round(rm * 100);

    /* 预算只是给员工看个大概，真正发给多少由后端决定（§41/§42） */
    var line = document.getElementById('calcLine');
    if (line) {
      line.innerHTML = '消费 ' + UI.money(state.bill) +
        ' · 积分与 Reward 由后端按规则计算';
    }
    showBtn('grantBtn', true);
  }

  /* ---------------- ③ 送出 ---------------- */

  function submit() {
    if (state.busy) return;
    if (!state.verifyToken) {
      UI.toast('请先扫会员条码 / Scan the member code first', 'error');
      return;
    }
    if (!state.bill) {
      UI.toast('请先输入金额 / Enter the amount first', 'error');
      return;
    }

    state.busy = true;
    var btn = document.getElementById('grantBtn');
    if (btn) btn.disabled = true;
    UI.showLoading('SAVING');

    API.staff.grantOrder({
      customerId: state.customer.customerId,
      billAmount: state.bill,
      verifyToken: state.verifyToken,
      externalOrderId: txt('extInput'),
      note: txt('noteInput')
    }).then(function (res) {
      UI.hideLoading();
      state.busy = false;
      if (btn) btn.disabled = false;

      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        /* verifyToken 是一次性的，失败后多半要重扫 */
        if (res.error.code === 'MEMBER_VERIFY_EXPIRED' ||
            res.error.code === 'MEMBER_VERIFY_REQUIRED' ||
            res.error.code === 'MEMBER_VERIFY_MISMATCH') {
          backToScan();
        }
        return;
      }

      state.errorCode = null;
      state.result = res.data;
      stopCountdown();
      renderResult();
      show('result');
      UI.toast('已登记 · ' + res.data.pointsEarned + ' 分', 'success');
    });
  }

  function renderResult() {
    var r = state.result;
    if (!r) return;
    set('rName',   (r.customer && r.customer.name) || '—');
    set('rBill',   UI.money(r.billAmount));
    set('rPoints', '+' + r.pointsEarned + ' 分');
    set('rVisit',  r.visitCounted ? '算一次到店' : '6 小时内已算过，不重复计');
    set('rTotal',  (r.customer ? r.customer.currentPoints : 0) + ' 分');
    set('rSpend',  UI.money(r.customer ? r.customer.totalSpend : 0));

    var box = document.getElementById('rReward');
    if (box) {
      box.innerHTML = r.reward
        ? '🎁 已发出 Reward ' + UI.money(r.reward.amount) +
          ' · 顾客可在会员端开启'
        : '<span class="muted-2">未达 Reward 门槛，本次只发积分</span>';
    }
  }

  function reset() {
    state.bill = 0;
    state.result = null;
    state.customer = null;
    state.verifyToken = '';
    ['billInput', 'extInput', 'noteInput'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.value = '';
    });
    showBtn('grantBtn', false);
    var line = document.getElementById('calcLine');
    if (line) line.innerHTML = '';
    show('scan');
  }

  /* ---------------- 测试用 ---------------- */

  function debugState() {
    return {
      step: state.step,
      errorCode: state.errorCode,
      hasCustomer: !!state.customer,
      customerId: state.customer ? state.customer.customerId : null,
      hasVerifyToken: !!state.verifyToken,
      verifyLeft: state.verifyLeft,
      bill: state.bill,
      pointsEarned: state.result ? state.result.pointsEarned : null,
      visitCounted: state.result ? state.result.visitCounted : null,
      rewardAmount: state.result && state.result.reward ? state.result.reward.amount : null,
      busy: state.busy
    };
  }

  /* 测试用：直接注入 verifyToken，跳过相机 */
  function setVerified(customer, membership, verifyToken, seconds) {
    state.customer = customer;
    state.membership = membership;
    state.verifyToken = verifyToken;
    state.verifyLeft = seconds || 180;
    renderVerify();
    show('verify');
  }

  return {
    init: init,
    handleCode: handleCode,
    setVerified: setVerified,
    debugState: debugState
  };

})();
