// Crea una invitación para que una familia nueva entre en alDia (caduca en 30 días, un solo uso).
//   ALDIA_URL=https://... ADMIN_TOKEN=... node scripts/invitar.mjs
const { ALDIA_URL, ADMIN_TOKEN } = process.env;
if (!ALDIA_URL || !ADMIN_TOKEN) { console.error("Faltan ALDIA_URL y ADMIN_TOKEN."); process.exit(2); }
const r = await fetch(new URL("/api/admin/invitaciones", ALDIA_URL), { method: "POST", headers: { authorization: "Bearer " + ADMIN_TOKEN } });
const datos = await r.json().catch(() => ({}));
if (!r.ok) { console.error("No se ha podido crear:", datos.error || r.status); process.exit(1); }
console.log(`Enlace para la familia (caduca el ${datos.caduca.slice(0, 10)}):\n${new URL("/#crear=" + datos.codigo, ALDIA_URL)}`);
