/* PicklePOS - reports, Z-reading (end of day), CSV export */
(function (POS) {
  'use strict';
  const U = POS.util, P = POS.print, S = POS.state;
  let el = null, from = null, to = null, data = null;

  POS.views.reports = {
    render: function (root) {
      from = from || U.dayKey();
      to = to || U.dayKey();
      el = U.h('<div class="page"><div class="page-head"><h2>Reports</h2>' +
        '<label class="inline">From <input type="date" id="r-from"></label><label class="inline">To <input type="date" id="r-to"></label>' +
        '<button class="btn sm" data-r="today">Today</button><button class="btn sm" data-r="yest">Yesterday</button>' +
        '<button class="btn sm" data-r="week">Last 7 days</button><button class="btn sm" data-r="month">This month</button></div>' +
        '<div class="toolbar"><button class="btn primary" id="r-z">Print Z-Reading</button>' +
        '<button class="btn" id="r-close">Close Day &amp; Backup</button><button class="btn" id="r-csv">Export Sales (CSV)</button>' +
        '<button class="btn" id="r-stock">Out of Stock List</button></div><div id="r-body"></div></div>');
      root.appendChild(el);
      const fi = U.$('#r-from', el), ti = U.$('#r-to', el);
      fi.value = from;
      ti.value = to;
      fi.onchange = () => { from = fi.value; if (to < from) { to = from; ti.value = to; } load(); };
      ti.onchange = () => { to = ti.value; if (to < from) { from = to; fi.value = from; } load(); };
      U.$$('[data-r]', el).forEach((b) => {
        b.onclick = () => {
          const d = new Date(), r = b.getAttribute('data-r');
          const k = (y, m, dd) => U.dayKey(new Date(y, m, dd).getTime());
          if (r === 'today') from = to = U.dayKey();
          if (r === 'yest') from = to = k(d.getFullYear(), d.getMonth(), d.getDate() - 1);
          if (r === 'week') { from = k(d.getFullYear(), d.getMonth(), d.getDate() - 6); to = U.dayKey(); }
          if (r === 'month') { from = k(d.getFullYear(), d.getMonth(), 1); to = U.dayKey(); }
          fi.value = from;
          ti.value = to;
          load();
        };
      });
      U.$('#r-z', el).onclick = () => { if (data) P.send(zHTML(data)); };
      U.$('#r-close', el).onclick = closeDay;
      U.$('#r-csv', el).onclick = exportCsv;
      U.$('#r-stock', el).onclick = stockReport;
      load();
    },
    refresh: function () { if (el) load(); },
    destroy: function () { el = null; }
  };

  POS.loadReport = async function (a, b) {
    const orders = await POS.db.byIndex('orders', 'day', IDBKeyRange.bound(a, b));
    return aggregate(orders, a, b);
  };

  async function load() {
    data = await POS.loadReport(from, to);
    if (el) draw();
  }

  function aggregate(orders, a, b) {
    const r = {
      from: a, to: b, orders: orders, count: 0, gross: 0, net: 0, food: 0, court: 0, courtMin: 0,
      discounts: { senior: 0, pwd: 0, custom: 0 }, vatExempt: 0, seniorCount: 0, pwdCount: 0,
      methods: {}, items: {}, cats: {}, cashiers: {}, voids: { count: 0, amount: 0 }, change: 0, firstNo: null, lastNo: null
    };
    S.settings.payMethods.forEach((m) => { r.methods[m] = 0; });
    orders.forEach((o) => {
      if (o.status === 'void') {
        r.voids.count++;
        r.voids.amount += o.totals ? o.totals.total : 0;
        return;
      }
      if (o.status !== 'paid') return;
      const t = o.totals;
      r.count++;
      r.gross += t.subtotal;
      r.net += t.total;
      r.food += t.food;
      r.court += t.court;
      r.courtMin += t.courtMinutes || 0;
      r.vatExempt += t.vatExempt || 0;
      if (o.discount) {
        r.discounts[o.discount.type] = (r.discounts[o.discount.type] || 0) + t.discount;
        if (o.discount.type === 'senior') r.seniorCount += o.discount.count || 1;
        if (o.discount.type === 'pwd') r.pwdCount += o.discount.count || 1;
      }
      (o.payments || []).forEach((p) => { r.methods[p.method] = (r.methods[p.method] || 0) + p.amount; });
      const cn = o.paidBy || o.cashier || '-';
      r.cashiers[cn] = r.cashiers[cn] || { count: 0, amount: 0 };
      r.cashiers[cn].count++;
      r.cashiers[cn].amount += t.total;
      if (r.firstNo == null || o.no < r.firstNo) r.firstNo = o.no;
      if (r.lastNo == null || o.no > r.lastNo) r.lastNo = o.no;
      o.lines.forEach((l) => {
        if (l.kind === 'court') {
          const k = 'court:' + l.name;
          r.items[k] = r.items[k] || { name: l.name + ' (hours)', cat: 'Court Rental', qty: 0, amount: 0 };
          r.items[k].qty += (l.billed || l.minutes || 0) / 60;
          r.items[k].amount += l.amount != null ? l.amount : U.r2(l.minutes / 60 * l.rate);
          return;
        }
        const cat = POS.catById(l.catId);
        const cname = cat ? cat.name : 'Other';
        const k = l.itemId + ':' + l.price;
        r.items[k] = r.items[k] || { name: l.name, cat: cname, qty: 0, amount: 0 };
        r.items[k].qty += l.qty;
        r.items[k].amount += l.qty * l.price;
      });
    });
    Object.keys(r.items).forEach((k) => {
      const i = r.items[k];
      r.cats[i.cat] = r.cats[i.cat] || { qty: 0, amount: 0 };
      r.cats[i.cat].qty += i.qty;
      r.cats[i.cat].amount += i.amount;
    });
    r.discountTotal = r.discounts.senior + r.discounts.pwd + r.discounts.custom;
    return r;
  }

  let statN = 0;
  const stat = (k, v, sub) => '<div class="card stat" style="--i:' + (statN++) + '"><div class="k">' + k + '</div><div class="v" data-money="' + v + '">' +
    U.money(v) + '</div>' + (sub ? '<div class="muted small">' + sub + '</div>' : '') + '</div>';
  const fmtQty = (q) => (Math.round(q * 100) / 100).toString();

  function draw() {
    const r = data;
    const items = Object.keys(r.items).map((k) => r.items[k]).sort((a, b) => b.amount - a.amount);
    statN = 0;
    let h = '<div class="stats">' +
      stat('Net sales', r.net, r.count + ' transaction(s)') +
      stat('Cafe sales', r.food, r.net ? Math.round(r.food / (r.food + r.court || 1) * 100) + '% of sales' : '') +
      stat('Court rental', r.court, U.fmtDur(r.courtMin) + ' billed') +
      stat('Discounts', r.discountTotal + r.vatExempt, (r.seniorCount + r.pwdCount) + ' Senior/PWD') +
      stat('Voids', r.voids.amount, r.voids.count + ' voided') +
      stat('Average sale', r.count ? r.net / r.count : 0) + '</div>';
    const split = r.food + r.court;
    if (split > 0) {
      h += '<div class="card split"><div class="split-bar"><i class="cafe" style="width:' + (r.food / split * 100).toFixed(1) + '%"></i>' +
        '<i class="court" style="width:' + (r.court / split * 100).toFixed(1) + '%"></i></div><div class="split-legend">' +
        '<span><i class="cafe"></i>Cafe ' + U.money(r.food) + '</span><span><i class="court"></i>Courts ' + U.money(r.court) + '</span></div></div>';
    }
    h += '<div class="report-grid"><div class="card"><h3 class="sec-h">Payments received</h3><table class="tbl plain">' +
      Object.keys(r.methods).map((m) => '<tr><td>' + U.esc(m) + '</td><td class="right">' + U.money(r.methods[m]) + '</td></tr>').join('') +
      '<tr class="tot"><td>Total</td><td class="right">' + U.money(r.net) + '</td></tr></table>' +
      '<h3 class="sec-h">By category</h3><table class="tbl plain">' + Object.keys(r.cats).sort((a, b) => r.cats[b].amount - r.cats[a].amount)
        .map((c) => '<tr><td>' + U.esc(c) + '</td><td class="right">' + U.money(r.cats[c].amount) + '</td></tr>').join('') + '</table>' +
      '<h3 class="sec-h">By cashier</h3><table class="tbl plain">' + Object.keys(r.cashiers).map((c) => '<tr><td>' + U.esc(c) + ' (' +
        r.cashiers[c].count + ')</td><td class="right">' + U.money(r.cashiers[c].amount) + '</td></tr>').join('') + '</table>' +
      '<h3 class="sec-h">Summary</h3><table class="tbl plain"><tr><td>Gross sales</td><td class="right">' + U.money(r.gross) + '</td></tr>' +
      '<tr><td>Senior discount</td><td class="right">-' + U.money(r.discounts.senior) + '</td></tr>' +
      '<tr><td>PWD discount</td><td class="right">-' + U.money(r.discounts.pwd) + '</td></tr>' +
      '<tr><td>Other discounts</td><td class="right">-' + U.money(r.discounts.custom) + '</td></tr>' +
      (r.vatExempt ? '<tr><td>VAT exemption</td><td class="right">-' + U.money(r.vatExempt) + '</td></tr>' : '') +
      '<tr class="tot"><td>Net sales</td><td class="right">' + U.money(r.net) + '</td></tr></table></div>' +
      '<div class="card"><h3 class="sec-h">Items sold</h3>' + (items.length ? '<table class="tbl plain"><thead><tr><th>Item</th><th>Category</th>' +
        '<th class="right">Qty</th><th class="right">Amount</th></tr></thead><tbody>' + items.map((i) => '<tr><td>' + U.esc(i.name) +
        '</td><td class="muted">' + U.esc(i.cat) + '</td><td class="right">' + fmtQty(i.qty) + '</td><td class="right">' + U.money(i.amount) +
        '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No sales in this period.</p>') + '</div></div>';
    U.$('#r-body', el).innerHTML = h;
    U.$$('[data-money]', el).forEach((v) => U.countUp(v, +v.getAttribute('data-money'), U.money, 650));
  }

  const row = (a, b, cls) => '<div class="row' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><span>' + b + '</span></div>';

  function zHTML(r) {
    const s = S.settings;
    let h = P.header(s) + '<div class="c b big">Z-READING</div>';
    h += '<div class="c">' + (r.from === r.to ? U.fmtDayKey(r.from) : U.fmtDayKey(r.from) + ' to ' + U.fmtDayKey(r.to)) + '</div>';
    h += '<div class="c sm">Printed ' + U.fmtDT(Date.now()) + ' by ' + U.esc(S.user.name) + '</div><hr>';
    h += row('Transactions', r.count) + row('Order # range', r.firstNo ? r.firstNo + ' - ' + r.lastNo : '-');
    h += '<hr>' + row('Gross sales', U.num(r.gross)) + row('Less Senior', '-' + U.num(r.discounts.senior)) +
      row('Less PWD', '-' + U.num(r.discounts.pwd)) + row('Less other disc.', '-' + U.num(r.discounts.custom));
    if (r.vatExempt) h += row('Less VAT exempt', '-' + U.num(r.vatExempt));
    h += row('NET SALES', U.money(r.net), 'b big') + '<hr>';
    h += row('Cafe sales', U.num(r.food)) + row('Court rental', U.num(r.court)) + row('Court time billed', U.fmtDur(r.courtMin));
    h += '<hr><div class="b">PAYMENTS</div>';
    Object.keys(r.methods).forEach((m) => { h += row(U.esc(m), U.num(r.methods[m])); });
    h += '<hr><div class="b">BY CATEGORY</div>';
    Object.keys(r.cats).forEach((c) => { h += row(U.esc(c), U.num(r.cats[c].amount)); });
    h += '<hr><div class="b">ITEMS SOLD</div>';
    Object.keys(r.items).map((k) => r.items[k]).sort((a, b) => b.amount - a.amount)
      .forEach((i) => { h += row(fmtQty(i.qty) + ' ' + U.esc(i.name), U.num(i.amount)); });
    h += '<hr>' + row('Senior/PWD customers', r.seniorCount + r.pwdCount) + row('Voids', r.voids.count + ' / ' + U.num(r.voids.amount));
    h += '<hr><div class="b">CASHIERS</div>';
    Object.keys(r.cashiers).forEach((c) => { h += row(U.esc(c) + ' (' + r.cashiers[c].count + ')', U.num(r.cashiers[c].amount)); });
    h += '<hr>' + row('Cash on hand (count)', '__________') + row('Difference', '__________');
    return h + '<br><div class="c">Signature: ______________</div>';
  }

  async function closeDay() {
    const today = U.dayKey();
    const r = await POS.loadReport(today, today);
    if (S.open.length && !(await U.confirm('There are still ' + S.open.length + ' open tab(s). Close the day anyway? They will stay open.', 'Close Day'))) return;
    P.send(zHTML(r));
    await POS.backup();
  }

  function exportCsv() {
    if (!data) return;
    const rows = [['Date', 'Time', 'Order #', 'Status', 'Customer', 'Cashier', 'Type', 'Item', 'Category', 'Qty', 'Price', 'Line Amount',
      'Order Subtotal', 'Order Discount', 'Order Total', 'Payment Methods', 'Reference Nos', 'Discount Type', 'Void Reason']];
    data.orders.slice().sort((a, b) => a.no - b.no).forEach((o) => {
      const ts = o.paidAt || o.voidAt;
      const t = o.totals || {};
      o.lines.forEach((l) => {
        const cat = l.kind === 'court' ? 'Court Rental' : ((POS.catById(l.catId) || {}).name || '');
        const qty = l.kind === 'court' ? fmtQty((l.billed || l.minutes || 0) / 60) : l.qty;
        const price = l.kind === 'court' ? l.rate : l.price;
        const amt = l.kind === 'court' ? (l.amount != null ? l.amount : U.r2(l.minutes / 60 * l.rate)) : U.r2(l.qty * l.price);
        rows.push([U.dayKey(ts), U.fmtTime(ts), o.no, o.status, o.name, o.paidBy || o.cashier, l.kind, l.name, cat, qty, price, amt,
          t.subtotal, U.r2((t.discount || 0) + (t.vatExempt || 0)), t.total, (o.payments || []).map((p) => p.method).join(' + '),
          (o.payments || []).map((p) => p.ref).filter(Boolean).join(' '), o.discount ? o.discount.type : '', o.voidReason || '']);
      });
    });
    U.download('PicklePOS-sales-' + from + '_to_' + to + '.csv', '﻿' + U.csv(rows), 'text/csv');
    U.toast('Saved to your Downloads folder (opens in Excel)', 'ok');
  }

  // Items currently marked out of stock (to restock / tell the supplier)
  function stockReport() {
    const items = S.items.filter((i) => i.soldOut && i.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    const body = items.length ? '<table class="tbl"><thead><tr><th>Out of stock</th><th>Category</th></tr></thead><tbody>' +
      items.map((i) => '<tr><td>' + U.esc(i.name) + '</td><td>' + U.esc((POS.catById(i.categoryId) || {}).name || '') + '</td></tr>').join('') + '</tbody></table>' :
      '<p class="muted">Everything is in stock.</p>';
    U.modal({
      title: 'Out of Stock List', body: body, buttons: [{
        label: 'Print', onClick: () => {
          P.send(P.header(S.settings) + '<div class="c b">OUT OF STOCK</div><div class="c sm">' + U.fmtDT(Date.now()) + '</div><hr>' +
            (items.length ? items.map((i) => '<div>[ ] ' + U.esc(i.name) + '</div>').join('') : '<div>Everything is in stock.</div>'));
          return false;
        }
      }, { label: 'Close', cls: 'primary' }]
    });
  }
})(window.POS);
