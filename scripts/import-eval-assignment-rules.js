#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_SPREADSHEET_ID = '1gZ2qeKnsOdEYKMMxXerUUTU5Fq7aeeNz9yVOxKK76OQ';
const DEFAULT_SHEET_NAME = 'Sheet1';
const DEFAULT_SOURCE_TITLE = 'ALL IN ONE';
const REQUIRED_HEADERS = ['AssignedTo', 'WAREHOUSEI', 'ITEMCODE', 'CONTSIZE', 'COMMONNAME', 'LOCATIONCODE', 'SOURCE', 'GENUSNAME'];
const CRITERIA_HEADERS = ['WAREHOUSEI', 'ITEMCODE', 'CONTSIZE', 'COMMONNAME', 'LOCATIONCODE', 'SOURCE', 'GENUSNAME'];

const USER_ALIASES = new Map(Object.entries({
  dylan: 'dylan_collyge',
  'dylan collyge': 'dylan_collyge',
  dylan_collyge: 'dylan_collyge',
  josh: 'josh_vann',
  'josh vann': 'josh_vann',
  josh_vann: 'josh_vann',
  kayla: 'kayla_knepp',
  'kayla knepp': 'kayla_knepp',
  kayla_knepp: 'kayla_knepp',
  abbey: 'abbey_sartain',
  abby: 'abbey_sartain',
  'abbey sartain': 'abbey_sartain',
  abbey_sartain: 'abbey_sartain',
  abigail: 'abigail_vazquez',
  'abigail vazquez': 'abigail_vazquez',
  abigail_vazquez: 'abigail_vazquez',
  bobby: 'bobby_adair',
  'bobby adair': 'bobby_adair',
  bobby_adair: 'bobby_adair',
  charley: 'charley_robertson',
  'charley robertson': 'charley_robertson',
  charley_robertson: 'charley_robertson',
  ellen: 'ellen_ward',
  'ellen ward': 'ellen_ward',
  ellen_ward: 'ellen_ward',
  jorge: 'jorge_colunga',
  'jorge colunga': 'jorge_colunga',
  jorge_colunga: 'jorge_colunga',
  megan: 'megan_kelly',
  'megan kelly': 'megan_kelly',
  megan_kelly: 'megan_kelly',
  mitch: 'mitch_kaiser',
  'mitch kaiser': 'mitch_kaiser',
  mitch_kaiser: 'mitch_kaiser',
  zoe: 'zoe_green',
  'zoe green': 'zoe_green',
  zoe_green: 'zoe_green',
  murphy: 'murphy_stanley',
  'murphy stanley': 'murphy_stanley',
  murphy_stanley: 'murphy_stanley',
  jd: 'jd_jones',
  'jd jones': 'jd_jones',
  jd_jones: 'jd_jones'
}));
const KNOWN_USERNAMES = new Set(USER_ALIASES.values());

function printHelp() {
  console.log(`Import Google Sheet Eval assignment rules into Supabase.

Usage:
  node scripts/import-eval-assignment-rules.js [options]

Sources:
  --spreadsheet-id <id>   Google Sheet id. Defaults to ALL IN ONE.
  --sheet-name <name>     Sheet tab name. Defaults to Sheet1.
  --csv <path>            Read exported CSV instead of Google Sheets API.
  --values-json <path>    Read Sheets API values JSON instead of Google Sheets API.

Output:
  --out <path>            Write generated SQL. Defaults to eval_assignment_rules_import.sql.
  --apply                 Run the generated SQL with psql or node-postgres and GNC_SUPABASE_DB_URL.
  --quiet                 Only print errors and final status.

Auth for Google Sheets API:
  Uses APPS_SCRIPT_CLASPRC_JSON or CLASPRC_JSON when --csv/--values-json is not supplied.
  The JSON can be the clasp config text or a path to the JSON file.
`);
}

