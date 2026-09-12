import { createHash } from 'node:crypto';
import { SOURCE_VERSION, sourceFileId, sourceSnapshotId, validSourcePath, validateSourceSnapshot } from '../knowledge/source/model.mjs';
import { fail } from '../knowledge/shared/model.mjs';
import { supportedSourceLanguages, sourceLanguage, sourceLanguageProfiles } from './languages.mjs';
export { supportedSourceLanguages, sourceLanguage, sourceLanguageProfiles } from './languages.mjs';

export async function analyzeSources(sources, { sourceId = 'repository' } = {}) {
  if (!Array.isArray(sources) || typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('Provide source entries and a nonempty sourceId.');
  const seen = new Set(), inputs = [], files = [];
  for (const source of sources) {
    if (!source || !validSourcePath(source.path) || seen.has(source.path) || typeof source.content !== 'string' || Buffer.from(source.content).toString('utf8') !== source.content) throw new Error('Source entries require unique normalized relative paths and valid Unicode string content.');
    seen.add(source.path);
  }
  for (const source of [...sources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const file = { id: sourceFileId(sourceId, source.path), path: source.path, language: sourceLanguage(source.path) };
    if (supportedSourceLanguages.includes(file.language)) {
      Object.assign(file, { status: 'analyzed', contentDigest: createHash('sha256').update(source.content).digest('hex'), byteLength: Buffer.byteLength(source.content), textLength: source.content.length, parseStatus: 'parsed' });
      inputs.push({ file, content: source.content });
    } else Object.assign(file, { status: 'skipped', reason: 'unsupported-language' });
    files.push(file);
  }
  const records = { declarations: [], references: [], diagnostics: [] };
  const compilerInputs = inputs.filter(input => sourceLanguageProfiles[input.file.language].backend === 'typescript');
  const syntaxInputs = inputs.filter(input => sourceLanguageProfiles[input.file.language].backend === 'tree-sitter');
  const producer = { name: 'waxwing-hybrid', version: '0.3.0', adapterVersion: '0.3.0', configuration: 'TypeScript 6.0.3 closed-snapshot bindings; web-tree-sitter 0.27.0 with tree-sitter-wasm 2.0.1 syntax profiles. Per-file capabilities and grammar identity are recorded.' };
  if (compilerInputs.length) {
    const { analyzeJavaScript, producer: compiler } = await import('./javascript.mjs');
    const result = analyzeJavaScript(compilerInputs);
    for (const { file } of compilerInputs) file.analysis = { backend: 'typescript', version: compiler.version, level: 'bindings', capabilities: ['declarations', 'containment', 'call-occurrences', 'module-occurrences', 'binding-resolution', 'import-value-provenance'], limitations: [compiler.configuration] };
    for (const key of Object.keys(records)) records[key].push(...result[key]);
  }
  if (syntaxInputs.length) {
    const { analyzeTreeSitter } = await import('./tree-sitter.mjs');
    const result = await analyzeTreeSitter(syntaxInputs);
    for (const key of Object.keys(records)) records[key].push(...result[key]);
  }
  const snapshot = { schemaVersion: SOURCE_VERSION, source: { id: sourceId }, producer,
    coverage: { discovery: 'provided-inputs', discoveryComplete: true, excludedDirectories: [], limits: {} },
    files, ...records, limitations: [
      'JavaScript/TypeScript use compiler bindings; other enabled languages use selected Tree-sitter syntax profiles without target resolution. Per-file analysis records the actual capabilities and limitations. Named declarations and identifier/module occurrences are indexed; anonymous callables and computed/string member references are not fully indexed.',
      'Bindings treat every file as a module in a closed snapshot with bundler module resolution. Project tsconfig, package manifests, external packages and standard libraries are not loaded; type-checking, build execution and runtime verification are not run.',
      'Static value provenance is limited to immutable simple destructuring of awaited literal imports. It locates exported declarations, not guaranteed runtime values. Mutable bindings/exports, writes and unsupported patterns stay unresolved; general alias/data-flow analysis is absent.',
      'Call records describe syntax and compiler bindings, not execution, control flow, dispatch certainty, architectural intent or a complete call graph.',
      'File IDs use source identity and relative path. Declaration/reference IDs also include file content and spans; cross-revision renames or identity continuity are not inferred.',
      'Positions are zero-based UTF-16 offsets and one-based UTF-16 lines/columns with exclusive ends. Source text is not embedded; matching source bytes are needed to inspect evidence.',
    ] };
  snapshot.id = sourceSnapshotId(snapshot);
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.ok) fail('Scanner produced an invalid source snapshot.', validation.diagnostics);
  return snapshot;
}
