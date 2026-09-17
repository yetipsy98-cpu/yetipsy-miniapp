# YETIPSY MINI APP 2.0 · SMART ORDERING SYSTEM

> Foodcourt Hybrid Ordering + Membership + Points + Wallet + Rewards
>
> 这份是 2.0 的正式计划书（原本由 Owner 撰写，这里原样收进 repo 做唯一依据）。
> **实作前必读 §70：Phase 1 先审计现有 1.x，不得凭计划书猜代码。**
> 审计结果见 [`docs/AUDIT-1.x.md`](docs/AUDIT-1.x.md)。

---

## 阶段进度

| Phase | 内容 | 状态 |
|---|---|---|
| 1 | 审计现有 1.x（§70） | ✅ 完成 · `docs/AUDIT-1.x.md` |
| 2 | 数据库升级 `upgradeToV2()`（§71） | ✅ 完成 · 5 张新表 + 12 个新设定，不动旧资料 · `test:upgrade` 142 项 |
| 3 | Menu（§72） | ✅ 完成 · `Menu.gs` + `menu.html` `product.html` · `test:menu` 139 项 · `test:menuui` 88 项 |
| 4 | Cart（§73） | ✅ 完成 · `cart.html` + `js/cart.js`（LocalStorage，价格最终由后端验证） |
| 5 | Checkout + Quote（§74） | ✅ 完成 · `Checkout.gs` · Quote 5 分钟 · IdempotencyKey · `test:checkout` 155 项 |
| 6 | 建立订单（§75） | ✅ 完成 · `AppOrders.gs` · `placeOrder` 幂等 · 订单追踪页 |
| 7 | 员工订单看板（§76） | ⬜ 未开始 |
| 8 | 会员整合（§77） | ⬜ 未开始 |
| 9 | Wallet 接入 Checkout（§78） | ⬜ 未开始 |
| 10 | Owner 菜单管理（§79） | 🟡 后端 7 个 action 已就位并通过权限测试；`admin/menu.html` 页面未做 |
| 11 | Analytics（§80） | ⬜ 未开始 |
| 12 | 安全审计（§81） | ⬜ 未开始 |

### Phase 5+6 已验证的规则

| 规则 | 怎么验的 |
|---|---|
| §84 MVP | Mojito×2 + Long Island = 小计 7200；钱包 RM8.68 全用（20% 上限 1440）；应付 6332；预估积分 63；订单号 `YT260917001`；桌号 A12；状态 SUBMITTED / UNPAID |
| §41/§42 前端不能定价 | items 里塞 `price:1 / lineTotal:1`、外层塞 `subtotal:1 / total:1 / discount:99999` → 小计仍是 2200 |
| §43 Quote | 用过即失效；假 token 被拒；**别人的 Quote 报 QUOTE_EXPIRED**；TTL 压到 0 秒后立刻过期 |
| §44 幂等 | 同 key 连下两次 → `duplicate:true` 且 AppOrders 只有 1 列；没带 key 被拒；拿旧 Quote 配新 key 报 QUOTE_MISMATCH |
| §54 钱包 | 下单后 `walletRequested=868` 但 `walletUsed=0`，钱包余额没变；取消后仍是 0（没扣过所以不需 reversal） |
| §22 完成才发 | SUBMITTED 时 `pointsEarned=0`、会员 `currentPoints/totalVisits/totalSpend` 全部不变 |
| §66 售罄 | 报价后员工标售罄 → 下单被 `PRODUCT_UNAVAILABLE` 挡下，且没有产生订单 |
| §64/§65 开关 | 非营业时间 / `ORDERING_PAUSED` 都不能报价；**报价之后才被暂停 → 下单也被挡** |
| §30 快照 | 下单后把 Mojito 改成 RM25、再下架 → 旧订单仍显示 RM22.00、总额 7200、名称读得到 |
| §37 再点一次 | 2 项都能重新加入并保留规格；卖完的那项被排除并列进 `unavailable` |
| §12 防伪造 | 别人的订单 `getAppOrder` / `cancel` / `reorder` 全部 ORDER_NOT_FOUND |
| §57 积分基础 | 修掉一个真实错误：原本把「已扣钱包的 finalAmount」再传进 `pointsForAmount()` 造成扣两次（54 分），改成传毛额后正确得到 63 分 |

