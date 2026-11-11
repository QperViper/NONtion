import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { startApi } from './harness.ts';

test('una pizarra grande enviada comprimida (gzip) se guarda completa y ocupa mucho menos', async () => {
  const api = await startApi();
  const base = `${api.origin}/api`;
  try {
    const board = await (await fetch(`${base}/whiteboards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json() as { id: string; version: number };
    // ~2 000 trazos: el tipo de pizarra que hoy viajaría completa en cada guardado.
    const store: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i++) store[`shape:${i}`] = { id: `shape:${i}`, typeName: 'shape', type: 'draw', x: i, y: i * 2, props: { segments: [{ type: 'free', points: Array.from({ length: 12 }, (_, j) => ({ x: j, y: j * 1.5, z: 0.5 })) }], color: 'black', size: 'm' } };
    const json = JSON.stringify({ version: board.version, snapshot: { document: { store, schema: { schemaVersion: 2 } } } });
    const gz = gzipSync(json);
    const res = await fetch(`${base}/whiteboards/${board.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gz });
    assert.equal(res.status, 200);
    const saved = await (await fetch(`${base}/whiteboards/${board.id}`)).json() as { snapshot: { document: { store: Record<string, unknown> } } };
    assert.equal(Object.keys(saved.snapshot.document.store).length, 2000, 'llegó entera');
    const ratio = json.length / gz.length;
    assert.ok(ratio > 5, `comprime ${ratio.toFixed(1)}×`);
    console.log(`  pizarra de ${(json.length / 1024).toFixed(0)} KB → ${(gz.length / 1024).toFixed(0)} KB enviados (${ratio.toFixed(1)}× menos)`);
    await fetch(`${base}/whiteboards/${board.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: board.version + 1, deletedAt: new Date().toISOString() }) });
  } finally { await api.close(); }
});
