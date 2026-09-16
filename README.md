# YETIPSY MINI APP 1.2 — FOODCOURT EDITION

> Foodcourt 负责点餐和付款。
> Yetipsy 负责顾客关系。

Google Sheets + Google Apps Script + GitHub Pages · 月费 RM0 的会员 / 积分 / 奖励 / 钱包系统。

**程式码全部在 GitHub，资料全部在 Google Sheets，两边都是 RM0。**

| 你要的东西 | 放在哪里 | 费用 |
|---|---|---|
| 前端（会员端 / 员工端 HTML+JS） | 这个 repo → GitHub Pages | RM0 |
| 后端（业务逻辑，16 个 `.gs`） | 这个 repo 的 `apps-script/` → 部署到 Google Apps Script | RM0 |
| 资料库（13 张表） | Google Sheets | RM0 |
| 自动部署 | GitHub Actions + `clasp`（push 就上线） | RM0 |

> **1.2 修正了「同一个号码重复注册」**：电话号码一律规范化成 E.164
> （`0123456789` = `60123456789` = `+60 12-345 6789` = 同一个会员），
> 前后端使用同一套规则，注册在交易锁内查重；
> 旧的重复资料用 `dedupeCustomers()` 合并。详见 §5 与 DEPLOYMENT.md PART I。

---

## 0. 这个系统做什么 / 不做什么

**做：**

```
任何渠道产生消费 → 建立会员消费记录 → 产生 Claim → 顾客认领
→ 绑定会员 → 累计 Spend → 获得 Points → 更新 Tier
→ 获得 Reward → Reward 进入 Wallet → 促进下一次消费
```

**不做（Phase 1 明确排除）：**

Foodcourt API、线上点餐、DuitNow / FPX / 信用卡、POS、库存、会计、
厨房系统、订位、外送、WhatsApp 自动化、SMS OTP、Native App、多分店、拆单积分。

> 这不是 POS。
> 目的是 **CUSTOMER RETENTION**，不是 ORDER MANAGEMENT。

---

## 1. 架构

```
顾客手机                员工手机 / Tablet
   ↓                          ↓
GitHub Pages             同一个 GitHub Pages
   ↓                          ↓
Yetipsy Mini App         Yetipsy Staff Admin
   ↓                          ↓
   └────────→ Google Apps Script Web App ←──────┘
                       ↓
                  Google Sheets
              （11 张 Sheet 的资料库）
```

| 层 | 技术 | 费用 |
|---|---|---|
| Frontend | HTML5 + CSS3 + Vanilla JS + PWA | RM0 |
| Hosting | GitHub Pages | RM0 |
| Backend | Google Apps Script | RM0 |
| Database | Google Sheets | RM0 |
| Payment | Foodcourt 既有流程 | RM0 |

---

## 2. 目录结构

