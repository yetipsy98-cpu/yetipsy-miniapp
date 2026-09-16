/* =============================================================
   YETIPSY MINI APP 1.1 — Security.gs
   -------------------------------------------------------------
   Session · 角色权限 · Rate limit
   （Token 一律只存 SHA-256 hash，资料库里没有明文 token）
   ============================================================= */

/* -------------------------------------------------------------
   1. Session
   ------------------------------------------------------------- */

function createSession(userType, userId) {
  var token = randomToken(32);                      // 64 hex
  var hours = userType === 'STAFF' ? STAFF_SESSION_HOURS : CUSTOMER_SESSION_HOURS;
  dbInsert('sessions', {
    sessionId:  dbNextId('SES', 'session'),
    userType:   userType,
    userId:     userId,
    tokenHash:  sha256(token),
    status:     'ACTIVE',
    createdAt:  nowISO(),
    expiresAt:  new Date(Date.now() + hours * 3600000).toISOString(),
    lastUsedAt: nowISO()
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  var hash = sha256(token);
  var s = dbFind('sessions', function (x) { return x.tokenHash === hash && x.status === 'ACTIVE'; });
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    s.status = 'EXPIRED';
    return null;
  }
  s.lastUsedAt = nowISO();
  return s;
}

function destroySession(token) {
  var hash = sha256(token);
  var s = dbFind('sessions', function (x) { return x.tokenHash === hash; });
  if (s) s.status = 'LOGGED_OUT';
}

function requireCustomer(token) {
  var s = getSession(token);
  if (!s || s.userType !== 'CUSTOMER') return { error: err('INVALID_SESSION') };
  var c = dbById('customers', s.userId);
  if (!c || c.status === 'MERGED') return { error: err('INVALID_SESSION') };
  return { session: s, customer: c };
}

/**
 * @param {string[]} [roles] 需要的角色；空 = 任何在职员工
 */
function requireStaff(token, roles) {
  var s = getSession(token);
  if (!s || s.userType !== 'STAFF') return { error: err('INVALID_SESSION') };
  var st = dbById('staff', s.userId);
  if (!st || st.status !== 'ACTIVE') return { error: err('INVALID_SESSION') };
  if (roles && roles.length && roles.indexOf(st.role) === -1) {
    return { error: err('UNAUTHORIZED', 'Manager or Owner permission required. / 需要经理或老板权限。') };
  }
  return { session: s, staff: st };
}

/* -------------------------------------------------------------
   2. Rate limit（用 CacheService，跨请求有效）
   ------------------------------------------------------------- */

function rateLimitGet(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function rateLimitSet(key, value, ttlSeconds) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(value), Math.min(21600, ttlSeconds)); }
  catch (e) { /* cache 不可用时不阻断流程 */ }
}

function rateLimitClear(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

/**
 * 记录一次失败。回传 true = 已达上限（应拒绝）。
 */
function rateLimitFail(key, maxAttempts, lockSeconds) {
  var rec = rateLimitGet(key) || { count: 0, until: 0 };
  rec.count = (rec.count || 0) + 1;
  var locked = false;
  if (rec.count >= maxAttempts) {
    rec.until = Date.now() + lockSeconds * 1000;
    locked = true;
  }
  rateLimitSet(key, rec, lockSeconds * 2);
  return locked;
}

/** 回传 true = 目前被锁定 */
function rateLimitLocked(key) {
  var rec = rateLimitGet(key);
  return !!(rec && rec.until && Date.now() < rec.until);
}
