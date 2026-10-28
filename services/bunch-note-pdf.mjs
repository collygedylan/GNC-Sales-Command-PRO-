const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 52;
const RIGHT = 52;
const TOP = 744;
const CONTENT_BOTTOM = 64;
const FOOTER_Y = 34;
const BODY_WIDTH = PAGE_WIDTH - LEFT - RIGHT;

const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const WIDTHS = {
  Helvetica: {
    ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,
    A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
    '[':278,'\\':278,']':278,'^':469,'_':556,'`':333,a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,'{':334,'|':260,'}':334,'~':584,
  },
  'Helvetica-Bold': {
    ' ':278,'!':333,'"':474,'#':556,'$':556,'%':889,'&':722,"'":238,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':333,';':333,'<':584,'=':584,'>':584,'?':611,'@':975,
    A:722,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
    '[':333,'\\':278,']':333,'^':584,'_':556,'`':333,a:556,b:611,c:556,d:611,e:556,f:333,g:611,h:611,i:278,j:278,k:556,l:278,m:889,n:611,o:611,p:611,q:611,r:389,s:556,t:333,u:611,v:556,w:778,x:556,y:556,z:500,'{':389,'|':280,'}':389,'~':584,
  },
};

function normalizedText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u2192\u27f6]/g, '->')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00b7]/g, '|')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u2610\u2611]/g, '[ ]');
}

function isPresent(value) {
  const text = normalizedText(value).trim();
  if (!text) return false;
  return !/^(?:not\s+specified|none|n\/?a|[-\u2013\u2014]+)$/i.test(text);
}

function escapePdfText(value) {
  const text = normalizedText(value);
  let escaped = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    let byte;
    if (code >= 0x20 && code <= 0x7e) byte = code;
    else if (code >= 0xa0 && code <= 0xff) byte = code;
    else byte = CP1252.get(code) ?? 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) escaped += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) escaped += `\\${byte.toString(8).padStart(3, '0')}`;
    else escaped += String.fromCharCode(byte);
  }
  return escaped;
}

function measureText(text, size, font) {
  const widths = WIDTHS[font] || WIDTHS.Helvetica;
  let units = 0;
  for (const character of normalizedText(text)) units += widths[character] || 556;
  return units * size / 1000;
}

function splitLongWord(word, width, size, font) {
  const result = [];
  let line = '';
  for (const character of word) {
    const candidate = line + character;
    if (line && measureText(candidate, size, font) > width) {
      result.push(line);
      line = character;
    } else line = candidate;
  }
  if (line) result.push(line);
  return result;
}

function wrapText(text, width, size, font) {
  const wrapped = [];
  for (const paragraph of normalizedText(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { wrapped.push(''); continue; }
    let line = '';
    for (const word of words) {
      if (measureText(word, size, font) > width) {
        if (line) wrapped.push(line);
        const pieces = splitLongWord(word, width, size, font);
        wrapped.push(...pieces.slice(0, -1));
        line = pieces.at(-1) || '';
      } else {
        const candidate = line ? `${line} ${word}` : word;
        if (line && measureText(candidate, size, font) > width) {
          wrapped.push(line);
          line = word;
        } else line = candidate;
      }
    }
    if (line) wrapped.push(line);
  }
  return wrapped;
}

function chicagoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(valid);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('month')}/${part('day')}/${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}

function reportTitle(report) {
  for (const value of [report.work_type, report.title, report.purposes, report.purpose_thread]) {
    if (isPresent(value)) return normalizedText(value).trim();
  }
  return 'Bunch Notes';
}

