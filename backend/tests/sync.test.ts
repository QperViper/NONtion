import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorageService } from '../fileStorage.ts';
import { SyncService, conflictTitle } from '../sync.ts';
import { emptyOldTrash } from '../maintenance.ts';
import { MemoryRemote } from './memoryRemote.ts';

const quiet = () => {};
async function device(remote: MemoryRemote, dir: string, name: string, uploadAsset?: (n: string) => Promise<boolean>) {
  const db = await FileStorageService.open(path.join(dir, name, 'local_db.json'));
  const sync = new SyncService(db, remote, { intervalMs: 0, log: quiet, uploadAsset });
  return { db, sync };
}
const doc = (title: string) => ({ parent_id: null, title, icon: null, cover_image: null, content: [{ type: 'paragraph', text: title }], is_favorite: false, created_at: new Date().toISOString() });

test('torre y notebook: crear, editar, bifurcar sin perder nada y fusionar ajustes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nontion-sync-'));
  const cloud = new MemoryRemote();
  const torre = await device(cloud, dir, 'torre');
  const notebook = await device(cloud, dir, 'notebook');
  try {
    const id = randomUUID();

    await t.test('creación nueva: se inserta con versión 1 y el otro equipo la descarga', async () => {
      torre.db.insert('documents', id, doc('Apuntes'));
      const pushed = await torre.sync.sync();
      assert.equal(pushed.ok, true);
      assert.equal(cloud.tables.documents.get(id)!.version, 1);
      const row = torre.db.raw('documents', id)!;
      assert.equal(row._dirty, false); assert.equal(row._base_version, 1);
      await notebook.sync.sync();
      assert.equal(notebook.db.get('documents', id)!.title, 'Apuntes');
      assert.equal(notebook.db.raw('documents', id)!._base_version, 1);
    });

    await t.test('actualización limpia: remote.version === _base_version → sube con versión siguiente', async () => {
      notebook.db.update('documents', id, { title: 'Apuntes v2' });
      await notebook.sync.sync();
      assert.equal(cloud.tables.documents.get(id)!.version, 2);
      assert.equal(cloud.tables.documents.get(id)!.title, 'Apuntes v2');
      assert.equal(notebook.db.raw('documents', id)!._dirty, false);
      await torre.sync.sync();
      assert.equal(torre.db.get('documents', id)!.title, 'Apuntes v2');
      assert.equal(torre.db.raw('documents', id)!._base_version, 2);
    });

    await t.test('ESCENARIO CRÍTICO: la torre edita y sube; el notebook edita sin internet; al volver no se pierde nada', async () => {
      torre.db.update('documents', id, { content: [{ type: 'paragraph', text: 'escrito en la torre' }] });
      await torre.sync.sync();
      assert.equal(cloud.tables.documents.get(id)!.version, 3);

      cloud.offline = true; // el notebook en el café: sin internet
      notebook.db.update('documents', id, { content: [{ type: 'paragraph', text: 'escrito en el café' }] });
      const offline = await notebook.sync.sync();
      assert.equal(offline.ok, false); assert.equal(offline.state, 'offline', 'sin internet no lanza: queda pendiente');
      assert.equal(notebook.db.raw('documents', id)!._dirty, true);

      cloud.offline = false; // vuelve la conexión
      const result = await notebook.sync.sync();
      assert.equal(result.ok, true);
      assert.equal(result.conflicts.length, 1);
      const conflict = result.conflicts[0];
      assert.equal(conflict.resolution, 'copia');
      assert.match(conflict.title, /^Apuntes v2 \(Conflicto local \d{4}-\d{2}-\d{2}T[\d:.]+Z\)$/);

      // La nube conserva intacto lo de la torre…
      assert.deepEqual(cloud.tables.documents.get(id)!.content, [{ type: 'paragraph', text: 'escrito en la torre' }]);
      assert.equal(cloud.tables.documents.get(id)!.version, 3);
      // …la copia con lo del notebook también está en la nube…
      const copy = cloud.tables.documents.get(conflict.copyId!)!;
      assert.deepEqual(copy.content, [{ type: 'paragraph', text: 'escrito en el café' }]);
      // …y en el notebook el original pasó a ser la versión de la torre, sin cambios pendientes.
      const original = notebook.db.raw('documents', id)!;
      assert.deepEqual(original.content, [{ type: 'paragraph', text: 'escrito en la torre' }]);
      assert.equal(original._dirty, false); assert.equal(original._base_version, 3);
      assert.ok(original.version > 3, 'la versión local sube: la pestaña abierta nota el cambio');
      assert.equal(notebook.db.raw('documents', conflict.copyId!)!._dirty, false);

      await torre.sync.sync();
      assert.ok(torre.db.get('documents', conflict.copyId!), 'la torre también recibe la copia');
    });

    await t.test('si otro equipo escribe justo entre la consulta y el update, se trata como bifurcación', async () => {
      notebook.db.update('documents', id, { title: 'título del notebook' });
      cloud.beforeUpdate = (table, rowId) => { if (table === 'documents' && rowId === id) { cloud.beforeUpdate = null; cloud.editAsOtherDevice('documents', id, { title: 'título de la torre' }); } };
      const result = await notebook.sync.sync();
      assert.equal(cloud.tables.documents.get(id)!.title, 'título de la torre', 'no se pisó');
      assert.equal(result.conflicts[0].resolution, 'copia');
      assert.match(cloud.tables.documents.get(result.conflicts[0].copyId!)!.title as string, /^título del notebook \(Conflicto local/);
    });

    await t.test('ajustes: fusión por campo (tema desde la torre, desenfoque desde el notebook)', async () => {
      await torre.sync.sync(); await notebook.sync.sync();
      torre.db.update('workspace_settings', 1, { theme_color: '#112233' });
      await torre.sync.sync();
      cloud.offline = true;
      notebook.db.update('workspace_settings', 1, { bg_blur: 9 });
      await notebook.sync.sync();
      cloud.offline = false;
      const result = await notebook.sync.sync();
      assert.equal(result.conflicts[0]?.resolution, 'fusion');
      const merged = cloud.tables.workspace_settings.get('1')!;
      assert.equal(merged.theme_color, '#112233'); assert.equal(merged.bg_blur, 9);
      const local = notebook.db.raw('workspace_settings', 1)!;
      assert.equal(local.theme_color, '#112233'); assert.equal(local.bg_blur, 9); assert.equal(local._dirty, false);
    });

    await t.test('papelera: el borrado lógico viaja como deleted_at; si la nube cambió, no hay copia y se reaplica', async () => {
      const other = randomUUID();
      torre.db.insert('documents', other, doc('Para borrar'));
      await torre.sync.sync(); await notebook.sync.sync();
      torre.db.update('documents', other, { title: 'renombrada en la torre' });
      await torre.sync.sync();
      notebook.db.update('documents', other, { deleted_at: new Date().toISOString() });
      const result = await notebook.sync.sync();
      assert.equal(result.conflicts[0].copyId, null, 'solo se movió a la papelera: no hace falta copia');
      await notebook.sync.sync();
      const remote = cloud.tables.documents.get(other)!;
      assert.equal(remote.title, 'renombrada en la torre'); assert.ok(remote.deleted_at, 'y quedó en la papelera');
    });
  } finally { await torre.db.persist(); await notebook.db.persist(); await rm(dir, { recursive: true, force: true }); }
});

