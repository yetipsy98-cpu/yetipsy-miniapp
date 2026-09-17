/* =============================================================
   tools/check-backend.js
   -------------------------------------------------------------
   「GitHub 上的 .gs 是不是最新版、跟前端合不合」的自动检查。

   执行： node tools/check-backend.js      （或 npm run check:backend）

   它检查 6 件事：
     1. apps-script/ 里每个 .gs 都有被载入 / 被复制贴上文件收录（没有漏档）
     2. Code.gs 的 action 表里每个函数真的存在（少贴档案会在这里爆）
     3. 前端 js/*.js 呼叫的每个 action，后端都有实作
     4. 版本号码一致：Config.gs APP_VERSION = package.json =
        js/config.js = service-worker 快取名 = 每个 .gs 的档头
     5. APPS-SCRIPT-COPY-PASTE.md 跟 apps-script/*.gs 一模一样（没过期）
     6. 跑一次「真正的后端」端到端：老板登录 → 建菜单 → POS 进单 →
        扫会员码进分 → 会员点单 → 员工看板完成（用的是 apps-script/*.gs 本身）

   任何一项失败都会 exit 1，并印出要修什么。
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadBackend, FILE_ORDER, BACKEND_DIR } = require('./load-backend');
const { render, OUT } = require('./build-copypaste');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? '  → ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* -------------------------------------------------------------
   1. 档案齐全
   ------------------------------------------------------------- */
function checkFiles() {
  section('① 后端档案（apps-script/*.gs）');

  const onDisk = fs.readdirSync(BACKEND_DIR).filter((f) => f.endsWith('.gs')).sort();
  const loaded = FILE_ORDER.slice().sort();

  const notLoaded = onDisk.filter((f) => loaded.indexOf(f) === -1);
  const missing = loaded.filter((f) => onDisk.indexOf(f) === -1);

  check('apps-script/ 的 ' + onDisk.length + ' 个 .gs 全部被载入', notLoaded.length === 0,
    notLoaded.join(', '));
  check('载入清单里的档案都存在', missing.length === 0, missing.join(', '));
  check('appsscript.json 存在（部署设定）', fs.existsSync(path.join(BACKEND_DIR, 'appsscript.json')));

  return onDisk;
}

/* -------------------------------------------------------------
   2 + 3. action 表 / 前端呼叫
   ------------------------------------------------------------- */
function checkActions(bundle) {
  section('② Code.gs action 表');

  const handlers = bundle.api.handlers();
  const names = Object.keys(handlers);

  const notFunction = names.filter((n) => typeof handlers[n] !== 'function');
  check(names.length + ' 个 action 都指向真的函数', notFunction.length === 0,
    notFunction.length ? '少了这些函数：' + notFunction.join(', ') : '');

  section('③ 前端呼叫的 action');

  const jsDir = path.join(ROOT, 'js');
  const files = fs.readdirSync(jsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('js', f))
    .concat(fs.readdirSync(path.join(ROOT, 'js'))
      .filter(() => false));   // 保留结构，方便日后加子目录

  const called = new Map();
  const re = /(?:call|API\.call|send)\(\s*["']([A-Za-z][A-Za-z0-9_]*)["']/g;
  files.forEach((rel) => {
    const src = read(rel);
    let m;
    while ((m = re.exec(src))) {
      const action = m[1];
      if (!called.has(action)) called.set(action, new Set());
      called.get(action).add(rel);
    }
  });

  const unknown = [...called.keys()].filter((a) => !handlers[a]).sort();
  check('前端用到的 ' + called.size + ' 个 action 后端都有', unknown.length === 0,
    unknown.map((a) => a + ' (' + [...called.get(a)].join(', ') + ')').join(' · '));

  const known = new Set(Object.keys(handlers));
  const rarely = [...known].filter((a) => !called.has(a));
  console.log('    （后端另有 ' + rarely.length + ' 个前端没直接用的 action：' +
    (rarely.join(', ') || '无') + '）');

  return { handlers: handlers, called: called };
}

/* -------------------------------------------------------------
   4. 版本号码一致
   ------------------------------------------------------------- */
function checkVersions(gsFiles) {
  section('④ 版本号码');

  const pkgVersion = JSON.parse(read('package.json')).version;

  const cfg = read('apps-script/Config.gs').match(/var APP_VERSION = '([^']+)'/);
  const appVersion = cfg ? cfg[1] : '(找不到)';

  const fe = read('js/config.js').match(/APP_VERSION:\s*'([^']+)'/);
  const feVersion = fe ? fe[1] : '(找不到)';

  const sw = read('service-worker.js').match(/CACHE_NAME = 'yetipsy-v([^']+)'/);
  const swVersion = sw ? sw[1] : '(找不到)';

  check('Config.gs APP_VERSION = ' + appVersion, appVersion === pkgVersion,
    'package.json 是 ' + pkgVersion);
  check('js/config.js APP_VERSION = ' + feVersion, feVersion === pkgVersion,
    'package.json 是 ' + pkgVersion);
  check('service-worker 快取名 = yetipsy-v' + swVersion, swVersion === pkgVersion,
    'package.json 是 ' + pkgVersion);

  const noStamp = gsFiles.filter((f) => {
    const head = read('apps-script/' + f).split('\n').slice(0, 4).join('\n');
    return head.indexOf('YETIPSY MINI APP ' + appVersion) === -1;
  });
  check('每个 .gs 档头都写着 ' + appVersion, noStamp.length === 0, noStamp.join(', '));

  const docHead = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').slice(0, 400) : '';
  check('复制贴上文件的版本 = ' + appVersion,
    docHead.indexOf('版本 ' + appVersion) >= 0);

  return appVersion;
}