### Phase 3 已验证的规则（不是「看起来对」，是测试跑出来的）

| 规则 | 怎么验的 |
|---|---|
| §41 价格只由后端定 | 会员带 `price:1` 呼叫 `getProduct`，回传仍是 Sheet 里的 2200；对外形状没有 `priceSen` 栏位 |
| §40 促销时间窗由后端判断 | 未开始 / 进行中 / 已过期 / 促销价高于原价 四种情形都测；负数促销价被拒 |
| §32 Staff 只能改库存 | STAFF 账号可以 `setProductAvailability`，但 `createProduct` `updateProduct` `archiveProduct` `createCategory` `createProductOption` 全部 `UNAUTHORIZED` |
| §31/§66 售罄 | 员工标售罄 → 顾客端菜单与详情页立刻显示；加入清单按钮停用；硬点也写不进购物车 |
| §82 缓存 | 第二次 `getMenu` 命中缓存；改商品 / 价格 / 规格后缓存失效；**钱包与积分连续两次读取数值不同（没被缓存）** |
| §64 营业时间 | 关闭 / 暂停时菜单照常列出，并显示对应横幅；`ORDERING_PAUSED` 可一键切换 |
| §5/§8 不 Hardcode | 新增一组 `EXTRA` 规格后，详情页立刻多出一个区块 |
| §34/§35 搜寻筛选 | 中英文都可搜（`mojito` 与「莫希托」都是 2 项）、描述可搜、tag 可筛、可叠加 |
| 失败不伪装 | 后端回 `UPGRADE_REQUIRED` 时页面显示「酒单载入失败 + 错误码 + 重试」，不是「没有商品」 |
| 审计留痕 | `CREATE_CATEGORY` `CREATE_PRODUCT` `UPDATE_PRODUCT`（含改前 2200 / 改后 2500）`PRODUCT_SOLD_OUT` `ARCHIVE_PRODUCT` 都写进 AuditLogs |

---

# 1. PROJECT OBJECTIVE

1.x 已完成（**2.0 不重新开发**）：Customer Account、Membership、Points、Wallet、Reward、
Claim Purchase、Member Barcode、Customer Profile、Activity History、Staff Login、
Foodcourt Order Claim。

2.0 核心目标：在现有系统上增加 **YETIPSY ORDERING SYSTEM**，让顾客可以：

```
扫码 → 进入 Yetipsy → 查看 Menu → 选择鸡尾酒 → 加入购物车 → 选择桌号 → 提交订单
  → Staff 收到订单 → 确认 → 制作 → Ready → Completed
  → 自动进入会员消费 → Points → Reward → Wallet
```

# 2. IMPORTANT ARCHITECTURE

Yetipsy 仍在 Foodcourt 环境，必须同时支持两条通路：

**CHANNEL A — Foodcourt Ordering System**
`Foodcourt → Customer Order → Staff → Existing Claim System → Membership`

**CHANNEL B — Yetipsy Ordering System**
`Yetipsy Mini App → Menu → Cart → Order → Staff → Completed → Membership automatically credited`

两个系统同时存在。**不得移除现有 Foodcourt Claim 功能。**

# 3. 2.0 CORE PHILOSOPHY

不是大型 POS。目标：**Mobile Ordering + Customer Retention**。
重点：`MENU / ORDER / MEMBER / POINTS / REWARD / WALLET`。

不要开发：Accounting、Payroll、Complex Inventory、Kitchen ERP、Full POS。

# 4. CUSTOMER HOME 2.0

重新设计首页：问候 + 名字 + 等级 + 积分 → **ORDER NOW**（今晚喝什么？VIEW MENU →）
→ MY WALLET → Tonight（活动）→ Quick Actions `[MENU] [CLAIM] [WALLET] [MEMBER]`。

Bottom Navigation：`HOME · MENU · ORDERS · WALLET · MEMBER`

# 5. MENU SYSTEM

新增 `menu.html`。分类：SIGNATURE 招牌特调、CLASSIC 经典鸡尾酒、GIN 金酒、VODKA 伏特加、
RUM 朗姆、WHISKY 威士忌、TEQUILA 龙舌兰、TOWER 酒塔、SHOT、NON-ALCOHOL 无酒精。

