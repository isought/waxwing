// Repository-specific acceptance experiment, not part of the scanner package.
// V8 compiles source for import inventory only; modules are never linked/evaluated.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderSourceFile, scanRepositoryToFile } from '../../modules/application/scan.mjs';

if (!vm.SourceTextModule) throw new Error('Run with node --experimental-vm-modules.');
if (process.argv.length !== 3) throw new Error('Usage: node --experimental-vm-modules experiments/source-scan/audit.mjs OUTPUT_DIRECTORY');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2]);
const started = performance.now();
await scanRepositoryToFile(root, path.join(output, 'snapshot.json'));
const scanMilliseconds = performance.now() - started;
const scanPeakRSSKiB = process.resourceUsage().maxRSS;
const snapshot = JSON.parse(fs.readFileSync(path.join(output, 'snapshot.json'), 'utf8'));
const files = new Map(snapshot.files.map(f => [f.id, f]));
const declarations = new Map(snapshot.declarations.map(d => [d.id, d]));
const analyzed = snapshot.files.filter(f => f.status === 'analyzed');
const texts = new Map(analyzed.map(f => [f.id, fs.readFileSync(path.join(root, f.path), 'utf8')]));
const perFile = new Map(analyzed.map(f => [f.id, snapshot.references.filter(r => r.fileRef === f.id)]));
const failures = [];
const check = (ok, detail) => { if (!ok) failures.push(detail); };
let staticDependencies = 0, relativeTargets = 0, externalDependencies = 0, positionChecks = 0;
for (const f of analyzed) {
  const content = texts.get(f.id);
  check(createHash('sha256').update(content).digest('hex') === f.contentDigest, { check: 'source-digest', file: f.path });
  check(Buffer.byteLength(content) === f.byteLength && content.length === f.textLength, { check: 'source-length', file: f.path });
  check(f.parseStatus === 'parsed', { check: 'parse-status', file: f.path });
  // This repository is JS/ESM. Do not quietly skip files if it later adds TS/CJS.
  let expected;
  try { expected = new Set(new vm.SourceTextModule(content, { identifier: f.path }).dependencySpecifiers); }
  catch (error) { failures.push({ check: 'independent-parser', file: f.path, message: error.message }); continue; }
  const actual = perFile.get(f.id).filter(r => ['import', 're-export'].includes(r.kind));
  const actualNames = new Set(actual.map(r => r.name));
  for (const name of expected) check(actualNames.has(name), { check: 'missing-static-module', file: f.path, name });
  for (const name of actualNames) check(expected.has(name), { check: 'extra-static-module', file: f.path, name });
  staticDependencies += expected.size;
  for (const name of expected) {
    const refs = actual.filter(r => r.name === name);
    if (name.startsWith('.')) {
      // Independent explicit-path oracle, intentionally limited to this repo's .mjs/.js imports.
      const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), name));
      const target = analyzed.find(item => item.path === targetPath);
      check(Boolean(target), { check: 'unsupported-or-missing-oracle-path', file: f.path, name });
      for (const ref of refs) check(ref.resolution.status === 'resolved' && ref.resolution.targets.length === 1 && ref.resolution.targets[0] === target?.id,
        { check: 'static-target', file: f.path, name, resolution: ref.resolution });
      relativeTargets++;
    } else {
      for (const ref of refs) check(ref.resolution.status === 'unresolved' && ref.resolution.reason === (name.startsWith('node:') ? 'external-builtin' : 'external-package-specifier'), { check: 'external-target', file: f.path, name });
      externalDependencies++;
    }
  }
  // Recompute line/column from actual text independently of TypeScript and snapshot validation.
  const lineStarts = [0];
  for (let offset = 0; offset < content.length; offset++) {
    const character = content[offset];
    if (character === '\r' && content[offset + 1] === '\n') offset++;
    if (['\r', '\n', '\u2028', '\u2029'].includes(character)) lineStarts.push(offset + 1);
  }
  for (const record of [...snapshot.declarations.filter(d => d.fileRef === f.id), ...perFile.get(f.id)]) {
    for (const position of [record.span.start, record.span.end]) {
      const start = lineStarts[position.line - 1];
      check(start !== undefined && start + position.column - 1 === position.offset && position.offset <= content.length &&
        (position.line === lineStarts.length || position.offset < lineStarts[position.line]), { check: 'source-position', file: f.path, id: record.id, position });
      positionChecks++;
    }
    if (record.resolution && ['reference', 'call', 'construct'].includes(record.kind)) {
      check(content.slice(record.span.start.offset, record.span.end.offset) === record.name, { check: 'identifier-text', file: f.path, id: record.id });
    }
  }
}

