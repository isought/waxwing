import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {analyzeSources} from '../modules/analysis/index.mjs';
import {loadModel} from '../modules/application/load-model.mjs';
import {captureSourceTexts,buildConnectedSiteFiles} from '../modules/application/connected.mjs';
import {buildCollection} from '../modules/application/collection.mjs';
import {layoutModel} from '../modules/presentation/layout/index.mjs';
import {renderSite} from '../modules/presentation/site/index.mjs';
import {writeSite,recoverSite} from '../modules/application/site-files.mjs';
import {digest} from '../modules/knowledge/shared/model.mjs';
import {graphsOf} from '../modules/knowledge/architecture/graphs.mjs';

const content = '\ufeffexport function entry() { return "</script><script>bad()</script>"; }\n';
const snapshot = await analyzeSources([{path:'app.mjs',content}],{sourceId:'test-code'});
const entry = snapshot.declarations.find(d=>d.name==='entry');
const model = loadModel(new URL('../examples/order-processing/model.json',import.meta.url)).model;
const graph = graphsOf(model)[0], subject = {kind:'node',graphRef:graph.id,ref:graph.entityRefs[0]};
const sidecar = {schemaVersion:'0.1-source-links-draft',modelId:model.id,modelDigest:digest(model),snapshotId:snapshot.id,links:[{
  id:'entry-implementation',subject,entryRef:entry.id,evidenceRefs:[entry.id],label:'Explore implementation',
  basis:{status:'reported',explanation:'Test mapping; no architectural claim is promoted.',sourceRefs:[model.sources[0].id]},rationaleNoteRefs:[],
}]};
const layout = await layoutModel(model);
const sourceData = files => JSON.parse(files.get('source/index.html').match(/<script type="application\/json" id="source-data">(.*?)<\/script>/s)[1]);
function temporary(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'waxwing-connected-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('connected publication has precise source entry and return context without modifying either native model',t=>{
  const before=structuredClone({model,snapshot,sidecar});
  const files=renderSite(layout,{source:{snapshot,links:sidecar,sourceTexts:{[entry.fileRef]:content}}});
  assert.ok(files.get(`graphs/${graph.id}.html`).includes(`../source/index.html?context=entry-implementation#${entry.id}`));
  const data=sourceData(files);
  assert.equal(data.connections[0].returnURL,`../graphs/${graph.id}.html#record-${subject.ref}`);
  assert.equal(data.connections[0].basis.status,'reported');
  assert.deepEqual(JSON.parse(files.get('source/model.json')),model);
  assert.deepEqual(JSON.parse(files.get('source/snapshot.json')),snapshot);
  assert.deepEqual({model,snapshot,sidecar},before);
  assert.ok(!files.get('source/index.html').includes('<script>bad()</script>'));
  const dir=temporary(t),first=path.join(dir,'first'),moved=path.join(dir,'moved');
  writeSite(files,first);fs.renameSync(first,moved);
  assert.deepEqual(recoverSite(moved),model);
  // Connected outputs remain ordinary managed sites and can be rebuilt independently.
  writeSite(renderSite(layout),moved);
  assert.equal(fs.existsSync(path.join(moved,'source/index.html')),false);
});

test('missing and stale connections preserve independent system and source views with explicit diagnostics',()=>{
  const independent=renderSite(layout,{source:{snapshot}});
  assert.deepEqual(sourceData(independent).connections,[]);
  assert.ok(independent.get('index.html').includes('Explore code'));
  const stale=structuredClone(sidecar);stale.modelDigest='0'.repeat(64);
  const files=renderSite(layout,{source:{snapshot,links:stale}}),data=sourceData(files);
  assert.deepEqual(data.connections,[]);
  assert.ok(data.bridgeDiagnostics.length);
  assert.ok(files.get(`graphs/${graph.id}.html`).includes('Source connections unavailable'));
  assert.ok(!files.get(`graphs/${graph.id}.html`).includes('?context=entry-implementation'));
});