**所有 Category 必须后台可修改，不要 Hardcode。**

# 6. PRODUCT CARD

图片 + 名称（EN/ZH）+ 描述（如 `Mint · Lime · Rum`）+ 价格 + `[+]`。点击进入 Product Detail。

# 7. PRODUCT DETAIL

名称、图片、风味标签（清爽/薄荷/青柠 · Refreshing/Minty/Citrusy）、价格、
Size（Regular / Large +RM6）、Customization（ICE：Normal / Less Ice）、
条件式 SWEETNESS（Normal / Less Sweet）、Special Request 备注、数量 `[-] 1 [+]`、
`ADD TO CART RM22`。

# 8. PRODUCT OPTIONS

**不要把 Size 写死。** 建立 `ProductOptions`：Option Group（如 SIZE）→ 选项 + 加价。
未来可扩 Extra Shot +RM8、Less Sweet RM0、No Ice RM0。

# 9. CART

新增 `cart.html`：YOUR ORDER → 每项（名称/规格/单价/数量/小计）→ SUBTOTAL →
若有钱包：`YETIPSY WALLET · Available RM8.68 · □ Use Wallet`。

# 10. WALLET IN ORDERING

`MAX_WALLET_USAGE_PERCENT = 20`，Bill RM72 → 上限 RM14.40；钱包只有 RM8.68 →
可用 RM8.68，顾客可勾选。

**不要在 Cart 阶段真正扣 Wallet**，只记录 `RequestedWalletAmount`；
最终订单确认时 Backend 才扣。

# 11. TABLE SYSTEM

不要假设所有桌子都是 Yetipsy 自己的。支持：`TABLE NUMBER` / `TAKEAWAY` / `COUNTER PICKUP`。
顾客端：`Where are you sitting? Table Number [A12]` 或 `○ Counter Pickup`。

# 12. TABLE QR

未来若有自己的桌牌，QR 内容 `/app/?table=A12`；扫后自动 `Table = A12`，不需重输。

# 13. ORDER CONFIRMATION

`YOUR ORDER · 3 ITEMS · RM72.00 · Wallet -RM8.68 · TOTAL RM63.32 · Table A12 · [PLACE ORDER]`

# 14. PAYMENT — PHASE 2.0

第一阶段**不接 Payment Gateway**。订单提交后显示 `ORDER #YT260917001 · RM63.32`，
付款方式 `PAY AT COUNTER 柜台付款` 或 `FOODCOURT PAYMENT`，由 Staff 处理收款。

# 15. FUTURE PAYMENT

数据库必须预留 `PaymentMethod` / `PaymentStatus` / `PaymentReference`。

- PaymentMethod：`COUNTER CASH DUITNOW CARD FOODCOURT ONLINE`
- PaymentStatus：`UNPAID PENDING PAID REFUNDED FAILED`

# 16. ORDER STATUS

`SUBMITTED → CONFIRMED → PREPARING → READY → COMPLETED`，另有 `CANCELLED`。顾客可实时查看。

# 17. CUSTOMER ORDER TRACKING

新增 `order.html`：订单号 + 进度（✓ ORDER RECEIVED / ✓ CONFIRMED / ● PREPARING /
○ READY / ○ COMPLETED）+ 品项 + 总额。

# 18. READY SCREEN

Staff 点 `READY` 后顾客页面显示：`YOUR DRINKS ARE READY 🍸 · Order #… ·
Please collect your drinks at Yetipsy. · [VIEW ORDER]`

# 19. STAFF ORDER DASHBOARD

新增 `admin/orders.html`（**2.0 最重要的 Staff 页面**）。
NEW 区列出订单（编号 / 桌号或 PICKUP / 金额 / 品项数）+ `[ACCEPT]`。

# 20. ORDER KANBAN

Desktop / Tablet：`NEW | PREPARING | READY` 三栏，Staff 可点
`ACCEPT / START / READY / COMPLETE`。

# 21. ORDER DETAIL — STAFF

