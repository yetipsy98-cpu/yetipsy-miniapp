/* =============================================================
   demo/test-copypaste.js
   -------------------------------------------------------------
   验证 APPS-SCRIPT-COPY-PASTE.md（顾客拿去贴进 Apps Script 的档案）：

   01 · 区块数与顺序对、每一段内容跟 apps-script/*.gs 一模一样、
        标示的 SHA-256 跟内容对得上
   02 · ★ 把「文件里的那些字」直接丢进 Node 执行（不是读 .gs 档），
        走完整流程：setupDatabase → 查号码 → 注册 → 密码错 → 密码对
        → 改密码 → 员工重设密码
   03 · 文件里的数字（档案数 / 分页数 / 版本）跟实作一致
   04 · DEPLOYMENT.md 那张粘贴顺序表跟 FILE_ORDER 逐项一致
        （老板手动部署唯一照着抄的清单，漏一个档案 = 部署静默出错）
   05 · ★ 用「文件里的字」跑 upgradeToV2()：既有老板唯一的升级路径，
        从 1.x 线上状态一路升到 2.0，并逐格确认会员资料没被动过

   为什么要有：这份文件是手动部署的唯一依据。如果它跟 repo 里的
   .gs 不同步，顾客贴上去的就是旧后端 —— 跟 Service Worker 快取
   那次是同一类问题，所以直接在 CI 里挡住。

   执行： node demo/test-copypaste.js
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Suite } = require('./harness');
const { createShim } = require('./google-shim');
const { FILE_ORDER } = require('./load-backend');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'APPS-SCRIPT-COPY-PASTE.md');

const suite = new Suite('YETIPSY · 复制贴上文件校验（APPS-SCRIPT-COPY-PASTE.md）');

function read(p) { return fs.readFileSync(p, 'utf8'); }

function sha16(s) {
  return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/* 把 markdown 里的代码区块抓出来（数量以 FILE_ORDER 为准） */
function extractBlocks(doc) {
  const re = /## (\d+)\. (\S+\.gs)\n([\s\S]*?)```javascript\n([\s\S]*?)\n```/g;
  const out = [];
  let m;
  while ((m = re.exec(doc))) {
    out.push({ index: parseInt(m[1], 10), file: m[2], head: m[3], body: m[4] });
  }
  return out;
}

/* 跟 demo/load-backend.js 的 backendSource() 完全一样的拼法 */
function joinLikeBackend(blocks) {
  return blocks
    .map((b) => '/* ---- ' + b.file + ' ---- */\n' + b.body + '\n')
    .join('\n;\n');
}

suite.group('01 · 文件内容跟 apps-script/*.gs 完全一致', (t) => {
  t.check('APPS-SCRIPT-COPY-PASTE.md 存在', fs.existsSync(DOC));
  const doc = read(DOC);
  const blocks = extractBlocks(doc);
  global.__blocks = blocks;

  /* 档案数跟着 FILE_ORDER 走，不要写死（2.0 加了 Menu.gs） */
  t.check('抓到 ' + FILE_ORDER.length + ' 个代码区块',
    blocks.length === FILE_ORDER.length, blocks.length);
  t.check('区块顺序 = demo/load-backend.js 的 FILE_ORDER',
    JSON.stringify(blocks.map((b) => b.file)) === JSON.stringify(FILE_ORDER));

  blocks.forEach((b) => {
    const src = read(path.join(ROOT, 'apps-script', b.file)).replace(/\n+$/, '');
    t.check(b.file + ' 内容一致', src === b.body,
      src === b.body ? sha16(b.body) : '原始 ' + sha16(src) + ' vs 文件 ' + sha16(b.body));
    const listed = (b.head.match(/SHA-256 `([0-9a-f]{16})`/) || [])[1];
    t.check(b.file + ' 标示的 hash 正确', listed === sha16(b.body), listed);
  });
});

