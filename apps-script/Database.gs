/* =============================================================
   YETIPSY MINI APP 1.3 — Database.gs
   -------------------------------------------------------------
   Google Sheets 存取层。

   设计：
   - 每个 API 请求开始时 dbLoad() 把 Sheet 读进记忆体（DB）
   - 业务逻辑只操作记忆体物件（跟 demo 后端完全一样的写法）
   - 请求结束时 dbFlush() 只把「有变动的列」写回 Sheet
   - 整个过程由 Code.gs 的 LockService 保护，不会互相踩到

   业务逻辑永远不直接碰 SpreadsheetApp。
   未来要换 Supabase / PostgreSQL，只需要改这个档案。
   ============================================================= */

var DB = null;
var DB_META = null;

/* -------------------------------------------------------------
   1. Spreadsheet
   ------------------------------------------------------------- */

function dbSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  }
  if (!ss) {
    throw new Error('SPREADSHEET_NOT_FOUND: 请把这个 Script 绑定到一个 Google Sheet，' +
      '或在 Script Properties 设定 SPREADSHEET_ID。');
  }
  return ss;
}

/* -------------------------------------------------------------
   2. 初始化（在 Apps Script 编辑器里手动执行一次）
   ------------------------------------------------------------- */

/**
 * 建立 12 张 Sheet 与预设设置。可重复执行（不会清掉资料）。
 */
function setupDatabase() {
  var ss = dbSpreadsheet();
  var created = [];

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) {
      sh = ss.insertSheet(def.sheet);
      created.push(def.sheet);
    }
    var headers = def.columns.map(function (c) { return c[1]; });
    var first = sh.getRange(1, 1, 1, headers.length);
    first.setValues([headers]);
    first.setFontWeight('bold');
    first.setBackground('#171717');
    first.setFontColor('#F4F1EA');
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    if (sh.getMaxColumns() > headers.length) {
      sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
    }
  });

  /* 预设设置（只在 Settings 是空的时候写入） */
  var settingsSheet = ss.getSheetByName(SCHEMA.settings.sheet);
  if (settingsSheet.getLastRow() < 2) {
    var defs = defaultSettings();
    var rows = Object.keys(defs).map(function (k) {
      return [k, String(defs[k]), SETTING_DESC[k] || ''];
    });
    settingsSheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  /* ID 序号 */
  var seqSheet = ss.getSheetByName(SCHEMA.sequences.sheet);
  if (seqSheet.getLastRow() < 2) {
    var seqRows = ['customer', 'staff', 'session', 'order', 'claim', 'reward',
                   'point', 'wallet', 'promo', 'audit'].map(function (k) { return [k, 0]; });
    seqSheet.getRange(2, 1, seqRows.length, 2).setValues(seqRows);
  }

  /* 示范促销（只在 Promotions 是空的时候写入） */
  var promoSheet = ss.getSheetByName(SCHEMA.promotions.sheet);
  if (promoSheet.getLastRow() < 2) {
    var tmp = { seq: { promo: 0 } };
    var seeds = [
      promoObject(tmp, 'Cocktail Night', 'EVERY WEDNESDAY',
        "Show this screen and enjoy our bartender's special selection.\n向店员出示此页面即可参与本周特调。",
        daysFromNow(-30), daysFromNow(60)),
      promoObject(tmp, 'Claim & Win', '每笔消费都有惊喜',
        "Claim your purchase and open tonight's mystery reward.\n认领消费即可打开今晚的神秘奖励。",
        daysFromNow(-10), daysFromNow(90))
    ];
    var promoDef = SCHEMA.promotions;
    promoSheet.getRange(2, 1, seeds.length, promoDef.columns.length)
      .setValues(seeds.map(function (p) { return objectToRow(promoDef, p); }));

    /* 把 promo 序号推到已使用的号码之后，避免之后建立活动时重号 */
    var seqSheet2 = ss.getSheetByName(SCHEMA.sequences.sheet);
    var seqValues = seqSheet2.getDataRange().getValues();
    for (var r = 1; r < seqValues.length; r++) {
      if (String(seqValues[r][0]) === 'promo') {
        seqSheet2.getRange(r + 1, 2).setValue(tmp.seq.promo);
        break;
      }
    }
  }

  Logger.log('setupDatabase() done. created sheets: ' + (created.length ? created.join(', ') : '(none, already existed)'));
  Logger.log('下一步：执行 bootstrapOwner("owner", "你的密码") 建立第一个老板账号。');
  return { ok: true, created: created };
}

