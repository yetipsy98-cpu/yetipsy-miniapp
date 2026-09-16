/* =============================================================
   YETIPSY — code.js（会员端 · 会员条码）
   -------------------------------------------------------------
   顾客出示 → 员工扫描 → 确认是本人 → 才允许抵扣钱包。

   · 条码内容来自后端 getMemberCode（每 N 秒换一条，扫过即失效）
   · 画 Code128 一维条码（JsBarcode）+ 同内容的 QR（给不支援
     BarcodeDetector 的装置扫，例如 iOS Safari）
   · 画面停留在这一页时自动倒数、到期自动换
   ============================================================= */

var CODE = (function () {

  var timerId = null;
  var secondsLeft = 0;
  var ttl = 60;

  function init() {
    if (!AUTH.requireCustomer()) return;

    document.getElementById('refreshBtn').addEventListener('click', function () { load(); });

    /* 画面被切到背景就停止倒数，回来时立刻换一条（避免拿到过期码） */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopTimer();
      else load();
    });

    load();
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function load() {
    stopTimer();
    UI.showLoading('LOADING');

    API.customer.getMemberCode().then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      render(res.data);
    });
  }

  function render(d) {
    ttl = Number(d.seconds) || 60;
    secondsLeft = ttl;

    document.getElementById('ttlText').textContent = ttl;
    document.getElementById('memberName').textContent = d.displayName || 'MEMBER';
    document.getElementById('memberId').textContent = d.customerId;
    document.getElementById('memberMeta').textContent =
      UI.points(d.currentPoints) + ' PTS · ' + UI.money(d.walletBalance) + ' WALLET';

    drawBarcode(d.payload);
    UI.renderQR(document.getElementById('qrBox'), d.payload, 118);

    paintTimer();
    timerId = setInterval(function () {
      secondsLeft--;
      if (secondsLeft <= 0) { load(); return; }   // 到期自动换一条
      paintTimer();
    }, 1000);
  }

  function paintTimer() {
    var el = document.getElementById('codeTimer');
    el.textContent = secondsLeft + ' 秒后更换 · REFRESHES IN ' + secondsLeft + 'S';
    el.style.color = secondsLeft <= 10 ? '#B4472F' : '#8A6B2F';
  }

  /* Code128 一维条码。JsBarcode 直接画进 <svg> */
  function drawBarcode(payload) {
    var svg = document.getElementById('barcode');
    try {
      JsBarcode(svg, payload, {
        format: 'CODE128',
        displayValue: false,
        background: '#FFFFFF',
        lineColor: '#0D0D0D',
        height: 92,
        width: 2,
        margin: 4
      });
    } catch (e) {
      /* 画不出来就只留 QR（员工还是扫得到） */
      document.getElementById('barcodeBox').innerHTML =
        '<div style="padding:26px 0;font-size:11px;letter-spacing:1.4px;color:#6B6B6B">' +
        '条码不可用，请扫下方 QR</div>';
    }
  }

  return { init: init };
})();

CODE.init();
