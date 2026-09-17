/* =============================================================
   YETIPSY — admin-menu.js（2.0 Phase 10）
   -------------------------------------------------------------
   Owner / Manager 的菜单管理（§5 §31 §32 §33 §40）

   权限（§32）：
   · MANAGER / OWNER：新增 / 编辑商品、价格、图片、分类、排序、促销、规格
   · 普通员工：只能切换 售罄 / 有货

   §33：图片只存 ImageURL，图片档放 GitHub /assets/menu/*.webp，
        不放进 Google Sheets。
   §40：促销价由后端判断时间窗，这里只送 promoPrice / promoStart / promoEnd。
   ============================================================= */

var ADMIN_MENU = (function () {

  var state = {
    categories: [],
    products: [],
    optionsByProduct: {},
    filter: '',
    search: '',
    loading: true,
    errorCode: null,
    canEdit: false,
    editing: null          // 正在编辑的商品（null = 新增）
  };

  function init() {
    state.canEdit = ADMIN.isManager();
    bindEvents();
    /* 资料由导出的 init() 呼叫 fetchAll() 抓，这里不重复请求 */
  }

  function bindEvents() {
    var search = document.getElementById('menuSearch');
    if (search) search.addEventListener('input', function () {
      state.search = search.value.trim().toLowerCase();
      render();
    });

    var add = document.getElementById('addProductBtn');
    if (add) {
      if (state.canEdit) add.addEventListener('click', function () { openForm(null); });
      else add.style.display = 'none';            // §32 员工不能新增
    }
  }

  /* ---------------------------------------------------------
     资料
     --------------------------------------------------------- */

  /**
   * 一次就拿到分类 + 商品 + 规格（§82 不要多次读表）。
   * ★ 必须用 getAdminMenu，不能用 getMenu：
   *   getMenu 走 requireCustomer()，员工 token 一律 INVALID_SESSION；
   *   而且它只回 status = ACTIVE 的商品，管理页会看不到已下架的。
   */
  function fetchAll() {
    state.loading = true;
    render();
    return API.call('getAdminMenu', {}, { sessionType: 'staff' }).then(function (res) {
      if (!res.success) {
        state.errorCode = res.error.code;
        state.loading = false;
        render();
        return;
      }
      state.errorCode = null;
      state.categories = res.data.categories || [];
      state.products = res.data.products || [];
      state.optionsByProduct = res.data.optionsByProduct || {};
      state.loading = false;
      render();
    });
  }

  /* ---------------------------------------------------------
     列表
     --------------------------------------------------------- */

  function render() {
    var box = document.getElementById('menuAdminBody');
    if (!box) return;
    renderFilter();

    if (state.loading) {
      box.innerHTML = '<div class="a-empty">载入中… LOADING</div>';
      return;
    }
    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">载入失败 · ' + UI.esc(state.errorCode) +
        '<br><button class="btn btn-secondary mt-16" id="retryBtn">重试 RETRY</button></div>';
      var r = document.getElementById('retryBtn');
      if (r) r.addEventListener('click', fetchAll);
      return;
    }

    var list = state.products.filter(function (p) {
      if (state.filter && p.categoryId !== state.filter) return false;
      if (!state.search) return true;
      return (p.nameEN || '').toLowerCase().indexOf(state.search) !== -1 ||
             (p.nameZH || '').indexOf(state.search) !== -1;
    });

    if (!list.length) {
      box.innerHTML = '<div class="a-empty">没有符合的商品 NO PRODUCTS</div>';
      return;
    }

    box.innerHTML = list.map(row).join('');
    bindRows();
  }

  function renderFilter() {
    var strip = document.getElementById('catFilter');
    if (!strip) return;
    var all = '<div class="cat-chip' + (state.filter ? '' : ' active') +
      '" data-cat="">全部 ALL</div>';
    strip.innerHTML = all + state.categories.map(function (c) {
      return '<div class="cat-chip' + (state.filter === c.categoryId ? ' active' : '') +
        '" data-cat="' + UI.esc(c.categoryId) + '">' +
        UI.esc(c.nameZH || c.nameEN) + '</div>';
    }).join('');

    Array.prototype.forEach.call(strip.querySelectorAll('.cat-chip'), function (el) {
      el.addEventListener('click', function () {
        state.filter = el.getAttribute('data-cat') || '';
        renderFilter();
        render();
      });
    });
  }

  function catName(id) {
    var c = state.categories.filter(function (x) { return x.categoryId === id; })[0];
    return c ? (c.nameZH || c.nameEN) : id;
  }

  function row(p) {
    var soldOut = !p.available;
    /* getAdminMenu 才回传 status（顾客端的 getMenu 只有 ACTIVE 的商品） */
    var archived = String(p.status || 'ACTIVE').toUpperCase() !== 'ACTIVE';
    var opts = state.optionsByProduct[p.productId] || [];
    return '<div class="a-list" data-row="' + UI.esc(p.productId) + '">' +
      '<div class="a-main">' +
        '<div class="a-title">' + UI.esc(p.nameEN) +
          (p.nameZH ? ' <span class="a-sub">' + UI.esc(p.nameZH) + '</span>' : '') +
          (archived ? ' <span class="chip chip-warn">已下架 ARCHIVED</span>' : '') +
          (soldOut ? ' <span class="chip chip-warn">售罄 SOLD OUT</span>' : '') +
          (p.onPromo ? ' <span class="chip chip-on">促销 PROMO</span>' : '') +
        '</div>' +
        '<div class="a-sub">' + UI.esc(catName(p.categoryId)) +
          ' · ' + UI.money(p.price) +
          (p.onPromo ? ' <s class="a-sub">' + UI.money(p.originalPrice) + '</s>' : '') +
          ' · 排序 ' + (p.sortOrder || 0) +
          (opts.length ? ' · ' + opts.length + ' 个规格' : '') +
        '</div>' +
        (p.imageURL ? '<div class="a-sub">图片 ' + UI.esc(p.imageURL) + '</div>' : '') +
      '</div>' +
      '<div class="a-right">' +
        '<button class="chip" data-toggle="' + UI.esc(p.productId) + '">' +
          (soldOut ? '恢复有货 IN STOCK' : '标售罄 SOLD OUT') + '</button>' +
        /* ★ 上下架是「状态类」操作，任何员工都能做（setProductStatus）。
           只有改价格 / 新增商品才需要 MANAGER+（state.canEdit）。 */
        '<button class="chip mt-8" data-status="' + UI.esc(p.productId) + '">' +
          (archived ? '上架 RESTORE' : '下架 ARCHIVE') + '</button>' +
        (state.canEdit
          ? '<button class="chip mt-8" data-edit="' + UI.esc(p.productId) + '">编辑 EDIT</button>' : '') +
      '</div>' +
    '</div>';
  }

  function bindRows() {
    var box = document.getElementById('menuAdminBody');
    if (!box) return;

    Array.prototype.forEach.call(box.querySelectorAll('[data-toggle]'), function (el) {
      el.addEventListener('click', function () {
        var pid = el.getAttribute('data-toggle');
        var prod = state.products.filter(function (p) { return p.productId === pid; })[0];
        el.disabled = true;
        API.staff.setProductAvailability(pid, !prod.available).then(function (res) {
          el.disabled = false;
          if (!res.success) { UI.toast(res.error.message, 'error'); return; }
          UI.toast(prod.available ? '已标售罄' : '已恢复有货', 'success', 1800);
          fetchAll();
        });
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-edit]'), function (el) {
      el.addEventListener('click', function () {
        var pid = el.getAttribute('data-edit');
        openForm(state.products.filter(function (p) { return p.productId === pid; })[0]);
      });
    });

    /* ★ 上下架：任何员工都能做（§32 状态类操作） */
    Array.prototype.forEach.call(box.querySelectorAll('[data-status]'), function (el) {
      el.addEventListener('click', function () {
        var pid = el.getAttribute('data-status');
        var prod = state.products.filter(function (p) { return p.productId === pid; })[0];
        if (!prod) return;
        var archived = String(prod.status || 'ACTIVE').toUpperCase() !== 'ACTIVE';
        var next = archived ? 'ACTIVE' : 'ARCHIVED';

        el.disabled = true;
        API.staff.setProductStatus(pid, next).then(function (res) {
          el.disabled = false;
          if (!res.success) { UI.toast(res.error.message, 'error'); return; }
          UI.toast(archived ? '已上架' : '已下架', 'success', 1800);
          fetchAll();
        });
      });
    });
  }

  /* ---------------------------------------------------------
     新增 / 编辑表单（§32 只有 MANAGER+ 看得到）
     --------------------------------------------------------- */

  function openForm(product) {
    if (!state.canEdit) { UI.toast('需要经理权限', 'error'); return; }
    state.editing = product;

    var panel = document.getElementById('productForm');
    if (!panel) return;
    panel.style.display = '';

    var isEdit = !!product;
    /* ★ 标题由下面的 innerHTML 一并写入。
       之前这里多了一句 document.getElementById('formTitle').textContent = …，
       但 #formTitle 那时还不存在（它正是这段 innerHTML 建立的），
       所以第一次打开表单必定抛 TypeError，表单永远开不起来。 */

    var catOptions = state.categories.map(function (c) {
      return '<option value="' + UI.esc(c.categoryId) + '"' +
        (product && product.categoryId === c.categoryId ? ' selected' : '') + '>' +
        UI.esc(c.nameZH || c.nameEN) + '</option>';
    }).join('');

    panel.innerHTML =
      '<div class="a-section-title" id="formTitle">' +
        (isEdit ? '编辑商品 EDIT PRODUCT' : '新增商品 ADD PRODUCT') + '</div>' +

      field('商品名称（英） NAME (EN)', 'fNameEN', product ? product.nameEN : '', 'Mojito') +
      field('商品名称（中） NAME (ZH)', 'fNameZH', product ? product.nameZH : '', '经典莫希托') +

      '<div class="a-field"><label class="a-label">分类 CATEGORY</label>' +
        '<select class="a-select" id="fCategory">' + catOptions + '</select></div>' +

      field('价格（RM） PRICE', 'fPrice',
        product ? (product.price / 100).toFixed(2) : '', '22.00', 'number') +
      field('排序 SORT ORDER', 'fSort', product ? (product.sortOrder || 0) : '0', '0', 'number') +

      '<div class="a-divider"></div>' +
      '<div class="a-sub">促销（§40）—— 后端自己判断时间窗，前端不能指定「现在的价格」</div>' +
      field('原价（RM） ORIGINAL', 'fOriginal',
        product && product.originalPrice ? (product.originalPrice / 100).toFixed(2) : '', '25.00', 'number') +
      field('促销价（RM） PROMO', 'fPromo',
        product && product.promoPrice ? (product.promoPrice / 100).toFixed(2) : '', '18.00', 'number') +
      field('开始日期 START', 'fPromoStart', product ? (product.promoStart || '') : '',
        '2026-09-01', 'date') +
      field('结束日期 END', 'fPromoEnd', product ? (product.promoEnd || '') : '',
        '2026-09-30', 'date') +

      '<div class="a-divider"></div>' +
      field('说明（英） DESCRIPTION (EN)', 'fDescEN', product ? product.descriptionEN : '',
        'Refreshing mint & lime') +
      field('说明（中） DESCRIPTION (ZH)', 'fDescZH', product ? product.descriptionZH : '',
        '清爽薄荷青柠') +
      field('标签 TAGS（逗号分隔）', 'fTags', product ? (product.tags || '') : '',
        'refreshing,citrus,mint') +

      '<div class="a-field"><label class="a-label">酒感 STRENGTH</label>' +
        '<select class="a-select" id="fStrength">' +
        ['', 'LIGHT', 'MEDIUM', 'STRONG'].map(function (s) {
          return '<option value="' + s + '"' +
            (product && (product.strength || '') === s ? ' selected' : '') + '>' +
            (s || '— 不显示 —') + '</option>';
        }).join('') + '</select></div>' +

      /* §33 图片只存 URL */
      field('图片 URL（§33 放 GitHub /assets/menu/*.webp）', 'fImage',
        product ? product.imageURL : '', '/assets/menu/mojito.webp') +

      '<button class="btn btn-primary mt-16" id="saveProductBtn" style="width:100%">' +
        (isEdit ? '保存变更 SAVE' : '建立商品 CREATE') + '</button>' +
      '<button class="btn btn-ghost mt-8" id="cancelFormBtn" style="width:100%">取消 CANCEL</button>' +
      (isEdit ? '<button class="btn btn-ghost mt-8" id="archiveBtn" style="width:100%;color:#E2696B">' +
        '下架商品 ARCHIVE</button>' : '');

    var save = document.getElementById('saveProductBtn');
    if (save) save.addEventListener('click', onSave);
    var cancel = document.getElementById('cancelFormBtn');
    if (cancel) cancel.addEventListener('click', closeForm);
    var archive = document.getElementById('archiveBtn');
    if (archive) archive.addEventListener('click', onArchive);
  }

  function field(label, id, value, placeholder, type) {
    return '<div class="a-field"><label class="a-label">' + UI.esc(label) + '</label>' +
      '<input class="a-input" id="' + id + '" value="' + UI.esc(value == null ? '' : value) + '"' +
      (placeholder ? ' placeholder="' + UI.esc(placeholder) + '"' : '') +
      (type ? ' type="' + type + '"' : '') + '></div>';
  }

  function closeForm() {
    var panel = document.getElementById('productForm');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    state.editing = null;
  }

  /** RM → sen；空白回 null 表示「不改这个栏位」 */
  function sen(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var v = String(el.value || '').trim();
    if (v === '') return null;
    var n = Math.round(Number(v) * 100);
    return isFinite(n) ? n : null;
  }

  function txt(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function onSave() {
    var isEdit = !!state.editing;
    var body = {
      nameEN: txt('fNameEN'),
      nameZH: txt('fNameZH'),
      categoryId: txt('fCategory'),
      price: sen('fPrice'),
      sortOrder: Number(txt('fSort')) || 0,
      descriptionEN: txt('fDescEN'),
      descriptionZH: txt('fDescZH'),
      tags: txt('fTags'),
      strength: txt('fStrength'),
      imageURL: txt('fImage'),
      promoPrice: sen('fPromo'),
      promoStart: txt('fPromoStart'),
      promoEnd: txt('fPromoEnd')
    };

    if (isEdit) {
      /* 原价只有促销时才需要；清掉促销就把 promoPrice 设 0 */
      if (body.promoPrice === null) body.promoPrice = 0;
      body.productId = state.editing.productId;
    }

    if (!body.nameEN && !body.nameZH) { UI.toast('请输入商品名称', 'error'); return; }
    if (body.price === null || body.price <= 0) { UI.toast('请输入正确的价格', 'error'); return; }

    var btn = document.getElementById('saveProductBtn');
    if (btn) { btn.disabled = true; UI.setLoading(btn, true, '保存中…'); }

    var req = isEdit ? API.staff.updateProduct(body) : API.staff.createProduct(body);
    req.then(function (res) {
      if (btn) { btn.disabled = false; UI.setLoading(btn, false); }
      if (!res.success) { UI.toast(res.error.message, 'error', 3500); return; }
      UI.toast(isEdit ? '已保存 SAVED' : '已建立 CREATED', 'success');
      closeForm();
      fetchAll();
    });
  }

  function onArchive() {
    var pid = state.editing && state.editing.productId;
    if (!pid) return;
    UI.confirmDialog('下架这个商品？', 'Archive this product?（旧订单仍可读到名称与价格）',
      '下架 ARCHIVE').then(function (yes) {
      if (!yes) return;
      API.staff.archiveProduct(pid).then(function (res) {
        if (!res.success) { UI.toast(res.error.message, 'error'); return; }
        UI.toast('已下架 ARCHIVED', 'success');
        closeForm();
        fetchAll();
      });
    });
  }

  /* ---------------------------------------------------------
     分类管理（§5 分类不能写死）
     --------------------------------------------------------- */

  function addCategory() {
    if (!state.canEdit) { UI.toast('需要经理权限', 'error'); return; }
    var panel = document.getElementById('productForm');
    if (!panel) return;
    state.editing = null;
    panel.style.display = '';
    panel.innerHTML =
      '<div class="a-section-title">新增分类 ADD CATEGORY</div>' +
      field('名称（英） NAME (EN)', 'cNameEN', '', 'SIGNATURE') +
      field('名称（中） NAME (ZH)', 'cNameZH', '', '招牌特调') +
      field('排序 SORT ORDER', 'cSort', '0', '0', 'number') +
      '<button class="btn btn-primary mt-16" id="saveCatBtn" style="width:100%">建立 CREATE</button>' +
      '<button class="btn btn-ghost mt-8" id="cancelFormBtn" style="width:100%">取消 CANCEL</button>';

    document.getElementById('saveCatBtn').addEventListener('click', function () {
      var body = { nameEN: txt('cNameEN'), nameZH: txt('cNameZH'),
                   sortOrder: Number(txt('cSort')) || 0 };
      if (!body.nameEN && !body.nameZH) { UI.toast('请输入分类名称', 'error'); return; }
      API.staff.createCategory(body).then(function (res) {
        if (!res.success) { UI.toast(res.error.message, 'error'); return; }
        UI.toast('分类已建立', 'success');
        closeForm();
        fetchAll();
      });
    });
    document.getElementById('cancelFormBtn').addEventListener('click', closeForm);
  }

  function debugState() {
    return {
      loading: state.loading,
      errorCode: state.errorCode,
      canEdit: state.canEdit,
      categories: state.categories.length,
      products: state.products.length,
      filter: state.filter,
      search: state.search,
      editing: state.editing ? state.editing.productId : null
    };
  }

  return {
    init: function () { init(); fetchAll(); },
    reload: fetchAll,
    openForm: openForm,
    addCategory: addCategory,
    closeForm: closeForm,
    debugState: debugState
  };

})();
