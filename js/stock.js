/* PicklePOS - Stock screen: tap an item to mark it out of stock (or back in stock) */
(function (POS) {
  'use strict';
  const U = POS.util, S = POS.state;
  let el = null, search = '', outOnly = false;

  POS.views.stock = {
    render: function (root) {
      el = U.h('<div class="page"><div class="page-head"><h2>Stock</h2><span class="k-counts" id="sk-counts"></span>' +
        '<label class="chk"><input type="checkbox" id="sk-out"> Out of stock only</label>' +
        '<button class="btn" id="sk-all">All Back in Stock</button></div>' +
        '<div class="search-wrap sk-search"><svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input type="text" class="search" id="sk-q" placeholder="Search items..."></div>' +
        '<p class="muted small">Tap an item when it runs out. It shows <b>Out of stock</b> on the Sell screen and cannot be ordered until you tap it again.</p>' +
        '<div class="stock-grid" id="sk-grid"></div></div>');
      root.appendChild(el);
      const q = U.$('#sk-q', el);
      q.value = search;
      q.oninput = () => { search = q.value; draw(); };
      U.$('#sk-out', el).checked = outOnly;
      U.$('#sk-out', el).onchange = (e) => { outOnly = e.target.checked; draw(); };
      U.$('#sk-all', el).onclick = allBack;
      U.$('#sk-grid', el).onclick = async (e) => {
        const c = e.target.closest('[data-id]');
        if (!c) return;
        e.preventDefault();
        const item = POS.itemById(c.getAttribute('data-id'));
        await POS.toggleSoldOut(item);
        draw();
      };
      draw();
    },
    refresh: function () { if (el) draw(); },
    destroy: function () { el = null; }
  };

  function draw() {
    const order = {};
    S.categories.forEach((c, i) => { order[c.id] = i; });
    const all = S.items.filter((i) => i.active !== false);
    const out = all.filter((i) => i.soldOut).length;
    U.$('#sk-counts', el).innerHTML = '<span class="k-count ready"><b>' + (all.length - out) + '</b> in stock</span>' +
      '<span class="k-count out"><b>' + out + '</b> out</span>';
    U.$('#sk-all', el).disabled = !out;
    const qq = search.trim().toLowerCase();
    const list = all.filter((i) => (!outOnly || i.soldOut) && (!qq || i.name.toLowerCase().indexOf(qq) >= 0))
      .sort((a, b) => (order[a.categoryId] - order[b.categoryId]) || a.name.localeCompare(b.name));
    U.$('#sk-grid', el).innerHTML = list.length ? list.map((i) => {
      const cat = POS.catById(i.categoryId);
      return '<div class="stock-card' + (i.soldOut ? ' is-out' : '') + '" data-id="' + i.id + '"><div class="ph sc-ph">' + POS.photoHTML(i) + '</div>' +
        '<div class="sc-main"><b>' + U.esc(i.name) + '</b><small>' + U.esc(cat ? cat.name : '') + '</small>' + POS.stockSwitch(i) + '</div></div>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">' + (outOnly ? 'Everything is in stock.' : 'No items found.') + '</div>';
  }

  async function allBack() {
    const out = S.items.filter((i) => i.soldOut);
    if (!out.length || !(await U.confirm('Mark all ' + out.length + ' out-of-stock items as back in stock?', 'All Back in Stock'))) return;
    for (const i of out) await POS.setSoldOut(i, false);
    U.toast('All items are back in stock', 'ok');
    draw();
  }
})(window.POS);
