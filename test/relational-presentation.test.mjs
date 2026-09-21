import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadModel } from '../modules/documents/index.mjs';
import { validateModel } from '../modules/model/index.mjs';
import { layoutModel, validateLayout } from '../modules/layout/index.mjs';
import { renderSVG, renderHTML } from '../modules/render/index.mjs';
import { recoverArtifact, extractLayout } from '../modules/render/artifacts.mjs';
import { layoutRelational, relationalRecords } from '../modules/relational/index.mjs';
import { renderSite, siteTargetURL, siteSearchIndex, writeSite } from '../modules/site/index.mjs';
import { recoverSite } from '../modules/site/files.mjs';
import { buildCollection } from '../modules/site/collection.mjs';
import { compareModelRecords } from '../modules/knowledge/records/compare.mjs';
import { modelRecords } from '../modules/query/index.mjs';

const fixture = new URL('../examples/relational/model.json', import.meta.url);
const model = loadModel(fixture).model;
const layout = await layoutModel(model);

test('relational dispatch preserves the complete source and stable column routes for composite keys', async () => {
  assert.equal(validateModel(model).ok, true);
  assert.deepEqual(await layoutRelational(model), layout);
  assert.equal(validateLayout(layout, { expectedModel: model }).ok, true);
  for (const constraint of model.constraints.filter(record => record.kind === 'foreign')) {
    const edge = layout.edges.find(item => item.ref === constraint.id);
    assert.equal(edge.routes.length, constraint.columnRefs.length);
    assert.deepEqual(edge.routes.map(route => route.fromColumnRef), constraint.columnRefs);
    assert.deepEqual(edge.routes.map(route => route.toColumnRef), constraint.references.columnRefs);
  }
  const reversed = structuredClone(model);
  for (const key of ['tables', 'columns', 'constraints', 'associations']) reversed[key].reverse();
  const same = await layoutModel(reversed);
  assert.deepEqual(same.tables, layout.tables);
  assert.deepEqual(same.edges, layout.edges);
  assert.equal(validateLayout(await layoutModel(model, { direction: 'DOWN' })).ok, true);
  await assert.rejects(layoutModel(model, { groupingPerspectiveRef: 'schema' }), /only direction/);
});

test('relational layout rejects dropped records, rewired columns, overlap, nonfinite and undersized geometry', () => {
  const composite = layout.edges.findIndex(edge => edge.routes.length > 1);
  for (const change of [
    drawing => drawing.tables.pop(), drawing => drawing.tables.push(structuredClone(drawing.tables[0])),
    drawing => drawing.tables[0].columns.pop(), drawing => drawing.edges.pop(),
    drawing => { drawing.tables[0].box = structuredClone(drawing.tables[1].box); },
    drawing => { drawing.tables[0].box.width = 1; },
    drawing => { drawing.tables[0].columns[0].box.y += 1; },
    drawing => { drawing.canvas.width = 10; },
    drawing => { drawing.edges[0].routes[0].points[0].x = Infinity; },
    drawing => { drawing.edges[0].routes[0].points[0].y += 5; },
    drawing => { drawing.edges[0].from = drawing.edges[0].to; },
    drawing => { drawing.edges[0].kind = 'inferred'; },
    drawing => { drawing.edges[0].label.width = 1; },
    drawing => drawing.edges[composite].routes.reverse(),
    drawing => drawing.edges[composite].routes.pop(),
    drawing => { drawing.model.title = 'Changed source'; },
    drawing => { drawing.extra = 'undocumented'; },
  ]) {
    const changed = structuredClone(layout); change(changed);
    assert.equal(validateLayout(changed).ok, false);
  }
});

test('self foreign keys and associations with unmatched endpoint sets preserve their semantics', async () => {
  const input = structuredClone(model);
  const key = input.constraints.find(record => record.kind === 'foreign' && record.columnRefs.length === 1);
  key.references = { tableRef: key.tableRef, columnRefs: [input.columns.find(column => column.tableRef === key.tableRef && column.name === 'id').id] };
  const association = input.associations[0];
  association.from.columnRefs = input.columns.filter(column => column.tableRef === association.from.tableRef).map(column => column.id);
  const drawing = await layoutModel(input);
  const edge = drawing.edges.find(item => item.ref === association.id);
  assert.equal(edge.routes.length, 1);
  assert.equal(edge.routes[0].fromColumnRef, null, 'Multiple logical fields do not invent column pairings.');
  assert.deepEqual(recoverArtifact(renderHTML(drawing)), input);
});

