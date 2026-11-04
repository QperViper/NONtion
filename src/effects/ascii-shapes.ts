import { animation, clamp } from './ascii-math.ts';
import type { AsciiParameters, Grid, Rgb } from './ascii-types.ts';

const charSets: Record<string, string> = {
  standard: ' .:-=+*#%@', detailed: ' .`^",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@',
  binary: ' 01', blocks: ' ░▒▓█', minimal: ' .oO@', numeric: ' 0123456789',
};
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const css = (rgb: Rgb, scale = 1) => `rgb(${Math.round(clamp(rgb[0] * scale, 0, 255))} ${Math.round(clamp(rgb[1] * scale, 0, 255))} ${Math.round(clamp(rgb[2] * scale, 0, 255))})`;
function polygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, sides: number, inner = radius, rotation = -Math.PI / 2) {
  ctx.beginPath();
  const points = sides * (inner === radius ? 1 : 2);
  for (let i = 0; i < points; i++) {
    const angle = rotation + i * Math.PI * 2 / points, r = i % 2 ? inner : radius;
    if (!i) ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    else ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  ctx.closePath(); ctx.fill();
}
function contour(ctx: CanvasRenderingContext2D, grid: Grid, col: number, row: number, rgb: Rgb, scale: number) {
  if (col >= grid.columns - 1 || row >= grid.rows - 1) return;
  const a = grid.cells[row * grid.columns + col], b = grid.cells[row * grid.columns + col + 1];
  const c = grid.cells[(row + 1) * grid.columns + col + 1], d = grid.cells[(row + 1) * grid.columns + col];
  const corners = [a, b, c, d];
  ctx.strokeStyle = css(rgb, 1.4); ctx.lineWidth = Math.max(.6, scale);
  for (let level = .05; level < 1; level += .1) {
    const crossings: [number, number][] = [];
    for (let edge = 0; edge < 4; edge++) {
      const p = corners[edge], q = corners[(edge + 1) % 4];
      if ((p.luminance < level) === (q.luminance < level)) continue;
      const t = (level - p.luminance) / (q.luminance - p.luminance);
      crossings.push([p.x + p.width / 2 + (q.x + q.width / 2 - p.x - p.width / 2) * t,
        p.y + p.height / 2 + (q.y + q.height / 2 - p.y - p.height / 2) * t]);
    }
    // Four crossings represent a saddle; keep each pair separate.
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      ctx.beginPath(); ctx.moveTo(...crossings[i]); ctx.lineTo(...crossings[i + 1]); ctx.stroke();
    }
  }
}
export function drawCells(ctx: CanvasRenderingContext2D, grid: Grid, p: AsciiParameters, time: number, scale: number) {
  const speed = p.animSpeed.enabled ? p.animSpeed.intensity / 100 : 0;
  const strength = p.animIntensity.enabled ? p.animIntensity.intensity / 100 : 0;
  const t = time * speed;
  const characters = Array.from(p.charSet === 'custom' ? p.customChars || ' ' : charSets[p.charSet] || charSets.standard);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let index = 0; index < grid.cells.length; index++) {
    const cell = grid.cells[index], col = index % grid.columns, row = Math.floor(index / grid.columns);
    if (cell.seed >= clamp(p.coverage / 100)) continue;
    const wave = p.animated ? animation(p.animStyle, col, row, cell.radius, t, Math.floor(cell.seed * 10000)) * strength : 0;
    const l = clamp((p.invert ? 1 - cell.luminance : cell.luminance) + cell.edge * p.edgeEmphasis / 100);
    const rgb: Rgb = p.invert ? cell.rgb.map(c => 255 - c) as [number, number, number] : cell.rgb;
    const ink = clamp(l + p.density / 100, .04, 1), pulse = 1 + wave * .12;
    const density = clamp(1 + p.density / 100, .1, 2);
    const width = Math.max(.2, cell.width - scale) * pulse * density, height = Math.max(.2, cell.height - scale) * pulse * density;
    const cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2;
    const radius = Math.min(width, height) / 2;
    const color = css(rgb, 1 + wave * .14 + cell.edge * p.edgeEmphasis / 100 + p.density / 200);
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(.6 * scale, radius * .14 * ink);
    const glyph = (text: string, amount = ink) => {
      ctx.font = `${Math.max(1, grid.size * (.65 + .35 * amount) * pulse)}px ui-monospace, "Courier New", monospace`;
      ctx.fillText(text, cx, cy + grid.size * .035);
    };
    switch (p.renderMode) {
      case 'mosaic':
        ctx.beginPath(); ctx.roundRect(cx - width / 2, cy - height / 2, width, height, Math.min(width, height) * .16); ctx.fill(); break;
      case 'pixel': ctx.fillRect(cell.x, cell.y, cell.width, cell.height); break;
      case 'characters': glyph(characters[Math.min(characters.length - 1, Math.floor(ink * characters.length))]); break;
      case 'hexdump': glyph('0123456789ABCDEF'[Math.min(15, Math.floor(ink * 16))]); break;
      case 'matrix': {
        const head = (t * 8 + col * 3.71) % (grid.rows + 10);
        const trail = (head - row + grid.rows + 10) % (grid.rows + 10);
        const glow = trail < 10 ? 1 - trail / 10 : .08;
        ctx.fillStyle = `rgb(${Math.round(glow * 90)} ${Math.round((60 + ink * 195) * glow)} ${Math.round(glow * 100)})`;
        glyph(String.fromCharCode(0x30a0 + Math.floor((cell.seed * 95 + Math.floor(t * 9)) % 95))); break;
      }
      case 'dither': {
        const light = ink > (bayer[(row % 4) * 4 + col % 4] + .5) / 16;
        ctx.fillStyle = light ? '#fff' : '#000'; ctx.fillRect(cell.x, cell.y, cell.width, cell.height); break;
      }
      case 'dots': ctx.beginPath(); ctx.arc(cx, cy, radius * Math.sqrt(ink), 0, Math.PI * 2); ctx.fill(); break;
      case 'cross':
        ctx.beginPath(); ctx.moveTo(cx - radius * ink, cy); ctx.lineTo(cx + radius * ink, cy);
        ctx.moveTo(cx, cy - radius * ink); ctx.lineTo(cx, cy + radius * ink); ctx.stroke(); break;
      case 'diamond': polygon(ctx, cx, cy, radius * Math.sqrt(ink), 4); break;
      case 'hexagons': polygon(ctx, cx + (row % 2 ? grid.size * .5 : 0), cy, radius * 1.06, 6, radius * 1.06); break;
      case 'stars': polygon(ctx, cx, cy, radius * Math.sqrt(ink), 5, radius * .4 * Math.sqrt(ink)); break;
      case 'hearts': {
        const r = radius * Math.sqrt(ink);
        ctx.beginPath(); ctx.moveTo(cx, cy + r);
        ctx.bezierCurveTo(cx - r * 2, cy - r * .2, cx - r * .65, cy - r * 1.6, cx, cy - r * .5);
        ctx.bezierCurveTo(cx + r * .65, cy - r * 1.6, cx + r * 2, cy - r * .2, cx, cy + r); ctx.fill(); break;
      }
      case 'voxel': {
        const r = radius * (.3 + ink * .7);
        ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy - r * .4); ctx.lineTo(cx, cy + r * .2); ctx.lineTo(cx - r, cy - r * .4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = css(rgb, .65); ctx.beginPath(); ctx.moveTo(cx - r, cy - r * .4); ctx.lineTo(cx, cy + r * .2); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy + r * .4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = css(rgb, .85); ctx.beginPath(); ctx.moveTo(cx, cy + r * .2); ctx.lineTo(cx + r, cy - r * .4); ctx.lineTo(cx + r, cy + r * .4); ctx.lineTo(cx, cy + r); ctx.closePath(); ctx.fill(); break;
      }
      case 'lego':
        ctx.fillRect(cx - width / 2, cy - height / 2, width, height);
        ctx.fillStyle = css(rgb, 1.3); ctx.beginPath(); ctx.arc(cx, cy, radius * .46, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = css(rgb, .65); ctx.stroke(); break;
      case 'mixed':
        if (cell.seed < .33) glyph(characters[Math.min(characters.length - 1, Math.floor(ink * characters.length))]);
        else if (cell.seed < .66) { ctx.beginPath(); ctx.arc(cx, cy, radius * ink, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke(); } break;
      case 'lines':
        for (let i = 0; i < Math.ceil(ink * 4); i++) { const y = cell.y + (i + .5) * cell.height / 4; ctx.beginPath(); ctx.moveTo(cell.x, y); ctx.lineTo(cell.x + width, y); ctx.stroke(); } break;
      case 'diagonal':
        ctx.beginPath(); ctx.moveTo(cx - radius * ink, cy + radius * ink); ctx.lineTo(cx + radius * ink, cy - radius * ink); ctx.stroke(); break;
      case 'braille': {
        const bits = [0, 3, 1, 4, 2, 5, 6, 7]; let code = 0;
        for (let i = 0; i < 8; i++) if ((p.invert ? 1 - cell.braille[i] : cell.braille[i]) > .35 - p.density / 200) code |= 1 << bits[i];
        glyph(String.fromCharCode(0x2800 + code), 1); break;
      }
      case 'disco':
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(wave * .2 + cell.seed * .2);
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.fillStyle = `hsla(${cell.seed * 360 + t * 20},80%,65%,.22)`; ctx.fillRect(-width / 2, -height / 2, width, height); ctx.restore(); break;
      case 'rings': ctx.beginPath(); ctx.arc(cx, cy, radius * (.3 + ink * .65), 0, Math.PI * 2); ctx.stroke(); break;
      case 'triangles':
        ctx.fillStyle = css(p.invert ? cell.top.map(c => 255 - c) as [number, number, number] : cell.top, 1 + wave * .14 + p.density / 200);
        ctx.beginPath(); ctx.moveTo(cell.x, cell.y); ctx.lineTo(cell.x + cell.width, cell.y); ctx.lineTo(cell.x, cell.y + cell.height); ctx.closePath(); ctx.fill();
        ctx.fillStyle = css(p.invert ? cell.bottom.map(c => 255 - c) as [number, number, number] : cell.bottom, 1 + wave * .14 + p.density / 200);
        ctx.beginPath(); ctx.moveTo(cell.x + cell.width, cell.y); ctx.lineTo(cell.x + cell.width, cell.y + cell.height); ctx.lineTo(cell.x, cell.y + cell.height); ctx.closePath(); ctx.fill(); break;
      case 'bubbles': {
        const r = radius * Math.sqrt(ink), gradient = ctx.createRadialGradient(cx - r * .3, cy - r * .3, 0, cx, cy, Math.max(.01, r));
        gradient.addColorStop(0, css(rgb, 1.7)); gradient.addColorStop(.45, css(rgb, .7)); gradient.addColorStop(1, color);
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
      }
      case 'hatch': {
        const strokes = Math.ceil(ink * 5);
        ctx.save(); ctx.beginPath(); ctx.rect(cell.x, cell.y, cell.width, cell.height); ctx.clip();
        for (let i = -strokes; i <= strokes; i++) {
          const offset = i * cell.width / Math.max(1, strokes);
          ctx.beginPath(); ctx.moveTo(cell.x + offset, cell.y + cell.height); ctx.lineTo(cell.x + offset + cell.width, cell.y); ctx.stroke();
          if (ink > .45) { ctx.beginPath(); ctx.moveTo(cell.x + offset, cell.y); ctx.lineTo(cell.x + offset + cell.width, cell.y + cell.height); ctx.stroke(); }
        }
        ctx.restore(); break;
      }
      case 'contour': contour(ctx, grid, col, row, rgb, scale); break;
      case 'halfblocks':
        ctx.fillStyle = css(p.invert ? cell.top.map(c => 255 - c) as [number, number, number] : cell.top, 1 + wave * .14 + p.density / 200); ctx.fillRect(cell.x, cell.y, width, cell.height / 2);
        ctx.fillStyle = css(p.invert ? cell.bottom.map(c => 255 - c) as [number, number, number] : cell.bottom, 1 + wave * .14 + p.density / 200); ctx.fillRect(cell.x, cell.y + cell.height / 2, width, cell.height / 2); break;
    }
  }
}
