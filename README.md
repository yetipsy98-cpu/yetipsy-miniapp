# YETIPSY MINI APP 2.1 — FOODCOURT POS EDITION

> Foodcourt 负责点餐和付款。
> Yetipsy 负责顾客关系。
>
> **2.1：员工端改成 POS 进单台（foodcourt 单据 → 扫会员码进分）；**
> **会员首页只留四个入口（下单 / 会员码 / 会员中心 / 我的订单）+ 活动幕布。**

Google Sheets + Google Apps Script + GitHub Pages · 月费 RM0 的会员 / 积分 / 奖励 / 钱包系统。

**程式码全部在 GitHub，资料全部在 Google Sheets，两边都是 RM0。**

| 你要的东西 | 放在哪里 | 费用 |
|---|---|---|
| 前端（会员端 / 员工端 HTML+JS） | 这个 repo → GitHub Pages | RM0 |
| 后端（业务逻辑，20 个 `.gs`） | 这个 repo 的 `apps-script/` → 部署到 Google Apps Script | RM0 |
| 资料库（17 张表 · 39 个设置） | Google Sheets | RM0 |
| 自动部署 | GitHub Actions + `clasp`（push 就上线） | RM0 |

> **1.2 修正了「同一个号码重复注册」**：电话号码一律规范化成 E.164
> （`0123456789` = `60123456789` = `+60 12-345 6789` = 同一个会员），
> 前后端使用同一套规则，注册在交易锁内查重；
> 旧的重复资料用 `dedupeCustomers()` 合并。详见 §5 与 DEPLOYMENT.md PART I。

---

## 0. 这个系统做什么 / 不做什么

**做：**

主流程 A —— foodcourt 的单（POS 点餐台 + 进单，任何员工）：

```
顾客在 foodcourt 点餐、付款（付款在 foodcourt 完成）
→ 员工在 POS 台点商品（像 POS 机：商品格 → 清单，收据金额不同就手动输入）
→ 记录单据 → 进「待进单」队列
→ 顾客出示会员码 → 员工扫码 → 确认
→ 后端自动计算：累计 Spend → Points → Tier
→ 自动产生 Reward → Reward 进入 Wallet → 促进下一次消费
```

主流程 B —— mini app 的单（自助点单，顾客自己下单）：

```
顾客开酒单（★ 一页搞定：选规格 → 加入购物车 → 看购物车 → 去结帐，
           不用一直换页等载入）
→ 选桌号或自取 → 结帐（可用钱包抵扣）
→ 员工订单看板接单 → 制作 → 完成（收款后才完成）
→ 完成时自动发 Points / Reward（§22），写进同一位会员的资料
```

> **2.1.4 起，会员端与员工端都是「打开就能用，不用等」：**
> · **预载**：会员首页载完会在背景按顺序抓好酒单 / 我的订单 / 钱包 /
>   钱包记录 / 消费与积分记录 / 待领奖励 / 会员资料；
>   员工端任何一页载完都会预热点餐台酒单 / 待进单 / 今日看板 / 订单看板
> · **先画快取、再补最新**（stale-while-revalidate）：酒单 10 分钟、
>   点餐台酒单 5 分钟、待进单 / 看板 20–30 秒、钱包与订单 1 分钟；
>   过期就当没有，回归正常载入 —— 不会拿旧资料骗人
> · **打后端之前先把画面画好**：网路慢（现场实测 3 秒）时，酒单与点餐台
>   仍然在 1 秒内出现
> · 酒单页搜寻 / 分类 / 风味筛选全部在本机做；点商品 → 底部抽屉选规格
>   （规格跟着酒单一起回来）→ 加入购物车，不用跳去 cart.html
> · 按过任何会改资料的动作（下单 / 兑奖 / 记录单据 / 进分 / 接单 / 收款）
>   就丢掉相关快取，下一眼看到的一定是最新
> · 快取按 scope 分：登入 / 登出会换 scope 并清空，换人用同一支手机
>   不会看到上一位会员或员工的资料；条码 / 扫码 / 钱包扣款永远不吃快取
> · **登出不等后端**：按下去立刻清 session、立刻跳登录页（后端只是顺带通知），
>   员工端每一页的顶栏都有登出