/**
 * 建立第一个 OWNER 账号。只有在 Staff 表还是空的时候才能执行，
 * 之后一律由员工端 /admin/staff.html 管理（避免任何人从外部建立老板账号）。
 */
function bootstrapOwner(username, password) {
  dbLoad();
  try {
    if (DB.staff.length > 0) {
      throw new Error('STAFF_ALREADY_EXISTS: 老板账号已存在，请用 /admin/staff.html 管理。');
    }
    var uname = String(username || '').trim().toLowerCase();
    var pwd = String(password || '');
    if (uname.length < 3) throw new Error('USERNAME_TOO_SHORT: 账号至少 3 个字。');
    if (pwd.length < 8) throw new Error('PASSWORD_TOO_SHORT: 密码至少 8 位。');
    var salt = randomToken(8);
    var s = {
      staffId: dbNextId('STF', 'staff', 4),
      username: uname,
      salt: salt,
      passwordHash: hashPassword(pwd, salt),
      role: 'OWNER',
      status: 'ACTIVE',
      lastLogin: '',
      createdAt: nowISO()
    };
    dbInsert('staff', s);
    audit(s.staffId, 'STAFF', 'BOOTSTRAP_OWNER', 'STAFF', s.staffId, '', uname);
    dbFlush();
    Logger.log('Owner created: ' + uname);
    return { ok: true, username: uname };
  } finally {
    dbRelease();
  }
}

/* -------------------------------------------------------------
   3. 读：把 Sheet 载入记忆体
   ------------------------------------------------------------- */

function dbLoad() {
  var ss = dbSpreadsheet();
  DB_META = { rows: new Map(), snap: new Map(), sheets: {}, writes: 0 };
  DB = {};

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) {
      throw new Error('SETUP_REQUIRED: 找不到 Sheet「' + def.sheet + '」，请先执行 setupDatabase()。');
    }
    DB_META.sheets[table] = sh;
    var arr = [];
    var last = sh.getLastRow();
    if (last >= 2) {
      var values = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
      for (var i = 0; i < values.length; i++) {
        var obj = rowToObject(def, values[i]);
        DB_META.rows.set(obj, i + 2);
        DB_META.snap.set(obj, JSON.stringify(obj));
        arr.push(obj);
      }
    }
    DB[table] = arr;
  });

  /* settings / sequences 另外做成快速查询表 */
  DB._settings = {};
  DB.settings.forEach(function (r) { DB._settings[r.key] = r.value; });
  DB.seq = {};
  DB.sequences.forEach(function (r) { DB.seq[r.key] = Number(r.value) || 0; });

  DB._index = {};
  Object.keys(SCHEMA).forEach(function (table) {
    var idKey = SCHEMA[table].columns[0][0];
    var map = {};
    DB[table].forEach(function (o) { if (o[idKey]) map[o[idKey]] = o; });
    DB._index[table] = { key: idKey, map: map };
  });

  return DB;
}

function dbRelease() { DB = null; DB_META = null; }

function rowToObject(def, values) {
  var obj = {};
  def.columns.forEach(function (c, i) {
    var v = values[i];
    if (v instanceof Date) v = v.toISOString();
    if (v === null || v === undefined) v = '';
    if (c[2] === 'n') {
      var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      obj[c[0]] = isFinite(n) ? n : 0;
    } else {
      obj[c[0]] = String(v);
    }
  });
  return obj;
}

