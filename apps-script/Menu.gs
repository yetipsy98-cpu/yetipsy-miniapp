/* =============================================================
   YETIPSY — Menu.gs（2.0 Phase 3）
   -------------------------------------------------------------
   酒单：分类 / 商品 / 规格（§5–§8）

   几条不能违反的规则：
   · §41 价格只由 Backend 决定。前端只能送 ProductID / Quantity / Options，
         任何从前端来的价格一律忽略。
   · §40 促销价由 Backend 判断时间窗，前端不决定价格。
   · §31 SOLD OUT 由 Backend 判断；Checkout 会再验一次（§66）。
   · §82 菜单可以缓存（MENU_CACHE_SECONDS），但钱包 / 余额 / 订单一律不缓存。
   · §33 图片只存 ImageURL（GitHub /assets/menu/*.webp），不存进 Sheet。
   · §5 / §8 分类与规格一律来自 Sheet，不 Hardcode。
   ============================================================= */

var MENU_CACHE_KEY = 'menu:v2';

/* -------------------------------------------------------------
   1. 价格（唯一权威）
   ------------------------------------------------------------- */

/**
 * 算出「现在」的有效单价（sen）。
 * 促销只有在 start/end 都合法、且今天在窗口内、且促销价 > 0 时才生效。
 * 回传 { priceSen, originalPriceSen, onPromo }
 */
function effectivePriceSen(product, todayKey) {
  var base = Math.round(Number(product.priceSen) || 0);
  var today = todayKey || todayKeyOf();

  var promo = Math.round(Number(product.promoPriceSen) || 0);
  var start = String(product.promoStart || '').slice(0, 10);
  var end   = String(product.promoEnd || '').slice(0, 10);

  if (promo > 0 && start && end && start <= today && today <= end && promo < base) {
    return { priceSen: promo, originalPriceSen: base, onPromo: true };
  }
  return { priceSen: base, originalPriceSen: base, onPromo: false };
}

/** 后端时区的今天（YYYY-MM-DD） */
function todayKeyOf() {
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

/** 商品对外形状（不含内部栏位） */
function publicProduct(p, todayKey) {
  var price = effectivePriceSen(p, todayKey);
  var tags = String(p.tags || '').split(',').map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length; });
  return {
    productId:   p.productId,
    categoryId:  p.categoryId,
    nameEN:      p.nameEN || '',
    nameZH:      p.nameZH || '',
    descriptionEN: p.descriptionEN || '',
    descriptionZH: p.descriptionZH || '',
    price:       price.priceSen,
    originalPrice: price.onPromo ? price.originalPriceSen : 0,
    onPromo:     price.onPromo,
    tags:        tags,
    strength:    p.strength || '',
    imageURL:    p.imageURL || '',
    available:   String(p.available).toUpperCase() !== 'FALSE',
    sortOrder:   Number(p.sortOrder) || 0
  };
}

function publicCategory(c) {
  return {
    categoryId: c.categoryId,
    nameEN: c.nameEN || '',
    nameZH: c.nameZH || '',
    sortOrder: Number(c.sortOrder) || 0
  };
}

function publicOption(o) {
  return {
    optionId: o.optionId,
    productId: o.productId,
    optionGroup: o.optionGroup || '',
    optionGroupNameEN: o.optionGroupNameEN || '',
    optionGroupNameZH: o.optionGroupNameZH || '',
    nameEN: o.nameEN || '',
    nameZH: o.nameZH || '',
    priceAdjustment: Math.round(Number(o.priceAdjustmentSen) || 0),
    required: String(o.required).toUpperCase() === 'TRUE',
    sortOrder: Number(o.sortOrder) || 0
  };
}

/* -------------------------------------------------------------
   2. 组装菜单（一次读完，§82）
   ------------------------------------------------------------- */

