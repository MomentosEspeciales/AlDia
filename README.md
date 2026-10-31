# alDia 🩷🩵

La agenda familiar de los peques en el móvil: qué tienen hoy, mañana y durante la semana, qué hay que llevar y qué tareas quedan. Varias familias la comparten **por colegio y por clase**: cada circular se procesa una vez y llega a todas las familias de esa clase. Lo de cada familia (peques, extraescolares, cumpleaños, tareas) va **cifrado en el móvil** y el servidor no puede leerlo.

Es la evolución de KiBi para muchas familias. El plan completo está en [`docs/PLANIFICACION.md`](docs/PLANIFICACION.md).

> **Privacidad:** este repositorio no contiene datos de ninguna familia. Nombres, cursos y circulares viven en la base de datos (las familias, cifradas). La carpeta `datos/` (migraciones, capas en preparación) está en `.gitignore`.

## Cómo funciona

| Capa | Qué tiene | Dónde | Quién la ve |
| --- | --- | --- | --- |
| Colegio | Curso, horario, festivos, avisos para todo el cole | D1, en claro | Familias con peques en ese colegio |
| Clase | Actividades semanales, circulares, tareas de la clase | D1, en claro | Familias de esa clase |
| Familia | Peques (nombre, color, clase), anotaciones, tareas hechas | D1, **cifrada** (AES-GCM) | Solo los móviles de la familia |

- La app (`public/`) junta las tres capas en el móvil (`Agenda.componer`) y usa la misma lógica de días que KiBi (`public/logica.js`). Los hermanos pueden ir a colegios distintos.
- **Acceso por invitación.** La administración crea un enlace para cada familia nueva; la familia crea enlaces para sus otros adultos. Cada enlace sirve una vez. El de la familia lleva la **clave de cifrado en el `#fragmento`**, que el navegador nunca envía al servidor.
- **Cada móvil tiene su token** y se le puede quitar el acceso desde otro móvil de la familia.
- **Sincronización:** cada cambio lleva una marca de tiempo; si dos móviles guardan a la vez, el servidor responde 409 y el móvil fusiona (`Agenda.fusionar`) y vuelve a guardar. Funciona sin conexión con la última copia.
- **Baja:** «Borrar nuestra familia» elimina todo lo de la familia del servidor.

## Estructura

```
public/            la app (HTML, CSS y JS sin compilar)
  app.js           pantallas, invitaciones, sincronización
  agenda.js        familia: validación, fusión entre móviles, composición con colegio y clase
  logica.js        qué tiene cada peque un día (y el texto de los avisos)
  cripto.js        cifrado (clave de familia con HKDF + AES-GCM; PBKDF2 solo para importar de KiBi)
  almacen.js       IndexedDB del móvil
src/worker.js      Worker de Cloudflare: API en /api/* (el resto lo sirven los assets)
migrations/        esquema de la base D1
scripts/           administración: invitar, validar, publicar, migrar desde KiBi
tests/             pruebas con datos ficticios (node --test + Miniflare)
```

## Desarrollo

```bash
npm install
cp .dev.vars.example .dev.vars   # y pon un ADMIN_TOKEN cualquiera
npm run dev                      # D1 local + http://localhost:8787
npm test                         # todas las pruebas (sin Cloudflare ni datos reales)
```

Para probar en local: publica un colegio y una clase con `scripts/publicar.mjs` y crea una invitación con `scripts/invitar.mjs` (con `ALDIA_URL=http://localhost:8787`).

## Puesta en marcha en Cloudflare (una sola vez)

Igual que Buxola: un Worker con assets que se despliega solo con **Workers Builds** en cada push a `main`.

1. **Base de datos:** Cloudflare → *Storage & Databases* → *D1* → *Create* con el nombre `aldia`. Copia su **Database ID** en `wrangler.jsonc` (`database_id`; no es secreto).
2. **Worker:** *Workers & Pages* → *Create* → *Import a repository* → `MomentosEspeciales/alDia`.
   - Build command: `npm ci`
   - Deploy command: `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
3. **Secreto:** en el Worker → *Settings* → *Variables and Secrets* → `ADMIN_TOKEN` (*Secret*): un texto largo y aleatorio (por ejemplo, el resultado de `openssl rand -base64 32`). Guárdalo en tu gestor de contraseñas.
4. Abre la URL del Worker (`https://aldia.<tu-subdominio>.workers.dev`).

## Administración

```bash
export ALDIA_URL=https://aldia.<subdominio>.workers.dev ADMIN_TOKEN=...
node scripts/invitar.mjs                                  # enlace para una familia nueva
node scripts/validar.mjs datos/clase-x.json datos/colegio-y.json
node scripts/publicar.mjs datos/colegio-y.json datos/clase-x.json   # revisa y publica
```

Formato de un archivo de capa: `{ "ambito": "colegio"|"clase", "id": "mi-cole-1b-2026", "nombre": "1º B", "colegio": "mi-cole", "datos": { … } }`. En `datos` van los mismos campos que en KiBi (`curso`, `horario`, `sinCole` en el colegio; `semanal`, `eventos`, `tareas` en ambos), pero **sin `nino`/`ninos`**: lo de una clase es para todos sus peques. `duda` marca lo que hay que confirmar (se ve con ⚠️).

Para que una familia publique las circulares de su clase: `POST /api/admin/gestores` con `{ familiaId, ambito, id }`.

## Migrar una familia desde KiBi

```bash
# datos/migracion.json: colegio, clase de cada peque y qué es personal (ver el comentario de scripts/migrar.mjs)
CODIGO_FAMILIAR=... node scripts/migrar.mjs ../Kibi/datos.cifrados.json datos/migracion.json
node scripts/publicar.mjs datos/colegio-*.json datos/clase-*.json
node scripts/invitar.mjs        # abrir el enlace en el móvil, crear la familia
# En la app: Nuestra familia → Importar… → datos/familia.json (se cifra en el móvil)
```

Revisa el resumen antes de publicar: lo que KiBi tenía para un solo peque va a su clase, y lo de todos los peques al colegio. Lo que sea solo vuestro (por ejemplo, una tarea de la familia) muévelo a `familia.json` o márcalo con `personal`.
