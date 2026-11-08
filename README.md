# Espacio de Nicolás · nontion

Espacio personal local para escribir con BlockNote, dibujar con Tldraw y conectar texto con páginas o pizarras. React + Vite + Tailwind, Zustand como entrada de la interfaz a la API, Express y PostgreSQL.

## Arranque local (desarrollo)

Requisitos: Node.js compatible con Vite 8, pnpm y PostgreSQL en ejecución.

```powershell
pnpm install
pnpm --dir backend install
```

Copia `backend/.env.example` a `backend/.env` si todavía no existe y configura `DATABASE_URL` con tus credenciales **solo en ese archivo**. La base debe existir; en este equipo se llama `NONtion` (con esas mayúsculas).

```powershell
npm run dev
```

Este comando inicia ambos procesos: frontend en `http://127.0.0.1:5173` y API en `http://127.0.0.1:4000`. Ctrl+C detiene los procesos que inició. No arranques una segunda API sobre el mismo puerto. También puedes iniciarlos por separado con `npm run dev:api` y `npm run dev:ui`.

Vite envía `/api` y `/assets` al backend mediante proxy. `VITE_API_URL` permite configurar otra dirección de API. Los servicios escuchan únicamente en loopback; esta entrega está pensada para uso personal en el equipo.

## Uso diario: abrir con un clic

Una sola vez por equipo, haz doble clic en **`Instalar NONtion.cmd`** (raíz del proyecto). Crea:

- **NONtion** en el Escritorio y en el menú Inicio: abre la app en una ventana propia (Brave → Chrome → Edge, en ese orden).
- **Inicio automático**: al iniciar sesión en Windows, nontion arranca solo y queda abierto.
- **Detener NONtion** en el menú Inicio.

El lanzador (`scripts/launch.mjs`) arranca la API en segundo plano en `http://127.0.0.1:4000`, que también sirve la interfaz compilada (un solo puerto, sin Vite). Si el código cambió desde la última vez, recompila la interfaz antes de abrir. Si la API ya está en marcha, solo abre la ventana. Al encender el equipo espera hasta 3 minutos a que la base de datos y la red estén disponibles; si aun así no puede, muestra una página con el motivo. Los registros quedan en `logs/` (api.log, lanzador.log, build.log).

- `Abrir NONtion.cmd`: abre la app sin instalar accesos directos.
- `"Instalar NONtion.cmd" -SinInicioAutomatico`: solo crea los accesos del Escritorio y del menú Inicio. `-Desinstalar` los quita.
- Para usar otro navegador, añade `NONTION_BROWSER=C:\ruta\al\navegador.exe` a `backend/.env`.
- Equivalentes por terminal: `npm start`, `npm run stop`, `npm run serve` (API + interfaz en primer plano).

Para programar sigue usando `npm run dev` (recarga en caliente en `http://127.0.0.1:5173`). Si nontion ya está abierto, `dev` reutiliza esa API; para que tome cambios del backend, detenla antes con `npm run stop`.

Las páginas de la versión de desarrollo (puerto 5173) y las del lanzador (puerto 4000) guardan sus borradores locales por separado. Los datos guardados en la base son los mismos.

## Respaldos automáticos

Mientras la API está en marcha, crea un respaldo al día en `backend/backups/daily/` y conserva los 14 más recientes. Cada respaldo incluye `database.json` (todas las tablas), las imágenes y, si PostgreSQL está instalado en el equipo, `database.dump` (restaurable con `pg_restore`). Cada carpeta trae un `LEEME.txt` con las instrucciones de restauración. Respaldo manual: `npm run backup`.

## Varios equipos con Supabase

La base de datos y las imágenes pueden vivir en Supabase para usar el mismo espacio en la torre y en el notebook. Cada equipo ejecuta su propia API local (nada queda expuesto en internet) y se conecta a la misma base.

