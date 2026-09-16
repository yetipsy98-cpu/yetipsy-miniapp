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

## B2. 建立所有后端档案

左边有个「档案」区域：

1. 先把预设的 `Code.gs` **删掉**
   （点 `Code.gs` 右边的三个点 → 删除）
2. 然后依照下表，一个一个新增档案：
   点 **+ → 指令码（Script）**，输入档案名称（**不要**输入 `.gs`，系统会自动加）

| 顺序 | 档案名称 |
|---|---|
| 1 | `Config` |
| 2 | `Utils` |
| 3 | `Audit` |
| 4 | `Database` |
| 5 | `Security` |
| 6 | `Auth` |
| 7 | `Customers` |
| 8 | `Orders` |
| 9 | `Claims` |
| 10 | `Points` |
| 11 | `Rewards` |
| 12 | `Wallet` |
| 13 | `Promotions` |
| 14 | `Admin` |
| 15 | `Code` |

3. 打开专案里的 `apps-script/` 资料夹，里面每个 `.gs` 档案：
   - 用记事本打开该档案
   - 全选复制（Ctrl+A → Ctrl+C）
   - 贴到 Apps Script 对应的档案里（覆盖原本的内容）

4. 每贴完一个档案按 **💾 储存**（或 Ctrl+S）

> ⚠️ 15 个档案全部贴完再继续。
> 少一个档案系统会出错。

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
SETUP OK
Settings ready (17 keys)
Owner account created: username=owner
!! Generated owner password: a3f9c2 （请修改）
Demo promotions created
```

> **⚠️ 请把那组随机密码抄下来！** 这是老板账号的初始密码。
> 如果没看到，往下看 PART C，我们会直接重设密码。

## B4. 确认资料库建立成功

回到 Google Sheet，下方应该会出现这些分页：

```
Customers  Orders  Claims  Rewards  PointTransactions
WalletTransactions  Promotions  Staff  Sessions  Settings  AuditLogs
```

看到这 11 个分页 = 资料库成功。

---

<a name="part-c"></a>
# PART C — 建立账号

## C1. 设定老板密码（重要）

回到 Apps Script 编辑器，**在程式码最下方**（或任何一个档案的最下面）加入这段：

```javascript
function setMyOwnerPassword() {
  changeStaffPassword('owner', '这里改成你的密码');
}
```

例如：

```javascript
function setMyOwnerPassword() {
  changeStaffPassword('owner', 'Yetipsy@2026');
}
```

然后：

1. 储存
2. 上方函式选单选择 **`setMyOwnerPassword`**
3. 按 **执行**
4. 看到「执行完毕」后，**把这段程式删掉**（避免密码留在程式码里）

> 密码规则：至少 8 个字符。不要用 `123456`。

## C2. 建立员工账号

用同样方式，加入并执行：

```javascript
function createMyStaff() {
  createAdditionalStaff();
}
```

这会建立：

| 账号 | 密码 | 角色 |
|---|---|---|
| `manager` | `ChangeMe123` | 经理 |
| `staff` | `ChangeMe123` | 员工 |

**建立后立刻改密码**，用这段：

```javascript
function fixPasswords() {
  changeStaffPassword('manager', '经理的新密码');
  changeStaffPassword('staff',   '员工的新密码');
}
```

执行完一样把程式删掉。

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
→ 在 Apps Script 改完后，必须：
**部署 → 管理部署 → 编辑（✏️）→ 版本：建立新版本 → 部署**
→ API URL 不会变，前端不用改。

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

**Q：会员登录没有 OTP，会不会被冒用？**
→ 这是第一版为了 RM0 做的取舍（见 README §6.1）。
风险有限：冒用者只能看到积分与钱包，
**不能**自行转账、不能改敏感资料、不能进员工端。
Phase 2 建议加 WhatsApp OTP。

---

## 完成检查表

- [ ] Google Sheet 出现 11 个分页
- [ ] Apps Script 15 个档案都贴上
- [ ] `setupDatabase()` 执行成功
- [ ] 老板密码已改成自己的
- [ ] 员工账号已建立并改密码
- [ ] Web App 已部署，URL 已复制
- [ ] GitHub Pages 网址可以打开
- [ ] `js/config.js` 已填入 API URL
- [ ] PART G 测试清单全部完成
- [ ] 两个 QR（会员端 / 员工端）贴在吧台

```
YETIPSY MINI APP 1.1 · FOODCOURT EDITION
Validate the business model before scaling the technology.
```