订单号、TABLE、CUSTOMER（名字 + 等级）、品项（含规格）、NOTE、
SUBTOTAL / WALLET / TOTAL、PAYMENT 状态。
Actions：`CONFIRM PAYMENT / START PREPARING / READY / COMPLETE / CANCEL`。

# 22. VERY IMPORTANT — Points 与 Reward 的时机

**只能在 COMPLETED ORDER 后发放。** 不能 Place Order 就给 Points，
否则 `Place Order → 拿积分 → 取消` 会产生漏洞。

正确顺序：`SUBMITTED → CONFIRMED → PAID → PREPARING → READY → COMPLETED
→ ISSUE POINTS → GENERATE REWARD`

# 23. ORDER → MEMBERSHIP

Yetipsy App 订单**不需要 Claim**（顾客已登录，建立订单时已绑定 CustomerID）。
完成后：`TotalSpend + / Visits + / Points + / Tier Update / Reward`。

# 24. FOODCOURT ORDERS REMAIN DIFFERENT

Foodcourt：`Order → Claim QR → Customer Claims → Points → Reward`。
Yetipsy App：`Order → 已识别顾客 → Complete → Points 自动 → Reward`。

两种模式共用：**Points Engine / Reward Engine / Wallet Engine / Membership Engine**。

# 25. DATABASE — NEW TABLES

保留 1.x 所有 Sheets，新增：`Products`、`Categories`、`ProductOptions`、`AppOrders`、`OrderItems`。

# 26. PRODUCTS

`ProductID, CategoryID, NameEN, NameZH, DescriptionEN, DescriptionZH, PriceSen,
ImageURL, Status, Available, SortOrder, CreatedAt, UpdatedAt`

例：`PRD001 / CLASSIC / Mojito / 经典莫希托 / Refreshing mint & lime / 清爽薄荷青柠 /
2200 / /image/mojito.webp / ACTIVE / TRUE / 1`

# 27. CATEGORIES

`CategoryID, NameEN, NameZH, Status, SortOrder`

# 28. PRODUCT OPTIONS

`OptionID, ProductID, OptionGroup, NameEN, NameZH, PriceAdjustmentSen, Status, SortOrder`
例：`OPT001 / PRD001 / SIZE / Large / 大杯 / 600 / ACTIVE`

# 29. APP ORDERS

`AppOrderID, CustomerID, OrderNumber, TableNumber, OrderType, SubtotalSen,
WalletRequestedSen, WalletUsedSen, DiscountSen, FinalAmountSen, PaymentMethod,
PaymentStatus, OrderStatus, CustomerNote, CreatedAt, ConfirmedAt, ReadyAt,
CompletedAt, CancelledAt, HandledBy`

# 30. ORDER ITEMS

`OrderItemID, AppOrderID, ProductID, ProductNameSnapshot, UnitPriceSen, Quantity,
OptionsJSON, OptionsPriceSen, LineTotalSen, CustomerNote, CreatedAt`

**必须保存 `ProductNameSnapshot` 与 `UnitPriceSen`**：订单历史不得永远读取 Products 的
当前价格。今天 Mojito RM22，以后改 RM25，旧订单仍须显示 RM22。

# 31. PRODUCT AVAILABILITY

Staff 可切 `AVAILABLE / SOLD OUT`。Customer Menu 显示 `SOLD OUT 售罄`，不能加入 Cart。

# 32. MENU ADMIN

新增 `admin/menu.html`。Owner / Manager：`ADD PRODUCT / EDIT PRODUCT / PRICE / IMAGE /
CATEGORY / AVAILABLE / SORT ORDER`。**Staff 只能改 `AVAILABLE / SOLD OUT`。**

# 33. MENU IMAGE STRATEGY

第一阶段不要把图片放 Google Sheets。Sheets 只存 `ImageURL`；图片放
`GitHub /assets/menu/`（例如 `/assets/menu/mojito.webp`），**优先 WEBP** 减少加载时间。

# 34. SEARCH

Menu 支持 `Search cocktails...`，可搜中英文（Mojito / 莫希托 / Gin / 金酒）。

# 35. FILTER

简单 Filter：`Refreshing / Sweet / Strong / Fruity`。因此 Products 增加 `Tags`
（例如 `refreshing,citrus,mint`）。

