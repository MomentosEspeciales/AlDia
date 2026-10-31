// Datos de la familia: validación, fusión entre móviles y composición con las capas de colegio y clase.
// Lo usan la app (navegador) y las pruebas (Node).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./logica.js"));
  else root.Agenda = factory(root.Logica);
})(typeof self !== "undefined" ? self : this, function (L) {
  const TIPOS = ["cumple", "tarea", "extra", "evento"];
  const marca = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? v : "";
  const fechaValida = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && L.iso(L.parse(s)) === s;
  function validarLista(lista, ninos) {
    if (!Array.isArray(lista) || lista.length > 500) throw Error("La copia debe contener como máximo 500 anotaciones.");
    const ids = new Set();
    return lista.map(e => {
      if (!e || typeof e !== "object" || !TIPOS.includes(e.tipo)) throw Error("Hay una anotación de tipo desconocido.");
      if (typeof e.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(e.id) || ids.has(e.id)) throw Error("La copia contiene identificadores incorrectos o repetidos.");
      ids.add(e.id);
      const texto = (k, max = 2000) => {
        if (e[k] != null && typeof e[k] !== "string") throw Error("Uno de los textos no es válido.");
        const s = (e[k] || "").trim();
        if (s.length > max) throw Error("Uno de los textos es demasiado largo.");
        return s;
      };
      const titulo = texto("titulo", 160);
      if (!titulo) throw Error("Escribe un nombre o título.");
      if (!Array.isArray(e.ninos) || !e.ninos.length || e.ninos.some(id => !ninos.includes(id))) throw Error("Selecciona al menos un peque de esta familia.");
      const fecha = e.fecha || "", hasta = e.hasta || "", hora = e.hora || "";
      if ((e.tipo !== "tarea" || fecha) && !fechaValida(fecha)) throw Error("Revisa la fecha.");
      if (hasta && (!fechaValida(hasta) || hasta < fecha)) throw Error("El final no puede ser anterior al inicio.");
      if (hora && (typeof hora !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora))) throw Error("Revisa la hora.");
      const dias = Array.isArray(e.dias) ? [...new Set(e.dias)] : [];
      if (e.tipo === "extra" && (!dias.length || dias.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw Error("Elige los días de la extraescolar.");
      return { id: e.id, actualizado: marca(e.actualizado), tipo: e.tipo, titulo, ninos: [...new Set(e.ninos)], fecha, hasta: e.tipo === "extra" ? hasta : "", hora: e.tipo === "tarea" ? "" : hora, lugar: texto("lugar", 240), detalle: texto("detalle"), llevar: texto("llevar", 500), dias: e.tipo === "extra" ? dias : [], anual: e.tipo === "cumple" && e.anual === true, soloConCole: e.tipo === "extra" && e.soloConCole === true };
    });
  }
  function aplicar(base, entradas) {
    const D = { ...base, semanal: [...base.semanal], eventos: [...base.eventos], tareas: [...base.tareas] };
    for (const e of entradas) {
      const detalle = [e.lugar && "Lugar: " + e.lugar, e.detalle].filter(Boolean).join(" · ");
      const comun = { titulo: e.tipo === "cumple" ? "Cumpleaños · " + e.titulo : e.titulo, detalle, llevar: e.llevar, hora: e.hora };
      if (e.tipo === "tarea") D.tareas.push({ ...comun, ninos: e.ninos, limite: e.fecha, _personalId: e.id, _clave: "personal:" + e.id });
      else if (e.tipo === "extra") {
        for (const nino of e.ninos) for (const dia of e.dias) D.semanal.push({ ...comun, nino, dia, desde: e.fecha, hasta: e.hasta, soloConCole: e.soloConCole });
      } else D.eventos.push({ ...comun, ninos: e.ninos, fecha: e.fecha, anual: e.anual });
    }
    return D;
  }

  // ---------- Familia ----------
  // { formato, version, ninos[], entradas[], hechas{clave: {hecha, actualizado}}, borrados{"nino:id"|"entrada:id": marca} }
  // Cada niño y cada entrada lleva `actualizado` (ISO): al fusionar dos móviles gana la versión más reciente.
  const FORMATO = "aldia-familia";
  const ahora = () => new Date().toISOString();
  const familiaVacia = () => ({ formato: FORMATO, version: 1, ninos: [], entradas: [], hechas: {}, borrados: {} });

  function validarNinos(lista) {
    if (!Array.isArray(lista) || lista.length > 12) throw Error("Puede haber como máximo 12 peques.");
    const ids = new Set();
    return lista.map(n => {
      if (!n || typeof n.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(n.id) || ids.has(n.id)) throw Error("Hay un peque con un identificador incorrecto o repetido.");
      ids.add(n.id);
      const nombre = typeof n.nombre === "string" ? n.nombre.trim() : "";
      if (!nombre || nombre.length > 40) throw Error("Escribe el nombre del peque (máximo 40 letras).");
      const texto = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
      return { id: n.id, nombre, color: L.TONOS.includes(n.color) ? n.color : "", curso: texto(n.curso, 60), clase: texto(n.clase, 80), actualizado: marca(n.actualizado) };
    });
  }

  // Deja la familia en un estado coherente: sin entradas de peques que ya no existen.
  function validarFamilia(doc) {
    if (!doc || doc.formato !== FORMATO || doc.version !== 1) throw Error("No son datos de familia de alDia.");
    const ninos = validarNinos(doc.ninos || []);
    const ids = new Set(ninos.map(n => n.id));
    const entradas = validarLista((doc.entradas || [])
      .map(e => e && Array.isArray(e.ninos) ? { ...e, ninos: e.ninos.filter(id => ids.has(id)) } : e)
      .filter(e => e && e.ninos && e.ninos.length), [...ids]);
    const hechas = {};
    for (const [k, v] of Object.entries(doc.hechas || {})) {
      if (typeof k === "string" && k.length <= 300 && v && typeof v.hecha === "boolean") hechas[k] = { hecha: v.hecha, actualizado: marca(v.actualizado) };
    }
    const borrados = {};
    for (const [k, v] of Object.entries(doc.borrados || {})) if (/^(nino|entrada):[\w-]{1,80}$/.test(k) && marca(v)) borrados[k] = v;
    return { formato: FORMATO, version: 1, ninos, entradas, hechas, borrados };
  }

  const masReciente = (a, b) => {
    const ta = a.actualizado || "", tb = b.actualizado || "";
    if (ta !== tb) return ta > tb ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b; // mismo instante: elección estable
  };
  // Une lo de dos móviles. Es conmutativa: da igual cuál sea la local y cuál la del servidor.
  function fusionar(a, b) {
    a = validarFamilia(a); b = validarFamilia(b);
    const borrados = { ...a.borrados };
    for (const [k, v] of Object.entries(b.borrados)) if (!borrados[k] || v > borrados[k]) borrados[k] = v;
    const unir = (xs, ys, tipo) => {
      const m = new Map();
      for (const x of [...xs, ...ys]) m.set(x.id, m.has(x.id) ? masReciente(m.get(x.id), x) : x);
      return [...m.values()].filter(x => !(borrados[tipo + ":" + x.id] >= (x.actualizado || ""))).sort((x, y) => x.id.localeCompare(y.id));
    };
    const hechas = { ...a.hechas };
    for (const [k, v] of Object.entries(b.hechas)) hechas[k] = hechas[k] ? masReciente(hechas[k], v) : v;
    return validarFamilia({ formato: FORMATO, version: 1, ninos: unir(a.ninos, b.ninos, "nino"), entradas: unir(a.entradas, b.entradas, "entrada"), hechas, borrados });
  }

  // Cambios que hace la app (siempre con marca de tiempo, para que la fusión sepa qué es más nuevo).
  function guardarNino(doc, nino) {
    const n = { ...nino, actualizado: ahora() };
    return validarFamilia({ ...doc, ninos: [...doc.ninos.filter(x => x.id !== n.id), n] });
  }
  function borrarNino(doc, id) {
    const t = ahora();
    return validarFamilia({ ...doc, ninos: doc.ninos.filter(x => x.id !== id), borrados: { ...doc.borrados, ["nino:" + id]: t },
      entradas: doc.entradas.map(e => e.ninos.includes(id) ? { ...e, ninos: e.ninos.filter(x => x !== id), actualizado: t } : e) });
  }
  function guardarEntrada(doc, entrada) {
    const e = { ...entrada, actualizado: ahora() };
    return validarFamilia({ ...doc, entradas: [...doc.entradas.filter(x => x.id !== e.id), e] });
  }
  function borrarEntrada(doc, id) {
    return validarFamilia({ ...doc, entradas: doc.entradas.filter(x => x.id !== id), borrados: { ...doc.borrados, ["entrada:" + id]: ahora() } });
  }
  function marcarHecha(doc, clave, hecha) {
    return validarFamilia({ ...doc, hechas: { ...doc.hechas, [clave]: { hecha, actualizado: ahora() } } });
  }
  const estaHecha = (doc, clave) => !!(doc.hechas[clave] && doc.hechas[clave].hecha);

  // ---------- Composición ----------
  // agenda = { colegios: { id: { nombre, datos } }, clases: { id: { nombre, colegio, datos } } }
  // Devuelve el mismo objeto D que usa logica.js. Lo de cada clase es para los peques de esa clase,
  // y lo del colegio para los peques de ese colegio.
  function componer(familia, agenda) {
    agenda = agenda || {};
    const colegios = agenda.colegios || {}, clases = agenda.clases || {};
    const ninos = familia.ninos.map(n => {
      const clase = n.clase && clases[n.clase];
      return { id: n.id, nombre: n.nombre, color: n.color, curso: n.curso || (clase ? clase.nombre : ""), clase: clase ? n.clase : "", colegio: clase ? clase.colegio : "" };
    });
    const D = { ninos, porColegio: {}, semanal: [], eventos: [], tareas: [] };
    const nombres = [], fechas = [];
    const anadir = (capa, ids, origen) => {
      for (const s of capa.semanal || []) for (const nino of ids) D.semanal.push({ ...s, nino });
      for (const e of capa.eventos || []) D.eventos.push({ ...e, ninos: ids });
      for (const t of capa.tareas || []) D.tareas.push({ ...t, ninos: ids, _clave: origen + ":" + (t.id || t.titulo) });
    };
    for (const id of new Set(ninos.map(n => n.colegio).filter(Boolean))) {
      const c = colegios[id];
      if (!c) continue;
      const d = c.datos || {};
      D.porColegio[id] = { curso: d.curso || null, horario: d.horario || { normal: "", especiales: [] }, sinCole: d.sinCole || [] };
      nombres.push(c.nombre);
      if (d.actualizado) fechas.push(d.actualizado);
      anadir(d, ninos.filter(n => n.colegio === id).map(n => n.id), "colegio:" + id);
    }
    for (const id of new Set(ninos.map(n => n.clase).filter(Boolean))) {
      const d = clases[id].datos || {};
      if (d.actualizado) fechas.push(d.actualizado);
      anadir(d, ninos.filter(n => n.clase === id).map(n => n.id), "clase:" + id);
    }
    const primero = Object.values(D.porColegio)[0];
    D.curso = primero ? primero.curso : null;
    D.horario = primero ? primero.horario : { normal: "", especiales: [] };
    D.sinCole = primero ? primero.sinCole : [];
    D.colegio = nombres.join(" · ");
    D.actualizado = fechas.sort().pop() || "";
    return aplicar(D, familia.entradas);
  }

  return { validarLista, aplicar, fechaValida, familiaVacia, validarNinos, validarFamilia, fusionar, guardarNino, borrarNino, guardarEntrada, borrarEntrada, marcarHecha, estaHecha, componer };
});