test('borrado definitivo: se confirma en la nube, el otro equipo lo purga y la cascada se respeta', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nontion-purge-'));
  const cloud = new MemoryRemote();
  const torre = await device(cloud, dir, 'torre');
  const notebook = await device(cloud, dir, 'notebook');
  try {
    const parent = randomUUID(), child = randomUUID(), event = randomUUID(), thread = randomUUID();
    torre.db.insert('documents', parent, { ...doc('Vieja'), deleted_at: new Date(Date.now() - 40 * 864e5).toISOString() });
    torre.db.insert('documents', child, { ...doc('Hija'), parent_id: parent });
    torre.db.insert('events', event, { title: 'Evento', description: '', emoji: null, color: '#2383e2', priority: 'media', all_day: false,
      start_at: new Date().toISOString(), end_at: new Date().toISOString(), completed: false, document_id: parent, created_at: new Date().toISOString() });
    torre.db.insert('hyperthreads', thread, { source_doc_id: parent, source_text: 'x', source_block_id: 'b', destination_type: 'document', destination_id: child,
      destination_title: 'Hija', destination_path: `/${child}`, created_at: new Date().toISOString() });
    await torre.sync.sync();
    assert.equal(cloud.tables.documents.get(child)!.parent_id, parent, 'el padre se subió antes que la hija');
    await notebook.sync.sync();
    assert.ok(notebook.db.get('hyperthreads', thread));

    const removed = emptyOldTrash(30, { db: torre.db, remote: true });
    assert.equal(removed.documents, 1);
    assert.equal(torre.db.get('documents', parent), undefined, 'oculto en local mientras se confirma');
    assert.ok(torre.db.raw('documents', parent)?._purge);
    await torre.sync.sync();
    assert.equal(cloud.tables.documents.has(parent), false);
    assert.equal(torre.db.raw('documents', parent), undefined, 'confirmado: se purga del JSON');
    assert.equal(cloud.tables.documents.get(child)!.parent_id, null);
    assert.equal(cloud.tables.events.get(event)!.document_id, null);

    await notebook.sync.sync();
    assert.equal(notebook.db.raw('documents', parent), undefined, 'el notebook lo purga al ver que no está en la nube');
    assert.equal(notebook.db.get('documents', child)!.parent_id, null);
    assert.equal(notebook.db.get('events', event)!.document_id, null);
    assert.equal(notebook.db.get('hyperthreads', thread), undefined);
  } finally { await torre.db.persist(); await notebook.db.persist(); await rm(dir, { recursive: true, force: true }); }
});

