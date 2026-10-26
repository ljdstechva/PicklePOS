/* PicklePOS - 58mm / 80mm thermal printing through the Windows printer driver */
(function (POS) {
  'use strict';
  const U = POS.util, C = POS.calc;
  const P = POS.print = {};
  const esc = U.esc, num = U.num;

  // Printable width in mm. A 58 mm printer's head covers 48 mm, but the rightmost 3-4 mm land
  // off the paper (measured with a calibration print), so the receipt stays inside 44 mm.
  P.width = (s) => (+s.paper === 80 ? 68 : 44);

  P.css = function (s) {
    const w = P.width(s);
    const fs = +s.fontSize || 12;
    return '@page{margin:0}html,body{margin:0;padding:0;background:#fff}' +
      'body{width:' + w + 'mm;padding:0 1mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;' +
      'font-size:' + fs + 'px;line-height:1.3;color:#000;font-weight:600}' +
      P.innerCss(fs) +
      '.feed{height:' + Math.max(0, +s.feedLines || 0) * 5 + 'mm}';
  };
  // Shared by printing and on-screen previews
  P.innerCss = function (fs) {
    return '.c{text-align:center}.b{font-weight:800}.big{font-size:' + (fs + 4) + 'px}.sm{font-size:' + (fs - 1) + 'px}' +
      '.row{display:flex;justify-content:space-between;align-items:flex-start}' +
      '.row>span:first-child{flex:1;padding-right:2mm;min-width:0;word-wrap:break-word}' +
      '.row>span:last-child{white-space:nowrap}' +
      'hr{border:0;border-top:1px dashed #000;margin:4px 0}' +
      '.logo{display:block;margin:0 auto 4px;max-width:70%;max-height:30mm}' +
      '.ind{padding-left:3mm}.note{font-style:italic;padding-left:3mm}' +
      '.k-item{font-size:' + (fs + 4) + 'px;font-weight:800;margin:3px 0}' +
      '.cut{text-align:center;margin:8px 0}';
  };

  const row = (a, b, cls) => '<div class="row' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><span>' + b + '</span></div>';

  P.header = function (s) {
    let h = '';
    if (s.logo) h += '<img class="logo" src="' + s.logo + '">';
    h += '<div class="c b big">' + esc(s.bizName) + '</div>';
    [s.bizLine2, s.address, s.contact].forEach((x) => { if (x) h += '<div class="c sm">' + esc(x) + '</div>'; });
    if (s.tin) h += '<div class="c sm">TIN: ' + esc(s.tin) + '</div>';
    return h + '<hr>';
  };

  P.receiptHTML = function (o, opts) {
    opts = opts || {};
    const s = POS.state.settings;
    const t = o.totals || C.totals(o);
    let h = P.header(s);
    if (s.receiptTitle) h += '<div class="c b">' + esc(s.receiptTitle) + '</div>';
    if (o.status === 'void') h += '<div class="c b big">*** VOIDED ***</div>';
    else if (opts.reprint) h += '<div class="c b">*** REPRINT ***</div>';
    else if (o.status !== 'paid') h += '<div class="c b">BILL / FOR PAYMENT</div>';
    h += row('Order #', esc(o.no || '-'));
    h += row('Date', U.fmtDT(o.paidAt || Date.now()));
    h += row('Cashier', esc(o.paidBy || o.cashier || ''));
    if (o.name && o.name !== 'Walk-in') h += row('Customer', esc(o.name));
    h += '<hr>';

    o.lines.forEach((l) => {
      if (l.kind === 'court') {
        const r = C.court(l);
        const end = l.end || Date.now();
        h += '<div>' + esc(l.name) + ' (' + U.fmtDur(r.billed) + ')</div>';
        h += row('<span class="ind">' + U.fmtTime(l.start) + '-' + U.fmtTime(end) + ' @' + num(l.rate) + '/hr</span>', num(r.amount));
      } else {
        h += '<div>' + esc(l.name) + '</div>';
        h += row('<span class="ind">' + l.qty + ' x ' + num(l.price) + '</span>', num(l.price * l.qty));
        if (l.note) h += '<div class="note sm">' + esc(l.note) + '</div>';
      }
    });
    h += '<hr>';
    h += row('Subtotal', num(t.subtotal));
    const d = o.discount;
    if (d && t.discount + t.vatExempt > 0) {
      if (d.type === 'senior' || d.type === 'pwd') {
        if (t.vatExempt) h += row('Less VAT (exempt)', '-' + num(t.vatExempt));
        h += row('Less ' + C.discountLabel(d) + ' 20%', '-' + num(t.discount));
      } else {
        h += row('Less ' + esc(C.discountLabel(d)) + (d.mode === 'pct' ? ' ' + d.value + '%' : ''), '-' + num(t.discount));
      }
    }
    h += row('TOTAL', U.money(t.total), 'b big');
    (o.payments || []).forEach((p) => {
      h += row(esc(p.method) + (p.ref ? ' <span class="sm">#' + esc(p.ref) + '</span>' : ''), num(p.tendered || p.amount));
    });
    if (t.change > 0) h += row('Change', num(t.change), 'b');
    if (s.vatRegistered && t.vatableSales != null) {
      h += '<hr>' + row('VATable Sales', num(t.vatableSales)) + row('VAT (12%)', num(t.vat));
      h += row('VAT-Exempt Sales', num(t.vatExemptSales));
    }
    if (d && (d.type === 'senior' || d.type === 'pwd')) {
      h += '<hr><div class="sm">' + C.discountLabel(d) + ' ID: ' + esc(d.idNo || '') + '</div>';
      h += '<div class="sm">Name: ' + esc(d.holder || '') + '</div><div class="sm">Signature: ______________</div>';
    }
    if (s.receiptNote) h += '<hr><div class="c b">' + esc(s.receiptNote) + '</div>';
    if (s.footer) h += '<div class="c">' + esc(s.footer) + '</div>';
    return h;
  };

  P.kitchenHTML = function (o, items) {
    let h = '<div class="c b big">KITCHEN ORDER</div>';
    h += '<div class="c b">#' + esc(o.no || '-') + ' &bull; ' + esc(o.name || '') + '</div>';
    h += '<div class="c sm">' + U.fmtDT(Date.now()) + '</div><hr>';
    items.forEach((i) => {
      h += '<div class="k-item">' + i.qty + ' x ' + esc(i.name) + '</div>';
      if (i.note) h += '<div class="note">' + esc(i.note) + '</div>';
    });
    return h + '<hr>';
  };

  // Sends HTML to the default printer through a hidden frame.
  // With Start POS.bat (--kiosk-printing) it prints silently; otherwise the print dialog appears.
  P.send = function (inner) {
    const old = document.getElementById('print-frame');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'print-frame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    const s = POS.state.settings;
    const d = f.contentWindow.document;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title><style>' + P.css(s) +
      '</style></head><body>' + inner + '<div class="feed"></div><div class="c">.</div></body></html>');
    d.close();
    const go = () => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        U.toast('Printing failed: ' + e.message, 'error');
      }
    };
    const imgs = Array.prototype.slice.call(d.images);
    let pending = imgs.filter((i) => !i.complete).length;
    if (!pending) setTimeout(go, 150);
    else imgs.forEach((i) => {
      if (!i.complete) i.onload = i.onerror = () => { if (--pending === 0) setTimeout(go, 100); };
    });
  };

  P.receipt = (o, opts) => P.send(P.receiptHTML(o, opts));
  P.kitchen = (o, items) => P.send(P.kitchenHTML(o, items));
  P.receiptAndKitchen = (o, items) => P.send(P.receiptHTML(o) +
    '<div class="feed"></div><div class="cut">- - - - - tear here - - - - -</div>' + P.kitchenHTML(o, items));

  P.test = function () {
    const s = POS.state.settings;
    P.send(P.header(s) + '<div class="c b">PRINTER TEST</div><div class="c">' + U.fmtDT(Date.now()) + '</div><hr>' +
      row('Item name', '123.45') + row('Another longer item name that wraps', '1,000.00') +
      '<hr>' + row('TOTAL', U.money(1123.45), 'b big') +
      '<hr><div class="c">If this prints clearly, printing is set up correctly.</div>');
  };

  // On-screen preview that looks like the printout
  P.preview = function (inner) {
    const fs = +POS.state.settings.fontSize || 12;
    const w = P.width(POS.state.settings);
    return '<div class="receipt-preview" style="width:' + (w + 6) + 'mm;font-size:' + fs + 'px">' +
      '<style>.receipt-preview ' + P.innerCss(fs).replace(/}(?=.)/g, '}.receipt-preview ') + '</style>' + inner + '</div>';
  };
})(window.POS);
