// Familia: fusión entre móviles y composición con las capas de colegio y clase (datos ficticios).
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../public/agenda.js");
const L = require("../public/logica.js");

const t = s => `2026-10-0${s}T10:00:00.000Z`; // en el pasado: lo que se borra «ahora» es más reciente
const familia = extra => A.validarFamilia({ ...A.familiaVacia(), ...extra });
const nico = { id: "nico", nombre: "Nico", color: "verde", clase: "cole-a-1b", actualizado: t(1) };
const vera = { id: "vera", nombre: "Vera", clase: "cole-b-i3", actualizado: t(1) };
const entrada = (id, ninos, extra = {}) => ({ id, tipo: "evento", titulo: "Plan " + id, ninos, fecha: "2026-11-04", actualizado: t(1), ...extra });

const agenda = {
  colegios: {
    "cole-a": { nombre: "Colegio A", datos: { actualizado: "2026-10-30", curso: { inicio: "2026-09-08", fin: "2027-06-21" }, horario: { normal: "9–17", especiales: [] }, sinCole: [{ fecha: "2026-11-13", motivo: "Festivo A" }], eventos: [{ fecha: "2026-11-02", titulo: "Castañada" }] } },
    "cole-b": { nombre: "Colegio B", datos: { curso: { inicio: "2026-09-08", fin: "2027-06-21" }, horario: { normal: "9–13", especiales: [] }, sinCole: [{ fecha: "2026-11-16", motivo: "Festivo B" }] } }
  },
  clases: {
    "cole-a-1b": { nombre: "1º B", colegio: "cole-a", datos: { semanal: [{ dia: 5, titulo: "Educación Física", soloConCole: true }], tareas: [{ id: "t1", titulo: "Autorización", limite: "2026-11-10" }] } },
    "cole-b-i3": { nombre: "Infantil 3", colegio: "cole-b", datos: { eventos: [{ fecha: "2026-11-04", titulo: "Teatro", duda: "Falta la hora" }] } }
  }
};

test("componer: cada peque recibe lo de su clase y su colegio, y sus festivos", () => {
  const D = A.componer(familia({ ninos: [nico, vera], entradas: [entrada("e1", ["vera"])] }), agenda);
  assert.deepEqual(D.ninos.map(n => [n.id, n.curso, n.colegio]), [["nico", "1º B", "cole-a"], ["vera", "Infantil 3", "cole-b"]]);
  assert.ok(L.itemsDe(D, "nico", "2026-11-06").some(i => i.titulo === "Educación Física"));
  assert.ok(!L.itemsDe(D, "vera", "2026-11-06").some(i => i.titulo === "Educación Física"), "lo de 1º B no es de Vera");
  assert.ok(L.itemsDe(D, "nico", "2026-11-02").some(i => i.titulo === "Castañada"), "lo del colegio A es de Nico");
  assert.ok(!L.itemsDe(D, "vera", "2026-11-02").length, "y no de Vera, que va al colegio B");
  assert.deepEqual(L.itemsDe(D, "vera", "2026-11-04").map(i => i.titulo).sort(), ["Plan e1", "Teatro"]);
  assert.equal(L.itemsDe(D, "vera", "2026-11-04").find(i => i.titulo === "Teatro").duda, "Falta la hora");
  assert.equal(L.sinCole(D, "2026-11-13", "nico"), "Festivo A");
  assert.equal(L.sinCole(D, "2026-11-13", "vera"), null, "cada colegio tiene sus festivos");
  assert.equal(L.horario(D, "2026-11-12", "vera"), "9–13");
  assert.ok(!L.itemsDe(D, "nico", "2026-11-13").some(i => i.titulo === "Educación Física"), "soloConCole respeta el festivo de su colegio");
  assert.equal(D.tareas[0]._clave, "clase:cole-a-1b:t1");
  assert.equal(D.colegio, "Colegio A · Colegio B");
  assert.equal(D.actualizado, "2026-10-30");
});

