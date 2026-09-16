/* =============================================================
   demo/smoke-ui.js
   -------------------------------------------------------------
   前端健全性检查（不需要浏览器）。
   这几项检查的目的，是防止再次发生「线上页面其实是 demo 档」
   与「前端呼叫了后端没有的 action」这类事故。

   执行： node demo/smoke-ui.js
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Suite } = require('./harness');
const { loadBackend } = require('./load-backend');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const suite = new Suite('YETIPSY · 前端健全性检查（smoke-ui）');

const CUSTOMER_PAGES = ['index.html', 'login.html', 'claim.html', 'wallet.html',
  'activity.html', 'profile.html', 'reward.html'];
const ADMIN_PAGES = ['admin/login.html', 'admin/index.html', 'admin/claim.html',
  'admin/customers.html', 'admin/orders.html', 'admin/settings.html',
  'admin/audit.html', 'admin/staff.html', 'admin/more.html'];
const PRODUCTION_PAGES = CUSTOMER_PAGES.concat(ADMIN_PAGES);

/* -------------------------------------------------------------
   01 · 线上页面不能是 demo 档
   ------------------------------------------------------------- */
suite.group('01 · 线上页面不是离线 DEMO 档', (t) => {
  const home = read('index.html');
  t.check('index.html 载入 js/app.js（正式版首页）', /<script src="js\/app\.js">/.test(home));
  t.check('index.html 不含 MOCK_BACKEND', !/MOCK_BACKEND/.test(home));
  t.check('index.html 不是单档离线预览', !/OFFLINE PREVIEW/.test(home));

  PRODUCTION_PAGES.forEach((page) => {
    const html = read(page);
    t.check(page + ' 不含 MOCK_BACKEND', !/MOCK_BACKEND/.test(html));
    /* demo 密码提示只允许出现在 IS_DEMO() 保护的 demo-banner 那一行 */
    const leakedPassword = html.split('\n').some((line) =>
      line.indexOf('yetipsy123') !== -1 && line.indexOf('demo-banner') === -1);
    t.check(page + ' 没有把 demo 密码写进正式内容', !leakedPassword);
    t.check(page + ' 载入 js/config.js', /js\/config\.js/.test(html));
    t.check(page + ' 载入 js/api.js', /js\/api\.js/.test(html));
  });

  const preview = read('preview.html');
  t.check('离线预览档还在（preview.html）', /OFFLINE PREVIEW/.test(preview));
  t.check('离线预览档不会被线上页面连到',
    !PRODUCTION_PAGES.some((p) => /preview\.html/.test(read(p))));
});

/* -------------------------------------------------------------
   02 · config.js 是线上设定
   ------------------------------------------------------------- */