```
yetipsy-miniapp/
│
├── index.html           会员首页（积分 · 等级 · 钱包 · 今晚活动）← 线上版入口
├── preview.html         单档离线预览（DEMO 用，不参与线上流程）
├── login.html           手机登录 / 注册
├── claim.html           扫码或输入 Code 认领消费
├── reward.html          打开奖励（动画）
├── wallet.html          我的钱包
├── activity.html        消费 / 积分 / 钱包记录
├── profile.html         会员资料 · 隐私说明
│
├── admin/               员工端
│   ├── login.html       员工登录
│   ├── index.html       Dashboard（今晚营业额 / 认领数 / 新会员…）
│   ├── claim.html       ★ 建立 Claim（5–10 秒）→ QR + Code
│   ├── customers.html   查找会员 · 钱包抵扣 · 调整（Manager+）
│   ├── orders.html      订单 / 消费记录
│   ├── settings.html    系统设置 + 优惠活动（Manager+）
│   ├── audit.html       操作记录（Manager+）
│   ├── staff.html       员工账号（Owner）
│   └── more.html        功能总表
│
├── css/                 app.css（会员端）· admin.css（员工端）
├── js/
│   ├── config.js        ★ 唯一需要修改的前端文件（填 API URL）
│   ├── api.js           前端唯一的后端通讯层
│   ├── auth.js          Session 管理
│   ├── ui.js            金额格式化 / Toast / QR / 双语
│   ├── app.js claim.js reward.js wallet.js activity.js profile.js
│   ├── admin*.js        员工端各页面逻辑
│   └── vendor/          qrcode.js（MIT）· jsQR.js（Apache-2.0）
│
├── apps-script/         ★ 生产后端（Google Apps Script，16 个档案）
│   ├── Code.gs          Web App 入口（doPost / doGet · action 分派 · 交易锁）
│   ├── Config.gs        13 张 Sheet 的栏位定义 · 默认设置 · 错误讯息
│   ├── Utils.gs         时间 · 金额(SEN) · SHA-256 · ★ 电话 E.164 规范化
│   ├── Database.gs      Sheets 存取层 · setupDatabase() · dedupeCustomers()
│   ├── Security.gs      Session（只存 hash）· 角色 · Rate limit
│   ├── Auth.gs          ping · 员工登录（失败 6 次锁 5 分钟）
│   ├── Customers.gs     ★ 会员注册/登录（同一个号码只有一笔）
│   ├── Orders.gs Claims.gs Points.gs Rewards.gs Wallet.gs
│   ├── Promotions.gs Admin.gs Audit.gs Otp.gs（WhatsApp OTP）
│   ├── appsscript.json  Apps Script manifest（V8 · 时区 · 权限）
│   ├── .clasp.json.example  部署设定范本
│   └── README.md        部署 / 自动推送 / 维护工具
│
├── demo/                本机测试与演示（不需要 Google 账号）
│   ├── google-shim.js   在 Node 里模拟 Sheets / Lock / Properties / UrlFetch
│   ├── load-backend.js  把 apps-script/*.gs 载入 Node（测的是真实后端）
│   ├── server.js        本机 demo 服务器（npm run demo）
│   ├── tests.js         API 测试 25 组 / 163 项
│   ├── test-apps-script.js  后端单元测试 82 项
│   ├── smoke-ui.js      前端 ↔ API ↔ 后端契约检查 318 项
│   ├── e2e-ui.js        端到端 HTTP 测试 44 项
│   └── harness.js       测试框架（零依赖）
│
├── .github/workflows/
│   ├── ci.yml                 每次 push / PR 跑全部测试
│   └── deploy-apps-script.yml push 后用 clasp 自动部署后端
│
├── manifest.json         PWA（可加到手机主画面）
├── service-worker.js     只 Cache App Shell，不 Cache 任何敏感资料
├── DEPLOYMENT.md         零基础部署教学
└── apps-script/README.md 后端部署与自动推送
```

---

## 3. 立即试用（DEMO 模式，不需要 Google 账号）

```bash
cd yetipsy-miniapp
npm run demo          # = node demo/server.js
```

> DEMO 服务器会把 `js/config.js` 的 `API_URL` 换成空字串再伺服出去，
> 所以 repo 里的 `config.js` 可以一直保持线上 URL，不用为了试用改来改去。
> 线上版的页面（`index.html` 等）在 `REQUIRE_BACKEND: true` 时
> **不会**偷偷退回 DEMO —— 没连上后端就直接显示错误，避免「以为在线上版，
> 其实资料只存在自己手机」。

| | 网址 |
|---|---|
| 会员端 | http://localhost:3000/ |
| 员工端 | http://localhost:3000/admin/login.html |

员工账号（密码都是 `yetipsy123`）：

| 账号 | 角色 | 可以做 |
|---|---|---|
| `owner` | OWNER | 全部（含员工账号管理） |
| `manager` | MANAGER | 设置、调整积分/钱包、Audit Log、取消订单 |
| `staff` | STAFF | 建立 Claim、查找会员、钱包抵扣 |

**完整 Demo 流程（对应企划书 §70 / §71）：**

1. 员工端 → `+ CREATE CLAIM` → 来源 `FOODCOURT`、单号 `FC8231`、金额 `86.00`
2. 画面出现 QR + Claim Code（例如 `Y7K2`）
3. 会员端 → 输入任意手机号码（例如 `123456789`）→ 注册
4. `CLAIM PURCHASE` → 输入 Code 或扫 QR → `CLAIM MY ORDER`
5. 得到 `+86 POINTS` → `OPEN REWARD` → 奖励进 Wallet
6. 员工端 → `MEMBERS` → 搜寻会员 → 输入账单 `60.00` → 系统算出可抵扣
   上限（钱包余额 vs 20%）→ `CONFIRM REDEEM`