const application = 'modules/application/';
const layout = 'modules/presentation/layout/';
const render = 'modules/presentation/render/';
const knowledge = 'modules/knowledge/';
// Ground truth read from the source, not generated from scanner targets. Unique
// source snippets make line movement harmless and changed expectations explicit.
const cases = [
  [application + 'collection.mjs', 'loadModel(source)', 'loadModel', application + 'load-model.mjs'],
  [application + 'collection.mjs', 'layoutModel(loaded.model,entry.layout??{})', 'layoutModel', layout + 'index.mjs'],
  [application + 'collection.mjs', 'const files=renderSite(layout)', 'renderSite', 'modules/presentation/site/index.mjs'],
  [application + 'collection.mjs', 'esc(start.path)', 'esc', render + 'index.mjs', 'escapeXML'],
  [application + 'load-model.mjs', 'validateModel(model)', 'validateModel', knowledge + 'architecture/model.mjs'],
  [application + 'load-model.mjs', 'parseMarkdown(doc.markdown)', 'parseMarkdown', knowledge + 'documents/markdown.mjs'],
  [application + 'load-model.mjs', 'assetMime(bytes)', 'assetMime', knowledge + 'documents/markdown.mjs'],
  [application + 'pipeline.mjs', 'const { model, inputFiles } = loadModel(input);\n  return { output:', 'loadModel', application + 'load-model.mjs'],
  [application + 'pipeline.mjs', 'write(output, renderer(readJSON(input), options), [input])', 'readJSON', application + 'pipeline.mjs'],
  [application + 'pipeline.mjs', 'write(output, renderer(readJSON(input), options), [input])', 'write', application + 'pipeline.mjs'],
  [application + 'pipeline.mjs', 'write(output, renderer(readJSON(input), options), [input])', 'renderer', application + 'pipeline.mjs', 'renderer', 'variable'],
  [application + 'pipeline.mjs', 'layoutModel(model, options)', 'layoutModel', application + 'pipeline.mjs', 'layoutModel', 'variable'],
  [application + 'pipeline.mjs', 'renderSVG(layout)', 'renderSVG', application + 'pipeline.mjs', 'renderSVG', 'variable'],
  [layout + 'index.mjs', 'layoutSequence(input, options)', 'layoutSequence', 'modules/presentation/sequence/layout.mjs'],
  [layout + 'index.mjs', 'const result = validateModel(input)', 'validateModel', knowledge + 'architecture/model.mjs'],
  [layout + 'index.mjs', 'layoutModel(projectGraph(input, graph.id)', 'layoutModel', layout + 'index.mjs'],
  [layout + 'index.mjs', 'layoutModel(projectGraph(input, graph.id)', 'projectGraph', knowledge + 'architecture/graphs.mjs'],
  [layout + 'index.mjs', 'frameMemberships(model, groupingPerspectiveRef)', 'frameMemberships', 'modules/presentation/shared/model.mjs'],
  [layout + 'index.mjs', 'flatten(child, bounds.x, bounds.y)', 'flatten', layout + 'index.mjs'],
  [render + 'artifacts.mjs', 'return recoverModel(extractLayout(artifact))', 'recoverModel', render + 'artifacts.mjs'],
  [render + 'artifacts.mjs', 'return recoverModel(extractLayout(artifact))', 'extractLayout', render + 'artifacts.mjs'],
  [knowledge + 'query/index.mjs', 'map(([,v])=>recordText(v))', 'recordText', knowledge + 'query/index.mjs'],
  [knowledge + 'query/index.mjs', 'revision:digest(model)', 'digest', knowledge + 'shared/model.mjs'],
  ['test/pipeline.test.mjs', 'const layout = await layoutModel(model, options)', 'layoutModel', layout + 'index.mjs'],
  ['test/pipeline.test.mjs', 'assert.throws(() => renderSVG(modified))', 'renderSVG', render + 'index.mjs'],
  [knowledge + 'source/query.mjs', 'validateSourceSnapshot(snapshot)', 'validateSourceSnapshot', knowledge + 'source/model.mjs'],
];
function locate(file, snippet, name) {
  const f = analyzed.find(f => f.path === file);
  const content = texts.get(f?.id) ?? '';
  const offset = content.indexOf(snippet);
  if (offset < 0 || content.indexOf(snippet, offset + 1) >= 0 || !snippet.includes(name)) throw new Error(`Oracle snippet must match once: ${file}: ${snippet}`);
  return { file: f, offset: offset + snippet.indexOf(name), snippet };
}
const bindings = cases.map(([file, snippet, name, targetFile, targetName = name, targetKind = 'function']) => {
  const located = locate(file, snippet, name);
  const ref = perFile.get(located.file.id).find(r => r.span.start.offset === located.offset && r.kind === 'call');
  const targets = (ref?.resolution.targets ?? []).map(id => declarations.get(id)).filter(Boolean);
  const ok = ref?.resolution.status === 'resolved' && targets.length === 1 && targets[0].name === targetName && targets[0].kind === targetKind && files.get(targets[0].fileRef).path === targetFile;
  const entry = { file, snippet, name, line: ref?.span.start.line, expected: { file: targetFile, name: targetName, kind: targetKind },
    actual: targets.map(t => ({ file: files.get(t.fileRef).path, name: t.name, kind: t.kind, line: t.span.start.line })), ok: Boolean(ok) };
  check(ok, { check: 'sample-binding', ...entry });
  return entry;
});
const conditional = locate('modules/interfaces/cli.mjs', "(command === 'layout' ? layoutModelFile : buildModelFiles)(args[0]", 'layoutModelFile');
const conditionalRef = perFile.get(conditional.file.id).find(r => r.span.start.offset === conditional.offset);
// Keep the lexical-binding oracle above unchanged. This is an additional,
// manually selected exported-declaration oracle, not a rewritten expectation.
const provenanceCases = [
  [application + 'pipeline.mjs', 'await layoutModel(model, options)', 'layoutModel', layout + 'index.mjs'],
  [application + 'pipeline.mjs', "['diagram.svg', renderSVG(layout)]", 'renderSVG', render + 'index.mjs'],
  ['modules/interfaces/cli.mjs', 'await scanRepositoryToFile(args[0]', 'scanRepositoryToFile', application + 'scan.mjs'],
  [application + 'scan.mjs', 'const content = renderSourceHTML(snapshot)', 'renderSourceHTML', 'modules/presentation/source/index.mjs'],
];
const provenanceBindings = provenanceCases.map(([file, snippet, name, targetFile]) => {
  const located = locate(file, snippet, name);
  const call = perFile.get(located.file.id).find(r => r.span.start.offset === located.offset && r.kind === 'call');
  const binding = declarations.get(call?.resolution.targets[0]);
  const p = binding?.valueProvenance;
  const target = declarations.get(p?.resolution.targets[0]);
  const evidence = perFile.get(located.file.id).find(r => r.id === p?.moduleRef);
  const ok = call?.resolution.status === 'resolved' && binding?.kind === 'variable' && p?.resolution.status === 'resolved' && target?.name === name && target?.kind === 'function' && files.get(target.fileRef)?.path === targetFile && evidence?.kind === 'dynamic-import';
  const entry = { file, snippet, name, expected: targetFile, ok: Boolean(ok), line: call?.span.start.line, exportLine: target?.span.start.line };
  check(ok, {check: 'sample-provenance', ...entry});
  return entry;
});
const viewStarted = performance.now();
await renderSourceFile(path.join(output, 'snapshot.json'), path.join(output, 'source.html'));
const viewMilliseconds = Math.round(performance.now() - viewStarted);
const view = fs.readFileSync(path.join(output, 'source.html'), 'utf8');
const viewData = JSON.parse(view.match(/<script type="application\/json" id="source-data">(.*?)<\/script>/s)[1]);
for (const [file, snippet, name, targetFile] of provenanceCases) {
  const located = locate(file, snippet, name);
  const relationship = viewData.relationships.find(r => r.reference.fileRef === located.file.id && r.reference.span.start.offset === located.offset);
  check(relationship?.provenance.some(p => p.resolution.targets.some(id => files.get(declarations.get(id)?.fileRef)?.path === targetFile)), {check:'view-provenance', file, name});
}

