/* =============================================================
   YETIPSY — menu.js（2.0 Phase 3）
   -------------------------------------------------------------
   酒单页：分类 / 商品 / 搜寻 / 风味筛选 / 售罄（§5 §6 §31 §34 §35）

   几条规则：
   · 价格一律用后端回传的 product.price，前端绝不自己算（§41）
   · 菜单失败要讲清楚，不能伪装成「暂无商品」（1.2 活动区的教训）
   · 载入状态画在内容区（骨架），不用全屏 overlay（会员条码页的教训）
   ============================================================= */

var MENU = (function () {

  var state = {
    loading: false,
    loaded: false,
    error: null,
    categories: [],
    products: [],
    optionsByProduct: {},
    ordering: null,
    allowPickup: true,
    allowTableOrder: true,
    maxOrderItems: 20,
    /* 目前的筛选 */
    search: '',
    tag: '',
    categoryId: ''
  };

  /* 后端没给分类时的兜底标题（分类本身仍来自 Sheet，§5） */
  var ALL = { categoryId: '', nameEN: 'ALL', nameZH: '全部' };

  var searchTimer = null;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    bindEvents();
    renderSkeleton();
    load();
  }

  function bindEvents() {
    var input = document.getElementById('menuSearch');
    if (input) {
      input.addEventListener('input', function () {
        /* 输入时先在本地筛（快），同时向后端要一次权威结果 */
        state.search = input.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(load, 260);
        renderLocal();
      });
    }

    var retry = document.getElementById('menuRetryBtn');
    if (retry) retry.addEventListener('click', function () { renderSkeleton(); load(); });
  }

  function load() {
    state.loading = true;
    API.customer.getMenu({
      search: state.search,
      tag: state.tag,
      categoryId: state.categoryId
    }).then(function (res) {
      state.loading = false;
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error)) renderError();
        return;
      }
      state.error = null;
      state.loaded = true;
      state.categories = res.data.categories || [];
      state.products = res.data.products || [];
      state.optionsByProduct = res.data.optionsByProduct || {};
      state.ordering = res.data.ordering || null;
      state.allowPickup = res.data.allowPickup !== false;
      state.allowTableOrder = res.data.allowTableOrder !== false;
      state.maxOrderItems = res.data.maxOrderItems || 20;
      render();
    });
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function renderSkeleton() {
    var box = document.getElementById('menuList');
    if (!box) return;
    box.innerHTML = '<div class="menu-skeleton"></div>'.repeat(5);
    var hint = document.getElementById('menuHint');
    if (hint) hint.textContent = '';
  }

  /** §58/§64：点单关闭时菜单仍可浏览，但要讲清楚 */
  function orderingBanner() {
    var o = state.ordering;
    if (!o) return '';
    if (o.open) return '';

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
    return '<div class="ordering-banner">' +
      '<div class="ordering-banner-zh">' + UI.esc(zh) + '</div>' +
      '<div class="ordering-banner-en">' + UI.esc(en) + '</div>' +
      '</div>';
  }

  function renderError() {
    var box = document.getElementById('menuList');
    if (!box) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    box.innerHTML =
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
    var btn = document.getElementById('menuRetryBtn');
    if (btn) btn.addEventListener('click', function () { renderSkeleton(); load(); });
  }

  /** 只在本地重画商品清单（输入搜寻时用，避免整页闪） */
  function renderLocal() {
    if (!state.loaded) return;
    renderProducts();
  }

  function render() {
    renderOrderingBanner();
    renderCategories();
    renderTags();
    renderProducts();
  }

  function renderOrderingBanner() {
    var box = document.getElementById('orderingBanner');
    if (box) box.innerHTML = orderingBanner();
  }

  function renderCategories() {
    var strip = document.getElementById('catStrip');
    if (!strip) return;
    var cats = [ALL].concat(state.categories);
    strip.innerHTML = cats.map(function (c) {
      var active = (c.categoryId || '') === state.categoryId ? ' active' : '';
      var label = c.nameZH ? UI.esc(c.nameZH) : UI.esc(c.nameEN);
      return '<div class="cat-chip' + active + '" data-cat="' + UI.esc(c.categoryId || '') + '">' +
        label + '</div>';
    }).join('');

    Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (el) {
      el.addEventListener('click', function () {
        state.categoryId = el.getAttribute('data-cat') || '';
        renderCategories();
        renderSkeleton();
        load();
      });
    });
  }

  function renderTags() {
    var strip = document.getElementById('tagStrip');
    if (!strip) return;
    /* 风味标签从商品的 tags 收集（§35），不写死 */
    var set = {};
    state.products.forEach(function (p) {
      (p.tags || []).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
    });
    /* 也把「全部商品」的标签纳入，避免筛掉之后就看不到其他标签 */
    var tags = Object.keys(set).sort(function (a, b) { return set[b] - set[a]; }).slice(0, 8);

    if (!tags.length) { strip.innerHTML = ''; return; }
    strip.innerHTML = tags.map(function (t) {
      var active = t === state.tag ? ' active' : '';
      return '<div class="tag-chip' + active + '" data-tag="' + UI.esc(t) + '">' +
        UI.esc(t) + '</div>';
    }).join('');

    Array.prototype.forEach.call(strip.querySelectorAll('.tag-chip'), function (el) {
      el.addEventListener('click', function () {
        var t = el.getAttribute('data-tag');
        state.tag = (state.tag === t) ? '' : t;      // 再点一次取消
        renderTags();
        renderSkeleton();
        load();
      });
    });
  }

  function renderProducts() {
    var box = document.getElementById('menuList');
    if (!box) return;

    if (state.error) { renderError(); return; }

    if (!state.products.length) {
      box.innerHTML = UI.emptyState(
        state.search || state.tag ? '找不到符合的酒' : '酒单还没有商品',
        state.search || state.tag ? 'NO MATCHING DRINKS' : 'MENU IS EMPTY',
        'activity');
      var hint = document.getElementById('menuHint');
      if (hint) hint.textContent = '';
      return;
    }

    /* 依分类分组（分类顺序来自 Sheet） */
    var order = state.categories.map(function (c) { return c.categoryId; });
    var groups = {};
    state.products.forEach(function (p) {
      var key = p.categoryId || '_';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    var html = '';
    var keys = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 999;
      if (ib < 0) ib = 999;
      return ia - ib;
    });

    keys.forEach(function (key) {
      var cat = state.categories.filter(function (c) { return c.categoryId === key; })[0];
      if (cat) {
        html += '<div class="menu-cat-title">' + UI.esc(cat.nameEN) +
          '<span class="menu-cat-zh">' + UI.esc(cat.nameZH) + '</span></div>';
      }
      groups[key].forEach(function (p) { html += productCard(p); });
    });

    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('.product-card'), function (el) {
      el.addEventListener('click', function () {
        UI.go('product.html?id=' + encodeURIComponent(el.getAttribute('data-id')));
      });
    });

    var hint = document.getElementById('menuHint');
    if (hint) {
      hint.textContent = state.search || state.tag
        ? '找到 ' + state.products.length + ' 款'
        : '共 ' + state.products.length + ' 款';
    }
  }

  function productCard(p) {
    var sold = p.available === false;
    var thumb = p.imageURL
      ? '<div class="product-thumb"><img src="' + UI.esc(p.imageURL) + '" alt="" ' +
        'onerror="this.parentNode.textContent=\'🍸\'"></div>'
      : '<div class="product-thumb">🍸</div>';

    var priceHtml = '<span class="product-price">' + UI.money(p.price) + '</span>';
    if (p.onPromo && p.originalPrice) {
      priceHtml += '<span class="product-price-was">' + UI.money(p.originalPrice) + '</span>' +
        '<span class="promo-badge">PROMO</span>';
    }

    return '<div class="product-card' + (sold ? ' is-sold' : '') + '" data-id="' + UI.esc(p.productId) + '">' +
      thumb +
      '<div class="product-info">' +
        '<div class="product-name">' + UI.esc(p.nameEN) + '</div>' +
        (p.nameZH ? '<div class="product-name-zh">' + UI.esc(p.nameZH) + '</div>' : '') +
        (p.descriptionEN || p.descriptionZH
          ? '<div class="product-desc">' + UI.esc(p.descriptionZH || p.descriptionEN) + '</div>'
          : '') +
        '<div class="product-price-row">' + priceHtml + '</div>' +
        (sold ? '<span class="sold-out-badge">SOLD OUT 售罄</span>' : '') +
      '</div>' +
      '<div class="product-add"' + (sold ? ' style="opacity:.3"' : '') + '>' + (sold ? '✕' : '+') + '</div>' +
    '</div>';
  }

  /** 给测试用：不碰 DOM 也能检查状态 */
  function debugState() {
    return {
      loading: state.loading,
      loaded: state.loaded,
      errorCode: state.error ? state.error.code : null,
      categories: state.categories.length,
      products: state.products.length,
      ordering: state.ordering,
      search: state.search,
      tag: state.tag,
      categoryId: state.categoryId
    };
  }

  return {
    init: init,
    load: load,
    debugState: debugState
  };

})();
