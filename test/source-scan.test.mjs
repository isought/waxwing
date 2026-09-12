import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { validateSourceSnapshot, querySourceSnapshot } from '../modules/knowledge/source/index.mjs';
import { sourceSnapshotId } from '../modules/knowledge/source/model.mjs';

const fixture = [
  { path: 'math.ts', content: 'export function twice(n: number) { return n * 2; }\n' },
  { path: 'facade.ts', content: "export { twice as double } from './math.js';\n" },
  { path: 'main.ts', content: "import { double as calculate } from './facade.js';\nconst result = calculate(3);\nfunction local(calculate: (n: number) => number) { return calculate(4); }\nunknownCall();\n" },
];

test('scanner binds aliases and re-exports to declarations while respecting shadowed parameters', async () => {
  const scan = await analyzeSources(fixture, { sourceId: 'example' });
  assert.equal(validateSourceSnapshot(scan).ok, true);
  const twice = scan.declarations.find(d => d.name === 'twice');
  const parameter = scan.declarations.find(d => d.name === 'calculate' && d.kind === 'parameter');
  const calls = scan.references.filter(r => r.name === 'calculate' && r.kind === 'call');
  assert.deepEqual(calls.map(r => r.resolution.targets), [[twice.id], [parameter.id]]);
  const unresolved = scan.references.find(r => r.name === 'unknownCall');
  assert.equal(unresolved.resolution.status, 'unresolved');
  assert.deepEqual(querySourceSnapshot(scan, 'references', twice.id).results.filter(r => r.kind === 'call').map(r => r.id), [calls[0].id]);
});

test('scan identity is deterministic, root-independent and does not merge same-named declarations', async () => {
  const a = await analyzeSources(fixture, { sourceId: 'example' });
  const b = await analyzeSources([...fixture].reverse(), { sourceId: 'example' });
  assert.deepEqual(a, b);
  const c = await analyzeSources(fixture, { sourceId: 'another-repo' });
  assert.notEqual(a.id, c.id);
  const changed = await analyzeSources(fixture.map(f => f.path === 'math.ts' ? { ...f, content: f.content.replace('* 2', '* 3') } : f), { sourceId: 'example' });
  assert.notEqual(a.id, changed.id);
  assert.notEqual(a.declarations.find(d => d.name === 'twice').id, changed.declarations.find(d => d.name === 'twice').id);
});

test('comments and strings do not invent references; UTF-16 spans identify original source', async () => {
  const content = '// 🦉 fakeCall()\r\nconst π = "ghost()";\r\nexport function greet() { return π; }\r\n';
  const scan = await analyzeSources([{ path: 'unicode.mjs', content }]);
  assert.ok(!scan.references.some(r => ['fakeCall', 'ghost'].includes(r.name)));
  const ref = scan.references.find(r => r.name === 'π');
  assert.equal(content.slice(ref.span.start.offset, ref.span.end.offset), 'π');
  assert.equal(ref.span.start.line, 3);
  assert.equal(scan.files[0].byteLength, Buffer.byteLength(content));
  assert.equal(scan.files[0].textLength, content.length);
});

test('syntax recovery, unsupported files, missing modules and dynamic imports remain explicit', async () => {
  const scan = await analyzeSources([
    { path: 'broken.ts', content: 'export function broken( {\n' },
    { path: 'main.mjs', content: "import x from './absent.mjs';\nimport('external-package');\nimport(variable);\n" },
    { path: 'Proof.lean', content: 'theorem identity (p : Prop) : p → p := fun h => h\n' },
  ]);
  assert.equal(scan.files.find(f => f.path === 'broken.ts').parseStatus, 'errors');
  assert.equal(scan.files.find(f => f.path === 'Proof.lean').status, 'skipped');
  assert.ok(scan.diagnostics.some(d => d.code.startsWith('typescript/')));
  assert.ok(scan.references.filter(r => ['import', 'dynamic-import'].includes(r.kind)).every(r => r.resolution.status === 'unresolved'));
  assert.ok(scan.references.some(r => r.resolution.reason === 'dynamic-module'));
});

