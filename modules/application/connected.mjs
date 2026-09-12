import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadModel } from './load-model.mjs';
import { loadSourceSnapshot } from './scan.mjs';
import { validateSourceSnapshot } from '../knowledge/source/model.mjs';
import { fail } from '../knowledge/shared/model.mjs';

// Source bytes are optional evidence, pinned to the scan rather than to Git HEAD.
// An unavailable file removes only its excerpt, not the independently useful graph.
export function captureSourceTexts(snapshot, directory) {
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.ok) fail('Invalid source snapshot.', validation.diagnostics);
  const sourceTexts = {}, diagnostics = [], inputFiles = [];
  let root;
  try {
    root = fs.realpathSync(directory);
    if (!fs.statSync(root).isDirectory()) throw new Error('not-directory');
  } catch (error) {
    return {sourceTexts,diagnostics:[{code:'source-text/root-unavailable',message:`Source excerpts unavailable: source root ${error.code ?? error.message}. The recorded scan remains usable.`}],inputFiles:snapshot.files.filter(f=>f.status==='analyzed').map(f=>path.resolve(directory,f.path))};
  }
  for (const file of snapshot.files.filter(f => f.status === 'analyzed')) {
    const filename = path.join(root, file.path);
    // Include even missing input paths in overwrite protection.
    inputFiles.push(filename);
    try {
      let current = root;
      for (const part of file.path.split('/')) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink');
      }
      if (!fs.lstatSync(filename).isFile()) throw new Error('not-regular-file');
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      let bytes;
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw new Error('not-regular-file');
        if (stat.size !== file.byteLength) throw new Error('changed-bytes');
        bytes = fs.readFileSync(fd);
      } finally { fs.closeSync(fd); }
      if (createHash('sha256').update(bytes).digest('hex') !== file.contentDigest) throw new Error('changed-bytes');
      const text = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes);
      if (text.length !== file.textLength) throw new Error('changed-text-length');
      sourceTexts[file.id] = text;
    } catch (error) {
      diagnostics.push({code:'source-text/unavailable',fileRef:file.id,message:`Source excerpt unavailable for ${file.path}: ${error.code ?? error.message}. The recorded scan remains unchanged.`});
    }
  }
  return {sourceTexts,diagnostics,inputFiles};
}

export async function buildConnectedSiteFiles(input, snapshotFile, linksFile, directory, options = {}) {
  if (!options || Object.keys(options).some(k => !['sourceRoot','direction','groupingPerspectiveRef','readingAnchors'].includes(k))) throw new Error('Unknown connected build option.');
  const {sourceRoot,...layoutOptions} = options;
  const {model,inputFiles} = loadModel(input);
  const snapshot = loadSourceSnapshot(snapshotFile);
  const links = linksFile == null ? undefined : JSON.parse(fs.readFileSync(linksFile,'utf8'));
  const captured = sourceRoot === undefined ? {sourceTexts:{},diagnostics:[],inputFiles:[]} : captureSourceTexts(snapshot,sourceRoot);
  const {layoutModel} = await import('../presentation/layout/index.mjs');
  const {renderSite} = await import('../presentation/site/index.mjs');
  const {writeSite} = await import('./site-files.mjs');
  const layout = await layoutModel(model,layoutOptions);
  const files = renderSite(layout,{source:{snapshot,links,sourceTexts:captured.sourceTexts,evidenceDiagnostics:captured.diagnostics}});
  const {projectSourceLinks} = await import('../knowledge/source-links/index.mjs');
  const projection = projectSourceLinks(model,snapshot,links);
  const written = writeSite(files,directory,{inputFiles:[...inputFiles,snapshotFile,...(linksFile == null ? [] : [linksFile]),...captured.inputFiles]});
  return {...written,source:path.join(written.directory,'source/index.html'),snapshotId:snapshot.id,connections:projection.links.length,diagnostics:[...projection.diagnostics,...captured.diagnostics]};
}
