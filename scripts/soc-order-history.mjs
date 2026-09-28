import fs from 'node:fs';
import vm from 'node:vm';

// Exercise exactly the parser deployed in Apps Script, without duplicating it.
const source = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const start = source.indexOf('// SOC ORDER HISTORY PURE CORE START');
const end = source.indexOf('// SOC ORDER HISTORY PURE CORE END');
if (start < 0 || end <= start) throw new Error('SOC_HISTORY_CORE_MISSING');
const context = vm.createContext({ Intl, Date, JSON });
vm.runInContext(source.slice(start, end) + '\nthis.core = { parseSocHistoryReportTime_, inspectSocHistorySheet_, parseSocHistoryRows_, summarizeSocHistoryFiles_, SOC_HISTORY_LEGACY_COLUMNS };', context);
export const core = context.core;
export const parseReportTime = core.parseSocHistoryReportTime_;
export const parseRows = core.parseSocHistoryRows_;
export const summarizeFiles = core.summarizeSocHistoryFiles_;
