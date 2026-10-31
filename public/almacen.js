// Almacén local del móvil (IndexedDB). Guarda la sesión y una copia cifrada para abrir sin conexión.
// Si el navegador no deja guardar (modo privado), funciona en memoria y `persistente` queda en false.
(function (root) {
  const memoria = new Map();
  let db = null, persistente = true;
  const abrir = () => db || (db = new Promise(res => {
    try {
      const r = indexedDB.open("aldia", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  }).then(x => { if (!x) persistente = false; return x; }));
  const op = async (modo, fn) => {
    const base = await abrir();
    if (!base) throw Error("Sin almacenamiento");
    return new Promise((res, rej) => {
      const tx = base.transaction("kv", modo);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => res(req.result);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  };
  root.Almacen = {
    async get(k) { try { const v = await op("readonly", s => s.get(k)); return v === undefined ? (memoria.get(k) ?? null) : v; } catch (e) { return memoria.get(k) ?? null; } },
    async set(k, v) { memoria.set(k, v); try { await op("readwrite", s => s.put(v, k)); return true; } catch (e) { persistente = false; return false; } },
    async del(k) { memoria.delete(k); try { await op("readwrite", s => s.delete(k)); } catch (e) {} },
    async limpiar() { memoria.clear(); try { await op("readwrite", s => s.clear()); } catch (e) {} },
    get persistente() { return persistente; }
  };
})(self);
