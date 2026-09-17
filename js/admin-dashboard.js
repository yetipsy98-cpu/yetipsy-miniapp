/* =============================================================
   YETIPSY — admin-dashboard.js (Staff Home)
   ============================================================= */

var ADMIN_DASH = (function () {

  var STATUS_CHIP = {
    AVAILABLE: 'chip gold',
    CLAIMED:   'chip ok',
    EXPIRED:   'chip',
    CANCELLED: 'chip danger'
  };

  var SOURCE_LABEL = {
    FOODCOURT: 'FC',
    DIRECT:    'DIRECT',
    YETIPSY_APP: 'APP',
    MANUAL:    'MANUAL'
  };

  function init() {
    document.getElementById('logoutBtn').addEventListener('click', ADMIN.logout);

    /*
     * ★ 主流程有两条（都不在这个页面）：
     *   · foodcourt 单 → POS 进单台（pos.html）录入单据 → 扫会员码进分
     *   · mini app 单 → 订单看板（orderboard.html）完成时自动进分
     * 「建立 Claim（生成 QR）」是备用路径，入口在 MORE 页，
     * 后端 createClaim 收紧到 MANAGER / OWNER —— 首页不再有按钮，
     * 所以这里不需要按角色隐藏任何东西。
     */

    renderDate();
    load();
  }

  function renderDate() {
    var now = new Date();
    var s = now.toLocaleDateString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE,
      weekday: 'long', day: '2-digit', month: 'short', year: 'numeric'
    });
    var hour = Number(now.toLocaleString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE, hour: '2-digit', hour12: false
    }));
    document.getElementById('dateLabel').textContent = s;
    document.getElementById('todayLabel').textContent = (hour >= 17 || hour < 5) ? 'TONIGHT 今晚' : 'TODAY 今天';
  }

  function load() {
    API.staff.getDashboard('').then(function (res) {
      if (!res.success) { ADMIN.handleError(res.error); return; }
      render(res.data);
    });
  }

  function render(d) {
    document.getElementById('statMemberSales').textContent  = UI.money(d.memberSales);
    document.getElementById('statSalesSub').textContent     = 'All recorded sales: ' + UI.money(d.sales);
    document.getElementById('statClaims').textContent       = d.claims;
    document.getElementById('statClaimsSub').textContent    = d.claimsPending + ' pending · ' + d.claimsExpired + ' expired';
    document.getElementById('statNewMembers').textContent   = d.newMembers;
    document.getElementById('statPoints').textContent       = UI.points(d.pointsIssued);
    document.getElementById('statRewards').textContent      = UI.money(d.rewardsGiven);
    document.getElementById('statRewardsSub').textContent   =
      'budget ' + UI.money(d.rewardBudget) + ' · left ' + UI.money(d.rewardBudgetLeft) +
      (d.lowRewardMode ? ' · LOW MODE' : '');
    document.getElementById('statWalletRedeemed').textContent = UI.money(d.walletRedeemed);

    var box = document.getElementById('recentClaims');
    if (!d.recentClaims || !d.recentClaims.length) {
      box.innerHTML = '<div class="a-empty">No claims yet / 还没有记录</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + d.recentClaims.map(function (c) {
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.money(c.amount) +
            ' <span class="tiny muted-2">#' + UI.esc(c.externalOrderId || c.orderId) + '</span></div>' +
          '<div class="a-sub">' + UI.esc(SOURCE_LABEL[c.source] || c.source) +
            ' · ' + UI.esc(c.claimCode || '') +
            ' · ' + UI.esc(UI.timeOnly(c.createdAt)) +
            (c.customerName ? ' · ' + UI.esc(c.customerName) : '') +
          '</div>' +
        '</div>' +
        '<div class="a-right">' +
          '<span class="' + (STATUS_CHIP[c.status] || 'chip') + '">' + UI.esc(c.status) + '</span>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  return { init: init, reload: load };
})();
