/* =============================================================
   demo/test-menu.js
   -------------------------------------------------------------
   2.0 Phase 3 验收测试（企划书 §5–§8 / §31–§35 / §40–§41 / §60–§62 / §82）

   重点验证「不能违反的规则」：
     · §41 价格只由 Backend 决定，前端送来的价格一律忽略
     · §40 促销价由 Backend 判断时间窗
     · §32 Staff 只能改 AVAILABLE，不能建 / 改商品
     · §82 菜单可缓存，但钱包 / 余额绝不缓存；改过商品要立刻失效
     · §5 / §8 分类与规格来自 Sheet，不 Hardcode

   执行： node demo/test-menu.js
   ============================================================= */

'use strict';

const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const suite = new Suite('YETIPSY · 2.0 菜单测试（Phase 3 · §5–§8 / §31–§41）');

const OWNER = { username: 'owner', password: 'owner-pass-123' };
const PASSWORD = 'test-pass-123';

function call(world, action, data, token) {
  return world.api.doPost({ action: action, data: data || {}, token: token || '' });
}

/** 有示范酒单的世界 */
function menuWorld() {
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  w.ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  w.api.mutate((DB, sb) => sb.seedDemoMenu());

  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  w.customerToken = reg.data.token;
  w.customerId = reg.data.customer.customerId;

  const menu = call(w, 'getMenu', {}, w.customerToken);
  w.menu = menu.data;
  w.mojito = menu.data.products.find((p) => p.nameEN === 'Mojito');
  w.longIsland = menu.data.products.find((p) => p.nameEN === 'Long Island Iced Tea');
  return w;
}

/** 建一个 STAFF（非 MANAGER/OWNER）账号 */
function makeStaff(w, username) {
  const created = call(w, 'createStaff',
    { username: username, password: 'staff-pass-123', role: 'STAFF' }, w.ownerToken);
  if (!created.success) return null;
  const login = call(w, 'staffLogin', { username: username, password: 'staff-pass-123' });
  return login.success ? login.data.token : null;
}

/* -------------------------------------------------------------
   01 · 权限：菜单是会员专属
   ------------------------------------------------------------- */
suite.group('01 · 菜单需要会员登入', (t) => {
  const w = menuWorld();

  t.errorIs(call(w, 'getMenu', {}, ''), 'INVALID_SESSION', '没登入不能看菜单');
  t.errorIs(call(w, 'getCategories', {}, ''), 'INVALID_SESSION', 'getCategories 同样要登入');
  t.errorIs(call(w, 'getProducts', {}, ''), 'INVALID_SESSION', 'getProducts 同样要登入');
  t.errorIs(call(w, 'getProduct', { productId: w.mojito.productId }, ''),
    'INVALID_SESSION', 'getProduct 同样要登入');

  /* 员工 token 不是会员 token，也不能当会员用 */
  t.errorIs(call(w, 'getMenu', {}, w.ownerToken), 'INVALID_SESSION',
    '员工 token 不能当会员 token 用');

  const okMenu = call(w, 'getMenu', {}, w.customerToken);
  t.okIs(okMenu, '会员可以看菜单');
});

/* -------------------------------------------------------------
   02 · 分类 / 商品 / 规格都来自 Sheet（§5 / §8 不 Hardcode）
   ------------------------------------------------------------- */
