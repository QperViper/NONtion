import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePatch, uuid } from '../validation.ts';

test('PATCH omite imágenes no enviadas y permite borrarlas explícitamente',()=>{
  assert.deepEqual(validatePatch({version:1,bgBlur:4},'settings'),[{column:'bg_blur',value:4}]);
  assert.deepEqual(validatePatch({version:1,bgImage:null},'settings'),[{column:'bg_image',value:null}]);
});
test('rechaza versiones ausentes, campos arbitrarios y rangos fuera de contrato',()=>{
  for(const patch of [{title:'x'},{version:0,title:'x'},{version:1,id:'x'},{version:1,bgBlur:-1},{version:1,themeColor:'red'},{version:1,bgImage:'javascript:alert(1)'}])assert.throws(()=>validatePatch(patch,'settings'));
  assert.throws(()=>uuid('not-a-uuid'));
});
test('el título vacío se normaliza y contenido vacío sigue siendo un cambio válido',()=>{
  assert.deepEqual(validatePatch({version:1,title:'',content:[]},'document'),[{column:'title',value:'Sin título'},{column:'content',value:'[]'}]);
});
test('papelera reversible y personalización solo admiten valores conocidos',()=>{
  assert.deepEqual(validatePatch({version:1,deletedAt:null},'document'),[{column:'deleted_at',value:null}]);
  assert.doesNotThrow(()=>validatePatch({version:1,customizations:{'action.search':{emoji:'✨',zone:'toolbar',order:2,size:24}}},'settings'));
  assert.throws(()=>validatePatch({version:1,customizations:{'action.search':{position:'fixed'}}},'settings'));
});
