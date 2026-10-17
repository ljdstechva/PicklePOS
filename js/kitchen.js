/* PicklePOS - Kitchen screen: orders to prepare, shown on screen instead of printed */
(function (POS) {
  'use strict';
  const U = POS.util, S = POS.state;
  // Tickets that still belong on the board (served / dismissed ones are history)
  const ACTIVE = ['new', 'preparing', 'ready', 'cancelled'];
  S.tickets = [];

  // Settings > Printer > "Kitchen orders": screen | print | both | off
  const mode = () => S.settings.kitchenMode || 'screen';
  POS.kitchenOn = () => mode() !== 'off';
  POS.kitchenScreen = () => mode() === 'screen' || mode() === 'both';
  POS.kitchenPrint = () => mode() === 'print' || mode() === 'both';

  POS.loadTickets = async function () {
    let all = [];
    for (const st of ACTIVE) all = all.concat(await POS.db.byIndex('tickets', 'status', IDBKeyRange.only(st)));
    S.tickets = all.sort((a, b) => a.createdAt - b.createdAt);
  };

  POS.kitchenCount = () => S.tickets.filter((t) => t.status === 'new' || t.status === 'preparing').length;

  async function saveTicket(t) {
    if (ACTIVE.indexOf(t.status) < 0) S.tickets = S.tickets.filter((x) => x !== t);
    await POS.db.put('tickets', t);
    POS.updateBadges();
  }
  function changed() {
    POS.updateBadges();
    if (S.view === 'kitchen' && el) draw();
  }

  // Marks the order's not-yet-sent kitchen items as sent and, when the kitchen screen is on,
  // puts them on the board as a new ticket. Returns the items (also used for printed slips).
  POS.sendToKitchen = async function (o, opts) {
    opts = opts || {};
    const hadSent = o.lines.some((l) => l.kind === 'item' && l.kitchen && (l.sent || 0) > 0);
    const items = [];
    o.lines.forEach((l) => {
      if (l.kind !== 'item' || !l.kitchen) return;
      const n = l.qty - (l.sent || 0);
      if (n > 0) items.push({ lineId: l.id, name: l.name, qty: n, note: l.note || '', done: false, cancelled: 0 });
      l.sent = l.qty;
    });
    if (!items.length || !POS.kitchenScreen()) return items;
    const t = {
      id: U.uid(), orderId: o.id, orderNo: o.no, name: o.name, items: items, status: 'new',
      createdAt: Date.now(), by: S.user.name, paid: !!opts.paid, addOn: hadSent
    };
    S.tickets.push(t);
    await POS.db.put('tickets', t);
    POS.sound('ding');
    changed();
    return items;
  };

  // After an order is saved: items taken off the order (or a voided order) are shown as cancelled
  POS.kitchenAfterSave = async function (prev, o) {
    const active = S.tickets.filter((t) => t.orderId === o.id && t.status !== 'ready' && t.status !== 'cancelled');
    const all = S.tickets.filter((t) => t.orderId === o.id);
    if (!all.length) return;
    const touched = [];
    if (o.status === 'void') {
      all.forEach((t) => {
        if (t.status === 'cancelled') return;
        t.status = 'cancelled';
        t.cancelReason = 'Order voided';
        touched.push(t);
      });
    } else {
      // name changes follow the order
      all.forEach((t) => { if (t.name !== o.name || t.orderNo !== o.no) { t.name = o.name; t.orderNo = o.no; touched.push(t); } });
      const prevSent = {}, nowQty = {};
      (prev ? prev.lines : []).forEach((l) => { if (l.kind === 'item' && l.kitchen) prevSent[l.id] = l.sent || 0; });
      o.lines.forEach((l) => { if (l.kind === 'item') nowQty[l.id] = l.qty; });
      const newestFirst = active.slice().sort((a, b) => b.createdAt - a.createdAt);
      Object.keys(prevSent).forEach((lid) => {
        let drop = prevSent[lid] - (nowQty[lid] || 0);
        newestFirst.forEach((t) => t.items.forEach((it) => {
          if (drop <= 0 || it.lineId !== lid) return;
          const can = Math.min(drop, it.qty - (it.cancelled || 0));
          if (can > 0) {
            it.cancelled = (it.cancelled || 0) + can;
            drop -= can;
            if (touched.indexOf(t) < 0) touched.push(t);
          }
        }));
      });
      touched.forEach((t) => {
        if (t.items.every((it) => it.qty - (it.cancelled || 0) <= 0)) { t.status = 'cancelled'; t.cancelReason = 'Items removed from the order'; }
      });
    }
    if (!touched.length) return;
    for (const t of touched) await POS.db.put('tickets', t);
    if (touched.some((t) => t.status === 'cancelled' || t.items.some((i) => i.cancelled))) {
      U.toast('Kitchen screen updated: item(s) cancelled for #' + o.no, 'warn');
    }
    changed();
  };

  // Short status text for other screens (Open Tabs)
  POS.kitchenStatus = function (orderId) {
    const t = S.tickets.filter((x) => x.orderId === orderId && x.status !== 'cancelled');
    if (!t.length) return '';
    if (t.some((x) => x.status === 'ready')) return 'ready';
    if (t.some((x) => x.status === 'preparing')) return 'preparing';
    return 'new';
  };

  /* ---------- the screen ---------- */
  let el = null;
  POS.views.kitchen = {
    render: function (root) {
      el = U.h('<div class="page kitchen"><div class="page-head"><h2>Kitchen</h2><div class="k-counts" id="k-counts"></div>' +
        '<button class="btn" id="k-served">Recently Served</button></div><div id="k-off"></div>' +
        '<div class="k-board"><section class="k-col"><h3 class="k-h">To prepare <span class="muted small">tap an item when it\'s done</span></h3>' +
        '<div class="k-cards" id="k-todo"></div></section>' +
        '<section class="k-col k-ready-col"><h3 class="k-h">Ready to serve</h3><div class="k-cards" id="k-ready"></div></section></div></div>');
      root.appendChild(el);
      el.onclick = onClick;
      U.$('#k-served', el).onclick = recentlyServed;
      draw();
    },
    refresh: function () { if (el) draw(); },
    tick: function () { if (el) ages(); },
    destroy: function () { el = null; }
  };

  function ageText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 3600) return U.fmtDur(s / 60);
    return Math.floor(s / 60) + ':' + U.pad(s % 60);
  }
  const ageClass = (t, now) => {
    if (t.status === 'ready' || t.status === 'cancelled') return '';
    const m = (now - t.createdAt) / 60000;
    return m >= 20 ? ' late' : m >= 10 ? ' warn' : '';
  };

  function card(t, now) {
    const left = (it) => it.qty - (it.cancelled || 0);
    const allDone = t.items.every((it) => it.done || left(it) <= 0);
    const status = { new: 'NEW', preparing: 'PREPARING', ready: 'READY', cancelled: 'CANCELLED' }[t.status];
    let h = '<div class="k-card ' + t.status + ageClass(t, now) + (now - t.createdAt < 4000 ? ' fresh' : '') + (allDone ? ' all-done' : '') +
      '" data-id="' + t.id + '"><div class="k-top"><span class="k-no">#' + U.esc(t.orderNo) + '</span>' +
      '<span class="k-status">' + status + '</span></div>' +
      '<div class="k-name">' + U.esc(t.name || 'Walk-in') + (t.addOn ? ' <span class="k-tag">ADD-ON</span>' : '') +
      ' <span class="k-tag ' + (t.paid ? 'paid' : '') + '">' + (t.paid ? 'PAID' : 'TAB') + '</span></div>' +
      '<div class="k-time">' + U.fmtTime(t.createdAt) + (t.status === 'ready' ? ' &middot; ready ' + U.fmtTime(t.readyAt) :
        t.status === 'cancelled' ? '' :
        ' &middot; waiting <b class="k-age" data-age="' + t.createdAt + '">' + ageText(now - t.createdAt) + '</b>') + '</div>';
    if (t.status === 'cancelled') h += '<div class="k-cancel">' + U.esc(t.cancelReason || 'Cancelled') + ' &ndash; do not prepare</div>';
    h += '<ul class="k-items">' + t.items.map((it, i) => {
      const n = left(it);
      return '<li class="k-item' + (it.done ? ' k-done' : '') + (n <= 0 ? ' cancelled' : '') + '" data-i="' + i + '">' +
        '<span class="k-q">' + (n <= 0 ? it.qty : n) + '&times;</span><span class="k-n">' + U.esc(it.name) +
        (n <= 0 ? ' <span class="k-cx">CANCELLED</span>' : it.cancelled ? ' <span class="k-cx">' + it.cancelled + ' cancelled</span>' : '') +
        (it.note ? '<span class="k-note">' + U.esc(it.note) + '</span>' : '') + '</span>' +
        '<span class="k-tick">' + (it.done ? '&#10003;' : '') + '</span></li>';
    }).join('') + '</ul><div class="k-actions">';
    if (t.status === 'new') h += '<button class="btn primary lg" data-a="start">Start Preparing</button>';
    else if (t.status === 'preparing') h += '<button class="btn primary lg k-ready-btn" data-a="ready">&#10003; Ready</button>';
    else if (t.status === 'ready') h += '<button class="btn lg" data-a="back" title="Back to preparing">&larr;</button><button class="btn primary lg" data-a="served">Served</button>';
    else h += '<button class="btn danger lg" data-a="dismiss">OK, Remove</button>';
    return h + '</div></div>';
  }

  function draw() {
    const now = Date.now();
    const todo = S.tickets.filter((t) => t.status !== 'ready');
    const ready = S.tickets.filter((t) => t.status === 'ready').sort((a, b) => a.readyAt - b.readyAt);
    const n = (st) => S.tickets.filter((t) => t.status === st).length;
    U.$('#k-counts', el).innerHTML = '<span class="k-count new"><b>' + n('new') + '</b>new</span>' +
      '<span class="k-count preparing"><b>' + n('preparing') + '</b>preparing</span>' +
      '<span class="k-count ready"><b>' + ready.length + '</b>ready</span>';
    U.$('#k-off', el).innerHTML = POS.kitchenScreen() ? '' : '<div class="notice">The kitchen screen is turned off, so new orders will not appear here. ' +
      (POS.can('settings') ? 'Turn it on in Settings &rarr; Printer &rarr; Kitchen orders.' : 'Ask the owner to turn it on in Settings.') + '</div>';
    U.$('#k-todo', el).innerHTML = todo.length ? todo.map((t) => card(t, now)).join('') :
      '<div class="empty big-empty k-empty"><span class="logo-ball float"></span><b>All caught up!</b><span>New orders from the Sell screen appear here.</span></div>';
    U.$('#k-ready', el).innerHTML = ready.length ? ready.map((t) => card(t, now)).join('') : '<p class="muted k-none">Nothing waiting to be served.</p>';
  }

  function ages() {
    const now = Date.now();
    U.$$('[data-age]', el).forEach((b) => {
      const created = +b.getAttribute('data-age');
      b.textContent = ageText(now - created);
      const c = b.closest('.k-card');
      const m = (now - created) / 60000;
      c.classList.toggle('warn', m >= 10 && m < 20);
      c.classList.toggle('late', m >= 20);
    });
  }

  async function onClick(e) {
    const c = e.target.closest('.k-card');
    if (!c) return;
    const t = S.tickets.find((x) => x.id === c.getAttribute('data-id'));
    if (!t) return;
    const b = e.target.closest('[data-a]');
    const li = e.target.closest('.k-item');
    if (b) {
      const a = b.getAttribute('data-a');
      if (a === 'start') { t.status = 'preparing'; t.startedAt = Date.now(); }
      if (a === 'ready') {
        t.status = 'ready';
        t.readyAt = Date.now();
        t.items.forEach((it) => { it.done = true; });
        POS.sound('ok');
        U.toast('#' + t.orderNo + ' ' + (t.name || '') + ' is ready to serve', 'ok');
      }
      if (a === 'back') t.status = 'preparing';
      if (a === 'served' || a === 'dismiss') {
        t.status = a === 'served' ? 'served' : 'dismissed';
        if (a === 'served') t.servedAt = Date.now();
        if (POS.anim()) { c.classList.add('leaving'); await new Promise((r) => setTimeout(r, 180)); }
      }
      await saveTicket(t);
      draw();
      return;
    }
    if (li && (t.status === 'new' || t.status === 'preparing')) {
      const it = t.items[+li.getAttribute('data-i')];
      if (it.qty - (it.cancelled || 0) <= 0) return;
      it.done = !it.done;
      if (t.status === 'new') { t.status = 'preparing'; t.startedAt = Date.now(); }
      await saveTicket(t);
      draw();
    }
  }

  async function recentlyServed() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const list = (await POS.db.byIndex('tickets', 'servedAt', IDBKeyRange.lowerBound(start.getTime())))
      .filter((t) => t.status === 'served').sort((a, b) => b.servedAt - a.servedAt).slice(0, 20);
    const body = U.h('<div>' + (list.length ? '<table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Items</th><th>Ordered</th><th>Served</th><th></th></tr></thead><tbody>' +
      list.map((t) => '<tr><td>' + U.esc(t.orderNo) + '</td><td>' + U.esc(t.name) + '</td><td>' +
        U.esc(t.items.map((i) => (i.qty - (i.cancelled || 0)) + 'x ' + i.name).join(', ')) + '</td><td>' + U.fmtTime(t.createdAt) +
        '</td><td>' + U.fmtTime(t.servedAt) + ' <span class="muted small">(' + U.fmtDur((t.servedAt - t.createdAt) / 60000) + ')</span></td>' +
        '<td class="right"><button class="btn sm" data-recall="' + t.id + '">Recall</button></td></tr>').join('') +
      '</tbody></table>' : '<p class="muted">Nothing served yet today.</p>') + '</div>');
    const m = U.modal({ title: 'Served Today (latest 20)', body: body, cls: 'wide', buttons: [{ label: 'Close', cls: 'primary' }] });
    U.$$('[data-recall]', body).forEach((b) => {
      b.onclick = async () => {
        const t = list.find((x) => x.id === b.getAttribute('data-recall'));
        t.status = 'ready';
        delete t.servedAt;
        S.tickets.push(t);
        await saveTicket(t);
        m.close();
        draw();
        U.toast('#' + t.orderNo + ' is back on the board', 'ok');
      };
    });
  }
})(window.POS);
