/* =============================================================
   YETIPSY MINI APP 1.1 — Wallet.gs
   钱包余额只由后端改动，每一笔都留 WalletTx 明细。
   ============================================================= */

/**
 * 加钱（正数）或扣钱（负数）。余额不会低于 0。
 * type: REWARD | REDEEM | MANUAL_ADD | MANUAL_DEDUCT | REFUND | REVERSAL
 */
function walletCredit(customer, order, amountSen, type, description, actorId, actorType) {
  var before = Number(customer.walletBalance) || 0;
  var after  = Math.max(0, before + amountSen);
  customer.walletBalance = after;

  dbInsert('walletTx', {
    transactionId: dbNextId('WLT', 'wallet'),
    customerId:    customer.customerId,
    orderId:       order ? order.orderId : '',
    type:          type,
    amount:        amountSen,
    balanceBefore: before,
    balanceAfter:  after,
    description:   description || '',
    createdAt:     nowISO(),
    createdBy:     actorId || ''
  });

  audit(actorId, actorType || 'SYSTEM',
        type === 'REWARD' ? 'CLAIM_REWARD' : 'WALLET_' + type,
        'CUSTOMER', customer.customerId, before, after);

  return { before: before, after: after };
}

/** 计算这笔账单最多可以用钱包抵扣多少（员工端与会员端共用同一套规则） */
function walletRedemptionPlan(customer, billSen) {
  var percent = numSetting('MAX_WALLET_USAGE_PERCENT', 20);
  var minBill = numSetting('MIN_WALLET_REDEEM_BILL', 30) * 100;
  var wallet  = Number(customer.walletBalance) || 0;

  var capAmount = Math.floor(billSen * percent / 100);
  var maxUsable = Math.min(wallet, capAmount);
  var reason = '', reasonEn = '';

  if (billSen < minBill) {
    reason   = '账单未满 RM' + (minBill / 100).toFixed(2);
    reasonEn = 'bill below minimum RM' + (minBill / 100).toFixed(2);
  } else if (wallet <= 0) {
    reason   = '钱包没有余额';
    reasonEn = 'no wallet balance';
  }

  var usable = billSen < minBill ? 0 : maxUsable;

  return {
    billAmount:    billSen,
    walletBalance: wallet,
    maxPercent:    percent,
    capAmount:     capAmount,
    maxUsable:     maxUsable,
    usableAmount:  usable,
    customerPays:  billSen - usable,
    minBill:       minBill,
    reason:        reason,
    reasonEn:      reasonEn,
    allowed:       billSen >= minBill && usable > 0
  };
}

/* -------------------------------------------------------------
   API：员工端钱包抵扣
   ------------------------------------------------------------- */

function calculateWalletRedemption(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var bill = Math.round(Number(data.billAmount));
  if (!isFinite(bill) || bill <= 0) return err('INVALID_AMOUNT');

  return ok(walletRedemptionPlan(c, bill));
}

/** 员工确认抵扣：扣钱包 → 建立消费记录 → 发积分（NET_PAID） */
function redeemWallet(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var bill      = Math.round(Number(data.billAmount));
  var requested = Math.round(Number(data.walletAmount));
  if (!isFinite(bill) || bill <= 0) return err('INVALID_AMOUNT');
  if (!isFinite(requested) || requested < 0) return err('INVALID_AMOUNT');

  var minBill = numSetting('MIN_WALLET_REDEEM_BILL', 30) * 100;
  var wallet  = Number(c.walletBalance) || 0;

  if (bill < minBill) {
    return err('WALLET_LIMIT_EXCEEDED',
      'Bill must be at least RM' + (minBill / 100).toFixed(2) +
      '. / 账单需满 RM' + (minBill / 100).toFixed(2) + '。');
  }
  if (requested > wallet) return err('INSUFFICIENT_WALLET');

  var cap = Math.floor(bill * numSetting('MAX_WALLET_USAGE_PERCENT', 20) / 100);
  if (requested > cap) return err('WALLET_LIMIT_EXCEEDED');

  var source = String(data.source || 'DIRECT').toUpperCase();
  var externalOrderId = String(data.externalOrderId || '').trim().toUpperCase();
  if (externalOrderId && findOrderByExternal(source, externalOrderId)) {
    return err('DUPLICATE_EXTERNAL_ORDER');
  }

  var order = createMemberTransaction({
    source: source,
    externalOrderId: externalOrderId,
    amount: bill,
    customerId: c.customerId,
    createdBy: ctx.staff.staffId,
    actorType: 'STAFF',
    note: String(data.note || '').slice(0, 200)
  });

  order.walletUsed  = requested;
  order.finalAmount = bill - requested;
  order.claimStatus = 'CLAIMED';
  order.claimedAt   = nowISO();
  order.completedAt = nowISO();

  walletCredit(c, order, -requested, 'REDEEM',
    'Redemption for ' + (externalOrderId || order.orderId), ctx.staff.staffId, 'STAFF');
  audit(ctx.staff.staffId, 'STAFF', 'REDEEM_WALLET', 'ORDER', order.orderId, wallet, wallet - requested);

  var points = pointsForAmount(bill, requested);
  order.pointsEarned = points;

  c.totalSpend  = (Number(c.totalSpend) || 0) + bill;
  c.totalVisits = (Number(c.totalVisits) || 0) + 1;
  c.lastVisitAt = nowISO();
  issuePoints(c, order, points, 'Purchase with wallet redemption', ctx.staff.staffId, 'STAFF', 'EARN');

  var reward = generateReward(c, order, bill);

  return ok({
    orderId: order.orderId,
    billAmount: bill,
    walletUsed: requested,
    customerPays: bill - requested,
    pointsEarned: points,
    customer: publicCustomer(c),
    membership: membershipInfo(c),
    reward: reward ? { rewardId: reward.rewardId, status: reward.status } : null
  });
}

/** 手动加 / 扣钱包（Manager+） */
function manualWalletAdjustment(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var amount = Math.round(Number(data.amount));
  if (!isFinite(amount) || amount === 0) return err('INVALID_AMOUNT');
  if (amount < 0 && Math.abs(amount) > (Number(c.walletBalance) || 0)) return err('INSUFFICIENT_WALLET');

  var reason = String(data.reason || '').slice(0, 200);
  walletCredit(c, null, amount, amount > 0 ? 'MANUAL_ADD' : 'MANUAL_DEDUCT',
               reason || 'Manual adjustment', ctx.staff.staffId, 'STAFF');
  audit(ctx.staff.staffId, 'STAFF', 'MANUAL_WALLET_ADJUST', 'CUSTOMER', c.customerId, '',
        amount + ' | ' + reason);

  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}
