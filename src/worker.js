// alDia · Worker de Cloudflare: sirve la app (assets) y la API en /api/*.
// El servidor nunca ve los datos de las familias en claro: guarda un blob cifrado en el móvil.
// Sí guarda en claro la agenda de colegios y clases (festivos, horarios, circulares), que se comparte.

const MAX_BLOB = 512 * 1024;      // bytes del blob cifrado de una familia
const MAX_CAPA = 256 * 1024;      // bytes de los datos de un colegio o una clase
const MAX_CLASES = 20;
const DIAS_INVITACION = { familia: 30, miembro: 7 };
const ID_CAPA = /^[a-z0-9][a-z0-9-]{0,79}$/;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const json = (datos, status = 200) => new Response(JSON.stringify(datos), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
});
const ahora = () => new Date().toISOString();
const enDias = n => new Date(Date.now() + n * 864e5).toISOString();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatorio = (n = 24) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(texto) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function leerJson(request, max = MAX_BLOB + 16 * 1024) {
  const texto = await request.text();
  if (texto.length > max) throw new HttpError(413, "La petición es demasiado grande.");
  try { return JSON.parse(texto || "{}"); } catch { throw new HttpError(400, "El cuerpo no es JSON válido."); }
}
const texto = (v, max, campo) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new HttpError(400, `Falta «${campo}» o es demasiado largo.`);
  return v.trim();
};
function validarBlob(b) {
  if (!b || b.v !== 2 || typeof b.iv !== "string" || typeof b.datos !== "string") throw new HttpError(400, "Los datos de la familia deben ir cifrados (v2).");
  const s = JSON.stringify({ v: 2, iv: b.iv, datos: b.datos });
  if (s.length > MAX_BLOB) throw new HttpError(413, "Los datos de la familia son demasiado grandes.");
  return s;
}

// ---------- Autenticación ----------
const bearer = request => (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

async function dispositivo(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, "Falta el token del móvil.");
  const d = await env.DB.prepare("SELECT id, familia_id FROM dispositivos WHERE token_hash = ? AND revocado IS NULL").bind(await sha256(token)).first();
  if (!d) throw new HttpError(401, "Este móvil no tiene acceso. Pide una invitación nueva.");
  await env.DB.prepare("UPDATE dispositivos SET ultimo_uso = ? WHERE id = ?").bind(ahora(), d.id).run();
  return d;
}

async function esAdmin(request, env) {
  const token = bearer(request);
  if (!env.ADMIN_TOKEN || !token) return false;
  // Comparación de hashes: mismo tiempo para cualquier token.
  return (await sha256(token)) === (await sha256(env.ADMIN_TOKEN));
}
async function admin(request, env) {
  if (!(await esAdmin(request, env))) throw new HttpError(403, "Solo para la administración de alDia.");
}

async function nuevoDispositivo(env, familiaId, nombre) {
  const token = aleatorio(32), id = aleatorio(12);
  await env.DB.prepare("INSERT INTO dispositivos (id, familia_id, token_hash, nombre, creado) VALUES (?, ?, ?, ?, ?)")
    .bind(id, familiaId, await sha256(token), nombre, ahora()).run();
  return { dispositivoId: id, token };
}

// Gasta una invitación (una sola vez, sin caducar). Devuelve la fila o lanza 403.
async function gastarInvitacion(env, codigo, tipo) {
  if (typeof codigo !== "string" || codigo.length < 20 || codigo.length > 100) throw new HttpError(400, "Falta la invitación.");
  const hash = await sha256(codigo);
  const inv = await env.DB.prepare("SELECT * FROM invitaciones WHERE hash = ? AND tipo = ?").bind(hash, tipo).first();
  if (!inv) throw new HttpError(403, "Esta invitación no es válida.");
  const r = await env.DB.prepare("UPDATE invitaciones SET usada = ? WHERE hash = ? AND usada IS NULL AND caduca > ?").bind(ahora(), hash, ahora()).run();
  if (!r.meta.changes) throw new HttpError(403, "Esta invitación ya se ha usado o ha caducado. Pide otra.");
  return inv;
}

