/* =============================================================
   YETIPSY — product.js（2.0 Phase 3）
   -------------------------------------------------------------
   商品详情：风味标签 / 规格（Size · ICE · SWEETNESS）/ 备注 / 数量
   （§7 §8）

   规则：
   · 单价与规格加价一律来自后端（§41），前端只负责加总显示。
     真正下单时后端会重新算一次（§42），这里的数字只是预览。
   · 必选规格没选完就不给加入清单（§8）
   ============================================================= */

var PRODUCT = (function () {

  var state = {
    productId: '',
    product: null,
    optionGroups: [],
    /* { OPTIONGROUP: optionId } */
    selected: {},
    quantity: 1,
    note: '',
    error: null
  };

  var MAX_QTY = 20;

  function init() {
    if (!AUTH.isCustomerLoggedIn()) { AUTH.requireCustomer(); return; }
    state.productId = UI.getParam('id') || '';
    if (!state.productId) {
      UI.toast('缺少商品编号 / Missing product id', 'error');
      return;
    }
    bindEvents();
    renderSkeleton();
    load();
  }

  function bindEvents() {
    var minus = document.getElementById('qtyMinus');
    var plus = document.getElementById('qtyPlus');
    if (minus) minus.addEventListener('click', function () { setQty(state.quantity - 1); });
    if (plus) plus.addEventListener('click', function () { setQty(state.quantity + 1); });

    var note = document.getElementById('productNote');
    if (note) {
      note.addEventListener('input', function () { state.note = note.value; });
    }

    var add = document.getElementById('addToCartBtn');
    if (add) add.addEventListener('click', onAddToCart);
  }

  function load() {
    API.customer.getProduct(state.productId).then(function (res) {
      if (!res.success) {
        state.error = res.error;
        if (!AUTH.handleSessionError(res.error)) renderError();
        return;
      }
      state.product = res.data.product;
      state.optionGroups = res.data.optionGroups || [];
      state.error = null;
      /* 每组规格先选第一个（必选组这样就有预设值） */
      state.selected = {};
      state.optionGroups.forEach(function (g) {
        if (g.options && g.options.length) state.selected[g.optionGroup] = g.options[0].optionId;
      });
      render();
    });
  }

  /* ---------------------------------------------------------
     计算（只用后端给的数字）
     --------------------------------------------------------- */

  function optionsPriceSen() {
    var total = 0;
    state.optionGroups.forEach(function (g) {
      var chosen = chosenOption(g);
      if (chosen) total += Number(chosen.priceAdjustment) || 0;
    });
    return total;
  }

  function chosenOption(group) {
    var id = state.selected[group.optionGroup];
    if (!id) return null;
    return group.options.filter(function (o) { return o.optionId === id; })[0] || null;
  }

  function unitPriceSen() {
    return (Number(state.product && state.product.price) || 0) + optionsPriceSen();
  }

  function lineTotalSen() {
    return unitPriceSen() * state.quantity;
  }

  function missingRequired() {
    return state.optionGroups.filter(function (g) {
      return g.required && !state.selected[g.optionGroup];
    });
  }

  function setQty(n) {
    state.quantity = Math.max(1, Math.min(MAX_QTY, n));
    var el = document.getElementById('qtyValue');
    if (el) el.textContent = String(state.quantity);
    var minus = document.getElementById('qtyMinus');
    if (minus) minus.disabled = state.quantity <= 1;
    var plus = document.getElementById('qtyPlus');
    if (plus) plus.disabled = state.quantity >= MAX_QTY;
    updateCta();
  }

  /* ---------------------------------------------------------
     渲染
     --------------------------------------------------------- */

  function renderSkeleton() {
    var box = document.getElementById('productBody');
    if (box) box.innerHTML = '<div class="menu-skeleton" style="height:200px"></div>' +
      '<div class="menu-skeleton"></div><div class="menu-skeleton"></div>';
  }

  function renderError() {
    var box = document.getElementById('productBody');
    if (!box) return;
    var code = state.error && state.error.code ? state.error.code : 'ERROR';
    box.innerHTML =
      '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div class="bilingual-zh">商品载入失败</div>' +
        '<div class="bilingual-en">PRODUCT FAILED TO LOAD</div>' +
        '<div class="divider"></div>' +
        '<div class="small muted">错误码 ' + UI.esc(code) + '</div>' +
        '<div class="tiny muted mt-12">' + UI.esc(state.error && state.error.message || '') + '</div>' +
        '<a class="btn btn-secondary mt-12" href="menu.html">回酒单 BACK TO MENU</a>' +
      '</div>';
    var cta = document.getElementById('stickyCta');
    if (cta) cta.style.display = 'none';
  }

  function render() {
    var p = state.product;
    var box = document.getElementById('productBody');
    if (!box) return;

    var hero = p.imageURL
      ? '<div class="detail-hero"><img src="' + UI.esc(p.imageURL) + '" alt="" ' +
        'onerror="this.parentNode.textContent=\'🍸\'"></div>'
      : '<div class="detail-hero">🍸</div>';

    var tags = (p.tags || []).map(function (t) {
      return '<span class="flavor-tag">' + UI.esc(t) + '</span>';
    }).join('');

    var priceHtml = '<span class="product-price" style="font-size:20px">' + UI.money(p.price) + '</span>';
    if (p.onPromo && p.originalPrice) {
      priceHtml += '<span class="product-price-was">' + UI.money(p.originalPrice) + '</span>' +
        '<span class="promo-badge">PROMO</span>';
    }

    var html = hero +
      '<div class="bilingual-zh" style="font-size:21px">' + UI.esc(p.nameEN) + '</div>' +
      (p.nameZH ? '<div class="bilingual-en">' + UI.esc(p.nameZH) + '</div>' : '') +
      (tags ? '<div class="flavor-tags">' + tags + '</div>' : '') +
      ((p.descriptionEN || p.descriptionZH)
        ? '<div class="small muted mt-12" style="line-height:1.7">' +
          UI.esc(p.descriptionZH || '') + (p.descriptionZH && p.descriptionEN ? '<br>' : '') +
          UI.esc(p.descriptionEN || '') + '</div>'
        : '') +
      '<div class="product-price-row mt-12">' + priceHtml + '</div>' +
      (p.available === false
        ? '<div class="sold-out-badge">SOLD OUT 售罄</div>'
        : '');

    /* 规格（§8） */
    state.optionGroups.forEach(function (g, gi) {
      html += '<div class="option-group card" style="padding:0;overflow:hidden">' +
        '<div style="padding:12px 14px 6px">' +
          '<span class="option-group-title">' + UI.esc(g.nameEN || g.optionGroup) + '</span>' +
          '<span class="option-group-sub"> ' + UI.esc(g.nameZH || '') + '</span>' +
          (g.required ? '<span class="required-mark">必选 REQUIRED</span>' : '') +
        '</div>';
      (g.options || []).forEach(function (o) {
        var sel = state.selected[g.optionGroup] === o.optionId ? ' selected' : '';
        html += '<div class="option-row' + sel + '" data-group="' + UI.esc(g.optionGroup) +
          '" data-option="' + UI.esc(o.optionId) + '">' +
          '<div class="option-radio"></div>' +
          '<div class="option-name">' + UI.esc(o.nameEN) +
            (o.nameZH ? ' <span class="tiny muted">' + UI.esc(o.nameZH) + '</span>' : '') +
          '</div>' +
          '<div class="option-price">' +
            (o.priceAdjustment > 0 ? '+' + UI.money(o.priceAdjustment) : UI.money(0)) +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    });

    /* 备注（§7 Special Request） */
    html += '<div class="card mt-12">' +
      '<div class="bilingual-zh">备注</div>' +
      '<div class="bilingual-en">SPECIAL REQUEST</div>' +
      '<textarea class="textarea mt-12" id="productNote" rows="2" ' +
        'placeholder="例如：不要太甜 / Less sugar"></textarea>' +
      '</div>';

    /* 数量（§7） */
    html += '<div class="qty-row">' +
      '<div class="bilingual-zh" style="font-size:14px">数量<span class="tiny muted"> QUANTITY</span></div>' +
      '<div class="qty-ctrl">' +
        '<button class="qty-btn" id="qtyMinus"' + (state.quantity <= 1 ? ' disabled' : '') + '>−</button>' +
        '<span class="qty-value" id="qtyValue">' + state.quantity + '</span>' +
        '<button class="qty-btn" id="qtyPlus"' + (state.quantity >= MAX_QTY ? ' disabled' : '') + '>+</button>' +
      '</div>' +
    '</div>';

    box.innerHTML = html;

    /* 绑定规格点击 */
    Array.prototype.forEach.call(box.querySelectorAll('.option-row'), function (el) {
      el.addEventListener('click', function () {
        state.selected[el.getAttribute('data-group')] = el.getAttribute('data-option');
        renderOptionsOnly();
        updateCta();
      });
    });

    bindEvents();
    updateCta();
  }

  /** 只重画规格的选中状态，避免整页重绘（输入备注时不会被清掉） */
  function renderOptionsOnly() {
    var box = document.getElementById('productBody');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.option-row'), function (el) {
      var on = state.selected[el.getAttribute('data-group')] === el.getAttribute('data-option');
      el.classList.toggle('selected', on);
    });
  }

  function updateCta() {
    var btn = document.getElementById('addToCartBtn');
    if (!btn || !state.product) return;

    var sold = state.product.available === false;
    var missing = missingRequired();

    var label;
    if (sold) {
      label = 'SOLD OUT 售罄';
    } else if (missing.length) {
      label = '请选择 ' + UI.esc(missing[0].nameEN || missing[0].optionGroup) + ' / CHOOSE ' +
        UI.esc((missing[0].nameEN || missing[0].optionGroup).toUpperCase());
    } else {
      label = 'ADD TO CART ' + UI.money(lineTotalSen()) +
        '<span class="btn-sub-label">加入清单</span>';
    }
    btn.innerHTML = '<span>' + label + '</span>';
    btn.disabled = sold || missing.length > 0;
  }

  function onAddToCart() {
    if (!state.product || state.product.available === false) return;
    var missing = missingRequired();
    if (missing.length) {
      UI.toast('请先选择 ' + (missing[0].nameZH || missing[0].nameEN), 'error');
      return;
    }

    var items = [];
    state.optionGroups.forEach(function (g) {
      var o = chosenOption(g);
      if (o) {
        items.push({
          optionGroup: g.optionGroup,
          optionId: o.optionId,
          nameEN: o.nameEN,
          nameZH: o.nameZH
        });
      }
    });

    var added = CART.add({
      productId: state.product.productId,
      nameEN: state.product.nameEN,
      nameZH: state.product.nameZH,
      unitPrice: Number(state.product.price) || 0,
      quantity: state.quantity,
      options: items,
      note: String(state.note || '').slice(0, 200)
    });

    if (!added.ok) { UI.toast(added.message, 'error'); return; }
    UI.toast('已加入清单 · ' + state.product.nameEN, 'success');
    setTimeout(function () { UI.go('cart.html'); }, 450);
  }

  /** 给测试用 */
  function debugState() {
    return {
      productId: state.productId,
      hasProduct: !!state.product,
      errorCode: state.error ? state.error.code : null,
      available: state.product ? state.product.available !== false : null,
      price: state.product ? Number(state.product.price) || 0 : 0,
      optionGroups: state.optionGroups.length,
      selected: Object.assign({}, state.selected),
      optionsPrice: optionsPriceSen(),
      unitPrice: state.product ? unitPriceSen() : 0,
      quantity: state.quantity,
      lineTotal: state.product ? lineTotalSen() : 0,
      missingRequired: missingRequired().map(function (g) { return g.optionGroup; })
    };
  }

  return {
    init: init,
    load: load,
    setQty: setQty,
    debugState: debugState
  };

})();
