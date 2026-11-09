import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, quickMath } from '../../src/lib/quickMath.ts';

test('calculadora rápida: operaciones, precedencia y notación en español', () => {
  const cases: [string, number][] = [
    ['2+2', 4], ['(3+4)*2', 14], ['3+4*2', 11], ['2^3^2', 512], ['10/4', 2.5], ['3,5 * 2', 7], ['-(2+3)', -5],
    ['6 × 7', 42], ['9 ÷ 3', 3], ['2 x 3', 6], ['raíz(16) + 1', 5], ['√9', 3], ['2*pi', 2 * Math.PI],
    ['15% de 230', 34.5], ['230 + 10%', 253], ['230 - 10%', 207], ['50%*80', 40], ['1.5^2', 2.25],
  ];
  for (const [input, expected] of cases) assert.ok(Math.abs(quickMath(input)! - expected) < 1e-9, `${input} → ${quickMath(input)} (esperado ${expected})`);
});

test('lo que no es un cálculo se busca normalmente', () => {
  for (const input of ['segunda guerra mundial', 'covid-19', 'iPhone 15', 'Windows 11', '2+', '(2+3', '1/0', 'alert(1)', '2+2; rm -rf', '']) {
    assert.equal(quickMath(input), null, input);
  }
});

test('formato de números en español', () => {
  assert.equal(formatNumber(1234567.5), '1.234.567,5');
  assert.equal(formatNumber(0.1 + 0.2), '0,3');
});
