import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { querySourceSnapshot, validateSourceSnapshot } from '../modules/knowledge/source/index.mjs';
import { sourceSnapshotId } from '../modules/knowledge/source/model.mjs';

const library = [
  { path: 'lib.ts', content: 'export function run() {} export default function main() {} export let mutable = run; export function overloaded(x: string): void; export function overloaded(x: number): void; export function overloaded(x: unknown) {}' },
  { path: 'facade.ts', content: "export { run as renamed, default, mutable, overloaded } from './lib.js';" },
];
const scanCode = content => analyzeSources([...library, { path: 'main.ts', content }]);
const binding = (s, name) => s.declarations.find(d => d.name === name && s.files.find(f => f.id === d.fileRef).path === 'main.ts');

test('literal awaited import keeps lexical binding and traces renamed/default exports with evidence', async () => {
  const s = await scanCode("async function load() { const { renamed: local, default: start } = await import('./facade.js'); local(); start(); function nested(local: () => void) { local(); } }");
  const local = binding(s, 'local'), p = local.valueProvenance;
  assert.equal(p.kind, 'await-import');
  assert.equal(p.importedName, 'renamed');
  assert.equal(s.references.find(r => r.id === p.moduleRef).kind, 'dynamic-import');
  assert.equal(p.resolution.status, 'resolved');
  const target = s.declarations.find(d => d.id === p.resolution.targets[0]);
  assert.equal(target.name, 'run');
  const calls = s.references.filter(r => r.kind === 'call' && r.name === 'local');
  assert.deepEqual(calls[0].resolution.targets, [local.id]);
  assert.equal(s.declarations.find(d => d.id === calls[1].resolution.targets[0]).kind, 'parameter');
  assert.equal(querySourceSnapshot(s, 'references', target.id).results.some(r => r.id === calls[0].id), true);
  assert.equal(s.declarations.find(d => d.id === binding(s, 'start').valueProvenance.resolution.targets[0]).name, 'main');
});

test('mutable, defaulted, nested, rest, computed and dynamic destructuring report unsupported provenance', async () => {
  const cases = [
    ["let { renamed: local } = await import('./facade.js'); local();", 'mutable-binding'],
    ["const { renamed: local } = await import('./facade.js'); local = other; local();", 'written-binding'],
    ["const { renamed: local = other } = await import('./facade.js'); local();", 'unsupported-binding-pattern'],
    ["const { renamed: { local } } = await import('./facade.js'); local();", 'unsupported-binding-pattern'],
    ["const { ...local } = await import('./facade.js'); local();", 'unsupported-binding-pattern'],
    ["const { ['renamed']: local } = await import('./facade.js'); local();", 'unsupported-binding-pattern'],
    ["const { renamed: local } = await import(moduleName); local();", 'dynamic-module'],
    ["const { mutable: local } = await import('./facade.js'); local();", 'mutable-export'],
    ["const { missing: local } = await import('./facade.js'); local();", 'missing-export'],
  ];
  for (const [content, reason] of cases) {
    const s = await scanCode(content), p = binding(s, 'local').valueProvenance;
    assert.equal(p.resolution.status, 'unresolved', content);
    assert.equal(p.resolution.reason, reason, content);
  }
});

test('export overloads remain candidates and external boundaries differ from missing relative modules', async () => {
  const s = await scanCode("const { overloaded: local } = await import('./facade.js'); local(1); import fs from 'node:fs'; import x from 'some-package'; import y from './missing.js'; import z from '#alias';");
  assert.equal(binding(s, 'local').valueProvenance.resolution.status, 'ambiguous');
  const module = name => s.references.find(r => r.kind === 'import' && r.name === name);
  assert.equal(module('node:fs').resolution.reason, 'external-builtin');
  assert.equal(module('some-package').resolution.reason, 'external-package-specifier');
  assert.equal(module('./missing.js').resolution.reason, 'missing-internal-module');
  assert.equal(module('#alias').resolution.reason, 'unconfigured-module-specifier');
});

test('provenance contract rejects dangling evidence and target references', async () => {
  const original = await scanCode("const { renamed: local } = await import('./facade.js'); local();");
  for (const mutate of [p => { p.moduleRef = 'ref-' + '0'.repeat(64); }, p => { p.resolution.targets = ['decl-' + '0'.repeat(64)]; }]) {
    const s = structuredClone(original); mutate(binding(s, 'local').valueProvenance); s.id = sourceSnapshotId(s);
    assert.equal(validateSourceSnapshot(s).ok, false);
  }
});

test('star collisions and incomplete export paths do not collapse to a chosen declaration', async () => {
  const s = await analyzeSources([
    {path:'a.ts',content:'export function run() {}'},
    {path:'b.ts',content:'export function run() {}'},
    {path:'both.ts',content:"export * from './a.js'; export * from './b.js';"},
    {path:'unknown.ts',content:"export * from './a.js'; export * from './absent.js';"},
    {path:'main.ts',content:"const {run: local} = await import('./both.js'); local(); const {run: unknown} = await import('./unknown.js'); unknown();"},
  ]);
  assert.equal(binding(s, 'local').valueProvenance.resolution.status, 'ambiguous');
  assert.equal(binding(s, 'local').valueProvenance.resolution.targets.length, 2);
  assert.equal(binding(s, 'unknown').valueProvenance.resolution.reason, 'unresolved-re-export');
});

test('writes through assignment patterns and loops invalidate provenance, shadow writes do not', async () => {
  for (const assignment of ['({local} = other)', '[local] = other', 'for (local of other) {}', 'local++', 'local ||= other']) {
    const s = await scanCode(`const { renamed: local } = await import('./facade.js'); ${assignment}; local();`);
    assert.equal(binding(s, 'local').valueProvenance.resolution.reason, 'written-binding', assignment);
  }
  const s = await scanCode("const { renamed: local } = await import('./facade.js'); function inner(local: unknown) {local = 1;} local();");
  assert.equal(binding(s, 'local').valueProvenance.resolution.status, 'resolved');
});

test('named re-export facades preserve star ambiguity and exclude type-only exports', async () => {
  const s = await analyzeSources([
    {path:'a.ts',content:'export function run() {}'},
    {path:'b.ts',content:'export function run() {}'},
    {path:'both.ts',content:"export * from './a.js'; export * from './b.js';"},
    {path:'facade.ts',content:"export {run as renamed} from './both.js'; export type {run as typeOnly} from './a.js';"},
    {path:'main.ts',content:"const {renamed: local, typeOnly: typed} = await import('./facade.js'); local(); typed();"},
  ]);
  assert.equal(binding(s, 'local').valueProvenance.resolution.status, 'ambiguous');
  assert.equal(binding(s, 'typed').valueProvenance.resolution.reason, 'type-only-export');
});
