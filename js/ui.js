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

  return {
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
    confirmDialog: confirmDialog
  };
})();
