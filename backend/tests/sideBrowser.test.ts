import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpError } from '../validation.ts';
import { closeSide, openSide, safeUrl, validBounds } from '../sideBrowser.ts';

test('la ventana lateral solo abre páginas web y valida su tamaño', () => {
  assert.equal(safeUrl('https://www.youtube.com/results?search_query=hola'), 'https://www.youtube.com/results?search_query=hola');
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'chrome://settings', 'no es url', 'http://localhost:4000/api/x', 'http://127.0.0.1:9227/json']) {
    assert.throws(() => safeUrl(bad), HttpError, bad);
  }
  assert.deepEqual(validBounds({ left: 1100, top: 0, width: 800, height: 1040 }), { left: 1100, top: 0, width: 800, height: 1040 });
  assert.equal(validBounds({ left: 0, top: 0, width: 10, height: 10 }), undefined, 'demasiado chica');
  assert.equal(validBounds({ left: '0', top: 0, width: 800, height: 600 }), undefined);
  assert.equal(validBounds(null), undefined);
});

const chromium = process.env.NONTION_TEST_CHROMIUM;
test('abre una sola ventana, la reutiliza, la coloca al costado y la cierra', { skip: !chromium || !existsSync(chromium) ? 'Define NONTION_TEST_CHROMIUM' : false }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'nontion-side-'));
  const site = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>${req.url}</title>`); });
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  Object.assign(process.env, { NONTION_BROWSER: chromium, NONTION_SIDE_PROFILE: profile, NONTION_SIDE_PORT: '9339', NONTION_SIDE_ALLOW_LOCAL: '1',
    NONTION_SIDE_EXTRA_ARGS: '--headless=new --no-sandbox --disable-gpu' });
  const targets = async () => (await (await fetch('http://127.0.0.1:9339/json/list')).json() as { type: string; url: string }[]).filter(t => t.type === 'page');
  try {
    assert.deepEqual(await openSide(`${base}/primera`, { left: 900, top: 0, width: 700, height: 800 }), { mode: 'opened' });
    for (let i = 0; i < 40 && !(await fetch('http://127.0.0.1:9339/json/version').then(() => true, () => false)); i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual((await targets()).map(t => t.url), [`${base}/primera`]);
    assert.deepEqual(await openSide(`${base}/segunda`, { left: 960, top: 20, width: 640, height: 700 }), { mode: 'reused' });
    await new Promise(r => setTimeout(r, 500));
    const pages = await targets();
    assert.equal(pages.length, 1, 'sigue siendo una sola ventana');
    assert.equal(pages[0].url, `${base}/segunda`, 'la misma ventana navegó a la nueva búsqueda');
    assert.equal(await closeSide(), true);
    await new Promise(r => setTimeout(r, 1000));
    assert.equal(await fetch('http://127.0.0.1:9339/json/version').then(() => true, () => false), false, 'cerrada: no queda nada corriendo');
    assert.equal(await closeSide(), false);
  } finally {
    await closeSide().catch(() => {});
    site.close(); await rm(profile, { recursive: true, force: true });
  }
});
