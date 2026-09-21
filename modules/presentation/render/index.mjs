import fs from 'node:fs';
import { workflowSVG } from '../workflow/render.mjs';
import { renderSequenceSVG, renderSequenceHTML } from '../sequence/render.mjs';
import { renderRelationalSVG, renderRelationalHTML } from '../relational/render.mjs';
import { inspectReadability } from '../layout/readability.mjs';
import { selectHighlights, cleanViewerSVG, setDiagramFocus } from './highlights.mjs';
import { componentPresentation, previewText } from './presentation.mjs';
import { graphsOf, rootGraph } from '../../knowledge/architecture/graphs.mjs';
import { assertLayout } from './artifacts.mjs';
import { exists, canonical } from '../../knowledge/shared/model.mjs';
import { existenceText, alerts, wrap, edgeLines } from '../shared/model.mjs';
import { renderDocument } from '../documents/markdown.mjs';

export { selectHighlights } from './highlights.mjs';
export { extractLayout, recoverModel, recoverArtifact } from './artifacts.mjs';
const asset = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const svgCSS = asset('diagram.css');
const pageCSS = asset('viewer.css');
const pageJS = `const inspectReadability = ${inspectReadability.toString()};\nconst selectHighlights = ${selectHighlights.toString()};\nconst setDiagramFocus = ${setDiagramFocus.toString()};\nconst cleanViewerSVG = ${cleanViewerSVG.toString()};\n${asset('viewer.js')}`;
export const escapeXML = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const n = (value) => Number(value.toFixed(3));
const attrs = (ref, label) => `class="record" data-ref="${escapeXML(ref)}" tabindex="0" role="button" aria-label="Inspect ${escapeXML(label)}"`;

export function svgMarkup(source, graphRef = rootGraph(source.model), embed = true, skin = 'standard') {
  const model = source.model;
  const graph = graphsOf(model).find((item) => item.id === graphRef);
  if (!graph) throw new Error(`Unknown graph "${graphRef}".`);
  const layout = source.graphs ? source.graphs.find((item) => item.ref === graphRef) : source;
  const entities = new Map(model.entities.map((item) => [item.id, item]));
  const groups = new Map(model.groups.map((item) => [item.id, item]));
  const relationships = new Map(model.relationships.map((item) => [item.id, item]));
  const frames = [...layout.groups].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height).map(({ ref, box }) => {
    const group = groups.get(ref);
    return `<g ${attrs(ref, group.label)}><rect class="frame" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="16"/><text class="frame-title" x="${n(box.x + 22)}" y="${n(box.y + 30)}">${escapeXML(group.label)}</text></g>`;
  }).join('');
  const edges = layout.edges.map((edge) => {
    const relation = relationships.get(edge.ref);
    const route = edge.points.map((point, index) => `${index ? 'L' : 'M'}${n(point.x)},${n(point.y)}`).join(' ');
    return `<g ${attrs(edge.ref, relation.label)}><g class="${exists(relation.existence) ? '' : 'qualified'}"><path class="edge-hit" d="${route}"/><path class="edge-line" d="${route}" marker-end="url(#ww-arrow)"/></g></g>`;
  }).join('');
  const nodes = layout.nodes.map(({ ref, box }) => {
    const entity = entities.get(ref);
    const anchored = layout.layout.readingAnchorRef === ref;
    const titleLines = wrap(entity.label, 26);
    const presentation = componentPresentation(entity);
    const context = graph.contextRefs.includes(ref);
    const flags = alerts({ ...model, memberships: model.memberships.filter((item) => graph.membershipRefs.includes(item.id)) }, entity);
    return `<g ${attrs(ref, entity.label)}${anchored ? ' data-reading-anchor="true"' : ''}><title>${escapeXML(`${entity.label}. ${presentation.roleLabel}. ${presentation.summary}. ${existenceText(entity.existence)}${context ? '. External context' : ''}`)}</title><g class="category-${presentation.role}">
      <rect class="node-box" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="12"/>
      <rect class="node-rail" x="${n(box.x)}" y="${n(box.y + 14)}" width="4" height="${n(box.height - 28)}" rx="2"/>
      <text class="node-category" x="${n(box.x + 18)}" y="${n(box.y + 25)}">${escapeXML(presentation.roleLabel)}</text>
      ${context ? `<text class="node-context" text-anchor="end" x="${n(box.x + box.width - 12)}" y="${n(box.y + 25)}"><title>External context</title>EXT</text>` : ''}
      ${titleLines.map((line, index) => `<text class="node-title" x="${n(box.x + 18)}" y="${n(box.y + 52 + index * 20)}">${escapeXML(line)}</text>`).join('')}
      <text class="node-status node-summary${presentation.existence ? ' node-alert' : ''}" x="${n(box.x + 18)}" y="${n(box.y + 75 + (titleLines.length - 1) * 20)}">${escapeXML(previewText(presentation.existence || presentation.summary, Math.floor((box.width - 36) / 7.2)))}</text>
      <text class="${flags.length ? 'node-alert' : 'node-link'}" x="${n(box.x + 18)}" y="${n(box.y + box.height - 18 - (anchored ? 24 : 0))}">${escapeXML(flags.length ? flags.slice(0, 2).join(' · ') : (model.graphs?.some((item) => item.expands?.graphRef === graphRef && item.expands.nodeRef === ref) ? 'Detailed graph available ↗' : 'Inspect evidence ↗'))}</text>
${anchored ? `      <text class="reading-anchor-cue" x="${n(box.x + 18)}" y="${n(box.y + box.height - 18)}">Start reading here</text>` : ''}
    </g></g>`;
  }).join('');
  const labels = layout.edges.map((edge) => {
    const relation = relationships.get(edge.ref);
    const lines = edgeLines(relation);
    const regularLines = wrap(relation.label, 24).length;
    const box = edge.label;
    return `<g ${attrs(edge.ref, relation.label)}><rect class="edge-label-bg" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="5"/>${lines.map((line, index) => `<text class="edge-label${index >= regularLines ? ' edge-note' : ''}" text-anchor="middle" x="${n(box.x + box.width / 2)}" y="${n(box.y + 18 + index * 18)}">${escapeXML(line)}</text>`).join('')}</g>`;
  }).join('');
  const payload = embed ? Buffer.from(canonical(source), 'utf8').toString('base64') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ww-svg" data-skin="${skin}" data-graph-ref="${escapeXML(graphRef)}" data-theme="light" viewBox="0 0 ${n(layout.canvas.width)} ${n(layout.canvas.height)}" width="${n(layout.canvas.width)}" height="${n(layout.canvas.height)}" role="group" aria-labelledby="ww-title ww-description">
    <title id="ww-title">${escapeXML(graph.title)}</title><desc id="ww-description">${escapeXML(graph.scope.abstraction)} Operation arrows point from actor to resource. Unknowns and disputes are retained in ${embed ? 'embedded JSON 1' : 'the export source'} and the HTML details viewer.</desc>
