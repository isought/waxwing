import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { sourceNavigation, querySourceSnapshot } from '../modules/knowledge/source/index.mjs';
import { renderSourceHTML } from '../modules/presentation/source/index.mjs';
import { renderSourceFile } from '../modules/application/scan.mjs';

const fixture = async () => analyzeSources([
  { path: 'lib.mjs', content: 'export function run() {}' },
  { path: 'app.mjs', content: "export async function boot() { const {run: local} = await import('./lib.mjs'); const result = local(); function nested() { local(); } }" },
]);
test('navigation preserves exact evidence, provenance and nearest named callable ownership', async () => {
  const s = await fixture(), nav = sourceNavigation(s), boot = s.declarations.find(d => d.name === 'boot'), nested = s.declarations.find(d => d.name === 'nested');
  const calls = nav.relationships.filter(r => r.reference.kind === 'call');
  assert.deepEqual(calls.map(r => r.callerRef), [boot.id, nested.id]);
  assert.equal(calls[0].provenance[0].importedName, 'run');
  assert.equal(querySourceSnapshot(s, 'outgoing', boot.id).results.length, 1);
  assert.equal(querySourceSnapshot(s, 'functions', boot.fileRef).results.length, 2);
  nav.declarations[0].name = 'mutated';
  assert.notEqual(s.declarations[0].name, 'mutated');
  const html = renderSourceHTML(s);
  const embedded = JSON.parse(html.match(/<script type="application\/json" id="source-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(embedded.relationships, sourceNavigation(s).relationships);
  assert.ok(html.includes('Find a file or function'));
});

test('standalone source view escapes hostile source names and does not execute scanned code', async () => {
  const s = await analyzeSources([{path:'<img onerror=alert(1)>.mjs',content:'const text = "</script><script>alert(1)</script>";'}], { sourceId: '</title><script>alert(1)</script>' });
  const html = renderSourceHTML(s);
  assert.ok(!html.includes('</title><script>alert(1)'));
  assert.ok(!html.includes('<img onerror=alert(1)>'));
  assert.ok(html.includes('\\u003c'));
});

test('CLI source view writes atomic HTML, rejects input/symlink replacement and leaves prior output on failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-source-view-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const input = path.join(dir, 'snapshot.json'), output = path.join(dir, 'source.html');
  fs.writeFileSync(input, JSON.stringify(await fixture()));
  const cli = spawnSync(process.execPath, ['bin/waxwing.mjs', 'scan-view', input, output], {encoding:'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  fs.writeFileSync(input, '{}');
  await assert.rejects(renderSourceFile(input, output), /Invalid/);
  assert.equal(fs.readFileSync(output, 'utf8'), html);
  fs.symlinkSync(output, path.join(dir, 'alias.html'));
  await assert.rejects(renderSourceFile(input, path.join(dir, 'alias.html')), /symlink/);
  await assert.rejects(renderSourceFile(output, output), /overwrite/);
});
