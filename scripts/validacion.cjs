// Comprueba que los datos de la agenda estén bien formados y señala lo dudoso.
// errores: cosas que romperían la app (se bloquea la publicación).
// dudas: cosas que conviene confirmar (se publica igual, pero se avisa).
const L = require("../public/logica.js");

const quitarAcentos = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DIAS_SIN = L.DIAS.map(quitarAcentos);
const MESES_SIN = L.MESES.map(quitarAcentos);
const fechaOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && L.iso(L.parse(s)) === s;
const horaOk = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function validarDatos(D) {
  const errores = [], dudas = [];
  const err = (donde, msg) => errores.push(`${donde}: ${msg}`);
  const duda = (donde, msg) => dudas.push(`${donde}: ${msg}`);
  if (!D || typeof D !== "object") return { errores: ["Los datos no son un objeto"], dudas };

  // Curso y niños
  if (!D.curso || !fechaOk(D.curso.inicio) || !fechaOk(D.curso.fin) || D.curso.inicio > D.curso.fin) err("curso", "inicio y fin deben ser fechas AAAA-MM-DD y el inicio anterior al fin");
  if (!D.horario || typeof D.horario.normal !== "string" || !Array.isArray(D.horario.especiales)) err("horario", "falta el horario normal o la lista de especiales");
  const ids = new Set();
  if (!Array.isArray(D.ninos) || !D.ninos.length) err("ninos", "tiene que haber al menos un peque");
  for (const [i, n] of (D.ninos || []).entries()) {
    const donde = `ninos[${i}]`;
    if (!n || typeof n.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(n.id)) err(donde, "id no válido (minúsculas, números, - o _)");
    else if (ids.has(n.id)) err(donde, `id repetido «${n.id}»`);
    else ids.add(n.id);
    if (!n || typeof n.nombre !== "string" || !n.nombre.trim()) err(donde, "falta el nombre");
    if (n && n.color != null && !L.TONOS.includes(n.color)) err(donde, `color «${n.color}» no existe (usa ${L.TONOS.join(", ")})`);
  }
  for (const k of ["sinCole", "semanal", "eventos", "tareas"]) if (!Array.isArray(D[k])) err(k, "tiene que ser una lista");
  if (errores.length) return { errores, dudas };

  // Fechas que cubre un elemento (fecha, fechas[] o desde/hasta).
  function rango(x, donde) {
    if (x.fecha != null) { if (!fechaOk(x.fecha)) err(donde, `fecha no válida «${x.fecha}»`); return; }
    if (x.fechas != null) {
      if (!Array.isArray(x.fechas) || !x.fechas.length) err(donde, "«fechas» tiene que ser una lista con al menos una fecha");
      else for (const f of x.fechas) if (!fechaOk(f)) err(donde, `fecha no válida «${f}»`);
      return;
    }
    if (x.desde != null || x.hasta != null) {
      if (!fechaOk(x.desde) || !fechaOk(x.hasta)) err(donde, "«desde» y «hasta» tienen que ser fechas válidas");
      else if (x.desde > x.hasta) err(donde, "«desde» es posterior a «hasta»");
      return;
    }
    err(donde, "falta la fecha (fecha, fechas o desde/hasta)");
  }
  const titulo = (x, donde) => { if (typeof x.titulo !== "string" || !x.titulo.trim()) err(donde, "falta el título"); };
  const hora = (x, donde) => { if (x.hora && !horaOk(x.hora)) err(donde, `hora no válida «${x.hora}»`); };
  const ninosOk = (lista, donde) => {
    if (!Array.isArray(lista) || !lista.length) err(donde, "falta para qué peques es");
    else for (const id of lista) if (!ids.has(id)) err(donde, `peque desconocido «${id}»`);
  };
  const nombre = x => `«${x.titulo || "sin título"}»`;

  D.sinCole.forEach((x, i) => { rango(x, `sinCole[${i}]`); if (!x.motivo) err(`sinCole[${i}]`, "falta el motivo"); });
  D.horario.especiales.forEach((x, i) => { rango(x, `horario.especiales[${i}]`); if (!x.texto) err(`horario.especiales[${i}]`, "falta el texto"); });
  D.semanal.forEach((x, i) => {
    const donde = `semanal[${i}] ${nombre(x)}`;
    titulo(x, donde); hora(x, donde);
    if (!ids.has(x.nino)) err(donde, `peque desconocido «${x.nino}»`);
    if (!Number.isInteger(x.dia) || x.dia < 0 || x.dia > 6) err(donde, "«dia» tiene que ir de 0 (domingo) a 6 (sábado)");
    for (const k of ["desde", "hasta"]) if (x[k] && !fechaOk(x[k])) err(donde, `«${k}» no es una fecha válida`);
    if (x.desde && x.hasta && x.desde > x.hasta) err(donde, "«desde» es posterior a «hasta»");
    if (x.duda) duda(donde, x.duda);
  });
  D.tareas.forEach((x, i) => {
    const donde = `tareas[${i}] ${nombre(x)}`;
    titulo(x, donde); ninosOk(x.ninos, donde);
    if (x.limite && !fechaOk(x.limite)) err(donde, `fecha límite no válida «${x.limite}»`);
    if (x.duda) duda(donde, x.duda);
  });
  const vistos = new Map();
  D.eventos.forEach((x, i) => {
    const donde = `eventos[${i}] ${nombre(x)}`;
    const antes = errores.length;
    titulo(x, donde); hora(x, donde); ninosOk(x.ninos, donde); rango(x, donde);
    if (x.duda) duda(donde, x.duda);
    if (errores.length > antes) return;

    const fechas = x.fecha ? [x.fecha] : x.fechas || [];
    // Fuera del curso (los cumpleaños y lo anual se repiten, así que no cuentan).
    if (!x.anual) {
      const fuera = (x.desde ? [x.desde, x.hasta] : fechas).filter(f => f < D.curso.inicio || f > D.curso.fin);
      if (fuera.length) duda(donde, `fuera del curso (${fuera.join(", ")})`);
      const sinClase = fechas.filter(f => { const m = L.sinCole(D, f); return m && m !== "Fin de semana" && m !== "Fuera del curso escolar"; });
      if (sinClase.length) duda(donde, `cae en un día sin cole (${sinClase.map(f => `${f}: ${L.sinCole(D, f)}`).join(", ")})`);
    }
    // El texto menciona un día de la semana que no cuadra con la fecha («sábado 30 de mayo» en domingo).
    const texto = quitarAcentos(`${x.titulo} ${x.detalle || ""}`);
    const re = new RegExp(`\\b(${DIAS_SIN.join("|")})\\s+(\\d{1,2})(?:\\s+de\\s+(${MESES_SIN.join("|")}))?`, "g");
    for (const [, dia, num, mes] of texto.matchAll(re)) {
      for (const f of fechas) {
        const d = L.parse(f);
        if (d.getDate() !== Number(num) || (mes && MESES_SIN[d.getMonth()] !== mes)) continue;
        if (DIAS_SIN[d.getDay()] !== dia) duda(donde, `el texto dice «${dia} ${num}» pero el ${f} es ${L.DIAS[d.getDay()]}`);
      }
    }
    // Duplicados: mismo título y mismas fechas para algún mismo peque.
    const clave = quitarAcentos(x.titulo.trim()) + "|" + (x.fecha || (x.fechas || []).join(",") || x.desde + "/" + x.hasta);
    const previo = vistos.get(clave);
    if (previo && previo.ninos.some(id => x.ninos.includes(id))) duda(donde, `parece repetido de eventos[${previo.i}]`);
    else vistos.set(clave, { i, ninos: x.ninos });
  });
  return { errores, dudas };
}

module.exports = { validarDatos };

// Valida la agenda de un colegio o de una clase (lo que se publica en /api/capas).
// Para una clase, `colegio` (los datos de su colegio) permite comprobar curso y festivos.
function validarCapa(capa, ambito, colegio) {
  if (!capa || typeof capa !== "object") return { errores: ["Los datos no son un objeto"], dudas: [] };
  const cal = ambito === "colegio" ? capa : (colegio || {});
  const D = {
    curso: cal.curso || { inicio: "2000-01-01", fin: "2100-12-31" },
    horario: cal.horario || { normal: "", especiales: [] },
    ninos: [{ id: "peque", nombre: "Peque" }],
    sinCole: cal.sinCole || [],
    semanal: (capa.semanal || []).map(s => ({ ...s, nino: "peque" })),
    eventos: (capa.eventos || []).map(e => ({ ...e, ninos: ["peque"] })),
    tareas: (capa.tareas || []).map(t => ({ ...t, ninos: ["peque"] }))
  };
  const r = validarDatos(D);
  if (ambito === "colegio" && !capa.curso) r.errores.push("curso: un colegio necesita inicio y fin de curso");
  return r;
}

module.exports.validarCapa = validarCapa;
