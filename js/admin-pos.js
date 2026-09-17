/* =============================================================
   YETIPSY — admin-pos.js（员工端 POS 点餐台 + 进单）
   -------------------------------------------------------------
   现场动线（foodcourt 通路）——像 POS 机一样：

     ① 点餐台：商品格 → 点商品 → 清单（可改数量 / 手动改金额）
     ② 记录单据 → 进「待进单」队列
     ③ 顾客出示会员码 → 扫码 → 确认 → 进分

   为什么金额还是员工确认：
     收据上的数字才是真的（折扣 / 税在 foodcourt 算好了）。
     清单只是「这张单卖了什么」的纪录；积分只看金额（§57）。
     金额不对就在清单里手动输入（勾「手动输入金额」）。

   为什么先记录再扫码：
     值班时可以先把三五张单录进队列，顾客来了才逐张扫码。
     扫码只是回答「这张单是谁的」，付款早在 foodcourt 完成了。

   Mini app 的订单不走这里 —— 顾客在 App 下单，员工完成订单时
   系统就会自动进分（admin/orderboard.html）。
   ============================================================= */

var ADMIN_POS = (function () {

  var state = {
    tab: 'kiosk',            // kiosk | queue | scan | confirm | result
    menu: null,              // { categories, products }
    categoryId: '',
    lines: [],               // 目前这张单：{productId,nameZH,nameEN,unitPrice,qty}
    manualAmountSen: 0,
    useManualAmount: false,
    tickets: [],
    today: null,
    selected: null,
    customer: null,
    membership: null,
    verifyToken: '',
    verifyLeft: 0,
    result: null,
    errorCode: null,
    busy: false,
    pollSeconds: 8,
    signature: ''
  };

  var el = {};
  var pollTimer = null;
  var countdownTimer = null;

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */

  function init() {
    el.kiosk      = document.getElementById('stepKiosk');
    el.queue      = document.getElementById('stepQueue');
    el.scan       = document.getElementById('stepScan');
    el.confirm    = document.getElementById('stepConfirm');
    el.result     = document.getElementById('stepResult');
    el.grid       = document.getElementById('kioskGrid');
    el.cats       = document.getElementById('kioskCats');
    el.scanBox    = document.getElementById('scanBox');
    el.video      = document.getElementById('scanVideo');
    el.hint       = document.getElementById('scanHint');
    el.support    = document.getElementById('scanSupport');
    el.sheet      = document.getElementById('ticketSheet');
    el.lines      = document.getElementById('ticketLines');

    on('tabKiosk', function () { show('kiosk'); });
    on('tabQueue', function () { show('queue'); });
    on('kioskRefreshBtn', function () { loadMenu(true); });
    on('refreshBtn', function () { loadQueue(true); });
    on('kioskOpenTicket', openTicketSheet);
    on('kioskTicketBtn', openTicketSheet);
    on('ticketSheetClose', closeTicketSheet);
    on('ticketClearBtn', clearLines);
    on('saveTicketBtn', saveTicket);
    on('manualAmountToggle', toggleManualAmount);
    on('manualBtn', function () { handleCode(txt('manualInput')); });
    on('manualInput', null, function (e) { if (e.key === 'Enter') handleCode(txt('manualInput')); });
    on('startScanBtn', startCamera);
    on('stopScanBtn', function () { MEMBER_SCANNER.stop(); });
    on('confirmBtn', confirm);
    on('rescanBtn', function () { if (state.selected) beginScan(state.selected); });
    on('backToQueueBtn', backToKiosk);
    on('nextTicketBtn', backToKiosk);

    bindGrid();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopPolling(); MEMBER_SCANNER.stop(); }
      else if (state.tab === 'queue') { loadQueue(false); startPolling(); }
    });

    show('kiosk');
    loadMenu(false);
    loadQueue(false);
  }

  function on(id, fn, keyFn) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener(keyFn ? 'keydown' : 'click', keyFn || fn);
  }

  function txt(id) {
    var node = document.getElementById(id);
    return node ? String(node.value || '').trim() : '';
  }

  function set(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function showBtn(id, visible) {
    var node = document.getElementById(id);
    if (node) node.style.display = visible ? '' : 'none';
  }

  function show(tab) {
    state.tab = tab;
    if (el.kiosk)   el.kiosk.style.display   = (tab === 'kiosk')   ? '' : 'none';
    if (el.queue)   el.queue.style.display   = (tab === 'queue')   ? '' : 'none';
    if (el.scan)    el.scan.style.display    = (tab === 'scan')    ? '' : 'none';
    if (el.confirm) el.confirm.style.display = (tab === 'confirm') ? '' : 'none';
    if (el.result)  el.result.style.display  = (tab === 'result')  ? '' : 'none';

    var tabKiosk = document.getElementById('tabKiosk');
    var tabQueue = document.getElementById('tabQueue');
    if (tabKiosk) tabKiosk.className = 'pt' + (tab === 'kiosk' ? ' on' : '');
    if (tabQueue) tabQueue.className = 'pt' + (tab === 'queue' ? ' on' : '');
    var tabs = document.querySelector('.pos-tabs');
    if (tabs) tabs.style.display = (tab === 'scan' || tab === 'confirm' || tab === 'result') ? 'none' : '';

    if (tab === 'queue') startPolling(); else stopPolling();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------
     点餐台：商品格
     --------------------------------------------------------- */

  function loadMenu(verbose) {
    var status = document.getElementById('kioskStatus');
    if (status && !state.menu) status.textContent = '载入酒单…';

    API.staff.getAdminMenu().then(function (res) {
      if (!res.success) {
        if (status) { status.textContent = '酒单载入失败 ' + res.error.code; status.className = 'a-sub warn'; }
        if (!ADMIN.handleError(res.error) && verbose) UI.toast(res.error.message, 'error');
        return;
      }
      state.menu = {
        categories: (res.data.categories || []).filter(function (c) {
          return String(c.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
        }),
        products: (res.data.products || []).filter(function (p) {
          return String(p.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
        })
      };
      renderCats();
      renderGrid();
    });
  }

  function renderCats() {
    if (!el.cats) return;
    var cats = [{ categoryId: '', nameZH: '全部', nameEN: 'ALL' }].concat(state.menu ? state.menu.categories : []);
    el.cats.innerHTML = cats.map(function (c) {
      var active = (c.categoryId || '') === state.categoryId ? ' active' : '';
      return '<div class="cat-chip' + active + '" data-cat="' + UI.esc(c.categoryId || '') + '">' +
        (c.nameZH ? UI.esc(c.nameZH) : UI.esc(c.nameEN)) + '</div>';
    }).join('');

    Array.prototype.forEach.call(el.cats.querySelectorAll('.cat-chip'), function (node) {
      node.addEventListener('click', function () {
        var next = node.getAttribute('data-cat') || '';
        state.categoryId = (state.categoryId === next) ? '' : next;
        renderCats();
        renderGrid();
      });
    });
  }

  function gridProducts() {
    var list = (state.menu && state.menu.products) || [];
    if (!state.categoryId) return list;
    return list.filter(function (p) { return (p.categoryId || '') === state.categoryId; });
  }

  function renderGrid() {
    if (!el.grid) return;
    var list = gridProducts();

    var status = document.getElementById('kioskStatus');
    if (status) {
      status.className = 'a-sub';
      status.textContent = state.menu
        ? '点商品加入这张单 · 共 ' + list.length + ' 款'
        : '载入酒单…';
    }

    if (!list.length) {
      el.grid.innerHTML = '<div class="a-empty" style="padding:20px">酒单还没有商品<br>' +
        '<span class="tiny">到「更多 → 菜单管理」新增</span></div>';
      return;
    }

    el.grid.innerHTML = list.map(function (p) {
      var sold = p.available === false;
      var qty = qtyOf(p.productId);
      return '<button class="k-tile' + (sold ? ' is-sold' : '') + (qty ? ' in-cart' : '') +
        '" data-product="' + UI.esc(p.productId) + '"' + (sold ? ' disabled' : '') + '>' +
        (qty ? '<span class="kt-qty">' + qty + '</span>' : '') +
        '<span class="kt-name">' + UI.esc(p.nameZH || p.nameEN) + '</span>' +
        '<span class="kt-en">' + UI.esc(p.nameEN) + '</span>' +
        '<span class="kt-price">' + (sold ? '售罄 SOLD OUT' : UI.money(p.price)) + '</span>' +
      '</button>';
    }).join('');
  }

  /** 事件只绑一次（委派）：商品格重画也不用重新绑 */
  function bindGrid() {
    if (!el.grid || el.grid.getAttribute('data-bound') === '1') return;
    el.grid.setAttribute('data-bound', '1');
    el.grid.addEventListener('click', function (e) {
      var node = closest(e.target, '[data-product]');
      if (!node || node.disabled) return;
      addProduct(node.getAttribute('data-product'));
    });
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches ? node.matches(selector) : false) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ---------------------------------------------------------
     这张单（清单）
     --------------------------------------------------------- */

  function findProduct(productId) {
    var hit = null;
    ((state.menu && state.menu.products) || []).forEach(function (p) {
      if (!hit && p.productId === productId) hit = p;
    });
    return hit;
  }

  function qtyOf(productId) {
    var q = 0;
    state.lines.forEach(function (l) { if (l.productId === productId) q += l.qty; });
    return q;
  }

  function addProduct(productId) {
    var p = findProduct(productId);
    if (!p || p.available === false) return;

    var line = null;
    state.lines.forEach(function (l) { if (!line && l.productId === productId) line = l; });

    if (line) {
      if (line.qty >= 99) return;
      line.qty += 1;
    } else {
      state.lines.push({
        productId: p.productId,
        nameZH: p.nameZH || '',
        nameEN: p.nameEN || '',
        unitPrice: Number(p.price) || 0,
        qty: 1
      });
    }

    renderGrid();          // 只更新数量角标
    renderKioskBar();
    renderTicketLines();
  }

  function setLineQty(productId, qty) {
    var next = Math.round(Number(qty) || 0);
    if (next <= 0) {
      state.lines = state.lines.filter(function (l) { return l.productId !== productId; });
    } else {
      state.lines.forEach(function (l) {
        if (l.productId === productId) l.qty = Math.min(99, next);
      });
    }
    renderGrid();
    renderKioskBar();
    renderTicketLines();
  }

  function linesTotalSen() {
    return state.lines.reduce(function (sum, l) {
      return sum + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
    }, 0);
  }

  function clearLines() {
    state.lines = [];
    state.manualAmountSen = 0;
    state.useManualAmount = false;
    var toggle = document.getElementById('manualAmountToggle');
    if (toggle) toggle.checked = false;
    var manual = document.getElementById('manualAmountInput');
    if (manual) { manual.value = ''; manual.style.display = 'none'; }
    renderGrid();
    renderKioskBar();
    renderTicketLines();
  }

  function renderKioskBar() {
    var bar = document.getElementById('kioskBar');
    var n = state.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    set('kbCount', n);
    set('kbTotal', UI.money(linesTotalSen()));
    if (bar) bar.style.display = n > 0 ? '' : 'none';
  }

  /* ---------------------------------------------------------
     清单抽屉
     --------------------------------------------------------- */

  function openTicketSheet() {
    renderTicketLines();
    if (el.sheet) {
      el.sheet.style.display = '';
      document.body.classList.add('sheet-open');
    }
  }

  function closeTicketSheet() {
    if (el.sheet) el.sheet.style.display = 'none';
    document.body.classList.remove('sheet-open');
  }

  function renderTicketLines() {
    if (!el.lines) return;

    set('ticketSub', state.lines.length
      ? state.lines.length + ' 项 · ' + UI.money(linesTotalSen())
      : '空的 · 从商品格点选');

    if (!state.lines.length) {
      el.lines.innerHTML = '<div class="a-empty" style="padding:18px">清单是空的<br>' +
        '<span class="tiny">回点餐台点商品</span></div>';
    } else {
      el.lines.innerHTML = state.lines.map(function (l) {
        return '<div class="ps-line" data-line="' + UI.esc(l.productId) + '">' +
          '<div class="psl-main">' +
            '<div class="psl-name">' + UI.esc(l.nameZH || l.nameEN) + '</div>' +
            '<div class="psl-price">' + UI.money(l.unitPrice) + ' × ' + l.qty +
              ' = <b>' + UI.money(l.unitPrice * l.qty) + '</b></div>' +
          '</div>' +
          '<div class="psl-qty">' +
            '<button class="qty-btn" data-dec="' + UI.esc(l.productId) + '">−</button>' +
            '<span class="qty-value">' + l.qty + '</span>' +
            '<button class="qty-btn" data-inc="' + UI.esc(l.productId) + '">+</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    set('ticketTotal', UI.money(state.useManualAmount ? state.manualAmountSen : linesTotalSen()));

    Array.prototype.forEach.call(el.lines.querySelectorAll('[data-inc]'), function (node) {
      node.addEventListener('click', function () {
        var id = node.getAttribute('data-inc');
        setLineQty(id, qtyOf(id) + 1);
      });
    });
    Array.prototype.forEach.call(el.lines.querySelectorAll('[data-dec]'), function (node) {
      node.addEventListener('click', function () {
        var id = node.getAttribute('data-dec');
        setLineQty(id, qtyOf(id) - 1);
      });
    });

    var save = document.getElementById('saveTicketBtn');
    if (save) save.disabled = !state.lines.length && !state.manualAmountSen;
  }

  function toggleManualAmount() {
    var toggle = document.getElementById('manualAmountToggle');
    var input = document.getElementById('manualAmountInput');
    state.useManualAmount = !!(toggle && toggle.checked);
    if (input) {
      input.style.display = state.useManualAmount ? '' : 'none';
      if (state.useManualAmount) input.focus();
    }
    state.manualAmountSen = state.useManualAmount ? parseAmountSen(input ? input.value : '') : 0;
    set('ticketTotal', UI.money(state.useManualAmount ? state.manualAmountSen : linesTotalSen()));
  }

  /** "86" / "86.5" / "RM 86.00" → sen */
  function parseAmountSen(raw) {
    var n = parseFloat(String(raw || '').replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  /* ---------------------------------------------------------
     记录单据
     --------------------------------------------------------- */

  function billSen() {
    if (state.useManualAmount) return state.manualAmountSen;
    return linesTotalSen();
  }

  function saveTicket() {
    if (state.busy) return;

    var amount = billSen();
    if (amount <= 0) {
      UI.toast('请先点商品，或勾「手动输入金额」输入收据金额', 'error');
      return;
    }

    state.busy = true;
    var btn = document.getElementById('saveTicketBtn');
    UI.setLoading(btn, true, 'SAVING');

    API.staff.createPosTicket({
      amount: amount,
      externalOrderId: txt('ticketNoInput'),
      note: txt('ticketNoteInput'),
      items: state.lines.map(function (l) {
        return { nameZH: l.nameZH, nameEN: l.nameEN, quantity: l.qty, unitPriceSen: l.unitPrice };
      })
    }).then(function (res) {
      state.busy = false;
      UI.setLoading(btn, false);

      if (!res.success) {
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }

      var ticket = res.data.ticket;
      ['ticketNoInput', 'ticketNoteInput'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.value = '';
      });
      clearLines();
      closeTicketSheet();
      UI.toast('已记录 ' + UI.money(ticket.amount) + ' · 请扫顾客会员码', 'success');

      /* 直接接着扫码（现场最常见的顺序），队列也会同步更新 */
      loadQueue(false);
      beginScan(ticket);
    });
  }

  /* ---------------------------------------------------------
     待进单队列
     --------------------------------------------------------- */

  function loadQueue(verbose) {
    if (!API.staff.getPosQueue) { UI.toast('API 未更新 / API out of date', 'error'); return; }
    return API.staff.getPosQueue().then(function (res) {
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error) && verbose) UI.toast(res.error.message, 'error');
        renderQueue(true);
        return res;
      }
      state.errorCode = null;
      state.tickets = res.data.pending || [];
      state.today = res.data.today || null;
      state.pollSeconds = Number(res.data.pollSeconds) || 8;
      renderQueue(false);
      return res;
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || state.tab !== 'queue') return;
      loadQueue(false);
    }, Math.max(5, state.pollSeconds) * 1000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function renderQueue(force) {
    var box = document.getElementById('queueBody');
    if (!box) return;

    set('statOpen', state.tickets.length);
    set('statBound', state.today ? state.today.bound : 0);
    set('statPoints', state.today ? UI.points(state.today.points) : 0);
    set('queueCount', state.tickets.length);
    set('tabQueueCount', state.tickets.length);

    var status = document.getElementById('queueStatus');
    if (status) {
      status.textContent = state.errorCode
        ? '载入失败 ' + state.errorCode
        : (state.tickets.length ? state.tickets.length + ' 张单据等着进单' : '目前没有待进单 · 去点餐台录一张');
      status.className = 'a-sub' + (state.errorCode ? ' warn' : '');
    }

    var sig = JSON.stringify([state.errorCode, state.tickets, state.today]);
    if (!force && sig === state.signature) return;
    state.signature = sig;

    if (state.errorCode) {
      box.innerHTML = '<div class="a-empty">' +
        '载入失败 / LOAD FAILED<br>' + UI.esc(state.errorCode) +
        '<br><button class="chip mt-16" id="retryBtn">重试 RETRY</button></div>';
      on('retryBtn', function () { loadQueue(true); });
    } else if (!state.tickets.length) {
      box.innerHTML = '<div class="a-empty" style="padding:20px">' +
        '还没有待进单<br><span class="tiny">顾客在 foodcourt 付完款 → 去点餐台录单</span></div>';
    } else {
      box.innerHTML = state.tickets.map(ticketCard).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-scan]'), function (node) {
        node.addEventListener('click', function () {
          var id = node.getAttribute('data-scan');
          var hit = null;
          state.tickets.forEach(function (t) { if (!hit && t.orderId === id) hit = t; });
          if (hit) beginScan(hit);
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-cancel]'), function (node) {
        node.addEventListener('click', function () {
          cancelTicket(node.getAttribute('data-cancel'));
        });
      });
    }

    renderToday();
  }

  function ticketCard(t) {
    return '<div class="ticket" data-ticket="' + UI.esc(t.orderId) + '">' +
      '<div class="tk-top">' +
        '<span class="tk-num">' + UI.esc(t.orderNumber) + '</span>' +
        '<span class="tk-amt">' + UI.money(t.amount) + '</span>' +
      '</div>' +
      (t.note ? '<div class="tk-note">' + UI.esc(t.note) + '</div>' : '') +
      '<div class="tk-meta">' + UI.esc(t.source) + ' · ' + UI.esc(UI.timeOnly(t.createdAt)) + '</div>' +
      '<div class="tk-actions">' +
        '<button class="big-action" data-scan="' + UI.esc(t.orderId) + '">' +
          '扫会员码进单 SCAN MEMBER</button>' +
        '<button class="chip" data-cancel="' + UI.esc(t.orderId) + '">✕</button>' +
      '</div>' +
    '</div>';
  }

  function renderToday() {
    var box = document.getElementById('todayBody');
    if (!box) return;
    var list = (state.today && state.today.recent) || [];
    if (!list.length) {
      box.innerHTML = '<div class="a-empty" style="padding:18px">今天还没有进单</div>';
      return;
    }
    box.innerHTML = '<div class="a-list">' + list.map(function (t) {
      return '<div class="a-item">' +
        '<div class="a-main">' +
          '<div class="a-title">' + UI.esc(t.orderNumber) +
            ' · <span style="color:var(--a-gold)">' + UI.money(t.amount) + '</span></div>' +
          '<div class="a-sub">' + UI.esc(t.customerName || '—') +
            ' · +' + UI.points(t.pointsEarned) + ' 分 · ' + UI.esc(UI.timeOnly(t.boundAt)) + '</div>' +
        '</div>' +
        '<div class="a-right"><span class="chip ok">已进单</span></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function cancelTicket(orderId) {
    var hit = null;
    state.tickets.forEach(function (t) { if (!hit && t.orderId === orderId) hit = t; });
    UI.confirmDialog(
      '取消单据 ' + (hit ? hit.orderNumber : '') + '？',
      'Cancel this ticket?（还没进分才可以取消）',
      '取消 CANCEL'
    ).then(function (yes) {
      if (!yes) return;
      UI.showLoading('CANCELLING');
      API.staff.cancelPosTicket(orderId, 'Cancelled at POS').then(function (res) {
        UI.hideLoading();
        if (!res.success) {
          if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
          loadQueue(false);
          return;
        }
        UI.toast('已取消单据', 'success');
        loadQueue(false);
      });
    });
  }

  /* ---------------------------------------------------------
     扫码 → 确认 → 进分
     --------------------------------------------------------- */

  function beginScan(ticket) {
    state.selected = ticket;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;

    var box = document.getElementById('scanTicketBox');
    if (box) {
      box.innerHTML =
        '<div class="tk-top">' +
          '<span class="tk-num">' + UI.esc(ticket.orderNumber) + '</span>' +
          '<span class="tk-amt">' + UI.money(ticket.amount) + '</span>' +
        '</div>' +
        (ticket.note ? '<div class="tk-note">' + UI.esc(ticket.note) + '</div>' : '') +
        '<div class="tk-meta">' + UI.esc(ticket.source) + '</div>';
    }

    var manual = document.getElementById('manualInput');
    if (manual) manual.value = '';

    show('scan');

    if (el.hint) el.hint.textContent = '请顾客出示会员码（条码，或条码下方的 QR）';
    if (MEMBER_SCANNER.hasCamera()) startCamera();
    else if (el.hint) el.hint.textContent = '这台装置没有相机 · 请用下面的手动输入';
  }

  function startCamera() {
    MEMBER_SCANNER.start({
      video: el.video,
      onStart: function (hasBarcode) {
        el.scanBox.style.display = '';
        showBtn('startScanBtn', false);
        showBtn('stopScanBtn', true);
        el.hint.textContent = hasBarcode ? '把顾客的会员条码对准框内' : '请扫会员条码下方的 QR';
      },
      onCode: handleCode,
      onError: function (why) {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
        if (el.support) el.support.innerHTML = MEMBER_SCANNER.supportText();
        if (why === 'CAMERA_DENIED') UI.toast('开不了相机，请用手动输入 / Camera unavailable', 'error');
      },
      onStop: function () {
        el.scanBox.style.display = 'none';
        showBtn('startScanBtn', true);
        showBtn('stopScanBtn', false);
      }
    });
  }

  function handleCode(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToKiosk(); return; }
    MEMBER_SCANNER.stop();
    UI.showLoading('VERIFYING');

    API.staff.scanMemberCode(text).then(function (res) {
      UI.hideLoading();
      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        return;
      }
      state.errorCode = null;
      state.customer = res.data.customer;
      state.membership = res.data.membership;
      state.verifyToken = res.data.verifyToken;
      state.verifyLeft = Number(res.data.verifySeconds) || 180;
      renderConfirm();
      show('confirm');
      startCountdown();
      UI.toast('已确认 ' + (state.customer.name || state.customer.customerId), 'success');
    });
  }

  function renderConfirm() {
    var c = state.customer || {};
    var t = state.selected || {};

    var box = document.getElementById('confirmCustomer');
    if (box) {
      box.innerHTML =
        '<div class="a-title">' + UI.esc(c.name || '—') + '</div>' +
        '<div class="a-sub">' + UI.esc(c.customerId || '') + ' · ' + UI.esc(c.phone || '') + '</div>' +
        '<div class="mt-8">' +
          row('等级 TIER', UI.esc((state.membership && state.membership.tier) || 'MEMBER')) +
          row('现有积分 POINTS', UI.esc(String(c.currentPoints || 0)) + ' 分') +
          row('钱包 WALLET', UI.money(c.walletBalance || 0)) +
          row('到店 VISITS', UI.esc(String(c.totalVisits || 0)) + ' 次') +
        '</div>';
    }

    var tk = document.getElementById('confirmTicket');
    if (tk) {
      tk.innerHTML =
        row('单据 TICKET', UI.esc(t.orderNumber || '—')) +
        row('消费金额 BILL', '<span style="font-size:18px;color:var(--a-gold)">' +
          UI.money(t.amount || 0) + '</span>') +
        row('积分 / Reward', '由后端按规则自动计算');
    }
  }

  function row(k, v) {
    return '<div class="pos-row"><span class="pos-k">' + k + '</span>' +
      '<span class="pos-v">' + v + '</span></div>';
  }

  function startCountdown() {
    stopCountdown();
    var left = document.getElementById('verifyLeft');
    if (left) { left.textContent = state.verifyLeft + ' 秒内有效'; left.style.color = ''; }
    countdownTimer = setInterval(function () {
      state.verifyLeft -= 1;
      if (left) {
        left.textContent = state.verifyLeft + ' 秒内有效';
        if (state.verifyLeft <= 30) left.style.color = '#E2696B';
      }
      if (state.verifyLeft <= 0) {
        stopCountdown();
        UI.toast('验证已过期，请重新扫码 / Verification expired', 'error');
        if (state.selected) beginScan(state.selected);
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function backToKiosk() {
    stopCountdown();
    MEMBER_SCANNER.stop();
    state.selected = null;
    state.customer = null;
    state.verifyToken = '';
    state.result = null;
    show('kiosk');
    loadQueue(false);
  }

  function confirm() {
    if (state.busy) return;
    if (!state.selected) { UI.toast('请先选一张单据 / Pick a ticket first', 'error'); backToKiosk(); return; }
    if (!state.verifyToken) { UI.toast('请先扫顾客的会员码 / Scan the member code first', 'error'); return; }

    state.busy = true;
    var btn = document.getElementById('confirmBtn');
    if (btn) btn.disabled = true;
    UI.showLoading('SAVING');

    API.staff.bindPosTicket({
      orderId: state.selected.orderId,
      customerId: state.customer.customerId,
      verifyToken: state.verifyToken
    }).then(function (res) {
      UI.hideLoading();
      state.busy = false;
      if (btn) btn.disabled = false;

      if (!res.success) {
        state.errorCode = res.error.code;
        if (!ADMIN.handleError(res.error)) UI.toast(res.error.message, 'error');
        if (res.error.code === 'MEMBER_VERIFY_EXPIRED' ||
            res.error.code === 'MEMBER_VERIFY_REQUIRED' ||
            res.error.code === 'MEMBER_VERIFY_MISMATCH') {
          if (state.selected) beginScan(state.selected);
        } else if (res.error.code === 'TICKET_ALREADY_BOUND') {
          backToKiosk();
        }
        return;
      }

      state.errorCode = null;
      state.result = res.data;
      stopCountdown();
      renderResult();
      show('result');
      UI.toast('已进单 · +' + res.data.pointsEarned + ' 分', 'success');
    });
  }

  function renderResult() {
    var r = state.result || {};
    var t = state.selected || {};

    set('rName', (r.customer && r.customer.name) || '—');
    set('rPoints', '+' + (r.pointsEarned || 0) + ' 分');
    set('rTicket', t.orderNumber || '—');
    set('rBill', UI.money(r.billAmount || 0));
    set('rVisit', r.visitCounted ? '算一次到店' : '6 小时内已算过，不重复计');
    set('rTotal', (r.customer ? r.customer.currentPoints : 0) + ' 分');

    var box = document.getElementById('rReward');
    if (box) {
      box.innerHTML = r.reward
        ? '🎁 已发出 Reward ' + UI.money(r.reward.amount) + ' · 顾客可在会员端开启'
        : '<span class="muted-2">未达 Reward 门槛，本次只发积分</span>';
    }
  }

  /* ---------------- 测试用 ---------------- */

  function debugState() {
    return {
      tab: state.tab,
      menuProducts: state.menu ? state.menu.products.length : 0,
      categoryId: state.categoryId,
      lines: state.lines.map(function (l) { return l.productId + '×' + l.qty; }),
      linesTotal: linesTotalSen(),
      bill: billSen(),
      useManualAmount: state.useManualAmount,
      queueCount: state.tickets.length,
      selectedOrderId: state.selected ? state.selected.orderId : null,
      hasVerifyToken: !!state.verifyToken,
      customerId: state.customer ? state.customer.customerId : null,
      pointsEarned: state.result ? state.result.pointsEarned : null,
      errorCode: state.errorCode,
      busy: state.busy
    };
  }

  return {
    init: init,
    loadMenu: loadMenu,
    loadQueue: loadQueue,
    handleCode: handleCode,
    addProduct: addProduct,
    setLineQty: setLineQty,
    clearLines: clearLines,
    saveTicket: saveTicket,
    beginScan: beginScan,
    toggleManualAmount: toggleManualAmount,
    show: show,
    debugState: debugState
  };
})();
