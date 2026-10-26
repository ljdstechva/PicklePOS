/* PicklePOS - Facebook Messenger as a tab inside the POS.
   Facebook does not allow messenger.com to be shown inside another page, so the Messenger tab works
   like this: the tab's content area is filled by a real messenger.com window (desktop layout, chats on
   the left, conversation on the right) that the launcher opens in its own browser profile and snaps
   exactly over the tab's area. It follows the POS window, stays only while the POS or the panel is in
   front, and goes away when another tab is chosen. The nav badge shows how many chats are unread:
     1. from a Facebook Page access token (Settings > Messenger), exact count via the Graph API, or
     2. from the Messenger window's title, which Facebook prefixes with "(3)" when 3 chats are unread
        (the launcher writes it to messenger-status.js next to index.html). */
(function (POS) {
  'use strict';
  const U = POS.util;
  const M = POS.messenger = {};
  const GRAPH = 'https://graph.facebook.com/v21.0/';
  M.DEFAULT_URL = 'https://www.messenger.com/';
  let graph = { count: null, error: '', at: 0 };
  let win = null, shown = -1, lastGraph = 0, lastWin = 0;
  let el = null, dockTimer = null;

  M.url = () => (((POS.state.settings && POS.state.settings.msgUrl) || M.DEFAULT_URL) + '').trim();
  const launcher = () => !!(POS.launcherPresent && POS.launcherPresent() && POS.signalLauncher);
  const stale = () => !!(POS.launcherStale && POS.launcherStale());

  // "Open Messenger" from anywhere = go to the tab
  M.open = function () { POS.go('messenger'); };

  /* ---- the tab: tell the launcher where to put the messenger.com window ---- */
  // Screen rectangle (device pixels) of the tab's content area
  function contentRect() {
    const main = document.getElementById('main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);   // window border
    const frameY = Math.max(0, window.outerHeight - window.innerHeight);       // title bar + border
    return {
      x: Math.round((window.screenX + frameX + r.left) * dpr), y: Math.round((window.screenY + frameY + r.top) * dpr),
      w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), dpr: Math.round(dpr * 100)
    };
  }
  function dock() {
    if (!el || !launcher() || stale()) return;
    const r = contentRect();
    if (!r || r.w < 50 || r.h < 50) return;
    POS.signalLauncher('msgdock:' + [r.x, r.y, r.w, r.h, r.dpr].join(',') + ':' + encodeURIComponent(M.url()), 2500);
  }
  function undock() { if (launcher()) POS.signalLauncher('msghide', 2500); }
  const onResize = () => { clearTimeout(dockTimer); dockTimer = setTimeout(dock, 250); };

  POS.views.messenger = {
    render: function (root) {
      const st = M.state();
      let body;
      if (!launcher()) body = '<p>Messenger shows here when PicklePOS is opened with <b>Start POS.bat</b> (the desktop shortcut).</p>';
      else if (stale()) body = '<p>One more step after the update: <b>close PicklePOS and open it again from the desktop shortcut</b>, then come back to this tab.</p>';
      else body = '<p>Loading your Messenger inbox...</p><p class="muted small">First time: log in once in the panel that appears here. It stays signed in afterwards.</p>';
      el = U.h('<div class="page msg-page"><div class="msg-hint">' + POS.icon('messenger') + '<h2>Messenger</h2>' + body +
        (st.count > 0 ? '<p><b>' + st.count + '</b> unread chat' + (st.count > 1 ? 's' : '') + '</p>' : '') +
        '<p class="muted small">Inbox: ' + U.esc(M.url()) + ' &middot; change it in Settings &rarr; Messenger</p></div></div>');
      root.appendChild(el);
      window.addEventListener('resize', onResize);
      setTimeout(dock, 60);                  // after layout
      dockTimer = setTimeout(dock, 2500);    // again, in case the panel was still opening
    },
    destroy: function () {
      window.removeEventListener('resize', onResize);
      clearTimeout(dockTimer);
      el = null;
      undock();
    }
  };

  /* ---- unread count ---- */
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

  // Badge on the Messenger tab; a sound and a message when new chats arrive
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
    if (!POS.state.settings) return;
    const now = Date.now();
    if (now - lastWin >= 4000) { lastWin = now; pollWin(); }
    if (POS.state.settings.msgToken && now - lastGraph >= 30000) { lastGraph = now; pollGraph().then(M.sync); }
  }
  setInterval(tick, 1000);
  M.refreshNow = function () { lastGraph = 0; lastWin = 0; tick(); };
})(window.POS);
