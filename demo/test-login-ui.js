/* =============================================================
   demo/test-login-ui.js
   -------------------------------------------------------------
   ★ 用真的 DOM（jsdom）把 login.html 跑起来，模拟顾客点按钮，
     验证「输入手机号码 → 没重复就跳注册 / 重复就填密码」。

   为什么要有这个测试：
   上一版改版后 login.html 已经是新流程，但浏览器的 Service Worker
   还在拿旧的 js/api.js（cache-first + 没换 CACHE_NAME），
   结果页面呼叫 API.customer.checkPhone 直接 TypeError —— 顾客看到
   「点了没反应」。smoke-ui 只比对字串，抓不到这种「页面 ↔ 载入的
   JS 对不上」的问题，所以这里直接把页面执行一次。

   执行： node demo/test-login-ui.js
   需要： npm i --no-save jsdom（CI 已在 .github/workflows/ci.yml 装）
   ============================================================= */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { Suite } = require('./harness');

const PORT = 3998;
const BASE = 'http://127.0.0.1:' + PORT;
const suite = new Suite('YETIPSY · 登录页 DOM 测试（jsdom + demo/server.js）');

const PASSWORD = 'demo-pass-123';
const PHONE_A = '0123456789';        // 这个号码会用来注册
const PHONE_B = '0198765432';        // 这个号码不会注册

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping', data: {}, token: '' })
      });
      if (res.ok) return;
    } catch (e) { /* server 还没起来 */ }
    await sleep(120);
  }
  throw new Error('demo server 起不来：' + BASE);
}

/* 在 jsdom 里开一个真的 login.html（含外部 JS 与 inline script） */
async function openLogin(JSDOM) {
  const dom = await JSDOM.fromURL(BASE + '/login.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* jsdom 没有 fetch；Node 的 fetch 又不接受相对网址（config.js 在 demo
         模式下回的是 'api'），所以这里用页面网址补成绝对网址。 */
      window.fetch = function (input, init) {
        var url = input;
        if (typeof url === 'string' && !/^[a-z]+:\/\//i.test(url)) {
          url = new URL(url, window.location.href).href;
        }
        return globalThis.fetch(url, init);
      };
      window.__nav = [];
    }
  });
  const win = dom.window;
  const doc = win.document;

  /* 等外部 script 都跑完（js/api.js 挂上 window.API） */
  const start = Date.now();
  while (!(win.API && win.API.customer && win.API.customer.checkPhone) &&
         Date.now() - start < 15000) {
    await sleep(80);
  }
  await sleep(150);   // 让 getPublicSettings 回来

  /* jsdom 不允许真的跳页（会印 Not implemented），所以包住 UI.go 记录下来 */
  win.UI.go = function (u) { win.__nav.push(u); };

  return { dom, win, doc };
}

function visibleStep(doc) {
  const ids = ['phoneStep', 'registerStep', 'passwordStep', 'setupStep'];
  for (let i = 0; i < ids.length; i++) {
    const el = doc.getElementById(ids[i]);
    if (el && !el.hidden) return ids[i];
  }
  return null;
}

function click(doc, id) { doc.getElementById(id).click(); }

function token(win) { return win.localStorage.getItem('yt_customer_token'); }

async function until(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 12000)) {
    if (fn()) return true;
    await sleep(80);
  }
  return false;
}

/* =============================================================
   测试主体
   ============================================================= */

suite.group('00 · 环境与页面载入', async (t) => {
  await waitForServer(15000);
  let JSDOM;
  try {
    JSDOM = require('jsdom').JSDOM;
  } catch (e) {
    throw new Error('这个测试需要 jsdom：请先跑 `npm install`（package.json 的 devDependencies）');
  }
  global.__JSDOM = JSDOM;

  const { win, doc } = await openLogin(JSDOM);
  global.__page = { win, doc };

  t.check('window.API 载入了', !!win.API);
  t.check('API.customer.checkPhone 存在（旧快取的 api.js 没有这个）',
    typeof win.API.customer.checkPhone === 'function');
  t.check('API.customer.login 存在', typeof win.API.customer.login === 'function');
  t.check('页面已经没有 OTP 栏位', !doc.getElementById('otpBox') && !doc.getElementById('otpInput'));
  t.check('有四个步骤区块', ['phoneStep', 'registerStep', 'passwordStep', 'setupStep']
    .every((id) => !!doc.getElementById(id)));
  t.check('一开始停在手机号码步骤', visibleStep(doc) === 'phoneStep');
  t.check('步骤①只有号码，没有名字栏（名字在注册时才问）',
    !!doc.getElementById('phoneInput') &&
    doc.getElementById('nameInput').closest('#registerStep') !== null);
});

suite.group('01 · 号码没注册过 → 跳去注册', async (t) => {
  const { win, doc } = global.__page;

  doc.getElementById('phoneInput').value = PHONE_A;
  click(doc, 'continueBtn');

  const ok = await until(() => visibleStep(doc) === 'registerStep');
  t.check('按下「继续」后跳到注册步骤 ★', ok, visibleStep(doc));
  t.check('显示的是 E.164 号码',
    doc.getElementById('registerPhone').textContent === '+60123456789',
    doc.getElementById('registerPhone').textContent);
  t.check('还没有 token（还没注册）', !token(win));
});

