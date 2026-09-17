/* =============================================================
   YETIPSY — Analytics.gs（2.0 Phase 11）
   -------------------------------------------------------------
   业绩分析（§50 §51 §52 §62）

   §50 Owner Dashboard：今日 销售 / 订单数 / 平均客单 / 卖出杯数 /
        钱包抵扣 / 发出 Reward / 新会员
   §51 通路业绩：Yetipsy App / Foodcourt / Direct 各多少
        —— 这是老板判断「自己做的点餐系统到底有没有价值」的依据
   §52 会员分析：新客 / 回头客 / 平均消费 / 平均到店 / 钱包使用率 /
        Reward 回流率（2.0 先把数字算出来，复杂的以后再做）

   重要：App 订单完成时会同时写一笔 1.x Orders（orderSource =
   YETIPSY_APP），所以通路统计一律以 1.x Orders 为准，
   这样两条通路加起来不会重复计算。
   ============================================================= */

/** 把 ISO 时间转成 Asia/Kuala_Lumpur 的 YYYY-MM-DD */
function localDay(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  } catch (e) {
    return String(iso).slice(0, 10);
  }
}

/** 最近 n 天的日期清单（含今天），用于趋势图 */
function lastDays(n) {
  var out = [];
  var now = Date.now();
  for (var i = n - 1; i >= 0; i--) {
    out.push(localDay(new Date(now - i * 86400000).toISOString()));
  }
  return out;
}

/**
 * getSalesAnalytics —— Owner 专用（§50 §51 §62）
 * @param {object} data { days: 7 }
 */
function getSalesAnalytics(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var days = Math.max(1, Math.min(90, Number((data && data.days) || 7)));
  var today = todayKeyOf();
  var range = lastDays(days);
  var from = range[0];

  /* ---- 1.x Orders 是通路统计的唯一来源（App 订单也镜像在这里） ---- */
  var orders = dbFilter('orders', function () { return true; });

  var todayOrders = orders.filter(function (o) {
    return localDay(o.completedAt || o.claimedAt || o.createdAt) === today;
  });

  var sumNet = function (list) {
    return list.reduce(function (s, o) {
      return s + (Number(o.finalAmount) || Number(o.billAmount) || 0);
    }, 0);
  };
  var sumGross = function (list) {
    return list.reduce(function (s, o) { return s + (Number(o.billAmount) || 0); }, 0);
  };
  var sumWallet = function (list) {
    return list.reduce(function (s, o) { return s + (Number(o.walletUsed) || 0); }, 0);
  };

  var todaySales = sumNet(todayOrders);

  /* ---- §51 通路业绩（今天） ---- */
  var byChannel = {};
  todayOrders.forEach(function (o) {
    var src = String(o.orderSource || 'DIRECT').toUpperCase();
    if (!byChannel[src]) byChannel[src] = { channel: src, orders: 0, sales: 0 };
    byChannel[src].orders += 1;
    byChannel[src].sales += (Number(o.finalAmount) || Number(o.billAmount) || 0);
  });
  var channels = Object.keys(byChannel).map(function (k) { return byChannel[k]; })
    .sort(function (a, b) { return b.sales - a.sales; });
  var channelTotal = channels.reduce(function (s, c) { return s + c.sales; }, 0);

  /* ---- 卖出杯数：只有 App 订单有品项 ---- */
  var appToday = dbFilter('appOrders', function (o) {
    return o.orderStatus === 'COMPLETED' && localDay(o.completedAt) === today;
  });
  var itemsSold = 0;
  appToday.forEach(function (o) {
    itemsSold += Number(o.itemCount) || 0;
  });

  /* ---- 钱包抵扣 / Reward / 新会员（今天） ---- */
  var walletRedeemed = dbFilter('walletTx', function (x) {
    return x.type === 'REDEEM' && localDay(x.createdAt) === today;
  }).reduce(function (s, x) { return s + Math.abs(Number(x.amount) || 0); }, 0);

  var rewardsIssued = dbFilter('rewards', function (r) {
    return localDay(r.createdAt) === today;
  });

  var newMembers = dbFilter('customers', function (c) {
    return localDay(c.createdAt) === today;
  }).length;

  /* ---- 趋势（最近 n 天，按通路） ---- */
  var trend = range.map(function (day) {
    var list = orders.filter(function (o) {
      return localDay(o.completedAt || o.claimedAt || o.createdAt) === day;
    });
    var app = list.filter(function (o) {
      return String(o.orderSource || '').toUpperCase() === 'YETIPSY_APP';
    });
    return {
      date: day,
      orders: list.length,
      sales: sumNet(list),
      appOrders: app.length,
      appSales: sumNet(app)
    };
  });

  /* ---- 区间总计 ---- */
  var rangeOrders = orders.filter(function (o) {
    var d = localDay(o.completedAt || o.claimedAt || o.createdAt);
    return d >= from && d <= today;
  });

  return ok({
    today: {
      date: today,
      orders: todayOrders.length,
      sales: todaySales,
      gross: sumGross(todayOrders),
      averageOrder: todayOrders.length ? Math.round(todaySales / todayOrders.length) : 0,
      itemsSold: itemsSold,
      walletRedeemed: walletRedeemed,
      rewardsIssued: rewardsIssued.length,
      rewardsAmount: rewardsIssued.reduce(function (s, r) {
        return s + (Number(r.amount) || 0);
      }, 0),
      newMembers: newMembers
    },
    /* §51 通路业绩 */
    channels: channels,
    channelTotal: channelTotal,
    /* 最近 n 天趋势 */
    trend: trend,
    range: {
      days: days,
      from: from,
      to: today,
      orders: rangeOrders.length,
      sales: sumNet(rangeOrders),
      gross: sumGross(rangeOrders),
      walletRedeemed: sumWallet(rangeOrders)
    },
    topProducts: topProductsFor(range).slice(0, 10)
  });
}

