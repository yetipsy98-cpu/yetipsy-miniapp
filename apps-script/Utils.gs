/* =============================================================
   YETIPSY MINI APP 1.3 — Utils.gs
   -------------------------------------------------------------
   时间 · 金额(SEN) · Hash · ID · 电话号码规范化 · 错误讯息
   ============================================================= */

/* -------------------------------------------------------------
   1. 基本工具
   ------------------------------------------------------------- */

function pad(n, len) {
  var s = String(n);
  while (s.length < (len || 6)) s = '0' + s;
  return s;
}

function nowISO() { return new Date().toISOString(); }

/** 随机 token（64 hex = 32 bytes）。资料库只存 hash，不存原文。 */
function randomToken(bytes) {
  var n = bytes || 24;
  var raw = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  // Utilities.getUuid() 只有 122 bits 熵，补上 Math.random 提高不可预测性
  var extra = '';
  while (extra.length < n * 2) extra += Math.floor(Math.random() * 1e16).toString(16);
  return (raw + extra).slice(0, n * 2);
}

function sha256(str) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function hashPassword(password, salt) {
  return sha256(salt + '|' + password + '|' + salt);
}

/** 金额：RM 字串 → sen 整数。非法回传 null */
function toSen(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Math.round(Number(value));
  return isFinite(n) ? n : null;
}

function timezone() {
  try { return String(setting('TIMEZONE', 'Asia/Kuala_Lumpur')); }
  catch (e) { return 'Asia/Kuala_Lumpur'; }
}

/** 当地「今天」YYYY-MM-DD */
function todayKey(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return dateKey(d);
}

/** 任意 ISO 时间 → 当地日期 YYYY-MM-DD */
function isoDateKey(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return dateKey(d);
}

function dateKey(d) {
  try {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    var y = '', m = '', dd = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') dd = p.value;
    });
    return y + '-' + m + '-' + dd;
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

function safeJson(text, fallback) {
  try {
    var v = JSON.parse(text);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) { return fallback; }
}

/* -------------------------------------------------------------
   2. 电话号码规范化（★ 防重复注册的核心）
   -------------------------------------------------------------
   会员身份 = 电话号码。同一个人可能用很多种写法输入同一个号码：

     0123456789  /  60123456789  /  +60123456789  /  0060 12-345 6789

   全部必须被规范化成同一个 E.164 字串：  +60123456789

   否则「同一个号码」会在 Customers Sheet 产生多列（重复注册），
   积分与钱包也会被拆到不同的会员帐号上。
   ------------------------------------------------------------- */

/**
 * @param {string} input 使用者输入的任何格式
 * @param {string} [defaultCountry] 预设国家码（不带 +），例如 '60'
 * @return {{ok:boolean, phone:string, countryCode:string, reason:string}}
 */
function normalizePhoneE164(input, defaultCountry) {
  var raw = String(input === null || input === undefined ? '' : input).trim();
  var hadPlus = raw.indexOf('+') === 0;
  var digits = raw.replace(/[^0-9]/g, '');

  var def = String(defaultCountry || setting('DEFAULT_COUNTRY_CODE', '60')).replace(/[^0-9]/g, '');
  var allowed = String(setting('ALLOWED_COUNTRY_CODES', '60,65'))
    .split(',').map(function (c) { return c.replace(/[^0-9]/g, ''); })
    .filter(function (c) { return c.length > 0; });
  if (allowed.indexOf(def) === -1) allowed.unshift(def);

  if (!digits) return phoneFail('EMPTY');

  /* 00xx = 国际拨号前缀 */
  if (!hadPlus && digits.indexOf('00') === 0) {
    digits = digits.slice(2);
    hadPlus = true;
  }

  var country = '';
  var local = digits;

  if (hadPlus) {
    /* 带 + ：从最长（3 位）到最短（1 位）尝试匹配允许的国家码 */
    var matched = false;
    [3, 2, 1].forEach(function (len) {
      if (matched) return;
      var cand = digits.slice(0, len);
      if (allowed.indexOf(cand) !== -1 && digits.length > len) {
        country = cand;
        local = digits.slice(len);
        matched = true;
      }
    });
    if (!matched) return phoneFail('UNSUPPORTED_COUNTRY');
  } else {
    /* 没有 + ：可能是 60123456789 / 0123456789 / 123456789 */
    var hit = null;
    allowed.forEach(function (c) {
      if (!hit && digits.indexOf(c) === 0 && digits.length > c.length + 6) hit = c;
    });
    if (hit) {
      country = hit;
      local = digits.slice(hit.length);
    } else {
      country = def;
      local = digits.replace(/^0+/, '');       // 本地写法：去掉前面的 0
    }
  }

  if (!local) return phoneFail('EMPTY');

  /* 本地号码长度 / 开头检查 */
  if (country === '60') {
    // 马来西亚手机：1x-xxxxxxx / 1x-xxxxxxxx（9–10 位，1 开头）
    if (!/^1[0-9]{8,9}$/.test(local)) return phoneFail('INVALID_LENGTH');
  } else if (country === '65') {
    // 新加坡手机：8 或 9 位，8/9 开头
    if (!/^[89][0-9]{7,8}$/.test(local)) return phoneFail('INVALID_LENGTH');
  } else {
    if (local.length < 7 || local.length > 12) return phoneFail('INVALID_LENGTH');
  }

  return { ok: true, phone: '+' + country + local, countryCode: country, reason: '' };
}

