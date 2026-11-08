const prohibited = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE']);

function skipQuoted(sql, start, quote, escapes) {
  for (let i = start + 1; i < sql.length; i++) {
    if (sql[i] === '\\' && escapes) { i++; continue; }
    if (sql[i] !== quote) continue;
    if (sql[i + 1] === quote) { i++; continue; }
    return i + 1;
  }
  throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
}

function skipBlockComment(sql, start) {
  let depth = 1;
  for (let i = start + 2; i < sql.length - 1; i++) {
    const pair = sql.slice(i, i + 2);
    if (pair === '/*') { depth++; i++; }
    if (pair === '*/') { depth--; i++; if (!depth) return i + 1; }
  }
  throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
}

function skipDollarString(sql, start) {
  const delimiter = sql.slice(start).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0];
  if (!delimiter) return start;
  const end = sql.indexOf(delimiter, start + delimiter.length);
  if (end < 0) throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
  return end + delimiter.length;
}

function assertStatement(first, second, third) {
  if (prohibited.has(first) || (first === 'START' && second === 'TRANSACTION')
      || (first === 'PREPARE' && second === 'TRANSACTION')
      || (first === 'SET' && (second === 'TRANSACTION' || second === 'STANDARD_CONFORMING_STRINGS'
        || (['LOCAL', 'SESSION'].includes(second) && third === 'STANDARD_CONFORMING_STRINGS')))) {
    throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
  }
}

function skipNonCode(sql, i) {
  const pair = sql.slice(i, i + 2), char = sql[i];
  if (pair === '--') { const end = sql.indexOf('\n', i + 2); return end < 0 ? sql.length : end + 1; }
  if (pair === '/*') return skipBlockComment(sql, i);
  if (char === "'" || char === '"') {
    const escapes = char === "'" && /^[eE]$/.test(sql[i - 1] || '') && !/[a-zA-Z_0-9]/.test(sql[i - 2] || '');
    return skipQuoted(sql, i, char, escapes);
  }
  return char === '$' ? skipDollarString(sql, i) : i;
}

export function assertTransactionlessSql(sql) {
  let i = 0, words = [];
  while (i < sql.length) {
    const next = skipNonCode(sql, i);
    if (next !== i) { i = next; continue; }
    if (sql[i] === ';') { assertStatement(...words); words = []; i++; continue; }
    const word = sql.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/)?.[0];
    if (!word) { i++; continue; }
    if (words.length < 3) words.push(word.toUpperCase());
    i += word.length;
  }
  assertStatement(...words);
}

export function migrationBody(source) {
  const wrapped = /^begin;\s/i.test(source) && /\scommit;\s*$/i.test(source);
  const body = wrapped ? source.replace(/^begin;\s*/i, '').replace(/\scommit;\s*$/i, '') : source;
  assertTransactionlessSql(body);
  return body;
}
