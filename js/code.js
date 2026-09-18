/* =============================================================
   YETIPSY — code.js（会员端 · 会员条码）
   -------------------------------------------------------------
   顾客出示 → 员工扫描 → 确认是本人 → 才允许抵扣钱包。

   · 条码内容来自后端 getMemberCode（每 N 秒换一条，扫过即失效）
   · 画 Code128 一维条码（JsBarcode）+ 同内容的 QR（给不支援
     BarcodeDetector 的装置扫，例如 iOS Safari）

   ★ 载入体验（顾客要求的）：
     - 不用全屏 loading 遮罩（以前每次换码都用转圈把画好的条码盖住，
       线上后端慢的时候要转好几秒，看起来像「生成好了还在转」）
     - 第一次：只在条码区显示占位骨架
     - 换码时：**保留旧条码**，只在下面加一行「更新中」小字
     - 新码回来 → 直接覆盖，不闪、不清空
     - 在剩 30% 时间时就先偷偷抓下一条，换码几乎没有空窗
   ============================================================= */

var CODE = (function () {

  var timerId = null;
  var secondsLeft = 0;
  var ttl = 60;
  var hasCode = false;      // 画面上有没有一条可用的条码
  var fetching = false;     // 避免同时发两次请求
  var lastPayload = '';

  function init() {
    if (!AUTH.requireCustomer()) return;

    document.getElementById('refreshBtn').addEventListener('click', function () {
      load(true);
    });

    /* 画面被切到背景就停止倒数；回来时换一条（旧的大概率已经过期） */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopTimer();
      } else if (!fetching) {
        load(true);
      }
    });

    load(false);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function setHint(text) {
    var el = document.getElementById('codeHint');
    if (el) el.textContent = text || '';
  }

  /**
   * @param {boolean} isRefresh 换码（画面上已有一条）还是第一次载入
   */
  function load(isRefresh) {
    if (fetching) return;
    fetching = true;

    if (hasCode) {
      /* 保留旧条码，只加一行小字 —— 不用全屏遮罩盖住画面 */
      setHint('更新中… UPDATING');
    } else {
      /* 2.1.17：条码一定要问后端（一次性密语，不能快取），
         但上面的会员资料可以先吃快取 → 一打开就有名字 / 等级 / 积分，
         不用整页等条码。 */
      paintFromCache();
      renderPending();
    }

    API.customer.getMemberCode().then(function (res) {
      fetching = false;
      if (!res.success) {
        if (AUTH.handleSessionError(res.error)) return;
        renderError(res.error || {});
        return;
      }
      render(res.data);          // 直接覆盖，不清空、不闪
    });
  }

  /* ---------------- 画面 ---------------- */

  /**
   * 先用快取把会员资料画出来（等级 / 名字 / 积分 / 钱包）。
   * 资料来自预载清单里的 getProfile / getPoints / getWallet，
   * 所以通常一打开就是现成的。
   */
  function paintFromCache() {
    try {
      var peek = API.cache && API.cache.peek;
      if (!peek) return;
      var prof = API.cache.peek('getProfile', {});
      var pts  = API.cache.peek('getPoints', {});
      var wall = API.cache.peek('getWallet', {});
      var c = (prof && prof.customer) || null;
      var m = (pts && pts.membership) || (prof && prof.membership) || null;
      if (!c && !pts && !wall) return;
      setText('memberName', c ? (c.name || 'MEMBER') : null);
      setText('memberId', c ? c.customerId : null);
      setText('memberMeta',
        UI.points((pts && pts.currentPoints) || (c && c.currentPoints) || 0) + ' PTS · ' +
        UI.money((wall && wall.balance) || (c && c.walletBalance) || 0) + ' WALLET');
      setText('codeHint', '条码产生中… GENERATING CODE');
    } catch (e) {}
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = value;
  }

  /** 第一次载入：只在条码区放占位骨架，不动其他东西 */
  function renderPending() {
    document.getElementById('barcodeBox').innerHTML =
      '<div class="code-skeleton" aria-label="产生条码中"></div>' +
      '<div class="code-pending-text">产生条码中… GENERATING</div>';
    document.getElementById('qrBox').innerHTML =
      '<div class="code-skeleton code-skeleton-qr"></div>';
    document.getElementById('codeTimer').textContent = '— · LOADING';
  }

  /** 载入失败：讯息显示在条码区，并给重试钮（不用 toast + 遮罩） */
  function renderError(error) {
    var code = error.code || 'ERROR';
    document.getElementById('barcodeBox').innerHTML =
      '<div class="code-error">' +
        '<div class="code-error-zh">条码产生失败</div>' +
        '<div class="code-error-en">CODE FAILED</div>' +
        '<div class="code-error-code">' + UI.esc(code) + '</div>' +
        '<button id="codeRetryBtn" class="code-retry" type="button">重试 RETRY</button>' +
      '</div>';
    document.getElementById('qrBox').innerHTML = '';
    document.getElementById('codeTimer').textContent = '— · FAILED';
    setHint('');
    hasCode = false;
    stopTimer();

    var retry = document.getElementById('codeRetryBtn');
    if (retry) retry.addEventListener('click', function () { load(false); });
    if (window.console && console.warn) {
      console.warn('[YETIPSY] getMemberCode 失败：' + code + ' · ' + (error.message || ''));
    }
  }

  function render(d) {
    ttl = Number(d.seconds) || 60;
    secondsLeft = ttl;
    lastPayload = d.payload;
    hasCode = true;

    /* 恢复结构（第一次载入时 barcodeBox 被换成骨架了） */
    ensureStructure();

    document.getElementById('ttlText').textContent = ttl;
    document.getElementById('memberName').textContent = d.displayName || 'MEMBER';
    document.getElementById('memberId').textContent = d.customerId;
    document.getElementById('memberMeta').textContent =
      UI.points(d.currentPoints) + ' PTS · ' + UI.money(d.walletBalance) + ' WALLET';

    drawBarcode(d.payload);
    UI.renderQR(document.getElementById('qrBox'), d.payload, 118);

    setHint('');
    paintTimer();

    stopTimer();
    timerId = setInterval(tick, 1000);
  }

  /** renderPending 会换掉 barcodeBox 的内容，这里把 <svg id="barcode"> 放回去 */
  function ensureStructure() {
    var box = document.getElementById('barcodeBox');
    if (!document.getElementById('barcode')) {
      box.innerHTML = '<svg id="barcode"></svg>';
    }
  }

  function tick() {
    secondsLeft--;

    /* 剩 30% 时就先抓下一条：换码时几乎没有空窗，
       也不会出现「旧的过期了、新的还没来」的空档 */
    if (!fetching && secondsLeft <= Math.ceil(ttl * 0.3) && secondsLeft > 0) {
      load(true);
      return;
    }
    if (secondsLeft <= 0) {
      if (!fetching) load(true);
      secondsLeft = 1;           // 停在 1 秒，不要出现负数
    }
    paintTimer();
  }

  function paintTimer() {
    var el = document.getElementById('codeTimer');
    el.textContent = secondsLeft + ' 秒后更换 · REFRESHES IN ' + secondsLeft + 'S';
    el.style.color = secondsLeft <= 10 ? '#B4472F' : '#8A6B2F';
  }

  /* Code128 一维条码。JsBarcode 直接画进 <svg>（重复呼叫会覆盖） */
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

  /* 给测试用：确认画面上一直是同一条还是已经换过了 */
  function debugState() {
    return { hasCode: hasCode, fetching: fetching, payload: lastPayload, left: secondsLeft };
  }

  return { init: init, load: load, debugState: debugState };
})();

CODE.init();
