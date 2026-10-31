// API del Worker con una D1 local (Miniflare). Sin Cloudflare ni datos reales.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const ADMIN = "token-admin-de-prueba-muy-largo";
const blob = n => ({ v: 2, iv: "aXY=", datos: "cifrado-" + n });

async function arrancar() {
  const mf = new Miniflare({
    modules: true,
    scriptPath: "src/worker.js",
    compatibilityDate: "2026-07-14",
    d1Databases: ["DB"],
    bindings: { ADMIN_TOKEN: ADMIN },
    serviceBindings: { ASSETS: () => new Response("app", { status: 200 }) }
  });
  const db = await mf.getD1Database("DB");
  const sql = readFileSync("migrations/0001_inicial.sql", "utf8").replace(/--.*$/gm, "");
  await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const api = async (metodo, ruta, { token, cuerpo } = {}) => {
    const r = await mf.dispatchFetch("http://aldia.test" + ruta, {
      method: metodo,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    return { status: r.status, datos: await r.json() };
  };
  return { mf, db, api };
}

// Prepara un colegio con dos clases y una familia con su móvil.
async function escenario(api) {
  await api("PUT", "/api/capas/colegio/cole-ficticio", { token: ADMIN, cuerpo: { nombre: "Colegio Ficticio", datos: { curso: { inicio: "2026-09-08", fin: "2027-06-21" }, horario: { normal: "9–17", especiales: [] }, sinCole: [] } } });
  await api("PUT", "/api/capas/clase/ficticio-1b", { token: ADMIN, cuerpo: { nombre: "1º B", colegio: "cole-ficticio", datos: { semanal: [{ dia: 5, titulo: "Educación Física" }] } } });
  await api("PUT", "/api/capas/clase/ficticio-i3", { token: ADMIN, cuerpo: { nombre: "Infantil 3", colegio: "cole-ficticio", datos: { eventos: [] } } });
  const inv = await api("POST", "/api/admin/invitaciones", { token: ADMIN });
  const alta = await api("POST", "/api/familias", { cuerpo: { invitacion: inv.datos.codigo, dispositivo: "Móvil A", blob: blob(1) } });
  return { inv: inv.datos.codigo, ...alta.datos };
}

test("la app la sirven los assets y las rutas desconocidas de la API dan 404", async () => {
  const { mf, api } = await arrancar();
  const r = await mf.dispatchFetch("http://aldia.test/");
  assert.equal(await r.text(), "app");
  assert.equal((await api("GET", "/api/nada")).status, 404);
  await mf.dispose();
});

test("alta de familia con invitación de un solo uso", async () => {
  const { mf, api } = await arrancar();
  const f = await escenario(api);
  assert.ok(f.token && f.familiaId);
  const repetida = await api("POST", "/api/familias", { cuerpo: { invitacion: f.inv, dispositivo: "Otro", blob: blob(1) } });
  assert.equal(repetida.status, 403, "una invitación no se puede usar dos veces");
  assert.equal((await api("POST", "/api/familias", { cuerpo: { invitacion: "x".repeat(30), dispositivo: "Otro", blob: blob(1) } })).status, 403);
  assert.equal((await api("POST", "/api/admin/invitaciones", { token: "falso" })).status, 403, "sin token de administración no hay invitaciones");
  const sinCifrar = await api("POST", "/api/familias", { cuerpo: { invitacion: (await api("POST", "/api/admin/invitaciones", { token: ADMIN })).datos.codigo, dispositivo: "Otro", blob: { ninos: ["en claro"] } } });
  assert.equal(sinCifrar.status, 400, "los datos de la familia tienen que ir cifrados");
  await mf.dispose();
});

test("un segundo adulto se une y los dos comparten los datos con control de versiones", async () => {
  const { mf, api } = await arrancar();
  const a = await escenario(api);
  const inv = await api("POST", "/api/familia/invitaciones", { token: a.token });
  const b = (await api("POST", "/api/unirse", { cuerpo: { invitacion: inv.datos.codigo, dispositivo: "Móvil B" } })).datos;
  assert.equal(b.familiaId, a.familiaId);

  const g1 = await api("PUT", "/api/familia", { token: a.token, cuerpo: { blob: blob(2), base: 1, clases: ["ficticio-1b"] } });
  assert.deepEqual(g1.datos, { version: 2, clases: ["ficticio-1b"] });
  const conflicto = await api("PUT", "/api/familia", { token: b.token, cuerpo: { blob: blob(3), base: 1 } });
  assert.equal(conflicto.status, 409, "B partía de una versión vieja");
  assert.equal(conflicto.datos.version, 2);
  assert.deepEqual(conflicto.datos.blob, blob(2), "el 409 trae lo último para fusionar");
  assert.equal((await api("PUT", "/api/familia", { token: b.token, cuerpo: { blob: blob(3), base: 2 } })).datos.version, 3);
  const leida = await api("GET", "/api/familia", { token: a.token });
  assert.deepEqual(leida.datos.blob, blob(3));
  assert.deepEqual(leida.datos.clases, ["ficticio-1b"], "sin «clases», se conservan las de antes");
  assert.equal((await api("PUT", "/api/familia", { token: a.token, cuerpo: { blob: blob(4), base: 3, clases: ["no-existe"] } })).status, 400);
  await mf.dispose();
});

test("cada familia solo ve la agenda de sus clases y de sus colegios", async () => {
  const { mf, api } = await arrancar();
  const a = await escenario(api);
  await api("PUT", "/api/familia", { token: a.token, cuerpo: { blob: blob(2), base: 1, clases: ["ficticio-1b"] } });
  const agenda = (await api("GET", "/api/agenda", { token: a.token })).datos;
  assert.deepEqual(Object.keys(agenda.clases), ["ficticio-1b"]);
  assert.deepEqual(Object.keys(agenda.colegios), ["cole-ficticio"]);
  assert.equal(agenda.clases["ficticio-1b"].colegio, "cole-ficticio");
  assert.equal(agenda.clases["ficticio-1b"].datos.semanal[0].titulo, "Educación Física");

  const otra = await (async () => {
    const inv = await api("POST", "/api/admin/invitaciones", { token: ADMIN });
    return (await api("POST", "/api/familias", { cuerpo: { invitacion: inv.datos.codigo, dispositivo: "Móvil C", blob: blob(9) } })).datos;
  })();
  assert.deepEqual((await api("GET", "/api/agenda", { token: otra.token })).datos, { colegios: {}, clases: {} });
  assert.deepEqual((await api("GET", "/api/familia", { token: otra.token })).datos.blob, blob(9), "cada familia lee solo su blob");
  const catalogo = (await api("GET", "/api/catalogo", { token: otra.token })).datos;
  assert.deepEqual(catalogo.colegios[0].clases.map(c => c.id).sort(), ["ficticio-1b", "ficticio-i3"]);
  assert.equal((await api("GET", "/api/agenda")).status, 401);
  await mf.dispose();
});

test("quitar el acceso a un móvil y darse de baja", async () => {
  const { mf, api } = await arrancar();
  const a = await escenario(api);
  const inv = await api("POST", "/api/familia/invitaciones", { token: a.token });
  const b = (await api("POST", "/api/unirse", { cuerpo: { invitacion: inv.datos.codigo, dispositivo: "Móvil B" } })).datos;
  const lista = (await api("GET", "/api/dispositivos", { token: a.token })).datos.dispositivos;
  assert.deepEqual(lista.map(d => [d.nombre, d.esEste]), [["Móvil A", true], ["Móvil B", false]]);
  assert.equal((await api("DELETE", "/api/dispositivos/" + b.dispositivoId, { token: a.token })).status, 200);
  assert.equal((await api("GET", "/api/familia", { token: b.token })).status, 401, "el móvil revocado ya no entra");

  const otra = (await api("POST", "/api/familias", { cuerpo: { invitacion: (await api("POST", "/api/admin/invitaciones", { token: ADMIN })).datos.codigo, dispositivo: "X", blob: blob(1) } })).datos;
  assert.equal((await api("DELETE", "/api/dispositivos/" + a.dispositivoId, { token: otra.token })).status, 404, "no se puede revocar un móvil de otra familia");

  assert.equal((await api("DELETE", "/api/familia", { token: a.token })).status, 200);
  assert.equal((await api("GET", "/api/familia", { token: a.token })).status, 401, "tras la baja no queda nada");
  await mf.dispose();
});

test("publicar agendas: crear solo la administración, actualizar también las familias gestoras", async () => {
  const { mf, api } = await arrancar();
  const a = await escenario(api);
  assert.equal((await api("PUT", "/api/capas/clase/nueva", { token: a.token, cuerpo: { nombre: "X", colegio: "cole-ficticio", datos: {} } })).status, 403);
  assert.equal((await api("PUT", "/api/capas/clase/ficticio-1b", { token: a.token, cuerpo: { datos: { semanal: [] } } })).status, 403, "sin ser gestora no publica");
  await api("POST", "/api/admin/gestores", { token: ADMIN, cuerpo: { familiaId: a.familiaId, ambito: "clase", id: "ficticio-1b" } });
  const ok = await api("PUT", "/api/capas/clase/ficticio-1b", { token: a.token, cuerpo: { datos: { semanal: [] }, base: 1 } });
  assert.equal(ok.datos.version, 2);
  assert.equal((await api("PUT", "/api/capas/clase/ficticio-1b", { token: a.token, cuerpo: { datos: {}, base: 1 } })).status, 409, "base vieja");
  assert.equal((await api("PUT", "/api/capas/clase/ficticio-i3", { token: a.token, cuerpo: { datos: {} } })).status, 403, "solo gestiona su clase");
  assert.equal((await api("PUT", "/api/capas/clase/sin-cole", { token: ADMIN, cuerpo: { nombre: "X", colegio: "no-existe", datos: {} } })).status, 400);
  const capa = (await api("GET", "/api/capas/clase/ficticio-1b", { token: a.token })).datos;
  assert.equal(capa.nombre, "1º B");
  assert.equal(capa.colegio, "cole-ficticio");
  await mf.dispose();
});
