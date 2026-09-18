/* =============================================================
   YETIPSY — app.js  (Customer Home)
   -------------------------------------------------------------
   客户主页只有一个画面：

     · 顶栏：品牌 · LIVE 状态 · 认领（右上角）
     · 活动幕布：会员卡 / 待领奖励 / 活动，左右滑动 + 自动轮播
     · 四个入口：下单 · 会员码 · 会员中心 · 我的订单

   刻意不在下面放任何其他入口：
     钱包 / 记录都收进「会员中心」，避免首页变成功能清单。
   会员卡（积分 / 钱包 / 到店）放在幕布第一张，一眼看到但不多占版面。
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

  /* 幕布上的装饰：鸡尾酒杯（纯装饰，不含资料） */
  var ART_GLASS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 4h16l-8 8z"/><path d="M12 12v6"/><path d="M8.5 20h7"/>' +
    '<path d="M6.4 6.6h11.2"/></svg>';

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

    setIcon('claimIcon',  'scan', 15);
    setIcon('tileMenu',   'menu', 22);
    setIcon('tileCode',   'scan', 22);
    setIcon('tileProfile','profile', 22);
    setIcon('tileOrders', 'orders', 22);

    renderConfigError();
    bindBanner();
    checkBackend();
    load();
    prefetch();
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
      box.className = 'live-pill off';
      return;
    }
    box.textContent = '● …';
    box.className = 'live-pill';
    API.system.ping().then(function (res) {
      if (res.success && res.data && res.data.mode === 'PRODUCTION') {
        box.textContent = '● LIVE';
        box.className = 'live-pill on';
      } else if (res.success) {
        box.textContent = '● ' + (res.data.mode || 'ONLINE');
        box.className = 'live-pill';
      } else {
        box.textContent = '● OFFLINE';
        box.className = 'live-pill off';
      }
    });
  }

  /* ---------------------------------------------------------
     载入
     --------------------------------------------------------- */

  /**
   * ① 先画快取（有的话立刻有画面）② 后端回来再画一次。
   * API 层的 live call 会回两次，所以这里每个 .then 都要是幂等的。
   */
  function load() {
    /* 2.1.17：不再等三支都回来才画。
       任何一支先到就先画一次（快取通常 0 毫秒），后面的到了再补一次，
       所以顾客打开首页是「马上有画面」而不是「先看骨架」。 */
    var painted = false;
    function paint() {
      try {
        if (!state.profile && !state.slides.length) return;   // 什么都还没有 → 再等一下
        renderBanner();
        startRotate();
        painted = true;
      } catch (e) {}
    }

    /* 先用快取画的（有的话） */
    var cachedProfile = API.cache && API.cache.peek ? API.cache.peek('getProfile', {}) : null;
    if (cachedProfile && cachedProfile.customer) {
      state.profile = cachedProfile.customer;
      state.membership = cachedProfile.membership;
    }
    var cachedReward = API.cache && API.cache.peek ? API.cache.peek('getPendingReward', { rewardId: '' }) : null;
    if (cachedReward && cachedReward.reward) state.pendingReward = cachedReward.reward;
    var cachedPromo = API.cache && API.cache.peek ? API.cache.peek('getPromotions', {}) : null;
    if (cachedPromo) state.slides = buildSlides(cachedPromo.promotions || []);
    paint();

    API.customer.getProfile().then(function (res) {
      if (!res.success) {
        if (!pending.failed) {
          pending.failed = true;
          if (!AUTH.handleSessionError(res.error)) UI.toast(res.error.message, 'error');
        }
        return;
      }
      state.profile = res.data.customer;
      state.membership = res.data.membership;
      paint();
    });

    API.customer.getPendingReward().then(function (res) {
      state.pendingReward = (res.success && res.data && res.data.reward) ? res.data.reward : null;
      paint();
    });

    /* ★ 成功但清单是空的 ≠ 请求失败。
       以前两种情况都画「暂无活动」，后端出问题（例如线上还是旧版、
       没有 getPromotions 这个 action）时顾客看到的是「没有活动」，
       根本无从发现故障。现在失败会变成一张写清楚的错误幕布。 */
    API.customer.getPromotions().then(function (res) {
      if (res.success) {
        state.promoError = null;
        state.slides = buildSlides(res.data.promotions || []);
      } else {
        state.promoError = res.error || {};
        state.slides = buildSlides([]);
        if (window.console && console.warn) {
          console.warn('[YETIPSY] getPromotions 失败：' +
            (state.promoError.code || '') + ' · ' + (state.promoError.message || ''));
        }
      }
      if (painted && !state.profile) return;      // 还没有会员资料 → 上面那支回来才画
      paint();
    });
  }

  /**
   * 预载：首页是顾客第一个到的页面，趁它载完把酒单 / 订单 / 钱包
   * 先在背景抓好（只读写入快取）。这样点「下单」是立刻出来，
   * 不是「再等一次载入」。失败也不影响首页。
   */
  function prefetch() {
    try {
      var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 400); };
      idle(function () {
        /* 2.1.17：整个会员端要用的资料一次预载好（酒单 / 订单 / 钱包 /
           记录 / 待领奖励 / 会员资料 / 活动），点任何一页都不用等 */
        if (API.cache && API.cache.autoWarm) API.cache.autoWarm();
        else if (API.cache && API.cache.prefetch) API.cache.prefetch();
      });
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     活动幕布
     --------------------------------------------------------- */

  function stat(value, label) {
    return '<span class="hb-stat"><b>' + UI.esc(value) + '</b><i>' + UI.esc(label) + '</i></span>';
  }

  function buildSlides(promotions) {
    var slides = [];
    var c = state.profile || {};
    var g = greeting();

    /* ① 会员卡（一定在第一张）：问候 + 积分 / 钱包 / 到店 */
    slides.push({
      kind: 'greeting',
      eyebrow: g.zh + ' · ' + g.en.toUpperCase() + ' · ' + UI.tierName(c.membershipTier),
      zh: c.name || 'Friend',
      art: ART_GLASS,
      stats: [
        stat(UI.points(c.currentPoints), 'POINTS 积分'),
        stat(UI.money(c.walletBalance), 'WALLET 钱包'),
        stat(c.totalVisits || 0, 'VISITS 到店')
      ],
      href: 'menu.html',
      cta: '开始点单 ORDER NOW'
    });

    /* ② 待领奖励（有才出现，放最前面才不会被漏掉） */
    if (state.pendingReward) {
      slides.splice(1, 0, {
        kind: 'reward',
        eyebrow: 'REWARD · 奖励已准备好',
        zh: UI.money(state.pendingReward.rewardAmount || state.pendingReward.amount || 0),
        sub: '点开领取，金额进入钱包',
        art: ART_GLASS,
        href: 'reward.html?rewardId=' + encodeURIComponent(state.pendingReward.rewardId),
        cta: '领取 CLAIM'
      });
    }

    /* ③ 活动 */
    promotions.forEach(function (p) {
      var when = '';
      if (p.startDate || p.endDate) {
        when = (p.startDate || '') + (p.endDate ? ' — ' + p.endDate : '');
      }
      slides.push({
        kind: 'promo',
        eyebrow: 'PROMOTION · ' + (p.subtitle || 'TONIGHT'),
        zh: p.title || '今晚活动',
        sub: p.description || '',
        date: when,
        art: ART_GLASS,
        href: 'menu.html',
        cta: '看酒单 VIEW MENU'
      });
    });

    return slides;
  }

  function slideHtml(s, i) {
    var inner =
      '<span class="hb-art">' + (s.art || '') + '</span>' +
      '<span class="hb-eyebrow">' + UI.esc(s.eyebrow || '') + '</span>' +
      '<span class="hb-zh">' + UI.esc(s.zh || '') + '</span>' +
      (s.sub ? '<span class="hb-sub">' + UI.esc(s.sub) + '</span>' : '') +
      (s.stats && s.stats.length ? '<span class="hb-stats">' + s.stats.join('') + '</span>' : '') +
      (s.date ? '<span class="hb-date">' + UI.esc(s.date) + '</span>' : '') +
      (s.cta ? '<span class="hb-cta">' + UI.esc(s.cta) + ' ›</span>' : '');

    return '<a class="hb-slide hb-' + UI.esc(s.kind) + '" href="' + UI.esc(s.href) +
      '" data-slide="' + i + '">' + inner + '</a>';
  }

  function renderBanner() {
    var track = document.getElementById('homeBannerTrack');
    var dots = document.getElementById('homeBannerDots');
    if (!track) return;

    var html = state.slides.map(slideHtml).join('');

    /* 活动载入失败 → 换成一张写清楚的错误幕布（顾客/员工都看得出来） */
    if (state.promoError) {
      var e = state.promoError;
      html += '<div class="hb-slide hb-error">' +
        '<span class="hb-eyebrow" style="color:#E2696B">活动载入失败</span>' +
        '<span class="hb-zh" style="font-size:16px">PROMOTIONS FAILED TO LOAD</span>' +
        '<span class="hb-sub">' + UI.esc(e.code || 'ERROR') + '<br>' + UI.esc(e.message || '') + '</span>' +
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
