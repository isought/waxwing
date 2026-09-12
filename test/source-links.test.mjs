import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { loadModel } from '../modules/application/load-model.mjs';
import { digest } from '../modules/knowledge/shared/model.mjs';
import { sourceSnapshotId } from '../modules/knowledge/source/model.mjs';
import { validateSourceLinks, projectSourceLinks } from '../modules/knowledge/source-links/index.mjs';

const snapshot = await analyzeSources([
  { path: 'orders.mjs', content: 'export function handle(order) { return save(order); }\nfunction save(order) { return order; }\nexport class Store { write(order) { return save(order); } }\n' },
  { path: 'proof.lean', content: 'def answer : Nat := 42\n' },
], { sourceId: 'source-link-fixture' });
const entry = snapshot.declarations.find(d => d.name === 'handle');
const call = snapshot.references.find(r => r.kind === 'call');
const ordinary = snapshot.references.find(r => r.kind === 'reference' && r.name === 'order');
const original = loadModel(fileURLToPath(new URL('../examples/subgraphs/model.json', import.meta.url))).model;
original.sources.push({ id: 'maintainer', kind: 'human', locator: 'Fixture maintainer statement, 2026-09-12', description: 'Fictional maintenance rationale.' });
original.notes.push({ id: 'maintenance-rationale', subjectRefs: ['orders', 'checkout-orders'], topic: 'rationale',
  statement: 'Why does this component remain supported?', answer: { status: 'reported', value: 'Maintain the existing entry during migration.',
    basis: { sourceRefs: ['maintainer'], explanation: 'The fictional maintainer explicitly supplied this scoped reason.' } } });

function fixture() {
  const model = structuredClone(original);
  const sidecar = { schemaVersion: '0.1-source-links-draft', modelId: model.id, modelDigest: digest(model), snapshotId: snapshot.id,
    links: [{ id: 'orders-entry', subject: { kind: 'node', graphRef: 'overview', ref: 'orders' }, entryRef: entry.id,
      evidenceRefs: [call.id, ordinary.id], label: 'Inspect order handling',
      basis: { status: 'inferred', explanation: 'The test connects its order component to the fixture handler.', sourceRefs: ['fictional-snapshot'] },
      rationaleNoteRefs: ['maintenance-rationale'] }] };
  return { model, sidecar };
}

test('bridges retain exact snapshot identities, qualified rationale and its distinct sources', () => {
  const { model, sidecar } = fixture();
  assert.deepEqual(validateSourceLinks(model, snapshot, sidecar), { ok: true, diagnostics: [] });
  const output = projectSourceLinks(model, snapshot, sidecar);
  assert.deepEqual(output.diagnostics, []);
  assert.equal(output.links[0].subjectLabel, model.entities.find(n => n.id === 'orders').label);
  assert.deepEqual(output.links[0].evidenceRefs, [call.id, ordinary.id]);
  assert.equal(output.links[0].basis.status, 'inferred');
  assert.equal(output.links[0].rationale[0].answer.status, 'reported');
  assert.deepEqual(output.links[0].sources.map(s => s.id), ['fictional-snapshot', 'maintainer']);
  output.links[0].subject.ref = 'edited';
  output.links[0].rationale[0].answer.value = 'edited';
  output.links[0].sources[0].description = 'edited';
  assert.equal(sidecar.links[0].subject.ref, 'orders');
  assert.equal(model.notes.at(-1).answer.value, 'Maintain the existing entry during migration.');
  assert.notEqual(model.sources[0].description, 'edited');
});

test('node and edge entries support files, functions and methods without forcing ownership', () => {
  const { model, sidecar } = fixture();
  const edge = { ...structuredClone(sidecar.links[0]), id: 'checkout-entry', subject: { kind: 'edge', graphRef: 'overview', ref: 'checkout-orders' } };
  sidecar.links.push(edge);
  assert.equal(validateSourceLinks(model, snapshot, sidecar).ok, true);
  for (const ref of [entry.id, snapshot.files.find(f => f.status === 'analyzed').id, snapshot.declarations.find(d => d.kind === 'method').id]) {
    edge.entryRef = ref;
    assert.equal(validateSourceLinks(model, snapshot, sidecar).ok, true);
  }
  sidecar.links[0].subject = { kind: 'node', graphRef: 'order-internals', ref: 'payments' };
  sidecar.links[0].rationaleNoteRefs = [];
  sidecar.links[0].evidenceRefs = [];
  assert.equal(validateSourceLinks(model, snapshot, sidecar).ok, true, 'Explicit external context is a visible node, and extra evidence/rationale may be absent.');
});

test('missing bridges and empty link collections preserve independent usefulness', () => {
  const { model, sidecar } = fixture();
  for (const value of [undefined, null, { ...sidecar, links: [] }]) {
    assert.deepEqual(validateSourceLinks(model, snapshot, value), { ok: true, diagnostics: [] });
    assert.deepEqual(projectSourceLinks(model, snapshot, value), { links: [], diagnostics: [] });
  }
});

