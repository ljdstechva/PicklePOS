/* PicklePOS - Menu: categories, dishes with photos, out-of-stock switch */
(function (POS) {
  'use strict';
  const U = POS.util, S = POS.state;
  let el = null, selCat = 'all', lowOnly = false;

  POS.views.menu = {
    render: function (root) {
      el = U.h('<div class="page"><div class="page-head"><h2>Menu</h2>' +
        '<label class="chk"><input type="checkbox" id="m-low"> Out of stock only</label>' +
        '<button class="btn" id="m-log">Stock History</button><button class="btn primary" id="m-add">+ Add Item</button></div>' +
        '<div class="menu-wrap"><div class="card cat-panel"><div class="cp-head"><b>Categories</b>' +
        '<button class="btn sm" id="m-addcat">+ Add</button></div><div id="m-cats"></div></div>' +
        '<div id="m-items"></div></div></div>');
      root.appendChild(el);
      U.$('#m-low', el).checked = lowOnly;
      U.$('#m-low', el).onchange = (e) => { lowOnly = e.target.checked; drawItems(); };
      U.$('#m-add', el).onclick = () => itemModal(null);
      U.$('#m-addcat', el).onclick = addCat;
      U.$('#m-log', el).onclick = stockLog;
      U.$('#m-cats', el).onclick = onCatClick;
      U.$('#m-items', el).onclick = onItemClick;
      draw();
    },
    refresh: function () { if (el) draw(); },
    destroy: function () { el = null; }
  };

  function draw() { drawCats(); drawItems(); }

  function drawCats() {
    const count = (id) => S.items.filter((i) => i.categoryId === id).length;
    U.$('#m-cats', el).innerHTML = '<div class="cat-row' + (selCat === 'all' ? ' on' : '') + '" data-c="all"><span>All items</span><span class="muted">' +
      S.items.length + '</span></div>' + S.categories.map((c, i) => '<div class="cat-row' + (selCat === c.id ? ' on' : '') + '" data-c="' + c.id + '">' +
        '<span>' + U.esc(c.name) + ' <span class="muted">' + count(c.id) + '</span></span><span class="cat-btns">' +
        '<button class="icon" data-a="up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
        '<button class="icon" data-a="down" title="Move down"' + (i === S.categories.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '<button class="icon" data-a="ren" title="Rename">&#9998;</button><button class="icon" data-a="del" title="Delete">&times;</button></span></div>').join('');
  }

  // Shared in/out of stock switch (Menu and Stock screens)
  POS.stockSwitch = (i, cls) => '<label class="chk switch stock-sw ' + (cls || '') + (i.soldOut ? ' is-out' : '') + '" title="Tap to change">' +
    '<input type="checkbox"' + (i.soldOut ? '' : ' checked') + '><span class="sw"></span><span>' + (i.soldOut ? 'Out of stock' : 'In stock') + '</span></label>';
  POS.toggleSoldOut = async function (item) {
    await POS.setSoldOut(item, !item.soldOut);
    U.toast(item.name + (item.soldOut ? ' marked OUT OF STOCK' : ' is back in stock'), item.soldOut ? 'warn' : 'ok');
  };

  function drawItems() {
    let list = S.items.filter((i) => selCat === 'all' || i.categoryId === selCat);
    if (lowOnly) list = list.filter((i) => i.soldOut);
    const order = {};
    S.categories.forEach((c, i) => { order[c.id] = i; });
    list.sort((a, b) => (order[a.categoryId] - order[b.categoryId]) || a.name.localeCompare(b.name));
    U.$('#m-items', el).innerHTML = list.length ? '<div class="item-list">' + list.map((i) => {
      const cat = POS.catById(i.categoryId);
      return '<div class="card item-row' + (i.active === false ? ' inactive' : '') + '" data-id="' + i.id + '">' +
        '<div class="ir-ph ph">' + POS.photoHTML(i) + '</div><div class="ir-main"><b>' + U.esc(i.name) + '</b>' +
        '<div class="muted small">' + U.esc(cat ? cat.name : 'No category') + (i.kitchen ? ' &middot; goes to kitchen' : '') +
        (i.active === false ? ' &middot; <b>hidden</b>' : '') + '</div></div>' +
        '<div class="ir-price">' + U.money(i.price) + '</div>' + POS.stockSwitch(i, 'ir-stock') +
        '<div class="ir-btns"><button class="btn sm" data-a="edit">Edit</button></div></div>';
    }).join('') + '</div>' : '<div class="empty">' + (lowOnly ? 'Everything is in stock.' : 'No items here yet. Click <b>+ Add Item</b>.') + '</div>';
  }

  async function saveCats() {
    S.categories.forEach((c, i) => { c.sort = i; });
    for (const c of S.categories) await POS.db.put('categories', c);
  }

  async function addCat() {
    const name = await U.ask('New category', 'Category name', '', { required: true, placeholder: 'e.g. Pastries' });
    if (!name) return;
    const c = { id: U.uid(), name: name, sort: S.categories.length };
    S.categories.push(c);
    await POS.db.put('categories', c);
    selCat = c.id;
    draw();
  }

  async function onCatClick(e) {
    const r = e.target.closest('[data-c]');
    if (!r) return;
    const id = r.getAttribute('data-c');
    const b = e.target.closest('[data-a]');
    if (!b) { selCat = id; return draw(); }
    const i = S.categories.findIndex((c) => c.id === id);
    const c = S.categories[i];
    const a = b.getAttribute('data-a');
    if (a === 'up' && i > 0) { S.categories.splice(i - 1, 0, S.categories.splice(i, 1)[0]); await saveCats(); }
    if (a === 'down' && i < S.categories.length - 1) { S.categories.splice(i + 1, 0, S.categories.splice(i, 1)[0]); await saveCats(); }
    if (a === 'ren') {
      const n = await U.ask('Rename category', 'Category name', c.name, { required: true });
      if (n) { c.name = n; await POS.db.put('categories', c); }
    }
    if (a === 'del') {
      if (S.items.some((x) => x.categoryId === id)) return U.toast('Move or delete the items in "' + c.name + '" first', 'error');
      if (!(await U.confirm('Delete the category "' + c.name + '"?', 'Delete', true))) return;
      S.categories.splice(i, 1);
      await POS.db.del('categories', id);
      await saveCats();
      if (selCat === id) selCat = 'all';
    }
    draw();
  }

  async function onItemClick(e) {
    const r = e.target.closest('[data-id]');
    if (!r) return;
    const item = POS.itemById(r.getAttribute('data-id'));
    if (e.target.closest('.stock-sw')) {
      e.preventDefault();
      await POS.toggleSoldOut(item);
      return drawItems();
    }
    itemModal(item);
  }

  function itemModal(item) {
    if (!S.categories.length) return U.toast('Add a category first', 'error');
    const isNew = !item;
    const it = item ? U.copy(item) : {
      id: U.uid(), name: '', price: '', categoryId: selCat !== 'all' ? selCat : S.categories[0].id, photo: '',
      kitchen: true, soldOut: false, active: true
    };
    const body = U.h('<div class="item-form"><div class="photo-pick"><div class="photo-box" id="i-photo"></div><div>' +
      '<label class="btn sm">Choose Photo<input type="file" id="i-file" accept="image/*" class="hidden"></label> ' +
      '<button type="button" class="btn sm" id="i-nophoto">Remove</button>' +
      '<p class="muted small">Any photo works; it is shrunk automatically so the laptop stays fast.</p></div></div>' +
      '<label class="f">Dish / item name<input id="i-name" type="text" autofocus></label>' +
      '<div class="row2"><label class="f">Price<input id="i-price" type="number" min="0" step="0.01"></label>' +
      '<label class="f">Category<select id="i-cat">' + S.categories.map((c) => '<option value="' + c.id + '">' + U.esc(c.name) + '</option>').join('') +
      '</select></label></div>' +
      '<label class="chk"><input type="checkbox" id="i-kitchen"> Send to the kitchen (food/drinks that need preparing)</label>' +
      '<label class="chk"><input type="checkbox" id="i-out"> Out of stock right now (cannot be ordered)</label>' +
      '<label class="chk"><input type="checkbox" id="i-active"> Show on the Sell screen</label></div>');
    const f = (id) => U.$('#' + id, body);
    f('i-name').value = it.name;
    f('i-price').value = it.price;
    f('i-cat').value = it.categoryId;
    f('i-kitchen').checked = !!it.kitchen;
    f('i-out').checked = !!it.soldOut;
    f('i-active').checked = it.active !== false;
    const drawPhoto = () => { f('i-photo').innerHTML = it.photo ? '<img src="' + it.photo + '">' : '<span class="muted small">No photo</span>'; };
    drawPhoto();
    f('i-nophoto').onclick = () => { it.photo = ''; drawPhoto(); };
    f('i-file').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { it.photo = await U.resizeImage(file, 300, true); drawPhoto(); } catch (err) { U.toast(err.message, 'error'); }
      e.target.value = '';
    };
    const buttons = [];
    if (!isNew) {
      buttons.push({
        label: 'Delete', cls: 'danger', onClick: async () => {
          if (!(await U.confirm('Delete "' + it.name + '"? Past sales keep their records. Tip: untick "Show on the Sell screen" to hide it instead.', 'Delete', true))) return false;
          await POS.db.del('items', it.id);
          S.items = S.items.filter((x) => x.id !== it.id);
          draw();
        }
      });
    }
    buttons.push({ label: 'Cancel' }, {
      id: 'i-ok', label: isNew ? 'Add Item' : 'Save', cls: 'primary', onClick: async () => {
        const name = f('i-name').value.trim(), price = +f('i-price').value;
        if (!name) { U.toast('Enter the item name', 'error'); return false; }
        if (!(price >= 0) || f('i-price').value === '') { U.toast('Enter a valid price', 'error'); return false; }
        it.name = name;
        it.price = U.r2(price);
        it.categoryId = f('i-cat').value;
        it.kitchen = f('i-kitchen').checked;
        it.active = f('i-active').checked;
        const out = f('i-out').checked;
        const changed = !!it.soldOut !== out;
        const idx = S.items.findIndex((x) => x.id === it.id);
        if (idx >= 0) S.items[idx] = it; else S.items.push(it);
        if (changed && !isNew) await POS.setSoldOut(it, out);
        else { it.soldOut = out; await POS.db.put('items', it); }
        U.toast(isNew ? it.name + ' added' : 'Saved', 'ok');
        draw();
      }
    });
    U.modal({ title: isNew ? 'Add Item' : 'Edit Item', body: body, buttons: buttons, enterButton: 'i-ok' });
  }

  // Older versions logged counted stock (delta/after); newer ones log in/out of stock
  const stockChange = (r) => ('out' in r ? (r.out ? '<span class="neg"><b>Marked out of stock</b></span>' : '<span class="pos"><b>Back in stock</b></span>') :
    (r.delta > 0 ? '+' : '') + r.delta + ' (count ' + r.after + ') ' + U.esc(r.reason || ''));

  async function stockLog() {
    const rows = (await POS.db.all('stocklog')).sort((a, b) => b.ts - a.ts).slice(0, 300);
    U.modal({
      title: 'Stock History (latest 300)', cls: 'wide',
      body: rows.length ? '<table class="tbl"><thead><tr><th>When</th><th>Item</th><th>Change</th><th>By</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td>' + U.fmtDT(r.ts) + '</td><td>' + U.esc(r.name) + '</td><td>' + stockChange(r) + '</td><td>' + U.esc(r.user) + '</td></tr>').join('') +
        '</tbody></table>' : '<p class="muted">No stock changes yet.</p>',
      buttons: [{ label: 'Close', cls: 'primary' }]
    });
  }
})(window.POS);
