import fs from 'node:fs';
import { canonical, fail } from '../../knowledge/shared/model.mjs';
import { relationalRecords } from '../../knowledge/relational/index.mjs';
import { modelRecords } from '../../knowledge/query/index.mjs';
import { validateRelationalLayout, relationalConnections, connectionLabel, TABLE_HEADER, COLUMN_HEIGHT } from './layout.mjs';
import { units } from '../shared/model.mjs';

const asset = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const svgCSS = asset('diagram.css');
const pageCSS = asset('viewer.css');
const pageJS = asset('viewer.js');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const n = value => Number(value.toFixed(3));
const recordAttrs = (id, label, className = '') => `class="record ${className}" data-ref="${esc(id)}" tabindex="0" role="button" aria-label="Inspect ${esc(label)}"`;
const short = (text, limit) => units(text) <= limit ? text : [...text].slice(0, Math.max(1, limit - 1)).join('') + '…';
const cardinality = value => `${value.min ?? '?'}..${value.max === 'many' ? '*' : value.max ?? '?'}`;

function checkedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'skin')) throw new Error('Relational rendering accepts only skin.');
  const skin = options.skin ?? 'standard';
  if (!['standard', 'engineering', 'editorial'].includes(skin)) throw new Error('Skin must be standard, engineering, or editorial.');
  return skin;
}

function assertRelationalLayout(layout) {
  const result = validateRelationalLayout(layout);
  if (!result.ok) fail('Relational layout failed validation.', result.diagnostics);
}