function buildMenu() {
  var today = todayKeyOf();

  var categories = dbFilter('categories', function (c) {
    return String(c.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicCategory);

  var products = dbFilter('products', function (p) {
    return String(p.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(function (p) { return publicProduct(p, today); });

  var options = dbFilter('productOptions', function (o) {
    return String(o.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicOption);

  /* 规格依商品分组，前端一次就能画完 Product Detail */
  var optionsByProduct = {};
  options.forEach(function (o) {
    if (!optionsByProduct[o.productId]) optionsByProduct[o.productId] = [];
    optionsByProduct[o.productId].push(o);
  });

  return {
    categories: categories,
    products: products,
    optionsByProduct: optionsByProduct,
    today: today,
    counts: {
      categories: categories.length,
      products: products.length,
      available: products.filter(function (p) { return p.available; }).length
    }
  };
}

/** 菜单缓存：改过商品 / 分类 / 规格就要清掉 */
function clearMenuCache() {
  rateLimitClear(MENU_CACHE_KEY);
}

/* -------------------------------------------------------------
   3. 点单是否开放（§63 / §64）
   ------------------------------------------------------------- */

/**
 * 回传 { enabled, paused, open, reason, openTime, closeTime }
 * reason: '' | 'DISABLED' | 'PAUSED' | 'CLOSED'
 */
function orderingWindowState() {
  var enabled = boolSetting('ORDERING_ENABLED', true);
  var paused  = boolSetting('ORDERING_PAUSED', false);
  var openTime  = String(setting('ORDERING_OPEN_TIME', '18:30'));
  var closeTime = String(setting('ORDERING_CLOSE_TIME', '00:00'));

  var state = {
    enabled: enabled,
    paused: paused,
    open: enabled && !paused,
    reason: '',
    openTime: openTime,
    closeTime: closeTime
  };

  if (!enabled) { state.reason = 'DISABLED'; return state; }
  if (paused)   { state.reason = 'PAUSED';   return state; }

  /* 营业时间：close < open 代表跨午夜（18:30 → 00:00） */
  var now = new Date();
  var tz = String(setting('TIMEZONE', 'Asia/Kuala_Lumpur'));
  var hhmm;
  try {
    hhmm = new Date().toLocaleTimeString('en-GB',
      { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) {
    hhmm = now.toISOString().slice(11, 16);
  }
  var cur = toMinutes(hhmm);
  var openM = toMinutes(openTime);
  var closeM = toMinutes(closeTime);

  var within;
  if (closeM === 0 || closeM <= openM) {
    within = cur >= openM;                      // 开到午夜（或跨日）
  } else {
    within = cur >= openM && cur < closeM;
  }

  state.open = within;
  state.now = hhmm;
  if (!within) state.reason = 'CLOSED';
  return state;
}

function toMinutes(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/* -------------------------------------------------------------
   4. 顾客端 API（§60）
   ------------------------------------------------------------- */

/**
 * getMenu —— 一次拿 Categories + Products + Options（§82）。
 * 顾客必须登入（会员制酒吧），但不需要额外权限。
 */
function getMenu(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var ttl = numSetting('MENU_CACHE_SECONDS', 120);
  var cached = null;
  if (ttl > 0) cached = rateLimitGet(MENU_CACHE_KEY);

  var menu;
  if (cached && cached.categories) {
    menu = cached;
    menu.fromCache = true;
  } else {
    menu = buildMenu();
    menu.fromCache = false;
    if (ttl > 0) rateLimitSet(MENU_CACHE_KEY, menu, Math.min(300, ttl));   // §82 上限 300 秒
  }

  /* 点单开关不缓存，每次现算 */
  menu.ordering = orderingWindowState();
  menu.allowPickup = boolSetting('ALLOW_PICKUP', true);
  menu.allowTableOrder = boolSetting('ALLOW_TABLE_ORDER', true);
  menu.maxOrderItems = numSetting('MAX_ORDER_ITEMS', 20);

  /* 顾客端的筛选（§34 / §35）——在已组装好的菜单上做，不再读 Sheet */
  var q = String((data && data.search) || '').trim().toLowerCase();
  var tag = String((data && data.tag) || '').trim().toLowerCase();
  var categoryId = String((data && data.categoryId) || '').trim();

  var list = menu.products;
  if (q) {
    list = list.filter(function (p) {
      return String(p.nameEN).toLowerCase().indexOf(q) >= 0 ||
             String(p.nameZH).indexOf(q) >= 0 ||
             String(p.descriptionEN).toLowerCase().indexOf(q) >= 0 ||
             String(p.descriptionZH).indexOf(q) >= 0;
    });
  }
  if (tag) {
    list = list.filter(function (p) {
      return p.tags.some(function (t) { return t.toLowerCase() === tag; });
    });
  }
  if (categoryId) {
    list = list.filter(function (p) { return p.categoryId === categoryId; });
  }

  return ok({
    categories: menu.categories,
    products: list,
    optionsByProduct: menu.optionsByProduct,
    ordering: menu.ordering,
    allowPickup: menu.allowPickup,
    allowTableOrder: menu.allowTableOrder,
    maxOrderItems: menu.maxOrderItems,
    totalProducts: menu.products.length,
    shownProducts: list.length,
    fromCache: !!menu.fromCache,
    today: menu.today
  });
}

/** getCategories（§60） */
function getCategories(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  return ok({
    categories: dbFilter('categories', function (c) {
      return String(c.status).toUpperCase() === 'ACTIVE';
    }).sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    }).map(publicCategory)
  });
}

/** getProducts（§60） */
function getProducts(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var today = todayKeyOf();
  var categoryId = String((data && data.categoryId) || '').trim();

  var list = dbFilter('products', function (p) {
    if (String(p.status).toUpperCase() !== 'ACTIVE') return false;
    if (categoryId && p.categoryId !== categoryId) return false;
    return true;
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(function (p) { return publicProduct(p, today); });

  return ok({ products: list, today: today });
}

/** getProduct（§60）——含规格，Product Detail 一次就够 */
function getProduct(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p || String(p.status).toUpperCase() !== 'ACTIVE') return err('PRODUCT_NOT_FOUND');

  var options = dbFilter('productOptions', function (o) {
    return o.productId === p.productId && String(o.status).toUpperCase() === 'ACTIVE';
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  }).map(publicOption);

  /* 依 OptionGroup 分组，前端直接画区块 */
  var groups = [];
  var byGroup = {};
  options.forEach(function (o) {
    if (!byGroup[o.optionGroup]) {
      byGroup[o.optionGroup] = {
        optionGroup: o.optionGroup,
        nameEN: o.optionGroupNameEN,
        nameZH: o.optionGroupNameZH,
        required: o.required,
        options: []
      };
      groups.push(byGroup[o.optionGroup]);
    }
    byGroup[o.optionGroup].options.push(o);
  });

  return ok({
    product: publicProduct(p, todayKeyOf()),
    options: options,
    optionGroups: groups
  });
}

/** getProductOptions（§60） */
function getProductOptions(data, token) {
  var ctx = requireCustomer(token);
  if (ctx.error) return ctx.error;
  var productId = String((data && data.productId) || '');
  if (!dbById('products', productId)) return err('PRODUCT_NOT_FOUND');

  return ok({
    options: dbFilter('productOptions', function (o) {
      return o.productId === productId && String(o.status).toUpperCase() === 'ACTIVE';
    }).map(publicOption)
  });
}

/* -------------------------------------------------------------
   5. 员工端：只能改 AVAILABLE / SOLD OUT（§32）
   ------------------------------------------------------------- */

/** setProductAvailability（§61）——Staff 也可以，这是他们唯一的菜单权限 */
function setProductAvailability(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p || String(p.status).toUpperCase() !== 'ACTIVE') return err('PRODUCT_NOT_FOUND');

  var available = data && data.available;
  if (typeof available === 'string') available = available.toUpperCase() !== 'FALSE';
  if (typeof available !== 'boolean') return err('INVALID_INPUT', 'available must be true or false.');

  var before = String(p.available).toUpperCase() !== 'FALSE';
  p.available = available ? 'TRUE' : 'FALSE';
  p.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', available ? 'PRODUCT_AVAILABLE' : 'PRODUCT_SOLD_OUT',
        'PRODUCT', p.productId, String(before), String(available));

  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/* -------------------------------------------------------------
   6. Owner / Manager：分类与商品管理（§62）
   ------------------------------------------------------------- */

/** createCategory（§62） */
function createCategory(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!nameEN && !nameZH) {
    return err('INVALID_INPUT', 'Category name is required. / 请输入分类名称。');
  }

  var c = {
    categoryId: dbNextId('CAT', 'category', 4),
    nameEN: nameEN,
    nameZH: nameZH,
    status: 'ACTIVE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('categories', c);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_CATEGORY', 'CATEGORY', c.categoryId, '',
        c.nameEN + ' / ' + c.nameZH);
  return ok({ category: publicCategory(c) });
}

/** updateCategory（§62） */
function updateCategory(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var c = dbById('categories', String((data && data.categoryId) || ''));
  if (!c) return err('CATEGORY_NOT_FOUND');

  var before = c.nameEN + ' / ' + c.nameZH + ' / ' + c.status;
  if (data.nameEN !== undefined) c.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) c.nameZH = String(data.nameZH).trim();
  if (data.status !== undefined) {
    c.status = String(data.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }
  if (data.sortOrder !== undefined) c.sortOrder = Number(data.sortOrder) || 0;
  c.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_CATEGORY', 'CATEGORY', c.categoryId, before,
        c.nameEN + ' / ' + c.nameZH + ' / ' + c.status);
  return ok({ category: publicCategory(c) });
}

/** createProduct（§62） */
function createProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!nameEN && !nameZH) {
    return err('INVALID_INPUT', 'Product name is required. / 请输入商品名称。');
  }
  if (!dbById('categories', String((data && data.categoryId) || ''))) {
    return err('CATEGORY_NOT_FOUND');
  }
  var price = Math.round(Number(data && data.price));
  if (!isFinite(price) || price <= 0) {
    return err('INVALID_INPUT', 'Price must be greater than 0. / 价格必须大于 0。');
  }

  var p = {
    productId:  dbNextId('PRD', 'product', 4),
    categoryId: String(data.categoryId),
    nameEN: nameEN,
    nameZH: nameZH,
    descriptionEN: String((data && data.descriptionEN) || '').trim(),
    descriptionZH: String((data && data.descriptionZH) || '').trim(),
    priceSen: price,
    originalPriceSen: 0,
    promoPriceSen: 0,
    promoStart: '',
    promoEnd: '',
    tags: normalizeTags(data && data.tags),
    strength: String((data && data.strength) || '').toUpperCase(),
    imageURL: String((data && data.imageURL) || '').trim(),
    status: 'ACTIVE',
    available: 'TRUE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('products', p);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PRODUCT', 'PRODUCT', p.productId, '',
        p.nameEN + ' | ' + price);
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** updateProduct（§62）——价格、图片、分类、排序、促销都在这里改 */
function updateProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p) return err('PRODUCT_NOT_FOUND');

  var before = JSON.stringify({
    price: p.priceSen, status: p.status, available: p.available,
    categoryId: p.categoryId, name: p.nameEN
  });

  if (data.categoryId !== undefined) {
    if (!dbById('categories', String(data.categoryId))) return err('CATEGORY_NOT_FOUND');
    p.categoryId = String(data.categoryId);
  }
  if (data.nameEN !== undefined) p.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) p.nameZH = String(data.nameZH).trim();
  if (data.descriptionEN !== undefined) p.descriptionEN = String(data.descriptionEN).trim();
  if (data.descriptionZH !== undefined) p.descriptionZH = String(data.descriptionZH).trim();
  if (data.price !== undefined) {
    var price = Math.round(Number(data.price));
    if (!isFinite(price) || price <= 0) {
      return err('INVALID_INPUT', 'Price must be greater than 0. / 价格必须大于 0。');
    }
    p.priceSen = price;
  }
  if (data.tags !== undefined) p.tags = normalizeTags(data.tags);
  if (data.strength !== undefined) p.strength = String(data.strength).toUpperCase();
  if (data.imageURL !== undefined) p.imageURL = String(data.imageURL).trim();
  if (data.sortOrder !== undefined) p.sortOrder = Number(data.sortOrder) || 0;
  if (data.status !== undefined) {
    p.status = String(data.status).toUpperCase() === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  }

  /* 促销（§40）：Backend 自己判断时间窗，前端不能直接指定「现在的价格」 */
  if (data.promoPrice !== undefined) {
    var promo = Math.round(Number(data.promoPrice));
    if (!isFinite(promo) || promo < 0) {
      return err('INVALID_INPUT', 'Promo price is invalid. / 促销价不正确。');
    }
    p.promoPriceSen = promo;
  }
  if (data.promoStart !== undefined) p.promoStart = String(data.promoStart).slice(0, 10);
  if (data.promoEnd !== undefined) p.promoEnd = String(data.promoEnd).slice(0, 10);

  p.updatedAt = nowISO();
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PRODUCT', 'PRODUCT', p.productId, before,
        JSON.stringify({ price: p.priceSen, status: p.status, available: p.available,
                         categoryId: p.categoryId, name: p.nameEN }));
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** archiveProduct（§62）——不删资料，只标 ARCHIVED（订单历史还要读得到名称） */
function archiveProduct(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String((data && data.productId) || ''));
  if (!p) return err('PRODUCT_NOT_FOUND');
  if (p.status === 'ARCHIVED') return ok({ product: publicProduct(p, todayKeyOf()), alreadyArchived: true });

  p.status = 'ARCHIVED';
  p.updatedAt = nowISO();
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'ARCHIVE_PRODUCT', 'PRODUCT', p.productId, 'ACTIVE', 'ARCHIVED');
  return ok({ product: publicProduct(p, todayKeyOf()) });
}

