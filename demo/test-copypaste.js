/* =============================================================
   demo/test-copypaste.js
   -------------------------------------------------------------
   验证 APPS-SCRIPT-COPY-PASTE.md（顾客拿去贴进 Apps Script 的档案）：

   01 · 15 个区块、顺序对、每一段内容跟 apps-script/*.gs 一模一样、
        标示的 SHA-256 跟内容对得上
   02 · ★ 把「文件里的那些字」直接丢进 Node 执行（不是读 .gs 档），
        走完整流程：setupDatabase → 查号码 → 注册 → 密码错 → 密码对
        → 改密码 → 员工重设密码
   03 · 文件里的数字（档案数 / 分页数 / 版本）跟实作一致

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

/* 把 markdown 里的 15 个代码区块抓出来 */
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

  t.check('抓到 15 个代码区块', blocks.length === 15, blocks.length);
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
  t.check('setupDatabase() 建出 12 个分页', sheets.length === 12, sheets.join(', '));
  t.check('没有 OtpCodes 分页', sheets.indexOf('OtpCodes') === -1);

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

  t.check('档案数写 15', doc.indexOf('**15 个档案') !== -1);
  t.check('版本号跟 package.json 一致',
    doc.indexOf('版本 ' + pkg.version) !== -1, pkg.version);
  t.check('分页数写 12（跟 Config.gs 的 SHEETS 一样）',
    doc.indexOf('**12 个分页**') !== -1);
  t.check('标明不用 WhatsApp OTP', doc.indexOf('不用 WhatsApp OTP') !== -1);
  t.check('列出 4 个密码设定', ['CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES', 'PASSWORD_SELFSERVICE_SETUP'].every((k) => doc.indexOf(k) !== -1));
  t.check('这些设定在 Config.gs 里真的有', ['CUSTOMER_PASSWORD_MIN', 'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES', 'PASSWORD_SELFSERVICE_SETUP'].every((k) => cfg.indexOf(k) !== -1));
  t.check('没有残留 OTP 说明',
    doc.indexOf('OTP_ENABLED') === -1 && doc.indexOf('WHATSAPP_TOKEN') === -1);
});

/* harness 的 run() 回传的是 boolean：true = 全过 */
suite.run().then((pass) => process.exit(pass ? 0 : 1));
