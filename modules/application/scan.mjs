import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { analyzeSources } from '../analysis/index.mjs';
import { sourceLanguage, supportedSourceLanguages } from '../analysis/languages.mjs';
import { sourceFileId, sourceSnapshotId, validSourcePath, validateSourceSnapshot } from '../knowledge/source/model.mjs';
import { fail } from '../knowledge/shared/model.mjs';

const excludedDirectories = ['.git', '.internal', '.waxwing', 'node_modules', 'vendor', 'dist', 'build', 'generated'];
const defaults = { maxFiles: 10000, maxFileBytes: 1048576, maxTotalBytes: 33554432 };
const contains = (root, target) => { const rel = path.relative(root, target); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
function git(root, args) {
  // Git discovery must not invoke a repository-configured filesystem monitor.
  return spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
}
function discover(root, limit) {
  const check = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (check.status === 0 && check.stdout.trim() === 'true') {
    const listed = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (listed.status !== 0) throw new Error('Git file discovery failed or exceeded its time/output limit.');
    const all = [...new Set(listed.stdout.split('\0').filter(Boolean))].filter(name => !name.split('/').slice(0, -1).some(part => excludedDirectories.includes(part))).sort();
    const head = git(root, ['rev-parse', '--verify', 'HEAD']);
    return { names: all.slice(0, limit), complete: all.length <= limit, mode: 'git-working-tree', ...(head.status === 0 ? { gitHead: head.stdout.trim() } : {}), diagnostics: [] };
  }
  if (check.error && check.error.code !== 'ENOENT') throw new Error('Git discovery failed; source enumeration was not completed.');
  if (!check.error && check.status !== 0 && !check.stderr.includes('not a git repository')) throw new Error('Git discovery failed; fix the repository configuration before scanning.');
  const names = [], directories = [''], diagnostics = []; let complete = true;
  while (directories.length && names.length <= limit) {
    const relative = directories.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
    catch (error) { complete = false; diagnostics.push({ code: 'scan/discovery', message: `Cannot enumerate ${JSON.stringify(relative || '.')}: ${error.code ?? 'read-error'}.` }); continue; }
    for (const entry of entries) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { if (!excludedDirectories.includes(entry.name)) directories.push(name); }
      else names.push(name);
      if (names.length > limit) { complete = false; break; }
    }
  }
  return { names: names.slice(0, limit).sort(), complete: complete && !directories.length, mode: 'filesystem', diagnostics };
}
function readBounded(file, limit) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('not-regular-file');
    const chunks = []; let size = 0;
    while (size <= limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - size));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      chunks.push(chunk.subarray(0, count)); size += count;
    }
    if (size > limit) return null;
    return Buffer.concat(chunks, size);
  } finally { fs.closeSync(fd); }
}

export async function scanRepository(directory, options = {}) {
  if (Object.keys(options).some(key => !['sourceId', ...Object.keys(defaults)].includes(key))) throw new Error('Unknown scan option.');
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error('scan requires a source directory.');
  const sourceId = options.sourceId ?? path.basename(root);
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('sourceId must be nonempty.');
  const limits = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, options[key] ?? fallback]));
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > (key === 'maxFiles' ? 100000 : 536870912)) throw new Error(`Invalid scan limit ${key}.`);
  const discovery = discover(root, limits.maxFiles), sources = [], skipped = [], diagnostics = [...discovery.diagnostics];
  let totalBytes = 0;
  for (const relative of discovery.names) {
    if (!validSourcePath(relative)) {
      discovery.complete = false;
      diagnostics.push({ code: 'scan/path', message: `Unsupported source path ${JSON.stringify(relative)}; omitted from the snapshot.` }); continue;
    }
    const file = { id: sourceFileId(sourceId, relative), path: relative, language: sourceLanguage(relative), status: 'skipped' };
    const skip = reason => { skipped.push({ ...file, reason }); };
    try {
      let current = root, symlink = false;
      for (const part of relative.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) { symlink = true; break; } }
      if (symlink) { skip('symlink'); continue; }
      const absolute = path.join(root, relative), stat = fs.statSync(absolute);
      if (!stat.isFile()) { skip('not-regular-file'); continue; }
      if (!supportedSourceLanguages.includes(file.language)) { skip('unsupported-language'); continue; }
      if (stat.size > limits.maxFileBytes) { skip('max-file-bytes'); continue; }
      if (stat.size > limits.maxTotalBytes - totalBytes) { skip('max-total-bytes'); continue; }
      const limit = Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes);
      const bytes = readBounded(absolute, limit);
      if (!bytes) { skip(limit === limits.maxFileBytes ? 'max-file-bytes' : 'max-total-bytes'); continue; }
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { skip('invalid-utf8'); continue; }
      if (content.includes('\0')) { skip('binary-content'); continue; }
      sources.push({ path: relative, content }); totalBytes += bytes.length;
    } catch (error) { skip(`unavailable:${error.code ?? 'read-error'}`); }
  }
  const snapshot = await analyzeSources(sources, { sourceId });
  snapshot.files.push(...skipped);
  snapshot.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  snapshot.diagnostics.push(...diagnostics);
  if (!discovery.complete) snapshot.diagnostics.push({ code: 'scan/incomplete-discovery', message: 'Discovery stopped at a limit or encountered inaccessible/unsupported paths; unlisted files remain unknown.' });
  if (discovery.gitHead) snapshot.source.gitHead = discovery.gitHead;
  snapshot.coverage = { discovery: discovery.mode, discoveryComplete: discovery.complete, excludedDirectories: [...excludedDirectories], limits };
  snapshot.limitations.push('Files are sampled from the working tree, including uncommitted changes; gitHead is context, not proof that bytes equal that commit. This is not an atomic repository snapshot. Git ignore rules apply only to Git discovery. Excluded directories are outside the scan scope.');
  snapshot.id = sourceSnapshotId(snapshot);
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.ok) fail('Invalid repository scan.', validation.diagnostics);
  return snapshot;
}

function physical(filename) {
  const absolute = path.resolve(filename);
  if (fs.lstatSync(absolute, { throwIfNoEntry: false })) return fs.realpathSync(absolute);
  return path.join(physical(path.dirname(absolute)), path.basename(absolute));
}
export async function scanRepositoryToFile(directory, output, options) {
  const root = fs.realpathSync(directory), target = path.resolve(output);
  if (contains(root, physical(target))) throw new Error('Scan output must be outside the source directory.');
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Scan output must not be a symlink.');
  const snapshot = await scanRepository(root, options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.waxwing-scan-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2) + '\n'); fs.renameSync(temp, target); }
  finally { fs.rmSync(temp, { force: true }); }
  return { output: target, snapshotId: snapshot.id, ...validateSourceSnapshot(snapshot), coverage: snapshot.coverage };
}

export function loadSourceSnapshot(filename) {
  const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const result = validateSourceSnapshot(snapshot);
  if (!result.ok) fail('Invalid source snapshot.', result.diagnostics);
  return snapshot;
}

export async function renderSourceFile(input, output) {
  const target = path.resolve(output);
  if (path.extname(target).toLowerCase() !== '.html') throw new Error('Source view output must be .html.');
  if (physical(target) === fs.realpathSync(input)) throw new Error('Source view must not overwrite its snapshot input.');
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Source view output must not be a symlink.');
  const snapshot = loadSourceSnapshot(input);
  const { renderSourceHTML } = await import('../presentation/source/index.mjs');
  const content = renderSourceHTML(snapshot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.waxwing-view-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, content); fs.renameSync(temp, target); }
  finally { fs.rmSync(temp, { force: true }); }
  return { output: target, snapshotId: snapshot.id };
}
