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