const gaps = [
  { file: conditional.file.path, line: conditionalRef?.span.start.line, observation: 'Conditional callee is indexed as identifier references; there is no call record for the conditional expression.', source: conditional.snippet, observed: conditionalRef?.kind },
  { file: 'modules/presentation/render/index.mjs', observation: 'asset("viewer.js") reads JavaScript as text. The file is scanned independently, but this asset dependency and injected browser globals are not linked.', source: "${asset('viewer.js')}" },
];
const counts = values => values.reduce((out, value) => { out[value] = (out[value] ?? 0) + 1; return out; }, {});
const moduleKinds = ['import', 're-export', 'dynamic-import', 'require'];
const moduleRefs = snapshot.references.filter(r => moduleKinds.includes(r.kind));
const calls = snapshot.references.filter(r => r.kind === 'call');
const audit = {
  snapshotId: snapshot.id, source: snapshot.source, coverage: snapshot.coverage,
  summary: { files: snapshot.files.length, analyzed: analyzed.length, skipped: snapshot.files.length - analyzed.length,
    declarations: snapshot.declarations.length, references: snapshot.references.length, syntaxErrors: analyzed.filter(f => f.parseStatus === 'errors').length,
    referencesByResolution: counts(snapshot.references.map(r => r.resolution.status)), callsByResolution: counts(calls.map(r => r.resolution.status)),
    resolvedCallTargetKinds: counts(calls.filter(r => r.resolution.status === 'resolved').map(r => declarations.get(r.resolution.targets[0])?.kind ?? 'file')),
    skippedReasons: counts(snapshot.files.filter(f => f.status === 'skipped').map(f => f.reason)), moduleKinds: counts(moduleRefs.map(r => r.kind)) },
  checks: { independentlyParsedFiles: analyzed.length, staticDependencies, relativeTargets, externalDependencies, positionChecks,
    sampledProvenance: provenanceBindings.length, sampledProvenancePassed: provenanceBindings.filter(b => b.ok).length, sampledBindings: bindings.length, sampledBindingsPassed: bindings.filter(b => b.ok).length, failures },
  bindings, provenanceBindings, gaps, view: { viewMilliseconds, bytes: Buffer.byteLength(view), peakRSSKiB: process.resourceUsage().maxRSS }, measurement: { scanMilliseconds: Math.round(scanMilliseconds), scanPeakRSSKiB, snapshotBytes: fs.statSync(path.join(output, 'snapshot.json')).size,
    scope: 'One warm-filesystem run; scan and JSON serialization/validation, before independent audit. Peak RSS includes this Node process. Not a scaling benchmark.' },
};
const json = value => JSON.stringify(value, null, 2) + '\n';
fs.writeFileSync(path.join(output, 'audit.json'), json(audit));
const report = `# Waxwing scans Waxwing\n\nSnapshot: \`${snapshot.id}\`. Git HEAD is context only; this run includes current uncommitted source.\n\n` +
  `## What was checked\n\n- ${analyzed.length} JavaScript files parsed independently with Node/V8; no modules linked or executed.\n- ${staticDependencies} distinct per-file static module specifiers compared in both directions; ${relativeTargets} relative target paths checked independently; ${externalDependencies} built-in/package dependencies classified as boundary references without scanning their implementations.\n- All analyzed file hashes and lengths checked against source bytes; ${positionChecks} span endpoints recomputed, and every identifier occurrence compared to source text.\n- ${bindings.filter(b => b.ok).length}/${bindings.length} manually selected call-binding cases passed. These are samples, not a precision/recall estimate.\n- ${provenanceBindings.filter(b => b.ok).length}/${provenanceBindings.length} manually grounded import-provenance paths passed, including their generated navigation records. Lexical expectations remain unchanged.\n- ${failures.length} unexpected check failures.\n\n` +
  `## What the snapshot contains\n\n${JSON.stringify(audit.summary, null, 2)}\n\n` +
  `## Observed gaps\n\n${gaps.map(g => `- **${g.file}${g.line ? ':' + g.line : ''}** — ${g.observation}`).join('\n')}\n\n` +
  `A resolved call can target a variable or parameter. The resolution rate is not a call-graph accuracy score. Missing Node/browser standard libraries and external packages account for many unresolved names; we do not guess targets.\n\n` +
  `The preview projects file dependencies directly from the snapshot. It does not turn imports into architectural calls or classify source files as services. The architecture schema currently has no source-file category or imports relationship kind. Terms, boundaries and intention remain human contributions.\n\n` +
  `## Sampled bindings\n\n| Source | Call | Expected target | Result |\n| --- | --- | --- | --- |\n` +
  bindings.map(b => `| ${b.file}:${b.line ?? '?'} | ${b.name} | ${b.expected.file} · ${b.expected.kind} ${b.expected.name} | ${b.ok ? 'Pass' : 'FAIL'} |`).join('\n') +
  `\n\n## Cost of this run\n\n${audit.measurement.scanMilliseconds} ms; peak RSS ${(scanPeakRSSKiB / 1024).toFixed(0)} MiB; formatted snapshot ${(audit.measurement.snapshotBytes / 1048576).toFixed(1)} MiB. ${audit.measurement.scope}\n\n` +
  `## Limits of this audit\n\nNo independent full declaration/call inventory, runtime tracing, TypeScript-project accuracy assessment, or dynamic-import completeness oracle. The V8 check covers static ESM imports/re-exports only. File discovery follows the scanner's declared Git/exclusion scope; this audit does not independently prove discovery completeness.\n`;
