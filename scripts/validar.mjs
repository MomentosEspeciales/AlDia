// Revisa la agenda de un colegio o una clase antes de publicarla.
//   node scripts/validar.mjs datos/clase-x.json [datos/colegio-y.json]
// El archivo tiene la forma { ambito, id, nombre, colegio?, datos }.
// Sale con error si hay errores; las dudas solo se muestran.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validarCapa } = require("./validacion.cjs");

export function revisar(capa, colegio) {
  const { errores, dudas } = validarCapa(capa.datos, capa.ambito, colegio && colegio.datos);
  for (const d of dudas) console.log(`⚠️  ${capa.id}: ${d}`);
  for (const e of errores) console.log(`✗ ${capa.id}: ${e}`);
  console.log(`${capa.id}: ${errores.length} errores, ${dudas.length} dudas.`);
  return errores.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [archivo, archivoColegio] = process.argv.slice(2);
  if (!archivo) { console.error("Uso: node scripts/validar.mjs capa.json [colegio.json]"); process.exit(2); }
  const leer = f => JSON.parse(readFileSync(f, "utf8"));
  if (!revisar(leer(archivo), archivoColegio && leer(archivoColegio))) process.exit(1);
}
