import { validateModel } from '../architecture/model.mjs';
import { digest } from '../shared/model.mjs';
import { graphsOf } from '../architecture/graphs.mjs';
import { relationalRecords } from '../relational/index.mjs';

// A canonical record appears once here, independently of how many views show it.
export function modelRecords(model) {
  const collections = model.diagramType === 'sequence'
    ? [['participants','component'],['steps','step'],['blocks','block']]
    : [['entities','component'],['relationships','relationship'],['groups','group'],['memberships','membership'],['perspectives','perspective']];
  const { sources, documents, entities, relationships, participants, steps, blocks, workflows, graphs, groups, memberships, perspectives, notes, tables, columns, constraints, indexes, associations, ...header } = model;
  const entries = [{kind:'model',record:header}, ...(model.diagramType === 'relational' ? relationalRecords(model).map(({kind,record})=>({kind,record})) : collections.flatMap(([key,kind])=>(model[key]??[]).map(record=>({kind,record})))),
    ...(['sequence','relational'].includes(model.diagramType) ? [] : graphsOf(model).filter(g=>g.id!==model.id).map(record=>({kind:'graph',record}))),
    ...(workflows??[]).flatMap(record=>[{kind:'workflow',record},...record.steps.map(step=>({kind:'step',record:step,workflowRef:record.id}))]),
    ...(notes??[]).map(record=>({kind:'note',record})), ...(sources??[]).map(record=>({kind:'source',record})),
    ...(documents??[]).map(({assets,...record})=>({kind:'document',record}))];
  return entries;
}

export function recordText(value) {
  if (typeof value === 'string') return value;
  if (value == null || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key])=>!['assets','data','dataUrl'].includes(key)).map(([,v])=>recordText(v)).filter(Boolean).join(' ');
}

