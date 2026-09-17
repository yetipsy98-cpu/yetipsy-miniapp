/* =============================================================
   YETIPSY — menu.js（2.1 单页点单）
   -------------------------------------------------------------
   一页做完「逛 → 选规格 → 加入购物车 → 看购物车 → 去结帐」：

     · 酒单预载：首页已经先抓好 / 或快取还在 → 进来直接画，不等后端
     · 搜寻 / 分类 / 风味 → 全部在本机筛（不再每点一次就等一次）
     · 点商品 → 底部抽屜选规格（规格跟酒单一起回来的，不用再抓）
     · 底部购物车条：几件 + 金额 + 结帐，要改数量开抽屉即可

   规则不变：
   · 价格一律用后端回传的数字（§41），下单时后端会重算（§42）
   · 菜单失败要讲清楚，不能伪装成「暂无商品」
   ============================================================= */

var MENU = (function () {

  var MAX_QTY = 20;

  var state = {
    loaded: false,
    error: null,
    categories: [],
    products: [],
    optionsByProduct: {},
    ordering: null,
    maxOrderItems: 20,
    /* 筛选（全部在本机做） */
    search: '',
    tag: '',
    categoryId: '',
    /* 规格抽屉 */
    sheet: null,
    /* 避免同一份资料重复重画 */
    signature: ''
  };

  var ALL = { categoryId: '', nameEN: 'ALL', nameZH: '全部' };
  var el = {};

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }

    el.list       = document.getElementById('menuList');
    el.hint       = document.getElementById('menuHint');
    el.sheet      = document.getElementById('sheetOverlay');
    el.productSheet = document.getElementById('productSheet');
    el.cartSheet  = document.getElementById('cartSheet');
    el.sheetBody  = document.getElementById('sheetBody');
    el.cartBody   = document.getElementById('cartSheetBody');

    bindEvents();

    /* 结帐小抽屉：先把取餐方式设好 + 开始预载报价（顾客还在看酒单） */
    if (window.CHECKOUT && CHECKOUT.initSheet && document.getElementById('checkoutSheet')) {
      CHECKOUT.initSheet();
    }

    renderCartBar();

    /* ★ 先用快取画一次（如果有），画面立刻有东西；后端回来再更新一次 */
    var cached = API.cache.peek('getMenu', {});
    if (cached) apply(cached, true);
    else renderSkeleton();

    load();
  }

  function bindEvents() {
    var input = document.getElementById('menuSearch');
    if (input) {
      input.addEventListener('input', function () {
        state.search = input.value.trim().toLowerCase();
        renderProducts();               // 纯本机筛选，零延迟
      });
    }

    on('topCartBtn', openCart);
    on('cbOpenCart', openCart);
    on('cbCheckout', goCheckout);
    on('cartSheetGo', goCheckout);
    on('cartSheetClose', closeSheets);
    on('sheetClose', closeSheets);
    on('sheetOverlay', function (e) { if (e.target === el.sheet) closeSheets(); });

    on('sheetQtyMinus', function () { setSheetQty((state.sheet ? state.sheet.qty : 1) - 1); });
    on('sheetQtyPlus',  function () { setSheetQty((state.sheet ? state.sheet.qty : 1) + 1); });
    on('sheetAddBtn', addSheetToCart);

    on('cartClearBtn', function () {
      UI.confirmDialog('清空购物车？', 'Clear the whole cart?', '清空 CLEAR').then(function (yes) {
        if (!yes) return;
        CART.clear();
        if (window.CHECKOUT && CHECKOUT.invalidate) CHECKOUT.invalidate();   // 空的购物车没有报价
        renderCart();
        renderCartBar();
        UI.toast('购物车已清空', 'success');
        closeSheets();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheets();
    });
  }

  function on(id, fn) {
    var node = document.getElementById(id);
    if (node) node.addEventListener('click', fn);
  }

  /* ---------------------------------------------------------
     载入（快取优先；同一个 payload 只画一次）
     --------------------------------------------------------- */

  function load() {
    API.customer.getMenu({}).then(function (res) {
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error) && !state.loaded) renderError();
        return;
      }
      state.error = null;
      apply(res.data, false);
    });
  }

  function apply(data, fromCache) {
    state.categories = data.categories || [];
    state.products = data.products || [];
    state.optionsByProduct = data.optionsByProduct || {};
    state.ordering = data.ordering || null;
    state.maxOrderItems = data.maxOrderItems || 20;
    state.loaded = true;

    var sig = JSON.stringify([state.categories, state.products.length, state.products[0],
      state.ordering, state.maxOrderItems]);
    if (sig === state.signature && state.rendered) return;   // 快取与后端一样 → 不重画
    state.signature = sig;
    state.rendered = true;

    render();
    if (fromCache) log('menu painted from cache');
  }

  function log(msg) {
    if (window.console && console.log) console.log('[MENU] ' + msg);
  }

  /* ---------------------------------------------------------
     筛选（全部本机）
     --------------------------------------------------------- */

  function visibleProducts() {
    var q = state.search;
    return state.products.filter(function (p) {
      if (state.categoryId && (p.categoryId || '') !== state.categoryId) return false;
      if (state.tag && (p.tags || []).indexOf(state.tag) === -1) return false;
      if (!q) return true;
      var hay = [p.nameEN, p.nameZH, p.descriptionEN, p.descriptionZH, (p.tags || []).join(' ')]
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  /** 目前这一批商品里出现过的风味（分类/搜寻改变时不会整条消失） */
  function visibleTags() {
    var set = {};
    visibleProducts().forEach(function (p) {
      (p.tags || []).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
    });
    return Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 8);
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function renderSkeleton() {
    if (!el.list) return;
    el.list.innerHTML = '<div class="menu-skeleton"></div>'.repeat(4);
    if (el.hint) el.hint.textContent = '';
  }

  function renderError() {
    if (!el.list) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    el.list.innerHTML =
      '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div class="bilingual-zh">酒单载入失败</div>' +
        '<div class="bilingual-en">MENU FAILED TO LOAD</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">错误码 ' + UI.esc(code) + '</div>' +
        '<div class="tiny muted mt-12" style="line-height:1.7">' +
          UI.esc(state.error && state.error.message || '') +
        '</div>' +
        '<button class="btn btn-secondary mt-12" id="menuRetryBtn">重试 RETRY</button>' +
      '</div>';
    on('menuRetryBtn', function () { renderSkeleton(); load(); });
  }

  function render() {
    renderOrderingBanner();
    renderCategories();
    renderProducts();
  }

  function renderOrderingBanner() {
    var box = document.getElementById('orderingBanner');
    if (!box) return;
    var o = state.ordering;
    if (!o || o.open) { box.innerHTML = ''; return; }

    var zh, en;
    if (o.reason === 'DISABLED') {
      zh = '目前未开放线上点单';
      en = 'Online ordering is not available right now.';
    } else if (o.reason === 'PAUSED') {
      zh = '目前暂停接单，我们正在忙 🍸';
      en = "ORDERS TEMPORARILY PAUSED · We're catching up.";
    } else {
      zh = '点单时间 ' + o.openTime + ' – ' + o.closeTime + '，你可以先看看酒单';
      en = 'ORDERING CLOSED · You can still browse our menu.';
    }
    box.innerHTML = '<div class="ordering-banner">' +
      '<div class="ordering-banner-zh">' + UI.esc(zh) + '</div>' +
      '<div class="ordering-banner-en">' + UI.esc(en) + '</div>' +
      '</div>';
  }

  function renderCategories() {
    var strip = document.getElementById('catStrip');
    if (!strip) return;
    var cats = [ALL].concat(state.categories);
    strip.innerHTML = cats.map(function (c) {
      var active = (c.categoryId || '') === state.categoryId ? ' active' : '';
      return '<div class="cat-chip' + active + '" data-cat="' + UI.esc(c.categoryId || '') + '">' +
        (c.nameZH ? UI.esc(c.nameZH) : UI.esc(c.nameEN)) + '</div>';
    }).join('');

    Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (node) {
      node.addEventListener('click', function () {
        var next = node.getAttribute('data-cat') || '';
        state.categoryId = (state.categoryId === next) ? '' : next;
        state.tag = '';
        renderCategories();
        renderProducts();
      });
    });
  }

  function renderProducts() {
    if (!el.list) return;
    if (state.error) { renderError(); return; }

    renderTags();

    var list = visibleProducts();

    if (!list.length) {
      el.list.innerHTML = UI.emptyState(
        state.search || state.tag || state.categoryId ? '找不到符合的酒' : '酒单还没有商品',
        state.search || state.tag || state.categoryId ? 'NO MATCHING DRINKS' : 'MENU IS EMPTY',
        'activity');
      if (el.hint) el.hint.textContent = '';
      return;
    }

    /* 依分类分组（分类顺序来自 Sheet） */
    var order = state.categories.map(function (c) { return c.categoryId; });
    var groups = {};
    list.forEach(function (p) {
      var key = p.categoryId || '_';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    var keys = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 999;
      if (ib < 0) ib = 999;
      return ia - ib;
    });

    var html = '';
    keys.forEach(function (key) {
      var cat = state.categories.filter(function (c) { return c.categoryId === key; })[0];
      if (cat) {
        html += '<div class="menu-cat-title">' + UI.esc(cat.nameEN) +
          '<span class="menu-cat-zh">' + UI.esc(cat.nameZH) + '</span></div>';
      }
      groups[key].forEach(function (p) { html += productCard(p); });
    });

    el.list.innerHTML = html;

    if (el.hint) {
      el.hint.textContent = (state.search || state.tag || state.categoryId)
        ? '找到 ' + list.length + ' 款' : '共 ' + list.length + ' 款 · 点一下加入';
    }
  }

  function renderTags() {
    var strip = document.getElementById('tagStrip');
    if (!strip) return;
    var tags = visibleTags();
    if (state.tag && tags.indexOf(state.tag) === -1) state.tag = '';
    if (!tags.length) { strip.innerHTML = ''; return; }

    strip.innerHTML = tags.map(function (t) {
      return '<div class="tag-chip' + (t === state.tag ? ' active' : '') + '" data-tag="' +
        UI.esc(t) + '">' + UI.esc(t) + '</div>';
    }).join('');

    Array.prototype.forEach.call(strip.querySelectorAll('.tag-chip'), function (node) {
      node.addEventListener('click', function () {
        var t = node.getAttribute('data-tag');
        state.tag = (state.tag === t) ? '' : t;
        renderProducts();
      });
    });
  }

  function productCard(p) {
    var sold = p.available === false;
    var groups = state.optionsByProduct[p.productId] || [];
    var thumb = p.imageURL
      ? '<div class="product-thumb"><img src="' + UI.esc(p.imageURL) + '" alt="" ' +
        'onerror="this.parentNode.textContent=\'🍸\'"></div>'
      : '<div class="product-thumb">🍸</div>';

    var priceHtml = '<span class="product-price">' + UI.money(p.price) + '</span>';
    if (p.onPromo && p.originalPrice) {
      priceHtml += '<span class="product-price-was">' + UI.money(p.originalPrice) + '</span>' +
        '<span class="promo-badge">PROMO</span>';
    }

    return '<div class="product-card' + (sold ? ' is-sold' : '') + '" data-id="' +
      UI.esc(p.productId) + '">' +
      thumb +
      '<div class="product-info">' +
        '<div class="product-name">' + UI.esc(p.nameEN) + '</div>' +
        (p.nameZH ? '<div class="product-name-zh">' + UI.esc(p.nameZH) + '</div>' : '') +
        (p.descriptionEN || p.descriptionZH
          ? '<div class="product-desc">' + UI.esc(p.descriptionZH || p.descriptionEN) + '</div>'
          : '') +
        '<div class="product-price-row">' + priceHtml +
          (groups.length && !sold ? '<span class="card-hint">' + groups.length + ' 个规格可选</span>' : '') +
        '</div>' +
        (sold ? '<span class="sold-out-badge">SOLD OUT 售罄</span>' : '') +
      '</div>' +
      '<button class="product-add"' + (sold ? ' disabled' : '') + ' data-add="' +
        UI.esc(p.productId) + '">' + (sold ? '✕' : '+') + '</button>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     规格抽屉
     --------------------------------------------------------- */

  function findProduct(productId) {
    var hit = null;
    state.products.forEach(function (p) { if (!hit && p.productId === productId) hit = p; });
    return hit;
  }

  function optionGroupsOf(productId) {
    return state.optionsByProduct[productId] || [];
  }

  function openProduct(productId) {
    var p = findProduct(productId);
    if (!p || p.available === false) return;

    var groups = optionGroupsOf(productId);
    var selected = {};
    groups.forEach(function (g) {
      if (g.options && g.options.length) selected[g.optionGroup] = g.options[0].optionId;
    });

    state.sheet = { mode: 'product', product: p, groups: groups, selected: selected, qty: 1, note: '' };
    renderSheet();
    openSheets(el.productSheet);
  }

  function sheetUnitPrice() {
    var s = state.sheet;
    if (!s) return 0;
    var total = Number(s.product.price) || 0;
    s.groups.forEach(function (g) {
      var chosen = chosenOf(g);
      if (chosen) total += Number(chosen.priceAdjustment) || 0;
    });
    return total;
  }

  function chosenOf(group) {
    var s = state.sheet;
    if (!s) return null;
    var id = s.selected[group.optionGroup];
    if (!id) return null;
    var hit = null;
    (group.options || []).forEach(function (o) { if (!hit && o.optionId === id) hit = o; });
    return hit;
  }

  function missingRequired() {
    var s = state.sheet;
    if (!s) return [];
    return s.groups.filter(function (g) { return g.required && !s.selected[g.optionGroup]; });
  }

  function renderSheet() {
    var s = state.sheet;
    if (!s) return;

    set('sheetTitle', s.product.nameEN || '');
    set('sheetSub', (s.product.nameZH ? s.product.nameZH + ' · ' : '') + UI.money(sheetUnitPrice()));
    set('sheetQtyValue', s.qty);

    var html = '';
    s.groups.forEach(function (g) {
      html += '<div class="option-group">' +
        '<div class="sheet-group-head">' +
          '<span class="option-group-title">' + UI.esc(g.nameEN || g.optionGroup) + '</span>' +
          '<span class="option-group-sub">' + UI.esc(g.nameZH || '') + '</span>' +
          (g.required ? '<span class="required-mark">必选</span>' : '') +
        '</div>';
      (g.options || []).forEach(function (o) {
        var sel = s.selected[g.optionGroup] === o.optionId ? ' selected' : '';
        html += '<div class="option-row' + sel + '" data-group="' + UI.esc(g.optionGroup) +
          '" data-option="' + UI.esc(o.optionId) + '">' +
          '<div class="option-radio"></div>' +
          '<div class="option-name">' + UI.esc(o.nameEN) +
            (o.nameZH ? ' <span class="tiny muted">' + UI.esc(o.nameZH) + '</span>' : '') +
          '</div>' +
          '<div class="option-price">' +
            (Number(o.priceAdjustment) > 0 ? '+' + UI.money(o.priceAdjustment) : UI.money(0)) +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    });

    html += '<div class="sheet-note">' +
      '<div class="bilingual-zh" style="font-size:13px">备注 <span class="tiny muted-2">SPECIAL REQUEST</span></div>' +
      '<textarea class="textarea mt-8" id="sheetNote" rows="2" maxlength="200" ' +
        'placeholder="例如：不要太甜 / Less sugar">' + UI.esc(s.note) + '</textarea>' +
    '</div>';

    el.sheetBody.innerHTML = html;

    Array.prototype.forEach.call(el.sheetBody.querySelectorAll('.option-row'), function (node) {
      node.addEventListener('click', function () {
        s.selected[node.getAttribute('data-group')] = node.getAttribute('data-option');
        renderSheetOnly();
        updateSheetCta();
      });
    });

    var note = document.getElementById('sheetNote');
    if (note) {
      note.addEventListener('input', function () { s.note = note.value; });
    }

    updateSheetCta();
    log('product sheet for ' + s.product.productId + ' (no network)');
  }

  /** 只切换选中样式，避免重画把备注吃掉 */
  function renderSheetOnly() {
    var s = state.sheet;
    if (!s || !el.sheetBody) return;
    Array.prototype.forEach.call(el.sheetBody.querySelectorAll('.option-row'), function (node) {
      var on = s.selected[node.getAttribute('data-group')] === node.getAttribute('data-option');
      node.classList.toggle('selected', on);
    });
    set('sheetSub', (s.product.nameZH ? s.product.nameZH + ' · ' : '') + UI.money(sheetUnitPrice()));
  }

  function updateSheetCta() {
    var btn = document.getElementById('sheetAddBtn');
    if (!btn) return;
    var missing = missingRequired();
    var total = sheetUnitPrice() * (state.sheet ? state.sheet.qty : 1);

    if (missing.length) {
      btn.innerHTML = '<span>请选择 ' +
        UI.esc(missing[0].nameZH || missing[0].nameEN || missing[0].optionGroup) + '</span>';
      btn.disabled = true;
      return;
    }
    btn.disabled = state.ordering && state.ordering.open === false;
    btn.innerHTML = '<span>加入购物车 ADD · ' + UI.money(total) + '</span>';
  }

  function setSheetQty(n) {
    var s = state.sheet;
    if (!s) return;
    s.qty = Math.max(1, Math.min(MAX_QTY, n));
    set('sheetQtyValue', s.qty);
    var minus = document.getElementById('sheetQtyMinus');
    var plus = document.getElementById('sheetQtyPlus');
    if (minus) minus.disabled = s.qty <= 1;
    if (plus) plus.disabled = s.qty >= MAX_QTY;
    updateSheetCta();
  }

  function addSheetToCart() {
    var s = state.sheet;
    if (!s) return;
    if (missingRequired().length) { updateSheetCta(); return; }

    var options = [];
    s.groups.forEach(function (g) {
      var o = chosenOf(g);
      if (o) {
        options.push({
          optionGroup: g.optionGroup,
          optionId: o.optionId,
          nameEN: o.nameEN,
          nameZH: o.nameZH
        });
      }
    });

    addToCart(s.product, options, s.qty, s.note, sheetUnitPrice());
  }

  /** 没有规格的商品：卡片上的 + 直接加入（一次点击就完成） */
  function quickAdd(productId) {
    var p = findProduct(productId);
    if (!p || p.available === false) return;
    var groups = optionGroupsOf(productId);

    if (groups.length) { openProduct(productId); return; }

    if (state.ordering && state.ordering.open === false) {
      UI.toast('目前未开放线上点单', 'error');
      return;
    }
    addToCart(p, [], 1, '', Number(p.price) || 0);
  }

  /**
   * 2.1.13：顾客还在酒单页就把「结帐金额」算好（存在 sessionStorage），
   * 到购物车页 / 打开结帐抽屉就是现成的，不用再等后端。
   */
  function warmQuote() {
    try {
      if (!window.CHECKOUT || !CHECKOUT.prefetchSoon) return;
      CHECKOUT.prefetchSoon();               // 400ms 后再算，连续加购只算最后一次
    } catch (e) {}
  }

  /** unitPriceSen 由呼叫端算好（含规格加价），这样购物车条显示的金额才会跟结帐一致 */
  function addToCart(p, options, qty, note, unitPriceSen) {
    if (state.ordering && state.ordering.open === false) {
      UI.toast('目前未开放线上点单', 'error');
      return;
    }

    var res = CART.add({
      productId: p.productId,
      nameEN: p.nameEN,
      nameZH: p.nameZH,
      unitPrice: Number(unitPriceSen) || Number(p.price) || 0,
      quantity: qty,
      options: options,
      note: String(note || '').slice(0, 200)
    });

    if (!res.ok) { UI.toast(res.message, 'error'); return; }

    closeSheets();
    renderCartBar();
    renderCart();
    warmQuote();
    UI.toast('已加入 · ' + (p.nameZH || p.nameEN), 'success');
  }

  /* ---------------------------------------------------------
     购物车条 / 抽屉
     --------------------------------------------------------- */

  function renderCartBar() {
    var bar = document.getElementById('cartBar');
    var n = CART.count();
    set('cbCount', n);
    set('cbTotal', UI.money(CART.subtotalSen()));
    if (bar) bar.style.display = n > 0 ? '' : 'none';

    var badge = document.getElementById('topCartBadge');
    if (badge) {
      badge.textContent = n;
      badge.style.display = n > 0 ? '' : 'none';
    }
  }

  function openCart() {
    warmQuote();
    renderCart();
    openSheets(el.cartSheet);
  }

  function renderCart() {
    if (!el.cartBody) return;
    var items = CART.items();

    set('cartSheetSub', items.length
      ? items.length + ' 项 · ' + UI.money(CART.subtotalSen())
      : '空 EMPTY');

    if (!items.length) {
      el.cartBody.innerHTML = '<div class="a-empty-lite">购物车是空的<br>' +
        '<span class="tiny muted-2">从酒单点一下就可以加进来</span></div>';
      var go = document.getElementById('cartSheetGo');
      if (go) go.disabled = true;
      return;
    }

    el.cartBody.innerHTML = items.map(function (it) {
      var optText = (it.options || []).map(function (o) {
        return o.nameZH || o.nameEN || '';
      }).filter(Boolean).join(' · ');

      return '<div class="cart-line" data-line="' + UI.esc(it.lineId) + '">' +
        '<div class="cl-main">' +
          '<div class="cl-name">' + UI.esc(it.nameZH || it.nameEN) + '</div>' +
          (optText ? '<div class="cl-opt">' + UI.esc(optText) + '</div>' : '') +
          (it.note ? '<div class="cl-note">备注 ' + UI.esc(it.note) + '</div>' : '') +
          '<div class="cl-price">' + UI.money(CART.lineTotalSen(it)) + '</div>' +
        '</div>' +
        '<div class="qty-ctrl cl-qty">' +
          '<button class="qty-btn" data-dec="' + UI.esc(it.lineId) + '">−</button>' +
          '<span class="qty-value">' + it.quantity + '</span>' +
          '<button class="qty-btn" data-inc="' + UI.esc(it.lineId) + '">+</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var go = document.getElementById('cartSheetGo');
    if (go) go.disabled = false;

    Array.prototype.forEach.call(el.cartBody.querySelectorAll('[data-inc]'), function (node) {
      node.addEventListener('click', function () {
        var id = node.getAttribute('data-inc');
        var line = findLine(id);
        if (line) CART.setQuantity(id, line.quantity + 1);
        refreshCartUi();
      });
    });
    Array.prototype.forEach.call(el.cartBody.querySelectorAll('[data-dec]'), function (node) {
      node.addEventListener('click', function () {
        var id = node.getAttribute('data-dec');
        var line = findLine(id);
        if (!line) return;
        if (line.quantity <= 1) CART.remove(id);
        else CART.setQuantity(id, line.quantity - 1);
        refreshCartUi();
      });
    });
  }

  function findLine(lineId) {
    var hit = null;
    CART.items().forEach(function (it) { if (!hit && it.lineId === lineId) hit = it; });
    return hit;
  }

  function refreshCartUi() {
    renderCart();
    renderCartBar();
    warmQuote();
  }

  function goCheckout() {
    if (!CART.count()) { UI.toast('购物车是空的 / Cart is empty', 'error'); return; }
    /* 2.1.13：不换页 —— 关掉购物车抽屉，直接滑出结帐小抽屉。
       报价在加购的时候就已经算好（warmQuote），所以是立刻就有金额。 */
    if (window.CHECKOUT && CHECKOUT.openSheet && document.getElementById('checkoutSheet')) {
      closeSheets();
      CHECKOUT.openSheet();
      return;
    }
    UI.go('cart.html');
  }

  /* ---------------------------------------------------------
     抽屉开关
     --------------------------------------------------------- */

  function openSheets(which) {
    if (!el.sheet) return;
    el.sheet.style.display = '';
    if (el.productSheet) el.productSheet.style.display = which === el.productSheet ? '' : 'none';
    if (el.cartSheet)    el.cartSheet.style.display    = which === el.cartSheet ? '' : 'none';
    document.body.classList.add('sheet-open');
    /* 进场动画（下一帧才加 class，才会动） */
    setTimeout(function () {
      if (el.productSheet && el.productSheet.style.display !== 'none') el.productSheet.classList.add('in');
      if (el.cartSheet && el.cartSheet.style.display !== 'none') el.cartSheet.classList.add('in');
    }, 10);
  }

  function closeSheets() {
    if (!el.sheet) return;
    if (el.productSheet) { el.productSheet.classList.remove('in'); el.productSheet.style.display = 'none'; }
    if (el.cartSheet)    { el.cartSheet.classList.remove('in');    el.cartSheet.style.display = 'none'; }
    el.sheet.style.display = 'none';
    document.body.classList.remove('sheet-open');
    state.sheet = null;
  }

  /* ---------------------------------------------------------
     事件委派（清单重画也不用重新绑）
     --------------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute('data-add')) {
        e.stopPropagation();
        quickAdd(node.getAttribute('data-add'));
        return;
      }
      if (node.classList && node.classList.contains('product-card')) {
        openProduct(node.getAttribute('data-id'));       // 卡片本身 → 开规格抽屉
        return;
      }
      node = node.parentNode;
    }
  });

  function set(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  /* ---------------- 测试用 ---------------- */

  function debugState() {
    return {
      loaded: state.loaded,
      errorCode: state.error ? state.error.code : null,
      categories: state.categories.length,
      products: state.products.length,
      visible: visibleProducts().length,
      tag: state.tag,
      categoryId: state.categoryId,
      search: state.search,
      cartCount: CART.count(),
      cartSubtotal: CART.subtotalSen(),
      sheet: state.sheet ? {
        productId: state.sheet.product.productId,
        groups: state.sheet.groups.length,
        qty: state.sheet.qty
      } : null
    };
  }

  return {
    init: init,
    load: load,
    openProduct: openProduct,
    quickAdd: quickAdd,
    openCart: openCart,
    closeSheets: closeSheets,
    setSheetQty: setSheetQty,
    addSheetToCart: addSheetToCart,
    debugState: debugState
  };
})();