suite.group('02 · ★ 用文件里的字真的跑一次（不是读 .gs 档）', (t) => {
  const blocks = global.__blocks;
  const shim = createShim({});
  const sandbox = Object.assign({ console: console }, shim.globals);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(joinLikeBackend(blocks), sandbox, { filename: 'copy-paste.gs' });

  const doPost = (payload) => JSON.parse(
    sandbox.doPost({ postData: { contents: JSON.stringify(payload), type: 'text/plain' } })
      .getContent());

  sandbox.setupDatabase();
  sandbox.bootstrapOwner('owner', 'yetipsy123');   // 顾客部署后要跑的第二支
  const sheets = shim.spreadsheet.getSheets().map((sh) => sh.getName());
  /* 分页数直接对照 Config.gs 的 SCHEMA，避免这里写死数字跟实作脱节 */
  const expectedSheets = Object.keys(sandbox.SCHEMA).map((k) => sandbox.SCHEMA[k].sheet);
  t.check('setupDatabase() 建出的分页跟 SCHEMA 一样（' + expectedSheets.length + ' 个）',
    sheets.length === expectedSheets.length, sheets.join(', '));
  expectedSheets.forEach((name) => {
    t.check('有「' + name + '」分页', sheets.indexOf(name) >= 0);
  });
  t.check('没有 OtpCodes 分页', sheets.indexOf('OtpCodes') === -1);
  /* 2.0 的 5 张表也要在（§59 / §71） */
  ['Categories', 'Products', 'ProductOptions', 'AppOrders', 'OrderItems'].forEach((name) => {
    t.check('2.0 有「' + name + '」分页', sheets.indexOf(name) >= 0);
  });

  const PWD = 'copy-paste-123';

  /* ① 号码没注册 → exists=false */
  const check1 = doPost({ action: 'checkCustomerPhone', data: { phone: '0123456789' }, token: '' });
  t.check('查号码成功', check1.success === true, JSON.stringify(check1.error));
  t.check('还没注册 → exists=false', check1.data.exists === false);

  /* ② 注册 */
  const reg = doPost({ action: 'customerRegister',
    data: { phone: '0123456789', name: 'Jason', password: PWD }, token: '' });
  t.check('注册成功', reg.success === true, JSON.stringify(reg.error));
  t.check('CustomerID = YT000001', reg.data.customer.customerId === 'YT000001',
    reg.data && reg.data.customer.customerId);

  /* ③ 同一个号码换写法 → exists=true */
  const check2 = doPost({ action: 'checkCustomerPhone', data: { phone: '+60 12-345 6789' }, token: '' });
  t.check('同一个号码 → exists=true', check2.data.exists === true);
  t.check('遮罩名字 = J***', check2.data.displayName === 'J***', check2.data.displayName);

  /* ④ 重复注册被挡 */
  const dup = doPost({ action: 'customerRegister',
    data: { phone: '60123456789', password: 'another-pass' }, token: '' });
  t.check('同一个号码不能注册第二次',
    dup.success === false && dup.error.code === 'PHONE_ALREADY_REGISTERED',
    JSON.stringify(dup.error));

  /* ⑤ 密码错 / 密码对 */
  const bad = doPost({ action: 'customerLogin',
    data: { phone: '0123456789', password: 'wrong-pass-1' }, token: '' });
  t.check('密码错 → WRONG_PASSWORD',
    bad.success === false && bad.error.code === 'WRONG_PASSWORD', JSON.stringify(bad.error));

  const good = doPost({ action: 'customerLogin',
    data: { phone: '0123456789', password: PWD }, token: '' });
  t.check('密码对 → 登入成功', good.success === true, JSON.stringify(good.error));
  const token = good.data.token;
  t.check('拿到 session token', typeof token === 'string' && token.length > 20);

  /* ⑥ 没注册的号码不会被偷偷建帐号 */
  const ghost = doPost({ action: 'customerLogin',
    data: { phone: '0198765432', password: PWD }, token: '' });
  t.check('没注册 → CUSTOMER_NOT_FOUND',
    ghost.success === false && ghost.error.code === 'CUSTOMER_NOT_FOUND',
    JSON.stringify(ghost.error));

  /* ⑦ 会员自己改密码 */
  const NEWPWD = 'brand-new-456';
  const chg = doPost({ action: 'changeCustomerPassword',
    data: { currentPassword: PWD, newPassword: NEWPWD }, token: token });
  t.check('改密码成功', chg.success === true, JSON.stringify(chg.error));
  const after = doPost({ action: 'customerLogin',
    data: { phone: '0123456789', password: NEWPWD }, token: '' });
  t.check('新密码可以登入', after.success === true, JSON.stringify(after.error));

  /* ⑧ 员工重设密码 */
  const staff = doPost({ action: 'staffLogin',
    data: { username: 'owner', password: 'yetipsy123' }, token: '' });
  t.check('员工登入成功', staff.success === true, JSON.stringify(staff.error));
  const reset = doPost({ action: 'resetCustomerPassword',
    data: { customerId: 'YT000001', password: 'staff-set-789' }, token: staff.data.token });
  t.check('员工重设会员密码成功', reset.success === true, JSON.stringify(reset.error));
  const afterReset = doPost({ action: 'customerLogin',
    data: { phone: '0123456789', password: 'staff-set-789' }, token: '' });
  t.check('重设后的密码可以登入', afterReset.success === true, JSON.stringify(afterReset.error));

  /* ⑨ Sheet 里不能出现明文密码 */
  const rows = shim.spreadsheet.getSheetByName('Customers').getDataRange().getValues();
  const flat = JSON.stringify(rows);
  t.check('Customers 表看不到明文密码',
    flat.indexOf(PWD) === -1 && flat.indexOf(NEWPWD) === -1 && flat.indexOf('staff-set-789') === -1);
  t.check('Customers 表有 Salt / PasswordHash 栏',
    rows[0].indexOf('Salt') !== -1 && rows[0].indexOf('PasswordHash') !== -1);
});