async function crearInvitacion(env, tipo, familiaId = null) {
  const codigo = aleatorio(24), caduca = enDias(DIAS_INVITACION[tipo]);
  await env.DB.prepare("INSERT INTO invitaciones (hash, tipo, familia_id, creada, caduca) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(codigo), tipo, familiaId, ahora(), caduca).run();
  return { codigo, caduca };
}

async function guardarClases(env, familiaId, clases) {
  if (!Array.isArray(clases) || clases.length > MAX_CLASES || clases.some(c => typeof c !== "string" || !ID_CAPA.test(c))) throw new HttpError(400, "La lista de clases no es válida.");
  const unicas = [...new Set(clases)];
  if (unicas.length) {
    const { results } = await env.DB.prepare(`SELECT id FROM capas WHERE ambito = 'clase' AND id IN (${unicas.map(() => "?").join(",")})`).bind(...unicas).all();
    const existen = new Set(results.map(r => r.id));
    const falta = unicas.find(c => !existen.has(c));
    if (falta) throw new HttpError(400, `La clase «${falta}» no existe.`);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM familia_clases WHERE familia_id = ?").bind(familiaId),
    ...unicas.map(c => env.DB.prepare("INSERT INTO familia_clases (familia_id, clase_id) VALUES (?, ?)").bind(familiaId, c))
  ]);
  return unicas;
}
async function clasesDe(env, familiaId) {
  const { results } = await env.DB.prepare("SELECT clase_id FROM familia_clases WHERE familia_id = ? ORDER BY clase_id").bind(familiaId).all();
  return results.map(r => r.clase_id);
}

