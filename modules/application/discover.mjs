import fs from 'node:fs';
import path from 'node:path';
import { loadModel } from './load-model.mjs';
import { loadWorkspace } from './workspace.mjs';
import { validateSourceSnapshot } from '../knowledge/source/model.mjs';
import { digest, canonical } from '../knowledge/shared/model.mjs';
import { contains, displayPath, git, gitHead, loadProjectConfig, resolveProject } from './project.mjs';

export const DISCOVERY_LIMITS = { maxListedFiles: 200000, maxCandidates: 2000, maxSniffBytes: 4096, maxModelBytes: 16 * 1024 * 1024, maxSnapshotBytes: 64 * 1024 * 1024, maxDepth: 12, timeBudgetMs: 5000 };
const skippedDirectories = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.venv', 'venv', '__pycache__', 'target', '.next', '.cache', 'coverage']);
const modelVersions = new Set(['0.2-draft', '0.3-draft', '0.4-draft', '0.5-draft', '0.1-sequence-draft', '0.2-sequence-draft']);
const recognized = {
  '0.1-workspace-draft': 'waxwing-workspace', '0.1-source-draft': 'waxwing-source-snapshot', '0.1-site-draft': 'waxwing-site', '0.1-collection-draft': 'waxwing-collection',
  ...Object.fromEntries([...modelVersions].map(version => [version, 'waxwing-model'])),
};
const graphifyDefault = 'graphify-out/graph.json';

function sniff(filename, limit) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(limit), count = fs.readSync(fd, buffer, 0, limit, 0);
    return buffer.subarray(0, count).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function listConventional(root, limits, deadline) {
  const check = git(root, ['rev-parse', '--show-toplevel']);
  const top = check.status === 0 ? check.stdout.trim() : null;
  if (top && fs.realpathSync(top) === root) {
    const listed = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.json']);
    if (listed.status === 0) {
      const names = listed.stdout.split('\0').filter(Boolean);
      const kept = names.filter(name => !name.split('/').slice(0, -1).some(part => skippedDirectories.has(part)));
      return { mode: 'git-working-tree', complete: kept.length <= limits.maxCandidates, files: kept.slice(0, limits.maxCandidates), respectsIgnore: true };
    }
  }
  // Without a Git root (or for a nested project scope), walk a bounded tree.
  const files = [], stack = [['', 0]];
  let complete = true, visited = 0;
  while (stack.length) {
    if (Date.now() > deadline || visited > limits.maxListedFiles) { complete = false; break; }
    const [relative, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch { complete = false; continue; }
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      visited++;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skippedDirectories.has(entry.name)) continue;
        if (relative && fs.existsSync(path.join(root, name, '.git'))) continue; // Another repository.
        if (depth + 1 > limits.maxDepth) { complete = false; continue; }
        stack.push([name, depth + 1]);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(name);
        if (files.length >= limits.maxCandidates) { complete = false; break; }
      }
    }
    if (files.length >= limits.maxCandidates) break;
  }
  return { mode: top ? 'filesystem-nested-scope' : 'filesystem', complete, files: files.sort(), respectsIgnore: false };
}

function readJSON(filename, maxBytes) {
  const stat = fs.statSync(filename);
  if (stat.size > maxBytes) throw Object.assign(new Error(`File exceeds the ${maxBytes}-byte discovery limit.`), { code: 'too-large' });
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(filename)));
}

