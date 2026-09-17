/* =============================================================
   YETIPSY MINI APP 2.1.5 — Admin.gs
   设置 · 积分调整 · Audit Log · 员工账号（Manager / Owner）
   ============================================================= */

function manualPointAdjustment(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var points = Math.round(Number(data.points));
  if (!isFinite(points) || points === 0) return err('INVALID_AMOUNT');
  if (points < 0 && Math.abs(points) > (Number(c.currentPoints) || 0)) {
    return err('INVALID_AMOUNT', 'Adjustment exceeds current points. / 调整超过现有积分。');
  }

  var reason = String(data.reason || '').slice(0, 200);
  var before = Number(c.currentPoints) || 0;
  issuePoints(c, null, points, reason || 'Manual adjustment',
              ctx.staff.staffId, 'STAFF', 'ADJUSTMENT');
  audit(ctx.staff.staffId, 'STAFF', 'POINT_ADJUST', 'CUSTOMER', c.customerId, before,
        c.currentPoints + ' | ' + reason);

  return ok({ customer: publicCustomer(c), membership: membershipInfo(c) });
}

/* -------------------------------------------------------------
   设置
   ------------------------------------------------------------- */

function getSettings(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;
  var list = DB.settings.map(function (r) {
    return { key: r.key, value: r.value, description: r.description || SETTING_DESC[r.key] || '' };
  });
  return ok({ settings: list });
}

var NUMERIC_SETTINGS = ['POINTS_PER_RM', 'CLAIM_EXPIRY_HOURS', 'REWARD_MIN_SPEND',
  'DAILY_REWARD_BUDGET', 'MAX_WALLET_USAGE_PERCENT', 'MIN_WALLET_REDEEM_BILL',
  'MEMBER_THRESHOLD', 'SILVER_THRESHOLD', 'GOLD_THRESHOLD', 'LOW_REWARD_MODE_MAX',
  'REWARD_EXPIRY_DAYS', 'CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS', 'LOGIN_LOCK_MINUTES'];

function updateSetting(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var key = String(data.key || '');
  var known = DB._settings[key] !== undefined || SETTING_DESC[key] !== undefined;
  if (!known) return err('INVALID_INPUT', 'Unknown setting. / 未知设置。');

  var oldValue = DB._settings[key];
  var value = String(data.value === undefined ? '' : data.value).trim();

  if (NUMERIC_SETTINGS.indexOf(key) !== -1) {
    if (!isFinite(Number(value)) || Number(value) < 0) {
      return err('INVALID_INPUT', 'Must be a number. / 必须是数字。');
    }
  }
  if (key === 'REWARD_ENABLED' && ['TRUE', 'FALSE'].indexOf(value.toUpperCase()) === -1) {
    return err('INVALID_INPUT', 'Must be TRUE or FALSE.');
  }
  if (key === 'ALLOWED_COUNTRY_CODES') {
    var codes = value.split(',').map(function (c) { return c.replace(/[^0-9]/g, ''); })
      .filter(function (c) { return c.length > 0; });
    if (!codes.length) return err('INVALID_INPUT', 'At least one country code. / 至少填一个国家码。');
    value = codes.join(',');
  }

  setSetting(key, value);
  audit(ctx.staff.staffId, 'STAFF', 'SETTINGS_CHANGE', 'SETTING', key, oldValue, value);
  return ok({ key: key, value: value });
}

/* -------------------------------------------------------------
   Audit Log
   ------------------------------------------------------------- */

function getAuditLogs(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var limit  = Math.min(500, Math.max(1, Number(data.limit) || 100));
  var action = String(data.action || '');
  var userId = String(data.userId || '');

  var list = dbRecent('audit');
  if (action) list = list.filter(function (l) { return l.action === action; });
  if (userId) list = list.filter(function (l) { return l.userId === userId; });

  return ok({ logs: list.slice(0, limit) });
}

/* -------------------------------------------------------------
   员工账号（Owner）
   ------------------------------------------------------------- */

function listStaff(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;
  return ok({
    staff: DB.staff.map(function (s) {
      return {
        staffId: s.staffId, username: s.username, role: s.role,
        status: s.status, lastLogin: s.lastLogin, createdAt: s.createdAt
      };
    })
  });
}