# 36. COCKTAIL STRENGTH（可选）

可显示 `LIGHT / MEDIUM / STRONG`，但**不要显示精确 ABV**，除非后台有可靠数据。

# 37. REORDER

Order History 每项提供 `[ORDER AGAIN]`，把**仍然 AVAILABLE** 的商品重新加入 Cart。

# 38. FAVORITES — OPTIONAL 2.1

预留 `Favorites`，2.0 MVP 不一定实现。

# 39. PROMOTIONS + MENU

现有 Promotions 可升级：例如 `WEDNESDAY / GODDESS NIGHT` → 点击 `ORDER NOW`
直接打开相关产品。

# 40. PRODUCT PROMOTION

Products 增加 `OriginalPriceSen, PromoPriceSen, PromoStart, PromoEnd`。
**Backend 判断 Promo 是否有效，Frontend 不决定价格。**

# 41. PRICE SECURITY（极重要）

Customer Frontend 只能发送 `ProductID / Quantity / Options`，
**不能告诉 Backend 价格**。Backend 必须自己读 `Products` 重新计算，
防止顾客改 Browser 把 RM22 改成 RM0.01。

# 42. CART SECURITY

Frontend Cart 只是 DISPLAY。Checkout 时 Backend：
`Receive Product IDs → Read Current Prices → Validate Availability → Validate Options →
Calculate Subtotal → Calculate Wallet → Return Checkout Quote`。
Customer Confirm 后才 `Create Order`。

# 43. CHECKOUT QUOTE

新增 `createCheckoutQuote`：`Cart → Backend Quote → RM72 → Wallet max RM8.68 →
Final RM63.32 → Customer confirms → placeOrder()`。
Quote 设短 Expiry（例如 **5 分钟**），避免价格修改后的问题。

# 44. DOUBLE ORDER PROTECTION

顾客快速点两次 `PLACE ORDER` 不能产生两个订单 → 使用 **IdempotencyKey**：
每次 Checkout 产生随机 Key，Backend 对相同 Key 只建立一个订单。

# 45. ORDER NUMBER

显示格式 `YT260917001 / 002 / 003`；内部使用独立的 `AppOrderID`，OrderNumber 只做显示。

# 46. ORDER NOTIFICATION

GitHub Pages + Apps Script 没有真正 WebSocket。Staff Dashboard 每 **5–10 秒**自动检查新订单。
**不要 1 秒 polling**，避免 Apps Script 请求量过高。

# 47. CUSTOMER TRACKING

顾客订单状态同样 **10–15 秒** polling，**只有订单页面打开时才 Poll**，订单完成即停止。

# 48. SOUND ALERT

Staff Dashboard 新订单播放 `ding` + `NEW ORDER` 视觉提示，**必须提供 MUTE 按钮**。

# 49. ORDER TIMER

Staff 端显示等待时间（`#001 Waiting 04:32` / `Preparing 08:21`）。
**Timer 只由 CreatedAt 计算，不需要每秒写 Database。**

# 50. SALES DASHBOARD 2.0

Owner Dashboard 增加 TODAY：`Sales / Orders / Average Order / Items Sold /
Wallet Redeemed / Rewards Issued / New Members`，以及 TOP PRODUCTS 排行。

# 51. CHANNEL ANALYTICS（非常重要）

Owner 要看到各通路业绩：`Yetipsy App RM860 / Foodcourt RM1,260 / Direct RM320`，
用来判断自己的点餐系统到底有没有价值。

# 52. CUSTOMER ANALYTICS

未来：New / Repeat Customers、Average Spend、Average Visits、Wallet Redemption Rate、
Reward Return Rate。**2.0 先把数据记录好**，复杂分析以后做。

# 53. CANCEL ORDER

`SUBMITTED` 且 Staff 尚未 Accept → 顾客可 `REQUEST CANCEL`，由 Staff Confirm。
已经 `PREPARING` → 默认不能自行取消，需要 Staff。

# 54. WALLET RESERVATION

Checkout 要用钱包时不要马上永久扣：先记 `WalletRequested`，订单确认付款时才 `WalletUsed`。
订单 Cancel 不得扣钱包；若已扣必须 **REVERSAL**，WalletTransactions 留完整记录。

