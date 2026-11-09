import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error módulo JavaScript del lanzador, sin tipos
import { rotatingLog } from '../../scripts/rotating-log.mjs';

test('los registros no crecen sin límite: rotan a .1 y empiezan de cero', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nontion-log-'));
  const file = path.join(dir, 'api.log');
  try {
    const write = rotatingLog(file, 1000);
    for (let i = 0; i < 100; i++) write(`línea ${i} ${'x'.repeat(40)}\n`);
    assert.ok(statSync(file).size <= 1000, 'el actual no pasa del límite');
    assert.ok(statSync(`${file}.1`).size <= 1000, 'el anterior tampoco');
    assert.ok(!existsSync(`${file}.2`), 'solo se guarda un respaldo');
    assert.match(readFileSync(file, 'utf8'), /línea 99/, 'lo más nuevo queda en el actual');
    const again = rotatingLog(file, 1000);
    again('sigue\n');
    assert.match(readFileSync(file, 'utf8'), /sigue\n$/, 'al reabrir continúa el mismo archivo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