- **Arranque liviano:** al abrir solo se descargan títulos y metadatos; cada página o pizarra se descarga al abrirla. Guardar no devuelve el contenido completo.
- **Cambios de otros equipos:** se consultan al volver a la ventana y cada 15 s mientras está visible (`/api/changes`, solo lo que cambió). Si una página abierta cambió en otro equipo, se recarga sola. Si ambos editaron el mismo recurso sin sincronizar, aparece el conflicto de siempre para elegir versión.
- **Preferencias de pantalla** (ancho y estado de la barra lateral, ancho del panel de apariencia) son de cada equipo. Tema, fondo y personalización se comparten.
- **Imágenes:** se suben a un bucket privado de Supabase Storage. `backend/data/assets/` queda como caché local: una imagen subida desde otro equipo se descarga la primera vez que se ve. Las direcciones `/assets/…` guardadas en las notas no cambian.
- **Seguridad:** la conexión a la base va cifrada. La migración 003 activa RLS en las tablas para cerrar el acceso por la API pública de Supabase; la app no se ve afectada porque se conecta como dueña de las tablas.

### Pasar tu base local a Supabase (una vez, en el equipo que tiene los datos)

1. En `backend/.env`, mueve tu dirección actual a `LOCAL_DATABASE_URL=` y pon en `DATABASE_URL=` la de Supabase (**Connect → Session pooler**, con tu contraseña). Añade `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (ver `backend/.env.example`).
2. Doble clic en **`Pasar a Supabase.cmd`**. Detiene nontion, aplica migraciones pendientes a la base local, guarda una copia en `backend/backups/antes-de-supabase-*.json`, crea las tablas en Supabase, copia todo en una sola transacción (verificando los recuentos), sube las imágenes y vuelve a abrir la app.
3. La base local no se modifica. Si Supabase ya tiene datos, el traspaso se niega; `--reemplazar` los sustituye. Si solo fallan las imágenes, `"Pasar a Supabase.cmd" --solo-imagenes` reintenta ese paso.

### Otro equipo (notebook)

Clona el repositorio, ejecuta `pnpm install` y `pnpm --dir backend install`, crea `backend/.env` con `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (sin `LOCAL_DATABASE_URL`) y haz doble clic en `Instalar NONtion.cmd`. No necesita PostgreSQL instalado.

## Pizarra en la tablet Android por USB

La tablet usa la app del equipo al que está conectada (torre o notebook) por el cable, sin Wi-Fi: `adb reverse` hace que `http://localhost:4000` en la tablet llegue a ese equipo. Mientras nontion está abierto, el equipo vigila el cable cada 3 s; al conectar la tablet la enlaza y abre la pizarra. Al desconectarla y volver a conectarla, se enlaza de nuevo sola.

**Preparación (una vez):**
1. En la tablet: **Ajustes → Acerca de la tablet**, toca 7 veces **Número de compilación**. Luego **Ajustes → Sistema → Opciones de desarrollador** y activa **Depuración por USB**.
2. En cada equipo, vuelve a ejecutar **`Instalar NONtion.cmd`**: descarga `adb` (Android platform-tools, de Google) en `%LOCALAPPDATA%\nontion` y reinicia nontion.
3. Conecta la tablet con un cable **de datos**. En la tablet aparece «¿Permitir depuración por USB?»: marca **Permitir siempre desde esta computadora** y acepta.
4. Se abre la pizarra en Chrome. Menú **⋮ → Instalar app** (o *Agregar a pantalla principal*): queda como app a pantalla completa con su ícono.

**En la pizarra:** el botón ⤢ de la barra superior deja solo el lienzo (sin barra lateral) y la tablet lo recuerda; en el equipo puedes salir también con Esc. Un dedo o el lápiz dibujan con la herramienta lápiz; dos dedos mueven y hacen zoom. Con un lápiz pasivo la pantalla no distingue lápiz de dedo, así que apoyar la palma puede contar como toque: un guante de dibujo lo evita. Las fuentes e íconos de la pizarra van dentro de la app y no dependen de internet.

**Si no se enlaza:** mira `logs/api.log` (indica si falta autorizar la tablet). Prueba otro cable o puerto y, en la tablet, el modo USB «Transferencia de archivos». Si Windows no reconoce la tablet, instala el controlador USB de Lenovo. `NONTION_TABLET_ABRIR=0` en `backend/.env` evita que la pizarra se abra sola al conectar.

## Actualizaciones

Después de un `git pull`, abre nontion como siempre: si el código cambió desde que arrancó, el lanzador reinicia la API, instala dependencias nuevas (si cambió `pnpm-lock.yaml`) y recompila la interfaz.

## Persistencia y recuperación

