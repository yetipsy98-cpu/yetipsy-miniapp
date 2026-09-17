/* =============================================================
   YETIPSY — admin-redeem.js（员工端 · 扫码抵扣）
   -------------------------------------------------------------
   流程：① 扫顾客的会员条码 → ② 确认是本人 → ③ 输入账单、抵扣

   扫描方式（自动选）：
     · BarcodeDetector（Chrome / Android）→ 直接读 Code128 一维条码
     · 不支援时退回 jsQR → 请顾客用条码下方那个 QR
   两种方式读到的是同一串内容，后端验证完全一样。

   ⚠️ 安全：verifyToken 只能用于「扫到的那位顾客 + 扫的那位员工」，
      而且有时效（预设 180 秒），后端 redeemWallet 会再验一次。
   ============================================================= */

var ADMIN_REDEEM = (function () {

  /* 相机 / 条码辨识交给共用模组 MEMBER_SCANNER（js/scanner.js），
     这里只留业务状态。原本这四个变数与 startScan/stopScan/tick 是
     js/admin-redeem.js 自己的一份副本，与共用模组逐行相同。 */
  var verifyTimer = null;

  var state = {
    customer: null,
    membership: null,
    verifyToken: '',
    verifyLeft: 0
  };

  var el = {};

  /* ---------------- 初始化 ---------------- */

  function init() {
    el.stepScan   = document.getElementById('stepScan');
    el.stepVerify = document.getElementById('stepVerify');
    el.stepRedeem = document.getElementById('stepRedeem');
    el.stepResult = document.getElementById('stepResult');
    el.scanBox    = document.getElementById('scanBox');
    el.video      = document.getElementById('scanVideo');
    el.hint       = document.getElementById('scanHint');
    el.support    = document.getElementById('scanSupport');

    document.getElementById('startScanBtn').addEventListener('click', startScan);
    document.getElementById('stopScanBtn').addEventListener('click', stopScan);
    document.getElementById('manualBtn').addEventListener('click', manualVerify);
    document.getElementById('rescanBtn').addEventListener('click', backToScan);
    document.getElementById('calcBtn').addEventListener('click', calculate);
    document.getElementById('redeemBtn').addEventListener('click', redeem);
    document.getElementById('againBtn').addEventListener('click', reset);
    document.getElementById('billInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') calculate();
    });
    document.getElementById('walletInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') redeem();
    });

    showSupportInfo();
  }

  function showSupportInfo() {
    /* 支援说明与「有没有相机」都问共用模组，不再自己判断一遍 */
    MEMBER_SCANNER.init();
    el.support.innerHTML = MEMBER_SCANNER.supportText();
    if (!MEMBER_SCANNER.hasCamera()) {
      document.getElementById('startScanBtn').style.display = 'none';
    }
  }

  /* ---------------- 步骤切换 ---------------- */

  function show(step) {
    el.stepScan.style.display   = step === 'scan'   ? '' : 'none';
    el.stepVerify.style.display = step === 'verify' ? '' : 'none';
    el.stepRedeem.style.display = step === 'redeem' ? '' : 'none';
    el.stepResult.style.display = step === 'result' ? '' : 'none';
  }

  /* ---------------- 扫描 ----------------
     相机与条码辨识全部交给 MEMBER_SCANNER（js/scanner.js）。
     这里只负责画面上的显示切换 —— 与 admin-grant.js 用同一套。
     ---------------------------------------------------------- */

  function startScan() {
    MEMBER_SCANNER.start({
      video: el.video,
      onStart: function (hasBarcode) {
        el.scanBox.style.display = '';
        document.getElementById('startScanBtn').style.display = 'none';
        document.getElementById('stopScanBtn').style.display = '';
        el.hint.textContent = hasBarcode ? '把顾客的条码对准框内'
                                         : '请扫顾客条码下方的 QR';
      },
      onCode: handleCode,
      onError: function (why) {
        el.scanBox.style.display = 'none';
        document.getElementById('startScanBtn').style.display =
          MEMBER_SCANNER.hasCamera() ? '' : 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
        el.support.innerHTML = MEMBER_SCANNER.supportText();
        if (why === 'CAMERA_DENIED') {
          UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
        }
      },
      onStop: function () {
        el.scanBox.style.display = 'none';
        document.getElementById('startScanBtn').style.display =
          MEMBER_SCANNER.hasCamera() ? '' : 'none';
        document.getElementById('stopScanBtn').style.display = 'none';
      }
    });
  }

  function stopScan() {
    MEMBER_SCANNER.stop();
  }

  function manualVerify() {
    var v = document.getElementById('manualInput').value.trim();
    if (!v) { UI.toast('请输入条码内容 / Enter the code', 'error'); return; }
    handleCode(v);
  }

  /* ---------------- 验证 ---------------- */

  function handleCode(text) {
    if (!text) return;
    stopScan();

    UI.showLoading('VERIFYING');
    API.staff.scanMemberCode(text).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }

      state.customer   = res.data.customer;
      state.membership = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft  = Number(res.data.verifySeconds) || 180;

      renderVerify();
      show('verify');
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
      startVerifyCountdown();

      /* 顺手把钱包余额带进抵扣步骤 */
      el.stepRedeem.style.display = '';
      document.getElementById('walletInput').value = '';
      document.getElementById('calcLine').textContent = '';
    });
  }

  function renderVerify() {
    var c = state.customer;
    document.getElementById('vName').textContent   = c.name || 'MEMBER';
    document.getElementById('vId').textContent     = c.customerId;
    document.getElementById('vTier').textContent   = UI.tierName(c.membershipTier);
    document.getElementById('vPoints').textContent = UI.points(c.currentPoints);
    document.getElementById('vWallet').textContent = UI.money(c.walletBalance);
    document.getElementById('vPhone').textContent  = c.phone || '—';
  }

  function startVerifyCountdown() {
    if (verifyTimer) clearInterval(verifyTimer);
    paintCountdown();
    verifyTimer = setInterval(function () {
      state.verifyLeft--;
      if (state.verifyLeft <= 0) {
        clearInterval(verifyTimer); verifyTimer = null;
        UI.toast('验证已过期，请重扫 / Verification expired', 'error');
        backToScan();
        return;
      }
      paintCountdown();
    }, 1000);
  }

  function paintCountdown() {
    document.getElementById('vCount').textContent =
      '验证有效 ' + state.verifyLeft + ' 秒 · VERIFY EXPIRES IN ' + state.verifyLeft + 'S';
  }

  function backToScan() {
    if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
    state.customer = null; state.verifyToken = ''; state.verifyLeft = 0;
    show('scan');
    startScan();
  }

  /* ---------------- 抵扣 ---------------- */

  function calculate() {
    if (!state.customer) { UI.toast('请先扫条码 / Scan first', 'error'); return; }
    var bill = UI.parseMoneyToSen(document.getElementById('billInput').value);
    if (!bill || bill <= 0) { UI.toast('请输入账单金额 / Enter the bill', 'error'); return; }

    API.staff.calculateWalletRedemption(state.customer.customerId, bill).then(function (res) {
      if (!res.success) { ADMIN.handleError(res.error); return; }
      var p = res.data;
      if (!p.allowed) {
        document.getElementById('calcLine').innerHTML =
          '⚠️ ' + UI.esc(p.reason) + ' / ' + UI.esc(p.reasonEn);
        document.getElementById('walletInput').value = '0.00';
        return;
      }
      document.getElementById('calcLine').innerHTML =
        '最多可抵扣 <b>' + UI.money(p.usableAmount) + '</b>（上限 ' + p.maxPercent +
        '%）· 顾客付 ' + UI.money(p.customerPays);
      document.getElementById('walletInput').value = (p.usableAmount / 100).toFixed(2);
    });
  }

  function redeem() {
    if (!state.customer) { UI.toast('请先扫条码 / Scan first', 'error'); return; }
    if (!state.verifyToken) { UI.toast('验证已失效，请重扫 / Scan again', 'error'); return; }

    var bill   = UI.parseMoneyToSen(document.getElementById('billInput').value);
    var wallet = UI.parseMoneyToSen(document.getElementById('walletInput').value);
    if (!bill || bill <= 0) { UI.toast('请输入账单金额 / Enter the bill', 'error'); return; }
    if (wallet === null || wallet < 0) { UI.toast('抵扣金额无效 / Invalid amount', 'error'); return; }

    var btn = document.getElementById('redeemBtn');
    UI.setLoading(btn, true, 'PROCESSING');

    API.staff.redeemWallet(state.customer.customerId, bill, wallet,
      '', 'DIRECT', 'Scan & redeem', state.verifyToken).then(function (res) {
      UI.setLoading(btn, false);
      if (!res.success) {
        /* 验证过期 / 不是同一位顾客 → 请他重扫 */
        if (res.error.code === 'MEMBER_VERIFY_EXPIRED' ||
            res.error.code === 'MEMBER_VERIFY_REQUIRED' ||
            res.error.code === 'MEMBER_VERIFY_MISMATCH') {
          UI.toast(res.error.message, 'error');
          setTimeout(backToScan, 900);
          return;
        }
        ADMIN.handleError(res.error);
        return;
      }

      if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
      document.getElementById('rUsed').textContent = UI.money(res.data.walletUsed);
      document.getElementById('rDetail').innerHTML =
        '账单 ' + UI.money(res.data.billAmount) + ' · 顾客付 ' +
        UI.money(res.data.customerPays) + '<br>积分 +' + UI.points(res.data.pointsEarned) +
        ' · ' + UI.esc(res.data.customer.name || res.data.customer.customerId);
      show('result');
    });
  }

  function reset() {
    state.customer = null; state.membership = null;
    state.verifyToken = ''; state.verifyLeft = 0;
    document.getElementById('billInput').value = '';
    document.getElementById('walletInput').value = '';
    document.getElementById('calcLine').textContent = '';
    document.getElementById('manualInput').value = '';
    show('scan');
    startScan();
  }

  return { init: init };
})();