suite.group('02 · 分类与规格来自 Sheet，不是写死的', (t) => {
  const w = menuWorld();

  t.equal('4 个分类', w.menu.categories.length, 4);
  t.check('有 SIGNATURE 分类',
    w.menu.categories.some((c) => c.nameEN === 'SIGNATURE'), w.menu.categories);
  t.check('分类有中文名', w.menu.categories.every((c) => !!c.nameZH));

  t.equal('4 个商品', w.menu.products.length, 4);
  t.equal('Mojito RM22.00（§26 的例子）', w.mojito.price, 2200);
  t.equal('Long Island RM28.00', w.longIsland.price, 2800);

  /* §33 图片只存 URL */
  t.check('图片是 URL 不是内嵌资料',
    /^\/assets\/menu\/[a-z0-9-]+\.webp$/.test(w.mojito.imageURL), w.mojito.imageURL);

  /* §8 规格：Size / ICE / SWEETNESS 都从 Sheet 来 */
  const det = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken);
  t.okIs(det, 'getProduct 成功');
  const groups = det.data.optionGroups.map((g) => g.optionGroup);
  t.equal('Mojito 有 3 组规格', groups.length, 3);
  t.check('有 SIZE', groups.indexOf('SIZE') >= 0, groups);
  t.check('有 ICE', groups.indexOf('ICE') >= 0, groups);
  t.check('有 SWEETNESS', groups.indexOf('SWEETNESS') >= 0, groups);

  const size = det.data.optionGroups.find((g) => g.optionGroup === 'SIZE');
  t.equal('SIZE 是必选', size.required, true);
  const large = size.options.find((o) => o.nameEN === 'Large');
  t.equal('Large 加 RM6.00（§7）', large.priceAdjustment, 600);
  t.equal('Regular 不加价', size.options.find((o) => o.nameEN === 'Regular').priceAdjustment, 0);

  /* 新增一组规格，菜单要立刻看得到（证明不是写死的） */
  const shot = call(w, 'createProductOption', {
    productId: w.mojito.productId, optionGroup: 'EXTRA',
    optionGroupNameEN: 'Extra Shot', optionGroupNameZH: '加一份酒',
    nameEN: 'Extra Rum', nameZH: '多加朗姆', priceAdjustment: 800
  }, w.ownerToken);
  t.okIs(shot, '可以新增规格（§8 未来可扩 Extra Shot +RM8）');

  const det2 = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken);
  t.equal('新规格立刻出现在菜单', det2.data.optionGroups.length, 4);
  t.equal('Extra Rum 加 RM8.00',
    det2.data.optionGroups.find((g) => g.optionGroup === 'EXTRA').options[0].priceAdjustment, 800);
});

/* -------------------------------------------------------------
   03 · §41 价格只由 Backend 决定
   ------------------------------------------------------------- */
suite.group('03 · 前端送来的价格一律被忽略（§41）', (t) => {
  const w = menuWorld();

  /* 顾客端没有任何 action 可以「告诉后端价格」 */
  const actions = Object.keys(w.api.handlers());
  const customerActions = ['getMenu', 'getCategories', 'getProducts', 'getProduct',
    'getProductOptions'];
  customerActions.forEach((a) => {
    t.check(a + ' 存在于 handlers', actions.indexOf(a) >= 0);
  });

  /* getProduct 回传的价格永远等于 Sheet 里的价格 */
  const det = call(w, 'getProduct',
    { productId: w.mojito.productId, price: 1, priceSen: 1, hackPrice: 1 }, w.customerToken);
  t.okIs(det, '带假价格参数也能呼叫');
  t.equal('但回传的价格还是 RM22.00', det.data.product.price, 2200);

  /* 商品资料里不能出现前端可控的价格栏位 */
  const keys = Object.keys(det.data.product);
  t.check('对外形状没有 priceSen 这种可直接改写的栏位',
    keys.indexOf('priceSen') === -1, keys);

  /* 改价格只有 MANAGER / OWNER 的 updateProduct 能做到 */
  t.errorIs(call(w, 'updateProduct',
    { productId: w.mojito.productId, price: 1 }, w.customerToken),
    'INVALID_SESSION', '会员不能改价格');
});

/* -------------------------------------------------------------
   04 · §40 促销价由 Backend 判断时间窗
   ------------------------------------------------------------- */
