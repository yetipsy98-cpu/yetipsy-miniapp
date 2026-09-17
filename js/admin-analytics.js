/* =============================================================
   YETIPSY — admin-analytics.js（2.0 Phase 11）
   -------------------------------------------------------------
   Owner 业绩报表（§50 §51 §52 §62）

   · §50 今日：销售 / 订单数 / 平均客单 / 卖出杯数 / 钱包抵扣 /
          Reward / 新会员，加上 TOP PRODUCTS
   · §51 通路业绩：Yetipsy App / Foodcourt / Direct 各多少
          —— 老板靠这个判断自己做的点餐系统有没有价值
   · §52 会员分析：新客 / 回头客 / 平均消费 / 钱包使用率 / Reward 回流

   权限：只有 MANAGER / OWNER（§62），后端也会再挡一次。
   ============================================================= */

var ADMIN_ANALYTICS = (function () {

  var state = {
    sales: null,
    products: null,
    members: null,
    days: 7,
    loading: true,
    errorCode: null
  };

  function init() {
    if (!ADMIN.isManager()) {
      var box = document.getElementById('analyticsBody');
      if (box) {
        box.innerHTML = '<div class="a-empty">需要经理或老板权限<br>' +
          'Manager or Owner permission required</div>';
      }
      return;
    }
    bindEvents();
    load();
  }

  function bindEvents() {
    var strip = document.getElementById('rangeStrip');
    if (!strip) return;
    Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (el) {
      el.addEventListener('click', function () {
        state.days = Number(el.getAttribute('data-days')) || 7;
        Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (x) {
          x.className = 'cat-chip';
        });
        el.className = 'cat-chip active';
        load();
      });
    });
  }

  function load() {
    state.loading = true;
    render();
    return Promise.all([
      API.admin.getSalesAnalytics(state.days),
      API.admin.getProductAnalytics(state.days, 10),
      API.admin.getMemberAnalytics(Math.max(30, state.days))
    ]).then(function (results) {
      var bad = results.filter(function (r) { return !r.success; })[0];
      if (bad) {
        state.errorCode = bad.error.code;
        state.loading = false;
        render();
        return;
      }
      state.errorCode = null;
      state.sales = results[0].data;
      state.products = results[1].data;
      state.members = results[2].data;
      state.loading = false;
      render();
    });
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function render() {
    var box = document.getElementById('analyticsBody');
    if (!box) return;

    if (state.loading) {
      box.innerHTML = '<div class="a-empty">载入中… LOADING</div>';
      return;
    }
    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">载入失败 · ' + UI.esc(state.errorCode) +
        '<br><button class="btn btn-secondary mt-16" id="retryBtn">重试 RETRY</button></div>';
      var r = document.getElementById('retryBtn');
      if (r) r.addEventListener('click', load);
      return;
    }

    box.innerHTML =
      todayBlock() + channelBlock() + topBlock() + trendBlock() + memberBlock();
  }

  function card(label, value, sub) {
    return '<div class="dash-card">' +
      '<div class="dc-label">' + UI.esc(label) + '</div>' +
      '<div class="dc-value">' + value + '</div>' +
      (sub ? '<div class="dc-sub">' + UI.esc(sub) + '</div>' : '') +
    '</div>';
  }

  /** §50 今日 */
  function todayBlock() {
    var t = (state.sales && state.sales.today) || {};
    return '<div class="a-section-title">今日 TODAY · ' + UI.esc(t.date) + '</div>' +
      '<div class="dash-grid">' +
        card('销售 SALES', UI.money(t.sales), '毛额 ' + UI.money(t.gross)) +
        card('订单 ORDERS', t.orders, '') +
        card('平均客单 AVERAGE', UI.money(t.averageOrder), '') +
        card('卖出杯数 ITEMS', t.itemsSold, '') +
        card('钱包抵扣 WALLET', UI.money(t.walletRedeemed), '') +
        card('发出 Reward', t.rewardsIssued, UI.money(t.rewardsAmount)) +
        card('新会员 NEW MEMBERS', t.newMembers, '') +
      '</div>';
  }

  /** §51 通路业绩 —— 老板判断点餐系统价值的关键 */
  function channelBlock() {
    var list = (state.sales && state.sales.channels) || [];
    var total = state.sales.channelTotal || 0;

    var rows = list.length
      ? list.map(function (c) {
          var pct = total ? Math.round(c.sales * 1000 / total) / 10 : 0;
          return '<div class="ch-row">' +
            '<div class="ch-name">' + UI.esc(channelLabel(c.channel)) + '</div>' +
            '<div class="ch-bar"><div class="ch-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="ch-val">' + UI.money(c.sales) +
              '<span class="ch-sub">' + c.orders + ' 单 · ' + pct + '%</span></div>' +
          '</div>';
        }).join('')
      : '<div class="a-empty">今天还没有订单 NO ORDERS TODAY</div>';

    return '<div class="a-section-title mt-16">通路业绩 SALES CHANNEL（§51）</div>' +
      '<div class="panel">' + rows +
        (total ? '<div class="a-divider"></div><div class="ch-row">' +
          '<div class="ch-name">合计 TOTAL</div><div class="ch-bar"></div>' +
          '<div class="ch-val">' + UI.money(total) + '</div></div>' : '') +
      '</div>';
  }

  function channelLabel(src) {
    var map = {
      YETIPSY_APP: 'Yetipsy App 点单',
      FOODCOURT: 'Foodcourt 美食中心',
      FOODCOURT_API: 'Foodcourt API',
      DIRECT: 'Direct 直接消费',
      MANUAL: 'Manual 手动开单',
      IMPORT: 'Import 汇入'
    };
    return map[src] || src;
  }

  /** §50 TOP PRODUCTS */
  function topBlock() {
    var list = (state.products && state.products.products) || [];
    var rows = list.length
      ? list.map(function (p) {
          return '<div class="ch-row">' +
            '<div class="ch-name"><span class="rank">' + p.rank + '</span> ' +
              UI.esc(p.name) + '</div>' +
            '<div class="ch-bar"></div>' +
            '<div class="ch-val">' + p.quantity + ' 杯' +
              '<span class="ch-sub">' + UI.money(p.sales) + '</span></div>' +
          '</div>';
        }).join('')
      : '<div class="a-empty">还没有完成订单 NO COMPLETED ORDERS</div>';

    return '<div class="a-section-title mt-16">热销商品 TOP PRODUCTS（最近 ' +
      state.days + ' 天）</div><div class="panel">' + rows + '</div>';
  }

  /** 趋势 */
  function trendBlock() {
    var trend = (state.sales && state.sales.trend) || [];
    var max = trend.reduce(function (m, d) { return Math.max(m, Number(d.sales) || 0); }, 0);
    var bars = trend.map(function (d) {
      var h = max ? Math.max(2, Math.round(d.sales * 100 / max)) : 2;
      var appH = d.sales ? Math.round((Number(d.appSales) || 0) * 100 / d.sales) : 0;
      return '<div class="tr-col" title="' + UI.esc(d.date) + ' · ' +
          UI.money(d.sales) + ' · ' + d.orders + ' 单">' +
        '<div class="tr-bar" style="height:' + h + '%">' +
          '<div class="tr-app" style="height:' + appH + '%"></div>' +
        '</div>' +
        '<div class="tr-day">' + UI.esc(d.date.slice(5)) + '</div>' +
      '</div>';
    }).join('');

    return '<div class="a-section-title mt-16">趋势 TREND（金色 = App 点单）</div>' +
      '<div class="panel"><div class="tr-chart">' + bars + '</div></div>';
  }

  /** §52 会员分析 */
  function memberBlock() {
    var m = state.members || {};
    var tiers = (m.tiers || []).map(function (x) {
      return UI.esc(x.tier) + ' ' + x.members;
    }).join(' · ');

    return '<div class="a-section-title mt-16">会员分析 MEMBERS（§52 · 最近 ' +
        m.days + ' 天）</div>' +
      '<div class="dash-grid">' +
        card('会员总数 MEMBERS', m.totalMembers, '新增 ' + m.newMembers) +
        card('回头客 REPEAT', m.repeatCustomers, m.repeatRate + '%') +
        card('平均消费 AVG SPEND', UI.money(m.averageSpend), '') +
        card('平均到店 AVG VISITS', m.averageVisits, '') +
        card('钱包使用率 WALLET', m.walletUsageRate + '%', m.walletUsers + ' 人用过') +
        card('Reward 回流 RETURN', m.rewardReturnRate + '%',
          m.rewardsClaimed + ' / ' + m.rewardsIssued) +
      '</div>' +
      (tiers ? '<div class="a-sub mt-8">等级分布：' + tiers + '</div>' : '');
  }

  function debugState() {
    return {
      loading: state.loading,
      errorCode: state.errorCode,
      days: state.days,
      todaySales: state.sales && state.sales.today ? state.sales.today.sales : null,
      todayOrders: state.sales && state.sales.today ? state.sales.today.orders : null,
      channelTotal: state.sales ? state.sales.channelTotal : null,
      channels: state.sales && state.sales.channels
        ? state.sales.channels.map(function (c) { return c.channel; }) : [],
      topProducts: state.products ? state.products.products.length : null,
      totalMembers: state.members ? state.members.totalMembers : null
    };
  }

  return { init: init, load: load, debugState: debugState };

})();
