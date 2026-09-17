/* =============================================================
   YETIPSY — app.js  (Customer Home)
   -------------------------------------------------------------
   客户主页只有一个画面：
     · 顶栏：品牌 · LIVE 状态 · 认领（右上角）
     · 活动幕布：会员问候 / 待领奖励 / 活动，左右滑动 + 自动轮播
     · 四个入口：下单 · 会员码 · 会员中心 · 我的订单

   刻意不在下面放任何其他入口：
     钱包 / 记录都收进「会员中心」，避免首页变成功能清单。
   ============================================================= */

var APP = (function () {

  var ROTATE_MS = 5200;

  var state = {
    profile: null,
    membership: null,
    pendingReward: null,
    slides: [],
    index: 0,
    promoError: null
  };

  var rotateTimer = null;
  var paused = false;

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */

  function greeting() {
    var hour = Number(new Date().toLocaleString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE, hour: '2-digit', hour12: false
    }));
    if (hour < 5)  return { zh: '夜深了', en: 'Late night' };
    if (hour < 12) return { zh: '早安', en: 'Good morning' };
    if (hour < 18) return { zh: '午安', en: 'Good afternoon' };
    return { zh: '晚上好', en: 'Good evening' };
  }

  function setIcon(id, name, size) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = UI.icon(name, size);
  }

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    setIcon('claimIcon',  'scan', 18);
    setIcon('tileMenu',   'menu', 30);
    setIcon('tileCode',   'scan', 30);
    setIcon('tileProfile','profile', 30);
    setIcon('tileOrders', 'orders', 30);

    renderConfigError();
    bindBanner();
    checkBackend();
    load();
  }

  /** API_URL 没配置 → 明确报错（正式环境不会出现） */
  function renderConfigError() {
    var box = document.getElementById('configError');
    if (!box) return;
    if (!YETIPSY_CONFIG.IS_MISCONFIGURED()) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="demo-banner" style="border-color:#E2696B;color:#E2696B">' +
      'BACKEND NOT CONFIGURED · 未配置后端<br>' +
      '<span class="tiny">请在 js/config.js 填入 API_URL（Google Apps Script Web App）</span></div>';
  }

  /** 显示目前连的是线上后端还是连不上（避免「以为在线上版，其实是没连上」） */
  function checkBackend() {
    var box = document.getElementById('connectionStatus');
    if (!box) return;
    if (YETIPSY_CONFIG.IS_MISCONFIGURED()) {
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

  /* ---------------------------------------------------------
     载入
     --------------------------------------------------------- */

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

      var rewardRes = results[1];
      state.pendingReward = (rewardRes.success && rewardRes.data && rewardRes.data.reward)
        ? rewardRes.data.reward : null;

      /* ★ 成功但清单是空的 ≠ 请求失败。
         以前两种情况都画「暂无活动」，后端出问题（例如线上还是旧版、
         没有 getPromotions 这个 action）时顾客看到的是「没有活动」，
         根本无从发现故障。现在失败会变成一张写清楚的错误幕布。 */
      var promoRes = results[2];
      if (promoRes.success) {
        state.promoError = null;
        state.slides = buildSlides(promoRes.data.promotions || []);
      } else {
        state.promoError = promoRes.error || {};
        state.slides = buildSlides([]);
        if (window.console && console.warn) {
          console.warn('[YETIPSY] getPromotions 失败：' +
            (state.promoError.code || '') + ' · ' + (state.promoError.message || ''));
        }
      }

      renderBanner();
      startRotate();
    });
  }

  /* ---------------------------------------------------------
     活动幕布
     --------------------------------------------------------- */

  function buildSlides(promotions) {
    var slides = [];

    /* ① 会员问候（一定在第一张，顾客一眼看到自己的名字与等级） */
    var g = greeting();
    var c = state.profile || {};
    slides.push({
      kind: 'greeting',
      zh: g.zh + '，' + (c.name || 'Friend'),
      en: g.en.toUpperCase() + ' · ' + UI.tierName(c.membershipTier),
      sub: UI.points(c.currentPoints) + ' POINTS · ' + UI.money(c.walletBalance) + ' WALLET',
      href: 'menu.html',
      cta: '开始点单 ORDER NOW'
    });

    /* ② 待领奖励（有才出现，放最前面才不会被漏掉） */
    if (state.pendingReward) {
      slides.splice(1, 0, {
        kind: 'reward',
        zh: '你的奖励已准备好',
        en: 'YOUR REWARD IS READY',
        sub: '点开领取 · TAP TO OPEN',
        href: 'reward.html?rewardId=' + encodeURIComponent(state.pendingReward.rewardId),
        cta: '领取 CLAIM'
      });
    }

    /* ③ 活动 */
    promotions.forEach(function (p) {
      slides.push({
        kind: 'promo',
        zh: p.title || '今晚活动',
        en: p.subtitle || 'TONIGHT',
        sub: p.description || '',
        date: (p.startDate || p.endDate)
          ? (p.startDate || '') + (p.endDate ? ' — ' + p.endDate : '')
          : '',
        href: 'menu.html',
        cta: '看酒单 VIEW MENU'
      });
    });

    return slides;
  }

  function renderBanner() {
    var track = document.getElementById('homeBannerTrack');
    var dots = document.getElementById('homeBannerDots');
    if (!track) return;

    var html = state.slides.map(function (s, i) {
      var inner =
        '<div class="hb-zh">' + UI.esc(s.zh) + '</div>' +
        '<div class="hb-en">' + UI.esc(s.en) + '</div>' +
        (s.sub ? '<div class="hb-sub">' + UI.esc(s.sub) + '</div>' : '') +
        (s.date ? '<div class="hb-date">' + UI.esc(s.date) + '</div>' : '') +
        (s.cta ? '<div class="hb-cta">' + UI.esc(s.cta) + ' ›</div>' : '');

      return '<a class="hb-slide hb-' + UI.esc(s.kind) + '" href="' + UI.esc(s.href) +
        '" data-slide="' + i + '">' + inner + '</a>';
    }).join('');

    /* 活动载入失败 → 换成一张写清楚的错误幕布（顾客/员工都看得出来） */
    if (state.promoError) {
      var e = state.promoError;
      html += '<div class="hb-slide hb-error">' +
        '<div class="hb-zh" style="color:#E2696B">活动载入失败</div>' +
        '<div class="hb-en">PROMOTIONS FAILED TO LOAD</div>' +
        '<div class="hb-sub">' + UI.esc(e.code || 'ERROR') + '<br>' + UI.esc(e.message || '') + '</div>' +
        '<button class="btn btn-secondary btn-sm hb-retry" id="promoRetryBtn">' +
          '<span>重试<span class="btn-sub-label">RETRY</span></span></button>' +
        '</div>';
    }

    track.innerHTML = html;

    if (dots) {
      dots.innerHTML = state.slides.length > 1
        ? state.slides.map(function (s, i) {
            return '<span class="hb-dot' + (i === 0 ? ' active' : '') + '" data-dot="' + i + '"></span>';
          }).join('')
        : '';
      Array.prototype.forEach.call(dots.querySelectorAll('[data-dot]'), function (dot) {
        dot.addEventListener('click', function () {
          goTo(Number(dot.getAttribute('data-dot')));
        });
      });
    }

    var retry = document.getElementById('promoRetryBtn');
    if (retry) retry.addEventListener('click', function () { load(); });

    state.index = 0;
    track.scrollLeft = 0;
  }

  function slideCount() {
    var track = document.getElementById('homeBannerTrack');
    return track ? track.children.length : 0;
  }

  function goTo(i) {
    var track = document.getElementById('homeBannerTrack');
    if (!track) return;
    var count = slideCount();
    if (count < 1) return;
    if (i >= count) i = 0;
    if (i < 0) i = count - 1;
    state.index = i;
    track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
    syncDots();
  }

  function syncDots() {
    var dots = document.getElementById('homeBannerDots');
    if (!dots) return;
    Array.prototype.forEach.call(dots.querySelectorAll('.hb-dot'), function (dot, i) {
      dot.className = 'hb-dot' + (i === state.index ? ' active' : '');
    });
  }

  function bindBanner() {
    var track = document.getElementById('homeBannerTrack');
    if (!track) return;

    var scrollTimer = null;
    track.addEventListener('scroll', function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        if (!track.clientWidth) return;
        var i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== state.index) { state.index = i; syncDots(); }
      }, 90);
    }, { passive: true });

    /* 顾客在滑的时候不要抢着换页；手放开 6 秒后才恢复自动轮播 */
    ['pointerdown', 'touchstart'].forEach(function (ev) {
      track.addEventListener(ev, function () { paused = true; }, { passive: true });
    });
    ['pointerup', 'touchend', 'pointercancel', 'touchcancel'].forEach(function (ev) {
      track.addEventListener(ev, function () {
        setTimeout(function () { paused = false; }, 6000);
      }, { passive: true });
    });

    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
    });
  }

  function startRotate() {
    if (rotateTimer) clearInterval(rotateTimer);
    if (slideCount() < 2) return;
    rotateTimer = setInterval(function () {
      if (paused || document.hidden) return;
      goTo(state.index + 1);
    }, ROTATE_MS);
  }

  return {
    init: init,
    reload: load,
    state: state
  };
})();
