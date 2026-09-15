import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildContext, discoverReport, readReference } from '../modules/application/context.mjs';
import { normalizeGraphify, parseGraphifyLocation } from '../modules/knowledge/foreign/graphify.mjs';

const cli = fileURLToPath(new URL('../bin/waxwing.mjs', import.meta.url));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing graphify '));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// Shapes observed in Graphify 0.9.x output: exported node-link JSON with links,
// undirected storage, optional _src/_tgt direction markers and extra fields.
const graph = (extra = {}) => ({
  directed: false, multigraph: false, graph: {}, built_at_commit: null,
  nodes: [
    { id: 'src_checkout', label: 'checkout.ts', file_type: 'code', source_file: 'src/checkout.ts', source_location: 'L1', community: 0 },
    { id: 'src_checkout_status', label: 'status()', _callable: true, file_type: 'code', source_file: 'src/checkout.ts', source_location: 'L2', community: 0 },
    { id: 'src_main_run', label: 'run()', _callable: true, file_type: 'code', source_file: 'src/main.ts', source_location: 'L1', community: 1 },
    { id: 'legacy_status', label: 'status()', _callable: true, file_type: 'code', source_file: 'src/legacy.ts', source_location: 'L1', community: 1 },
  ],
  links: [
    // Serialized endpoints are flipped; the markers carry the extracted caller → callee direction.
    { source: 'src_checkout_status', target: 'src_main_run', _src: 'src_main_run', _tgt: 'src_checkout_status', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/main.ts', source_location: 'L2' },
    { source: 'src_checkout', target: 'src_checkout_status', relation: 'contains', confidence: 'EXTRACTED', source_file: 'src/checkout.ts', source_location: 'L2' },
    { source: 'src_main_run', target: 'missing', relation: 'calls', confidence: 'INFERRED' },
  ],
  ...extra,
});

function project(content = graph()) {
  const base = temp(), root = path.join(base, 'shop app');
  fs.mkdirSync(root);
  spawnSync('git', ['init', '-q'], { cwd: root });
  write(path.join(root, 'src/checkout.ts'), 'export class Checkout {\n  status(order: { paid: boolean }) {\n    return order.paid ? "complete" : "pending";\n  }\n}\n');
  write(path.join(root, 'src/main.ts'), 'export function run() {\n  return new Checkout().status({ paid: false });\n}\n');
  write(path.join(root, 'graphify-out/graph.json'), JSON.stringify(content));
  return { base, root };
}

test('normalization keeps direction markers, both edge keys, locations and unrecognized input explicit', () => {
  const normalized = normalizeGraphify(graph({ extra_top: 1 }));
  assert.equal(normalized.summary.nodes, 4);
  assert.equal(normalized.summary.skippedEdges, 1, 'an edge to an unknown node is skipped, not invented');
  const call = normalized.edges.find(e => e.relation === 'calls');
  assert.deepEqual([call.from, call.to], ['src_main_run', 'src_checkout_status']);
  assert.match(call.direction, /_src\/_tgt/);
  assert.match(normalized.edges.find(e => e.relation === 'contains').direction, /undirected/);
  assert.ok(normalized.diagnostics.some(d => d.code === 'graphify/unrecognized-fields' && d.message.includes('extra_top')));
  assert.ok(normalized.diagnostics.some(d => d.code === 'graphify/edge-unknown-node'));

  const { links, ...rest } = graph();
  const withEdges = normalizeGraphify({ ...rest, edges: links });
  assert.equal(withEdges.edgeKey, 'edges');
  assert.equal(withEdges.summary.edges, 2);
  assert.deepEqual(parseGraphifyLocation('L54'), { line: 54 });
  assert.deepEqual(parseGraphifyLocation('L3-L9'), { line: 3, endLine: 9 });
  assert.equal(parseGraphifyLocation('line 4'), null);
  assert.throws(() => normalizeGraphify({ nodes: [] }), /Not a recognized Graphify/);
  assert.throws(() => normalizeGraphify({ schemaVersion: '0.5-draft', nodes: [], links: [] }), /Not a recognized Graphify/);
});

test('a Graphify-only project supports discover, term and location context, and reads with qualified relationships', () => {
  const { base, root } = project();
  try {
    const report = discoverReport({ project: root });
    assert.equal(report.status, 'sources_found');
    const source = report.sources.find(s => s.format === 'graphify');
    assert.equal(source.status, 'available');
    assert.equal(source.summary.edges, 2);

    const found = buildContext({ project: root, terms: ['status'] });
    assert.equal(found.status, 'context_found');
    const statuses = found.candidates.filter(c => c.title === 'status()');
    assert.deepEqual(statuses.map(c => c.location.path).sort(), ['src/checkout.ts', 'src/legacy.ts'], 'same-name nodes stay separate');
    assert.ok(statuses.every(c => c.format === 'graphify' && c.matchBasis[0] === 'term "status" equals the name'));
    assert.ok(found.limitations.some(l => /do not establish execution order|does not establish execution order/.test(l)));
    assert.ok(found.limitations.some(l => /imported extraction claims/.test(l)));

    const at = buildContext({ project: root, at: ['src/checkout.ts:3'] });
    assert.deepEqual(at.candidates.map(c => [c.kind, c.title]), [['callable', 'status()'], ['file', 'checkout.ts']]);
    assert.match(at.candidates[0].matchBasis[0], /nearest preceding recorded callable \(starts line 2\); start lines only/);

    const read = readReference(statuses.find(c => c.location.path === 'src/checkout.ts').ref, { project: root });
    assert.equal(read.status, 'record_found');
    assert.equal(read.record.format, 'graphify');
    assert.equal(read.record.graphify.source_location, 'L2', 'original Graphify fields are preserved');
    assert.equal(read.record.excerpt.verification, 'unverified-current-file');
    assert.ok(read.lines.some(line => line.includes('"pending"')));
    const incoming = read.related.find(r => r.relation === 'calls');
    assert.deepEqual([incoming.direction, incoming.title, incoming.confidence], ['incoming', 'run()', 'EXTRACTED']);
    assert.deepEqual(incoming.evidence, { path: 'src/main.ts', line: 2 });
    assert.equal(readReference(incoming.ref, { project: root }).record.value.label, 'run()');

    // A missing source file keeps the node readable.
    fs.rmSync(path.join(root, 'src/main.ts'));
    const orphan = readReference(incoming.ref, { project: root });
    assert.equal(orphan.status, 'record_found');
    assert.equal(orphan.record.excerpt.verification, 'unavailable');

    // A rebuilt graph makes references stale and offers the current one when the node remains.
    const changed = graph(); changed.nodes[1].label = 'status()'; changed.links.pop();
    write(path.join(root, 'graphify-out/graph.json'), JSON.stringify(changed));
    const stale = readReference(read.reference, { project: root });
    assert.equal(stale.status, 'stale_reference');
    assert.equal(readReference(stale.currentRef, { project: root }).status, 'record_found');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('explicit alternative paths, unreadable shapes and the CLI surface', () => {
  const { base, root } = project({ nodes: [{ id: 'a' }] });
  try {
    assert.equal(discoverReport({ project: root }).status, 'unsupported_input');
    assert.equal(buildContext({ project: root, terms: ['a'] }).status, 'unsupported_input');

    const external = path.join(base, 'shared', 'code-graph.json');
    write(external, JSON.stringify(graph()));
    write(path.join(root, '.waxwing/config.json'), JSON.stringify({ schemaVersion: '0.1-project-config', artifacts: [external] }));
    const report = discoverReport({ project: root });
    const registered = report.sources.find(s => s.key === external);
    assert.equal(registered.format, 'graphify');
    assert.equal(registered.status, 'available');

    const result = spawnSync(process.execPath, [cli, 'context', '--term', 'run', '--format', 'json'], { cwd: path.join(root, 'src'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const packet = JSON.parse(result.stdout);
    assert.equal(packet.candidates[0].title, 'run()');
    assert.equal(packet.candidates[0].sourceKey, external);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
