/* =============================================================
   YETIPSY — claim.js
   -------------------------------------------------------------
   Claim 流程（QR / Code）
   页面状态：loading → order / entry → result
   ============================================================= */

var CLAIM = (function () {

  var state = {
    token: '',
    code: '',
    claim: null,
    claimed: null
  };

  var el = {};

  function show(id) {
    ['stateLoading', 'stateOrder', 'stateResult', 'stateEntry'].forEach(function (k) {
      if (el[k]) el[k].style.display = (k === id ? 'block' : 'none');
    });
  }

  function init() {
    el.stateLoading = document.getElementById('stateLoading');
    el.stateOrder   = document.getElementById('stateOrder');
    el.stateResult  = document.getElementById('stateResult');
    el.stateEntry   = document.getElementById('stateEntry');

    el.orderAmount  = document.getElementById('orderAmount');
    el.orderMeta    = document.getElementById('orderMeta');
    el.claimBtn     = document.getElementById('claimBtn');
    el.codeInput    = document.getElementById('codeInput');
    el.codeBtn      = document.getElementById('codeBtn');
    el.scanBtn      = document.getElementById('scanBtn');

    document.getElementById('scanIcon').innerHTML = UI.icon('scan', 20);

    el.claimBtn.addEventListener('click', doClaim);
    el.codeBtn.addEventListener('click', submitCode);
    el.scanBtn.addEventListener('click', SCANNER.open);

    el.codeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitCode();
    });

    var token = UI.getParam('token');
    if (token) {
      state.token = token;
      loadClaimByToken(token);
    } else {
      show('stateEntry');
    }
  }

  /* ---------------------------------------------------------
     由 QR 进入：读取 claim
     --------------------------------------------------------- */
  function loadClaimByToken(token) {
    API.customer.getClaimByToken(token).then(function (res) { afterClaimLoad(res, token); });
  }

  function afterClaimLoad(res, token) {
    if (!res.success) {
      if (!AUTH.handleSessionError(res.error)) {
        // 未登录 → 先登录再回来
        if (res.error.code === 'INVALID_SESSION' || res.error.code === 'UNAUTHORIZED') {
          AUTH.clearCustomer();
          location.replace('login.html?redirect=' +
            encodeURIComponent('claim.html?token=' + encodeURIComponent(token)));
          return;
        }
        showError(res.error);
      }
      return;
    }
    state.claim = res.data.claim;
    renderOrder();
  }

  function renderOrder() {
    var c = state.claim;
    el.orderAmount.textContent = UI.money(c.amount);
    el.orderMeta.innerHTML =
      (c.sourceLabel || c.source) + ' ORDER · #' + UI.esc(c.externalOrderId || c.orderId) +
      '<br><span class="tiny muted-2">' + UI.esc(c.createdAtText || '') + '</span>';
    show('stateOrder');
  }

  /* ---------------------------------------------------------
     Code 认领
     --------------------------------------------------------- */
  function submitCode() {
    var code = (el.codeInput.value || '').trim().toUpperCase();
    if (code.length < 4) {
      UI.toast('请输入 4–6 位 Claim Code / Enter the claim code', 'error');
      return;
    }
    UI.setLoading(el.codeBtn, true, 'CHECKING');
    API.customer.getClaimByCode(code).then(function (res) {
      UI.setLoading(el.codeBtn, false);
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.token = res.data.claim.token || '';
      state.code  = res.data.claim.claimCode || code;
      state.claim = res.data.claim;
      renderOrder();
    });
  }

  /* ---------------------------------------------------------
     执行认领
     --------------------------------------------------------- */
  function doClaim() {
    if (!state.token && !state.code) {
      UI.toast('缺少 Claim Token / Missing claim token', 'error');
      return;
    }
    UI.setLoading(el.claimBtn, true, 'CLAIMING');
    API.customer.claimOrder({ token: state.token || '', code: state.code || '' }).then(function (res) {
      UI.setLoading(el.claimBtn, false);
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      API.cache.clear();            // 积分 / 钱包 / 订单都变了
      renderResult(res.data);
    });
  }

  function renderResult(data) {
    state.claimed = data;
    document.getElementById('resultAmount').textContent = UI.money(data.amount);
    document.getElementById('resultPoints').textContent = '+' + UI.points(data.pointsEarned) + ' POINTS';

    if (data.reward && data.reward.rewardId) {
      document.getElementById('resultRewardBtn').style.display = 'block';
      document.getElementById('openRewardLink').href =
        'reward.html?rewardId=' + encodeURIComponent(data.reward.rewardId);
      document.getElementById('resultNote').innerHTML =
        '你的奖励已经准备好<br>Your reward is ready.';
    } else {
      document.getElementById('resultRewardBtn').style.display = 'none';
      document.getElementById('resultNote').innerHTML =
        '感谢你的支持<br>Thank you for the support.';
    }
    show('stateResult');
  }

  function showError(error) {
    el.stateLoading.innerHTML =
      '<div class="card order-card">' +
        '<div style="font-size:38px">✕</div>' +
        '<div class="bilingual-zh mt-12">' + UI.esc(error.message || error.code) + '</div>' +
        '<div class="bilingual-en">' + UI.esc(error.code || '') + '</div>' +
        '<a class="btn btn-secondary mt-16" href="claim.html">' +
          '<span>重新扫描<span class="btn-sub-label">TRY AGAIN</span></span></a>' +
      '</div>';
    show('stateLoading');
  }

  return { init: init };
})();


/* =============================================================
   SCANNER — 使用 jsQR 扫描员工 QR
   ============================================================= */
var SCANNER = (function () {

  var wrap, video, stream = null, rafId = null, running = false;

  function open() {
    if (running) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.toast('此浏览器不支持相机 / Camera not supported', 'error');
      return;
    }

    wrap = document.createElement('div');
    wrap.className = 'scanner-wrap';
    wrap.innerHTML =
      '<video class="scanner-video" playsinline muted autoplay></video>' +
      '<div class="scanner-frame"></div>' +
      '<div class="scanner-bottom">' +
        '<div class="scanner-title">扫描 YETIPSY CLAIM QR</div>' +
        '<div class="scanner-sub">把 QR 放进框内 · Put the QR inside the frame</div>' +
        '<button class="btn btn-ghost btn-sm mt-12" id="scannerClose">取消 CANCEL</button>' +
      '</div>';
    document.body.appendChild(wrap);

    video = wrap.querySelector('video');
    wrap.querySelector('#scannerClose').addEventListener('click', close);

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        video.setAttribute('playsinline', 'true');
        return video.play();
      })
      .then(function () {
        running = true;
        tick();
      })
      .catch(function (err) {
        UI.toast('无法使用相机 / Camera unavailable: ' + (err.name || ''), 'error');
        close();
      });
  }

  function tick() {
    if (!running) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      var canvas = document.createElement('canvas');
      var w = 400, h = Math.round(video.videoHeight * (w / video.videoWidth)) || 400;
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      var imageData = ctx.getImageData(0, 0, w, h);
      var code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        handleResult(code.data);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function handleResult(text) {
    var token = '';
    try {
      var url = new URL(text);
      token = url.searchParams.get('token') || '';
    } catch (e) {
      // 不是 URL，可能就是 token 本身
      token = (/^[A-Za-z0-9_\-]{20,}$/.test(text)) ? text : '';
    }
    close();
    if (token) {
      location.href = 'claim.html?token=' + encodeURIComponent(token);
    } else {
      UI.toast('这不是 YETIPSY QR / Not a Yetipsy QR', 'error');
    }
  }

  function close() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    wrap = null; video = null;
  }

  return { open: open, close: close };
})();
