// Cifrado de los datos de la familia. Funciona igual en el navegador y en Node 18+ (Web Crypto).
// - Clave de familia (v2): 32 bytes aleatorios que solo conocen los móviles de la familia (viajan en el
//   #fragmento del enlace de invitación, que nunca llega al servidor). De ahí sale la clave AES-GCM con HKDF.
// - Código familiar (v1, PBKDF2): solo para importar copias y datos de KiBi.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Cripto = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle);
  const ITER = 210000;
  const enc = new TextEncoder(), dec = new TextDecoder();

  const toB64 = buf => {
    const bytes = new Uint8Array(buf);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  };
  const fromB64 = s => {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  };
  const normaliza = codigo => String(codigo).trim().toLowerCase();

  async function clave(codigo, sal) {
    const base = await subtle().importKey("raw", enc.encode(normaliza(codigo)), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey({ name: "PBKDF2", salt: sal, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function cifrar(objeto, codigo) {
    const sal = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const k = await clave(codigo, sal);
    const datos = await subtle().encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(objeto)));
    return { v: 1, iter: ITER, sal: toB64(sal), iv: toB64(iv), datos: toB64(datos) };
  }

  // Lanza un error si el código no es correcto.
  async function descifrar(paquete, codigo) {
    const k = await clave(codigo, fromB64(paquete.sal));
    const plano = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(paquete.iv) }, k, fromB64(paquete.datos));
    return JSON.parse(dec.decode(plano));
  }

  // ---------- Clave de familia (v2) ----------
  const toB64url = buf => toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromB64url = s => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  const aleatorio = (n = 32) => toB64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));

  async function claveFamilia(secreto) {
    const raw = fromB64url(secreto);
    if (raw.length !== 32) throw Error("La clave de la familia no es válida.");
    const base = await subtle().importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("aldia"), info: enc.encode("datos-familia-v2") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function cifrarCon(objeto, k) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const datos = await subtle().encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(objeto)));
    return { v: 2, iv: toB64(iv), datos: toB64(datos) };
  }
  async function descifrarCon(paquete, k) {
    if (!paquete || paquete.v !== 2) throw Error("Formato de datos cifrados desconocido.");
    const plano = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(paquete.iv) }, k, fromB64(paquete.datos));
    return JSON.parse(dec.decode(plano));
  }

  return { cifrar, descifrar, aleatorio, claveFamilia, cifrarCon, descifrarCon };
});
