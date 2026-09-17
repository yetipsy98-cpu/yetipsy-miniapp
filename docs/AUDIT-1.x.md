# YETIPSY 1.x 审计报告（2.0 Phase 1 · §70）

> 计划书 §70 明确要求：**先审计现有 1.x，不得凭计划书猜代码。**
> 这份报告的每个数字都来自对 `apps-script/*.gs`、`js/*.js`、`*.html` 的实际扫描，
> 不是推测。2.0 的每个 Phase 都以这份为基准。
>
> 审计基准：commit `b235897`（1.3.0）

---

## 1. 后端（Google Apps Script）

**15 个 `.gs` 档案，共 3333 行。**

| 档案 | 职责 | 2.0 会动到吗 |
|---|---|---|
| `Config.gs` | SCHEMA（12 表）+ 27 个设定 + 权限常量 | ✏️ 加 5 张表、10 个设定 |
| `Utils.gs` | E.164 正规化、错误码表、日期、`ok()`/`err()` | ✏️ 加订单相关错误码 |
| `Database.gs` | `dbLoad/dbFlush/dbInsert/dbById/dbFilter/dbNextId`、`setupDatabase()`、防重复注册工具 | ✏️ 加 `upgradeToV2()` |
| `Security.gs` | Session、`requireCustomer/requireStaff(token, roles)`、Rate Limit | ✅ 直接复用 |
| `Audit.gs` | `audit(actorId, actorType, action, targetType, targetId, old, new)` | ✅ 直接复用 |
| `Points.gs` | `computeTier` `membershipInfo` `issuePoints` `pointsForAmount` | ✅ **复用，不重写**（§57/§77） |
| `Rewards.gs` | `rewardBand` `rewardsGivenToday` `generateReward` | ✅ **复用，不重写**（§58） |
| `Wallet.gs` | `walletCredit` `walletRedemptionPlan` `redeemWallet` `manualWalletAdjustment` | ✏️ Checkout 要复用 `walletCredit` |
| `Customers.gs` | 密码登录、会员条码、`publicCustomer` `maskName` | ✅ 复用 |
| `Orders.gs` | 消费纪录与统计、`createMemberTransaction` | ⚠️ 见下方「关键发现 2」 |
| `Claims.gs` | Claim QR / 4 位码、`claimOrder` | ✅ 不动（§2 双通路） |
| `Promotions.gs` | 活动 CRUD + 可见性诊断 + `reportPromotions()` | ✅ 不动 |
| `Admin.gs` | Dashboard、会员查询、手动调整、重设密码、设置 | ✏️ 加订单看板入口 |
| `Auth.gs` | `ping` `getPublicSettings` `staffLogin` `staffLogout` | ✅ 复用 |
| `Code.gs` | `doPost()` 唯一入口、`PUBLIC_ACTIONS` 白名单 | ✏️ 注册新 action |

## 2. 现有 API（51 个 action）

从 `Code.gs` 的 handlers 抓出来的完整清单：

**公开（8 个，`PUBLIC_ACTIONS`）**
`ping, getPublicSettings, checkCustomerPhone, customerRegister, customerLogin,
customerSetFirstPassword, customerLogout, staffLogin`

**会员端（需 customer session）**
`changeCustomerPassword, getMemberCode, getProfile, updateProfile, getMembership,
getPoints, getPointHistory, getWallet, getWalletHistory, getPromotions,
getOrderHistory, getClaimByToken, getClaimByCode, claimOrder, getPendingReward,
claimReward`

**员工端（需 staff session）**
`scanMemberCode, staffLogout, getStaffSession, getDashboard, createClaim, cancelClaim,
getClaim, listClaims, searchCustomer, getCustomer, getCustomerHistory,
calculateWalletRedemption, redeemWallet, getOrders, cancelOrder,
manualWalletAdjustment, manualPointAdjustment, resetCustomerPassword`

**Manager / Owner**
`getSettings, updateSetting, getPromotionsAdmin, createPromotion, updatePromotion,
getAuditLogs, listStaff, createStaff, setStaffStatus`

> 2.0 要新增的 29 个 action（§60–§62）目前**一个都不存在**，名称无冲突。

## 3. 数据库（12 张表）

| 内部名称 | Sheet | 栏数 | maxRows |
|---|---|---|---|
| settings | Settings | 3 | — |
| sequences | Sequences | 2 | — |
| customers | Customers | 19 | — |
| staff | Staff | 8 | — |
| sessions | Sessions | 8 | 3000 |
| orders | Orders | 17 | — |
| claims | Claims | 10 | — |
| rewards | Rewards | 8 | — |
| pointTx | PointTx | 10 | — |
| walletTx | WalletTx | 10 | — |
| promotions | Promotions | 11 | — |
| audit | AuditLogs | 9 | 5000 |

> 计划书 §59 点名的 `PointTransactions` / `WalletTransactions` 在这里叫
> **`PointTx` / `WalletTx`**（内部名 `pointTx` / `walletTx`）。2.0 沿用现名，不改。

## 4. 认证与权限

