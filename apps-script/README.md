# apps-script/ — 生产后端（Google Apps Script）

这一层是「线上版」的后端：

```
GitHub Pages（前端 HTML/JS）  ──POST──▶  Google Apps Script Web App（这个资料夹）
                                                    │
                                                    ▼
                                             Google Sheets（资料库，13 张表）
```

- **程式码**：全部在这个 GitHub repo（`apps-script/*.gs`）
- **执行环境**：Google Apps Script（RM0）
- **资料**：Google Sheets（RM0）

所以「程式码全部放在 GitHub」是可以的 —— 只有*执行*发生在 Google 那边。
你可以选择每次手动贴，或用下面的 GitHub Actions 自动推送（推荐）。

---

## 1. 档案

| 档案 | 职责 |
|---|---|
| `Code.gs` | Web App 入口：`doPost` / `doGet`、action 分派、交易锁、统一回应格式 |
| `Config.gs` | 13 张 Sheet 的栏位定义、预设设置、错误讯息表 |
| `Utils.gs` | 时间 / 金额(sen) / SHA-256 / ID / **电话号码 E.164 规范化** |
| `Database.gs` | Sheets 存取层：`dbLoad` / `dbFlush` / `setupDatabase` / `bootstrapOwner` / `dedupeCustomers` |
| `Security.gs` | Session（只存 token hash）、角色权限、Rate limit |
| `Audit.gs` | 操作记录 |
| `Points.gs` | 积分与等级（门槛读 Settings） |
| `Rewards.gs` | 奖励产生（后端随机 + 每日预算） |
| `Wallet.gs` | 钱包明细、抵扣上限、员工确认抵扣 |
| `Customers.gs` | 会员注册 / 登录（**同一个号码只有一笔**） |
| `Orders.gs` | 已验证消费记录、取消订单（撤销积分与奖励） |
| `Claims.gs` | Claim QR / Code、认领、Dashboard |
| `Promotions.gs` | 今晚活动 |
| `Admin.gs` | 设置、积分调整、Audit Log、员工账号 |
| `Auth.gs` | `ping`、员工登录（失败 6 次锁 5 分钟） |
| `Otp.gs` | WhatsApp OTP（验证码只存 hash，一次性 proof） |
| `appsscript.json` | Apps Script manifest（V8 runtime、时区、权限范围） |

---

## 2. 第一次部署

```bash
# 1) 建立 Google Sheet → 扩充功能 → Apps Script
# 2) 本机装 clasp 并登录（会打开浏览器授权一次）
npm install --global @google/clasp
clasp login

# 3) 把 scriptId 填进 .clasp.json
#    scriptId = Apps Script 网址里 /d/XXXXXXXX/ 那一串
cp .clasp.json.example .clasp.json     # 然后编辑 scriptId

# 4) 推送程式码 + 建立第一个部署
clasp push --force
clasp deploy --description "first deploy"
```

部署完成后复制 Web App URL（`https://script.google.com/macros/s/.../exec`），
贴到 **`js/config.js` 的 `API_URL`**，push 到 GitHub。

在浏览器直接打开那个 URL，应该看到：

```json
{"success":true,"data":{"app":"YETIPSY MINI APP","mode":"PRODUCTION",
 "backend":"GOOGLE_APPS_SCRIPT","storage":"GOOGLE_SHEETS", ...}}
```

然后在 Apps Script 编辑器执行：

```javascript
setupDatabase();                       // 建立 13 张 Sheet 与预设设置
bootstrapOwner('owner', '你的密码');    // 建立第一个老板账号（只能执行一次）
```

详细图文步骤见 [`../DEPLOYMENT.md`](../DEPLOYMENT.md)。

---

## 3. 让 GitHub 自动部署（推荐）

设定两个 GitHub Secrets（**Settings → Secrets and variables → Actions**）：

| Secret | 内容 |
|---|---|
| `CLASP_SCRIPT_ID` | Apps Script 专案 ID（`/d/XXXX/` 那一串） |
| `CLASPRC_JSON` | 本机 `~/.clasprc.json` 的**完整内容**（`clasp login` 之后产生） |

> `~/.clasprc.json` 里面是 OAuth 凭证（含 refresh token）。
> 它只能放在 GitHub Secrets，**不要**提交到 repo。
> 建议使用一个专用的 Google 账号部署，不要用个人主帐号。

设定好之后：

- `git push` 到 `main`，只要 `apps-script/` 有改动
- `.github/workflows/deploy-apps-script.yml` 会先跑测试，再 `clasp push` + `clasp deploy`
- **Web App URL 不会变**，前端不用改
- 没有设定 Secrets 时该 workflow 会跳过，不会让 CI 变红

---

## 4. 本机测试（不需要 Google 账号）

```bash
node demo/test-apps-script.js   # 直接执行这些 .gs（在 Node 里模拟 Google 服务）
node demo/tests.js              # 完整 API 测试（25 组 / 163 项）
node demo/server.js             # 本机 demo 服务器 http://localhost:3000/
```

`demo/google-shim.js` 用记忆体实作 `SpreadsheetApp` / `LockService` /
`PropertiesService` / `CacheService` / `Utilities.computeDigest` / `UrlFetchApp`，
所以测试跑的是**这里的真实程式码**，不是另一份复制品。

---

## 5. 维护工具（在 Apps Script 编辑器执行）

| 函式 | 用途 |
|---|---|
| `setupDatabase()` | 建立 / 补齐 13 张 Sheet 与预设设置（可重复执行，不会清资料） |
| `bootstrapOwner(user, pass)` | 建立第一个 OWNER（只在 Staff 表是空的时候可用） |
| `reportDuplicatePhones()` | 列出重复的电话号码（只读） |
| `dedupeCustomers(true)` | dry run：看看会怎么合并重复会员 |
| `dedupeCustomers(false)` | 真的合并（保留最早注册的帐号，明细转帐后重算积分/钱包） |
| `migratePhonesToE164(false)` | 把 `Customers.Phone` 全部改成 E.164 |

---

## 6. Script Properties（选用）

| 属性 | 用途 |
|---|---|
| `SPREADSHEET_ID` | 指定资料库 Sheet（没有设定时用绑定的 Sheet） |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API token（启用 OTP 才需要） |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp 电话号码 ID |
| `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` | 验证码模板（选用） |

> 任何 token / 密码都只能放在 Script Properties 或 GitHub Secrets，
> **绝不要**写进这个 repo 的任何档案。

---

## 7. 已知限制（Google Sheets 当资料库）

- 每次请求会把相关 Sheet 读进记忆体、结束时只写回变动的列；
  整段由 `LockService` 串行化，所以**不会**出现两个人同时认领同一笔。
- 适合一家店的量（几万列以内）。超过之后请改 `Database.gs`
  换 Supabase / PostgreSQL（前端 `js/api.js` 不用动）。
- Apps Script 单次执行上限 6 分钟、每日有配额；一般餐饮场景够用。