// Discovery identifies readable knowledge artifacts; it does not establish relevance or authority.
export function discoverKnowledge(options = {}) {
  const started = Date.now();
  const limits = { ...DISCOVERY_LIMITS, ...(options.limits ?? {}) };
  const deadline = started + limits.timeBudgetMs;
  const project = options.projectInfo ?? resolveProject({ project: options.project, cwd: options.cwd });
  const { root } = project;
  const config = loadProjectConfig(root);
  const diagnostics = [], candidates = new Map(), loaded = new Map();
  if (config.status === 'invalid') diagnostics.push({ severity: 'error', code: 'discover/config', path: config.path, message: config.message });

  // Registration order matters for reporting only; one physical file yields one source.
  const register = (filename, basis) => {
    let physical;
    try { physical = fs.realpathSync(filename); } catch { physical = path.resolve(filename); }
    const existing = candidates.get(physical);
    if (existing) { if (!existing.registrations.includes(basis)) existing.registrations.push(basis); return existing; }
    const candidate = { physical, requested: path.resolve(filename), registrations: [basis] };
    candidates.set(physical, candidate);
    return candidate;
  };

  const workspaceFiles = [];
  if (options.workspace !== undefined) workspaceFiles.push([path.resolve(options.cwd ?? process.cwd(), options.workspace), 'command-line --workspace']);
  if (config.workspace) workspaceFiles.push([config.workspace, `${config.path} workspace`]);
  for (const artifact of config.artifacts ?? []) register(artifact, `${config.path} artifacts`);
  for (const [filename, basis] of workspaceFiles) register(filename, basis).expected = 'waxwing-workspace';

  const graphify = path.join(root, graphifyDefault);
  if (fs.existsSync(graphify)) register(graphify, `conventional ${graphifyDefault}`);

  const listing = listConventional(root, limits, deadline);
  for (const name of listing.files) {
    if (Date.now() > deadline) { listing.complete = false; break; }
    const filename = path.join(root, name);
    let head;
    try {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile()) continue;
      head = sniff(filename, limits.maxSniffBytes);
    } catch { continue; }
    const version = head.match(/"schemaVersion"\s*:\s*"([^"]{1,80})"/)?.[1];
    if (version && recognized[version]) register(filename, `conventional file with schemaVersion ${version}`);
  }

  const sources = [], sites = [], workspaceModels = [];
  const location = filename => displayPath(root, filename);
  const inspect = candidate => {
    const { physical } = candidate;
    const base = { location: location(candidate.requested), registrations: candidate.registrations };
    if (candidate.physical !== candidate.requested && !contains(root, physical) && candidate.registrations.every(r => r.startsWith('conventional'))) {
      return { ...base, format: 'unknown', status: 'skipped', message: 'Symlink leads outside the project; register it explicitly to include it.' };
    }
    let head;
    try { head = sniff(physical, limits.maxSniffBytes); } catch (error) {
      return { ...base, format: candidate.expected ?? 'unknown', status: 'unavailable', message: error.code ?? error.message };
    }
    if (physical.endsWith(`${path.sep}graph.json`) && !/"schemaVersion"/.test(head) && /"nodes"\s*:/.test(head)) {
      return { ...base, format: 'graphify', status: 'unsupported', message: 'Graphify node-link graphs are recognized but not yet readable by this Waxwing version.' };
    }
    const version = head.match(/"schemaVersion"\s*:\s*"([^"]{1,80})"/)?.[1];
    const format = recognized[version] ?? candidate.expected ?? 'unknown';
    try {
      if (format === 'waxwing-model') {
        // Layout JSON 2 shares early version strings; it embeds a model rather than being one.
        const parsed = readJSON(physical, limits.maxModelBytes);
        if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'modelDigest') && Object.hasOwn(parsed, 'model')) {
          return { ...base, format: 'waxwing-layout', status: 'not-indexed', message: 'Layout JSON embeds a model for rendering; its source model or site is indexed instead.', indexed: false };
        }
        const { model } = loadModel(physical);
        const revision = digest(model);
        return { ...base, format, status: 'available', id: model.id, title: model.title, diagramType: model.diagramType ?? 'architecture', revision,
          freshness: { artifact: 'validated', semantic: 'unknown' }, load: { model } };
      }
      if (format === 'waxwing-source-snapshot') {
        const snapshot = readJSON(physical, limits.maxSnapshotBytes), result = validateSourceSnapshot(snapshot);
        if (!result.ok) return { ...base, format, status: 'invalid', message: 'Invalid source snapshot.', diagnostics: result.diagnostics.slice(0, 5) };
        return { ...base, format, status: 'available', id: snapshot.source.id, title: `Source snapshot ${snapshot.source.id}`, revision: snapshot.id, summary: result.summary,
          ...(snapshot.source.gitHead ? { gitHead: snapshot.source.gitHead } : {}), freshness: { artifact: 'validated', sourceBytes: 'checked-on-read', semantic: 'unknown' }, load: { snapshot } };
      }
      if (format === 'waxwing-workspace') {
        const report = loadWorkspace(physical);
        for (const model of report.models) if (model.kind === 'local') workspaceModels.push([model.resolvedPath, `workspace ${report.workspace.id} model ${model.id}`]);
        return { ...base, format, status: report.ok ? 'available' : 'invalid', id: report.workspace.id, title: report.workspace.title, revision: report.workspace.revision,
          summary: { models: report.models.length, sources: report.sources.length, referencesComplete: report.referencesComplete }, indexed: false,
          ...(report.diagnostics.length ? { diagnostics: report.diagnostics.slice(0, 5) } : {}) };
      }
      if (format === 'waxwing-site') {
        const manifest = readJSON(physical, limits.maxModelBytes), directory = path.dirname(physical);
        sites.push({ directory, manifest });
        register(path.join(directory, 'source/model.json'), `site ${location(directory)} source model`);
        if (fs.existsSync(path.join(directory, 'source/snapshot.json'))) register(path.join(directory, 'source/snapshot.json'), `site ${location(directory)} source snapshot`);
        return null;
      }
      if (format === 'waxwing-collection') return { ...base, format, status: 'not-indexed', message: 'Collections are listed, not indexed; register their models or sites to include them.', indexed: false };
      return { ...base, format: 'unknown', status: 'unsupported', message: 'Not a recognized knowledge artifact.' };
    } catch (error) {
      const unavailable = ['ENOENT', 'EACCES', 'EPERM'].includes(error.code);
      return { ...base, format, status: unavailable ? 'unavailable' : error.code === 'too-large' ? 'skipped' : 'invalid', message: error.message, ...(error.diagnostics?.length ? { diagnostics: error.diagnostics.slice(0, 5) } : {}) };
    }
  };

  const done = new Set();
  let timedOut = false;
  // Inspecting workspaces and sites registers more candidates, so iterate until stable.
  for (let pending = [...candidates.values()]; pending.length; pending = [...candidates.values()].filter(c => !done.has(c.physical))) {
    for (const candidate of pending) {
      done.add(candidate.physical);
      if (Date.now() > deadline) { timedOut = true; sources.push({ location: location(candidate.requested), registrations: candidate.registrations, format: 'unknown', status: 'skipped', message: 'Discovery time budget exhausted before inspection.' }); continue; }
      const result = inspect(candidate);
      if (result) sources.push(result);
    }
    for (const [filename, basis] of workspaceModels.splice(0)) register(filename, basis);
  }

  // Keys are stable locations; IDs are recorded identities that may repeat across files.
  const head = gitHead(root);
  for (const source of sources.sort((a, b) => a.location < b.location ? -1 : a.location > b.location ? 1 : 0)) {
    source.key = source.location;
    if (source.load) { loaded.set(source.key, { ...source.load, filename: path.resolve(root, source.location) }); delete source.load; }
    if (source.format === 'waxwing-source-snapshot' && source.status === 'available') source.freshness.gitHead = !source.gitHead || !head ? 'unknown' : source.gitHead === head ? 'matches-current-head' : 'differs-from-current-head';
    if (source.format === 'waxwing-model' && source.status === 'available') {
      const model = loaded.get(source.key).model;
      const views = sites.filter(site => site.manifest.modelDigest === source.revision && fs.existsSync(path.join(site.directory, 'source/model.json'))
        && (() => { try { return canonical(JSON.parse(fs.readFileSync(path.join(site.directory, 'source/model.json'), 'utf8'))) === canonical(model); } catch { return false; } })());
      if (views.length) {
        source.views = views.map(site => ({ site: location(site.directory), index: location(path.join(site.directory, 'index.html')) }));
        loaded.get(source.key).sites = views.map(site => site.directory);
      }
    }
  }
  // Byte-identical meaning in several files (for example a site's source copy) is one source.
  const firstByRevision = new Map();
  for (const source of sources) {
    if (source.status !== 'available' || !source.revision || source.format === 'waxwing-workspace') continue;
    const first = firstByRevision.get(`${source.format}:${source.revision}`);
    if (!first) { firstByRevision.set(`${source.format}:${source.revision}`, source); continue; }
    const preferred = source.registrations.some(r => !r.startsWith('conventional') && !r.startsWith('site ')) && first.registrations.every(r => r.startsWith('conventional') || r.startsWith('site ')) ? source : first;
    const other = preferred === source ? first : source;
    firstByRevision.set(`${source.format}:${source.revision}`, preferred);
    preferred.copies = [...(preferred.copies ?? []), other.key, ...(other.copies ?? [])];
    preferred.views = [...(preferred.views ?? []), ...(other.views ?? [])].filter((view, i, all) => all.findIndex(v => v.site === view.site) === i);
    const extra = loaded.get(other.key);
    if (extra?.sites) loaded.get(preferred.key).sites = [...new Set([...(loaded.get(preferred.key).sites ?? []), ...extra.sites])];
    Object.assign(other, { status: 'duplicate', duplicateOf: preferred.key });
    delete other.views; delete other.copies; loaded.delete(other.key);
  }
  const available = sources.filter(s => s.status === 'available' && ['waxwing-model', 'waxwing-source-snapshot'].includes(s.format));
  const status = available.length ? 'sources_found' : sources.some(s => s.status === 'unsupported' && s.format !== 'unknown') ? 'unsupported_input' : 'no_context';
  return {
    status,
    project,
    searched: {
      config: { path: config.path, status: config.status },
      explicitWorkspace: options.workspace !== undefined ? location(path.resolve(options.cwd ?? process.cwd(), options.workspace)) : null,
      conventional: { mode: listing.mode, jsonFiles: listing.files.length, complete: listing.complete && !timedOut, respectsIgnore: listing.respectsIgnore,
        skippedDirectories: [...skippedDirectories], alsoChecked: [graphifyDefault] },
    },
    sources: sources.filter(s => !(s.format === 'unknown' && s.status === 'unsupported' && s.registrations.every(r => r.startsWith('conventional')))),
    diagnostics,
    loaded,
    sourceRoots: config.sourceRoots ?? {},
    measurement: { discoveryMs: Date.now() - started, candidates: candidates.size, available: available.length },
  };
}
