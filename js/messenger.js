/* PicklePOS - Facebook Messenger at the counter.
   The "Messenger" button in the side bar opens the inbox as a floating panel (its own window, no
   address bar, docked at the bottom right, opened by the launcher inside the POS browser profile) and
   shows how many chats are unread, so bookings and payments sent through Messenger are not missed.
   Press the button again to bring the panel back, or to tuck it away when it is in front.
   The unread number comes from:
     1. A Facebook Page access token (Settings > Messenger): exact unread count from the Graph API.
     2. Otherwise the launcher watches the Messenger window's title (Facebook puts "(3)" in front of it
        when 3 chats are unread) and writes messenger-status.js next to index.html. */
(function (POS) {
  'use strict';
  const U = POS.util;
  const M = POS.messenger = {};
  const GRAPH = 'https://graph.facebook.com/v21.0/';
  M.DEFAULT_URL = 'https://www.messenger.com/';
  let graph = { count: null, error: '', at: 0 };
  let win = null, shown = -1, lastGraph = 0, lastWin = 0;

  M.url = () => (((POS.state.settings && POS.state.settings.msgUrl) || M.DEFAULT_URL) + '').trim();
  const launcher = () => !!(POS.launcherPresent && POS.launcherPresent() && POS.signalLauncher);

  // Opens the floating panel, brings it back, or tucks it away (the launcher does the window work).
  // Without the launcher (app opened without Start POS.bat) a plain browser window is used instead.
  M.open = function () {
    if (launcher()) {
      if (POS.launcherStale && POS.launcherStale()) {
        return U.toast('One more step after the update: close PicklePOS and open it again from the desktop shortcut, then press Messenger.', 'warn');
      }
      POS.signalLauncher('msg:' + encodeURIComponent(M.url()), 3000);
      const st = M.state();
      U.toast(st.open ? 'Messenger panel tucked away. Press again to bring it back.' : 'Opening Messenger...', '');
      return;
    }
    try {
      const w = window.open(M.url(), 'pp-messenger');
      if (w && w.focus) w.focus();
      if (!w) U.toast('Chrome blocked the Messenger window. Allow pop-ups for PicklePOS and try again.', 'error');
    } catch (e) { U.toast('Could not open Messenger: ' + (e.message || e), 'error'); }
  };

  // Unread chats and where the number comes from: 'page' (token), 'window' (title) or 'none';
  // open = the floating panel is on screen (not minimized)
  M.state = function () {
    const s = POS.state.settings;
    const fresh = !!(win && Date.now() - (win.at || 0) < 90000);
    const open = !!(fresh && win.open);
    if (s && s.msgToken) return { count: graph.count, source: 'page', error: graph.error, at: graph.at, open: open };
    if (fresh && win.window) return { count: win.count, source: 'window', error: '', at: win.at, title: win.title, open: open };
    return { count: null, source: 'none', error: '', at: 0, open: open };
  };

  async function graphGet(path, token) {
    const r = await fetch(GRAPH + path + (path.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(token), { cache: 'no-store' });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Facebook returned an error');
    return j;
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
    const s = POS.state.settings;
    if (!s || !s.msgToken) { graph = { count: null, error: '', at: 0 }; return; }
    if (!navigator.onLine) { graph = { count: graph.count, error: 'No internet', at: Date.now() }; return; }
    try { graph = { count: await M.unreadChats(s.msgToken), error: '', at: Date.now() }; }
    catch (e) { graph = { count: graph.count, error: e.message || String(e), at: Date.now() }; }
  }

  // messenger-status.js is rewritten by the launcher every few seconds
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

  // Badge and highlight on the side-bar button; a sound and a message when new chats arrive
  M.sync = function () {
    const st = M.state();
    const btn = document.getElementById('msg-btn');
    const b = document.getElementById('msg-badge');
    if (btn) {
      btn.classList.toggle('on', st.open);
      btn.title = st.open ? 'Messenger panel is open. Press to tuck it away.' :
        st.source === 'page' ? ('Facebook Page inbox' + (st.error ? ' - ' + st.error : '')) :
        st.source === 'window' ? 'Press to bring the Messenger panel back' :
        'Open Messenger as a floating panel. Log in there once; it remembers you.';
    }
    if (b) {
      b.textContent = st.count > 0 ? String(st.count) : (st.source === 'page' && st.error ? '!' : '');
      b.style.display = b.textContent ? '' : 'none';
    }
    const n = (st.count === null || st.count === undefined) ? -1 : +st.count;
    if (n > 0 && shown >= 0 && n > shown) {
      POS.sound('ding');
      U.toast('Messenger: ' + n + ' unread chat' + (n > 1 ? 's' : ''), 'warn');
    }
    if (n >= 0) shown = n;
    const v = POS.views && POS.state.view === 'settings' && POS.views.settings;
    if (v && v.refreshMessenger) v.refreshMessenger();
  };

  function tick() {
    if (!POS.state.settings) return;
    const now = Date.now();
    if (now - lastWin >= 4000) { lastWin = now; pollWin(); }
    if (POS.state.settings.msgToken && now - lastGraph >= 30000) { lastGraph = now; pollGraph().then(M.sync); }
  }
  setInterval(tick, 1000);
  M.refreshNow = function () { lastGraph = 0; lastWin = 0; tick(); };
})(window.POS);
