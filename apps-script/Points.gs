/* =============================================================
   YETIPSY MINI APP 1.1 — Points.gs
   积分 / 等级（Threshold 全部读 Settings，不 hardcode）
   ============================================================= */

function computeTier(points) {
  var gold   = numSetting('GOLD_THRESHOLD', 1500);
  var silver = numSetting('SILVER_THRESHOLD', 500);
  if (points >= gold) return 'GOLD';
  if (points >= silver) return 'SILVER';
  return 'MEMBER';
}

function membershipInfo(customer) {
  var p = Number(customer.currentPoints) || 0;
  var silver = numSetting('SILVER_THRESHOLD', 500);
  var gold   = numSetting('GOLD_THRESHOLD', 1500);
  var tier   = computeTier(p);

  var nextTier = '', pointsToNext = 0, floor = 0, ceiling = 0;
  if (p < silver)       { nextTier = 'SILVER'; floor = 0;      ceiling = silver; }
  else if (p < gold)    { nextTier = 'GOLD';   floor = silver; ceiling = gold;   }
  else                  { nextTier = '';       floor = gold;   ceiling = gold;   }

  pointsToNext = nextTier ? Math.max(0, ceiling - p) : 0;
  var progressPercent = nextTier
    ? Math.min(100, Math.round(((p - floor) / Math.max(1, ceiling - floor)) * 100))
    : 100;

  return {
    tier: tier,
    currentPoints: p,
    nextTier: nextTier,
    pointsToNext: pointsToNext,
    progressPercent: progressPercent,
    thresholds: {
      MEMBER: numSetting('MEMBER_THRESHOLD', 0),
      SILVER: silver,
      GOLD: gold
    },
    lifetimePoints: Number(customer.lifetimePoints) || 0
  };
}

/**
 * 发放 / 扣回积分（正数 = 发放，负数 = 撤销）
 * 余额永远不会低于 0。
 */
function issuePoints(customer, order, points, description, actorId, actorType, type) {
  if (!points) return null;
  var before = Number(customer.currentPoints) || 0;
  var after  = Math.max(0, before + points);

  customer.currentPoints = after;
  if (points > 0) customer.lifetimePoints = (Number(customer.lifetimePoints) || 0) + points;
  customer.membershipTier = computeTier(after);

  dbInsert('pointTx', {
    transactionId: dbNextId('PTS', 'point'),
    customerId:    customer.customerId,
    orderId:       order ? order.orderId : '',
    type:          type || (points >= 0 ? 'EARN' : 'ADJUSTMENT'),
    points:        points,
    balanceBefore: before,
    balanceAfter:  after,
    description:   description || '',
    createdAt:     nowISO(),
    createdBy:     actorId || ''
  });

  audit(actorId, actorType || 'SYSTEM', 'ISSUE_POINTS', 'CUSTOMER',
        customer.customerId, before, after);
  return { before: before, after: after };
}

/** 依 Settings 计算一笔消费应得积分 */
function pointsForAmount(billAmount, walletUsed) {
  var perRm = numSetting('POINTS_PER_RM', 1);
  var basis = setting('POINTS_CALCULATION', 'NET_PAID') === 'GROSS_BILL'
    ? billAmount
    : Math.max(0, billAmount - (walletUsed || 0));
  return Math.floor((basis / 100) * perRm);
}