// Kept self-contained so the exact same matching behavior runs in exported HTML.
export function searchRecords(entries, query, {kind='', limit=50, offset=0}={}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return {total:0,results:[]};
  const matches = entries.filter(e=>!kind || e.kind===kind).map(entry=>{
    const label = entry.title.toLowerCase(), text = entry.text.toLowerCase();
    if (!terms.every(t=>`${label} ${text}`.includes(t))) return null;
    const score = (label===query.trim().toLowerCase()?100:0)+terms.reduce((n,t)=>n+(label.includes(t)?10:1),0);
    const position = Math.max(0,text.indexOf(terms.find(t=>text.includes(t))??''));
    const start = Math.max(0,position-65), excerpt = `${start?'…':''}${entry.text.slice(start,start+240)}${entry.text.length>start+240?'…':''}`;
    return {...entry,score,excerpt};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  return {total:matches.length,results:matches.slice(offset,offset+limit)};
}

export function queryModel(model, operation, value, options={}) {
  const validation = validateModel(model);
  if (!validation.ok) { const error=new Error('Invalid model for query.'); error.diagnostics=validation.diagnostics; throw error; }
  if(typeof value!=='string'||!value.trim())throw new Error('Query requires nonempty text or a record ID.');
  const allowed=['limit','offset','budget',...(operation==='search'?['kind']:operation==='neighbors'?['direction','relation']:[])];
  if(Object.keys(options).some(k=>!allowed.includes(k)))throw new Error('Unknown query option.');
  const limit=options.limit??20, offset=options.offset??0, budget=options.budget??12000;
  if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(offset)||offset<0||!Number.isInteger(budget)||budget<256||budget>1000000)throw new Error('Query limit must be 1–1000, offset nonnegative, and budget 256–1000000 characters.');
  const entries=modelRecords(model), found=entries.find(e=>e.record.id===value);
  if(options.kind&&!['model','graph','component','relationship','group','membership','perspective','workflow','step','block','note','source','document','table','column','constraint','index','association'].includes(options.kind))throw new Error(`Unknown record kind "${options.kind}".`);
  let items, semantics='Recorded model knowledge; partial coverage is not proof of absence.';
  if(operation==='search') {
    const index=entries.map(e=>({id:e.record.id,kind:e.kind,title:e.record.title??e.record.label??e.record.id,text:model.diagramType==='relational'?JSON.stringify(e.record):recordText(e.record)}));
    items=searchRecords(index,value,{kind:options.kind,limit:index.length}).results.map(({text,score,...e})=>e);
  } else {
    if(!found)throw new Error(`Unknown record "${value}".`);
    if(operation==='inspect')items=[found];
    else if(operation==='workflow') {
      if(found.kind!=='workflow'&&!(model.diagramType==='sequence'&&value===model.id))throw new Error('workflow requires a workflow ID, or a standalone sequence model ID.');
      items=[{kind:'workflow',record:found.kind==='workflow'?found.record:model}];
      semantics='Explicit modeled order, replies and alternatives; not inferred from connectivity. No duration is implied.';
    } else if(operation==='workflows') {
      items=model.diagramType==='sequence' ? (model.participants.some(p=>p.id===value)?[{kind:'workflow',id:model.id,title:model.title,scope:model.scope,matchingStepRefs:model.steps.filter(s=>[s.from,s.to].includes(value)).map(s=>s.id)}]:[]) : (model.workflows??[]).filter(w=>w.steps.some(s=>[s.from,s.to].includes(value))).map(w=>({kind:'workflow',id:w.id,title:w.title,graphRef:w.graphRef,scope:w.scope,matchingStepRefs:w.steps.filter(s=>[s.from,s.to].includes(value)).map(s=>s.id)}));
    } else if(operation==='neighbors') {
      const direction=options.direction??'both';
      if(!['incoming','outgoing','both'].includes(direction))throw new Error('Direction must be incoming, outgoing, or both.');
      if(model.diagramType==='sequence')throw new Error('Use workflow for sequence order; neighbors queries architecture relationships.');
      if(model.diagramType==='relational') {
        const relations=[...model.constraints.filter(r=>r.kind==='foreign').map(record=>({record,kind:'foreign',from:{tableRef:record.tableRef,columnRefs:record.columnRefs},to:record.references})), ...model.associations.map(record=>({record,kind:record.enforcement,from:record.from,to:record.to}))];
        if(options.relation&&!['foreign','application','inferred'].includes(options.relation))throw new Error('Relational neighbor relation must be foreign, application, or inferred.');
        const at=(endpoint)=>endpoint.tableRef===value||endpoint.columnRefs.includes(value);
        items=relations.filter(r=>(direction!=='incoming'&&at(r.from)||direction!=='outgoing'&&at(r.to)||r.record.id===value)&&(!options.relation||r.kind===options.relation)).map(r=>({relationship:r.record,neighbor:entries.find(e=>e.record.id===(at(r.from)?r.to.tableRef:r.from.tableRef))?.record,from:r.from,to:r.to}));
        semantics='Recorded foreign keys and separately qualified logical associations. Column arrays retain declared order; logical endpoints do not imply positional pairing. No query execution, lineage, or completeness is inferred.';
      } else {
        items=model.relationships.filter(r=>(direction!=='incoming'&&r.from===value||direction!=='outgoing'&&r.to===value)&&(!options.relation||r.kind===options.relation)).map(relationship=>({relationship,neighbor:entries.find(e=>e.record.id===(relationship.from===value?relationship.to:relationship.from))?.record}));
        semantics='Recorded connectivity, including qualified relationships; no execution order or proven behavioral impact is implied.';
      }
    } else throw new Error(`Unknown query operation "${operation}".`);
  }
  const selected=[]; let used=2;
  for(const item of items.slice(offset,offset+limit)) {
    const size=JSON.stringify(item).length+(selected.length?1:0);
    if(used+size>budget)break;
    selected.push(item);used+=size;
  }
  const next=offset+selected.length, omitted=Math.max(0,items.length-next);
  const refs=new Set();
  const walk=v=>{if(!v||typeof v!=='object')return;(v.sourceRefs??[]).forEach(r=>refs.add(r));Object.values(v).forEach(walk);}; selected.forEach(walk);
  return {modelId:model.id,revision:digest(model),scope:model.scope,operation,semantics,total:items.length,offset,results:selected,
    sources:(model.sources??[]).filter(s=>refs.has(s.id)),omitted,truncated:omitted>0,nextOffset:omitted&&selected.length?next:null,
    budget:{characters:budget,used,appliesTo:'Serialized results only; scope, source metadata and envelope are additional.',...(omitted&&!selected.length?{minimumNextItemCharacters:JSON.stringify(items[offset]).length+2,hint:'Increase --budget to retrieve the next complete record.'}:{})}};
}
