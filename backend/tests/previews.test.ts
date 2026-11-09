import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, needsPreview } from '../../src/lib/previews.ts';

test('versión reducida: nunca agranda y respeta la proporción', () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});
test('solo se reducen las imágenes que lo merecen', () => {
  assert.equal(needsPreview(2_500_000, 4032, 3024), true, 'foto del celular');
  assert.equal(needsPreview(120_000, 1200, 800), false, 'liviana y razonable');
  assert.equal(needsPreview(150_000, 3000, 200), true, 'muy ancha aunque pese poco');
  assert.equal(needsPreview(500_000, 600, 400), false, 'pesada pero chica: no gana nada');
});