suite.group('04 · 促销价由 Backend 判断，前端不能指定（§40）', (t) => {
  const w = menuWorld();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const days = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  /* 还没到促销期 → 原价 */
  call(w, 'updateProduct', {
    productId: w.mojito.productId, promoPrice: 1500,
    promoStart: days(3), promoEnd: days(10)
  }, w.ownerToken);
  let p = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken).data.product;
  t.equal('促销还没开始 → 原价 RM22.00', p.price, 2200);
  t.equal('不算促销中', p.onPromo, false);

  /* 促销期内 → 促销价 + 显示原价 */
  call(w, 'updateProduct', {
    productId: w.mojito.productId, promoStart: days(-1), promoEnd: days(5)
  }, w.ownerToken);
  p = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken).data.product;
  t.equal('促销中 → RM15.00', p.price, 1500);
  t.equal('onPromo = true', p.onPromo, true);
  t.equal('同时给出原价 RM22.00（前端画删除线）', p.originalPrice, 2200);

  /* 促销过期 → 回到原价 */
  call(w, 'updateProduct', {
    productId: w.mojito.productId, promoStart: days(-10), promoEnd: days(-2)
  }, w.ownerToken);
  p = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken).data.product;
  t.equal('促销过期 → 回到 RM22.00', p.price, 2200);
  t.equal('onPromo = false', p.onPromo, false);

  /* 促销价比原价还贵 → 不生效（防呆） */
  call(w, 'updateProduct', {
    productId: w.mojito.productId, promoPrice: 3000,
    promoStart: days(-1), promoEnd: days(5)
  }, w.ownerToken);
  p = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken).data.product;
  t.equal('促销价高于原价 → 不生效，仍 RM22.00', p.price, 2200);

  /* 促销价 0 或负数 → 拒绝 */
  t.errorIs(call(w, 'updateProduct',
    { productId: w.mojito.productId, promoPrice: -100 }, w.ownerToken),
    'INVALID_INPUT', '负数促销价被拒绝');
});

/* -------------------------------------------------------------
   05 · §31 / §66 SOLD OUT
   ------------------------------------------------------------- */
suite.group('05 · SOLD OUT：员工可切，顾客端立刻看到', (t) => {
  const w = menuWorld();

  t.equal('一开始有货', w.mojito.available, true);

  const off = call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.ownerToken);
  t.okIs(off, '标记售罄成功');
  t.equal('回传 available = false', off.data.product.available, false);

  const menu = call(w, 'getMenu', {}, w.customerToken);
  const m = menu.data.products.find((x) => x.productId === w.mojito.productId);
  t.equal('顾客端菜单立刻显示售罄（§31）', m.available, false);

  const on = call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: true }, w.ownerToken);
  t.equal('恢复有货', on.data.product.available, true);

  /* 参数检查 */
  t.errorIs(call(w, 'setProductAvailability',
    { productId: w.mojito.productId }, w.ownerToken),
    'INVALID_INPUT', '没给 available 会被拒');
  t.errorIs(call(w, 'setProductAvailability',
    { productId: 'PRD9999', available: false }, w.ownerToken),
    'PRODUCT_NOT_FOUND', '不存在的商品');
  t.errorIs(call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.customerToken),
    'INVALID_SESSION', '会员不能改库存');
});

/* -------------------------------------------------------------
   06 · §32 Staff 只能改库存，不能建 / 改商品
   ------------------------------------------------------------- */
suite.group('06 · Staff 只能改 AVAILABLE（§32）', (t) => {
  const w = menuWorld();
  const staffToken = makeStaff(w, 'bartender1');
  t.check('STAFF 账号建好了', !!staffToken);

  /* 可以改库存 */
  const off = call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, staffToken);
  t.okIs(off, 'Staff 可以标售罄');

  /* 不能建 / 改 / 下架商品 */
  t.errorIs(call(w, 'createProduct',
    { categoryId: w.menu.categories[0].categoryId, nameEN: 'Hack', price: 100 }, staffToken),
    'UNAUTHORIZED', 'Staff 不能新增商品');
  t.errorIs(call(w, 'updateProduct',
    { productId: w.mojito.productId, price: 100 }, staffToken),
    'UNAUTHORIZED', 'Staff 不能改价格');
  t.errorIs(call(w, 'archiveProduct',
    { productId: w.mojito.productId }, staffToken),
    'UNAUTHORIZED', 'Staff 不能下架商品');
  t.errorIs(call(w, 'createCategory', { nameEN: 'Hack' }, staffToken),
    'UNAUTHORIZED', 'Staff 不能新增分类');
  t.errorIs(call(w, 'createProductOption',
    { productId: w.mojito.productId, optionGroup: 'SIZE', nameEN: 'Free' }, staffToken),
    'UNAUTHORIZED', 'Staff 不能新增规格');

  /* 价格确实没被改掉 */
  const p = call(w, 'getProduct', { productId: w.mojito.productId }, w.customerToken).data.product;
  t.equal('价格仍是 RM22.00', p.price, 2200);
});

