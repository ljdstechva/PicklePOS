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

  /* ---- "Printing..." overlay: a small printer feeding paper, then "Done" for a moment ---- */
  let ovTimer = null;
  P.showPrinting = function (what) {
    P.hidePrinting(true);
    const ov = U.h('<div class="print-ov" id="print-ov"><div class="print-card">' +
      '<div class="printer"><div class="p-body"></div><div class="p-paper"></div></div>' +
      '<div class="p-text">' + (what ? 'Printing ' + U.esc(what) + '...' : 'Printing...') + '</div></div></div>');
    document.body.appendChild(ov);
    return ov;
  };
  // ok = true: "Done" (green). ok = false: the message in red. ok = 'sent': amber "Sent to the printer"
  // (used when the launcher could not confirm the job finished).
  P.donePrinting = function (ok, msg) {
    clearTimeout(trackTimer);
    const ov = document.getElementById('print-ov');
    if (!ov) return;
    ov.classList.add(ok === true ? 'done' : (ok === 'sent' ? 'sent' : 'failed'));
    const t = ov.querySelector('.p-text');
    if (t) t.innerHTML = ok === true ? '<span class="p-check">&#10003;</span> Done' :
      ok === 'sent' ? '<span class="p-check sent">&#10003;</span> ' + U.esc(msg || 'Sent to the printer') : U.esc(msg || 'Printing failed');
    clearTimeout(ovTimer);
    ovTimer = setTimeout(() => P.hidePrinting(), ok === true ? 1400 : (ok === 'sent' ? 2200 : 3500));
  };
  P.hidePrinting = function (now) {
    clearTimeout(trackTimer);
    const ov = document.getElementById('print-ov');
    if (!ov) return;
    clearTimeout(ovTimer);
    if (now || !POS.anim()) { ov.remove(); return; }
    ov.classList.add('out');
    setTimeout(() => { if (ov.parentNode) ov.remove(); }, 320);
  };

  /* ---- After Chrome has handed the job to Windows, follow it in the print queue through the
     launcher (print-status.js): "Done" only once the job has really gone to the printer; printer
     problems (no paper, cover open, offline) are shown instead. ---- */
  let trackTimer = null;
  function loadPrintStatus(cb) {
    const old = document.getElementById('print-status');
    if (old) old.remove();
    window.POS_PRINT = null;
    const sc = document.createElement('script');
    sc.id = 'print-status';
    sc.src = 'print-status.js?t=' + Date.now();
    sc.onload = () => cb(window.POS_PRINT || null);
    sc.onerror = () => cb(null);
    document.head.appendChild(sc);
  }
  P.trackPrinting = function (t0) {
    if (!(POS.launcherPresent && POS.launcherPresent()) || (POS.launcherStale && POS.launcherStale())) return P.donePrinting(true);
    const ov = document.getElementById('print-ov');
    if (!ov) return;
    const txt = ov.querySelector('.p-text');
    const started = Date.now();
    let waitingSince = 0;
    const step = () => {
      loadPrintStatus((st) => {
        if (!document.getElementById('print-ov')) return;
        const mine = !!(st && st.since && Math.abs(+st.since - t0) < 20000);
        if (mine && st.state === 'error') return P.donePrinting(false, 'Printer problem: ' + (st.detail || 'check the printer') + '. Reprint when fixed.');
        if (mine && st.state === 'done') return P.donePrinting(true);
        if (mine && st.state === 'printing') { waitingSince = 0; if (txt) txt.textContent = 'Printing on ' + (st.printer || 'the printer') + '...'; }
        else if (mine && st.state === 'waiting') {
          // the job is not in the queue: still spooling, or already finished and gone
          if (!waitingSince) waitingSince = Date.now();
          if (Date.now() - waitingSince > 7000) return P.donePrinting(true);
        }
        if (Date.now() - started > 30000) return P.donePrinting('sent');
        trackTimer = setTimeout(step, 600);
      });
    };
    trackTimer = setTimeout(step, 400);
  };

  // Sends HTML to the default printer through a hidden frame, showing the "Printing..." overlay.
  // With Start POS.bat (--kiosk-printing) it prints silently; otherwise the print dialog appears.
  // what = 'receipt', 'kitchen slip', ... (shown on the overlay)
  P.send = function (inner, what) {
    const old = document.getElementById('print-frame');
    if (old) old.remove();
    P.showPrinting(what);
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
      const t0 = Date.now();
      try {
        // tell the launcher a print is coming so it can follow the job in the Windows print queue
        if (POS.signalLauncher && POS.launcherPresent && POS.launcherPresent()) POS.signalLauncher('print:' + t0, 6000);
        f.contentWindow.focus();
        f.contentWindow.print();   // returns once Windows has the job (silent in kiosk mode)
        P.trackPrinting(t0);
      } catch (e) {
        U.toast('Printing failed: ' + e.message, 'error');
        P.donePrinting(false, 'Printing failed: ' + e.message);
      }
    };
    const imgs = Array.prototype.slice.call(d.images);
    let pending = imgs.filter((i) => !i.complete).length;
    if (!pending) setTimeout(go, 250);
    else imgs.forEach((i) => {
      if (!i.complete) i.onload = i.onerror = () => { if (--pending === 0) setTimeout(go, 150); };
    });
  };

  P.receipt = (o, opts) => P.send(P.receiptHTML(o, opts), 'receipt');
  P.kitchen = (o, items) => P.send(P.kitchenHTML(o, items), 'kitchen slip');
  P.receiptAndKitchen = (o, items) => P.send(P.receiptHTML(o) +
    '<div class="feed"></div><div class="cut">- - - - - tear here - - - - -</div>' + P.kitchenHTML(o, items), 'receipt and kitchen slip');

  P.test = function () {
    const s = POS.state.settings;
    P.send(P.header(s) + '<div class="c b">PRINTER TEST</div><div class="c">' + U.fmtDT(Date.now()) + '</div><hr>' +
      row('Item name', '123.45') + row('Another longer item name that wraps', '1,000.00') +
      '<hr>' + row('TOTAL', U.money(1123.45), 'b big') +
      '<hr><div class="c">If this prints clearly, printing is set up correctly.</div>', 'test receipt');
  };

  // On-screen preview that looks like the printout
  P.preview = function (inner) {
    const fs = +POS.state.settings.fontSize || 12;
    const w = P.width(POS.state.settings);
    return '<div class="receipt-preview" style="width:' + (w + 6) + 'mm;font-size:' + fs + 'px">' +
      '<style>.receipt-preview ' + P.innerCss(fs).replace(/}(?=.)/g, '}.receipt-preview ') + '</style>' + inner + '</div>';
  };
})(window.POS);
