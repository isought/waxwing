import { searchRecords, modelRecords, recordText } from '../../knowledge/query/index.mjs';
import { parseMarkdown } from '../../knowledge/documents/markdown.mjs';
import { headingId } from '../documents/markdown.mjs';
import { escapeXML as esc } from '../render/index.mjs';

export function searchIndex(model, destinations) {
  return modelRecords(model).flatMap(({kind,record})=>{
    const base={id:record.id,kind,title:record.title??record.label??record.id,scope:model.scope.snapshot??model.scope.timeframe,
      destinations:destinations.get(record.id)??[{title:'Record catalog · not shown in a diagram',path:`records.html#record-${record.id}`}],text:recordText(record)};
    if(kind!=='document')return [base];
    base.destinations=[{title:base.title,path:`documents/${record.id}.html`}];
    const headings=parseMarkdown(record.markdown).headings, lines=record.markdown.split('\n');
    const preamble=lines.slice(0,headings[0]?.token.map[0]??lines.length).join('\n');
    // Section matches have precise heading destinations; preamble stays on the document.
    return [...(preamble.trim()||!headings.length?[{...base,text:preamble}]:[]),...headings.map((h,i)=>({...base,id:`${record.id}::${h.slug}`,title:h.title===base.title?base.title:`${base.title} · ${h.title}`,
      text:lines.slice(h.token.map[0],headings[i+1]?.token.map[0]??lines.length).join('\n'),
      destinations:[{title:base.title,path:`documents/${record.id}.html#${encodeURIComponent(headingId(record.id,h.slug))}`}]}))];
  });
}

export function searchBody(entries) {
  const kinds=[...new Set(entries.map(e=>e.kind))].sort();
  return `<p class="purpose">Search the included explanations, workflows, evidence and documents.</p><form class="search-form" role="search"><label>Search <input id="global-search" name="q" type="search" placeholder="A component, question, or phrase" autocomplete="off"></label><label>Kind <select id="search-kind" name="kind"><option value="">All records</option>${kinds.map(k=>`<option>${esc(k)}</option>`).join('')}</select></label><button>Search</button></form><p id="search-summary" role="status">Enter words to search this snapshot. All words must match; this is text search.</p><div id="search-results"></div><button id="search-more" hidden>Show more results</button><noscript><p>Interactive search needs JavaScript. Use Contents and the record catalog to browse the included information.</p></noscript>`;
}

export function searchScript(entries) {
  return `const waxwingSearchEntries = ${JSON.stringify(entries).replaceAll('<','\\u003c')};\nconst searchRecords = ${searchRecords.toString()};\n(${searchClient.toString()})();\n`;
}

function searchClient() {
  const input=document.getElementById('global-search'); if(!input)return;
  const kind=document.getElementById('search-kind'), results=document.getElementById('search-results'), summary=document.getElementById('search-summary'), more=document.getElementById('search-more');
  let limit=30;
  const params=new URLSearchParams(location.search);input.value=params.get('q')??'';kind.value=params.get('kind')??'';
  function render(save=false) {
    const query=input.value.trim(), found=searchRecords(waxwingSearchEntries,query,{kind:kind.value,limit});
    results.replaceChildren();
    for(const hit of found.results) {
      const card=document.createElement('article');card.className='search-result';
      const heading=document.createElement('h2');heading.textContent=hit.title;card.append(heading);
      const context=document.createElement('p');context.className='result-context';context.textContent=[hit.siteTitle,hit.kind,hit.scope].filter(Boolean).join(' · ');card.append(context);
      const excerpt=document.createElement('p');excerpt.textContent=hit.excerpt;card.append(excerpt);
      const links=document.createElement('div');links.className='result-links';
      for(const destination of hit.destinations) {const a=document.createElement('a');a.href=destination.path;a.textContent=destination.title;links.append(a);}
      card.append(links);results.append(card);
    }
    summary.textContent=query?`${found.total} matching records or document sections · showing ${found.results.length}. ${found.total?'':'No matching text in this snapshot; this does not establish absence in the system.'}`:'Enter words to search this snapshot. All words must match; this is text search.';
    more.hidden=found.results.length>=found.total;
    if(save) {const p=new URLSearchParams();if(query)p.set('q',query);if(kind.value)p.set('kind',kind.value);try {history.replaceState(history.state,'',location.pathname+(p.size?'?'+p:''));} catch { /* Some local-file policies restrict history; search still works. */ }}
  }
  input.form.onsubmit=e=>{e.preventDefault();limit=30;render(true);};
  input.oninput=()=>{limit=30;render(true);};kind.onchange=()=>{limit=30;render(true);};
  more.onclick=()=>{limit+=30;render();};
  render();
}
