/* =============================================================
   tools/load-backend.js
   -------------------------------------------------------------
   把 apps-script/*.gs 载入 Node 的 sandbox 并执行。
   2.1.6 起后端是「唯一一个档案」apps-script/Code.gs
   （就是你贴到 Google Apps Script 的那一份），
   所以这里跑的 = 线上跑的，不会出现「测试过但线上不同」。
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createShim } = require('./google-shim');

const BACKEND_DIR = path.join(__dirname, '..', 'apps-script');

/* -------------------------------------------------------------
   后端档案：正常情况只有一个 apps-script/Code.gs。
   万一以后又拆成多个档案，这里也接受 —— 依 Config 先、Code 后的
   顺序串起来（跟 Apps Script 专案里的档案顺序概念一样）。
   ------------------------------------------------------------- */
function gsFiles() {
  const files = fs.readdirSync(BACKEND_DIR).filter((f) => f.endsWith('.gs'));
  const rank = (f) => (f === 'Config.gs' ? 0 : f === 'Code.gs' ? 2 : 1);
  return files.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));
}

function backendSource() {
  const files = gsFiles();
  if (!files.length) {
    throw new Error('apps-script/ 里没有任何 .gs 档案（应该有 Code.gs）');
  }
  return files
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

module.exports = { loadBackend, backendSource, gsFiles, BACKEND_DIR };
