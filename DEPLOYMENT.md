# YETIPSY MINI APP 1.1 — 部署教学（零基础版）

> 这份文件假设你 **完全不会写程式**。
> 只要照着做，每一步都做了什么都会说明。
> 全程 RM0。

预计时间：**约 30–45 分钟**

你需要：

- [ ] 一个 Google 账号
- [ ] 一个 GitHub 账号（免费）
- [ ] 一台电脑（Windows / Mac 都可以）

---

# 目录

- [PART A — 建立资料库（Google Sheet）](#part-a)
- [PART B — 建立后端（Google Apps Script）](#part-b)
- [PART C — 建立老板账号](#part-c)
- [PART D — 部署 Web App 并取得 API URL](#part-d)
- [PART E — 建立网站（GitHub Pages）](#part-e)
- [PART F — 连线（config.js）](#part-f)
- [PART G — 上线前测试清单](#part-g)
- [PART H — 日常使用与维护](#part-h)
- [PART I — 常见问题](#part-i)

---

<a name="part-a"></a>
# PART A — 建立资料库（Google Sheet）

## A1. 建立试算表

1. 打开 https://sheets.google.com
2. 左上角点 **+ 空白** 建立新的试算表
3. 上方名称改为：

```
YETIPSY MINI APP DATABASE
```

> 这张表就是你的资料库。
> 顾客资料、订单、积分、钱包、奖励全部会写在这里。
> **不要**手动改里面的内容，除非你知道自己在做什么。

---

<a name="part-b"></a>
# PART B — 建立后端（Google Apps Script）

## B1. 开启 Apps Script

1. 在刚才的 Google Sheet 里，点上方选单：
   **扩充功能（Extensions）→ Apps Script**
2. 会开启一个新分页，里面有一个 `Code.gs` 档案

## B2. 把后端程式码放进 Apps Script

后端程式码全部在这个 GitHub repo 的 **`apps-script/`** 资料夹（20 个 `.gs` 档案）。

> **已经在跑 1.x 的老板**：新增的 5 个档案（`Menu` `Checkout` `AppOrders`
> `OrderBoard` `Analytics`）是 2.0 点单用的，**照贴就好，不要动旧档案的内容**；
> 贴完之后请跳到 **PART B-2（升级到 2.0）**，**不要**再跑 `setupDatabase()`。
有两种方式，选一种就好：

### 方式一（推荐）：GitHub Actions 自动推送

程式码留在 GitHub，push 之后自动推到 Google Apps Script，不需要手动贴。
设定方法见 **[`apps-script/README.md`](apps-script/README.md)**，
设定完成后每次改后端只要 `git push`，1–2 分钟后线上就更新了。

### 方式二：手动贴（第一次部署、或不想设定 GitHub Secrets）

1. 先把预设的 `Code.gs` **删掉**（点 `Code.gs` 右边的三个点 → 删除）
2. 依照下表新增档案：点 **+ → 指令码（Script）**，输入名称（**不要**输入 `.gs`）

| 顺序 | 档案名称 | 顺序 | 档案名称 |
|---|---|---|---|
| 1 | `Config` | 11 | `Menu` ★2.0 |
| 2 | `Utils` | 12 | `Checkout` ★2.0 |
| 3 | `Database` | 13 | `AppOrders` ★2.0 |
| 4 | `Security` | 14 | `OrderBoard` ★2.0 |
| 5 | `Audit` | 15 | `Analytics` ★2.0 |
| 6 | `Points` | 16 | `Claims` |
| 7 | `Rewards` | 17 | `Promotions` |
| 8 | `Wallet` | 18 | `Admin` |
| 9 | `Customers` | 19 | `Auth` |
| 10 | `Orders` | 20 | `Code` |

3. 打开专案里的 `apps-script/` 资料夹，每个 `.gs` 档案：
   - 用记事本打开 → 全选复制（Ctrl+A → Ctrl+C）
   - 贴到 Apps Script 对应名称的档案里（覆盖原内容）
4. 每贴完一个档案按 **💾 储存**（Ctrl+S）

> ⚠️ 20 个档案全部贴完再继续，少一个系统会出错。
>
> 不想一个一个贴：repo 里的 **`APPS-SCRIPT-COPY-PASTE.md`** 已经把 20 个档案
> 依顺序整理成一份，每个档案一节，照着一节一节贴就好。

## B3. 建立资料库

1. 上方的功能列，找到函式下拉选单（原本显示 `doPost` 或某个函式名）
2. 选择 **`setupDatabase`**
3. 按 **执行（Run）**
4. 第一次会要求授权：
   - 点「审查权限」
   - 选择你的 Google 账号
   - 出现「这个应用程式未经 Google 验证」→ 点 **进阶（Advanced）**
     → 点 **前往「YETIPSY…」（不安全）**
   - 点 **允许（Allow）**
5. 等待执行完成（右下角会显示「执行完毕」）
6. 点上方 **执行项目（Executions）** 可以看到纪录
7. 点 **记录（Logs）** 会看到类似：

```
setupDatabase() done. created sheets: Settings, Sequences, Customers, ...
下一步：执行 bootstrapOwner("owner", "你的密码") 建立第一个老板账号。
```

> `setupDatabase()` 只建立资料表与预设设置，**不会**帮你建立账号，
> 也不会产生随机密码。老板账号在 PART C 用 `bootstrapOwner()` 建立。

## PART B-2 — 升级到 2.0（★ 已经在跑 1.x 的老板看这里）

如果你**已经有会员资料**（Customers / Wallet / Points 里已经有东西），
20 个档案贴完之后：

### ⚠️ 不要再跑 `setupDatabase()`

`setupDatabase()` 是给**全新**资料库用的。它会重写每张表的表头，
而且当某张表的实际栏位数比程式定义的多时，会**删掉多出来的栏**
（连同那一栏的资料）。

> 实测：在没有手动加过栏的资料库上重跑 `setupDatabase()`，会员 / 钱包 /
> Claim / 商品 / 设置都没有掉。但只要有人在 Sheet 上手动加过栏，
> 或改过表头，那些资料就会被删掉。所以升级一律走下面这个函式。

### ✅ 改跑 `upgradeToV2({ backup: true })`

1. 函式下拉选单选 **`upgradeToV2`** → 按 **执行（Run）**
   （第一次会要求授权，跟前面一样）
2. 或者用「临时函式」贴这段再执行，可以先做一份完整备份：

```javascript
function runUpgrade() {
  var result = upgradeToV2({ backup: true });
  Logger.log(JSON.stringify(result, null, 2));
}
```

3. 看 **记录（Logs）**。回传是 `{ success, data, error }`，
   重点在 `data` 里面（以下是实跑出来的真实形状）：

```json
{
  "success": true,
  "data": {
    "upgraded": true,
    "version": "2.0",
    "backup": { "ok": true },
    "createdSheets": ["Categories", "Products", "ProductOptions", "AppOrders", "OrderItems"],
    "skippedSheets": [],
    "addedSettings": ["ORDERING_ENABLED", "VISIT_SESSION_HOURS", "..."],
    "addedSequences": ["apporder", "orderitem", "ordernum"],
    "rowCounts": { "Customers": {"before": 128, "after": 128}, "...": "..." },
    "dataIntact": true,
    "problems": [],
    "ok": true
  }
}
```

- `createdSheets` = 这次**新建**的 2.0 表（1.x 资料库里应该正好是那 5 张）
- `skippedSheets` = 已经存在、**没有被动过**的表
- `addedSettings` = 这次补上的设置**名称清单**（是阵列，不是数字）
- `addedSequences` = 补上的 ID 序号（点单要用的 `apporder` / `orderitem` / `ordernum`）
- `rowCounts` = **每张表升级前后的列数**。`before` 跟 `after` 要一样
- **`dataIntact: true`** = 旧资料一行都没少（这是最重要的一个）
- 如果 `dataIntact: false`，`problems` 会列出哪张表的列数变少了 —— 先别继续用，
  把那份备份找回来再看
- `backup.ok` 要是 `false`，会附上原因并叫你先手动「档案 → 建立副本」

4. 再跑一次 **`reportUpgradeStatus()`** 确认（同样包在 `data` 里）：

```json
{ "success": true, "data": { "ready": true, "missingSheets": [], "missingSettings": [] } }
```

`ready: true` 且两个清单都是空的，才算升级完成。

> 重复执行是安全的：第二次跑会回 `createdSheets: []`、
> `addedSettings: []`、`dataIntact: true`，什么都不会变。

### `upgradeToV2()` 做了什么（§67）

- 整段在交易锁内跑，两个人同时按也不会打架
- 先备份整个 Google Sheet（`{ backup: true }`）
- 检测已存在的表，**只建立缺的那几张**
- **只补**缺的设置与 ID 序号，不覆盖你已经改过的值
- 不重写表头、不删栏、不动任何一列既有资料
- 可以重复执行：第二次跑会回 `createdSheets: []`，什么都不会变

> 会员的 Session、Claim Code、钱包余额、积分全部照旧有效（§68）。
> `/`、`claim.html`、`activity.html`、`wallet.html`、`profile.html`、
> `admin/login.html` 这些网址也照常运作。

### 升级后要做的两件事

1. **员工端**：`admin/index.html` 顶部多了 **ORDER BOARD**（点单看板），
   `admin/more.html` 多了菜单管理与业绩报表
2. **顾客端**：底部导航第三格从「记录」变成「订单」（§4）；
   「记录」改从首页快捷区进入

## B4. 确认资料库建立成功

回到 Google Sheet，下方应该会出现这 **12** 个分页：

```
Settings   Sequences  Customers  Staff     Sessions
Orders     Claims     Rewards    PointTx   WalletTx
Promotions AuditLogs
```

看到 12 个分页 = 资料库成功。

| 分页 | 内容 |
|---|---|
| `Customers` | 会员（`Phone` 是 E.164，例如 `+60123456789`，同一个号码只会有 **一列**；密码是 Salted SHA-256，看不到明文） |
| `Orders` | 每一笔已验证消费（金额一律 sen：RM86.00 = 8600） |
| `Claims` | QR / 4 位 Code（只存 token 的 hash） |
| `Rewards` | 奖励（后端产生） |
| `PointTx` / `WalletTx` | 积分与钱包的每一笔明细（可追溯） |
| `Settings` | 所有可调规则（积分比例、等级门槛、钱包上限…） |
| `AuditLogs` | 操作记录（最多保留 5000 条） |

---

<a name="part-c"></a>
# PART C — 建立账号

## C1. 建立老板账号（重要）

回到 Apps Script 编辑器，**在任何一个档案的最下面**临时加入这段：

```javascript
function makeMyOwner() {
  bootstrapOwner('owner', '这里改成你的密码');
}
```

然后：

1. 储存
2. 上方函式选单选择 **`makeMyOwner`** → 按 **执行**
3. 看到「执行完毕」后，**把这段程式删掉**（避免密码留在程式码里）

> - 密码至少 8 个字符，不要用 `123456`。
> - `bootstrapOwner()` 只在 `Staff` 分页还是空的时候能执行。
>   已经有老板账号之后它会直接拒绝，避免任何人从外部再建立一个老板。
> - 密码以 **Salted SHA-256** 储存，Sheet 里看不到明文，每个账号的 salt 不同。

## C2. 建立员工账号

老板账号建好之后，**不需要再写程式**：

1. 打开 `你的网址/admin/login.html`，用老板账号登录
2. 进 **MORE → STAFF ACCOUNTS**
3. 新增 `manager`（经理）与 `staff`（员工），各自设定密码
4. 忘记密码也可以在同一个页面重设

### 角色说明

| 角色 | 可以做 |
|---|---|
| STAFF | 建立 Claim、查找会员、钱包抵扣 |
| MANAGER | 上面全部 + 修改设置、调整积分/钱包、取消订单、看 Audit Log |
| OWNER | 上面全部 + 管理员工账号 |

---

<a name="part-d"></a>
# PART D — 部署 Web App（取得 API URL）

1. Apps Script 右上角，点 **部署（Deploy）→ 新增部署（New deployment）**
2. 点左上角的齿轮图示 ⚙️ → 选 **网页应用程式（Web app）**
3. 设定：

| 栏位 | 设定值 |
|---|---|
| 说明 | `Yetipsy API v1.1` |
| 执行身份（Execute as） | **我（Me）** |
| 谁可以存取（Who has access） | **所有人（Anyone）** |

4. 点 **部署（Deploy）**
5. 复制出现的 **网页应用程式 URL**

看起来像这样：

```
https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxx/exec
```

> ⚠️ 这个 URL 就是你的 API 地址，请存好。
>
> 「谁可以存取 = 所有人」是必要的，
> 因为顾客手机要能连线。安全性由 Session Token 与角色验证保证，
> 每一个 API 都会检查，不是靠隐藏网址。

---

<a name="part-e"></a>
# PART E — 建立网站（GitHub Pages）

## E1. 建立 Repository

1. 打开 https://github.com → 登入
2. 右上角 **+ → New repository**
3. 设定：

| 栏位 | 值 |
|---|---|
| Repository name | `yetipsy-miniapp` |
| 类型 | **Public**（才能用免费的 GitHub Pages） |
| 勾选 | ☑ Add a README file（可以不勾） |

4. 点 **Create repository**

## E2. 上传档案

1. 在 repository 页面点 **uploading an existing file**
   （或点 **Add file → Upload files**）
2. 把整个 `yetipsy-miniapp` 资料夹里的东西拖进去：

```
index.html  login.html  claim.html  reward.html  wallet.html
activity.html  profile.html  manifest.json  service-worker.js
css/  js/  admin/  assets/
```

> ⚠️ **不要**上传 `demo/` 和 `apps-script/`（那是后端与测试用的）
> 上传了也不会坏，但没必要。

3. 拉到最下面 → **Commit changes**

## E3. 开启 GitHub Pages

1. 点 repository 上方 **Settings**
2. 左边选 **Pages**
3. Source 选择 **Deploy from a branch**
4. Branch 选择 **main**，资料夹选 **/ (root)**
5. 点 **Save**
6. 等 1–3 分钟，会出现网址：

```
https://你的账号.github.io/yetipsy-miniapp/
```

这就是 **顾客与员工打开的系统网址**。

---

<a name="part-f"></a>
# PART F — 连线（config.js）

## F1. 修改 config.js

1. 在 GitHub repository 里，打开 `js/config.js`
2. 右上角点 **✏️（Edit this file）**
3. 找到这一行：

```javascript
  API_URL: '',
```

4. 改成（贴上你在 PART D 复制的 URL）：

```javascript
  API_URL: 'https://script.google.com/macros/s/AKfycbxxxxxxx/exec',
```

5. 拉到最下面 → **Commit changes**
6. 等 1–2 分钟让 GitHub Pages 更新

## F2. 完成

现在打开：

| 用途 | 网址 |
|---|---|
| 顾客（会员端） | `https://你的账号.github.io/yetipsy-miniapp/` |
| 员工 | `https://你的账号.github.io/yetipsy-miniapp/admin/login.html` |

把这两个网址做成 QR Code，贴在吧台。

---

<a name="part-g"></a>
# PART G — 上线前测试清单

请 **全部做完** 才正式给顾客用。

## G1. 员工端测试

- [ ] 打开 `/admin/login.html`，用 owner 账号登录
- [ ] Dashboard 显示 Tonight 的资料（一开始都是 0）
- [ ] `+ CREATE CLAIM` → 来源 `FOODCOURT`、单号 `TEST001`、金额 `50.00`
- [ ] 出现 QR 与 4 位 Code
- [ ] **再建立一次同样的 TEST001** → 应该出现「此订单号已存在」（重复保护正常）
- [ ] 按 `CANCEL` 取消这笔测试 Claim

## G2. 顾客端测试（用你自己的手机）

- [ ] 打开会员端网址
- [ ] 输入你的手机号码 → 注册
- [ ] 首页显示 0 积分、RM0.00 钱包
- [ ] 员工端再建立一笔 Claim（例如 `TEST002`，RM86）
- [ ] 顾客端 → `CLAIM PURCHASE` → 输入 Code
- [ ] 显示 RM86.00 → 按 `CLAIM MY ORDER`
- [ ] 出现 `+86 POINTS`
- [ ] 按 `OPEN REWARD` → 动画 → 显示奖励金额
- [ ] 到 `WALLET` 确认余额增加
- [ ] 到 `ACTIVITY` 看到消费记录

## G3. 钱包抵扣测试

- [ ] 员工端 → `MEMBERS` → 搜寻你的手机号码
- [ ] 输入账单 `60.00`
- [ ] 系统显示可抵扣上限（钱包余额 vs 20% 账单 = RM12，取较小值）
- [ ] 按 `CONFIRM REDEEM`
- [ ] 完成 → 钱包归零、顾客应付 RM48.00

## G4. 资料库检查

回到 Google Sheet 确认这些分页都有资料：

- [ ] `Customers` — 有你的会员资料（YT000001）
- [ ] `Orders` — 有 TEST002 这笔
- [ ] `Claims` — 有 Claim 纪录、Status = CLAIMED
- [ ] `PointTransactions` — 有 +86
- [ ] `WalletTransactions` — 有奖励与抵扣
- [ ] `AuditLogs` — 密密麻麻的操作纪录

## G5. PWA（加到手机主画面）

- [ ] iPhone：Safari → 分享 → 加入主画面
- [ ] Android：Chrome → 右上角 → 安装应用程式

---

<a name="part-h"></a>
# PART H — 日常使用与维护

## 每天开店前

1. 员工打开 `/admin/login.html` 登录
2. 确认 Dashboard 显示今天的资料
3. 检查奖励预算：`budget RM50.00 · left RMxx.xx`

## 每一笔交易

```
顾客在 Foodcourt 点 Yetipsy 的酒
        ↓
员工：CREATE CLAIM
      来源 FOODCOURT
      单号 FC8231
      金额 86.00
        ↓
系统产生 QR + Code
        ↓
员工把画面（或 Code）给顾客
        ↓
顾客扫 QR 或输入 Code → 认领 → 积分 → 开奖
```

> 顾客可以回家再注册、再认领。
> Claim 24 小时内有效（可在 Settings 修改）。

## 顾客回来用钱包

```
员工：MEMBERS → 搜寻会员 → 输入账单金额
        ↓
系统自动算可抵扣金额
        ↓
员工确认 → 完成
```

## 修改设置（Manager / Owner）

`MORE → SETTINGS`，常用：

| 设置 | 说明 | 建议 |
|---|---|---|
| `POINTS_PER_RM` | 每 RM1 给多少积分 | 1 |
| `CLAIM_EXPIRY_HOURS` | Claim 有效时数 | 24 |
| `REWARD_ENABLED` | 是否开启奖励 | TRUE |
| `REWARD_MIN_SPEND` | 奖励最低消费（RM） | 30 |
| `DAILY_REWARD_BUDGET` | 每日奖励预算（RM） | 50 |
| `MAX_WALLET_USAGE_PERCENT` | 钱包最高抵扣比例 | 20 |
| `MIN_WALLET_REDEEM_BILL` | 最低抵扣账单（RM） | 30 |
| `SILVER_THRESHOLD` / `GOLD_THRESHOLD` | 等级门槛 | 500 / 1500 |

> 改完按 SAVE，立即生效，不需要重新部署。

## 修改优惠活动

`MORE → SETTINGS → Promotions`：新增标题、副标题、内容、日期。
`ACTIVE` 的活动会显示在顾客端首页「今晚活动」。

## 更新系统（改程式之后）

**改前端（HTML/CSS/JS）：**
→ 直接上传到 GitHub，1–2 分钟后生效。**不需要**重新部署 Apps Script。

**改后端（apps-script/*.gs）：**

- 有设定 GitHub Actions（推荐）：`git push` 之后自动 `clasp push` + `clasp deploy`，
  1–2 分钟完成，**API URL 不会变**。
- 手动方式：在 GitHub 改完档案后重新贴到 Apps Script，然后
  **部署 → 管理部署 → 编辑（✏️）→ 版本：建立新版本 → 部署**
  → API URL 不会变，前端不用改。

> ⚠️ 只有在 Apps Script 里直接改程式码，GitHub 上的版本就会跟线上不同步。
> 建议一律「改 GitHub → push」，让 GitHub 永远是唯一来源。

---

<a name="part-i"></a>
# PART I — 常见问题

**Q：顾客说扫不到 QR？**
→ 让他改输入 4 位 Claim Code，功能一样。

**Q：员工忘记密码？**
→ Owner 可以进 `MORE → STAFF ACCOUNTS` 重设，
或老板自己在 Apps Script 执行 `changeStaffPassword('账号', '新密码')`。

**Q：建立 Claim 时说「订单号已存在」？**
→ 这是保护机制，避免同一笔消费重复给积分。
确认单号有没有打错；如果确实要重开，先到 Orders 取消旧的。

**Q：奖励都没有出现？**
→ 检查三件事：
1. `REWARD_ENABLED` 是否为 `TRUE`
2. 消费是否达到 `REWARD_MIN_SPEND`（默认 RM30）
3. 今日 `DAILY_REWARD_BUDGET`（默认 RM50）是否已用完

**Q：顾客反映积分没有增加？**
→ 积分只在顾客 **认领** 之后才产生。
到 Orders 看 `ClaimStatus` 是否 = `CLAIMED`。

**Q：同一个号码出现两笔会员（重复注册）？**
→ 新版后端已经把电话号码统一成 E.164（`0123456789` / `60123456789` /
`+60 12-345 6789` 都视为同一个人），并且在同一把交易锁内查重，
**新的注册不会再产生重复**。
旧的重复资料请在 Apps Script 执行：

```javascript
reportDuplicatePhones();     // 先看有哪些重复（不会改资料）
dedupeCustomers(true);       // dry run：看看会怎么合并
dedupeCustomers(false);      // 真的合并
```

合并规则：保留最早注册的那一列，其余列的消费 / 积分 / 钱包明细全部转过来，
再用明细重算积分与余额（不会重复加），重复列标记 `Status = MERGED` 保留下来当证据。

**Q：Google Sheet 会不会很慢？**
→ 几千笔资料内都没问题。
超过几万笔再考虑升级到 Supabase / PostgreSQL
（前端 `js/api.js` 是独立的，后端 `Database.gs` 也是独立的，换资料库不必重写 UI）。

**Q：更新后顾客看到旧画面？**
→ 手机浏览器快取。请顾客：
iPhone：Safari → 长按重新载入图示 → 重新整理
Android：设定 → 清除浏览器快取，或重新加入主画面。

**Q：安全吗？会不会有人乱加积分？**
→ 所有积分 / 奖励 / 钱包都由后端计算，前端无法指定金额。
每一支员工 API 都会验证登录状态与角色。
所有操作都写在 `AuditLogs`，出问题可以追。

**Q：会员忘记密码怎么办？**
→ 请他找店员。Manager / Owner 进 `MEMBERS → 找到会员 → RESET PASSWORD`，
设一组新密码给他（会写入 Audit Log，他所有装置的登录会失效）。
会员自己也可以在 `我的 → 登录密码` 改密码（需要输入目前的密码）。

**Q：会员的密码安全吗？**
→ Sheet 里只存 `sha256(salt|密码|salt)`，每个会员的 salt 不同，看不到明文。
连续输错 6 次会锁定 5 分钟（`LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` 可调）。
会员端 session **不能**自行转账钱包、不能改设置、不能进员工端。

**Q：有人抢先用我的号码注册怎么办？**
→ 号码已存在时系统会要求输入密码，他进不去你的帐号。
如果你自己的帐号还没设过密码（旧资料），第一次进入时系统会让你设密码；
迁移完成后建议把 Settings 的 `PASSWORD_SELFSERVICE_SETUP` 改成 `FALSE`，
之后就只有店员能重设密码。

---

## 完成检查表

- [ ] Google Sheet 出现 12 个分页
- [ ] Apps Script 15 个档案都到位（或用 GitHub Actions 推送）
- [ ] `setupDatabase()` 执行成功
- [ ] `bootstrapOwner()` 建立老板账号，程式码已删除
- [ ] 员工账号已在 STAFF ACCOUNTS 建立
- [ ] Web App 已部署，URL 已复制
- [ ] GitHub Pages 网址可以打开
- [ ] `js/config.js` 已填入 API URL
- [ ] PART G 测试清单全部完成
- [ ] 两个 QR（会员端 / 员工端）贴在吧台

```
YETIPSY MINI APP 1.2 · FOODCOURT EDITION
Validate the business model before scaling the technology.
```

## 会员条码与扫码抵扣（本版规则）

顾客在 `钱包` 或 `我的` 页按「出示会员条码」→ 店员在员工端
`SCAN & REDEEM`（`admin/redeem.html`）扫描 → 确认是本人 → 才允许抵扣钱包。

| Action | 谁能用 | 做什么 |
|---|---|---|
| `getMemberCode` | 会员 | 回传条码内容 `YT1\|CustomerID\|随机码`（不含电话、密码），N 秒后失效 |
| `scanMemberCode` | 员工 | 验证条码 → 回传顾客资料 + `verifyToken`（条码扫过即作废） |
| `redeemWallet` | 员工 | 必须带 `verifyToken`，否则回 `MEMBER_VERIFY_REQUIRED` |

- 条码一次性：重扫 → `MEMBER_CODE_EXPIRED`
- verifyToken 绑顾客 + 绑员工：拿别人的用 → `MEMBER_VERIFY_MISMATCH`
- 员工端相机优先用 `BarcodeDetector`（Chrome / Android 直接读一维条码），
  不支援时自动改用 jsQR 扫条码下方那个 QR；没相机或非 HTTPS 时提示手动输入。

## 重复注册与会员密码（本版规则）

### 1. 同一个号码只会有一笔会员

- 后端 `Utils.gs → normalizePhoneE164()` 把所有写法统一成 E.164
  （`+60123456789`、`+6581234567`），前端 `js/ui.js → normalizePhone()` 使用同一套规则。
- `Customers.gs → customerLogin()` 先查后建，整段在 `LockService` 交易锁内执行；
  另有 `customerRegister()`：号码已存在直接回 `PHONE_ALREADY_REGISTERED`。
- 历史脏资料用 `dedupeCustomers()` 合并（见 PART I）。
- 测试覆盖：`node demo/tests.js`（第 02–06 组）、`node demo/test-apps-script.js`（第 01、05 组）。

### 2. 会员登录 = 手机号码 + 密码（不用 WhatsApp OTP）

顾客在登录页的动作：

```
① 输入手机号码 → 继续
      │
      ├── 这个号码还没注册 → ② 设密码（两次）→ 注册并进入
      │
      └── 这个号码已注册   → ③ 输入密码 → 登录
                              └ 旧会员还没设过密码 → 第一次设密码
```

| Settings | 预设 | 说明 |
|---|---|---|
| `CUSTOMER_PASSWORD_MIN` | `8` | 会员密码最少字符 |
| `LOGIN_MAX_ATTEMPTS` | `6` | 连续输错几次就锁定 |
| `LOGIN_LOCK_MINUTES` | `5` | 锁定几分钟 |
| `PASSWORD_SELFSERVICE_SETUP` | `TRUE` | 旧会员（无密码）可否自己补设密码；**迁移完成后建议改成 `FALSE`** |
| `MEMBER_CODE_SECONDS` | `60` | 会员端条码多久自动换一条（秒） |
| `MEMBER_VERIFY_SECONDS` | `180` | 员工扫到条码后，几分钟内要完成抵扣 |
| `REQUIRE_MEMBER_CODE_SCAN` | `TRUE` | `TRUE` = 抵扣前必须扫过顾客条码；改 `FALSE` 可关掉 |

- 密码以每个会员独立 salt 的 SHA-256 储存，Sheet 里看不到明文。
- 会员自己改密码：`我的 → 登录密码`（需要目前的密码；改完其他装置登出）。
- 会员忘记密码：店员 `MEMBERS → RESET PASSWORD`（Manager / Owner）。
- 号码已存在时注册会被拒绝（`PHONE_ALREADY_REGISTERED`），不会多出一笔会员。

前端所有 API 请求有 15 秒 timeout，避免按钮无限卡住。