function parseArgs(argv) {
  const options = {
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    sheetName: DEFAULT_SHEET_NAME,
    sheetId: DEFAULT_SPREADSHEET_ID,
    sourceTitle: DEFAULT_SOURCE_TITLE,
    out: path.resolve(process.cwd(), 'eval_assignment_rules_import.sql'),
    apply: false,
    quiet: false,
    csv: '',
    valuesJson: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[i];
    };
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--spreadsheet-id') {
      options.spreadsheetId = String(next()).trim();
      options.sheetId = options.spreadsheetId;
    } else if (arg === '--sheet-id') {
      options.sheetId = String(next()).trim();
    } else if (arg === '--sheet-name') {
      options.sheetName = String(next()).trim();
    } else if (arg === '--source-title') {
      options.sourceTitle = String(next()).trim();
    } else if (arg === '--csv') {
      options.csv = path.resolve(process.cwd(), next());
    } else if (arg === '--values-json') {
      options.valuesJson = path.resolve(process.cwd(), next());
    } else if (arg === '--out') {
      options.out = path.resolve(process.cwd(), next());
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.spreadsheetId && !options.csv && !options.valuesJson) {
    throw new Error('A spreadsheet id, CSV file, or values JSON file is required.');
  }
  if (!options.sheetName) throw new Error('Sheet name is required.');
  return options;
}