test("componer: un peque sin clase solo tiene lo de la familia", () => {
  const D = A.componer(familia({ ninos: [{ id: "bebe", nombre: "Bebé", actualizado: t(1) }], entradas: [entrada("e1", ["bebe"])] }), agenda);
  assert.equal(L.sinCole(D, "2026-11-04", "bebe"), null);
  assert.equal(L.horario(D, "2026-11-04", "bebe"), "");
  assert.deepEqual(L.itemsDe(D, "bebe", "2026-11-04").map(i => i.titulo), ["Plan e1"]);
});

test("avisos con hermanos en colegios distintos", () => {
  const D = A.componer(familia({ ninos: [nico, vera] }), agenda);
  assert.match(L.resumenAviso(D, "2026-11-13", "manana").cuerpo, /^Nico: sin cole \(Festivo A\)$/m);
  const vacio = A.componer(familia({ ninos: [nico] }), agenda);
  assert.match(L.resumenAviso(vacio, "2026-11-13", "manana").cuerpo, /^Sin cole: Festivo A$/m);
});

test("fusionar: une cambios de dos móviles y gana lo más reciente", () => {
  const base = familia({ ninos: [nico], entradas: [entrada("e1", ["nico"])] });
  const movilA = familia({ ...base, entradas: [entrada("e1", ["nico"], { titulo: "Editado en A", actualizado: t(3) })] });
  const movilB = familia({ ...base, entradas: [...base.entradas, entrada("e2", ["nico"], { actualizado: t(2) })], hechas: { "clase:cole-a-1b:t1": { hecha: true, actualizado: t(2) } } });
  const ab = A.fusionar(movilA, movilB), ba = A.fusionar(movilB, movilA);
  assert.deepEqual(ab, ba, "da igual el orden");
  assert.deepEqual(ab.entradas.map(e => e.titulo), ["Editado en A", "Plan e2"]);
  assert.ok(A.estaHecha(ab, "clase:cole-a-1b:t1"));
});

test("fusionar: lo borrado en un móvil no vuelve desde otro", () => {
  const base = familia({ ninos: [nico, vera], entradas: [entrada("e1", ["nico"]), entrada("e2", ["vera"])] });
  const conBorrado = A.borrarEntrada(base, "e1");
  const sinNico = A.borrarNino(base, "nico");
  const f = A.fusionar(A.fusionar(base, conBorrado), sinNico);
  assert.deepEqual(f.entradas.map(e => e.id), ["e2"]);
  assert.deepEqual(f.ninos.map(n => n.id), ["vera"]);
  assert.ok(f.borrados["entrada:e1"] && f.borrados["nino:nico"]);
});

test("fusionar: una entrada de un peque borrado en otro móvil desaparece sin romper nada", () => {
  const base = familia({ ninos: [nico, vera] });
  const a = A.borrarNino(base, "nico");
  const b = A.guardarEntrada(base, entrada("e9", ["nico"]));
  const f = A.fusionar(a, b);
  assert.deepEqual(f.ninos.map(n => n.id), ["vera"]);
  assert.deepEqual(f.entradas, []);
});

test("validarFamilia rechaza datos que no son de alDia y limpia lo incoherente", () => {
  assert.throws(() => A.validarFamilia({ formato: "otra-cosa" }));
  assert.throws(() => A.validarNinos([{ id: "A B", nombre: "x" }]));
  assert.throws(() => A.validarNinos([{ id: "a", nombre: "" }]));
  const f = A.validarFamilia({ ...A.familiaVacia(), ninos: [{ id: "a", nombre: "Ana", color: "fucsia" }], entradas: [entrada("e1", ["a", "fantasma"])], borrados: { "raro:x": t(1), "nino:b": "no-es-fecha" } });
  assert.equal(f.ninos[0].color, "", "un color desconocido se ignora");
  assert.deepEqual(f.entradas[0].ninos, ["a"]);
  assert.deepEqual(f.borrados, {});
});
