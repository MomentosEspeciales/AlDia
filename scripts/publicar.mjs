// Publica la agenda de colegios y clases en alDia (crea o actualiza).
//   ALDIA_URL=https://... ADMIN_TOKEN=... node scripts/publicar.mjs datos/colegio-x.json datos/clase-y.json …
// Revisa cada archivo antes; si alguno tiene errores no publica nada. Publica los colegios primero.
import { readFileSync } from "node:fs";
import { revisar } from "./validar.mjs";

const { ALDIA_URL, ADMIN_TOKEN } = process.env;
if (!ALDIA_URL || !ADMIN_TOKEN) { console.error("Faltan ALDIA_URL y ADMIN_TOKEN."); process.exit(2); }
const capas = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, "utf8")));
if (!capas.length) { console.error("Indica los archivos que quieres publicar."); process.exit(2); }
capas.sort((a, b) => (a.ambito === "colegio" ? 0 : 1) - (b.ambito === "colegio" ? 0 : 1));

const colegios = Object.fromEntries(capas.filter(c => c.ambito === "colegio").map(c => [c.id, c]));
if (!capas.every(c => revisar(c, colegios[c.colegio]))) { console.error("Hay errores: no se publica nada."); process.exit(1); }

for (const c of capas) {
  const r = await fetch(new URL(`/api/capas/${c.ambito}/${c.id}`, ALDIA_URL), {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer " + ADMIN_TOKEN },
    body: JSON.stringify({ nombre: c.nombre, colegio: c.colegio, datos: c.datos })
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`✗ ${c.ambito} ${c.id}: ${datos.error || r.status}`); process.exit(1); }
  console.log(`✓ ${c.ambito} ${c.id} publicado (versión ${datos.version}).`);
}