function objectToRow(def, obj) {
  return def.columns.map(function (c) {
    var v = obj[c[0]];
    if (v === null || v === undefined) return '';
    if (c[2] === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
    return String(v);
  });
}

/* -------------------------------------------------------------
   4. 写：只写有变动的列
   ------------------------------------------------------------- */

function dbFlush() {
  if (!DB || !DB_META) return { written: 0 };
  var written = 0;

  Object.keys(SCHEMA).forEach(function (table) {
    var def = SCHEMA[table];
    var sh = DB_META.sheets[table];
    var appends = [];
    var updates = [];

    DB[table].forEach(function (obj) {
      var rowNum = DB_META.rows.get(obj);
      var json = JSON.stringify(obj);
      if (!rowNum) {
        appends.push(objectToRow(def, obj));
        DB_META.snap.set(obj, json);
      } else if (DB_META.snap.get(obj) !== json) {
        updates.push([rowNum, objectToRow(def, obj)]);
        DB_META.snap.set(obj, json);
      }
    });

    if (appends.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, appends.length, def.columns.length).setValues(appends);
      written += appends.length;
    }
    updates.forEach(function (u) {
      sh.getRange(u[0], 1, 1, def.columns.length).setValues([u[1]]);
      written++;
    });

    /* log 类自动修剪最旧的列 */
    if (def.maxRows) {
      var total = sh.getLastRow() - 1;
      if (total > def.maxRows) sh.deleteRows(2, total - def.maxRows);
    }
  });

  DB_META.writes = written;
  return { written: written };
}

/* -------------------------------------------------------------
   5. 查询助手
   ------------------------------------------------------------- */

function dbInsert(table, obj) {
  DB[table].push(obj);
  var idKey = DB._index[table].key;
  if (obj[idKey]) DB._index[table].map[obj[idKey]] = obj;
  return obj;
}

function dbById(table, id) {
  if (!id) return null;
  return DB._index[table].map[String(id)] || null;
}

