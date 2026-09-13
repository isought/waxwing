#!/usr/bin/env node
import path from 'node:path';

const usage = `Waxwing — experimental modular diagram tool

  waxwing validate <model.json>
  waxwing prepare <model.json> <resolved-model.json>
  waxwing layout <model.json> <layout.json> [--group perspective-id] [--direction RIGHT|DOWN]
  waxwing check-layout <layout.json>
  waxwing render <layout.json> <output.svg|output.html> [--graph graph-id | --workflow workflow-id]
  waxwing render-site <layout.json> <output-directory>
  waxwing build-site <model.json> <output-directory> [--group perspective-id] [--direction RIGHT|DOWN]
  waxwing build-connected <model.json> <scan.json> <links.json|-> <output-directory> [--source-root directory] [--direction RIGHT|DOWN]
  waxwing build-collection <collection.json> <output-directory>
  waxwing init --agent codex|claude [--agent ...] [--project directory] [--dry-run]
  waxwing doctor [--project directory] [--format json]
  waxwing detach --agent codex|claude [--agent ...] [--project directory] [--dry-run]
  waxwing discover [--project directory] [--workspace workspace.json] [--budget 16384] [--format json]
  waxwing context --question <text> [--clue text ...] [--source key ...] [--project directory] [--workspace workspace.json] [--environment text] [--revision text] [--budget 16384] [--output file] [--format json]
  waxwing read <reference> [--from-line n] [--context-lines 3] [--source-root directory] [--project directory] [--budget 16384] [--output file] [--format json]
  waxwing guide <topic|list>
  waxwing review-update <before-model.json> <updated-model.json>
  waxwing skill install <skill-directory>
  waxwing scan <source-directory> <scan.json> [--source-id id] [--max-files 10000] [--max-file-bytes 1048576] [--max-total-bytes 33554432]
  waxwing scan-view <scan.json> <source.html>
  waxwing scan-check <scan.json>
  waxwing scan-query <scan.json> <search|inspect|references|imports|functions|outgoing> <text-or-id> [--limit 20] [--offset 0] [--budget 12000]
  waxwing workspace check <workspace.json> [--format json|markdown]
  waxwing workspace affected <workspace.json> [--source source-id] [--model model-id] [--format json|markdown]
  waxwing query <model.json> <search|inspect|neighbors|workflows|workflow> <text-or-id> [--limit 20] [--budget 12000] [--offset 0] [--kind kind] [--direction incoming|outgoing|both] [--relation kind]
  waxwing recover <layout.json|diagram.svg|diagram.html|site-directory> <model.json>
  waxwing build <model.json> <output-directory> [--group perspective-id] [--direction RIGHT|DOWN]

Architecture and basic sequence models use the same commands. Sequence models declare diagramType: sequence.
--group and --direction apply only to architecture diagrams; sequence order comes from JSON 1.
--anchor graph-id=node-id applies to layout, build, and build-site. Repeat for different architecture graphs.
An anchor is a reading preference, not a workflow entry or execution-order claim.
The layout stage is optional. Render accepts a compatible, independently authored JSON 2.
build-site publishes a managed directory with an index and one page per view/document.
build-collection packages separate models or existing sites under one home page, with shared search and explicit links.
init registers a portable project skill and a short instruction block for the selected agents; detach removes only unchanged managed material.
doctor reports runtime, host files and readable knowledge without calling a model. discover, context and read are read-only;
their --budget bounds the entire UTF-8 response in bytes. context matches supplied clues and identifiers lexically; it does not diagnose.
skill install writes a managed authoring/update skill bound to this package into an explicit destination.
workspace records evidence and elaboration across locations; affected produces a review queue, not automatic edits.
query reads recorded model knowledge; its budget bounds result characters, not tokens or the metadata envelope.
render-site accepts JSON 2 directly; neither requires a Waxwing server.
validate, prepare, layout, build, and build-site load explicitly registered Markdown files and local raster images.
scan indexes JavaScript/TypeScript source into a separate snapshot; write its output outside the source directory.
scan-query reads that snapshot; query continues to read authored architecture/sequence models.
No command executes scanned code, fetches source locators, or calls an LLM.`;