资料存在 `demo/demo-data.json`，删掉这个文件就会重置。

---

## 4. 测试

```bash
npm test                 # 全部 4 套（607 项检查）

npm run test:backend     # 直接执行 apps-script/*.gs（82 项）
npm run test:api         # 完整 API 测试 25 组（163 项）
npm run test:ui          # 前端 ↔ API ↔ 后端契约（318 项）
npm run test:e2e         # 起 demo server 走完整 HTTP 流程（44 项）
```

`demo/google-shim.js` 在 Node 里模拟 `SpreadsheetApp` / `LockService` /
`PropertiesService` / `CacheService` / `Utilities.computeDigest` / `UrlFetchApp`，
所以测试执行的是 **`apps-script/` 里真实的后端程式码**，不是另一份复制品。

覆盖项目（企划书 §69 + 防重复注册）：

| # | 测试 | # | 测试 |
|---|---|---|---|
| 01 | 新会员注册 | 12 | 会员等级更新 |
| 02 | ★ 旧会员登录（同一号码不重复注册） | 13 | 奖励产生 |
| 03 | 员工登录 | 14 | 打开奖励 |
| 04 | 建立 Foodcourt Claim | 15 | 重复打开奖励 → 拒绝 |
| 05 | 重复订单号 → 拒绝 | 16 | 钱包余额 |
| 06 | 扫描有效 QR | 17 | 钱包抵扣 |
| 07 | 无效 QR → 拒绝 | 18 | 超出抵扣上限 → 拒绝 |
| 08 | 过期 Claim → 拒绝 | 19 | 余额不足 → 拒绝 |
| 09 | 认领订单 | 20 | 并发认领 → 只有一个成功 |
| 10 | 重复认领 → 拒绝 | 21 | 并发领奖 → 只有一个成功 |
| 11 | 积分发放 | 22 | 未授权 Admin API → 拒绝 |

另外验证：取消订单会撤销积分与已领奖励、Audit Log 完整、
Dashboard 统计、密码以 Salted Hash 储存且每人 Salt 不同。

---

## 5. 核心规则（实作摘要）

| 主题 | 规则 |
|---|---|
| 会员身份 | **E.164 电话号码**（`+60123456789`）。`0123456789` / `60123456789` / `+60 12-345 6789` 都是同一个人，前后端用同一套规则；注册在 `LockService` 内查重，同一个号码只会有一列 |
| 金额 | 后端一律 SEN 整数（RM8.68 = 868），前端最后才格式化 |
| 积分 | RM1 = 1 Point；只能来自已认领的 Verified Transaction |
| 积分基础 | `POINTS_CALCULATION = NET_PAID`（钱包抵扣不重复产生积分） |
| 等级 | MEMBER / SILVER / GOLD，Threshold 全部在 Settings，不 hardcode |
| Claim | 一笔订单只能被认领一次；24 小时有效（可设置） |
| Claim Token | 32 bytes 随机（64 hex），资料库只存 SHA-256 hash |
| 重复订单 | `OrderSource + ExternalOrderID` 不可重复 |
| 奖励 | 只能由后端产生（禁止前端 `Math.random()`） |
| 奖励预算 | 每日 `RM50`（可设置），接近上限进入 LOW_REWARD_MODE |
| 钱包抵扣 | 最低账单 RM30、最高 20% 账单、必须由员工确认 |
| 交易安全 | 所有写入使用 `LockService.getScriptLock()` |
| 幂等 | 重复请求不会造成双倍积分 / 钱包 / 奖励 |

---

## 6. ⚠️ 安全说明（必须阅读）

### 6.1 手机号码登录不是强身份验证（企划书 §15）

第一版为了 RM0 成本，会员端使用「手机号码 + Session Token」登录，**没有 OTP**。

因此系统 **不允许** 仅凭会员登录执行：

- 手动转账 Wallet
- 敏感资料修改
- 任何 Admin 功能

Phase 2 建议补上：WhatsApp OTP / SMS OTP / Email OTP。

### 6.2 已实作的保护

- 员工密码：Salted Hash（`sha256(salt|password|salt)`），每个账号独立 Salt
- Session Token：随机 64 hex，资料库只存 hash
- 员工 API：每一次都验证 Session + StaffID + Role + Permission
- Claim Token：随机且不可预测，只存 hash
- 所有金额 / 积分 / 奖励逻辑在后端，前端只负责显示与动画
- 登录失败 6 次锁定 5 分钟
- 所有重要动作写入 AuditLogs

