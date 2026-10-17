/* PicklePOS - staff accounts and what each employee is allowed to do */
(function (POS) {
  'use strict';
  const U = POS.util, S = POS.state;

  // Screens (match the side bar) and extra actions an owner can allow per employee
  POS.PERMS = [
    { k: 'sell', label: 'Take orders', hint: 'Sell screen' },
    { k: 'tabs', label: 'Open tabs', hint: 'order now, pay later' },
    { k: 'kitchen', label: 'Kitchen screen' },
    { k: 'stock', label: 'Stock', hint: 'mark items out of stock' },
    { k: 'courts', label: 'Courts', hint: 'timers & bookings' },
    { k: 'history', label: 'Sales history', hint: 'reprint receipts' },
    { k: 'reports', label: 'Reports', hint: 'sales totals, Z-reading' },
    { k: 'menu', label: 'Menu', hint: 'add/edit items & prices' },
    { k: 'settings', label: 'Settings', hint: 'printer, courts, payments' }
  ];
  POS.ACTION_PERMS = [
    { k: 'void', label: 'Void sales & tabs' },
    { k: 'discount', label: 'Give custom discounts' },
    { k: 'courtEdit', label: 'Change or remove court time' },
    { k: 'price', label: 'Change prices on an order' }
  ];
  // Standard employee: normal orders and stock only
  POS.STANDARD_PERMS = ['sell', 'tabs', 'kitchen', 'stock'];
  // Cashiers created before access settings existed keep what they could do then
  const LEGACY_CASHIER = ['sell', 'tabs', 'kitchen', 'courts', 'history', 'stock'];

  POS.permsOf = (u) => (u.perms || LEGACY_CASHIER);
  POS.can = function (k) {
    const u = S.user;
    if (!u) return false;
    return u.role === 'owner' || POS.permsOf(u).indexOf(k) >= 0;
  };
  POS.roleLabel = (u) => (u.role === 'owner' ? 'Owner' : 'Employee');
  POS.accessSummary = function (u) {
    if (u.role === 'owner') return 'Full access';
    const p = POS.permsOf(u);
    if (p.length === POS.STANDARD_PERMS.length && POS.STANDARD_PERMS.every((k) => p.indexOf(k) >= 0)) return 'Standard (orders &amp; stock)';
    return POS.PERMS.concat(POS.ACTION_PERMS).filter((x) => p.indexOf(x.k) >= 0).map((x) => x.label).join(', ') || 'No access';
  };

  // Name + PIN + role + access checkboxes. Used by first-time setup and Settings.
  // Returns an element with .read() -> user object, or null after showing what's wrong.
  POS.userForm = function (user, opts) {
    opts = opts || {};
    const isNew = !user;
    const u = user ? U.copy(user) : { id: U.uid(), name: '', role: 'staff', pin: '', active: true, perms: POS.STANDARD_PERMS.slice() };
    if (u.role === 'cashier') u.role = 'staff';
    const perms = POS.permsOf(u).slice();
    const box = (x) => '<label class="perm"><input type="checkbox" data-p="' + x.k + '"' + (perms.indexOf(x.k) >= 0 ? ' checked' : '') + '><span><b>' +
      x.label + '</b>' + (x.hint ? '<small>' + x.hint + '</small>' : '') + '</span></label>';
    const el = U.h('<div class="user-form"><label class="f">Name<input data-f="name" type="text" placeholder="e.g. Ana"></label>' +
      (opts.noRole ? '' : '<label class="f">Role<select data-f="role"><option value="staff">Employee</option><option value="owner">Owner (full access)</option></select></label>') +
      '<div class="row2"><label class="f">' + (isNew ? 'PIN (4-6 digits)' : 'New PIN (leave blank to keep)') +
      '<input data-f="pin" type="password" inputmode="numeric" maxlength="6"></label>' +
      '<label class="f">Repeat PIN<input data-f="pin2" type="password" inputmode="numeric" maxlength="6"></label></div>' +
      '<div class="perm-wrap" data-f="perms"><div class="perm-head"><span class="f-label">What can this employee use?</span>' +
      '<span><button type="button" class="btn sm" data-preset="std">Standard</button> <button type="button" class="btn sm" data-preset="all">Everything</button></span></div>' +
      '<div class="perm-grid">' + POS.PERMS.map(box).join('') + '</div>' +
      '<div class="f-label" style="margin-top:10px">Without asking for the owner PIN</div><div class="perm-grid">' + POS.ACTION_PERMS.map(box).join('') + '</div>' +
      '<p class="muted small">Staff accounts and backups in Settings are always for owners only.</p></div>' +
      (opts.noActive ? '' : '<label class="chk"><input type="checkbox" data-f="active"> Can log in</label>') + '</div>');
    const f = (k) => U.$('[data-f="' + k + '"]', el);
    f('name').value = u.name;
    if (f('role')) f('role').value = u.role;
    if (f('active')) f('active').checked = u.active !== false;
    const drawRole = () => f('perms').classList.toggle('hidden', !!f('role') && f('role').value === 'owner');
    if (f('role')) f('role').onchange = drawRole;
    drawRole();
    U.$$('[data-preset]', el).forEach((b) => {
      b.onclick = () => {
        const all = b.getAttribute('data-preset') === 'all';
        U.$$('[data-p]', el).forEach((c) => { c.checked = all || POS.STANDARD_PERMS.indexOf(c.getAttribute('data-p')) >= 0; });
      };
    });
    el.focusName = () => f('name').focus();
    el.read = function () {
      const name = f('name').value.trim(), pin = f('pin').value.trim(), pin2 = f('pin2').value.trim();
      const role = f('role') ? f('role').value : 'staff';
      const active = f('active') ? f('active').checked : true;
      if (!name) { U.toast('Enter a name', 'error'); f('name').focus(); return null; }
      if (isNew || pin) {
        if (!/^\d{4,6}$/.test(pin)) { U.toast('PIN must be 4 to 6 digits', 'error'); f('pin').focus(); return null; }
        if (pin !== pin2) { U.toast('The two PINs do not match', 'error'); f('pin2').focus(); return null; }
        if (S.users.some((x) => x.id !== u.id && x.pin === U.hash(pin))) { U.toast('Someone else already uses that PIN', 'error'); return null; }
        u.pin = U.hash(pin);
      }
      const chosen = U.$$('[data-p]', el).filter((c) => c.checked).map((c) => c.getAttribute('data-p'));
      if (role !== 'owner' && !chosen.some((k) => POS.PERMS.some((x) => x.k === k))) { U.toast('Tick at least one screen this employee can use', 'error'); return null; }
      const owners = S.users.filter((x) => x.role === 'owner' && x.active !== false && x.id !== u.id);
      if (!isNew && !owners.length && (role !== 'owner' || !active)) { U.toast('There must be at least one active owner', 'error'); return null; }
      u.name = name;
      u.role = role;
      u.active = active;
      u.perms = role === 'owner' ? [] : chosen;
      return u;
    };
    return el;
  };

  POS.saveUser = async function (u) {
    await POS.db.put('users', u);
    const i = S.users.findIndex((x) => x.id === u.id);
    if (i >= 0) S.users[i] = u; else S.users.push(u);
    if (S.user && S.user.id === u.id) S.user = u;
  };

  POS.userModal = function (user, onSaved) {
    const form = POS.userForm(user);
    U.modal({
      title: user ? 'Edit ' + user.name : 'Add Employee', body: form, enterButton: 'u-ok',
      buttons: [{ label: 'Cancel' }, {
        id: 'u-ok', label: 'Save', cls: 'primary', onClick: async () => {
          const u = form.read();
          if (!u) return false;
          await POS.saveUser(u);
          U.toast(u.name + ' saved', 'ok');
          if (onSaved) onSaved(u);
        }
      }]
    });
    setTimeout(form.focusName, 50);
  };
})(window.POS);
