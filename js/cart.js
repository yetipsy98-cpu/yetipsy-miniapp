/* =============================================================
   YETIPSY — cart.js（2.0 Phase 4）
   -------------------------------------------------------------
   购物车（§9 §73）

   ★ 这里存的数字只是「显示用」。
     §41/§42：真正下单时后端会自己读 Products 重新算价、
     重新验证库存与规格，前端送过去的金额一律被忽略。
     所以 LocalStorage 被改过也不会造成价格漏洞 —— 只会让
     顾客在 Checkout 看到「价格已变动」而被挡下（QUOTE_MISMATCH）。

   存放：LocalStorage，key = YETIPSY_CART_V2
   结构：[{ lineId, productId, nameEN, nameZH, unitPrice,
            quantity, options:[{optionGroup,optionId,nameEN,nameZH}],
            note, addedAt }]
   ============================================================= */

var CART = (function () {

  var KEY = (YETIPSY_CONFIG && YETIPSY_CONFIG.STORAGE && YETIPSY_CONFIG.STORAGE.cart) ||
            'YETIPSY_CART_V2';
  var MAX_ITEMS = 20;          // 与后端 MAX_ORDER_ITEMS 一致（§63）
  var MAX_QTY_PER_LINE = 20;

  /* ---------------------------------------------------------
     存取
     --------------------------------------------------------- */

  function items() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      /* 只留形状正确的项，避免被改坏的资料让整页挂掉 */
      return arr.filter(function (it) {
        return it && typeof it.productId === 'string' && it.productId &&
               Number(it.quantity) > 0;
      }).map(function (it) {
        return {
          lineId: String(it.lineId || it.productId),
          productId: String(it.productId),
          nameEN: String(it.nameEN || ''),
          nameZH: String(it.nameZH || ''),
          unitPrice: Math.max(0, Math.round(Number(it.unitPrice) || 0)),
          quantity: Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.round(Number(it.quantity) || 1))),
          options: Array.isArray(it.options) ? it.options.filter(function (o) {
            return o && o.optionId;
          }) : [],
          note: String(it.note || '').slice(0, 200),
          addedAt: String(it.addedAt || '')
        };
      });
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function clear() {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
  }

  /* ---------------------------------------------------------
     计算（显示用）
     --------------------------------------------------------- */

  /** 一条明细的小计：(单价 + 规格加价) × 数量。加价以后端为准，这里用加入时记下的。 */
  function lineTotalSen(item) {
    return (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
  }

  function subtotalSen() {
    return items().reduce(function (sum, it) { return sum + lineTotalSen(it); }, 0);
  }

  function count() {
    return items().reduce(function (sum, it) { return sum + (Number(it.quantity) || 0); }, 0);
  }

  /* ---------------------------------------------------------
     操作
     --------------------------------------------------------- */

  /**
   * 加入一项。同商品 + 同规格 + 同备注 → 累加数量；否则新增一列。
   * @returns {{ok:boolean, message?:string, lineId?:string}}
   */
  function add(entry) {
    if (!entry || !entry.productId) return { ok: false, message: '缺少商品编号 / Missing product id' };

    var qty = Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.round(Number(entry.quantity) || 1)));
    var options = (entry.options || []).filter(function (o) { return o && o.optionId; });

    var list = items();
    if (list.length >= MAX_ITEMS) {
      return { ok: false, message: '单张订单最多 ' + MAX_ITEMS + ' 项 / Too many items' };
    }

    var signature = signatureOf(entry.productId, options, entry.note);
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (signatureOf(list[i].productId, list[i].options, list[i].note) === signature) {
        existing = list[i];
        break;
      }
    }

    if (existing) {
      var next = Math.min(MAX_QTY_PER_LINE, existing.quantity + qty);
      if (next === existing.quantity) {
        return { ok: false, message: '单项最多 ' + MAX_QTY_PER_LINE + ' 杯 / Max quantity reached' };
      }
      existing.quantity = next;
      save(list);
      return { ok: true, lineId: existing.lineId };
    }

    var lineId = entry.productId + '-' + shortHash(signature) + '-' + Date.now().toString(36).slice(-4);
    list.push({
      lineId: lineId,
      productId: String(entry.productId),
      nameEN: String(entry.nameEN || ''),
      nameZH: String(entry.nameZH || ''),
      unitPrice: Math.max(0, Math.round(Number(entry.unitPrice) || 0)),
      quantity: qty,
      options: options,
      note: String(entry.note || '').slice(0, 200),
      addedAt: new Date().toISOString()
    });
    save(list);
    return { ok: true, lineId: lineId };
  }

  function setQuantity(lineId, qty) {
    var list = items();
    var n = Math.round(Number(qty));
    if (!isFinite(n) || n < 1) return remove(lineId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].lineId === lineId) {
        list[i].quantity = Math.min(MAX_QTY_PER_LINE, n);
        save(list);
        return { ok: true };
      }
    }
    return { ok: false, message: '找不到这一项 / Line not found' };
  }

  function remove(lineId) {
    var list = items().filter(function (it) { return it.lineId !== lineId; });
    save(list);
    return { ok: true };
  }

  /* ---------------------------------------------------------
     小工具
     --------------------------------------------------------- */

  function signatureOf(productId, options, note) {
    var opts = (options || []).map(function (o) { return o.optionId; }).sort().join('+');
    return productId + '|' + opts + '|' + String(note || '').trim();
  }

  function shortHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return Math.abs(h).toString(36);
  }

  return {
    items: items,
    add: add,
    setQuantity: setQuantity,
    remove: remove,
    clear: clear,
    count: count,
    subtotalSen: subtotalSen,
    lineTotalSen: lineTotalSen,
    MAX_ITEMS: MAX_ITEMS
  };

})();
