/* =============================================================
   YETIPSY — ui.js
   -------------------------------------------------------------
   共用 UI 工具：金额格式化（sen）、Toast、页面顶部栏、
   中英双语标签、QR 生成、QR 扫描、载入状态
   ============================================================= */

var UI = (function () {

  /* =========================================================
     1. 格式化
     后端所有金额一律使用 SEN（整数）
     RM50   = 5000
     RM8.68 = 868
     ========================================================= */

  function money(sen, withSymbol) {
    if (sen === null || sen === undefined || sen === '') sen = 0;
    var v = Number(sen) / 100;
    var s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (withSymbol === false ? '' : YETIPSY_CONFIG.CURRENCY + ' ') + s;
  }

  function moneyPlain(sen) {
    if (sen === null || sen === undefined) sen = 0;
    return (Number(sen) / 100).toFixed(2);
  }

  /** RM 输入字串 → sen（整数）。非法返回 null */
  function parseMoneyToSen(str) {
    if (str === null || str === undefined) return null;
    var cleaned = String(str).replace(/[^0-9.]/g, '');
    if (cleaned === '' || isNaN(parseFloat(cleaned))) return null;
    var sen = Math.round(parseFloat(cleaned) * 100);
    if (!isFinite(sen) || sen < 0) return null;
    return sen;
  }

  function points(n) {
    n = Number(n) || 0;
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function dateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE,
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function dateOnly(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE,
      day: '2-digit', month: 'short'
    });
  }

  function timeOnly(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-GB', {
      timeZone: YETIPSY_CONFIG.TIMEZONE,
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  /* =========================================================
     2. 双语
     ========================================================= */

  /** 回传 <span class="bi">中文<small>ENGLISH</small></span> */
  function bi(zh, en) {
    return '<span class="bi"><b>' + esc(zh) + '</b><i>' + esc(en) + '</i></span>';
  }

  /** 横向双语（用于小标签） */
  function biInline(zh, en) {
    return '<span class="bi-inline">' + esc(zh) + ' <em>' + esc(en) + '</em></span>';
  }

  function esc(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* =========================================================
     3. 会员等级
     ========================================================= */

  function tierName(tier) {
    return (tier || 'MEMBER').toUpperCase();
  }

  function tierLabel(tier) {
    var t = tierName(tier);
    if (t === 'GOLD') return bi('黄金会员', 'GOLD MEMBER');
    if (t === 'SILVER') return bi('白银会员', 'SILVER MEMBER');
    return bi('会员', 'MEMBER');
  }

  function tierBadge(tier) {
    var t = tierName(tier);
    return '<span class="tier tier-' + t.toLowerCase() + '">' + t + '</span>';
  }

  function tierColor(tier) {
    return YETIPSY_CONFIG.TIER_COLORS[tierName(tier)] || YETIPSY_CONFIG.TIER_COLORS.MEMBER;
  }

  /* =========================================================
     4. Toast
     ========================================================= */

  function toast(message, type, duration) {
    var box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    box.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, duration || 2600);
  }

  /* =========================================================
     5. Loading
     ========================================================= */

  function showLoading(text) {
    var el = document.getElementById('loadingOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loadingOverlay';
      el.className = 'loading-overlay';
      el.innerHTML = '<div class="spinner"></div><div class="loading-text"></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.loading-text').textContent = text || '';
    el.classList.add('show');
  }

  function hideLoading() {
    var el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('show');
  }

  function setLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      button.dataset.text = button.innerHTML;
      button.disabled = true;
      button.classList.add('is-loading');
      button.innerHTML = '<span class="btn-spinner"></span>' + esc(loadingText || 'LOADING');
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      if (button.dataset.text) button.innerHTML = button.dataset.text;
    }
  }

  /* =========================================================
     6. 图标（线性 SVG，跟着 currentColor）
     ========================================================= */

  var ICONS = {
    activity: '<path d="M4 12h3l2.5-6 3 12L15 12h5"/>',
    orders: '<path d="M6 3.5h9l3.5 3.5v13.5H6Z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"/><path d="M3 7.5V18a1 1 0 0 0 1 1h15a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6"/><circle cx="17" cy="14" r="1.2"/>',
    profile: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>',
    menu: '<path d="M5 4.5h6a2.5 2.5 0 0 1 2.5 2.5v12A2 2 0 0 0 11.5 17H5Z"/><path d="M19 4.5h-2.5A2.5 2.5 0 0 0 14 7v12a2 2 0 0 1 2-2H19Z"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>'
  };

  function icon(name, size) {
    return '<svg class="icon" width="' + (size || 22) + '" height="' + (size || 22) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  /* =========================================================
     7. 顶部栏
     ========================================================= */

  function renderHeader(options) {
    options = options || {};
    var html =
      '<header class="app-header">' +
        '<div class="header-inner">' +
          (options.back
            ? '<a class="header-back" href="' + options.back + '" aria-label="back">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>' +
              '</a>'
            : '<span class="header-back-spacer"></span>') +
          '<div class="header-title">' +
            '<div class="ht-zh">' + esc(options.titleZh || '') + '</div>' +
            '<div class="ht-en">' + esc(options.titleEn || '') + '</div>' +
          '</div>' +
          '<div class="header-right">' + (options.right || '') + '</div>' +
        '</div>' +
      '</header>';
    document.body.insertAdjacentHTML('afterbegin', html);
    document.body.classList.add('has-header');
  }

  /* =========================================================
     8. QR 生成
     ========================================================= */

  /** 建立 QR 物件（ECC 等级 M，自动选择版本） */
  function buildQR(text) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr;
  }

  /** 以 SVG 绘制 QR（不需要 canvas，任何环境都能显示，且放大不失真） */
  function renderQR(container, text, size) {
    if (!container) return;
    size = size || 220;
    container.innerHTML = '';
    try {
      var qr = buildQR(text);
      var wrap = document.createElement('div');
      wrap.className = 'qr-svg';
      wrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
      var svg = wrap.firstChild;
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      container.appendChild(svg);
    } catch (e) {
      container.innerHTML = '<div class="qr-error">QR ERROR</div>';
    }
  }

  /** 生成 QR 图档 DataURL（用于下载 / 分享；优先 PNG，失败则回退 SVG） */
  function qrDataUrl(text, size) {
    try {
      var qr = buildQR(text);
      var count = qr.getModuleCount();
      var cell = Math.max(2, Math.floor((size || 512) / count));
      var real = cell * count;
      var canvas = document.createElement('canvas');
      canvas.width = real;
      canvas.height = real;
      var ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, real, real);
        ctx.fillStyle = '#000000';
        for (var r = 0; r < count; r++) {
          for (var c = 0; c < count; c++) {
            if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
          }
        }
        return canvas.toDataURL('image/png');
      }
      // 没有 canvas（例如某些内嵌预览环境）→ 回退 SVG data URL
      var svg = qr.createSvgTag({ cellSize: cell, margin: cell * 4 });
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    } catch (e) {
      return null;
    }
  }

  /* =========================================================
     9. 空状态 / 错误状态
     ========================================================= */

  function emptyState(zh, en, iconName) {
    return '<div class="empty-state">' +
      '<div class="empty-icon">' + icon(iconName || 'activity', 28) + '</div>' +
      '<div class="empty-zh">' + esc(zh) + '</div>' +
      '<div class="empty-en">' + esc(en) + '</div>' +
      '</div>';
  }

  /* =========================================================
     10. 其他
     ========================================================= */

  /** 页面跳转（login.html 等共用；抽出来方便测试与日后改 base path） */
  function go(url) {
    location.assign(url || 'index.html');
  }

  function getParam(name) {
    var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  /* --------------------------------------------------------
     电话号码规范化（E.164）
     --------------------------------------------------------
     必须和后端 Utils.gs 的 normalizePhoneE164() 使用同一套规则，
     否则同一个号码会产生两种写法 → 后端把它当成两个人 → 重复注册。

       0123456789 / 60123456789 / +60 12-345 6789  →  +60123456789
       81234567（选 +65）/ +65 8123 4567          →  +6581234567
     -------------------------------------------------------- */

  function allowedCountryCodes() {
    var list = (YETIPSY_CONFIG.COUNTRY_CODES && YETIPSY_CONFIG.COUNTRY_CODES.length)
      ? YETIPSY_CONFIG.COUNTRY_CODES
      : ['+60'];
    return list.map(function (c) { return String(c).replace(/[^0-9]/g, ''); })
      .filter(function (c) { return c.length > 0; });
  }

  function normalizePhone(input, countryCode) {
    var raw = String(input === null || input === undefined ? '' : input).trim();
    var hadPlus = raw.charAt(0) === '+';
    var digits = raw.replace(/[^0-9]/g, '');
    var allowed = allowedCountryCodes();
    var def = String(countryCode || YETIPSY_CONFIG.COUNTRY_CODE || '+60').replace(/[^0-9]/g, '');
    if (allowed.indexOf(def) === -1) allowed.unshift(def);
    if (!digits) return '';

    if (!hadPlus && digits.indexOf('00') === 0) {
      digits = digits.slice(2);
      hadPlus = true;
    }

    var country = '', local = digits;

    if (hadPlus) {
      var matched = false;
      [3, 2, 1].forEach(function (len) {
        if (matched) return;
        var cand = digits.slice(0, len);
        if (allowed.indexOf(cand) !== -1 && digits.length > len) {
          country = cand;
          local = digits.slice(len);
          matched = true;
        }
      });
      if (!matched) return '';
    } else {
      var hit = null;
      allowed.forEach(function (c) {
        if (!hit && digits.indexOf(c) === 0 && digits.length > c.length + 6) hit = c;
      });
      if (hit) {
        country = hit;
        local = digits.slice(hit.length);
      } else {
        country = def;
        local = digits.replace(/^0+/, '');
      }
    }

    return local ? ('+' + country + local) : '';
  }

  /** 与后端一致的号码有效性检查（会员必须是手机） */
  function isValidPhone(input, countryCode) {
    var e164 = normalizePhone(input, countryCode);
    if (!e164) return false;
    var digits = e164.replace(/[^0-9]/g, '');

    var country = '', local = '';
    var allowed = allowedCountryCodes().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < allowed.length; i++) {
      if (digits.indexOf(allowed[i]) === 0) {
        country = allowed[i];
        local = digits.slice(allowed[i].length);
        break;
      }
    }
    if (!country) return false;
    if (country === '60') return /^1[0-9]{8,9}$/.test(local);   // 马来西亚手机
    if (country === '65') return /^[89][0-9]{7,8}$/.test(local); // 新加坡手机
    return local.length >= 7 && local.length <= 12;
  }

  /**
   * 规格分组（2.1.16）
   * ---------------------------------------------------------
   * 后端 `optionsByProduct[productId]` 给的是「每个规格一笔」的平铺清单：
   *   [{ optionId, optionGroup:'SIZE', nameEN:'Large', priceAdjustment:400, … }]
   * 但画面要的是「一群一列」（SIZE → Large / Regular）：
   *   [{ optionGroup:'SIZE', nameEN:'SIZE', options:[…] }]
   * 这里把两种形状都吃下来，顺便滤掉已下架的规格。
   * （以前 menu.js / pos 都直接当成分好群的资料用，结果规格一列都画不出来 → 选规格失效。）
   */
  function optionGroups(list) {
    var out = [], index = {};

    function group(key, en, zh, required) {
      var k = String(key || '').toUpperCase() || 'OPTION';
      if (!index[k]) {
        index[k] = { optionGroup: key || k, nameEN: en || key || k, nameZH: zh || '',
                     required: !!required, options: [] };
        out.push(index[k]);
      }
      var g = index[k];
      if (!g.nameEN && en) g.nameEN = en;
      if (!g.nameZH && zh) g.nameZH = zh;
      if (required) g.required = true;
      return g;
    }

    (list || []).forEach(function (o) {
      if (!o) return;
      if (String(o.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return;   // 下架的规格不显示

      /* 已经是「一群」的形状（有的版本这样回）→ 原样收下 */
      if (o.options && typeof o.options.length === 'number') {
        var g0 = group(o.optionGroup || o.nameEN, o.nameEN || o.optionGroup, o.nameZH, o.required);
        (o.options || []).forEach(function (x) {
          if (!x || String(x.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return;
          g0.options.push(x);
          if (x.required) g0.required = true;
        });
        return;
      }

      var g = group(o.optionGroup, o.optionGroupNameEN || o.optionGroup, o.optionGroupNameZH, o.required);
      g.options.push(o);
    });

    return out.filter(function (g) { return g.options.length; });
  }

  function confirmDialog(messageZh, messageEn, confirmText) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay show';
      overlay.innerHTML =
        '<div class="modal">' +
          '<div class="modal-zh">' + esc(messageZh) + '</div>' +
          '<div class="modal-en">' + esc(messageEn) + '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" data-act="no">取消 CANCEL</button>' +
            '<button class="btn btn-primary" data-act="yes">' + esc(confirmText || '确定 CONFIRM') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function close(result) {
        overlay.classList.remove('show');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
        resolve(result);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'yes') close(true);
        if (act === 'no') close(false);
      });
    });
  }

  /* =========================================================
     语音播报 + 大字提示（2.1.10）
     ---------------------------------------------------------
     新订单来的时候员工要「听得到 + 看得到」：
       UI.say('您有新订单')        → 讲出来（浏览器的语音合成，免下载）
       UI.announceNewOrder(2)     → 讲「您有 2 个新订单」＋画面跳大字横幅
     浏览器规则：语音通常要页面先被点过才准出声，
     所以 UI.say 会在第一次点画面时自动「解锁」（讲一个空白字串）。
     ========================================================= */
  var voiceOn = true;          // 页面可以用 UI.setVoice(false) 关掉
  var unlocked = false;

  function speech() {
    return (typeof window !== 'undefined' && window.speechSynthesis) || null;
  }

  /** 挑一个中文声音；没有就随便挑一个（英文声音唸中文数字也还能懂） */
  function pickVoice() {
    var syn = speech();
    if (!syn || !syn.getVoices) return null;
    var list = syn.getVoices() || [];
    if (!list.length) return null;
    var want = ['zh-CN', 'zh-TW', 'zh-HK', 'zh'];
    for (var w = 0; w < want.length; w++) {
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].lang || '').toLowerCase().indexOf(want[w].toLowerCase()) === 0) return list[i];
      }
    }
    for (var j = 0; j < list.length; j++) {
      if (String(list[j].lang || '').toLowerCase().indexOf('zh') === 0) return list[j];
    }
    return null;
  }

  /** 第一次点画面时把语音解锁（Chrome 要这个动作才肯出声） */
  function unlockVoice() {
    if (unlocked) return;
    unlocked = true;
    var syn = speech();
    if (!syn) return;
    try {
      var u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = 'zh-CN';
      syn.speak(u);
    } catch (e) {}
    document.removeEventListener('touchstart', unlockVoice);
    document.removeEventListener('pointerdown', unlockVoice);
    document.removeEventListener('keydown', unlockVoice);
  }

  function bindUnlock() {
    try {
      document.addEventListener('touchstart', unlockVoice, { passive: true });
      document.addEventListener('pointerdown', unlockVoice);
      document.addEventListener('keydown', unlockVoice);
    } catch (e) {}
  }

  function setVoice(on) { voiceOn = !!on; }

  /**
   * 讲一句话。成功回 true；浏览器没有语音（或说不出话）回 false，
   * 呼叫方可以改用「哔」声。
   */
  function say(text, options) {
    var syn = speech();
    if (!syn || !window.SpeechSynthesisUtterance) return false;
    if (options && options.force !== true && !voiceOn) return false;
    try {
      if (syn.speaking) { syn.cancel(); }          // 不要排队排到天边
      var u = new window.SpeechSynthesisUtterance(String(text));
      var v = pickVoice();
      u.lang = (v && v.lang) || 'zh-CN';
      if (v) u.voice = v;
      u.rate = (options && options.rate) || 1;
      u.pitch = 1;
      u.volume = 1;
      syn.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 大字横幅：🔔 您有新订单（3.5 秒后自己收） */
  function banner(text) {
    var node = document.getElementById('voiceBanner');
    if (!node) {
      node = document.createElement('div');
      node.id = 'voiceBanner';
      node.className = 'voice-banner';
      document.body.appendChild(node);
    }
    node.innerHTML = '<div class="vb-text">' + esc(text) + '</div>';
    node.classList.add('on');
    if (node._t) clearTimeout(node._t);
    node._t = setTimeout(function () { node.classList.remove('on'); }, 3500);
  }

  /**
   * 新订单：讲出来 + 跳横幅。
   * count 1 → 「您有新订单」／多于 1 → 「您有 N 个新订单」
   */
  function announceNewOrder(count) {
    var n = Math.max(1, Number(count) || 1);
    var text = n > 1 ? '您有 ' + n + ' 个新订单' : '您有新订单';
    var spoke = say(text);
    banner(n > 1 ? '🔔 ' + text + '（' + n + '）' : '🔔 ' + text);
    return spoke;
  }

  bindUnlock();

  /* =========================================================
     连线提示（每页一个 #netPill）
     ---------------------------------------------------------
     pageFailed = 这一页自己最后一次载入有没有失败
     netState   = API.netState()（'ok' / 'slow' / 'offline'）
     规则：自己失败 or 后端离线 → 显示「连线不稳 · 显示上次资料」
           只是慢 → 显示「连线慢 · 重试中」
           都正常 → 收起来
     重点：别的请求成功（netState 变 ok）不会盖掉「这一页失败」的事实
     ========================================================= */
  function netPill(pageFailed, netState) {
    var pill = document.getElementById('netPill');
    if (!pill) return;
    var st = netState;
    if (!st && typeof API !== 'undefined' && API.netState) st = API.netState();
    if (!st) st = 'ok';
    if (!pageFailed && st === 'ok') {
      pill.style.display = 'none';
      pill.textContent = '';
      return;
    }
    pill.textContent = (pageFailed || st === 'offline')
      ? '⚠ 连线不稳 · 显示上次资料'
      : '⚠ 连线慢 · 重试中';
    pill.style.display = '';
  }

  return {
    say: say,
    announceNewOrder: announceNewOrder,
    setVoice: setVoice,
    unlockVoice: unlockVoice,
    voiceBanner: banner,
    netPill: netPill,
    money: money,
    moneyPlain: moneyPlain,
    parseMoneyToSen: parseMoneyToSen,
    points: points,
    dateTime: dateTime,
    dateOnly: dateOnly,
    timeOnly: timeOnly,
    bi: bi,
    biInline: biInline,
    esc: esc,
    tierName: tierName,
    tierLabel: tierLabel,
    tierBadge: tierBadge,
    tierColor: tierColor,
    toast: toast,
    showLoading: showLoading,
    hideLoading: hideLoading,
    setLoading: setLoading,
    icon: icon,
    renderHeader: renderHeader,
    renderQR: renderQR,
    qrDataUrl: qrDataUrl,
    emptyState: emptyState,
    go: go,
    getParam: getParam,
    copyToClipboard: copyToClipboard,
    normalizePhone: normalizePhone,
    isValidPhone: isValidPhone,
    allowedCountryCodes: allowedCountryCodes,
    optionGroups: optionGroups,
    confirmDialog: confirmDialog
  };
})();
