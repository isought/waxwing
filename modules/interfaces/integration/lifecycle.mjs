import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contains, displayPath, resolveProject } from '../../application/project.mjs';
import { CONTEXT_PROTOCOL } from '../../knowledge/context/protocol.mjs';
import { END, HOSTS, JOURNAL, RECEIPT, RECEIPT_VERSION, TEMPLATE_VERSION, hostName, instructionBlock, packageInfo, portableSkillFiles, sha256 } from './templates.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const conflict = (code, file, message) => ({ code, path: file, message });
const eolOf = text => /\r\n/.test(text) ? '\r\n' : '\n';
const normalize = text => text.replace(/\r\n/g, '\n');

export function parseHosts(values) {
  if (!Array.isArray(values) || !values.length) throw new Error(`Select at least one --agent: ${Object.keys(HOSTS).join(', ')}.`);
  const hosts = [];
  for (const value of values) {
    const name = hostName(value);
    if (!Object.hasOwn(HOSTS, name)) throw new Error(`Unsupported --agent "${value}". Supported: ${Object.keys(HOSTS).join(', ')}.`);
    if (!hosts.includes(name)) hosts.push(name);
  }
  return hosts;
}

function readText(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return { exists: false };
  if (!stat.isFile()) return { exists: true, invalid: 'not-regular-file' };
  try { return { exists: true, text: decoder.decode(fs.readFileSync(file)) }; } catch { return { exists: true, invalid: 'invalid-utf8' }; }
}

// Returns {start,end} for exactly one managed block, null for none, or a conflict code.
export function findBlock(text) {
  const begins = [...text.matchAll(/<!-- waxwing:begin[^>]*-->/g)], ends = [...text.matchAll(new RegExp(END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  if (!begins.length && !ends.length) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0].index < begins[0].index) return 'ambiguous-markers';
  return { start: begins[0].index, end: ends[0].index + END.length, text: text.slice(begins[0].index, ends[0].index + END.length) };
}

export function loadReceipt(root) {
  const file = path.join(root, RECEIPT), read = readText(file);
  if (!read.exists) return { status: 'absent', receipt: { schemaVersion: RECEIPT_VERSION, hosts: {} } };
  if (read.invalid) return { status: 'invalid', message: read.invalid };
  try {
    const receipt = JSON.parse(read.text);
    if (receipt?.schemaVersion !== RECEIPT_VERSION || !receipt.hosts || typeof receipt.hosts !== 'object' || Array.isArray(receipt.hosts)) throw new Error(`Expected schemaVersion ${RECEIPT_VERSION} with hosts.`);
    return { status: 'loaded', receipt };
  } catch (error) { return { status: 'invalid', message: error.message }; }
}

// Resolve a project-relative path without following links out of the project.
function projectFile(root, relative) {
  const absolute = path.join(root, relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) return { absolute, physical: absolute };
    if (stat.isSymbolicLink()) {
      let target;
      try { target = fs.realpathSync(current); } catch { return { absolute, error: 'broken-symlink' }; }
      if (!contains(root, target)) return { absolute, error: 'symlink-outside-project' };
      if (current !== absolute) return { absolute, error: 'symlinked-directory' };
      return { absolute, physical: target, symlink: true };
    }
  }
  return { absolute, physical: absolute };
}

function instructionTarget(root, name) {
  const host = HOSTS[name];
  const existing = host.instructionCandidates.filter(candidate => fs.lstatSync(path.join(root, candidate), { throwIfNoEntry: false }));
  // Codex uses AGENTS.override.md instead of AGENTS.md at the same scope; Claude loads either location.
  const chosen = existing[0] ?? host.createInstruction;
  return { relative: chosen, ...projectFile(root, chosen), created: !existing.length, ...(name === 'codex' && chosen === 'AGENTS.override.md' ? { note: 'AGENTS.override.md is active at the project root, so the block belongs there.' } : {}) };
}