suite.group('02 · 密码太短 / 两次不一样 → 不放行', async (t) => {
  const { win, doc } = global.__page;

  doc.getElementById('newPwInput').value = '123';
  doc.getElementById('newPw2Input').value = '123';
  click(doc, 'registerBtn');
  await sleep(250);
  t.check('密码太短 → 还停在注册步骤', visibleStep(doc) === 'registerStep');

  doc.getElementById('newPwInput').value = PASSWORD;
  doc.getElementById('newPw2Input').value = 'another-pass-1';
  click(doc, 'registerBtn');
  await sleep(250);
  t.check('两次不一样 → 还停在注册步骤', visibleStep(doc) === 'registerStep');
  t.check('没有发出注册请求（没 token）', !token(win));
});

suite.group('03 · 填对 → 注册成功并进入', async (t) => {
  const { win, doc } = global.__page;

  doc.getElementById('nameInput').value = 'Jason';
  doc.getElementById('newPwInput').value = PASSWORD;
  doc.getElementById('newPw2Input').value = PASSWORD;
  click(doc, 'registerBtn');

  const ok = await until(() => !!token(win));
  t.check('注册成功，拿到 session ★', ok);
  const profile = JSON.parse(win.localStorage.getItem('yt_customer_profile') || '{}');
  t.check('是同一笔会员资料', profile.phone === '+60123456789', profile.phone);
  t.check('登入后跳去首页', win.__nav.indexOf('index.html') !== -1, win.__nav.join(','));
});

suite.group('04 · 号码重复了 → 改成问密码', async (t) => {
  const { JSDOM } = global.__JSDOM ? {} : {};
  const JSDOMClass = global.__JSDOM;
  const page2 = await openLogin(JSDOMClass);
  const { win, doc } = page2;
  global.__page2 = page2;

  doc.getElementById('phoneInput').value = '+60 12-345 6789';   // 换一种写法
  click(doc, 'continueBtn');

  const ok = await until(() => visibleStep(doc) === 'passwordStep');
  t.check('同一个号码 → 跳到密码步骤 ★', ok, visibleStep(doc));
  t.check('欢迎词带遮罩名字', doc.getElementById('welcomeName').textContent === 'J***',
    doc.getElementById('welcomeName').textContent);
  t.check('步骤①的名字栏没被带到密码步骤',
    doc.getElementById('setupNameInput') === null || visibleStep(doc) === 'passwordStep');
});

suite.group('05 · 密码错 → 拒绝；密码对 → 登入', async (t) => {
  const { win, doc } = global.__page2;

  doc.getElementById('pwInput').value = 'wrong-pass-1';
  click(doc, 'loginBtn');
  await until(() => doc.getElementById('pwInput').value === '', 8000);
  t.check('密码错 → 没拿到 session', !token(win));
  t.check('密码错 → 输入框清空、留在原步骤', visibleStep(doc) === 'passwordStep');

  doc.getElementById('pwInput').value = PASSWORD;
  click(doc, 'loginBtn');
  const ok = await until(() => !!token(win));
  t.check('密码对 → 登入成功 ★', ok);
});

suite.group('06 · 没注册过的另一个号码 → 仍然跳注册', async (t) => {
  const { doc } = await openLogin(global.__JSDOM);
  doc.getElementById('phoneInput').value = PHONE_B;
  click(doc, 'continueBtn');
  const ok = await until(() => visibleStep(doc) === 'registerStep');
  t.check('新号码 → 注册步骤', ok, visibleStep(doc));
  t.check('显示 E.164', doc.getElementById('registerPhone').textContent === '+60198765432',
    doc.getElementById('registerPhone').textContent);
});

suite.group('07 · Service Worker 快取版本（防止旧 JS 复活）', (t) => {
  const fs = require('fs');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  const m = sw.match(/CACHE_NAME\s*=\s*'([^']+)'/);
  t.check('service-worker.js 有 CACHE_NAME', !!m);
  t.check('CACHE_NAME 跟 package.json 版本一致（改版一定要一起改，否则旧 JS 会复活）',
    m && m[1] === 'yetipsy-v' + pkg.version, m && m[1] + ' vs yetipsy-v' + pkg.version);
  t.check('.js/.css/.html 走 network first（不再 cache-first）',
    /var isCode = [^;]+;\s*\n\s*if \(isCode\)/.test(sw));
});

/* =============================================================
   起 server → 跑测试 → 收尾
   ============================================================= */

const server = spawn(process.execPath, [path.join(__dirname, 'server.js'),
  '--port', String(PORT), '--reset'], { cwd: path.join(__dirname, '..') });

/* harness 的 run() 回传的是 boolean：true = 全过（跟 tests.js / e2e-ui.js 一样） */
suite.run().then((pass) => {
  server.kill('SIGKILL');
  process.exit(pass ? 0 : 1);
}).catch((e) => {
  console.error('测试执行失败：', e && e.stack ? e.stack : e);
  server.kill('SIGKILL');
  process.exit(1);
});
