import fs from 'node:fs';
import path from 'node:path';
import { loadModel } from './load-model.mjs';
import { layoutModel } from '../presentation/layout/index.mjs';
import { renderSite, sitePages, siteTargetURL, siteSearchIndex, hashFile } from '../presentation/site/index.mjs';
import { recoverSite, writeSite } from './site-files.mjs';
import { escapeXML as esc } from '../presentation/render/index.mjs';
import { searchBody, searchScript } from '../presentation/site/search.mjs';

export const COLLECTION_VERSION='0.1-collection-draft';
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`${label} must be an object.`);};
const keys=(v,allowed,label)=>{object(v,label);if(Object.keys(v).some(k=>!allowed.includes(k)))throw new Error(`Unknown ${label} field.`);};
const text=(v,label)=>{if(typeof v!=='string'||!v.trim())throw new Error(`${label} must be nonempty text.`);};

// Collection links are publication navigation, never identity merges or new
// architectural claims. Validate them against actual exported destinations.
export async function buildCollection(input, output) {
  const filename=path.resolve(input), config=JSON.parse(fs.readFileSync(filename,'utf8'));
  keys(config,['schemaVersion','title','description','sites','start','links'],'collection');
  if(config.schemaVersion!==COLLECTION_VERSION)throw new Error(`Collection schemaVersion must be ${COLLECTION_VERSION}.`);
  text(config.title,'Collection title');if(config.description!==undefined)text(config.description,'Collection description');
  if(!Array.isArray(config.sites)||!config.sites.length)throw new Error('Collection needs at least one site.');
  if(config.links!==undefined&&!Array.isArray(config.links))throw new Error('Collection links must be an array.');
  const inputs=[filename], entries=[], ids=new Set();
  for(const entry of config.sites) {
    keys(entry,['id','title','description','model','site','layout'],'site');
    if(typeof entry.id!=='string'||!/^[a-z][a-z0-9_-]*$/.test(entry.id)||ids.has(entry.id))throw new Error('Site IDs must be unique lowercase path-safe identifiers.');
    ids.add(entry.id);
    if((entry.model!==undefined)===(entry.site!==undefined))throw new Error(`Site "${entry.id}" needs exactly one model or site path.`);
    text(entry.model??entry.site,'Input path');
    if(entry.title!==undefined)text(entry.title,'Site title');if(entry.description!==undefined)text(entry.description,'Site description');
    const source=path.resolve(path.dirname(filename),entry.model??entry.site);
    let layout;
    if(entry.model!==undefined) {
      if(entry.layout!==undefined)keys(entry.layout,['direction','groupingPerspectiveRef','readingAnchors'],'layout');
      const loaded=loadModel(source);inputs.push(...loaded.inputFiles);
      layout=await layoutModel(loaded.model,entry.layout??{});
    } else {
      if(entry.layout!==undefined)throw new Error('Layout options apply to model inputs, not existing sites.');
      recoverSite(source); // Verify the complete, unchanged export before using it.
      if (fs.existsSync(path.join(source,'source/snapshot.json'))) throw new Error('Connected source sites cannot yet be republished in a collection. Keep the connected site separately; collection regeneration would discard its source evidence.');
      inputs.push(path.join(source,'waxwing-site.json'));
      layout=JSON.parse(fs.readFileSync(path.join(source,'source/layout.json'),'utf8'));
    }
    const files=renderSite(layout);
    entries.push({...entry,title:entry.title??layout.model.title,description:entry.description??layout.model.scope.question,layout,files});
  }
  function resolve(target) {
    keys(target,['site','kind','ref','graphRef','workflowRef','heading'],'link target');
    const entry=entries.find(e=>e.id===target.site);if(!entry)throw new Error(`Unknown collection site "${target.site}".`);
    let local='index.html';
    if(target.kind!==undefined||target.ref!==undefined) {
      if(!['graph','workflow','document','node','edge','step','block'].includes(target.kind))throw new Error('Invalid collection target kind.');
      text(target.ref,'Target ref');
      if(target.heading!==undefined&&target.kind!=='document')throw new Error('Only document targets can name headings.');
      local=siteTargetURL(entry.layout.model,target,'index.html');
    } else if(['graphRef','workflowRef','heading'].some(k=>target[k]!==undefined))throw new Error('Target context requires kind and ref.');
    const [page,fragment]=local.split('#'), html=entry.files.get(page);
    if(!html||fragment&&!html.includes(`id="${decodeURIComponent(fragment)}"`))throw new Error(`Collection target does not exist: ${target.site}/${local}`);
    return {entry,local,path:`sites/${entry.id}/${local}`};
  }
  const start=resolve(config.start??{site:entries[0].id});
  const links=(config.links??[]).map(l=>{
    keys(l,['from','to','label'],'link');text(l.label,'Link label');
    if(l.from?.heading!==undefined)throw new Error('Link from a document page, not an individual heading.');
    return {from:resolve(l.from),to:resolve(l.to),label:l.label};
  });
  const files=new Map(), sites=entries.map(({id,title})=>({id,title}));
  for(const entry of entries) {
    const member=renderSite(entry.layout,{publication:{title:config.title,siteId:entry.id,sites,links:links.filter(l=>l.from.entry.id===entry.id).map(l=>({fromPath:l.from.local,toPath:l.to.path,label:l.label}))}});
    for(const [name,content] of member)files.set(`sites/${entry.id}/${name}`,content);
  }
  files.set('assets/site.css',entries[0].files.get('assets/site.css'));
  const shell=(name,title,body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Waxwing</title><link rel="stylesheet" href="assets/site.css">${name==='search.html'?'<script src="assets/search.js" defer></script>':''}</head><body data-skin="standard"><header class="masthead"><a class="brand" href="index.html"><span class="brand-mark">w</span> WAXWING <span class="brand-note">COLLECTION</span></a><nav class="header-actions"><a class="header-link" href="index.html">Home</a><a class="header-link" href="search.html">Search all</a></nav></header><main><div class="eyebrow">CONNECTED EXPLANATIONS</div><h1>${esc(title)}</h1>${body}<footer>Portable collection · Keep the complete directory together. Each member retains its own model, scope, and source.</footer></main></body></html>\n`;
  files.set('index.html',shell('index.html',config.title,`<p class="purpose">${esc(config.description??'Explore the system, then follow the scenarios that matter.')}</p><section class="start-panel"><div><div class="eyebrow">START HERE</div><h2>${esc(start.entry.title)}</h2><p>${esc(start.entry.description)}</p><a class="primary-link" href="${esc(start.path)}">Open explanation →</a></div><div><h3>One place to explore</h3><p>${entries.length} explanations, each with its own scope and evidence.</p><a href="search.html">Search across all content →</a></div></section><div class="collection-grid">${entries.map((e,i)=>`<section class="collection-card"><div class="eyebrow">${String(i+1).padStart(2,'0')} · ${e.layout.model.diagramType==='sequence'?'SEQUENCE':'ARCHITECTURE'}</div><h2><a href="sites/${e.id}/index.html">${esc(e.title)}</a></h2><p>${esc(e.description)}</p><p class="result-context">${esc(e.layout.model.scope.environment)} · ${esc(e.layout.model.scope.snapshot)}</p><details><summary>Views & documents · ${sitePages(e.layout.model).length}</summary><ol>${sitePages(e.layout.model).map(p=>`<li><a href="sites/${e.id}/${p.path}">${esc(p.title)}</a></li>`).join('')}</ol></details></section>`).join('')}</div><p>Reading order and links organize these explanations. They do not merge component identities or assert architectural relationships.</p>`));
  const index=entries.flatMap(e=>siteSearchIndex(e.layout.model).map(r=>({...r,id:`${e.id}/${r.id}`,siteTitle:e.title,destinations:r.destinations.map(d=>({...d,path:`sites/${e.id}/${d.path}`}))})));
  files.set('search.html',shell('search.html',`Search ${config.title}`,searchBody(index)));
  files.set('assets/search.js',searchScript(index));
  files.set('collection.json',JSON.stringify(config,null,2)+'\n');
  files.set('waxwing-collection.json',JSON.stringify({schemaVersion:COLLECTION_VERSION,title:config.title,sites,
    files:Object.fromEntries([...files].map(([p,c])=>[p,hashFile(c)]))},null,2)+'\n');
  return writeSite(files,output,{inputFiles:inputs});
}
