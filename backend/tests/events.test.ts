import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateEvent } from '../validation.ts';

test('validación de eventos: campos obligatorios, fechas, prioridad, emoji y color', () => {
  const ok = { title: ' Prueba ', startAt: '2026-11-10T13:00:00.000Z', endAt: '2026-11-10T14:00:00-03:00' };
  const fields = validateEvent(ok, { create: true });
  assert.deepEqual(fields.find(f => f.column === 'title')?.value, 'Prueba');
  assert.equal(fields.find(f => f.column === 'end_at')?.value, '2026-11-10T17:00:00.000Z', 'normaliza a UTC');
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ startAt: ok.startAt, endAt: ok.endAt }, /Faltan/],
    [{ ...ok, title: '   ' }, /título/],
    [{ ...ok, startAt: '2026-11-10T13:00' }, /inicio/],
    [{ ...ok, endAt: '2026-11-10T12:00:00Z' }, /anterior/],
    [{ ...ok, priority: 'critica' }, /Prioridad/],
    [{ ...ok, color: 'red' }, /Color/],
    [{ ...ok, emoji: '🙂🙂🙂🙂🙂🙂🙂🙂🙂' }, /Emoji/],
    [{ ...ok, completed: 'si' }, /Booleano/],
    [{ ...ok, hack: 1 }, /no permitido/],
    [{ ...ok, deletedAt: ok.startAt }, /no permitido/],
    [{ ...ok, startAt: '1800-01-01T00:00:00Z' }, /inicio/],
  ];
  for (const [body, message] of bad) assert.throws(() => validateEvent(body, { create: true }), message, JSON.stringify(body));
  assert.deepEqual(validateEvent({ completed: true }).map(f => f.column), ['completed'], 'un cambio parcial no exige título');
  assert.equal(validateEvent({ emoji: '' })[0].value, null);
});

test('API de eventos: crear sin duplicar, editar con versión, sincronizar, borrar y restaurar', { skip: process.env.NONTION_INTEGRATION !== '1' }, async t => {
  const { app } = await import('../app.ts'); const { pool } = await import('../db.ts');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  const id = randomUUID();
  try {
    const boot = await call('/bootstrap');
    const cursor = boot.data.cursor;
    const input = { id, title: 'QA examen 📐', emoji: '📐', color: '#e03e3e', priority: 'urgente', description: 'Capítulos 1–3',
      allDay: false, startAt: '2026-11-12T12:00:00.000Z', endAt: '2026-11-12T14:00:00.000Z' };
    await t.test('crear es idempotente (un reintento no duplica)', async () => {
      const first = await call('/events', 'POST', input);
      assert.equal(first.status, 201);
      assert.equal(first.data.priority, 'urgente'); assert.equal(first.data.version, 1); assert.equal(first.data.completed, false);
      const again = await call('/events', 'POST', input);
      assert.equal(again.status, 200); assert.equal(again.data.id, id);
      assert.equal(Number((await pool.query('SELECT count(*) FROM events WHERE id=$1', [id])).rows[0].count), 1);
    });
    await t.test('editar exige la versión y detecta conflictos entre equipos', async () => {
      const done = await call(`/events/${id}`, 'PATCH', { version: 1, completed: true, endAt: '2026-11-12T15:00:00.000Z' });
      assert.equal(done.status, 200); assert.equal(done.data.version, 2); assert.equal(done.data.completed, true);
      const stale = await call(`/events/${id}`, 'PATCH', { version: 1, title: 'viejo' });
      assert.equal(stale.status, 409); assert.equal(stale.data.current.version, 2);
      const backwards = await call(`/events/${id}`, 'PATCH', { version: 2, endAt: '2026-11-12T10:00:00.000Z' });
      assert.equal(backwards.status, 400, 'la base rechaza un término anterior al inicio');
      assert.equal((await call(`/events/${randomUUID()}`, 'PATCH', { version: 1, title: 'x' })).status, 404);
      assert.equal((await call('/events/no-es-uuid', 'PATCH', { version: 1, title: 'x' })).status, 400);
    });
    await t.test('aparece en /changes y en el arranque; al borrarlo, el otro equipo se entera', async () => {
      const changed = await call(`/changes?since=${cursor}`);
      assert.deepEqual(changed.data.events.map((e: { id: string }) => e.id), [id]);
      assert.ok((await call('/bootstrap')).data.events.some((e: { id: string }) => e.id === id));
      const removed = await call(`/events/${id}`, 'PATCH', { version: 2, deletedAt: new Date().toISOString() });
      assert.equal(removed.status, 200);
      const after = await call(`/changes?since=${changed.data.cursor}`);
      assert.ok(after.data.events[0].deleted_at, 'el borrado viaja en /changes');
      assert.ok(!(await call('/bootstrap')).data.events.some((e: { id: string }) => e.id === id), 'el arranque no trae borrados');
      const restored = await call(`/events/${id}`, 'PATCH', { version: 3, deletedAt: null });
      assert.equal(restored.data.deleted_at, null);
    });
    await t.test('validación también en la API', async () => {
      assert.equal((await call('/events', 'POST', { ...input, id: randomUUID(), endAt: '2026-11-01T00:00:00Z' })).status, 400);
      assert.equal((await call('/events', 'POST', { ...input, id: randomUUID(), documentId: randomUUID() })).status, 400);
    });
  } finally {
    await pool.query('DELETE FROM events WHERE title LIKE $1', ['QA %']);
    server.close(); await pool.end();
  }
});
