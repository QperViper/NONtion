import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { plain, quickSearch } from '../internet.ts';
import { HttpError } from '../validation.ts';

/** Imita las respuestas reales de la API de Wikipedia y de DuckDuckGo Instant Answer. */
async function fakeUpstream() {
  const hits: string[] = [];
  let down = new Set<string>();
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    hits.push(url.pathname + (url.searchParams.get('srsearch') || url.searchParams.get('q') || ''));
    const send = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/w/api.php') {
      if (down.has('wiki')) return send({}, 503);
      const q = url.searchParams.get('srsearch')!;
      if (q === 'nada') return send({ query: { search: [] } });
      return send({ query: { search: [
        { title: q === 'mercurio' ? 'Mercurio' : 'Fotosíntesis', snippet: 'La <span class="searchmatch">fotosíntesis</span> es la conversión &amp; más' },
        { title: 'Fase luminosa', snippet: 'Primera etapa…' },
      ] } });
    }
    if (url.pathname.startsWith('/api/rest_v1/page/summary/')) {
      const title = decodeURIComponent(url.pathname.split('/').pop()!);
      if (title === 'Mercurio') return send({ type: 'disambiguation', title: 'Mercurio', extract: 'Mercurio puede referirse a:' });
      return send({ type: 'standard', title: 'Fotosíntesis', description: 'proceso metabólico', extract: 'La fotosíntesis es la conversión de materia inorgánica en orgánica.',
        thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' }, content_urls: { desktop: { page: 'https://es.wikipedia.org/wiki/Fotos%C3%ADntesis' } } });
    }
    if (url.pathname === '/') {
      if (down.has('ddg')) return send({}, 500);
      return send({ Heading: 'Fotosíntesis', AbstractText: 'Proceso por el cual las plantas…', AbstractURL: 'https://es.wikipedia.org/wiki/Fotos%C3%ADntesis', AbstractSource: 'Wikipedia', Answer: '',
        RelatedTopics: [{ Text: 'Clorofila - pigmento verde', FirstURL: 'https://duckduckgo.com/Clorofila' }, { Name: 'Ver también', Topics: [{ Text: 'Ciclo de Calvin - reacciones', FirstURL: 'https://duckduckgo.com/Calvin' }] }, { Text: 'sin enlace' }] });
    }
    send({}, 404);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.NONTION_WIKI_BASE = base; process.env.NONTION_DDG_BASE = base;
  return { server, hits, setDown: (s: string[]) => { down = new Set(s); } };
}

test('quita etiquetas HTML de los fragmentos de Wikipedia', () => {
  assert.equal(plain('La <span class="searchmatch">fotosíntesis</span> es &amp; &quot;vida&quot;'), 'La fotosíntesis es & "vida"');
});

test('respuestas rápidas: resumen, artículos, respuesta instantánea, fallos parciales y caché', async () => {
  const fake = await fakeUpstream();
  try {
    const r = await quickSearch('fotosíntesis');
    assert.equal(r.summary?.title, 'Fotosíntesis');
    assert.equal(r.summary?.image, 'https://upload.wikimedia.org/x.jpg');
    assert.deepEqual(r.articles.map(a => a.title), ['Fase luminosa'], 'el primero ya está como resumen');
    assert.equal(r.instant?.source, 'Wikipedia');
    assert.deepEqual(r.related.map(t => t.title), ['Clorofila', 'Ciclo de Calvin'], 'aplana subtemas y descarta los que no tienen enlace');
    assert.deepEqual(r.failed, []);
    const before = fake.hits.length;
    await quickSearch('  FOTOSÍNTESIS ');
    assert.equal(fake.hits.length, before, 'la segunda búsqueda sale de la caché');

    const amb = await quickSearch('mercurio');
    assert.equal(amb.summary, null, 'una desambiguación no se muestra como resumen');
    assert.deepEqual(amb.articles.map(a => a.title), ['Mercurio', 'Fase luminosa']);
    assert.equal(amb.articles[0].snippet, 'La fotosíntesis es la conversión & más');

    fake.setDown(['ddg']);
    const partial = await quickSearch('clorofila');
    assert.deepEqual(partial.failed, ['DuckDuckGo']);
    assert.ok(partial.articles.length + (partial.summary ? 1 : 0) > 0, 'si una fuente falla, se muestra la otra');
    fake.setDown(['ddg', 'wiki']);
    await assert.rejects(quickSearch('sin conexión'), (e: HttpError) => e.status === 502);
    fake.setDown([]);
    assert.equal((await quickSearch('nada')).articles.length, 0);
    await assert.rejects(quickSearch(''), (e: HttpError) => e.status === 400);
    await assert.rejects(quickSearch('x'.repeat(301)), (e: HttpError) => e.status === 400);
  } finally { fake.server.close(); }
});
