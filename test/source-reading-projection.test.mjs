import test from 'node:test';
import assert from 'node:assert/strict';
import { readingProjection } from '../modules/presentation/source/reading.mjs';
const declarations=[{id:'caller',kind:'function'},{id:'target',kind:'function'},{id:'binding',kind:'variable'}];
const item=(id,targets,status='resolved',provenance=[])=>({callerRef:'caller',reference:{id,kind:'call',resolution:{status,targets}},provenance});
test('group repeated connections without losing occurrence identities',()=>{
 const result=readingProjection({declarations,relationships:[item('one',['target']),item('two',['target'])]},'caller');
 assert.equal(result.edges.length,1);assert.deepEqual(result.edges[0].occurrences,['one','two']);assert.equal(result.internal.length,2);
});
test('follow explicit exported value and preserve its basis',()=>{
 const result=readingProjection({declarations,relationships:[item('call',['binding'],'resolved',[{bindingRef:'binding',resolution:{status:'resolved',targets:['target']}}])]},'caller');
 assert.equal(result.edges[0].to,'target');assert.deepEqual(result.edges[0].bases,['export-origin']);assert.equal(result.other.length,0);
});
test('uncertain candidates and non-callable bindings stay out of internal graph',()=>{
 const result=readingProjection({declarations,relationships:[item('ambiguous',['target'],'ambiguous'),item('parameter',['binding']),item('unknown',[],'unresolved')]},'caller');
 assert.equal(result.edges.length,0);assert.equal(result.other.length,3);
});