function buildBlocks(report) {
  const blocks = [];
  const addText = (text, options = {}) => {
    if (!isPresent(text)) return;
    const font = options.bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = options.size || 10;
    const indent = options.indent || 0;
    const lines = wrapText(text, BODY_WIDTH - indent, size, font);
    if (lines.length) blocks.push({ lines, size, font, indent, before: options.before || 0, after: options.after ?? 3, keep: options.keep !== false, color: options.color || '0.12 0.22 0.17' });
  };
  const addSection = (title, body) => {
    if (!isPresent(body)) return;
    addText(title, { bold: true, size: 12, before: 7, after: 2, keep: true });
    addText(body, { size: 10, after: 5 });
  };

  const title = reportTitle(report);
  const titleLines = wrapText(title, BODY_WIDTH, 20, 'Helvetica-Bold');
  blocks.push({ title: true, lines: titleLines, size: 20, font: 'Helvetica-Bold', indent: 0, before: 0, after: 7, keep: true });

  const subtitleParts = [];
  if (isPresent(report.note_number)) subtitleParts.push(`Bunch Note ${report.note_number}`);
  if (isPresent(report.instruction_revision)) subtitleParts.push(`Revision ${report.instruction_revision}`);
  if (report.report_kind === 'completed_work' && isPresent(report.work_revision)) subtitleParts.push(`Completed work ${report.work_revision}`);
  addText(subtitleParts.join(' | '), { bold: true, size: 10, after: 7 });
  if (isPresent(report.default_house_plan)) addText(normalizedText(report.default_house_plan).trim().replace(/\r?\n/g, ' | '), { bold: true, size: 13, after: 7 });

  const metadata = [
    ['Purpose / sequence', report.purpose_thread],
    ['Direction', report.direction],
    ['Target houses', report.target_houses],
    ['Priority / order', report.priority],
    ['Schedule / prerequisite alert', report.schedule_banner],
    ['Header rules', Array.isArray(report.rule_chips) ? report.rule_chips.filter(isPresent).join(' | ') : ''],
    ...(report.report_kind === 'completed_work' ? [['Owner', report.owner_name || report.owner_id]] : []),
  ];
  for (const [label, value] of metadata) {
    if (!isPresent(value)) continue;
    addText(`${label}: ${normalizedText(value).trim()}`, { size: 9, after: 2 });
  }
  if (metadata.some(([, value]) => isPresent(value))) blocks.push({ rule: true, before: 3, after: 4, keep: true });

  addSection('General instructions', report.instructions || report.general_instructions);
  addSection('Prerequisites / wait instructions', report.prerequisites);

  const cards = Array.isArray(report.cards) ? report.cards : [];
  const actions = Array.isArray(report.actions) ? report.actions : [];
  const source = Array.isArray(report.source) ? report.source : [];
  const inventoryCards = cards.filter(card => card && card.kind === 'inventory');
  const orderedCardList = cards.filter(card => card && ['inventory', 'shared', 'divider'].includes(card.kind));
  if (orderedCardList.length) {
    addText('Walking order', { bold: true, size: 13, before: 9, after: 4, keep: true });
    let itemNumber = 0;
    for (const card of orderedCardList) {
      if (card.kind === 'divider') {
        addText(card.text || card.instructions, { bold: true, size: 10, before: 7, after: 5, keep: true, color: '0.27 0.34 0.29' });
        continue;
      }
      const row = source.find(item => (card.row_ids || []).includes(item.unique_id));
      const isInventory = card.kind === 'inventory';
      if (isInventory) itemNumber += 1;
      const callout = isPresent(card.left_margin) ? `${normalizedText(card.left_margin).trim()} | ` : '';
      const size = card.contsize || row?.contsize;
      const variety = card.variety || card.commonname || card.itemcode || row?.commonname || row?.itemcode || 'Unspecified item';
      const itemCode = isPresent(card.itemcode || row?.itemcode) ? ` (${card.itemcode || row?.itemcode})` : '';
      const firstLine = isInventory ? `${itemNumber}. ${callout}${isPresent(size) ? `${size} ` : ''}${variety}${itemCode}` : `${callout}${variety}`;
      const itemLines = wrapText(firstLine, BODY_WIDTH - 8, 11, 'Helvetica-Bold').map(text => ({ text, size: 11, font: 'Helvetica-Bold', indent: 8 }));
      const actions = String(card.workflow_action || '').split(/\r?\n|\s+·\s+/).map(value => value.trim()).filter(Boolean);
      const routeParts = actions.map(value => {
        const action = value.toLowerCase();
        if (action === 'move' || action.startsWith('move ')) return isPresent(card.destination_location) ? `Move to ${card.destination_location}${isPresent(card.destination_qualifier) ? ` | ${card.destination_qualifier}` : ''}` : 'Move';
        if (action === 'bunch' || action.startsWith('bunch') || action.includes('& bunch')) return isPresent(card.destination_house) ? `Bunch to ${String(card.destination_house).replace(/\r?\n/g, ' | ')}` : value;
        if (action === 'ta' || action.startsWith('ta ')) return 'TA (Throw Away)';
        return value;
      });
      if (isPresent(card.destination_location) && !actions.some(value => value.toLowerCase() === 'move' || value.toLowerCase().startsWith('move '))) routeParts.push(`Destination ${card.destination_location}`);
      const details = [];
      if (isPresent(card.workflow_instructions)) details.push(`Instructions: ${card.workflow_instructions}`);
      if (isPresent(card.notes)) details.push(`Notes: ${card.notes}`);
      for (const planned of actions.filter(item => item && item.card_id === card.id)) {
        const actionParts = [planned.label || planned.group, planned.destination ? `to ${planned.destination}` : '', planned.quantity ? `Qty ${planned.quantity}` : '', planned.stage ? `Stage ${planned.stage}` : '', planned.marking, planned.instructions].filter(isPresent);
        if (actionParts.length && !(planned.instructions === card.workflow_instructions || planned.instructions === card.notes)) details.push(`Task: ${actionParts.join(' | ')}`);
      }
      const assignees = Array.isArray(card.owner_names) ? card.owner_names.filter(isPresent) : [];
      if (assignees.length) details.push(`Assigned: ${assignees.join(', ')}`);
      const itemBlock = [...itemLines];
      if (routeParts.length) for (const text of wrapText(routeParts.join(' | '), BODY_WIDTH - 24, 10, 'Helvetica')) itemBlock.push({ text, size: 10, font: 'Helvetica', indent: 24 });
      for (const detail of details) {
        for (const text of wrapText(detail, BODY_WIDTH - 24, 9, 'Helvetica')) itemBlock.push({ text, size: 9, font: 'Helvetica', indent: 24 });
      }
      blocks.push({ item: true, lines: itemBlock, size: 10, font: 'Helvetica', indent: 0, before: 5, after: 7, keep: true });
    }
  } else if (inventoryCards.length) {
    // Kept for clarity if a future card type is added without joining the walking order.
    addText('Walking order', { bold: true, size: 13, before: 9, after: 4, keep: true });
  }

  if (!cards.length && source.length) {
    addText('Plant details — saved source snapshot', { bold: true, size: 13, before: 9, after: 4 });
    for (const row of source) {
      const itemTitle = [row.itemcode, row.commonname].filter(isPresent).join(' | ');
      const attributes = [row.contsize, row.lotcode ? `Lot ${row.lotcode}` : '', row.salesyear ? `Sales year ${row.salesyear}` : '', row.season ? `Season ${row.season}` : '', row.stock != null ? `On hand ${row.stock}` : '', row.available != null ? `Available ${row.available}` : '', row.location_notes].filter(isPresent).join(' | ');
      if (!itemTitle && !attributes) continue;
      const lines = wrapText(itemTitle || attributes, BODY_WIDTH - 8, 10, 'Helvetica-Bold').map(text => ({ text, size: 10, font: 'Helvetica-Bold', indent: 8 }));
      if (itemTitle && attributes) for (const text of wrapText(attributes, BODY_WIDTH - 24, 9, 'Helvetica')) lines.push({ text, size: 9, font: 'Helvetica', indent: 24 });
      blocks.push({ item: true, lines, size: 10, font: 'Helvetica', indent: 0, before: 4, after: 5, keep: true });
    }
  }

  const unscopedActions = actions.filter(action => !action.card_id || !cards.some(card => card.id === action.card_id));
  if (unscopedActions.length) {
    addText('Additional tasks', { bold: true, size: 13, before: 9, after: 4, keep: true });
    for (const action of unscopedActions) {
      const detail = [action.label || action.group, action.destination ? `to ${action.destination}` : '', action.quantity ? `Qty ${action.quantity}` : '', action.percentage ? `${action.percentage}%` : '', action.stage, action.marking, action.instructions].filter(isPresent).join(' | ');
      if (detail) addText(detail, { size: 9, indent: 8, before: 3, after: 5, keep: true });
    }
  }

  if (report.report_kind === 'completed_work') {
    const actuals = Array.isArray(report.actuals) ? report.actuals : [];
    const currentActuals = actuals.filter(actual => !actual.superseded);
    const totals = new Map();
    for (const actual of currentActuals) {
      const key = actual.action_snapshot?.kind || actual.action_snapshot?.label || 'Work';
      totals.set(key, (totals.get(key) || 0) + Number(actual.quantity || 0));
    }
    if (totals.size) addSection('Recorded totals by action type', [...totals].map(([key, value]) => `${key}: ${value}`).join(' | '));
    if (actuals.length) {
      addText('Actual work and correction history', { bold: true, size: 13, before: 9, after: 4, keep: true });
      for (const actual of actuals) {
        const snapshot = actual.source_snapshot || {};
        const record = [actual.action_snapshot?.label || actual.action_snapshot?.instructions, snapshot.itemcode, snapshot.contsize, snapshot.lotcode ? `Lot ${snapshot.lotcode}` : '', `Qty ${actual.quantity}`, actual.destination ? `To ${actual.destination}` : '', actual.actor_display || actual.actor_username || actual.actor_id, actual.created_at, actual.superseded ? 'Replaced; excluded from totals' : actual.replaces_id ? 'Correction; current' : 'Current', actual.explanation, ...(Array.isArray(actual.review_flags) ? actual.review_flags : [])].filter(isPresent).join(' | ');
        addText(record, { size: 9, indent: 8, before: 3, after: 5, keep: true });
      }
    }
  }
  return blocks;
}

