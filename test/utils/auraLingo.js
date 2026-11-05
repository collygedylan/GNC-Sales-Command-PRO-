const SMALL = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = new Map([['twenty',20],['thirty',30],['forty',40],['fifty',50],['sixty',60],['seventy',70],['eighty',80],['ninety',90]]);
const SIZE_NUMBER = ['\\d+(?:\\.\\d+)?','(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?',...SMALL.slice().sort((a,b)=>b.length-a.length)].join('|');
function underHundred(words) {
  if (words.length === 1) { const small = SMALL.indexOf(words[0]); return small >= 0 ? small : TENS.get(words[0]) ?? null; }
  if (words.length === 2 && TENS.has(words[0])) { const unit = SMALL.indexOf(words[1]); return unit >= 1 && unit <= 9 ? TENS.get(words[0]) + unit : null; }
  return null;
}
function underThousand(words) {
  if (!words.length) return 0;
  if (words[1] !== 'hundred') return underHundred(words);
  const hundreds = SMALL.indexOf(words[0]);
  if (hundreds < 1 || hundreds > 9) return null;
  const tail = words.slice(2);
  if (tail[0] === 'and') tail.shift();
  const remainder = tail.length ? underHundred(tail) : 0;
  return remainder == null ? null : hundreds * 100 + remainder;
}
export function parseAuraWholeNumber(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text || /\band\s*$/.test(text)) return null;
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
    const number = Number(text.replaceAll(',', ''));
    return Number.isSafeInteger(number) && number <= 999999 ? number : null;
  }
  const words = text.replaceAll('-', ' ').split(/\s+/), split = words.indexOf('thousand');
  if (split < 0) return underThousand(words);
  if (split === 0 || words.lastIndexOf('thousand') !== split) return null;
  const high = underThousand(words.slice(0,split)), tail = words.slice(split+1);
  if (tail[0] === 'and') tail.shift();
  const low = underThousand(tail);
  if (high == null || high < 1 || low == null) return null;
  const number = high * 1000 + low;
  return number <= 999999 ? number : null;
}
function sizeNumber(value) { return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : parseAuraWholeNumber(value); }

/** Apply only to inventory phrases; customer names, chat and pest copy stay verbatim. */
export function cleanseAuraInventoryText(input) {
  let text = String(input ?? '').normalize('NFKC').trim();
  const replaceSize = (pattern, format) => {
    text = text.replace(new RegExp(pattern,'gi'),(match,spoken)=>{
      const value = sizeNumber(spoken.toLowerCase());
      return Number.isFinite(value) && value > 0 && value <= 999999 ? format(value) : match;
    });
  };
  replaceSize('(?:\\bhash\\s+|#\\s*)('+SIZE_NUMBER+')(?=\\s|$|[,.!?])',value=>'#'+value);
  replaceSize('\\b('+SIZE_NUMBER+')\\s*(?:deep\\s+pee|d\\s*p|dp)\\b',value=>value+'DP');
  replaceSize('\\b('+SIZE_NUMBER+')\\s*(?:gallons?|gal\\.?)\\b',value=>'#'+value);
  for (const [spoken,stored] of [['inches?|in','IN'],['feet|foot|ft','FT'],['quarts?|qt','QT'],['pints?|pt','PT'],['cells?','CELL'],['trays?','TRAY']]) {
    replaceSize('\\b('+SIZE_NUMBER+')\\s*(?:'+spoken+')\\b',value=>value+' '+stored);
  }
  return text.replace(/\byou\s+one\b/gi,'U1').replace(/\byou\s+two\b/gi,'U2')
    .replace(/\beff\s+one\b/gi,'F1').replace(/\bess\s+one\b/gi,'S1').replace(/\s+/g,' ').trim();
}
export function canonicalAuraSize(input) {
  const value = cleanseAuraInventoryText(input).toUpperCase().replace(/\.$/,'').trim();
  const gallon = value.match(/^#?\s*(\d+(?:\.\d+)?)$/);
  if (gallon) return '#'+Number(gallon[1]);
  const dp = value.match(/^(\d+(?:\.\d+)?)\s*DP$/);
  return dp ? Number(dp[1])+'DP' : value;
}
export function readAuraProduct(input) {
  const text = cleanseAuraInventoryText(input).replace(/[,.!?;:]+$/g,'').trim();
  const matches = [...text.matchAll(/(?:^|\s)(#\d+(?:\.\d+)?|\d+(?:\.\d+)?DP|\d+(?:\.\d+)?\s+(?:IN|FT|QT|PT|CELL|TRAY))(?=\s|$)/gi)];
  if (matches.length > 1) return null;
  const size = matches[0];
  const commonName = (size ? text.slice(0,size.index)+' '+text.slice(size.index+size[0].length) : text).replace(/\s+/g,' ').trim();
  return commonName ? { commonName, contSize: size ? canonicalAuraSize(size[1]) : null } : null;
}
function nameKey(value) { return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function distance(left,right) {
  let previous = Array.from({length:right.length+1},(_,i)=>i);
  for (let i=1;i<=left.length;i++) {
    const current=[i];
    for (let j=1;j<=right.length;j++) current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(left[i-1]===right[j-1]?0:1));
    previous=current;
  }
  return previous[right.length];
}
function nameScore(query,candidate) {
  if (query===candidate) return 1;
  if (query.length<4) return 0;
  const digits=value=>(value.match(/\d+/g)??[]).join('|');
  if (digits(query)!==digits(candidate)) return 0;
  const words=candidate.split(' '), width=query.split(' ').length, alternatives=[candidate];
  for(let i=0;i+width<=words.length;i++) alternatives.push(words.slice(i,i+width).join(' '));
  return Math.max(...alternatives.map(value=>1-distance(query,value)/Math.max(query.length,value.length)));
}
export function matchAuraProduct(product,catalog) {
  if (!catalog?.complete || !Array.isArray(catalog.rows) || catalog.rows.length>10000) throw new Error('Inventory matching requires a complete, bounded catalog.');
  const query=nameKey(product?.commonName);
  if(!query || query.length>160) return {kind:'none',candidates:[]};
  const size=product.contSize?canonicalAuraSize(product.contSize):null, grouped=new Map();
  for(const row of catalog.rows) {
    if(!row?.itemcode || !row.commonname || !row.contsize) continue;
    const rowSize=canonicalAuraSize(row.contsize);
    if(size && size!==rowSize) continue;
    const key=JSON.stringify([row.itemcode,rowSize]), score=nameScore(query,nameKey(row.commonname).slice(0,160));
    if(!grouped.has(key)||score>grouped.get(key).score) grouped.set(key,{itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,score});
  }
  const ranked=[...grouped.values()].filter(row=>row.score>=0.60).sort((a,b)=>b.score-a.score||a.itemcode.localeCompare(b.itemcode)||a.contsize.localeCompare(b.contsize));
  const candidates=ranked.slice(0,5);
  if(!candidates.length)return {kind:'none',candidates};
  const [first,second]=ranked;
  return first.score>=0.92&&(!second||first.score-second.score>=0.10)?{kind:'match',item:first,candidates}:{kind:'choose',candidates};
}
