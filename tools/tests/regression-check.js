/* =============================================================
   tools/tests/regression-check.js —— 这几轮修过的东西不许坏
   -------------------------------------------------------------
   覆盖（都是这几版实际修过、被 user 回报过的问题）：
     ① 看板：按一下 → 直接「制作中」（旧版后端也一样）
     ② 看板：没有「已确认」这一栏；残留 CONFIRMED 并进「制作中」
     ③ 点餐台：选规格画得出来、加价算进去
     ④ 顾客酒单 / 商品页：选规格 → 金额跟着变 → 加入购物车带规格
     ⑤ 结帐小抽屉：先算好价、开抽屉 120ms 内有金额、旧报价不会变订单
     ⑥ 员工菜单管理：新增 / 编辑都用小抽屉，按了真的有反应
     ⑦ 刷新间隔：看板 4 秒、顾客取餐状态 3 秒
   跑法：node tools/tests/regression-check.js
   ============================================================= */
'use strict';

const H = require('./harness');
const h = H.create({ port: 4418 });
const check = (n, ok, d) => h.check(n, ok, d);

(async function run() {
  await h.start();
  const s = h.seed();
  console.log('回归检查（2.1.11 ~ 2.1.17 修过的东西）\n');

  /* ---------------- ① ~ ② 看板 ---------------- */
  console.log('[1] 订单看板：按一下直接进「制作中」、没有「已确认」栏');
  const staffLocal = {
    yt_staff_token: s.TOKEN,
    yt_staff_profile: JSON.stringify({ username: 'owner', role: 'OWNER', staffId: 'ST1' })
  };
  const o1 = h.placeOrder(s);
  const board = await h.open('admin/orderboard.html', { storage: staffLocal, wait: 1500 });
  const bd = board.doc;
  const laneOf = (id) => {
    const card = bd.querySelector('[data-card="' + id + '"]');
    if (!card) return null;
    const lane = card.closest ? card.closest('[data-lane]') : null;
    return lane ? lane.getAttribute('data-lane') : null;
  };
  const laneKeys = Array.prototype.slice.call(bd.querySelectorAll('.lane'))
    .map((n) => n.getAttribute('data-lane'));
  check('★ 画面上没有「已确认」栏', laneKeys.indexOf('CONFIRMED') === -1, laneKeys);
  check('栏位：新订单 → 制作中 → 可取酒', laneKeys.join(',') === 'NEW,PREPARING,READY', laneKeys);
  check('新单在「新订单」栏', laneOf(o1) === 'NEW', laneOf(o1));

  h.delays.write = 1500;
  bd.querySelector('[data-card="' + o1 + '"] [data-act]').click();
  await h.sleep(120);
  check('★ 按下去 120ms 内卡片已在「制作中」栏', laneOf(o1) === 'PREPARING', laneOf(o1));
  const midBtn = bd.querySelector('[data-card="' + o1 + '"] .big-action');
  check('★ 按钮直接是下一个动作「做好了 READY」（没有「处理中…」）',
    !!midBtn && /做好了/.test(midBtn.textContent) && !/处理中/.test(bd.getElementById('boardBody').textContent),
    midBtn ? midBtn.textContent.trim() : '(没有)');
  await h.sleep(2000);
  h.delays.write = 0;
  const raw = h.post('getActiveOrders', {}, s.TOKEN);
  check('后端状态真的变成 PREPARING（不是只有画面好看）',
    (raw.data.lanes.PREPARING || []).some((o) => o.appOrderId === o1));
  check('看板刷新间隔 = 4 秒', board.win.ADMIN_ORDERBOARD.debugState().pollEverySeconds === 4,
    board.win.ADMIN_ORDERBOARD.debugState().pollEverySeconds);

  /* 旧版后端：不认得 acceptOrder 的 startPreparing 参数（只会给 CONFIRMED），
     但 startPreparing 这支 action 是有的 → 前端要自己补第二步。 */
  h.transforms.acceptOrder = function (p) {
    return { action: 'acceptOrder', data: { appOrderId: p.data.appOrderId }, token: p.token };
  };
  const o2 = h.placeOrder(s);
  board.win.API.cache.drop('getActiveOrders', {});
  await board.win.ADMIN_ORDERBOARD.load(false);
  await h.sleep(600);
  check('第二张新单在「新订单」栏', laneOf(o2) === 'NEW', laneOf(o2));
  bd.querySelector('[data-card="' + o2 + '"] [data-act]').click();
  await h.sleep(1500);
  check('★ 旧版后端：按一下仍然进「制作中」', laneOf(o2) === 'PREPARING', laneOf(o2));
  check('　前端确实补送了 startPreparing', h.calls.indexOf('startPreparing') !== -1);
  board.dom.window.close();

  /* ---------------- ③ 点餐台规格 ---------------- */
  console.log('\n[2] 点餐台：规格画得出来、加价算进去');
  const pos = await h.open('admin/pos.html', { storage: staffLocal, wait: 1500 });
  const pd = pos.doc;
  check('商品格画得出来', pd.querySelectorAll('[data-product]').length >= 2);
  pd.querySelector('[data-product="' + s.P2 + '"]').click();
  await h.sleep(200);
  const orows = pd.querySelectorAll('#optionBody .option-row');
  check('★ 规格选项画得出来（以前是 0 列 → 选规格失效）', orows.length === 2, orows.length);
  check('★ 规格群组标题在（SIZE）', /SIZE/.test(pd.getElementById('optionBody').textContent));
  check('★ 这一杯含规格加价 RM 22.00', /22\.00/.test(pd.getElementById('optPrice').textContent),
    pd.getElementById('optPrice').textContent);
  orows[0].click();
  await h.sleep(80);
  pd.getElementById('optAddBtn').click();
  await h.sleep(150);
  check('★ 加价算进这张单（1 杯 1800 + 400 = 2200）',
    pos.win.ADMIN_POS.debugState().linesTotal === 2200, pos.win.ADMIN_POS.debugState().linesTotal);
  pos.dom.window.close();

  /* ---------------- ④ 顾客选规格 ---------------- */
  console.log('\n[3] 顾客：酒单选规格 → 金额跟着变 → 加入购物车带规格');
  const custLocal = {
    yt_customer_token: s.CUST,
    yt_customer_profile: JSON.stringify(s.member.customer)
  };
  const menu = await h.open('menu.html', { storage: custLocal, wait: 1500 });
  const md = menu.doc;
  md.querySelector('[data-id="' + s.P2 + '"]').click();
  await h.sleep(250);
  const crows = md.querySelectorAll('#sheetBody .option-row');
  check('★ 规格抽屉画得出 2 个规格', crows.length === 2, crows.length);
  check('加入按钮金额含规格加价 RM 22.00',
    /22\.00/.test(md.getElementById('sheetAddBtn').textContent), md.getElementById('sheetAddBtn').textContent.trim());
  crows[1].click();
  await h.sleep(120);
  check('★ 换成「标准」→ 金额变 RM 18.00', /18\.00/.test(md.getElementById('sheetAddBtn').textContent),
    md.getElementById('sheetAddBtn').textContent.trim());
  crows[0].click();
  await h.sleep(120);
  md.getElementById('sheetAddBtn').click();
  await h.sleep(200);
  const lines = menu.win.CART.items();
  check('★ 购物车那一行带着刚选的规格（大杯）',
    lines.length === 1 && lines[0].options[0].optionId === s.OPT && lines[0].unitPrice === 2200,
    JSON.stringify(lines[0] || null).slice(0, 100));

  /* ---------------- ⑤ 结帐小抽屉 ---------------- */
  console.log('\n[4] 结帐：小抽屉 + 报价预载（不用等）');
  await h.sleep(800);                  // 等预载报价算完（加购后 400ms 才发）
  const cartLocal = Object.assign({}, h.snapshotStorage(menu.win));
  /* 同一个分页（sessionStorage）会把预载的报价带过去 —— 跟真的换页一样 */
  const memo = menu.win.sessionStorage.getItem('yt_quote_memo_v1');
  check('加购后酒单页已经把报价预载好（sessionStorage）', !!memo);
  menu.dom.window.close();

  h.delays.write = 2000;                 // 后端慢：120ms 内不可能算得完
  const cart = await h.open('cart.html', {
    storage: cartLocal, session: memo ? [['yt_quote_memo_v1', memo]] : [], wait: 900
  });
  const cd = cart.doc;
  h.calls.length = 0;
  cd.getElementById('checkoutBtn').click();
  await h.sleep(120);
  check('★ 打开抽屉 120ms 内就有金额（用预载的报价）',
    /22\.00/.test(cd.getElementById('checkoutBody').textContent),
    cd.getElementById('checkoutBody').textContent.slice(0, 40));
  check('★ 这 120ms 内没有再问后端要报价', h.calls.indexOf('createCheckoutQuote') === -1, h.calls.join(','));
  h.delays.write = 0;
  check('抽屉是小抽屉（CSS 限高 56vh）',
    /#checkoutSheet \.sheet-inner \{[^}]*max-height: 56vh/.test(
      require('fs').readFileSync(H.REPO + '/css/app.css', 'utf8')));

  /* 旧报价不会变成订单 */
  const lineId = cart.win.CART.items()[0].lineId;
  cart.win.CART.setQuantity(lineId, 3);
  h.calls.length = 0;
  cd.getElementById('placeOrderBtn').click();
  await h.sleep(150);
  check('★ 购物车变了 → 旧报价不会送出去（没有 placeOrder）', h.calls.indexOf('placeOrder') === -1, h.calls.join(','));
  check('　改成先重新算价', h.calls.indexOf('createCheckoutQuote') !== -1, h.calls.join(','));
  cart.dom.window.close();

  /* ---------------- ⑥ 菜单管理小抽屉 ---------------- */
  console.log('\n[5] 员工菜单管理：新增 / 编辑都是小抽屉，按了有反应');
  const mm = await h.open('admin/menu.html', { storage: staffLocal, wait: 1500 });
  const md2 = mm.doc;
  check('列表画得出来', md2.querySelectorAll('[data-row]').length >= 2);
  check('一开始没有开着抽屉', md2.getElementById('menuSheet').style.display === 'none');
  md2.querySelector('[data-row="' + s.P2 + '"] [data-edit]').click();
  await h.sleep(200);
  check('★ 按「编辑」→ 小抽屉滑上来', md2.getElementById('menuSheet').style.display !== 'none');
  check('抽屉标题带出商品名', /莫吉托/.test(md2.getElementById('sheetFormTitle').textContent),
    md2.getElementById('sheetFormTitle').textContent);
  check('保存按钮在抽屉底部（固定按得到）', !!md2.querySelector('#menuSheetFoot #saveProductBtn'));
  md2.getElementById('menuSheetClose').click();
  await h.sleep(150);
  const before = md2.querySelectorAll('[data-row]').length;
  md2.getElementById('addProductBtn').click();
  await h.sleep(200);
  md2.getElementById('fNameEN').value = 'Espresso Martini';
  md2.getElementById('fNameZH').value = '浓缩马天尼';
  md2.getElementById('fPrice').value = '28.00';
  md2.getElementById('saveProductBtn').click();
  await h.sleep(700);
  check('★ 新增商品真的建立（后端多一笔）', md2.querySelectorAll('[data-row]').length === before + 1,
    md2.querySelectorAll('[data-row]').length + ' vs ' + before);
  check('★ 存完抽屉自动关上', md2.getElementById('menuSheet').style.display === 'none');
  mm.dom.window.close();

  /* ---------------- ⑦ 顾客取餐状态刷新间隔 ---------------- */
  console.log('\n[6] 顾客的取餐状态：3 秒刷新');
  const orderPage = await h.open('order.html?id=' + o2, { storage: custLocal, wait: 1200 });
  const od = orderPage.win.ORDER.debugState();
  check('★ 每 3 秒刷新（以前 12 秒）', od.pollSeconds === 3, od.pollSeconds);
  check('画面上是「制作中」、没有「已确认」',
    /制作中/.test(orderPage.doc.getElementById('orderBody').textContent) &&
    !/已确认/.test(orderPage.doc.getElementById('orderBody').textContent));
  orderPage.dom.window.close();

  const ok = h.done();
  process.exit(ok ? 0 : 1);
})().catch(function (e) { console.error(e); process.exit(1); });