# 55. ORDER COMPLETION IDEMPOTENCY

Staff 连按两次 `COMPLETE` 只能发一次 Points、一次 Reward、加一次 Visit。
**`completeOrder()` 必须 Idempotent。**

# 56. VISIT CALCULATION

不要简单地 1 Order = 1 Visit（同一晚加单 4 次会变成 4 Visits）。
同一 Customer 在 **6 小时**内完成多个订单算 1 Visit：`VISIT_SESSION_HOURS = 6`。

# 57. POINTS CALCULATION

默认 `POINTS_CALCULATION = NET_PAID`。例：Subtotal RM72 − Wallet RM8 = Paid RM64 → 64 分。
**必须由 Backend 计算。**

# 58. ORDER + REWARD

订单完成（如 Net Paid RM64）且 `REWARD_MIN_SPEND = RM30` → 进入 Reward Engine。
顾客看到 `ORDER COMPLETE · +64 POINTS · YOU HAVE A REWARD · [OPEN]`。
**继续使用 1.x Reward 系统，不要重新开发第二套。**

# 59. DATABASE PRINCIPLE

2.0 必须 **EXTEND EXISTING DATABASE**，而不是 REBUILD。
现有 `Customers / Orders / Claims / PointTransactions / WalletTransactions / Promotions /
Staff / Sessions / Settings / AuditLogs` 继续保留，新增
`Categories / Products / ProductOptions / AppOrders / OrderItems`。

# 60. API — CUSTOMER（新增）

`getCategories, getProducts, getProduct, getProductOptions, createCheckoutQuote,
placeOrder, getAppOrder, getMyOrders, requestOrderCancellation, reorder`

# 61. API — STAFF（新增）

`getIncomingOrders, getActiveOrders, acceptOrder, startPreparing, markReady,
completeOrder, cancelAppOrder, markPaymentPaid, setProductAvailability`

# 62. API — OWNER（新增）

`createProduct, updateProduct, archiveProduct, createCategory, updateCategory,
createProductOption, updateProductOption, getSalesAnalytics, getProductAnalytics`

# 63. NEW SETTINGS

```
ORDERING_ENABLED = TRUE              MAX_ORDER_ITEMS = 20
ORDERING_OPEN_TIME = 18:30           VISIT_SESSION_HOURS = 6
ORDERING_CLOSE_TIME = 00:00          ORDER_POLL_SECONDS = 8
ALLOW_PICKUP = TRUE                  CUSTOMER_ORDER_POLL_SECONDS = 12
ALLOW_TABLE_ORDER = TRUE             CHECKOUT_QUOTE_EXPIRY_MINUTES = 5
```

# 64. OPENING HOURS

Ordering Closed 时 Menu 仍可浏览，但显示
`ORDERING CLOSED · 营业时间 6:30 PM – 12:00 AM · You can still browse our menu.`，不能下单。
Owner 可 `PAUSE ORDERS`（`ORDERING_PAUSED = TRUE`）→ 顾客看到
`ORDERS TEMPORARILY PAUSED · We're catching up 🍸`。

# 65. STAFF EMERGENCY CONTROL

Dashboard 顶部：`ORDERS ● OPEN [PAUSE ORDERS]`，一键暂停新单，现有订单继续处理。

# 66. SOLD OUT

Staff 标记 `SOLD OUT` → 顾客端立即显示 `MOJITO SOLD OUT`；
**Checkout Backend 再验证一次**，即使已放入 Cart，若后来 Sold Out 返回 `PRODUCT_UNAVAILABLE`。

# 67. DATA MIGRATION

**开发 AI 不得删除现有会员资料。** 必须：① Backup Google Sheet ② 检测 Existing Sheets
③ 只建立不存在的 2.0 Sheets ④ 只增加必要 Settings ⑤ 不覆盖 Existing Data。

提供 `upgradeToV2()`，而不是重新执行会清空资料的 `setupDatabase()`。

# 68. BACKWARD COMPATIBILITY

升级后这些 URL 必须继续工作：`/ claim.html activity.html wallet.html profile.html
admin/login.html`。现有会员 Session 尽量继续有效、现有 Claim Code 继续有效、
现有 Wallet 不改变、现有 Points 不改变。

