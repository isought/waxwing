import fs from 'node:fs';
import path from 'node:path';
import { resolveProject } from '../../application/project.mjs';
import { discoverKnowledge } from '../../application/discover.mjs';
import { CONTEXT_PROTOCOL } from '../../knowledge/context/protocol.mjs';
import { HOSTS, JOURNAL, TEMPLATE_VERSION, installCommand, instructionBlock, packageInfo, packageRoot, portableSkillFiles, sha256 } from './templates.mjs';
import { findBlock, loadReceipt } from './lifecycle.mjs';

export const CAPABILITIES = ['init', 'doctor', 'detach', 'discover', 'context', 'read', 'guide', 'review-update', 'query', 'scan', 'scan-query', 'workspace'];
const normalize = text => text.replace(/\r\n/g, '\n');
const read = file => { try { return fs.lstatSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null; } catch { return null; } };

function runtimeOwner(executable) {
  let real;
  try { real = fs.realpathSync(executable); } catch { return { path: executable, status: 'broken-link' }; }
  // npm links bin/waxwing.mjs; walk up to the owning package manifest.
  for (let dir = path.dirname(real); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = read(path.join(dir, 'package.json'));
    if (!manifest) continue;
    try {
      const pkg = JSON.parse(manifest);
      if (pkg.name === packageInfo.name) return { path: executable, packageRoot: dir, version: pkg.version, isThisRuntime: fs.realpathSync(dir) === packageRoot };
    } catch { /* Keep walking. */ }
    break;
  }
  return { path: executable, target: real, status: 'not-waxwing-package' };
}

export function runtimeReport(env = process.env) {
  const names = process.platform === 'win32' ? ['waxwing.cmd', 'waxwing.exe', 'waxwing'] : ['waxwing'];
  const seen = new Set(), onPath = [];
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      try { fs.accessSync(file, fs.constants.X_OK); } catch { continue; }
      if (seen.has(file)) continue;
      seen.add(file); onPath.push(runtimeOwner(file));
    }
  }
  const first = onPath[0];
  const distinct = new Set(onPath.map(entry => entry.packageRoot ?? entry.target ?? entry.path));
  const [major, minor] = process.versions.node.split('.').map(Number);
  return {
    node: { version: process.versions.node, required: packageInfo.engines?.node ?? null, supported: major > 20 || major === 20 && minor >= 19 },
    current: { package: packageInfo.name, version: packageInfo.version, packageRoot, protocolVersion: CONTEXT_PROTOCOL, templateVersion: TEMPLATE_VERSION, capabilities: CAPABILITIES },
    onPath,
    pathResolvesTo: first ? (first.isThisRuntime ? 'this-runtime' : first.packageRoot ? 'other-waxwing-runtime' : 'non-waxwing-command') : 'missing',
    pathAmbiguous: distinct.size > 1,
  };
}

function hostReport(root, name, receiptHost) {
  const host = HOSTS[name], block = instructionBlock();
  const candidates = host.instructionCandidates.filter(candidate => fs.lstatSync(path.join(root, candidate), { throwIfNoEntry: false }));
  const report = { title: host.title, uptake: 'untested', instructions: {}, skill: {} };
  const withBlock = candidates.map(candidate => ({ candidate, text: read(path.join(root, candidate)) })).map(entry => ({ ...entry, block: entry.text === null ? null : findBlock(entry.text) }));
  const blockEntry = withBlock.find(entry => entry.block);
  if (name === 'claude' && !blockEntry && withBlock.some(entry => /^@AGENTS\.md[ \t]*$/m.test(entry.text ?? ''))) {
    const agents = read(path.join(root, 'AGENTS.md')), found = agents && findBlock(agents);
    report.instructions = found && typeof found === 'object' ? { state: 'installed', path: 'AGENTS.md', via: '@AGENTS.md import' } : { state: 'not-installed' };
  } else if (!blockEntry) report.instructions = { state: 'not-installed', ...(candidates.length ? { candidates } : {}) };
  else if (blockEntry.block === 'ambiguous-markers') report.instructions = { state: 'conflict', path: blockEntry.candidate, detail: 'Unbalanced or repeated waxwing markers.' };
  else {
    const current = normalize(blockEntry.block.text) === block;
    const managedOld = !current && receiptHost?.instructions?.blockSha256 === sha256(normalize(blockEntry.block.text));
    report.instructions = { state: current ? 'installed' : managedOld ? 'stale-template' : 'modified', path: blockEntry.candidate };
    if (host.activeFirstExisting && candidates[0] !== blockEntry.candidate) Object.assign(report.instructions, { state: 'shadowed', detail: `${candidates[0]} is active at this scope, so ${blockEntry.candidate} is not read by the host.` });
    else if (host.maxInstructionBytes && Buffer.byteLength(blockEntry.text) > host.maxInstructionBytes) Object.assign(report.instructions, { state: 'potentially-shadowed', detail: `File exceeds ${host.maxInstructionBytes} bytes; the host may truncate the block.` });
  }
  const files = portableSkillFiles(), directory = path.join(root, host.skillDirectory);
  if (fs.existsSync(path.join(directory, 'waxwing-skill.json'))) report.skill = { state: 'package-bound', directory: host.skillDirectory, detail: 'Explicit `waxwing skill install` binding; not managed by init.' };
  else {
    const states = [...files].map(([relative, content]) => { const text = read(path.join(directory, relative)); return text === null ? 'missing' : text === content ? 'current' : receiptHost?.skill?.files?.[relative] === sha256(text) ? 'stale' : 'modified'; });
    report.skill = { directory: host.skillDirectory, state: states.every(s => s === 'missing') ? 'not-installed' : states.every(s => s === 'current') ? 'installed' : states.includes('modified') ? 'modified' : states.includes('missing') ? 'incomplete' : 'stale-template' };
  }
  return report;
}

