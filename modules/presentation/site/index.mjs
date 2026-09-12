import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertLayout } from '../render/artifacts.mjs';
import { svgMarkup, escapeXML as esc } from '../render/index.mjs';
import { workflowSVG } from '../workflow/render.mjs';
import { sequenceSVGMarkup, sequenceEntryHTML } from '../sequence/render.mjs';
import { graphsOf, graphNodes } from '../../knowledge/architecture/graphs.mjs';
import { renderDocument, headingId } from '../documents/markdown.mjs';
import { parseMarkdown } from '../../knowledge/documents/markdown.mjs';
import { inspectReadability } from '../layout/readability.mjs';
import { digest } from '../../knowledge/shared/model.mjs';
import { existenceText } from '../shared/model.mjs';
import { selectHighlights, setDiagramFocus } from '../render/highlights.mjs';
import { modelRecords } from '../../knowledge/query/index.mjs';
import { searchIndex, searchBody, searchScript } from './search.mjs';
import { projectSourceLinks } from '../../knowledge/source-links/index.mjs';
import { renderSourceHTML } from '../source/index.mjs';

export const SITE_VERSION = '0.1-site-draft';
export const hashFile = (content) => createHash('sha256').update(content).digest('hex');
const asset = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const title = (record) => record.title ?? record.label ?? record.id;
const anchor = (id) => `record-${id}`;
const relative = (from, to) => path.posix.relative(path.posix.dirname(from), to);

// IDs define publication destinations. Source filesystem locations never do.
export function sitePages(model) {
  const diagrams = model.diagramType === 'sequence'
    ? [{ kind: 'graph', ref: model.id, title: model.title, scope: model.scope }]
    : graphsOf(model).map((g) => ({ kind: 'graph', ref: g.id, title: g.title, scope: g.scope }));
  return [...diagrams, ...(model.workflows ?? []).map((w) => ({ kind: 'workflow', ref: w.id, title: w.title, scope: w.scope })),
    ...(model.documents ?? []).map((d) => ({ kind: 'document', ref: d.id, title: d.title }))]
    .map((p) => ({ ...p, path: `${{graph:'graphs',workflow:'workflows',document:'documents'}[p.kind]}/${p.ref}.html` }));
}

