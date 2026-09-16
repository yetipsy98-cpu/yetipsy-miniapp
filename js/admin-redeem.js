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

  var detector = null;
  var stream = null;
  var rafId = null;
  var scanning = false;
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
    var camera = hasCamera();
    var hasDetector = typeof window.BarcodeDetector === 'function';

    if (hasDetector) {
      try {
        detector = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] });
      } catch (e) { detector = null; }
    }

    if (!camera) {
      el.support.innerHTML = '⚠️ 这台装置没有相机，请用下面的「手动输入」。<br>' +
        '<span class="muted-2">No camera on this device — use manual entry.</span>';
      document.getElementById('startScanBtn').style.display = 'none';
      return;
    }

    el.support.innerHTML = detector
      ? '✅ 可以扫一维条码（Code128）与 QR。'
      : 'ℹ️ 这台装置的浏览器不支援一维条码扫描（iOS Safari 就是这样），' +
        '请顾客出示条码<b>下方的 QR</b> 给你扫。';
  }

  /* ---------------- 步骤切换 ---------------- */

  function show(step) {
    el.stepScan.style.display   = step === 'scan'   ? '' : 'none';
    el.stepVerify.style.display = step === 'verify' ? '' : 'none';
    el.stepRedeem.style.display = step === 'redeem' ? '' : 'none';
    el.stepResult.style.display = step === 'result' ? '' : 'none';
  }

  /* ---------------- 扫描 ---------------- */

  function hasCamera() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function startScan() {
    if (scanning) return;

    /* 没有相机（或页面不是 HTTPS，浏览器不会给 mediaDevices）→
       不能直接存取 navigator.mediaDevices，否则会 TypeError。
       这种情况请顾客报出条码内容，用「手动输入」。 */
    if (!hasCamera()) {
      el.scanBox.style.display = 'none';
      document.getElementById('startScanBtn').style.display = 'none';
      document.getElementById('stopScanBtn').style.display = 'none';
      el.support.innerHTML = '⚠️ 这台装置开不了相机（没有相机，或页面不是 HTTPS），' +
        '请用下面的「手动输入」。<br>' +
        '<span class="muted-2">Camera unavailable — use manual entry below.</span>';
      return;
    }

    el.scanBox.style.display = '';
    document.getElementById('startScanBtn').style.display = 'none';
    document.getElementById('stopScanBtn').style.display = '';
    el.hint.textContent = detector ? '把顾客的条码对准框内' : '请扫顾客条码下方的 QR';

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        el.video.srcObject = s;
        el.video.setAttribute('playsinline', 'true');
        return el.video.play();
      })
      .then(function () { scanning = true; tick(); })
      .catch(function () {
        UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
        stopScan();
      });
  }

  function stopScan() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    el.video.srcObject = null;
    el.scanBox.style.display = 'none';
    document.getElementById('startScanBtn').style.display = '';
    document.getElementById('stopScanBtn').style.display = 'none';
  }

  function tick() {
    if (!scanning) return;

    if (el.video.readyState === el.video.HAVE_ENOUGH_DATA) {
      var w = 480;
      var h = Math.round(el.video.videoHeight * (w / el.video.videoWidth)) || 360;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(el.video, 0, 0, w, h);

      if (detector) {
        detector.detect(canvas).then(function (codes) {
          if (codes && codes.length) handleCode(codes[0].rawValue);
        }).catch(function () { /* 这一帧读不到就算了 */ });
      } else {
        var img = ctx.getImageData(0, 0, w, h);
        var qr = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data) handleCode(qr.data);
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  function manualVerify() {
    var v = document.getElementById('manualInput').value.trim();
    if (!v) { UI.toast('请输入条码内容 / Enter the code', 'error'); return; }
    handleCode(v);
  }

  /* ---------------- 验证 ---------------- */

  function handleCode(text) {
    if (!scanning && !text) return;
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