/* -------------------------------------------------------------
   07 · §34 / §35 搜寻与筛选
   ------------------------------------------------------------- */
suite.group('07 · 中英文搜寻与风味筛选', (t) => {
  const w = menuWorld();

  const byEN = call(w, 'getMenu', { search: 'mojito' }, w.customerToken);
  t.equal('搜 mojito → 2 项（Mojito + Virgin Mojito）', byEN.data.shownProducts, 2);

  const byZH = call(w, 'getMenu', { search: '莫希托' }, w.customerToken);
  t.equal('搜中文「莫希托」→ 2 项（§34）', byZH.data.shownProducts, 2);

  const byDesc = call(w, 'getMenu', { search: 'cola' }, w.customerToken);
  t.equal('描述也能搜到（Long Island）', byDesc.data.shownProducts, 1);

  const nothing = call(w, 'getMenu', { search: 'zzzzz' }, w.customerToken);
  t.equal('搜不到就 0 项', nothing.data.shownProducts, 0);
  t.equal('但总商品数照常回报', nothing.data.totalProducts, 4);

  const refreshing = call(w, 'getMenu', { tag: 'refreshing' }, w.customerToken);
  t.equal('tag=refreshing → 2 项（§35）', refreshing.data.shownProducts, 2);

  const strong = call(w, 'getMenu', { tag: 'strong' }, w.customerToken);
  t.equal('tag=strong → 1 项', strong.data.shownProducts, 1);

  const cat = w.menu.categories.find((c) => c.nameEN === 'CLASSIC');
  const byCat = call(w, 'getMenu', { categoryId: cat.categoryId }, w.customerToken);
  t.equal('按分类筛选 → 2 项', byCat.data.shownProducts, 2);

  const combo = call(w, 'getMenu', { search: 'mojito', tag: 'mint' }, w.customerToken);
  t.equal('搜寻 + 筛选可叠加 → 1 项', combo.data.shownProducts, 1);
});

/* -------------------------------------------------------------
   08 · §82 缓存：可以缓存菜单，但绝不缓存钱包；改过就要失效
   ------------------------------------------------------------- */
suite.group('08 · 菜单缓存（§82）', (t) => {
  const w = menuWorld();
  w.api.clearMenuCache();          // menuWorld() 已经读过一次菜单，先清掉才能测「第一次」

  const first = call(w, 'getMenu', {}, w.customerToken);
  t.equal('第一次不是从缓存来', first.data.fromCache, false);

  const second = call(w, 'getMenu', {}, w.customerToken);
  t.equal('第二次命中缓存', second.data.fromCache, true);
  t.equal('缓存内容一样', second.data.products.length, first.data.products.length);

  /* 改过商品 → 缓存必须失效，否则员工标了售罄顾客还看到有货 */
  call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.ownerToken);
  const third = call(w, 'getMenu', {}, w.customerToken);
  t.equal('改过商品后缓存失效', third.data.fromCache, false);
  t.equal('而且立刻反映售罄',
    third.data.products.find((p) => p.productId === w.mojito.productId).available, false);

  /* 改价格 / 分类 / 规格也都要失效 */
  call(w, 'getMenu', {}, w.customerToken);
  call(w, 'updateProduct', { productId: w.mojito.productId, price: 2500 }, w.ownerToken);
  t.equal('改价格后缓存失效',
    call(w, 'getMenu', {}, w.customerToken).data.fromCache, false);

  call(w, 'getMenu', {}, w.customerToken);
  call(w, 'createProductOption', {
    productId: w.mojito.productId, optionGroup: 'EXTRA', nameEN: 'Test', priceAdjustment: 0
  }, w.ownerToken);
  t.equal('新增规格后缓存失效',
    call(w, 'getMenu', {}, w.customerToken).data.fromCache, false);

  /* §82 红线：钱包 / 余额绝不缓存 */
  call(w, 'manualWalletAdjustment',
    { customerId: w.customerId, amount: 5000, reason: 'cache test' }, w.ownerToken);
  const w1 = call(w, 'getWallet', {}, w.customerToken).data.balance;
  call(w, 'manualWalletAdjustment',
    { customerId: w.customerId, amount: -2000, reason: 'cache test' }, w.ownerToken);
  const w2 = call(w, 'getWallet', {}, w.customerToken).data.balance;
  t.equal('钱包余额 5000', w1, 5000);
  t.equal('扣掉后立刻变 3000（没有被缓存）', w2, 3000);

  const p1 = call(w, 'getProfile', {}, w.customerToken).data.customer.currentPoints;
  call(w, 'manualPointAdjustment',
    { customerId: w.customerId, points: 50, reason: 'cache test' }, w.ownerToken);
  const p2 = call(w, 'getProfile', {}, w.customerToken).data.customer.currentPoints;
  t.equal('积分也没有被缓存', p2, p1 + 50);
});