/** createProductOption（§62） */
function createProductOption(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var productId = String((data && data.productId) || '');
  if (!dbById('products', productId)) return err('PRODUCT_NOT_FOUND');

  var group = String((data && data.optionGroup) || '').trim().toUpperCase();
  var nameEN = String((data && data.nameEN) || '').trim();
  var nameZH = String((data && data.nameZH) || '').trim();
  if (!group) return err('INVALID_INPUT', 'optionGroup is required. / 请选择规格类别。');
  if (!nameEN && !nameZH) return err('INVALID_INPUT', 'Option name is required. / 请输入规格名称。');

  var adjust = Math.round(Number((data && data.priceAdjustment) || 0));
  if (!isFinite(adjust)) adjust = 0;
  if (adjust < 0) {
    return err('INVALID_INPUT', 'Price adjustment cannot be negative. / 加价不能是负数。');
  }

  var o = {
    optionId: dbNextId('OPT', 'option', 4),
    productId: productId,
    optionGroup: group,
    optionGroupNameEN: String((data && data.optionGroupNameEN) || '').trim(),
    optionGroupNameZH: String((data && data.optionGroupNameZH) || '').trim(),
    nameEN: nameEN,
    nameZH: nameZH,
    priceAdjustmentSen: adjust,
    required: (data && data.required) ? 'TRUE' : 'FALSE',
    status: 'ACTIVE',
    sortOrder: Number((data && data.sortOrder) || 0),
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
  dbInsert('productOptions', o);
  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'CREATE_PRODUCT_OPTION', 'PRODUCT', productId, '',
        group + ' / ' + nameEN + ' / +' + adjust);
  return ok({ option: publicOption(o) });
}

