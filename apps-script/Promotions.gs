/* =============================================================
   YETIPSY MINI APP 1.3 — Promotions.gs
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

/**
 * 这条活动今天会不会出现在会员端？
 * 员工端最常问「为什么客户端看不到」，所以直接把原因算出来回传。
 */
function promotionVisibility(p, today) {
  if (p.status !== 'ACTIVE') return { visible: false, reason: 'INACTIVE' };
  if (p.startDate && p.startDate > today) return { visible: false, reason: 'NOT_STARTED' };
  if (p.endDate && p.endDate < today)     return { visible: false, reason: 'EXPIRED' };
  return { visible: true, reason: 'VISIBLE' };
}

function getPromotionsAdmin(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  var today = todayKey();
  var list = dbRecent('promotions').map(function (p) {
    var v = promotionVisibility(p, today);
    p.visibleToday = v.visible;
    p.visibilityReason = v.reason;
    return p;
  });
  return ok({ promotions: list, today: today });
}

/* 注意：没有「删除活动」。
   DB 层（dbFlush）只新增与更新，删掉一列会让下面所有列的行号错位。
   不想让会员看到就切成 INACTIVE，或把日期改到今天之后。 */

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

/* =============================================================
   诊断工具（在 Apps Script 编辑器里手动执行）
   -------------------------------------------------------------
   顾客说「客户端看不到活动」时跑这个，10 秒就知道原因：
     · 表是空的        → 会员端当然没有活动
     · 全部过期/未开始 → 改日期
     · 全部 INACTIVE   → 切回 ACTIVE
     · 有 VISIBLE 的   → 后端没问题，是前端/后端版本或连线的问题
   ============================================================= */
function reportPromotions() {
  dbLoad();
  try {
    var today = todayKey();
    var all = dbFilter('promotions', function () { return true; });
    var lines = [];
    var visible = 0;

    lines.push('════ YETIPSY · Promotions 诊断 ════');
    lines.push('今天（后端时区）= ' + today);
    lines.push('Promotions 表共 ' + all.length + ' 条');

    if (!all.length) {
      lines.push('');
      lines.push('→ 这张表是空的，所以会员端「暂无活动」是正常的。');
      lines.push('  请在员工端 SETTINGS → Promotions 新增一条活动。');
    }

    all.forEach(function (p) {
      var v = promotionVisibility(p, today);
      if (v.visible) visible++;
      lines.push('  ' + (v.visible ? '✓' : '✗') + ' ' + p.promotionId +
        ' | ' + p.title +
        ' | status=' + p.status +
        ' | ' + (p.startDate || '(不限)') + ' → ' + (p.endDate || '(不限)') +
        ' | ' + v.reason);
    });

    lines.push('');
    lines.push('会员端现在会显示 ' + visible + ' 条活动。');
    if (all.length && !visible) {
      lines.push('→ 有活动但一条都看不到：');
      lines.push('  EXPIRED      = 结束日早于今天 → 员工端「改日期」');
      lines.push('  NOT_STARTED  = 开始日晚于今天 → 改开始日');
      lines.push('  INACTIVE     = 已停用 → 员工端切回 ACTIVE');
    }
    if (visible) {
      lines.push('→ 后端有活动可回传。若会员端还是看不到：');
      lines.push('  1) 会员端首页现在会显示「活动载入失败 + 错误码」，把错误码记下来');
      lines.push('  2) UNKNOWN_ACTION = 线上 Apps Script 还是旧版 → 重新贴 Code.gs 并重新部署');
      lines.push('  3) 部署后记得在「管理部署」选新版本，旧 /exec 网址会继续跑旧代码');
    }

    var text = lines.join('\n');
    Logger.log(text);
    return text;
  } finally {
    dbRelease();
  }
}
