import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, asUrl, remember, youtubeId } from '../../src/lib/internet.ts';

test('reconoce enlaces de YouTube en todas sus formas', () => {
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ']) {
    assert.equal(youtubeId(url), 'dQw4w9WgXcQ', url);
  }
  for (const text of ['youtube', 'https://www.youtube.com/@canal', 'https://youtu.be/corto', 'cómo usar youtube.com']) assert.equal(youtubeId(text), null, text);
});

test('distingue una dirección web de una búsqueda', () => {
  assert.equal(asUrl('wikipedia.org'), 'https://wikipedia.org/');
  assert.equal(asUrl('uchile.cl/carreras'), 'https://uchile.cl/carreras');
  assert.equal(asUrl('http://ejemplo.com'), 'http://ejemplo.com/');
  for (const text of ['segunda guerra mundial', 'node.js', '3.14', 'javascript:alert(1)', 'archivo.pdf', '']) assert.equal(asUrl(text), null, text);
});

test('búsquedas recientes sin repetir y buscadores', () => {
  assert.deepEqual(remember(['a', 'B', 'c'], 'b'), ['b', 'a', 'c']);
  assert.equal(remember(Array.from({ length: 8 }, (_, i) => String(i)), 'nuevo').length, 8);
  assert.deepEqual(remember(['a'], '  '), ['a']);
  assert.equal(ENGINES.find(e => e.id === 'youtube')!.url('lofi & café'), 'https://www.youtube.com/results?search_query=lofi%20%26%20caf%C3%A9');
  assert.equal(ENGINES.find(e => e.id === 'google')!.url(''), 'https://www.google.com/');
});
