/* =============================================================
   tools/google-shim.js
   -------------------------------------------------------------
   在 Node 里模拟 Google Apps Script 的服务，让我们可以直接执行
   apps-script/*.gs —— 测试跑的是「真正的生产后端程式码」，
   不是另一份复制品。

   模拟项目：
     SpreadsheetApp  · LockService · PropertiesService · CacheService
     Utilities(SHA-256) · ContentService · UrlFetchApp · Logger
   ============================================================= */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

/* -------------------------------------------------------------
   1. 虚拟 Spreadsheet
   ------------------------------------------------------------- */

class VirtualRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }

  setValues(matrix) {
    for (let r = 0; r < matrix.length; r++) {
      const target = this.row - 1 + r;
      while (this.sheet.rows.length <= target) this.sheet.rows.push([]);
      for (let c = 0; c < matrix[r].length; c++) {
        this.sheet.rows[target][this.col - 1 + c] = matrix[r][c];
      }
    }
    return this;
  }

  setValue(value) {
    const target = this.row - 1;
    while (this.sheet.rows.length <= target) this.sheet.rows.push([]);
    this.sheet.rows[target][this.col - 1] = value;
    return this;
  }

  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
}

class VirtualSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];            // rows[0] = 标题列
    this.frozen = 0;
  }

  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() {
    return this.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  }
  getRange(row, col, numRows, numCols) {
    return new VirtualRange(this, row, col || 1, numRows || 1, numCols || 1);
  }
  getDataRange() {
    return new VirtualRange(this, 1, 1, Math.max(1, this.rows.length), this.getMaxColumns());
  }
  setFrozenRows(n) { this.frozen = n; return this; }
  deleteRows(position, howMany) { this.rows.splice(position - 1, howMany); }
  deleteColumns(position, howMany) {
    this.rows.forEach((r) => r.splice(position - 1, howMany));
  }
  insertRowsAfter() { return this; }
  clearContents() { this.rows = this.rows.slice(0, 1); return this; }
}

class VirtualSpreadsheet {
  constructor(id) {
    this.id = id || 'virtual';
    this.sheets = {};
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) {
    const sh = new VirtualSheet(name);
    this.sheets[name] = sh;
    return sh;
  }
  getSheets() { return Object.keys(this.sheets).map((k) => this.sheets[k]); }
  getId() { return this.id; }
  getName() { return 'YETIPSY (virtual)'; }

  toJSON() {
    const out = {};
    Object.keys(this.sheets).forEach((k) => { out[k] = this.sheets[k].rows; });
    return out;
  }
  static fromJSON(id, data) {
    const ss = new VirtualSpreadsheet(id);
    Object.keys(data || {}).forEach((k) => {
      const sh = new VirtualSheet(k);
      sh.rows = (data[k] || []).map((r) => r.slice());
      ss.sheets[k] = sh;
    });
    return ss;
  }
}

/* -------------------------------------------------------------
   2. Google 服务
   ------------------------------------------------------------- */

function createShim(options) {
  const opts = options || {};
  const ss = opts.spreadsheet || new VirtualSpreadsheet('demo');

  const properties = Object.assign({}, opts.properties || {});
  const cache = new Map();                       // key → { value, expires }
  const urlFetchCalls = [];
  const logs = [];

  /* ---- LockService：模拟「同一时间只有一个请求在写」 ---- */
  let lockHeld = false;
  const LockService = {
    getScriptLock() {
      return {
        tryLock() {
          if (lockHeld) return false;
          lockHeld = true;
          return true;
        },
        waitLock(ms) {
          if (lockHeld) throw new Error('LOCK_TIMEOUT');
          lockHeld = true;
        },
        releaseLock() { lockHeld = false; },
        hasLock() { return lockHeld; }
      };
    }
  };

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(properties, k) ? properties[k] : null),
        setProperty: (k, v) => { properties[k] = String(v); },
        setProperties: (obj) => Object.keys(obj).forEach((k) => { properties[k] = String(obj[k]); }),
        deleteProperty: (k) => { delete properties[k]; },
        getProperties: () => Object.assign({}, properties)
      };
    },
    getUserProperties() { return this.getScriptProperties(); }
  };

  const CacheService = {
    getScriptCache() {
      return {
        get(key) {
          const hit = cache.get(key);
          if (!hit) return null;
          if (hit.expires && Date.now() > hit.expires) { cache.delete(key); return null; }
          return hit.value;
        },
        put(key, value, ttl) {
          cache.set(key, { value: String(value), expires: ttl ? Date.now() + ttl * 1000 : 0 });
        },
        remove(key) { cache.delete(key); }
      };
    }
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(algorithm, value) {
      const algo = algorithm === 'SHA_256' ? 'sha256' : (algorithm === 'SHA_1' ? 'sha1' : 'md5');
      return Array.from(crypto.createHash(algo).update(String(value), 'utf8').digest());
    },
    getUuid() { return crypto.randomUUID(); },
    base64Encode(str) { return Buffer.from(String(str), 'utf8').toString('base64'); }
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput(text) {
      const out = { content: String(text), mimeType: 'text/plain' };
      out.setMimeType = (m) => { out.mimeType = m; return out; };
      out.getContent = () => out.content;
      return out;
    }
  };

  const UrlFetchApp = {
    fetch(url, params) {
      urlFetchCalls.push({ url: url, params: params });
      const responder = opts.urlFetch || (() => ({ code: 200, body: '{"ok":true}' }));
      const r = responder(url, params);
      return {
        getResponseCode: () => r.code,
        getContentText: () => r.body || ''
      };
    }
  };

  const Logger = {
    log(...args) { logs.push(args.map(String).join(' ')); },
    getLog() { return logs.join('\n'); }
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet() { return ss; },
    openById() { return ss; },
    create(name) { return new VirtualSpreadsheet(name); }
  };

  const globals = {
    SpreadsheetApp, LockService, PropertiesService, CacheService,
    Utilities, ContentService, UrlFetchApp, Logger,
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@yetipsy.local' }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }) },
    MimeType: { JSON: 'application/json' },
    JSON, Math, Date, Number, String, Object, Array, Boolean, RegExp, Error,
    Intl, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };

  return {
    globals,
    spreadsheet: ss,
    properties,
    cache,
    logs,
    urlFetchCalls,
    isLockHeld: () => lockHeld,
    resetLock: () => { lockHeld = false; },
    saveTo(file) { fs.writeFileSync(file, JSON.stringify(ss.toJSON(), null, 2)); },
    loadFrom(file) {
      if (!fs.existsSync(file)) return false;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.keys(ss.sheets).forEach((k) => delete ss.sheets[k]);
      const loaded = VirtualSpreadsheet.fromJSON('demo', data);
      Object.keys(loaded.sheets).forEach((k) => { ss.sheets[k] = loaded.sheets[k]; });
      return true;
    }
  };
}

module.exports = { createShim, VirtualSpreadsheet };
