# YETIPSY MINI APP 1.1 — FOODCOURT EDITION

> Foodcourt 负责点餐和付款。
> Yetipsy 负责顾客关系。

Google Sheets + Google Apps Script + GitHub Pages · 月费 RM0 的会员 / 积分 / 奖励 / 钱包系统。

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
├── index.html           会员首页（积分 · 等级 · 钱包 · 今晚活动）
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
├── apps-script/         ★ 生产后端（Google Apps Script）
│   ├── Code.gs          Web App 入口（doPost）
│   ├── Config.gs        Sheet 名称 / 栏位 / 默认设置
│   ├── Utils.gs         时间 · 金额(SEN) · Hash · Error
│   ├── Database.gs      Sheets 存取层 + setupDatabase()
│   ├── Security.gs      交易锁 · Session · 角色 · Rate limit
│   ├── Auth.gs          会员 / 员工登录
│   ├── Customers.gs Orders.gs Claims.gs Points.gs Rewards.gs Wallet.gs
│   ├── Promotions.gs Admin.gs Audit.gs
│
├── demo/                本地演示后端（不需要 Google 账号即可试用）
│   ├── server.js        模拟 GAS 的 API 服务器
│   ├── tests.js         22 组测试（78 项检查）
│   └── test-apps-script.js  直接执行 apps-script/*.gs（88 项检查）
│
├── manifest.json         PWA（可加到手机主画面）
├── service-worker.js     只 Cache App Shell，不 Cache 任何敏感资料
└── DEPLOYMENT.md         零基础部署教学
```

---

## 3. 立即试用（DEMO 模式，不需要 Google 账号）

```bash
cd yetipsy-miniapp
node demo/server.js
```

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
# 1) DEMO 后端测试（22 组 / 78 项）
node demo/server.js &
node demo/tests.js

# 2) 生产后端测试（在 Node 里模拟 Google 服务，直接跑 apps-script/*.gs，88 项）
node demo/test-apps-script.js
```

覆盖项目（企划书 §69）：

| # | 测试 | # | 测试 |
|---|---|---|---|
| 01 | 新会员注册 | 12 | 会员等级更新 |
| 02 | 旧会员登录 | 13 | 奖励产生 |
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

1. 建立 Google Sheet → 开启 Apps Script
2. 贴上 `apps-script/*.gs` → 执行 `setupDatabase()`
3. Deploy → New deployment → Web app → 复制 URL
4. 建立 GitHub Repo → 上传档案 → 开启 GitHub Pages
5. `js/config.js` 贴上 API URL → 完成

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

### 6.4 会员身份与 WhatsApp OTP（更新）

仅用电话号码登录无法证明号码属于当前顾客；任何人输入别人的号码都可能看到该会员资料。生产环境应开启 `js/config.js` 的 `OTP_ENABLED`，并在后端完成以下流程，**不要在前端生成或返回验证码**：

1. `requestCustomerOtp`：后端把 6 位随机码的 hash、`phone`（E.164）、过期时间和尝试次数写入 OTP 表，并通过 WhatsApp Business Cloud API 或 BSP 发送模板消息；同一号码每 60 秒最多发送一次。
2. `verifyCustomerOtp`：后端检查 hash、有效期和失败次数，成功后签发一次性短期 verification proof。
3. `customerLogin`：必须验证该 proof，才创建或返回会员 session；没有 proof 时拒绝登录。`Customers.phone` 必须以 E.164 格式建立唯一约束（例如 `+60123456789`、`+6581234567`），并在写入时再次检查，不能只靠前端防重复。
4. 生产环境还应限制 OTP 重试、IP/号码频率，日志中不要保存验证码明文。WhatsApp Cloud API token 只能放在 Apps Script Properties，不可放入这个前端仓库。

本版本登录页已支持马来西亚 `+60` 与新加坡 `+65`，并加入请求超时，网络/GAS 无响应时会在 15 秒后结束 loading。由于当前仓库不包含 Apps Script 后端源码，`OTP_ENABLED` 默认保持 `false`；部署上述后端端点并测试 WhatsApp 模板后再改为 `true`。否则直接开启会正确显示“OTP 未配置”，不会悄悄允许无验证登录。