- El backend aplica migraciones versionadas al arrancar. La primera añade columnas a las tablas existentes; no elimina notas, relaciones ni columnas.
- Antes de esa migración, guarda las cuatro tablas existentes en `backend/backups/before-001-*.json`. Esa copia es una instantánea previa, no un historial continuo de versiones.
- Cada recurso tiene una versión. Los PATCH requieren la versión de partida: una escritura antigua recibe HTTP 409 y no sobrescribe la versión nueva.
- Zustand actualiza la interfaz al escribir y agrupa los cambios durante 600 ms. Las peticiones de un recurso se serializan, y los fallos se reintentan.
- Los cambios pendientes se respaldan en IndexedDB. Al recargar la misma pestaña se recuperan; los de otras sesiones aparecen en el inspector para exportar o recuperar explícitamente. No borres los datos del navegador si tienes borradores pendientes.
- Un conflicto ofrece exportar el borrador, conservarlo sobre la versión del servidor o usar la versión del servidor. Las dos últimas decisiones son explícitas. No se combinan ediciones automáticamente.
- La papelera conserva contenido y conexiones. Esta entrega no incluye borrado definitivo.
- Las imágenes PNG/JPG/WebP/GIF (hasta 12 MB) se guardan en `backend/data/assets/`; la base almacena sus referencias. Conserva **la base y ese directorio** juntos cuando hagas copias o muevas la aplicación.

## Uso

Cada página vive en `/:documentId` y cada pizarra en `/pizarra/:boardId`. El título, contenido, icono, portada y favoritos de las páginas se guardan. Los snapshots de las pizarras guardan el documento Tldraw, incluidas sus páginas internas; la selección, cámara y deshacer de una sesión no forman parte del contenido persistente.

Selecciona texto y pulsa **Conectar selección**, o usa el menú contextual. El buscador muestra recursos reales; el hiperhilo queda enlazado dentro del texto y su destino se abre al lado. Las conexiones entrantes permiten volver al origen. Si se elimina el enlace del texto, deja de aparecer como conexión activa; su registro se conserva para permitir deshacer. Los registros antiguos sin anclaje se conservan, pero pueden requerir volver a enlazar el texto.

Hay hasta tres paneles de recursos distintos. Cuando están ocupados, se pide cuál reemplazar; cerrar un panel no elimina el recurso ni su borrador. Los paneles secundarios no se recuerdan al recargar. La URL sigue identificando el recurso principal.

Usa **Personalizar** o clic derecho sobre los controles de la aplicación para cambiar emoji, imagen/GIF, colores, tamaño y redondeado. Las acciones principales también admiten zona (lateral/superior), orden y visibilidad. El modo Personalizar vuelve a mostrar los controles ocultos y ofrece restauración individual. La entrada para salir de ese modo y los controles de recuperación permanecen accesibles. Las barras internas de BlockNote y Tldraw mantienen sus controles originales; su personalización completa queda para una etapa posterior.

La opción **Reducir animación de imágenes** congela las imágenes gestionadas por la interfaz. Las imágenes dentro de los editores dependen del comportamiento propio de cada editor. Las URL de imágenes externas siguen dependiendo de su servidor.

**Apariencia → Fondo de pantalla → Vignette Bloom** activa el mosaico Canvas2D animado con la foto y el preset proporcionados. La selección se conserva en PostgreSQL; **Color o imagen** recupera el fondo anterior. **Reducir animaciones** muestra un fotograma fijo. El motor es una reconstrucción de la especificación, no el código privado de 21st.dev; sus detalles y comprobaciones están en `src/effects/README.md`.

## Comprobaciones

```powershell
npm test
npm run lint
npm run build
```

El build comprueba los tipos del frontend y del backend. Las pruebas normales cubren orden de guardado, recuperación, conflictos, fallos del respaldo y validación de PATCH.

Para comprobar además la API con PostgreSQL, primero aplica las migraciones iniciando la API. Luego:

```powershell
$env:NONTION_INTEGRATION = '1'
npm test
Remove-Item Env:NONTION_INTEGRATION
```

Las pruebas de integración crean y limpian únicamente sus registros temporales. Verifican escrituras concurrentes, JSONB, conexiones, papelera, validación y subida de GIF; no modifican tus ajustes ni tus notas. Las páginas y pizarras marcadas con «QA» creadas durante la revisión visual se pueden enviar a la papelera desde la app.

El uso en producción, cuentas de varios usuarios, sincronización colaborativa y edición offline completa quedan fuera de esta entrega. Tldraw muestra su aviso de licencia de producción; el desarrollo local no configura una licencia.