- 会员：**手机号码 + 密码**（Salted SHA-256，`Customers.Salt/PasswordHash`），
  无 OTP。连续失败 `LOGIN_MAX_ATTEMPTS=6` 次锁 `LOGIN_LOCK_MINUTES=5` 分钟。
- 会员条码：`getMemberCode` → `scanMemberCode` → `verifyToken`（绑顾客 + 绑员工），
  `redeemWallet` 必须带。
- 员工角色：`STAFF` / `MANAGER` / `OWNER`，由 `requireStaff(token, ['MANAGER','OWNER'])` 控管。
  **§32「Staff 只能改 AVAILABLE」可直接用这套。**
- Session：token 只存 SHA-256，会员 30 天 / 员工 12 小时（`STAFF_SESSION_HOURS=12`）。

## 5. 可复用引擎（§77 要求不要重写）

| 引擎 | 函数 | 2.0 怎么用 |
|---|---|---|
| Points | `pointsForAmount(billAmount, walletUsed)` → 依 `POINTS_CALCULATION=NET_PAID` | `completeOrder()` 里呼叫 |
| Points | `issuePoints(customer, order, points, desc, actorId, actorType, type)` | 同上，写 PointTx |
| Membership | `computeTier(points)` `membershipInfo(customer)` | 同上 |
| Reward | `generateReward(customer, order, amountSen)` | 同上（含 `REWARD_MIN_SPEND=30`、每日预算） |
| Wallet | `walletCredit(customer, order, amountSen, type, desc, actorId, actorType)` | 抵扣与 reversal 都用它，保证 WalletTx 完整（§54） |
| Wallet | `walletRedemptionPlan(customer, billSen)` | **Checkout Quote 直接复用**（已含 20% 上限与最低账单） |
| Audit | `audit(...)` | 每个订单状态转换都写一笔 |
| ID | `dbNextId(prefix, key, len)` | `AppOrderID` / `OrderNumber` 用它 |
| 锁 | `LockService`（`dbLoad`/`dbRelease` 已包在交易锁内） | 满足 §83 |

## 6. 前端

**18 个页面**：`index login claim reward wallet activity profile code preview` +
`admin/{login,index,claim,customers,orders,settings,audit,staff,more,redeem}.html`

**20 个 JS**：`app auth api config ui claim reward wallet activity profile code` +
`admin{,-dashboard,-claim,-customer,-orders,-settings,-audit,-staff,-redeem}` +
`vendor/{qrcode,jsQR,jsbarcode.min}.js`

> ⚠️ **`admin/orders.html` 与 `js/admin-orders.js` 已存在**（1.x 的订单列表）。
> 计划书 §19/§69 要求新增同名档案 —— 必须**改名或改造**，不能覆盖（§68 向后相容）。
> 建议：2.0 的看板叫 `admin/orderboard.html` + `js/admin-orderboard.js`，
> 旧的 `admin/orders.html` 保留为「历史订单查询」。

## 7. 测试基线（升级不得让任何一项变红）

| 套件 | 检查数 |
|---|---|
| `demo/test-apps-script.js` | 86 |
| `demo/tests.js` | 242 |
| `demo/smoke-ui.js` | 354 |
| `demo/e2e-ui.js` | 57 |
| `demo/test-login-ui.js` | 27 |
| `demo/test-copypaste.js` | 60 |
| `demo/test-scan-ui.js` | 66 |
| `demo/test-home-ui.js` | 12 |
| **合计** | **904** |

---

## 关键发现（会改变 2.0 做法的 4 件事）

**1. `setupDatabase()` 本来就不会清资料。**
它会补建缺失的 Sheet、用 `insertColumnsAfter` 补缺失的栏位，示范活动只在
`Promotions` 为空时写入。所以 §67 担心的「重新执行会清空资料」在 1.3 已不成立。
但 §67 仍要求一个**显式、只增不改、可回报**的入口 —— 因此 2.0 提供 `upgradeToV2()`，
内部走同一条安全路径，并回传升级报告（建了哪些表、加了哪些设定、旧资料列数前后对比）。

**2. 1.x 的 `Orders` 表是「已完成的消费纪录」，不是订单流程表。**
`createMemberTransaction` 一建立就是 `claimStatus=CLAIMED`、`completedAt` 已填。
所以 2.0 **不能复用 `Orders` 存 `SUBMITTED/PREPARING/READY`**，必须用新的
`AppOrders`（§29），完成后再由现有流程写一笔 `Orders`（保留 §51 通路分析的能力）。

**3. `getOrderHistory` 读的是 `Orders`。**
2.0 的「我的订单」必须合并两个来源（`AppOrders` + `Orders`），否则顾客在
`activity.html` 看不到 App 订单，或在 `orders.html` 看不到 Foodcourt 消费。

**4. 钱包上限逻辑已经存在且经过测试。**
`walletRedemptionPlan()` 已实作 `MAX_WALLET_USAGE_PERCENT=20`、
`MIN_WALLET_REDEEM_BILL=30`、`min(余额, 上限)`。§10/§43 的 Checkout Quote
**直接呼叫它**即可，不要重写第二套（否则两边规则会漂移）。
