import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { sourceSnapshotId } from '../modules/knowledge/source/model.mjs';
import { sourceNavigation } from '../modules/knowledge/source/navigation.mjs';
import { validateSourceLinks, projectSourceLinks } from '../modules/knowledge/source-links/index.mjs';
import { createSelfExample, selfExamplePaths } from '../experiments/connected-source/fixture.mjs';

const inputs = selfExamplePaths.map(path => ({ path, content: fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8') }));
const snapshot = await analyzeSources(inputs, { sourceId: 'waxwing-demo-test' });

test('the current build example resolves real callees while retaining lexical import evidence and curated mappings', () => {
  const before = structuredClone(snapshot);
  const { model, links } = createSelfExample(snapshot);
  assert.deepEqual(snapshot, before, 'Building an overview does not change the scan.');
  assert.deepEqual(validateSourceLinks(model, snapshot, links), { ok: true, diagnostics: [] });
  assert.deepEqual(projectSourceLinks(model, snapshot, undefined), { links: [], diagnostics: [] }, 'The native views do not require a bridge.');
  const records = new Map([...snapshot.declarations, ...snapshot.references].map(item => [item.id, item]));
  const navigation = sourceNavigation(snapshot);
  for (const [id, name, caller] of [
    ['load-call-entry', 'loadModel', 'loadAndLayout'],
    ['layout-call-entry', 'layoutModel', 'loadAndLayout'],
    ['svg-call-entry', 'renderSVG', 'buildModelFiles'],
    ['html-call-entry', 'renderHTML', 'buildModelFiles'],
  ]) {
    const link = links.links.find(item => item.id === id);
    const entry = records.get(link.entryRef);
    assert.equal(entry.name, name);
    assert.equal(entry.kind, 'function');
    const occurrence = link.evidenceRefs.map(ref => records.get(ref)).find(item => item?.kind === 'call' && item.name === name);
    assert.ok(occurrence, `${id} has its actual call occurrence.`);
    const relation = navigation.relationships.find(item => item.reference.id === occurrence.id);
    assert.equal(records.get(relation.callerRef).name, caller);
    if (name !== 'loadModel') {
      assert.notEqual(occurrence.resolution.targets[0], entry.id, 'A lazy import retains the local lexical binding.');
      const origin = relation.provenance.find(item => item.resolution.targets.includes(entry.id));
      assert.ok(origin);
      assert.ok(link.evidenceRefs.includes(origin.moduleRef), 'The awaited-import occurrence remains inspectable.');
    }
  }
  assert.deepEqual(links.links.filter(link => link.subject.kind === 'edge' && link.subject.ref === 'render-artifacts').map(link => records.get(link.entryRef).name), ['renderSVG', 'renderHTML']);
  assert.ok(links.links.every(link => link.basis.status === 'inferred'), 'Code lookup does not establish the curated responsibility boundary.');
  assert.equal(records.get(links.links.find(link => link.id === 'pipeline-entry').entryRef).name, 'buildModelFiles');
  assert.ok(!links.links.some(link => /cli/i.test(link.id)), 'This example does not invent a resolved conditional CLI call.');
});

test('rationale quotes are pinned to their actual comments and the missing intended boundary stays unknown', () => {
  const { model, links } = createSelfExample(snapshot);
  const code = inputs.find(input => input.path.endsWith('/pipeline.mjs')).content;
  for (const note of model.notes.filter(note => note.answer.status === 'reported')) {
    const source = model.sources.find(source => source.id === note.answer.basis.sourceRefs[0]);
    const line = Number(source.locator.match(/ : line (\d+)$/)[1]);
    assert.equal(code.split('\n')[line - 1].trim(), '// ' + note.answer.value);
    assert.match(source.locator, / @ sha256:[a-f0-9]{64} : line \d+$/);
  }
  const output = projectSourceLinks(model, snapshot, links);
  const rationale = output.links.find(link => link.id === 'pipeline-entry').rationale;
  assert.equal(rationale.filter(note => note.answer.status === 'reported').length, 2);
  const unknown = rationale.find(note => note.id === 'open-write-recovery');
  assert.equal(unknown.answer.status, 'unknown');
  assert.equal(unknown.answer.value, undefined);
});

test('a valid scan of changed bytes cannot borrow rationale from the current checkout', async () => {
  const changed = await analyzeSources(inputs.map((input, i) => i ? input : { ...input, content: input.content + '\n// A different source revision.\n' }), { sourceId: 'waxwing-demo-test' });
  assert.throws(() => createSelfExample(changed), /Source bytes changed.*rescan before attaching/);
  const missing = await analyzeSources(inputs.slice(1), { sourceId: 'waxwing-demo-test' });
  assert.throws(() => createSelfExample(missing), /Expected exactly one analyzed file modules\/application\/pipeline.mjs; found 0/);
});

test('a missing import origin stops the curated relationship instead of substituting a same-named function', () => {
  const changed = structuredClone(snapshot);
  const pipeline = changed.files.find(file => file.path === selfExamplePaths[0]);
  const binding = changed.declarations.find(declaration => declaration.fileRef === pipeline.id && declaration.name === 'layoutModel' && declaration.valueProvenance);
  binding.valueProvenance.resolution = { status: 'unresolved', targets: [], reason: 'unsupported-pattern' };
  changed.id = sourceSnapshotId(changed);
  assert.throws(() => createSelfExample(changed), /does not establish a unique binding or static import origin for loadAndLayout → layoutModel/);
});
