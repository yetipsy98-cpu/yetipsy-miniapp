/* =============================================================
   YETIPSY — service-worker.js
   -------------------------------------------------------------
   只 Cache 静态 App Shell（HTML / CSS / JS / 图标）
   绝不 Cache：
     · API 请求（POST）
     · Wallet / Customer / Staff 任何敏感数据
   ============================================================= */

var CACHE_NAME = 'yetipsy-v2.1.9';   // 改版就 +1，让旧快取自动清掉

var SHELL = [
  './',
  './index.html',
  './login.html',
  './claim.html',
  './reward.html',
  './wallet.html',
  './activity.html',
  './profile.html',
  './code.html',
  './menu.html',
  './product.html',
  './cart.html',
  './checkout.html',
  './order.html',
  './orders.html',
  './admin/redeem.html',
  './admin/orderboard.html',
  './admin/menu.html',
  './admin/analytics.html',
  './admin/index.html',
  './admin/more.html',
  './admin/login.html',
  './admin/pos.html',
  './admin/claim.html',
  './admin/customers.html',
  './admin/orders.html',
  './css/app.css',
  './css/admin.css',
  './js/config.js',
  './js/api.js',
  './js/auth.js',
  './js/ui.js',
  './js/app.js',
  './js/claim.js',
  './js/reward.js',
  './js/wallet.js',
  './js/activity.js',
  './js/profile.js',
  './js/code.js',
  './js/menu.js',
  './js/product.js',
  './js/cart.js',
  './js/cart-page.js',
  './js/admin-orderboard.js',
  './js/admin-menu.js',
  './js/admin-analytics.js',
  './js/admin-pos.js',
  './js/scanner.js',
  './js/checkout.js',
  './js/order.js',
  './js/orders.js',
  './js/admin-redeem.js',
  './js/admin.js',
  './js/admin-dashboard.js',
  './js/admin-claim.js',
  './js/admin-customer.js',
  './js/admin-orders.js',
  './js/admin-settings.js',
  './js/admin-audit.js',
  './js/admin-staff.js',
  './js/vendor/qrcode.js',
  './js/vendor/jsbarcode.min.js',
  './js/vendor/jsQR.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

/* ---------------- INSTALL ---------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 个别文件失败不阻断安装
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------------- ACTIVATE ---------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------------- FETCH ---------------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 1) 非 GET（API POST）→ 永不缓存，直接走网络
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // 2) 跨域（Google Apps Script API）→ 永不缓存
  if (url.origin !== self.location.origin) return;

  // 3) 本站 /api（demo 后端）→ 永不缓存
  if (url.pathname.indexOf('/api') !== -1) return;

  // 4) 页面导航 → Network first，离线时回退 cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 5) 程式码（.js / .css / .html）→ Network first
  //    ★ 以前这里是 cache-first，结果改版后浏览器还在跑旧的 js/api.js，
  //      新页面呼叫 API.customer.checkPhone 就变成「点了没反应」。
  //      程式码一律先走网络，只有断线才用快取。
  var isCode = /\.(js|css|html)(\?|$)/i.test(url.pathname) ||
    url.pathname === '/' || url.pathname === '';

  if (isCode) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 6) 其他静态资源（图标 / manifest）→ Stale-while-revalidate
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
