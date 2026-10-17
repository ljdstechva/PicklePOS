/* PicklePOS - shared helpers (no external libraries, works offline) */
window.POS = window.POS || {};
(function (POS) {
  'use strict';
  const U = POS.util = {};
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.r2 = (n) => Math.round((+n || 0) * 100 + (n < 0 ? -1e-9 : 1e-9)) / 100;
  U.copy = (o) => JSON.parse(JSON.stringify(o));

  U.num = function (n) {
    const v = Math.abs(U.r2(n));
    const parts = v.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (U.r2(n) < 0 ? '-' : '') + parts.join('.');
  };
  U.money = function (n) {
    const cur = (POS.state && POS.state.settings && POS.state.settings.currency) || '₱';
    return (U.r2(n) < 0 ? '-' : '') + cur + U.num(Math.abs(n));
  };

  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  U.h = function (html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  };

  U.pad = (n) => (n < 10 ? '0' : '') + n;
  U.dayKey = function (ts) {
    const d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };
  U.fmtTime = function (ts) {
    const d = new Date(ts);
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + U.pad(d.getMinutes()) + ' ' + ap;
  };
  U.fmtDate = function (ts) {
    const d = new Date(ts);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  };
  U.fmtDayKey = function (key) {
    const p = key.split('-');
    return U.fmtDate(new Date(+p[0], +p[1] - 1, +p[2]).getTime());
  };
  U.fmtDT = (ts) => U.fmtDate(ts) + ' ' + U.fmtTime(ts);
  U.fmtDur = function (min) {
    min = Math.round(min);
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + 'h ' : '') + m + 'm';
  };
  U.fmtClock = function (ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    return h + ':' + U.pad(Math.floor(s / 60)) + ':' + U.pad(s % 60);
  };
  // "HH:MM" for <input type="time">
  U.timeInput = function (ts) {
    const d = new Date(ts);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };
  // Turn an "HH:MM" value into the timestamp closest to refTs (within 12 hours either side),
  // so 11:20 PM typed just after midnight means last night, not tonight.
  U.fromTimeInput = function (val, refTs) {
    const p = String(val).split(':');
    const ref = refTs || Date.now();
    const d = new Date(ref);
    d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
    let t = d.getTime();
    if (t - ref > 12 * 3600e3) t -= 24 * 3600e3;
    else if (ref - t > 12 * 3600e3) t += 24 * 3600e3;
    return t;
  };

  // Light PIN hashing. Not cryptographic - it just keeps PINs out of plain sight.
  U.hash = function (s) {
    let h = 0x811c9dc5;
    s = 'pkl$' + s + '$pos';
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  };

  U.initials = function (name) {
    const w = String(name || '?').replace(/[^A-Za-z0-9À-ɏ\s]/g, ' ').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  };
  const COLORS = ['#2f7d4f', '#b5651d', '#3a6ea5', '#8e44ad', '#c0392b', '#16808a', '#7a8f1c', '#a0522d'];
  U.colorFor = function (s) {
    let h = 0;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  };

  /* ---------- Toasts ---------- */
  // opts: { action: 'Undo', onAction: fn } adds a button to the toast
  U.toast = function (msg, type, opts) {
    opts = opts || {};
    const t = U.h('<div class="toast ' + (type || '') + '"><span></span></div>');
    t.firstChild.textContent = msg;
    let timer;
    const hide = () => {
      clearTimeout(timer);
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    };
    if (opts.action) {
      const b = U.h('<button class="toast-btn"></button>');
      b.textContent = opts.action;
      b.onclick = () => { hide(); opts.onAction(); };
      t.appendChild(b);
      t.classList.add('has-action');
    }
    const box = document.getElementById('toasts');
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    if (type === 'error' && POS.sound) POS.sound('error');
    timer = setTimeout(hide, opts.action ? 6000 : type === 'error' || type === 'warn' ? 4500 : 2500);
  };

  // Animate a number from its current value (or 0) up to "to"
  U.countUp = function (el, to, fmt, ms) {
    fmt = fmt || U.money;
    if (!POS.anim || !POS.anim() || !window.requestAnimationFrame) { el.textContent = fmt(to); return; }
    const start = performance.now(), dur = ms || 500;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ---------- Modals (in-app, never browser dialogs) ---------- */
  // The modal currently on top (ignores ones playing their closing animation)
  U.topModal = function () {
    const list = U.$$('#modals > .modal-back:not(.closing)');
    return list.length ? list[list.length - 1] : null;
  };

  U.modal = function (o) {
    const root = document.getElementById('modals');
    const wrap = U.h('<div class="modal-back"><div class="modal ' + (o.cls || '') + '">' +
      '<div class="modal-head"><h3></h3><button class="x" title="Close">&times;</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div></div>');
    U.$('h3', wrap).textContent = o.title || '';
    const body = U.$('.modal-body', wrap);
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);
    const foot = U.$('.modal-foot', wrap);
    let closed = false;
    const api = { el: wrap, body: body, foot: foot, close: close };

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      const remove = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
      if (POS.anim && POS.anim()) {
        wrap.classList.add('closing');
        setTimeout(remove, 140);
      } else remove();
      if (o.onClose) o.onClose();
    }
    function onKey(e) {
      if (U.topModal() !== wrap) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && o.enterButton && e.target.tagName !== 'TEXTAREA') {
        const b = U.$('#' + o.enterButton, wrap);
        if (b && !b.disabled) { e.preventDefault(); b.click(); }
      }
    }
    api.setButtons = function (buttons) {
      foot.innerHTML = '';
      (buttons || []).forEach((b) => {
        const btn = U.h('<button class="btn ' + (b.cls || '') + '"></button>');
        btn.textContent = b.label;
        if (b.id) btn.id = b.id;
        btn.onclick = function () {
          const r = b.onClick ? b.onClick(api) : undefined;
          if (r && typeof r.then === 'function') {
            btn.disabled = true;
            btn.classList.add('busy');
            const idle = () => { btn.disabled = false; btn.classList.remove('busy'); };
            r.then((v) => { idle(); if (v !== false) close(); },
              (err) => { idle(); U.toast(err.message || String(err), 'error'); });
          } else if (r !== false) close();
        };
        foot.appendChild(btn);
      });
      foot.style.display = buttons && buttons.length ? '' : 'none';
    };
    api.setButtons(o.buttons);
    U.$('.x', wrap).onclick = close;
    document.addEventListener('keydown', onKey, true);
    root.appendChild(wrap);
    if (o.onOpen) o.onOpen(api);
    const f = U.$('[autofocus]', wrap);
    if (f) { f.focus(); if (f.select) f.select(); }
    return api;
  };

  U.confirm = function (msg, okLabel, danger) {
    return new Promise((res) => {
      let ok = false;
      const p = document.createElement('p');
      p.textContent = msg;
      U.modal({
        title: 'Please confirm', body: p, cls: 'small', enterButton: 'cf-ok',
        buttons: [{ label: 'Cancel' },
          { id: 'cf-ok', label: okLabel || 'OK', cls: danger ? 'danger' : 'primary', onClick: () => { ok = true; } }],
        onClose: () => res(ok)
      });
    });
  };

  // Ask for a single line of text. Resolves to the string, or null if cancelled.
  U.ask = function (title, label, value, opts) {
    opts = opts || {};
    return new Promise((res) => {
      let out = null;
      const body = U.h('<div><label class="f"><span></span><input type="text" autofocus></label></div>');
      U.$('span', body).textContent = label;
      const inp = U.$('input', body);
      inp.value = value || '';
      if (opts.placeholder) inp.placeholder = opts.placeholder;
      U.modal({
        title: title, body: body, cls: 'small', enterButton: 'ask-ok',
        buttons: [{ label: 'Cancel' }, {
          id: 'ask-ok', label: opts.okLabel || 'OK', cls: 'primary', onClick: () => {
            const v = inp.value.trim();
            if (opts.required && !v) { U.toast(label + ' is required', 'error'); inp.focus(); return false; }
            out = v;
          }
        }],
        onClose: () => res(out)
      });
    });
  };

  U.download = function (name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };

  U.readFile = function (file, asText) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      if (asText) fr.readAsText(file); else fr.readAsDataURL(file);
    });
  };

  // Shrinks a photo so the database stays small and the laptop stays fast.
  // square=true crops to a square (menu photos); otherwise keeps the aspect (receipt logo).
  U.resizeImage = function (file, size, square, gray) {
    return U.readFile(file).then((src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = function () {
        let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
        if (square) {
          const s = Math.min(sw, sh);
          sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
          w = h = size;
        } else {
          const k = Math.min(1, size / sw);
          w = Math.round(sw * k); h = Math.round(sh * k);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        if (gray) {
          const d = ctx.getImageData(0, 0, w, h), p = d.data;
          for (let i = 0; i < p.length; i += 4) {
            const g = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
            p[i] = p[i + 1] = p[i + 2] = g;
          }
          ctx.putImageData(d, 0, 0);
          res(c.toDataURL('image/png'));
        } else res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => rej(new Error('That file is not a picture the browser can read.'));
      img.src = src;
    }));
  };

  // Square app icon from a logo: the whole logo fits inside (no cropping), transparent corners kept.
  U.iconImage = function (file, size) {
    return U.readFile(file).then((src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = function () {
        const k = Math.min(size / img.width, size / img.height);
        const w = Math.round(img.width * k), h = Math.round(img.height * k);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => rej(new Error('That file is not a picture the browser can read.'));
      img.src = src;
    }));
  };

  U.csv = function (rows) {
    return rows.map((r) => r.map((v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  };
})(window.POS);
