import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PROJECT_CONFIG_VERSION = '0.1-project-config';
export const PROJECT_CONFIG = '.waxwing/config.json';

export const contains = (root, target) => { const rel = path.relative(root, target); return !rel || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
export const displayPath = (root, target) => contains(root, target) ? path.relative(root, target).split(path.sep).join('/') || '.' : target;

// Resolve the physical path of a possibly nonexistent file through its nearest existing ancestor.
export function physicalPath(filename) {
  const absolute = path.resolve(filename);
  if (fs.lstatSync(absolute, { throwIfNoEntry: false })) return fs.realpathSync(absolute);
  const parent = path.dirname(absolute);
  if (parent === absolute) return absolute;
  return path.join(physicalPath(parent), path.basename(absolute));
}

export function git(root, args, { timeout = 5000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  // Read-only Git calls must not invoke a repository-configured filesystem monitor.
  return spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout, maxBuffer });
}

// Explicit project, otherwise the enclosing Git worktree (directory or file-based .git), otherwise cwd.
export function resolveProject({ project, cwd = process.cwd() } = {}) {
  if (project !== undefined) {
    if (typeof project !== 'string' || !project.trim()) throw new Error('--project requires a directory.');
    let root;
    try { root = fs.realpathSync(path.resolve(cwd, project)); } catch { throw new Error(`Project directory not found: ${path.resolve(cwd, project)}`); }
    if (!fs.statSync(root).isDirectory()) throw new Error(`Project must be a directory: ${root}`);
    return { root, basis: 'explicit' };
  }
  const start = fs.realpathSync(cwd);
  for (let current = start; ; current = path.dirname(current)) {
    const marker = fs.lstatSync(path.join(current, '.git'), { throwIfNoEntry: false });
    if (marker && (marker.isDirectory() || marker.isFile())) return { root: current, basis: 'git-worktree' };
    if (path.dirname(current) === current) break;
  }
  return { root: start, basis: 'working-directory' };
}

export function gitHead(root) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD'], { timeout: 3000, maxBuffer: 1024 * 1024 });
  return head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
}

export function loadProjectConfig(root) {
  const filename = path.join(root, PROJECT_CONFIG);
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat) return { status: 'absent', path: PROJECT_CONFIG };
  const invalid = message => ({ status: 'invalid', path: PROJECT_CONFIG, message });
  if (!stat.isFile()) return invalid('Project configuration must be a regular file.');
  if (stat.size > 65536) return invalid('Project configuration exceeds 64 KiB.');
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (error) { return invalid(`Invalid JSON: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return invalid('Expected an object.');
  if (config.schemaVersion !== PROJECT_CONFIG_VERSION) return invalid(`schemaVersion must be "${PROJECT_CONFIG_VERSION}".`);
  const unknown = Object.keys(config).filter(key => !['schemaVersion', 'workspace', 'artifacts', 'sourceRoots'].includes(key));
  if (unknown.length) return invalid(`Unknown field(s): ${unknown.join(', ')}.`);
  const text = value => typeof value === 'string' && value.trim() && !value.includes('\0');
  if (config.workspace !== undefined && !text(config.workspace)) return invalid('workspace must be a path.');
  if (config.artifacts !== undefined && (!Array.isArray(config.artifacts) || config.artifacts.length > 200 || !config.artifacts.every(text))) return invalid('artifacts must be an array of at most 200 paths.');
  if (config.sourceRoots !== undefined && (!config.sourceRoots || typeof config.sourceRoots !== 'object' || Array.isArray(config.sourceRoots) || !Object.entries(config.sourceRoots).every(([id, location]) => text(id) && text(location)))) return invalid('sourceRoots must map snapshot source IDs to directories.');
  const resolve = location => path.resolve(root, location);
  return { status: 'loaded', path: PROJECT_CONFIG,
    ...(config.workspace ? { workspace: resolve(config.workspace) } : {}),
    artifacts: (config.artifacts ?? []).map(resolve),
    sourceRoots: Object.fromEntries(Object.entries(config.sourceRoots ?? {}).map(([id, location]) => [id, resolve(location)])) };
}