/** updateProductOption（§62） */
function updateProductOption(data, token) {
  var ctx = requireStaff(token, ['MANAGER', 'OWNER']);
  if (ctx.error) return ctx.error;

  var o = dbById('productOptions', String((data && data.optionId) || ''));
  if (!o) return err('OPTION_NOT_FOUND');

  var before = o.nameEN + ' / ' + o.priceAdjustmentSen + ' / ' + o.status;
  if (data.nameEN !== undefined) o.nameEN = String(data.nameEN).trim();
  if (data.nameZH !== undefined) o.nameZH = String(data.nameZH).trim();
  if (data.optionGroupNameEN !== undefined) o.optionGroupNameEN = String(data.optionGroupNameEN).trim();
  if (data.optionGroupNameZH !== undefined) o.optionGroupNameZH = String(data.optionGroupNameZH).trim();
  if (data.priceAdjustment !== undefined) {
    var adjust = Math.round(Number(data.priceAdjustment));
    if (!isFinite(adjust) || adjust < 0) {
      return err('INVALID_INPUT', 'Price adjustment cannot be negative. / 加价不能是负数。');
    }
    o.priceAdjustmentSen = adjust;
  }
  if (data.required !== undefined) o.required = data.required ? 'TRUE' : 'FALSE';
  if (data.sortOrder !== undefined) o.sortOrder = Number(data.sortOrder) || 0;
  if (data.status !== undefined) {
    o.status = String(data.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  }
  o.updatedAt = nowISO();

  clearMenuCache();
  audit(ctx.staff.staffId, 'STAFF', 'UPDATE_PRODUCT_OPTION', 'OPTION', o.optionId, before,
        o.nameEN + ' / ' + o.priceAdjustmentSen + ' / ' + o.status);
  return ok({ option: publicOption(o) });
}

/* -------------------------------------------------------------
   7. 小工具
   ------------------------------------------------------------- */

function normalizeTags(input) {
  if (!input) return '';
  var arr = Array.isArray(input) ? input : String(input).split(',');
  return arr.map(function (t) {
    return String(t).trim().toLowerCase().replace(/\s+/g, '-');
  }).filter(function (t) { return t.length; }).slice(0, 10).join(',');
}

/**
 * 示范酒单（§26 的例子）。只在 Products 还是空的时候写入，
 * 不会覆盖老板已经建好的菜单。
 */
function seedDemoMenu() {
  if (dbFilter('products', function () { return true; }).length) {
    return ok({ seeded: false, reason: 'Products 已有资料，不覆盖。' });
  }

  var cats = [
    ['SIGNATURE', '招牌特调', 1],
    ['CLASSIC', '经典鸡尾酒', 2],
    ['GIN', '金酒', 3],
    ['NON_ALCOHOL', '无酒精', 9]
  ];
  var catIds = {};
  cats.forEach(function (c) {
    var row = {
      categoryId: dbNextId('CAT', 'category', 4),
      nameEN: c[0].replace(/_/g, ' '), nameZH: c[1], status: 'ACTIVE',
      sortOrder: c[2], createdAt: nowISO(), updatedAt: nowISO()
    };
    dbInsert('categories', row);
    catIds[c[0]] = row.categoryId;
  });

  var items = [
    ['CLASSIC', 'Mojito', '经典莫希托', 'Mint · Lime · Rum', '清爽薄荷青柠', 2200, 'refreshing,citrus,mint', 'LIGHT'],
    ['CLASSIC', 'Long Island Iced Tea', '长岛冰茶', 'Five spirits · Cola', '五种基酒 · 可乐', 2800, 'strong,cola', 'STRONG'],
    ['SIGNATURE', 'Yetipsy Sunset', 'yetipsy 日落', 'House special', '本店特调', 3200, 'fruity,sweet', 'MEDIUM'],
    ['NON_ALCOHOL', 'Virgin Mojito', '无酒精莫希托', 'Mint · Lime · Soda', '清爽薄荷青柠', 1200, 'refreshing,citrus', 'LIGHT']
  ];
  var productIds = [];
  items.forEach(function (it, i) {
    var p = {
      productId: dbNextId('PRD', 'product', 4),
      categoryId: catIds[it[0]],
      nameEN: it[1], nameZH: it[2],
      descriptionEN: it[3], descriptionZH: it[4],
      priceSen: it[5], originalPriceSen: 0, promoPriceSen: 0, promoStart: '', promoEnd: '',
      tags: it[6], strength: it[7],
      imageURL: '/assets/menu/' + it[1].toLowerCase().replace(/[^a-z]+/g, '-') + '.webp',
      status: 'ACTIVE', available: 'TRUE', sortOrder: i + 1,
      createdAt: nowISO(), updatedAt: nowISO()
    };
    dbInsert('products', p);
    productIds.push(p.productId);
  });

  /* Mojito 的规格（§8：Size / ICE / SWEETNESS 都来自 Sheet） */
  var mojito = productIds[0];
  [
    ['SIZE', 'Size', '份量', 'Regular', '标准', 0, true, 1],
    ['SIZE', 'Size', '份量', 'Large', '大杯', 600, false, 2],
    ['ICE', 'Ice', '冰块', 'Normal', '正常冰', 0, false, 3],
    ['ICE', 'Ice', '冰块', 'Less Ice', '少冰', 0, false, 4],
    ['SWEETNESS', 'Sweetness', '甜度', 'Normal', '正常甜', 0, false, 5],
    ['SWEETNESS', 'Sweetness', '甜度', 'Less Sweet', '少甜', 0, false, 6]
  ].forEach(function (o) {
    dbInsert('productOptions', {
      optionId: dbNextId('OPT', 'option', 4),
      productId: mojito,
      optionGroup: o[0], optionGroupNameEN: o[1], optionGroupNameZH: o[2],
      nameEN: o[3], nameZH: o[4], priceAdjustmentSen: o[5],
      required: o[6] ? 'TRUE' : 'FALSE', status: 'ACTIVE', sortOrder: o[7],
      createdAt: nowISO(), updatedAt: nowISO()
    });
  });

  clearMenuCache();
  return ok({
    seeded: true,
    categories: cats.length,
    products: items.length,
    options: 6
  });
}

/* =============================================================
   员工专用菜单（2.0 Phase 10 · §32）
   -------------------------------------------------------------
   为什么不能用 getMenu：
     1. getMenu 用 requireCustomer()，员工 token 一律 INVALID_SESSION
     2. buildMenu() 只回 status = ACTIVE 的分类 / 商品 / 规格，
        老板在管理页会看不到已下架的商品，也就无法恢复或编辑

   所以这个函式：任何员工都能读（普通员工要看得到商品才能标售罄），
   回传**全部状态**的资料，并附上管理才需要的栏位
   （status / promoPrice / promoStart / promoEnd / 原价）。
   不走 CacheService —— 管理页要看到刚改完的结果（§82 的快取是给顾客端的）。
   ============================================================= */

function getAdminMenu(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var today = todayKeyOf();

  var categories = dbFilter('categories', function () { return true; })
    .sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    })
    .map(function (c) {
      var out = publicCategory(c);
      out.status = String(c.status || 'ACTIVE').toUpperCase();
      return out;
    });

  var products = dbFilter('products', function () { return true; })
    .sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    })
    .map(function (p) {
      var out = publicProduct(p, today);
      out.status = String(p.status || 'ACTIVE').toUpperCase();
      out.promoPrice = Math.round(Number(p.promoPriceSen) || 0);
      out.promoStart = p.promoStart || '';
      out.promoEnd = p.promoEnd || '';
      return out;
    });

  var options = dbFilter('productOptions', function () { return true; })
    .sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    })
    .map(function (o) {
      var out = publicOption(o);
      out.status = String(o.status || 'ACTIVE').toUpperCase();
      return out;
    });

  var optionsByProduct = {};
  options.forEach(function (o) {
    if (!optionsByProduct[o.productId]) optionsByProduct[o.productId] = [];
    optionsByProduct[o.productId].push(o);
  });

  return ok({
    categories: categories,
    products: products,
    optionsByProduct: optionsByProduct,
    today: today,
    /* 前端要用这个决定「新增 / 编辑」按钮给不给看（§32） */
    canEdit: ['MANAGER', 'OWNER'].indexOf(
      String(ctx.staff && ctx.staff.role).toUpperCase()) >= 0,
    counts: {
      categories: categories.length,
      products: products.length,
      active: products.filter(function (p) { return p.status === 'ACTIVE'; }).length,
      archived: products.filter(function (p) { return p.status !== 'ACTIVE'; }).length,
      soldOut: products.filter(function (p) { return !p.available; }).length
    }
  });
}

