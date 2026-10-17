/* PicklePOS - local database (IndexedDB, stored inside the browser profile) */
(function (POS) {
  'use strict';
  const STORES = ['kv', 'users', 'categories', 'items', 'orders', 'stocklog', 'tickets'];
  let db = null;

  function req(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function done(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Database write was cancelled'));
    });
  }
  const store = (name, mode) => db.transaction(name, mode || 'readonly').objectStore(name);

  POS.db = {
    STORES: STORES,
    open: function () {
      return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('This browser cannot store data. Please use Google Chrome or Microsoft Edge.'));
        // v1: first release. v2: kitchen tickets (Kitchen screen).
        const r = indexedDB.open('picklepos', 2);
        r.onupgradeneeded = function () {
          const d = r.result;
          const has = (n) => d.objectStoreNames.contains(n);
          if (!has('kv')) d.createObjectStore('kv', { keyPath: 'k' });
          if (!has('users')) d.createObjectStore('users', { keyPath: 'id' });
          if (!has('categories')) d.createObjectStore('categories', { keyPath: 'id' });
          if (!has('items')) d.createObjectStore('items', { keyPath: 'id' });
          if (!has('orders')) {
            const o = d.createObjectStore('orders', { keyPath: 'id' });
            o.createIndex('status', 'status');
            o.createIndex('day', 'day');
          }
          if (!has('stocklog')) {
            const s = d.createObjectStore('stocklog', { keyPath: 'id' });
            s.createIndex('ts', 'ts');
          }
          if (!has('tickets')) {
            const t = d.createObjectStore('tickets', { keyPath: 'id' });
            t.createIndex('status', 'status');
            t.createIndex('servedAt', 'servedAt');
          }
        };
        r.onsuccess = () => {
          db = r.result;
          // A newer PicklePOS opened in another window needs this one to step aside
          db.onversionchange = () => { db.close(); location.reload(); };
          res(db);
        };
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('Close other PicklePOS windows and try again.'));
      });
    },
    all: (s) => req(store(s).getAll()),
    get: (s, k) => req(store(s).get(k)),
    byIndex: (s, idx, range) => req(store(s).index(idx).getAll(range)),
    put: function (s, v) {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).put(v);
      return done(tx);
    },
    del: function (s, k) {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).delete(k);
      return done(tx);
    },
    // Export everything (used for backups)
    dump: async function () {
      const out = {};
      for (const s of STORES) out[s] = await POS.db.all(s);
      return out;
    },
    // Replace everything (used for restore)
    restore: function (data) {
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach((s) => {
        const os = tx.objectStore(s);
        os.clear();
        (data[s] || []).forEach((v) => os.put(v));
      });
      return done(tx);
    }
  };
})(window.POS);