${embed ? `    <metadata id="waxwing-source" data-encoding="base64">${payload}</metadata>` : ''}
    <style>${svgCSS}</style><defs><marker id="ww-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="arrow" d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>
    ${frames}${edges}${nodes}${labels}
  </svg>`;
}

export function renderSVG(layout, options = {}) {
  if (layout?.diagramType === 'relational') return renderRelationalSVG(layout, options);
  if (layout?.diagramType === 'sequence') return renderSequenceSVG(layout, options);
  assertLayout(layout);
  if (Object.keys(options).some((key) => !['graphRef', 'workflowRef', 'skin'].includes(key))) throw new Error('Unknown SVG render option.');
  if (options.workflowRef !== undefined && options.graphRef !== undefined) throw new Error('Choose either graphRef or workflowRef.');
  const graphRef = options.graphRef ?? rootGraph(layout.model);
  const skin = checkedSkin(options.skin);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${options.workflowRef !== undefined ? workflowSVG(layout, options.workflowRef, true, skin) : svgMarkup(layout, graphRef, true, skin)}\n`;
}

function checkedSkin(value = 'standard') {
  if (!['standard', 'engineering', 'editorial'].includes(value)) throw new Error('Skin must be standard, engineering, or editorial.');
  return value;
}

export function renderHTML(layout, options = {}) {
  if (layout?.diagramType === 'relational') return renderRelationalHTML(layout, options);
  if (layout?.diagramType === 'sequence') return renderSequenceHTML(layout, options);
  assertLayout(layout);
  if (Object.keys(options).some((key) => key !== 'skin')) throw new Error('Unknown HTML render option.');
  const skin = checkedSkin(options.skin);
  const model = layout.model;
  const documents = model.documents ?? [];
  const graph = graphsOf(model).find((item) => item.id === rootGraph(model));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeXML(model.title)} · Waxwing</title><style>${pageCSS}</style></head>