suite.group('02 · js/config.js 是线上设定', (t) => {
  const cfg = read('js/config.js');
  const url = (cfg.match(/API_URL:\s*'([^']*)'/) || [])[1];
  const requireBackend = /REQUIRE_BACKEND:\s*true/.test(cfg);

  t.check('API_URL 已填入 https 网址', /^https:\/\/script\.google\.com\/macros\/s\//.test(url || ''), url);
  t.check('REQUIRE_BACKEND = true（不会静默退回 demo）', requireBackend);
  t.check("ENVIRONMENT = 'production'", /ENVIRONMENT:\s*'production'/.test(cfg));

  const api = read('js/api.js');
  t.check('api.js 有 BACKEND_NOT_CONFIGURED 保护', /BACKEND_NOT_CONFIGURED/.test(api));
});

/* -------------------------------------------------------------
   03 · 前端呼叫的每个 API 方法都存在
   ------------------------------------------------------------- */
suite.group('03 · 前端 API 呼叫 ↔ js/api.js', (t) => {
  const apiSource = read('js/api.js');
  const defined = new Set();
  const groupRe = /var (customer|staff|admin|system) = \{([\s\S]*?)\n  \};/g;
  let m;
  while ((m = groupRe.exec(apiSource))) {
    const group = m[1];
    const body = m[2];
    const nameRe = /(\w+):\s*function/g;
    let n;
    while ((n = nameRe.exec(body))) defined.add(group + '.' + n[1]);
  }
  t.check('js/api.js 解析到 API 方法', defined.size > 20, defined.size);

  const used = new Set();
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'api.js')
    .map((f) => 'js/' + f)
    .concat(PRODUCTION_PAGES)
    .concat(['login.html']);
  Array.from(new Set(files)).forEach((f) => {
    const src = read(f);
    const re = /API\.(customer|staff|admin|system)\.(\w+)\s*\(/g;
    let x;
    while ((x = re.exec(src))) used.add(x[1] + '.' + x[2]);
  });

  used.forEach((u) => t.check('API.' + u + ' 存在', defined.has(u)));
});

/* -------------------------------------------------------------
   04 · js/api.js 的每个 action 后端都有实作
   ------------------------------------------------------------- */
suite.group('04 · 前端 action ↔ Apps Script handlers', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();
  const handlers = Object.keys(api.handlers());

  const apiSource = read('js/api.js');
  const actions = new Set();
  const re = /call\(\s*'(\w+)'/g;
  let m;
  while ((m = re.exec(apiSource))) actions.add(m[1]);

  t.check('前端用到的 action 数量', actions.size > 25, actions.size);
  actions.forEach((a) => t.check('后端有 ' + a, handlers.indexOf(a) !== -1));

  const unused = handlers.filter((h) => !actions.has(h));
  t.check('后端没有前端不知道的多馀 action', unused.length === 0, unused);
});

/* -------------------------------------------------------------
   05 · 页面元素 id 齐全（js 抓得到的 id 一定要在 HTML 里）
   ------------------------------------------------------------- */
suite.group('05 · HTML 元素 id', (t) => {
  const pairs = [
    ['js/app.js', 'index.html'],
    ['js/wallet.js', 'wallet.html'],
    ['js/activity.js', 'activity.html'],
    ['js/profile.js', 'profile.html'],
    ['js/reward.js', 'reward.html'],
    ['js/claim.js', 'claim.html'],
    ['js/admin-dashboard.js', 'admin/index.html'],
    ['js/admin-claim.js', 'admin/claim.html'],
    ['js/admin-customer.js', 'admin/customers.html'],
    ['js/admin-orders.js', 'admin/orders.html'],
    ['js/admin-settings.js', 'admin/settings.html'],
    ['js/admin-audit.js', 'admin/audit.html'],
    ['js/admin-staff.js', 'admin/staff.html']
  ];

  pairs.forEach((pair) => {
    const js = read(pair[0]);
    const html = read(pair[1]);
    /* 页面自己也可能建立元素（innerHTML），所以只检查静态写在 HTML 的容器 id */
    const ids = new Set();
    const re = /getElementById\(\s*'([\w-]+)'\s*\)/g;
    let m;
    while ((m = re.exec(js))) ids.add(m[1]);

    /* 只要求「在 HTML 里以 id="..." 出现过」或「由该 js 自己 innerHTML 产生」 */
    ids.forEach((id) => {
      const inHtml = html.indexOf('id="' + id + '"') !== -1;
      const builtByJs = js.indexOf('id="' + id + '"') !== -1 ||
        js.indexOf("id='" + id + "'") !== -1 ||
        js.indexOf('id=\\"' + id) !== -1;
      t.check(pair[1] + ' 有 #' + id, inHtml || builtByJs);
    });
  });
});

/* -------------------------------------------------------------
   06 · ★ 前端与后端的电话号码规则必须完全一致
   ------------------------------------------------------------- */
suite.group('06 · 前端 UI.normalizePhone ↔ 后端 normalizePhoneE164', (t) => {
  const { api } = loadBackend();
  api.setupDatabase();

  const sandbox = {
    console: console,
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} } }), body: {} },
    window: {},
    navigator: {},
    location: { search: '', pathname: '/' },
    qrcode: () => { throw new Error('no qr'); },
    requestAnimationFrame: (fn) => fn(),
    setTimeout: setTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/config.js'), sandbox, { filename: 'js/config.js' });
  vm.runInContext(read('js/ui.js'), sandbox, { filename: 'js/ui.js' });

  const cases = [
    ['0123456789', '+60'],
    ['123456789', '+60'],
    ['60123456789', '+60'],
    ['+60 12-345 6789', '+60'],
    ['0060 12 345 6789', '+60'],
    ['01112345678', '+60'],
    ['81234567', '+65'],
    ['+65 8123 4567', '+65'],
    ['6581234567', '+65'],
    ['123', '+60'],
    ['', '+60'],
    ['+14155551234', '+60']
  ];

  cases.forEach((c) => {
    const front = sandbox.UI.normalizePhone(c[0], c[1]);
    const back = api.normalizePhoneE164(c[0], c[1].replace('+', ''));
    if (back.ok) {
      t.equal('「' + c[0] + '」前后端 E.164 一致', front, back.phone);
    } else {
      t.equal('「' + c[0] + '」后端判定无效 → 前端也判定无效',
        sandbox.UI.isValidPhone(c[0], c[1]), false);
    }
    t.equal('「' + c[0] + '」有效性判断一致',
      sandbox.UI.isValidPhone(c[0], c[1]), back.ok);
  });

  t.equal('同一个号码的多种写法在前端也收敛成 1 个',
    new Set(['0123456789', '60123456789', '+60 12-345 6789', '0060 12 345 6789']
      .map((p) => sandbox.UI.normalizePhone(p, '+60'))).size, 1);
});

suite.run().then((pass) => process.exit(pass ? 0 : 1));
