(() => {
  const data = JSON.parse(document.getElementById('source-data').textContent);
  const files = new Map(data.files.map(f => [f.id, f]));
  const declarations = new Map(data.declarations.map(d => [d.id, d]));
  const records = new Map([...data.files, ...data.declarations, ...data.references, ...data.relationships.map(r => r.reference)].map(r => [r.id, r]));
  const main = document.getElementById('detail'), nav = document.getElementById('navigation');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const callable = d => ['function', 'method'].includes(d.kind);
  const module = r => ['import', 're-export', 'dynamic-import', 'require'].includes(r.kind);
  const link = (id, label) => `<a href="#${esc(id)}">${esc(label ?? records.get(id)?.name ?? records.get(id)?.path ?? id)}</a>`;
  const location = r => {
    const file = files.get(r.fileRef ?? r.id), p = r.span;
    return `${file?.path ?? r.id}${p ? `:${p.start.line}:${p.start.column}–${p.end.line}:${p.end.column}` : ''}`;
  };
  const targets = resolution => resolution.targets.length ? resolution.targets.map(id => {
    const target = records.get(id);
    return `${link(id)} <small>${esc(target?.kind ?? 'file')} · ${esc(target ? location(target) : id)}</small>`;
  }).join('<br>') : '<span class="muted">No indexed target</span>';
  const boundary = r => ['external-builtin', 'external-package-specifier'].includes(r.resolution.reason);
  const qualify = r => `<span class="tag ${esc(r.status)}">${esc(r.status)}</span> ${esc(r.reason)}`;
  const contextId = new URLSearchParams(window.location.search).get('context');
  const context = data.connections.find(item => item.id === contextId);
  let graphLimit = 8, graphMode = 'recommended', trail = [], selectedEdges = [];
  const projectionCache = new Map();
  const reading = id => { if (!projectionCache.has(id)) projectionCache.set(id, readingProjection(data, id)); return projectionCache.get(id); };
  const stateView = () => ({ limit: graphLimit, mode: graphMode, otherOpen: !!main.querySelector('#other-calls')?.open, scroll: main.scrollTop, pageScroll: window.scrollY ?? 0 });
  const routeURL = id => (window.location.search ?? '') + '#' + id;
  function saveView() {
    if (!trail.length) return;
    trail[trail.length - 1] = { ...trail.at(-1), ...stateView() };
    window.history?.replaceState({ sourceTrail: trail, snapshotId: data.snapshotId, contextId }, '', routeURL(locationHash()));
  }
  function navigate(id, reset = false) {
    saveView();
    trail = visitReadingTrail(trail, id, stateView(), reset);
    const entry = trail.at(-1); graphLimit = entry.limit; graphMode = entry.mode;
    window.history?.pushState({ sourceTrail: trail, snapshotId: data.snapshotId, contextId }, '', routeURL(id));
    if (!window.history) window.location.hash = '#' + id;
    render(); main.scrollTop = entry.scroll ?? 0; window.scrollTo?.(0, entry.pageScroll ?? 0);
  }
  function restoreHistory(state) {
    const id = locationHash();
    const valid = state?.snapshotId === data.snapshotId && state.contextId === contextId && Array.isArray(state.sourceTrail) && state.sourceTrail.length && state.sourceTrail.at(-1).id === id && state.sourceTrail.every(e => (!e.id || records.has(e.id)) && ['recommended','occurrences'].includes(e.mode) && Number.isInteger(e.limit) && e.limit >= 1 && e.limit <= 40);
    trail = valid ? state.sourceTrail.map(e => ({...e})) : [{ id, mode: 'recommended', limit: 8, otherOpen: false, scroll: 0 }];
    graphLimit = trail.at(-1).limit; graphMode = trail.at(-1).mode;
    render(); main.scrollTop = trail.at(-1).scroll ?? 0; window.scrollTo?.(0, trail.at(-1).pageScroll ?? 0);
  }
  function occurrenceLabel(reference) {
    const text = data.sourceTexts[reference.fileRef] ?? '';
    const prefix = text.slice(Math.max(0, reference.span.start.offset - 160), reference.span.start.offset);
    return (reference.kind === 'construct' ? 'new ' : '') + (prefix.match(/(?:[\w$]+\.)+$/)?.[0] ?? '') + reference.name;
  }
  function recommendedGraph(record) {
    const projection = reading(record.id);
    let ordered = prioritizeReadingEdges(projection.edges, record.id, trail.map(e => e.id));
    const preferred = new Set(context?.evidenceRefs ?? []);
    ordered = [...ordered.filter(e => e.occurrences.some(id => preferred.has(id))), ...ordered.filter(e => !e.occurrences.some(id => preferred.has(id)))];
    const nodes = new Map([[record.id, { id: record.id, recordRef: record.id, label: record.name, kind: record.kind, role: 'focus' }]]);
    const edges = ordered.slice(0, graphLimit).map(edge => {
      for (const id of [edge.from, edge.to]) if (!nodes.has(id)) {
        const target = records.get(id), file = files.get(target?.fileRef ?? id);
        nodes.set(id, { id, recordRef: id, label: readingRecordLabel(target), path: file?.path, kind: target?.kind ?? 'module scope', role: id === edge.from ? 'caller' : 'target' });
      }
      return { ...edge, referenceRefs: edge.occurrences, referenceRef: edge.occurrences[0], kind: edge.bases.includes('export-origin') ? 'provenance' : 'binding', status: 'resolved', reason: edge.bases.includes('export-origin') ? 'export-binding' : 'compiler-binding' };
    });
    return { focusRef: record.id, nodes: [...nodes.values()], edges, totalRelationships: ordered.length, omittedRelationships: Math.max(0, ordered.length - graphLimit), omittedNodes: 0 };
  }
  function otherCalls(record) {
    const other = reading(record.id).other, groups = new Map();
    for (const item of other) { const key = occurrenceLabel(item.reference) + ' · ' + item.reference.resolution.status; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    return `<details id="other-calls" class="other-calls"${trail.at(-1)?.otherOpen ? ' open' : ''}><summary>Other calls · ${other.length} occurrences in ${groups.size} groups</summary><p>These calls have no resolved internal callable target in this snapshot. This includes unresolved members and calls to parameters or other bindings; it does not establish that they are all built-ins or external.</p>${[...groups].map(([label, items]) => { const index = selectedEdges.push(items.map(i => i.reference.id)) - 1; return `<div class="other-call-row"><code>${esc(label)}</code><button data-evidence="${index}">Inspect ${items.length} occurrence${items.length === 1 ? '' : 's'}</button></div>`; }).join('')}</details>`;
  }

  function sourceExcerpt(record, brief = false) {
    const file = files.get(record.fileRef ?? record.id), text = data.sourceTexts[file?.id];
    if (typeof text !== 'string') return '<p class="muted">Source text is not embedded for this file. The snapshot retains its locations and hash; matching source bytes are needed to read an excerpt.</p>';
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/);
    const selectedStart = record.span?.start.line ?? 1;
    const selectedEnd = record.span ? record.span.end.line - (record.span.end.column === 1 && record.span.end.line > selectedStart ? 1 : 0) : lines.length;
    const first = Math.max(1, selectedStart - (brief ? 1 : 3));
    const last = Math.min(lines.length, Math.max(selectedStart, selectedEnd) + (brief ? 1 : 3), first + (brief ? 8 : 119));
    const contents = lines.slice(first - 1, last).map((line, index) => {
      const number = first + index, selected = number >= selectedStart && number <= selectedEnd;
      return `<span class="source-line${selected ? ' selected-line' : ''}"><span class="line-number" aria-hidden="true">${number}</span><code>${esc(line) || ' '}</code></span>`;
    }).join('');
    return `<div class="excerpt-heading"><span class="tag verified">Verified source bytes</span><span>Lines ${first}–${last}${last < selectedEnd ? ` · excerpt clipped; selection ends at line ${selectedEnd}` : ''}</span></div><pre class="source-code" tabindex="0" aria-label="Source excerpt, lines ${first} through ${last}">${contents}</pre>`;
  }
  function evidence(record, prominent = false) {
    const file = files.get(record.fileRef ?? record.id);
    if (!file || file.status !== 'analyzed') return '';
    const offsets = record.span ? `<p>Selection: lines ${record.span.start.line}–${record.span.end.line} · UTF-16 offsets [${record.span.start.offset}, ${record.span.end.offset}); end is exclusive.</p>` : `<p>${file.byteLength.toLocaleString()} bytes · ${file.textLength.toLocaleString()} UTF-16 code units.</p>`;
    return `<details class="evidence"${prominent ? ' open' : ''}><summary>${prominent ? 'Source evidence' : 'Evidence'} · ${esc(location(record))}</summary>${sourceExcerpt(record, !prominent)}${offsets}<p class="digest">File SHA-256: ${esc(file.contentDigest)}</p><p class="digest">Record: ${esc(record.id)}</p>${prominent ? '' : link(record.id, 'Open occurrence')}</details>`;
  }
  const rows = relationships => relationships.map(({ reference: r, callerRef, provenance }) => `<article class="relationship">
    <div><strong>${link(r.id, r.name)}</strong> <span class="tag">${esc(r.kind)}</span> <small>in ${link(callerRef)}</small></div>
    <p>${module(r) ? 'Module target' : 'Compiler binding'}: ${targets(r.resolution)}</p><p class="muted">${qualify(r.resolution)}</p>
    ${provenance.map(p => `<div class="provenance"><strong>Static value provenance</strong> via ${link(p.bindingRef)}<p>Export ${esc(p.importedName ?? '(unsupported pattern)')}: ${targets(p.resolution)}</p><p>${qualify(p.resolution)} · ${link(p.moduleRef, 'Import evidence')}</p><small>Exported declaration origin; runtime dispatch is not established.</small></div>`).join('')}${evidence(r)}</article>`).join('');

  function section(title, items) {
    const id = `list-${section.next++}`;
    section.pending.push({ id, items });
    return `<section><h2>${esc(title)} <span class="count">${items.length}</span></h2><div id="${id}">${items.length ? rows(items.slice(0, 30)) : '<p class="muted">No recorded relationships in this view.</p>'}</div>${items.length > 30 ? `<button data-more="${id}">Show ${Math.min(30, items.length - 30)} more (${items.length - 30} remaining)</button>` : ''}</section>`;
  }
  function functions(file) {
    const items = data.declarations.filter(d => d.fileRef === file.id && (callable(d) || d.kind === 'class'));
    return `<section><h2>Functions & classes <span class="count">${items.length}</span></h2><div class="function-list">${items.map(d => `<div>${link(d.id)} <small>${esc(d.kind)} · line ${d.span.start.line}</small></div>`).join('') || '<p class="muted">No named functions or classes recorded.</p>'}</div></section>`;
  }
  function sourceSources(refs, sources) {
    return (refs ?? []).map(id => {
      const source = sources.find(source => source.id === id);
      return source ? `<div class="source-origin"><span class="tag">${esc(source.kind)}</span> ${esc(source.description)}<div class="digest">${esc(source.locator)}</div></div>` : `<p class="muted">Source: ${esc(id)}</p>`;
    }).join('');
  }
  function claim(answer, sources) {
    if (!answer) return '<p class="muted">No answer recorded.</p>';
    if (answer.status === 'unknown') return `<p><span class="tag unknown">Unknown</span> ${esc(answer.reason)}</p>${sourceSources(answer.sourceRefs, sources)}`;
    if (answer.status === 'disputed') return `<p><span class="tag unknown">Disputed</span> ${esc(answer.reason)}</p>${(answer.alternatives ?? []).map(alternative => `<div class="alternative">${claim(alternative, sources)}</div>`).join('')}`;
    return `<p><span class="tag">${esc(answer.status)}</span> ${esc(answer.value ?? answer.explanation ?? '')}</p>${answer.basis ? `<p>${esc(answer.basis.explanation)}</p>` : ''}${sourceSources(answer.basis?.sourceRefs ?? answer.sourceRefs, sources)}`;
  }
  function contextPanel(id) {
    let html = '';
    if (context) {
      const sources = context.sources ?? [];
      html = `<section class="context-card"><div class="context-heading"><h2><span class="context-prefix">From</span> ${esc(context.subjectLabel ?? context.label)}</h2><a class="button" href="${esc(context.returnURL)}">← Return to overview</a></div><details class="connection-details"><summary>Why this connection${context.rationale?.length ? ` · ${context.rationale.length} rationale notes` : ''}</summary><p>${esc(context.label)}</p><p>Entry point: ${link(context.entryRef)}</p>${claim(context.basis, sources)}<p>Supporting source occurrences: ${context.evidenceRefs.map(id => link(id)).join(', ') || 'None recorded.'}</p>${context.rationale?.length ? `<div class="rationale"><h3>Recorded rationale</h3>${context.rationale.map(note => `<article><h3>${esc(note.statement)}</h3>${claim(note.answer, sources)}</article>`).join('')}</div>` : '<p class="muted">No rationale recorded for this connection. Code connectivity alone does not establish intention.</p>'}</details></section>`;
    } else if (contextId) html = '<p class="notice">This connection is not available in the current publication. You can still explore the source independently.</p>';
    const reverse = data.connections.filter(item => item.entryRef === id && item.id !== context?.id);
    if (reverse.length) html += `<details class="reverse-connections"><summary>Connected explanations <span class="count">${reverse.length}</span></summary>${reverse.map(item => `<a class="connection-link" href="?context=${encodeURIComponent(item.id)}#${esc(item.entryRef)}"><strong>${esc(item.subjectLabel ?? item.label)}</strong><span>${esc(item.label)}</span></a>`).join('')}</details>`;
    return html;
  }
  function wrapLabel(label, max = 24) {
    const text = String(label), parts = [];
    for (let i = 0; i < Math.min(text.length, max * 2); i += max) parts.push(text.slice(i, i + max));
    if (text.length > max * 2) parts[1] = parts[1].slice(0, -1) + '…';
    return parts.length ? parts : [''];
  }
  function graph(record) {
    const recommended = callable(record) && graphMode === 'recommended';
    const visitedRefs = callable(record) ? reading(record.id).edges.filter(e => trail.some(t => t.id !== record.id && [e.from, e.to].includes(t.id))).flatMap(e => e.occurrences) : [];
    const model = recommended ? recommendedGraph(record) : sourceNeighborhood(data, record.id, { limit: graphLimit, preferredReferenceRefs: [...(context?.evidenceRefs ?? []), ...visitedRefs] });
    if (!model.nodes.length) return '';
    const columns = ['caller', 'focus', 'target', 'origin'].filter(role => model.nodes.some(node => node.role === role));
    const counts = columns.map(role => model.nodes.filter(node => node.role === role).length);
    const narrow = window.matchMedia?.('(max-width:600px)').matches;
    let width = columns.length * 282 + 34, height = Math.max(200, Math.max(...counts) * 110 + 74);
    const positions = new Map();
    for (const [column, role] of columns.entries()) {
      const nodes = model.nodes.filter(node => node.role === role);
      nodes.forEach((node, index) => positions.set(node.id, { x: 28 + column * 282, y: role === 'focus' ? Math.max(57, (height - 80) / 2) : 57 + index * 104 }));
    }
    const captionPositions = new Map(columns.map((role,index) => [role, {x:28 + index * 282,y:25}]));
    if (narrow) {
      width = 340; let cursor = 30;
      for (const role of columns) {
        captionPositions.set(role,{x:82,y:cursor}); cursor += 24;
        for (const node of model.nodes.filter(n => n.role === role)) { positions.set(node.id,{x:82,y:cursor}); cursor += 104; }
        cursor += 16;
      }
      height = cursor;
    }
    const captions = { caller: 'Incoming caller', focus: files.has(model.focusRef) ? 'Selected file' : 'Selected callable / binding', target: recommended ? 'Calls internally' : 'Static binding / boundary', origin: 'Exported value origin' };
    const edgeMarkup = model.edges.map((edge, index) => {
      const from = positions.get(edge.from), to = positions.get(edge.to);
      const forward = to.x > from.x, startX = from.x + (forward ? 228 : 0), endX = to.x + (forward ? 0 : 228);
      const same = edge.from === edge.to;
      const parallel = model.edges.slice(0, index).filter(other => other.from === edge.from && other.to === edge.to).length;
      const shift = parallel * 8, y1 = from.y + 40 + shift, y2 = to.y + 40 + shift;
      // Skip-column edges travel above the node boxes: routing through an
      // intervening node would falsely suggest a relationship with that node.
      const skipsColumn = Math.abs(to.x - from.x) > 282;
      const gutter = 38 + (index % 3) * 4, departure = startX + (forward ? 12 : -12), arrival = endX + (forward ? -12 : 12);
      const path = narrow ? `M ${from.x} ${from.y + 40} L ${18 + index % 4 * 5} ${from.y + 40} L ${18 + index % 4 * 5} ${to.y + (same ? 62 : 40)} L ${to.x} ${to.y + (same ? 62 : 40)}` : same ? `M ${from.x + 170} ${from.y} C ${from.x + 280} ${from.y - 42}, ${from.x + 280} ${from.y + 90}, ${from.x + 228} ${from.y + 56}` : skipsColumn ? `M ${startX} ${y1} L ${departure} ${y1} L ${departure} ${gutter} L ${arrival} ${gutter} L ${arrival} ${y2} L ${endX} ${y2}` : `M ${startX} ${y1} C ${(startX + endX) / 2} ${y1}, ${(startX + endX) / 2} ${y2}, ${endX} ${y2}`;
      const label = edge.kind === 'provenance' ? 'value origin' : edge.kind === 'module' ? 'module' : 'binding';
      const title = `${label} · ${edge.status} · ${edge.reason}. Inspect ${records.get(edge.referenceRef)?.name ?? 'source occurrence'}`;
      const evidenceIndex = selectedEdges.push(edge.referenceRefs ?? [edge.referenceRef]) - 1;
      const count = edge.referenceRefs?.length ?? 1;
      const badge = recommended ? `<g class="edge-count"><rect x="${(narrow ? 41 : (startX + endX) / 2) - 33}" y="${(y1 + y2) / 2 - 10}" width="66" height="20" rx="6"/><text x="${narrow ? 41 : (startX + endX) / 2}" y="${(y1 + y2) / 2 + 4}" text-anchor="middle">${count > 1 ? count + ' calls' : edge.kind === 'provenance' ? 'via import' : '1 call'}</text></g>` : '';
      return `<a href="#${esc(edge.referenceRef)}" data-evidence="${evidenceIndex}" class="graph-edge ${edge.kind}${edge.status !== 'resolved' ? ' qualified' : ''}" aria-label="${esc(readingRecordLabel(records.get(edge.from)) + ' → ' + (records.has(edge.to) ? readingRecordLabel(records.get(edge.to)) : model.nodes.find(node => node.id === edge.to)?.label ?? 'Other call') + ': ' + count + ' occurrences. ' + title)}"><title>${esc(title)}</title><path class="edge-hit" d="${path}"/><path class="edge-line" d="${path}" marker-end="url(#${edge.kind === 'provenance' ? 'origin-arrow' : 'binding-arrow'})"/>${badge}</a>`;
    }).join('');
    const nodeMarkup = model.nodes.map(node => {
      const { x, y } = positions.get(node.id), content = `<title>${esc(node.label)}${node.path ? ' · ' + esc(node.path) : ''}</title><rect x="${x}" y="${y}" width="228" height="80" rx="9"/><text x="${x + 14}" y="${y + 23}" class="node-kind">${esc(recommended && node.role !== 'focus' ? node.path?.split('/').slice(-2).join('/') ?? node.kind : node.kind)}</text><text x="${x + 14}" y="${y + 46}" class="node-label">${wrapLabel(node.label).map((part, index) => `<tspan x="${x + 14}" dy="${index ? 17 : 0}">${esc(part)}</tspan>`).join('')}</text>`;
      return node.recordRef ? `<a href="#${esc(node.recordRef)}" class="graph-node ${node.role}${node.boundary ? ' ' + node.boundary : ''}" aria-label="Focus ${esc(node.label)}">${content}</a>` : `<g class="graph-node ${esc(node.boundary)}">${content}</g>`;
    }).join('');
    const visible = model.totalRelationships - model.omittedRelationships;
    return `<section class="graph-section"><div class="section-heading"><h2>Source neighborhood</h2>${callable(record) ? `<div class="graph-modes" role="group" aria-label="Graph presentation"><button data-mode="recommended" aria-pressed="${recommended}">Recommended</button><button data-mode="occurrences" aria-pressed="${!recommended}">All occurrences</button></div>` : ''}</div><p class="graph-summary">${model.nodes.length} visible nodes · ${model.edges.length} edges · ${visible} of ${model.totalRelationships} ${recommended ? 'connections' : 'occurrences'}</p><p class="graph-description">${files.has(model.focusRef) ? 'Module references around this file.' : recommended ? 'Internal callable connections, grouped by caller and target. Imported value origins retain their binding evidence.' : 'Direct calls and incoming references around the selected callable or binding.'} Select a node to refocus; select an arrow to inspect its occurrence.</p><div class="graph-frame" data-focus-x="${positions.get(model.focusRef)?.x ?? 0}" tabindex="0" aria-label="Scrollable source graph"><svg class="source-graph${narrow ? ' narrow' : ''}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Static source relationships, not execution order"><defs><marker id="binding-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#647b85"/></marker><marker id="origin-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#328476"/></marker></defs>${columns.map((role, index) => `<text x="${captionPositions.get(role).x}" y="${captionPositions.get(role).y}" class="column-label">${captions[role]}</text>`).join('')}${edgeMarkup}${nodeMarkup}</svg></div><div class="graph-legend"><span><i class="legend-line"></i>Compiler binding / module target</span><span><i class="legend-line origin"></i>Static value origin</span><span><i class="legend-box"></i>Unresolved / external boundary</span></div><p class="muted">Arrows record static relationships. They do not establish runtime dispatch, branch conditions, execution order, or intent.</p>${model.omittedNodes ? `<p class="notice">${model.omittedNodes} additional targets are outside this graph's node limit. Inspect occurrence details for all candidates.</p>` : ''}${model.omittedRelationships ? `<p class="notice">${model.omittedRelationships} additional ${recommended ? 'connections' : 'occurrences'} are outside this graph. The relationship lists below retain them.</p>${graphLimit < 40 ? '<button id="expand-graph">Show more connections</button>' : ''}` : ''}${callable(record) ? otherCalls(record) : ''}<div id="connection-evidence" tabindex="-1" aria-live="polite"></div></section>`;
  }
  function diagnosticList(items) {
    return items.map(item => `<p><span class="tag">${esc(item.code ?? 'notice')}</span> ${esc(item.message ?? item.reason ?? String(item))}</p>`).join('');
  }
  function render() {
    section.next = 0; section.pending = []; selectedEdges = [];
    const id = locationHash(), record = records.get(id);
    const selected = record && files.get(record.fileRef ?? record.id);
    const top = `<p class="eyebrow">Snapshot evidence · ${esc(data.source.id)}</p>`;
    let content = contextPanel(id) + (id ? '' : top) + (trail.length > 1 ? `<nav class="browsing-trail" aria-label="Browsing trail"><span>Browsing trail</span>${trail.map((entry, i) => `<a href="#${esc(entry.id)}"${i === trail.length - 1 ? ' aria-current="page"' : ''}>${esc(entry.id ? readingRecordLabel(records.get(entry.id)) : 'Source overview')}</a>`).join('<span>›</span>')}</nav>` : '');
    if (!id) {
      content += `<h1>Explore the source</h1><p class="intro">Start with a file or function, then follow its static relationships. Every connection retains source evidence and its binding qualifications.</p><div class="stats"><div><strong>${data.files.filter(f => f.status === 'analyzed').length}</strong> analyzed files</div><div><strong>${data.declarations.filter(callable).length}</strong> named callables</div><div><strong>${data.files.filter(f => f.status === 'skipped').length}</strong> skipped files</div></div>${data.connections.length ? `<section><h2>Connected entry points</h2><div class="function-list">${data.connections.map(item => `<div><a href="?context=${encodeURIComponent(item.id)}#${esc(item.entryRef)}">${esc(item.label)}</a><small>${esc(item.subjectLabel)}</small></div>`).join('')}</div></section>` : ''}<h2 class="start-heading">Start with a file</h2><p>Use the sidebar to select a path, or search for a function. Source exploration works without an overview or any authored connections.</p>`;
    } else if (!record) content += '<h1>Record not in this snapshot</h1><p>Occurrence identities change when source bytes change.</p><a href="#">Return to source overview</a>';
    else if (files.has(id)) {
      const rels = data.relationships.filter(r => r.reference.fileRef === id);
      content += `<h1>${esc(record.path)}</h1><p>${esc(record.language)} · ${esc(record.status)}${record.reason ? ' · ' + esc(record.reason) : ''}${record.parseStatus ? ' · ' + esc(record.parseStatus) : ''}</p>` + graph(record) + functions(record) +
        section('Repository imports & module occurrences', rels.filter(r => module(r.reference) && r.reference.resolution.status !== 'unresolved')) +
        section('External module boundaries', rels.filter(r => module(r.reference) && boundary(r.reference))) +
        section('Unresolved module occurrences', rels.filter(r => module(r.reference) && r.reference.resolution.status === 'unresolved' && !boundary(r.reference))) +
        section('Incoming module references', data.relationships.filter(r => module(r.reference) && r.reference.resolution.targets.includes(id))) +
        section('Calls in file (including nested functions)', rels.filter(r => !module(r.reference))) + evidence(record);
    } else if (declarations.has(id)) {
      const incoming = data.relationships.filter(r => r.reference.resolution.targets.includes(id) || r.provenance.some(p => p.resolution.targets.includes(id)));
      const p = record.valueProvenance;
      content += `<p class="record-trail">${link(selected.id, selected.path)}</p><div class="record-heading"><h1>${esc(record.name)}</h1><span class="tag">${esc(record.kind)}</span></div><details class="record-metadata"><summary>Lines ${record.span.start.line}–${record.span.end.line} · Source metadata</summary><p>${esc(location(record))}</p><p>Lexical container: ${link(record.containerRef)}</p></details>` + graph(record) +
        (p ? `<section><h2>Static value provenance</h2><p>Export ${esc(p.importedName ?? '(unsupported pattern)')} from ${link(p.moduleRef, 'await import occurrence')}</p><p>${targets(p.resolution)}</p><p>${qualify(p.resolution)}</p></section>` : '') + `<details class="function-source"><summary>Read function source</summary>${evidence(record, true)}</details><details class="all-evidence"><summary>All source occurrences & bindings</summary>` +
        section('Outgoing calls (nearest named callable)', data.relationships.filter(r => r.callerRef === id && !module(r.reference))) + section('Incoming calls & module relationships', incoming) + '</details>';
    } else {
      const rel = data.relationships.find(r => r.reference.id === id);
      content += `<p class="record-trail">${link(selected.id, selected.path)}</p><div class="record-heading"><h1>${esc(record.name)}</h1><span class="tag">${esc(record.kind)}</span></div><details class="record-metadata"><summary>Lines ${record.span.start.line}–${record.span.end.line} · Source metadata</summary><p>${esc(location(record))}</p></details>` + graph(record) + evidence(record, true) + (rel ? rows([rel]) : `<section><h2>Compiler binding</h2><p>${targets(record.resolution)}</p><p>${qualify(record.resolution)}</p></section>`);
    }
    if (selected) {
      const diagnostics = data.diagnostics.filter(d => d.fileRef === selected.id);
      if (diagnostics.length) content += `<section><h2>Diagnostics</h2>${diagnosticList(diagnostics)}</section>`;
    }
    if (data.bridgeDiagnostics.length || data.evidenceDiagnostics.length) content += `<section class="notice"><h2>Connection & evidence notices</h2>${diagnosticList([...data.bridgeDiagnostics, ...data.evidenceDiagnostics])}</section>`;
    content += `<footer><p>${esc(data.semantics)}</p><p>Discovery: ${esc(data.coverage.discovery)} · ${data.coverage.discoveryComplete ? 'complete within declared scope' : 'INCOMPLETE'} · excluded directories: ${esc(data.coverage.excludedDirectories.join(', ') || 'none')}</p><details><summary>Snapshot identity & coverage limits</summary><p class="digest">${esc(data.snapshotId)}</p>${data.limitations.map(l => `<p>${esc(l)}</p>`).join('')}<p>Embedded source excerpts have been checked against this snapshot's file hashes. Search hides local identifiers; the detailed snapshot retains them. Match hashes before applying locations to an edited checkout.</p></details></footer>`;
    main.innerHTML = content;
    main.querySelectorAll?.('[data-mode]').forEach(button => button.addEventListener('click', () => { graphMode = button.dataset.mode; saveView(); const scroll = main.scrollTop; render(); main.scrollTop = scroll; }));
    main.querySelector('#other-calls')?.addEventListener('toggle', saveView);
    main.querySelectorAll?.('[data-evidence]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const items = selectedEdges[Number(button.dataset.evidence)].map(id => data.relationships.find(item => item.reference.id === id)).filter(Boolean);
      const panel = main.querySelector('#connection-evidence');
      panel.innerHTML = `<h2>Connection evidence · ${items.length} occurrences</h2><div class="evidence-rows">${rows(items.slice(0,30))}</div>${items.length > 30 ? '<button class="more-evidence">Show more evidence</button>' : ''}`;
      let shown = 30; panel.querySelector('.more-evidence')?.addEventListener('click', event => { panel.querySelector('.evidence-rows').insertAdjacentHTML('beforeend', rows(items.slice(shown, shown + 30))); shown += 30; if (shown >= items.length) event.target.remove(); });
      panel.scrollIntoView?.({block:'nearest'}); panel.focus?.({preventScroll:true});
    }));
    const graphFrame = main.querySelector('.graph-frame');
    if (graphFrame && !window.matchMedia?.('(max-width:600px)').matches && Number(graphFrame.dataset.focusX) + 256 > graphFrame.clientWidth) graphFrame.scrollLeft = Math.max(0, Number(graphFrame.dataset.focusX) - 24);
    main.querySelector('#expand-graph')?.addEventListener('click', () => { graphLimit = Math.min(40, graphLimit + 8); saveView(); const scroll = main.scrollTop; render(); main.scrollTop = scroll; });
    for (const pending of section.pending) {
      let shown = 30;
      main.querySelector(`[data-more="${pending.id}"]`)?.addEventListener('click', event => {
        document.getElementById(pending.id).insertAdjacentHTML('beforeend', rows(pending.items.slice(shown, shown + 30)));
        shown += 30;
        const remaining = pending.items.length - shown;
        if (remaining <= 0) event.target.remove();
        else event.target.textContent = `Show ${Math.min(30, remaining)} more (${remaining} remaining)`;
      });
    }
    main.scrollTop = 0;
  }
  function locationHash() { return window.location.hash.slice(1); }
  function search() {
    const text = document.getElementById('search').value.toLowerCase();
    const includeSkipped = document.getElementById('show-skipped').checked;
    const matches = data.files.filter(f => (includeSkipped || f.status === 'analyzed') && f.path.toLowerCase().includes(text));
    const named = text ? data.declarations.filter(d => callable(d) && d.name.toLowerCase().includes(text)) : [];
    nav.innerHTML = `<p class="muted">${matches.length} files${text ? ` · ${named.length} functions` : ''}</p>` + matches.map(f => `<div class="nav-item">${link(f.id, f.path)}${f.status === 'skipped' ? '<small>skipped</small>' : ''}</div>`).join('') + named.map(d => `<div class="nav-item">${link(d.id)}<small>${esc(location(d))}</small></div>`).join('');
  }
  const fileBrowser = document.getElementById('file-browser');
  const narrowScreen = window.matchMedia?.('(max-width:1000px)');
  if (fileBrowser && narrowScreen) {
    fileBrowser.open = !narrowScreen.matches;
    narrowScreen.addEventListener('change', event => { fileBrowser.open = !event.matches; });
  }
  document.getElementById('search').addEventListener('input', () => { if (fileBrowser) fileBrowser.open = true; search(); });
  document.getElementById('show-skipped').addEventListener('change', search);
  document.addEventListener?.('click', event => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href^="#"]');
    if (!anchor || anchor.hasAttribute('data-evidence')) return;
    const id = anchor.getAttribute('href').slice(1); if (id && !records.has(id)) return;
    event.preventDefault(); navigate(id, !!anchor.closest('#navigation'));
  });
  window.addEventListener('popstate', event => restoreHistory(event.state));
  window.addEventListener('hashchange', () => { if (trail.at(-1)?.id !== locationHash()) restoreHistory(window.history?.state); });
  window.matchMedia?.('(max-width:600px)').addEventListener('change', () => { const scroll = main.scrollTop; render(); main.scrollTop = scroll; });
  search(); restoreHistory(window.history?.state);
})();
