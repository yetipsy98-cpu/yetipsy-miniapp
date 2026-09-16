/* =============================================================
   YETIPSY MINI APP 1.1 — FOODCOURT EDITION
   config.js
   -------------------------------------------------------------
   这是唯一需要你手动修改的前端文件（部署时）。

   ★ 线上版（正式环境）：
       API_URL       填入 Google Apps Script Web App 的 URL
       REQUIRE_BACKEND = true   ← 没连上后端就明确报错，绝不偷偷用本机资料

   ★ DEMO 模式（本机试用）：
       用 `npm run demo` 起本机服务器，或打开 preview.html。
       正式页面（index.html 等）在 REQUIRE_BACKEND = true 时
       不会退回 DEMO，避免「以为在用线上版，其实资料只存在自己手机」。
   ============================================================= */

var YETIPSY_CONFIG = {

  /* ----------------------------------------------------------
     1) 环境
     'production' = 正式上线（GitHub Pages + Google Apps Script）
     'demo'       = 本机演示
     ---------------------------------------------------------- */
  ENVIRONMENT: 'production',

  /* ----------------------------------------------------------
     2) API 地址（Google Apps Script Web App）
     部署之后把 URL 粘贴到这里。
     在浏览器直接打开这个 URL，应该会看到 {"success":true,"data":{"app":"YETIPSY MINI APP",...}}
     ---------------------------------------------------------- */
  API_URL: 'https://script.google.com/macros/s/AKfycbw2WXwgeHls1AvyAl_dcNW0q2Fd4KOsurqPXky28MqDo6wxMPuVICAhyfr-xex34qgSuw/exec',

  /* ----------------------------------------------------------
     3) 线上版必须连上后端
     true  = API_URL 没填 / 连不上时，直接显示错误，不使用本机演示资料
     false = 允许退回 DEMO（只在本机开发时打开）
     ---------------------------------------------------------- */
  REQUIRE_BACKEND: true,

  /* ----------------------------------------------------------
     4) 品牌
     ---------------------------------------------------------- */
  BAR_NAME: 'YETIPSY',
  TAGLINE: 'Join the night.',
  CURRENCY: 'RM',
  /* 支援的国家码（要和后端 Settings 的 ALLOWED_COUNTRY_CODES 一致） */
  COUNTRY_CODE: '+60',
  COUNTRY_CODES: ['+60', '+65'],

  /* 登录方式：手机号码 + 密码（不使用 WhatsApp / SMS OTP）。
     密码长度以后端 Settings.CUSTOMER_PASSWORD_MIN 为准，
     这里只是前端提示用（getPublicSettings 会回传真实值）。 */
  AUTH_MODE: 'PHONE_PASSWORD',
  PASSWORD_MIN_LENGTH: 8,

  API_TIMEOUT_MS: 15000,
  TIMEZONE: 'Asia/Kuala_Lumpur',

  /* ----------------------------------------------------------
     5) 主题（会员端）
     ---------------------------------------------------------- */
  TIER_COLORS: {
    MEMBER: '#A7A7A7',
    SILVER: '#C9CFD6',
    GOLD:   '#E5B769'
  },

  /* ----------------------------------------------------------
     6) Session 存储 key
     ---------------------------------------------------------- */
  STORAGE: {
    CUSTOMER_TOKEN:   'yt_customer_token',
    CUSTOMER_PROFILE: 'yt_customer_profile',
    STAFF_TOKEN:      'yt_staff_token',
    STAFF_PROFILE:    'yt_staff_profile',
    LANGUAGE:         'yt_lang'
  },

  /* ----------------------------------------------------------
     7) Session 有效期（小时，仅前端提示用，后端才是权威）
     ---------------------------------------------------------- */
  CUSTOMER_SESSION_HOURS: 720,   // 30 天
  STAFF_SESSION_HOURS:     12,   // 当班

  /* ----------------------------------------------------------
     8) 二维码内容（扫描后打开的页面）
     一般不需要修改。GitHub Pages 子目录部署时才需要改。
     ---------------------------------------------------------- */
  CLAIM_PAGE: 'claim.html',

  /* ----------------------------------------------------------
     9) 调试
     ---------------------------------------------------------- */
  DEBUG: false
};

/* 是否运行在 DEMO 模式（没有填 GAS URL） */
YETIPSY_CONFIG.IS_DEMO = function () {
  return !YETIPSY_CONFIG.API_URL || YETIPSY_CONFIG.API_URL.indexOf('http') !== 0;
};

/* 线上版但没填 API URL —— 这是设定错误，要大声报错 */
YETIPSY_CONFIG.IS_MISCONFIGURED = function () {
  return YETIPSY_CONFIG.IS_DEMO() && YETIPSY_CONFIG.REQUIRE_BACKEND !== false;
};

/* 实际请求地址 */
YETIPSY_CONFIG.getApiUrl = function () {
  return YETIPSY_CONFIG.IS_DEMO() ? 'api' : YETIPSY_CONFIG.API_URL;
};

/* 生成 Claim QR 内容（完整 URL）
   注意：员工端在 /admin/ 目录下，QR 必须指向根目录的 claim.html */
YETIPSY_CONFIG.buildClaimUrl = function (token) {
  var path = location.pathname.replace(/[^/]*$/, '');   // '/admin/' 或 '/'
  if (path.indexOf('/admin/') !== -1) {
    path = path.replace(/\/admin\/$/, '/');
  }
  return location.origin + path + YETIPSY_CONFIG.CLAIM_PAGE + '?token=' + encodeURIComponent(token);
};
