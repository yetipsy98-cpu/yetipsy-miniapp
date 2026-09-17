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

  /** 图标渲染：元素不存在就安静跳过（导览界面区块可能被调整过） */
  function setIcon(id, name, size) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = UI.icon(name, size);
  }

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    if (YETIPSY_CONFIG.IS_MISCONFIGURED && YETIPSY_CONFIG.IS_MISCONFIGURED()) {
      document.getElementById('demoBanner').innerHTML =
        '<div class="demo-banner" style="border-color:#E2696B;color:#E2696B">' +
        'BACKEND NOT CONFIGURED · 未配置后端<br>' +
        '<span class="tiny">请在 js/config.js 填入 API_URL（Google Apps Script Web App）</span></div>';
    } else if (YETIPSY_CONFIG.IS_DEMO()) {
      document.getElementById('demoBanner').innerHTML =
        '<div class="demo-banner">DEMO MODE · 演示模式 · 数据保存在本地</div>';
    }

    // icons
    /* ★ 认领入口已移到右上角，导览界面三张卡 + 下方的「其他」 */
    setIcon('claimIcon',  'scan', 18);
    setIcon('navMenu',    'menu', 26);
    setIcon('navCode',    'scan', 26);
    setIcon('navProfile', 'profile', 26);
    setIcon('qiOrders',   'orders', 20);
    setIcon('qiAct',      'activity', 20);
    setIcon('qiWallet',   'wallet', 20);
    setIcon('qiProfile',  'profile', 20);

    var g = greeting();
    document.getElementById('greeting').innerHTML = g.zh + ' · ' + g.en;

    checkBackend();
    load();
  }

  /** 显示目前连的是线上后端还是连不上（避免「以为在线上版，其实是 demo」） */
  function checkBackend() {
    var box = document.getElementById('connectionStatus');
    if (!box) return;
    if (YETIPSY_CONFIG.IS_MISCONFIGURED && YETIPSY_CONFIG.IS_MISCONFIGURED()) {
      box.textContent = '● NO BACKEND';
      box.style.color = '#E2696B';
      return;
    }
    box.textContent = '● …';
    API.system.ping().then(function (res) {
      if (res.success && res.data && res.data.mode === 'PRODUCTION') {
        box.textContent = '● LIVE';
        box.style.color = 'var(--ok)';
      } else if (res.success) {
        box.textContent = '● ' + (res.data.mode || 'ONLINE');
        box.style.color = 'var(--muted-2)';
      } else {
        box.textContent = '● OFFLINE';
        box.style.color = '#E2696B';
      }
    });
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
      /* ★ 成功但清单是空的 ≠ 请求失败。
         以前两种情况都画「暂无活动」，结果后端出问题（例如线上还是旧版、
         没有 getPromotions 这个 action）时，顾客看到的是「没有活动」，
         根本无从发现故障。现在失败要大声讲出来，并给重试钮。 */
      var promoRes = results[2];
      if (promoRes.success) {
        renderPromotions(promoRes.data.promotions || []);
      } else {
        renderPromotionsError(promoRes.error || {});
      }
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

  /** 活动载入失败 —— 要跟「真的没有活动」长得完全不一样 */
  function renderPromotionsError(error) {
    var box = document.getElementById('promoList');
    var code = error.code || 'ERROR';
    box.innerHTML =
      '<div class="empty-state" style="border:1px solid #E2696B;border-radius:14px;padding:16px 14px">' +
        '<div class="empty-zh" style="color:#E2696B">活动载入失败</div>' +
        '<div class="empty-en">PROMOTIONS FAILED TO LOAD</div>' +
        '<div class="tiny muted-2" style="margin-top:10px;line-height:1.7">' +
          UI.esc(code) + '<br>' + UI.esc(error.message || '') +
        '</div>' +
        '<button id="promoRetryBtn" class="btn btn-secondary btn-sm" style="margin-top:12px">' +
          '<span>重试<span class="btn-sub-label">RETRY</span></span>' +
        '</button>' +
      '</div>';

    var retry = document.getElementById('promoRetryBtn');
    if (retry) retry.addEventListener('click', function () { load(); });

    /* 给开发者/店员看的线索：把错误码留在 console */
    if (window.console && console.warn) {
      console.warn('[YETIPSY] getPromotions 失败：' + code + ' · ' + (error.message || ''));
    }
  }

  function renderPromotions(list) {
    var box = document.getElementById('promoList');
    if (!list.length) {
      box.innerHTML = UI.emptyState('暂无活动', 'NO PROMOTION RIGHT NOW', 'activity') +
        '<div class="tiny muted-2 center" style="margin-top:8px">' +
        '员工端 SETTINGS → Promotions 可以新增活动' +
        '</div>';
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