/* -------------------------------------------------------------
   09 · §63 / §64 点单开关与营业时间
   ------------------------------------------------------------- */
suite.group('09 · 点单开关与营业时间（§63 / §64）', (t) => {
  const w = menuWorld();

  let ordering = call(w, 'getMenu', {}, w.customerToken).data.ordering;
  t.equal('预设 ORDERING_ENABLED = true', ordering.enabled, true);
  t.equal('预设没暂停', ordering.paused, false);
  t.equal('开放时间 18:30', ordering.openTime, '18:30');
  t.equal('关闭时间 00:00', ordering.closeTime, '00:00');
  t.check('回传现在几点（后端时区）', /^\d{2}:\d{2}$/.test(ordering.now), ordering.now);

  /* 关掉点单：菜单仍可浏览，但不能下单（§64） */
  call(w, 'updateSetting', { key: 'ORDERING_ENABLED', value: 'FALSE' }, w.ownerToken);
  ordering = call(w, 'getMenu', {}, w.customerToken).data.ordering;
  t.equal('关闭后 enabled = false', ordering.enabled, false);
  t.equal('open = false', ordering.open, false);
  t.equal('reason = DISABLED', ordering.reason, 'DISABLED');
  const stillBrowse = call(w, 'getMenu', {}, w.customerToken);
  t.okIs(stillBrowse, '关闭点单仍可浏览菜单（§64）');
  t.equal('商品照常列出', stillBrowse.data.products.length, 4);

  /* 员工紧急暂停（§65） */
  call(w, 'updateSetting', { key: 'ORDERING_ENABLED', value: 'TRUE' }, w.ownerToken);
  call(w, 'updateSetting', { key: 'ORDERING_PAUSED', value: 'TRUE' }, w.ownerToken);
  ordering = call(w, 'getMenu', {}, w.customerToken).data.ordering;
  t.equal('暂停时 paused = true', ordering.paused, true);
  t.equal('open = false', ordering.open, false);
  t.equal('reason = PAUSED', ordering.reason, 'PAUSED');

  /* 其他 2.0 设定要透给前端 */
  const menu = call(w, 'getMenu', {}, w.customerToken).data;
  t.equal('allowPickup 透传', menu.allowPickup, true);
  t.equal('allowTableOrder 透传', menu.allowTableOrder, true);
  t.equal('maxOrderItems = 20', menu.maxOrderItems, 20);
});

/* -------------------------------------------------------------
   10 · Owner 商品管理（§62）
   ------------------------------------------------------------- */
