import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence='G:/My Drive/GNC/AgData/Release Evidence';
const git=(args,input)=>execFileSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
if(!/github\.com[/:]collygedylan\/GNC-Sales-Command-PRO-(?:\.git)?$/.test(git(['remote','get-url','origin'])))throw Error('TEST_RELEASE_REMOTE_MISMATCH');
git(['fetch','origin','gh-pages']);
const baseline=git(['rev-parse','origin/gh-pages']),sourceCommit=git(['rev-parse','HEAD']);
const output=path.join(root,'_site/test');
const deployment=JSON.parse(await fs.readFile(path.join(output,'deployment.json'),'utf8'));
await fs.writeFile(path.join(output,'deployment.json'),JSON.stringify({...deployment,testSourceCommit:sourceCommit,testPublishedAt:new Date().toISOString()})+'\n');
async function files(dir){return(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async entry=>{if(entry.isSymbolicLink())throw Error('TEST_ARTIFACT_SYMLINK');const full=path.join(dir,entry.name);return entry.isDirectory()?files(full):[full];}))).flat();}
const publicFiles=(await files(output)).sort();
if(publicFiles.some(f=>/\.(sql|ts|gs|env)$/.test(f)||/(?:credentials|secrets|node_modules)/i.test(path.relative(output,f))))throw Error('TEST_PRIVATE_ARTIFACT');
const hashes=git(['hash-object','-w','--stdin-paths'],publicFiles.map(f=>JSON.stringify(path.relative(root,f).replaceAll('\\','/'))).join('\n')+'\n').split('\n');
const tree={};for(let i=0;i<publicFiles.length;i++){const parts=path.relative(output,publicFiles[i]).split(path.sep);let node=tree;for(const part of parts.slice(0,-1))node=node[part]??={};node[parts.at(-1)]=hashes[i];}
function writeTree(node){return git(['mktree'],Object.entries(node).map(([name,value])=>typeof value==='string'?'100644 blob '+value+'\t'+name:'040000 tree '+writeTree(value)+'\t'+name).join('\n')+'\n');}
const testTree=writeTree(tree),baseEntries=git(['ls-tree',baseline]).split('\n').filter(Boolean),productionEntries=baseEntries.filter(line=>line.split('\t')[1]!=='test');
const rootTree=git(['mktree'],productionEntries.concat('040000 tree '+testTree+'\ttest').join('\n')+'\n');
const commit=git(['commit-tree',rootTree,'-p',baseline], 'Publish AgData Test (T) only from '+sourceCommit+'\n');
const changed=git(['diff','--name-only',baseline,commit]).split('\n').filter(Boolean);if(changed.some(p=>!p.startsWith('test/')))throw Error('PRODUCTION_TREE_CHANGE');
const after=git(['ls-tree',commit]).split('\n').filter(line=>line.split('\t')[1]!=='test');if(JSON.stringify(after)!==JSON.stringify(productionEntries))throw Error('PRODUCTION_ROOT_NOT_IDENTICAL');
git(['push','origin',commit+':refs/heads/gh-pages']);
const receipt={sourceCommit,pagesCommit:commit,baseline,files:publicFiles.length,productionRootEntriesPreserved:productionEntries.length,changedOutsideTest:0,url:'https://agmetricapp.com/test/index.html'};
await fs.writeFile(path.join(evidence,'agdata-test-publication.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
