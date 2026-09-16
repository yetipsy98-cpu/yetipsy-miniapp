/* =============================================================
   YETIPSY — reward.js
   -------------------------------------------------------------
   Reward 只能由后端产生：
     后端 validate → 产生 reward → 前端只负责动画
   本文件不参与任何金额计算。
   ============================================================= */

var REWARD = (function () {

  var state = { reward: null, opened: false };

  function show(id) {
    ['stateLoading', 'stateClosed', 'stateOpened', 'stateError'].forEach(function (k) {
      var node = document.getElementById(k);
      if (node) node.style.display = (k === id ? 'block' : 'none');
    });
  }

  function init() {
    if (!AUTH.isCustomerLoggedIn()) {
      AUTH.requireCustomer();
      return;
    }

    document.getElementById('envelope').addEventListener('click', openReward);

    var rewardId = UI.getParam('rewardId') || '';

    API.customer.getPendingReward(rewardId).then(function (res) {
      if (!res.success) {
        if (!AUTH.handleSessionError(res.error)) showError(res.error);
        return;
      }
      var reward = res.data.reward;
      if (!reward) {
        showError({ code: 'REWARD_NOT_FOUND', message: '目前没有可开启的奖励 / No reward available right now.' });
        return;
      }
      state.reward = reward;
      var meta = document.getElementById('closedMeta');
      meta.innerHTML = reward.orderInfo
        ? UI.esc(reward.orderInfo.amountText || '') + ' · ' + UI.esc(reward.orderInfo.externalOrderId || '')
        : '';
      show('stateClosed');
    });
  }

  function openReward() {
    if (state.opened) return;
    state.opened = true;

    var env = document.getElementById('envelope');
    env.classList.remove('shake');
    env.style.transition = 'transform .35s ease, opacity .35s ease';
    env.style.transform = 'scale(.9)';
    env.style.opacity = '0';

    setTimeout(function () {
      UI.showLoading('OPENING');
      API.customer.claimReward(state.reward.rewardId).then(function (res) {
        UI.hideLoading();
        if (!res.success) {
          state.opened = false;
          env.style.transform = 'scale(1)';
          env.style.opacity = '1';
          env.classList.add('shake');
          if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
          return;
        }
        renderOpened(res.data);
      });
    }, 320);
  }

  function renderOpened(data) {
    document.getElementById('rewardAmount').textContent = UI.money(data.amount);
    document.getElementById('walletAfter').textContent  = UI.money(data.walletBalance);
    show('stateOpened');
    confetti();
    if (navigator.vibrate) { try { navigator.vibrate([18, 40, 26]); } catch (e) {} }
  }

  function confetti() {
    var box = document.createElement('div');
    box.className = 'confetti';
    document.body.appendChild(box);
    var colors = ['#E5B769', '#F4F1EA', '#C9A227', '#A7A7A7', '#8B6F3A'];
    for (var i = 0; i < 60; i++) {
      var s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
      s.style.animationDelay = (Math.random() * 0.5) + 's';
      s.style.height = (8 + Math.random() * 8) + 'px';
      s.style.opacity = String(0.5 + Math.random() * 0.5);
      box.appendChild(s);
    }
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3600);
  }

  function showError(error) {
    document.getElementById('stateError').innerHTML =
      '<div class="card order-card">' +
        '<div style="font-size:38px">✕</div>' +
        '<div class="bilingual-zh mt-12">' + UI.esc(error.message || '') + '</div>' +
        '<div class="bilingual-en">' + UI.esc(error.code || '') + '</div>' +
        '<a class="btn btn-secondary mt-16" href="index.html">' +
          '<span>返回首页<span class="btn-sub-label">BACK TO HOME</span></span></a>' +
      '</div>';
    show('stateError');
  }

  return { init: init };
})();