suite.group('03 · 文件里的说明跟实作一致', (t) => {
  const doc = read(DOC);
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  const cfg = read(path.join(ROOT, 'apps-script', 'Config.gs'));

  t.check('档案数写 ' + FILE_ORDER.length,
    doc.indexOf('**' + FILE_ORDER.length + ' 个档案') !== -1);
  t.check('版本号跟 package.json 一致',
    doc.indexOf('版本 ' + pkg.version) !== -1, pkg.version);
  /* group 02 的 sandbox 不在这里的作用域；上面已经读过 cfg（Config.gs 原文），
     直接在新的 vm context 里执行它拿 SCHEMA */
  const schemaBox = {};
  vm.createContext(schemaBox);
  vm.runInContext(cfg, schemaBox, { filename: 'Config.gs' });
  const sheetCount = Object.keys(schemaBox.SCHEMA).length;
  t.check('分页数写 ' + sheetCount + '（跟 Config.gs 的 SCHEMA 一样）',
    doc.indexOf('**' + sheetCount + ' 个分页**') !== -1);
  t.check('说明里有 upgradeToV2()（§67 升级路径）',
    doc.indexOf('upgradeToV2({ backup: true })') !== -1);
  t.check('说明里有 reportUpgradeStatus()',
    doc.indexOf('reportUpgradeStatus()') !== -1);
  t.check('标明不用 WhatsApp OTP', doc.indexOf('不用 WhatsApp OTP') !== -1);
  t.check('列出 4 个密码设定', ['CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES', 'PASSWORD_SELFSERVICE_SETUP'].every((k) => doc.indexOf(k) !== -1));
  t.check('这些设定在 Config.gs 里真的有', ['CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES', 'PASSWORD_SELFSERVICE_SETUP'].every((k) => cfg.indexOf(k) !== -1));
  t.check('没有残留 OTP 说明',
    doc.indexOf('OTP_ENABLED') === -1 && doc.indexOf('WHATSAPP_TOKEN') === -1);
});

/* =============================================================
   04 · DEPLOYMENT.md 的粘贴顺序表 == FILE_ORDER
   -------------------------------------------------------------
   为什么要有：老板是**手动复制粘贴**部署的，而 DEPLOYMENT.md 那张
   双栏表格（1..20）就是他实际照抄的东西。它跟 apps-script/*.gs 是
   两份独立维护的清单 —— 以后新增第 21 个 .gs、更新了 FILE_ORDER
   并重新生成 APPS-SCRIPT-COPY-PASTE.md，这张表却会静默停在 20 个。

   后果不是测试红，是**部署静默少一个档案**，而文档自己就写着
   「20 个档案全部贴完再继续，少一个系统会出错」。所以在这里挡住。
   ============================================================= */