fs.writeFileSync(path.join(output, 'report.md'), report);
// A compact evidence projection for the interactive view. Full records remain in snapshot.json.
const preview = { summary: audit.summary, checks: { staticDependencies, relativeTargets, sampledBindings: bindings.length, failures: failures.length },
  files: analyzed.map(f => ({ path: f.path, language: f.language,
    declarations: snapshot.declarations.filter(d => d.fileRef === f.id && ['function', 'class', 'method'].includes(d.kind)).map(d => ({ name: d.name, kind: d.kind, line: d.span.start.line })),
    calls: counts(perFile.get(f.id).filter(r => r.kind === 'call').map(r => r.resolution.status)) })),
  edges: moduleRefs.map(r => ({ from: files.get(r.fileRef).path, to: files.get(r.resolution.targets[0])?.path ?? null,
    specifier: r.name, kind: r.kind, line: r.span.start.line, status: r.resolution.status,
    evidence: texts.get(r.fileRef).split(/\r\n|[\n\r\u2028\u2029]/)[r.span.start.line - 1]?.trim().slice(0, 500) })),
  bindings, gaps };
fs.writeFileSync(path.join(output, 'preview-data.json'), json(preview));
console.log(json({ output, snapshotId: snapshot.id, summary: audit.summary, checks: audit.checks, measurement: audit.measurement }));
if (failures.length) process.exitCode = 1;
