import test from 'node:test';
import assert from 'node:assert/strict';
import { visitReadingTrail, prioritizeReadingEdges, readingRecordLabel } from '../modules/presentation/source/history.mjs';

test('returning to an ancestor restores its view without mutating prior history',()=>{
 const trail=[{id:'A',mode:'clean',limit:8,otherOpen:false},{id:'B',mode:'raw',limit:24,otherOpen:true},{id:'C',mode:'clean',limit:8,otherOpen:false}];
 const before=structuredClone(trail);
 const next=visitReadingTrail(trail,'B',{mode:'clean',limit:16,otherOpen:true});
 assert.deepEqual(next,before.slice(0,2));assert.deepEqual(trail,before);
 assert.equal(next.at(-1).limit,24);assert.equal(next.at(-1).otherOpen,true);
});
test('a new branch saves the current view; an independent search resets the trail',()=>{
 const trail=[{id:'A',mode:'clean',limit:8,otherOpen:false}];
 const next=visitReadingTrail(trail,'B',{mode:'raw',limit:16,otherOpen:true});
 assert.equal(next[0].limit,16);assert.equal(next[1].mode,'raw');assert.equal(next[1].limit,8);
 assert.deepEqual(visitReadingTrail(next,'D',{mode:'clean',limit:24,otherOpen:false},true),[{id:'D',mode:'clean',limit:8,otherOpen:false}]);
});
test('visited callers survive a crowded outgoing neighborhood without inventing edges',()=>{
 const edges=[...Array.from({length:15},(_,i)=>({from:'B',to:'D'+i})),{from:'A',to:'B'}];
 const result=prioritizeReadingEdges(edges,'B',['A','B']);
 assert.equal(result[0],edges.at(-1));assert.equal(result.length,edges.length);
 assert.deepEqual(new Set(result),new Set(edges));
 assert.ok(prioritizeReadingEdges(edges,'B',[]).slice(0,8).some(e=>e.from==='A'));
 assert.equal(prioritizeReadingEdges(edges,'B',['imaginary','B']).length,edges.length);
});
test('file paths are display names while identities remain separate',()=>{
 assert.equal(readingRecordLabel({id:'file-123',path:'src/main.mjs'}),'src/main.mjs');
 assert.equal(readingRecordLabel({id:'decl-123',name:'run'}),'run');
});