### 6.3 `/admin.html` 隐藏不是安全

员工端页面可以公开，因为每个 API 都会再验证一次权限。
前端的 `ADMIN.hasRole()` 只是为了 UI 显示/隐藏，**不是**安全边界。

---

## 7. 隐私

只收集会员系统必要资料：

- 手机号码（必要）
- 名字（可不填）
- 生日（可不填，未来生日奖励用）
- 消费记录

用途仅限于：会员身份识别、积分、奖励、消费记录、优惠通知。
App 内 `PROFILE` 页面有完整隐私说明。

---

## 8. 部署

见 **[DEPLOYMENT.md](DEPLOYMENT.md)** —— 假设你完全不懂程式，一步一步照做。

简述：

1. 建立 Google Sheet → 扩充功能 → Apps Script
2. 把 `apps-script/*.gs` 推上去（`clasp push`，或设定 GitHub Actions 之后 `git push` 自动推）
3. 执行 `setupDatabase()` 与 `bootstrapOwner('owner','你的密码')`
4. Deploy → New deployment → Web app → 复制 URL
5. `js/config.js` 贴上 API URL（`REQUIRE_BACKEND: true`）→ push → 开启 GitHub Pages

> 之后改后端只要 `git push`：CI 会先跑 607 项测试，再用 `clasp` 部署，
> Web App URL 不变，前端不用动。设定方法见 `apps-script/README.md`。

---

## 9. 未来扩充（Phase 2+）

已预留位置，不需要重写前端：

- Foodcourt API / Webhook / CSV 自动建立 Order（走 `createMemberTransaction()`）
- Birthday Reward、Referral、Voucher、VIP Event
- WhatsApp CRM、Customer Segmentation
- 资料库升级 Supabase / PostgreSQL（只需改写 `Database.gs` 与 `js/api.js`）

---

## 10. 授权与第三方

- 本专案代码：随专案交付，可自由修改使用
- `js/vendor/qrcode.js` — QR Code Generator for JavaScript, Copyright (c) 2009 Kazuhiko Arase, **MIT**
- `js/vendor/jsQR.js` — jsQR, **Apache-2.0**

```
YETIPSY MINI APP 1.1 · FOODCOURT EDITION
Simple before complex. Secure before fancy.
Fast for staff. Fun for customers.
```

### 6.4 会员身份与 WhatsApp OTP（本版已实作）

仅用电话号码登录无法证明号码属于当前顾客；任何人输入别人的号码都可能看到该会员资料。
后端 `apps-script/Otp.gs` 已实作完整流程，**验证码绝不在前端产生或回传**：

1. `requestCustomerOtp`：后端产生 6 位码，只把 **hash** + `phone`（E.164）+ 过期时间 + 尝试次数
   写入 `OtpCodes` 表，并通过 WhatsApp Business Cloud API 发送；同一号码 60 秒内只能发一次。
2. `verifyCustomerOtp`：检查 hash、有效期与失败次数（默认最多 5 次），
   成功后签发一次性、5 分钟有效的 verification proof。
3. `customerLogin`：`OTP_ENABLED = TRUE` 时必须带这个 proof，否则回 `OTP_REQUIRED`；
   proof 用一次即失效（重放会被拒绝）。
4. `Customers.Phone` 一律 E.164，登录/注册在 `LockService` 交易锁内查重；
   另有 `customerRegister`：号码已存在直接回 `PHONE_ALREADY_REGISTERED`。
   日志与 AuditLog 都不写验证码明文。

开启方式：Apps Script **Script Properties** 填 `WHATSAPP_TOKEN` 与
`WHATSAPP_PHONE_NUMBER_ID` → 员工端 SETTINGS 把 `OTP_ENABLED` 改成 `TRUE`
（没配置 WhatsApp 时系统会拒绝开启）→ `js/config.js` 的 `OTP_ENABLED` 改成 `true`。
详细步骤见 DEPLOYMENT.md。

登录页支持马来西亚 `+60` 与新加坡 `+65`；所有 API 请求有 15 秒超时，
网络 / GAS 无响应时不会无限转圈。
