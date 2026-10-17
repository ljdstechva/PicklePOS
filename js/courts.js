/* PicklePOS - court timers, bookings and the Open Tabs screen */
(function (POS) {
  'use strict';
  const U = POS.util, C = POS.calc, S = POS.state;

  // The order object to change: the cart itself if that tab is loaded, otherwise a copy of the saved tab.
  function liveOrder(id) {
    if (POS.cart && POS.cart.id === id) return POS.cart;
    const o = S.open.find((x) => x.id === id);
    return o ? U.copy(o) : null;
  }
  async function commit(o) {
    await POS.saveOrder(o);
    if (o === POS.cart) POS.cartDirty = false;
    refreshView();
  }
  function refreshView() {
    const v = POS.views[S.view];
    if (v && v.refresh) v.refresh();
  }

  // Is the court already taken between start and end? (end = Infinity for a running timer)
  POS.courtConflict = function (courtId, start, end, ignoreLineId) {
    for (const o of S.open) {
      for (const l of o.lines) {
        if (l.kind !== 'court' || l.courtId !== courtId || l.id === ignoreLineId) continue;
        const ls = l.start, le = l.mode === 'fixed' ? l.end : (l.end || Infinity);
        if (l.mode !== 'fixed' && l.end) continue; // finished timers don't block
        if (start < le && end > ls) return o;
      }
    }
    return null;
  };

  /* ---------- start a timer / book hours ---------- */
  POS.startCourt = function (opts) {
    opts = opts || {};
    const courts = S.settings.courts;
    if (!courts.length) return U.toast('No courts set up. Add them in Settings.', 'error');
    let mode = opts.mode || 'timer';
    let courtId = opts.courtId || (courts.find((c) => !POS.courtSession(c.id)) || courts[0]).id;
    const cart = opts.cart ? POS.cart : null;
    const needName = cart && (!cart.name || cart.name === 'Walk-in');
    const body = U.h('<div><div class="f-label">Court</div><div class="seg wrap" id="sc-court"></div>' +
      '<div class="f-label">Billing</div><div class="seg" id="sc-mode"><button type="button" data-m="timer">Start timer (pay for time used)</button>' +
      '<button type="button" data-m="fixed">Book fixed hours</button></div>' +
      '<div class="row2"><label class="f">Start time<input id="sc-start" type="time"></label>' +
      '<label class="f" id="sc-hrs-wrap">Hours<input id="sc-hrs" type="number" min="0.5" step="0.5" value="1"></label></div>' +
      (cart ? (needName ? '<label class="f">Customer / tab name<input id="sc-name" type="text" placeholder="e.g. Juan, Saturday group" autofocus></label>' : '') :
        '<label class="f">Charge to<select id="sc-tab"><option value="">+ New tab</option>' +
        S.open.map((o) => '<option value="' + o.id + '">#' + o.no + ' ' + U.esc(o.name) + '</option>').join('') + '</select></label>' +
        '<label class="f" id="sc-name-wrap">Customer / tab name<input id="sc-name" type="text" placeholder="e.g. Juan, Saturday group" autofocus></label>') +
      '<div class="muted small" id="sc-info"></div></div>');
    const f = (id) => U.$('#' + id, body);
    f('sc-start').value = U.timeInput(Date.now());

    function draw() {
      const info = [];
      f('sc-court').innerHTML = courts.map((c) => {
        const ses = POS.courtSession(c.id);
        return '<button type="button" data-c="' + c.id + '" class="' + (c.id === courtId ? 'on' : '') + '">' + U.esc(c.name) +
          '<small>' + (ses ? 'In use: ' + U.esc(ses.order.name) : 'Available') + ' &middot; ' + U.money(c.rate) + '/hr</small></button>';
      }).join('');
      U.$$('#sc-court button', body).forEach((b) => { b.onclick = () => { courtId = b.getAttribute('data-c'); draw(); }; });
      U.$$('#sc-mode button', body).forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-m') === mode);
        b.onclick = () => { mode = b.getAttribute('data-m'); draw(); };
      });
      f('sc-hrs-wrap').classList.toggle('hidden', mode !== 'fixed');
      const court = courts.find((c) => c.id === courtId);
      if (mode === 'timer') {
        const s = S.settings;
        info.push('Charged ' + U.money(court.rate) + '/hr. Minimum ' + U.fmtDur(s.courtMin) + ', then every ' + s.courtInc +
          ' min (' + s.courtGrace + ' min grace).');
      } else info.push('Total: ' + U.money((+f('sc-hrs').value || 0) * court.rate));
      f('sc-info').textContent = info.join(' ');
      const tabSel = f('sc-tab');
      if (tabSel) f('sc-name-wrap').classList.toggle('hidden', !!tabSel.value);
    }
    f('sc-hrs').oninput = draw;
    if (f('sc-tab')) f('sc-tab').onchange = draw;
    draw();

    U.modal({
      title: 'Court Time', body: body, enterButton: 'sc-ok',
      buttons: [{ label: 'Cancel' }, {
        id: 'sc-ok', label: 'Start', cls: 'primary', onClick: async () => {
          const court = courts.find((c) => c.id === courtId);
          let start = U.fromTimeInput(f('sc-start').value, Date.now());
          // A time typed far ahead of "now" with the timer most likely meant yesterday is not supported; keep same-day.
          const hrs = +f('sc-hrs').value;
          if (mode === 'fixed' && !(hrs > 0)) { U.toast('Enter the number of hours', 'error'); return false; }
          if (mode === 'timer' && start > Date.now() + 60000) { U.toast('A timer cannot start in the future. Use "Book fixed hours" for reservations.', 'error'); return false; }
          const end = mode === 'fixed' ? start + Math.round(hrs * 60) * 60000 : Infinity;
          const clash = POS.courtConflict(courtId, start, end);
          if (clash) { U.toast(court.name + ' is already in use by ' + clash.name + ' at that time', 'error'); return false; }
          const name = f('sc-name') ? f('sc-name').value.trim() : '';
          let o;
          if (cart) {
            o = POS.cart;
            if (needName) { if (!name) { U.toast('Enter a name for the tab', 'error'); return false; } o.name = name; }
          } else if (f('sc-tab').value) o = liveOrder(f('sc-tab').value);
          else {
            if (!name) { U.toast('Enter a name for the tab', 'error'); return false; }
            o = POS.newCart();
            o.name = name;
          }
          const line = { id: U.uid(), kind: 'court', courtId: court.id, name: court.name, rate: +court.rate, mode: mode, start: start, end: null };
          if (mode === 'fixed') { line.minutes = Math.round(hrs * 60); line.end = end; }
          o.lines.push(line);
          o.status = 'open';
          await commit(o);
          U.toast(court.name + (mode === 'timer' ? ' timer started for ' : ' booked for ') + o.name, 'ok');
          if (opts.onDone) opts.onDone(o);
        }
      }]
    });
  };

  POS.stopCourt = async function (orderId, lineId) {
    const o = liveOrder(orderId);
    const l = o && o.lines.find((x) => x.id === lineId);
    if (!l || l.end) return;
    C.freezeCourt(l, Date.now());
    await commit(o);
    U.modal({
      title: l.name + ' stopped', cls: 'small', enterButton: 'st-pay',
      body: '<p>' + U.esc(o.name) + ' played <b>' + U.fmtDur(l.elapsed) + '</b>, billed <b>' + U.fmtDur(l.billed) +
        '</b> = <b>' + U.money(l.amount) + '</b>.</p><p class="muted">Added to tab #' + o.no + '.</p>',
      buttons: [{ label: 'Pay Later' }, {
        id: 'st-pay', label: 'Take Payment Now', cls: 'primary', onClick: () => {
          POS.openTab(o.id).then((ok) => { if (ok) POS.payModal(); });
        }
      }]
    });
  };

  // Options for a court line: stop, change times, remove
  POS.courtLineModal = function (orderId, lineId) {
    const o = liveOrder(orderId);
    const l = o && o.lines.find((x) => x.id === lineId);
    if (!l) return;
    const r = C.court(l);
    const fixed = l.mode === 'fixed';
    const body = U.h('<div><p><b>' + U.esc(o.name) + '</b> &middot; ' + (fixed ? 'Booked ' + U.fmtDur(l.minutes) :
      r.running ? 'Timer running &middot; ' + U.fmtDur(r.elapsed) + ' so far' : 'Played ' + U.fmtDur(r.elapsed)) +
      ' &middot; ' + U.money(r.amount) + '</p>' +
      '<div class="row2"><label class="f">Start time<input id="cl-start" type="time"></label>' +
      (fixed ? '<label class="f">Hours<input id="cl-hrs" type="number" min="0.5" step="0.5"></label>' :
        '<label class="f">End time' + (r.running ? ' (still running)' : '') + '<input id="cl-end" type="time"' + (r.running ? ' disabled' : '') + '></label>') +
      '</div><label class="f">Rate per hour<input id="cl-rate" type="number" min="0" step="1"></label>' +
      (POS.can('courtEdit') ? '' : '<p class="muted small">Changing times, rate or removing court time needs owner approval.</p>') + '</div>');
    const f = (id) => U.$('#' + id, body);
    f('cl-start').value = U.timeInput(l.start);
    f('cl-rate').value = l.rate;
    if (fixed) f('cl-hrs').value = l.minutes / 60;
    else if (l.end) f('cl-end').value = U.timeInput(l.end);
    const buttons = [{
      label: 'Remove', cls: 'danger', onClick: async () => {
        if (!(await POS.requireOwner('remove court time', 'courtEdit'))) return false;
        o.lines = o.lines.filter((x) => x.id !== l.id);
        if (o === POS.cart && o.status !== 'open') { POS.cartDirty = true; refreshView(); } else await commit(o);
      }
    }, {
      label: 'Save Changes', onClick: async () => {
        if (!(await POS.requireOwner('change court time', 'courtEdit'))) return false;
        const start = U.fromTimeInput(f('cl-start').value, l.start);
        const rate = +f('cl-rate').value;
        if (!(rate >= 0)) { U.toast('Enter a valid rate', 'error'); return false; }
        let end;
        if (fixed) {
          const hrs = +f('cl-hrs').value;
          if (!(hrs > 0)) { U.toast('Enter the hours', 'error'); return false; }
          end = start + Math.round(hrs * 60) * 60000;
        } else if (l.end) {
          end = U.fromTimeInput(f('cl-end').value, start);
          if (end <= start) end += 24 * 3600e3;
        } else end = Infinity;
        if (POS.courtConflict(l.courtId, start, end, l.id)) { U.toast('That time overlaps another booking', 'error'); return false; }
        l.start = start;
        l.rate = rate;
        if (fixed) { l.minutes = Math.round((end - start) / 60000); l.end = end; } else if (l.end) { l.end = end; C.freezeCourt(l, end); }
        await commit(o);
      }
    }];
    if (r.running) buttons.push({ label: 'Stop Timer', cls: 'primary', onClick: () => { POS.stopCourt(o.id, l.id); } });
    else buttons.push({ label: 'Close', cls: 'primary' });
    U.modal({ title: l.name, body: body, buttons: buttons });
  };

  POS.extendCourt = async function (orderId, lineId, minutes) {
    const o = liveOrder(orderId);
    const l = o && o.lines.find((x) => x.id === lineId);
    if (!l || l.mode !== 'fixed') return;
    if (POS.courtConflict(l.courtId, l.end, l.end + minutes * 60000, l.id)) return U.toast('Next time slot is already booked', 'error');
    l.minutes += minutes;
    l.end += minutes * 60000;
    await commit(o);
    U.toast(l.name + ' extended by ' + minutes + ' min', 'ok');
  };

  POS.openTab = async function (id) {
    if (POS.cart && POS.cart.id !== id && POS.cartDirty && POS.cart.lines.length) {
      if (!(await U.confirm('The current order has unsaved changes. Discard them and open this tab?', 'Discard & Open', true))) return false;
    }
    const o = S.open.find((x) => x.id === id);
    if (!o) return false;
    if (!(POS.cart && POS.cart.id === id)) { POS.cart = U.copy(o); POS.cartDirty = false; }
    POS.go('sell');
    return true;
  };

  /* ---------- Courts screen ---------- */
  let el = null, sig = '';
  function signature() {
    return S.settings.courts.map((c) => {
      const s = POS.courtSession(c.id);
      return s ? s.line.id : '-';
    }).join('|') + '#' + S.open.length;
  }

  // Progress bar + helper text: when the next billing block starts (timer) or when the booking ends (fixed)
  function progress(l, now) {
    if (l.mode === 'fixed') {
      const p = (now - l.start) / Math.max(1, l.end - l.start);
      return { p: p, warn: l.end - now < 10 * 60000, text: 'Ends at ' + U.fmtTime(l.end) + ' · ' + U.fmtDur(Math.max(0, l.end - now) / 60000) + ' left' };
    }
    const s = S.settings, r = C.court(l, now);
    const min = +s.courtMin || 0, inc = Math.max(1, +s.courtInc || 1), grace = +s.courtGrace || 0;
    const nextAt = r.billed + grace;
    const prev = r.billed <= min ? 0 : r.billed - inc + grace;
    const left = Math.max(0, Math.ceil(nextAt - r.elapsed));
    const text = r.elapsed < min ? 'Minimum ' + U.fmtDur(min) + ' · next charge in ' + U.fmtDur(left) :
      'Next +' + U.money(inc / 60 * l.rate) + ' in ' + U.fmtDur(left);
    return { p: (r.elapsed - prev) / Math.max(1, nextAt - prev), warn: left <= 5, text: text };
  }
  const bar = (pr) => '<div class="cc-prog' + (pr.warn ? ' warn' : '') + '"><i style="transform:scaleX(' + Math.min(1, Math.max(0, pr.p)).toFixed(3) + ')"></i></div>' +
    '<div class="cc-next">' + pr.text + '</div>';

  POS.views.courts = {
    render: function (root) {
      el = U.h('<div class="page"><div class="page-head"><h2>Courts</h2><span class="muted" id="ct-rule"></span></div>' +
        '<div class="courts" id="ct-list"></div><h3 class="sec-h">Active &amp; upcoming bookings</h3><div id="ct-up"></div></div>');
      root.appendChild(el);
      el.onclick = onClick;
      draw();
    },
    refresh: function () { if (el) draw(); },
    tick: function () {
      if (!el) return;
      if (signature() !== sig) return draw();
      const now = Date.now();
      U.$$('[data-timer]', el).forEach((t) => {
        const ses = POS.courtSession(t.getAttribute('data-court'), now);
        if (!ses) return;
        const l = ses.line, r = C.court(l, now);
        t.textContent = l.mode === 'fixed' ? U.fmtClock(l.end - now) : U.fmtClock(now - l.start);
        const card = t.closest('.court-card');
        U.$('[data-billed]', card).textContent = U.fmtDur(r.billed);
        const amt = U.$('[data-amt]', card), txt = U.money(r.amount);
        if (amt.textContent !== txt) { amt.textContent = txt; amt.classList.remove('bump'); void amt.offsetWidth; amt.classList.add('bump'); }
        const pr = progress(l, now);
        U.$('.cc-prog i', card).style.transform = 'scaleX(' + Math.min(1, Math.max(0, pr.p)).toFixed(3) + ')';
        U.$('.cc-prog', card).classList.toggle('warn', pr.warn);
        U.$('.cc-next', card).textContent = pr.text;
        card.classList.toggle('ending', l.mode === 'fixed' && l.end - now < 10 * 60000);
      });
    },
    destroy: function () { el = null; }
  };

  function draw() {
    sig = signature();
    const s = S.settings, now = Date.now();
    U.$('#ct-rule', el).textContent = 'Billing: minimum ' + U.fmtDur(s.courtMin) + ', then every ' + s.courtInc + ' min (' + s.courtGrace + ' min grace)';
    U.$('#ct-list', el).innerHTML = s.courts.map((c) => {
      const ses = POS.courtSession(c.id, now);
      if (!ses) {
        return '<div class="card court-card free enter"><div class="cc-head"><h3>' + U.esc(c.name) + '</h3><span class="pill ok"><i class="dot"></i>Available</span></div>' +
          '<div class="cc-rate">' + U.money(c.rate) + ' / hour</div><div class="court-art"><span></span></div>' +
          '<div class="cc-actions"><button class="btn primary lg" data-a="start" data-c="' + c.id + '">Start Timer</button>' +
          '<button class="btn lg" data-a="book" data-c="' + c.id + '">Book Hours</button></div></div>';
      }
      const l = ses.line, o = ses.order, r = C.court(l, now), fixed = l.mode === 'fixed';
      return '<div class="card court-card busy enter" data-o="' + o.id + '" data-l="' + l.id + '"><div class="cc-head"><h3>' + U.esc(c.name) +
        '</h3><span class="pill busy"><i class="dot live-dot"></i>' + (fixed ? 'Booked' : 'In use') + '</span></div>' +
        '<div class="cc-who">' + U.esc(o.name) + ' <span class="muted">&middot; Tab #' + o.no + '</span></div>' +
        '<div class="muted small">' + (fixed ? 'Time left' : 'Playing time') + '</div>' +
        '<div class="court-timer" data-timer data-court="' + c.id + '">' + (fixed ? U.fmtClock(l.end - now) : U.fmtClock(now - l.start)) + '</div>' +
        '<div class="cc-meta">' + (fixed ? U.fmtTime(l.start) + ' - ' + U.fmtTime(l.end) : 'Started ' + U.fmtTime(l.start)) +
        ' &middot; Billed <span data-billed>' + U.fmtDur(r.billed) + '</span> &middot; <b data-amt>' + U.money(r.amount) + '</b></div>' +
        bar(progress(l, now)) +
        '<div class="cc-actions">' + (fixed ? '<button class="btn lg" data-a="ext30">+30 min</button><button class="btn lg" data-a="ext60">+1 hour</button>' :
          '<button class="btn danger lg" data-a="stop">Stop Timer</button>') +
        '<button class="btn lg" data-a="open">Open Tab</button><button class="btn lg" data-a="opts" title="Change times">&#8942;</button></div></div>';
    }).join('') || '<div class="empty">No courts set up yet. Add them in Settings.</div>';

    const up = [];
    S.open.forEach((o) => o.lines.forEach((l) => {
      if (l.kind !== 'court') return;
      const active = l.mode === 'fixed' ? l.end > now : !l.end;
      if (active) up.push({ o: o, l: l });
    }));
    up.sort((a, b) => a.l.start - b.l.start);
    U.$('#ct-up', el).innerHTML = up.length ? '<table class="tbl"><thead><tr><th>Court</th><th>Customer</th><th>Time</th><th>Type</th><th class="right">Amount</th></tr></thead><tbody>' +
      up.map((x) => {
        const r = C.court(x.l, now);
        return '<tr class="click" data-open="' + x.o.id + '"><td>' + U.esc(x.l.name) + '</td><td>' + U.esc(x.o.name) + ' <span class="muted">#' + x.o.no + '</span></td><td>' +
          U.fmtTime(x.l.start) + (x.l.mode === 'fixed' ? ' - ' + U.fmtTime(x.l.end) : ' - now') + '</td><td>' +
          (x.l.mode === 'fixed' ? (x.l.start > now ? '<span class="tag">Upcoming</span>' : '<span class="tag open">Booked</span>') : '<span class="tag open">Timer</span>') +
          '</td><td class="right">' + U.money(r.amount) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">No active or upcoming court bookings.</p>';
    POS.updateBadges();
  }

  function onClick(e) {
    const row = e.target.closest('[data-open]');
    if (row) return POS.openTab(row.getAttribute('data-open'));
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.getAttribute('data-a');
    const card = b.closest('.court-card');
    const oid = card && card.getAttribute('data-o'), lid = card && card.getAttribute('data-l');
    if (a === 'start') POS.startCourt({ courtId: b.getAttribute('data-c'), mode: 'timer' });
    else if (a === 'book') POS.startCourt({ courtId: b.getAttribute('data-c'), mode: 'fixed' });
    else if (a === 'stop') POS.stopCourt(oid, lid);
    else if (a === 'open') POS.openTab(oid);
    else if (a === 'opts') POS.courtLineModal(oid, lid);
    else if (a === 'ext30') POS.extendCourt(oid, lid, 30);
    else if (a === 'ext60') POS.extendCourt(oid, lid, 60);
  }

  /* ---------- Open Tabs screen ---------- */
  let tabsEl = null;
  POS.views.tabs = {
    render: function (root) {
      tabsEl = U.h('<div class="page"><div class="page-head"><h2>Open Tabs</h2>' +
        '<button class="btn primary" id="tb-new">+ New Tab</button></div><div id="tb-list"></div></div>');
      root.appendChild(tabsEl);
      U.$('#tb-new', tabsEl).onclick = async () => {
        if (POS.cartDirty && POS.cart && POS.cart.lines.length &&
          !(await U.confirm('Discard the unsaved changes to the current order?', 'Discard', true))) return;
        const name = await U.ask('New tab', 'Customer name or table', '', { required: true, placeholder: 'e.g. Juan, Table 3', okLabel: 'Create Tab' });
        if (!name) return;
        POS.cart = POS.newCart();
        POS.cart.name = name;
        POS.cartDirty = true;
        POS.go('sell');
      };
      const list = U.$('#tb-list', tabsEl);
      list.onclick = (e) => {
        const c = e.target.closest('[data-id]');
        if (c) POS.openTab(c.getAttribute('data-id'));
      };
      list.classList.add('anim');
      setTimeout(() => list.classList.remove('anim'), 900);
      draw2();
    },
    refresh: function () { if (tabsEl) draw2(); },
    tick: function () {
      if (tabsEl && Date.now() % 15000 < 1000) draw2();
    },
    destroy: function () { tabsEl = null; }
  };

  const kitchenChip = (st) => (st ? '<span class="k-chip ' + st + '">' +
    { new: 'Kitchen: new', preparing: 'Kitchen: preparing', ready: 'Food ready!' }[st] + '</span>' : '');

  function draw2() {
    const now = Date.now();
    const list = S.open.slice().sort((a, b) => a.createdAt - b.createdAt);
    U.$('#tb-list', tabsEl).innerHTML = list.length ? '<div class="tabs-grid">' + list.map((o, n) => {
      const t = C.totals(o, now);
      const live = o.lines.filter((l) => l.kind === 'court' && (l.mode === 'fixed' ? now >= l.start && now < l.end : !l.end));
      const items = o.lines.filter((l) => l.kind === 'item').reduce((a, l) => a + l.qty, 0);
      const mins = Math.round((now - o.createdAt) / 60000);
      return '<div class="card tab-card' + (live.length ? ' playing' : '') + '" style="--i:' + n + '" data-id="' + o.id + '"><div class="tc-top"><b>#' + o.no + '</b><span class="muted small">' +
        U.fmtTime(o.createdAt) + ' &middot; ' + (mins < 60 ? mins + 'm ago' : U.fmtDur(mins) + ' ago') + '</span></div><div class="tc-name">' + U.esc(o.name) + '</div>' +
        '<div class="muted small">' + items + ' item(s)' + (live.length ? ' &middot; <span class="live">' + U.esc(live[0].name) + '</span>' : '') +
        ' &middot; ' + U.esc(o.cashier || '') + '</div><div class="tc-bottom"><div class="tc-total">' + U.money(t.total) + '</div>' +
        kitchenChip(POS.kitchenStatus(o.id)) + '</div></div>';
    }).join('') + '</div>' : '<div class="empty big-empty"><span class="logo-ball float"></span><b>No open tabs</b>' +
      '<span>Use <b>Save Tab</b> on the Sell screen, or start a court timer.</span></div>';
  }
})(window.POS);
