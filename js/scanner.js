/* =============================================================
   YETIPSY — scanner.js（共用「扫会员条码」模组）
   -------------------------------------------------------------
   为什么抽出来：2.0 员工端新增「扫会员码进分」要用到与
   js/admin-redeem.js 相同的扫码逻辑（BarcodeDetector + jsQR 备用），
   与其复制一份，不如共用。

   ⚠️ 全域名称刻意叫 MEMBER_SCANNER，不是 SCANNER：
      js/claim.js 已经有一个全域 SCANNER（扫「员工 QR」，纯 jsQR，
      跟扫会员条码是两件事）。同名会在同时载入时静默互相覆写。

   目前 js/admin-redeem.js 仍保留自己那一份（尚未合并）——
   它的相机路径在 jsdom 里测不到，合并要等能在真机验证时再做。

   能力（与原本一致，不降级）：
     · BarcodeDetector（Chrome / Android）→ 直接读 Code128 一维条码
     · 不支援时退回 jsQR → 扫条码下方那个 QR（iOS Safari 就是这样）
     · 没有相机 / 不是 HTTPS → 不存取 navigator.mediaDevices（会 TypeError），
       由呼叫端显示「手动输入」

   用法：
     SCANNER.start({
       video:  <video 元素>,
       onCode: function (text) { … },
       onError: function (message) { … }
     });
     SCANNER.stop();
   ============================================================= */

var MEMBER_SCANNER = (function () {

  var detector = null;
  var stream = null;
  var rafId = null;
  var scanning = false;
  var opts = null;

  /** 这台装置有没有相机（页面不是 HTTPS 时浏览器不会给 mediaDevices） */
  function hasCamera() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** 浏览器能不能直接读一维条码 */
  function supportsBarcode() {
    return typeof window.BarcodeDetector === 'function';
  }

  /** 初始化 detector（呼叫端要在显示提示文字前先呼叫一次） */
  function init() {
    if (detector || !supportsBarcode()) return detector;
    try {
      detector = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] });
    } catch (e) {
      detector = null;
    }
    return detector;
  }

  /** 给呼叫端一句人话的支援说明 */
  function supportText() {
    if (!hasCamera()) {
      return '⚠️ 这台装置开不了相机（没有相机，或页面不是 HTTPS），' +
        '请用「手动输入」。<br>' +
        '<span class="muted-2">Camera unavailable — use manual entry.</span>';
    }
    return init()
      ? '✅ 可以扫一维条码（Code128）与 QR。'
      : 'ℹ️ 这台装置的浏览器不支援一维条码扫描（iOS Safari 就是这样），' +
        '请顾客出示条码<b>下方的 QR</b> 给你扫。';
  }

  function start(o) {
    opts = o || {};
    if (scanning) return;
    if (!hasCamera()) {
      if (opts.onError) opts.onError('NO_CAMERA');
      return;
    }
    init();

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        opts.video.srcObject = s;
        opts.video.setAttribute('playsinline', 'true');
        return opts.video.play();
      })
      .then(function () {
        scanning = true;
        if (opts.onStart) opts.onStart(!!detector);
        tick();
      })
      .catch(function () {
        if (opts.onError) opts.onError('CAMERA_DENIED');
        stop();
      });
  }

  function stop() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (opts && opts.video) opts.video.srcObject = null;
    if (opts && opts.onStop) opts.onStop();
  }

  function tick() {
    if (!scanning) return;
    var video = opts.video;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      var w = 480;
      var h = Math.round(video.videoHeight * (w / video.videoWidth)) || 360;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);

      if (detector) {
        detector.detect(canvas).then(function (codes) {
          if (codes && codes.length && scanning) handleCode(codes[0].rawValue);
        }).catch(function () { /* 这一帧读不到就算了 */ });
      } else if (window.jsQR) {
        var img = ctx.getImageData(0, 0, w, h);
        var qr = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data && scanning) handleCode(qr.data);
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  function handleCode(text) {
    if (!text) return;
    stop();
    if (opts && opts.onCode) opts.onCode(String(text).trim());
  }

  return {
    hasCamera: hasCamera,
    supportsBarcode: supportsBarcode,
    supportText: supportText,
    init: init,
    start: start,
    stop: stop,
    isScanning: function () { return scanning; }
  };

})();