export function siteTargetURL(model, target, from) {
  let kind = target.kind, ref = target.ref, fragment = '';
  if (kind === 'document') {
    if (!(model.documents ?? []).some((d) => d.id === ref)) throw new Error(`Unknown document target "${ref}".`);
    if (target.heading !== undefined) fragment = headingId(ref, target.heading);
  } else if (target.workflowRef || kind === 'step' || kind === 'workflow') {
    ref = kind === 'workflow' ? ref : target.workflowRef ?? model.workflows?.find((w) => w.steps.some((s) => s.id === ref))?.id;
    if (!model.workflows?.some((w) => w.id === ref)) throw new Error(`Unknown workflow for target "${target.ref}".`);
    if (kind !== 'workflow') fragment = anchor(target.ref);
    kind = 'workflow';
  } else {
    if (kind !== 'graph') {
      if (model.diagramType === 'sequence') ref = model.id;
      else if (target.graphRef) ref = target.graphRef;
      else {
        const matches = graphsOf(model).filter((g) => (kind === 'node' ? graphNodes(g) : g.relationshipRefs).includes(ref));
        if (matches.length !== 1) throw new Error(`Target "${ref}" needs an explicit graphRef for site navigation.`);
        ref = matches[0].id;
      }
      fragment = anchor(target.ref);
    }
    kind = 'graph';
  }
  const page = sitePages(model).find((p) => p.kind === kind && p.ref === ref);
  if (!page) throw new Error(`No exported page for ${kind} "${ref}".`);
  return `${page.path === from && fragment ? '' : relative(from, page.path)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

function recordsFor(model, page, drawing) {
  if (model.diagramType === 'sequence') {
    const {participants, steps, blocks, documents, sources, notes, ...scope} = model;
    return [scope, ...participants, ...steps, ...(blocks ?? []), ...notes];
  }
  const graph = graphsOf(model).find((g) => g.id === (page.kind === 'graph' ? page.ref : drawing.graphRef));
  const nodes = page.kind === 'graph' ? graphNodes(graph) : [...new Set(drawing.steps.flatMap((s) => [s.from,s.to]))];
  const relations = page.kind === 'graph' ? graph.relationshipRefs : drawing.steps.map((s) => s.relationshipRef).filter(Boolean);
  const memberships = model.memberships.filter((m) => graph.membershipRefs.includes(m.id));
  // Retain selected memberships and their group definitions, including nested frames.
  const groupRefs = new Set(memberships.flatMap((m) => [m.memberRef, ...(m.group.status === 'unknown' ? [] : m.group.status === 'disputed' ? m.group.alternatives.map(c => c.value) : [m.group.value])]));
  const groups = model.groups.filter((g) => groupRefs.has(g.id));
  const perspectives = model.perspectives.filter((p) => groups.some((g) => g.perspectiveRef === p.id));
  const base = [drawing, ...model.entities.filter((e) => nodes.includes(e.id)), ...model.relationships.filter((r) => relations.includes(r.id)),
    ...memberships, ...groups, ...perspectives, ...(page.kind === 'workflow' ? drawing.steps : [])];
  const ids = new Set(base.map((r) => r.id));
  return [...base, ...model.notes.filter((n) => n.subjectRefs.some((ref) => ids.has(ref)))];
}

function sourcesFor(model, records) {
  const refs = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.sourceRefs)) value.sourceRefs.forEach((id) => refs.add(id));
    for (const child of Object.values(value)) walk(child);
  }
  records.forEach(walk);
  return model.sources.filter((s) => refs.has(s.id));
}

export function siteSearchIndex(model) {
  const destinations=new Map();
  for(const page of sitePages(model).filter(p=>p.kind!=='document')) {
    const drawing=model.diagramType==='sequence'?model:page.kind==='workflow'?model.workflows.find(w=>w.id===page.ref):graphsOf(model).find(g=>g.id===page.ref);
    const records=recordsFor(model,page,drawing);
    for(const r of [...records,...sourcesFor(model,records)]) {
      if(!destinations.has(r.id))destinations.set(r.id,[]);
      const target={title:page.title,path:`${page.path}#${encodeURIComponent(anchor(r.id))}`};
      if(!destinations.get(r.id).some(d=>d.path===target.path))destinations.get(r.id).push(target);
    }
  }
  return searchIndex(model,destinations);
}

function attachmentTargets(model, attachment) {
  if (model.diagramType !== 'sequence' && ['node','edge'].includes(attachment.kind) && !attachment.graphRef && !attachment.workflowRef) {
    return graphsOf(model).filter((g) => (attachment.kind === 'node' ? graphNodes(g) : g.relationshipRefs).includes(attachment.ref))
      .map((g) => ({ ...attachment, graphRef: g.id }));
  }
  return [attachment];
}

function fieldHTML(value, key = '', local = new Map()) {
  if (value === null || typeof value !== 'object') {
    const refField = /Refs?$/.test(key) || ['from','to','replyTo'].includes(key);
    return refField && local.has(value) ? `<a href="#${anchor(value)}">${esc(title(local.get(value)))}</a>` : `<span>${esc(value)}</span>`;
  }
  if (Array.isArray(value)) return value.length ? `<ul>${value.map((v) => `<li>${fieldHTML(v,key,local)}</li>`).join('')}</ul>` : '<span>None recorded</span>';
  const claim = ['established','reported','inferred','unknown','disputed'].includes(value.status);
  return `<div${claim ? ` class="claim" data-status="${value.status}"` : ''}>${claim ? `<span class="status-pill ${value.status}">${value.status}</span>` : ''}<dl>${Object.entries(value).filter(([k]) => !claim || k !== 'status').map(([k,v]) => `<div class="detail-field"><dt class="detail-key">${esc(k.replace(/([a-z])([A-Z])/g,'$1 $2'))}</dt><dd class="detail-value">${fieldHTML(v,k,local)}</dd></div>`).join('')}</dl></div>`;
}

