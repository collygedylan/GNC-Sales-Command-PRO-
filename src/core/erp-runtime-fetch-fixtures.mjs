import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export function fixtureErpReceipt(dataset, fileName, rows) {
  return { ok: true, skip: false, stage_commit: 'canonical_atomic_import',
    dataset_key: dataset, file_name: fileName, source_rows: rows, staged_rows: rows };
}

export function mockDriveMetadata(url,init){
  if(!url.pathname.match(/\/files\/[^/]+$/)||!url.searchParams.has('fields')||init?.method==='PATCH')return null;
  const id=decodeURIComponent(url.pathname.split('/').at(-1));
  const parent=id.includes('cav')||id==='good-cav'?'cav-folder':id.includes('soc')||id.includes('resume')?'soc-folder':'drive-folder';
  return Response.json({id,parents:id==='soc-bounded'?['soc-folder','shared-folder']:[parent]});
}

export async function unchangedFetch(input,init,{calls}){
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files')){
      const query=url.searchParams.get('q');
      if (/name contains/.test(query)) return Response.json({files:[]});
      assert.match(query,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
      assert.match(query,/text\/csv/);
      assert.match(query,/application\/octet-stream/);
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='drive-folder'
        ? [{id:'file-1',name:'DriveAroundMC-10-12000020261105120000.csv',modifiedTime:'2026-10-27T00:00:00Z',parents:['drive-folder']}]
        : folder==='drive-processed' ? [] : []});
    }
    if(url.pathname.endsWith('/files/file-1')){calls.push('archive');return Response.json({id:'file-1'});}
    throw new Error('unchanged source must not be downloaded');
}

function listedFiles(folder,files,archived){
  if(folder==='drive-folder')return files.filter(file=>!archived.includes(file.id));
  if(folder==='processed-folder')return files.filter(file=>archived.includes(file.id));
  return [];
}

export async function continuationFetch(input,init,{files, archived, listed}){
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      listed.push(folder);
      return Response.json({files:listedFiles(folder,files,archived)});
    }
    if(url.pathname.endsWith('/files/file-1')||url.pathname.endsWith('/files/file-2')){
      const id=url.pathname.split('/').at(-1);
      if(init.method==='PATCH'){archived.push(id);return Response.json({id,parents:['processed-folder']});}
      return new Response('itemcode,commonname,ptravailable\n004380.010.1,Blue Dart Grass,1\n');
    }
    throw new Error(`unexpected fetch ${url}`);
}

export async function largeFetch(input,init,{csv, state}){
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files')) {
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='drive-folder'&&!state.archived?[{id:'large-file',name:'DriveAroundMC-10-12000020261105120000.csv',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']}]:[]});
    }
    if(url.pathname.endsWith('/files/large-file')) {
      if(init.method==='PATCH') {
        state.moveAttempts+=1;
        assert.equal(url.searchParams.get('addParents'),'processed-folder');
        assert.equal(url.searchParams.get('removeParents'),'drive-folder');
        assert.equal(url.searchParams.get('supportsAllDrives'),'true');
        if(state.moveAttempts===1)return Response.json({error:'temporary'}, {status:503});
        state.archived=true;return Response.json({id:'large-file',parents:['processed-folder']});
      }
      return new Response(csv);
    }
    throw new Error(`unexpected fetch ${url}`);
}

export async function failedSourceFetch(input,init,{archived, listed}){
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];listed.push(folder);
      const files=folder==='drive-folder'&&!archived.includes('bad-drive')
        ?[{id:'bad-drive',name:'DriveAroundMC-10-12000020261105120000.csv',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']}]
        :folder==='cav-folder'&&!archived.includes('good-cav')
        ?[{id:'good-cav',name:'CAV-12000020261105120000.csv',modifiedTime:'2026-10-28T12:01:00Z',parents:['cav-folder']}]:[];
      return Response.json({files});
    }
    if(url.pathname.endsWith('/files/good-cav')){
      if(init.method==='PATCH'){archived.push('good-cav');return Response.json({id:'good-cav'});}
      return new Response('itemcode,commonname,brandcode\n001,Blue Grass,B1\n');
    }
    throw new Error(`unexpected Drive call ${url}`);
}

export function withArchiveProof(fetcher, bytes, originalParents) {
  const parents = new Map(), versions = new Map();
  const checksum = createHash('sha256').update(bytes).digest('hex');
  return async (input, init = {}) => {
    const url = new URL(input);
    const id = url.pathname.split('/').at(-1);
    if (init.method !== 'PATCH' && String(url.searchParams.get('fields')).includes('sha256Checksum')) {
      return Response.json({ id, parents: parents.get(id) || originalParents, version: String(versions.get(id) || 1), sha256Checksum: checksum });
    }
    const response = await fetcher(input, init);
    if (init.method === 'PATCH' && response.ok) {
      parents.set(id, url.searchParams.get('addParents').split(','));
      versions.set(id, (versions.get(id) || 1) + 1);
    }
    return response;
  };
}

export function singleXlsxDriveSource(bytes) {
  const file = {id:'xlsx-1', name:'DriveAroundMC-10-12000020261105120000.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modifiedTime:'2026-10-28T12:00:00Z', parents:['drive-folder']};
  let archived = false;
  async function fetchWorkbook(input, init = {}) {
    const url = new URL(input);
    const metadata = mockDriveMetadata(url, init);
    if (metadata) return metadata;
    if (url.pathname.endsWith('/files')) {
      const folder = url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder === 'drive-folder' && !archived ? [file] : []});
    }
    if (!url.pathname.endsWith('/files/xlsx-1')) throw Error('Unexpected workbook fixture URL ' + url);
    if (init.method !== 'PATCH') return new Response(bytes);
    archived = true;
    return Response.json({id:file.id});
  }
  return {fetch:withArchiveProof(fetchWorkbook, bytes, file.parents), get archived() { return archived; }};
}