/* -------------------------------------------------------------
   5. 复制贴上文件没有过期
   ------------------------------------------------------------- */
function checkCopyPaste() {
  section('⑤ APPS-SCRIPT-COPY-PASTE.md 是否最新');

  const fresh = render();
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const same = current === fresh.doc;

  check('文件内容 = 现在 apps-script/*.gs 重新产生的内容', same,
    same ? '' : '过期了 → 请执行 npm run build:copypaste 并 commit');
  if (same) {
    console.log('    （' + fresh.files + ' 个档案 · ' + fresh.lines + ' 行 · ' +
      (fresh.bytes / 1024).toFixed(1) + ' KB）');
  }
}

/* -------------------------------------------------------------
   6. 真正的后端端到端（跑 apps-script/*.gs 本身）
   ------------------------------------------------------------- */
function checkEndToEnd() {
  section('⑥ 真实后端端到端（POS 进单 + 会员点单）');

  const { api } = loadBackend();
  const post = (action, data, token) =>
    api.doPost({ action: action, data: data || {}, token: token || '' });

  const okData = (res, label) => {
    if (!res.success) {
      check(label, false, res.error && res.error.code ? res.error.code : JSON.stringify(res).slice(0, 120));
      return null;
    }
    return res.data;
  };

  api.setupDatabase();
  api.bootstrapOwner('owner', 'yetipsy123');

  const ping = okData(post('ping'), 'ping 回版本 ' + '(APP_VERSION)');
  check('ping 回的 version = APP_VERSION', !!ping && !!ping.version, ping && ping.version);

  const login = okData(post('staffLogin', { username: 'owner', password: 'yetipsy123' }), '老板登录');
  const staffToken = login && login.token;

  /* 会员（点单要用会员身分） */
  const reg = okData(post('customerRegister',
    { phone: '0123456789', countryCode: '+60', name: 'Test Member', password: 'Passw0rd!' }),
    '会员注册');
  const custToken = reg && reg.token;
  const customerId = reg && reg.customer && reg.customer.customerId;

  /* 这个检查要能随时跑，所以把点单时间窗改成 24 小时（只影响这次沙盒） */
  api.mutate(function (DB, sb) {
    sb.setSetting('ORDERING_OPEN_TIME', '00:00');
    sb.setSetting('ORDERING_CLOSE_TIME', '00:00');
  });

  /* --- 菜单：分类 / 商品 / 规格 --- */
  const cat = okData(post('createCategory',
    { nameEN: 'Cocktails', nameZH: '鸡尾酒' }, staffToken), '建立分类');
  const prod = okData(post('createProduct', {
    categoryId: cat && cat.category.categoryId,
    nameEN: 'Mojito', nameZH: '莫吉托', price: 1800
  }, staffToken), '建立商品');
  const productId = prod && prod.product.productId;
  const opt = okData(post('createProductOption', {
    productId: productId, optionGroup: 'SIZE', optionGroupNameEN: 'Size', optionGroupNameZH: '尺寸',
    nameEN: 'Large', nameZH: '大杯', priceAdjustment: 400
  }, staffToken), '建立规格（+RM4）');

  const menu = okData(post('getMenu', {}, custToken), 'getMenu');
  const menuOptions = (menu && menu.optionsByProduct && menu.optionsByProduct[productId]) || [];
  check('getMenu 带 optionsByProduct（点餐台规格选单要用，每个商品一组规格）',
    menuOptions.length > 0);
  check('getMenu 的规格带着加价 400（1800 + 400 = 2200）',
    menuOptions.some((o) => Number(o.priceAdjustment) === 400),
    JSON.stringify(menuOptions.map((o) => o.priceAdjustment)));
  check('规格有状态栏位（点餐台只显示 ACTIVE）',
    menuOptions.every((o) => String(o.status || 'ACTIVE').toUpperCase() === 'ACTIVE'));

  /* --- 2.1 POS：点餐台单据（items）→ 队列 --- */
  const ticket = okData(post('createPosTicket', {
    source: 'FOODCOURT', amount: 4000,
    items: [
      { nameEN: 'Mojito', nameZH: '莫吉托', quantity: 2, unitPriceSen: 1800 },
      { nameEN: 'Long Island', nameZH: '长岛冰茶', quantity: 1, unitPriceSen: 2200 }
    ]
  }, staffToken), 'createPosTicket（带 items）');

  check('createPosTicket 把明细回传（items）',
    !!ticket && Array.isArray(ticket.items) && ticket.items.length === 2,
    ticket ? JSON.stringify(ticket.items).slice(0, 120) : '');
  check('明细写进 Note（例：莫吉托×2 · 长岛冰茶×1）',
    !!ticket && /莫吉托×2/.test(ticket.ticket.note || ''),
    ticket && ticket.ticket.note);

  const queue = okData(post('getPosQueue', {}, staffToken), 'getPosQueue');
  check('待进单队列看得到这张单',
    !!queue && (queue.pending || []).some((t) => t.orderId === ticket.ticket.orderId));

  /* --- 会员扫码进分（foodcourt 路径，不扣钱包） --- */
  const code = okData(post('getMemberCode', {}, custToken), 'getMemberCode');
  const scanned = okData(post('scanMemberCode', { payload: code.payload }, staffToken), 'scanMemberCode');
  const bound = okData(post('bindPosTicket', {
    orderId: ticket.ticket.orderId, customerId: customerId, verifyToken: scanned.verifyToken
  }, staffToken), 'bindPosTicket（扫完码进分）');

  check('扫码后进分成功（金额 RM40 → ' + (bound && bound.pointsEarned) + ' 分）',
    !!bound && Number(bound.pointsEarned) > 0);
  check('foodcourt 路径不动钱包（walletUsed = 0）',
    !!bound && Number(bound.walletUsed || 0) === 0);

  const again = post('bindPosTicket', {
    orderId: ticket.ticket.orderId, customerId: customerId, verifyToken: ''
  }, staffToken);
  check('同一张单再绑一次是幂等的（不会重复进分）',
    !again.success || again.data.alreadyBound === true,
    again.error ? again.error.code : JSON.stringify(again.data).slice(0, 80));

  /* --- 会员点单 → 员工看板完成 → 发积分 --- */
  const optionId = (opt && opt.option && opt.option.optionId) ||
    (menuOptions[0] && menuOptions[0].optionId);
  const quoteRes = post('createCheckoutQuote', {
    items: [{ productId: productId, quantity: 1, options: [optionId] }],
    orderType: 'COUNTER', useWallet: false
  }, custToken);
  const quote = okData(quoteRes, 'createCheckoutQuote（规格 +400）');

  check('报价 = 1800 + 400 = 2200 sen', !!quote && Number(quote.finalAmount) === 2200,
    quote ? String(quote.finalAmount) : (quoteRes.error ? quoteRes.error.code : ''));

  const placed = quote ? okData(post('placeOrder', {
    quoteToken: quote.quoteToken, idempotencyKey: quote.idempotencyKey
  }, custToken), 'placeOrder') : null;
  const appOrderId = placed && placed.order && placed.order.appOrderId;

  if (!appOrderId) {
    check('会员下单 → 看板完成 → 发积分', false,
      placed ? 'placeOrder 没回 appOrderId' : 'quote 没成功，后面跳过');
    return;
  }

  okData(post('acceptOrder', { appOrderId: appOrderId }, staffToken), 'acceptOrder');
  okData(post('startPreparing', { appOrderId: appOrderId }, staffToken), 'startPreparing');
  okData(post('markReady', { appOrderId: appOrderId }, staffToken), 'markReady');
  /* §54：收款（这一步才会动钱包）→ 完成（这一步才发积分） */
  okData(post('markPaymentPaid', { appOrderId: appOrderId, paymentMethod: 'CASH' }, staffToken),
    'markPaymentPaid（收款）');
  const done = okData(post('completeOrder', { appOrderId: appOrderId }, staffToken), 'completeOrder（完成）');

  check('完成后发积分（' + (done && done.pointsIssued) + ' 分）',
    !!done && Number(done.pointsIssued) > 0);

  const mine = okData(post('getMyOrders', { limit: 10 }, custToken), 'getMyOrders');
  const myOrder = mine && (mine.orders || []).find((o) => o.appOrderId === appOrderId);
  check('会员看得到自己的订单（状态 ' + (myOrder && myOrder.orderStatus) + '）',
    !!myOrder && myOrder.orderStatus === 'COMPLETED');

  const analytics = okData(post('getSalesAnalytics', { date: '' }, staffToken), 'getSalesAnalytics');
  check('业绩报表算得出来（App 与 Foodcourt 分开）',
    !!analytics && (analytics.summary || analytics.today || analytics.channels) !== undefined);
}

/* -------------------------------------------------------------
   主流程
   ------------------------------------------------------------- */
console.log('YETIPSY · 后端（apps-script/*.gs）检查');
console.log('=======================================');

const gsFiles = checkFiles();
const bundle = loadBackend();
checkActions(bundle);
checkVersions(gsFiles);
checkCopyPaste();
checkEndToEnd();

console.log('\n=======================================');
if (fail === 0) {
  console.log('✅ 全部通过：' + pass + ' 项 —— GitHub 上的 .gs 是最新版，复制贴上文件也同步。');
  process.exit(0);
}
console.log('❌ ' + fail + ' 项没过（' + pass + ' 项通过）：');
failures.forEach((f) => console.log('   · ' + f));
process.exit(1);
