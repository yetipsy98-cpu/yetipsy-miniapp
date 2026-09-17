/* =============================================================
   demo/load-backend.js
   -------------------------------------------------------------
   把 apps-script/*.gs 载入 Node 的 sandbox 并执行。
   测试与 demo server 都用这一份「真正的生产后端」，
   避免出现「测试通过但线上行为不同」的两套程式码。
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createShim } = require('./google-shim');

const BACKEND_DIR = path.join(__dirname, '..', 'apps-script');

/* 载入顺序（只是让 var 初始化有固定顺序；函数宣告本来就会 hoist） */
const FILE_ORDER = [
  'Config.gs',
  'Utils.gs',
  'Database.gs',
  'Security.gs',
  'Audit.gs',
  'Points.gs',
  'Rewards.gs',
  'Wallet.gs',
  'Customers.gs',
  'Orders.gs',
  'Menu.gs',
  'Checkout.gs',
  'AppOrders.gs',
  'OrderBoard.gs',
  'Claims.gs',
  'Promotions.gs',
  'Admin.gs',
  'Auth.gs',
  'Code.gs'
];

function backendSource() {
  const missing = FILE_ORDER.filter((f) => !fs.existsSync(path.join(BACKEND_DIR, f)));
  if (missing.length) {
    throw new Error('apps-script 缺少档案: ' + missing.join(', '));
  }
  return FILE_ORDER
    .map((f) => '/* ---- ' + f + ' ---- */\n' + fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8'))
    .join('\n;\n');
}

/**
 * @param {object} [options] { spreadsheet, properties, urlFetch }
 * @returns {{ api:object, shim:object }}
 */
function loadBackend(options) {
  const shim = createShim(options || {});
  const sandbox = Object.assign({ console: console }, shim.globals);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(backendSource(), sandbox, { filename: 'apps-script.gs' });

  /* 直接测内部函数（这些函数在生产环境里总是在已载入 DB 的请求中执行） */
  const withDb = (fn) => {
    sandbox.dbLoad();
    try { return fn(sandbox); } finally { sandbox.dbRelease(); }
  };

  const api = {
    /* Web App 入口 */
    doPost: (payload) => callDoPost(sandbox, payload),
    doGet: () => JSON.parse(sandbox.doGet().getContent()),

    /* 维护工具（Apps Script 编辑器里手动执行的那些） */
    setupDatabase: () => sandbox.setupDatabase(),
    upgradeToV2: (options) => sandbox.upgradeToV2(options),
    reportUpgradeStatus: () => sandbox.reportUpgradeStatus(),
    clearMenuCache: () => sandbox.clearMenuCache(),
    bootstrapOwner: (u, p) => sandbox.bootstrapOwner(u, p),
    dedupeCustomers: (dryRun) => sandbox.dedupeCustomers(dryRun),
    migratePhonesToE164: (dryRun) => sandbox.migratePhonesToE164(dryRun),
    setPassword: (c, pwd) => sandbox.setPassword(c, pwd),
    reportDuplicatePhones: () => sandbox.reportDuplicatePhones(),
    reportPromotions: () => sandbox.reportPromotions(),
    recalcCustomerTotals: (c) => sandbox.recalcCustomerTotals(c),

    /* 直接测内部函数 */
    normalizePhoneE164: (input, cc) => withDb((sb) => sb.normalizePhoneE164(input, cc)),
    computeTier: (p) => withDb((sb) => sb.computeTier(p)),
    pointsForAmount: (bill, wallet) => withDb((sb) => sb.pointsForAmount(bill, wallet)),
    handlers: () => sandbox.getHandlers(),

    /* 测试专用：读 / 改资料 */
    inspect: (fn) => {
      sandbox.dbLoad();
      try { return fn(sandbox.DB, sandbox); } finally { sandbox.dbRelease(); }
    },
    mutate: (fn) => {
      sandbox.dbLoad();
      try { const r = fn(sandbox.DB, sandbox); sandbox.dbFlush(); return r; }
      finally { sandbox.dbRelease(); }
    },
    setProperty: (k, v) => shim.properties[k] = String(v),
    deleteProperty: (k) => { delete shim.properties[k]; },
    setNow: null
  };

  return { api: api, shim: shim, sandbox: sandbox };
}

/** 模拟前端 POST：{ action, data, token } → JSON 回应 */
function callDoPost(sandbox, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const out = sandbox.doPost({ postData: { contents: body, type: 'text/plain' } });
  return JSON.parse(out.getContent());
}

module.exports = { loadBackend, backendSource, FILE_ORDER, BACKEND_DIR };
