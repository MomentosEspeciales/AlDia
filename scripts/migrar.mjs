// Pasa los datos de KiBi (un único archivo por familia) a las capas de alDia:
//   - colegio: curso, horario, festivos y lo que es para todos los peques de la familia en ese colegio
//   - una clase por peque: sus actividades semanales y circulares
//   - familia: lo personal (extraescolares, cumpleaños…), que se importa desde la app y se cifra allí
//
//   node scripts/migrar.mjs datos/eventos.json datos/migracion.json
//   CODIGO_FAMILIAR=... node scripts/migrar.mjs datos.cifrados.json datos/migracion.json
//
// datos/migracion.json:
//   { "colegio": { "id": "mi-cole", "nombre": "Mi colegio" },
//     "clases": { "<id del peque en KiBi>": { "id": "mi-cole-1b-2026", "nombre": "1º B" } },
//     "personal": "extraescolar|cumple" }      ← expresión: lo que coincide va a la familia
//
// Escribe en datos/ (no se sube a git): colegio-<id>.json, clase-<id>.json y familia.json.
// Revisa el resumen y los archivos antes de publicar con scripts/publicar.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { descifrar } = require("../public/cripto.js");
const L = require("../public/logica.js");
const A = require("../public/agenda.js");

export function migrar(K, cfg) {
  const personal = new RegExp(cfg.personal || "extraescolar|cumplea", "i");
  const conClase = K.ninos.filter(n => cfg.clases[n.id]);
  const esPersonal = x => x.anual || personal.test(`${x.titulo} ${x.detalle || ""}`);
  const limpio = ({ nino, ninos, ...x }) => x;
  const colegio = { curso: K.curso, horario: K.horario, sinCole: K.sinCole, actualizado: K.actualizado, eventos: [], tareas: [] };
  const clases = Object.fromEntries(conClase.map(n => [n.id, { semanal: [], eventos: [], tareas: [], actualizado: K.actualizado }]));
  const familia = A.familiaVacia();
  const resumen = { colegio: [], familia: [], aviso: [] };
  Object.keys(clases).forEach(id => { resumen["clase " + cfg.clases[id].id] = []; });
  const aClase = (id, tipo, x) => { clases[id][tipo].push(limpio(x)); resumen["clase " + cfg.clases[id].id].push(x.titulo); };
  let n = 0;
  const entrada = (x, extra) => { familia.entradas.push({ id: "kibi-" + (++n), titulo: x.titulo, ninos: x.ninos || [x.nino], hora: x.hora || "", lugar: "", detalle: x.detalle || "", llevar: x.llevar || "", fecha: "", hasta: "", dias: [], anual: false, soloConCole: false, ...extra }); resumen.familia.push(x.titulo); };

  for (const s of K.semanal) {
    if (esPersonal(s) || !clases[s.nino]) entrada(s, { tipo: "extra", fecha: s.desde || K.curso.inicio, hasta: s.hasta || "", dias: [s.dia], soloConCole: !!s.soloConCole });
    else aClase(s.nino, "semanal", s);
  }
  const reparto = (x, tipo) => {
    const todos = conClase.length > 1 && conClase.every(c => x.ninos.includes(c.id));
    if (todos) { colegio[tipo].push(limpio(x)); resumen.colegio.push(x.titulo); }
    else for (const id of x.ninos) if (clases[id]) aClase(id, tipo, x);
  };
  for (const e of K.eventos) {
    if (!esPersonal(e)) { reparto(e, "eventos"); continue; }
    if (e.desde) { reparto(e, "eventos"); resumen.aviso.push(`«${e.titulo}» es un periodo (desde/hasta): se queda en el colegio o la clase, revísalo.`); continue; }
    const tipo = e.anual ? "cumple" : "evento";
    const titulo = e.anual ? e.titulo.replace(/^cumplea(ñ|n)os( de)?\s*/i, "") || e.titulo : e.titulo;
    for (const fecha of e.fecha ? [e.fecha] : e.fechas) entrada({ ...e, titulo }, { tipo, fecha, anual: !!e.anual });
  }
  for (const t of K.tareas) {
    if (esPersonal(t)) entrada(t, { tipo: "tarea", fecha: t.limite || "" });
    else reparto(t, "tareas");
  }
  familia.ninos = K.ninos.map(k => ({ id: k.id, nombre: k.nombre, color: L.tono(K, k.id), curso: k.curso || "", clase: cfg.clases[k.id] ? cfg.clases[k.id].id : "" }));
  const doc = A.validarFamilia(familia);
  const capas = [
    { ambito: "colegio", id: cfg.colegio.id, nombre: cfg.colegio.nombre, datos: colegio },
    ...Object.entries(clases).map(([nino, datos]) => ({ ambito: "clase", id: cfg.clases[nino].id, nombre: cfg.clases[nino].nombre, colegio: cfg.colegio.id, datos }))
  ];
  return { capas, familia: doc, resumen };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origen, archivoCfg] = process.argv.slice(2);
  if (!origen || !archivoCfg) { console.error("Uso: node scripts/migrar.mjs <eventos.json|datos.cifrados.json> <migracion.json>"); process.exit(2); }
  let K = JSON.parse(readFileSync(origen, "utf8"));
  if (K.sal && K.datos) {
    if (!process.env.CODIGO_FAMILIAR) { console.error("Ese archivo está cifrado: falta CODIGO_FAMILIAR."); process.exit(2); }
    K = await descifrar(K, process.env.CODIGO_FAMILIAR);
  }
  const { capas, familia, resumen } = migrar(K, JSON.parse(readFileSync(archivoCfg, "utf8")));
  mkdirSync("datos", { recursive: true });
  for (const c of capas) writeFileSync(`datos/${c.ambito}-${c.id}.json`, JSON.stringify(c, null, 2) + "\n");
  writeFileSync("datos/familia.json", JSON.stringify(familia, null, 2) + "\n");
  for (const [donde, titulos] of Object.entries(resumen)) if (titulos.length) console.log(`\n${donde} (${titulos.length}):\n  - ${titulos.join("\n  - ")}`);
  console.log(`\nArchivos en datos/: ${capas.map(c => `${c.ambito}-${c.id}.json`).join(", ")} y familia.json`);
  console.log("Siguiente paso: revisa los archivos, publica las capas (scripts/publicar.mjs) e importa familia.json desde la app.");
}