// ---------- Rutas ----------
const rutas = [];
const ruta = (metodo, patron, fn) => rutas.push({ metodo, re: new RegExp("^" + patron.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

// Alta de una familia nueva con una invitación de la administración.
ruta("POST", "/api/familias", async (req, env) => {
  const b = await leerJson(req);
  const nombre = texto(b.dispositivo, 60, "dispositivo");
  const blob = validarBlob(b.blob);
  await gastarInvitacion(env, b.invitacion, "familia");
  const id = aleatorio(16), t = ahora();
  await env.DB.prepare("INSERT INTO familias (id, blob, version, creada, actualizada) VALUES (?, ?, 1, ?, ?)").bind(id, blob, t, t).run();
  const disp = await nuevoDispositivo(env, id, nombre);
  return json({ familiaId: id, version: 1, ...disp }, 201);
});

// Otro adulto se une a una familia con una invitación de miembro.
ruta("POST", "/api/unirse", async (req, env) => {
  const b = await leerJson(req);
  const nombre = texto(b.dispositivo, 60, "dispositivo");
  const inv = await gastarInvitacion(env, b.invitacion, "miembro");
  const disp = await nuevoDispositivo(env, inv.familia_id, nombre);
  return json({ familiaId: inv.familia_id, ...disp }, 201);
});

ruta("GET", "/api/familia", async (req, env) => {
  const d = await dispositivo(req, env);
  const f = await env.DB.prepare("SELECT blob, version FROM familias WHERE id = ?").bind(d.familia_id).first();
  return json({ familiaId: d.familia_id, dispositivoId: d.id, blob: JSON.parse(f.blob), version: f.version, clases: await clasesDe(env, d.familia_id) });
});

// Guarda los datos cifrados. `base` es la versión de la que parte el móvil: si otro móvil guardó
// antes, responde 409 con lo último para que el móvil fusione y vuelva a intentarlo.
ruta("PUT", "/api/familia", async (req, env) => {
  const d = await dispositivo(req, env);
  const b = await leerJson(req);
  const blob = validarBlob(b.blob);
  if (!Number.isInteger(b.base)) throw new HttpError(400, "Falta la versión de partida («base»).");
  const r = await env.DB.prepare("UPDATE familias SET blob = ?, version = version + 1, actualizada = ? WHERE id = ? AND version = ?").bind(blob, ahora(), d.familia_id, b.base).run();
  if (!r.meta.changes) {
    const f = await env.DB.prepare("SELECT blob, version FROM familias WHERE id = ?").bind(d.familia_id).first();
    throw new HttpError(409, "Otro móvil ha guardado cambios antes.", { blob: JSON.parse(f.blob), version: f.version, clases: await clasesDe(env, d.familia_id) });
  }
  const clases = b.clases === undefined ? await clasesDe(env, d.familia_id) : await guardarClases(env, d.familia_id, b.clases);
  return json({ version: b.base + 1, clases });
});

// Baja: borra la familia, sus móviles e invitaciones.
ruta("DELETE", "/api/familia", async (req, env) => {
  const d = await dispositivo(req, env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM familia_clases WHERE familia_id = ?").bind(d.familia_id),
    env.DB.prepare("DELETE FROM gestores WHERE familia_id = ?").bind(d.familia_id),
    env.DB.prepare("DELETE FROM invitaciones WHERE familia_id = ?").bind(d.familia_id),
    env.DB.prepare("DELETE FROM dispositivos WHERE familia_id = ?").bind(d.familia_id),
    env.DB.prepare("DELETE FROM familias WHERE id = ?").bind(d.familia_id)
  ]);
  return json({ borrada: true });
});

ruta("POST", "/api/familia/invitaciones", async (req, env) => {
  const d = await dispositivo(req, env);
  return json(await crearInvitacion(env, "miembro", d.familia_id), 201);
});

ruta("GET", "/api/dispositivos", async (req, env) => {
  const d = await dispositivo(req, env);
  const { results } = await env.DB.prepare("SELECT id, nombre, creado, ultimo_uso FROM dispositivos WHERE familia_id = ? AND revocado IS NULL ORDER BY creado").bind(d.familia_id).all();
  return json({ dispositivos: results.map(x => ({ ...x, esEste: x.id === d.id })) });
});

ruta("DELETE", "/api/dispositivos/:id", async (req, env, p) => {
  const d = await dispositivo(req, env);
  const r = await env.DB.prepare("UPDATE dispositivos SET revocado = ?, suscripcion = NULL WHERE id = ? AND familia_id = ? AND revocado IS NULL").bind(ahora(), p.id, d.familia_id).run();
  if (!r.meta.changes) throw new HttpError(404, "Ese móvil no está en vuestra familia.");
  return json({ revocado: true });
});

// Colegios y clases disponibles, para elegir la clase de cada peque.
ruta("GET", "/api/catalogo", async (req, env) => {
  await dispositivo(req, env);
  const { results } = await env.DB.prepare("SELECT ambito, id, colegio_id, nombre FROM capas ORDER BY nombre").all();
  const colegios = results.filter(r => r.ambito === "colegio").map(c => ({ id: c.id, nombre: c.nombre, clases: results.filter(r => r.ambito === "clase" && r.colegio_id === c.id).map(r => ({ id: r.id, nombre: r.nombre })) }));
  return json({ colegios });
});

// La agenda compartida de las clases que sigue la familia (y de sus colegios).
ruta("GET", "/api/agenda", async (req, env) => {
  const d = await dispositivo(req, env);
  const { results } = await env.DB.prepare(`
    SELECT c.ambito, c.id, c.colegio_id, c.nombre, c.datos, c.version FROM capas c
    WHERE (c.ambito = 'clase' AND c.id IN (SELECT clase_id FROM familia_clases WHERE familia_id = ?1))
       OR (c.ambito = 'colegio' AND c.id IN (SELECT k.colegio_id FROM capas k JOIN familia_clases fc ON fc.clase_id = k.id AND k.ambito = 'clase' WHERE fc.familia_id = ?1))`).bind(d.familia_id).all();
  const agenda = { colegios: {}, clases: {} };
  for (const r of results) {
    const capa = { nombre: r.nombre, version: r.version, datos: JSON.parse(r.datos) };
    if (r.ambito === "colegio") agenda.colegios[r.id] = capa;
    else agenda.clases[r.id] = { ...capa, colegio: r.colegio_id };
  }
  return json(agenda);
});

// Publicar la agenda de un colegio o una clase. Crear: solo administración. Actualizar: administración
// o familias gestoras (de esa clase, o de su colegio). Con `base`, falla si alguien publicó antes.
ruta("PUT", "/api/capas/:ambito/:id", async (req, env, p) => {
  if (!["colegio", "clase"].includes(p.ambito) || !ID_CAPA.test(p.id)) throw new HttpError(404, "No existe.");
  const b = await leerJson(req, MAX_CAPA + 16 * 1024);
  const actual = await env.DB.prepare("SELECT * FROM capas WHERE ambito = ? AND id = ?").bind(p.ambito, p.id).first();
  const adminOk = await esAdmin(req, env);
  if (!adminOk) {
    if (!actual) throw new HttpError(403, "Solo la administración puede crear colegios y clases.");
    const d = await dispositivo(req, env);
    const g = await env.DB.prepare("SELECT 1 FROM gestores WHERE familia_id = ? AND ((ambito = ? AND capa_id = ?) OR (ambito = 'colegio' AND capa_id = ?))")
      .bind(d.familia_id, p.ambito, p.id, actual.colegio_id || p.id).first();
    if (!g) throw new HttpError(403, "Vuestra familia no gestiona esta agenda.");
  }
  if (!b.datos || typeof b.datos !== "object" || Array.isArray(b.datos)) throw new HttpError(400, "Faltan los datos.");
  const datos = JSON.stringify(b.datos);
  if (datos.length > MAX_CAPA) throw new HttpError(413, "Los datos son demasiado grandes.");
  const nombre = b.nombre === undefined && actual ? actual.nombre : texto(b.nombre, 80, "nombre");
  let colegio = null;
  if (p.ambito === "clase") {
    colegio = b.colegio === undefined && actual ? actual.colegio_id : b.colegio;
    if (typeof colegio !== "string" || !(await env.DB.prepare("SELECT 1 FROM capas WHERE ambito = 'colegio' AND id = ?").bind(colegio).first())) throw new HttpError(400, "La clase tiene que pertenecer a un colegio existente.");
  }
  if (b.base !== undefined && (!actual || actual.version !== b.base)) throw new HttpError(409, "Alguien ha publicado antes. Vuelve a descargar y revisa.", { version: actual ? actual.version : 0 });
  if (actual) {
    await env.DB.prepare("UPDATE capas SET nombre = ?, colegio_id = ?, datos = ?, version = version + 1, actualizada = ? WHERE ambito = ? AND id = ?")
      .bind(nombre, colegio, datos, ahora(), p.ambito, p.id).run();
  } else {
    await env.DB.prepare("INSERT INTO capas (ambito, id, colegio_id, nombre, datos, version, actualizada) VALUES (?, ?, ?, ?, ?, 1, ?)")
      .bind(p.ambito, p.id, colegio, nombre, datos, ahora()).run();
  }
  return json({ version: actual ? actual.version + 1 : 1 }, actual ? 200 : 201);
});

ruta("GET", "/api/capas/:ambito/:id", async (req, env, p) => {
  if (!(await esAdmin(req, env))) await dispositivo(req, env);
  const c = await env.DB.prepare("SELECT * FROM capas WHERE ambito = ? AND id = ?").bind(p.ambito, p.id).first();
  if (!c) throw new HttpError(404, "No existe.");
  return json({ nombre: c.nombre, colegio: c.colegio_id, version: c.version, datos: JSON.parse(c.datos) });
});

// ---------- Administración ----------
ruta("POST", "/api/admin/invitaciones", async (req, env) => {
  await admin(req, env);
  return json(await crearInvitacion(env, "familia"), 201);
});

ruta("POST", "/api/admin/gestores", async (req, env) => {
  await admin(req, env);
  const b = await leerJson(req);
  if (!["colegio", "clase"].includes(b.ambito) || typeof b.id !== "string" || typeof b.familiaId !== "string") throw new HttpError(400, "Faltan familiaId, ambito o id.");
  if (!(await env.DB.prepare("SELECT 1 FROM familias WHERE id = ?").bind(b.familiaId).first())) throw new HttpError(404, "Esa familia no existe.");
  await env.DB.prepare("INSERT OR IGNORE INTO gestores (familia_id, ambito, capa_id) VALUES (?, ?, ?)").bind(b.familiaId, b.ambito, b.id).run();
  return json({ ok: true }, 201);
});

async function api(request, env) {
  const { pathname } = new URL(request.url);
  for (const r of rutas) {
    const m = request.method === r.metodo && pathname.match(r.re);
    if (m) return r.fn(request, env, m.groups || {});
  }
  throw new HttpError(404, "No existe.");
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: "Error interno. Vuelve a intentarlo en un rato." }, 500);
    }
  }
};
