// alDia · la app del móvil.
// Flujo: invitación → sesión guardada en el móvil → datos de la familia cifrados con la clave de la familia
// (que solo tienen sus móviles) → sincronización con el servidor → composición con la agenda de cada clase.
(function () {
  const L = window.Logica, C = window.Cripto, A = window.Agenda, S = window.Almacen;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (id, cls) => `<svg${cls ? ` class="${cls}"` : ""} aria-hidden="true"><use href="#${id}"/></svg>`;
  const pref = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const VISTAS = ["hoy", "manana", "semana"];
  let view = pref.get("vista") || "hoy";
  if (!VISTAS.includes(view)) view = "hoy";

  // ---------- Estado ----------
  let sesion = null;        // { familiaId, dispositivoId, token, clave }
  let clave = null;         // CryptoKey de la familia
  let familia = A.familiaVacia();
  let version = 0;          // versión del servidor de la que parten los datos locales
  let sucio = false;        // hay cambios locales sin subir
  let agenda = { colegios: {}, clases: {} };
  let catalogo = null;
  let D = null;
  let editando = null, editandoNino = null;

  // ---------- API ----------
  class ErrorApi extends Error { constructor(status, datos) { super(datos.error || "Error " + status); this.status = status; this.datos = datos; } }
  async function api(metodo, ruta, cuerpo, token = sesion && sesion.token) {
    const r = await fetch("/api" + ruta, {
      method: metodo,
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      cache: "no-store"
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErrorApi(r.status, datos);
    return datos;
  }

  // ---------- Guardado local y sincronización ----------
  const clasesDe = doc => [...new Set(doc.ninos.map(n => n.clase).filter(Boolean))].sort();
  async function guardarLocal() {
    const blob = await C.cifrarCon(familia, clave);
    await S.set("familia", { blob, version, sucio });
    await S.set("agenda", agenda);
  }

  let cola = Promise.resolve();
  const sincronizar = () => (cola = cola.then(sincronizarYa, sincronizarYa));
  async function sincronizarYa() {
    try {
      for (let intento = 0; intento < 4; intento++) {
        const remoto = await api("GET", "/familia");
        const docRemoto = A.validarFamilia(await C.descifrarCon(remoto.blob, clave));
        const fusion = A.fusionar(familia, docRemoto);
        const igual = JSON.stringify(fusion) === JSON.stringify(docRemoto);
        const clasesOk = JSON.stringify(clasesDe(fusion)) === JSON.stringify(remoto.clases);
        if (igual && clasesOk) { familia = fusion; version = remoto.version; sucio = false; break; }
        try {
          const r = await api("PUT", "/familia", { blob: await C.cifrarCon(fusion, clave), base: remoto.version, clases: clasesDe(fusion) });
          familia = fusion; version = r.version; sucio = false; break;
        } catch (e) { if (e.status !== 409) throw e; } // otro móvil guardó a la vez: se vuelve a fusionar
      }
      agenda = await api("GET", "/agenda");
      await guardarLocal();
      estado("");
    } catch (e) {
      if (e.status === 401) return sinAcceso();
      await guardarLocal().catch(() => {});
      estado(sucio ? "Sin conexión: los cambios están guardados en este móvil y se subirán al volver la conexión." : "Sin conexión: mostrando lo último que se descargó.");
    }
    recomponer();
  }
  async function cambiar(nuevo) {
    familia = nuevo; sucio = true;
    recomponer();
    await guardarLocal();
    sincronizar();
  }
  function estado(texto) { $("agenda-status").textContent = texto; }

  async function sinAcceso() {
    await S.limpiar();
    sesion = null;
    mostrarBienvenida("sin-acceso");
  }

  // ---------- Agenda ----------
  function recomponer() {
    D = A.componer(familia, agenda);
    $("empezar").hidden = familia.ninos.length > 0;
    pintar();
  }
  function plegadas() {
    try { const ids = JSON.parse(pref.get("plegadas") || "[]"); return Array.isArray(ids) ? ids.filter(id => typeof id === "string") : []; }
    catch (e) { return []; }
  }
  const duda = x => x.duda ? `<span class="duda"><span aria-hidden="true">⚠️</span>Por confirmar: ${esc(x.duda)}</span>` : "";
  function tarjeta(n, f) {
    const libre = L.sinCole(D, f, n.id), items = L.itemsDe(D, n.id, f), horario = L.horario(D, f, n.id);
    const estadoDia = libre && (libre !== "Fin de semana" || horario)
      ? `<div class="estado libre">${icon("i-sun")}Sin cole · ${esc(libre)}</div>`
      : horario ? `<div class="estado">${icon("i-school")}Cole · ${esc(horario)}</div>` : "";
    const lista = items.length
      ? `<ul class="items">${items.map(i => `<li class="item">
          <span class="time${i.hora ? "" : " dia"}">${esc(i.hora) || "Todo el día"}</span>
          <div class="what"><b>${esc(i.titulo)}</b>${i.detalle ? `<p>${esc(i.detalle)}</p>` : ""}
          ${i.llevar ? `<span class="bring">${icon("i-bag")}${esc(i.llevar)}</span>` : ""}${duda(i)}</div></li>`).join("")}</ul>`
      : `<p class="empty">${libre ? "Nada especial apuntado." : "Día normal, sin nada especial."}</p>`;
    return `<details class="kid tono-${L.tono(D, n.id)}" data-child="${esc(n.id)}"${plegadas().includes(n.id) ? "" : " open"}>
      <summary class="kid-head"><div class="avatar" aria-hidden="true"><svg><use href="#heart"/></svg><span>${esc(n.nombre[0])}</span></div>
      <div><h3 class="kid-name">${esc(n.nombre)}</h3><div class="kid-meta">${esc(n.curso)}</div></div></summary>
      ${estadoDia}${lista}</details>`;
  }
  $("view").addEventListener("toggle", e => {
    const card = e.target;
    if (!card.matches("details.kid")) return;
    const ids = plegadas().filter(id => id !== card.dataset.child);
    if (!card.open) ids.push(card.dataset.child);
    pref.set("plegadas", JSON.stringify(ids));
  }, true);
  function resumenDia(f) {
    const llevar = [];
    for (const n of D.ninos) for (const it of L.itemsDe(D, n.id, f)) if (it.llevar) llevar.push(`<li><b>${esc(n.nombre)}</b><span>${esc(it.llevar)}</span></li>`);
    return llevar.length ? `<aside class="packing" aria-label="Qué hay que llevar">${icon("i-bag")}<div><h3>Antes de salir de casa</h3><ul>${llevar.join("")}</ul></div></aside>` : "";
  }
  function vistaDia(f, etiqueta) {
    const d = L.parse(f);
    return `<div class="agenda-heading"><div><p class="eyebrow">NUESTRA AGENDA</p><h2 class="daytitle">${etiqueta} <span>· ${L.DIAS[d.getDay()]} ${d.getDate()}</span></h2></div><span class="child-count">${D.ninos.length} peque${D.ninos.length === 1 ? "" : "s"}</span></div>` + resumenDia(f) + D.ninos.map(n => tarjeta(n, f)).join("");
  }
  function vistaSemana(hoy) {
    let html = `<div class="agenda-heading"><div><p class="eyebrow">PARA ORGANIZARNOS</p><h2 class="daytitle">Los próximos 7 días</h2></div></div><div class="week">`;
    for (let i = 0; i < 7; i++) {
      const d = L.addDays(hoy, i), f = L.iso(d), filas = [];
      const motivos = new Set(D.ninos.map(n => L.sinCole(D, f, n.id)).filter(m => m && m !== "Fin de semana"));
      for (const m of motivos) filas.push(`<div class="row off">Sin cole · ${esc(m)}</div>`);
      for (const n of D.ninos) for (const it of L.itemsDe(D, n.id, f))
        filas.push(`<div class="row"><span class="week-child tono-${L.tono(D, n.id)}">${esc(n.nombre)}</span><span>${it.hora ? esc(it.hora) + " · " : ""}${esc(it.titulo)}${it.duda ? ' <span title="' + esc(it.duda) + '">⚠️</span>' : ""}</span></div>`);
      if (!filas.length) filas.push(`<div class="row quiet">${d.getDay() === 0 || d.getDay() === 6 ? "Fin de semana" : "Día normal"}</div>`);
      html += `<div class="wday${i === 0 ? " today" : ""}"><div class="wdate"><span>${L.DIAS[d.getDay()].slice(0, 3)}</span><b>${d.getDate()}</b></div><div class="wlist">${filas.join("")}</div></div>`;
    }
    return html + `</div>`;
  }
  const taskKey = t => t._clave || "tarea:" + t.titulo;
  function pintarTareas(hoy) {
    const focused = document.activeElement;
    const focusKey = focused?.matches("#tasks input") ? focused.dataset.key : null;
    const hoyF = L.iso(hoy);
    const ts = [...D.tareas].sort((a, b) => (a.limite || "9999").localeCompare(b.limite || "9999"));
    const pendientes = ts.filter(t => !A.estaHecha(familia, taskKey(t))).length;
    $("task-count").textContent = pendientes ? `${pendientes} pendiente${pendientes === 1 ? "" : "s"}` : "Todo listo ✓";
    $("tasks").innerHTML = ts.length ? ts.map((t, i) => {
      const ok = A.estaHecha(familia, taskKey(t));
      let due = "";
      if (t.limite) {
        const dias = Math.round((L.parse(t.limite) - L.parse(hoyF)) / 864e5);
        const txt = dias < 0 ? "Vencida" : dias === 0 ? "Hoy" : dias === 1 ? "Mañana" : "Hasta " + L.corto(t.limite);
        due = `<span class="due${dias <= 7 ? " soon" : ""}">${txt}</span>`;
      }
      const dots = `<span class="quien">${t.ninos.map(id => `<span class="dot tono-${L.tono(D, id)}"></span>`).join("")}</span>`;
      const quien = t.ninos.map(id => esc((D.ninos.find(n => n.id === id) || {}).nombre || id)).join(" y ");
      return `<li><label class="task${ok ? " done" : ""}" for="t${i}">
        <input type="checkbox" id="t${i}" data-key="${esc(taskKey(t))}" ${ok ? "checked" : ""}>
        <span class="check">${icon("i-check")}</span>
        <span class="what"><b>${esc(t.titulo)}</b><p>${dots}${quien}${t.detalle ? " · " + esc(t.detalle) : ""}</p>${duda(t)}</span>${due}</label></li>`;
    }).join("") : `<li class="tasks-empty">No hay tareas pendientes. ¡A disfrutar del día!</li>`;
    if (focusKey !== null) [...document.querySelectorAll("#tasks input")].find(cb => cb.dataset.key === focusKey)?.focus();
  }
  $("tasks").addEventListener("change", e => {
    const cb = e.target.closest("input[data-key]");
    if (cb) cambiar(A.marcarHecha(familia, cb.dataset.key, cb.checked));
  });
  function pintar() {
    if (!D) return;
    const hoy = new Date();
    $("fecha").innerHTML = `<b>${L.DIAS[hoy.getDay()].replace(/^./, c => c.toUpperCase())} ${hoy.getDate()}</b>${L.MESES[hoy.getMonth()]}`;
    document.querySelectorAll(".switch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    $("thumb").style.transform = `translateX(${VISTAS.indexOf(view) * 100}%)`;
    $("view").innerHTML = view === "hoy" ? vistaDia(L.iso(hoy), "Hoy")
      : view === "manana" ? vistaDia(L.iso(L.addDays(hoy, 1)), "Mañana") : vistaSemana(hoy);
    pintarTareas(hoy); pintarEntradas(); pintarNinos();
    const origen = [D.colegio, D.actualizado && "agenda del " + L.corto(D.actualizado)].filter(Boolean).join(" · ");
    $("foot").innerHTML = `<span>${esc(origen)}</span><div class="footer-actions"><button type="button" id="actualizar">Actualizar alDia</button></div><span id="update-status" role="status"></span>`;
    $("actualizar").onclick = actualizarApp;
  }
  async function actualizarApp() {
    const button = $("actualizar");
    button.disabled = true; button.textContent = "Buscando actualización…";
    try {
      if ("serviceWorker" in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
      location.reload();
    } catch (e) {
      button.disabled = false; button.textContent = "Actualizar alDia";
      $("update-status").textContent = "No se pudo comprobar la actualización. Revisa la conexión y prueba otra vez.";
    }
  }
  document.querySelectorAll(".switch button").forEach(b => b.addEventListener("click", () => { view = b.dataset.view; pref.set("vista", view); pintar(); }));

  // ---------- Anotaciones ----------
  const nombresTipos = { cumple: "Cumpleaños", tarea: "Tarea", extra: "Extraescolar", evento: "Evento" };
  const nombreNino = id => (familia.ninos.find(n => n.id === id) || {}).nombre || "?";
  function pintarEntradas() {
    const entradas = familia.entradas;
    $("entry-count").textContent = entradas.length;
    $("entries").innerHTML = entradas.length ? entradas.map(e => `<li><div><b>${esc(e.titulo)}</b><p>${nombresTipos[e.tipo]} · ${e.ninos.map(id => esc(nombreNino(id))).join(" y ")}</p><p>${e.fecha ? L.corto(e.fecha) : "Sin fecha límite"}${e.tipo === "extra" ? " · " + e.dias.map(d => L.DIAS[d]).join(", ") : e.anual ? " · Cada año" : ""}${e.hora ? " · " + esc(e.hora) : ""}</p></div><div class="entry-actions"><button type="button" class="btn ghost" data-edit="${esc(e.id)}" aria-label="Editar ${esc(e.titulo)}">Editar</button><button type="button" class="btn ghost" data-delete="${esc(e.id)}" aria-label="Eliminar ${esc(e.titulo)}">Eliminar</button></div></li>`).join("") : `<li class="tasks-empty">Aquí aparecerán los planes y tareas que añadáis.</li>`;
  }
  function camposTipo() {
    const tipo = $("entry-type").value;
    $("entry-extra").hidden = tipo !== "extra";
    $("entry-annual-wrap").hidden = tipo !== "cumple";
    $("entry-time-wrap").hidden = tipo === "tarea";
    $("entry-place-wrap").hidden = tipo === "tarea";
    $("entry-bring-wrap").hidden = tipo === "tarea";
    $("entry-title-label").textContent = tipo === "cumple" ? "Nombre de quien cumple años" : tipo === "extra" ? "Nombre de la actividad" : "¿Qué hay que hacer?";
    $("entry-date-label").textContent = tipo === "tarea" ? "Fecha límite (opcional)" : tipo === "extra" ? "A partir de" : "Fecha";
    $("entry-date").required = tipo !== "tarea";
  }
  function abrirEditor(id = null) {
    if (!familia.ninos.length) { abrirNino(); return; }
    editando = id;
    const e = familia.entradas.find(x => x.id === id);
    $("entry-form").reset();
    $("entry-error").hidden = true;
    $("editor-title").textContent = e ? "Editar anotación" : "Añadir a la agenda";
    $("entry-kids").innerHTML = familia.ninos.map(n => `<label><input type="checkbox" name="entry-kid" value="${esc(n.id)}"${e?.ninos.includes(n.id) || (!e && familia.ninos.length === 1) ? " checked" : ""}>${esc(n.nombre)}</label>`).join("");
    $("entry-type").value = e?.tipo || "cumple";
    $("entry-title").value = e?.titulo || "";
    $("entry-date").value = e?.fecha ?? L.iso(new Date());
    $("entry-time").value = e?.hora || "";
    $("entry-until").value = e?.hasta || "";
    $("entry-place").value = e?.lugar || "";
    $("entry-bring").value = e?.llevar || "";
    $("entry-notes").value = e?.detalle || "";
    $("entry-annual").checked = e ? e.anual : true;
    $("entry-school").checked = e?.soloConCole || false;
    document.querySelectorAll('[name="entry-day"]').forEach(cb => { cb.checked = e?.dias.includes(Number(cb.value)) || false; });
    camposTipo(); $("editor").showModal();
  }
  const nuevoId = () => C.aleatorio(12).replace(/[^a-zA-Z0-9_-]/g, "");
  $("nueva").onclick = () => abrirEditor();
  $("cerrar-editor").onclick = () => $("editor").close();
  $("entry-type").onchange = camposTipo;
  $("entry-form").onsubmit = async e => {
    e.preventDefault();
    $("entry-error").hidden = true;
    const tipo = $("entry-type").value;
    const entrada = { id: editando || nuevoId(), tipo, titulo: $("entry-title").value, ninos: [...document.querySelectorAll('[name="entry-kid"]:checked')].map(cb => cb.value), fecha: $("entry-date").value, hora: tipo === "tarea" ? "" : $("entry-time").value, hasta: tipo === "extra" ? $("entry-until").value : "", lugar: tipo === "tarea" ? "" : $("entry-place").value, llevar: tipo === "tarea" ? "" : $("entry-bring").value, detalle: $("entry-notes").value, dias: [...document.querySelectorAll('[name="entry-day"]:checked')].map(cb => Number(cb.value)), anual: $("entry-annual").checked, soloConCole: $("entry-school").checked };
    try {
      await cambiar(A.guardarEntrada(familia, entrada));
      $("editor").close(); estado("Guardado. Lo veréis en todos vuestros móviles.");
    } catch (err) {
      $("entry-error").textContent = "No se ha guardado: " + err.message;
      $("entry-error").hidden = false;
    }
  };
  $("entries").onclick = async e => {
    const editar = e.target.closest("button[data-edit]"), borrar = e.target.closest("button[data-delete]");
    if (editar) { abrirEditor(editar.dataset.edit); return; }
    if (!borrar) return;
    const entrada = familia.entradas.find(x => x.id === borrar.dataset.delete);
    if (!entrada || !confirm(`¿Eliminar «${entrada.titulo}»? Desaparecerá en todos vuestros móviles.`)) return;
    await cambiar(A.borrarEntrada(familia, entrada.id));
    estado("Anotación eliminada.");
  };

  // ---------- Peques ----------
  function pintarNinos() {
    $("ninos").innerHTML = familia.ninos.length ? familia.ninos.map(n => {
      const clase = n.clase && agenda.clases[n.clase];
      const donde = clase ? `${esc((agenda.colegios[clase.colegio] || {}).nombre || "")} · ${esc(clase.nombre)}` : n.clase ? "Clase pendiente de cargar" : "Sin clase";
      return `<li><div><b><span class="dot tono-${L.tono(D || { ninos: familia.ninos }, n.id)}"></span> ${esc(n.nombre)}</b><p>${donde}${n.curso ? " · " + esc(n.curso) : ""}</p></div><div class="entry-actions"><button type="button" class="btn ghost" data-nino-edit="${esc(n.id)}">Editar</button><button type="button" class="btn ghost" data-nino-delete="${esc(n.id)}">Quitar</button></div></li>`;
    }).join("") : `<li class="tasks-empty">Todavía no habéis añadido a ningún peque.</li>`;
  }
  async function cargarCatalogo() {
    try { catalogo = await api("GET", "/catalogo"); } catch (e) { if (!catalogo) catalogo = { colegios: [] }; }
    return catalogo;
  }
  async function abrirNino(id = null) {
    editandoNino = id;
    const n = familia.ninos.find(x => x.id === id);
    $("nino-form").reset();
    $("nino-error").hidden = true;
    $("nino-titulo").textContent = n ? "Editar peque" : "Añadir un peque";
    $("nino-nombre").value = n?.nombre || "";
    const usados = familia.ninos.map(x => x.color);
    $("nino-color").value = n?.color || L.TONOS.find(t => !usados.includes(t)) || L.TONOS[0];
    $("nino-curso").value = n?.curso || "";
    $("nino-editor").showModal();
    const cat = await cargarCatalogo();
    $("nino-clase").innerHTML = `<option value="">Sin clase (no va al cole o no está en alDia)</option>` + cat.colegios.map(c => `<optgroup label="${esc(c.nombre)}">${c.clases.map(k => `<option value="${esc(k.id)}">${esc(k.nombre)}</option>`).join("")}</optgroup>`).join("");
    $("nino-clase").value = n?.clase || "";
    $("nino-clase-nota").textContent = cat.colegios.length ? "Al elegir su clase, veréis los festivos, el horario y las circulares de esa clase." : "Todavía no hay colegios en alDia (o no hay conexión). Podéis añadirla más tarde.";
  }
  $("nuevo-nino").onclick = () => abrirNino();
  $("empezar-nino").onclick = () => abrirNino();
  $("cerrar-nino").onclick = () => $("nino-editor").close();
  $("nino-form").onsubmit = async e => {
    e.preventDefault();
    const nombre = $("nino-nombre").value.trim();
    const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "peque";
    let id = editandoNino;
    if (!id) { id = base; let i = 2; while (familia.ninos.some(n => n.id === id) || familia.borrados["nino:" + id]) id = base + "-" + i++; }
    try {
      await cambiar(A.guardarNino(familia, { id, nombre, color: $("nino-color").value, clase: $("nino-clase").value, curso: $("nino-curso").value }));
      $("nino-editor").close();
    } catch (err) { $("nino-error").textContent = err.message; $("nino-error").hidden = false; }
  };
  $("ninos").onclick = async e => {
    const ed = e.target.closest("[data-nino-edit]"), del = e.target.closest("[data-nino-delete]");
    if (ed) return abrirNino(ed.dataset.ninoEdit);
    if (!del) return;
    const n = familia.ninos.find(x => x.id === del.dataset.ninoDelete);
    if (n && confirm(`¿Quitar a ${n.nombre} de alDia? Sus anotaciones también se quitarán (las compartidas con otros peques se conservan para ellos).`)) await cambiar(A.borrarNino(familia, n.id));
  };

  // ---------- Invitar, móviles, copia y baja ----------
  const enlaceUnirse = (codigo, secreto) => `${location.origin}${location.pathname}#unirse=${codigo}.${secreto}`;
  $("invitar").onclick = async () => {
    $("invitar").disabled = true;
    try {
      const inv = await api("POST", "/familia/invitaciones");
      $("inv-enlace").value = enlaceUnirse(inv.codigo, sesion.clave);
      $("invitacion").hidden = false;
      $("inv-estado").textContent = "Caduca el " + L.corto(inv.caduca.slice(0, 10)) + ". Sirve una sola vez.";
      $("inv-compartir").hidden = !navigator.share;
    } catch (e) { $("familia-status").textContent = "No se ha podido crear la invitación: " + e.message; }
    finally { $("invitar").disabled = false; }
  };
  $("inv-copiar").onclick = async () => {
    try { await navigator.clipboard.writeText($("inv-enlace").value); $("inv-estado").textContent = "Copiado. Envíalo solo a quien quieras dar acceso."; }
    catch (e) { $("inv-enlace").select(); $("inv-estado").textContent = "Selecciona el enlace y cópialo."; }
  };
  $("inv-compartir").onclick = () => navigator.share({ title: "alDia", text: "Únete a nuestra agenda familiar en alDia:", url: $("inv-enlace").value }).catch(() => {});

  async function pintarDispositivos() {
    try {
      const { dispositivos } = await api("GET", "/dispositivos");
      $("dispositivos").innerHTML = dispositivos.map(d => `<li><div><b>${esc(d.nombre)}${d.esEste ? " (este móvil)" : ""}</b><p>Desde el ${L.corto(d.creado.slice(0, 10))}${d.ultimo_uso ? " · último uso el " + L.corto(d.ultimo_uso.slice(0, 10)) : ""}</p></div>${d.esEste ? "" : `<div class="entry-actions"><button type="button" class="btn ghost" data-revocar="${esc(d.id)}" data-nombre="${esc(d.nombre)}">Quitar acceso</button></div>`}</li>`).join("");
    } catch (e) { $("dispositivos").innerHTML = `<li class="tasks-empty">Sin conexión: no se puede ver la lista.</li>`; }
  }
  $("familia-ajustes").addEventListener("toggle", e => { if (e.target.open) pintarDispositivos(); });
  $("dispositivos").onclick = async e => {
    const b = e.target.closest("[data-revocar]");
    if (!b || !confirm(`¿Quitar el acceso a «${b.dataset.nombre}»? Ese móvil dejará de ver vuestra agenda.`)) return;
    try { await api("DELETE", "/dispositivos/" + encodeURIComponent(b.dataset.revocar)); pintarDispositivos(); }
    catch (err) { $("familia-status").textContent = "No se ha podido quitar el acceso: " + err.message; }
  };
  $("salir").onclick = async () => {
    if (!confirm("¿Quitar alDia de este móvil? Para volver a entrar necesitarás una invitación nueva.")) return;
    try { await api("DELETE", "/dispositivos/" + encodeURIComponent(sesion.dispositivoId)); } catch (e) {}
    await S.limpiar(); location.reload();
  };
  $("baja").onclick = async () => {
    if (!confirm("¿Borrar vuestra familia de alDia? Se borrarán los peques, las anotaciones y el acceso de todos vuestros móviles.")) return;
    if (prompt("Escribe BORRAR para confirmar") !== "BORRAR") return;
    try { await api("DELETE", "/familia"); await S.limpiar(); location.reload(); }
    catch (e) { $("familia-status").textContent = "No se ha podido borrar: " + e.message; }
  };

  function descargar(nombre, contenido) {
    const url = URL.createObjectURL(new Blob([contenido], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("exportar").onclick = async () => {
    const copia = { formato: "aldia-copia", version: 1, paquete: await C.cifrarCon(familia, clave) };
    descargar(`aldia-copia-${L.iso(new Date())}.aldia`, JSON.stringify(copia));
    $("familia-status").textContent = "Copia descargada. Solo se puede abrir desde un móvil de vuestra familia.";
  };
  // Importa: una copia de alDia, una copia .kibi de anotaciones de KiBi (pide el código de KiBi)
  // o el archivo de migración de KiBi (familia en claro, generado con scripts/migrar.mjs).
  $("importar").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error("El archivo supera 2 MB.");
      const datos = JSON.parse(await file.text());
      let doc;
      if (datos.formato === "aldia-copia") doc = await C.descifrarCon(datos.paquete, clave);
      else if (datos.formato === "aldia-familia") doc = datos;
      else if (datos.v === 1 && datos.sal) {
        const codigo = prompt("Escribe el código familiar de KiBi para abrir la copia");
        if (!codigo) return;
        const copia = await C.descifrar(datos, codigo);
        if (copia.formato !== "kibi-anotaciones") throw Error("No es una copia de anotaciones de KiBi.");
        const ids = new Set(familia.ninos.map(n => n.id));
        const falta = [...new Set(copia.entradas.flatMap(x => x.ninos))].filter(id => !ids.has(id));
        if (falta.length) throw Error(`Primero añade a los peques con estos identificadores: ${falta.join(", ")} (o importa el archivo de migración).`);
        doc = { ...familia, entradas: copia.entradas };
      } else throw Error("No reconozco este archivo.");
      const nuevo = A.validarFamilia(doc);
      const t = new Date().toISOString();
      const marcar = xs => xs.map(x => ({ ...x, actualizado: x.actualizado || t }));
      const mezcla = A.fusionar(familia, { ...nuevo, ninos: marcar(nuevo.ninos), entradas: marcar(nuevo.entradas) });
      if (!confirm(`Quedarán ${mezcla.ninos.length} peques y ${mezcla.entradas.length} anotaciones. ¿Importar?`)) return;
      await cambiar(mezcla);
      $("familia-status").textContent = "Importado.";
    } catch (err) { $("familia-status").textContent = "No se ha importado: " + err.message; }
    finally { e.target.value = ""; }
  };

  // ---------- Instalar ----------
  let promptInstalar = null;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function pintarInstalar() {
    $("instalar").hidden = !promptInstalar || standalone();
    $("instalar-nota").textContent = standalone() ? "alDia está instalada en este móvil." : promptInstalar ? "Instálala para tenerla en la pantalla de inicio." : "Consejo: en el menú del navegador, elige «Instalar app» o «Añadir a pantalla de inicio».";
    if (!S.persistente) $("instalar-nota").textContent += " Atención: este navegador no guarda datos (¿modo privado?). Al cerrarlo, este móvil perderá el acceso.";
  }
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; pintarInstalar(); });
  $("instalar").onclick = async () => { promptInstalar.prompt(); await promptInstalar.userChoice; promptInstalar = null; pintarInstalar(); };

  // ---------- Entrada (invitaciones) ----------
  function mostrarBienvenida(modo, datos = {}) {
    $("loading").hidden = true; $("app").hidden = true; $("bienvenida").hidden = false;
    const conForm = modo === "crear" || modo === "unirse";
    $("bv-movil").hidden = $("bv-movil-label").hidden = $("bv-boton").hidden = !conForm;
    $("bv-err").hidden = true;
    const textos = {
      crear: ["BIENVENIDA", "Vamos a crear vuestra familia", "Os han invitado a alDia. Dad un nombre a este móvil para reconocerlo después. Luego añadiréis a vuestros peques y su clase."],
      unirse: ["OS ESPERAN", "Únete a tu familia", "Te han invitado a la agenda de tu familia. Da un nombre a este móvil para reconocerlo después."],
      "sin-acceso": ["SIN ACCESO", "Este móvil ya no tiene acceso", "Puede que se haya quitado desde otro móvil de la familia. Pide un enlace de invitación nuevo para volver a entrar."],
      inicio: ["VUESTRO RINCÓN FAMILIAR", "Hola, familia ☀", "alDia funciona por invitación. Abre en este móvil el enlace que te han enviado."]
    }[modo];
    [$("bv-eyebrow").textContent, $("bv-titulo").textContent, $("bv-texto").textContent] = textos;
    $("bienvenida").onsubmit = async e => {
      e.preventDefault();
      const boton = $("bv-boton"), nombre = $("bv-movil").value.trim() || "Mi móvil";
      boton.disabled = true; $("bv-err").hidden = true;
      try { await (modo === "crear" ? crearFamilia(datos.codigo, nombre) : unirse(datos.codigo, datos.secreto, nombre)); }
      catch (err) {
        $("bv-err").textContent = err.status === 403 ? err.message : "No se ha podido completar: " + err.message;
        $("bv-err").hidden = false;
      } finally { boton.disabled = false; }
    };
    if (conForm) $("bv-movil").focus();
  }
  async function guardarSesion(s) {
    sesion = s;
    clave = await C.claveFamilia(s.clave);
    await S.set("sesion", s);
  }
  async function crearFamilia(codigo, nombre) {
    const secreto = C.aleatorio(32);
    const k = await C.claveFamilia(secreto);
    const doc = A.familiaVacia();
    const r = await api("POST", "/familias", { invitacion: codigo, dispositivo: nombre, blob: await C.cifrarCon(doc, k) }, null);
    await guardarSesion({ familiaId: r.familiaId, dispositivoId: r.dispositivoId, token: r.token, clave: secreto });
    familia = doc; version = r.version; sucio = false;
    await guardarLocal();
    entrar();
    abrirNino();
  }
  async function unirse(codigo, secreto, nombre) {
    await C.claveFamilia(secreto); // falla pronto si el enlace está cortado
    const r = await api("POST", "/unirse", { invitacion: codigo, dispositivo: nombre }, null);
    await guardarSesion({ familiaId: r.familiaId, dispositivoId: r.dispositivoId, token: r.token, clave: secreto });
    const remoto = await api("GET", "/familia");
    try { familia = A.validarFamilia(await C.descifrarCon(remoto.blob, clave)); }
    catch (e) { await S.limpiar(); throw Error("El enlace está incompleto: no abre los datos de la familia. Pide que te lo envíen otra vez."); }
    version = remoto.version; sucio = false;
    await guardarLocal();
    entrar();
  }
  function entrar() {
    $("bienvenida").hidden = true; $("loading").hidden = true; $("app").hidden = false; $("skip-agenda").hidden = false;
    recomponer(); pintarInstalar(); sincronizar();
  }

  async function arrancar() {
    // El enlace de invitación trae el código (para el servidor) y la clave (solo para este móvil).
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.has("crear") || hash.has("unirse")) history.replaceState(null, "", location.pathname);
    const guardada = await S.get("sesion");
    if (guardada) {
      await guardarSesion(guardada);
      const local = await S.get("familia");
      if (local) {
        try { familia = A.validarFamilia(await C.descifrarCon(local.blob, clave)); version = local.version; sucio = local.sucio; }
        catch (e) { familia = A.familiaVacia(); version = 0; }
      }
      agenda = (await S.get("agenda")) || agenda;
      if (hash.has("crear") || hash.has("unirse")) estado("Este móvil ya está en una familia. Para usar otra invitación, primero quita alDia de este móvil en «Nuestra familia».");
      return entrar();
    }
    if (hash.has("crear")) return mostrarBienvenida("crear", { codigo: hash.get("crear") });
    if (hash.has("unirse")) {
      const [codigo, secreto] = hash.get("unirse").split(".");
      if (codigo && secreto) return mostrarBienvenida("unirse", { codigo, secreto });
    }
    mostrarBienvenida("inicio");
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden && sesion) { pintar(); sincronizar(); } });
  addEventListener("online", () => { if (sesion) sincronizar(); });
  if ("serviceWorker" in navigator) {
    const teniaControlador = Boolean(navigator.serviceWorker.controller);
    let recargando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (teniaControlador && !recargando) { recargando = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
  arrancar().catch(e => { $("loading").textContent = "No se ha podido abrir alDia: " + e.message; });
})();
