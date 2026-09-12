import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { analyzeSources } from '../modules/analysis/index.mjs';
import { renderSourceHTML } from '../modules/presentation/source/index.mjs';

// Execute the shipped HTML's event handlers. This adapter supplies only the DOM
// and History surfaces they use; visual layout is checked in a real browser.
async function viewer() {
  const content=`export function A(){ B(); }\nexport function B(){ C(); C(); ${Array.from({length:9},(_,i)=>`D${i}();`).join(' ')} }\nexport function C(){}\n${Array.from({length:9},(_,i)=>`function D${i}(){}`).join('\n')}\nA();`;
  const snapshot=await analyzeSources([{path:'main.mjs',content}]);
  const ids=Object.fromEntries(snapshot.declarations.filter(d=>d.kind==='function').map(d=>[d.name,d.id]));
  const connection={id:'entry',entryRef:ids.A,evidenceRefs:[],label:'Service entry',subjectLabel:'Service B',returnURL:'../graphs/service.html',sources:[],basis:{status:'established',explanation:'Explicit entry mapping.',sourceRefs:[]},rationale:[]};
  const html=renderSourceHTML(snapshot,{sourceTexts:{[snapshot.files[0].id]:content},connections:[connection]});
  const elements=new Map(),listeners={},documentListeners={};
  class Element {
    constructor(attrs='',parent=null){this.attributes={};this.dataset={};this.events={};this.children=[];this.parent=parent;this.value='';this.scrollTop=0;this.clientWidth=900;this.checked=false;
      for(const [,k,v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){this.attributes[k]=v;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
      this.open=/\sopen(?:\s|$)/.test(attrs);if(this.attributes.id)elements.set(this.attributes.id,this);
    }
    set innerHTML(v){this.html=v;this.children=[...v.matchAll(/<(?:a|button|details|div|nav|section)\b([^>]*)>/g)].map(m=>new Element(m[1],this));}
    get innerHTML(){return this.html??'';}
    getAttribute(k){return this.attributes[k]??null;} hasAttribute(k){return k in this.attributes;}
    setAttribute(k,v){this.attributes[k]=String(v);} addEventListener(k,f){this.events[k]=f;}
    querySelectorAll(selector){return this.children.filter(e=>selector.startsWith('#')?e.attributes.id===selector.slice(1):selector.startsWith('.')?(e.attributes.class??'').split(' ').includes(selector.slice(1)):selector.startsWith('[')?e.hasAttribute(selector.slice(1,-1)):false);}
    querySelector(s){return this.querySelectorAll(s)[0]??null;}
    closest(s){if(s==='a[href^="#"]')return this.attributes.href?.startsWith('#')?this:null;if(s==='#navigation')return this.parent?.attributes.id==='navigation'?this.parent:null;return null;}
    insertAdjacentHTML(_,s){this.innerHTML+=s;} scrollIntoView(){} focus(){} remove(){}
    click(){const e={target:this,button:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};this.events.click?.(e);if(!e.stopped)documentListeners.click?.(e);}
  }
  const get=id=>{if(!elements.has(id))elements.set(id,new Element(`id="${id}"`));return elements.get(id);};
  get('source-data').textContent=html.match(/<script type="application\/json" id="source-data">(.*?)<\/script>/s)[1];
  const location={hash:'#'+ids.A,search:'?context=entry'},entries=[{state:null,url:location.search+location.hash}];let index=0;
  const update=url=>{location.hash=url.slice(url.indexOf('#'));};
  const history={get state(){return entries[index].state;},replaceState(state,_,url){entries[index]={state:structuredClone(state),url};update(url);},pushState(state,_,url){entries.splice(++index);entries.push({state:structuredClone(state),url});update(url);},back(){if(index){index--;update(entries[index].url);listeners.popstate?.({state:entries[index].state});}},forward(){if(index+1<entries.length){index++;update(entries[index].url);listeners.popstate?.({state:entries[index].state});}}};
  vm.runInNewContext(html.match(/<script>(.*?)<\/script>/s)[1],{URLSearchParams,document:{getElementById:get,addEventListener:(k,f)=>documentListeners[k]=f},window:{location,history,addEventListener:(k,f)=>listeners[k]=f}});
  const nodes=()=>get('detail').children.filter(e=>(e.attributes.class??'').includes('graph-node'));
  const click=name=>{const node=nodes().find(e=>e.attributes.href==='#'+ids[name]);assert.ok(node,`Expected ${name} visible`);node.click();};
  return {get,ids,click,nodes,history,location};
}
test('production navigation A → B → C → B restores expansion and retains A',async()=>{
 const app=await viewer();app.click('B');app.get('detail').querySelector('#expand-graph').click();app.click('C');app.click('B');
 assert.ok(app.nodes().some(e=>e.attributes.href==='#'+app.ids.A));assert.ok(app.nodes().some(e=>e.attributes.href==='#'+app.ids.D8));
 assert.match(app.get('detail').innerHTML,/Browsing trail/);assert.match(app.get('detail').innerHTML,/Return to overview/);assert.equal(app.location.search,'?context=entry');
});
test('production browser Back/Forward restore focus and connected context',async()=>{
 const app=await viewer();app.click('B');app.click('C');app.history.back();assert.equal(app.location.hash,'#'+app.ids.B);assert.match(app.get('detail').innerHTML,/<h1>B<\/h1>/);
 app.history.back();assert.match(app.get('detail').innerHTML,/<h1>A<\/h1>/);app.history.forward();assert.match(app.get('detail').innerHTML,/<h1>B<\/h1>/);
 assert.match(app.get('detail').innerHTML,/href="\.\.\/graphs\/service.html"/);
});
test('production grouped evidence opens without replacing the graph focus',async()=>{
 const app=await viewer();app.click('B');const edge=app.get('detail').children.find(e=>(e.attributes.class??'').includes('graph-edge')&&(e.attributes['aria-label']??'').startsWith('B → C: 2 occurrences'));
 assert.ok(edge);edge.click();assert.equal(app.location.hash,'#'+app.ids.B);assert.match(app.get('connection-evidence').innerHTML,/2 occurrences/);assert.equal((app.get('connection-evidence').innerHTML.match(/class="relationship"/g)??[]).length,2);
});
test('module-scope callers show file names and navigate to file contents',async()=>{
 const app=await viewer();assert.ok(app.nodes().some(e=>e.attributes['aria-label']==='Focus main.mjs'));
 app.nodes().find(e=>e.attributes['aria-label']==='Focus main.mjs').click();assert.match(app.get('detail').innerHTML,/<h1>main.mjs<\/h1>/);assert.match(app.get('detail').innerHTML,/Functions & classes/);
});
