import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initIntegration, detachIntegration, findBlock } from '../modules/interfaces/integration/lifecycle.mjs';
import { doctorReport, runtimeReport } from '../modules/interfaces/integration/doctor.mjs';
import { TEMPLATE_COMMANDS, instructionBlock, portableSkillFiles, sha256 } from '../modules/interfaces/integration/templates.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/waxwing.mjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'waxwing setup '));
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// Every file below the project except .git, with contents, for byte-level comparison.
function tree(dir, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const relative = prefix + entry.name, file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) result[relative] = `-> ${fs.readlinkSync(file)}`;
    else if (entry.isDirectory()) { result[relative + '/'] = 'dir'; Object.assign(result, tree(file, relative + '/')); }
    else result[relative] = fs.readFileSync(file, 'latin1');
  }
  return result;
}
function project(files = {}) {
  const dir = temp();
  fs.mkdirSync(path.join(dir, '.git'));
  for (const [name, text] of Object.entries(files)) write(path.join(dir, name), text);
  return dir;
}

test('init is repeatable and detach restores unrelated bytes for LF, CRLF and unterminated instruction files', () => {
  for (const original of ['# Rules\n\nBe kind.\n', '# Rules\r\n\r\nBe kind.\r\n', 'No trailing newline', '# Ends with a blank line\n\n']) {
    const dir = project({ 'AGENTS.md': original, 'docs/notes.md': 'unrelated' });
    try {
      const before = tree(dir);
      const first = initIntegration({ agents: ['codex', 'claude'], project: dir });
      assert.equal(first.status, 'installed');
      assert.deepEqual(first.changes.map(c => c.path).sort(), ['.agents/skills/waxwing/SKILL.md', '.agents/skills/waxwing/references/create.md', '.agents/skills/waxwing/references/investigate.md',
        '.agents/skills/waxwing/references/update.md', '.claude/skills/waxwing/SKILL.md', '.claude/skills/waxwing/references/create.md', '.claude/skills/waxwing/references/investigate.md',
        '.claude/skills/waxwing/references/update.md', '.waxwing/integration.json', 'AGENTS.md', 'CLAUDE.md']);
      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
      assert.ok(agents.startsWith(original), 'existing bytes remain a prefix');
      if (original.includes('\r\n')) assert.ok(!/[^\r]\n/.test(agents), 'CRLF file keeps CRLF line endings');
      const installed = tree(dir);
      assert.equal(initIntegration({ agents: ['codex', 'claude'], project: dir }).status, 'unchanged');
      assert.deepEqual(tree(dir), installed);
      const detached = detachIntegration({ agents: ['codex', 'claude'], project: dir });
      assert.equal(detached.status, 'detached');
      assert.deepEqual(tree(dir), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('dry-run reports exact changes without writing; subdirectories and file-based .git worktrees resolve the root', () => {
  const dir = temp();
  try {
    write(path.join(dir, 'main repo/.git/HEAD'), 'ref: refs/heads/main\n');
    const worktree = path.join(dir, 'linked worktree');
    write(path.join(worktree, '.git'), `gitdir: ${path.join(dir, 'main repo/.git/worktrees/linked')}\n`);
    write(path.join(worktree, 'src/deep/file.js'), '');
    const before = tree(dir);
    const result = run(path.join(worktree, 'src/deep'), ['init', '--agent', 'claude', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.status, 'dry-run');
    assert.equal(plan.project.root, fs.realpathSync(worktree));
    assert.equal(plan.project.basis, 'git-worktree');
    assert.match(plan.diff, /\+\+\+ CLAUDE\.md/);
    assert.match(plan.diff, /\+<!-- waxwing:begin -->/);
    assert.deepEqual(tree(dir), before);
    const applied = JSON.parse(run(path.join(worktree, 'src/deep'), ['init', '--agent', 'claude']).stdout);
    assert.equal(applied.status, 'installed');
    assert.equal(applied.readiness.hostUptake, 'untested');
    assert.ok(fs.existsSync(path.join(worktree, '.claude/skills/waxwing/SKILL.md')));
    assert.ok(!fs.existsSync(path.join(worktree, 'src/deep/CLAUDE.md')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('active and alternative host instruction targets are used instead of shadowed files', () => {
  const dir = project({ 'AGENTS.md': 'base\n', 'AGENTS.override.md': 'override\n', '.claude/CLAUDE.md': 'claude rules\n' });
  try {
    const result = initIntegration({ agents: ['codex', 'claude'], project: dir });
    assert.equal(result.status, 'installed');
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'base\n');
    assert.ok(findBlock(fs.readFileSync(path.join(dir, 'AGENTS.override.md'), 'utf8')));
    assert.ok(findBlock(fs.readFileSync(path.join(dir, '.claude/CLAUDE.md'), 'utf8')));
    assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
    assert.ok(result.notes.some(note => /AGENTS\.override\.md is active/.test(note)));
    const doctor = doctorReport({ project: dir, env: { PATH: '' } });
    assert.equal(doctor.integration.hosts.codex.instructions.state, 'installed');
    // A block left only in the base file is reported as shadowed.
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'base\n\n' + instructionBlock() + '\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.override.md'), 'override\n');
    assert.equal(doctorReport({ project: dir, env: { PATH: '' } }).integration.hosts.codex.instructions.state, 'shadowed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shared instruction files receive one block: symlinks inside the project and @AGENTS.md imports', () => {
  const linked = project({ 'AGENTS.md': 'shared\n' });
  const imported = project({ 'AGENTS.md': 'shared\n', 'CLAUDE.md': '@AGENTS.md\n' });
  const outside = project({});
  const external = temp();
  try {
    fs.symlinkSync('AGENTS.md', path.join(linked, 'CLAUDE.md'));
    const before = tree(linked);
    assert.equal(initIntegration({ agents: ['codex', 'claude'], project: linked }).status, 'installed');
    const text = fs.readFileSync(path.join(linked, 'AGENTS.md'), 'utf8');
    assert.equal(text.match(/waxwing:begin/g).length, 1);
    assert.ok(fs.lstatSync(path.join(linked, 'CLAUDE.md')).isSymbolicLink());
    assert.equal(initIntegration({ agents: ['claude', 'codex'], project: linked }).status, 'unchanged');
    detachIntegration({ agents: ['claude', 'codex'], project: linked });
    assert.deepEqual(tree(linked), before);

    const result = initIntegration({ agents: ['codex', 'claude'], project: imported });
    assert.equal(fs.readFileSync(path.join(imported, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    assert.ok(result.notes.some(note => /imports AGENTS\.md/.test(note)));
    assert.equal(doctorReport({ project: imported, env: { PATH: '' } }).integration.hosts.claude.instructions.via, '@AGENTS.md import');
    // Detaching Claude alone must keep the Codex block that Claude imported.
    detachIntegration({ agents: ['claude'], project: imported });
    assert.ok(findBlock(fs.readFileSync(path.join(imported, 'AGENTS.md'), 'utf8')));

    write(path.join(external, 'AGENTS.md'), 'elsewhere\n');
    fs.symlinkSync(path.join(external, 'AGENTS.md'), path.join(outside, 'AGENTS.md'));
    const refused = initIntegration({ agents: ['codex'], project: outside });
    assert.equal(refused.status, 'conflict');
    assert.equal(refused.conflicts[0].code, 'symlink-outside-project');
    assert.equal(fs.readFileSync(path.join(external, 'AGENTS.md'), 'utf8'), 'elsewhere\n');
  } finally { for (const dir of [linked, imported, outside, external]) fs.rmSync(dir, { recursive: true, force: true }); }
});

test('edited managed content is preserved: init conflicts before writing and detach reports residual content', () => {
  const dir = project({ 'AGENTS.md': 'rules\n' });
  try {
    initIntegration({ agents: ['codex', 'claude'], project: dir });
    const edited = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').replace('Waxwing can retrieve', 'Our team says Waxwing can retrieve');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), edited);
    fs.appendFileSync(path.join(dir, '.claude/skills/waxwing/SKILL.md'), '\nLocal note.\n');
    const before = tree(dir);
    const conflict = initIntegration({ agents: ['codex', 'claude'], project: dir });
    assert.equal(conflict.ok, false);
    assert.deepEqual(conflict.conflicts.map(c => c.code).sort(), ['edited-block', 'edited-skill-file']);
    assert.deepEqual(tree(dir), before, 'a conflict writes nothing');
    const detached = detachIntegration({ agents: ['codex', 'claude'], project: dir });
    assert.ok(detached.preserved.some(p => p.code === 'edited-block' && p.residual.includes('Our team says')));
    assert.ok(detached.preserved.some(p => p.code === 'edited-skill-file'));
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), edited);
    assert.ok(fs.readFileSync(path.join(dir, '.claude/skills/waxwing/SKILL.md'), 'utf8').endsWith('Local note.\n'));
    assert.ok(!fs.existsSync(path.join(dir, '.agents/skills/waxwing/SKILL.md')), 'unchanged files are still removed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('older managed templates upgrade in place; unknown or duplicated markers and bound skills conflict', () => {
  const dir = project({ 'AGENTS.md': 'rules\n' });
  try {
    initIntegration({ agents: ['codex'], project: dir });
    const receiptFile = path.join(dir, '.waxwing/integration.json'), receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    const oldBlock = '<!-- waxwing:begin -->\nOlder managed wording.\n<!-- waxwing:end -->';
    const oldSkill = 'older skill\n';
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `rules\n\n${oldBlock}\n`);
    fs.writeFileSync(path.join(dir, '.agents/skills/waxwing/SKILL.md'), oldSkill);
    receipt.hosts.codex.instructions.blockSha256 = sha256(oldBlock);
    receipt.hosts.codex.skill.files['SKILL.md'] = sha256(oldSkill);
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    assert.equal(doctorReport({ project: dir, env: { PATH: '' } }).integration.hosts.codex.instructions.state, 'stale-template');
    assert.equal(initIntegration({ agents: ['codex'], project: dir }).status, 'installed');
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), `rules\n\n${instructionBlock()}\n`);
    assert.equal(fs.readFileSync(path.join(dir, '.agents/skills/waxwing/SKILL.md'), 'utf8'), portableSkillFiles().get('SKILL.md'));

    fs.appendFileSync(path.join(dir, 'AGENTS.md'), '<!-- waxwing:begin -->\n');
    assert.equal(initIntegration({ agents: ['codex'], project: dir }).conflicts[0].code, 'ambiguous-markers');

    const bound = project({});
    write(path.join(bound, '.claude/skills/waxwing/waxwing-skill.json'), '{}');
    const refused = initIntegration({ agents: ['claude'], project: bound });
    assert.equal(refused.conflicts[0].code, 'bound-skill-present');
    assert.ok(!fs.existsSync(path.join(bound, 'CLAUDE.md')));
    fs.rmSync(bound, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Codex instruction size limit is a preflight conflict', () => {
  const dir = project({ 'AGENTS.md': 'x'.repeat(32500) + '\n' });
  try {
    const result = initIntegration({ agents: ['codex'], project: dir });
    assert.equal(result.status, 'conflict');
    assert.equal(result.conflicts[0].code, 'instruction-size-cap');
    assert.ok(!fs.existsSync(path.join(dir, '.agents')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a failed multi-file write rolls back, and an interrupted journal is recovered before the next run', () => {
  const dir = project({ 'AGENTS.md': 'rules\n' });
  try {
    const before = tree(dir);
    const failed = run(dir, ['init', '--agent', 'codex', '--agent', 'claude'], { WAXWING_TEST_FAIL_AFTER_WRITES: '4' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Injected failure/);
    assert.deepEqual(tree(dir), before);

    // Simulate a process that stopped after replacing AGENTS.md but before cleanup.
    write(path.join(dir, '.waxwing/.transaction-crash/0'), 'rules\n');
    write(path.join(dir, '.waxwing/integration.journal.json'), JSON.stringify({ transaction: '.waxwing/.transaction-crash', entries: [{ path: 'AGENTS.md', backup: '.waxwing/.transaction-crash/0' }, { path: 'CLAUDE.md', created: true }], createdDirectories: [] }));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'partially written\n');
    write(path.join(dir, 'CLAUDE.md'), 'partial');
    assert.equal(doctorReport({ project: dir, env: { PATH: '' } }).problems.some(p => /interrupted/.test(p)), true);
    const recovered = initIntegration({ agents: ['codex'], project: dir });
    assert.deepEqual(recovered.recovered, ['AGENTS.md', 'CLAUDE.md']);
    assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').startsWith('rules\n\n<!-- waxwing:begin -->'));
    assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.waxwing/integration.journal.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctor distinguishes runtime on PATH, other runtimes and missing commands without claiming host uptake', () => {
  const dir = project({});
  const bin = temp(), other = temp();
  try {
    fs.symlinkSync(cli, path.join(bin, 'waxwing'));
    write(path.join(other, 'pkg/package.json'), JSON.stringify({ name: '@isought/waxwing', version: '0.0.1' }));
    write(path.join(other, 'pkg/bin/waxwing.mjs'), '');
    fs.chmodSync(path.join(other, 'pkg/bin/waxwing.mjs'), 0o755);
    fs.symlinkSync(path.join(other, 'pkg/bin/waxwing.mjs'), path.join(other, 'waxwing'));
    assert.equal(runtimeReport({ PATH: bin }).pathResolvesTo, 'this-runtime');
    const ambiguous = runtimeReport({ PATH: [other, bin].join(path.delimiter) });
    assert.equal(ambiguous.pathResolvesTo, 'other-waxwing-runtime');
    assert.equal(ambiguous.pathAmbiguous, true);
    assert.equal(runtimeReport({ PATH: '' }).pathResolvesTo, 'missing');

    assert.equal(doctorReport({ project: dir, env: { PATH: bin } }).status, 'not-configured');
    initIntegration({ agents: ['claude'], project: dir });
    const ready = doctorReport({ project: dir, env: { PATH: bin } });
    assert.equal(ready.status, 'ready');
    assert.equal(ready.integration.hosts.claude.uptake, 'untested');
    assert.ok(ready.notes.some(note => /not that a model session loaded/.test(note)));
    const missing = doctorReport({ project: dir, env: { PATH: '' } });
    assert.equal(missing.status, 'attention');
    assert.ok(missing.repairs.some(r => r.startsWith('npm install -g @isought/waxwing@')));
  } finally { for (const d of [dir, bin, other]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('generated instructions stay small and only invoke commands this runtime provides', () => {
  const block = instructionBlock();
  assert.ok(Buffer.byteLength(block) <= 1024, `instruction block is ${Buffer.byteLength(block)} bytes`);
  const help = run(root, ['--help']).stdout;
  const texts = [block, ...portableSkillFiles().values()];
  for (const text of texts) {
    assert.ok(!text.includes('<skill>'), 'portable files do not reference an absolute skill adapter');
    for (const [, command] of text.matchAll(/(?:^|`)waxwing ([a-z][a-z-]*)/gm)) {
      assert.ok(TEMPLATE_COMMANDS.includes(command) || command === 'doctor', `template invokes unlisted command ${command}`);
    }
  }
  for (const command of TEMPLATE_COMMANDS) assert.match(help, new RegExp(`waxwing ${command}\\b`), `CLI help lacks ${command}`);
  const guide = run(root, ['guide', 'list']);
  assert.equal(guide.status, 0, guide.stderr);
  assert.ok(JSON.parse(guide.stdout).some(topic => topic.topic === 'basics'));
});
