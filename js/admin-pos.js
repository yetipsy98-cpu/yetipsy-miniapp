/* =============================================================
   YETIPSY — admin-pos.js（员工端 POS 点餐台 + 进单）
   -------------------------------------------------------------
   现场动线（foodcourt 通路）——像 POS 机一样：

     ① 点餐台：商品格 → 点商品 → 清单（可改数量 / 手动改金额）
     ② 记录单据 → 进「待进单」队列
     ③ 顾客出示会员码 → 扫码 → 确认 → 进分

   为什么金额还是员工确认：
     收据上的数字才是真的（折扣 / 税在 foodcourt 算好了）。
     清单只是「这张单卖了什么」的纪录；积分只看金额（§57）。
     金额不对就在清单里手动输入（勾「手动输入金额」）。

   为什么先记录再扫码：
     值班时可以先把三五张单录进队列，顾客来了才逐张扫码。
     扫码只是回答「这张单是谁的」，付款早在 foodcourt 完成了。

   Mini app 的订单不走这里 —— 顾客在 App 下单，员工完成订单时
   系统就会自动进分（admin/orderboard.html）。
   ============================================================= */

var ADMIN_POS = (function () {

  var state = {
    tab: 'kiosk',            // kiosk | queue | scan | confirm | result
    menu: null,              // { categories, products }
    categoryId: '',
    lines: [],               // 目前这张单：{key,productId,nameZH,nameEN,unitPrice,qty,options[]}
    search: '',
    opt: null,               // 有规格的商品：{ product, groups, selected, qty }
    pad: '0',                // 收据金额键盘
    padDecimal: false,
    manualAmountSen: 0,
    useManualAmount: false,
    tickets: [],
    today: null,
    selected: null,
    customer: null,
    membership: null,
    verifyToken: '',
    verifyLeft: 0,
    result: null,
    loadFailed: false,
    errorCode: null,
    busy: false,
    pollSeconds: 8,
    paymentMethod: 'CASH',
    hits: [],                // 搜到的会员（顾客没有会员码时用）
    knownTickets: null,      // 待进单看过的单据（新的才播报「您有新订单」）
    muted: false,
    signature: ''
  };

  var el = {};
  var poller = null;
  var countdownTimer = null;

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */

  function init() {
    el.kiosk      = document.getElementById('stepKiosk');
    el.queue      = document.getElementById('stepQueue');
    el.scan       = document.getElementById('stepScan');
    el.confirm    = document.getElementById('stepConfirm');
    el.result     = document.getElementById('stepResult');
    el.grid       = document.getElementById('kioskGrid');
    el.cats       = document.getElementById('kioskCats');
    el.scanBox    = document.getElementById('scanBox');
    el.video      = document.getElementById('scanVideo');
    el.hint       = document.getElementById('scanHint');
    el.support    = document.getElementById('scanSupport');
    el.sheet      = document.getElementById('ticketSheet');
    el.lines      = document.getElementById('ticketLines');

    on('tabKiosk', function () { show('kiosk'); });
    on('tabQueue', function () { show('queue'); });
    on('kioskRefreshBtn', function () { loadMenu(true); });
    on('kioskSearch', null, null);
    var search = document.getElementById('kioskSearch');
    if (search) {
      search.addEventListener('input', function () {
        state.search = search.value.trim().toLowerCase();
        renderGrid();
      });
    }
    on('optionSheetClose', closeOptionSheet);
    on('optQtyMinus', function () { setOptQty((state.opt ? state.opt.qty : 1) - 1); });
    on('optQtyPlus',  function () { setOptQty((state.opt ? state.opt.qty : 1) + 1); });
    on('optAddBtn', addOptionToTicket);
    on('manualClear', function () { padQuick(); });
    on('noteChips', function (e) {
      var node = closest(e.target, '[data-note]');
      if (!node) return;
      var input = document.getElementById('ticketNoteInput');
      if (input) input.value = node.getAttribute('data-note') || '';
    });
    bindPad();
    on('refreshBtn', function () { API.cache.drop('getPosQueue', {}); loadQueue(true); });
    on('kioskOpenTicket', openTicketSheet);
    on('kioskTicketBtn', openTicketSheet);
    on('kioskCheckoutBtn', openTicketSheet);
    on('sheetAddMoreBtn', closeTicketSheet);
    on('ticketSheetClose', closeTicketSheet);

    /* 付款方式（写进单据备注，AUDIT 也会有纪录） */
    on('payChips', function (e) {
      var node = closest(e.target, '[data-pay]');
      if (!node) return;
      state.paymentMethod = node.getAttribute('data-pay') || 'CASH';
      renderPayChips();
    });

    /* 顾客没有会员码 → 用手机号找会员 */
    on('memberSearchBtn', function () { searchMember(); });
    on('memberSearchInput', null, function (e) { if (e.key === 'Enter') searchMember(); });
    on('ticketClearBtn', clearLines);
    on('saveTicketBtn', saveTicket);
    on('manualAmountToggle', toggleManualAmount);
    on('manualBtn', function () { handleCode(txt('manualInput')); });
    on('manualInput', null, function (e) { if (e.key === 'Enter') handleCode(txt('manualInput')); });
    on('startScanBtn', startCamera);
    on('stopScanBtn', function () { MEMBER_SCANNER.stop(); });
    on('confirmBtn', confirm);
    on('rescanBtn', function () { if (state.selected) beginScan(state.selected); });
    on('backToQueueBtn', backToKiosk);
    on('nextTicketBtn', backToKiosk);

    bindGrid();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopPolling(); MEMBER_SCANNER.stop(); }
      else if (state.tab === 'kiosk' || state.tab === 'queue') startPolling();
    });

    /* 连线状态：不稳的时候只显示一个小提示，不要把整页变错误 */
    /* 2.1.10 待进单有新的也要「听得到」：跟订单看板共用同一个静音开关 */
    state.muted = localStorage.getItem('yt_board_mute') === '1';
    UI.setVoice(!state.muted);
    on('posMuteBtn', function () {
      state.muted = !state.muted;
      localStorage.setItem('yt_board_mute', state.muted ? '1' : '0');
      UI.setVoice(!state.muted);
      renderMuteBtn();
      UI.toast(state.muted ? '已静音 MUTED' : '声音开启 SOUND ON', 'success', 1600);
    });
    renderMuteBtn();

    /* 连线提示 = 这一页自己的载入结果 + 全局网络状态（见 UI.netPill） */
    API.onNetwork(function (st) { UI.netPill(state.loadFailed, st); });

    var ver = document.getElementById('posVersion');
    if (ver) ver.textContent = 'v' + ((window.YETIPSY_CONFIG && YETIPSY_CONFIG.APP_VERSION) || '');

    show('kiosk');
    loadMenu(false);
    loadQueue(false);
  }

  function renderPayChips() {
    var box = document.getElementById('payChips');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-pay]'), function (node) {
      var on = node.getAttribute('data-pay') === state.paymentMethod;
      node.className = 'pq' + (on ? ' on' : '');
    });
  }

  function on(id, fn, keyFn) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener(keyFn ? 'keydown' : 'click', keyFn || fn);
  }

  function txt(id) {
    var node = document.getElementById(id);
    return node ? String(node.value || '').trim() : '';
  }

  function set(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function showBtn(id, visible) {
    var node = document.getElementById(id);
    if (node) node.style.display = visible ? '' : 'none';
  }

  function show(tab) {
    state.tab = tab;
    if (el.kiosk)   el.kiosk.style.display   = (tab === 'kiosk')   ? '' : 'none';
    if (el.queue)   el.queue.style.display   = (tab === 'queue')   ? '' : 'none';
    if (el.scan)    el.scan.style.display    = (tab === 'scan')    ? '' : 'none';
    if (el.confirm) el.confirm.style.display = (tab === 'confirm') ? '' : 'none';
    if (el.result)  el.result.style.display  = (tab === 'result')  ? '' : 'none';

    var tabKiosk = document.getElementById('tabKiosk');
    var tabQueue = document.getElementById('tabQueue');
    if (tabKiosk) tabKiosk.className = 'pt' + (tab === 'kiosk' ? ' on' : '');
    if (tabQueue) tabQueue.className = 'pt' + (tab === 'queue' ? ' on' : '');
    var tabs = document.querySelector('.pos-tabs');
    if (tabs) tabs.style.display = (tab === 'scan' || tab === 'confirm' || tab === 'result') ? 'none' : '';

    /* 2.1.10 点餐台也要顾到「待进单」：一直轮询（看不到就 1 秒后再看），
       有新单据才会播报「您有新订单」；只有扫会员码 / 确认 / 结果那几步停下来，
       避免员工正在处理时被打断。 */
    if (tab === 'scan' || tab === 'confirm' || tab === 'result') stopPolling();
    else startPolling();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------
     点餐台：商品格
     --------------------------------------------------------- */

  function loadMenu(verbose) {
    var status = document.getElementById('kioskStatus');
    if (status && !state.menu) status.textContent = '载入酒单…';

    API.staff.getAdminMenu().then(function (res) {
      if (!res.success) {
        if (status) { status.textContent = '酒单载入失败 ' + res.error.code; status.className = 'a-sub warn'; }
        if (!ADMIN.handleError(res.error) && verbose) UI.toast(res.error.message, 'error');
        return;
      }
      var allProducts = res.data.products || [];
      state.menu = {
        categories: (res.data.categories || []).filter(function (c) {
          return String(c.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
        }),
        products: allProducts.filter(function (p) {
          return String(p.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
        }),
        /* ★ 规格也要留着：点商品才知道要不要先选 Size / ICE */
        optionsByProduct: res.data.optionsByProduct || {},
        /* 已下架的商品数（商品格看不到，菜单管理可以重新上架） */
        hiddenCount: allProducts.filter(function (p) {
          return String(p.status || 'ACTIVE').toUpperCase() !== 'ACTIVE';
        }).length
      };
      renderCats();
      renderGrid();
    });
  }

  function renderCats() {
    if (!el.cats) return;
    var cats = [{ categoryId: '', nameZH: '全部', nameEN: 'ALL' }].concat(state.menu ? state.menu.categories : []);
    el.cats.innerHTML = cats.map(function (c) {
      var active = (c.categoryId || '') === state.categoryId ? ' active' : '';
      return '<div class="cat-chip' + active + '" data-cat="' + UI.esc(c.categoryId || '') + '">' +
        (c.nameZH ? UI.esc(c.nameZH) : UI.esc(c.nameEN)) + '</div>';
    }).join('');

    Array.prototype.forEach.call(el.cats.querySelectorAll('.cat-chip'), function (node) {
      node.addEventListener('click', function () {
        var next = node.getAttribute('data-cat') || '';
        state.categoryId = (state.categoryId === next) ? '' : next;
        renderCats();
        renderGrid();
      });
    });
  }

  function gridProducts() {
    var list = (state.menu && state.menu.products) || [];
    if (state.categoryId) {
      list = list.filter(function (p) { return (p.categoryId || '') === state.categoryId; });
    }
    if (state.search) {
      var q = state.search;
      list = list.filter(function (p) {
        return String(p.nameZH || '').toLowerCase().indexOf(q) !== -1 ||
               String(p.nameEN || '').toLowerCase().indexOf(q) !== -1 ||
               String(p.descriptionZH || '').toLowerCase().indexOf(q) !== -1 ||
               String(p.descriptionEN || '').toLowerCase().indexOf(q) !== -1 ||
               (p.tags || []).join(' ').toLowerCase().indexOf(q) !== -1;
      });
    }
    return list;
  }

  /**
   * 这一款有几个规格群（有的話點下去要先選）。
   * 后端给的是平铺清单 → 交给 UI.optionGroups 分组（下架的规格会被滤掉）。
   */
  function optionGroupsOf(productId) {
    var all = (state.menu && state.menu.optionsByProduct && state.menu.optionsByProduct[productId]) || [];
    return UI.optionGroups(all);
  }

  function renderGrid() {
    if (!el.grid) return;
    var list = gridProducts();

    var status = document.getElementById('kioskStatus');
    if (status) {
      status.className = 'a-sub';
      if (!state.menu) {
        status.textContent = '载入酒单…';
      } else {
        var hidden = Number(state.menu.hiddenCount) || 0;
        status.textContent = '点商品加入这张单 · 共 ' + list.length + ' 款' +
          (hidden ? '（另有 ' + hidden + ' 款已下架 → 更多 → 菜单管理 可上架）' : '');
      }
    }

    if (!list.length) {
      var hiddenToo = (state.menu && Number(state.menu.hiddenCount)) || 0;
      el.grid.innerHTML = '<div class="a-empty" style="padding:20px">' +
        (hiddenToo
          ? '商品全部下架了（' + hiddenToo + ' 款）<br><span class="tiny">到「更多 → 菜单管理」按一下重新上架</span>'
          : '酒单还没有商品<br><span class="tiny">到「更多 → 菜单管理」新增</span>') +
        '</div>';
      return;
    }

    el.grid.innerHTML = list.map(function (p) {
      var sold = p.available === false;
      var qty = qtyOf(p.productId);
      var groups = optionGroupsOf(p.productId);
      var thumb = p.imageURL
        ? '<img class="kt-img" src="' + UI.esc(p.imageURL) + '" alt="">'
        : '<span class="kt-img kt-emoji">🍸</span>';

      return '<button class="k-tile' + (sold ? ' is-sold' : '') + (qty ? ' in-cart' : '') +
        '" data-product="' + UI.esc(p.productId) + '"' + (sold ? ' disabled' : '') + '>' +
        thumb +
        '<span class="kt-name">' + UI.esc(p.nameZH || p.nameEN) + '</span>' +
        '<span class="kt-en">' + UI.esc(p.nameEN) + '</span>' +
        '<span class="kt-price">' + (sold ? '售罄 SOLD OUT' : UI.money(p.price)) +
          (groups.length && !sold ? ' <i class="kt-opt">规格</i>' : '') + '</span>' +
        (qty ? '<span class="kt-qty">' + qty + '</span>' +
               '<span class="kt-minus" data-dec="' + UI.esc(p.productId) + '">−</span>' : '') +
      '</button>';
    }).join('');
  }

  /** 事件只绑一次（委派）：商品格重画也不用重新绑 */
  function bindGrid() {
    if (!el.grid || el.grid.getAttribute('data-bound') === '1') return;
    el.grid.setAttribute('data-bound', '1');
    el.grid.addEventListener('click', function (e) {
      /* 格子上的 − ：先把這一款減一杯（不開規格表） */
      var minus = closest(e.target, '[data-dec]');
      if (minus) {
        e.stopPropagation();
        var pid = minus.getAttribute('data-dec');
        var last = null;
        state.lines.forEach(function (l) { if (l.productId === pid) last = l; });
        if (last) setLineQty(last.key, last.qty - 1);
        return;
      }
      var node = closest(e.target, '[data-product]');
      if (!node || node.disabled) return;
      addProduct(node.getAttribute('data-product'));
    });
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches ? node.matches(selector) : false) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ---------------------------------------------------------
     这张单（清单）
     --------------------------------------------------------- */

  function findProduct(productId) {
    var hit = null;
    ((state.menu && state.menu.products) || []).forEach(function (p) {
      if (!hit && p.productId === productId) hit = p;
    });
    return hit;
  }

  function qtyOf(productId) {
    var q = 0;
    state.lines.forEach(function (l) { if (l.productId === productId) q += l.qty; });
    return q;
  }

  /** 同一款 + 同一组规格 → 同一行；规格不同就分开两行 */
  function lineKey(productId, options) {
    var ids = (options || []).map(function (o) { return o.optionId; }).sort().join('+');
    return productId + '|' + ids;
  }

  function optionsText(options) {
    return (options || []).map(function (o) { return o.nameZH || o.nameEN || ''; })
      .filter(Boolean).join('·');
  }

  function addProduct(productId) {
    var p = findProduct(productId);
    if (!p || p.available === false) return;

    /* 有规格 → 先开规格表（否则一律大杯 / 少冰这种东西事后没法补救） */
    var groups = optionGroupsOf(productId);
    if (groups.length) { openOptionSheet(productId); return; }

    addLine(p, [], 1);
  }

  function addLine(product, options, qty) {
    var opts = options || [];
    var key = lineKey(product.productId, opts);
    var add = 0;
    opts.forEach(function (o) { add += Number(o.priceAdjustment) || 0; });

    var line = null;
    state.lines.forEach(function (l) { if (!line && l.key === key) line = l; });

    if (line) {
      line.qty = Math.min(99, line.qty + qty);
    } else {
      state.lines.push({
        key: key,
        productId: product.productId,
        nameZH: product.nameZH || '',
        nameEN: product.nameEN || '',
        unitPrice: (Number(product.price) || 0) + add,
        qty: Math.max(1, Math.min(99, qty)),
        options: opts
      });
    }

    renderGrid();
    renderKioskBar();
    renderTicketLines();
    UI.toast('已加入 ' + (product.nameZH || product.nameEN) +
      (opts.length ? '（' + optionsText(opts) + '）' : ''), 'success');
  }

  function setLineQty(key, qty) {
    var next = Math.round(Number(qty) || 0);
    if (next <= 0) {
      state.lines = state.lines.filter(function (l) { return l.key !== key; });
    } else {
      state.lines.forEach(function (l) {
        if (l.key === key) l.qty = Math.min(99, next);
      });
    }
    renderGrid();
    renderKioskBar();
    renderTicketLines();
  }

  /* ---------------------------------------------------------
     规格表（有规格的商品）
     --------------------------------------------------------- */

  function openOptionSheet(productId) {
    var p = findProduct(productId);
    if (!p) return;
    var groups = optionGroupsOf(productId);

    var selected = {};
    groups.forEach(function (g) {
      if (g.options && g.options.length) selected[g.optionGroup] = g.options[0].optionId;
    });

    state.opt = { product: p, groups: groups, selected: selected, qty: 1 };
    renderOptionSheet();

    var sheet = document.getElementById('optionSheet');
    if (sheet) sheet.style.display = '';
    document.body.classList.add('sheet-open');
  }

  function closeOptionSheet() {
    var sheet = document.getElementById('optionSheet');
    if (sheet) sheet.style.display = 'none';
    state.opt = null;
    /* 清單抽屜沒開的話，就不要鎖住捲動 */
    var ticket = document.getElementById('ticketSheet');
    if (!ticket || ticket.style.display === 'none') document.body.classList.remove('sheet-open');
  }

  function optChosen(group) {
    var o = state.opt;
    if (!o) return null;
    var id = o.selected[group.optionGroup];
    var hit = null;
    (group.options || []).forEach(function (x) { if (!hit && x.optionId === id) hit = x; });
    return hit;
  }

  function optUnitPrice() {
    var o = state.opt;
    if (!o) return 0;
    var total = Number(o.product.price) || 0;
    o.groups.forEach(function (g) {
      var c = optChosen(g);
      if (c) total += Number(c.priceAdjustment) || 0;
    });
    return total;
  }

  function renderOptionSheet() {
    var o = state.opt;
    if (!o) return;

    set('optTitle', o.product.nameZH || o.product.nameEN || '');
    set('optSub', (o.product.nameZH && o.product.nameEN ? o.product.nameEN + ' · ' : '') +
      '请选规格');
    set('optQtyValue', o.qty);
    set('optPrice', UI.money(optUnitPrice()));

    var body = document.getElementById('optionBody');
    if (!body) return;

    body.innerHTML = o.groups.map(function (g) {
      var head = '<div class="opt-group-head">' +
        '<span class="option-group-title">' + UI.esc(g.nameEN || g.optionGroup) + '</span>' +
        '<span class="option-group-sub">' + UI.esc(g.nameZH || '') + '</span>' +
        (g.required ? '<span class="required-mark">必选</span>' : '') +
      '</div>';

      var rows = (g.options || []).map(function (x) {
        var on = o.selected[g.optionGroup] === x.optionId ? ' selected' : '';
        return '<div class="option-row' + on + '" data-group="' + UI.esc(g.optionGroup) +
          '" data-option="' + UI.esc(x.optionId) + '">' +
          '<div class="option-radio"></div>' +
          '<div class="option-name">' + UI.esc(x.nameZH || x.nameEN) +
            (x.nameZH && x.nameEN ? ' <span class="tiny muted">' + UI.esc(x.nameEN) + '</span>' : '') +
          '</div>' +
          '<div class="option-price">' +
            (Number(x.priceAdjustment) > 0 ? '+' + UI.money(x.priceAdjustment) : '') +
          '</div>' +
        '</div>';
      }).join('');

      return head + rows;
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('.option-row'), function (node) {
      node.addEventListener('click', function () {
        o.selected[node.getAttribute('data-group')] = node.getAttribute('data-option');
        Array.prototype.forEach.call(body.querySelectorAll('.option-row'), function (n2) {
          var on = o.selected[n2.getAttribute('data-group')] === n2.getAttribute('data-option');
          n2.classList.toggle('selected', on);
        });
        set('optPrice', UI.money(optUnitPrice()));
      });
    });
  }

  function setOptQty(n) {
    var o = state.opt;
    if (!o) return;
    o.qty = Math.max(1, Math.min(99, n));
    set('optQtyValue', o.qty);
    var minus = document.getElementById('optQtyMinus');
    var plus = document.getElementById('optQtyPlus');
    if (minus) minus.disabled = o.qty <= 1;
    if (plus) plus.disabled = o.qty >= 99;
  }

  function addOptionToTicket() {
    var o = state.opt;
    if (!o) return;
    var chosen = [];
    o.groups.forEach(function (g) {
      var c = optChosen(g);
      if (c) chosen.push({
        optionGroup: g.optionGroup,
        optionId: c.optionId,
        nameZH: c.nameZH,
        nameEN: c.nameEN,
        priceAdjustment: Number(c.priceAdjustment) || 0
      });
    });
    var product = o.product;
    var qty = o.qty;
    closeOptionSheet();
    addLine(product, chosen, qty);
  }

  function linesTotalSen() {
    return state.lines.reduce(function (sum, l) {
      return sum + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
    }, 0);
  }

  function clearLines() {
    state.lines = [];
    state.manualAmountSen = 0;
    state.useManualAmount = false;
    state.pad = '0';
    state.padDecimal = false;
    var toggle = document.getElementById('manualAmountToggle');
    if (toggle) toggle.checked = false;
    var pad = document.getElementById('manualPad');
    if (pad) pad.style.display = 'none';
    set('manualAmount', '0.00');
    renderGrid();
    renderKioskBar();
    renderTicketLines();
  }

  function renderKioskBar() {
    var bar = document.getElementById('kioskBar');
    var n = state.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    set('kbCount', n);
    set('kbTotal', UI.money(linesTotalSen()));
    if (bar) bar.style.display = n > 0 ? '' : 'none';
  }

  /* ---------------------------------------------------------
     清单抽屉
     --------------------------------------------------------- */

  function openTicketSheet() {
    renderTicketLines();
    if (el.sheet) {
      el.sheet.style.display = '';
      document.body.classList.add('sheet-open');
    }
  }

  function closeTicketSheet() {
    if (el.sheet) el.sheet.style.display = 'none';
    document.body.classList.remove('sheet-open');
  }

  function renderTicketLines() {
    if (!el.lines) return;

    var units = state.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    set('ticketSub', state.lines.length
      ? state.lines.length + ' 项 · ' + units + ' 杯 · ' + UI.money(linesTotalSen())
      : '空的 · 从商品格点选');

    if (!state.lines.length) {
      el.lines.innerHTML = '<div class="a-empty" style="padding:18px">清单是空的<br>' +
        '<span class="tiny">回点餐台点商品</span></div>';
    } else {
      el.lines.innerHTML = state.lines.map(function (l) {
        var opts = optionsText(l.options);
        return '<div class="ps-line" data-line="' + UI.esc(l.key) + '">' +
          '<div class="psl-main">' +
            '<div class="psl-name">' + UI.esc(l.nameZH || l.nameEN) + '</div>' +
            (opts ? '<div class="psl-opt">' + UI.esc(opts) + '</div>' : '') +
            '<div class="psl-price">' + UI.money(l.unitPrice) + ' × ' + l.qty +
              ' = <b>' + UI.money(l.unitPrice * l.qty) + '</b></div>' +
          '</div>' +
          '<div class="psl-qty">' +
            '<button class="qty-btn" data-dec="' + UI.esc(l.key) + '">−</button>' +
            '<span class="qty-value">' + l.qty + '</span>' +
            '<button class="qty-btn" data-inc="' + UI.esc(l.key) + '">+</button>' +
            '<button class="psl-x" data-del="' + UI.esc(l.key) + '">✕</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    set('ticketTotal', UI.money(billSen()));

    Array.prototype.forEach.call(el.lines.querySelectorAll('[data-inc]'), function (node) {
      node.addEventListener('click', function () {
        var key = node.getAttribute('data-inc');
        var line = null;
        state.lines.forEach(function (l) { if (!line && l.key === key) line = l; });
        if (line) setLineQty(key, line.qty + 1);
      });
    });
    Array.prototype.forEach.call(el.lines.querySelectorAll('[data-dec]'), function (node) {
      node.addEventListener('click', function () {
        var key = node.getAttribute('data-dec');
        var line = null;
        state.lines.forEach(function (l) { if (!line && l.key === key) line = l; });
        if (line) setLineQty(key, line.qty - 1);
      });
    });
    Array.prototype.forEach.call(el.lines.querySelectorAll('[data-del]'), function (node) {
      node.addEventListener('click', function () {
        setLineQty(node.getAttribute('data-del'), 0);
      });
    });

    var save = document.getElementById('saveTicketBtn');
    if (save) save.disabled = !state.lines.length && !state.manualAmountSen;
  }

  function toggleManualAmount() {
    var toggle = document.getElementById('manualAmountToggle');
    var pad = document.getElementById('manualPad');
    state.useManualAmount = !!(toggle && toggle.checked);
    if (pad) pad.style.display = state.useManualAmount ? '' : 'none';
    if (state.useManualAmount) {
      state.pad = state.pad === '0' ? String(linesTotalSen() / 100) : state.pad;
      updatePad();
    }
    set('ticketTotal', UI.money(billSen()));
  }

  /* ---- 收据金额键盘（POS 机那样，不要叫员工找输入框） ---- */
  function bindPad() {
    var keys = document.getElementById('padKeys');
    if (!keys) return;
    keys.addEventListener('click', function (e) {
      var btn = closest(e.target, '[data-key]');
      if (!btn) return;
      padPress(btn.getAttribute('data-key'));
    });
  }

  function padSen() {
    var n = parseFloat(state.pad);
    if (!isFinite(n) || n < 0) n = 0;
    return Math.round(n * 100);
  }

  function padPress(key) {
    if (key === 'del') {
      state.pad = state.pad.length > 1 ? state.pad.slice(0, -1) : '0';
      if (state.pad === '' || state.pad === '.') state.pad = '0';
      if (state.pad.indexOf('.') === -1) state.padDecimal = false;
      updatePad();
      return;
    }
    if (key === '.') {
      if (!state.padDecimal) {
        state.padDecimal = true;
        if (state.pad.indexOf('.') === -1) state.pad += '.';
      }
      updatePad();
      return;
    }
    if (state.padDecimal) {
      var dec = (state.pad.split('.')[1] || '');
      if (dec.length >= 2) return;
      state.pad += String(key);
    } else if (state.pad === '0') {
      state.pad = String(key);
    } else if (state.pad.replace('.', '').length < 8) {
      state.pad += String(key);
    }
    updatePad();
  }

  function padQuick() {
    state.pad = '0';
    state.padDecimal = false;
    updatePad();
  }

  function updatePad() {
    state.manualAmountSen = state.useManualAmount ? padSen() : 0;
    set('manualAmount', UI.money(padSen()).replace(/^RM\s*/, ''));
    set('ticketTotal', UI.money(billSen()));
  }

  /* ---------------------------------------------------------
     记录单据
     --------------------------------------------------------- */

  function billSen() {
    if (state.useManualAmount) return padSen();
    return linesTotalSen();
  }

  function saveTicket() {
    if (state.busy) return;

    var amount = billSen();
    if (amount <= 0) {
      UI.toast('请先点商品，或勾「手动输入金额」输入收据金额', 'error');
      return;
    }

    state.busy = true;
    var btn = document.getElementById('saveTicketBtn');
    UI.setLoading(btn, true, 'SAVING');

    API.staff.createPosTicket({
      amount: amount,
      externalOrderId: txt('ticketNoInput'),
      note: txt('ticketNoteInput'),
      paymentMethod: state.paymentMethod,
      items: state.lines.map(function (l) {
        var opts = optionsText(l.options);
        return {
          nameZH: (l.nameZH || '') + (opts ? ' ' + opts : ''),
          nameEN: l.nameEN,
          quantity: l.qty,
          unitPriceSen: l.unitPrice
        };
      })
    }).then(function (res) {
      state.busy = false;
      UI.setLoading(btn, false);

      if (!res.success) {
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }

      var ticket = res.data.ticket;
      dropQueueCache();
      ['ticketNoInput', 'ticketNoteInput'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.value = '';
      });
      clearLines();
      state.paymentMethod = 'CASH';
      renderPayChips();
      closeTicketSheet();
      UI.toast('已结账 ' + UI.money(ticket.amount) + ' · 请扫顾客会员码', 'success');

      /* 直接接着扫码（现场最常见的顺序），队列也会同步更新 */
      loadQueue(false);
      beginScan(ticket);
    });
  }

  /* ---------------------------------------------------------
     待进单队列
     --------------------------------------------------------- */

  function loadQueue(verbose) {
    if (!API.staff.getPosQueue) { UI.toast('API 未更新 / API out of date', 'error'); return; }
    return API.staff.getPosQueue().then(function (res) {
      if (!res.success) {
        state.errorCode = res.error.code;
        /* 已经有资料就先留着（轮询失败很常见，不要清空画面） */
        if (state.tickets.length) {
          /* 已经有资料就先留着（轮询失败很常见，不要清空画面） */
          state.loadFailed = true;
          UI.netPill(true);
          var status = document.getElementById('queueStatus');
          if (status) status.textContent = '⚠ 连线不稳 · 显示上次资料（自动重试中）';
          return res;
        }
        if (!ADMIN.handleError(res.error) && verbose) UI.toast(res.error.message, 'error');
        renderQueue(true);
        return res;
      }
      state.errorCode = null;
      state.loadFailed = false;
      UI.netPill(false, 'ok');

      var pending = res.data.pending || [];
      var ids = pending.map(function (t) { return t.orderId; });
      if (state.knownTickets === null) {
        state.knownTickets = ids;              // 第一次载入不播报，不然一开页面就吵
      } else {
        var fresh = ids.filter(function (id) { return state.knownTickets.indexOf(id) === -1; });
        state.knownTickets = ids;
        if (fresh.length && !state.muted && !document.hidden) UI.announceNewOrder(fresh.length);
      }

      state.tickets = pending;
      state.today = res.data.today || null;
      state.pollSeconds = Number(res.data.pollSeconds) || 8;
      renderQueue(false);
      return res;
    });
  }

  function startPolling() {
    stopPolling();
    poller = API.poll(Math.max(5, state.pollSeconds), function () {
      if (state.tab !== 'queue') return Promise.resolve({ success: true });
      return loadQueue(false);
    });
  }

  function stopPolling() {
    if (poller) { poller.stop(); poller = null; }
  }

  function renderQueue(force) {
    var box = document.getElementById('queueBody');
    if (!box) return;

    set('statOpen', state.tickets.length);
    set('statBound', state.today ? state.today.bound : 0);
    set('statPoints', state.today ? UI.points(state.today.points) : 0);
    set('queueCount', state.tickets.length);
    set('tabQueueCount', state.tickets.length);

    var status = document.getElementById('queueStatus');
    if (status) {
      status.textContent = state.errorCode
        ? '载入失败 ' + state.errorCode
        : (state.tickets.length ? state.tickets.length + ' 张单据等着进单' : '目前没有待进单 · 去点餐台录一张');
      status.className = 'a-sub' + (state.errorCode ? ' warn' : '');
    }

    var sig = JSON.stringify([state.errorCode, state.tickets, state.today]);
    if (!force && sig === state.signature) return;
    state.signature = sig;

    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">' +
        '载入失败 / LOAD FAILED<br>' + UI.esc(state.errorCode) +
        '<br><button class="chip mt-16" id="retryBtn">重试 RETRY</button></div>';
      on('retryBtn', function () { loadQueue(true); });
    } else if (!state.tickets.length) {
      box.innerHTML = '<div class="a-empty" style="padding:20px">' +
        '还没有待进单<br><span class="tiny">顾客在 foodcourt 付完款 → 去点餐台录单</span></div>';
    } else {
      box.innerHTML = state.tickets.map(ticketCard).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-scan]'), function (node) {
        node.addEventListener('click', function () {
          var id = node.getAttribute('data-scan');
          var hit = null;
          state.tickets.forEach(function (t) { if (!hit && t.orderId === id) hit = t; });
          if (hit) beginScan(hit);
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-cancel]'), function (node) {
        node.addEventListener('click', function () {
          cancelTicket(node.getAttribute('data-cancel'));
        });
      });
    }

    renderToday();
  }

  function ticketCard(t) {
    return '<div class="ticket" data-ticket="' + UI.esc(t.orderId) + '">' +
      '<div class="tk-top">' +
        '<span class="tk-num">' + UI.esc(t.orderNumber) + '</span>' +
        '<span class="tk-amt">' + UI.money(t.amount) + '</span>' +
      '</div>' +
      (t.note ? '<div class="tk-note">' + UI.esc(t.note) + '</div>' : '') +
      '<div class="tk-meta">' + UI.esc(t.source) + ' · ' + UI.esc(UI.timeOnly(t.createdAt)) + '</div>' +
      '<div class="tk-actions">' +
        '<button class="big-action" data-scan="' + UI.esc(t.orderId) + '">' +
          '扫会员码进单 SCAN MEMBER</button>' +
        '<button class="chip" data-cancel="' + UI.esc(t.orderId) + '">✕</button>' +
      '</div>' +
    '</div>';
  }

  function renderToday() {
    var box = document.getElementById('todayBody');
    if (!box) return;
    var list = (state.today && state.today.recent) || [];
    if (!list.length) {
      box.innerHTML = '<div class="a-empty" style="padding:18px">今天还没有进单</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + list.map(function (t) {
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.esc(t.orderNumber) +
            ' · <span style="color:var(--a-gold)">' + UI.money(t.amount) + '</span></div>' +
          '<div class="a-sub">' + UI.esc(t.customerName || '—') +
            ' · +' + UI.points(t.pointsEarned) + ' 分 · ' + UI.esc(UI.timeOnly(t.boundAt)) + '</div>' +
        '</div>' +
        '<div class="a-right"><span class="chip ok">已进单</span></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /** 只丢「待进单」那一份快取（其余员工资料不动） */
  function dropQueueCache() {
    if (API.cache && API.cache.drop) {
      API.cache.drop('getPosQueue', {});
      API.cache.drop('getDashboard', { date: '' });
      API.cache.drop('getActiveOrders', {});
    }
  }

  function cancelTicket(orderId) {
    var hit = null;
    state.tickets.forEach(function (t) { if (!hit && t.orderId === orderId) hit = t; });
    UI.confirmDialog(
      '取消单据 ' + (hit ? hit.orderNumber : '') + '？',
      'Cancel this ticket?（还没进分才可以取消）',
      '取消 CANCEL'
    ).then(function (yes) {
      if (!yes) return;
      UI.showLoading('CANCELLING');
      API.staff.cancelPosTicket(orderId, 'Cancelled at POS').then(function (res) {
        UI.hideLoading();
        if (!res.success) {
          if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
          loadQueue(false);
          return;
        }
        dropQueueCache();
        UI.toast('已取消单据', 'success');
        loadQueue(false);
      });
    });
  }

  /* ---------------------------------------------------------
     扫码 → 确认 → 进分
     --------------------------------------------------------- */

  function beginScan(ticket) {
    state.selected = ticket;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;

    var box = document.getElementById('scanTicketBox');
    if (box) {
      box.innerHTML =
        '<div class="tk-top">' +
          '<span class="tk-num">' + UI.esc(ticket.orderNumber) + '</span>' +
          '<span class="tk-amt">' + UI.money(ticket.amount) + '</span>' +
        '</div>' +
        (ticket.note ? '<div class="tk-note">' + UI.esc(ticket.note) + '</div>' : '') +
        '<div class="tk-meta">' + UI.esc(ticket.source) + '</div>';
    }

    var manual = document.getElementById('manualInput');
    if (manual) manual.value = '';
    var search = document.getElementById('memberSearchInput');
    if (search) search.value = '';
    state.hits = [];
    renderMemberHits();

    show('scan');

    if (el.hint) el.hint.textContent = '请顾客出示会员码（条码，或条码下方的 QR）';
    if (MEMBER_SCANNER.hasCamera()) startCamera();
    else if (el.hint) el.hint.textContent = '这台装置没有相机 · 请用下面的手动输入';
  }

  function startCamera() {
    MEMBER_SCANNER.start({
      video: el.video,
      onStart: function (hasBarcode) {
        el.scanBox.style.display = '';
        showBtn('startScanBtn', false);
        showBtn('stopScanBtn', true);
        el.hint.textContent = hasBarcode ? '把顾客的会员条码对准框内' : '请扫会员条码下方的 QR';
      },
      onCode: handleCode,
      onError: function (why) {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
        if (el.support) el.support.innerHTML = MEMBER_SCANNER.supportText();
        if (why === 'CAMERA_DENIED') UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
      },
      onStop: function () {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
      }
    });
  }

  function handleCode(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToKiosk(); return; }
    MEMBER_SCANNER.stop();
    UI.showLoading('VERIFYING');

    API.staff.scanMemberCode(text).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.errorCode = null;
      state.customer = res.data.customer;
      state.membership = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft = Number(res.data.verifySeconds) || 180;
      renderConfirm();
      show('confirm');
      startCountdown();
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
    });
  }

  function renderConfirm() {
    var c = state.customer || {};
    var t = state.selected || {};

    var box = document.getElementById('confirmCustomer');
    if (box) {
      box.innerHTML =
        '<div class="a-title">' + UI.esc(c.name || '—') + '</div>' +
        '<div class="a-sub">' + UI.esc(c.customerId || '') + ' · ' + UI.esc(c.phone || '') + '</div>' +
        '<div class="mt-8">' +
          row('等级 TIER', UI.esc((state.membership && state.membership.tier) || 'MEMBER')) +
          row('现有积分 POINTS', UI.esc(String(c.currentPoints || 0)) + ' 分') +
          row('钱包 WALLET', UI.money(c.walletBalance || 0)) +
          row('到店 VISITS', UI.esc(String(c.totalVisits || 0)) + ' 次') +
        '</div>';
    }

    var tk = document.getElementById('confirmTicket');
    if (tk) {
      tk.innerHTML =
        row('单据 TICKET', UI.esc(t.orderNumber || '—')) +
        row('消费金额 BILL', '<span style="font-size:18px;color:var(--a-gold)">' +
          UI.money(t.amount || 0) + '</span>') +
        row('积分 / Reward', '由后端按规则自动计算');
    }
  }

  function row(k, v) {
    return '<div class="pos-row"><span class="pos-k">' + k + '</span>' +
      '<span class="pos-v">' + v + '</span></div>';
  }

  function startCountdown() {
    stopCountdown();
    var left = document.getElementById('verifyLeft');
    if (left) { left.textContent = state.verifyLeft + ' 秒内有效'; left.style.color = ''; }
    countdownTimer = setInterval(function () {
      state.verifyLeft -= 1;
      if (left) {
        left.textContent = state.verifyLeft + ' 秒内有效';
        if (state.verifyLeft <= 30) left.style.color = '#E2696B';
      }
      if (state.verifyLeft <= 0) {
        stopCountdown();
        UI.toast('验证已过期，请重新扫码 / Verification expired', 'error');
        if (state.selected) beginScan(state.selected);
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function backToKiosk() {
    stopCountdown();
    MEMBER_SCANNER.stop();
    state.selected = null;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;
    show('kiosk');
    loadQueue(false);
  }

  /* ---------------------------------------------------------
     顾客没有会员码：手机号 / 名字找会员 → 当面核对 → 确认进分
     （后端写 AUDIT: POS_VERIFY_MANUAL；可用设定关掉）
     --------------------------------------------------------- */

  function searchMember() {
    var input = document.getElementById('memberSearchInput');
    var kw = input ? String(input.value || '').trim() : '';
    if (kw.length < 3) { UI.toast('请输入手机号或名字（至少 3 个字）', 'error'); return; }

    UI.showLoading('SEARCHING');
    API.staff.searchCustomer(kw).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.hits = (res.data.customers || []).slice(0, 8);
      renderMemberHits();
      if (!state.hits.length) UI.toast('找不到会员 / No member found', 'error');
    });
  }

  function renderMemberHits() {
    var box = document.getElementById('memberHits');
    if (!box) return;
    if (!state.hits.length) { box.innerHTML = ''; return; }

    box.innerHTML = '<div class="a-sub mt-8">确认是这位顾客再按 CONFIRM（会写 AUDIT）：</div>' +
      state.hits.map(function (c) {
        return '<div class="mh-row">' +
          '<div class="mh-main">' +
            '<div class="mh-name">' + UI.esc(c.name || '(没有名字)') + '</div>' +
            '<div class="tiny muted-2">' + UI.esc(c.phone || '') + ' · ' +
              UI.esc(c.membershipTier || 'MEMBER') + ' · ' + UI.points(c.currentPoints) + ' 分</div>' +
          '</div>' +
          '<button class="chip" data-pick="' + UI.esc(c.customerId) + '">确认 CONFIRM</button>' +
        '</div>';
      }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-pick]'), function (node) {
      node.addEventListener('click', function () {
        verifyMemberManually(node.getAttribute('data-pick'));
      });
    });
  }

  function verifyMemberManually(customerId) {
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToKiosk(); return; }
    UI.showLoading('VERIFYING');

    API.staff.posVerifyMember(customerId).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.errorCode = null;
      state.customer = res.data.customer;
      state.membership = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft = Number(res.data.verifySeconds) || 180;
      renderConfirm();
      show('confirm');
      startCountdown();
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
    });
  }

  function confirm() {
    if (state.busy) return;
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToKiosk(); return; }
    if (!state.verifyToken) { UI.toast('请先扫顾客的会员码 / Scan the member code first', 'error'); return; }

    state.busy = true;
    var btn = document.getElementById('confirmBtn');
    if (btn) btn.disabled = true;
    UI.showLoading('SAVING');

    API.staff.bindPosTicket({
      orderId: state.selected.orderId,
      customerId: state.customer.customerId,
      verifyToken: state.verifyToken
    }).then(function (res) {
      UI.hideLoading();
      state.busy = false;
      if (btn) btn.disabled = false;

      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        if (res.error.code === 'MEMBER_VERIFY_EXPIRED' ||
            res.error.code === 'MEMBER_VERIFY_REQUIRED' ||
            res.error.code === 'MEMBER_VERIFY_MISMATCH') {
          if (state.selected) beginScan(state.selected);
        } else if (res.error.code === 'TICKET_ALREADY_BOUND') {
          backToKiosk();
        }
        return;
      }

      state.errorCode = null;
      state.result = res.data;
      dropQueueCache();               // 这张单已经不在队列里了
      stopCountdown();
      renderResult();
      show('result');
      UI.toast('已进单 · +' + res.data.pointsEarned + ' 分', 'success');
    });
  }

  function renderResult() {
    var r = state.result || {};
    var t = state.selected || {};

    set('rName', (r.customer && r.customer.name) || '—');
    set('rPoints', '+' + (r.pointsEarned || 0) + ' 分');
    set('rTicket', t.orderNumber || '—');
    set('rBill', UI.money(r.billAmount || 0));
    set('rVisit', r.visitCounted ? '算一次到店' : '6 小时内已算过，不重复计');
    set('rTotal', (r.customer ? r.customer.currentPoints : 0) + ' 分');

    var box = document.getElementById('rReward');
    if (box) {
      box.innerHTML = r.reward
        ? '🎁 已发出 Reward ' + UI.money(r.reward.amount) + ' · 顾客可在会员端开启'
        : '<span class="muted-2">未达 Reward 门槛，本次只发积分</span>';
    }
  }

  /* ---------------- 测试用 ---------------- */

  function renderMuteBtn() {
    var btn = document.getElementById('posMuteBtn');
    if (!btn) return;
    btn.innerHTML = state.muted ? '🔇 静音 MUTED' : '🔔 声音 SOUND';
    btn.className = 'chip' + (state.muted ? '' : ' chip-on');
  }

  function debugState() {
    return {
      tab: state.tab,
      menuProducts: state.menu ? state.menu.products.length : 0,
      categoryId: state.categoryId,
      search: state.search,
      lines: state.lines.map(function (l) { return l.key.split('|')[0] + '×' + l.qty; }),
      pad: state.pad,
      linesTotal: linesTotalSen(),
      bill: billSen(),
      useManualAmount: state.useManualAmount,
      queueCount: state.tickets.length,
      selectedOrderId: state.selected ? state.selected.orderId : null,
      hasVerifyToken: !!state.verifyToken,
      paymentMethod: state.paymentMethod,
      memberHits: state.hits.length,
      muted: state.muted,
      customerId: state.customer ? state.customer.customerId : null,
      pointsEarned: state.result ? state.result.pointsEarned : null,
      errorCode: state.errorCode,
      busy: state.busy
    };
  }

  return {
    init: init,
    loadMenu: loadMenu,
    loadQueue: loadQueue,
    handleCode: handleCode,
    addProduct: addProduct,
    setLineQty: setLineQty,
    clearLines: clearLines,
    saveTicket: saveTicket,
    beginScan: beginScan,
    toggleManualAmount: toggleManualAmount,
    openOptionSheet: openOptionSheet,
    addOptionToTicket: addOptionToTicket,
    setOptQty: setOptQty,
    padPress: padPress,
    show: show,
    debugState: debugState
  };
})();
