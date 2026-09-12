import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { digest } from '../shared/model.mjs';

export const SOURCE_VERSION = '0.1-source-draft';
const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/source-snapshot.schema.json', import.meta.url), 'utf8'));
const shape = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
export const sourceSnapshotId = ({ id, ...snapshot }) => `snapshot-${digest(snapshot)}`;
export const sourceFileId = (sourceId, path) => `file-${digest([sourceId, path])}`;
export const sourceRecordId = (prefix, file, span, kind) => `${prefix}-${digest([file.id, file.contentDigest, span.start.offset, span.end.offset, kind])}`;
export const validSourcePath = value => typeof value === 'string' && !!value.trim() && !/[\\\u0000-\u001f\u007f:]/u.test(value) && !value.startsWith('/') && value.split('/').every(part => part && !['.', '..'].includes(part));

export function validateSourceSnapshot(snapshot) {
  if (!shape(snapshot)) return { ok: false, diagnostics: shape.errors.map(e => ({ code: 'source/schema', path: e.instancePath, message: e.message })) };
  const diagnostics = [], all = new Map(), fileMap = new Map(snapshot.files.map(f => [f.id, f])), paths = new Set();
  const add = (code, path, message) => diagnostics.push({ code: `source/${code}`, path, message });
  for (const collection of ['files', 'declarations', 'references']) for (const [i, record] of snapshot[collection].entries()) {
    if (all.has(record.id)) add('duplicate', `/${collection}/${i}/id`, 'Record IDs must be unique across a snapshot.');
    all.set(record.id, { ...record, collection });
  }
  for (const [i, file] of snapshot.files.entries()) {
    if (!validSourcePath(file.path) || paths.has(file.path)) add('path', `/files/${i}/path`, 'Use unique normalized relative source paths.');
    paths.add(file.path);
    if (file.id !== sourceFileId(snapshot.source.id, file.path)) add('identity', `/files/${i}/id`, 'File ID does not match its source/path.');
  }
  const checkSpan = (span, file, pointer) => {
    const { start, end } = span;
    if (!file || file.status !== 'analyzed' || end.offset > file.textLength || start.offset > end.offset || start.line > end.line || start.line === end.line && start.column > end.column) add('span', pointer, 'Span must be ordered and lie within an analyzed file.');
  };
  for (const collection of ['declarations', 'references']) for (const [i, record] of snapshot[collection].entries()) {
    const pointer = `/${collection}/${i}`, file = fileMap.get(record.fileRef), container = all.get(record.containerRef);
    checkSpan(record.span, file, pointer + '/span');
    if (!container || !['files', 'declarations'].includes(container.collection) || (container.collection === 'files' ? container.id : container.fileRef) !== record.fileRef || container.id === record.id) add('container', pointer + '/containerRef', 'Container must be a different declaration or the file containing this occurrence.');
    else if (container.span && (container.span.start.offset > record.span.start.offset || container.span.end.offset < record.span.end.offset)) add('container', pointer + '/containerRef', 'Container span must contain this occurrence.');
    if (file && record.id !== sourceRecordId(collection === 'declarations' ? 'decl' : 'ref', file, record.span, record.kind)) add('identity', pointer + '/id', 'Record ID does not match its file revision, span and kind.');
    if (record.valueProvenance) {
      const evidence = all.get(record.valueProvenance.moduleRef);
      if (evidence?.collection !== 'references' || evidence.kind !== 'dynamic-import' || evidence.fileRef !== record.fileRef) add('provenance', pointer + '/valueProvenance/moduleRef', 'Provenance requires a dynamic-import occurrence in the binding file.');
      if (record.kind !== 'variable' || record.valueProvenance.resolution.targets.length && (evidence?.resolution?.status !== 'resolved' || !record.valueProvenance.importedName)) add('provenance', pointer + '/valueProvenance', 'Resolved provenance requires a variable binding, an export name and a resolved module occurrence.');
    }
    if (collection === 'references' || record.valueProvenance) {
      const { status, targets } = record.resolution ?? record.valueProvenance.resolution;
      if (status === 'resolved' && targets.length !== 1 || status === 'ambiguous' && targets.length < 2 || status === 'unresolved' && targets.length !== 0) add('resolution', pointer + '/resolution', 'Resolution status and target count disagree.');
      for (const id of targets) {
        const target = all.get(id), targetFile = target?.collection === 'files' ? target : fileMap.get(target?.fileRef);
        if (!['files', 'declarations'].includes(target?.collection) || targetFile?.status !== 'analyzed') add('target', pointer + '/resolution/targets', `Unknown or unanalyzed file/declaration target ${id}.`);
        else if (file?.parseStatus === 'errors' || targetFile.parseStatus === 'errors') add('resolution', pointer + '/resolution', 'Syntax-error files must not be presented as resolved bindings.');
      }
    }
  }
  for (const [i, d] of snapshot.diagnostics.entries()) {
    if (d.fileRef && !fileMap.has(d.fileRef)) add('diagnostic', `/diagnostics/${i}/fileRef`, 'Unknown diagnostic file.');
    if (d.span) checkSpan(d.span, fileMap.get(d.fileRef), `/diagnostics/${i}/span`);
  }
  // Even equal-span declarations must not introduce a containment cycle.
  const done = new Set();
  for (const d of snapshot.declarations) {
    const active = new Set(); let current = d;
    while (current?.collection !== 'files' && current && !done.has(current.id)) {
      if (active.has(current.id)) { add('cycle', '/declarations', 'Declaration containment must be acyclic.'); break; }
      active.add(current.id); current = all.get(current.containerRef);
    }
    for (const id of active) done.add(id);
  }
  if (snapshot.id !== sourceSnapshotId(snapshot)) add('digest', '/id', 'Snapshot digest does not match its contents.');
  return { ok: !diagnostics.length, diagnostics, summary: {
    files: snapshot.files.length, analyzed: snapshot.files.filter(f => f.status === 'analyzed').length,
    skipped: snapshot.files.filter(f => f.status === 'skipped').length, declarations: snapshot.declarations.length,
    references: snapshot.references.length, unresolved: snapshot.references.filter(r => r.resolution.status === 'unresolved').length,
    ambiguous: snapshot.references.filter(r => r.resolution.status === 'ambiguous').length,
    syntaxErrors: snapshot.diagnostics.filter(d => d.code.startsWith('typescript/')).length,
  } };
}
