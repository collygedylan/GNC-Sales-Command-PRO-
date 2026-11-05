export function textPdf(text) {
  const escape = value => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  const pages = []; for (let i = 0; i < text.length; i += 43) pages.push(text.slice(i, i + 43));
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const linesOnPage of pages) {
    const pageId = objects.length, streamId = pageId + 1; kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    const stream = 'BT /F1 10 Tf 42 748 Td 16 TL\n' + linesOnPage.map((line, i) => (i ? 'T* ' : '') + '(' + escape(line) + ') Tj').join('\n') + '\nET';
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length; pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n` + offsets.slice(1).map(n => String(n).padStart(10,'0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