test('every relational record is inspectable; portable output escapes labels and preserves evidence and mappings', async () => {
  const input = structuredClone(model);
  input.tables[0].label = '</script><img src=x onerror=alert(1)> café';
  input.columns[0].dataType = null; input.columns[0].nullable = null;
  const drawing = await layoutModel(input);
  for (const skin of ['standard', 'engineering', 'editorial']) {
    const html = renderHTML(drawing, { skin }), svg = renderSVG(drawing, { skin });
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:|<img src=x/);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    assert.equal((html.match(/<metadata id="waxwing-source"/g) ?? []).length, 1);
    assert.deepEqual(recoverArtifact(html), input); assert.deepEqual(recoverArtifact(svg), input);
    for (const entry of relationalRecords(input)) assert.ok(html.includes(`id="relational-record-${entry.id}"`));
    for (const entry of modelRecords(input)) assert.ok(html.includes(`id="relational-record-${entry.record.id}"`));
    assert.match(html, /id="table-filter"/); assert.match(html, /id="focus-neighbors"/);
    assert.match(html, /id="diagram-main"/); assert.match(html, /id="inspector"/);
    assert.match(html, /architecture Refs/); assert.match(html, /orders-database/);
    assert.match(svg, /connection application/); assert.match(svg, /FK · reported · 2 columns/);
  }
  assert.throws(() => renderSVG(drawing, { graphRef: model.id }), /only skin/);
});

test('renderer and artifact recovery imports do not load the layout engine', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {createRequire} from 'node:module'; await import('./modules/render/index.mjs'); await import('./modules/render/artifacts.mjs'); await import('./modules/relational/index.mjs'); if(Object.keys(createRequire(import.meta.url).cache).some(file=>file.includes('elkjs'))) process.exit(1);`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('inferred and unknown foreign key claims remain visibly qualified in the diagram', async () => {
  for (const status of ['inferred', 'unknown']) {
    const input = structuredClone(model), key = input.constraints.find(record => record.kind === 'foreign');
    key.evidence = { status, sourceRefs: status === 'unknown' ? [] : ['orders-schema'], reason: 'Illustrative unresolved database constraint.' };
    const drawing = await layoutModel(input), svg = renderSVG(drawing), html = renderHTML(drawing);
    assert.ok(svg.includes(`connection foreign ${status}`));
    assert.ok(svg.includes(`FK · ${status}`));
    assert.ok(svg.includes(`Database foreign key · ${status}`));
    assert.match(html, /Dash-dot: qualified FK/);
    assert.deepEqual(recoverArtifact(svg), input);
  }
});

test('relational standalone site, search and collection targets preserve source and record identity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-relational-site-'));
  try {
    const site = path.join(directory, 'site'); writeSite(renderSite(layout), site);
    assert.deepEqual(recoverSite(site), model);
    const index = siteSearchIndex(model);
    assert.equal(index.length, modelRecords(model).length);
    for (const entry of modelRecords(model)) {
      const target = siteTargetURL(model, { kind: entry.kind, ref: entry.record.id }, 'index.html');
      assert.equal(target, `graphs/relational.html#record=${encodeURIComponent(entry.record.id)}`);
      assert.ok(index.some(item => item.id === entry.record.id && item.destinations[0].path === target));
    }
    assert.throws(() => siteTargetURL(model, { kind: 'table', ref: 'absent' }, 'index.html'), /Unknown relational target/);
    const config = { schemaVersion: '0.1-collection-draft', title: 'Storage and architecture', sites: [{ id: 'storage', model: fixture.pathname }, { id: 'system', model: new URL('../examples/order-processing/model.json', import.meta.url).pathname }], links: [{ from: { site: 'storage', kind: 'table', ref: model.tables[0].id }, to: { site: 'system' }, label: 'Architecture context' }] };
    fs.writeFileSync(path.join(directory, 'collection.json'), JSON.stringify(config));
    await buildCollection(path.join(directory, 'collection.json'), path.join(directory, 'collection'));
    assert.deepEqual(recoverSite(path.join(directory, 'collection/sites/storage')), model);
    assert.match(fs.readFileSync(path.join(directory, 'collection/sites/storage/graphs/relational.html'), 'utf8'), /Architecture context/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('CLI prepares, builds, renders and recovers relational models without the original input file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-relational-cli-'));
  const cli = new URL('../bin/waxwing.mjs', import.meta.url).pathname;
  const run = (...args) => { const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result; };
  try {
    fs.copyFileSync(fixture, path.join(directory, 'model.json'));
    run('validate', 'model.json'); run('build', 'model.json', 'output'); run('check-layout', 'output/layout.json');
    run('render', 'output/layout.json', 'standalone.svg'); run('build-site', 'model.json', 'site');
    fs.unlinkSync(path.join(directory, 'model.json')); fs.unlinkSync(path.join(directory, 'output/layout.json'));
    run('recover', 'output/diagram.html', 'recovered.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'recovered.json'))), model);
    assert.deepEqual(extractLayout(fs.readFileSync(path.join(directory, 'standalone.svg'), 'utf8')), layout);
    run('recover', 'site', 'from-site.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'from-site.json'))), model);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('record inventory comparison reports relational column and constraint edits without changing their identities', () => {
  const after = structuredClone(model); after.columns[0].nullable = true;
  after.constraints.find(record => record.kind === 'foreign').onDelete = 'cascade';
  const change = compareModelRecords(model, after);
  assert.equal(change.counts.changed, 2);
  assert.deepEqual(new Set(change.changed.map(record => record.collection)), new Set(['columns', 'constraints']));
  assert.equal(change.counts.added, 0); assert.equal(change.counts.removed, 0);
});