function blockHeight(block) {
  if (block.rule) return block.before + block.after + 4;
  const lines = block.lines || [];
  return block.before + block.after + lines.reduce((total, line) => total + (typeof line === 'string' ? block.size : line.size) * 1.32, 0);
}

function paginate(blocks) {
  const pages = [[]];
  let y = TOP;
  const newPage = () => { pages.push([]); y = TOP; };
  for (const block of blocks) {
    const height = blockHeight(block);
    if (block.keep && y - height < CONTENT_BOTTOM && pages.at(-1).length) newPage();
    if (block.rule) {
      if (y - height < CONTENT_BOTTOM && pages.at(-1).length) newPage();
      y -= block.before + 2;
      pages.at(-1).push({ ruleY: y });
      y -= block.after + 2;
      continue;
    }
    if (!block.keep && y - height < CONTENT_BOTTOM && pages.at(-1).length) newPage();
    y -= block.before;
    for (const rawLine of block.lines || []) {
      const line = typeof rawLine === 'string'
        ? { text: rawLine, size: block.size, font: block.font, indent: block.indent }
        : rawLine;
      const lineHeight = line.size * 1.32;
      if (y - lineHeight < CONTENT_BOTTOM && pages.at(-1).length) newPage();
      y -= lineHeight;
      pages.at(-1).push({ text: line.text, x: LEFT + (line.indent || block.indent || 0), y, size: line.size || block.size, font: line.font || block.font, color: block.color, centered: block.title });
    }
    y -= block.after;
  }
  return pages;
}

