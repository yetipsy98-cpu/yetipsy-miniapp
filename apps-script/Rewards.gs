/* =============================================================
   YETIPSY MINI APP 1.3 — Rewards.gs
   奖励只能由后端产生（前端不允许 Math.random）
   每日预算用完 → 停止发放；接近上限 → LOW_REWARD_MODE
   ============================================================= */

function rewardBand(amountSen) {
  var tiers = safeJson(setting('REWARD_TIERS', '[]'), []);
  var hit = null;
  tiers.forEach(function (t) {
    if (!hit && amountSen >= t.min && amountSen <= t.max) hit = t;
  });
  return hit;
}

function rewardsGivenToday() {
  var today = todayKey();
  return dbFilter('rewards', function (r) {
    return r.status !== 'CANCELLED' && isoDateKey(r.createdAt) === today;
  }).reduce(function (sum, r) { return sum + (Number(r.amount) || 0); }, 0);
}

function generateReward(customer, order, amountSen) {
  if (!boolSetting('REWARD_ENABLED', true)) return null;
  if (amountSen < numSetting('REWARD_MIN_SPEND', 30) * 100) return null;

  var band = rewardBand(amountSen);
  if (!band) return null;

  var budget = numSetting('DAILY_REWARD_BUDGET', 50) * 100;
  var used   = rewardsGivenToday();
  var left   = budget - used;
  if (left <= 0) return null;                      // 预算用尽

  var weights = safeJson(setting('REWARD_WEIGHTS', '{"small":70,"medium":25,"big":5}'),
                         { small: 70, medium: 25, big: 5 });
  var small  = Number(weights.small)  || 70;
  var medium = Number(weights.medium) || 25;

  var roll  = Math.random() * 100;
  var range = band.to - band.from;
  var amount;
  if (roll < small) {
    amount = band.from + Math.round(Math.random() * range * 0.30);
  } else if (roll < small + medium) {
    amount = band.from + Math.round(range * 0.30 + Math.random() * range * 0.40);
  } else {
    amount = band.from + Math.round(range * 0.70 + Math.random() * range * 0.30);
  }

  /* 预算接近上限 → LOW_REWARD_MODE（最多 LOW_REWARD_MODE_MAX） */
  if (used + amount > budget * 0.8) {
    amount = Math.min(amount, numSetting('LOW_REWARD_MODE_MAX', 100));
  }
  amount = Math.round(Math.max(10, Math.min(amount, left)));

  var reward = dbInsert('rewards', {
    rewardId:  dbNextId('RWD', 'reward'),
    orderId:   order ? order.orderId : '',
    customerId: customer ? customer.customerId : '',
    amount:    amount,
    status:    'AVAILABLE',
    createdAt: nowISO(),
    expiresAt: new Date(Date.now() + numSetting('REWARD_EXPIRY_DAYS', 7) * 86400000).toISOString(),
    claimedAt: ''
  });

  audit('SYSTEM', 'SYSTEM', 'ISSUE_REWARD', 'REWARD', reward.rewardId, '', amount);
  return reward;
}
