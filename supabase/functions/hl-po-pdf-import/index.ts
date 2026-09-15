import { getDocumentProxy } from 'npm:unpdf@1.8.1';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { HL_PO_PDF_VERSION, parseHlPoPdfPage } from '../_shared/hl-po-pdf.mjs';

const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');

export function createHlPoPdfHandler(serviceKey:string, client:{rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:Record<string,unknown>|null,error:{message:string}|null}>}) {
return async (request:Request)=>{
  // Only the existing server-side Apps Script importer can stage original PDFs.
  const bearer=(request.headers.get('authorization') || '').replace(/^Bearer\s+/i,'').trim();
  if(!serviceKey || bearer!==serviceKey) return response({ok:false,code:'HL_PO_PDF_FORBIDDEN'},403);
  if(request.method!=='POST') return response({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try {
    const input=await request.json();
    if(typeof input.pdf_base64!=='string' || input.pdf_base64.length>14000000 ||
      typeof input.source_file_id!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(input.source_file_id) ||
      typeof input.source_file_name!=='string' || input.source_file_name.length>255) throw new Error('HL_PO_PDF_INVALID_INPUT');
    const bytes=Uint8Array.from(atob(input.pdf_base64),v=>v.charCodeAt(0));
    if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new Error('HL_PO_PDF_INVALID_FILE');
    const fileHash=await hash(bytes);
    const pdf=await getDocumentProxy(bytes);
    if(pdf.numPages<1 || pdf.numPages>150) throw new Error('HL_PO_PDF_PAGE_LIMIT');
    const pages=[];
    for(let n=1;n<=pdf.numPages;n++) {
      const page=await pdf.getPage(n); const content=await page.getTextContent();
      const viewport=page.getViewport({scale:1});
      pages.push(parseHlPoPdfPage(content.items,{pageNumber:n,totalPages:pdf.numPages,width:viewport.width,height:viewport.height}));
    }
    const identity=JSON.stringify(pages[0].metadata);
    if(pages.some(p=>JSON.stringify(p.metadata)!==identity)) throw new Error('HL_PO_PDF_MIXED_REPORT');
    const fingerprint=await hash(new TextEncoder().encode(JSON.stringify({version:HL_PO_PDF_VERSION,pages})));
    const runId=`hl-pdf:${input.source_file_id}:${fileHash}`;
    const metadata={source_file_id:input.source_file_id,source_file_name:input.source_file_name,fingerprint,
      page_count:pdf.numPages,...pages[0].metadata,parser_version:HL_PO_PDF_VERSION};
    const first=input.start_page ?? 1;
    if(!Number.isInteger(first) || first<1 || first>pdf.numPages) throw new Error('HL_PO_PDF_INVALID_PAGE');
    const last=Math.min(first+9,pdf.numPages);
    for(let page=first;page<=last;page++) {
      const {error}=await client.rpc('hl_po_pdf_stage',{p_run_id:runId,p_metadata:metadata,p_page:page,p_rows:pages[page-1].rows,p_complete:false});
      if(error) throw new Error(error.message?.match(/HL_PO_[A-Z_]+/)?.[0] || 'HL_PO_PDF_STAGE_FAILED');
    }
    if(last<pdf.numPages) return response({ok:true,run_id:runId,status:'staging',next_page:last+1,page_count:pdf.numPages});
    const {data,error}=await client.rpc('hl_po_pdf_stage',{p_run_id:runId,p_metadata:metadata,p_page:null,p_rows:[],p_complete:true});
    if(error) throw new Error(error.message?.match(/HL_PO_[A-Z_]+/)?.[0] || 'HL_PO_PDF_FINALIZE_FAILED');
    return response({ok:true,...data,run_id:runId,next_page:null,page_count:pdf.numPages,total_rows:pages.reduce((n,p)=>n+p.rows.length,0)});
  } catch(error) {
    const code=String(error instanceof Error?error.message:'').match(/^HL_PO_PDF_[A-Z_]+/)?.[0] || 'HL_PO_PDF_IMPORT_FAILED';
    return response({ok:false,code},422);
  }
};
}

if (import.meta.main) {
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
 Deno.serve(createHlPoPdfHandler(key,createClient(Deno.env.get('SUPABASE_URL') || '',key,{auth:{persistSession:false,autoRefreshToken:false}})));
}
