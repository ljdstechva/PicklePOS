/* PicklePOS - app updates.
   The launcher (launcher/PicklePOS.ps1, started by Start POS.bat) checks GitHub in the background,
   downloads a new version and writes update-status.js next to index.html. This file reads that
   status, shows a "Restart to update" bar, and talks back to the launcher through the window title
   ("[pp:check]" = check now, "[pp:restart]" = close and reopen the app, installing the update). */
(function (POS) {
  'use strict';
  const U = POS.util;
  POS.version = window.POS_VERSION || '0.0.0';
  // Polls every 3 s for the first 2.5 minutes after opening (the launcher checks GitHub ~20 s after
  // start-up), then every minute; toastedFor remembers which version was already announced.
  let status = null, fastUntil = Date.now() + 150000, lastPoll = 0, hiddenFor = '', autoRun = null, toastedFor = '';

  // true if version a is newer than b ("1.10.0" > "1.9.2")
  POS.newerVersion = function (a, b) {
    const x = String(a || '').split('.'), y = String(b || '').split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d > 0;
    }
    return false;
  };

  function poll() {
    lastPoll = Date.now();
    const old = document.getElementById('upd-status');
    if (old) old.remove();
    window.POS_UPDATE = null;
    const sc = document.createElement('script');
    sc.id = 'upd-status';
    sc.src = 'update-status.js?t=' + Date.now();
    sc.onload = () => { status = window.POS_UPDATE || null; changed(); };
    sc.onerror = () => { status = null; changed(); };
    document.head.appendChild(sc);
  }
  setTimeout(poll, 2500);
  setInterval(() => { if (Date.now() - lastPoll > (Date.now() < fastUntil ? 3000 : 60000)) poll(); }, 1000);

  const isReady = () => !!(status && status.state === 'ready' && POS.newerVersion(status.version, POS.version));

  POS.updateInfo = function () {
    const st = status;
    if (!st || !st.launcher) {
      return { cls: '', launcher: false, html: 'Automatic updates work when PicklePOS is opened with <b>Start POS.bat</b> (the desktop shortcut).' };
    }
    const when = st.checkedAt ? ' &middot; checked ' + U.fmtDT(st.checkedAt) : '';
    if (isReady()) {
      return { cls: 'ready', launcher: true, ready: true, html: '<b>Version ' + U.esc(st.version) + ' is downloaded and ready.</b> Restart PicklePOS to finish updating.' +
        (st.notes ? '<br><span class="small">What’s new: ' + U.esc(st.notes) + '</span>' : '') };
    }
    if (st.state === 'idle') return { cls: '', launcher: true, html: 'PicklePOS will check for updates in a moment (when there is internet).' };
    if (st.state === 'checking') return { cls: '', launcher: true, html: 'Checking for updates...' };
    if (st.state === 'downloading') return { cls: '', launcher: true, html: 'Downloading version ' + U.esc(st.version || '') + '...' };
    if (st.state === 'offline') return { cls: 'warn', launcher: true, html: 'No internet right now. PicklePOS will check again later' + when + '.' };
    if (st.state === 'error') return { cls: 'warn', launcher: true, html: 'Could not check for updates: ' + U.esc(st.message || 'unknown error') + when + '.' };
    return { cls: 'ok', launcher: true, html: 'PicklePOS is up to date' + when + '.' };
  };

  // Side-bar "Update" button: visible to every user (employees too). Plain "Update" checks GitHub
  // and installs; it turns into "Install update" once a newer version has been downloaded.
  POS.syncUpdateButton = function () {
    const b = document.getElementById('upd-btn');
    if (!b) return;
    const ready = isReady();
    const downloading = !!(status && status.state === 'downloading' && !autoRun);
    b.classList.remove('hidden');
    b.classList.toggle('primary', ready);
    b.classList.toggle('has-update', ready);
    b.disabled = !!autoRun;
    b.innerHTML = (autoRun ? 'Checking update...' : (ready ? 'Install update' : (downloading ? 'Downloading...' : 'Update'))) +
      (ready ? '<span class="badge hot" id="upd-badge">1</span>' : '');
    b.title = ready ? 'PicklePOS ' + status.version + ' is downloaded. Press to install it now (takes a few seconds).' :
      'Check for a newer PicklePOS and install it';
    b.onclick = () => POS.updateNow();
  };

  function changed() {
    autoStep();
    POS.syncUpdateButton();
    staleNotice();
    // A new version was found and downloaded on its own: say so once
    if (isReady() && !autoRun && toastedFor !== status.version) {
      toastedFor = status.version;
      POS.sound('ding');
      U.toast('PicklePOS ' + status.version + ' is ready. Press "Install update" in the side bar when the counter is free.', 'ok');
    }
    const v = POS.views && POS.state.view === 'settings' && POS.views.settings;
    if (v && v.refresh) v.refresh();
    let bar = document.getElementById('upd-bar');
    if (!isReady() || hiddenFor === status.version) { if (bar) bar.remove(); return; }
    if (bar) return;
    bar = U.h('<div id="upd-bar" class="upd-bar"><span class="upd-ico">&#8679;</span><span>PicklePOS <b>' + U.esc(status.version) +
      '</b> is ready. Restart to finish updating.</span><button class="btn sm primary" data-a="go">Restart Now</button>' +
      '<button class="btn sm" data-a="later">Later</button></div>');
    U.$('[data-a=go]', bar).onclick = () => POS.restartForUpdate();
    U.$('[data-a=later]', bar).onclick = () => { hiddenFor = status.version; bar.remove(); };
    document.body.appendChild(bar);
  }

  // Briefly put a signal in the window title; the launcher watches the title of the app window
  // (any earlier signal is removed first; the browser trims the title, so no leading space is assumed)
  function signal(code, ms) {
    const base = document.title.replace(/(\s*\[pp:[^\]]*\])+\s*$/, '');
    document.title = base + ' [pp:' + code + ']';
    if (ms) setTimeout(() => { if (document.title.indexOf('[pp:' + code + ']') >= 0) document.title = base; }, ms);
  }
  POS.signalLauncher = signal;
  POS.launcherPresent = () => !!(status && status.launcher);
  // The launcher (launcher\PicklePOS.ps1) keeps running across in-app updates; since 1.2.2 it hands
  // over to its new copy by itself, but an older launcher cannot, so the app asks for one fresh start.
  POS.launcherStale = () => !!(status && status.launcher && (!status.launcherVersion || POS.newerVersion(POS.version, status.launcherVersion)));
  let staleShown = false;
  function staleNotice() {
    if (!POS.launcherStale() || staleShown || document.getElementById('stale-bar')) return;
    staleShown = true;
    const bar = U.h('<div id="stale-bar" class="upd-bar"><span class="upd-ico">!</span><span>Update installed. To finish it, <b>close PicklePOS and open it again from the desktop shortcut</b>.</span>' +
      '<button class="btn sm" data-a="ok">OK</button></div>');
    U.$('[data-a=ok]', bar).onclick = () => bar.remove();
    document.body.appendChild(bar);
  }

  POS.checkUpdates = function () {
    fastUntil = Date.now() + 120000;
    signal('check', 5000);
  };

  /* ---- "Update Now": one click = check internet, ask GitHub, download, install, reopen ----
     The launcher does the downloading (it answers the "[pp:check]" title signal by writing
     update-status.js); this code watches that status and restarts the app as soon as a newer
     version is downloaded, with no further clicks. */
  POS.updateBusy = () => !!autoRun;

  POS.updateNow = function () {
    if (!navigator.onLine) return U.toast('No internet connection. Connect the laptop to Wi-Fi first.', 'error');
    if (!(status && status.launcher)) return U.toast('Updates need the desktop shortcut: close this window and open PicklePOS with Start POS.bat.', 'error');
    if (autoRun) return U.toast('Already checking...', '');
    if (isReady()) return POS.restartForUpdate(true);
    autoRun = { since: Date.now(), lastState: '', timer: setTimeout(() => autoFail('The updater did not answer. Please try again.'), 120000) };
    fastUntil = Date.now() + 180000;
    signal('check', 5000);
    U.toast('Checking for updates...', '');
    setTimeout(poll, 1500);
    refreshAbout();
  };

  function refreshAbout() {
    POS.syncUpdateButton();
    const v = POS.views && POS.state.view === 'settings' && POS.views.settings;
    if (v && v.refresh) v.refresh();
  }
  function autoEnd() {
    if (autoRun && autoRun.timer) clearTimeout(autoRun.timer);
    autoRun = null;
    refreshAbout();
  }
  function autoFail(msg) { autoEnd(); U.toast(msg, 'error'); }
  function autoStep() {
    if (!autoRun || !status) return;
    if (!status.checkedAt || status.checkedAt < autoRun.since) return; // launcher has not answered yet
    const st = status.state;
    if (st === 'checking' || st === 'idle') return;
    if (st === 'downloading') {
      if (autoRun.lastState !== 'downloading') {
        autoRun.lastState = 'downloading';
        U.toast('Update ' + (status.version || '') + ' found. Downloading...', 'ok');
        clearTimeout(autoRun.timer);
        autoRun.timer = setTimeout(() => autoFail('The download is slow. It continues in the background; press Update Now again in a few minutes.'), 15 * 60000);
      }
      return;
    }
    if (st === 'offline') return autoFail('No internet connection: ' + (status.message || 'the update server could not be reached.'));
    if (st === 'error') return autoFail('Update check failed: ' + (status.message || 'unknown error'));
    if (isReady()) {
      autoEnd();
      U.toast('Version ' + status.version + ' downloaded. Installing now...', 'ok');
      return POS.restartForUpdate(true);
    }
    // 'current', or 'ready' with nothing newer
    autoEnd();
    U.toast('PicklePOS ' + POS.version + ' is already the latest version.', 'ok');
  }
  window.addEventListener('online', refreshAbout);
  window.addEventListener('offline', refreshAbout);

  POS.restartForUpdate = async function (auto) {
    if (POS.cart && POS.cart.lines.length && POS.cartDirty) {
      return U.toast('Finish or save the current order first, then press Update Now again.', 'error');
    }
    if (!auto && !(await U.confirm('Restart PicklePOS now to install version ' + (status ? status.version : '') + '? It takes a few seconds. Your data is kept.', 'Restart Now'))) return;
    document.body.appendChild(U.h('<div class="restarting"><span class="logo-ball"></span><b>Updating PicklePOS...</b><span>The app will open again by itself.</span></div>'));
    signal('restart');
    // If no launcher reacts (app opened another way), explain what to do
    setTimeout(() => {
      const r = document.querySelector('.restarting');
      if (r) r.remove();
      document.title = document.title.replace(/(\s*\[pp:[^\]]*\])+\s*$/, '');
      U.modal({
        title: 'Please restart PicklePOS', cls: 'small',
        body: '<p>Close this window, then open PicklePOS again with the <b>desktop shortcut</b> (Start POS.bat). The update is installed while it opens.</p>',
        buttons: [{ label: 'OK', cls: 'primary' }]
      });
    }, 12000);
  };
})(window.POS);