function planInstructions(root, name, receiptHost, pending) {
  const target = instructionTarget(root, name), conflicts = [], block = instructionBlock();
  if (target.error) return { conflicts: [conflict(target.error, target.relative, 'Instruction file is a link Waxwing will not follow; add the block manually or replace the link.')] };
  const key = target.physical;
  const read = pending.has(key) ? { exists: pending.get(key).after !== null, text: pending.get(key).after ?? '' } : readText(target.physical);
  if (read.invalid) return { conflicts: [conflict(read.invalid, target.relative, 'Instruction target is not a readable UTF-8 file.')] };
  const text = read.exists ? read.text : '';
  // Claude Code expands @AGENTS.md imports; a managed block there already reaches Claude.
  if (name === 'claude' && /^@AGENTS\.md[ \t]*$/m.test(text) && !findBlock(text)) {
    const agents = projectFile(root, 'AGENTS.md'), agentsText = pending.get(agents.physical)?.after ?? readText(agents.physical).text ?? '';
    const found = findBlock(agentsText);
    if (found && typeof found === 'object' && normalize(found.text) === block) return { conflicts, receipt: { path: target.relative, via: '@AGENTS.md' }, via: 'AGENTS.md' };
  }
  const found = findBlock(text), eol = eolOf(text), desired = instructionBlock(eol);
  if (found === 'ambiguous-markers') return { conflicts: [conflict('ambiguous-markers', target.relative, 'Found unbalanced or repeated waxwing markers; resolve them manually.')] };
  let after, separator = pending.get(key)?.separator ?? receiptHost?.instructions?.separator ?? '';
  if (found) {
    const known = normalize(found.text) === block || receiptHost?.instructions?.blockSha256 === sha256(normalize(found.text));
    if (!known) return { conflicts: [conflict('edited-block', target.relative, 'The existing Waxwing block was edited; preserve or remove it manually, then run init again.')] };
    after = text.slice(0, found.start) + desired + text.slice(found.end);
  } else {
    separator = !text ? '' : text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
    after = text + separator + desired + eol;
  }
  if (HOSTS[name].maxInstructionBytes && Buffer.byteLength(after) > HOSTS[name].maxInstructionBytes) {
    conflicts.push(conflict('instruction-size-cap', target.relative, `The file would exceed ${HOSTS[name].maxInstructionBytes} bytes, Codex's default project instruction limit, and the block could be truncated.`));
  }
  pending.set(key, { relative: target.relative, physical: target.physical, before: pending.has(key) ? pending.get(key).before : read.exists ? text : null, after, separator });
  return { conflicts, receipt: { path: target.relative, ...(target.symlink ? { physicalPath: displayPath(root, target.physical) } : {}), blockSha256: sha256(block), separator, ...(target.created ? { created: true } : receiptHost?.instructions?.created ? { created: true } : {}) }, note: target.note };
}

function planSkill(root, name, receiptHost, pending) {
  const directory = HOSTS[name].skillDirectory, conflicts = [], files = {};
  const location = projectFile(root, directory);
  if (location.error || location.symlink) return { conflicts: [conflict(location.error ?? 'symlinked-directory', directory, 'Skill directory path contains a link; Waxwing will not write through it.')] };
  if (fs.existsSync(path.join(root, directory, 'waxwing-skill.json'))) {
    return { conflicts: [conflict('bound-skill-present', directory, 'A package-bound skill from `waxwing skill install` exists here. Keep it, or remove it before selecting the portable project skill.')] };
  }
  for (const [relative, content] of portableSkillFiles()) {
    const file = path.join(root, directory, relative), read = readText(file), hash = sha256(content);
    files[relative] = hash;
    if (read.invalid) { conflicts.push(conflict(read.invalid, `${directory}/${relative}`, 'Skill file is not a regular UTF-8 file.')); continue; }
    if (read.exists && read.text !== content && receiptHost?.skill?.files?.[relative] !== sha256(read.text)) {
      conflicts.push(conflict('edited-skill-file', `${directory}/${relative}`, 'This skill file differs from the managed version; preserve your edits by moving it, then run init again.'));
      continue;
    }
    pending.set(file, { relative: `${directory}/${relative}`, physical: file, before: read.exists ? read.text : null, after: content });
  }
  return { conflicts, receipt: { directory, files } };
}