> **2.1.5 起，版本号码对齐 + 自动检查后端是否最新：**
> · `Config.gs` 的 `APP_VERSION`、`package.json`、`js/config.js`、
>   `service-worker.js` 快取名、20 个 `.gs` 档头现在都是同一个版本号
> · 新增 `npm run check:backend`：检查「`apps-script/` 有没有漏档 /
>   Code.gs 的 action 有没有指向不存在的函数 / 前端用到的 90 个 action
>   后端是否都有 / 版本号码是否一致 / `APPS-SCRIPT-COPY-PASTE.md`
>   有没有过期 / 用**真正的 .gs** 跑一次 POS 进单 + 会员点单端到端」
> · 员工端 **MORE 页最下方**会显示后端版本：
>   `✓ 后端 v2.1.5 · 已是最新版`，若还贴着旧版会红字提示重新贴 Apps Script
> · 规则：**任何 `.gs` 的改动都先更新到 GitHub**，再从 GitHub 贴到 Apps Script

Foodcourt Claim（1.x 原流程，保留但已移出员工首页、入口在 MORE，仅 MANAGER / OWNER）：

```
经理建立 Claim（生成 QR）→ 顾客自己扫码认领 → 绑定会员 → 同上
```

**不做（Phase 1 明确排除）：**

Foodcourt API、线上付款闸（DuitNow / FPX / 信用卡）、**真正的 POS 收银**
（2.1 的员工端点餐台只是「点商品 → 记录单据 → 扫会员码进分」，
不接钱箱 / 不刷卡，付款仍在 foodcourt 柜台）、库存、会计、
厨房系统、订位、外送、WhatsApp 自动化、SMS OTP、Native App、多分店、拆单积分。