# 69. FILE STRUCTURE

新增页面：`menu.html product.html cart.html checkout.html orders.html order.html`
Admin：`admin/orders.html admin/order.html admin/menu.html admin/products.html`
JS：`js/menu.js js/product.js js/cart.js js/checkout.js js/orders.js js/order.js`
Backend：`apps-script/Menu.gs apps-script/AppOrders.gs apps-script/OrderItems.gs
apps-script/Checkout.gs`

# 70. DEVELOPMENT STRATEGY — PHASE 1

**不要一次全部写。** 先 Audit Existing 1.x，必须先检查：Existing Files / API / Database /
Authentication / Wallet / Points / Rewards / Staff Roles。**不要凭计划书猜现有代码。**

# 71. PHASE 2 — DATABASE UPGRADE

建立 `Categories / Products / ProductOptions / AppOrders / OrderItems`，
实现 `upgradeToV2()`，**测试 Existing Data 不受影响**。

# 72–81. PHASE 3–12

3 Menu（Categories / Products / Details / Availability / Images / Search，先不做 Cart）
4 Cart（Add / Remove / Quantity / Options / Subtotal；可用 LocalStorage，但价格最终由 Backend 验证）
5 Checkout（Quote / Table / Pickup / Wallet / Final Amount / Idempotency）
6 Order Creation（`placeOrder()` → SUBMITTED + 顾客订单追踪）
7 Staff Order Board（NEW / PREPARING / READY + Accept / Prepare / Ready / Complete）
8 Membership Integration（调用现有 Points / Visit / Membership / Reward Engine，不要 Duplicate Logic）
9 Wallet（接入 Checkout；重点测 Cancel / Failure / Double Submit / Wallet Race Condition）
10 Owner Menu Management（Product / Price / Category / Availability / Promotion）
11 Analytics（App Sales / Foodcourt Sales / Top Products / Average Order / Order Count）
12 Security Audit（见下）

# 81. PHASE 12 — SECURITY AUDIT（主动测试）

`Change Product Price in Browser / Fake Wallet Amount / Fake CustomerID / Fake Order Total /
Double Place Order / Double Complete / Complete Unpaid Order / Use Wallet Twice /
Order Sold-Out Product / Unauthorized Product Edit / Unauthorized Order Completion /
Replay API Request`。**所有 Critical Issue 必须修复。**

# 82. PERFORMANCE

Backend 是 Apps Script + Sheets：不要每次 Menu Load 循环读取整个 Spreadsheet 多次。
一次 `getMenu()` 返回 `Categories + Products + Options`，可用 `CacheService` 缓存
**60–300 秒**。**订单、Wallet、Customer 不要 Cache 敏感余额。**

# 83. GOOGLE SHEETS LIMITATION

系统定位：`Single Yetipsy Outlet` + `Low / Medium Order Volume`。
不要假装 Sheets 是高并发数据库。所有金融/会员操作必须 `LockService`。
未来订单量明显扩大再迁移 `Supabase / PostgreSQL`。

# 84. MVP SUCCESS TEST（现场必须完成）

```
Jason Login → MENU → Mojito RM22 ×2 + Long Island RM28 → CART RM72 → Wallet RM8
→ Checkout → Table A12 → PLACE ORDER → Staff receives → ACCEPT → PREPARING → READY
→ COMPLETED → Wallet deducted once → Points issued once → Visit counted once
→ Reward generated once → Jason opens reward → Wallet receives reward
```

同时 Google Sheets 正确产生：`AppOrder / OrderItems / PointTransaction /
WalletTransaction / AuditLog`。

# 85. FOODCOURT TEST

同时必须保证 `Foodcourt Order → Existing Create Claim → Customer Claim → Points → Reward`
仍然正常。**不允许 2.0 破坏 1.x。**

# 86. FINAL PRODUCT

```
                 YETIPSY
                    │
        ┌───────────┴───────────┐
   FOODCOURT               YETIPSY APP
     CLAIM                    ORDER
        └───────────┬───────────┘
                 MEMBER → VERIFIED SPEND → POINTS → MEMBERSHIP
                    → REWARD → WALLET → RETURN
```
