/* =============================================================
   demo/build-copypaste.js
   -------------------------------------------------------------
   把 apps-script/*.gs 整合成 APPS-SCRIPT-COPY-PASTE.md
   （手动部署用：打开 Apps Script → 建 15 个档案 → 复制贴上）。

   执行： node demo/build-copypaste.js     （或 npm run build:copypaste）

   改完任何 .gs 之后都要重跑一次；demo/test-copypaste.js 会检查
   这份文件跟 .gs 是否同步，不同步 CI 会红。
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILE_ORDER, loadBackend } = require('./load-backend');

/* 分页清单从 Config.gs 的 SCHEMA 直接读出来，避免文件里的数字跟实作脱节 */
const { sandbox: CFG } = loadBackend();
const SHEET_NAMES = Object.keys(CFG.SCHEMA).map((k) => CFG.SCHEMA[k].sheet);
const SHEET_COUNT = SHEET_NAMES.length;
const SHEET_LIST = SHEET_NAMES.map((n) => '`' + n + '`').join(' ');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'APPS-SCRIPT-COPY-PASTE.md');

const DESC = {
  'Config.gs': '所有设定与 ' + SHEET_COUNT + ' 张表的栏位定义（要改规则就改这里）',
  'Utils.gs': '公用工具：E.164 电话正规化、错误码、日期、JSON 回应',
  'Database.gs': 'setupDatabase()、upgradeToV2()、补栏位、防重复注册工具、dedupeCustomers()',
  'Security.gs': 'Session Token、权限（STAFF/MANAGER/OWNER）、Rate Limit、登入锁定',
  'Audit.gs': 'Audit Log 写入与查询（最多保留 5000 条）',
  'Points.gs': '积分累计 / 等级门槛计算',
  'Rewards.gs': '奖励产生与状态流转',
  'Wallet.gs': '钱包储值 / 抵扣 / 上限（金额一律 sen）',
  'Customers.gs': '★ 查号码 / 注册 / 密码登录 / 改密码 / 会员资料',
  'Orders.gs': '消费纪录与统计',
  'Menu.gs': '★ 2.0 酒单：分类 / 商品 / 规格、促销价、售罄、菜单缓存（upgradeToV2() 后才用得到）',
  'Checkout.gs': '★ 2.0 结帐报价：后端重算价格、钱包上限、Quote 5 分钟有效期、防重复下单的识别码',
  'AppOrders.gs': '★ 2.0 订单：placeOrder（幂等）、订单查询、取消、再点一次、名称与单价快照',
  'Claims.gs': 'QR / 4 位 Code 认领（只存 token 的 hash）',
  'Promotions.gs': '优惠规则',
  'Admin.gs': '员工端：Dashboard、会员查询、手动调整、重设会员密码、设置',
  'Auth.gs': 'ping / getPublicSettings / staffLogin / staffLogout',
  'Code.gs': '★ 唯一入口 doPost()：action 白名单、参数解析、错误包装'
};

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const lines = (s) => s.replace(/\n+$/, '').split('\n').length;

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missingDesc = FILE_ORDER.filter((f) => !DESC[f]);
  if (missingDesc.length) throw new Error('缺少说明：' + missingDesc.join(', '));

  let total = 0;
  const rows = FILE_ORDER.map((f, i) => {
    const n = lines(read(f));
    total += n;
    return '| ' + (i + 1) + ' | `' + f.slice(0, -3) + '` | ' + n + ' | ' + DESC[f] + ' |';
  }).join('\n');

  const head = '# YETIPSY · Google Apps Script 全部档案（复制贴上用）\n\n' +
    '**' + FILE_ORDER.length + ' 个档案 · 版本 ' + pkg.version +
    ' · 会员登录 = 手机号码 + 密码（不用 WhatsApp OTP）**\n\n' +
    '> 这份文件由 `node demo/build-copypaste.js` 从 `apps-script/*.gs` 产生。\n' +
    '> 改了后端记得重跑，`npm test` 会检查两者是否同步。\n\n---\n\n' +
    '## 怎么用这个档案\n\n' +
    '1. 打开 <https://script.google.com>，建立（或打开）你的 Apps Script 专案。\n' +
    '2. 预设会有一个 `Code.gs` → 点它右边三个点 → **删除**（下面第 ' +
    FILE_ORDER.length + ' 个会取代它）。\n' +
    '3. 依照下表顺序新增 ' + FILE_ORDER.length + ' 个档案：点 **+ → 指令码（Script）**，\n' +
    '   输入名称时**不要**打 `.gs`（例如输入 `Config`，不是 `Config.gs`）。\n' +
    '4. 在下面的每一节里，复制那个代码框里的**全部内容**，贴到对应的档案里\n' +
    '   （档案里已经有内容的话，先 Ctrl+A 全选删掉再贴）。\n' +
    '5. 每个档案贴完按 **💾 储存**（Ctrl+S）。\n' +
    '6. 全部贴完 → 选 `Database` 档案 → 执行 `setupDatabase()`\n' +
    '   → 授权（进阶 → 前往专案 → 允许）→ 再执行一次 `bootstrapOwner()`。\n' +
    '7. 回 Google Sheet 看是否出现 **' + SHEET_COUNT + ' 个分页**：' + SHEET_LIST + '。\n' +
    '8. **已经在跑 1.x 的老板看这里**：不要重跑 `setupDatabase()`，\n' +
    '   改执行 `upgradeToV2({ backup: true })` —— 它只会补建 2.0 的 5 张表\n' +
    '   （`Categories` `Products` `ProductOptions` `AppOrders` `OrderItems`）\n' +
    '   和 12 个新设定，**既有会员 / 积分 / 钱包 / Claim 一列都不会动**。\n' +
    '   想看升级状态就执行 `reportUpgradeStatus()`。\n\n' +
    '| 顺序 | Apps Script 里的档案名 | 行数 | 内容 |\n|---|---|---|---|\n' + rows + '\n\n' +
    '> ⚠️ **' + FILE_ORDER.length + ' 个档案全部贴完再执行**，少一个会报 `xxx is not defined`。\n\n---\n';

  const body = FILE_ORDER.map((f, i) => {
    const src = read(f).replace(/\n+$/, '');
    return '\n## ' + (i + 1) + '. ' + f + '\n\n' +
      '> Apps Script 里的档案名称：**`' + f.slice(0, -3) + '`**（不要打 .gs）\n' +
      '> ' + DESC[f] + ' · ' + lines(src) + ' 行 · SHA-256 `' + sha16(src) + '`\n\n' +
      '```javascript\n' + src + '\n```\n\n---\n';
  }).join('');

  const tail = `
## 贴完之后

| 要做的事 | 怎么做 |
|---|---|
| 建立资料库 | 选 \`Database\` 档案 → 执行 \`setupDatabase()\`（可重复执行，不会清资料；少了栏位会自动补） |
| 建立老板帐号 | 执行 \`bootstrapOwner()\` → 用 \`owner\` / \`yetipsy123\` 登录员工端，**进去马上改密码** |
| 部署成 Web App | **部署 → 新增部署 → 网页应用程序** → 执行身分选「我」→ 存取权限「所有人」→ 复制 \`/exec\` 网址 |
| 前端接上 | 把那个 \`/exec\` 网址填进 repo 的 \`js/config.js\` 的 \`API_URL\`，push 到 GitHub |
| 检查有没有重复会员 | 执行 \`reportDuplicatePhones()\`（只看不改）→ 确认没问题再 \`dedupeCustomers(true)\`（预演）→ \`dedupeCustomers(false)\`（真的合并） |

### 会员登录规则（这版）

\`\`\`
① 输入手机号码 → checkCustomerPhone
      ├── 没重复 → ② 设密码注册（customerRegister）
      └── 重复了 → ③ 输入密码（customerLogin）
                     └ 旧会员还没设过密码 → 第一次设密码（customerSetFirstPassword）
\`\`\`

可调的设定（员工端 SETTINGS 或 \`Settings\` 分页）：

| Key | 预设 | 说明 |
|---|---|---|
| \`CUSTOMER_PASSWORD_MIN\` | \`8\` | 会员密码最少字符 |
| \`LOGIN_MAX_ATTEMPTS\` | \`6\` | 连续输错几次就锁定 |
| \`LOGIN_LOCK_MINUTES\` | \`5\` | 锁定几分钟 |
| \`PASSWORD_SELFSERVICE_SETUP\` | \`TRUE\` | 旧会员可否自己补设密码；**都补完后建议改 \`FALSE\`** |

- 密码存 Salted SHA-256（\`Customers\` 表的 \`Salt\` / \`PasswordHash\` 栏），Sheet 里看不到明文。
- 会员自己改密码：会员端 \`我的 → 登录密码\`。
- 会员忘记密码：员工端 \`MEMBERS → RESET PASSWORD\`（Manager / Owner）。

### 忘记贴了哪一个？

执行任何功能时报 \`ReferenceError: xxx is not defined\`，
\`xxx\` 就是少贴的那个档案里的函数名 —— 对照上面的表补上即可。
`;

  const doc = head + body + tail;
  fs.writeFileSync(OUT, doc, 'utf8');
  return { files: FILE_ORDER.length, lines: total, bytes: Buffer.byteLength(doc, 'utf8') };
}

if (require.main === module) {
  const r = build();
  console.log('已产生 APPS-SCRIPT-COPY-PASTE.md：' + r.files + ' 个档案 · ' +
    r.lines + ' 行 · ' + (r.bytes / 1024).toFixed(1) + ' KB');
}

module.exports = { build };
