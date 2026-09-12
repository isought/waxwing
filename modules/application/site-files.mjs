import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { recoverModel } from '../presentation/render/artifacts.mjs';
import { canonical, digest } from '../knowledge/shared/model.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const manifestName = 'waxwing-site.json';
const validPath = (p) => typeof p==='string' && /^(?:index\.html|search\.html|records\.html|(?:graphs|workflows|documents)\/[a-z][a-z0-9_-]*\.html|source\/(?:(?:model|layout|snapshot|links)\.json|index\.html)|assets\/(?:site\.(?:css|js)|search\.js))$/.test(p);
const collectionName='waxwing-collection.json';
const collectionPath=p=>['index.html','search.html','collection.json','assets/site.css','assets/search.js'].includes(p)||/^sites\/[a-z][a-z0-9_-]*\//.test(p)&&(p.split('/').slice(2).join('/')===manifestName||validPath(p.split('/').slice(2).join('/')));
function manifestOf(text, collection=false) {
  const manifest = JSON.parse(text);
  const required=collection?['index.html','collection.json']:['index.html','source/model.json','source/layout.json'];
  if (manifest?.schemaVersion !== (collection?'0.1-collection-draft':'0.1-site-draft') || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object' || !required.every(p=>Object.hasOwn(manifest.files,p)) || Object.entries(manifest.files).some(([p,h])=>!(collection?collectionPath(p):validPath(p))||typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))) throw new Error('Invalid Waxwing site manifest.');
  return manifest;
}
function inventory(dir,collection=false) {
  const files = [];
  function walk(base, prefix='') {
    for(const item of fs.readdirSync(base,{withFileTypes:true})) {
      const name = prefix+item.name;
      if(item.isSymbolicLink() || (!item.isDirectory()&&!item.isFile())) throw new Error(`Site contains an unsupported file or symlink: ${name}`);
      if(item.isDirectory()) {
        if(!(collection ? name==='assets'||name==='sites'||/^sites\/[a-z][a-z0-9_-]*(?:\/(?:graphs|workflows|documents|source|assets))?$/.test(name) : ['graphs','workflows','documents','source','assets'].includes(name))) throw new Error(`Site contains an unowned directory: ${name}`);
        walk(path.join(base,item.name),name+'/');
      } else files.push(name);
    }
  }
  walk(dir); return files;
}
function checkSite(dir,collection=false) {
  if(fs.lstatSync(dir).isSymbolicLink()) throw new Error('Site directory must not be a symlink.');
  const name=collection?collectionName:manifestName;
  const actual = inventory(dir,collection);
  if(!actual.includes(name)) throw new Error('Output directory is not a managed Waxwing site. Choose a new or empty directory.');
  const manifest = manifestOf(fs.readFileSync(path.join(dir,name),'utf8'),collection);
  const expected = new Set([...Object.keys(manifest.files),name]);
  if(actual.length!==expected.size || actual.some(p=>!expected.has(p))) throw new Error('Site has added or missing files. Rebuild to a new directory, or restore the generated files.');
  for(const [name,expectedHash] of Object.entries(manifest.files)) if(hash(fs.readFileSync(path.join(dir,name)))!==expectedHash) throw new Error(`Generated site file was modified: ${name}. Rebuild to a new directory, or restore it first.`);
  return manifest;
}
// Resolve an output through existing ancestor symlinks before checking input overlap.
function physical(file) {
  const absolute = path.resolve(file);
  if(fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent=path.dirname(absolute);
  return path.join(physical(parent),path.basename(absolute));
}
export function assertOutsideSite(directory, file) {
  const rel = path.relative(physical(directory),physical(file));
  if(rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))) throw new Error('Recover to a file outside the managed site directory.');
}
export function writeSite(files, directory, {inputFiles=[]}={}) {
  const collection=files.has(collectionName),name=collection?collectionName:manifestName;
  const manifest = manifestOf(files.get(name),collection);
  if(files.size!==Object.keys(manifest.files).length+1 || [...files].some(([p,content])=>p!==name&&(!Object.hasOwn(manifest.files,p)||hash(content)!==manifest.files[p]))) throw new Error('Site files do not match their manifest.');
  const target=path.resolve(directory),actualTarget=physical(target);
  if(target===path.parse(target).root) throw new Error('Cannot publish a site at the filesystem root.');
  for(const input of inputFiles) {
    const actual=physical(input),rel=path.relative(actualTarget,actual);
    if(rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))) throw new Error('Site output must not contain or replace its input files.');
  }
  if(fs.existsSync(target)) {
    if(fs.lstatSync(target).isSymbolicLink()||!fs.statSync(target).isDirectory()) throw new Error('Site output must be a real directory.');
    if(fs.readdirSync(target).length) checkSite(target,collection);
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const staging=fs.mkdtempSync(path.join(path.dirname(target),'.waxwing-site-'));
  const backup=path.join(path.dirname(target),`.waxwing-backup-${randomUUID()}`);
  let moved=false,installed=false;
  try {
    for(const [name,content] of files) {
      const file=path.join(staging,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
    }
    if(fs.existsSync(target)){fs.renameSync(target,backup);moved=true;}
    fs.renameSync(staging,target);installed=true;
  } catch(error) {
    if(moved&&!installed)fs.renameSync(backup,target);
    throw error;
  } finally {
    fs.rmSync(staging,{recursive:true,force:true});
    if(installed&&moved)fs.rmSync(backup,{recursive:true,force:true});
  }
  return {directory:target,index:path.join(target,'index.html'),files:files.size};
}
export function recoverSite(directory) {
  if(fs.existsSync(path.join(directory,collectionName)))throw new Error('A collection contains separate models. Recover a member directory under sites/<id>, not the collection as one model.');
  const dir=path.resolve(directory),manifest=checkSite(dir);
  const layout=JSON.parse(fs.readFileSync(path.join(dir,'source/layout.json'),'utf8'));
  const model=recoverModel(layout);
  const standalone=JSON.parse(fs.readFileSync(path.join(dir,'source/model.json'),'utf8'));
  if(canonical(model)!==canonical(standalone)||digest(model)!==manifest.modelDigest||digest(layout)!==manifest.layoutDigest) throw new Error('Site source snapshots do not match its manifest.');
  return model;
}
