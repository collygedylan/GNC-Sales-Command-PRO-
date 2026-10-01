import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = read('components/command-center/fieldCommandCenter.jsx');
const shell = read('index.html');
const builder = read('scripts/build-alpha-command-center.mjs');
const pushSender = read('supabase/functions/send-push-alert/index.ts');
const reminderSweep = read('supabase/functions/calendar-reminder-sweep/index.ts');

test('command center assets load only after the verified Dylan gate succeeds', () => {
  const loaderStart = shell.indexOf('async function mountAlphaCommandCenter(mode, host)');
  const loaderEnd = shell.indexOf('function isAuraProfileCandidate()', loaderStart);
  assert.notEqual(loaderStart, -1);
  const loader = shell.slice(loaderStart, loaderEnd);
  assert.match(loader, /if\s*\(!host\s*\|\|\s*!isAuraWidgetAuthorized\(\)\)\s*return/);
  assert.ok(loader.indexOf('!isAuraWidgetAuthorized()') < loader.indexOf('import(moduleUrl.href)'));
  assert.ok(loader.indexOf('!isAuraWidgetAuthorized()') < loader.indexOf("document.createElement('link')"));
  assert.match(shell, /String\(nativeAuthProfile\.username\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)\s*===\s*'dylan_collyge'/);
  assert.match(shell, /String\(currentUser\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)\s*===\s*'dylan_collyge'/);
  assert.match(builder, /assets\/alpha-command-center\.js/);
  assert.match(builder, /styles\/alpha-command-center\.css/);
  assert.doesNotMatch(loader, /fetch\([^)]*alpha-command-center/);
});

test('chat retry reuses the optimistic row identity and successful send settles that row', () => {
  assert.match(component, /const optimistic = \{ clientId, body: message,[\s\S]*optimistic: true \}/);
  assert.match(component, /current\.some\(row => row\.clientId === clientId\) \? current\.map\(row => row\.clientId === clientId \? \{ \.\.\.row, failed: false \}/);
  assert.match(component, /onRetry=\{row => void send\(row\.body, row\.clientId\)\}/);
  assert.match(component, /failed: true, optimistic: true/);
  assert.match(component, /optimistic: false, failed: false/);
  assert.match(component, /sendInFlight\.current\.has\(clientId\)/);
});

test('message feed virtualizes by row count, including large histories', () => {
  assert.match(component, /useVirtualizer\(\{ count: rows\.length/);
  assert.match(component, /overscan: 8/);
  assert.match(component, /virtualizer\.getVirtualItems\(\)\.map/);
  assert.match(component, /getItemKey: index => rows\[index\]\?\.clientId \|\| rows\[index\]\?\.id/);
  assert.doesNotMatch(component, /rows\.map\(row =>/);
});

test('weekly labor keeps separate job-code rows and autosaves each selected code/date pair', () => {
  assert.match(component, /grouped\.set\(code, \{ key: code, job_code: code, hours: \{\}, persisted: true \}\)/);
  assert.match(component, /const localEntriesRef = useRef\(\[\]\)/);
  assert.match(component, /localEntriesRef\.current = updated/);
  assert.match(component, /const row = localEntriesRef\.current\.find\(item => item\.key === key\)/);
  assert.match(component, /localEntries\.map\(row =>/);
  assert.match(component, /onConflict: 'employee_id,work_date,job_code'/);
  assert.match(component, /const timerKey = `\$\{key\}:\$\{field\}`/);
  assert.match(component, /await onSave\(\{ employee_id: employee\.id, work_date: field, job_code: row\.job_code, hours: Number\(value\) \}\)/);
  assert.match(component, /persisted: true/);
  assert.match(component, /disabled=\{row\.persisted\}/);
  assert.match(component, /created_by_profile_id: deps\.profileId/);
  assert.match(component, /entries\.filter\(row => row\.employee_id === employee\.id && dates\.includes\(row\.work_date\)\)/);
  assert.match(component, /employee_id: employee\.id, work_date: field, job_code: row\.job_code/);
});

test('time-off request draft clears only after the API confirms creation', () => {
  const start = component.indexOf('const submitRequest = async event =>');
  const end = component.indexOf('const updateRequest =', start);
  const submit = component.slice(start, end);
  assert.ok(submit.indexOf('await api({ action: \'alpha_timeoff_request\'') < submit.indexOf("setRequest({ title: '', start: '', end: '' })"));
  assert.match(submit, /catch \(cause\) \{ setError\(errorText\(cause\)\); \}/);
  assert.match(component, /value=\{request\.title\}[\s\S]*value=\{request\.start\}[\s\S]*value=\{request\.end\}/);
});

test('private realtime channel checks session freshness and removes the channel on cleanup', () => {
  const start = component.indexOf('function usePrivateChatChannel');
  const end = component.indexOf('function Communications', start);
  const hook = component.slice(start, end);
  assert.match(hook, /deps\.client\.auth\.getSession\(\)/);
  assert.match(hook, /deps\.client\.realtime\.setAuth\(data\.session\.access_token\)/);
  assert.match(hook, /if \(!active \|\| !deps\.isAuthorized\(\)\) return/);
  assert.match(hook, /return \(\) => \{ active = false; if \(channel\) void deps\.client\.removeChannel\(channel\); \}/);
  assert.match(hook, /alpha-chat:dylan_collyge:/);
});

test('calendar reminders require the configured service credential and target only Dylan', () => {
  assert.match(pushSender, /eventType === "hr_calendar_reminder"[\s\S]*?return \["dylan_collyge"\]/);
  assert.match(pushSender, /\(eventType === "hr_calendar_reminder" \|\| handoverEventTypes\.has\(eventType\)\) && authHeader !== SUPABASE_SERVICE_ROLE_KEY && apiKey !== SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(reminderSweep, /bearer !== SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(reminderSweep, /targetUsers: \["dylan_collyge"\]/);
});
