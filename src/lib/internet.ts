// Utilidades del panel «Internet» (sin dependencias del navegador, para poder probarlas).

/** Buscadores de un clic: se abren en una pestaña nueva. Brave Search va primero (sin anuncios personalizados). */
export const ENGINES = [
  { id: 'brave', label: 'Brave Search', url: (q: string) => q ? `https://search.brave.com/search?q=${encodeURIComponent(q)}` : 'https://search.brave.com/' },
  { id: 'google', label: 'Google', url: (q: string) => q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : 'https://www.google.com/' },
  { id: 'youtube', label: 'YouTube', url: (q: string) => q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://www.youtube.com/' },
  { id: 'wikipedia', label: 'Wikipedia', url: (q: string) => q ? `https://es.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` : 'https://es.wikipedia.org/' },
  { id: 'translate', label: 'Traductor', url: (q: string) => `https://translate.google.com/?sl=auto&tl=es&text=${encodeURIComponent(q)}` },
  { id: 'maps', label: 'Mapas', url: (q: string) => q ? `https://www.google.com/maps/search/${encodeURIComponent(q)}` : 'https://www.google.com/maps' },
] as const;

/** «youtube.com/watch?v=…», «youtu.be/…», «/shorts/…» o «/embed/…» → id del video (11 caracteres). */
export function youtubeId(input: string): string | null {
  const text = input.trim();
  const m = text.match(/(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i);
  return m ? m[1] : null;
}

const COMMON_TLD = /\.(com|org|net|edu|gov|io|dev|app|ai|co|cl|es|ar|mx|pe|uy|bo|ve|py|ec|br|us|uk|de|fr|it|info|me|tv|gg|xyz|site|online|tech|wiki|blog|news|store)$/i;

/** Texto que parece una dirección web («ejemplo.com/ruta» o con http). Devuelve la URL completa. */
export function asUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  // «node.js» o «informe.pdf» son búsquedas: sin http, se exige www., una ruta o una terminación de dominio conocida.
  const domainLike = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)
    && (/^www\./i.test(text) || /^[^/]+\.[a-z]{2,}\/\S*/i.test(text) && !/\.(js|ts|py|pdf|docx?|xlsx?|pptx?|png|jpe?g|txt|md|zip)\//i.test(text) || COMMON_TLD.test(text.split(/[/:]/)[0]));
  const candidate = /^https?:\/\//i.test(text) ? text : domainLike ? `https://${text}` : null;
  if (!candidate) return null;
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

/** Búsquedas recientes de este equipo (las más nuevas primero, sin repetir). */
export function remember(list: string[], query: string, max = 8) {
  const q = query.trim();
  return q ? [q, ...list.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, max) : list;
}
