import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyzeSources, supportedSourceLanguages, sourceLanguageProfiles } from '../modules/analysis/index.mjs';
import { validateSourceSnapshot, sourceSnapshotId } from '../modules/knowledge/source/model.mjs';
import { querySourceSnapshot, sourceNavigation } from '../modules/knowledge/source/index.mjs';
import { renderSourceHTML } from '../modules/presentation/source/index.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/source-languages.json', import.meta.url)));
for (const fixture of fixtures) test(`Tree-sitter baseline extracts checked source evidence: ${fixture.path}`, async () => {
  const scan = await analyzeSources([fixture]);
  assert.equal(validateSourceSnapshot(scan).ok, true);
  assert.equal(scan.files[0].parseStatus, 'parsed', JSON.stringify(scan.diagnostics));
  assert.equal(scan.files[0].analysis.level, 'syntax');
  assert.deepEqual(scan.declarations.map(d => d.name), fixture.declarations);
  if (fixture.call) assert.ok(scan.references.some(r => r.kind === 'call' && r.name === fixture.call), JSON.stringify(scan.references));
  if (fixture.import) assert.ok(scan.references.some(r => r.kind === 'import'));
  assert.ok(scan.references.every(r => r.resolution.status === 'unresolved' && r.resolution.reason === 'syntax-only-no-resolution' && !r.resolution.targets.length));
  assert.ok(!scan.references.some(r => r.name.includes('ghost')));
  for (const record of [...scan.declarations, ...scan.references]) {
    const original = fixture.content.slice(record.span.start.offset, record.span.end.offset);
    assert.ok(original.includes(record.name), `${record.name}: ${original}`);
  }
  assert.equal(querySourceSnapshot(scan, 'search', fixture.declarations.at(-1)).results.length > 0, true);
  assert.ok(renderSourceHTML(scan).includes(scan.files[0].id));
});

test('hybrid routing preserves compiler bindings, qualified syntax calls and deterministic identity', async () => {
  const sources = [...fixtures, { path: 'math.ts', content: 'export function save() {}' }, { path: 'main.ts', content: "import {save} from './math.js'; save();" }];
  const a = await analyzeSources(sources), b = await analyzeSources([...sources].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(new Set(a.files.map(f => f.language)), new Set(supportedSourceLanguages.filter(l => l !== 'javascript')));
  assert.equal(a.references.find(r => r.kind === 'call' && a.files.find(f => f.id === r.fileRef).path === 'main.ts').resolution.status, 'resolved');
  assert.ok(a.references.filter(r => a.files.find(f => f.id === r.fileRef).analysis.level === 'syntax').every(r => r.resolution.status === 'unresolved'));
  assert.equal(sourceNavigation(a).files.filter(f => f.analysis.level === 'syntax').length, fixtures.length);
  assert.equal(Object.values(sourceLanguageProfiles).filter(p => p.backend === 'tree-sitter').length, fixtures.length);
});

test('syntax extraction preserves nested ownership and UTF-16 locations without binding same names', async () => {
  const content = '# 🦉 ghost()\r\ndef save():\r\n    pass\r\ndef run(save):\r\n    π = "fake()"\r\n    return save(π)\r\n';
  const scan = await analyzeSources([{path:'unicode.py',content}]);
  const call = scan.references.find(r => r.kind === 'call');
  assert.equal(call.name, 'save');
  assert.equal(call.span.start.offset, content.lastIndexOf('save('));
  assert.deepEqual(call.span.start, { offset: content.lastIndexOf('save('), line: 6, column: 12 });
  assert.equal(call.containerRef, scan.declarations.find(d => d.name === 'run').id);
  assert.equal(call.resolution.status, 'unresolved');
  assert.equal(scan.files[0].byteLength, Buffer.byteLength(content));
  const json = await analyzeSources([{path:'a.json', content:'{"🦉": {"child": 1}}'}]);
  assert.equal(json.declarations[1].containerRef, json.declarations[0].id);
  assert.equal(json.references.length, 0);
});

test('grammar errors and unsupported languages remain visible, including Objective-C++ limitations', async () => {
  const scan = await analyzeSources([{path:'bad.py',content:'def broken(:\n    missing()\n'}, {path:'Proof.lean',content:'theorem identity (p : Prop) : p → p := fun h => h'}, {path:'mixed.mm',content:'class C { public: void run() { save(); } };\n'}]);
  assert.equal(scan.files.find(f => f.path === 'bad.py').parseStatus, 'errors');
  assert.ok(scan.diagnostics.some(d => d.code === 'tree-sitter/syntax'));
  assert.ok(validateSourceSnapshot(scan).summary.syntaxErrors > 0);
  assert.equal(scan.files.find(f => f.path === 'Proof.lean').status, 'skipped');
  assert.match(scan.files.find(f => f.path === 'mixed.mm').analysis.limitations.join(' '), /C\+\+ constructs/);
  assert.ok(scan.references.every(r => r.resolution.status === 'unresolved'));
});

test('capability metadata is validated and participates in snapshot identity', async () => {
  const scan = await analyzeSources([fixtures[0]]);
  const changed = structuredClone(scan); changed.files[0].analysis.level = 'verified'; changed.id = sourceSnapshotId(changed);
  assert.equal(validateSourceSnapshot(changed).ok, false);
  const old = structuredClone(scan); delete old.files[0].analysis; old.id = sourceSnapshotId(old);
  assert.equal(validateSourceSnapshot(old).ok, true, 'Older snapshots remain readable.');
});
