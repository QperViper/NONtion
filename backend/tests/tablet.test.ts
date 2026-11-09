import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDevices, watchTablets } from '../tablet.ts';

test('interpreta la salida de "adb devices"', () => {
  const devices = parseDevices('List of devices attached\r\nHA1B2C3\tdevice\r\nZY99\tunauthorized\r\n\r\n');
  assert.deepEqual([...devices], [['HA1B2C3', 'device'], ['ZY99', 'unauthorized']]);
  assert.equal(parseDevices('List of devices attached\n\n').size, 0);
});

test('enlaza la tablet al conectarla, pide autorizarla y la vuelve a enlazar tras desconectarla', { skip: process.platform === 'win32' && 'La imitación de adb es un script de shell.' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nontion-adb-'));
  const state = path.join(dir, 'devices.txt'), calls = path.join(dir, 'calls.txt');
  const fake = path.join(dir, 'adb');
  // Imitación de adb: "devices" lee el estado de un archivo; el resto de órdenes se anotan.
  const noBrave = path.join(dir, 'sin-brave');
  // Si existe el archivo «sin-brave», pedir Brave responde como Android cuando la app no está instalada.
  await writeFile(fake, `#!/bin/sh\nif [ "$1" = "devices" ]; then printf 'List of devices attached\\n'; cat "${state}" 2>/dev/null; else echo "$@" >> "${calls}"; case "$*" in *com.brave.browser*) [ -f "${noBrave}" ] && echo 'Error: Activity not started, unable to resolve Intent';; esac; fi\n`);
  await chmod(fake, 0o755);
  const messages: string[] = [];
  const watcher = watchTablets({ port: 4000, adbPath: fake, intervalMs: 60_000, log: (...parts) => messages.push(parts.join(' ')) })!;
  const commands = async () => (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  try {
    await watcher.check();
    assert.deepEqual(watcher.linked(), []);
    await writeFile(state, 'TABM11\tunauthorized\n');
    await watcher.check(); await watcher.check();
    assert.equal(messages.filter(m => m.includes('falta autorizar')).length, 1, 'avisa una sola vez');
    assert.deepEqual(await commands(), []);
    await writeFile(state, 'TABM11\tdevice\n');
    await watcher.check(); await watcher.check();
    assert.deepEqual(watcher.linked(), ['TABM11']);
    assert.deepEqual(await commands(), [
      '-s TABM11 reverse tcp:4000 tcp:4000',
      '-s TABM11 shell am start -a android.intent.action.VIEW -d http://localhost:4000/pizarra -p com.brave.browser',
    ], 'enlaza y abre la pizarra en Brave una sola vez');
    await writeFile(state, '');
    await watcher.check();
    assert.deepEqual(watcher.linked(), []);
    assert.ok(messages.some(m => m.includes('desconectada')));
    await writeFile(state, 'TABM11\tdevice\n');
    await watcher.check();
    assert.equal((await commands()).filter(c => c.includes('reverse')).length, 2, 'al reconectar se vuelve a enlazar');
    // Tablet sin Brave: se usa el navegador predeterminado.
    await writeFile(noBrave, '');
    await writeFile(state, ''); await watcher.check();
    await writeFile(state, 'TABM11\tdevice\n'); await watcher.check();
    assert.equal((await commands()).at(-1), '-s TABM11 shell am start -a android.intent.action.VIEW -d http://localhost:4000/pizarra', 'sin Brave, abre el predeterminado');
  } finally { watcher.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('sin adb instalado no vigila nada', () => {
  assert.equal(watchTablets({ port: 4000, adbPath: null }), null);
});