/* =============================================================
   商品上下架（2.0 · §32 状态类操作）
   -------------------------------------------------------------
   与 setProductAvailability 同级：任何员工都能操作。
   「状态」类操作（售罄 / 有货、上架 / 下架）不该卡在权限上，
   改价格与新增商品仍然只有 MANAGER / OWNER（updateProduct）。

   入参：{ productId, status: 'ACTIVE' | 'ARCHIVED' }
   ============================================================= */

function setProductStatus(data, token) {
  var ctx = requireStaff(token);
  if (ctx.error) return ctx.error;

  var p = dbById('products', String(data.productId || ''));
  if (!p) return err('PRODUCT_NOT_FOUND');

  var status = String(data.status || '').toUpperCase();
  if (['ACTIVE', 'ARCHIVED'].indexOf(status) === -1) {
    return err('INVALID_INPUT', 'Status must be ACTIVE or ARCHIVED. / 状态只能是 ACTIVE 或 ARCHIVED。');
  }

  p.status = status;
  p.updatedAt = nowISO();

  audit(ctx.staff.staffId, 'STAFF', 'SET_PRODUCT_STATUS', 'PRODUCT', p.productId,
        '', status === 'ACTIVE' ? '上架' : '下架');

  clearMenuCache();

  return ok({ productId: p.productId, status: p.status });
}
