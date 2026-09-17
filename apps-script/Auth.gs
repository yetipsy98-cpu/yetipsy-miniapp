/* =============================================================
   YETIPSY MINI APP 2.1.5 — Auth.gs
   -------------------------------------------------------------
   系统 ping · 员工登录（Salted Hash + 失败锁定）
   会员登录在 Customers.gs（因为要处理「同一个号码只注册一次」）
   ============================================================= */

function ping() {
  return ok({
    app: 'YETIPSY MINI APP',
    version: APP_VERSION,
    mode: 'PRODUCTION',
    backend: 'GOOGLE_APPS_SCRIPT',
    storage: 'GOOGLE_SHEETS',
    serverTime: nowISO(),
    timezone: timezone(),
    auth: 'PHONE_PASSWORD'
  });
}

function getPublicSettings() {
  return ok({
    barName: setting('BAR_NAME', 'Yetipsy'),
    currency: setting('CURRENCY', 'MYR'),
    timezone: timezone(),
    auth: 'PHONE_PASSWORD',
    passwordMinLength: numSetting('CUSTOMER_PASSWORD_MIN', 8),
    allowedCountryCodes: String(setting('ALLOWED_COUNTRY_CODES', '60,65'))
      .split(',').map(function (c) { return '+' + c.trim(); })
  });
}

/* -------------------------------------------------------------
   员工登录
   ------------------------------------------------------------- */

function staffLogin(data) {
  var username = String(data.username || '').trim().toLowerCase();
  var password = String(data.password || '');
  if (!username || !password) {
    return err('UNAUTHORIZED', 'Invalid username or password. / 账号或密码错误。');
  }

  var key = 'stafflogin:' + username;
  if (rateLimitLocked(key)) return err('RATE_LIMITED');

  var staff = dbFind('staff', function (s) { return String(s.username).toLowerCase() === username; });

  if (!staff || staff.status !== 'ACTIVE' ||
      staff.passwordHash !== hashPassword(password, staff.salt)) {
    rateLimitFail(key, 6, 300);                     // 6 次失败 → 锁 5 分钟
    audit(username, 'STAFF', 'LOGIN_FAILED', 'STAFF', username, '', '');
    return err('UNAUTHORIZED', 'Invalid username or password. / 账号或密码错误。');
  }

  rateLimitClear(key);
  staff.lastLogin = nowISO();
  var token = createSession('STAFF', staff.staffId);
  audit(staff.staffId, 'STAFF', 'LOGIN', 'STAFF', staff.staffId, '', staff.role);

  return ok({
    token: token,
    staff: {
      staffId: staff.staffId,
      username: staff.username,
      role: staff.role,
      name: staff.username
    }
  });
}

function staffLogout(data, token) {
  var ctx = requireStaff(token);
  if (!ctx.error) audit(ctx.staff.staffId, 'STAFF', 'LOGOUT', 'STAFF', ctx.staff.staffId, '', '');
  destroySession(token);
  return ok({ loggedOut: true });
}

function getStaffSession(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;
  return ok({
    staff: {
      staffId: ctx.staff.staffId,
      username: ctx.staff.username,
      role: ctx.staff.role
    }
  });
}
