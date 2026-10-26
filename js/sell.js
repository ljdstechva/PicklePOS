/* PicklePOS - Sell screen: item grid, cart, discounts, payment */
(function (POS) {
  'use strict';
  const U = POS.util, C = POS.calc, P = POS.print, S = POS.state;
  let el = null, cat = 'all', search = '', lastCartTick = 0, lastTotal = null;

  POS.views.sell = {
    render: function (root) {
      if (!POS.cart) { POS.cart = POS.newCart(); POS.cartDirty = false; }
      lastTotal = null;
      const hr = new Date().getHours();
      el = U.h('<div class="sell"><section class="catalog"><div class="cat-bar"><div class="cat-top"><div class="hello"><h1>Good ' +
        (hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening') + ', ' + U.esc(S.user.name.split(' ')[0]) + '</h1><div>' +
        U.fmtDate(Date.now()) + ' &middot; ' + U.esc(S.settings.bizName) + '</div></div><div class="search-wrap">' +
        '<svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>' +
        '<input type="text" class="search" id="s-search" placeholder="Search items...  (F2)   Enter = add first result">' +
        '<button class="search-x hidden" id="s-clear" title="Clear search">&times;</button></div></div>' +
        '<div class="cats" id="s-chips"></div></div><div class="grid" id="s-grid"></div></section>' +
        '<aside class="cart" id="cart"></aside></div>');
      root.appendChild(el);
      const si = U.$('#s-search', el), sx = U.$('#s-clear', el);
      si.value = search;
      const onSearch = () => { search = si.value; sx.classList.toggle('hidden', !search); renderGrid(true); };
      si.oninput = onSearch;
      si.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const first = U.$('#s-grid .tile', el);
          if (first && search.trim()) { first.click(); si.select(); }
        } else if (e.key === 'Escape' && si.value) { e.stopPropagation(); si.value = ''; onSearch(); }
      };
      sx.onclick = () => { si.value = ''; onSearch(); si.focus(); };
      sx.classList.toggle('hidden', !search);
      U.$('#s-grid', el).onclick = (e) => {
        const t = e.target.closest('.tile');
        if (t) addItem(POS.itemById(t.getAttribute('data-id')), t);
      };
      U.$('#cart', el).onclick = onCartClick;
      document.addEventListener('keydown', onKeys);
      renderChips();
      renderGrid(true);
      renderCart();
    },
    refresh: function () { if (el) { renderGrid(); renderCart(); } },
    tick: function () {
      if (Date.now() - lastCartTick > 10000 && POS.cart && POS.cart.lines.some((l) => l.kind === 'court' && !l.end)) {
        lastCartTick = Date.now();
        renderCart();
      }
    },
    destroy: function () { el = null; document.removeEventListener('keydown', onKeys); }
  };

  // F2 = search, F9 = pay, F4 = court time, F8 = save tab
  function onKeys(e) {
    if (!el || U.topModal()) return;
    const map = { F2: 'search', F4: 'courtadd', F8: 'save', F9: 'pay' };
    const what = map[e.key];
    if (!what) return;
    e.preventDefault();
    if (what === 'search') { const si = U.$('#s-search', el); si.focus(); si.select(); return; }
    const b = U.$('#cart [data-a="' + what + '"]', el);
    if (b && !b.disabled) b.click();
  }

  /* ---------- catalog ---------- */
  function activeItems() { return S.items.filter((i) => i.active !== false); }

  // Category tiles: an icon picked from the category name, in a soft colour, with the item count
  const CAT_ICONS = [
    [/coffee|kape|espresso|latte|cafe|tea|matcha|choco|hot/i, '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M11 3.5v2.5"/>'],
    [/drink|juice|soda|water|beverage|shake|smoothie|cold|iced|beer/i, '<path d="M7 4h10l-1.2 15a1.5 1.5 0 0 1-1.5 1.4H9.7a1.5 1.5 0 0 1-1.5-1.4z"/><path d="M7.5 9h9"/>'],
    [/dessert|cake|sweet|pastr|bread|bake|cookie|donut/i, '<path d="M4 20h16v-6H4z"/><path d="M4 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2M12 9V6"/><circle cx="12" cy="4.5" r="1"/>'],
    [/snack|chip|fries|nacho/i, '<path d="M6 8h12l-1.5 12h-9z"/><path d="M8 8l-1-4M12 8V3M16 8l1-4"/>'],
    [/food|meal|rice|silog|pasta|burger|sandwich|wing|chicken|pancit|noodle|lunch|breakfast|dinner/i, '<path d="M3 12h18a9 9 0 0 1-18 0z"/><path d="M8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4"/>'],
    [/court|extra|paddle|ball|pickle|rental|gear|merch|equip/i, '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="10" r="1"/><circle cx="10.5" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>']
  ];
  const ICON_ALL = '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>';
  const ICON_TAG = '<path d="M3.5 12.5l8-8H20v8.5l-8 8z"/><circle cx="15.5" cy="8.5" r="1.3"/>';
  const PASTELS = [['#e5f4eb', '#178a4a'], ['#fdefd6', '#b26a00'], ['#e3eefb', '#2f6fb0'], ['#fbe5ed', '#b83c6a'],
    ['#ede7fb', '#6a4bc4'], ['#ddf3f1', '#13837a'], ['#fde8dd', '#c4511f']];
  const svg = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  function catIcon(name) {
    const m = CAT_ICONS.find((x) => x[0].test(name));
    return svg(m ? m[1] : ICON_TAG);
  }

  function renderChips() {
    const used = {};
    activeItems().forEach((i) => { used[i.categoryId] = (used[i.categoryId] || 0) + 1; });
    const cats = S.categories.filter((c) => used[c.id]);
    if (cat !== 'all' && !used[cat]) cat = 'all';
    const box = U.$('#s-chips', el);
    const tile = (id, name, n, icon, i) => {
      const c = PASTELS[i % PASTELS.length];
      return '<button class="cat" data-c="' + id + '" style="--i:' + i + ';--cb:' + c[0] + ';--cf:' + c[1] + '"><span class="cat-ic">' + icon +
        '</span><span><b>' + U.esc(name) + '</b><small>' + n + (n === 1 ? ' item' : ' items') + '</small></span></button>';
    };
    box.innerHTML = tile('all', 'All', activeItems().length, svg(ICON_ALL), 0) +
      cats.map((c, i) => tile(c.id, c.name, used[c.id], catIcon(c.name), i + 1)).join('');
    box.classList.add('anim');
    U.$$('.cat', box).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-c') === cat);
      b.onclick = () => {
        cat = b.getAttribute('data-c');
        box.classList.remove('anim');
        U.$$('.cat', box).forEach((x) => x.classList.toggle('on', x === b));
        renderGrid(true);
      };
    });
  }

  POS.stockBadge = (item) => (item.soldOut ? '<span class="stock zero">Out of stock</span>' : '');

  POS.photoHTML = function (item) {
    return item.photo ? '<img src="' + item.photo + '" alt="">' :
      '<div class="ph-ph" style="--pc:' + U.colorFor(item.categoryId + item.name) + '">' + U.esc(U.initials(item.name)) + '</div>';
  };

  // How many of each item are in the current order (shown as a badge on the tile)
  function cartQty() {
    const m = {};
    POS.cart.lines.forEach((l) => { if (l.kind === 'item') m[l.itemId] = (m[l.itemId] || 0) + l.qty; });
    return m;
  }
  const qtyBadge = (n) => (n ? '<span class="in-cart">' + n + '</span>' : '');

  function updateBadges() {
    if (!el) return;
    const m = cartQty();
    U.$$('#s-grid .tile', el).forEach((t) => {
      const n = m[t.getAttribute('data-id')] || 0;
      t.classList.toggle('in', n > 0);
      let b = U.$('.in-cart', t);
      if (!n) { if (b) b.remove(); return; }
      if (!b) { U.$('.ph', t).insertAdjacentHTML('beforeend', qtyBadge(n)); return; }
      if (b.textContent !== String(n)) {
        b.textContent = n;
        b.classList.remove('bump');
        void b.offsetWidth;
        b.classList.add('bump');
      }
    });
  }

  function renderGrid(animate) {
    const q = search.trim().toLowerCase();
    const order = {};
    S.categories.forEach((c, i) => { order[c.id] = i; });
    const items = activeItems().filter((i) => (q ? i.name.toLowerCase().indexOf(q) >= 0 : cat === 'all' || i.categoryId === cat))
      .sort((a, b) => (order[a.categoryId] - order[b.categoryId]) || a.name.localeCompare(b.name));
    const grid = U.$('#s-grid', el);
    if (!items.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + (S.items.length ? 'No items found.' :
        'No menu items yet.' + (POS.can('menu') ? ' Add them in <b>Menu</b>.' : '')) + '</div>';
      return;
    }
    const inCart = cartQty();
    grid.classList.toggle('anim', !!animate);
    grid.innerHTML = items.map((i, n) => '<div class="tile' + (POS.available(i) <= 0 ? ' out' : '') + (inCart[i.id] ? ' in' : '') + '" data-id="' + i.id + '"' +
      (animate && n < 30 ? ' style="--i:' + n + '"' : '') + '>' +
      '<div class="ph">' + POS.photoHTML(i) + POS.stockBadge(i) + qtyBadge(inCart[i.id]) + '</div>' +
      '<div class="t-name">' + U.esc(i.name) + '</div><div class="t-foot"><span class="t-price">' + U.money(i.price) + '</span>' +
      '<span class="t-add">+</span></div></div>').join('');
  }

  // A small copy of the tile's picture flies into the order line
  function flyToCart(tile, lineId) {
    if (!POS.anim() || !tile) return;
    const ph = U.$('.ph', tile);
    const target = U.$('.line[data-lid="' + lineId + '"]', el) || U.$('.cart-lines', el);
    if (!ph || !target) return;
    const a = ph.getBoundingClientRect(), b = target.getBoundingClientRect();
    const size = Math.min(a.width, a.height);
    const fly = document.createElement('div');
    fly.className = 'fly';
    const pic = U.$('img, .ph-ph', ph).cloneNode(true);
    fly.appendChild(pic);
    fly.style.cssText = 'left:' + (a.left + (a.width - size) / 2) + 'px;top:' + a.top + 'px;width:' + size + 'px;height:' + size + 'px';
    document.body.appendChild(fly);
    const dx = b.left + 30 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + size / 2);
    void fly.offsetWidth;
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.18)';
    fly.style.opacity = '0.2';
    setTimeout(() => fly.remove(), 520);
  }

  function refreshTile(item) {
    const t = el && U.$('.tile[data-id="' + item.id + '"]', el);
    if (!t) return;
    const old = U.$('.stock', t);
    if (old) old.remove();
    U.$('.ph', t).insertAdjacentHTML('beforeend', POS.stockBadge(item));
    t.classList.toggle('out', POS.available(item) <= 0);
  }

  function addItem(item, tile) {
    if (!item) return;
    if (POS.available(item) < 1) {
      if (tile) { tile.classList.remove('shake'); void tile.offsetWidth; tile.classList.add('shake'); }
      return U.toast(item.name + ' is out of stock', 'error');
    }
    const o = POS.cart;
    const l = o.lines.find((x) => x.kind === 'item' && x.itemId === item.id && !x.note && x.price === item.price);
    let lid;
    if (l) { l.qty++; lid = l.id; } else {
      lid = U.uid();
      o.lines.push({
        id: lid, kind: 'item', itemId: item.id, name: item.name, price: item.price, qty: 1, note: '',
        sent: 0, kitchen: !!item.kitchen, catId: item.categoryId
      });
    }
    POS.cartDirty = true;
    POS.sound('add');
    renderCart(lid, l ? 'qty' : 'new');
    refreshTile(item);
    flyToCart(tile, lid);
  }

  /* ---------- cart ---------- */
  const unsentKitchen = (o) => o.lines.filter((l) => l.kind === 'item' && l.kitchen && l.qty > (l.sent || 0))
    .map((l) => ({ name: l.name, qty: l.qty - (l.sent || 0), note: l.note }));

  function itemLineHTML(l) {
    const sent = l.kitchen && l.sent ? ' <span class="sent">&#10003; ' + (l.sent >= l.qty ? 'sent' : l.sent + ' sent') + '</span>' : '';
    const item = POS.itemById(l.itemId);
    return '<div class="line" data-lid="' + l.id + '"><span class="l-ph">' + POS.photoHTML(item || { name: l.name, categoryId: l.catId || '' }) + '</span>' +
      '<div class="l-main"><div class="l-name">' + U.esc(l.name) + '</div>' +
      '<div class="l-sub">' + U.money(l.price) + (l.note ? ' &middot; <i>' + U.esc(l.note) + '</i>' : '') + sent + '</div></div>' +
      '<div class="qty"><button data-a="dec" title="Less">&minus;</button><span>' + l.qty + '</span>' +
      '<button data-a="inc" title="More">+</button></div>' +
      '<div class="l-amt">' + U.num(l.price * l.qty) + '</div>' +
      '<button class="l-more" data-a="more" title="Note / remove">&#8942;</button></div>';
  }

  function courtLineHTML(l, now) {
    const r = C.court(l, now);
    const when = l.mode === 'fixed' ? U.fmtTime(l.start) + ' - ' + U.fmtTime(l.end) + ' (booked)' :
      U.fmtTime(l.start) + ' - ' + (l.end ? U.fmtTime(l.end) : 'now') + ' &middot; played ' + U.fmtDur(r.elapsed);
    return '<div class="line court" data-lid="' + l.id + '"><span class="l-ph court">' + POS.icon('courts') + '</span>' +
      '<div class="l-main"><div class="l-name">' + U.esc(l.name) +
      (r.running ? ' <span class="live">LIVE</span>' : '') + '</div><div class="l-sub">' + when + '<br>Billed ' +
      U.fmtDur(r.billed) + ' @ ' + U.money(l.rate) + '/hr</div></div>' +
      '<div class="l-amt">' + U.num(r.amount) + '</div><button class="l-more" data-a="court" title="Court options">&#8942;</button></div>';
  }

  const sumRow = (label, v, cls) => '<div class="sum-row ' + (cls || '') + '"><span>' + label + '</span><span>' + U.money(v) + '</span></div>';

  function renderCart(flashId, kind) {
    const box = el && U.$('#cart', el);
    if (!box) return;
    const o = POS.cart, now = Date.now(), t = C.totals(o, now);
    const saved = o.status === 'open';
    const unsent = unsentKitchen(o).reduce((a, i) => a + i.qty, 0);
    let h = '<div class="cart-head"><div class="c-who"><div class="c-title">' + (saved ? 'Tab #' + o.no : 'New Order') +
      (POS.cartDirty && saved ? ' <span class="unsaved">not saved</span>' : '') + '</div>' +
      '<button class="link" data-a="name">' + U.esc(o.name) + ' &#9998;</button></div><div class="c-head-btns">' +
      (o.lines.length ? '<button class="btn sm" data-a="bill" title="Print the bill for the customer to check">Bill</button>' : '') +
      (saved ? '<button class="btn sm" data-a="void">Void</button>' : '') +
      '<button class="btn sm" data-a="new">+ New</button></div></div><div class="cart-lines">';
    if (!o.lines.length) {
      h += '<div class="empty cart-empty"><span class="logo-ball float"></span><b>No items yet</b>' +
        '<span>Tap a dish or drink to add it.' + (POS.can('courts') ? '<br>Use <b>Court Time</b> for court rental.' : '') + '</span></div>';
    }
    o.lines.forEach((l) => { h += l.kind === 'court' ? courtLineHTML(l, now) : itemLineHTML(l); });
    h += '</div><div class="cart-sum">' + sumRow('Subtotal', t.subtotal);
    if (t.vatExempt) h += sumRow('Less VAT (exempt)', -t.vatExempt, 'disc');
    if (t.discount) h += sumRow('Less ' + U.esc(C.discountLabel(o.discount)) + (o.discount.type !== 'custom' ? ' 20%' : ''), -t.discount, 'disc');
    h += sumRow('Total', t.total, 'total') + '</div><div class="cart-actions">' +
      (POS.can('courts') ? '<button class="btn" data-a="courtadd" title="F4">Court Time</button>' : '') +
      '<button class="btn' + (o.discount ? ' on' : '') + '" data-a="disc">' + (o.discount ? 'Edit Discount' : 'Discount') + '</button>' +
      '<button class="btn" data-a="save" title="F8">Save Tab</button>' +
      (POS.kitchenOn() ? '<button class="btn" data-a="kitchen">To Kitchen' + (unsent ? ' <span class="count">' + unsent + '</span>' : '') + '</button>' : '') +
      '<button class="btn primary lg full pay-btn" data-a="pay"' + (o.lines.length ? '' : ' disabled') + '><span>Pay ' +
      U.money(t.total) + '</span><kbd>F9</kbd></button></div>';
    const lines = U.$('.cart-lines', box);
    const keep = lines ? lines.scrollTop : 0;
    box.innerHTML = h;
    const nl = U.$('.cart-lines', box);
    if (flashId) {
      const f = U.$('.line[data-lid="' + flashId + '"]', box);
      if (f) {
        if (kind === 'qty') U.$('.qty span', f) && U.$('.qty span', f).classList.add('bump');
        else f.classList.add(kind === 'new' ? 'new' : 'flash');
        f.scrollIntoView({ block: 'nearest' });
      }
    } else nl.scrollTop = keep;
    if (lastTotal !== null && lastTotal !== t.total) {
      U.$$('.sum-row.total span:last-child, .pay-btn span', box).forEach((s) => s.classList.add('bump'));
    }
    lastTotal = t.total;
    updateBadges();
  }
  POS.renderCart = () => renderCart();

  async function onCartClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.getAttribute('data-a');
    const o = POS.cart;
    const lineEl = b.closest('.line');
    const l = lineEl ? o.lines.find((x) => x.id === lineEl.getAttribute('data-lid')) : null;
    if (a === 'inc' && l) {
      const item = POS.itemById(l.itemId);
      if (item && POS.available(item) < 1) return U.toast(item.name + ' is out of stock', 'error');
      l.qty++;
      POS.cartDirty = true;
      POS.sound('add');
      renderCart(l.id, 'qty');
      if (item) refreshTile(item);
    } else if (a === 'dec' && l) {
      if (l.qty <= 1) return removeLine(l);
      l.qty--;
      l.sent = Math.min(l.sent || 0, l.qty);
      POS.cartDirty = true;
      renderCart(l.id, 'qty');
      const item = POS.itemById(l.itemId);
      if (item) refreshTile(item);
    } else if (a === 'more' && l) lineModal(l);
    else if (a === 'court' && l) POS.courtLineModal(o.id, l.id, o);
    else if (a === 'name') {
      const v = await U.ask('Customer / tab name', 'Name or table', o.name === 'Walk-in' ? '' : o.name, { placeholder: 'e.g. Juan, Table 3, Court 1 group' });
      if (v != null) { o.name = v || 'Walk-in'; POS.cartDirty = true; renderCart(); }
    } else if (a === 'new') {
      if (POS.cartDirty && o.lines.length && !(await U.confirm('Discard the unsaved changes to this order?', 'Discard', true))) return;
      POS.cart = POS.newCart();
      POS.cartDirty = false;
      POS.views.sell.refresh();
    } else if (a === 'void') voidTab();
    else if (a === 'bill') P.receipt(Object.assign(U.copy(o), { totals: C.totals(o) }));
    else if (a === 'courtadd') POS.startCourt({ cart: true });
    else if (a === 'disc') discountModal();
    else if (a === 'save') {
      if (await saveTab()) {
        U.toast('Saved to tab #' + o.no + ' (' + o.name + ')', 'ok');
        POS.cart = POS.newCart();
        POS.cartDirty = false;
        POS.views.sell.refresh();
      }
    } else if (a === 'kitchen') sendKitchen();
    else if (a === 'pay') POS.payModal();
  }

  async function removeLine(l) {
    if (l.kitchen && l.sent && !(await U.confirm(l.name + ' was already sent to the kitchen. Remove it anyway?', 'Remove', true))) return;
    const cart = POS.cart;
    const idx = cart.lines.indexOf(l);
    const finish = () => {
      cart.lines = cart.lines.filter((x) => x !== l);
      POS.cartDirty = true;
      renderCart();
      const item = POS.itemById(l.itemId);
      if (item) refreshTile(item);
    };
    const row = el && U.$('.line[data-lid="' + l.id + '"]', el);
    if (row && POS.anim()) { row.classList.add('removing'); setTimeout(finish, 170); } else finish();
    U.toast('Removed ' + l.qty + ' x ' + l.name, '', {
      action: 'Undo', onAction: () => {
        if (POS.cart !== cart || cart.lines.indexOf(l) >= 0) return;
        const item = POS.itemById(l.itemId);
        // If the removal was already saved, the kitchen saw it as cancelled, so send it again
        const saved = S.open.find((x) => x.id === cart.id);
        if (l.sent && (!saved || !saved.lines.some((x) => x.id === l.id))) l.sent = 0;
        cart.lines.splice(Math.min(idx, cart.lines.length), 0, l);
        POS.cartDirty = true;
        renderCart(l.id, 'new');
        if (item) refreshTile(item);
      }
    });
  }

  const QUICK_NOTES = ['Iced', 'Hot', 'Less sugar', 'No sugar', 'Less ice', 'Extra shot', 'Take out', 'No onions'];

  function lineModal(l) {
    const body = U.h('<div><div class="row2"><label class="f">Quantity<input id="lm-qty" type="number" min="1" step="1"></label>' +
      '<label class="f">Price each<input id="lm-price" type="number" min="0" step="0.01"' + (POS.can('price') ? '' : ' disabled') + '></label></div>' +
      '<label class="f">Note for kitchen / receipt<input id="lm-note" type="text" placeholder="e.g. Iced, less sugar"></label>' +
      '<div class="quick">' + QUICK_NOTES.map((n) => '<button type="button" class="btn sm" data-n="' + n + '">' + n + '</button>').join('') + '</div></div>');
    U.$('#lm-qty', body).value = l.qty;
    U.$('#lm-price', body).value = l.price;
    const note = U.$('#lm-note', body);
    note.value = l.note || '';
    U.$$('[data-n]', body).forEach((b) => {
      b.onclick = () => { note.value = (note.value ? note.value + ', ' : '') + b.getAttribute('data-n'); };
    });
    U.modal({
      title: l.name, body: body, cls: 'small', enterButton: 'lm-ok',
      buttons: [
        { label: 'Remove', cls: 'danger', onClick: () => { removeLine(l); } },
        { label: 'Cancel' },
        {
          id: 'lm-ok', label: 'Save', cls: 'primary', onClick: () => {
            const q = Math.floor(+U.$('#lm-qty', body).value);
            if (!(q >= 1)) { U.toast('Quantity must be at least 1', 'error'); return false; }
            const item = POS.itemById(l.itemId);
            if (item && item.soldOut && q > l.qty) { U.toast(item.name + ' is out of stock', 'error'); return false; }
            l.qty = q;
            l.sent = Math.min(l.sent || 0, q);
            l.note = note.value.trim();
            const pr = +U.$('#lm-price', body).value;
            if (POS.can('price') && pr >= 0) l.price = U.r2(pr);
            POS.cartDirty = true;
            renderCart();
            if (item) refreshTile(item);
          }
        }]
    });
  }

  POS.ensureName = async function (o) {
    if (o.name && o.name !== 'Walk-in') return true;
    const v = await U.ask('Name this tab', 'Customer name or table', '', {
      required: true, placeholder: 'e.g. Juan, Table 3, Court 1 group', okLabel: 'Continue'
    });
    if (!v) return false;
    o.name = v;
    return true;
  };

  async function saveTab() {
    const o = POS.cart;
    if (!o.lines.length) { U.toast('Add items first', 'error'); return false; }
    if (!(await POS.ensureName(o))) return false;
    o.status = 'open';
    await POS.saveOrder(o);
    POS.cartDirty = false;
    return true;
  }

  async function sendKitchen() {
    const o = POS.cart;
    const items = unsentKitchen(o);
    if (!items.length) return U.toast('Nothing new to send to the kitchen', 'warn');
    if (!(await POS.ensureName(o))) return;
    if (!o.no) o.no = await POS.nextNo();
    await POS.sendToKitchen(o);
    o.status = 'open';
    await POS.saveOrder(o);
    if (POS.kitchenPrint()) P.kitchen(o, items);
    U.toast('Sent to kitchen – saved to tab #' + o.no + ' (' + o.name + ')', 'ok');
    POS.cart = POS.newCart();
    POS.cartDirty = false;
    POS.views.sell.refresh();
  }

  async function voidTab() {
    const o = POS.cart;
    if (!(await POS.requireOwner('void tab #' + o.no, 'void'))) return;
    const reason = await U.ask('Void tab #' + o.no, 'Reason for voiding', '', { required: true, okLabel: 'Void Tab' });
    if (!reason) return;
    const saved = S.open.find((x) => x.id === o.id);
    const v = U.copy(saved || o);
    v.status = 'void';
    v.voidAt = Date.now();
    v.voidBy = S.user.name;
    v.voidReason = reason;
    v.totals = C.totals(v);
    await POS.saveOrder(v);
    U.toast('Tab #' + o.no + ' voided', 'ok');
    POS.cart = POS.newCart();
    POS.cartDirty = false;
    POS.views.sell.refresh();
  }

  /* ---------- discount ---------- */
  function discountModal() {
    const o = POS.cart;
    const d = o.discount || {};
    const vat = S.settings.vatRegistered;
    o.lines.forEach((l) => { if (!l.id) l.id = U.uid(); });   // items are ticked by id
    const itemRows = o.lines.map((l) => '<label class="chk"><input type="checkbox" data-line="' + l.id + '"> ' +
      (l.kind === 'court' ? U.esc(l.name) + ' <span class="muted small">(court time)</span>' : l.qty + ' &times; ' + U.esc(l.name)) +
      ' <span class="muted small">' + U.money(C.lineAmount(l)) + '</span></label>').join('');
    const body = U.h('<div><div class="seg" id="d-type">' +
      [['none', 'None'], ['senior', 'Senior Citizen'], ['pwd', 'PWD'], ['custom', 'Other']].map((x) =>
        '<button type="button" data-t="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
      '<div id="d-sp"><div class="f-label">Which items are for the Senior/PWD? <span class="muted small">(their own meal and drinks only)</span></div>' +
      '<div id="d-items" style="max-height:170px;overflow:auto;padding:2px 0 6px">' + itemRows + '</div>' +
      '<div id="d-split"><div class="row2"><label class="f">Total guests on this bill<input id="d-pax" type="number" min="1" step="1"></label>' +
      '<label class="f">How many are Senior/PWD<input id="d-cnt" type="number" min="1" step="1"></label></div>' +
      '<label class="chk"><input type="checkbox" id="d-court"> Also apply to court fees</label></div>' +
      '<div class="row2"><label class="f">Name on ID<input id="d-holder" type="text"></label>' +
      '<label class="f">ID number<input id="d-id" type="text"></label></div>' +
      '<p class="muted small" id="d-how"></p></div>' +
      '<div id="d-cu"><div class="row2"><label class="f">Type<select id="d-mode"><option value="pct">Percent (%)</option>' +
      '<option value="amt">Fixed amount</option></select></label><label class="f">Value<input id="d-val" type="number" min="0" step="0.01"></label></div>' +
      '<label class="f">Reason<input id="d-reason" type="text" placeholder="e.g. Promo, Member, Owner\'s guest"></label></div>' +
      '<div class="disc-preview" id="d-prev"></div></div>');
    let type = d.type || 'none';
    const f = (id) => U.$('#' + id, body);
    f('d-pax').value = d.pax || 1;
    f('d-cnt').value = d.count || 1;
    f('d-holder').value = d.holder || '';
    f('d-id').value = d.idNo || '';
    f('d-court').checked = !!d.includeCourt;
    f('d-mode').value = d.mode || 'pct';
    f('d-val').value = d.value || '';
    f('d-reason').value = d.reason || '';
    U.$$('[data-line]', body).forEach((c) => { c.checked = (d.lineIds || []).indexOf(c.getAttribute('data-line')) >= 0; });
    const ticked = () => U.$$('[data-line]', body).filter((c) => c.checked).map((c) => c.getAttribute('data-line'));

    function read() {
      if (type === 'none') return null;
      if (type === 'custom') return { type: 'custom', mode: f('d-mode').value, value: +f('d-val').value || 0, reason: f('d-reason').value.trim() };
      return {
        type: type, pax: Math.max(1, Math.floor(+f('d-pax').value || 1)), count: Math.max(1, Math.floor(+f('d-cnt').value || 1)),
        holder: f('d-holder').value.trim(), idNo: f('d-id').value.trim(), includeCourt: f('d-court').checked, lineIds: ticked()
      };
    }
    function draw() {
      U.$$('#d-type button', body).forEach((b) => b.classList.toggle('on', b.getAttribute('data-t') === type));
      f('d-sp').classList.toggle('hidden', type !== 'senior' && type !== 'pwd');
      f('d-cu').classList.toggle('hidden', type !== 'custom');
      const own = ticked().length;
      f('d-split').classList.toggle('hidden', own > 0);
      f('d-how').innerHTML = own ?
        '20% off the <b>' + own + ' ticked item' + (own > 1 ? 's' : '') + '</b> only' + (vat ? ', plus VAT exemption on them' : '') + '. The rest of the bill is charged in full.' :
        'No items ticked, so the bill is divided equally: 20% off (bill &divide; guests &times; Senior/PWD count)' + (vat ? ', plus VAT exemption' : '') +
        '. Tick the Senior/PWD\'s own meal above to discount only that.';
      const t = C.totals(Object.assign({}, o, { discount: read() }));
      f('d-prev').innerHTML = 'Subtotal ' + U.money(t.subtotal) +
        (t.vatExempt ? ' &middot; VAT exempt -' + U.money(t.vatExempt) : '') +
        ' &middot; Discount -' + U.money(t.discount) + ' &middot; <b>New total ' + U.money(t.total) + '</b>';
    }
    U.$$('#d-type button', body).forEach((b) => { b.onclick = () => { type = b.getAttribute('data-t'); draw(); }; });
    U.$$('input,select', body).forEach((i) => { i.oninput = draw; i.onchange = draw; });
    draw();
    U.modal({
      title: 'Discount', body: body, enterButton: 'd-ok',
      buttons: [{ label: 'Cancel' }, {
        id: 'd-ok', label: 'Apply', cls: 'primary', onClick: async () => {
          const nd = read();
          if (nd && nd.type !== 'custom') {
            if (!nd.idNo || !nd.holder) { U.toast('Enter the name and ID number from the Senior/PWD ID', 'error'); return false; }
            if (!nd.lineIds.length && nd.count > nd.pax) { U.toast('Senior/PWD count cannot be more than total guests', 'error'); return false; }
          }
          if (nd && nd.type === 'custom') {
            if (!(nd.value > 0)) { U.toast('Enter the discount value', 'error'); return false; }
            if (!(await POS.requireOwner('give a discount', 'discount'))) return false;
          }
          o.discount = nd;
          POS.cartDirty = true;
          renderCart();
        }
      }]
    });
  }

  /* ---------- payment ---------- */
  POS.payModal = function () {
    const o = POS.cart;
    if (!o.lines.length) return U.toast('The order is empty', 'error');
    const now = Date.now();
    const work = U.copy(o);
    work.payments = (o.payments || []).slice();
    const methods = S.settings.payMethods.length ? S.settings.payMethods : ['Cash'];
    let method = methods[0];
    const body = U.h('<div class="pay"><div class="pay-left"><div class="muted">Amount due</div><div class="due" id="p-due"></div>' +
      '<div id="p-list" class="p-list"></div><div class="remain-row"><span>Remaining</span><b id="p-rem"></b></div>' +
      '<div class="muted small" id="p-info"></div>' +
      (POS.kitchenScreen() && unsentKitchen(o).length && o.name === 'Walk-in' ?
        '<label class="f p-name">Name to call when the order is ready (optional)<input id="p-name" type="text" placeholder="e.g. Ana"></label>' : '') +
      '</div>' +
      '<div class="pay-right"><div class="methods" id="p-methods">' + methods.map((m) =>
        '<button type="button" class="btn" data-m="' + U.esc(m) + '">' + U.esc(m) + '</button>').join('') + '</div>' +
      '<label class="f">Amount received<input id="p-amt" type="number" step="0.01" min="0" inputmode="decimal" autofocus></label>' +
      '<div class="quick" id="p-quick"></div>' +
      '<label class="f" id="p-ref-wrap">Reference no.<input id="p-ref" type="text" placeholder="From the e-wallet / bank confirmation"></label>' +
      '<div class="change-box" id="p-change"></div></div></div>');
    const amt = U.$('#p-amt', body), ref = U.$('#p-ref', body);
    const balance = () => C.totals(work, now).balance;
    const running = o.lines.filter((l) => l.kind === 'court' && !l.end).length;

    function draw() {
      const t = C.totals(work, now);
      U.$('#p-due', body).textContent = U.money(t.total);
      U.$('#p-rem', body).textContent = U.money(Math.max(0, t.balance));
      U.$('#p-info', body).textContent = (o.name !== 'Walk-in' ? o.name + ' · ' : '') +
        o.lines.length + ' line(s)' + (running ? ' · court timer will stop at ' + U.fmtTime(now) : '');
      U.$('#p-list', body).innerHTML = work.payments.map((p, i) => '<div class="p-row"><span>' + U.esc(p.method) +
        (p.ref ? ' <small>#' + U.esc(p.ref) + '</small>' : '') + '</span><b>' + U.money(p.amount) +
        '</b><button class="link" data-del="' + i + '">remove</button></div>').join('');
      U.$$('[data-del]', body).forEach((b) => {
        b.onclick = () => { work.payments.splice(+b.getAttribute('data-del'), 1); setDefault(); draw(); };
      });
      U.$$('#p-methods .btn', body).forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === method));
      const cash = method === 'Cash';
      U.$('#p-ref-wrap', body).classList.toggle('hidden', cash);
      const rem = Math.max(0, t.balance);
      const q = U.$('#p-quick', body);
      if (cash) {
        const opts = [rem];
        [20, 50, 100, 500, 1000].forEach((step) => {
          const v = Math.ceil(rem / step) * step;
          if (v > rem && opts.indexOf(v) < 0 && opts.length < 5) opts.push(v);
        });
        q.innerHTML = opts.map((v, i) => '<button type="button" class="btn sm" data-v="' + v + '">' +
          (i === 0 ? 'Exact' : U.money(v)) + '</button>').join('');
        U.$$('[data-v]', q).forEach((b) => { b.onclick = () => { amt.value = b.getAttribute('data-v'); showChange(); amt.focus(); }; });
      } else q.innerHTML = '';
      showChange();
    }
    function showChange() {
      const rem = Math.max(0, balance());
      const v = +amt.value || 0;
      const box = U.$('#p-change', body);
      const okBtn = document.getElementById('p-ok');
      if (method === 'Cash' && v > rem) box.innerHTML = 'Change: <span>' + U.money(v - rem) + '</span>';
      else if (v > 0 && v < rem) box.innerHTML = '<span class="muted">Partial payment – ' + U.money(rem - v) + ' will remain</span>';
      else box.innerHTML = '';
      if (okBtn) okBtn.textContent = v > 0 && v < rem ? 'Add Partial Payment' : 'Complete Sale';
    }
    function setDefault() { amt.value = Math.max(0, balance()).toFixed(2); }
    U.$$('#p-methods .btn', body).forEach((b) => {
      b.onclick = () => { method = b.getAttribute('data-m'); setDefault(); draw(); (method === 'Cash' ? amt : ref).focus(); };
    });
    amt.oninput = showChange;
    setDefault();

    U.modal({
      title: 'Payment' + (o.no ? ' – #' + o.no : ''), body: body, cls: 'wide', enterButton: 'p-ok',
      buttons: [{ label: 'Cancel' }, {
        id: 'p-ok', label: 'Complete Sale', cls: 'primary lg', onClick: () => {
          const rem = balance();
          const v = U.r2(parseFloat(amt.value));
          if (!(v > 0)) { U.toast('Enter the amount received', 'error'); amt.focus(); return false; }
          if (method !== 'Cash' && v > rem + 0.001) { U.toast(method + ' amount cannot be more than ' + U.money(rem), 'error'); return false; }
          const r = ref.value.trim();
          if (method !== 'Cash' && S.settings.refRequired && !r) { U.toast('Enter the ' + method + ' reference number', 'error'); ref.focus(); return false; }
          const applied = U.r2(Math.min(v, rem));
          work.payments.push({ method: method, amount: applied, tendered: method === 'Cash' ? v : applied, ref: method === 'Cash' ? '' : r, ts: Date.now() });
          ref.value = '';
          if (balance() <= 0.001) {
            const nm = U.$('#p-name', body);
            if (nm && nm.value.trim()) o.name = nm.value.trim();
            return finalize(work.payments, now);
          }
          setDefault();
          draw();
          return false;
        }
      }],
      onOpen: () => draw()
    });
  };

  async function finalize(payments, now) {
    const o = POS.cart;
    o.payments = payments;
    o.lines.forEach((l) => {
      if (l.kind === 'court' && l.mode !== 'fixed' && (!l.end || l.amount == null)) C.freezeCourt(l, now);
    });
    if (!o.no) o.no = await POS.nextNo();
    // unsent food/drinks go to the kitchen screen (and/or a printed slip, per Settings)
    const kitchenItems = await POS.sendToKitchen(o, { paid: true });
    const slip = POS.kitchenPrint() && kitchenItems.length;
    o.status = 'paid';
    o.paidAt = now;
    o.paidBy = S.user.name;
    o.totals = C.totals(o, now);
    await POS.saveOrder(o);
    if (S.settings.autoPrint) {
      if (slip) P.receiptAndKitchen(o, kitchenItems); else P.receipt(o);
    } else if (slip) P.kitchen(o, kitchenItems);
    o.toKitchen = POS.kitchenScreen() && kitchenItems.length > 0;
    POS.cart = POS.newCart();
    POS.cartDirty = false;
    if (S.view === 'sell') POS.views.sell.refresh();
    doneModal(o);
  }

  function doneModal(o) {
    const t = o.totals;
    POS.sound('ok');
    const m = U.modal({
      title: 'Sale complete – #' + o.no, cls: 'small', enterButton: 'dn-ok',
      body: '<div class="done"><svg class="check" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/>' +
        '<path d="M15 27.5l7.5 7.5L38 19"/></svg>' +
        (t.change > 0 ? '<div class="muted">Change to give</div><div class="due" id="dn-amt"></div>' :
          '<div class="due" id="dn-amt"></div><div class="muted">Paid in full</div>') +
        '<div class="muted small">' + (o.payments || []).map((p) => U.esc(p.method) + ' ' + U.money(p.tendered || p.amount)).join(' + ') +
        (S.settings.autoPrint ? ' &middot; receipt printing' : '') + '</div>' +
        (o.toKitchen ? '<div class="sent-kitchen">' + POS.icon('kitchen') + ' Sent to the Kitchen screen</div>' : '') + '</div>',
      buttons: [
        { label: S.settings.autoPrint ? 'Reprint Receipt' : 'Print Receipt', onClick: () => { P.receipt(o, { reprint: S.settings.autoPrint }); return false; } },
        { id: 'dn-ok', label: 'Next Order  (Enter)', cls: 'primary' }]
    });
    U.countUp(U.$('#dn-amt', m.el), t.change > 0 ? t.change : t.total, U.money, 600);
  }
})(window.POS);
