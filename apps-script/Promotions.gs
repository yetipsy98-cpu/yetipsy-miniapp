/* =============================================================
   YETIPSY MINI APP 1.1 — Promotions.gs
   ============================================================= */

/** 会员端：只回传今天有效的活动 */
function getPromotions() {
  var today = todayKey();
  var list = dbFilter('promotions', function (p) {
    return p.status === 'ACTIVE' &&
      (!p.startDate || p.startDate <= today) &&
      (!p.endDate || p.endDate >= today);
  })
  .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
  .map(function (p) {
    return {
      promotionId: p.promotionId, title: p.title, subtitle: p.subtitle,
      description: p.description, imageUrl: p.imageUrl,
      startDate: p.startDate, endDate: p.endDate
    };
  });
  return ok({ promotions: list });
}

function getPromotionsAdmin(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  return ok({ promotions: dbRecent('promotions') });
}

function createPromotion(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var title = String(data.title || '').trim().slice(0, 80);
  if (!title) return err('INVALID_INPUT', 'Title required. / 请填写标题。');

  var p = dbInsert('promotions', {
    promotionId: dbNextId('PRM', 'promo', 4),
    title: title,
    subtitle: String(data.subtitle || '').slice(0, 80),
    description: String(data.description || '').slice(0, 500),
    imageUrl: String(data.imageUrl || '').slice(0, 300),
    startDate: String(data.startDate || '').slice(0, 10),
    endDate: String(data.endDate || '').slice(0, 10),
    minSpend: Math.max(0, Math.round(Number(data.minSpend) || 0)),
    status: String(data.status || 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    sortOrder: dbFilter('promotions', function () { return true; }).length,
    createdAt: nowISO()
  });

  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PROMOTION', 'PROMOTION', p.promotionId, '', title);
  return ok({ promotion: p });
}

function updatePromotion(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('promotions', String(data.promotionId || ''));
  if (!p) return err('INVALID_INPUT', 'Promotion not found. / 找不到活动。');

  var old = p.status;
  if (data.status !== undefined)      p.status = String(data.status) === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (data.title !== undefined)       p.title = String(data.title).slice(0, 80);
  if (data.subtitle !== undefined)    p.subtitle = String(data.subtitle).slice(0, 80);
  if (data.description !== undefined) p.description = String(data.description).slice(0, 500);
  if (data.startDate !== undefined)   p.startDate = String(data.startDate).slice(0, 10);
  if (data.endDate !== undefined)     p.endDate = String(data.endDate).slice(0, 10);

  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PROMOTION', 'PROMOTION', p.promotionId, old, p.status);
  return ok({ promotion: p });
}
