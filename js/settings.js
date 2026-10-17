/* PicklePOS - Settings: business, receipt, courts, printing, staff, backup */
(function (POS) {
  'use strict';
  const U = POS.util, P = POS.print, S = POS.state;
  let el = null;

  POS.views.settings = {
    render: function (root) {
      el = U.h('<div class="page"><div class="page-head"><h2>Settings</h2></div><div class="settings-grid">' +
        section('Business &amp; Receipt', 'biz') + section('Courts &amp; Rates', 'courts') +
        section('Printer', 'print') + section('Payments &amp; Tax', 'pay') +
        (POS.isOwner() ? section('Staff &amp; PINs', 'users') : '') + section('Display &amp; Sounds', 'display') +
        (POS.isOwner() ? section('Backup &amp; Restore', 'backup') : '') + section('About &amp; Updates', 'about') + '</div></div>');
      root.appendChild(el);
      drawBiz(); drawCourts(); drawPrint(); drawPay(); drawDisplay(); drawAbout();
      if (POS.isOwner()) { drawUsers(); drawBackup(); }
    },
    refresh: function () { if (el) drawAbout(); },
    destroy: function () { el = null; }
  };

  const section = (title, id) => '<div class="card"><h3 class="section-title">' + title + '</h3><div id="st-' + id + '"></div></div>';
  const field = (label, id, type, extra) => '<label class="f">' + label + '<input id="' + id + '" type="' + (type || 'text') + '"' + (extra || '') + '></label>';
  const f = (id) => U.$('#' + id, el);

  async function save(msg) {
    await POS.saveSettings();
    U.toast(msg || 'Settings saved', 'ok');
  }

  /* ---------- business & receipt ---------- */
  function drawBiz() {
    const s = S.settings;
    f('st-biz').innerHTML = field('Business name', 'b-name') + field('Second line (e.g. Courts &amp; Cafe)', 'b-line2') +
      field('Address', 'b-addr') + field('Contact no. / Facebook page', 'b-contact') + field('TIN (optional)', 'b-tin') +
      field('Receipt title', 'b-title') + field('Note under total', 'b-note') + field('Footer message', 'b-footer') +
      '<div class="f-label">Business logo &ndash; the app icon, and printed in black &amp; white on receipts</div><div class="photo-pick"><div class="photo-box" id="b-logo"></div>' +
      '<div><label class="btn sm">Choose Logo<input type="file" id="b-logo-file" accept="image/*" class="hidden"></label> ' +
      '<button class="btn sm" id="b-logo-del">Remove</button></div></div>' +
      '<p class="muted small">This POS is not BIR-accredited, so the receipt is an Acknowledgement Receipt. Issue BIR official receipts/invoices separately when required.</p>' +
      '<button class="btn primary" id="b-save">Save</button>';
    const map = { 'b-name': 'bizName', 'b-line2': 'bizLine2', 'b-addr': 'address', 'b-contact': 'contact', 'b-tin': 'tin', 'b-title': 'receiptTitle', 'b-note': 'receiptNote', 'b-footer': 'footer' };
    Object.keys(map).forEach((k) => { f(k).value = s[map[k]] || ''; });
    const drawLogo = () => {
      f('b-logo').innerHTML = s.appLogo || s.logo ? '<img src="' + (s.appLogo || s.logo) + '" style="object-fit:contain">' : '<span class="muted small">No logo</span>';
      const rail = U.$('#rail-biz');
      if (rail) { rail.innerHTML = POS.logoHTML(); rail.classList.toggle('has-img', !!s.appLogo); }
    };
    drawLogo();
    f('b-logo-file').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { await POS.setLogo(file); drawLogo(); U.toast('Logo saved. It is now the app icon too.', 'ok'); } catch (err) { U.toast(err.message, 'error'); }
      e.target.value = '';
    };
    f('b-logo-del').onclick = async () => { s.logo = ''; s.appLogo = ''; POS.applyBrand(); drawLogo(); await save('Logo removed'); };
    f('b-save').onclick = async () => {
      if (!f('b-name').value.trim()) return U.toast('Business name is required', 'error');
      Object.keys(map).forEach((k) => { s[map[k]] = f(k).value.trim(); });
      await save();
      POS.applyBrand();
      const b = U.$('#rail-biz');
      if (b) b.title = s.bizName;
    };
  }

  /* ---------- courts ---------- */
  function drawCourts() {
    const s = S.settings;
    f('st-courts').innerHTML = '<div id="c-list"></div><button class="btn sm" id="c-add">+ Add Court</button>' +
      '<div class="f-label" style="margin-top:14px">Timer billing rules</div><div class="row3">' +
      field('Minimum (minutes)', 'c-min', 'number', ' min="0" step="5"') + field('Then charge every (min)', 'c-inc', 'number', ' min="1" step="5"') +
      field('Grace period (min)', 'c-grace', 'number', ' min="0" step="1"') + '</div><p class="muted small" id="c-example"></p>' +
      '<button class="btn primary" id="c-save">Save</button>';
    let courts = U.copy(s.courts);
    function list() {
      f('c-list').innerHTML = courts.map((c, i) => '<div class="court-edit" data-i="' + i + '"><input type="text" data-k="name" placeholder="Court name">' +
        '<input type="number" data-k="rate" min="0" step="10" placeholder="Rate / hour"><span class="muted small">/hr</span>' +
        '<button class="icon" data-del="' + i + '" title="Remove">&times;</button></div>').join('');
      U.$$('.court-edit', f('c-list')).forEach((r) => {
        const c = courts[+r.getAttribute('data-i')];
        U.$('[data-k=name]', r).value = c.name;
        U.$('[data-k=rate]', r).value = c.rate;
        U.$('[data-k=name]', r).oninput = (e) => { c.name = e.target.value; };
        U.$('[data-k=rate]', r).oninput = (e) => { c.rate = +e.target.value; };
      });
      U.$$('[data-del]', f('c-list')).forEach((b) => {
        b.onclick = () => {
          const c = courts[+b.getAttribute('data-del')];
          if (POS.courtSession(c.id)) return U.toast(c.name + ' is in use right now', 'error');
          courts.splice(+b.getAttribute('data-del'), 1);
          list();
        };
      });
    }
    function example() {
      const r = { courtMin: +f('c-min').value, courtInc: +f('c-inc').value, courtGrace: +f('c-grace').value };
      const ex = [45, 64, 66, 95, 125].map((m) => m + 'm played → ' + U.fmtDur(POS.calc.billMinutes(m, r)));
      f('c-example').textContent = 'Example: ' + ex.join(', ');
    }
    list();
    f('c-min').value = s.courtMin;
    f('c-inc').value = s.courtInc;
    f('c-grace').value = s.courtGrace;
    ['c-min', 'c-inc', 'c-grace'].forEach((k) => { f(k).oninput = example; });
    example();
    f('c-add').onclick = () => { courts.push({ id: U.uid(), name: 'Court ' + (courts.length + 1), rate: courts.length ? courts[0].rate : 300 }); list(); };
    f('c-save').onclick = async () => {
      if (courts.some((c) => !c.name.trim() || !(c.rate >= 0))) return U.toast('Each court needs a name and a rate', 'error');
      if (!(+f('c-inc').value >= 1)) return U.toast('"Charge every" must be at least 1 minute', 'error');
      courts.forEach((c) => { c.name = c.name.trim(); });
      s.courts = courts;
      s.courtMin = Math.max(0, +f('c-min').value || 0);
      s.courtInc = Math.max(1, +f('c-inc').value || 1);
      s.courtGrace = Math.max(0, +f('c-grace').value || 0);
      courts = U.copy(s.courts);
      await save('Court settings saved. New rates apply to new court sessions.');
    };
  }

  /* ---------- printer ---------- */
  function drawPrint() {
    const s = S.settings;
    f('st-print').innerHTML = '<div class="row3"><label class="f">Paper width<select id="p-paper"><option value="58">58 mm</option>' +
      '<option value="80">80 mm</option></select></label>' + field('Font size (px)', 'p-font', 'number', ' min="9" max="18"') +
      field('Blank space after (lines)', 'p-feed', 'number', ' min="0" max="12"') + '</div>' +
      '<label class="chk"><input type="checkbox" id="p-auto"> Print receipt automatically after payment</label>' +
      '<label class="f">Kitchen orders (food &amp; drinks to prepare)<select id="p-kitchen">' +
      '<option value="screen">Show on the Kitchen screen (no printing) - recommended</option>' +
      '<option value="print">Print a kitchen slip</option><option value="both">Kitchen screen + print a slip</option>' +
      '<option value="off">Off</option></select></label>' +
      '<div class="toolbar"><button class="btn primary" id="p-save">Save</button><button class="btn" id="p-test">Print Test Receipt</button></div>' +
      '<p class="muted small">Printer: POS-5890U-L (58mm, USB/Bluetooth). Install its driver from www.cnfujun.com/d/50, set it as the ' +
      '<b>default printer</b>, and open the app with <b>Start POS.bat</b> so receipts print without a dialog. See SETUP GUIDE.txt.</p>';
    f('p-paper').value = String(s.paper);
    f('p-font').value = s.fontSize;
    f('p-feed').value = s.feedLines;
    f('p-auto').checked = !!s.autoPrint;
    f('p-kitchen').value = s.kitchenMode || 'screen';
    const apply = () => {
      s.paper = +f('p-paper').value;
      s.fontSize = Math.min(18, Math.max(9, +f('p-font').value || 12));
      s.feedLines = Math.min(12, Math.max(0, +f('p-feed').value || 0));
      s.autoPrint = f('p-auto').checked;
      s.kitchenMode = f('p-kitchen').value;
    };
    f('p-save').onclick = async () => { apply(); await save(); };
    f('p-test').onclick = () => { apply(); P.test(); };
  }

  /* ---------- payments & tax ---------- */
  function drawPay() {
    const s = S.settings;
    const ALL = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Card'];
    const extra = s.payMethods.filter((m) => ALL.indexOf(m) < 0);
    f('st-pay').innerHTML = '<div class="f-label">Payment methods accepted</div>' +
      ALL.concat(extra).map((m) => '<label class="chk"><input type="checkbox" data-m="' + U.esc(m) + '"> ' + U.esc(m) + '</label>').join('') +
      '<label class="chk"><input type="checkbox" id="y-ref"> Require reference no. for non-cash payments</label>' +
      '<div class="row2">' + field('Currency symbol', 'y-cur') + '</div>' +
      '<label class="chk"><input type="checkbox" id="y-vat"> Business is VAT-registered (shows VAT breakdown, Senior/PWD VAT exemption)</label>' +
      '<button class="btn primary" id="y-save">Save</button>';
    U.$$('[data-m]', f('st-pay')).forEach((c) => { c.checked = s.payMethods.indexOf(c.getAttribute('data-m')) >= 0; });
    f('y-ref').checked = !!s.refRequired;
    f('y-cur').value = s.currency;
    f('y-vat').checked = !!s.vatRegistered;
    f('y-save').onclick = async () => {
      const methods = U.$$('[data-m]', f('st-pay')).filter((c) => c.checked).map((c) => c.getAttribute('data-m'));
      if (!methods.length) return U.toast('Select at least one payment method', 'error');
      s.payMethods = methods;
      s.refRequired = f('y-ref').checked;
      s.currency = f('y-cur').value.trim() || '₱';
      s.vatRegistered = f('y-vat').checked;
      await save();
    };
  }

  /* ---------- staff (owners only) ---------- */
  function drawUsers() {
    f('st-users').innerHTML = '<div class="staff-list">' + S.users.map((u) => '<div class="staff-row' + (u.active === false ? ' inactive' : '') + '">' +
      '<span class="avatar" style="background:' + U.colorFor(u.name) + '">' + U.esc(U.initials(u.name)) + '</span><span><b>' + U.esc(u.name) + '</b>' +
      (u.active === false ? ' <span class="tag void">Disabled</span>' : '') + '<small>' + POS.roleLabel(u) + ' &middot; ' + POS.accessSummary(u) + '</small></span>' +
      '<button class="btn sm" data-u="' + u.id + '">Edit</button></div>').join('') + '</div>' +
      '<button class="btn sm" id="u-add">+ Add Employee</button><p class="muted small">Each person logs in with their own PIN. ' +
      '<b>Standard</b> employees can take orders, open tabs, use the Kitchen screen and mark items out of stock. ' +
      'Press Edit to choose exactly what each employee can use. Anything not allowed asks for an owner PIN.</p>';
    U.$$('[data-u]', f('st-users')).forEach((b) => {
      b.onclick = () => POS.userModal(S.users.find((u) => u.id === b.getAttribute('data-u')), (u) => {
        drawUsers();
        if (S.user.id === u.id) POS.renderShell(), POS.go('settings');
      });
    });
    f('u-add').onclick = () => POS.userModal(null, drawUsers);
  }

  /* ---------- display & sounds ---------- */
  function drawDisplay() {
    const s = S.settings;
    f('st-display').innerHTML =
      '<label class="chk switch"><input type="checkbox" id="d-anim"><span class="sw"></span> Animations <span class="muted small">(turn off if the laptop feels slow)</span></label>' +
      '<label class="chk switch"><input type="checkbox" id="d-snd"><span class="sw"></span> Sounds <span class="muted small">(item added, sale complete, court time alerts)</span></label>' +
      '<div class="row2"><label class="f">Lock the POS automatically after<select id="d-lock">' +
      [[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']].map((x) =>
        '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>' +
      '<div class="f"><span class="f-label">&nbsp;</span><button class="btn" id="d-try">Play test sound</button></div></div>' +
      '<p class="muted small">Locking keeps the order on screen; the next person just logs in with their PIN.<br>' +
      'Keyboard shortcuts on the Sell screen: <kbd>F2</kbd> search, <kbd>F4</kbd> court time, <kbd>F8</kbd> save tab, <kbd>F9</kbd> pay, ' +
      '<kbd>Enter</kbd> confirm, <kbd>Esc</kbd> close.</p>';
    f('d-anim').checked = s.anim !== false;
    f('d-snd').checked = !!s.sounds;
    f('d-lock').value = String(s.autoLock || 0);
    f('d-anim').onchange = async () => { s.anim = f('d-anim').checked; POS.applyDisplay(); await save(s.anim ? 'Animations on' : 'Animations off'); };
    f('d-snd').onchange = async () => { s.sounds = f('d-snd').checked; if (s.sounds) POS.sound('ok'); await save(s.sounds ? 'Sounds on' : 'Sounds off'); };
    f('d-lock').onchange = async () => { s.autoLock = +f('d-lock').value; await save(); };
    f('d-try').onclick = () => {
      if (!s.sounds) return U.toast('Turn on Sounds first', 'warn');
      POS.sound('alert');
    };
  }

  /* ---------- about & updates ---------- */
  function drawAbout() {
    const box = f('st-about');
    if (!box) return;
    const u = POS.updateInfo();
    box.innerHTML = '<p>PicklePOS version <b>' + U.esc(POS.version) + '</b></p><div class="update-box ' + u.cls + '">' + u.html + '</div>' +
      '<div class="toolbar"><button class="btn" id="a-check"' + (u.launcher ? '' : ' disabled') + '>Check for Updates Now</button>' +
      (u.ready ? '<button class="btn primary" id="a-restart">Restart to Update</button>' : '') + '</div>' +
      '<p class="muted small">When the laptop has internet, PicklePOS checks for a new version every few hours and downloads it in the background. ' +
      'It is installed the next time the app restarts. Your sales, menu and settings are kept.</p>';
    if (U.$('#a-check', box)) U.$('#a-check', box).onclick = () => { POS.checkUpdates(); U.toast('Checking for updates...', ''); };
    if (U.$('#a-restart', box)) U.$('#a-restart', box).onclick = () => POS.restartForUpdate();
  }

  /* ---------- backup ---------- */
  function drawBackup() {
    const s = S.settings;
    f('st-backup').innerHTML = '<p>Last backup: <b>' + (s.lastBackup ? U.fmtDT(s.lastBackup) : 'never') + '</b></p>' +
      '<p class="muted small">All sales, menu items, photos and settings are saved on this laptop. Download a backup every day ' +
      '(Reports &rarr; Close Day does this automatically) and copy it to a USB drive or Google Drive now and then.</p>' +
      '<div class="toolbar"><button class="btn primary" id="k-backup">Download Backup</button>' +
      '<label class="btn">Restore from Backup<input type="file" id="k-file" accept=".json,application/json" class="hidden"></label></div>' +
      '<p class="muted small" id="k-usage"></p>';
    f('k-backup').onclick = async () => { await POS.backup(); drawBackup(); };
    f('k-file').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let j;
      try { j = JSON.parse(await U.readFile(file, true)); } catch (err) { return U.toast('That file is not a PicklePOS backup', 'error'); }
      if (!j || j.app !== 'PicklePOS' || !j.data) return U.toast('That file is not a PicklePOS backup', 'error');
      const n = (j.data.orders || []).length;
      if (!(await U.confirm('Replace ALL current data with the backup from ' + U.fmtDT(j.exportedAt) + ' (' + n + ' orders)? This cannot be undone.', 'Restore', true))) return;
      await POS.db.restore(j.data);
      await POS.loadAll();
      U.toast('Backup restored. Please log in again.', 'ok');
      POS.cart = null;
      POS.showLogin();
    };
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        const box = f('k-usage');
        if (box) box.textContent = 'Storage used: ' + (est.usage / 1048576).toFixed(1) + ' MB';
      }).catch(() => {});
    }
  }
})(window.POS);