function log(options, message) {
  if (!options.quiet) console.log(message);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r') {
      if (next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value || '').trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').trim().replace(/[^a-z0-9]+/gi, '').toUpperCase();
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizeRuleValue(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeAssignedTo(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const aliasKey = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (USER_ALIASES.has(aliasKey)) return USER_ALIASES.get(aliasKey);
  const usernameKey = raw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (USER_ALIASES.has(usernameKey)) return USER_ALIASES.get(usernameKey);
  return usernameKey;
}

function parseValues(values, options) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) throw new Error('No rows found in assignment source.');

  const headers = rows[0].map((value) => String(value || '').trim());
  const headerIndexByName = new Map();
  headers.forEach((header, index) => headerIndexByName.set(normalizeHeader(header), index));

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerIndexByName.has(normalizeHeader(header)));
  if (missingHeaders.length) {
    throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}`);
  }

  const rules = [];
  const unknownNames = new Set();
  const skippedRows = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const sourceRow = rows[rowIndex] || [];
    const read = (header) => normalizeText(sourceRow[headerIndexByName.get(normalizeHeader(header))]);
    const assignedToRaw = read('AssignedTo');
    const assignedto = normalizeAssignedTo(assignedToRaw);
    const criteria = {};
    let filledCriteria = 0;

    CRITERIA_HEADERS.forEach((header) => {
      const value = read(header);
      criteria[header.toLowerCase()] = value || null;
      if (value) filledCriteria += 1;
    });

    if (!assignedToRaw && !filledCriteria) continue;
    if (!assignedto || !filledCriteria) {
      skippedRows.push(rowIndex + 1);
      if (assignedToRaw && !assignedto) unknownNames.add(`${assignedToRaw} (row ${rowIndex + 1})`);
      continue;
    }
    if (!KNOWN_USERNAMES.has(assignedto)) {
      unknownNames.add(`${assignedToRaw} -> ${assignedto} (row ${rowIndex + 1})`);
    }

    const normalized = {};
    CRITERIA_HEADERS.forEach((header) => {
      normalized[header] = normalizeRuleValue(criteria[header.toLowerCase()] || '');
    });

    rules.push({
      sheet_id: options.sheetId || options.spreadsheetId || '',
      sheet_name: options.sheetName,
      sheet_row_number: rowIndex + 1,
      assigned_to_raw: assignedToRaw,
      assignedto,
      ...criteria,
      normalized: {
        source_title: options.sourceTitle || DEFAULT_SOURCE_TITLE,
        criteria: normalized
      }
    });
  }

  const conflicts = findConflicts(rules);
  return { headers, rules, unknownNames: Array.from(unknownNames), skippedRows, conflicts };
}

function findConflicts(rules) {
  const seen = new Map();
  const conflicts = [];
  rules.forEach((rule) => {
    CRITERIA_HEADERS.forEach((header) => {
      const value = normalizeRuleValue(rule[header.toLowerCase()]);
      if (!value) return;
      const key = `${header}:${value}`;
      const prior = seen.get(key);
      if (!prior) {
        seen.set(key, rule);
        return;
      }
      if (prior.assignedto !== rule.assignedto) {
        conflicts.push({
          field: header,
          value,
          first: prior.assignedto,
          firstRow: prior.sheet_row_number,
          second: rule.assignedto,
          secondRow: rule.sheet_row_number
        });
      }
    });
  });
  return conflicts.slice(0, 50);
}

function sqlString(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value || {}))}::jsonb`;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function buildSql(parsed, options) {
  const rules = parsed.rules || [];
  const sheetId = options.sheetId || options.spreadsheetId || '';
  const sheetName = options.sheetName;
  const lines = [];

  lines.push('-- Generated by scripts/import-eval-assignment-rules.js');
  lines.push('-- Source: ALL IN ONE Eval assignment rules');
  lines.push('begin;');

  chunkArray(rules, 500).forEach((chunk) => {
    lines.push(`insert into public.v2_eval_assignment_rules (
  sheet_id,
  sheet_name,
  sheet_row_number,
  assigned_to_raw,
  assignedto,
  warehousei,
  itemcode,
  contsize,
  commonname,
  locationcode,
  source,
  genusname,
  normalized,
  active,
  imported_at,
  updated_at
) values`);
    lines.push(chunk.map((rule) => `(
  ${sqlString(rule.sheet_id)},
  ${sqlString(rule.sheet_name)},
  ${Number(rule.sheet_row_number) || 0},
  ${sqlString(rule.assigned_to_raw)},
  ${sqlString(rule.assignedto)},
  ${sqlString(rule.warehousei)},
  ${sqlString(rule.itemcode)},
  ${sqlString(rule.contsize)},
  ${sqlString(rule.commonname)},
  ${sqlString(rule.locationcode)},
  ${sqlString(rule.source)},
  ${sqlString(rule.genusname)},
  ${sqlJson(rule.normalized)},
  true,
  now(),
  now()
)`).join(',\n'));
    lines.push(`on conflict (sheet_id, sheet_name, sheet_row_number) do update set
  assigned_to_raw = excluded.assigned_to_raw,
  assignedto = excluded.assignedto,
  warehousei = excluded.warehousei,
  itemcode = excluded.itemcode,
  contsize = excluded.contsize,
  commonname = excluded.commonname,
  locationcode = excluded.locationcode,
  source = excluded.source,
  genusname = excluded.genusname,
  normalized = excluded.normalized,
  active = true,
  imported_at = now(),
  updated_at = now();`);
  });

  if (rules.length) {
    const rowNumbers = rules.map((rule) => Number(rule.sheet_row_number) || 0).filter(Boolean);
    lines.push(`update public.v2_eval_assignment_rules
set active = false,
    updated_at = now()
where sheet_id = ${sqlString(sheetId)}
  and sheet_name = ${sqlString(sheetName)}
  and not (sheet_row_number = any(array[${rowNumbers.join(',')} ]::integer[]));`);
  } else {
    lines.push(`update public.v2_eval_assignment_rules
set active = false,
    updated_at = now()
where sheet_id = ${sqlString(sheetId)}
  and sheet_name = ${sqlString(sheetName)};`);
  }

  lines.push('commit;');
  lines.push('');
  lines.push(`select count(*) as active_eval_assignment_rules
from public.v2_eval_assignment_rules
where sheet_id = ${sqlString(sheetId)}
  and sheet_name = ${sqlString(sheetName)}
  and active = true;`);
  return lines.join('\n');
}

function parseClaspRc(rawValue) {
  if (!rawValue) throw new Error('APPS_SCRIPT_CLASPRC_JSON or CLASPRC_JSON is required for Google Sheets API import.');
  let text = rawValue;
  const possiblePath = path.resolve(process.cwd(), rawValue);
  if (!rawValue.trim().startsWith('{') && fs.existsSync(possiblePath)) {
    text = fs.readFileSync(possiblePath, 'utf8');
  }
  return JSON.parse(text);
}

