# alDia · Plan de producto y tareas

> alDia es la evolución de KiBi (repositorio `MomentosEspeciales/Kibi`) para varias familias. Las fases 0 y 1 se hicieron en KiBi; la 2 empieza aquí, con historial limpio.

> Este repositorio es público. Aquí no van nombres, cursos, colegios, horarios ni direcciones de ninguna familia. El contexto de la familia piloto se guarda fuera del repositorio.

## 1. Objetivo

alDia organiza el cole y las actividades de los peques en el móvil de dos adultos con prisa. Nació para una familia (la **familia piloto**), pero el objetivo es que la usen **más familias conocidas, por invitación (50 como máximo)**. El código no puede depender de quiénes son los niños: todo sale de los datos.

Decisiones ya tomadas por la familia piloto:

| Tema | Decisión |
| --- | --- |
| Móviles | Android los dos. Avisos para los dos |
| Entrada de circulares | La intranet escolar (Educamos) manda un **correo de aviso sin adjunto**. El PDF hay que descargarlo con sesión iniciada |
| Publicación | **Automática**, con las dudas marcadas (no se aprueba cada cambio) |
| Fuente de verdad | **KiBi**. Calendar se suscribe a un **ICS**. Drive y Claude Docs se retiran |
| Backend | **Cloudflare (gratis)**: Workers + D1 |
| Alcance | Familias conocidas, por invitación |
| Datos del cole | **Se comparten por colegio y clase**: cada circular se procesa una vez para todas las familias de esa clase |

## 2. Diagnóstico

**Funciona y se reutiliza**
- `logica.js`: qué tiene cada niño un día. Funciona en el navegador y en Node, y lee los niños de los datos.
- `agenda.js`: valida las anotaciones del móvil y las mezcla sobre la agenda base (`aplicar`).
- `cripto.js`: PBKDF2 (210 000 iteraciones) + AES-GCM.
- PWA sin conexión y avisos push con `web-push`.

**Frágil**
1. Hubo datos de menores en claro en el repositorio público (documentación). Ya están quitados, pero **siguen en el historial de git**.
2. Un único código familiar elegido a mano, sin revocación y guardado en claro en `localStorage`. Cualquiera puede descargar `datos.cifrados.json` e intentar adivinar el código sin conexión.
3. El cron de GitHub se retrasa y se desactiva tras 60 días sin actividad en el repositorio.
4. Los datos están en cinco sitios (app, Calendar, Drive, Claude Docs y la memoria del asistente). Las anotaciones de cada móvil no se sincronizan y no entran en los avisos.
5. La extracción de circulares no tenía validación. Ya hubo errores: una actividad apuntada en el día equivocado y una circular con una fecha cuyo día de la semana no cuadraba.

## 3. Arquitectura objetivo: tres capas

| Capa | Contenido | Quién la ve | Dónde |
| --- | --- | --- | --- |
| **Colegio** | Curso, horario, festivos, circulares para todo el colegio | Familias con algún hijo en ese colegio | D1, en claro (no son datos personales) |
| **Clase** | Actividades semanales de clase, eventos y tareas de las circulares de clase, tutora | Familias de esa clase | D1, en claro, solo para sus miembros |
| **Familia** | Niños (nombre, color, clase), extraescolares, cumpleaños, tareas propias y hechas | Solo los móviles de esa familia | D1, **cifrado de extremo a extremo** (el servidor solo guarda datos ilegibles) |

- **Composición en el cliente:** `componer(colegio, clases, familia)` devuelve el mismo objeto `D` que hoy usa `logica.js`. Lo de cada clase se asigna a los niños de esa clase. La lógica y la interfaz casi no cambian.
- **El repositorio queda solo con código.** `datos.cifrados.json` y `suscripciones.cifradas.json` pasan a D1.
- **Worker `kibi-api`**:
  - Tablas: `colegios`, `clases`, `items` (ámbito colegio/clase, tipo, json, `origen`, `duda`), `familias` (blob cifrado, versión, clave envuelta, fechas con aviso), `familia_clases`, `dispositivos` (hash del token, suscripción push, revocado), `gestores`, `invitaciones`, `avisos_enviados`.
  - Endpoints: `POST /familias` (con invitación de administrador), `POST /unirse`, `GET /agenda`, `GET/PUT /familia` (con `If-Match`), `POST /suscribir`, `PUT /clases/:id/items` (solo gestores), `GET /cal/:token.ics`.
- **Claves:**
  - Cada familia tiene una clave aleatoria. Se envuelve con un secreto largo que viaja en el `#fragmento` del enlace de invitación, que nunca llega al servidor.
  - El móvil la guarda como `CryptoKey` no extraíble en IndexedDB, así que no hay que teclear ningún código.
  - Cada móvil tiene su token y se puede revocar.
- **Avisos sin que el servidor lea los datos de la familia:**
  - El cliente sube solo las **fechas** en las que la familia tiene algo personal.
  - El Cron Trigger del Worker manda `{fecha, modo, lineasClase}` a las 7:00 y a las 19:00, hora de Madrid.
  - El service worker compone el texto con `logica.js` sobre los datos de la familia, que tiene descifrados en local, con opción de mostrar solo iniciales.
- **ICS:** capas de colegio y clase. Lo personal solo si la familia lo activa, porque Google tiene que leerlo en claro.
- **Coste:** con 50 familias se queda muy lejos de los límites del plan gratuito de Cloudflare.

## 4. Circulares: una vez por clase

