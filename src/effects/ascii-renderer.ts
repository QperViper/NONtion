import { clamp, luminance, noise, sampleGrid, tone } from './ascii-math.ts';
import { drawCells } from './ascii-shapes.ts';
import type { AsciiParameters, EffectName, Grid } from './ascii-types.ts';

const effects: EffectName[] = ['scanLines', 'vignette', 'bloom', 'chromatic', 'filmGrain', 'glitch', 'halftone', 'pixelate', 'filmDust'];
function surface() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Tu navegador no admite Canvas2D.');
  return { canvas, context };
}
export class AsciiRenderer {
  private target: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private source = surface();
  private copy = surface();
  private work = surface();
  private mask = surface();
  private tiny = surface();
  private glow = surface();
  private glowBlur = surface();
  private grid: Grid | null = null;
  private photo: CanvasImageSource;
  private photoWidth: number;
  private photoHeight: number;
  private maskImage: HTMLImageElement | null = null;
  private scale = 1;
  private parameters: AsciiParameters;
  private colorLut = new Float64Array(256);
  private identityTone: boolean;

  constructor(target: HTMLCanvasElement, photo: CanvasImageSource, photoWidth: number, photoHeight: number, parameters: AsciiParameters) {
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Tu navegador no admite Canvas2D.');
    this.target = target; this.ctx = ctx; this.photo = photo;
    this.photoWidth = photoWidth; this.photoHeight = photoHeight; this.parameters = parameters;
    this.identityTone = parameters.toneCurve.length === 0 || parameters.toneCurve.every(point => point.x === point.y);
    for (let value = 0; value < 256; value++) {
      this.colorLut[value] = clamp((clamp(value + parameters.brightness, 0, 255) - 128) * parameters.contrast / 100 + 128, 0, 255);
    }
  }
  async prepareMask() {
    if (!this.parameters.mask.enabled || !this.parameters.mask.dataUrl) return;
    const image = new Image(); image.src = this.parameters.mask.dataUrl;
    await image.decode(); this.maskImage = image;
  }
  resize(cssWidth: number, cssHeight: number, dpr = 1) {
    // cellSize stays in CSS pixels even on high-DPI/large displays. Bound the
    // raster allocation, not the number/size of the visible cells.
    this.scale = Math.min(Math.max(1, dpr), 1280 / Math.max(1, cssWidth, cssHeight), Math.sqrt(1_000_000 / Math.max(1, cssWidth * cssHeight)));
    const width = Math.max(1, Math.round(cssWidth * this.scale)), height = Math.max(1, Math.round(cssHeight * this.scale));
    for (const canvas of [this.target, this.source.canvas, this.copy.canvas, this.work.canvas, this.mask.canvas]) {
      canvas.width = width; canvas.height = height;
    }
    for (const { canvas } of [this.glow, this.glowBlur]) {
      canvas.width = Math.max(1, Math.ceil(width / 4)); canvas.height = Math.max(1, Math.ceil(height / 4));
    }
    const fit = Math.max(width / this.photoWidth, height / this.photoHeight);
    this.source.context.drawImage(this.photo, (width - this.photoWidth * fit) / 2, (height - this.photoHeight * fit) / 2, this.photoWidth * fit, this.photoHeight * fit);
    const pixels = this.source.context.getImageData(0, 0, width, height);
    this.grid = sampleGrid(pixels.data, width, height, Math.max(1, this.parameters.cellSize * this.scale));
    if (this.maskImage) {
      const ctx = this.mask.context;
      ctx.drawImage(this.maskImage, 0, 0, width, height);
      const mask = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < mask.data.length; i += 4) {
        let reveal = luminance(mask.data[i], mask.data[i + 1], mask.data[i + 2]) * mask.data[i + 3] / 255;
        if (this.parameters.mask.invert) reveal = 1 - reveal;
        mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 255; mask.data[i + 3] = reveal * 255;
      }
      ctx.putImageData(mask, 0, 0);
    }
  }
  private snapshot() {
    this.copy.context.clearRect(0, 0, this.target.width, this.target.height);
    this.copy.context.drawImage(this.target, 0, 0);
  }
  private replace(source: HTMLCanvasElement) {
    this.ctx.clearRect(0, 0, this.target.width, this.target.height); this.ctx.drawImage(source, 0, 0);
  }
  private adjust() {
    const p = this.parameters, ctx = this.ctx, { width, height } = this.target;
    const frame = ctx.getImageData(0, 0, width, height), data = frame.data;
    const saturation = p.saturation / 100, grayMix = clamp(p.grayscale / 100);
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (!this.identityTone) {
        const l = luminance(r, g, b), mapped = tone(l, p.toneCurve), ratio = l ? mapped / l : 1, lift = l ? 0 : mapped * 255;
        r = clamp(r * ratio + lift, 0, 255); g = clamp(g * ratio + lift, 0, 255); b = clamp(b * ratio + lift, 0, 255);
      }
      r = this.colorLut[Math.round(r)]; g = this.colorLut[Math.round(g)]; b = this.colorLut[Math.round(b)];
      if (saturation !== 1 || grayMix !== 0) {
        const l = luminance(r, g, b) * 255;
        r = clamp(l + (r - l) * saturation, 0, 255); g = clamp(l + (g - l) * saturation, 0, 255); b = clamp(l + (b - l) * saturation, 0, 255);
        const gray = luminance(r, g, b) * 255;
        r = r * (1 - grayMix) + gray * grayMix; g = g * (1 - grayMix) + gray * grayMix; b = b * (1 - grayMix) + gray * grayMix;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
    ctx.putImageData(frame, 0, 0);
    if (p.tintOpacity > 0) {
      // Blend straight RGB on an opaque scratch surface, then restore the exact
      // original alpha. Painting a tint directly would fill bgMode=none gaps.
      const alpha = new Uint8Array(width * height);
      for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) { alpha[pixel] = data[i + 3]; data[i + 3] = 255; }
      const work = this.work.context; work.putImageData(frame, 0, 0);
      work.save(); work.globalCompositeOperation = p.overlayBlend;
      work.globalAlpha = clamp(p.tintOpacity / 100); work.fillStyle = p.tint; work.fillRect(0, 0, width, height); work.restore();
      const tinted = work.getImageData(0, 0, width, height);
      for (let i = 3, pixel = 0; i < tinted.data.length; i += 4, pixel++) tinted.data[i] = alpha[pixel];
      ctx.putImageData(tinted, 0, 0);
    }
  }
  private blur() {
    const p = this.parameters;
    if (p.blurType === 'off' || p.blurAmount <= 0) return;
    const { width: w, height: h } = this.target, radius = p.blurAmount / 100 * 30 * this.scale;
    const ctx = this.work.context;
    this.snapshot(); ctx.clearRect(0, 0, w, h);
    if (p.blurType === 'directional' || p.blurType === 'radial' || p.blurType === 'zoom') {
      const samples = 15, cx = w * p.blurCenterX / 100, cy = h * p.blurCenterY / 100;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 / samples;
      for (let i = 0; i < samples; i++) {
        const progress = i / (samples - 1) - (p.directionalBothSides ? .5 : 0);
        ctx.save();
        if (p.blurType === 'directional') {
          const angle = p.blurAngle * Math.PI / 180;
          ctx.translate(Math.cos(angle) * radius * progress, Math.sin(angle) * radius * progress);
        } else {
          ctx.translate(cx, cy);
          if (p.blurType === 'radial') ctx.rotate(progress * p.blurAmount / 100 * .2);
          else { const factor = 1 + progress * p.blurAmount / 100 * .12; ctx.scale(factor, factor); }
          ctx.translate(-cx, -cy);
        }
        ctx.drawImage(this.copy.canvas, 0, 0); ctx.restore();
      }
      ctx.restore(); this.replace(this.work.canvas); return;
    }
    ctx.save(); ctx.filter = `blur(${radius}px)`; ctx.drawImage(this.copy.canvas, 0, 0); ctx.restore();
    if (p.blurType !== 'gaussian') {
      let gradient: CanvasGradient;
      if (p.blurType === 'lens') {
        const cx = w * p.blurCenterX / 100, cy = h * p.blurCenterY / 100;
        gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * .75);
        gradient.addColorStop(0, 'transparent'); gradient.addColorStop(clamp(p.lensFocus / 100, 0, .98), 'transparent'); gradient.addColorStop(1, '#fff');
      } else if (p.blurType === 'progressive') {
        gradient = ctx.createLinearGradient(0, p.progressiveReverse ? h : 0, 0, p.progressiveReverse ? 0 : h);
        gradient.addColorStop(0, 'transparent'); gradient.addColorStop(clamp(p.progressivePosition / 100, 0, .98), 'transparent'); gradient.addColorStop(1, '#fff');
      } else {
        gradient = ctx.createLinearGradient(0, 0, 0, h);
        const center = p.tiltPosition / 100, focus = p.tiltFocus / 200, feather = p.tiltFeather / 100;
        gradient.addColorStop(0, '#fff'); gradient.addColorStop(clamp(center - focus - feather), '#fff');
        gradient.addColorStop(clamp(center - focus), 'transparent'); gradient.addColorStop(clamp(center + focus), 'transparent');
        gradient.addColorStop(clamp(center + focus + feather), '#fff'); gradient.addColorStop(1, '#fff');
      }
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h); ctx.restore();
      this.ctx.drawImage(this.work.canvas, 0, 0);
    } else this.replace(this.work.canvas);
  }
  private postEffect(name: EffectName, intensity: number, time: number) {
    const ctx = this.ctx, { width: w, height: h } = this.target, s = this.scale, strength = clamp(intensity / 100);
    if (!strength) return;
    ctx.save();
    switch (name) {
      case 'scanLines':
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${strength * .55})`;
        for (let y = 0; y < h; y += Math.max(2, 4 * s)) ctx.fillRect(0, y, w, Math.max(.6, s)); break;
      case 'vignette': {
        ctx.globalCompositeOperation = 'source-atop';
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .16, w / 2, h / 2, Math.hypot(w, h) / 2);
        gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h); break;
      }
      case 'bloom': {
        const bright = ctx.getImageData(0, 0, w, h), data = bright.data;
        for (let i = 0; i < data.length; i += 4) data[i + 3] *= clamp((luminance(data[i], data[i + 1], data[i + 2]) - .35) / .65);
        this.copy.context.putImageData(bright, 0, 0);
        // Bloom is a low-frequency layer: blur at quarter resolution, keeping
        // radii in target pixels, then upsample. Cell geometry stays full size.
        const { width: gw, height: gh } = this.glow.canvas;
        this.glow.context.clearRect(0, 0, gw, gh); this.glow.context.drawImage(this.copy.canvas, 0, 0, gw, gh);
        const glow = this.glowBlur.context;
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = strength;
        for (const radius of [4, 18]) {
          glow.clearRect(0, 0, gw, gh); glow.save(); glow.filter = `blur(${radius * s * gw / w}px)`;
          glow.drawImage(this.glow.canvas, 0, 0); glow.restore(); ctx.drawImage(this.glowBlur.canvas, 0, 0, w, h);
        }
        break;
      }
      case 'chromatic': {
        const frame = ctx.getImageData(0, 0, w, h), original = new Uint8ClampedArray(frame.data), shift = Math.max(1, Math.round(strength * 8 * s));
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          frame.data[i] = original[(y * w + Math.min(w - 1, x + shift)) * 4];
          frame.data[i + 2] = original[(y * w + Math.max(0, x - shift)) * 4 + 2];
        }
        ctx.putImageData(frame, 0, 0); break;
      }
      case 'filmGrain': {
        const frame = ctx.getImageData(0, 0, w, h), tick = Math.floor(time * 24);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, grain = (noise(x, y, tick) - .5) * 65 * strength;
          frame.data[i] += grain; frame.data[i + 1] += grain; frame.data[i + 2] += grain;
        }
        ctx.putImageData(frame, 0, 0); break;
      }
      case 'glitch': {
        this.snapshot(); const tick = Math.floor(time * 8);
        for (let i = 0; i < Math.ceil(strength * 14); i++) {
          const y = noise(i, 0, tick) * h, strip = Math.max(1, noise(i, 1, tick) * 18 * s);
          ctx.drawImage(this.copy.canvas, 0, y, w, Math.min(strip, h - y), (noise(i, 2, tick) - .5) * 80 * strength * s, y, w, Math.min(strip, h - y));
        }
        break;
      }
      case 'halftone': {
        const step = Math.max(3, 7 * s), frame = ctx.getImageData(0, 0, w, h);
        ctx.fillStyle = `rgba(0,0,0,${strength * .85})`;
        for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
          const i = (Math.floor(y) * w + Math.floor(x)) * 4, dark = 1 - luminance(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
          ctx.beginPath(); ctx.arc(x, y, step * .4 * dark, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pixelate': {
        const step = Math.max(2, (2 + strength * 16) * s);
        this.tiny.canvas.width = Math.max(1, Math.round(w / step)); this.tiny.canvas.height = Math.max(1, Math.round(h / step));
        this.tiny.context.drawImage(this.target, 0, 0, this.tiny.canvas.width, this.tiny.canvas.height);
        ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, w, h); ctx.drawImage(this.tiny.canvas, 0, 0, w, h); break;
      }
      case 'filmDust': {
        const tick = Math.floor(time * 5); ctx.fillStyle = `rgba(255,248,230,${strength * .7})`; ctx.strokeStyle = `rgba(255,248,230,${strength * .4})`;
        for (let i = 0; i < Math.ceil(strength * 70); i++) {
          const x = noise(i, 0, tick) * w, y = noise(i, 1, tick) * h;
          ctx.beginPath(); ctx.arc(x, y, Math.max(.5, noise(i, 2, tick) * 2 * s), 0, Math.PI * 2); ctx.fill();
          if (i % 17 === 0) { ctx.lineWidth = Math.max(.5, s * .5); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, Math.min(h, y + 50 * s)); ctx.stroke(); }
        }
        break;
      }
    }
    ctx.restore();
  }
  render(timeSeconds = 0) {
    if (!this.grid) return;
    const p = this.parameters, ctx = this.ctx, { width: w, height: h } = this.target;
    const time = p.animated || p.renderMode === 'matrix' ? timeSeconds : 0;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = clamp(p.bgOpacity / 100);
    if (p.bgMode === 'solid') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
    else if (p.bgMode !== 'none') {
      if (p.bgMode === 'blur' || p.bgMode === 'blurred') ctx.filter = `blur(${p.bgBlur * this.scale}px)`;
      ctx.drawImage(this.source.canvas, 0, 0);
    }
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = p.styleBlend; drawCells(ctx, this.grid, p, time, this.scale); ctx.restore();
    this.adjust(); this.blur();
    for (const name of effects) if (p.pfx[name]?.enabled) this.postEffect(name, p.pfx[name].intensity, time * (p.animSpeed.enabled ? p.animSpeed.intensity / 100 : 0));
    if (p.lights.enabled) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (const point of p.lights.points) {
        const x = point.x * w, y = point.y * h, radius = Math.max(1, Math.min(w, h) * (point.radius <= 1 ? point.radius : point.radius / 100));
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, point.color || '#fff'); gradient.addColorStop(1, 'transparent');
        ctx.globalAlpha = clamp(point.intensity <= 1 ? point.intensity : point.intensity / 100); ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    }
    if (p.mask.enabled && this.maskImage) {
      const work = this.work.context; work.clearRect(0, 0, w, h); work.drawImage(this.source.canvas, 0, 0);
      work.save(); work.globalCompositeOperation = 'destination-in'; work.drawImage(this.mask.canvas, 0, 0); work.restore();
      ctx.drawImage(this.work.canvas, 0, 0);
    }
  }
  dispose() {
    for (const { canvas } of [this.source, this.copy, this.work, this.mask, this.tiny, this.glow, this.glowBlur]) { canvas.width = 1; canvas.height = 1; }
    this.grid = null; this.maskImage = null;
  }
}
