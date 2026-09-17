/* =============================================================
   demo/harness.js — 极简测试框架（不需要 npm install）
   ============================================================= */

'use strict';

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m';
const color = process.env.NO_COLOR ? (c, s) => s : (c, s) => c + s + RESET;

class Suite {
  constructor(title) {
    this.title = title;
    this.groups = [];
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
  }

  group(name, fn) { this.groups.push({ name: name, fn: fn }); return this; }

  check(desc, condition, extra) {
    if (condition) {
      this.passed++;
      return true;
    }
    this.failed++;
    this.failures.push({ desc: desc, extra: extra });
    console.log('      ' + color(RED, '✗ ' + desc) + (extra !== undefined ? color(DIM, '  → ' + JSON.stringify(extra)) : ''));
    return false;
  }

  equal(desc, actual, expected) {
    return this.check(desc, actual === expected, { actual: actual, expected: expected });
  }

  errorIs(res, code, desc) {
    const ok = res && res.success === false && res.error && res.error.code === code;
    return this.check(desc || ('error = ' + code), ok, { got: res && res.error });
  }

  okIs(res, desc) {
    return this.check(desc || 'success = true', !!(res && res.success === true), { error: res && res.error });
  }

  /** 支援同步与 async 群组；回传 Promise<boolean> */
  async run() {
    console.log('\n' + color(BOLD, this.title));
    for (const g of this.groups) {
      console.log('  ' + color(BOLD, g.name));
      try {
        await g.fn(this);
      } catch (e) {
        this.failed++;
        this.failures.push({ desc: g.name + ' threw', extra: e.message });
        console.log('      ' + color(RED, '✗ EXCEPTION: ' + (e && e.stack ? e.stack : e)));
      }
    }
    const total = this.passed + this.failed;
    const line = this.failed
      ? color(RED, this.failed + ' FAILED') + ' / ' + total + ' checks'
      : color(GREEN, 'ALL PASS') + ' · ' + total + ' checks';
    console.log('\n' + this.title + ' → ' + line + '\n');
    return this.failed === 0;
  }
}

module.exports = { Suite };