suite.group('10 · Owner 商品 / 分类管理', (t) => {
  const w = menuWorld();

  /* 分类 */
  const cat = call(w, 'createCategory',
    { nameEN: 'TEQUILA', nameZH: '龙舌兰', sortOrder: 5 }, w.ownerToken);
  t.okIs(cat, '新增分类');
  t.equal('分类 ID 格式 CAT0005', cat.data.category.categoryId, 'CAT0005');

  t.errorIs(call(w, 'createCategory', {}, w.ownerToken),
    'INVALID_INPUT', '没名称的分类被拒');

  const updCat = call(w, 'updateCategory',
    { categoryId: cat.data.category.categoryId, nameZH: '龙舌兰酒' }, w.ownerToken);
  t.equal('分类可改名', updCat.data.category.nameZH, '龙舌兰酒');

  t.errorIs(call(w, 'updateCategory', { categoryId: 'CAT9999' }, w.ownerToken),
    'CATEGORY_NOT_FOUND', '不存在的分类');

  /* 商品 */
  const prod = call(w, 'createProduct', {
    categoryId: cat.data.category.categoryId,
    nameEN: 'Margarita', nameZH: '玛格丽特',
    descriptionEN: 'Tequila · Lime · Salt', descriptionZH: '龙舌兰 · 青柠 · 盐',
    price: 2600, tags: 'Citrus, Strong', strength: 'medium',
    imageURL: '/assets/menu/margarita.webp', sortOrder: 1
  }, w.ownerToken);
  t.okIs(prod, '新增商品');
  t.equal('商品 ID 格式 PRD0005', prod.data.product.productId, 'PRD0005');
  t.equal('价格 RM26.00', prod.data.product.price, 2600);
  t.equal('tags 正规化成小写', prod.data.product.tags.join(','), 'citrus,strong');
  t.equal('strength 转大写', prod.data.product.strength, 'MEDIUM');

  /* 参数检查 */
  t.errorIs(call(w, 'createProduct',
    { categoryId: cat.data.category.categoryId, nameEN: 'X', price: 0 }, w.ownerToken),
    'INVALID_INPUT', '价格 0 被拒');
  t.errorIs(call(w, 'createProduct',
    { categoryId: 'CAT9999', nameEN: 'X', price: 100 }, w.ownerToken),
    'CATEGORY_NOT_FOUND', '分类不存在被拒');
  t.errorIs(call(w, 'createProduct',
    { categoryId: cat.data.category.categoryId, price: 100 }, w.ownerToken),
    'INVALID_INPUT', '没名称被拒');

  /* 新商品要出现在菜单 */
  const menu = call(w, 'getMenu', {}, w.customerToken);
  t.equal('菜单变 5 个商品', menu.data.products.length, 5);

  /* 下架是标记不是删除（§30 订单历史还要读名称） */
  const arch = call(w, 'archiveProduct',
    { productId: prod.data.product.productId }, w.ownerToken);
  t.okIs(arch, '下架商品');
  const menu2 = call(w, 'getMenu', {}, w.customerToken);
  t.equal('下架后菜单只剩 4 个', menu2.data.products.length, 4);
  const row = w.api.inspect((DB) => DB.products.find(
    (p) => p.productId === prod.data.product.productId));
  t.equal('但资料还在（status = ARCHIVED）', row.status, 'ARCHIVED');
  t.check('名称还读得到', !!row.nameEN);

  const arch2 = call(w, 'archiveProduct',
    { productId: prod.data.product.productId }, w.ownerToken);
  t.equal('重复下架回报 alreadyArchived', arch2.data.alreadyArchived, true);

  /* 规格参数检查 */
  t.errorIs(call(w, 'createProductOption',
    { productId: w.mojito.productId, nameEN: 'No group' }, w.ownerToken),
    'INVALID_INPUT', '没有 optionGroup 被拒');
  t.errorIs(call(w, 'createProductOption',
    { productId: w.mojito.productId, optionGroup: 'SIZE', nameEN: 'Bad', priceAdjustment: -500 },
    w.ownerToken), 'INVALID_INPUT', '负数加价被拒');

  const opt = call(w, 'createProductOption', {
    productId: w.mojito.productId, optionGroup: 'SIZE', nameEN: 'Jumbo',
    nameZH: '超大杯', priceAdjustment: 1200
  }, w.ownerToken);
  t.okIs(opt, '新增规格');
  const updOpt = call(w, 'updateProductOption',
    { optionId: opt.data.option.optionId, priceAdjustment: 1000 }, w.ownerToken);
  t.equal('规格加价可改', updOpt.data.option.priceAdjustment, 1000);
  t.errorIs(call(w, 'updateProductOption', { optionId: 'OPT9999' }, w.ownerToken),
    'OPTION_NOT_FOUND', '不存在的规格');
});

/* -------------------------------------------------------------
   11 · seedDemoMenu 不覆盖既有菜单（§67 同款原则）
   ------------------------------------------------------------- */