function phoneFail(reason) {
  return { ok: false, phone: '', countryCode: '', reason: reason };
}

/* -------------------------------------------------------------
   3. 统一回应格式
   ------------------------------------------------------------- */

function ok(data) { return { success: true, data: data || {}, error: null }; }
function fail(code, msg) {
  return { success: false, data: null, error: { code: code, message: msg || code } };
}

var ERR = {
  INVALID_SESSION:         ['INVALID_SESSION', 'Session expired. Please log in again. / 请重新登录。'],
  UNAUTHORIZED:            ['UNAUTHORIZED', 'You do not have permission. / 权限不足。'],
  INVALID_PHONE:           ['INVALID_PHONE', 'Invalid mobile number. / 手机号码无效。'],
  PHONE_ALREADY_REGISTERED:['PHONE_ALREADY_REGISTERED', 'This number is already registered. / 此号码已注册，请直接登录。'],
  WRONG_PASSWORD:          ['WRONG_PASSWORD', 'Wrong password. / 密码错误。'],
  PASSWORD_REQUIRED:       ['PASSWORD_REQUIRED', 'Password required. / 请输入密码。'],
  PASSWORD_TOO_SHORT:      ['PASSWORD_TOO_SHORT', 'Password is too short. / 密码太短。'],
  PASSWORD_SETUP_REQUIRED: ['PASSWORD_SETUP_REQUIRED', 'Please set your password first. / 请先设定密码。'],
  PASSWORD_CHANGE_STAFF:   ['PASSWORD_CHANGE_STAFF', 'Please ask our staff to reset your password. / 请联系店员重设密码。'],
  INVALID_AMOUNT:          ['INVALID_AMOUNT', 'Invalid amount. / 金额无效。'],
  INVALID_INPUT:           ['INVALID_INPUT', 'Invalid input. / 输入无效。'],
  ORDER_NOT_FOUND:         ['ORDER_NOT_FOUND', 'Order not found. / 找不到订单。'],
  DUPLICATE_EXTERNAL_ORDER:['DUPLICATE_EXTERNAL_ORDER', 'This order number already exists. / 此订单号已存在。'],
  CLAIM_NOT_FOUND:         ['CLAIM_NOT_FOUND', 'Claim not found. / 找不到此认领。'],
  CLAIM_EXPIRED:           ['CLAIM_EXPIRED', 'This claim has expired. / 此认领已过期。'],
  CLAIM_ALREADY_USED:      ['CLAIM_ALREADY_USED', 'This order has already been claimed. / 此订单已被认领。'],
  INVALID_CLAIM_TOKEN:     ['INVALID_CLAIM_TOKEN', 'Invalid QR code. / 二维码无效。'],
  REWARD_NOT_FOUND:        ['REWARD_NOT_FOUND', 'Reward not found. / 找不到奖励。'],
  REWARD_ALREADY_CLAIMED:  ['REWARD_ALREADY_CLAIMED', 'Reward already claimed. / 奖励已被领取。'],
  INSUFFICIENT_WALLET:     ['INSUFFICIENT_WALLET', 'Insufficient wallet balance. / 钱包余额不足。'],
  WALLET_LIMIT_EXCEEDED:   ['WALLET_LIMIT_EXCEEDED', 'Wallet usage exceeds the allowed limit. / 超出钱包可抵扣上限。'],
  CUSTOMER_NOT_FOUND:      ['CUSTOMER_NOT_FOUND', 'Member not found. / 找不到会员。'],
  INVALID_ROLE:            ['INVALID_ROLE', 'Invalid role. / 角色无效。'],
  RATE_LIMITED:            ['RATE_LIMITED', 'Too many attempts. Please wait. / 尝试次数过多，请稍后再试。'],
  STAFF_NOT_FOUND:         ['STAFF_NOT_FOUND', 'Staff account not found. / 找不到员工账号。'],
  USERNAME_TAKEN:          ['USERNAME_TAKEN', 'Username already exists. / 账号已存在。'],
  SETUP_REQUIRED:          ['SETUP_REQUIRED', 'Database is not set up yet. Run setupDatabase() first. / 资料库尚未初始化。'],
  UNKNOWN_ACTION:          ['UNKNOWN_ACTION', 'Unknown action. / 未知的 API 动作。']
};

function err(key, customMessage) {
  var e = ERR[key] || ['UNKNOWN', 'Unknown error.'];
  return fail(e[0], customMessage || e[1]);
}