function getOAuthClientFromClaspRc(google, claspRc) {
  const token = claspRc.token || claspRc.tokens || {};
  const settings = claspRc.oauth2ClientSettings || claspRc.oauth2Client || {};
  const clientId = String(settings.clientId || settings.client_id || process.env.APPS_SCRIPT_CLIENT_ID || '').trim();
  const clientSecret = String(settings.clientSecret || settings.client_secret || process.env.APPS_SCRIPT_CLIENT_SECRET || '').trim();
  const redirectUri = String(settings.redirectUri || settings.redirect_uri || 'http://localhost').trim();
  const refreshToken = String(token.refresh_token || process.env.APPS_SCRIPT_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth client id, client secret, and refresh token are required.');
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: token.access_token,
    token_type: token.token_type || 'Bearer',
    expiry_date: token.expiry_date
  });
  return oauth2Client;
}

async function readValuesFromGoogleSheets(options) {
  let google;
  try {
    ({ google } = require('googleapis'));
  } catch (error) {
    throw new Error('googleapis is not installed. Use --csv or --values-json, or install googleapis.');
  }

  const claspRc = parseClaspRc(String(process.env.APPS_SCRIPT_CLASPRC_JSON || process.env.CLASPRC_JSON || '').trim());
  const auth = getOAuthClientFromClaspRc(google, claspRc);
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `${options.sheetName}!A:H`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: options.spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return response.data.values || [];
}

function readValuesJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.values)) return parsed.values;
  if (parsed.data && Array.isArray(parsed.data.values)) return parsed.data.values;
  throw new Error('Values JSON must be an array or contain a values array.');
}

async function readSourceValues(options) {
  if (options.csv) return parseCsv(fs.readFileSync(options.csv, 'utf8'));
  if (options.valuesJson) return readValuesJson(options.valuesJson);
  return readValuesFromGoogleSheets(options);
}

async function applySql(sqlPath, options) {
  const dbUrl = String(process.env.GNC_SUPABASE_DB_URL || '').trim();
  if (!dbUrl) throw new Error('GNC_SUPABASE_DB_URL is required for --apply.');

  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const psqlMissing = result.error && result.error.code === 'ENOENT';
  if (!psqlMissing && result.status === 0) {
    log(options, String(result.stdout || '').trim());
    return;
  }

  if (!psqlMissing) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(`psql failed.${stderr ? `\n${stderr}` : ''}${stdout ? `\n${stdout}` : ''}`);
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (error) {
    throw new Error('psql was not found, and the pg package is not available. Install pg or install psql before using --apply.');
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  let nodePgUrl = dbUrl;
  try {
    const parsedUrl = new URL(dbUrl);
    parsedUrl.searchParams.delete('sslmode');
    parsedUrl.searchParams.set('sslmode', 'no-verify');
    nodePgUrl = parsedUrl.toString();
  } catch (error) {
    nodePgUrl = dbUrl;
  }
  const client = new Client({
    connectionString: nodePgUrl,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  log(options, `Reading Eval assignment rules from ${options.csv || options.valuesJson || `${options.spreadsheetId}:${options.sheetName}`}...`);
  const values = await readSourceValues(options);
  const parsed = parseValues(values, options);
  const sql = buildSql(parsed, options);
  fs.writeFileSync(options.out, sql, 'utf8');

  log(options, `Generated ${parsed.rules.length} active assignment rule(s) at ${options.out}.`);
  if (parsed.unknownNames.length) log(options, `Unknown names: ${parsed.unknownNames.join(', ')}`);
  if (parsed.skippedRows.length) log(options, `Skipped row(s): ${parsed.skippedRows.slice(0, 30).join(', ')}${parsed.skippedRows.length > 30 ? '...' : ''}`);
  if (parsed.conflicts.length) {
    log(options, `Potential conflicts: ${parsed.conflicts.slice(0, 10).map((conflict) => `${conflict.field} ${conflict.value} rows ${conflict.firstRow}/${conflict.secondRow}`).join('; ')}`);
  }

  if (options.apply) {
    const tempPath = options.out || path.join(os.tmpdir(), `eval-assignment-rules-${Date.now()}.sql`);
    await applySql(tempPath, options);
    log(options, 'Eval assignment rules imported into Supabase.');
  }
}

main().catch((error) => fail(error && error.message ? error.message : String(error)));
