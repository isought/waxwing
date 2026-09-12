import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateModel } from '../../modules/knowledge/architecture/model.mjs';
import { digest, fail } from '../../modules/knowledge/shared/model.mjs';
import { sourceNavigation } from '../../modules/knowledge/source/navigation.mjs';
import { validateSourceLinks } from '../../modules/knowledge/source-links/index.mjs';

export const selfExamplePaths = [
  'modules/application/pipeline.mjs',
  'modules/application/load-model.mjs',
  'modules/presentation/layout/index.mjs',
  'modules/presentation/render/index.mjs',
];
const repository = new URL('../../', import.meta.url);
const one = (records, description) => {
  if (records.length !== 1) throw new Error(`Expected exactly one ${description}; found ${records.length}. Refresh the curated example instead of guessing.`);
  return records[0];
};
const claim = (status, value, sourceRefs, explanation) => ({ status, value, basis: { sourceRefs, explanation } });

// The overview and its responsibility boundaries are curated. Only the record
// lookup and verification below are mechanical; names do not establish intent.
export function createSelfExample(snapshot) {
  const navigation = sourceNavigation(snapshot);
  const verified = new Map(selfExamplePaths.map(relative => {
    const file = one(snapshot.files.filter(item => item.path === relative && item.status === 'analyzed'), `analyzed file ${relative}`);
    const bytes = fs.readFileSync(new URL(relative, repository));
    if (createHash('sha256').update(bytes).digest('hex') !== file.contentDigest) throw new Error(`Source bytes changed for ${relative}; rescan before attaching this example's rationale.`);
    return [relative, { file, text: bytes.toString('utf8') }];
  }));
  const declaration = (relative, name) => one(snapshot.declarations.filter(record => record.fileRef === verified.get(relative).file.id && record.kind === 'function' && record.name === name), `function ${relative}:${name}`);
  const [pipelinePath, loaderPath, layoutPath, renderPath] = selfExamplePaths;
  const build = declaration(pipelinePath, 'buildModelFiles');
  const helper = declaration(pipelinePath, 'loadAndLayout');
  const loader = declaration(loaderPath, 'loadModel');
  const layout = declaration(layoutPath, 'layoutModel');
  const svg = declaration(renderPath, 'renderSVG');
  const html = declaration(renderPath, 'renderHTML');
  const call = (caller, callee) => {
    const relationship = one(navigation.relationships.filter(item => item.callerRef === caller.id && item.reference.kind === 'call' && item.reference.name === callee.name), `call ${caller.name} → ${callee.name}`);
    const direct = relationship.reference.resolution.status === 'resolved' && relationship.reference.resolution.targets.includes(callee.id);
    const origins = relationship.provenance.filter(origin => origin.resolution.status === 'resolved' && origin.resolution.targets.includes(callee.id));
    if (!direct && origins.length !== 1) throw new Error(`The snapshot does not establish a unique binding or static import origin for ${caller.name} → ${callee.name}.`);
    return { evidenceRefs: [...new Set([relationship.reference.id, ...origins.map(origin => origin.moduleRef)])] };
  };
  const buildHelper = call(build, helper);
  const loadCall = call(helper, loader);
  const layoutCall = call(helper, layout);
  const svgCall = call(build, svg);
  const htmlCall = call(build, html);
  const pipeline = verified.get(pipelinePath);
  const comment = quote => {
    const matches = pipeline.text.split('\n').flatMap((line, i) => line.trim() === `// ${quote}` ? [i + 1] : []);
    return one(matches, `recorded comment ${JSON.stringify(quote)}`);
  };
  const lazyQuote = 'Keep layout imports lazy so preparation, rendering and recovery do not load ELK.';
  const writeQuote = 'Compute and validate all content before replacing any prior output.';
  const lazyLine = comment(lazyQuote), writeLine = comment(writeQuote);
  const sourceLocator = (relative, line) => `${relative} @ sha256:${verified.get(relative).file.contentDigest}${line ? ` : line ${line}` : ''}`;
  const sources = selfExamplePaths.map((relative, i) => ({
    id: ['src-pipeline', 'src-loader', 'src-layout', 'src-render'][i], kind: 'code',
    locator: sourceLocator(relative), description: `Exact source bytes included in ${snapshot.id}; gitHead alone does not identify these bytes.`,
  }));
  sources.push(
    { id: 'src-lazy-comment', kind: 'code', locator: sourceLocator(pipelinePath, lazyLine), description: `Recorded source comment: “${lazyQuote}”` },
    { id: 'src-output-comment', kind: 'code', locator: sourceLocator(pipelinePath, writeLine), description: `Recorded source comment: “${writeQuote}”` },
    { id: 'src-curation', kind: 'fixture', locator: 'experiments/connected-source/fixture.mjs', description: 'Waxwing self-example: authored grouping and selected entry points. The scanner supplies source records; it does not choose these responsibility boundaries.' },
  );
  const entity = (id, label, sourceRef, represents) => ({
    id, label,
    existence: claim('established', true, [sourceRef], 'The cited implementation contains the corresponding callable code.'),
    category: claim('inferred', 'service', ['src-curation', sourceRef], 'The architecture vocabulary uses service for this logical responsibility. This example does not assert a network service or deployment boundary.'),
    abstraction: {
      represents: claim('inferred', represents, ['src-curation', sourceRef], 'A curated responsibility used to answer the scoped build question.'),
      omits: ['Most individual declarations and references, alternate execution paths, and runtime state.'],
      reason: 'Keep the overview useful for locating the responsibility to investigate.', level: 'Logical implementation responsibility',
    },
  });
  const scope = {
    timeframe: 'current', environment: 'Waxwing working-tree source; static inspection', snapshot: snapshot.id, coverage: 'partial',
    question: 'How does the artifact build path connect model loading, layout and rendering?',
    includes: ['The buildModelFiles application entry, its loadAndLayout helper, and selected calls into loading, layout and rendering.'],
    excludes: ['A complete workflow or runtime trace, deployment topology, conditional CLI dispatch, external library implementations, and a claim of cross-file transactional writes.'],
    abstraction: 'A curated overview of logical code responsibilities, connected to an independently generated source explorer.',
  };
  const relationships = [
    ['load-input', 'model-loading', 'Load model', 'loadAndLayout contains the loadModel call; buildModelFiles calls loadAndLayout.'],
    ['place-model', 'layout-engine', 'Place model', 'loadAndLayout calls the local layoutModel binding, whose static awaited-import origin is the exported layoutModel declaration.'],
    ['render-artifacts', 'export-rendering', 'Render SVG / HTML', 'buildModelFiles calls renderSVG and renderHTML through local bindings with explicit static awaited-import origins.'],
  ].map(([id, to, label, explanation]) => ({ id, from: 'application-pipeline', to, kind: 'calls', label, existence: claim('established', true, ['src-pipeline'], `${explanation} This records static connectivity, not runtime execution or call order.`) }));
  const model = {
    schemaVersion: '0.5-draft', id: 'waxwing-connected-build', title: 'Inside a Waxwing build', scope, sources, perspectives: [], groups: [], memberships: [],
    entities: [
      entity('application-pipeline', 'Application pipeline', 'src-pipeline', 'Coordinate loading, layout, rendering and writing artifact files for the selected build path.'),
      entity('model-loading', 'Model loading', 'src-loader', 'Read model input and its document inputs into the model consumed by the application pipeline.'),
      entity('layout-engine', 'Layout', 'src-layout', 'Validate model input and produce validated geometry for the chosen architecture view.'),
      entity('export-rendering', 'Export rendering', 'src-render', 'Produce SVG and HTML representations from an existing layout.'),
    ],
    relationships,
    notes: [
      {
        id: 'why-lazy-layout', subjectRefs: ['application-pipeline', 'layout-engine', 'place-model'], topic: 'rationale', statement: 'Why are layout imports lazy?',
        answer: claim('reported', lazyQuote, ['src-lazy-comment'], 'Quoted from the source comment at the pinned line. This is recorded rationale; the scanner does not infer its author’s intention or measure the resource benefit.'),
      },
      {
        id: 'why-prepare-output', subjectRefs: ['application-pipeline', 'export-rendering', 'render-artifacts'], topic: 'rationale', statement: 'Why prepare all artifact content before writing?',
        answer: claim('reported', writeQuote, ['src-output-comment'], 'Quoted from the source comment at the pinned line. It explains the preparation order and does not assert that multiple output files are replaced as one transaction.'),
      },
      {
        id: 'open-write-recovery', subjectRefs: ['application-pipeline'], topic: 'rationale', statement: 'What recovery guarantee should apply if an output write fails after another output has been replaced?',
        answer: { status: 'unknown', reason: 'The inspected source records preparation order and individual file writes, but does not record the intended recovery guarantee for a partially completed multi-file write. A maintainer can supply the intended boundary and its reason.', sourceRefs: ['src-pipeline', 'src-output-comment'] },
      },
    ],
    graphs: [{ id: 'overview', title: 'Artifact build responsibilities', scope: structuredClone(scope), entityRefs: ['application-pipeline', 'model-loading', 'layout-engine', 'export-rendering'], contextRefs: [], relationshipRefs: relationships.map(item => item.id), membershipRefs: [] }],
    documents: [{
      id: 'reading-guide', title: 'Follow the build into its source', format: 'markdown',
      markdown: fs.readFileSync(new URL('./reading.md', import.meta.url), 'utf8'),
      attachments: [{ kind: 'graph', ref: 'overview' }, { kind: 'node', ref: 'application-pipeline' }], links: [], assets: [],
    }], workflows: [], rootGraphRef: 'overview',
  };
  const validated = validateModel(model);
  if (!validated.ok) fail('Invalid connected self-example model.', validated.diagnostics);
  const link = (id, kind, ref, entry, label, evidenceRefs, rationaleNoteRefs = []) => ({
    id, subject: { kind, ref, graphRef: 'overview' }, entryRef: entry.id, evidenceRefs: [...new Set(evidenceRefs)], label,
    basis: {
      status: 'inferred', explanation: `This example selects ${entry.name} as an implementation entry for the curated overview subject. Its exact record and the cited source occurrences were checked against this snapshot; the responsibility mapping remains an authored interpretation.`,
      sourceRefs: ['src-curation', 'src-pipeline'],
    }, rationaleNoteRefs,
  });
  const links = {
    schemaVersion: '0.1-source-links-draft', modelId: model.id, modelDigest: digest(model), snapshotId: snapshot.id,
    links: [
      link('pipeline-entry', 'node', 'application-pipeline', build, 'Explore buildModelFiles', [build.id, pipeline.file.id, ...buildHelper.evidenceRefs], ['why-lazy-layout', 'why-prepare-output', 'open-write-recovery']),
      link('loader-entry', 'node', 'model-loading', loader, 'Explore loadModel', [loader.id]),
      link('layout-entry', 'node', 'layout-engine', layout, 'Explore layoutModel', [layout.id, pipeline.file.id], ['why-lazy-layout']),
      link('renderer-entry', 'node', 'export-rendering', svg, 'Explore renderSVG', [svg.id, pipeline.file.id], ['why-prepare-output']),
      link('renderer-html-entry', 'node', 'export-rendering', html, 'Explore renderHTML', [html.id, pipeline.file.id], ['why-prepare-output']),
      link('load-call-entry', 'edge', 'load-input', loader, 'Follow the model-loading call', [...buildHelper.evidenceRefs, ...loadCall.evidenceRefs]),
      link('layout-call-entry', 'edge', 'place-model', layout, 'Follow the layout call', [...buildHelper.evidenceRefs, ...layoutCall.evidenceRefs, pipeline.file.id], ['why-lazy-layout']),
      link('svg-call-entry', 'edge', 'render-artifacts', svg, 'Follow the SVG call', [...svgCall.evidenceRefs, pipeline.file.id], ['why-prepare-output']),
      link('html-call-entry', 'edge', 'render-artifacts', html, 'Follow the HTML call', [...htmlCall.evidenceRefs, pipeline.file.id], ['why-prepare-output']),
    ],
  };
  const connected = validateSourceLinks(model, snapshot, links);
  if (!connected.ok) fail('Invalid connected self-example links.', connected.diagnostics);
  return { model, links };
}

export const selfExampleRepository = fileURLToPath(repository);