1. Detectar el correo de aviso de Educamos en Gmail (tarea programada).
2. Descargar el PDF o ZIP en Chrome, en el ordenador de un **gestor** y con su sesión. El asistente nunca escribe contraseñas. Si la sesión ha caducado, se para y se avisa.
3. Extraer cada circular a `circular.json`: id, prefijo, clases, fechas, acciones y confianza.
4. `validar` → marcar las dudas en el campo `duda`.
5. Publicar en la capa de clase o de colegio, con `origen: <CircularId>` (para poder deshacer una circular entera).
6. Push a las familias afectadas si hay algo urgente, y a los gestores si hay dudas.

Alternativa: cualquier familia sube el PDF desde la app y un gestor lo revisa. El original se guarda cifrado en R2.

## 5. Tareas por fases

### Fase 0: privacidad y desacoplar el código
- [x] Quitar los datos personales de `README.md` y de este documento.
- [x] Textos genéricos en `index.html`, `manifest.webmanifest` y `package.json`.
- [x] Colores por niño con el campo `color` (`azul`, `rosa`, `verde`, `naranja`, `lila`), o por orden si falta. Sustituye las clases CSS con nombres.
- [x] Contacto VAPID configurable (`VAPID_SUBJECT`), sin correo escrito en el código.
- [x] Pruebas con familias ficticias (`tests/fixtures/`), que se ejecutan en el CI.
- [x] Avisos con solo iniciales (`AVISOS_PRIVADOS=1`).
- [ ] **Familia piloto:** limpiar el historial de git (o empezar un repositorio limpio) y cambiar el código familiar.

### Fase 1: fiabilidad y calidad de datos
- [x] `npm run validar`: formato, fecha frente al día de la semana del texto, duplicados, eventos en días sin cole y fuera del curso. Se ejecuta antes de publicar.
- [x] Campo `duda` con el distintivo ⚠️ en las tarjetas, la semana y las tareas.
- [x] Versión de la caché del service worker calculada al publicar.
- [x] Avisos: cron a :17, hasta 1 hora de margen, registro de lo enviado (caché de Actions) y cron que se mantiene activo.

### Fase 2: backend multifamilia
- [x] Worker (`src/worker.js`, un único Worker con assets, como Buxola) y esquema D1 (`migrations/`).
- [x] Invitaciones de un solo uso (familia y miembro), token por móvil, revocación y baja de la familia.
- [x] Clave de familia aleatoria en el `#fragmento` del enlace (HKDF + AES-GCM); el servidor solo guarda el blob cifrado.
- [x] `componer()` y `fusionar()` en `agenda.js` con pruebas. Sincronización con control de versiones (409 → fusionar), copia local en IndexedDB y funcionamiento sin conexión.
- [x] Pantallas: entrar con invitación, añadir peques (nombre, color, colegio y clase), invitar a otro adulto, móviles con acceso, copia cifrada, importar de KiBi, darse de baja.
- [x] Calendario por colegio en `logica.js`: hermanos en colegios distintos con sus festivos y horarios.
- [x] `scripts/migrar.mjs` (probado con los datos reales: 287 días idénticos a KiBi), `validar.mjs`, `publicar.mjs` e `invitar.mjs`.
- [ ] **Familia piloto:** crear la base D1 y el Worker con Workers Builds, y el secreto `ADMIN_TOKEN` (ver README).
- [ ] **Familia piloto:** revisar el reparto de la migración, publicar colegio y clases, crear la familia e importar `familia.json`.

### Fase 3: avisos e ICS
- [ ] Cron Trigger y `POST /suscribir` con un toque. El service worker compone el texto final.
- [ ] Envío de push desde el Worker (VAPID + cifrado aes128gcm con Web Crypto) y claves VAPID nuevas para alDia.
- [ ] Apagar KiBi cuando alDia funcione (avisos, Pages y datos cifrados del repositorio).
- [ ] ICS por familia (UID estable, alarmas 1 y 2 días antes).
- [ ] **Familia piloto:** suscribir Calendar al ICS, borrar los eventos creados a mano y retirar Drive y Claude Docs.

### Fase 4: circulares por clase
- [ ] Rol de gestor y pantalla «Dudas por revisar».
- [ ] `circular.json`, `scripts/fusionar.mjs` y la tarea programada (Gmail → Chrome → API).
- [ ] Subir circulares desde la app (R2 cifrado) con cola de revisión.
- [ ] Push inmediato si la fecha límite es en menos de 3 días.

### Fase 5: producto
- [ ] Menú del comedor por colegio.
- [ ] Contactos del cole.
- [ ] Pegado inteligente de mensajes de WhatsApp.
- [ ] Texto RGPD para las familias invitadas: quién guarda qué y cómo darse de baja.

## 6. Riesgos y decisiones

- Quien administra pasa a ser **responsable del tratamiento** de los datos de otras familias. Hace falta consentimiento y una baja real.
- La capa de clase está en claro en D1 (actividades, tutora). Es aceptable porque el acceso es por invitación y no incluye nombres de niños.
- Si una familia pierde todos sus móviles y el enlace de invitación, pierde sus datos personales. Se mitiga con la exportación `.kibi` y con varios móviles por familia.
- La ingestión depende de que un gestor tenga el ordenador encendido con Chrome y la sesión de Educamos abierta.

## 7. Pruebas (sin datos reales)

- Datos ficticios: hoy, `tests/fixtures/eventos.sintetico.json`. Para la fase 2: dos colegios, tres clases y tres familias (una con hermanos en clases distintas).
- `node --test`: lógica, validación, `componer()`, fusión de circulares y ventana horaria de los avisos.
- Worker con `wrangler dev`/Miniflare: aislamiento entre familias, revocación, conflictos de versión e ICS válido.
- De extremo a extremo: despliegue de vista previa, alta con invitación, push a un Android de prueba y ICS en una cuenta de Google de pruebas.
