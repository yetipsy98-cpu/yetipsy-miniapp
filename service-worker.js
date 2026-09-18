/* =============================================================
   YETIPSY — service-worker.js
   -------------------------------------------------------------
   只 Cache 静态 App Shell（HTML / CSS / JS / 图标）
   绝不 Cache：
     · API 请求（POST）
     · Wallet / Customer / Staff 任何敏感数据
   ============================================================= */

var CACHE_NAME = 'yetipsy-v2.1.17';   // 改版就 +1，让旧快取自动清掉

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
  './admin/audit.html',
  './admin/settings.html',
  './admin/staff.html',
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

  /* ----------------------------------------------------------------
     4) 页面导航 / 程式码 → 「先给快取，背景偷偷更新」（2.1.17）
     ----------------------------------------------------------------
     以前导航与 js/css 都是 network first：从 HOME 点「下单」「我的订单」，
     每一次都要等 Google 那边回应（1~2 秒）才看得到画面 —— 现场的感觉
     就是「等」。现在：

       · 快取里有 → 立刻画出来（0 毫秒），同时背景再抓一份最新的存起来，
         下一次点进来就是最新的。
       · 快取里没有（第一次安装 / 刚清过资料）→ 走网络，回来顺手存下。

     改版不会因此看到旧画面：每个新版本都会换 CACHE_NAME（yetipsy-vX），
     install 会重新预载整个 shell、activate 会把旧快取删掉，
     加上页面用的都是 `?v=` 版本号，所以「先给快取」给的永远是自己那版。
     ================================================================ */
  function isCodeRequest(u) {
    return /\.(js|css|html)(\?|$)/i.test(u.pathname) ||
      u.pathname === '/' || u.pathname === '' || u.pathname.slice(-1) === '/';
  }

  function revalidate(req, cache) {
    return fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone());
      }
      return res;
    });
  }

  if (req.mode === 'navigate' || isCodeRequest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) {
            /* 先画快取（0 等待）；背景再抓一份最新的存起来，不挡画面 */
            event.waitUntil(revalidate(req, cache).catch(function () {}));
            return hit;
          }
          return revalidate(req, cache).catch(function () {
            /* 真的连不上：导航至少给首页，不要白画面 */
            return caches.match('./index.html');
          });
        });
      })
    );
    return;
  }

  // 6) 其他静态资源（图标 / manifest）→ Stale-while-revalidate（先给快取）
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