function pdfLiteral(value) {
  return `(${escapePdfText(value)})`;
}

function pageContent(lines, footer, page, total) {
  const commands = [];
  for (const line of lines) {
    if (line.ruleY !== undefined) {
      commands.push('0.68 G 0.5 w');
      commands.push(`${LEFT} ${line.ruleY.toFixed(2)} m ${PAGE_WIDTH - RIGHT} ${line.ruleY.toFixed(2)} l S`);
      commands.push('0 G');
      continue;
    }
    const fontId = line.font === 'Helvetica-Bold' ? 'F2' : 'F1';
    const x = line.centered ? (PAGE_WIDTH - measureText(line.text, line.size, line.font)) / 2 : line.x;
    const [red, green, blue] = (line.color || '0.12 0.22 0.17').split(' ');
    commands.push(`BT /${fontId} ${line.size} Tf ${red} ${green} ${blue} rg 1 0 0 1 ${x.toFixed(2)} ${line.y.toFixed(2)} Tm ${pdfLiteral(line.text)} Tj ET`);
  }
  const footerText = `Prepared by: ${footer.preparedBy} | Prepared: ${footer.timestamp} | Page ${page} of ${total}`;
  let footerSize = 8;
  while (footerSize > 6 && measureText(footerText, footerSize, 'Helvetica') > BODY_WIDTH) footerSize -= 0.25;
  commands.push('0.68 G 0.5 w');
  commands.push(`${LEFT} ${(FOOTER_Y + 13).toFixed(2)} m ${PAGE_WIDTH - RIGHT} ${(FOOTER_Y + 13).toFixed(2)} l S`);
  commands.push('0 G');
  commands.push(`BT /F1 ${footerSize.toFixed(2)} Tf 0.24 0.30 0.26 rg 1 0 0 1 ${LEFT} ${FOOTER_Y.toFixed(2)} Tm ${pdfLiteral(footerText)} Tj ET`);
  return commands.join('\n');
}