test('source contracts reject dangling identities, corrupt digests and invalid spans', async () => {
  const scan = await analyzeSources(fixture);
  for (const [mutate, expected] of [
    [s => { s.references[0].resolution = { status: 'resolved', targets: ['decl-' + '0'.repeat(64)], reason: 'compiler-binding' }; }, 'source/target'],
    [s => { s.declarations[0].span.end.offset = 100000; }, 'source/span'],
    [s => { s.files.push(s.files[0]); }, 'source/duplicate'],
  ]) {
    const modified = structuredClone(scan); mutate(modified);
    modified.id = sourceSnapshotId(modified);
    const result = validateSourceSnapshot(modified);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => d.code === expected));
  }
  assert.equal(validateSourceSnapshot({ ...scan, id: 'snapshot-' + '0'.repeat(64) }).ok, false);
  assert.equal(validateSourceSnapshot(null).ok, false);
  assert.throws(() => querySourceSnapshot(scan, 'inspect', 'missing'), /Unknown/);
});

test('module extensions, JSX syntax, Unicode input and snapshot path rules are explicit', async () => {
  for (const file of ['main.js', 'main.jsx', 'main.mjs', 'main.cjs', 'main.ts', 'main.tsx', 'main.mts', 'main.cts', 'MAIN.TS']) {
    const scan = await analyzeSources([{path:file,content:'export function run() { return 1; }'}]);
    assert.equal(scan.files[0].status, 'analyzed');
    assert.equal(scan.declarations.find(d => d.name === 'run').kind, 'function');
  }
  const jsx = await analyzeSources([{path:'view.tsx',content:'const View = () => <section>Hello</section>;'}]);
  assert.equal(jsx.files[0].parseStatus, 'parsed');
  for (const input of [[null], [{path:'../secret.ts',content:''}], [{path:'a.ts',content:'\ud800'}], [fixture[0], fixture[0]]]) {
    await assert.rejects(analyzeSources(input), /Source entries/);
  }
});

test('bounded queries retain complete records and report omitted results', async () => {
  const scan = await analyzeSources(fixture);
  const first = querySourceSnapshot(scan, 'search', 'calculate', { limit: 1 });
  assert.equal(first.results.length, 1);
  assert.ok(first.omitted > 0);
  const next = querySourceSnapshot(scan, 'search', 'calculate', { limit: 1, offset: first.nextOffset });
  assert.notEqual(first.results[0].id, next.results[0].id);
  const small = querySourceSnapshot(scan, 'inspect', scan.declarations[0].id, { budget: 64 });
  assert.deepEqual(small.results, []);
  assert.equal(small.nextOffset, null);
  assert.ok(small.minimumNextItemCharacters > 64);
  first.source.id = 'changed-report'; first.results[0].name = 'changed-result';
  assert.equal(validateSourceSnapshot(scan).ok, true);
});

test('methods, overload candidates, shorthand reads and locally shadowed require stay distinct', async () => {
  const scan = await analyzeSources([{path:'edges.ts',content:`
    export function choose(x: string): string;
    export function choose(x: number): number;
    export function choose(x: unknown) { return x; }
    const original = 1;
    const object = { original, run() { return original; } };
    object.run(); choose(1);
    function local(require: (s: string) => void) { require('./not-a-module'); }
  `}]);
  const method = scan.declarations.find(d => d.name === 'run');
  assert.deepEqual(scan.references.find(r => r.name === 'run' && r.kind === 'call').resolution.targets, [method.id]);
  assert.equal(scan.references.find(r => r.name === 'choose' && r.kind === 'call').resolution.status, 'ambiguous');
  assert.ok(!scan.references.some(r => r.kind === 'require'));
  const original = scan.declarations.find(d => d.name === 'original' && d.kind === 'variable');
  assert.equal(scan.references.filter(r => r.name === 'original' && r.resolution.targets.includes(original.id)).length, 2);
});

test('destructured parameters remain parameter bindings instead of global or function-name guesses', async () => {
  const scan = await analyzeSources([{path:'params.ts',content:'export function execute({run}: {run: () => void}) { run(); }'}]);
  const parameter = scan.declarations.find(d => d.name === 'run' && d.kind === 'parameter');
  assert.ok(parameter);
  assert.deepEqual(scan.references.find(r => r.name === 'run' && r.kind === 'call').resolution.targets, [parameter.id]);
});
