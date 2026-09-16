/* =============================================================
   YETIPSY — app.js  (Customer Home)
   ============================================================= */

var APP = (function () {

  var state = {
    profile: null,
    membership: null,
    promotions: [],
    pendingReward: null
  };

  function greeting() {
    var hour = Number(new Date().toLocaleString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE, hour: '2-digit', hour12: false
    }));
    if (hour < 5)  return { zh: '夜深了', en: 'Late night' };
    if (hour < 12) return { zh: '早安', en: 'Good morning' };
    if (hour < 18) return { zh: '午安', en: 'Good afternoon' };
    return { zh: '晚上好', en: 'Good evening' };
  }

  function init() {
    if (YETIPSY_CONFIG.IS_DEMO()) {
      document.getElementById('demoBanner').innerHTML =
        '<div class="demo-banner">DEMO MODE · 演示模式 · 数据保存在本地</div>';
    }

    // icons
    document.getElementById('claimIcon').innerHTML = UI.icon('scan', 24);
    document.getElementById('qiScan').innerHTML    = UI.icon('scan', 20);
    document.getElementById('qiAct').innerHTML     = UI.icon('activity', 20);
    document.getElementById('qiWallet').innerHTML  = UI.icon('wallet', 20);
    document.getElementById('qiProfile').innerHTML = UI.icon('profile', 20);

    var g = greeting();
    document.getElementById('greeting').innerHTML =
      g.zh + '，<b>' + UI.esc(state.profileName || '') + '</b> · ' + g.en;

    load();
  }

  function load() {
    return Promise.all([
      API.customer.getProfile(),
      API.customer.getPendingReward(),
      API.customer.getPromotions()
    ]).then(function (results) {
      var profileRes = results[0];

      if (!profileRes.success) {
        if (!AUTH.handleSessionError(profileRes.error)) {
          UI.toast(profileRes.error.message, 'error');
        }
        return;
      }

      state.profile = profileRes.data.customer;
      state.membership = profileRes.data.membership;
      renderHero();

      // pending reward
      var rewardRes = results[1];
      if (rewardRes.success && rewardRes.data && rewardRes.data.reward) {
        state.pendingReward = rewardRes.data.reward;
        renderPendingReward();
      }

      // promotions
      var promoRes = results[2];
      if (promoRes.success) renderPromotions(promoRes.data.promotions || []);
      else document.getElementById('promoList').innerHTML =
        UI.emptyState('暂无活动', 'NO PROMOTION RIGHT NOW', 'activity');
    });
  }

  function renderHero() {
    var c = state.profile;
    var m = state.membership || {};

    var g = greeting();
    document.getElementById('greeting').innerHTML =
      g.zh + '，<b>' + UI.esc(c.name || 'Friend') + '</b>';
    document.getElementById('tierBadge').innerHTML = UI.tierBadge(c.membershipTier);
    document.getElementById('pointsValue').textContent = UI.points(c.currentPoints);

    document.getElementById('walletValue').textContent = UI.money(c.walletBalance);
    document.getElementById('spendValue').textContent  = UI.money(c.totalSpend);
    document.getElementById('visitsSub').textContent   =
      (c.totalVisits || 0) + ' visits 到店次数';

    // progress
    var pct = m.progressPercent || 0;
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressText').textContent =
      UI.tierName(c.membershipTier) + ' · ' + UI.points(c.currentPoints) + ' PTS';
    document.getElementById('progressNext').textContent =
      m.nextTier
        ? UI.points(m.pointsToNext) + ' PTS TO ' + m.nextTier
        : 'TOP TIER 最高等级';
  }

  function renderPendingReward() {
    var r = state.pendingReward;
    if (!r) {
      document.getElementById('pendingRewardBox').innerHTML = '';
      return;
    }
    document.getElementById('pendingRewardBox').innerHTML =
      '<div class="section">' +
        '<a class="card gold" href="reward.html?rewardId=' + encodeURIComponent(r.rewardId) + '" style="display:block">' +
          '<div class="row-between">' +
            '<div>' +
              '<div class="bilingual-zh">你的奖励已准备好</div>' +
              '<div class="bilingual-en">YOUR REWARD IS READY</div>' +
              '<div class="small muted" style="margin-top:8px">点击打开 · Tap to open</div>' +
            '</div>' +
            '<div style="color:var(--gold);font-size:26px">🎁</div>' +
          '</div>' +
        '</a>' +
      '</div>';
  }

  function renderPromotions(list) {
    var box = document.getElementById('promoList');
    if (!list.length) {
      box.innerHTML = UI.emptyState('暂无活动', 'NO PROMOTION RIGHT NOW', 'activity');
      return;
    }
    box.innerHTML = list.map(function (p) {
      return '<div class="promo">' +
        '<div class="promo-title">' + UI.esc(p.title) + '</div>' +
        (p.subtitle ? '<div class="promo-sub">' + UI.esc(p.subtitle) + '</div>' : '') +
        (p.description ? '<div class="promo-desc">' + UI.esc(p.description) + '</div>' : '') +
        ((p.startDate || p.endDate)
          ? '<div class="promo-date">' + UI.esc(p.startDate || '') +
            (p.endDate ? ' — ' + UI.esc(p.endDate) : '') + '</div>'
          : '') +
        '</div>';
    }).join('');
  }

  return {
    init: init,
    reload: load,
    state: state
  };
})();
