export const renderModes = [
  'characters', 'dither', 'mosaic', 'pixel', 'dots', 'cross', 'diamond',
  'voxel', 'lego', 'mixed', 'lines', 'diagonal', 'braille', 'disco',
  'hexdump', 'matrix', 'rings', 'hearts', 'stars', 'hexagons',
  'triangles', 'bubbles', 'hatch', 'contour', 'halfblocks',
] as const;
export type RenderMode = typeof renderModes[number];
export type Rgb = readonly [number, number, number];
export type AnimationStyle = 'wave' | 'pulse' | 'shimmer' | 'ripple' | 'flicker';
export type BlurType = 'off' | 'gaussian' | 'directional' | 'radial' | 'zoom' | 'tilt-shift' | 'lens' | 'progressive';
export type EffectName = 'scanLines' | 'vignette' | 'bloom' | 'chromatic' | 'filmGrain' | 'glitch' | 'halftone' | 'pixelate' | 'filmDust';
export interface EffectControl { enabled: boolean; intensity: number; }
export interface LightPoint { x: number; y: number; radius: number; intensity: number; color?: string; }
export interface AsciiParameters {
  renderMode: RenderMode;
  bgMode: 'blur' | 'blurred' | 'solid' | 'original' | 'image' | 'none';
  bgBlur: number; bgOpacity: number;
  cellSize: number; coverage: number; invert: boolean; styleBlend: GlobalCompositeOperation;
  charSet: string; customChars: string;
  brightness: number; contrast: number; edgeEmphasis: number; density: number;
  toneCurve: { x: number; y: number }[];
  tint: string; tintOpacity: number; overlayBlend: GlobalCompositeOperation;
  saturation: number; grayscale: number;
  blurType: BlurType; blurAmount: number; blurAngle: number; directionalBothSides: boolean;
  tiltFocus: number; tiltPosition: number; tiltFeather: number; lensFocus: number;
  blurCenterX: number; blurCenterY: number; progressivePosition: number; progressiveReverse: boolean;
  pfx: Record<EffectName, EffectControl>;
  animated: boolean; animStyle: AnimationStyle; animSpeed: EffectControl; animIntensity: EffectControl;
  lights: { enabled: boolean; points: LightPoint[] };
  mask: { enabled: boolean; tool: string; brushSize: number; showOverlay: boolean; invert: boolean; dataUrl: string | null; shapes: unknown[] };
}
export interface Cell {
  x: number; y: number; width: number; height: number;
  rgb: Rgb; top: Rgb; bottom: Rgb; luminance: number; edge: number;
  braille: number[]; seed: number; radius: number;
}
export interface Grid { cells: Cell[]; columns: number; rows: number; width: number; height: number; size: number; }
