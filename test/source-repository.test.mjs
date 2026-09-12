import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { scanRepository, scanRepositoryToFile, loadSourceSnapshot } from '../modules/application/scan.mjs';

const cli = fileURLToPath(new URL('../bin/waxwing.mjs', import.meta.url));
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing-scan-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'repository'); fs.mkdirSync(root);
  const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  return { root, temporary, write, git };
}

test('Git discovery honors ignore rules, retains tracked ignored files and never executes source or fsmonitor', async t => {
  const { root, temporary, write, git } = fixture(t);
  git('init', '-q');
  write('.gitignore', 'ignored.ts\ntracked.ts\n');
  write('ignored.ts', 'export const hidden = 1;');
  write('tracked.ts', 'export const tracked = 1;'); git('add', '-f', 'tracked.ts');
  const marker = path.join(temporary, 'executed');
  write('main.mjs', `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed'); export const value = 1;`);
  const hook = write('monitor.sh', `#!/bin/sh\ntouch '${marker}'\n`); fs.chmodSync(hook, 0o755);
  git('config', 'core.fsmonitor', hook);
  write('node_modules/package/index.js', 'export const ignoredDependency = 1;');
  const before = fs.readFileSync(path.join(root, 'main.mjs'));
  const scan = await scanRepository(root, { sourceId: 'test' });
  assert.equal(scan.coverage.discovery, 'git-working-tree');
  assert.ok(!scan.files.some(f => f.path === 'ignored.ts' || f.path.startsWith('node_modules/')));
  assert.equal(scan.files.find(f => f.path === 'tracked.ts').status, 'analyzed');
  assert.ok(!fs.existsSync(marker));
  assert.deepEqual(fs.readFileSync(path.join(root, 'main.mjs')), before);
});

test('filesystem scans bound input size and make symlinks, binary files and unsupported languages visible', async t => {
  const { root, temporary, write } = fixture(t);
  write('small.ts', 'export const value = 1;');
  write('big.ts', ' '.repeat(500));
  write('broken.ts', Buffer.from([0xff, 0xfe]));
  write('binary.js', 'const x=1;\0');
  write('Proof.lean', 'theorem identity (p : Prop) : p → p := fun h => h');
  write('generated/large.ts', ' '.repeat(500));
  const outside = path.join(temporary, 'outside.ts'); fs.writeFileSync(outside, 'export const outside = 1;');
  fs.symlinkSync(outside, path.join(root, 'linked.ts'));
  const scan = await scanRepository(root, { maxFileBytes: 128 });
  const reason = name => scan.files.find(f => f.path === name)?.reason;
  assert.equal(reason('big.ts'), 'max-file-bytes');
  assert.equal(reason('linked.ts'), 'symlink');
  assert.equal(reason('broken.ts'), 'invalid-utf8');
  assert.equal(reason('binary.js'), 'binary-content');
  assert.equal(reason('Proof.lean'), 'unsupported-language');
  assert.ok(!scan.files.some(f => f.path.startsWith('generated/')));
  assert.deepEqual(scan.declarations.map(d => d.name), ['value']);
  const limited = await scanRepository(root, { maxFiles: 1 });
  assert.equal(limited.files.length, 1);
  assert.equal(limited.coverage.discoveryComplete, false);
  assert.ok(limited.diagnostics.some(d => d.code === 'scan/incomplete-discovery'));
  const bytes = await scanRepository(root, { maxTotalBytes: 1 });
  assert.ok(!bytes.files.some(f => f.status === 'analyzed'));
  assert.ok(bytes.files.some(f => f.reason === 'max-total-bytes'));
  scan.coverage.excludedDirectories.push('included');
  write('included/module.ts', 'export const additional = 1;');
  assert.ok((await scanRepository(root)).files.some(f => f.path === 'included/module.ts' && f.status === 'analyzed'));
});

test('scan output is atomic, stays outside sources, and round-trips through independent CLI queries', async t => {
  const { root, temporary, write } = fixture(t);
  const source = 'export function twice(n: number) { return n * 2; }\n';
  write('math.ts', source);
  write('main.ts', "import {twice} from './math.js'; twice(3);\n");
  const output = path.join(temporary, 'snapshot.json');
  const result = await scanRepositoryToFile(root, output, { sourceId: 'fixture' });
  assert.equal(result.ok, true);
  const scan = loadSourceSnapshot(output), target = scan.declarations.find(d => d.name === 'twice' && d.kind === 'function');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: temporary, encoding: 'utf8' });
  const check = run(['scan-check', output]); assert.equal(check.status, 0, check.stderr);
  const query = run(['scan-query', output, 'references', target.id]); assert.equal(query.status, 0, query.stderr);
  assert.ok(JSON.parse(query.stdout).results.some(r => r.kind === 'call'));
  const scanned = run(['scan', root, path.join(temporary, 'cli.json'), '--source-id', 'fixture']); assert.equal(scanned.status, 0, scanned.stderr);
  assert.deepEqual(loadSourceSnapshot(path.join(temporary, 'cli.json')), scan);
  await assert.rejects(scanRepositoryToFile(root, path.join(root, 'math.ts')), /outside/);
  fs.symlinkSync(root, path.join(temporary, 'alias'), 'dir');
  await assert.rejects(scanRepositoryToFile(root, path.join(temporary, 'alias', 'new.json')), /outside/);
  assert.equal(fs.readFileSync(path.join(root, 'math.ts'), 'utf8'), source);
  const previous = fs.readFileSync(output);
  await assert.rejects(scanRepositoryToFile(root, output, { maxFiles: 0 }), /limit/);
  assert.deepEqual(fs.readFileSync(output), previous);
  assert.equal(run(['scan', root, output, '--unknown', '1']).status, 1);
});