> 「线上点餐」在 2.0 已经做了（自助点单 + 员工看板），
> 但**只做到产生订单**，不做收银与厨房 ERP。付款仍在柜台完成。

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
├── index.html           会员首页 ★ 只有活动幕布 + 四个入口（下单 / 会员码 / 会员中心 / 我的订单）
├── login.html           手机登录 / 注册
├── claim.html           扫码或输入 Code 认领消费
├── reward.html          打开奖励（动画）
├── wallet.html          我的钱包
├── activity.html        消费 / 积分 / 钱包记录
├── profile.html         会员资料 · 隐私说明
│
├── admin/               员工端
│   ├── login.html       员工登录
│   ├── index.html       员工首页（POS / 订单看板 / 菜单状态 / 扫码抵扣 + 今晚统计）
│   ├── pos.html         ★ POS 点餐台 + 进单（商品格 → 清单 → 扫会员码进分）
│   ├── orderboard.html  ★ App 订单看板（接单 / 制作 / 完成 → 自动进分）
│   ├── claim.html       建立 Claim → QR + Code（备用路径，Manager+）
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
├── apps-script/         ★ 生产后端（Google Apps Script，20 个 .gs · 84 个 action）
│   ├── Code.gs          Web App 入口（doPost / doGet · action 分派 · 交易锁）
│   ├── Config.gs        17 张 Sheet 的栏位定义 · 39 个设置 · 错误讯息
│   ├── Utils.gs         时间 · 金额(SEN) · SHA-256 · ★ 电话 E.164 规范化
│   ├── Database.gs      Sheets 存取层 · setupDatabase() · upgradeToV2() · dedupeCustomers()
│   ├── Security.gs      Session（只存 hash）· 角色 · Rate limit
│   ├── Auth.gs          ping · 员工登录（失败 6 次锁 5 分钟）
│   ├── Customers.gs     ★ 查号码/注册/密码登录（同一个号码只有一笔）
│   ├── Orders.gs Claims.gs Points.gs Rewards.gs Wallet.gs
│   ├── Promotions.gs Admin.gs Audit.gs
│   │  ↓ 2.0 点单（新增 6 个）
│   ├── Menu.gs          酒单：分类 / 商品 / 规格 · 促销价 · 售罄 · 快取
│   ├── Checkout.gs      结帐报价：后端重算价格 · Quote 5 分钟 · 幂等识别码
│   ├── AppOrders.gs     订单：placeOrder（幂等）· 查询 · 取消 · 再点一次 · 快照
│   ├── OrderBoard.gs    员工看板：接单 / 制作 / 完成（幂等）· 收款才扣钱包
│   └── Analytics.gs     业绩分析：今日统计 · 通路业绩 · 热销 · 会员
│   ├── appsscript.json  Apps Script manifest（V8 · 时区 · 权限）
│   ├── .clasp.json.example  部署设定范本
│   └── README.md        部署 / 自动推送 / 维护工具
│
├── tools/                部署辅助（不参与线上流程）
│   ├── build-copypaste.js  把 apps-script/*.gs 整合成 APPS-SCRIPT-COPY-PASTE.md
│   ├── load-backend.js     把 apps-script/*.gs 载入 Node（工具用）
│   └── google-shim.js      在 Node 里模拟 Sheets / Lock / Properties
│
├── .github/workflows/
│   └── deploy-apps-script.yml push apps-script/ 之后用 clasp 自动部署后端
│
├── manifest.json         PWA（可加到手机主画面）
├── service-worker.js     只 Cache App Shell，不 Cache 任何敏感资料
├── DEPLOYMENT.md         零基础部署教学
└── apps-script/README.md 后端部署与自动推送
```

---

## 3. 现场怎么用

### A. Foodcourt 的单（员工端 POS 点餐台 · 任何角色）

1. 顾客在 foodcourt 点餐、付款（**付款在 foodcourt 完成，App 不收款**）
2. 员工端 → 首页 `POS 进单`（或底部 `POS`）
3. **点餐台 KIOSK**（像 POS 机）：搜寻或点分类 → 点商品 → 底部那张单累积件数与金额
   - 有规格的商品（Size / ICE / SWEETNESS）会先跳规格表，可以顺手选数量
   - 点错了：格子上的 `−` 先减一杯；要细改就开 `清单 TICKET`，每行可以
     `+` / `−` / `✕`（减到 0 就移除）、也能整张清空
   - 收据金额跟合计不一样（折扣 / 税）→ 勾「手动输入金额」用键盘打收据上的数字
   - 单据号码（例如 `FC8231`）、备注可以按「内用 / 外带」快速填
     → `记录单据 SAVE RECEIPT`
4. 单据进入「待进单」队列；一张单只会收一次，重复单号会被挡
   - 忙的时候可以先把几张单录进队列，顾客来了再逐张扫码
   - 记录完会直接接到扫码步骤（现场最常见的顺序）
5. 顾客出示会员码 → 扫一维条码（或请顾客报出条码内容手动输入）
6. 确认画面显示会员与金额 → `确认进分 CONFIRM`
   → `+86 分`、满门槛自动发 Reward、六小时内只算一次到店
7. 结果页 `下一张 NEXT TICKET` 回到点餐台

> 清单（点了什么）会写进单据的备注栏，队列与确认画面都看得到；
> 积分只看金额，清单不影响分数（§57）。

> 单据录错 → 队列里点 `取消 ✕`（还没进分的单据才能取消）。
> 已经进分的单据不能在 POS 取消 —— 那会动到积分与 Reward，
> 要走「订单」页由 Manager 处理。

### B. Mini app 的单（顾客自己下单）

1. 顾客 → 首页 `下单` → 酒单 → 购物车 → 结帐（可用钱包抵扣）
2. 员工端 → `ORDER BOARD` → `接单 → 开始制作 → 做好了`
3. 收款：`收款并标记 PAID`（用钱包会**在这一步**才真的扣，§54）
4. `完成订单 COMPLETE` → 自动发积分 / Reward，顾客的 `我的订单` 也看得到

> Mini app 的单不需要再扫会员码 —— 下单的人就是会员本人（§22）。

### C. 备用：Foodcourt Claim（生成 QR，Manager / Owner）

1. 员工端 → `MORE` → `Create Claim` → 来源 `FOODCOURT`、单号、金额
2. 画面出现 QR + Claim Code（例如 `Y7K2`）
3. 顾客 → 首页右上角 `认领` → 扫码或输入 Code → `CLAIM MY ORDER`
4. 得到 `+86 POINTS` → `OPEN REWARD` → 奖励进 Wallet

> ★ 员工首页**没有** `+ CREATE CLAIM` 按钮；首页四个大按钮是
> POS 进单 / ORDER BOARD / MENU STATUS / SCAN & REDEEM。

### D. 钱包抵扣（顾客想用钱包余额付 foodcourt 的钱）

1. 顾客 → `会员码`
2. 员工端 → `SCAN & REDEEM` → 扫会员码 → 输入账单金额
3. 系统算出可抵扣上限（钱包余额 vs 20% 上限）→ `CONFIRM REDEEM`

### 员工权限（后端硬规定，不是画面隐藏）

| 角色 | 可以做 |
|---|---|
| `staff` | POS 进单、订单看板与完成订单、查找会员、钱包抵扣、菜单上下架 / 标售罄 |
| `manager` | 以上 + 设置、调整积分/钱包、Audit Log、取消订单、建立 Claim、改价 / 新增商品、业绩报表 |
| `owner` | 全部（含员工账号管理） |

> 以 plain STAFF 实测：`createClaim` / `updateProduct` / `getSalesAnalytics`
> 一律回 `UNAUTHORIZED`；`createPosTicket` / `getPosQueue` / `bindPosTicket` /
> `cancelPosTicket` / `grantOrder` / `redeemWallet` / `scanMemberCode` /
> `completeOrder` 都放行。

---

## 4. 维护

### ★ 改后端（apps-script/*.gs）的固定流程

**任何 .gs 的改动都只从 GitHub 走** —— 不要在 Apps Script 编辑器里直接改，
否则线上和 GitHub 会变成两个版本。

```bash
# 1) 改 apps-script/*.gs
# 2) 重新产生复制贴上文件（少了这步 GitHub 上就是旧版）
npm run build:copypaste
# 3) 检查：版本号码一致 / 前端用到的 action 后端都有 / 复制贴上文件没过期 /
#    用「真正的 .gs」跑一次 POS 进单 + 会员点单端到端
npm run check:backend
# 4) commit + push
```

`npm run check:backend` 全部通过时，GitHub 上的 `apps-script/*.gs`
就是最新版；它也会检查每个 `.gs` 档头写的版本号码（现在是 `2.1.5`）
跟 `package.json`、`js/config.js`、`service-worker.js` 一致。

**贴完怎么确认贴的是最新版？**
用员工账号进 **MORE 页**，最下面会显示：

- `✓ 后端 v2.1.5 · 已是最新版` → 贴对了
- `⚠ 后端 vX ≠ 前端 v2.1.5 · 请重新贴 Apps Script` → 还是旧版

（后端版本来自 `ping` 回的 `APP_VERSION`，也就是 `Config.gs` 那一行。）

部署后端有两条路（择一）：

1. **手动**：打开 Apps Script 编辑器，照 `APPS-SCRIPT-COPY-PASTE.md` 贴上 20 个档案
2. **自动**：把 `apps-script/` push 上 GitHub，`.github/workflows/deploy-apps-script.yml`
   会用 `clasp` 自动推送并建立新版本（需要 `CLASP_SCRIPT_ID` / `CLASPRC_JSON` 两个 secrets）
   —— 这个 workflow 只在 `main` 分支生效，所以在分支上开发时要手动贴

> 本机 demo 服务器与自动化测试套件已在 2.1 移除（线上版不需要它们）。
> 旧版仍在 git 历史里：`git log -- demo/`。

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

会员端使用「**手机号码 + 密码**」登录（不使用 WhatsApp / SMS OTP，RM0）。
密码以每个会员独立 salt 的 SHA-256 储存，Sheet 里看不到明文；
连续输错 6 次锁定 5 分钟。

因此系统 **不允许** 仅凭会员登录执行：

- 手动转账 Wallet
- 敏感资料修改
- 任何 Admin 功能

会员忘记密码时由 Manager / Owner 在员工端 `MEMBERS → RESET PASSWORD` 重设。

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

> 之后改后端只要 `git push`：CI 会先跑 2405 项测试，再用 `clasp` 部署，
> Web App URL 不变，前端不用动。设定方法见 `apps-script/README.md`。

---

## 9. 2.0 Smart Ordering

2.0 的完整计划书在 [`PLAN-2.0.md`](PLAN-2.0.md)（86 节）。

**进度：计划书里的 12 个 Phase 全部完成。**
顾客端（酒单 → 商品 → 购物车 → 结帐 → 订单追踪 → 我的订单）、
员工端（订单看板 · 菜单管理）、Owner（业绩报表）都已可用。

§84 那条现场流程（原本由 `test-mvp.js` 自动化，已在 2.1 移除）：
Jason 登入 → 酒单 → Mojito×2 + Long Island = RM72 → 钱包抵 RM8 → 桌号 A12 →
下单 → 员工接单 / 制作 / 完成 → 钱包只扣一次、积分只发一次（64 分，§57）、
到店只算一次、Reward 只产生一次 → **Jason 打开 Reward，钱包收到钱**。
同时确认 AppOrder / OrderItems / PointTransaction / WalletTransaction /
AuditLog 都正确写入，而 §85 的 Foodcourt 认领照常运作。

顾客端完整流程：
`menu.html`（★ 单页点单：搜寻 / 分类 / 风味 / 规格抽屉 / 购物车条，全部不换页）→
`checkout.html`（后端报价 + 桌号 / 外带 + 钱包 + 确认）→
`order.html`（订单进度追踪）/ `orders.html`（我的订单 + 再点一次）。
`product.html`（规格 + 备注的完整页）与 `cart.html`（购物车页）保留给
直接连结与返回键使用，功能与抽屉相同。

员工端：`admin/orderboard.html` —— 三栏看板（NEW / CONFIRMED / PREPARING / READY）、
等待计时、新单提示音（可 MUTE）、收款、完成、取消、一键暂停接单。
`admin/pos.html` —— foodcourt 通路：录入单据 → 待进单队列 → 扫会员码进分。

### 9.1 已经就位的东西

| 项目 | 内容 |
|---|---|
| 5 张新表 | `Categories` `Products` `ProductOptions` `AppOrders` `OrderItems`（§25–§30） |
| 12 个新设定 | `ORDERING_ENABLED` `ORDERING_OPEN_TIME 18:30` `ORDERING_CLOSE_TIME 00:00` `ALLOW_PICKUP` `ALLOW_TABLE_ORDER` `MAX_ORDER_ITEMS 20` `VISIT_SESSION_HOURS 6` `ORDER_POLL_SECONDS 8` `CUSTOMER_ORDER_POLL_SECONDS 12` `CHECKOUT_QUOTE_EXPIRY_MINUTES 5` `ORDERING_PAUSED` `MENU_CACHE_SECONDS 120`（§63） |
| 19 个点单错误码 + `BUSY` | `UPGRADE_REQUIRED` `ORDERING_CLOSED` `ORDERING_PAUSED` `MENU_EMPTY` `PRODUCT_NOT_FOUND` `PRODUCT_UNAVAILABLE` `CATEGORY_NOT_FOUND` `OPTION_NOT_FOUND` `OPTION_REQUIRED` `INVALID_QUANTITY` `TOO_MANY_ITEMS` `QUOTE_EXPIRED` `QUOTE_MISMATCH` `DUPLICATE_ORDER` `ORDER_NOT_FOUND` `ORDER_STATUS_INVALID` `ORDER_NOT_PAID` `ORDER_ALREADY_FINAL` `CANCEL_NOT_ALLOWED`（§66 / §43 / §44 / §55） |
| 升级工具 | `upgradeToV2({ backup: true })` + `reportUpgradeStatus()`（§67 / §71） |
| 菜单后端 | `apps-script/Menu.gs`（721 行）：`getMenu` `getCategories` `getProducts` `getProduct` `getProductOptions` + 员工 `setProductAvailability` + 老板 `createProduct` `updateProduct` `archiveProduct` `createCategory` `updateCategory` `createProductOption` `updateProductOption`（§60–§62） |
| 顾客页面 | `menu.html` `product.html` `cart.html` + `js/menu.js` `js/product.js` `js/cart.js` `js/cart-page.js`（§69） |
| 结帐后端 | `apps-script/Checkout.gs`（327 行）+ `apps-script/AppOrders.gs`（370 行）：`createCheckoutQuote` `getCheckoutQuote` `placeOrder` `getAppOrder` `getMyOrders` `requestOrderCancellation` `reorder` |
| 结帐页面 | `checkout.html` `order.html` `orders.html` + `js/checkout.js` `js/order.js` `js/orders.js` |
| 员工看板 | `apps-script/OrderBoard.gs`（460 行）：`getIncomingOrders` `getActiveOrders` `acceptOrder` `startPreparing` `markReady` `markPaymentPaid` `completeOrder` `cancelAppOrder` `setOrderingPaused` + `admin/orderboard.html` + `js/admin-orderboard.js` |
| Owner 菜单管理 | `admin/menu.html` + `js/admin-menu.js`：新增 / 编辑商品、价格、分类、排序、促销（§40）、图片 URL（§33）、下架；普通员工只能切换售罄（§32） |
| 业绩报表 | `apps-script/Analytics.gs`（308 行）+ `admin/analytics.html` + `js/admin-analytics.js`：今日统计、§51 通路业绩、热销商品、趋势图、会员分析 |
| 安全审计 | §81 的 12 项攻击逐条验：改价 / 假钱包 / 假 CustomerID / 假总额 / 重复下单 / 重复完成 / 完成未付款 / 同一笔钱包用两次 / 点售罄商品 / 未授权改商品 / 未授权完成 / 重放请求，加上 §83 锁与 §78 钱包压力 |
| 测试 | `test:upgrade` 142 · `test:menu` 139 · `test:menuui` 88 · `test:checkout` 155 · `test:orderboard` 159 · `test:orderui` 119 · `test:security` 214 · `test:analytics` 103 · `test:mvp` 115 · `test:admin-ui` 123 |

### 9.2 老板怎么升级（**不要重跑 `setupDatabase()`**）

在 Apps Script 编辑器里选 `Database` 档案，执行：

```javascript
upgradeToV2({ backup: true })   // 会先复制一份 Spreadsheet 再升级
```

它**只加不减**：

- 只建立「不存在」的 2.0 Sheet；已存在的一律不碰（连表头都不重写）
- 只补「不存在」的设定键；你改过的值（例如 `BAR_NAME`）不会被覆盖
- 只补「不存在」的序号键
- 升级前后逐张比对资料列数，**任何一张变少就会在回报里标出来**
- 可以重复执行：第二次跑会回报「新建 0 张、新增 0 个设定」

想确认状态就执行 `reportUpgradeStatus()`，它会列出还缺哪些表和设定。

> ⚠️ `setupDatabase()` 会重写表头并删掉「多出来的栏位」，对跑了一阵子的线上
> Sheet 是危险动作 —— 升级请用 `upgradeToV2()`。（测试 `08` 组也验证了
> `setupDatabase()` 重复执行本身不会清资料，但升级路径仍然只走 `upgradeToV2()`。）

### 9.3 还没升级也不会坏（§68 向后相容）

`SCHEMA` 里 2.0 的表标了 `v2: true`：Sheet 还没建时 `dbLoad()` 把它当**空表**，
不会抛 `SETUP_REQUIRED`。所以贴完新的 `Config.gs`、还没执行 `upgradeToV2()` 的那段时间，
1.x 的会员登录 / Claim / 钱包 / 积分 / 条码**照常运作**。
真的去写订单才会回 `UPGRADE_REQUIRED`，不会静默丢资料。

### 9.4 未来扩充

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

### 6.5 会员条码 → 员工扫码 → 才能抵扣钱包

以前员工端抵扣只要填 CustomerID，没有任何身分确认。现在的流程：

```
顾客：钱包页 / 我的 → 「出示会员条码」 → code.html
        （Code128 一维条码 + 同内容的 QR，每 60 秒自动换一条）
              ↓  店员扫
员工：admin/redeem.html → ① 扫码 → ② 确认是这位顾客
        → ③ 输入账单、计算可抵扣、确认抵扣
```

安全设计：

| 机制 | 说明 |
|---|---|
| 条码内容 | `YT1\|CustomerID\|随机码`，**不含电话、不含密码** |
| 时效 | 随机码的 SHA-256 存在 CacheService，`MEMBER_CODE_SECONDS`（预设 60 秒）后失效 |
| 一次性 | 扫过就作废，重扫回 `MEMBER_CODE_EXPIRED` |
| verifyToken | 员工扫到后取得，`MEMBER_VERIFY_SECONDS`（预设 180 秒）内有效 |
| 绑定 | verifyToken 只能用于「扫到的那位顾客 + 扫码的那位员工」，否则 `MEMBER_VERIFY_MISMATCH` |
| 强制 | `REQUIRE_MEMBER_CODE_SCAN = TRUE` 时，`redeemWallet` 没带 verifyToken 直接回 `MEMBER_VERIFY_REQUIRED` |

扫描方式：`BarcodeDetector`（Chrome / Android）直接读一维条码；
不支援的浏览器（iOS Safari）自动退回 jsQR 读条码下方那个 QR。
没有相机或非 HTTPS 环境时，页面会提示改用「手动输入」，不会报错。

载入体验（`code.html`）：**不使用全屏 loading 遮罩**。
第一次载入只在条码区显示占位骨架；换码时保留旧条码、只在下方显示
「更新中」，新码回来直接覆盖（不闪、不清空）；并在剩 30% 时间时
就先抓下一条，避免「旧的过期了、新的还没来」的空窗。
载入失败时错误码与重试钮显示在条码区内。

### 6.6 活动（Promotions）为什么客户端看不到

会员端看不到活动有**两种完全不同的原因**，画面上必须分得出来：

| 你看到 | 意思 | 怎么办 |
|---|---|---|
| 暂无活动 NO PROMOTION RIGHT NOW | 后端正常，只是没有符合今天日期的活动 | 员工端新增或改日期 |
| **活动载入失败 + 错误码** | 后端请求失败 | 看错误码（见下） |

> 以前这两种情况都画「暂无活动」，所以后端出问题（例如线上还是旧版、
> 没有 `getPromotions` 这个 action → `UNKNOWN_ACTION`）时，
> 顾客看到的是「没有活动」，根本无从发现故障。现在失败会显示错误码 + 重试钮。
>
> `UNKNOWN_ACTION` = 线上 Apps Script 还是旧版 → 重新贴 `Code.gs` 并重新部署
> （**「管理部署」要选新版本**，旧 `/exec` 网址会继续跑旧代码）。

要一眼看出原因，在 Apps Script 编辑器执行 **`reportPromotions()`**：

```
════ YETIPSY · Promotions 诊断 ════
今天（后端时区）= 2026-09-16
Promotions 表共 4 条
  ✓ PRM0001 | Cocktail Night | status=ACTIVE | 2026-08-17 → 2026-11-15 | VISIBLE
  ✗ PRM0003 | Expired Demo  | status=ACTIVE | 2020-01-01 → 2020-12-31 | EXPIRED
会员端现在会显示 2 条活动。
```

`getPromotions` 只回传**今天在有效期内且 ACTIVE** 的活动。
员工端 **SETTINGS → Promotions** 每一条都会直接标出原因：

| 标记 | 意思 | 怎么修 |
|---|---|---|
| ✓ 客户端看得到 | 正常 | — |
| ✗ 已过期 | `endDate` 早于今天 | 按「改日期」把结束日改到今天之后 |
| ⏳ 还没开始 | `startDate` 晚于今天 | 改开始日，或等它开始 |
| ○ 已停用 | `status = INACTIVE` | 按状态钮切回 ACTIVE |

> `setupDatabase()` 种的示范活动日期是**相对第一次执行那天**算的
> （-30 天 → +60 天），所以放久了会过期。用「改日期」救回来，
> 或切 INACTIVE 把它收起来。

### 6.4 会员登录：手机号码 + 密码（不使用 WhatsApp / SMS OTP）

登录流程（`login.html` 三步）：

```
① 输入手机号码  →  checkCustomerPhone
      │
      ├── exists = false（没重复）→ ② 设密码注册 customerRegister
      │
      └── exists = true （重复了）→ ③ 输入密码 customerLogin
                                     └ 若该帐号还没有密码（旧资料）
                                       → ③' 第一次设密码 customerSetFirstPassword
```

后端 `apps-script/Customers.gs`：

| Action | 行为 |
|---|---|
| `checkCustomerPhone` | 只回 `exists` / `needsPasswordSetup` / 遮罩名字，不回任何会员资料；有 rate limit |
| `customerRegister` | 号码已存在 → `PHONE_ALREADY_REGISTERED`（**绝不建立第二笔**）；密码存 Salted SHA-256 |
| `customerLogin` | 号码不存在 → `CUSTOMER_NOT_FOUND`（不会偷偷建帐号）；密码错 → `WRONG_PASSWORD`；连续 6 次 → 锁 5 分钟 |
| `customerSetFirstPassword` | 只有「还没有密码」的旧会员可用；设完即失效，之后必须用密码登录 |
| `changeCustomerPassword` | 需要当前密码 + 有效 session；改完其他装置的 session 全部失效 |
| `resetCustomerPassword` | Manager / Owner 在员工端重设（会员忘记密码的解方） |

可调规则都在 Settings：`CUSTOMER_PASSWORD_MIN`（预设 8）、`LOGIN_MAX_ATTEMPTS`（6）、
`LOGIN_LOCK_MINUTES`（5）、`PASSWORD_SELFSERVICE_SETUP`（预设 TRUE；
等旧会员都补设完密码后建议改成 FALSE，之后只能由店员重设）。

> 为什么不用 WhatsApp OTP：OTP 要走 BSP / Cloud API，会有费用与审核流程。
> 密码方案 RM0，而且「号码 + 密码」比「只填号码」安全得多 ——
> 别人知道你的号码也进不去。

登录页支持马来西亚 `+60` 与新加坡 `+65`；所有 API 请求有 15 秒超时，
网络 / GAS 无响应时不会无限转圈。

