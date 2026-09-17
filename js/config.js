/* =============================================================
   YETIPSY MINI APP — config.js
   -------------------------------------------------------------
   这是唯一需要你手动修改的前端文件（部署时）。

   线上版（正式环境）：
       API_URL       填入 Google Apps Script Web App 的 URL
   没填 / 填错时，API 层会直接报 BACKEND_NOT_CONFIGURED，
   不会退回任何本机假资料 —— 避免「以为在用线上版，
   其实资料只存在自己手机」。

   部署方式见 DEPLOYMENT.md。
   ============================================================= */

var YETIPSY_CONFIG = {

  /* ----------------------------------------------------------
     0) 版本号码
     要和 package.json / service-worker.js / apps-script/Config.gs 的
     APP_VERSION 一致；员工端「MORE」页会拿它跟后端比，不一样就提示
     要重新贴 Apps Script。检查：npm run check:backend
     ---------------------------------------------------------- */
  APP_VERSION: '2.1.5',

  /* ----------------------------------------------------------
     1) API 地址（Google Apps Script Web App）
     部署之后把 URL 粘贴到这里。
     在浏览器直接打开这个 URL，应该会看到
     {"success":true,"data":{"app":"YETIPSY MINI APP",...}}
     ---------------------------------------------------------- */
  API_URL: 'https://script.google.com/macros/s/AKfycbw2WXwgeHls1AvyAl_dcNW0q2Fd4KOsurqPXky28MqDo6wxMPuVICAhyfr-xex34qgSuw/exec',

  /* ----------------------------------------------------------
     2) 品牌
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
     3) 主题（会员端）
     ---------------------------------------------------------- */
  TIER_COLORS: {
    MEMBER: '#A7A7A7',
    SILVER: '#C9CFD6',
    GOLD:   '#E5B769'
  },

  /* ----------------------------------------------------------
     4) Session 存储 key
     ---------------------------------------------------------- */
  STORAGE: {
    CUSTOMER_TOKEN:   'yt_customer_token',
    CUSTOMER_PROFILE: 'yt_customer_profile',
    STAFF_TOKEN:      'yt_staff_token',
    STAFF_PROFILE:    'yt_staff_profile',
    LANGUAGE:         'yt_lang',
    /* 点单：购物车（只存显示用的数字，价格一律由后端重算） */
    cart:             'yt_cart_v2'
  },

  /* ----------------------------------------------------------
     5) Session 有效期（小时，仅前端提示用，后端才是权威）
     ---------------------------------------------------------- */
  CUSTOMER_SESSION_HOURS: 720,   // 30 天
  STAFF_SESSION_HOURS:     12,   // 当班

  /* ----------------------------------------------------------
     6) 二维码内容（扫描后打开的页面）
     一般不需要修改。GitHub Pages 子目录部署时才需要改。
     ---------------------------------------------------------- */
  CLAIM_PAGE: 'claim.html',

  /* ----------------------------------------------------------
     7) 调试
     ---------------------------------------------------------- */
  DEBUG: false
};

/* API_URL 没填 / 格式不对 —— 这是设定错误，要大声报错 */
YETIPSY_CONFIG.IS_MISCONFIGURED = function () {
  return !YETIPSY_CONFIG.API_URL || YETIPSY_CONFIG.API_URL.indexOf('http') !== 0;
};

/* 实际请求地址（页面在 /admin/ 底下时也是打同一个 Web App URL） */
YETIPSY_CONFIG.getApiUrl = function () {
  return YETIPSY_CONFIG.API_URL;
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
