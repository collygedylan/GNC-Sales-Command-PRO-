import { textPdf } from '../../../assets/test/pdf.mjs';
const escape=(value:unknown):string=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function testMailReport(payload:Record<string,unknown>){
 const subject=String(payload.subject||payload.event_type||'Operational update');
 const text=JSON.stringify(payload,null,2);
 const html='<h1>AgData Test (T)</h1><p>Test delivery only: dylan_collyge@greenleafnursery.com</p><h2>'+escape(subject)+'</h2><table style="border-collapse:collapse;width:100%">'+Object.entries(payload).map(([k,v])=>'<tr><th style="text-align:left;vertical-align:top;border:1px solid #ccc;padding:6px">'+escape(k)+'</th><td style="border:1px solid #ccc;padding:6px;white-space:pre-wrap">'+escape(typeof v==='object'?JSON.stringify(v,null,2):v)+'</td></tr>').join('')+'</table>';
 const lines=['AGDATA TEST - OPERATIONAL REPORT',subject,'Recipient: dylan_collyge@greenleafnursery.com','',...text.split('\n').flatMap(line=>line.match(/.{1,90}/g)||[''])];
 const bytes=textPdf(lines);let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 return {subject,text,html,pdf:btoa(binary),pdfName:'AgData-Test-Report.pdf'};
}
