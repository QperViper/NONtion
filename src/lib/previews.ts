// Imágenes de las notas: se muestran en versión reducida (máx. 1600 px, WebP) y la original queda intacta.
// La primera vez que una imagen grande aparece en pantalla, el navegador crea la versión reducida y la guarda;
// desde entonces se muestra esa. Doble clic sobre la imagen abre la original.

export const PREVIEW_MAX = 1600;
const ASSET = /^\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;
const MIN_BYTES = 350 * 1024; // las chicas no ganan nada reduciéndolas

/** Dimensiones de la versión reducida (sin agrandar nunca). */
export function fitWithin(width: number, height: number, max = PREVIEW_MAX) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
/** ¿Merece una versión reducida? Solo si es pesada o más grande que el máximo. */
export const needsPreview = (bytes: number, width: number, height: number) => bytes >= MIN_BYTES && Math.max(width, height) > PREVIEW_MAX / 2 || Math.max(width, height) > PREVIEW_MAX * 1.25;

const previewOf = new Map<string, string>();   // vista reducida → original (para el doble clic)
const resolved = new Map<string, Promise<string>>();
const generating = new Set<string>();

export const originalOf = (src: string) => previewOf.get(new URL(src, location.origin).pathname) ?? null;

async function generate(url: string, id: string) {
  if (generating.has(id) || typeof createImageBitmap === 'undefined') return;
  generating.add(id);
  try {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    if (!needsPreview(blob.size, bitmap.width, bitmap.height)) { bitmap.close(); return; }
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    // Si el navegador no sabe crear WebP (devuelve PNG) o no se achica, no vale la pena.
    if (!webp || webp.type !== 'image/webp' || webp.size >= blob.size) return;
    await fetch(`/api/assets/${id}/preview`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: webp });
  } catch { /* se reintenta la próxima vez que se muestre */ } finally { generating.delete(id); }
}

/** Para BlockNote (resolveFileUrl): qué dirección mostrar para una imagen guardada en la nota. */
export function resolvePreview(url: string): Promise<string> {
  const match = url.match(ASSET);
  if (!match) return Promise.resolve(url);
  let task = resolved.get(url);
  if (!task) {
    const id = match[1], preview = `/assets/previews/${id}.webp`;
    task = fetch(preview, { method: 'HEAD' }).then(res => {
      if (res.ok) { previewOf.set(preview, url); return preview; }
      resolved.delete(url); // sin versión reducida todavía: se vuelve a consultar la próxima vez
      void generate(url, id);
      return url;
    }, () => url);
    resolved.set(url, task);
  }
  return task;
}