function diffText(change) {
  const before = normalize(change.before ?? '').split('\n'), after = normalize(change.after ?? '').split('\n');
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const removed = before.slice(prefix, before.length - suffix), added = after.slice(prefix, after.length - suffix);
  return [`--- ${change.before === null ? '/dev/null' : change.relative}`, `+++ ${change.after === null ? '/dev/null' : change.relative}`, `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map(line => `-${line}`), ...added.map(line => `+${line}`)].join('\n');
}

// ---- Transactions ----------------------------------------------------------

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.waxwing-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, content); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
}

function rollback(root, journal) {
  for (const entry of [...journal.entries].reverse()) {
    const file = path.join(root, entry.path);
    if (entry.backup && fs.existsSync(path.join(root, entry.backup))) fs.renameSync(path.join(root, entry.backup), file);
    else if (entry.created) fs.rmSync(file, { force: true });
  }
  for (const directory of [...journal.createdDirectories].reverse()) { try { fs.rmdirSync(path.join(root, directory)); } catch { /* Not empty or already gone. */ } }
  fs.rmSync(path.join(root, journal.transaction), { recursive: true, force: true });
  fs.rmSync(path.join(root, JOURNAL), { force: true });
  try { fs.rmdirSync(path.join(root, '.waxwing')); } catch { /* Keep existing receipt/config. */ }
}

export function recoverInterrupted(root) {
  const read = readText(path.join(root, JOURNAL));
  if (!read.exists) return null;
  let journal;
  try { journal = JSON.parse(read.text); } catch { throw new Error(`Unreadable ${JOURNAL}; inspect it and the files it lists before retrying.`); }
  rollback(root, journal);
  return { recovered: journal.entries.map(entry => entry.path) };
}

function apply(root, changes) {
  const transaction = `.waxwing/.transaction-${randomUUID()}`;
  const journal = { transaction, entries: [], createdDirectories: [] };
  fs.mkdirSync(path.join(root, '.waxwing'), { recursive: true });
  const saveJournal = () => writeAtomic(path.join(root, JOURNAL), JSON.stringify(journal, null, 2) + '\n');
  fs.mkdirSync(path.join(root, transaction));
  saveJournal();
  try {
    for (const [index, change] of changes.entries()) {
      const file = change.physical, relative = displayPath(root, file);
      let directory = path.dirname(file);
      const missing = [];
      while (!fs.existsSync(directory)) { missing.push(directory); directory = path.dirname(directory); }
      journal.createdDirectories.push(...missing.reverse().map(dir => displayPath(root, dir)));
      const entry = { path: relative, ...(change.before === null ? { created: true } : { backup: `${transaction}/${index}` }) };
      if (entry.backup) fs.copyFileSync(file, path.join(root, entry.backup));
      journal.entries.push(entry); saveJournal();
      if (change.after === null) fs.rmSync(file);
      else writeAtomic(file, change.after);
      if (process.env.WAXWING_TEST_FAIL_AFTER_WRITES && journal.entries.length >= Number(process.env.WAXWING_TEST_FAIL_AFTER_WRITES)) throw new Error('Injected failure after write (test only).');
    }
    // Remove directories emptied by deletions (only managed skill directories).
    for (const change of changes.filter(c => c.after === null && c.pruneUpTo)) {
      for (let dir = path.dirname(change.physical); contains(path.join(root, change.pruneUpTo), dir); dir = path.dirname(dir)) {
        try { fs.rmdirSync(dir); } catch { break; }
      }
    }
  } catch (error) {
    rollback(root, journal);
    throw error;
  }
  fs.rmSync(path.join(root, transaction), { recursive: true, force: true });
  fs.rmSync(path.join(root, JOURNAL), { force: true });
  try { fs.rmdirSync(path.join(root, '.waxwing')); } catch { /* Keep receipt/config. */ }
}

function receiptChange(root, receipt) {
  const file = path.join(root, RECEIPT), read = readText(file);
  const after = Object.keys(receipt.hosts).length ? JSON.stringify(receipt, null, 2) + '\n' : null;
  if ((read.text ?? null) === after) return null;
  return { relative: RECEIPT, physical: file, before: read.exists ? read.text : null, after };
}

function summarize(root, project, changes, extra) {
  return { project: { root, basis: project.basis }, changes: changes.map(c => ({ path: c.relative, action: c.before === null ? 'create' : c.after === null ? 'delete' : 'update' })), ...extra };
}

export function initIntegration({ agents, project: projectPath, cwd, dryRun = false } = {}) {
  const hosts = parseHosts(agents);
  const project = resolveProject({ project: projectPath, cwd }), root = project.root;
  const recovered = dryRun ? null : recoverInterrupted(root);
  const loaded = loadReceipt(root);
  if (loaded.status === 'invalid') return summarize(root, project, [], { ok: false, status: 'conflict', conflicts: [conflict('invalid-receipt', RECEIPT, loaded.message)] });
  const receipt = structuredClone(loaded.receipt), pending = new Map(), conflicts = [], notes = [];
  // Codex first so a Claude @AGENTS.md import can reuse its block.
  for (const name of [...hosts].sort((a, b) => (a === 'codex' ? -1 : 0) - (b === 'codex' ? -1 : 0))) {
    const previous = receipt.hosts[name];
    const instructions = planInstructions(root, name, previous, pending), skill = planSkill(root, name, previous, pending);
    conflicts.push(...instructions.conflicts, ...skill.conflicts);
    if (instructions.note) notes.push(instructions.note);
    if (instructions.via) notes.push(`CLAUDE.md imports AGENTS.md, so Claude Code receives the block from AGENTS.md.`);
    receipt.hosts[name] = { instructions: instructions.receipt, skill: skill.receipt };
  }
  receipt.templateVersion = TEMPLATE_VERSION;
  receipt.protocolVersion = CONTEXT_PROTOCOL;
  receipt.writtenBy = `${packageInfo.name}@${packageInfo.version}`;
  const changes = [...pending.values()].filter(change => change.before !== change.after);
  if (conflicts.length) return summarize(root, project, [], { ok: false, status: 'conflict', hosts, conflicts, notes });
  // Keep the receipt stable when a different runtime version finds nothing to change.
  if (loaded.status === 'loaded' && !changes.length) receipt.writtenBy = loaded.receipt.writtenBy ?? receipt.writtenBy;
  const receiptWrite = receiptChange(root, receipt);
  if (receiptWrite) changes.push(receiptWrite);
  if (dryRun) return summarize(root, project, changes, { ok: true, status: 'dry-run', hosts, notes, diff: changes.map(diffText).join('\n') });
  apply(root, changes);
  return summarize(root, project, changes, { ok: true, status: changes.length ? 'installed' : 'unchanged', hosts, notes: [...notes, 'Start a new agent session (or reload skills/instructions) so the host discovers these files.'], ...(recovered ?? {}) });
}

export function detachIntegration({ agents, project: projectPath, cwd, dryRun = false } = {}) {
  const hosts = parseHosts(agents);
  const project = resolveProject({ project: projectPath, cwd }), root = project.root;
  const recovered = dryRun ? null : recoverInterrupted(root);
  const loaded = loadReceipt(root);
  if (loaded.status === 'invalid') return summarize(root, project, [], { ok: false, status: 'conflict', conflicts: [conflict('invalid-receipt', RECEIPT, loaded.message)] });
  const receipt = structuredClone(loaded.receipt), pending = new Map(), preserved = [];
  const block = instructionBlock();
  for (const name of hosts) {
    const entry = receipt.hosts[name];
    const instructionPath = entry?.instructions?.path ?? instructionTarget(root, name).relative;
    const target = projectFile(root, instructionPath);
    const physicalOf = value => value?.path && projectFile(root, value.path).physical;
    const sameFile = value => value && (physicalOf(value) === target.physical || value.via && target.physical === projectFile(root, value.via.replace(/^@/, '')).physical);
    const sharedWithOther = Object.entries(receipt.hosts).some(([other, value]) => other !== name && !hosts.includes(other) && sameFile(value.instructions));
    if (!entry?.instructions?.via && !sharedWithOther && !target.error) {
      const current = target.physical && (pending.get(target.physical)?.after ?? readText(target.physical).text);
      const found = typeof current === 'string' ? findBlock(current) : null;
      if (found === 'ambiguous-markers') preserved.push(conflict('ambiguous-markers', instructionPath, 'Unbalanced waxwing markers were left unchanged.'));
      else if (found) {
        if (normalize(found.text) === block || entry?.instructions?.blockSha256 === sha256(normalize(found.text))) {
          // Hosts sharing one physical file share the separator written with its block.
          const separator = Object.values(loaded.receipt.hosts).filter(value => sameFile(value.instructions)).map(value => value.instructions.separator ?? '').sort((a, b) => b.length - a.length)[0] ?? '';
          let before = current.slice(0, found.start), afterBlock = current.slice(found.end);
          const eol = eolOf(current);
          if (afterBlock === eol || afterBlock === '') { afterBlock = ''; if (separator && before.endsWith(separator)) before = before.slice(0, -separator.length); }
          const after = before + afterBlock;
          pending.set(target.physical, { relative: instructionPath, physical: target.physical, before: current, after: !after && entry?.instructions?.created ? null : after });
        } else preserved.push({ code: 'edited-block', path: instructionPath, message: 'The Waxwing block was edited and was left in place.', residual: found.text });
      }
    }
    const directory = HOSTS[name].skillDirectory;
    for (const [relative, content] of portableSkillFiles()) {
      const file = path.join(root, directory, relative), read = readText(file);
      if (!read.exists) continue;
      if (read.text === content || entry?.skill?.files?.[relative] === sha256(read.text ?? '')) pending.set(file, { relative: `${directory}/${relative}`, physical: file, before: read.text, after: null, pruneUpTo: directory.split('/')[0] });
      else preserved.push({ code: 'edited-skill-file', path: `${directory}/${relative}`, message: 'Edited skill file was left in place.' });
    }
    delete receipt.hosts[name];
  }
  const changes = [...pending.values()].filter(change => change.before !== change.after);
  const receiptWrite = receiptChange(root, receipt);
  if (receiptWrite) changes.push(receiptWrite);
  if (dryRun) return summarize(root, project, changes, { ok: true, status: 'dry-run', hosts, preserved, diff: changes.map(diffText).join('\n') });
  if (changes.length) apply(root, changes);
  return summarize(root, project, changes, { ok: true, status: changes.length ? 'detached' : 'unchanged', hosts, preserved,
    notes: ['Project knowledge (models, snapshots, sites, Graphify output, .waxwing/config.json) was not modified.'], ...(recovered ?? {}) });
}