<body data-skin="${skin}">
  <header class="masthead"><a class="brand" href="#" aria-label="Waxwing overview"><span class="brand-mark">w</span> WAXWING <span class="brand-note">SYSTEM EXPLORER</span></a><div class="header-actions">${documents.length ? `<a class="header-link" href="#documents">Documents <span>${documents.length}</span></a>` : ''}<label class="skin-control">Style <select id="skin" aria-label="Visual style">${['standard', 'engineering', 'editorial'].map((value) => `<option value="${value}"${value === skin ? ' selected' : ''}>${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label><button id="theme" aria-label="Switch color theme">Dark theme</button><details class="export-menu"><summary>Export ↓</summary><div class="export-options"><button id="svg-download">Diagram · SVG</button><button id="source-download">Source model · JSON 1</button><button id="layout-download">Layout · JSON 2</button></div></details></div></header>
  <main id="diagram-main">
    <nav id="graph-breadcrumb" aria-label="Graph hierarchy"></nav>
    <div class="eyebrow"><span class="live-dot"></span> CURRENT IMPLEMENTATION <span class="sep">/</span> PARTIAL MODEL</div>
    <div class="title-row"><h1 id="graph-title">${escapeXML(graph.title)}</h1><button id="model-details">Model details ↗</button></div>
    <p class="purpose" id="graph-question">${escapeXML(graph.scope.question)}</p>
    <details class="view-context"><summary>About this view</summary><p class="purpose" id="graph-abstraction">${escapeXML(graph.scope.abstraction)}</p><div class="scope-line" id="graph-scope"></div></details>
    <div id="reading-anchor" class="reading-anchor" hidden><div><span class="detail-key">Start reading here</span><strong id="reading-anchor-name"></strong><p>Reading preference for this view. Arrows retain their operation direction.</p></div><button id="reading-anchor-go">Go to starting node</button></div>
    <div id="workflow-controls" hidden><label>View <select id="diagram-view" aria-label="Diagram view"></select></label><button id="workflow-details" hidden>Workflow entry & order ↗</button></div>
    <section class="map-panel" aria-label="Architecture diagram">
      <div class="map-controls">
      <div class="map-toolbar"><div><span class="toolbar-label">EXPLORE</span><span id="perspective-label"></span></div><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-fit">Fit</button><button id="zoom-read" aria-label="Read at full size">100%</button><button id="zoom-in" aria-label="Zoom in">+</button><span id="zoom-label" aria-live="polite"></span></div></div>
      <div class="highlight-toolbar"><label for="highlight-mode">Highlight</label><select id="highlight-mode"><option value="selection">Selection and direct relationships</option><option value="unknown">Unknown claims</option><option value="disputed">Disputed claims</option><option value="qualified">All qualified claims</option><option value="context">External context</option><option value="calls">Calls</option><option value="reads">Reads</option><option value="writes">Writes</option><option value="publishes">Publishes</option><option value="consumes">Consumes</option></select><button id="highlight-clear">Clear highlights</button><span id="highlight-summary" role="status"></span></div>
      </div><div id="highlight-details" aria-live="polite"></div>
      <div id="map-viewport" tabindex="0" aria-label="Diagram canvas. Use zoom controls; scroll to pan.">${svgMarkup(layout, graph.id, true, skin)}</div>
      <div class="map-caption"><span>Arrows describe operations: actor → resource.</span><span>Position does not imply execution order. Select any element to inspect it.</span></div>
    </section>
    <details id="readability"><summary id="readability-summary">Readability warnings</summary><p>Advisory geometry checks, separate from architectural truth. Fit estimates use this canvas area. No warnings does not prove visual quality.</p><div id="readability-list"></div></details>
    <section id="graph-connections" aria-label="Connections between graph levels"></section>
    <section class="knowledge-section" aria-labelledby="knowledge-heading"><div class="section-heading"><h2 id="knowledge-heading">What remains open</h2><span id="knowledge-count"></span></div><div id="knowledge-list"></div></section>
    <footer><span>Full source travels with this artifact. Qualifications remain intact.</span><span>Waxwing · experimental MVP</span></footer>
  </main>
  <main id="document-reader" hidden aria-label="Documents">
    <div class="document-breadcrumb"><a href="#">← Graph</a><span>/</span><a href="#documents">Documents</a></div>
    <div class="document-workspace"><nav id="document-nav" aria-label="Included documents"></nav><section id="document-content" aria-live="polite"></section></div>
  </main>
${documents.map((doc) => `<template id="ww-document-${escapeXML(doc.id)}"><article class="markdown-body">${renderDocument(doc, model.graphs ? model : model.id)}</article></template>`).join('')}
${(model.graphs ?? []).map((item) => `<template id="ww-graph-${escapeXML(item.id)}">${svgMarkup(layout, item.id, false, skin)}</template>`).join('')}
${(model.workflows ?? []).map((item) => `<template id="ww-workflow-${escapeXML(item.id)}">${workflowSVG(layout, item.id, false, skin)}</template>`).join('')}
  <aside id="inspector" hidden aria-label="Model inspector"><div class="inspector-header"><span>IN DETAIL</span><button id="close-inspector" aria-label="Close details">×</button></div><div id="inspector-content"></div></aside>
  <script>${pageJS}</script>
</body></html>\n`;
}
