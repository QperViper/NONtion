import type { AnimationStyle, AsciiParameters, Grid, Rgb } from './ascii-types.ts';

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const luminance = (r: number, g: number, b: number) => (r * .2126 + g * .7152 + b * .0722) / 255;
export function noise(x: number, y: number, seed = 0): number {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
export function tone(value: number, points: AsciiParameters['toneCurve']): number {
  if (!points.length) return value;
  if (value <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    if (value <= points[i].x) {
      const previous = points[i - 1], next = points[i];
      return previous.y + (next.y - previous.y) * (value - previous.x) / (next.x - previous.x || 1);
    }
  }
  return points[points.length - 1].y;
}
export function adjustColor(rgb: Rgb, p: AsciiParameters): [number, number, number] {
  const l = luminance(...rgb), curved = tone(l, p.toneCurve);
  const ratio = l > 0 ? curved / l : 1;
  const lift = l === 0 ? curved * 255 : 0;
  // Clamp after each operation: brightness -> contrast -> saturation -> grayscale.
  const channels = rgb.map(c => clamp(clamp(c * ratio + lift, 0, 255) + p.brightness, 0, 255)) as [number, number, number];
  for (let i = 0; i < 3; i++) channels[i] = clamp((channels[i] - 128) * p.contrast / 100 + 128, 0, 255);
  const gray = luminance(...channels) * 255;
  for (let i = 0; i < 3; i++) channels[i] = clamp(gray + (channels[i] - gray) * p.saturation / 100, 0, 255);
  const desaturated = luminance(...channels) * 255, mix = clamp(p.grayscale / 100);
  for (let i = 0; i < 3; i++) channels[i] = channels[i] * (1 - mix) + desaturated * mix;
  return channels;
}
export function animation(style: AnimationStyle, x: number, y: number, radius: number, time: number, seed: number): number {
  switch (style) {
    case 'wave': return Math.sin(x * .11 + y * .08 - time * 1.8);
    case 'pulse': return Math.sin(time * 2.2);
    case 'shimmer': return Math.sin(x * .7 + time * 3) * Math.cos(y * .53 - time * 1.7);
    case 'ripple': return Math.sin(radius * .22 - time * 2.7);
    case 'flicker': return noise(x, y, Math.floor(time * 12) + seed) * 2 - 1;
  }
}
export function sampleGrid(data: Uint8ClampedArray, width: number, height: number, size: number): Grid {
  size = Math.max(1, size);
  const columns = Math.ceil(width / size), rows = Math.ceil(height / size);
  const cells: Grid['cells'] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x0 = Math.floor(col * size), y0 = Math.floor(row * size);
    const x1 = Math.min(width, Math.floor((col + 1) * size)), y1 = Math.min(height, Math.floor((row + 1) * size));
    const sums = [0, 0, 0], top = [0, 0, 0], bottom = [0, 0, 0];
    const dots = new Array<number>(8).fill(0), counts = new Array<number>(8).fill(0);
    let n = 0, nt = 0, nb = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
      const rgb = [data[i] * alpha, data[i + 1] * alpha, data[i + 2] * alpha];
      const upper = y < y0 + (y1 - y0) / 2;
      for (let c = 0; c < 3; c++) { sums[c] += rgb[c]; (upper ? top : bottom)[c] += rgb[c]; }
      if (upper) nt++; else nb++;
      const slot = Math.min(3, Math.floor((y - y0) / Math.max(1, y1 - y0) * 4)) * 2 + Math.min(1, Math.floor((x - x0) / Math.max(1, x1 - x0) * 2));
      dots[slot] += luminance(rgb[0], rgb[1], rgb[2]); counts[slot]++; n++;
    }
    const rgb = sums.map(c => c / (n || 1)) as [number, number, number];
    cells.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, rgb,
      top: top.map(c => c / (nt || 1)) as [number, number, number],
      bottom: bottom.map(c => c / (nb || 1)) as [number, number, number],
      luminance: luminance(...rgb), edge: 0, seed: noise(col, row),
      radius: Math.hypot(col - columns / 2, row - rows / 2), braille: dots.map((sum, i) => sum / (counts[i] || 1)),
    });
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const at = (x: number, y: number) => cells[Math.max(0, Math.min(rows - 1, y)) * columns + Math.max(0, Math.min(columns - 1, x))].luminance;
    cells[row * columns + col].edge = clamp(Math.hypot(at(col + 1, row) - at(col - 1, row), at(col, row + 1) - at(col, row - 1)));
  }
  return { cells, columns, rows, width, height, size };
}
