// Lógica del día, avisos, colores y validación con datos ficticios (tests/fixtures).
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../public/logica.js");
const C = require("../public/cripto.js");
const { validarDatos } = require("../scripts/validacion.cjs");
const D = require("./fixtures/eventos.sintetico.json");
const copia = () => JSON.parse(JSON.stringify(D));

test("el cifrado va y vuelve, sin distinguir mayúsculas ni espacios en el código", async () => {
  const paquete = await C.cifrar(D, "Prueba Codigo");
  assert.deepEqual(await C.descifrar(paquete, "  prueba codigo "), D);
  await assert.rejects(C.descifrar(paquete, "otro"));
});

test("días sin cole, actividades semanales y eventos", () => {
  assert.equal(L.sinCole(D, "2026-11-13"), "Festivo de libre disposición");
  assert.equal(L.sinCole(D, "2026-11-12"), null);
  assert.equal(L.sinCole(D, "2026-12-25"), "Vacaciones de Navidad");
  assert.ok(L.itemsDe(D, "nico", "2026-11-05").some(i => i.titulo === "Natación (extraescolar)"), "jueves: natación");
  assert.ok(L.itemsDe(D, "nico", "2026-11-06").some(i => i.titulo === "Educación Física"), "viernes: EF");
  assert.ok(!L.itemsDe(D, "nico", "2026-11-13").some(i => i.titulo === "Educación Física"), "festivo: sin EF");
  assert.ok(L.itemsDe(D, "nico", "2027-03-05").some(i => i.titulo === "Piscina con el cole"));
  assert.equal(L.itemsDe(D, "vera", "2027-01-04").length, 0, "lunes de vacaciones: sin día de la fruta");
  assert.equal(L.itemsDe(D, "vera", "2027-11-20")[0].titulo, "Cumpleaños de Vera", "los anuales se repiten");
  assert.equal(L.horario(D, "2026-12-21"), "Jornada intensiva: 9:00–13:00");
});

test("los avisos agrupan lo común y solo salen si hay algo especial", () => {
  assert.equal(L.resumenAviso(D, "2026-11-10", "manana"), null, "martes normal: sin aviso");
  const fotos = L.resumenAviso(D, "2026-11-04", "manana");
  assert.equal(fotos.titulo, "Mañana, miércoles 4 de noviembre");
  assert.match(fotos.cuerpo, /^Nico y Vera: Fotos de grupo$/m);
  assert.match(L.resumenAviso(D, "2026-11-13", "hoy").cuerpo, /Sin cole: Festivo/);
  assert.match(L.resumenAviso(D, "2026-11-25", "hoy").cuerpo, /Último día: Devolver autorización/);
});

test("el modo privado muestra solo iniciales", () => {
  const a = L.resumenAviso(D, "2026-11-04", "manana", { privado: true });
  assert.match(a.cuerpo, /^N\. y V\.: Fotos de grupo$/m);
  assert.doesNotMatch(a.cuerpo, /Nico|Vera/);
});

test("cada peque tiene un color: el suyo o uno por orden", () => {
  assert.equal(L.tono(D, "nico"), "verde");
  assert.equal(L.tono(D, "vera"), "rosa");
  const tres = { ninos: [{ id: "a" }, { id: "b", color: "inventado" }, { id: "c" }] };
  assert.deepEqual(["a", "b", "c"].map(id => L.tono(tres, id)), ["azul", "rosa", "verde"]);
});

test("la duda de un evento llega a la tarjeta", () => {
  const fiesta = L.itemsDe(D, "nico", "2027-05-29").find(i => i.titulo === "Fiesta de fin de curso");
  assert.match(fiesta.duda, /sábado 30 de mayo/);
});

test("validación: los datos ficticios no tienen errores y la duda se lista", () => {
  const { errores, dudas } = validarDatos(D);
  assert.deepEqual(errores, []);
  assert.equal(dudas.length, 1);
  assert.match(dudas[0], /Fiesta de fin de curso/);
});

test("validación: detecta errores de formato", () => {
  const casos = [
    d => { d.eventos[0].ninos = ["desconocido"]; },
    d => { d.eventos[1].fecha = "2026-02-30"; },
    d => { d.semanal[0].dia = 7; },
    d => { d.semanal[1].hora = "25:00"; },
    d => { d.ninos.push({ id: "nico", nombre: "Otro" }); },
    d => { d.ninos[0].color = "fucsia"; },
    d => { d.sinCole[1].desde = "2027-02-01"; },
    d => { d.tareas[0].limite = "mañana"; },
    d => { delete d.eventos[2].fecha; },
    d => { d.eventos[2].titulo = " "; }
  ];
  for (const cambiar of casos) {
    const d = copia(); cambiar(d);
    assert.ok(validarDatos(d).errores.length > 0, cambiar.toString());
  }
});

test("validación: señala fechas dudosas, duplicados y días sin cole", () => {
  const d = copia();
  d.eventos.push({ fecha: "2027-05-30", ninos: ["nico"], titulo: "Fiesta", detalle: "El sábado 30 de mayo" });
  d.eventos.push({ fecha: "2026-11-04", ninos: ["vera"], titulo: "Fotos de grupo" });
  d.eventos.push({ fecha: "2026-11-13", ninos: ["nico"], titulo: "Excursión" });
  d.eventos.push({ fecha: "2027-07-10", ninos: ["nico"], titulo: "Campamento" });
  const dudas = validarDatos(d).dudas.join("\n");
  assert.match(dudas, /dice «sabado 30» pero el 2027-05-30 es domingo/);
  assert.match(dudas, /repetido/);
  assert.match(dudas, /día sin cole/);
  assert.match(dudas, /fuera del curso/);
});
