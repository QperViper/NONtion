import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@blocknote/core';
import { threadIds } from '../../src/lib/hyperthreads.ts';

test('las conexiones activas siguen a enlaces en texto, bloques anidados y tablas',()=>{
  const blocks=[{type:'paragraph',content:[{type:'text',text:'antes'},{type:'link',href:'/hilo/uno',content:[]}],children:[{type:'paragraph',content:[{type:'link',href:'/hilo/dos',content:[]}]}]},
    {type:'table',content:{type:'tableContent',rows:[{cells:[[{type:'link',href:'/hilo/tres',content:[]}]]}]}}] as unknown as Block[];
  assert.deepEqual([...threadIds(blocks)],['uno','dos','tres']);
  assert.equal(threadIds([{type:'paragraph',content:[],children:[]} as unknown as Block]).size,0);
});