// Flag parsing for the agent-entry commands: spec maps flag names to value kinds.
function flags(args, spec, command) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const kind = spec[arg];
    if (!kind) throw new Error(`Unknown ${command} option ${arg}.`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (kind === 'boolean') { if (options[key]) throw new Error(`Repeated ${arg}.`); options[key] = true; continue; }
    const value = args[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}.`);
    if (kind === 'list') { (options[key] ??= []).push(value); continue; }
    if (Object.hasOwn(options, key)) throw new Error(`Repeated ${arg}.`);
    if (kind === 'format') { if (value !== 'json') throw new Error('--format supports json.'); options[key] = value; continue; }
    options[key] = kind === 'integer' ? (/^-?\d+$/.test(value) ? Number(value) : NaN) : value;
    if (kind === 'integer' && !Number.isInteger(options[key])) throw new Error(`${arg} requires an integer.`);
  }
  return { options, positional };
}

async function emitProtocol(operation, packet, output) {
  const text = JSON.stringify(packet) + '\n';
  if (process.env.WAXWING_MEASUREMENT_LOG) {
    // Opt-in local measurement. Questions, clues, references and source text are never recorded.
    try {
      const fs = await import('node:fs');
      fs.appendFileSync(process.env.WAXWING_MEASUREMENT_LOG, JSON.stringify({ time: new Date().toISOString(), operation, status: packet.status, protocolVersion: packet.protocolVersion,
        measurement: packet.measurement ?? null, truncated: packet.budget?.truncated ?? null, candidates: packet.candidates?.length ?? null }) + '\n');
    } catch { /* Measurement must never change the command result. */ }
  }
  if (output === undefined) { process.stdout.write(text); return; }
  const fs = await import('node:fs'), { randomUUID } = await import('node:crypto');
  const target = path.resolve(output);
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('--output must not be a symlink.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.waxwing-context-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, text); fs.renameSync(temp, target); } finally { fs.rmSync(temp, { force: true }); }
  console.log(JSON.stringify({ status: packet.status, output: target, bytes: Buffer.byteLength(text) }));
}

function layoutArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index + 1]) throw new Error(`Missing value for ${args[index]}.`);
    if (args[index] === '--anchor') {
      const pair = args[index + 1].split('=');
      if (pair.length !== 2 || pair.some((part) => !part)) throw new Error('--anchor requires graph-id=node-id.');
      options.readingAnchors ??= {};
      if (Object.hasOwn(options.readingAnchors, pair[0])) throw new Error(`Repeated reading anchor for graph "${pair[0]}".`);
      Object.defineProperty(options.readingAnchors, pair[0], { value: pair[1], enumerable: true });
      continue;
    }
    const key = { '--group': 'groupingPerspectiveRef', '--direction': 'direction' }[args[index]];
    if (!key || Object.hasOwn(options, key)) throw new Error(`Unknown or repeated option ${args[index]}.`);
    options[key] = args[index + 1];
  }
  return options;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || ['--help', '-h', 'help'].includes(command)) console.log(usage);
  else if (command === '--version' || command === 'version') {
    const { packageInfo } = await import('./integration/templates.mjs');
    const { CONTEXT_PROTOCOL } = await import('../knowledge/context/protocol.mjs');
    console.log(JSON.stringify({ package: packageInfo.name, version: packageInfo.version, protocolVersion: CONTEXT_PROTOCOL }));
  } else if (command === 'init' || command === 'detach') {
    const { options, positional } = flags(args, { '--agent': 'list', '--project': 'string', '--dry-run': 'boolean', '--format': 'format' }, command);
    if (positional.length) throw new Error(`${command} takes no positional arguments; use --project for the directory.`);
    const { initIntegration, detachIntegration } = await import('./integration/lifecycle.mjs');
    const result = (command === 'init' ? initIntegration : detachIntegration)({ agents: options.agent, project: options.project, dryRun: options.dryRun });
    if (command === 'init' && result.ok && result.status !== 'dry-run') {
      const { runtimeReport } = await import('./integration/doctor.mjs');
      const runtime = runtimeReport();
      result.readiness = { runtimeOnPath: runtime.pathResolvesTo, pathAmbiguous: runtime.pathAmbiguous, hostUptake: 'untested', ...(runtime.pathResolvesTo === 'this-runtime' ? {} : { repair: 'Install a compatible runtime so `waxwing` on PATH provides these commands, then run waxwing doctor.' }) };
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } else if (command === 'doctor') {
    const { options, positional } = flags(args, { '--project': 'string', '--format': 'format' }, command);
    if (positional.length) throw new Error('doctor takes no positional arguments.');
    const { doctorReport } = await import('./integration/doctor.mjs');
    console.log(JSON.stringify(doctorReport({ project: options.project }), null, 2));
  } else if (['discover', 'context', 'read'].includes(command)) {
    const common = { '--project': 'string', '--workspace': 'string', '--budget': 'integer', '--format': 'format', '--output': 'string' };
    const spec = command === 'context' ? { ...common, '--question': 'string', '--clue': 'list', '--source': 'list', '--environment': 'string', '--revision': 'string' }
      : command === 'read' ? { ...common, '--from-line': 'integer', '--context-lines': 'integer', '--source-root': 'string' } : common;
    let parsed;
    try { parsed = flags(args, spec, command); } catch (error) { error.status = 'invalid_request'; throw error; }
    const { options, positional } = parsed;
    if (positional.length !== (command === 'read' ? 1 : 0)) throw Object.assign(new Error(command === 'read' ? 'read requires exactly one reference.' : `${command} takes no positional arguments.`), { status: 'invalid_request' });
    const { buildContext, readReference, discoverReport } = await import('../application/context.mjs');
    const { output, format, question, clue, source, ...rest } = options;
    const packet = command === 'context' ? buildContext({ ...rest, question, clues: clue, sources: source })
      : command === 'read' ? readReference(positional[0], rest) : discoverReport(rest);
    await emitProtocol(command, packet, output);
  } else if (command === 'guide') {
    if (args.length !== 1) throw new Error('guide requires one topic, or list.');
    const { readGuide } = await import('./skill/guide.mjs');
    const { packageRoot } = await import('./integration/templates.mjs');
    console.log(readGuide(packageRoot, args[0]));
  } else if (command === 'review-update') {
    if (args.length !== 2) throw new Error('review-update requires baseline and updated model paths.');
    const { reviewUpdate } = await import('../application/review-update.mjs');
    console.log(JSON.stringify({ ok: true, ...reviewUpdate(args[0], args[1]) }, null, 2));
  }
  else if (command === 'scan') {
    if (args.length < 2 || (args.length - 2) % 2) throw new Error('scan requires a source directory, output JSON path, and optional flag/value pairs.');
    const options = {}, keys = { '--source-id': 'sourceId', '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' };
    for (let i = 2; i < args.length; i += 2) {
      const key = keys[args[i]];
      if (!key || Object.hasOwn(options, key)) throw new Error(`Unknown or repeated scan option ${args[i]}.`);
      options[key] = key === 'sourceId' ? args[i + 1] : Number(args[i + 1]);
    }
    const { scanRepositoryToFile } = await import('../application/scan.mjs');
    console.log(JSON.stringify(await scanRepositoryToFile(args[0], args[1], options), null, 2));
  } else if (command === 'scan-view') {
    if (args.length !== 2) throw new Error('scan-view requires a snapshot JSON file and output HTML path.');
    const { renderSourceFile } = await import('../application/scan.mjs');
    console.log(JSON.stringify({ ok: true, ...await renderSourceFile(args[0], args[1]) }, null, 2));
  } else if (command === 'scan-check') {
    if (args.length !== 1) throw new Error('scan-check requires one source snapshot JSON file.');
    const { loadSourceSnapshot } = await import('../application/scan.mjs');
    const { validateSourceSnapshot } = await import('../knowledge/source/index.mjs');
    console.log(JSON.stringify(validateSourceSnapshot(loadSourceSnapshot(args[0])), null, 2));
  } else if (command === 'scan-query') {
    if (args.length < 3 || (args.length - 3) % 2) throw new Error('scan-query requires a snapshot, operation, value, and optional flag/value pairs.');
    const options = {};
    for (let i = 3; i < args.length; i += 2) {
      const key = args[i].slice(2);
      if (!['--limit', '--offset', '--budget'].includes(args[i]) || Object.hasOwn(options, key)) throw new Error(`Unknown or repeated source query option ${args[i]}.`);
      options[key] = Number(args[i + 1]);
    }
    const { loadSourceSnapshot } = await import('../application/scan.mjs');
    const { querySourceSnapshot } = await import('../knowledge/source/index.mjs');
    console.log(JSON.stringify({ ok: true, ...querySourceSnapshot(loadSourceSnapshot(args[0]), args[1], args[2], options) }, null, 2));
  }
  else if (command === 'validate') {
    if (args.length !== 1) throw new Error('validate requires one JSON 1 file.');
    const { validateModel } = await import('../knowledge/architecture/model.mjs');
    const { loadModel } = await import('../application/load-model.mjs');
    const result = validateModel(loadModel(args[0]).model);
    console.log(JSON.stringify(result.ok ? result : {...result, command, input: path.resolve(args[0])}, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } else if (command === 'prepare') {
    if (args.length !== 2) throw new Error('prepare requires an authoring input and a resolved JSON 1 output path.');
    const { prepareModelFile } = await import('../application/pipeline.mjs');
    console.log(JSON.stringify({ ok: true, ...prepareModelFile(args[0], args[1]) }));
  } else if (command === 'check-layout') {
    if (args.length !== 1) throw new Error('check-layout requires one JSON 2 file.');
    const { checkLayoutFile } = await import('../application/pipeline.mjs');
    const result = await checkLayoutFile(args[0]);
    console.log(JSON.stringify(result.ok ? result : {...result, command, input: path.resolve(args[0])}, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } else if (command === 'workspace') {
    const [operation, input, ...flags] = args;
    if (!['check','affected'].includes(operation) || !input || flags.length % 2) throw new Error('Usage: waxwing workspace <check|affected> <workspace.json> [--source id] [--model id] [--format json|markdown].');
    const options = { sources: [], models: [] }; let format;
    for (let i = 0; i < flags.length; i += 2) {
      if (flags[i] === '--format' && format === undefined && ['json','markdown'].includes(flags[i+1])) format = flags[i+1];
      else if (operation === 'affected' && ['--source','--model'].includes(flags[i]) && flags[i+1] && !flags[i+1].startsWith('--')) options[flags[i] === '--source' ? 'sources' : 'models'].push(flags[i+1]);
      else throw new Error(`Unknown or invalid workspace option ${flags[i]}.`);
    }
    const { loadWorkspace } = await import('../application/workspace.mjs');
    const { affectedModels } = await import('../knowledge/workspace/review.mjs');
    const { workspaceMarkdown } = await import('../presentation/workspace/markdown.mjs');
    const workspace = loadWorkspace(input), report = operation === 'check' ? workspace : affectedModels(workspace, options);
    console.log(format === 'markdown' ? workspaceMarkdown(report).trimEnd() : JSON.stringify(report,null,2));
    process.exitCode = report.ok ? 0 : 1;
  } else if (command === 'skill') {
    if(args.length!==2||args[0]!=='install')throw new Error('Usage: waxwing skill install <skill-directory>.');
    const {installSkill}=await import('./skill/index.mjs');
    console.log(JSON.stringify({ok:true,...installSkill(args[1])},null,2));
  } else if (command === 'build-collection') {
    if(args.length!==2)throw new Error('build-collection requires collection JSON and output directory paths.');
    const {buildCollection}=await import('../application/collection.mjs');
    console.log(JSON.stringify({ok:true,...await buildCollection(args[0],args[1])},null,2));
  } else if (command === 'query') {
    if(args.length<3||(args.length-3)%2)throw new Error('query requires a model, operation, value, and optional flag/value pairs.');
    const options={};
    for(let i=3;i<args.length;i+=2) {
      const key=args[i].slice(2);
      if(!['--limit','--offset','--budget','--kind','--direction','--relation'].includes(args[i])||Object.hasOwn(options,key))throw new Error(`Unknown or repeated query option ${args[i]}.`);
      options[key]=['limit','offset','budget'].includes(key)?Number(args[i+1]):args[i+1];
    }
    const {loadModel}=await import('../application/load-model.mjs');
    const {queryModel}=await import('../knowledge/query/index.mjs');
    console.log(JSON.stringify({ok:true,...queryModel(loadModel(args[0]).model,args[1],args[2],options)},null,2));
  } else if (command === 'build-connected') {
    if (args.length < 4 || (args.length - 4) % 2) throw new Error('build-connected requires model, scan, links (or -), output directory, and optional flag/value pairs.');
    let sourceRoot;
    const rest = [];
    for (let i = 4; i < args.length; i += 2) {
      if (args[i] === '--source-root') {
        if (sourceRoot !== undefined) throw new Error('Repeated --source-root option.');
        sourceRoot = args[i + 1];
      } else rest.push(args[i],args[i + 1]);
    }
    const {buildConnectedSiteFiles} = await import('../application/connected.mjs');
    console.log(JSON.stringify({ok:true,...await buildConnectedSiteFiles(args[0],args[1],args[2] === '-' ? null : args[2],args[3],{...layoutArgs(rest),...(sourceRoot !== undefined ? {sourceRoot} : {})})},null,2));
  } else if (command === 'render-site' || command === 'build-site') {
    if (args.length < 2 || (command === 'render-site' && args.length !== 2)) throw new Error(`${command} requires input and output directory paths.`);
    const { buildSiteFiles, renderSiteFile } = await import('../application/pipeline.mjs');
    const result = command === 'build-site' ? await buildSiteFiles(args[0], args[1], layoutArgs(args.slice(2))) : await renderSiteFile(args[0], args[1]);
    console.log(JSON.stringify({ok:true,...result},null,2));
  } else if (command === 'layout' || command === 'build') {
    if (args.length < 2) throw new Error(`${command} requires input and output paths.`);
    const { layoutModelFile, buildModelFiles } = await import('../application/pipeline.mjs');
    const result = await (command === 'layout' ? layoutModelFile : buildModelFiles)(args[0], args[1], layoutArgs(args.slice(2)));
    console.log(JSON.stringify({ ok: true, ...result }, null, command === 'layout' ? undefined : 2));
  } else if (command === 'render') {
    if (args.length !== 2 && !(args.length === 4 && ['--graph', '--workflow'].includes(args[2]))) throw new Error('render requires JSON 2 and an SVG or HTML output path, optionally --graph or --workflow for SVG.');
    const { renderLayoutFile } = await import('../application/pipeline.mjs');
    const result = await renderLayoutFile(args[0], args[1], args.length === 4 ? { [args[2] === '--workflow' ? 'workflowRef' : 'graphRef']: args[3] } : undefined);
    console.log(JSON.stringify({ ok: true, ...result }));
  } else if (command === 'recover') {
    if (args.length !== 2) throw new Error('recover requires an artifact and a JSON 1 output path.');
    const { recoverModelFile } = await import('../application/pipeline.mjs');
    console.log(JSON.stringify({ ok: true, ...await recoverModelFile(args[0], args[1]) }));
  } else throw new Error(`Unknown command "${command}". Run with --help.`);
} catch (error) {
  if (['discover', 'context', 'read'].includes(command)) {
    const { CONTEXT_PROTOCOL } = await import('../knowledge/context/protocol.mjs');
    console.error(JSON.stringify({ protocolVersion: CONTEXT_PROTOCOL, status: error.status ?? (/^(context requires|Question must|Supply at most|Each clue|Budget must|Unrecognized reference|Corrupted reference|--)/.test(error.message) ? 'invalid_request' : 'runtime_error'), message: error.message, diagnostics: error.diagnostics ?? [] }));
  } else console.error(JSON.stringify({ ok: false, command, ...(args[0] && ['scan','scan-view','scan-check','scan-query','validate','prepare','layout','check-layout','render','recover','build','render-site','build-site','build-connected','build-collection','query'].includes(command) ? {input: path.resolve(args[0])} : {}), message: error.message, diagnostics: error.diagnostics ?? [] }, null, 2));
  process.exitCode = 1;
}
