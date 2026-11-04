import { AsciiRenderer } from '../src/effects/ascii-renderer';
import { renderModes } from '../src/effects/ascii-types';
import type { AsciiParameters, BlurType, EffectName } from '../src/effects/ascii-types';
import { vignetteBloomParameters, vignetteBloomSource } from '../src/effects/vignette-bloom';

const output = document.querySelector<HTMLPreElement>('#results')!;
let passed = 0, failed = 0;
const lines: string[] = [];
function check(name: string, condition: boolean) {
  if (condition) passed++; else failed++;
  lines.push(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  output.textContent = `${passed} PASS · ${failed} FAIL\n${lines.join('\n')}`;
  output.className = failed ? 'fail' : 'pass';
}
function hash(canvas: HTMLCanvasElement) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let value = 2166136261;
  for (const byte of data) value = Math.imul(value ^ byte, 16777619);
  return value >>> 0;
}
const source = document.createElement('canvas'); source.width = 128; source.height = 96;
const sourceCtx = source.getContext('2d')!;
const gradient = sourceCtx.createLinearGradient(0, 0, 128, 96);
gradient.addColorStop(0, '#000'); gradient.addColorStop(.5, '#e25889'); gradient.addColorStop(1, '#fff');
sourceCtx.fillStyle = gradient; sourceCtx.fillRect(0, 0, 128, 96);
sourceCtx.fillStyle = '#56c9de'; sourceCtx.fillRect(48, 20, 32, 44);
const base = structuredClone(vignetteBloomParameters);
base.cellSize = 8; base.animated = false; base.brightness = 0; base.contrast = 100;
for (const effect of Object.values(base.pfx)) effect.enabled = false;
function draw(parameters: AsciiParameters, time = 0) {
  const canvas = document.createElement('canvas');
  const renderer = new AsciiRenderer(canvas, source, 128, 96, parameters);
  renderer.resize(128, 96); renderer.render(time);
  return { canvas, renderer, value: hash(canvas) };
}
try {
  const baseline = draw(base); const baselineHash = baseline.value; baseline.renderer.dispose();
  const seen = new Set<number>();
  for (const renderMode of renderModes) {
    const result = draw({ ...structuredClone(base), renderMode }); seen.add(result.value);
    const data = result.canvas.getContext('2d')!.getImageData(0, 0, 128, 96).data;
    check(`primitiva ${renderMode}`, data.some((v, i) => i % 4 !== 3 && v > 30));
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent = renderMode; figure.append(result.canvas, caption); document.querySelector('#modes')!.append(figure);
    result.renderer.dispose();
  }
  check('las primitivas generan resultados distintos', seen.size >= 23);
  const noCoverage = draw({ ...base, coverage: 0 });
  check('coverage=0 no dibuja celdas', noCoverage.canvas.getContext('2d')!.getImageData(0, 0, 128, 96).data.every((v, i) => i % 4 === 3 || v === 0)); noCoverage.renderer.dispose();
  const transparent = draw({ ...base, bgMode: 'none', coverage: 0, tintOpacity: 80 });
  check('tintado conserva fondo transparente', transparent.canvas.getContext('2d')!.getImageData(0, 0, 128, 96).data.every((v, i) => i % 4 !== 3 || v === 0)); transparent.renderer.dispose();
  const tinted = draw({ ...base, tintOpacity: 80 }); check('tintado modifica los colores', tinted.value !== baselineHash); tinted.renderer.dispose();
  for (const key of ['invert', 'density', 'edgeEmphasis'] as const) {
    const parameters = structuredClone(base);
    if (key === 'invert') parameters.invert = true; else parameters[key] = 80;
    const result = draw(parameters); check(`respeta ${key}`, result.value !== baselineHash); result.renderer.dispose();
  }
  for (const name of Object.keys(base.pfx) as EffectName[]) {
    const parameters = structuredClone(base); parameters.pfx[name] = { enabled: true, intensity: 80 };
    const result = draw(parameters, .7); check(`postefecto ${name}`, result.value !== baselineHash); result.renderer.dispose();
  }
  for (const blurType of ['gaussian', 'directional', 'radial', 'zoom', 'tilt-shift', 'lens', 'progressive'] as BlurType[]) {
    const result = draw({ ...structuredClone(base), blurType, blurAmount: 80 });
    check(`desenfoque ${blurType}`, result.value !== baselineHash); result.renderer.dispose();
  }
  const blurOff = draw({ ...base, blurType: 'off', blurAmount: 100 }); check('blurType off ignora blurAmount', blurOff.value === baselineHash); blurOff.renderer.dispose();
  for (const animStyle of ['wave', 'pulse', 'shimmer', 'ripple', 'flicker'] as const) {
    const result = draw({ ...structuredClone(base), animated: true, animStyle });
    result.renderer.render(1.3); check(`animación ${animStyle}`, hash(result.canvas) !== result.value); result.renderer.dispose();
  }
  const matrix = draw({ ...base, renderMode: 'matrix', animated: false });
  matrix.renderer.render(1.3); check('matrix se anima sin animated', hash(matrix.canvas) !== matrix.value); matrix.renderer.dispose();
  const lit = draw({ ...base, lights: { enabled: true, points: [{ x: .5, y: .5, radius: .4, intensity: 1 }] } });
  check('luces normalizadas', lit.value !== baselineHash); lit.renderer.dispose();
  const mask = document.createElement('canvas'); mask.width = 128; mask.height = 96;
  mask.getContext('2d')!.fillStyle = '#fff'; mask.getContext('2d')!.fillRect(0, 0, 128, 96);
  for (const invert of [false, true]) {
    const parameters = structuredClone(base); parameters.mask = { ...parameters.mask, enabled: true, invert, dataUrl: mask.toDataURL() };
    const canvas = document.createElement('canvas'), renderer = new AsciiRenderer(canvas, source, 128, 96, parameters);
    await renderer.prepareMask(); renderer.resize(128, 96); renderer.render();
    check(`máscara ${invert ? 'invertida conserva efecto' : 'blanca revela foto'}`, hash(canvas) === (invert ? baselineHash : hash(source))); renderer.dispose();
  }
  const image = new Image(); image.src = vignetteBloomSource; await image.decode();
  const preview = document.querySelector<HTMLCanvasElement>('#preview')!;
  const renderer = new AsciiRenderer(preview, image, image.naturalWidth, image.naturalHeight, vignetteBloomParameters);
  renderer.resize(960, 540);
  const start = performance.now(); renderer.render(0); const zero = hash(preview);
  renderer.render(0); check('preset reproducible con el mismo tiempo', zero === hash(preview));
  renderer.render(1.3); check('preset wave se mueve', zero !== hash(preview));
  const duration = performance.now() - start;
  const benchmarkStart = performance.now();
  for (let i = 0; i < 10; i++) renderer.render(i / 30);
  const meanRender = (performance.now() - benchmarkStart) / 10;
  check('foto local cargada', image.naturalWidth === 1536 && image.naturalHeight === 864);
  lines.push(`Tiempo: ${Math.round(duration)} ms para 3 renders a 960×540 (incluye comparación de píxeles). Media de render sin comparación: ${meanRender.toFixed(1)} ms.`);
  output.textContent = `${passed} PASS · ${failed} FAIL\n${lines.join('\n')}`;
  document.title = `${failed ? 'FAIL' : 'PASS'} ${passed}/${passed + failed} · Vignette Bloom`;
  const download = document.createElement('a');
  download.textContent = 'Descargar vista PNG'; download.href = preview.toDataURL('image/png'); download.download = 'vignette-bloom-preview.png';
  preview.after(download);
  renderer.dispose();
} catch (error) {
  check(`Error inesperado: ${(error as Error).message}`, false);
  document.title = 'FAIL · Vignette Bloom';
}