test('si otro equipo restauró lo que aquí se purga, no se borra: vuelve la versión de la nube', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nontion-restore-'));
  const cloud = new MemoryRemote();
  const torre = await device(cloud, dir, 'torre');
  const notebook = await device(cloud, dir, 'notebook');
  try {
    const id = randomUUID();
    torre.db.insert('documents', id, { ...doc('Casi borrada'), deleted_at: new Date(Date.now() - 40 * 864e5).toISOString() });
    await torre.sync.sync(); await notebook.sync.sync();
    notebook.db.update('documents', id, { deleted_at: null });
    await notebook.sync.sync();
    emptyOldTrash(30, { db: torre.db, remote: true });
    const result = await torre.sync.sync();
    assert.ok(cloud.tables.documents.has(id));
    assert.equal(result.conflicts[0].resolution, 'nube');
    assert.equal(torre.db.get('documents', id)!.deleted_at, null);
  } finally { await torre.db.persist(); await notebook.db.persist(); await rm(dir, { recursive: true, force: true }); }
});

test('salvaguardas: nube que «parece vacía» no borra nada; edición durante la subida no se pierde; imágenes pendientes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nontion-guard-'));
  const cloud = new MemoryRemote();
  const uploaded: string[] = [];
  const pc = await device(cloud, dir, 'pc', async name => { uploaded.push(name); return true; });
  try {
    const ids = Array.from({ length: 30 }, () => randomUUID());
    for (const id of ids) pc.db.insert('documents', id, doc(id));
    await pc.sync.sync();
    // Clave sin permisos (RLS): la nube responde vacía.
    const backup = cloud.tables;
    cloud.tables = { workspace_settings: new Map(), documents: new Map(), whiteboards: new Map(), hyperthreads: new Map(), events: new Map() };
    const blocked = await pc.sync.sync();
    assert.equal(blocked.ok, false); assert.match(blocked.error!, /no devolvió datos/);
    assert.equal(pc.db.all('documents').length, 30);
    cloud.tables = { ...cloud.tables, workspace_settings: backup.workspace_settings };
    const mass = await pc.sync.sync();
    assert.equal(mass.ok, false); assert.match(mass.error!, /Por seguridad/);
    assert.equal(pc.db.all('documents').length, 30);
    cloud.tables = backup;

    // El usuario sigue escribiendo mientras viaja la subida: el cambio nuevo queda pendiente, no se marca como subido.
    pc.db.update('documents', ids[0], { title: 'primera edición' });
    cloud.beforeUpdate = () => { cloud.beforeUpdate = null; pc.db.update('documents', ids[0], { title: 'segunda edición' }); };
    await pc.sync.sync();
    assert.equal(cloud.tables.documents.get(ids[0])!.title, 'primera edición');
    assert.equal(pc.db.raw('documents', ids[0])!._dirty, true);
    await pc.sync.sync();
    assert.equal(cloud.tables.documents.get(ids[0])!.title, 'segunda edición');
    assert.equal(pc.db.raw('documents', ids[0])!._dirty, false);

    await pc.db.addPendingAsset('a.png');
    await pc.sync.sync();
    assert.deepEqual(uploaded, ['a.png']); assert.deepEqual(pc.db.meta.pending_assets, []);
  } finally { await pc.db.persist(); await rm(dir, { recursive: true, force: true }); }
});

test('escritura atómica: el JSON siempre es válido y un archivo dañado se aparta y se recupera del temporal', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nontion-atomic-'));
  const file = path.join(dir, 'data', 'local_db.json');
  try {
    const db = await FileStorageService.open(file);
    assert.equal(db.isNew, true);
    assert.ok(existsSync(file), 'crea carpeta y archivo inicial');
    const ids = Array.from({ length: 50 }, () => randomUUID());
    for (const id of ids) db.insert('documents', id, doc(id));
    await db.persist();
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(Object.keys(parsed.documents).length, 50);
    assert.equal(existsSync(`${file}.tmp`), false, 'no queda el temporal');
    const sample = parsed.documents[ids[0]];
    for (const field of ['id', 'version', '_base_version', '_dirty', 'updated_at', 'deleted_at']) assert.ok(field in sample, field);

    // Corte de luz a mitad de una escritura «no atómica»: el archivo quedó truncado, pero el temporal está completo.
    const full = await readFile(file, 'utf8');
    await writeFile(`${file}.tmp`, full);
    await writeFile(file, full.slice(0, 100));
    const recovered = await FileStorageService.open(file);
    assert.equal(recovered.all('documents').length, 50);
    assert.ok(readdirSync(path.dirname(file)).some(name => name.includes('.danado-')), 'el dañado se conserva aparte');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('título de conflicto: formato pedido y recortado al largo permitido', () => {
  const at = new Date('2026-11-10T12:00:00.000Z');
  assert.equal(conflictTitle('Mi nota', 255, at), 'Mi nota (Conflicto local 2026-11-10T12:00:00.000Z)');
  assert.equal(conflictTitle('x'.repeat(300), 200, at).length, 200);
});