export function renderSite(layout, options = {}) {
  assertLayout(layout);
  if (Object.keys(options).some((k) => !['skin','publication','source'].includes(k))) throw new Error('Unknown site render option. The output structure is fixed.');
  const skin = options.skin ?? 'standard';
  if (!['standard','engineering','editorial'].includes(skin)) throw new Error('Skin must be standard, engineering, or editorial.');
  const model = layout.model, pages = sitePages(model), files = new Map(), destinations = new Map();
  const source = options.source;
  if (source !== undefined && (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(k => !['snapshot','links','sourceTexts','evidenceDiagnostics'].includes(k)))) throw new Error('Invalid site source option.');
  // Connections are optional publication context. Never modify either native model.
  const sourceProjection = source ? projectSourceLinks(model, source.snapshot, source.links) : {links:[],diagnostics:[]};
  const implementationLinks = (from, id, graphRef) => sourceProjection.links.filter(l => l.subject.ref === id && l.subject.graphRef === graphRef).map(l => `<a class="document-card source-connection" href="${esc(relative(from,'source/index.html'))}?context=${encodeURIComponent(l.id)}#${encodeURIComponent(l.entryRef)}">${esc(l.label)} →<span>Source graph · ${esc(l.basis.status)} connection</span></a>`).join('');
  const publication=options.publication;
  const publicationURL=(from,to)=>relative(`sites/${publication.siteId}/${from}`,to);
  const publicationLinks=(from,id)=>!publication?'':publication.links.filter(l=>l.fromPath===`${from}${id?`#${encodeURIComponent(anchor(id))}`:''}`).map(l=>`<a class="document-card" href="${esc(publicationURL(from,l.toPath))}">${esc(l.label)}<span>Related explanation · separate model</span></a>`).join('');
  const json = (v) => JSON.stringify(v,null,2)+'\n';
  files.set('source/model.json',json(model)); files.set('source/layout.json',json(layout));
  if (source) {
    files.set('source/snapshot.json',json(source.snapshot));
    if (source.links != null) files.set('source/links.json',json(source.links));
    files.set('source/index.html',renderSourceHTML(source.snapshot, {
      sourceTexts: source.sourceTexts ?? {},
      connections: sourceProjection.links.map(l => ({...l,returnURL:siteTargetURL(model,l.subject,'source/index.html')})),
      bridgeDiagnostics: sourceProjection.diagnostics,
      evidenceDiagnostics: source.evidenceDiagnostics ?? [],
    }));
  }
  files.set('assets/site.css',asset('../render/viewer.css')+'\n'+asset('site.css'));
  files.set('assets/site.js',`const setDiagramFocus = ${setDiagramFocus.toString()};\n${asset('viewer.js')}`);
  const link = (from,to,label,extra='') => `<a href="${esc(relative(from,to))}" ${extra}>${esc(label)}</a>`;
  const targetLink = (from,t,label) => `<a href="${esc(siteTargetURL(model,t,from))}">${esc(label)}</a>`;
  const breadcrumbs=(page)=>{
    if(model.diagramType==='sequence')return '';
    const graphMap=new Map(graphsOf(model).map(g=>[g.id,g]));
    let current=page.kind==='workflow'?graphMap.get(model.workflows.find(w=>w.id===page.ref).graphRef):page.kind==='graph'?graphMap.get(page.ref):null;
    const chain=[];
    if(page.kind==='workflow'&&current)chain.unshift(targetLink(page.path,{kind:'graph',ref:current.id},current.title));
    while(current?.expands) {const parent=graphMap.get(current.expands.graphRef);chain.unshift(targetLink(page.path,{kind:'node',ref:current.expands.nodeRef,graphRef:parent.id},parent.title));current=parent;}
    return chain.map(a=>`${a}<span>/</span>`).join('');
  };
  const shell = (page,body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="waxwing-artifact" content="site-page"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)} · Waxwing</title><link rel="stylesheet" href="${relative(page.path,'assets/site.css')}"><script src="${relative(page.path,'assets/site.js')}" defer></script></head>
<body data-skin="${skin}"><header class="masthead"><a class="brand" href="${relative(page.path,'index.html')}"><span class="brand-mark">w</span> WAXWING <span class="brand-note">SYSTEM EXPLORER</span></a><div class="header-actions">${publication?`<a class="header-link" href="${esc(publicationURL(page.path,'index.html'))}">${esc(publication.title)}</a>`:''}${link(page.path,'index.html','Contents','class="header-link"')}${link(page.path,'search.html','Search','class="header-link"')}${source?link(page.path,'source/index.html','Explore code','class="header-link"'):''}<label class="skin-control">Style <select id="skin" aria-label="Visual style">${['standard','engineering','editorial'].map((s)=>`<option${s===skin?' selected':''}>${s}</option>`).join('')}</select></label><button id="theme">Dark theme</button><details class="export-menu"><summary>Export ↓</summary><div class="export-options">${link(page.path,'source/model.json','Source model · JSON 1','download')}${link(page.path,'source/layout.json','Layout · JSON 2','download')}</div></details></div></header>
<main><nav class="document-breadcrumb" aria-label="Breadcrumb">${publication?`<a href="${esc(publicationURL(page.path,'index.html'))}">${esc(publication.title)}</a><span>/</span>`:''}${link(page.path,'index.html',model.title)}<span>/</span>${breadcrumbs(page)}<span>${esc(page.title)}</span></nav><div class="eyebrow">CURRENT IMPLEMENTATION · PARTIAL MODEL</div><h1>${esc(page.title)}</h1>${sourceProjection.diagnostics.length?`<p class="source-link-warning" role="status">Source connections unavailable for this export. The system and code views remain available independently. ${esc(sourceProjection.diagnostics.map(d=>d.message).join(' '))}</p>`:''}${body}${publicationLinks(page.path)}${publication?`<nav class="related" aria-label="Collection"><h2>In this collection</h2><a href="${esc(publicationURL(page.path,'search.html'))}">Search all explanations</a>${publication.sites.filter(s=>s.id!==publication.siteId).map(s=>`<a href="${esc(publicationURL(page.path,`sites/${s.id}/index.html`))}">${esc(s.title)}</a>`).join('')}</nav>`:''}<footer><span>Keep this exported directory together. Complete source is in source/.</span><span>Waxwing · experimental MVP</span></footer></main>
<aside id="inspector" hidden aria-label="Record details"><div class="inspector-header"><span>IN DETAIL</span><button id="close-inspector" aria-label="Close details">×</button></div><div id="inspector-content"></div></aside><p id="navigation-error" role="alert" hidden></p></body></html>\n`;

  const cards = (items,from) => items.map((p) => `<a class="document-card" href="${esc(relative(from,p.path))}">${esc(p.title)}<span>${esc(p.scope?.question ?? 'Markdown document')}</span></a>`).join('');
  const start=pages.find(p=>p.kind==='graph'&&p.ref===(model.rootGraphRef??model.id))??pages[0];
  const components=model.entities??model.participants;
  const unknown= modelRecords(model).filter(({record})=>{let hit=false;const walk=v=>{if(!v||typeof v!=='object')return;if(['unknown','disputed'].includes(v.status))hit=true;Object.values(v).forEach(walk);};walk(record);return hit;});
  files.set('index.html',shell({path:'index.html',title:model.title,kind:'Contents'},`<p class="purpose">${esc(model.scope.question)}</p><p>${esc(model.scope.abstraction)}</p><section class="start-panel"><div><div class="eyebrow">START HERE</div><h2>${esc(start.title)}</h2><p>${esc(start.scope?.question??'Explore this explanation.')}</p>${link('index.html',start.path,'Open the overview →','class="primary-link"')}</div><div><h3>This snapshot</h3><p>${esc(model.scope.environment)} · ${esc(model.scope.snapshot)}</p><p>${components.length} components · ${pages.filter(p=>p.kind!=='document').length} views · ${model.documents?.length??0} documents</p>${link('index.html','search.html','Search all content →')}</div></section><details><summary>Key components · ${components.length}</summary><div class="component-summary">${components.map(c=>`<p><a href="records.html#${anchor(c.id)}">${esc(title(c))}</a><span>${esc(c.description??c.abstraction?.represents?.value??c.meaning?.value??'Inspect recorded meaning and qualifications.')}</span></p>`).join('')}</div></details><label class="catalog-search">Find a view or document <input id="catalog-search" type="search" placeholder="Filter by title or question"></label><div id="catalog">${[['graph','Architecture & scenarios'],['workflow','Follow a workflow'],['document','Read the explanation']].filter(([kind])=>pages.some(p=>p.kind===kind)).map(([kind,label])=>`<section><h2>${label}</h2>${cards(pages.filter(p=>p.kind===kind),'index.html')}</section>`).join('')}</div><details><summary>Unknown or disputed knowledge · ${unknown.length} records</summary><p>These records contain unresolved claims; inspect their scope and evidence.</p>${unknown.map(e=>`<p><a href="records.html#${anchor(e.record.id)}">${esc(title(e.record))}</a></p>`).join('')}</details><details><summary>Model scope & omissions</summary>${fieldHTML(model.scope)}</details><p>${link('index.html','records.html','Browse every record')} · Navigation categories organize this export; they do not add architectural relationships.</p>`));

  for (const page of pages) {
    const from = page.path;
    if (page.kind === 'document') {
      const doc = model.documents.find((d) => d.id === page.ref);
      const attachments = doc.attachments.flatMap((a) => {
        const targets = attachmentTargets(model,a);
        return targets.length ? targets.map((t) => targetLink(from,t,`${t.kind}: ${t.ref}${t.graphRef ? ` · ${t.graphRef}` : ''}`)) : [`<span>${esc(a.kind)}: ${esc(a.ref)} (not shown in exported views)</span>`];
      });
      const headings = parseMarkdown(doc.markdown).headings;
      files.set(from,shell(page,`<div class="document-attachments">${attachments.join('')}</div><div class="document-workspace"><nav id="document-nav" aria-label="Document headings">${headings.map((h)=>`<a class="document-nav-link" href="#${encodeURIComponent(headingId(doc.id,h.slug))}">${esc(h.title)}</a>`).join('')}</nav><article class="markdown-body">${renderDocument(doc,model.graphs ? model : model.id,{resolveTarget:(t)=>siteTargetURL(model,t,from)})}<details><summary>Original Markdown</summary><pre>${esc(doc.markdown)}</pre></details></article></div>`));
      continue;
    }
    const sequence = model.diagramType === 'sequence';
    const drawing = sequence ? model : page.kind === 'workflow' ? model.workflows.find((w)=>w.id===page.ref) : graphsOf(model).find((g)=>g.id===page.ref);
    const markup = sequence ? sequenceSVGMarkup(layout,skin,false) : page.kind === 'workflow' ? workflowSVG(layout,page.ref,false,skin) : svgMarkup(layout,page.ref,false,skin);
    const records = recordsFor(model,page,drawing);
    const all = [...new Map([...records,...sourcesFor(model,records)].map((r)=>[r.id,r])).values()];
    for(const r of all) {if(!destinations.has(r.id))destinations.set(r.id,[]);destinations.get(r.id).push({title:page.title,path:`${from}#${encodeURIComponent(anchor(r.id))}`});}
    const local = new Map(all.map((r)=>[r.id,r]));
    const docs = model.documents ?? [];
    const documentLinks = (id) => docs.filter((d)=>d.attachments.some((a)=>a.ref===id && (!a.graphRef || a.graphRef===page.ref) && (!a.workflowRef || a.workflowRef===page.ref))).map((d)=>targetLink(from,{kind:'document',ref:d.id},d.title)).join(' · ');
    const related = sequence ? [] : page.kind === 'workflow' ? pages.filter((p)=>p.kind==='graph'&&p.ref===drawing.graphRef) : pages.filter((p)=>p.kind==='workflow'&&model.workflows.find(w=>w.id===p.ref).graphRef===page.ref || p.kind==='graph'&& (model.graphs?.find(g=>g.id===p.ref)?.expands?.graphRef===page.ref || drawing.expands?.graphRef===p.ref));
    const relations = related.length ? `<nav class="related" aria-label="Related views"><h2>Related views</h2>${related.map((p)=>link(from,p.path,p.title)).join('')}</nav>` : '';
    const recordHTML = all.map((r) => {
      const {id,...fields} = r;
      const attached = documentLinks(id);
      const expansion = !sequence && page.kind==='graph' ? (model.graphs ?? []).filter(g=>g.expands?.graphRef===page.ref&&g.expands.nodeRef===id) : [];
      const participating=!sequence&&model.entities.some(e=>e.id===id)?(model.workflows??[]).filter(w=>w.steps.some(s=>[s.from,s.to].includes(id))):[];
      const statuses = new Set();
      const visit = (v) => { if(!v || typeof v !== 'object') return; if(['unknown','disputed','reported','inferred'].includes(v.status)) statuses.add(v.status); Object.values(v).forEach(visit); }; visit(r);
      const architecture = !sequence && page.kind === 'graph';
      const focus = architecture ? selectHighlights(model,drawing,{ref:id}).refs : [];
      const component = !sequence && model.entities.some(e=>e.id===id);
      const connections = architecture && component ? model.relationships.filter(e=>drawing.relationshipRefs.includes(e.id) && [e.from,e.to].includes(id)) : [];
      const intro = component ? `<section class="component-intro"><h3>Represents</h3><p>${esc(r.abstraction.represents.value ?? r.abstraction.represents.reason ?? `Meaning ${r.abstraction.represents.status}`)}</p><span class="status-pill ${r.abstraction.represents.status}">${esc(r.abstraction.represents.status)}</span></section>` : '';
      const connectionHTML = architecture && component ? `<section class="connection-list"><h3>Direct connections · ${connections.length}</h3>${connections.length ? connections.map(e=>`<a class="connection-link" href="#${anchor(e.id)}">${esc(title(local.get(e.from)))} → ${esc(title(local.get(e.to)))}<span>${esc(e.label)}${e.existence.status !== 'established' || !e.existence.value ? ` · ${esc(existenceText(e.existence))}` : ''}</span></a>`).join('') : '<p class="purpose">No direct relationships recorded in this view.</p>'}</section>` : '';
      const relatedClaims = component ? records.filter(other=>other.memberRef===id || other.subjectRefs?.includes(id)) : [];
      const evidence = fieldHTML(fields,'',local) + (relatedClaims.length ? `<section class="detail-section"><h3>Related claims</h3>${relatedClaims.map(other=>`<div class="sub-record">${fieldHTML(other,'',local)}</div>`).join('')}</section>` : '');
      return `<details class="record-detail" data-statuses="${[...statuses].join(' ')}" data-focus-refs="${esc(JSON.stringify(focus))}" id="${anchor(id)}"><summary>${esc(title(r))} <span class="record-id">${esc(id)}</span></summary><div class="record-body"><h2>${esc(title(r))}</h2><p class="record-id">${esc(id)}</p>${intro}${page.kind==='graph'?implementationLinks(from,id,page.ref):''}${expansion.map(g=>`<div class="explore-child">${targetLink(from,{kind:'graph',ref:g.id},`Explore ${g.title} →`)}</div>`).join('')}${component&&!expansion.length&&!sourceProjection.links.some(l=>l.subject.ref===id&&l.subject.graphRef===page.ref)&&page.kind==='graph'?'<p class="detail-key">No internal detail view included here.</p>':''}${participating.length?`<section class="related"><h3>Workflows involving this component</h3>${participating.map(w=>targetLink(from,{kind:'node',ref:id,workflowRef:w.id},w.title)).join('')}</section>`:''}${publicationLinks(from,id)}${connectionHTML}${attached?`<div class="attached-documents">Documents: ${attached}</div>`:''}${component ? `<details class="component-evidence"><summary>Claims & evidence</summary>${evidence}</details>` : evidence}</div></details>`;
    }).join('');
    const caption = page.kind==='workflow' ? 'Follow the explicit order. Repeated boxes share one component ID. Spacing does not represent duration.' : sequence ? 'Read top to bottom within each body; loop frames repeat and if/else arms are alternatives. Spacing does not represent duration.' : 'Arrows describe operations: actor → resource. Position does not imply execution order.';
    const geometry = sequence ? null : page.kind === 'graph' ? (layout.graphs?.find(g=>g.ref===page.ref) ?? layout) : (() => {const g=layout.workflows.find(w=>w.ref===page.ref);return {...g,groups:[],edges:g.edges.map(e=>({...e,from:e.fromAppearanceRef,to:e.toAppearanceRef}))};})();
    const warnings = geometry ? inspectReadability(geometry,page.ref) : [];
    const anchorRef = page.kind === 'graph' ? geometry?.layout.readingAnchorRef : undefined;
    const anchorHTML = anchorRef ? `<div class="reading-anchor"><div><span class="detail-key">Start reading here</span><strong>${esc(title(local.get(anchorRef)))}</strong><p>Reading preference for this view. Arrows retain their operation direction.</p></div><a class="header-link" id="reading-anchor-go" href="#${anchor(anchorRef)}">Go to starting node</a></div>` : '';
    const warningHTML = geometry ? `<details><summary>Readability warnings (${warnings.length})</summary><p>Advisory checks at a reference viewport of 1200 × 520; they do not establish architectural truth or guarantee readability.</p><ul>${warnings.map(w=>`<li>${esc(w.message)} ${esc(w.refs.join(', '))}</li>`).join('')}</ul></details>` : '';
    const claimHighlights = !sequence && page.kind==='graph' ? Object.fromEntries(['unknown','disputed','qualified'].map(mode=>[mode,selectHighlights(model,drawing,{mode}).refs])) : {};
    files.set(from,shell(page,`<p class="purpose">${esc(page.scope.question)}</p><details class="view-context"><summary>About this view</summary><p class="purpose">${esc(page.scope.abstraction)}</p><div class="scope-line">${esc(page.scope.environment)} · ${esc(page.scope.snapshot)}</div><p>${documentLinks(page.ref)}</p></details>${sequence ? sequenceEntryHTML(model, `#${anchor(model.id)}`) : anchorHTML}${!sequence&&page.kind==='graph'?`<div id="overview-guide" class="overview-guide" hidden><p>Overview · Choose a component to read its detail at full size.</p><nav aria-label="Components in this view">${model.entities.filter(e=>graphNodes(drawing).includes(e.id)).map(e=>`<a href="#${anchor(e.id)}">${esc(title(e))}</a>`).join('')}</nav></div>`:''}<section class="map-panel" aria-label="${esc(page.kind)} diagram"><div class="map-controls"><div class="map-toolbar"><div><span class="toolbar-label">EXPLORE</span><a href="#${anchor(drawing.id)}">Scope & evidence</a></div><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-fit">${!sequence && page.kind === 'graph' ? 'Fit' : 'Fit width'}</button><button id="zoom-read">100%</button><button id="zoom-in" aria-label="Zoom in">+</button><span id="zoom-label" aria-live="polite"></span></div></div><div class="highlight-toolbar"><label>Highlight <select id="highlight"><option value="">${!sequence && page.kind==='graph' ? 'Selection & connections' : 'Selection'}</option><option value="unknown">Unknown claims</option><option value="disputed">Disputed claims</option><option value="qualified">All qualified claims</option></select></label><span id="highlight-count" role="status"></span></div></div><div id="map-viewport" data-claim-highlights="${esc(JSON.stringify(claimHighlights))}" tabindex="0" aria-label="Diagram canvas; scroll to pan">${markup}</div><div class="map-caption"><span>${caption}</span><span>${!sequence && page.kind==='graph' ? 'Select a component to explore its connections and evidence.' : 'Select a record for evidence and documents.'}</span></div></section>${warningHTML}${relations}<section class="evidence"><h2>Records & evidence</h2><p>Complete claims for the records included here. Inspect scope and qualifications before drawing conclusions.</p>${recordHTML}</section>`));
  }
  const catalog=modelRecords(model), localCatalog=new Map(catalog.map(e=>[e.record.id,e.record]));
  files.set('records.html',shell({path:'records.html',title:'Record catalog',kind:'Records'},`<p class="purpose">Every canonical record, including knowledge outside the drawn views.</p>${catalog.map(({kind,record:r})=>`<details class="record-detail" data-statuses="" data-focus-refs="[]" id="${anchor(r.id)}"><summary>${esc(title(r))} · ${esc(kind)}</summary><div class="record-body"><h2>${esc(title(r))}</h2><nav class="related">${(destinations.get(r.id)??[]).map(d=>link('records.html',d.path,d.title)).join('')}${kind==='document'?link('records.html',`documents/${r.id}.html`,'Read document'):''}${!destinations.has(r.id)&&kind!=='document'?'<p>Not shown in an exported diagram.</p>':''}</nav>${fieldHTML(r,'',localCatalog)}</div></details>`).join('')}`));
  const index=searchIndex(model,destinations);
  files.set('search.html',shell({path:'search.html',title:'Search',kind:'Search'},searchBody(index)).replace('</head>','<script src="assets/search.js" defer></script></head>'));
  files.set('assets/search.js',searchScript(index));
  const manifest = {schemaVersion:SITE_VERSION,modelDigest:digest(model),layoutDigest:digest(layout),pages:pages.map(({kind,ref,path,title})=>({kind,ref,path,title})),files:Object.fromEntries([...files].map(([p,c])=>[p,hashFile(c)]))};
  files.set('waxwing-site.json',json(manifest));
  return files;
}
