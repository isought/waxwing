import fs from 'node:fs';
import path from 'node:path';

const topics={
  basics:['Choose the question and model','Investigate and preserve meaning','Shared field rules'],
  architecture:['Architecture JSON 1','Architecture subgraphs'],
  workflows:['Architecture workflows','Scoped entry and trigger'],
  sequence:['Sequence JSON 1','Scoped entry and trigger'],
  behavior:['Sequence loops and if/else'],
  documents:['Markdown documents and references'],
  pipeline:['Run the pipeline','Troubleshooting and completion','Compatibility and maintenance'],
  'example-architecture':['Complete architecture example'],
  'example-scenario':['Complete sequence scenario example'],
  'example-behavior':['Complete sequence behavior example'],
};
const topicDocs = { collections: 'collections.md', queries: 'model-queries.md', workspace: 'workspace.md', scanning: 'source-scanning.md', 'agent-entry': 'agent-entry.md' };

export function guideSections(guide) {
  const sections=new Map();let heading,body=[],fence;
  const finish=()=>{if(heading){if(sections.has(heading))throw new Error(`Repeated guide section: ${heading}`);sections.set(heading,body.join('\n').trim()+'\n');}};
  for(const line of guide.split('\n')) {
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(marker) {
      if(!fence)fence={char:marker[1][0],length:marker[1].length};
      else if(marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;
    }
    const title=!fence&&line.match(/^## (.+)$/);
    if(title){finish();heading=title[1];body=[];}
    if(heading)body.push(line);
  }
  finish();return sections;
}

export function readGuide(root,topic) {
  const sections=guideSections(fs.readFileSync(path.join(root,'AGENT_GUIDE.md'),'utf8'));
  const contents=new Map(Object.entries(topics).map(([name,titles])=>[name,titles.map(title=>{
    if(!sections.has(title))throw new Error(`Missing guide section: ${title}`);return sections.get(title);
  }).join('\n')]));
  for(const [name,file] of Object.entries(topicDocs))contents.set(name,fs.readFileSync(path.join(root,'docs',file),'utf8'));
  if(topic==='list')return JSON.stringify([...contents].map(([name,text])=>({topic:name,characters:text.length})),null,2);
  if(!contents.has(topic))throw new Error(`Unknown guide topic "${topic}". Use guide list.`);
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  return `Waxwing ${version} · ${topic}\nSource: ${path.join(root,Object.hasOwn(topicDocs,topic)?`docs/${topicDocs[topic]}`:'AGENT_GUIDE.md')}\nRun the CLI examples below with the waxwing command or the installed skill adapter; relative documentation links resolve from the source above.\n\n${contents.get(topic)}`;
}
