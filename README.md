# Espacio de Nicolás · nontion

Espacio personal local para escribir con BlockNote, dibujar con Tldraw y conectar texto con páginas o pizarras. React + Vite + Tailwind, Zustand como entrada de la interfaz a la API y Express. **Local-first:** los datos viven en un archivo (`backend/data/local_db.json`) y se sincronizan con Supabase cuando hay internet. No requiere PostgreSQL.

## Arranque local (desarrollo)

Requisitos: Node.js compatible con Vite 8 y pnpm. No hace falta ninguna base de datos instalada.

```powershell
pnpm install
pnpm --dir backend install
```

`backend/.env` es opcional. Sin él, nontion funciona solo en este equipo. Para sincronizar entre equipos, copia `backend/.env.example` a `backend/.env` y completa `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (ver **Varios equipos con Supabase**).

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

Las páginas de la versión de desarrollo (puerto 5173) y las del lanzador (puerto 4000) guardan sus borradores del navegador por separado. Los datos guardados en `local_db.json` son los mismos.

## Respaldos automáticos

Mientras la API está en marcha, crea un respaldo al día en `backend/backups/daily/` y conserva los 14 más recientes. Cada respaldo incluye `local_db.json` (restaurable tal cual), `database.json` (las filas de cada tabla) y las imágenes. `npm run backup` crea uno a mano.

## Almacenamiento local (`backend/data/local_db.json`)

- Todo el espacio (páginas, pizarras, conexiones, eventos y ajustes) está en un único archivo JSON. La API lo mantiene en memoria y lo guarda en cada cambio.
- **Escritura atómica:** primero se escribe `local_db.json.tmp` (con `fsync`) y luego se reemplaza el original. Un corte de luz deja el archivo anterior o el nuevo, nunca uno a medias. Si aun así encontrara un archivo dañado, lo aparta como `local_db.danado-<fecha>.json` y se recupera del temporal o de Supabase.
- Cada registro lleva `version`, `_base_version` (versión de Supabase en que se basó la edición), `_dirty` (cambio pendiente de subir), `updated_at` y `deleted_at`.
- **La primera vez en un equipo**, si no existe `local_db.json`, se crea a partir del último respaldo diario (sirve sin internet) o se descarga de Supabase.
- Si la carpeta del proyecto está dentro de **OneDrive** y se sincroniza entre la torre y el notebook, OneDrive también copiaría `local_db.json` de un equipo a otro y crearía conflictos de archivo. En ese caso define `NONTION_DATA_DIR=C:\nontion-datos` (una carpeta fuera de OneDrive) en `backend/.env` y mueve allí `backend/data/`.

## Varios equipos con Supabase

Cada equipo trabaja sobre su propio `local_db.json` (al instante, con o sin internet) y la API local sincroniza con Supabase en segundo plano usando `@supabase/supabase-js`. Nada queda expuesto en internet.

- **Cuándo se sincroniza:** al abrir nontion, unos 4 s después de que dejas de escribir, cada minuto (para traer lo del otro equipo), con el botón de estado de la barra lateral o con **Ctrl+Alt+S** (Ctrl+Shift+S es «tachado» en el editor). También con doble clic en **`Sincronizar con Supabase.cmd`** o `npm run sync`.
- **Sin internet:** la app no lo nota. Los cambios quedan marcados como pendientes y se suben al volver la conexión; la barra lateral muestra «Sin conexión · N pendientes».
- **Subida segura:** cada cambio se sube con un `update` condicionado a la versión en que se basó (`WHERE version = _base_version`). Si otro equipo escribió entretanto, no se sobrescribe nada.
- **Conflictos (torre y notebook editaron lo mismo):** la versión de la nube se queda como está y **tu versión local se guarda como página/pizarra/evento nuevo** con el título `«… (Conflicto local <fecha>)»`. Los ajustes del espacio se fusionan campo por campo (gana lo que cambiaste en ese equipo). Si solo moviste algo a la papelera o lo marcaste como favorito, se reaplica sin crear copia.
- **Descarga:** se comparan las versiones de cada registro con la nube y se descarga solo lo nuevo, sin pisar lo que tenga cambios locales. (No se usa la hora de cada equipo: un reloj atrasado podría hacer que se saltara un cambio.)
- **Imágenes:** se guardan primero en `backend/data/assets/` y se suben a un bucket privado de Supabase Storage al momento o en la siguiente sincronización. Una imagen subida desde otro equipo se descarga la primera vez que se ve.
- **Clave:** usa la *Secret key* (`sb_secret_…`). Las tablas tienen RLS activo sin políticas, así que la clave pública no puede leerlas; si la nube «parece vacía», la sincronización se detiene sin borrar nada local.
- **Papelera:** lo que lleva más de 30 días en la papelera se borra definitivamente; si hay sincronización, primero se confirma el borrado en Supabase. Si el otro equipo lo restauró, no se borra.
- **Preferencias de pantalla** (ancho y estado de la barra lateral, ancho del panel de apariencia) son de cada equipo. Tema, fondo y personalización se comparten.

### Otro equipo (notebook)

Clona el repositorio, ejecuta `pnpm install` y `pnpm --dir backend install`, crea `backend/.env` con `SUPABASE_URL` y `SUPABASE_SECRET_KEY` y haz doble clic en `Instalar NONtion.cmd`. La primera vez descarga tu espacio desde Supabase.

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

- Cada recurso tiene una versión. Los PATCH requieren la versión de partida: una escritura antigua (otra pestaña) recibe HTTP 409 y no sobrescribe la versión nueva.
- Zustand actualiza la interfaz al escribir y agrupa los cambios durante 600 ms. Las peticiones de un recurso se serializan, y los fallos se reintentan. La API responde cuando el cambio ya está en el disco.
- Los cambios pendientes de la pestaña se respaldan además en IndexedDB. Al recargar la misma pestaña se recuperan; los de otras sesiones aparecen en el inspector para exportar o recuperar explícitamente.
- Si una página abierta cambia por la sincronización, se recarga sola. Un conflicto entre pestañas ofrece exportar el borrador, conservarlo o usar la versión guardada.
- Las imágenes PNG/JPG/WebP/GIF (hasta 12 MB) se guardan en `backend/data/assets/`. Conserva **`local_db.json` y ese directorio** juntos si mueves la aplicación (con Supabase configurado, ambos se recuperan de la nube).

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

**Apariencia → Fondo de pantalla → Vignette Bloom** activa el mosaico Canvas2D animado con la foto y el preset proporcionados. La selección se guarda con los ajustes del espacio; **Color o imagen** recupera el fondo anterior. **Reducir animaciones** muestra un fotograma fijo. El motor es una reconstrucción de la especificación, no el código privado de 21st.dev; sus detalles y comprobaciones están en `src/effects/README.md`.

## Comprobaciones

```powershell
npm test
npm run lint
npm run build
```

El build comprueba los tipos del frontend y del backend. `npm test` cubre la API sobre un `local_db.json` temporal (versiones, conflictos entre pestañas, conexiones, papelera, eventos, imágenes), la escritura atómica y la sincronización entre dos equipos con una nube simulada: creación, actualización limpia, el caso torre/notebook sin internet, escrituras simultáneas, fusión de ajustes, borrados definitivos y salvaguardas. Las pruebas nunca tocan `backend/data/` ni tu Supabase.

El uso en producción, cuentas de varios usuarios y edición colaborativa en tiempo real quedan fuera de esta entrega. Tldraw muestra su aviso de licencia de producción; el desarrollo local no configura una licencia.
