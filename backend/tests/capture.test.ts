import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'fonion-'));
Object.assign(process.env, { NONTION_CAPTURE_DIR: dir, NONTION_CAPTURE_PORT: '4199', NONTION_CAPTURE_HOST: '127.0.0.1' });
const { captureStatus, resolveCapture, safeName, startCapture, stopCapture } = await import('../capture.ts');

test('nombres seguros y solo fotos o videos', () => {
  assert.deepEqual(safeName('IMG_0042.JPG', 'image/jpeg'), { base: 'IMG_0042', ext: 'jpg', kind: 'image' });
  assert.deepEqual(safeName('', 'video/quicktime'), { base: 'captura', ext: 'mov', kind: 'video' });
  assert.equal(safeName('foto.heic', '')?.kind, 'image');
  assert.equal(safeName('../../Windows/evil.jpg', 'image/jpeg')?.base, 'evil', 'sin rutas');
  assert.equal(safeName('<script>.png', 'image/png')?.base, 'script');
  for (const [name, type] of [['virus.exe', 'application/octet-stream'], ['nota.txt', 'text/plain'], ['pagina.html', 'text/html'], ['x', '']]) {
    assert.equal(safeName(name, type), null, name);
  }
});

test('solo se pueden leer archivos dentro de FONion', () => {
  assert.ok(resolveCapture('2026-11-09/10-00-00_IMG.jpg')?.startsWith(dir));
  for (const bad of ['../secreto.jpg', '2026-11-09/../../x.jpg', '2026-11-09\\..\\x.jpg', 'C:/Windows/x.jpg', '2026-11-09/nota.txt', 2]) {
    assert.equal(resolveCapture(bad), null, String(bad));
  }
});

test('recepción: código secreto, subida a disco, rechazos y apagado', async () => {
  try {
    await startCapture();
    const status = await captureStatus();
    assert.equal(status.active, true);
    assert.match(status.path!, /^\/c\/[\w-]{20,}$/, 'código secreto largo');
    const token = status.path!.slice(3);
    const base = `http://127.0.0.1:4199${status.path}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Tomar foto o video/);
    assert.equal((await fetch(`http://127.0.0.1:4199/c/${'x'.repeat(token.length)}`)).status, 404, 'código equivocado');
    assert.equal((await fetch('http://127.0.0.1:4199/')).status, 404);
    assert.equal((await fetch('http://127.0.0.1:4199/api/bootstrap')).status, 404, 'no expone la API de nontion');
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 7)]);
    const up = await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': encodeURIComponent('IMG_0042.JPG') }, body: jpeg });
    assert.equal(up.status, 201);
    const saved = await up.json() as { file: string; bytes: number };
    assert.equal(saved.bytes, jpeg.length);
    assert.deepEqual(await readFile(path.join(dir, saved.file)), jpeg, 'se guardó idéntico en FONion/<fecha>/');
    const again = await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': 'IMG_0042.JPG' }, body: jpeg });
    assert.notEqual((await again.json() as { file: string }).file, saved.file, 'dos fotos con el mismo nombre no se pisan');
    assert.equal((await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/x-msdownload', 'X-File-Name': 'virus.exe' }, body: 'MZ' })).status, 415);
    assert.equal((await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': 'vacia.jpg' }, body: '' })).status, 400);
    const day = saved.file.split('/')[0];
    assert.deepEqual((await readdir(path.join(dir, day))).filter(n => n.endsWith('.parcial')), [], 'no quedan archivos a medias');
    assert.equal((await captureStatus()).files.length, 2);
    await stopCapture();
    assert.equal((await captureStatus()).active, false);
    await assert.rejects(fetch(base), 'apagada: ya no responde');
  } finally { await stopCapture(); await rm(dir, { recursive: true, force: true }); }
});
