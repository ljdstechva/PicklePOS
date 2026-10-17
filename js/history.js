/* PicklePOS - sales history: find, reprint and void sales */
(function (POS) {
  'use strict';
  const U = POS.util, C = POS.calc, P = POS.print, S = POS.state;
  let el = null, day = null, q = '', orders = [];

  POS.views.history = {
    render: function (root) {
      day = day || U.dayKey();
      el = U.h('<div class="page"><div class="page-head"><h2>Sales History</h2>' +
        '<button class="btn sm" id="h-prev">&larr;</button><input type="date" id="h-day" style="width:auto">' +
        '<button class="btn sm" id="h-next">&rarr;</button><button class="btn sm" id="h-today">Today</button>' +
        '<input type="text" id="h-q" placeholder="Search name, order # or ref no." style="width:260px"></div>' +
        '<div id="h-sum" class="muted"></div><div id="h-list"></div></div>');
      root.appendChild(el);
      const di = U.$('#h-day', el), qi = U.$('#h-q', el);
      di.value = day;
      qi.value = q;
      di.onchange = () => { if (di.value) { day = di.value; load(); } };
      const shift = (n) => {
        const p = day.split('-');
        day = U.dayKey(new Date(+p[0], +p[1] - 1, +p[2] + n).getTime());
        di.value = day;
        load();
      };
      U.$('#h-prev', el).onclick = () => shift(-1);
      U.$('#h-next', el).onclick = () => shift(1);
      U.$('#h-today', el).onclick = () => { day = U.dayKey(); di.value = day; load(); };
      qi.oninput = () => { q = qi.value; draw(); };
      U.$('#h-list', el).onclick = (e) => {
        const r = e.target.closest('[data-id]');
        if (r) detail(orders.find((o) => o.id === r.getAttribute('data-id')));
      };
      load();
    },
    refresh: function () { if (el) load(); },
    destroy: function () { el = null; }
  };

  async function load() {
    orders = (await POS.db.byIndex('orders', 'day', IDBKeyRange.only(day)))
      .sort((a, b) => (b.paidAt || b.voidAt) - (a.paidAt || a.voidAt));
    if (el) draw();
  }

  const methodsOf = (o) => (o.payments || []).map((p) => p.method).filter((m, i, a) => a.indexOf(m) === i).join(', ');

  function draw() {
    const s = q.trim().toLowerCase();
    const list = orders.filter((o) => !s || String(o.no).indexOf(s) >= 0 || (o.name || '').toLowerCase().indexOf(s) >= 0 ||
      (o.payments || []).some((p) => (p.ref || '').toLowerCase().indexOf(s) >= 0));
    const paid = orders.filter((o) => o.status === 'paid');
    U.$('#h-sum', el).innerHTML = U.fmtDayKey(day) + ' &middot; ' + paid.length + ' sale(s) &middot; ' +
      U.money(paid.reduce((a, o) => a + o.totals.total, 0)) + ' total';
    U.$('#h-list', el).innerHTML = list.length ? '<table class="tbl"><thead><tr><th>#</th><th>Time</th><th>Customer</th><th>Items</th>' +
      '<th>Payment</th><th>Cashier</th><th>Status</th><th class="right">Total</th></tr></thead><tbody>' +
      list.map((o) => '<tr class="click' + (o.status === 'void' ? ' voided' : '') + '" data-id="' + o.id + '"><td>' + o.no + '</td><td>' +
        U.fmtTime(o.paidAt || o.voidAt) + '</td><td>' + U.esc(o.name) + '</td><td class="ellip">' +
        U.esc(o.lines.map((l) => (l.kind === 'item' ? l.qty + 'x ' : '') + l.name).join(', ')) + '</td><td>' + U.esc(methodsOf(o)) +
        '</td><td>' + U.esc(o.paidBy || o.cashier || '') + '</td><td><span class="tag ' + o.status + '">' + (o.status === 'void' ? 'VOID' : 'PAID') +
        '</span></td><td class="right">' + U.money(o.totals ? o.totals.total : 0) + '</td></tr>').join('') + '</tbody></table>' :
      '<div class="empty">No sales on this day.</div>';
  }

  function detail(o) {
    if (!o) return;
    let extra = '';
    if (o.status === 'void') extra = '<p class="void-note">Voided ' + U.fmtDT(o.voidAt) + ' by ' + U.esc(o.voidBy) + ': ' + U.esc(o.voidReason) + '</p>';
    const buttons = [];
    if (o.status === 'paid') buttons.push({ label: 'Void Sale', cls: 'danger', onClick: () => voidSale(o) });
    buttons.push({ label: 'Reprint Receipt', onClick: () => { P.receipt(o, { reprint: true }); return false; } });
    buttons.push({ label: 'Close', cls: 'primary' });
    U.modal({ title: 'Order #' + o.no, body: extra + P.preview(P.receiptHTML(o, { reprint: true })), buttons: buttons });
  }

  async function voidSale(o) {
    if (!(await POS.requireOwner('void sale #' + o.no, 'void'))) return false;
    const reason = await U.ask('Void sale #' + o.no, 'Reason (e.g. wrong item, refund)', '', { required: true, okLabel: 'Void Sale' });
    if (!reason) return false;
    o.status = 'void';
    o.voidAt = Date.now();
    o.voidBy = S.user.name;
    o.voidReason = reason;
    await POS.saveOrder(o);
    U.toast('Sale #' + o.no + ' voided', 'ok');
    load();
  }
})(window.POS);
