import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentRow, boardRow, mergeDocument, mergeBoard, patchDocument, readDevicePrefs, writeDevicePrefs } from '../../src/lib/resources.ts';

const meta = { id: 'a', title: 'T', icon: null, cover_image: null, is_favorite: false, version: 2, deleted_at: null, parent_id: null, thread_links: ['/hilo/x'] };
const block = (href: string) => ({ id: 'b', type: 'paragraph', props: {}, content: [{ type: 'link', href, content: [] }], children: [] });

test('una fila sin contenido queda pendiente de descarga y conserva sus hiperhilos', () => {
  const doc = documentRow(meta);
  assert.equal(doc.loaded, false);
  assert.deepEqual(doc.content, []);
  assert.deepEqual(doc.threadLinks, ['x']);
  const full = documentRow({ ...meta, content: [block('/hilo/y')] });
  assert.equal(full.loaded, true);
  assert.deepEqual(full.threadLinks, ['y']);
});

test('los metadatos nuevos no borran el contenido ya descargado', () => {
  const loaded = documentRow({ ...meta, content: [block('/hilo/y')] });
  const merged = mergeDocument(loaded, documentRow({ ...meta, title: 'Nuevo', version: 3 }));
  assert.equal(merged.title, 'Nuevo');
  assert.equal(merged.version, 3);
  assert.equal(merged.loaded, true);
  assert.deepEqual(merged.threadLinks, ['y']);
  assert.equal(merged.content.length, 1);
  // Una descarga completa sí reemplaza el contenido.
  assert.deepEqual(mergeDocument(loaded, documentRow({ ...meta, content: [] })).content, []);
  const board = boardRow({ id: 'p', name: 'P', version: 1, deleted_at: null, snapshot: { document: 1 } });
  assert.deepEqual(mergeBoard(board, boardRow({ id: 'p', name: 'P2', version: 2, deleted_at: null })).snapshot, { document: 1 });
});

test('editar el contenido actualiza los hiperhilos de la página', () => {
  const doc = documentRow({ ...meta, content: [] });
  assert.deepEqual(patchDocument(doc, { content: [block('/hilo/z')] }).threadLinks, ['z']);
  assert.deepEqual(patchDocument(doc, { title: 'x' }).threadLinks, []);
});

test('las preferencias de pantalla son de cada equipo y se validan', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.deepEqual(readDevicePrefs(storage), {});
  writeDevicePrefs({ sidebarWidth: 300 }, storage);
  writeDevicePrefs({ isSidebarOpen: false }, storage);
  assert.deepEqual(readDevicePrefs(storage), { sidebarWidth: 300, isSidebarOpen: false });
  data.set('nontion-device', JSON.stringify({ sidebarWidth: 9999, settingsWidth: 'x' }));
  assert.deepEqual(readDevicePrefs(storage), { sidebarWidth: 600 });
  data.set('nontion-device', '{roto');
  assert.deepEqual(readDevicePrefs(storage), {});
  assert.deepEqual(readDevicePrefs(undefined), {});
});