function dbFind(table, predicate) {
  var arr = DB[table];
  for (var i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return null;
}

function dbFilter(table, predicate) {
  return DB[table].filter(predicate);
}

/** 最新在前（Sheet 是旧的在上、新的在下，这里反过来给 API 用） */
function dbRecent(table, limit) {
  var arr = DB[table].slice().reverse();
  return limit ? arr.slice(0, limit) : arr;
}

/** ID 序号（存在 Sequences Sheet，重启不会重号） */
function dbNextId(prefix, key, len) {
  DB.seq[key] = (Number(DB.seq[key]) || 0) + 1;
  var row = dbFind('sequences', function (r) { return r.key === key; });
  if (row) row.value = DB.seq[key];
  else dbInsert('sequences', { key: key, value: DB.seq[key] });
  return prefix + pad(DB.seq[key], len || 6);
}

/* -------------------------------------------------------------
   6. Settings
   ------------------------------------------------------------- */

function setting(key, fallback) {
  if (!DB || !DB._settings) return fallback;
  var v = DB._settings[key];
  if (v === undefined || v === null || v === '') return fallback;
  return v;
}

function numSetting(key, fallback) {
  var v = Number(setting(key, fallback));
  return isFinite(v) ? v : fallback;
}

function boolSetting(key, fallback) {
  var v = String(setting(key, fallback ? 'TRUE' : 'FALSE')).toUpperCase();
  return v === 'TRUE' || v === '1' || v === 'YES';
}

function setSetting(key, value) {
  var row = dbFind('settings', function (r) { return r.key === key; });
  if (row) row.value = String(value);
  else dbInsert('settings', { key: key, value: String(value), description: SETTING_DESC[key] || '' });
  DB._settings[key] = String(value);
}

/* -------------------------------------------------------------
   7. 维护工具（在 Apps Script 编辑器里手动执行）
   ------------------------------------------------------------- */

/**
 * ★ 修复「同一个号码重复注册」造成的历史脏资料。
 *
 * 1. 先把所有 Phone 规范化成 E.164（migratePhonesToE164）
 * 2. 同一个号码的多列 → 保留最早注册的那一列为正式帐号
 * 3. 其余列的 Orders / Claims / Rewards / PointTx / WalletTx 全部转到正式帐号
 * 4. 用转帐明细重新算出积分、钱包、累计消费（不是相加，避免重复计算）
 * 5. 重复的列标记 Status = MERGED（保留下来当审计证据，不删除）
 *
 * @param {boolean} dryRun true = 只回报会改什么，不写入
 */
function dedupeCustomers(dryRun) {
  dbLoad();
  try {
    var report = { dryRun: !!dryRun, normalized: 0, groups: [], merged: 0 };

    /* 1) 规范化电话 */
    var norm = migratePhonesE164(true);
    report.normalized = norm.changed.length;

    /* 2) 用「规范化之后」的号码分组（此时还没写入，先算出来） */
    var byPhone = {};
    DB.customers.forEach(function (c) {
      if (c.status === 'MERGED') return;
      var res = normalizePhoneE164(String(c.phone || ''));
      var p = res.ok ? res.phone : ('RAW:' + String(c.phone || '').trim());
      if (!p) return;
      (byPhone[p] = byPhone[p] || []).push(c);
    });

    Object.keys(byPhone).forEach(function (phone) {
      var group = byPhone[phone];
      if (group.length < 2) return;

      group.sort(function (a, b) {
        var ta = new Date(a.createdAt || 0).getTime() || 0;
        var tb = new Date(b.createdAt || 0).getTime() || 0;
        if (ta !== tb) return ta - tb;                 // 最早注册的当正式帐号
        return (b.totalSpend || 0) - (a.totalSpend || 0);
      });

      var keep = group[0];
      var drop = group.slice(1);
      var moved = { orders: 0, claims: 0, rewards: 0, pointTx: 0, walletTx: 0 };

      drop.forEach(function (dup) {
        DB.orders.forEach(function (o) {
          if (o.customerId === dup.customerId) { o.customerId = keep.customerId; moved.orders++; }
        });
        DB.claims.forEach(function (c) {
          if (c.customerId === dup.customerId) { c.customerId = keep.customerId; moved.claims++; }
        });
        DB.rewards.forEach(function (r) {
          if (r.customerId === dup.customerId) { r.customerId = keep.customerId; moved.rewards++; }
        });
        DB.pointTx.forEach(function (t) {
          if (t.customerId === dup.customerId) { t.customerId = keep.customerId; moved.pointTx++; }
        });
        DB.walletTx.forEach(function (t) {
          if (t.customerId === dup.customerId) { t.customerId = keep.customerId; moved.walletTx++; }
        });
        /* 密码：正式帐号还没设密码时，沿用重复列的密码 */
        if (!keep.passwordHash && dup.passwordHash) {
          keep.salt = dup.salt;
          keep.passwordHash = dup.passwordHash;
          keep.passwordSetAt = dup.passwordSetAt || nowISO();
        }
        dup.status = 'MERGED';
      });

      recalcCustomerTotals(keep);
      report.groups.push({
        phone: phone,
        keep: keep.customerId,
        merged: drop.map(function (d) { return d.customerId; }),
        moved: moved,
        after: {
          currentPoints: keep.currentPoints,
          walletBalance: keep.walletBalance,
          totalSpend: keep.totalSpend,
          totalVisits: keep.totalVisits
        }
      });
      report.merged += drop.length;
    });

    if (!dryRun) {
      /* 把规范化后的电话真正写进物件 */
      applyPhoneNormalization();
      dbFlush();
    }
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    dbRelease();
  }
}

/** 依转帐明细重算会员的积分 / 钱包 / 累计消费（合并后使用） */
function recalcCustomerTotals(customer) {
  var id = customer.customerId;
  var points = 0, wallet = 0, spend = 0, visits = 0, rewards = 0;

  DB.pointTx.forEach(function (t) { if (t.customerId === id) points += (Number(t.points) || 0); });
  DB.walletTx.forEach(function (t) { if (t.customerId === id) wallet += (Number(t.amount) || 0); });
  DB.orders.forEach(function (o) {
    if (o.customerId !== id || o.orderStatus === 'CANCELLED') return;
    if (o.claimStatus === 'CLAIMED') {
      spend += (Number(o.billAmount) || 0);
      visits += 1;
    }
  });
  DB.rewards.forEach(function (r) {
    if (r.customerId === id && r.status === 'CLAIMED') rewards += 1;
  });

  customer.currentPoints  = Math.max(0, points);
  customer.walletBalance  = Math.max(0, wallet);
  customer.totalSpend     = spend;
  customer.totalVisits    = visits;
  customer.totalRewards   = rewards;
  customer.membershipTier = computeTier(customer.currentPoints);
  return customer;
}

/** 检查（不写入）：哪些 Phone 不是标准 E.164。呼叫前 DB 必须已载入。 */
function migratePhonesE164(dryRun) {
  dbLoadIfNeeded();
  var changed = [], invalid = [];
  DB.customers.forEach(function (c) {
    var raw = String(c.phone || '');
    var res = normalizePhoneE164(raw);
    if (!res.ok) { invalid.push({ customerId: c.customerId, phone: raw, reason: res.reason }); return; }
    if (res.phone !== raw) {
      changed.push({ customerId: c.customerId, from: raw, to: res.phone });
      if (!dryRun) c.phone = res.phone;
    }
  });
  return { changed: changed, invalid: invalid };
}

/**
 * 独立工具（Apps Script 编辑器执行）：把 Customers.Phone 全部改成 E.164。
 * @param {boolean} dryRun true = 只回报，不写入
 */
function migratePhonesToE164(dryRun) {
  dbLoad();
  try {
    var report = migratePhonesE164(dryRun);
    if (!dryRun) dbFlush();
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    dbRelease();
  }
}

/** 真正写入 E.164 电话（配合 dedupeCustomers 使用） */
function applyPhoneNormalization() {
  DB.customers.forEach(function (c) {
    var res = normalizePhoneE164(String(c.phone || ''));
    if (res.ok) c.phone = res.phone;
  });
}

/** 报表：找出重复的电话号码（MERGED 的列不算） */
function reportDuplicatePhones() {
  dbLoad();
  try {
    var counts = {};
    DB.customers.forEach(function (c) {
      if (c.status === 'MERGED') return;
      var res = normalizePhoneE164(String(c.phone || ''));
      var p = res.ok ? res.phone : ('RAW:' + c.phone);
      counts[p] = (counts[p] || 0) + 1;
    });
    var dups = Object.keys(counts).filter(function (k) { return counts[k] > 1; })
      .map(function (k) { return { phone: k, count: counts[k] }; });
    Logger.log(JSON.stringify(dups, null, 2));
    return dups;
  } finally {
    dbRelease();
  }
}

function dbLoadIfNeeded() {
  if (!DB) dbLoad();
  return DB;
}

/* -------------------------------------------------------------
   8. 促销（setupDatabase 与 Admin 共用）
   ------------------------------------------------------------- */

function promoObject(counter, title, subtitle, description, start, end) {
  counter.seq.promo = (counter.seq.promo || 0) + 1;
  return {
    promotionId: 'PRM' + pad(counter.seq.promo, 4),
    title: title,
    subtitle: subtitle,
    description: description,
    imageUrl: '',
    startDate: start,
    endDate: end,
    minSpend: 0,
    status: 'ACTIVE',
    sortOrder: counter.seq.promo,
    createdAt: nowISO()
  };
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