export function relationalSVGMarkup(layout, { embed = true, skin = 'standard' } = {}) {
  const model = layout.model;
  const connectionMap = new Map(relationalConnections(model).map(connection => [connection.ref, connection]));
  const edges = layout.edges.map(edge => {
    const connection = connectionMap.get(edge.ref);
    const paths = edge.routes.map((route, index) => {
      const start = route.points[0], end = route.points.at(-1);
      const routePath = `M ${route.points.map(point => `${n(point.x)},${n(point.y)}`).join(' L ')}`;
      return `<path class="edge-hit" d="${routePath}"/><path class="edge-line" d="${routePath}" marker-end="url(#relational-arrow)"/><circle class="column-port" cx="${n(start.x)}" cy="${n(start.y)}" r="3"/><circle class="column-port" cx="${n(end.x)}" cy="${n(end.y)}" r="3"/>${index === 0 ? `<text class="multiplicity" x="${n(start.x + 9)}" y="${n(start.y - 8)}">${esc(cardinality(connection.cardinality.from))}</text><text class="multiplicity" text-anchor="end" x="${n(end.x - 9)}" y="${n(end.y - 8)}">${esc(cardinality(connection.cardinality.to))}</text>` : ''}`;
    }).join('');
    return `<g ${recordAttrs(edge.ref, connection.record.label, `connection ${edge.kind} ${connection.record.evidence.status}`)} data-from="${esc(edge.from)}" data-to="${esc(edge.to)}"><title>${esc(connection.record.label)}. ${esc(edge.kind === 'foreign' ? 'Database foreign key' : `${edge.kind} association`)} · ${esc(connection.record.evidence.status)}. ${connection.fromColumns.length > 1 ? 'Column routes belong to one composite constraint. ' : ''}${esc(connection.cardinality.reason.join(' '))}</title>${paths}</g>`;
  }).join('');
  const tables = layout.tables.map(geometry => {
    const table = model.tables.find(item => item.id === geometry.ref);
    const box = geometry.box;
    const columnRows = geometry.columns.map(columnGeometry => {
      const column = model.columns.find(item => item.id === columnGeometry.ref), row = columnGeometry.box;
      const keys = model.constraints.filter(constraint => constraint.tableRef === table.id && constraint.columnRefs.includes(column.id)).map(constraint => { const key = ({ primary: 'PK', foreign: 'FK', unique: 'UQ' })[constraint.kind]; return key ? key + (['unknown', 'inferred'].includes(constraint.evidence.status) ? '?' : '') : null; }).filter(Boolean);
      const badges = [...new Set(keys)].join(' ');
      const type = short(column.dataType ?? 'type unknown', 25);
      const nameWidth = Math.floor((box.width - 140 - Math.min(180, units(type) * 7)) / 8);
      return `<g ${recordAttrs(column.id, column.label, 'column-row')} data-table="${esc(table.id)}"><title>${esc(column.name)} · ${esc(column.dataType ?? 'Type unknown')} · ${column.nullable === true ? 'Nullable' : column.nullable === false ? 'Not null' : 'Nullability unknown'}${badges ? ` · ${badges}` : ''}</title><rect class="column-bg" x="${n(row.x + 1)}" y="${n(row.y)}" width="${n(row.width - 2)}" height="${COLUMN_HEIGHT}"/><text class="key-badge" x="${n(row.x + 13)}" y="${n(row.y + 21)}">${esc(badges)}</text><text class="column-name" x="${n(row.x + 79)}" y="${n(row.y + 21)}">${esc(short(column.name, nameWidth))}</text><text class="column-type" text-anchor="end" x="${n(row.x + row.width - 33)}" y="${n(row.y + 21)}">${esc(type)}</text><text class="nullable" text-anchor="middle" x="${n(row.x + row.width - 16)}" y="${n(row.y + 21)}">${column.nullable === true ? '○' : column.nullable === false ? '•' : '?'}</text></g>`;
    }).join('');
    return `<g class="table" data-table-ref="${esc(table.id)}"><rect class="table-box" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="9"/><g ${recordAttrs(table.id, table.label, 'table-header')}><title>${esc(table.label)} · ${esc(table.evidence.status)}${table.external ? ' · External table' : ''}</title><path class="table-heading" d="M ${n(box.x + 9)} ${n(box.y)} H ${n(box.x + box.width - 9)} Q ${n(box.x + box.width)} ${n(box.y)} ${n(box.x + box.width)} ${n(box.y + 9)} V ${n(box.y + TABLE_HEADER)} H ${n(box.x)} V ${n(box.y + 9)} Q ${n(box.x)} ${n(box.y)} ${n(box.x + 9)} ${n(box.y)} Z"/><text class="table-name" x="${n(box.x + 15)}" y="${n(box.y + 27)}">${esc(short(table.label, Math.floor((box.width - 32) / 10)))}</text><text class="table-schema" x="${n(box.x + 15)}" y="${n(box.y + 49)}">${esc(short([table.schema, table.name].filter(value => value !== null).join('.'), Math.floor((box.width - 125) / 7)))}</text><text class="table-kind" text-anchor="end" x="${n(box.x + box.width - 15)}" y="${n(box.y + 49)}">${esc(table.external ? 'EXTERNAL' : table.kind === 'materializedView' ? 'MAT. VIEW' : table.kind.toUpperCase())}</text></g>${columnRows || `<text class="column-type" x="${n(box.x + 15)}" y="${n(box.y + TABLE_HEADER + 21)}">No columns recorded</text>`}</g>`;
  }).join('');
  const labels = layout.edges.map(edge => {
    const connection = connectionMap.get(edge.ref), box = edge.label, lines = connectionLabel(connection);
    return `<g ${recordAttrs(edge.ref, connection.record.label, `connection-label ${edge.kind}`)}><rect class="edge-label-bg" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="5"/>${lines.map((line, index) => `<text class="edge-label${index === lines.length - 1 ? ' edge-kind' : ''}" text-anchor="middle" x="${n(box.x + box.width / 2)}" y="${n(box.y + 18 + index * 18)}">${esc(line)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ww-svg relational-svg" data-skin="${esc(skin)}" viewBox="0 0 ${n(layout.canvas.width)} ${n(layout.canvas.height)}" width="${n(layout.canvas.width)}" height="${n(layout.canvas.height)}" role="group" aria-labelledby="relational-title relational-description"><title id="relational-title">${esc(model.title)}</title><desc id="relational-description">Relational model. Established and reported column-level foreign keys are solid; inferred or unknown foreign-key claims use dash-dot routes. Logical application associations are dashed and inferred associations are dotted. Numbers show minimum and maximum related rows; ? means unknown. Multiple paired routes with one label represent one composite foreign key. Source evidence and declared architecture mappings are retained.</desc>${embed ? `<metadata id="waxwing-source" data-encoding="base64">${Buffer.from(canonical(layout), 'utf8').toString('base64')}</metadata>` : ''}<style>${svgCSS}</style><defs><marker id="relational-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path class="arrow" d="M 0 0 L 8 4 L 0 8 z"/></marker></defs>${edges}${tables}${labels}</svg>`;
}

export function renderRelationalSVG(layout, options = {}) {
  const skin = checkedOptions(options);
  assertRelationalLayout(layout);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${relationalSVGMarkup(layout, { skin })}\n`;
}

function fieldHTML(value, key, records) {
  if (value === null) return '<span class="unspecified">Unspecified</span>';
  if (Array.isArray(value)) return value.length ? `<ul>${value.map(item => `<li>${fieldHTML(item, key, records)}</li>`).join('')}</ul>` : '<span class="unspecified">None recorded</span>';
  if (typeof value === 'object') return `<dl>${Object.entries(value).map(([name, item]) => `<div><dt>${esc(name.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt><dd>${fieldHTML(item, name, records)}</dd></div>`).join('')}</dl>`;
  if ((/Refs?$/.test(key) || key === 'id') && records.has(value)) return `<a href="#record=${encodeURIComponent(value)}">${esc(records.get(value).label)}</a>`;
  if (key === 'locator' && typeof value === 'string' && /^https:\/\//i.test(value)) return `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`;
  return `<span>${esc(value)}</span>`;
}

function inspectorHTML(model, entry, records, connections) {
  const record = entry.record, parent = record.tableRef ? records.get(record.tableRef) : null;
  const connection = connections.find(item => item.ref === entry.id);
  const siblings = entry.kind === 'table' ? relationalRecords(model).filter(item => item.record.tableRef === entry.id) : [];
  const uses = model.constraints.filter(item => item.columnRefs.includes(entry.id) || item.references?.columnRefs.includes(entry.id));
  return `<div class="inspector-kind">${esc(entry.kind)}</div><h2>${esc(entry.label)}</h2><p class="record-id">${esc(entry.id)}</p>${parent ? `<p>Table: <a href="#record=${encodeURIComponent(parent.id)}">${esc(parent.label)}</a></p>` : ''}${record.evidence ? `<p class="evidence-status ${esc(record.evidence.status)}">${esc(record.evidence.status)}</p>` : ''}${record.description ? `<p>${esc(record.description)}</p>` : ''}${connection ? `<section><h3>${connection.kind === 'foreign' ? 'Foreign key' : 'Logical association'}</h3><p>${connection.kind === 'foreign' ? 'From referencing columns to referenced columns. All paired routes belong to this one constraint.' : 'This association is separate from database foreign keys.'}</p><p><a href="#record=${encodeURIComponent(connection.from)}">${esc(records.get(connection.from).label)}</a> → <a href="#record=${encodeURIComponent(connection.to)}">${esc(records.get(connection.to).label)}</a></p><dl><div><dt>Referencing rows per target</dt><dd>${esc(cardinality(connection.cardinality.from))}</dd></div><div><dt>Targets per referencing row</dt><dd>${esc(cardinality(connection.cardinality.to))}</dd></div></dl><ul>${connection.cardinality.reason.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></section>` : ''}${siblings.length ? `<section><h3>Table records</h3><nav class="record-links">${siblings.map(item => `<a href="#record=${encodeURIComponent(item.id)}">${esc(item.label)} <small>${esc(item.kind)}</small></a>`).join('')}</nav></section>` : ''}${uses.length ? `<section><h3>Constraints using this column</h3><nav class="record-links">${uses.map(item => `<a href="#record=${encodeURIComponent(item.id)}">${esc(item.label)}</a>`).join('')}</nav></section>` : ''}<section><h3>Recorded details & evidence</h3>${fieldHTML(record, '', records)}</section>`;
}

export function renderRelationalHTML(layout, options = {}) {
  const skin = checkedOptions(options);
  assertRelationalLayout(layout);
  const model = layout.model, entries = modelRecords(model).map(({ kind, record }) => ({ id: record.id, label: record.title ?? record.label ?? record.id, kind, record })), records = new Map(entries.map(entry => [entry.id, entry])), connections = relationalConnections(model);
  const unresolved = entries.filter(entry => entry.record.evidence?.status === 'unknown' || entry.kind === 'column' && (entry.record.dataType === null || entry.record.nullable === null));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(model.title)} · Waxwing</title><style>${pageCSS}</style></head><body data-skin="${esc(skin)}"><header class="masthead"><a class="brand" href="#">w <span>WAXWING</span><small>RELATIONAL EXPLORER</small></a><div class="header-actions"><button id="theme">Dark theme</button><details class="export-menu"><summary>Export ↓</summary><div><button id="svg-download">Diagram · SVG</button><button id="source-download">Source model · JSON</button><button id="layout-download">Layout · JSON</button></div></details></div></header><main id="diagram-main"><div class="eyebrow">RELATIONAL DATA · ${esc(model.scope.coverage)}</div><div class="title-row"><h1>${esc(model.title)}</h1><a href="#record=${encodeURIComponent(model.id)}">Model details ↗</a></div><p class="purpose">${esc(model.scope.question)}</p><p class="scope-line">${esc(model.scope.environment)} · ${esc(model.scope.timeframe)}</p><section class="map-panel" aria-label="Relational diagram"><div class="map-toolbar"><label class="filter-control">Find a table <input id="table-filter" type="search" placeholder="Name or schema" autocomplete="off"></label><label><input id="focus-neighbors" type="checkbox"> Focus selected table & neighbors</label><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-fit">Fit</button><button id="zoom-read">100%</button><button id="zoom-in" aria-label="Zoom in">+</button><output id="zoom-label"></output></div></div><div class="erd-workspace"><nav class="table-explorer" aria-label="Table explorer"><div class="explorer-heading">TABLES <span>${model.tables.length}</span></div><div id="table-list">${model.tables.map(table => `<a href="#record=${encodeURIComponent(table.id)}" data-table-link="${esc(table.id)}">${esc(table.label)}<small>${esc(table.schema ?? 'schema unspecified')} · ${model.columns.filter(column => column.tableRef === table.id).length} columns</small></a>`).join('')}</div><p id="table-filter-summary" role="status"></p></nav><div id="map-viewport" tabindex="0" aria-label="Relational diagram canvas. Scroll to pan; select a table, column or connection for evidence.">${relationalSVGMarkup(layout, { skin })}</div></div><div class="map-caption"><span><b class="legend-key">PK</b> Primary key · <b class="legend-key">FK</b> Foreign key · <b class="legend-key">UQ</b> Unique</span><span>• Not null · ○ Nullable · ? Unknown</span><span>Solid: database FK · Dash-dot: qualified FK · Dashed: application · Dotted: inferred</span></div><p class="cardinality-note">Relationships point from referencing rows to targets. Labels show min..max rows; * means many and ? means unknown. Composite FK routes share one constraint.</p></section><section class="knowledge-section"><h2>What remains open <span>${unresolved.length}</span></h2>${unresolved.length ? `<nav class="open-records">${unresolved.map(entry => `<a href="#record=${encodeURIComponent(entry.id)}">${esc(entry.label)}<small>${esc(entry.record.evidence?.reason ?? 'Type or nullability is unspecified.')}</small></a>`).join('')}</nav>` : '<p>No unknown records are explicitly marked. This does not establish schema completeness.</p>'}</section><details class="record-catalog"><summary>All records & constraints · ${entries.length}</summary><nav>${entries.map(entry => `<a href="#record=${encodeURIComponent(entry.id)}"><span>${esc(entry.label)}</span><small>${esc(entry.kind)}</small></a>`).join('')}</nav></details><footer>Full source travels with this artifact. Repository declarations, observed metadata and inferred relationships retain their evidence.</footer></main><aside id="inspector" hidden aria-label="Model inspector"><div class="inspector-header"><span>IN DETAIL</span><button id="close-inspector" aria-label="Close details">×</button></div><div id="inspector-content" aria-live="polite"></div></aside>${entries.map(entry => `<template id="relational-record-${esc(entry.id)}">${inspectorHTML(model, entry, records, connections)}</template>`).join('')}<script>${pageJS}</script></body></html>\n`;
}