suite.group('11 · seedDemoMenu() 不覆盖老板已建的菜单', (t) => {
  const w = menuWorld();
  const before = call(w, 'getMenu', {}, w.customerToken).data.products.length;

  const again = w.api.mutate((DB, sb) => sb.seedDemoMenu());
  t.okIs(again, '再跑一次 seedDemoMenu 不报错');
  t.equal('但回报 seeded = false', again.data.seeded, false);
  t.check('并说明原因', /不覆盖/.test(String(again.data.reason)), again.data.reason);

  const after = call(w, 'getMenu', {}, w.customerToken).data.products.length;
  t.equal('商品数没变', after, before);

  /* 空菜单时才播种 */
  const empty = loadBackend();
  empty.api.setupDatabase();
  const seeded = empty.api.mutate((DB, sb) => sb.seedDemoMenu());
  t.equal('空菜单 → seeded = true', seeded.data.seeded, true);
  t.equal('播了 4 个商品', seeded.data.products, 4);
  t.equal('播了 4 个分类', seeded.data.categories, 4);
  t.equal('播了 6 个规格', seeded.data.options, 6);
});

/* -------------------------------------------------------------
   12 · 每个动作都要留 Audit Log（§12 安全审计要用）
   ------------------------------------------------------------- */
suite.group('12 · 菜单操作都有 Audit Log', (t) => {
  const w = menuWorld();

  call(w, 'createCategory', { nameEN: 'WHISKY', nameZH: '威士忌' }, w.ownerToken);
  call(w, 'createProduct', {
    categoryId: w.menu.categories[0].categoryId, nameEN: 'Test Drink', price: 1000
  }, w.ownerToken);
  call(w, 'updateProduct', { productId: w.mojito.productId, price: 2500 }, w.ownerToken);
  call(w, 'setProductAvailability',
    { productId: w.mojito.productId, available: false }, w.ownerToken);
  call(w, 'archiveProduct', { productId: w.mojito.productId }, w.ownerToken);

  const logs = call(w, 'getAuditLogs', {}, w.ownerToken);
  t.okIs(logs, 'getAuditLogs 可读');
  const actions = logs.data.logs.map((l) => l.action);
  ['CREATE_CATEGORY', 'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'PRODUCT_SOLD_OUT', 'ARCHIVE_PRODUCT']
    .forEach((a) => {
      t.check('有 ' + a + ' 纪录', actions.indexOf(a) >= 0, actions.slice(0, 12));
    });

  /* 改价格要能看到改前改后（§12 价格篡改审计） */
  const priceLog = logs.data.logs.find((l) => l.action === 'UPDATE_PRODUCT');
  t.check('UPDATE_PRODUCT 记了旧值', /2200/.test(String(priceLog.oldValue)), priceLog.oldValue);
  t.check('UPDATE_PRODUCT 记了新值', /2500/.test(String(priceLog.newValue)), priceLog.newValue);
});

/* -------------------------------------------------------------
   13 · 2.0 的表还没建时，菜单 API 要回 UPGRADE_REQUIRED 而不是崩掉
   ------------------------------------------------------------- */
suite.group('13 · 还没升级时的行为', (t) => {
  const w = loadBackend();
  w.api.setupDatabase();
  w.api.bootstrapOwner(OWNER.username, OWNER.password);
  const ownerToken = call(w, 'staffLogin',
    { username: OWNER.username, password: OWNER.password }).data.token;
  const reg = call(w, 'customerRegister',
    { phone: '0123456789', name: 'Jason', password: PASSWORD });
  const customerToken = reg.data.token;

  /* 把 2.0 的表拿掉，模拟还没执行 upgradeToV2() */
  ['Categories', 'Products', 'ProductOptions', 'AppOrders', 'OrderItems']
    .forEach((n) => { delete w.shim.spreadsheet.sheets[n]; });

  const menu = call(w, 'getMenu', {}, customerToken);
  t.okIs(menu, '缺表时 getMenu 不崩，回空菜单');
  t.equal('商品 0 个', menu.data.products.length, 0);
  t.equal('分类 0 个', menu.data.categories.length, 0);

  /* 1.x 照常（§68） */
  t.okIs(call(w, 'getProfile', {}, customerToken), '缺表时 getProfile 照常');
  t.okIs(call(w, 'getWallet', {}, customerToken), '缺表时 getWallet 照常');

  /* 想写商品就会明确报错，不会静默丢资料 */
  const cat = call(w, 'createCategory', { nameEN: 'X' }, ownerToken);
  t.equal('写分类会失败（表不存在）', cat.success, false);
});

suite.run().then((pass) => { process.exit(pass ? 0 : 1); });
