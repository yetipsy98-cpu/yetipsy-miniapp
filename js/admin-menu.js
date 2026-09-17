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
    var editing = state.editing && state.editing.productId === p.productId;
    return '<div class="a-list' + (editing ? ' editing' : '') + '" data-row="' + UI.esc(p.productId) + '">' +
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

    var title = isEdit
      ? '编辑商品 EDIT PRODUCT · ' + (product.nameZH || product.nameEN || '')
      : '新增商品 ADD PRODUCT';

    panel.innerHTML =
      '<div class="a-section-title" id="formTitle">' + title + '</div>' +

      field('商品名称（英） NAME (EN)', 'fNameEN', product ? product.nameEN : '', 'Mojito') +
      field('商品名称（中） NAME (ZH)', 'fNameZH', product ? product.nameZH : '', '经典莫希托') +

      '<div class="a-field"><label class="a-label">分类 CATEGORY</label>' +
        '<select class="a-select" id="fCategory">' + catOptions + '</select></div>' +

      field('价格（RM） PRICE', 'fPrice',
        product ? (product.price / 100).toFixed(2) : '', '22.00', 'number') +
      /* 常见的填错：RM 22 写成 22 → 变成 RM 0.22（Sheet 存的是「分」） */
      '<div class="tiny muted-2" style="margin:-6px 2px 10px">' +
        '这里填 RM（22 = RM 22.00）。若直接在 Google Sheets 改，栏位 PriceSen 是「分」：RM 22 要填 2200' +
      '</div>' +
      field('排序 SORT ORDER', 'fSort', product ? (product.sortOrder || 0) : '0', '0', 'number') +

      '<div class="a-divider"></div>' +
      '<div class="a-sub">促销（§40）—— 后端自己判断时间窗，前端不能指定「现在的价格」。' +
        '原价 = 上面填的价格，这里只填促销价和日期。</div>' +
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

      (isEdit ? optionsHtml(product) : '') +

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

    bindFormDelegates();

    /* ★ 表单在页面最上面。员工在下面一点的商品按「编辑」时，
       表单如果只是展开、没有滚动过去，看起来就像「按了没反应」。
       所以每次打开都滚动到表单。 */
    try { panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    catch (e) { try { panel.scrollIntoView(); } catch (e2) {} }
  }

  /* ---------------------------------------------------------
     规格（Options）：SIZE / ICE …
     点餐台遇到有规格的商品会先开规格表，所以这里要能维护。
     --------------------------------------------------------- */

  /** 已经用过的规格群组（新规格的输入建议用） */
  function knownGroups() {
    var groups = [];
    Object.keys(state.optionsByProduct || {}).forEach(function (pid) {
      (state.optionsByProduct[pid] || []).forEach(function (o) {
        if (o.optionGroup && groups.indexOf(o.optionGroup) === -1) groups.push(o.optionGroup);
      });
    });
    ['SIZE', 'ICE', 'STRENGTH'].forEach(function (g) {
      if (groups.indexOf(g) === -1) groups.push(g);
    });
    return groups;
  }

  function groupLabel(o) {
    var zh = o.optionGroupNameZH || '';
    return o.optionGroup + (zh ? ' · ' + zh : '');
  }

  function optionsHtml(product) {
    var pid = product.productId;
    var list = (state.optionsByProduct[pid] || []).slice().sort(function (a, b) {
      if (a.optionGroup !== b.optionGroup) return a.optionGroup < b.optionGroup ? -1 : 1;
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    });

    var rows = list.map(function (o) {
      var off = String(o.status || 'ACTIVE').toUpperCase() !== 'ACTIVE';
      return '<div class="oi-row' + (off ? ' is-off' : '') + '" data-opt="' + UI.esc(o.optionId) + '">' +
        '<div class="oi-group">' + UI.esc(groupLabel(o)) +
          (off ? ' <span class="chip chip-warn">已下架</span>' : '') + '</div>' +
        '<input class="a-input oi-in" data-ozh value="' + UI.esc(o.nameZH || '') + '" placeholder="中文名 例 大杯">' +
        '<input class="a-input oi-in" data-oen value="' + UI.esc(o.nameEN || '') + '" placeholder="English, e.g. Large">' +
        '<div class="oi-adj"><span class="tiny muted-2">+RM</span>' +
          '<input class="a-input oi-num" type="number" min="0" step="0.50" data-oadj value="' +
            ((Number(o.priceAdjustment) || 0) / 100).toFixed(2) + '"></div>' +
        '<div class="oi-btns">' +
          '<button class="chip" data-osave="' + UI.esc(o.optionId) + '">保存</button>' +
          '<button class="chip' + (off ? ' chip-on' : ' chip-warn') + '" data-ostatus="' + UI.esc(o.optionId) +
            '" data-next="' + (off ? 'ACTIVE' : 'INACTIVE') + '">' + (off ? '上架' : '下架') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    if (!rows) {
      rows = '<div class="a-sub" style="padding:4px 0">这个商品还没有规格 —— 点餐台点一下就加入，不会问规格。</div>';
    }

    var dl = '<datalist id="optGroupList">' + knownGroups().map(function (g) {
      return '<option value="' + UI.esc(g) + '"></option>';
    }).join('') + '</datalist>';

    return '<div class="a-divider"></div>' +
      '<div class="a-section-title" style="margin-top:0">规格 OPTIONS（例：尺寸 / 冰）</div>' +
      '<div id="optRows">' + rows + '</div>' +
      '<div class="a-sub mt-8">＋ 新增规格（群组同名 = 同一组规格，点餐台会一组一组问）</div>' +
      '<div class="oi-row is-new">' +
        '<input class="a-input oi-in" id="optNewGroup" list="optGroupList" placeholder="群组 例 SIZE">' + dl +
        '<input class="a-input oi-in" id="optNewZH" placeholder="中文名 例 大杯">' +
        '<input class="a-input oi-in" id="optNewEN" placeholder="English, e.g. Large">' +
        '<div class="oi-adj"><span class="tiny muted-2">+RM</span>' +
          '<input class="a-input oi-num" id="optNewAdj" type="number" min="0" step="0.50" value="0"></div>' +
        '<button class="chip chip-on" id="optAddBtn">＋ 新增 ADD</button>' +
      '</div>';
  }

  /** 从 e.target 往上找带某属性的节点（区间只到表单为止） */
  function marked(node, attr) {
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute(attr)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindFormDelegates() {
    var panel = document.getElementById('productForm');
    if (!panel || panel.getAttribute('data-form-bound') === '1') return;
    panel.setAttribute('data-form-bound', '1');
    panel.addEventListener('click', function (e) {
      var add = document.getElementById('optAddBtn');
      if (add && (e.target === add || (e.target.parentNode === add))) { addOption(); return; }

      var save = marked(e.target, 'data-osave');
      if (save) { saveOption(save.getAttribute('data-osave')); return; }

      var st = marked(e.target, 'data-ostatus');
      if (st) { toggleOptionStatus(st.getAttribute('data-ostatus'), st.getAttribute('data-next')); return; }
    });
  }

  /** RM 文字 → 分 */
  function senOf(value) {
    var n = Math.round(Number(String(value == null ? '' : value).trim() || '0') * 100);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function saveOption(optionId) {
    var row = document.querySelector('[data-opt="' + optionId + '"]');
    if (!row) return;
    var body = {
      optionId: optionId,
      nameZH: String(row.querySelector('[data-ozh]').value || '').trim(),
      nameEN: String(row.querySelector('[data-oen]').value || '').trim(),
      priceAdjustment: senOf(row.querySelector('[data-oadj]').value)
    };
    if (!body.nameZH && !body.nameEN) { UI.toast('请输入规格名称', 'error'); return; }
    var btn = row.querySelector('[data-osave]');
    if (btn) btn.disabled = true;
    API.staff.updateProductOption(body).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.success) { UI.toast(res.error.message, 'error', 3500); return; }
      UI.toast('规格已更新', 'success', 1600);
      refreshForm();
    });
  }

  function toggleOptionStatus(optionId, next) {
    API.staff.updateProductOption({ optionId: optionId, status: next }).then(function (res) {
      if (!res.success) { UI.toast(res.error.message, 'error', 3500); return; }
      UI.toast(next === 'ACTIVE' ? '规格已上架' : '规格已下架（点餐台不再显示）', 'success', 1800);
      refreshForm();
    });
  }

  function addOption() {
    var product = state.editing;
    if (!product) return;
    var group = String(txt('optNewGroup') || '').trim().toUpperCase();
    var zh = txt('optNewZH');
    var en = txt('optNewEN');
    if (!group) { UI.toast('请填规格群组（例 SIZE / ICE）', 'error'); return; }
    if (!zh && !en) { UI.toast('请输入规格名称', 'error'); return; }

    var btn = document.getElementById('optAddBtn');
    if (btn) btn.disabled = true;
    API.staff.createProductOption({
      productId: product.productId,
      optionGroup: group,
      nameZH: zh,
      nameEN: en,
      priceAdjustment: senOf(document.getElementById('optNewAdj').value)
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.success) { UI.toast(res.error.message, 'error', 3500); return; }
      UI.toast('规格已新增', 'success', 1600);
      refreshForm();
    });
  }

  /** 改完规格：重抓资料，然后把同一个商品的表单再打开（员工不用重新找） */
  function refreshForm() {
    var pid = state.editing && state.editing.productId;
    return fetchAll().then(function () {
      if (!pid) return;
      var p = state.products.filter(function (x) { return x.productId === pid; })[0];
      if (p) openForm(p);
    });
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
      var backId = isEdit ? state.editing.productId : '';
      closeForm();
      fetchAll().then(function () {
        if (!backId) return;
        var rowNode = document.querySelector('[data-row="' + backId + '"]');
        try { if (rowNode) rowNode.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        catch (e) { try { if (rowNode) rowNode.scrollIntoView(); } catch (e2) {} }
      });
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
    refreshForm: refreshForm,
    openForm: openForm,
    addCategory: addCategory,
    closeForm: closeForm,
    debugState: debugState
  };

})();
