/* PicklePOS - Facebook Messenger inside the POS.
   Two ways, chosen in Settings > Messenger:
   1. Page inbox (connected): the Messenger tab is a real inbox for the business's Facebook Page, drawn by
      PicklePOS itself through the Facebook Graph API - chats on the left, the conversation on the right,
      replies and photos. The laptop asks Facebook every few seconds; no server is needed. Connecting is
      one press on "Connect Facebook Page" (Settings): a small web page does the Facebook sign-in and
      hands the result back through the launcher (fb-connect.js), or the code is pasted by hand.
   2. messenger.com window: Facebook does not allow its site inside another page, so the tab area is
      covered by a real messenger.com window that the launcher snaps in place. No setup needed.
   The nav badge shows unread chats either way. */
(function (POS) {
  'use strict';
  const U = POS.util;
  const M = POS.messenger = {};
  const GRAPH = 'https://graph.facebook.com/v21.0/';
  M.DEFAULT_URL = 'https://www.messenger.com/';
  M.DEFAULT_CONNECT = 'https://ljdstechva.github.io/PicklePOS/connect.html';
  let graph = { count: null, error: '', at: 0 };
  let win = null, shown = -1, lastGraph = 0, lastWin = 0, lastFb = 0;
  let el = null, winTab = false, dockTimer = null, connecting = null, usedToken = '';

  const S = () => POS.state.settings || {};
  M.url = () => ((S().msgUrl || M.DEFAULT_URL) + '').trim();
  M.connected = () => !!S().msgToken;
  // 'page' = the native Page inbox (needs a connected Page); 'window' = messenger.com window in the tab
  M.mode = () => (M.connected() && S().msgMode !== 'window' ? 'page' : 'window');
  const launcher = () => !!(POS.launcherPresent && POS.launcherPresent() && POS.signalLauncher);
  const stale = () => !!(POS.launcherStale && POS.launcherStale());
  M.open = function () { POS.go('messenger'); };

  /* ---------- Graph API ---------- */
  function fbError(j) { const e = new Error((j.error && j.error.message) || 'Facebook returned an error'); e.code = j.error && j.error.code; return e; }
  async function graphGet(path, token) {
    const url = GRAPH + path + (token ? (path.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(token) : '');
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (j.error) throw fbError(j);
    return j;
  }
  async function graphPost(path, token, body) {
    const r = await fetch(GRAPH + path + '?access_token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.error) throw fbError(j);
    return j;
  }
  function fbErr(e) {
    const m = e && e.message ? e.message : String(e);
    if (e && (e.code === 190 || /access token|session has expired/i.test(m))) return 'The Facebook connection has expired. Owner: Settings > Messenger > Connect Facebook Page.';
    return m;
  }
  // Number of conversations with unread messages (the 100 most recent chats are checked)
  M.unreadChats = async function (token) {
    const j = await graphGet('me/conversations?platform=messenger&fields=unread_count&limit=100', token);
    return (j.data || []).filter((c) => +c.unread_count > 0).length;
  };
  M.test = async function (token) {
    const me = await graphGet('me?fields=id,name', token);
    return { id: me.id, name: me.name, chats: await M.unreadChats(token) };
  };
  async function pollGraph() {
    const s = S();
    if (!s.msgToken) { graph = { count: null, error: '', at: 0 }; return; }
    if (!navigator.onLine) { graph = { count: graph.count, error: 'No internet', at: Date.now() }; return; }
    try { graph = { count: await M.unreadChats(s.msgToken), error: '', at: Date.now() }; }
    catch (e) { graph = { count: graph.count, error: fbErr(e), at: Date.now() }; }
  }

  /* ---------- the Page inbox (drawn by PicklePOS) ---------- */
  const inbox = { convs: [], sel: null, msgs: [], error: '', lastConvs: 0, lastMsgs: 0, sending: false, lastKey: '' };
  const when = (ts) => (Date.now() - ts < 86400000 ? U.fmtTime(ts) : U.fmtDate(ts));

  async function loadConvs() {
    const s = S();
    try {
      const j = await graphGet('me/conversations?platform=messenger&fields=id,participants,snippet,updated_time,unread_count,can_reply&limit=50', s.msgToken);
      inbox.convs = (j.data || []).map((c) => {
        const other = ((c.participants && c.participants.data) || []).find((p) => p.id !== s.msgPageId) || {};
        return { id: c.id, name: other.name || 'Customer', psid: other.id || '', snippet: c.snippet || '',
          updated: Date.parse(c.updated_time) || 0, unread: +c.unread_count || 0, canReply: c.can_reply !== false };
      });
      if (inbox.sel) { const again = inbox.convs.find((c) => c.id === inbox.sel.id); if (again) { again.unread = 0; inbox.sel = again; } }
      inbox.error = '';
      graph = { count: inbox.convs.filter((c) => c.unread > 0).length, error: '', at: Date.now() };
    } catch (e) { inbox.error = fbErr(e); graph = { count: graph.count, error: inbox.error, at: Date.now() }; }
    inbox.lastConvs = Date.now();
  }
  async function loadMsgs(conv) {
    const s = S();
    try {
      const j = await graphGet(conv.id + '/messages?fields=id,message,from,created_time,attachments{mime_type,name,file_url,image_data}&limit=40', s.msgToken);
      inbox.msgs = (j.data || []).map((m) => ({
        id: m.id, text: m.message || '', mine: !!(m.from && m.from.id === s.msgPageId), at: Date.parse(m.created_time) || 0,
        att: ((m.attachments && m.attachments.data) || []).map((a) => ({
          name: a.name || '', url: a.file_url || (a.image_data && (a.image_data.url || a.image_data.preview_url)) || '',
          img: !!a.image_data || /^image\//.test(a.mime_type || '')
        }))
      })).sort((a, b) => a.at - b.at);
      inbox.error = '';
    } catch (e) { inbox.error = fbErr(e); }
    inbox.lastMsgs = Date.now();
  }
  async function markSeen(conv) {
    if (!conv.psid) return;
    try { await graphPost('me/messages', S().msgToken, { recipient: { id: conv.psid }, sender_action: 'mark_seen' }); } catch (e) { /* not critical */ }
    conv.unread = 0;
    graph = { count: inbox.convs.filter((c) => c.unread > 0).length, error: '', at: Date.now() };
    renderList(); M.sync();
  }
  async function sendText(conv, text) {
    await graphPost('me/messages', S().msgToken, { recipient: { id: conv.psid }, messaging_type: 'RESPONSE', message: { text: text } });
  }

  const $ = (sel) => (el ? el.querySelector(sel) : null);
  function renderList() {
    const box = $('#mi-convs');
    if (!box) return;
    if (!inbox.convs.length) { box.innerHTML = '<div class="muted small mi-empty">' + (inbox.error ? U.esc(inbox.error) : 'No chats yet.') + '</div>'; return; }
    box.innerHTML = inbox.convs.map((c) => '<button class="mi-conv' + (inbox.sel && inbox.sel.id === c.id ? ' on' : '') + (c.unread ? ' unread' : '') + '" data-c="' + U.esc(c.id) + '">' +
      '<span class="avatar" style="background:' + U.colorFor(c.name) + '">' + U.esc(U.initials(c.name)) + '</span>' +
      '<span class="mi-c-main"><b>' + U.esc(c.name) + '</b><small>' + U.esc(c.snippet.substring(0, 70)) + '</small></span>' +
      '<span class="mi-c-side"><small>' + U.esc(when(c.updated)) + '</small>' + (c.unread ? '<span class="badge hot">' + c.unread + '</span>' : '') + '</span></button>').join('');
    U.$$('.mi-conv', box).forEach((b) => { b.onclick = () => selectConv(b.getAttribute('data-c')); });
  }
  function renderMsgs() {
    const box = $('#mi-msgs'), who = $('#mi-who'), note = $('#mi-note'), inp = $('#mi-text');
    if (!box) return;
    if (note) note.textContent = inbox.error || '';
    if (!inbox.sel) { who.innerHTML = 'Select a chat'; box.innerHTML = '<div class="muted small mi-empty">Messages show here.</div>'; if (inp) inp.disabled = true; return; }
    who.innerHTML = '<b>' + U.esc(inbox.sel.name) + '</b>' + (inbox.sel.canReply ? '' : ' <span class="muted small">(replies are not allowed: more than 24 hours since their last message)</span>');
    box.innerHTML = inbox.msgs.map((m) => '<div class="mi-msg' + (m.mine ? ' mine' : '') + '">' +
      (m.text ? '<div class="mi-bubble">' + U.esc(m.text) + '</div>' : '') +
      m.att.map((a) => (a.img && a.url) ? '<a class="mi-bubble mi-img" href="' + U.esc(a.url) + '" target="_blank" rel="noopener"><img src="' + U.esc(a.url) + '" alt=""></a>' :
        a.url ? '<a class="mi-bubble" href="' + U.esc(a.url) + '" target="_blank" rel="noopener">' + U.esc(a.name || 'Attachment') + '</a>' : '<div class="mi-bubble muted">[attachment]</div>').join('') +
      '<small>' + U.esc(U.fmtDT(m.at)) + '</small></div>').join('') || '<div class="muted small mi-empty">No messages yet.</div>';
    box.scrollTop = box.scrollHeight;
    if (inp) inp.disabled = !inbox.sel.canReply;
    inbox.lastKey = inbox.msgs.length + ':' + (inbox.msgs.length ? inbox.msgs[inbox.msgs.length - 1].id : '');
  }
  async function selectConv(id) {
    const c = inbox.convs.find((x) => x.id === id);
    if (!c) return;
    inbox.sel = c; inbox.msgs = [];
    renderList(); renderMsgs();
    await loadMsgs(c);
    if (inbox.sel !== c) return;
    renderMsgs();
    if (c.unread) markSeen(c);
    const inp = $('#mi-text'); if (inp && !inp.disabled) inp.focus();
  }
  async function onSend(e) {
    e.preventDefault();
    const inp = $('#mi-text');
    const text = (inp.value || '').trim();
    if (!text || !inbox.sel || inbox.sending) return;
    inbox.sending = true; inp.value = '';
    const conv = inbox.sel;
    try {
      await sendText(conv, text);
      inbox.msgs.push({ id: 'sent' + Date.now(), text: text, mine: true, at: Date.now(), att: [] });
      renderMsgs();
      POS.sound('ok');
      setTimeout(() => { if (inbox.sel === conv) loadMsgs(conv).then(() => { if (inbox.sel === conv) renderMsgs(); }); }, 2000);
    } catch (err) { inp.value = text; U.toast('Could not send: ' + fbErr(err), 'error'); }
    inbox.sending = false;
    inp.focus();
  }
  function renderInbox(root) {
    el = U.h('<div class="page msg-inbox"><div class="mi-list"><div class="mi-head"><h2>Messenger</h2><span class="muted small" id="mi-page"></span>' +
      '<button class="btn sm" id="mi-refresh" title="Look for new messages now">Refresh</button></div>' +
      '<div id="mi-convs"><div class="muted small mi-empty">Loading chats...</div></div></div>' +
      '<div class="mi-chat"><div class="mi-chat-head" id="mi-who">Select a chat</div><div class="mi-msgs" id="mi-msgs"></div>' +
      '<form class="mi-compose" id="mi-form"><input id="mi-text" type="text" placeholder="Type a reply..." autocomplete="off" maxlength="2000" disabled>' +
      '<button class="btn primary" type="submit">Send</button></form><div class="muted small" id="mi-note"></div></div></div>');
    root.appendChild(el);
    winTab = false;
    $('#mi-page').textContent = S().msgPageName ? 'Page: ' + S().msgPageName : '';
    $('#mi-form').onsubmit = onSend;
    $('#mi-refresh').onclick = () => { inbox.lastConvs = 0; inbox.lastMsgs = 0; inboxTick(); };
    inbox.sel = null; inbox.msgs = []; inbox.error = '';
    renderMsgs();
    loadConvs().then(() => { renderList(); M.sync(); });
  }
  function inboxTick() {
    if (!el || winTab || POS.state.view !== 'messenger') return;
    const now = Date.now();
    if (now - inbox.lastConvs >= 10000) { inbox.lastConvs = now; loadConvs().then(() => { renderList(); M.sync(); }); }
    if (inbox.sel && now - inbox.lastMsgs >= 5000) {
      inbox.lastMsgs = now;
      const c = inbox.sel;
      loadMsgs(c).then(() => {
        if (inbox.sel !== c) return;
        const key = inbox.msgs.length + ':' + (inbox.msgs.length ? inbox.msgs[inbox.msgs.length - 1].id : '');
        if (key !== inbox.lastKey) { renderMsgs(); if (inbox.msgs.length && !inbox.msgs[inbox.msgs.length - 1].mine) { markSeen(c); POS.sound('ding'); } }
      });
    }
  }

  /* ---------- the window mode: tell the launcher where to put the messenger.com window ---------- */
  function contentRect() {
    const main = document.getElementById('main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const frameY = Math.max(0, window.outerHeight - window.innerHeight);
    return { x: Math.round((window.screenX + frameX + r.left) * dpr), y: Math.round((window.screenY + frameY + r.top) * dpr),
      w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), dpr: Math.round(dpr * 100) };
  }
  function dock() {
    if (!el || !winTab || !launcher() || stale()) return;
    const r = contentRect();
    if (!r || r.w < 50 || r.h < 50) return;
    const url = M.connecting() ? M.connectUrl() : M.url();
    POS.signalLauncher('msgdock:' + [r.x, r.y, r.w, r.h, r.dpr].join(',') + ':' + encodeURIComponent(url), 2500);
  }
  function undock() { if (launcher()) POS.signalLauncher('msghide', 2500); }
  const onResize = () => { clearTimeout(dockTimer); dockTimer = setTimeout(dock, 250); };
  function renderWindowTab(root) {
    const st = M.state();
    let body;
    if (M.connecting()) body = '<p><b>Connecting your Facebook Page.</b> Sign in on the panel that appears here and choose your Page; PicklePOS finishes by itself.</p>';
    else if (!launcher()) body = '<p>Messenger shows here when PicklePOS is opened with <b>Start POS.bat</b> (the desktop shortcut).</p>';
    else if (stale()) body = '<p>One more step after the update: <b>close PicklePOS and open it again from the desktop shortcut</b>, then come back to this tab.</p>';
    else body = '<p>Loading your Messenger inbox...</p><p class="muted small">First time: log in once in the panel that appears here. It stays signed in afterwards.</p>';
    el = U.h('<div class="page msg-page"><div class="msg-hint">' + POS.icon('messenger') + '<h2>Messenger</h2>' + body +
      (st.count > 0 ? '<p><b>' + st.count + '</b> unread chat' + (st.count > 1 ? 's' : '') + '</p>' : '') +
      '<p class="muted small">' + (M.connecting() ? '' : 'Inbox: ' + U.esc(M.url()) + ' &middot; ') + 'Settings &rarr; Messenger to connect your Page or change the inbox.</p></div></div>');
    root.appendChild(el);
    winTab = true;
    window.addEventListener('resize', onResize);
    setTimeout(dock, 60);
    dockTimer = setTimeout(dock, 2500);
  }

  POS.views.messenger = {
    render: function (root) { if (M.mode() === 'page' && !M.connecting()) renderInbox(root); else renderWindowTab(root); },
    destroy: function () {
      window.removeEventListener('resize', onResize);
      clearTimeout(dockTimer);
      const wasWin = winTab;
      el = null; winTab = false;
      if (wasWin) undock();
    }
  };

  /* ---------- connecting a Page (Settings > Messenger) ---------- */
  M.connectUrl = function () {
    const s = S();
    const base = (s.msgConnectUrl || M.DEFAULT_CONNECT).trim();
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'app=' + encodeURIComponent(s.msgAppId || '') + (s.msgCfgId ? '&cfg=' + encodeURIComponent(s.msgCfgId) : '') + '&v=v21.0';
  };
  M.connecting = () => !!(connecting && Date.now() < connecting.until);
  M.cancelConnect = function () { connecting = null; if (launcher()) POS.signalLauncher('msgclose', 2500); };
  // With the launcher: the connect page opens in the Messenger tab and the sign-in result comes back by
  // itself. Without it: the page opens as a window and the code is pasted in Settings.
  M.connect = function () {
    const s = S();
    if (!s.msgAppId) return U.toast('Enter the Facebook App ID first (Settings > Messenger).', 'error');
    connecting = { since: Date.now(), until: Date.now() + 5 * 60000 };
    usedToken = '';
    if (launcher() && !stale()) {
      POS.signalLauncher('fbconnect', 2500);          // launcher: watch for the sign-in result, close any old Messenger window
      setTimeout(() => POS.go('messenger'), 1300);    // the tab then shows the connect page
      U.toast('Sign in to Facebook in the Messenger tab and choose your Page.', '');
    } else {
      const w = window.open(M.connectUrl(), 'pp-connect');
      if (!w) U.toast('Chrome blocked the window. Allow pop-ups for PicklePOS and try again.', 'error');
      else U.toast('Sign in on the page that opened, then paste the connection code in Settings > Messenger.', 'warn');
    }
  };
  // fb-connect.js is written by the launcher when the connect page hands over the sign-in result
  function pollFb() {
    const old = document.getElementById('fb-status');
    if (old) old.remove();
    window.POS_FB = null;
    const sc = document.createElement('script');
    sc.id = 'fb-status';
    sc.src = 'fb-connect.js?t=' + Date.now();
    sc.onload = () => {
      const r = window.POS_FB;
      if (r && r.token && connecting && r.at >= connecting.since - 5000 && r.token !== usedToken) { usedToken = r.token; M.finishConnect(r.token); }
    };
    document.head.appendChild(sc);
  }
  function choosePage(pages) {
    return new Promise((res) => {
      let picked = null, m = null;
      const body = U.h('<div><p>Which Page should PicklePOS use?</p><div class="staff-list"></div></div>');
      const list = body.querySelector('.staff-list');
      pages.forEach((p) => {
        const b = U.h('<button type="button" class="btn block" style="margin-bottom:6px"></button>');
        b.textContent = p.name;
        b.onclick = () => { picked = p; if (m) m.close(); };
        list.appendChild(b);
      });
      m = U.modal({ title: 'Choose your Page', body: body, cls: 'small', buttons: [{ label: 'Cancel' }], onClose: () => res(picked) });
    });
  }
  // token = the sign-in result (a user token), or a Page token pasted by hand
  M.finishConnect = async function (token) {
    const s = S();
    connecting = null;
    let pick = null;
    try {
      let tok = token;
      if (s.msgAppSecret) {
        try {
          const x = await graphGet('oauth/access_token?grant_type=fb_exchange_token&client_id=' + encodeURIComponent(s.msgAppId) + '&client_secret=' + encodeURIComponent(s.msgAppSecret) + '&fb_exchange_token=' + encodeURIComponent(token), '');
          if (x.access_token) tok = x.access_token;
        } catch (e) { /* not a user token, or wrong secret: try below */ }
      }
      let pages = [];
      try { pages = (await graphGet('me/accounts?fields=id,name,access_token&limit=100', tok)).data || []; } catch (e) { pages = []; }
      if (pages.length) {
        pick = pages.length === 1 ? pages[0] : await choosePage(pages);
        if (!pick) return;
        if (!s.msgAppSecret) U.toast('Connected without the App Secret: this connection lasts about an hour. Add the App Secret in Settings for a lasting one.', 'warn');
      } else {
        // maybe a Page token was pasted directly
        const me = await graphGet('me?fields=id,name', token);
        await M.unreadChats(token);
        pick = { id: me.id, name: me.name, access_token: token };
      }
      s.msgToken = pick.access_token; s.msgPageId = pick.id; s.msgPageName = pick.name; s.msgConnectedAt = Date.now();
      if (s.msgMode === 'window') s.msgMode = 'auto';
      await POS.saveSettings();
      graph = { count: null, error: '', at: 0 }; lastGraph = 0;
      if (launcher()) POS.signalLauncher('msgclose', 2500);
      U.toast('Connected to Page "' + pick.name + '". The Messenger tab now shows its inbox.', 'ok');
      POS.sound('ok');
      const v = POS.views.settings;
      if (POS.state.view === 'settings' && v && v.refreshMessenger) v.refreshMessenger(true);
      else if (POS.state.view === 'messenger') POS.go('messenger');
    } catch (e) { U.toast('Could not connect: ' + fbErr(e), 'error'); }
  };
  M.disconnect = async function () {
    const s = S();
    s.msgToken = ''; s.msgPageId = ''; s.msgPageName = ''; s.msgConnectedAt = 0;
    await POS.saveSettings();
    graph = { count: null, error: '', at: 0 };
    M.sync();
  };

  /* ---------- unread count, badge ---------- */
  M.state = function () {
    const fresh = !!(win && Date.now() - (win.at || 0) < 90000);
    const open = !!(fresh && win.open);
    if (M.connected()) return { count: graph.count, source: 'page', error: graph.error, at: graph.at, open: open };
    if (fresh && win.window) return { count: win.count, source: 'window', error: '', at: win.at, title: win.title, open: open };
    return { count: null, source: 'none', error: '', at: 0, open: open };
  };
  function pollWin() {
    const old = document.getElementById('msg-status');
    if (old) old.remove();
    window.POS_MSG = null;
    const sc = document.createElement('script');
    sc.id = 'msg-status';
    sc.src = 'messenger-status.js?t=' + Date.now();
    sc.onload = () => { win = window.POS_MSG || null; M.sync(); };
    sc.onerror = () => { win = null; M.sync(); };
    document.head.appendChild(sc);
  }
  M.sync = function () {
    const st = M.state();
    const b = document.getElementById('msg-badge');
    if (b) {
      b.textContent = st.count > 0 ? String(st.count) : (st.source === 'page' && st.error ? '!' : '');
      b.style.display = b.textContent ? '' : 'none';
    }
    const n = (st.count === null || st.count === undefined) ? -1 : +st.count;
    if (n > 0 && shown >= 0 && n > shown) {
      POS.sound('ding');
      if (POS.state.view !== 'messenger') U.toast('Messenger: ' + n + ' unread chat' + (n > 1 ? 's' : ''), 'warn');
    }
    if (n >= 0) shown = n;
    const v = POS.views && POS.state.view === 'settings' && POS.views.settings;
    if (v && v.refreshMessenger) v.refreshMessenger();
  };

  function tick() {
    if (!POS.state.settings || !POS.MESSENGER_ENABLED) return;
    const now = Date.now();
    if (now - lastWin >= 4000) { lastWin = now; pollWin(); }
    if (M.connected() && now - lastGraph >= 30000 && !(el && !winTab)) { lastGraph = now; pollGraph().then(M.sync); }
    if (M.connecting() && now - lastFb >= 2000) { lastFb = now; pollFb(); }
    inboxTick();
  }
  setInterval(tick, 1000);
  M.refreshNow = function () { lastGraph = 0; lastWin = 0; tick(); };
})(window.POS);