/**
 * getProductAnalytics —— 商品业绩（§50 §62）
 * @param {object} data { days: 7, limit: 10 }
 */
function getProductAnalytics(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var days = Math.max(1, Math.min(90, Number((data && data.days) || 7)));
  var limit = Math.max(1, Math.min(50, Number((data && data.limit) || 10)));
  var range = lastDays(days);

  return ok({
    days: days,
    from: range[0],
    to: range[range.length - 1],
    products: topProductsFor(range, limit)
  });
}

/** 依 OrderItems 统计热销（§50 TOP PRODUCTS） */
function topProductsFor(range, limit) {
  var from = range[0];
  var to = range[range.length - 1];

  /* 先挑出区间内完成的 App 订单 */
  var doneIds = {};
  dbFilter('appOrders', function (o) {
    if (o.orderStatus !== 'COMPLETED') return false;
    var d = localDay(o.completedAt);
    return d >= from && d <= to;
  }).forEach(function (o) { doneIds[o.appOrderId] = true; });

  var byProduct = {};
  dbFilter('orderItems', function (it) { return !!doneIds[it.appOrderId]; })
    .forEach(function (it) {
      var id = String(it.productId || '');
      if (!byProduct[id]) {
        byProduct[id] = {
          productId: id,
          name: it.productNameSnapshot || '',
          quantity: 0,
          sales: 0
        };
      }
      byProduct[id].quantity += Number(it.quantity) || 0;
      byProduct[id].sales += Number(it.lineTotalSen) || 0;
    });

  var list = Object.keys(byProduct).map(function (k) { return byProduct[k]; });
  list.sort(function (a, b) { return b.quantity - a.quantity || b.sales - a.sales; });

  return (limit ? list.slice(0, limit) : list).map(function (p, i) {
    p.rank = i + 1;
    return p;
  });
}

/**
 * getMemberAnalytics —— 会员分析（§52）
 * 2.0 先把数字算出来，复杂的分群以后再做。
 */
function getMemberAnalytics(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var days = Math.max(1, Math.min(365, Number((data && data.days) || 30)));
  var range = lastDays(days);
  var from = range[0];
  var today = range[range.length - 1];

  var customers = dbFilter('customers', function () { return true; }).filter(function (c) {
    return String(c.status || 'ACTIVE').toUpperCase() !== 'BLOCKED';
  });

  var inRange = customers.filter(function (c) {
    var d = localDay(c.createdAt);
    return d >= from && d <= today;
  });

  var withSpend = customers.filter(function (c) {
    return (Number(c.totalSpend) || 0) > 0;
  });
  var totalSpend = customers.reduce(function (s, c) {
    return s + (Number(c.totalSpend) || 0);
  }, 0);
  var totalVisits = customers.reduce(function (s, c) {
    return s + (Number(c.totalVisits) || 0);
  }, 0);

  /* 回头客：到店超过 1 次 */
  var repeat = customers.filter(function (c) {
    return (Number(c.totalVisits) || 0) > 1;
  }).length;

  /*
   * 钱包使用率：真的用过钱包抵扣的人数 / 有消费的人数。
   * Customers 表没有 totalWalletUsed 栏位，所以以 WalletTx 的 REDEEM 为准
   * （那是唯一的权威纪录），不能用「还有没有余额」来判断。
   */
  var walletUsersById = {};
  dbFilter('walletTx', function (x) {
    return x.type === 'REDEEM' && Number(x.amount) < 0;
  }).forEach(function (x) {
    if (x.customerId) walletUsersById[String(x.customerId)] = true;
  });
  var usedWallet = customers.filter(function (c) {
    return !!walletUsersById[String(c.customerId)];
  }).length;

  /* Reward 回流率：领到 Reward 且已兑换 / 领到 Reward */
  var rewards = dbFilter('rewards', function () { return true; });
  var claimedRewards = rewards.filter(function (r) {
    return String(r.status || '').toUpperCase() === 'CLAIMED';
  }).length;

  /* 等级分布 */
  var tiers = {};
  customers.forEach(function (c) {
    var t = String(c.membershipTier || 'MEMBER').toUpperCase();
    tiers[t] = (tiers[t] || 0) + 1;
  });

  return ok({
    days: days,
    from: from,
    to: today,
    totalMembers: customers.length,
    newMembers: inRange.length,
    repeatCustomers: repeat,
    repeatRate: customers.length ? Math.round(repeat * 1000 / customers.length) / 10 : 0,
    averageSpend: withSpend.length ? Math.round(totalSpend / withSpend.length) : 0,
    averageVisits: withSpend.length ? Math.round(totalVisits * 10 / withSpend.length) / 10 : 0,
    totalSpend: totalSpend,
    totalVisits: totalVisits,
    walletUsers: usedWallet,
    walletUsageRate: withSpend.length
      ? Math.round(usedWallet * 1000 / withSpend.length) / 10 : 0,
    rewardsIssued: rewards.length,
    rewardsClaimed: claimedRewards,
    rewardReturnRate: rewards.length
      ? Math.round(claimedRewards * 1000 / rewards.length) / 10 : 0,
    tiers: Object.keys(tiers).map(function (k) {
      return { tier: k, members: tiers[k] };
    }).sort(function (a, b) { return b.members - a.members; })
  });
}
