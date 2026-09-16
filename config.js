/* =============================================================
   YETIPSY MINI APP 1.1 — FOODCOURT EDITION
   config.js
   -------------------------------------------------------------
   这是唯一需要你手动修改的前端文件（部署时）。

   API_URL 留空  = DEMO 模式（数据存在本地 demo 服务器，用来试用/演示）
   API_URL 填入  = 连接 Google Apps Script Web App（真实环境）
   ============================================================= */

var YETIPSY_CONFIG = {

  /* ----------------------------------------------------------
     1) API 地址
     部署 Google Apps Script 之后，把 Web App URL 粘贴到这里
     例如：
     API_URL: 'https://script.google.com/macros/s/AKfycbw2WXwgeHls1AvyAl_dcNW0q2Fd4KOsurqPXky28MqDo6wxMPuVICAhyfr-xex34qgSuw/exec'
     ---------------------------------------------------------- */
  API_URL: 'https://script.google.com/macros/s/AKfycbw2WXwgeHls1AvyAl_dcNW0q2Fd4KOsurqPXky28MqDo6wxMPuVICAhyfr-xex34qgSuw/exec',

  /* ----------------------------------------------------------
     2) 品牌
     ---------------------------------------------------------- */
  BAR_NAME: 'YETIPSY',
  TAGLINE: 'Join the night.',
  CURRENCY: 'RM',
  COUNTRY_CODE: '+60',
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
    LANGUAGE:         'yt_lang'
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

/* 是否运行在 DEMO 模式（没有填 GAS URL） */
YETIPSY_CONFIG.IS_DEMO = function () {
  return !YETIPSY_CONFIG.API_URL || YETIPSY_CONFIG.API_URL.indexOf('http') !== 0;
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