suite.group('04 · DEPLOYMENT.md 的粘贴顺序表跟实作一致', (t) => {
  const dep = read(path.join(ROOT, 'DEPLOYMENT.md'));

  /* 那张表是双栏的：| 1 | `Config` | 11 | `Menu` ★2.0 |
     两栏都要抓，只抓左栏会漏掉一半。 */
  const rows = dep.match(
    /^\|\s*(\d+)\s*\|\s*`([^`]+)`[^\|]*\|\s*(\d+)\s*\|\s*`([^`]+)`[^\|]*\|\s*$/gm) || [];
  const byNum = {};
  rows.forEach((line) => {
    const m = line.match(
      /^\|\s*(\d+)\s*\|\s*`([^`]+)`[^\|]*\|\s*(\d+)\s*\|\s*`([^`]+)`[^\|]*\|\s*$/);
    if (m) {
      byNum[Number(m[1])] = m[2];
      byNum[Number(m[3])] = m[4];
    }
  });
  const nums = Object.keys(byNum).map(Number).sort((a, b) => a - b);
  const depOrder = nums.map((n) => byNum[n] + '.gs');

  t.equal('★ 表格抓到 ' + FILE_ORDER.length + ' 个档案', depOrder.length, FILE_ORDER.length);
  t.check('★ 编号连续且从 1 开始',
    JSON.stringify(nums) === JSON.stringify(FILE_ORDER.map((_, i) => i + 1)),
    nums.join(','));
  t.equal('★ 粘贴顺序 == FILE_ORDER（老板照这个顺序贴）',
    JSON.stringify(depOrder), JSON.stringify(FILE_ORDER));

  /* 逐个点名，失败时直接讲得出是第几个、差在哪 */
  FILE_ORDER.forEach((f, i) => {
    t.equal('  第 ' + (i + 1) + ' 个是 ' + f.replace('.gs', ''), depOrder[i], f);
  });

  /* 表里的名称不该带 .gs（Apps Script 建档时输入 .gs 会变成 Code.gs.gs） */
  const withExt = Object.keys(byNum).filter((n) => /\.gs$/.test(byNum[n]));
  t.equal('★ 表格里的档案名不带 .gs 副档名', withExt.length, 0,
    withExt.map((n) => byNum[n]).join(','));

  /* 提醒删掉预设 Code.gs 的说明要在（少这句，贴完会有两个 Code.gs） */
  t.check('有「先删掉预设 Code.gs」的说明',
    /先把预设的\s*`Code\.gs`/.test(dep));
  t.check('有「少一个系统会出错」的警告', dep.indexOf('少一个系统会出错') !== -1);

  /* -------------------------------------------------------------
     ★ 末尾「完成检查表」里的数字也要跟实作一致。
     为什么：那张表是老板部署完最后勾掉的东西，数字对不上会被读成
     「部署失败」而回去重装 —— 而重装（重跑 setupDatabase）正是会
     清掉会员资料的那个动作。

     注意 group 03 检查的分页数读的是 APPS-SCRIPT-COPY-PASTE.md
     （DOC 常量），**不看这份 DEPLOYMENT.md**，所以这里要单独挡。
     ------------------------------------------------------------- */
  const schemaBox2 = {};
  vm.createContext(schemaBox2);
  vm.runInContext(read(path.join(ROOT, 'apps-script', 'Config.gs')), schemaBox2,
    { filename: 'Config.gs' });
  const realSheets = Object.keys(schemaBox2.SCHEMA).length;

  t.check('★ 检查表写的分页数 == Config.gs SCHEMA（' + realSheets + '）',
    dep.indexOf('出现 **' + realSheets + ' 个分页**') !== -1,
    '找「出现 **' + realSheets + ' 个分页**」');
  t.check('★ 检查表写的 .gs 档案数 == FILE_ORDER（' + FILE_ORDER.length + '）',
    dep.indexOf('- [ ] ' + FILE_ORDER.length + ' 个 `.gs` 档案都到位') !== -1);
  /* 升级路径的分页数：1.x 是 12，升级后应等于 SCHEMA */
  t.check('★ 升级检查表讲明 12 → ' + realSheets + ' 张',
    dep.indexOf('从 12 个分页变成 **' + realSheets + ' 个**') !== -1);

  /* ★ 升级路径绝不能叫老板跑 setupDatabase —— 那会重写表头、删多出来的栏 */
  const upgradeSection = dep.slice(dep.indexOf('**从 1.x 升级'));
  t.check('★ 升级检查表明确写「没有跑 setupDatabase()」',
    upgradeSection.indexOf('**没有**跑 `setupDatabase()`') !== -1);
  t.check('★ 升级检查表要求跑 upgradeToV2({ backup: true })',
    upgradeSection.indexOf('upgradeToV2({ backup: true })') !== -1);
  t.check('★ 升级检查表要求确认 dataIntact: true',
    upgradeSection.indexOf('dataIntact: true') !== -1);
  t.check('★ 升级检查表要求确认既有会员资料没掉',
    upgradeSection.indexOf('一笔都没掉') !== -1);

  /* 页脚版本不该停在旧版（这份 .md 不在 smoke-ui 的 PRODUCTION_PAGES 里，
     所以没人挡过它 —— 之前就一直写着 1.2） */
  const pkg2 = JSON.parse(read(path.join(ROOT, 'package.json')));
  const short2 = pkg2.version.split('.').slice(0, 2).join('.');
  const foot = dep.match(/YETIPSY MINI APP ([0-9]+\.[0-9]+) ·/);
  t.check('★ DEPLOYMENT.md 页脚版本跟 package.json 一致',
    !!foot && foot[1] === short2, foot ? foot[1] : '(找不到页脚)');
});