function createPdfDocument(pages, footer) {
  const objects = [];
  const addObject = value => { objects.push(value); return objects.length; };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    const stream = pageContent(pages[index], footer, index + 1, pages.length);
    const streamLength = new TextEncoder().encode(stream).length;
    addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    addObject(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let document = '%PDF-1.4\n% GNC Bunch Notes\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(document).length);
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(document).length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) document += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function safeFilename(value) {
  return normalizedText(value).trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Bunch-Notes';
}

/** Render authorized Bunch Note reports into immutable PDFs for preview and delivery. */
export async function renderBunchNoteReportsPdf(reports, preparedBy, preparedAt = new Date()) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error('BUNCH_NOTE_PDF_REPORT_REQUIRED');
  const byline = isPresent(preparedBy) ? normalizedText(preparedBy).trim() : 'Unknown';
  const timestamp = chicagoTimestamp(preparedAt);
  const result = [];
  let totalBytes = 0;
  for (const report of reports) {
    if (!report || typeof report !== 'object') throw new Error('BUNCH_NOTE_PDF_REPORT_INVALID');
    const bytes = createPdfDocument(paginate(buildBlocks(report)), { preparedBy: byline, timestamp });
    totalBytes += bytes.length;
    if (totalBytes > 15_000_000) throw new Error('BUNCH_NOTE_BATCH_TOO_LARGE_SELECT_FEWER_LOCATIONS');
    const suffix = report.report_kind === 'completed_work' ? `_WORK_R${report.work_revision ?? ''}` : `_R${report.instruction_revision ?? ''}`;
    const filename = `${safeFilename(report.note_number)}${suffix}.pdf`;
    result.push({ job_id: String(report.job_id || ''), filename, base64: base64(bytes) });
  }
  return result;
}

export { chicagoTimestamp, isPresent };
