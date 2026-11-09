import { HttpError } from './validation.ts';

/**
 * Respuestas rápidas para el panel «Internet»: resumen de Wikipedia, otros artículos y respuesta
 * instantánea de DuckDuckGo. Servicios públicos sin clave; se consultan desde la API local
 * (sin problemas de CORS) con un tiempo límite corto y una caché de 10 minutos.
 */
export interface QuickResult { title: string; url: string; snippet: string; }
export interface QuickAnswer {
  query: string;
  summary: { title: string; description: string; extract: string; url: string; image: string | null } | null;
  instant: { heading: string; text: string; url: string | null; source: string | null } | null;
  articles: QuickResult[];
  related: QuickResult[];
  failed: string[];
}

const WIKI = () => process.env.NONTION_WIKI_BASE || 'https://es.wikipedia.org';
const DDG = () => process.env.NONTION_DDG_BASE || 'https://api.duckduckgo.com';
const HEADERS = { 'User-Agent': 'nontion-personal/1.0 (espacio personal; uso no comercial)', Accept: 'application/json' };
const TIMEOUT = 5000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ENTITIES[e]).replace(/\s+/g, ' ').trim();

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function wikipedia(query: string) {
  const search = await json<{ query?: { search?: { title: string; snippet: string }[] } }>(
    `${WIKI()}/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=6&srsearch=${encodeURIComponent(query)}`);
  const hits = search.query?.search ?? [];
  const articles = hits.map(hit => ({ title: hit.title, url: `${WIKI()}/wiki/${encodeURIComponent(hit.title.replaceAll(' ', '_'))}`, snippet: plain(hit.snippet) }));
  let summary: QuickAnswer['summary'] = null;
  if (hits[0]) {
    const page = await json<{ type?: string; title: string; description?: string; extract?: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page?: string } } }>(
      `${WIKI()}/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title.replaceAll(' ', '_'))}`).catch(() => null);
    // Una página de desambiguación no resume nada útil: se deja solo la lista.
    if (page?.extract && page.type !== 'disambiguation') {
      summary = { title: page.title, description: page.description ?? '', extract: page.extract, url: page.content_urls?.desktop?.page ?? articles[0].url, image: page.thumbnail?.source ?? null };
    }
  }
  return { summary, articles: summary ? articles.slice(1) : articles };
}

interface DdgTopic { Text?: string; FirstURL?: string; Topics?: DdgTopic[] }
async function duckduckgo(query: string) {
  const data = await json<{ Heading?: string; AbstractText?: string; AbstractURL?: string; AbstractSource?: string; Answer?: string; Definition?: string; DefinitionURL?: string; DefinitionSource?: string; RelatedTopics?: DdgTopic[] }>(
    `${DDG()}/?format=json&no_html=1&skip_disambig=1&no_redirect=1&kl=xl-es&q=${encodeURIComponent(query)}`);
  const text = data.Answer || data.AbstractText || data.Definition || '';
  const instant = text ? {
    heading: data.Heading || query, text: plain(String(text)),
    url: data.AbstractURL || data.DefinitionURL || null, source: data.AbstractSource || data.DefinitionSource || null,
  } : null;
  const related = (data.RelatedTopics ?? []).flatMap(t => t.Topics ?? [t])
    .filter(t => t.Text && t.FirstURL).slice(0, 5)
    .map(t => ({ title: t.Text!.split(' - ')[0].slice(0, 120), url: t.FirstURL!, snippet: t.Text! }));
  return { instant, related };
}

const cache = new Map<string, { at: number; value: QuickAnswer }>();
export async function quickSearch(raw: unknown): Promise<QuickAnswer> {
  const query = typeof raw === 'string' ? raw.trim() : '';
  if (!query || query.length > 300) throw new HttpError(400, 'Escribe qué buscar (máximo 300 caracteres).');
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  // Las dos fuentes en paralelo; si una falla, se muestra la otra.
  const [wiki, ddg] = await Promise.allSettled([wikipedia(query), duckduckgo(query)]);
  const failed = [wiki.status === 'rejected' && 'Wikipedia', ddg.status === 'rejected' && 'DuckDuckGo'].filter(Boolean) as string[];
  if (failed.length === 2) throw new HttpError(502, 'No hay conexión con Wikipedia ni DuckDuckGo. Revisa internet en este equipo.');
  const value: QuickAnswer = {
    query,
    summary: wiki.status === 'fulfilled' ? wiki.value.summary : null,
    articles: wiki.status === 'fulfilled' ? wiki.value.articles : [],
    instant: ddg.status === 'fulfilled' ? ddg.value.instant : null,
    related: ddg.status === 'fulfilled' ? ddg.value.related : [],
    failed,
  };
  if (!failed.length) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return value;
}
