/* PicklePOS - app core: start-up, first-time setup, login, navigation, saving orders */
(function (POS) {
  'use strict';
  const U = POS.util;
  const S = POS.state = { settings: null, users: [], categories: [], items: [], open: [], user: null, view: null };
  POS.views = {};
  POS.VIEW_ORDER = ['sell', 'kitchen', 'tabs', 'courts', 'stock', 'history', 'reports', 'menu', 'settings'];

  POS.DEFAULTS = {
    bizName: 'My Pickleball Club', bizLine2: 'Courts & Cafe', address: '', contact: '', tin: '',
    logo: '', appLogo: '',
    receiptTitle: 'ACKNOWLEDGEMENT RECEIPT', receiptNote: 'THIS IS NOT AN OFFICIAL RECEIPT',
    footer: 'Thank you! See you on the court!',
    currency: '₱', vatRegistered: false,
    courts: [{ id: 'court1', name: 'Court 1', rate: 300 }, { id: 'court2', name: 'Court 2', rate: 300 }],
    courtMin: 60, courtInc: 30, courtGrace: 5,
    paper: 58, fontSize: 12, feedLines: 4,
    autoPrint: true, kitchenMode: 'screen',
    payMethods: ['Cash', 'GCash', 'Maya', 'Bank Transfer'],
    refRequired: true,
    lastBackup: 0,
    anim: true, sounds: true, autoLock: 0
  };

  /* ---------- display: animations & sounds ---------- */
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  POS.anim = () => !!(S.settings && S.settings.anim !== false) && !(reduceMotion && reduceMotion.matches);
  POS.applyDisplay = function () {
    document.documentElement.classList.toggle('no-anim', !POS.anim());
  };

  // Short synthesized beeps (no sound files needed). Very quiet by default.
  let audio = null;
  const TONES = {
    add: [[1046, 0.035, 0.04]],
    ok: [[660, 0.09, 0.07], [988, 0.16, 0.07]],
    ding: [[1318, 0.35, 0.08]],
    error: [[196, 0.16, 0.08]],
    alert: [[880, 0.12, 0.09], [0, 0.08, 0], [880, 0.12, 0.09], [0, 0.08, 0], [1175, 0.25, 0.09]]
  };
  POS.sound = function (name) {
    if (!S.settings || !S.settings.sounds || !TONES[name]) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      if (audio.state === 'suspended') audio.resume();
      let t = audio.currentTime + 0.01;
      TONES[name].forEach((n) => {
        if (n[0]) {
          const osc = audio.createOscillator(), g = audio.createGain();
          osc.type = 'sine';
          osc.frequency.value = n[0];
          g.gain.setValueAtTime(n[2], t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + n[1]);
          osc.connect(g);
          g.connect(audio.destination);
          osc.start(t);
          osc.stop(t + n[1] + 0.02);
        }
        t += n[1];
      });
    } catch (e) { /* sound is optional */ }
  };

  // Simple line icons for the navigation bar
  const ICONS = {
    sell: '<path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19.5 7H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    tabs: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    kitchen: '<path d="M3 18h18M5 18v-1a7 7 0 0 1 14 0v1M12 10V7M10 7h4"/>',
    courts: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 5v14M3 12h18"/>',
    history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    menu: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M11 3.5v2.5"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    stock: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
  };
  POS.icon = (name) => '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';

  /* ---------- start-up ---------- */
  POS.boot = async function () {
    try {
      await POS.db.open();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      await POS.loadAll();
    } catch (e) {
      document.getElementById('app').innerHTML = '<div class="fatal"><h2>PicklePOS could not start</h2><p>' +
        U.esc(e.message || e) + '</p><p>Use <b>Start POS.bat</b> to open the app in Chrome or Edge.</p></div>';
      return;
    }
    POS.applyDisplay();
    POS.applyBrand();
    if (reduceMotion && reduceMotion.addListener) reduceMotion.addListener(POS.applyDisplay);
    setInterval(POS.tick, 1000);
    document.addEventListener('click', POS.touch, true);
    document.addEventListener('keydown', POS.touch, true);
    if (!S.users.length) POS.setup(); else POS.showLogin();
  };

  POS.loadAll = async function () {
    const kv = await POS.db.get('kv', 'settings');
    S.settings = Object.assign({}, POS.DEFAULTS, kv ? kv.v : {});
    S.users = await POS.db.all('users');
    S.categories = (await POS.db.all('categories')).sort((a, b) => a.sort - b.sort);
    S.items = await POS.db.all('items');
    await migrateStock();
    S.open = await POS.db.byIndex('orders', 'status', 'open');
    if (POS.loadTickets) await POS.loadTickets();
  };

  // Stock used to be counted; now an item is simply in stock or out of stock
  async function migrateStock() {
    for (const it of S.items) {
      if (!('trackStock' in it) && !('stock' in it)) continue;
      it.soldOut = !!it.trackStock && (it.stock || 0) <= 0;
      delete it.trackStock; delete it.stock; delete it.lowStock;
      await POS.db.put('items', it);
    }
  }

  POS.saveSettings = () => POS.db.put('kv', { k: 'settings', v: S.settings });

  /* ---------- business logo = app icon ---------- */
  const DEFAULT_ICON = document.querySelector('link[rel=icon]') ? document.querySelector('link[rel=icon]').href : '';
  POS.logoHTML = () => (S.settings && S.settings.appLogo ? '<img class="biz-logo" src="' + S.settings.appLogo + '" alt="">' : '<span class="logo-ball"></span>');
  POS.applyBrand = function () {
    const s = S.settings || {};
    const link = document.querySelector('link[rel=icon]');
    if (link) link.href = s.appLogo || DEFAULT_ICON;
    document.title = s.bizName ? s.bizName + ' - PicklePOS' : 'PicklePOS';
    // Remembered so the loading screen shows the right logo before the database opens
    try { localStorage.setItem('pp-brand', JSON.stringify({ icon: s.appLogo || '', name: s.bizName || '' })); } catch (e) { /* optional */ }
  };
  // One uploaded logo becomes the app icon (colour) and the receipt logo (black & white)
  POS.setLogo = async function (file) {
    S.settings.appLogo = await U.iconImage(file, 160);
    S.settings.logo = await U.resizeImage(file, 300, false, true);
    await POS.saveSettings();
    POS.applyBrand();
  };
  POS.isOwner = () => !!(S.user && S.user.role === 'owner');
  POS.itemById = (id) => S.items.find((i) => i.id === id);
  POS.catById = (id) => S.categories.find((c) => c.id === id);

  POS.nextNo = async function () {
    const r = await POS.db.get('kv', 'orderNo');
    const n = (r ? r.v : 1000) + 1;
    await POS.db.put('kv', { k: 'orderNo', v: n });
    return n;
  };

  /* ---------- first run ---------- */
  // Step 1: business name, logo (becomes the app icon), owner name and PIN.
  // Step 2: employees with their own PIN and what they may use.
  POS.setup = function () {
    const app = document.getElementById('app');
    let logoFile = null;
    app.innerHTML = '<div class="login"><div class="login-card setup"><div class="steps"><i class="on"></i><i></i></div>' +
      '<div class="setup-logo" id="su-logo-prev"><span class="logo-ball"></span></div><h2>Welcome to PicklePOS</h2>' +
      '<p class="muted">Step 1 of 2 &middot; Your business and the owner account. You can change all of this later in Settings.</p>' +
      '<label class="f">Business name<input id="su-biz" type="text" placeholder="e.g. Rally Point Pickleball"></label>' +
      '<div class="f-label">Business logo (optional) &ndash; used as the app icon and on receipts</div>' +
      '<div class="toolbar" style="margin-top:0"><label class="btn sm">Choose Logo<input type="file" id="su-logo" accept="image/*" class="hidden"></label>' +
      '<button type="button" class="btn sm hidden" id="su-logo-del">Remove</button></div>' +
      '<label class="f">Owner name<input id="su-name" type="text" placeholder="e.g. Mark"></label>' +
      '<div class="row2"><label class="f">Owner PIN (4-6 digits)<input id="su-pin" type="password" inputmode="numeric" maxlength="6"></label>' +
      '<label class="f">Repeat PIN<input id="su-pin2" type="password" inputmode="numeric" maxlength="6"></label></div>' +
      '<label class="chk"><input id="su-sample" type="checkbox" checked> Add a sample cafe menu (edit or delete later)</label>' +
      '<button id="su-go" class="btn primary lg block">Next: Add Employees</button></div></div>';
    U.$('#su-biz').focus();
    const prev = U.$('#su-logo-prev');
    U.$('#su-logo').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        prev.innerHTML = '<img class="biz-logo" src="' + (await U.iconImage(file, 160)) + '" alt="">';
        logoFile = file;
        U.$('#su-logo-del').classList.remove('hidden');
      } catch (err) { U.toast(err.message, 'error'); }
    };
    U.$('#su-logo-del').onclick = () => { logoFile = null; prev.innerHTML = '<span class="logo-ball"></span>'; U.$('#su-logo-del').classList.add('hidden'); };
    U.$('#su-go').onclick = async function () {
      const biz = U.$('#su-biz').value.trim(), name = U.$('#su-name').value.trim();
      const pin = U.$('#su-pin').value.trim(), pin2 = U.$('#su-pin2').value.trim();
      if (!biz) return U.toast('Please enter the business name', 'error');
      if (!name) return U.toast('Please enter the owner name', 'error');
      if (!/^\d{4,6}$/.test(pin)) return U.toast('PIN must be 4 to 6 digits', 'error');
      if (pin !== pin2) return U.toast('The two PINs do not match', 'error');
      this.disabled = true;
      S.settings.bizName = biz;
      if (logoFile) await POS.setLogo(logoFile); else await POS.saveSettings();
      POS.applyBrand();
      const owner = { id: U.uid(), name: name, role: 'owner', pin: U.hash(pin), active: true, perms: [] };
      await POS.saveUser(owner);
      if (U.$('#su-sample').checked) await POS.seedMenu();
      setupStaff(owner);
    };
  };

  function setupStaff(owner) {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="login"><div class="login-card setup wide view-enter"><div class="steps"><i class="on"></i><i class="on"></i></div>' +
      '<h2>Add your employees</h2><p class="muted">Step 2 of 2 &middot; Each employee logs in with their own PIN. ' +
      '<b>Standard</b> access is for taking orders and marking items out of stock. You can add or change employees later in Settings.</p>' +
      '<div id="su-staff"></div><div class="card soft" id="su-form-wrap"><div class="f-label" style="margin-top:0">New employee</div><div id="su-form"></div>' +
      '<button class="btn" id="su-add">+ Add Employee</button></div>' +
      '<button id="su-done" class="btn primary lg block">Finish &amp; Start Selling</button></div></div>';
    let form = null;
    const draw = () => {
      const staff = S.users.filter((u) => u.id !== owner.id);
      U.$('#su-staff').innerHTML = '<div class="staff-list">' + [owner].concat(staff).map((u) => '<div class="staff-row"><span class="avatar" style="background:' +
        U.colorFor(u.name) + '">' + U.esc(U.initials(u.name)) + '</span><span><b>' + U.esc(u.name) + '</b><small>' + POS.roleLabel(u) + ' &middot; ' +
        POS.accessSummary(u) + '</small></span></div>').join('') + '</div>';
      form = POS.userForm(null, { noRole: true, noActive: true });
      U.$('#su-form').innerHTML = '';
      U.$('#su-form').appendChild(form);
    };
    draw();
    U.$('#su-add').onclick = async () => {
      const u = form.read();
      if (!u) return;
      await POS.saveUser(u);
      U.toast(u.name + ' added', 'ok');
      draw();
      form.focusName();
    };
    U.$('#su-done').onclick = async () => {
      await POS.loadAll();
      POS.login(S.users.find((u) => u.id === owner.id));
    };
  }

  POS.seedMenu = async function () {
    const menu = [
      ['Coffee', true, [['Americano', 110], ['Cafe Latte', 140], ['Spanish Latte', 150], ['Caramel Macchiato', 160]]],
      ['Non-Coffee', true, [['Matcha Latte', 150], ['Chocolate', 130], ['House Iced Tea', 90]]],
      ['Food', true, [['Clubhouse Sandwich', 180], ['Chicken Wings (6 pcs)', 220], ['French Fries', 120], ['Pancit Canton', 150]]],
      ['Drinks', false, [['Bottled Water', 30], ['Sports Drink', 70], ['Soft Drink (can)', 60]]],
      ['Court Extras', false, [['Paddle Rental', 100], ['Pickleball (new)', 150], ['Ball Rental', 50]]]
    ];
    for (let i = 0; i < menu.length; i++) {
      const cat = { id: U.uid(), name: menu[i][0], sort: i };
      await POS.db.put('categories', cat);
      for (const it of menu[i][2]) {
        await POS.db.put('items', {
          id: U.uid(), name: it[0], price: it[1], categoryId: cat.id, photo: '', kitchen: menu[i][1],
          soldOut: false, active: true
        });
      }
    }
  };

  /* ---------- login / PIN ---------- */
  POS.pinPad = function (onDone, maxLen) {
    maxLen = maxLen || 6;
    let pin = '';
    const el = U.h('<div class="pin-wrap"><div class="pin-dots"></div><div class="pinpad">' +
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) =>
        '<button type="button" data-k="' + k + '"' + (k === 'OK' ? ' class="ok"' : '') + '>' + k + '</button>').join('') +
      '</div></div>');
    const dots = U.$('.pin-dots', el);
    function draw() {
      let h = '';
      for (let i = 0; i < Math.max(4, pin.length); i++) {
        h += '<i class="' + (i < pin.length ? 'on' : '') + (i === pin.length - 1 ? ' last' : '') + '"></i>';
      }
      dots.innerHTML = h;
    }
    function press(k) {
      if (k === 'C') pin = '';
      else if (k === 'OK' || k === 'Enter') { if (pin.length) { const p = pin; pin = ''; draw(); onDone(p); } return; }
      else if (k === 'Backspace') pin = pin.slice(0, -1);
      else if (/^\d$/.test(k) && pin.length < maxLen) pin += k;
      draw();
    }
    U.$$('button', el).forEach((b) => { b.onclick = () => press(b.getAttribute('data-k')); });
    el.press = press;
    el.shake = function () { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
    draw();
    return el;
  };

  POS.showLogin = function () {
    S.user = null;
    POS.destroyView();
    const app = document.getElementById('app');
    const users = S.users.filter((u) => u.active !== false);
    app.innerHTML = '<div class="login"><div class="login-card">' +
      '<div class="setup-logo">' + POS.logoHTML() + '</div><h2>' + U.esc(S.settings.bizName) + '</h2>' +
      '<div class="login-clock clock"></div>' +
      '<div id="lg-users"><p class="muted">Who is using the POS?</p><div class="user-list">' +
      users.map((u, i) => '<button class="user-btn" style="--i:' + i + '" data-id="' + u.id + '"><span class="avatar" style="background:' +
        U.colorFor(u.name) + '">' + U.esc(U.initials(u.name)) + '</span><span>' + U.esc(u.name) +
        '<small>' + POS.roleLabel(u) + '</small></span></button>').join('') +
      '</div></div><div id="lg-pin" class="hidden"><p><b id="lg-who"></b><br><span class="muted">Enter your PIN</span></p>' +
      '<div id="lg-pad"></div><button class="link" id="lg-back">&larr; Back</button></div></div></div>';
    POS.tick();
    let chosen = null, pad = null;
    U.$$('.user-btn', app).forEach((b) => {
      b.onclick = function () {
        chosen = S.users.find((u) => u.id === b.getAttribute('data-id'));
        U.$('#lg-users').classList.add('hidden');
        U.$('#lg-pin').classList.remove('hidden');
        U.$('#lg-pin').classList.add('view-enter');
        U.$('#lg-who').textContent = chosen.name;
        pad = POS.pinPad((pin) => {
          if (U.hash(pin) === chosen.pin) POS.login(chosen);
          else { pad.shake(); U.toast('Wrong PIN', 'error'); }
        });
        U.$('#lg-pad').innerHTML = '';
        U.$('#lg-pad').appendChild(pad);
      };
    });
    U.$('#lg-back').onclick = () => POS.showLogin();
    POS._loginKeys = function (e) {
      if (pad && !U.$('#lg-pin').classList.contains('hidden')) pad.press(e.key);
    };
  };

  POS.login = function (user) {
    S.user = user;
    POS._loginKeys = null;
    if (POS.cart && !POS.cart.lines.length) POS.cart = null;   // an empty order starts fresh for the new person
    POS.lastTouch = Date.now();
    const first = POS.VIEW_ORDER.find((v) => POS.can(v));
    if (!first) { U.toast(user.name + ' has no screens allowed. Ask the owner to check Settings > Staff.', 'error'); return POS.showLogin(); }
    POS.renderShell();
    POS.go(first);
    // An order left on screen when the POS was locked is kept for whoever logs in next
    if (POS.cart && POS.cart.lines.length && POS.cartDirty) U.toast('Welcome, ' + user.name + '! The unfinished order is still here.', 'ok');
    else U.toast('Welcome, ' + user.name + '!', 'ok');
  };

  // Locking keeps the current order on screen (it is not discarded)
  POS.logout = function () {
    U.$$('#modals > .modal-back').forEach((m) => m.remove());
    POS.showLogin();
  };

  document.addEventListener('keydown', (e) => {
    if (POS._loginKeys && !U.topModal()) POS._loginKeys(e);
  });

  // Asks for an owner PIN when an employee tries a restricted action, unless the owner
  // allowed that action for them (perm). Resolves true/false.
  POS.requireOwner = function (what, perm) {
    if (POS.isOwner() || (perm && POS.can(perm))) return Promise.resolve(true);
    return new Promise((res) => {
      let ok = false, m = null;
      const body = U.h('<div class="c"><p>Owner approval needed to <b></b>.</p></div>');
      U.$('b', body).textContent = what;
      const pad = POS.pinPad((pin) => {
        const h = U.hash(pin);
        const owner = S.users.find((u) => u.role === 'owner' && u.active !== false && u.pin === h);
        if (owner) { ok = true; m.close(); } else { pad.shake(); U.toast('Not an owner PIN', 'error'); }
      });
      body.appendChild(pad);
      const onKey = (e) => { if (/^\d$|^Backspace$|^Enter$/.test(e.key)) pad.press(e.key); };
      document.addEventListener('keydown', onKey);
      m = U.modal({
        title: 'Owner approval', body: body, cls: 'small',
        onClose: () => { document.removeEventListener('keydown', onKey); res(ok); }
      });
    });
  };

  /* ---------- shell & navigation ---------- */
  const VIEW_LABELS = {
    sell: 'Sell', kitchen: 'Kitchen', tabs: 'Tabs', courts: 'Courts', history: 'History',
    stock: 'Stock', reports: 'Reports', menu: 'Menu', settings: 'Settings'
  };

  POS.renderShell = function () {
    const app = document.getElementById('app');
    const views = POS.VIEW_ORDER.filter((v) => POS.can(v));
    app.innerHTML = '<aside class="rail"><div class="rail-logo' + (S.settings.appLogo ? ' has-img' : '') + '" id="rail-biz" title="' + U.esc(S.settings.bizName) + '">' + POS.logoHTML() + '</div>' +
      '<nav class="nav">' + views.map((v) => '<button data-view="' + v + '">' + POS.icon(v) + '<span class="nav-l">' + VIEW_LABELS[v] + '</span>' +
        (v === 'tabs' ? '<span class="badge" id="tabs-badge"></span>' : '') +
        (v === 'kitchen' ? '<span class="badge hot" id="kitchen-badge"></span>' : '') +
        (v === 'courts' ? '<span class="badge" id="courts-badge"></span>' : '') + '</button>').join('') + '</nav>' +
      '<div class="rail-foot"><button class="btn sm warn hidden" id="backup-warn" title="Download a backup copy of your data">Backup due</button>' +
      '<span class="clock"></span><button class="rail-lock" id="lock" title="' + U.esc(S.user.name) + ' - press to lock the POS">' +
      '<span class="avatar" style="background:' + U.colorFor(S.user.name) + '">' + U.esc(U.initials(S.user.name)) + '</span>' +
      '<span>' + POS.icon('lock') + ' Lock</span></button></div></aside><main class="main" id="main"></main>';
    U.$$('.nav button', app).forEach((b) => { b.onclick = () => POS.go(b.getAttribute('data-view')); });
    U.$('#lock').onclick = POS.logout;
    U.$('#backup-warn').onclick = () => POS.backup();
    POS.updateBadges();
    POS.tick();
  };

  POS.destroyView = function () {
    const cur = S.view && POS.views[S.view];
    if (cur && cur.destroy) cur.destroy();
  };

  POS.go = function (view) {
    if (!POS.can(view)) return U.toast('You do not have access to ' + VIEW_LABELS[view] + '. Ask the owner.', 'error');
    POS.destroyView();
    S.view = view;
    U.$$('.nav button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-view') === view));
    const main = document.getElementById('main');
    main.innerHTML = '';
    main.scrollTop = 0;
    POS.views[view].render(main);
    if (main.firstElementChild) main.firstElementChild.classList.add('view-enter');
  };

  POS.updateBadges = function () {
    const tb = document.getElementById('tabs-badge');
    if (tb) { tb.textContent = S.open.length || ''; tb.style.display = S.open.length ? '' : 'none'; }
    const kb = document.getElementById('kitchen-badge');
    if (kb && POS.kitchenCount) {
      const n = POS.kitchenCount();
      if (kb.textContent !== String(n || '')) {
        kb.textContent = n || '';
        kb.classList.remove('bump');
        void kb.offsetWidth;
        if (n) kb.classList.add('bump');
      }
      kb.style.display = n ? '' : 'none';
    }
    const cb = document.getElementById('courts-badge');
    if (cb) {
      const busy = S.settings.courts.filter((c) => POS.courtSession(c.id)).length;
      cb.textContent = busy ? busy + '/' + S.settings.courts.length : '';
      cb.style.display = busy ? '' : 'none';
    }
    const bw = document.getElementById('backup-warn');
    if (bw) bw.classList.toggle('hidden', !(POS.isOwner() && Date.now() - (S.settings.lastBackup || 0) > 24 * 3600e3));
  };

  POS.tick = function () {
    const now = new Date();
    U.$$('.clock').forEach((c) => {
      c.innerHTML = U.fmtTime(now.getTime()) + '<span class="c-date"> · ' + U.fmtDate(now.getTime()) + '</span>';
    });
    if (!S.user) return;
    const v = S.view && POS.views[S.view];
    if (v && v.tick) v.tick();
    POS.courtAlerts(now.getTime());
    const lock = +S.settings.autoLock || 0;
    if (lock && now.getTime() - (POS.lastTouch || 0) > lock * 60000 && !U.topModal()) {
      POS.logout();
      U.toast('Locked after ' + lock + ' minutes of no activity', 'warn');
    }
  };
  POS.touch = function () { POS.lastTouch = Date.now(); };

  // Warn the counter when a booked court is about to end, and when its time is up
  const alerted = {};
  POS.courtAlerts = function (now) {
    S.open.forEach((o) => o.lines.forEach((l) => {
      if (l.kind !== 'court' || l.mode !== 'fixed' || now < l.start) return;
      const left = l.end - now;
      const key = l.id + ':' + l.end;
      if (left <= 0 && left > -60000 && !alerted[key + 'up']) {
        alerted[key + 'up'] = alerted[key + '5'] = 1;
        POS.sound('alert');
        U.toast(l.name + ': time is up for ' + o.name, 'warn');
      } else if (left > 0 && left <= 5 * 60000 && !alerted[key + '5']) {
        alerted[key + '5'] = 1;
        POS.sound('alert');
        U.toast(l.name + ': 5 minutes left for ' + o.name, 'warn');
      }
    }));
  };

  /* ---------- orders ---------- */
  POS.newCart = function () {
    return {
      id: U.uid(), no: null, name: 'Walk-in', status: 'draft', lines: [], discount: null, payments: [],
      createdAt: Date.now(), cashier: S.user.name, cashierId: S.user.id
    };
  };

  // Which open order is using a court right now (timer running, or inside a booked block)
  POS.courtSession = function (courtId, now) {
    now = now || Date.now();
    for (const o of S.open) {
      for (const l of o.lines) {
        if (l.kind !== 'court' || l.courtId !== courtId) continue;
        if (l.mode === 'fixed' ? now >= l.start && now < l.end : !l.end) return { order: o, line: l };
      }
    }
    return null;
  };

  // Items are either in stock or marked "out of stock" (no counting)
  POS.available = (item) => (item && item.soldOut ? 0 : Infinity);

  POS.setSoldOut = async function (item, out) {
    item.soldOut = !!out;
    await POS.db.put('items', item);
    await POS.db.put('stocklog', {
      id: U.uid(), itemId: item.id, name: item.name, out: item.soldOut, ts: Date.now(), user: S.user ? S.user.name : ''
    });
  };

  // Saves any order (open tab, paid sale, void)
  POS.saveOrder = async function (o) {
    const prev = await POS.db.get('orders', o.id);
    if (!o.no) o.no = await POS.nextNo();
    o.updatedAt = Date.now();
    if (o.status === 'paid' || o.status === 'void') o.day = U.dayKey(o.paidAt || o.voidAt);
    await POS.db.put('orders', U.copy(o));
    S.open = S.open.filter((x) => x.id !== o.id);
    if (o.status === 'open') S.open.push(U.copy(o));
    if (POS.kitchenAfterSave) await POS.kitchenAfterSave(prev, o);
    POS.updateBadges();
    return o;
  };

  /* ---------- backup ---------- */
  POS.backup = async function () {
    const data = await POS.db.dump();
    const name = 'PicklePOS-backup-' + U.dayKey() + '-' + U.pad(new Date().getHours()) + U.pad(new Date().getMinutes()) + '.json';
    U.download(name, JSON.stringify({ app: 'PicklePOS', version: 1, exportedAt: Date.now(), data: data }), 'application/json');
    S.settings.lastBackup = Date.now();
    await POS.saveSettings();
    POS.updateBadges();
    U.toast('Backup saved to your Downloads folder: ' + name, 'ok');
  };
})(window.POS);
