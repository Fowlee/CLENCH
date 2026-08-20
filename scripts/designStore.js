/* ===== DESIGN HANDOFF =====
 *
 * Carries a design from designer.html to order.html, where it is submitted with
 * the booking. Nothing is sent to the server until the customer books, so a
 * visitor who plays with the designer and leaves creates no order.
 *
 * Two places to put it, in order of preference:
 *
 *   IndexedDB      first choice. A logo is embedded in the design as a data
 *                  URL, which routinely makes the whole thing several megabytes
 *                  — past what sessionStorage will hold.
 *   sessionStorage fallback. Some private-browsing modes and in-app browsers
 *                  refuse IndexedDB, and a few do it by never answering at all
 *                  rather than failing. A design with no uploaded image fits
 *                  here comfortably.
 *
 * Designing is a required step, so the one outcome that must never happen is a
 * silent hang: every call here settles, even if that means reporting failure.
 *
 * Loaded as a plain script on both pages; it hangs one object off window.
 */
(function () {
  const DB_NAME = 'clench';
  const DB_VERSION = 1;
  const STORE = 'handoff';

  // Only ever one design in flight, so the key is a constant.
  const KEY = 'current';
  const SESSION_KEY = 'clench.design';

  /* A blocked IndexedDB doesn't always error — in some browsers open() simply
   * never fires any event. Waiting forever would leave the order page showing
   * neither the form nor a way forward, so every attempt gets a deadline.
   * Real reads and writes here take milliseconds. */
  const TIMEOUT = 5000;

  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((resolve, reject) =>
        setTimeout(() => reject(new Error('IndexedDB did not respond')), TIMEOUT))
    ]);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
  }

  function transact(mode, work) {
    return withTimeout(openDatabase().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));

      // The transaction is what actually commits, so resolve on its completion
      // rather than on the request, or a write can be reported before it lands.
      transaction.oncomplete = () => { db.close(); resolve(request && request.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    })));
  }

  window.ClenchDesign = {
    /* Rejects only when neither store would take it — which on this site means
     * a big uploaded logo in a browser without IndexedDB. The designer turns
     * that into a message telling the customer what to change. */
    save(design) {
      return transact('readwrite', store => store.put(design, KEY))
        .then(() => {
          // Only one copy should exist, or a stale fallback could win later.
          try { sessionStorage.removeItem(SESSION_KEY); } catch (error) { /* nothing to clear */ }
        })
        .catch(error => {
          console.warn('IndexedDB unavailable, falling back to sessionStorage:', error);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(design));
        });
    },

    // Always resolves. "No design" is a state the order page knows how to show.
    load() {
      return transact('readonly', store => store.get(KEY))
        .catch(error => {
          console.warn('IndexedDB unavailable, reading sessionStorage:', error);
          return null;
        })
        .then(design => {
          if (design) return design;

          try {
            const saved = sessionStorage.getItem(SESSION_KEY);
            return saved ? JSON.parse(saved) : null;
          } catch (error) {
            return null;
          }
        })
        .catch(() => null);
    },

    clear() {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (error) { /* already gone */ }
      return transact('readwrite', store => store.delete(KEY)).catch(() => {});
    }
  };
})();
