// Migración desde KiBi con los datos ficticios de tests/fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { migrar } from "../scripts/migrar.mjs";
const require = createRequire(import.meta.url);
const A = require("../public/agenda.js"), L = require("../public/logica.js");
const { validarCapa } = require("../scripts/validacion.cjs");

const K = JSON.parse(readFileSync("tests/fixtures/eventos.sintetico.json", "utf8"));
const cfg = { colegio: { id: "cole-ficticio", nombre: "Colegio Ficticio" }, clases: { nico: { id: "ficticio-1b", nombre: "1º B" }, vera: { id: "ficticio-i3", nombre: "Infantil 3" } }, personal: "extraescolar|cumplea" };

test("reparte entre colegio, clases y familia, y el resultado da la misma agenda", () => {
  const { capas, familia } = migrar(K, cfg);
  const [colegio, clase1b, claseI3] = capas;
  assert.deepEqual(colegio.datos.eventos.map(e => e.titulo), ["Fotos de grupo", "Fiesta de fin de curso"], "lo de los dos peques va al colegio");
  assert.deepEqual(clase1b.datos.semanal.map(s => s.titulo), ["Educación Física"]);
  assert.deepEqual(claseI3.datos.semanal.map(s => s.titulo), ["Día de la fruta"]);
  assert.ok(!JSON.stringify(capas).includes("Natación"), "la extraescolar no va a la clase");
  assert.deepEqual(familia.entradas.map(e => [e.tipo, e.titulo]).sort(), [["cumple", "Vera"], ["extra", "Natación (extraescolar)"]]);
  for (const c of capas) assert.deepEqual(validarCapa(c.datos, c.ambito, colegio.datos).errores, [], c.id);

  // La agenda compuesta en alDia tiene lo mismo que la de KiBi.
  const agenda = { colegios: { [colegio.id]: { nombre: colegio.nombre, datos: colegio.datos } }, clases: Object.fromEntries(capas.slice(1).map(c => [c.id, { nombre: c.nombre, colegio: c.colegio, datos: c.datos }])) };
  const D = A.componer(familia, agenda);
  // Desde el inicio de curso: las extraescolares migradas empiezan ese día.
  for (let d = L.parse(K.curso.inicio); L.iso(d) <= "2027-07-15"; d = L.addDays(d, 1)) {
    const f = L.iso(d);
    for (const n of K.ninos) {
      const titulos = D2 => L.itemsDe(D2, n.id, f).map(i => i.titulo.replace(/^Cumpleaños · Vera$/, "Cumpleaños de Vera")).sort();
      assert.deepEqual(titulos(D), titulos(K), `${n.id} ${f}`);
      assert.equal(L.sinCole(D, f, n.id), L.sinCole(K, f), `${n.id} ${f}`);
    }
  }
  assert.equal(L.tono(D, "nico"), "verde", "se conserva el color");
});
