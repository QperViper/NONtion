import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustColor, animation, noise, sampleGrid, tone } from '../../src/effects/ascii-math.ts';
import { vignetteBloomParameters as preset } from '../../src/effects/vignette-bloom.ts';
import { validatePatch } from '../validation.ts';

test('promedia todos los píxeles de una celda y no pierde las celdas parciales',()=>{
  const pixels=new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255, 0,0,0,255, 0,0,255,255]);
  const grid=sampleGrid(pixels,3,2,2);
  assert.equal(grid.cells.length,2);assert.deepEqual(grid.cells[0].rgb,[127.5,127.5,63.75]);
  assert.deepEqual(grid.cells[1].rgb,[0,0,255]);assert.equal(grid.cells[1].width,1);
  assert.equal(grid.cells[0].top[0],127.5);assert.equal(grid.cells[0].bottom[0],127.5);
});
test('los ajustes respetan brillo antes de contraste y desaturación al final',()=>{
  const p={...structuredClone(preset),brightness:20,contrast:200,saturation:100,grayscale:0};
  assert.deepEqual(adjustColor([100,100,100],p).map(Math.round),[112,112,112]);
  const gray=adjustColor([180,40,10],{...p,grayscale:100});assert.ok(Math.abs(gray[0]-gray[1])<1e-8&&Math.abs(gray[1]-gray[2])<1e-8);
  assert.equal(tone(.25,[{x:0,y:0},{x:.5,y:1},{x:1,y:1}]),.5);
});
test('muestreo y movimiento son deterministas, con cinco animaciones distintas',()=>{
  assert.equal(noise(2,3),noise(2,3));assert.ok(noise(2,3)>=0&&noise(2,3)<1);
  for(const style of ['wave','pulse','shimmer','ripple','flicker'] as const) {
    const a=animation(style,3,5,6,0,100),b=animation(style,3,5,6,1.3,100);
    assert.ok(Number.isFinite(a)&&a>=-1&&a<=1);assert.notEqual(a,b);
  }
});
test('el preset solicitado permanece en mosaico y solo activa viñeta y bloom',()=>{
  assert.equal(preset.cellSize,16);assert.equal(preset.renderMode,'mosaic');assert.equal(preset.coverage,100);
  assert.deepEqual(Object.entries(preset.pfx).filter(([,v])=>v.enabled).map(([key,v])=>[key,v.intensity]),[['vignette',38],['bloom',25]]);
  assert.equal(preset.animStyle,'wave');assert.equal(preset.animIntensity.intensity,60);assert.equal(preset.blurType,'off');
});
test('el fondo seleccionable admite restauración y rechaza opciones arbitrarias',()=>{
  assert.deepEqual(validatePatch({version:1,backgroundEffect:'vignette-bloom'},'settings'),[{column:'background_effect',value:'vignette-bloom'}]);
  assert.deepEqual(validatePatch({version:1,backgroundEffect:null},'settings'),[{column:'background_effect',value:null}]);
  assert.throws(()=>validatePatch({version:1,backgroundEffect:'inventado'},'settings'));
});