export function doctorReport({ project: projectPath, cwd, env = process.env } = {}) {
  const started = Date.now();
  const project = resolveProject({ project: projectPath, cwd }), root = project.root;
  const runtime = runtimeReport(env);
  const loaded = loadReceipt(root);
  const hosts = Object.fromEntries(Object.keys(HOSTS).map(name => [name, hostReport(root, name, loaded.receipt?.hosts?.[name])]));
  const configured = Object.entries(hosts).filter(([, h]) => h.instructions.state !== 'not-installed' || h.skill.state !== 'not-installed').map(([name]) => name);
  let knowledge;
  try {
    const discovery = discoverKnowledge({ projectInfo: project });
    const count = predicate => discovery.sources.filter(predicate).length;
    knowledge = { status: discovery.status, available: count(s => s.status === 'available' && ['waxwing-model', 'waxwing-source-snapshot'].includes(s.format)),
      unsupported: count(s => s.status === 'unsupported'), invalid: count(s => s.status === 'invalid'), config: discovery.searched.config, discoveryMs: discovery.measurement.discoveryMs };
  } catch (error) { knowledge = { status: 'runtime_error', message: error.message }; }
  const problems = [], repairs = [];
  if (!runtime.node.supported) problems.push(`Node ${runtime.node.version} does not meet ${runtime.node.required}.`);
  if (runtime.pathResolvesTo === 'missing') { problems.push('No `waxwing` command is on PATH; generated instructions cannot run.'); repairs.push(installCommand()); }
  else if (runtime.pathResolvesTo === 'non-waxwing-command') problems.push('The first `waxwing` on PATH is not this package.');
  else if (runtime.pathResolvesTo === 'other-waxwing-runtime') problems.push(`The first \`waxwing\` on PATH is ${runtime.onPath[0].version} at ${runtime.onPath[0].packageRoot}, not this runtime.`);
  if (runtime.pathAmbiguous) problems.push('Several different `waxwing` commands are on PATH; the first one wins.');
  if (loaded.status === 'invalid') problems.push(`.waxwing/integration.json is invalid: ${loaded.message}`);
  if (loaded.status === 'loaded' && loaded.receipt.protocolVersion && loaded.receipt.protocolVersion !== CONTEXT_PROTOCOL) problems.push(`Project integration expects protocol ${loaded.receipt.protocolVersion}; this runtime provides ${CONTEXT_PROTOCOL}.`);
  if (fs.existsSync(path.join(root, JOURNAL))) { problems.push('An interrupted init/detach left a transaction journal.'); repairs.push('Run the same waxwing init or detach command again to roll it back first.'); }
  for (const name of configured) {
    const host = hosts[name];
    if (host.instructions.state !== 'installed' || host.skill.state !== 'installed') {
      problems.push(`${host.title}: instructions ${host.instructions.state}, skill ${host.skill.state}.`);
      if (['stale-template', 'not-installed', 'incomplete'].some(state => [host.instructions.state, host.skill.state].includes(state))) repairs.push(`waxwing init --agent ${name}`);
    }
  }
  const status = !configured.length ? 'not-configured' : problems.length ? 'attention' : 'ready';
  return {
    status, project, runtime,
    integration: { receipt: loaded.status, ...(loaded.receipt?.writtenBy ? { writtenBy: loaded.receipt.writtenBy } : {}), configuredHosts: configured, hosts },
    knowledge, problems, repairs: [...new Set(repairs)],
    notes: ['Files on disk show installation, not that a model session loaded or followed them; host uptake is untested by doctor.', 'Start a new agent session after init or detach.'],
    measurement: { doctorMs: Date.now() - started },
  };
}
