# Vignette Bloom

Reconstrucción Canvas2D de la especificación proporcionada por el usuario, basada en [la receta Vignette Bloom de Serafim](https://21st.dev/community/ascii/vignette-bloom-e05cb032-35be-4bcd-999b-cbf5b1588bac).

El JSON de `vignette-bloom.preset.json` conserva todos los valores recibidos. La foto local es una copia sin modificar de `https://21st.dev/ascii-editor/demos/generated/ref-008.webp` (SHA-256: `1d76928614002eedfee38bf52a15089429f3e11d0eae5b5bc711a46dfec7bdeb`). No se utiliza el TSX privado ni se presenta esta implementación como código original de 21st.dev. El prompt no proporciona fórmulas exactas de movimiento, bloom, densidad, bordes o primitivas, por lo que no garantiza equivalencia píxel a píxel con su motor interno.

## Motor

- `ascii-types.ts`: contrato del pipeline, primitivas, máscaras y luces.
- `ascii-math.ts`: media por celda (incluidos los bordes parciales), luminancia Rec.709, curvas y animaciones deterministas.
- `ascii-shapes.ts`: las 25 primitivas descritas. Contour usa segmentos interpolados entre celdas, Braille muestrea 2×4 regiones y Half Blocks mantiene los colores superior/inferior.
- `ascii-renderer.ts`: fondo, primitivas y mezcla, color, tintado, desenfoque, postefectos ordenados, luces y máscara de revelado. `solid` usa negro, como en el editor de referencia. Brillo se interpreta como desplazamiento de canales en 0–255; contraste se centra en 128. La cobertura usa una selección determinista para evitar parpadeo aleatorio.
- `VignetteBloomBackground` gestiona el tamaño, retina, errores y ciclo de animación. Mantiene `cellSize` en píxeles CSS, limita la superficie raster a un millón de píxeles/1280 por lado, muestrea al redimensionar y limita la animación a 30 fps. El bloom se desenfoca a un cuarto de resolución conservando los radios en píxeles del destino. Pausa con movimiento reducido, preferencia local, pestaña oculta o componente fuera de pantalla; libera los buffers al desmontar.

El preset activo usa solo mosaico, viñeta y bloom. Los demás controles son soportados por el motor para el contrato del prompt, pero no se activa ninguno adicional. Los metadatos del editor de máscaras (`tool`, `brushSize`, `shapes`, `showOverlay`) describen la herramienta de edición; el render utiliza el `dataUrl` de máscara ya dibujado.

## Integración

Apariencia permite alternar entre el fondo existente y Vignette Bloom. La elección se guarda en `workspace_settings.background_effect` mediante Zustand y la API, con las mismas versiones, borradores y recuperación de conflictos. Elegir una imagen vuelve al fondo normal; activar el efecto conserva la imagen previa. El preset no recibe un segundo ajuste de brillo/desenfoque del fondo normal.

No hay dependencias adicionales de ejecución: React, Canvas2D, ResizeObserver y requestAnimationFrame ya están disponibles.

## Verificación

`npm test` comprueba muestreo, orden de color, determinismo, preset y validación. Con `npm run dev`, abrir `/tests/ascii-renderer.html` ejecuta la batería raster en el navegador: todas las primitivas, cobertura, densidad, inversión, bordes, los nueve postefectos, los siete desenfoques, cinco animaciones, Matrix autónomo, luces y máscaras invertidas. Esa página es un arnés de desarrollo, no una ruta añadida al producto.