/* =============================================================
   05 · ★ 用「文件里的字」跑 upgradeToV2()（既有老板唯一的升级路径）
   -------------------------------------------------------------
   为什么要有：老板是手动粘贴部署的。group 02 已经证明粘贴档里的字
   能跑 setupDatabase → 注册 → 登入，但 upgradeToV2() 之前**只在
   test-upgrade.js 里跑过，而那个测试读的是 apps-script/*.gs**，
   不是这份粘贴档。也就是说：老板真正会执行的那份 upgradeToV2()
   代码，一次都没被跑过。

   这条路径的代价是老板的真实会员资料 —— §67 的硬规则是
   「绝不能删除既有会员资料」，跑错成 setupDatabase() 就会清掉。
   所以这里用粘贴档的字，从「1.x 线上、还没升级」的状态一路跑到
   升级完成，并且逐格确认会员资料没被动过。
   ============================================================= */

suite.group('05 · ★ 粘贴档里的 upgradeToV2() 真的能升级且不删资料', (t) => {
  const V2_SHEETS = ['Categories', 'Products', 'ProductOptions', 'AppOrders', 'OrderItems'];
  const V2_SETTINGS = ['ORDERING_ENABLED', 'ORDERING_PAUSED', 'ORDERING_OPEN_TIME',
    'ORDERING_CLOSE_TIME', 'ALLOW_PICKUP', 'ALLOW_TABLE_ORDER', 'MAX_ORDER_ITEMS',
    'VISIT_SESSION_HOURS', 'ORDER_POLL_SECONDS', 'CUSTOMER_ORDER_POLL_SECONDS',
    'CHECKOUT_QUOTE_EXPIRY_MINUTES', 'MENU_CACHE_SECONDS'];
  const V2_SEQUENCES = ['category', 'product', 'option', 'apporder', 'orderitem', 'ordernum'];

  const shim = createShim({});
  const sandbox = Object.assign({ console: console }, shim.globals);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(joinLikeBackend(global.__blocks), sandbox,
    { filename: 'copy-paste.gs' });
  const doPost = (payload) => JSON.parse(
    sandbox.doPost({ postData: { contents: JSON.stringify(payload), type: 'text/plain' } })
      .getContent());

  /* ① 先用粘贴档的字建一个「1.x 线上」的世界，塞进真实会员资料 */
  sandbox.setupDatabase();
  sandbox.bootstrapOwner('owner', 'yetipsy123');
  const reg = doPost({ action: 'customerRegister',
    data: { phone: '0123456789', name: 'Jason', password: 'test-pass-123' } });
  t.okIs(reg, '★ 用粘贴档的字注册会员');
  const cid = reg.data.customer.customerId;
  const own = doPost({ action: 'staffLogin',
    data: { username: 'owner', password: 'yetipsy123' } }).data.token;
  doPost({ action: 'manualPointAdjustment',
    data: { customerId: cid, points: 320, reason: 'upgrade' }, token: own });
  doPost({ action: 'manualWalletAdjustment',
    data: { customerId: cid, amount: 5000, reason: 'upgrade' }, token: own });

  /* ② 把 2.0 的东西剥掉，还原成「还没升级的 1.x 线上库」 */
  V2_SHEETS.forEach((n) => { delete shim.spreadsheet.sheets[n]; });
  const drop = (sheet, keys) => {
    if (sheet) sheet.rows = sheet.rows.filter((r, i) => i === 0 || keys.indexOf(String(r[0])) < 0);
  };
  drop(shim.spreadsheet.sheets.Settings, V2_SETTINGS);
  drop(shim.spreadsheet.sheets.Sequences, V2_SEQUENCES);
  const sheetsBefore = shim.spreadsheet.getSheets().length;
  t.equal('剥掉 V2 后剩 1.x 的分页数', sheetsBefore, 12, 
    shim.spreadsheet.getSheets().map((s) => s.getName()).join(','));

  /* 升级前的会员资料快照（逐格比对用） */
  const custBefore = JSON.parse(JSON.stringify(shim.spreadsheet.sheets.Customers.rows));
  const profBefore = doPost({ action: 'getProfile', data: {}, token: reg.data.token });
  t.okIs(profBefore, '★ 升级前读得到会员资料');
  t.equal('升级前积分 320', profBefore.data.customer.currentPoints, 320);
  t.equal('升级前钱包 5000', profBefore.data.customer.walletBalance, 5000);

  /* ③ ★ 跑粘贴档里的 upgradeToV2() */
  const res = sandbox.upgradeToV2({ backup: true });
  t.equal('★ upgradeToV2() 回传 success', res.success, true,
    res.error ? JSON.stringify(res.error) : '');
  const r = res.data;
  t.equal('★ 升级完成标记', r.upgraded, true);
  t.equal('★ 资料完整标记 dataIntact', r.dataIntact, true);
  t.equal('★ 没有问题回报', r.problems.length, 0, JSON.stringify(r.problems));
  t.equal('★ 新建 5 张 2.0 表', r.createdSheets.length, 5, JSON.stringify(r.createdSheets));
  V2_SHEETS.forEach((name) => {
    t.check('建了「' + name + '」', r.createdSheets.indexOf(name) >= 0);
    t.check('Sheet「' + name + '」真的存在', !!shim.spreadsheet.getSheetByName(name));
  });
  t.equal('升级后分页总数 = 12 + 5', shim.spreadsheet.getSheets().length, sheetsBefore + 5);

  /* ④ ★ 会员资料一格都不能变（§67 的核心承诺） */
  t.equal('★ Customers 表逐格没变',
    JSON.stringify(shim.spreadsheet.sheets.Customers.rows), JSON.stringify(custBefore));
  const profAfter = doPost({ action: 'getProfile', data: {}, token: reg.data.token });
  t.okIs(profAfter, '★ 升级后仍读得到会员资料');
  t.equal('★ 升级后积分还是 320', profAfter.data.customer.currentPoints, 320);
  t.equal('★ 升级后钱包还是 5000', profAfter.data.customer.walletBalance, 5000);
  t.equal('★ CustomerID 没变', profAfter.data.customer.customerId, cid);
  ['Customers', 'Orders', 'Claims', 'PointTx', 'WalletTx'].forEach((name) => {
    t.equal('★ rowCounts[' + name + '] 前后一致',
      r.rowCounts[name].after, r.rowCounts[name].before);
  });

  /* ⑤ 幂等：老板手滑跑第二次不能出事、不能重复建表 */
  const again = sandbox.upgradeToV2({ backup: true });
  t.equal('★ 重跑也回 success', again.success, true);
  t.equal('★ 重跑没有重复建表', again.data.createdSheets.length, 0,
    JSON.stringify(again.data.createdSheets));
  t.equal('★ 重跑后分页总数不变',
    shim.spreadsheet.getSheets().length, sheetsBefore + 5);
  t.equal('★ 重跑后资料仍完整', again.data.dataIntact, true);

  /* ⑥ 升级后 1.x 会员流程照常（§85），2.0 酒单也读得到 */
  const login = doPost({ action: 'customerLogin',
    data: { phone: '0123456789', password: 'test-pass-123' } });
  t.okIs(login, '★ 升级后旧密码仍能登入');
  const menu = doPost({ action: 'getMenu', data: {}, token: login.data.token });
  t.okIs(menu, '★ 升级后 2.0 酒单可读（getMenu）');
  t.check('★ 2.0 酒单回传商品阵列', Array.isArray(menu.data.products),
    typeof menu.data.products);
});

/* harness 的 run() 回传的是 boolean：true = 全过 */
suite.run().then((pass) => process.exit(pass ? 0 : 1));