test('source capture pins exact UTF-8 bytes including BOM and withholds stale or symlinked evidence',t=>{
  const dir=temporary(t),filename=path.join(dir,'app.mjs');fs.writeFileSync(filename,content);
  assert.equal(captureSourceTexts(snapshot,dir).sourceTexts[entry.fileRef],content);
  fs.writeFileSync(filename,content.replace('entry','other'));
  const changed=captureSourceTexts(snapshot,dir);
  assert.deepEqual(changed.sourceTexts,{});assert.match(changed.diagnostics[0].message,/changed-bytes/);
  fs.unlinkSync(filename);const original=path.join(dir,'original.mjs');fs.writeFileSync(original,content);fs.symlinkSync(original,filename);
  assert.match(captureSourceTexts(snapshot,dir).diagnostics[0].message,/symlink/);
});

test('connected CLI exports full portable evidence and source-root input cannot be replaced',async t=>{
  const dir=temporary(t),root=path.join(dir,'code');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'app.mjs'),content);
  const input=path.join(dir,'model.json'),scan=path.join(dir,'scan.json'),links=path.join(dir,'links.json'),out=path.join(dir,'site');
  fs.writeFileSync(input,JSON.stringify(model));fs.writeFileSync(scan,JSON.stringify(snapshot));fs.writeFileSync(links,JSON.stringify(sidecar));
  const result=spawnSync(process.execPath,['bin/waxwing.mjs','build-connected',input,scan,links,out,'--source-root',root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).connections,1);
  assert.deepEqual(recoverSite(out),model);
  const original=fs.readFileSync(path.join(out,'source/index.html'),'utf8');
  fs.writeFileSync(scan,'{}');
  await assert.rejects(buildConnectedSiteFiles(input,scan,links,out,{sourceRoot:root}),/Invalid/);
  assert.equal(fs.readFileSync(path.join(out,'source/index.html'),'utf8'),original);
  fs.writeFileSync(scan,JSON.stringify(snapshot));
  await assert.rejects(buildConnectedSiteFiles(input,scan,null,root,{sourceRoot:root}),/input files/);
  assert.equal(fs.readFileSync(path.join(root,'app.mjs'),'utf8'),content);
});

test('a missing evidence root and a file replaced by a FIFO cannot disable or hang the source graph',t=>{
  const dir=temporary(t),missing=captureSourceTexts(snapshot,path.join(dir,'missing'));
  assert.deepEqual(missing.sourceTexts,{});assert.equal(missing.diagnostics[0].code,'source-text/root-unavailable');
  if (process.platform==='win32') return;
  const fifo=spawnSync('mkfifo',[path.join(dir,'app.mjs')],{encoding:'utf8'});
  assert.equal(fifo.status,0,fifo.stderr);
  const scan=path.join(dir,'scan.json');fs.writeFileSync(scan,JSON.stringify(snapshot));
  const run=spawnSync(process.execPath,['--input-type=module','-e',`
    import fs from 'node:fs';
    import {captureSourceTexts} from './modules/application/connected.mjs';
    console.log(JSON.stringify(captureSourceTexts(JSON.parse(fs.readFileSync(process.argv[1])),process.argv[2])));
  `,scan,dir],{encoding:'utf8',timeout:4000});
  assert.equal(run.status,0,run.error?.message??run.stderr);
  assert.match(JSON.parse(run.stdout).diagnostics[0].message,/not-regular-file/);
});

test('collection regeneration refuses to silently discard a connected site source snapshot',async t=>{
  const dir=temporary(t),site=path.join(dir,'site');
  writeSite(renderSite(layout,{source:{snapshot,links:sidecar}}),site);
  const config=path.join(dir,'collection.json');
  fs.writeFileSync(config,JSON.stringify({schemaVersion:'0.1-collection-draft',title:'Connected',sites:[{id:'example',site}]}));
  await assert.rejects(buildCollection(config,path.join(dir,'collection')),/discard its source evidence/);
  assert.deepEqual(recoverSite(site),model);
});