function createStaff(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var username = String(data.username || '').trim().toLowerCase();
  var password = String(data.password || '');
  var role = String(data.role || 'STAFF').toUpperCase();

  if (username.length < 3) return err('INVALID_INPUT', 'Username too short. / 账号太短。');
  if (password.length < 8) return err('INVALID_INPUT', 'Password min 8 chars. / 密码至少 8 位。');
  if (['OWNER', 'MANAGER', 'STAFF'].indexOf(role) === -1) return err('INVALID_ROLE');
  if (dbFind('staff', function (s) { return String(s.username).toLowerCase() === username; })) {
    return err('USERNAME_TAKEN');
  }

  var salt = randomToken(8);
  var s = dbInsert('staff', {
    staffId: dbNextId('STF', 'staff', 4),
    username: username,
    salt: salt,
    passwordHash: hashPassword(password, salt),
    role: role,
    status: 'ACTIVE',
    lastLogin: '',
    createdAt: nowISO()
  });
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_STAFF', 'STAFF', s.staffId, '', username + '/' + role);
  return ok({ staffId: s.staffId, username: s.username, role: s.role });
}

function setStaffStatus(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var s = dbById('staff', String(data.staffId || ''));
  if (!s) return err('STAFF_NOT_FOUND');
  if (s.role === 'OWNER' && s.staffId === ctx.staff.staffId) {
    return err('INVALID_INPUT', 'You cannot disable your own owner account. / 不能停用自己的老板账号。');
  }

  var old = s.status;
  s.status = String(data.status) === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
  if (s.status === 'DISABLED') {
    dbFilter('sessions', function (x) { return x.userId === s.staffId && x.status === 'ACTIVE'; })
      .forEach(function (x) { x.status = 'LOGGED_OUT'; });
  }
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_STAFF', 'STAFF', s.staffId, old, s.status);
  return ok({ staffId: s.staffId, status: s.status });
}

function resetStaffPassword(data, token) {
  var ctx = requireStaff(token, ['OWNER']);
  if (ctx.error) return ctx.error;

  var s = dbById('staff', String(data.staffId || ''));
  if (!s) return err('STAFF_NOT_FOUND');
  var password = String(data.password || '');
  if (password.length < 8) return err('INVALID_INPUT', 'Password min 8 chars. / 密码至少 8 位。');

  s.salt = randomToken(8);
  s.passwordHash = hashPassword(password, s.salt);
  dbFilter('sessions', function (x) { return x.userId === s.staffId && x.status === 'ACTIVE'; })
    .forEach(function (x) { x.status = 'LOGGED_OUT'; });
  audit(ctx.staff.staffId, 'STAFF', 'RESET_PASSWORD', 'STAFF', s.staffId, '', '');
  return ok({ staffId: s.staffId });
}

/* -------------------------------------------------------------
   会员密码（员工协助重设）
   -------------------------------------------------------------
   会员忘记密码、或号码被别人先注册时，由 Manager / Owner 在这里重设。
   重设之后该会员的所有 session 会立刻失效，必须用新密码重新登录。
   ------------------------------------------------------------- */

function resetCustomerPassword(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('customers', String(data.customerId || ''));
  if (!c) return err('CUSTOMER_NOT_FOUND');

  var password = String(data.password || '');
  var minLen = numSetting('CUSTOMER_PASSWORD_MIN', 8);
  if (password.length < minLen) {
    return err('PASSWORD_TOO_SHORT',
      'Password min ' + minLen + ' chars. / 密码至少 ' + minLen + ' 位。');
  }

  setPassword(c, password);
  dbFilter('sessions', function (x) {
    return x.userId === c.customerId && x.userType === 'CUSTOMER' && x.status === 'ACTIVE';
  }).forEach(function (x) { x.status = 'LOGGED_OUT'; });

  audit(ctx.staff.staffId, 'STAFF', 'RESET_CUSTOMER_PASSWORD', 'CUSTOMER', c.customerId, '', '');
  return ok({ customerId: c.customerId, passwordReset: true });
}
