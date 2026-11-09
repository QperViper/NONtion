// Calculadora rápida del panel «Internet». Analizador propio (sin eval): + − × ÷ ^ ( ),
// coma decimal, porcentajes («15% de 230», «230 + 10%»), raíz(…) y pi.
type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string } | { kind: 'fn'; value: 'sqrt' };

function tokenize(input: string): Token[] | null {
  const src = input.toLowerCase()
    .replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷|:/g, '/').replace(/−/g, '-')
    .replace(/\bde\b|\bof\b/g, '@')                          // «15% de 230»
    .replace(/ra[ií]z|sqrt|√/g, 'r').replace(/\bpi\b|π/g, 'p');
  const tokens: Token[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    const num = src.slice(i).match(/^\d+(?:[.,]\d+)?/);
    if (num) { tokens.push({ kind: 'num', value: Number(num[0].replace(',', '.')) }); i += num[0].length; continue; }
    if (c === 'p') { tokens.push({ kind: 'num', value: Math.PI }); i++; continue; }
    if (c === 'r') { tokens.push({ kind: 'fn', value: 'sqrt' }); i++; continue; }
    if ('+-*/^()%@'.includes(c)) { tokens.push({ kind: 'op', value: c }); i++; continue; }
    return null;
  }
  return tokens;
}

/** Devuelve el resultado o null si el texto no es un cálculo (entonces se busca normalmente). */
export function quickMath(input: string): number | null {
  if (input.length > 120 || !/\d/.test(input) || !/[-+*/^%×÷√:]|ra[ií]z|sqrt|\d\s*x\s*[\d(]/i.test(input)) return null;
  const tokens = tokenize(input);
  if (!tokens?.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.kind === 'op' && peek()!.value === v;
  const fail = () => { throw new Error('sintaxis'); };

  // expr := term (('+'|'-') term ['%'])*   — «230 + 10%» suma el 10 % de 230.
  const expr = (): number => {
    let value = term();
    while (isOp('+') || isOp('-')) {
      const sign = tokens[pos++].value === '+' ? 1 : -1;
      const right = term();
      if (isOp('%')) { pos++; value += sign * value * right / 100; } else value += sign * right;
    }
    return value;
  };
  const term = (): number => {
    let value = power();
    while (isOp('*') || isOp('/') || isOp('@')) {
      const op = tokens[pos++].value;
      const right = power();
      value = op === '/' ? value / right : value * right;
    }
    return value;
  };
  const power = (): number => {
    const base = unary();
    if (isOp('^')) { pos++; return base ** power(); }
    return base;
  };
  const unary = (): number => {
    if (isOp('-')) { pos++; return -unary(); }
    if (isOp('+')) { pos++; return unary(); }
    return percent();
  };
  // «15%» vale 0,15 («15% de 230», «50%*80»). Excepción: «230 + 10%» al final lo resuelve expr().
  const percent = (): number => {
    let value = primary();
    if (isOp('%')) {
      const before = tokens[pos - 2];
      const trailingAfterSum = pos === tokens.length - 1 && before?.kind === 'op' && (before.value === '+' || before.value === '-');
      if (!trailingAfterSum) { pos++; value /= 100; }
    }
    return value;
  };
  const primary = (): number => {
    const token = tokens[pos++];
    if (!token) return fail();
    if (token.kind === 'num') return token.value;
    if (token.kind === 'fn') return Math.sqrt(primary());
    if (token.value === '(') { const v = expr(); if (!isOp(')')) fail(); pos++; return v; }
    return fail();
  };
  try {
    const result = expr();
    if (pos !== tokens.length || !Number.isFinite(result)) return null;
    return result;
  } catch { return null; }
}

/** 1234567.891 → «1.234.567,891» (máximo 10 decimales significativos). */
export const formatNumber = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 10 });