test('any stale model or snapshot identity disables the whole bridge without rebinding names', () => {
  for (const mutation of [
    ({ sidecar }) => { sidecar.modelId = 'another-model'; },
    ({ model }) => { model.title += ' changed'; },
    ({ scan }) => { scan.producer.adapterVersion = 'different'; scan.id = sourceSnapshotId(scan); },
  ]) {
    const state = { ...fixture(), scan: structuredClone(snapshot) };
    mutation(state);
    const result = projectSourceLinks(state.model, state.scan, state.sidecar);
    assert.deepEqual(result.links, []);
    assert.ok(result.diagnostics.some(d => d.code === 'source-links/identity'));
    assert.equal(validateSourceLinks(state.model, state.scan, state.sidecar).ok, false);
  }
});

test('bridge validation rejects missing records, wrong kinds and subjects outside the selected graph', () => {
  const invalid = [
    [l => { l.subject.ref = 'absent'; }, 'subject'],
    [l => { l.subject.ref = 'worker'; }, 'subject'],
    [l => { l.subject.graphRef = 'absent'; }, 'subject'],
    [l => { l.subject = { kind: 'edge', graphRef: 'overview', ref: 'api-queue' }; }, 'subject'],
    [l => { l.entryRef = 'absent'; }, 'entry'],
    [l => { l.entryRef = snapshot.files.find(f => f.status === 'skipped').id; }, 'entry'],
    [l => { l.entryRef = snapshot.declarations.find(d => d.kind === 'parameter').id; }, 'entry'],
    [l => { l.entryRef = call.id; }, 'entry'],
    [l => { l.evidenceRefs = ['absent']; }, 'evidence'],
    [l => { l.basis.sourceRefs = ['absent']; }, 'source'],
    [l => { l.rationaleNoteRefs = ['absent']; }, 'rationale'],
    [l => { l.subject.ref = 'payments'; }, 'rationale'],
  ];
  for (const [mutate, code] of invalid) {
    const { model, sidecar } = fixture();
    const bad = structuredClone(sidecar.links[0]); bad.id = 'bad-link'; mutate(bad); sidecar.links.push(bad);
    const result = projectSourceLinks(model, snapshot, sidecar);
    assert.deepEqual(result.links, [], 'A valid link must not mask an invalid sidecar.');
    assert.ok(result.diagnostics.some(d => d.code === `source-links/${code}`), `${code}: ${JSON.stringify(result)}`);
  }
  const { model, sidecar } = fixture();
  model.notes.at(-1).topic = 'behavior'; sidecar.modelDigest = digest(model);
  assert.ok(validateSourceLinks(model, snapshot, sidecar).diagnostics.some(d => d.code === 'source-links/rationale'));
});

test('strict fields, statuses, types and unique reference arrays are enforced', () => {
  const mutations = [
    s => { s.unrecognized = true; },
    s => { s.schemaVersion = 'next'; },
    s => { s.modelDigest = 'not-a-digest'; },
    s => { s.links[0].subject.kind = 'graph'; },
    s => { s.links[0].subject.url = 'javascript:alert(1)'; },
    s => { s.links[0].label = ' '; },
    s => { delete s.links[0].entryRef; },
    s => { s.links[0].basis.status = 'guaranteed'; },
    s => { s.links[0].basis.sourceRefs = []; },
    s => { s.links[0].rationaleNoteRefs = 'maintenance-rationale'; },
    s => { s.links[0].evidenceRefs = [call.id, call.id]; },
  ];
  for (const mutate of mutations) {
    const { model, sidecar } = fixture(); mutate(sidecar);
    assert.ok(validateSourceLinks(model, snapshot, sidecar).diagnostics.some(d => d.code === 'source-links/schema'));
    assert.deepEqual(projectSourceLinks(model, snapshot, sidecar).links, []);
  }
  const { model, sidecar } = fixture(); sidecar.links.push(structuredClone(sidecar.links[0]));
  assert.ok(validateSourceLinks(model, snapshot, sidecar).diagnostics.some(d => d.code === 'source-links/duplicate'));
});

test('invalid independent models and snapshots remain errors even without a sidecar', () => {
  const { model } = fixture();
  for (const [inputModel, inputSnapshot] of [[null, snapshot], [model, null], [model, { ...snapshot, id: 'snapshot-' + '0'.repeat(64) }]]) {
    assert.equal(validateSourceLinks(inputModel, inputSnapshot).ok, false);
    assert.throws(() => projectSourceLinks(inputModel, inputSnapshot), error => /Invalid explanation/.test(error.message) && error.diagnostics.length > 0);
  }
});

test('rationale provenance includes all disputed alternatives without choosing a winner', () => {
  const { model, sidecar } = fixture();
  const note = model.notes.at(-1);
  const first = note.answer;
  note.answer = { status: 'disputed', reason: 'Two fixture accounts differ.', alternatives: [first,
    { status: 'inferred', value: 'Preserve a separate integration contract.', basis: { sourceRefs: ['fictional-snapshot'], explanation: 'An alternative fixture interpretation.' } }] };
  sidecar.modelDigest = digest(model);
  const output = projectSourceLinks(model, snapshot, sidecar);
  assert.equal(output.links[0].rationale[0].answer.status, 'disputed');
  assert.equal(output.links[0].rationale[0].answer.alternatives.length, 2);
  assert.deepEqual(output.links[0].sources.map(s => s.id), ['fictional-snapshot', 'maintainer']);
});
