import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/manager-source-live-events.js', import.meta.url), 'utf8');
function api() {
  const context = { CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.GncManagerSourceLiveEvents;
}

test('manager source refresh events accept only authorized visible sources for their exact module', () => {
  const events = api(), received = [];
  const target = { dispatchEvent(event) { received.push(event); return true; } };
  const allowed = {
    'company-directory': ['ph_company_directory_contacts', 'ph_company_directory_blocks', 'ph_company_directory_beds', 'ph_company_directory_codes'],
    'production-schedule': ['production_schedule_active'],
    'hr-command': ['core_employees', 'hr_job_codes', 'labor_timesheets', 'ph_department_calendar_events']
  };
  for (const [tab, sources] of Object.entries(allowed)) {
    assert.equal(events.dispatch(target, { authorized: true, visible: true, view: 'managers', tab, sources }), true);
  }
  assert.equal(received.length, 3);
  assert.equal(received[2].type, 'gnc-manager-source-revision');
  assert.equal(received[2].detail.surface, 'hr-command');
  assert.deepEqual(Array.from(received[2].detail.sources), allowed['hr-command']);
});

test('manager source refresh events reject stale, unauthorized, or forged module source sets', () => {
  const events = api(), received = [];
  const target = { dispatchEvent(event) { received.push(event); return true; } };
  const current = { authorized: true, visible: true, view: 'managers', tab: 'company-directory', sources: ['ph_company_directory_contacts'] };
  for (const denied of [
    { ...current, authorized: false }, { ...current, visible: false },
    { ...current, view: 'drive' }, { ...current, tab: 'sales-reps' },
    { ...current, sources: ['ph_master_inventory'] }, { ...current, sources: [] }
  ]) assert.equal(events.dispatch(target, denied), false);
  assert.equal(events.dispatch({}, current), false);
  assert.equal(received.length, 0);
});

test('communications revision events are limited to authenticated chat and calendar sources', () => {
  const events = api(), received = [];
  const target = { dispatchEvent(event) { received.push(event); return true; } };
  assert.equal(events.dispatch(target, { authorized: true, visible: true, view: 'communication', tab: 'communications-chat', sources: ['ph_chat_messages'] }), true);
  assert.equal(events.dispatch(target, { authorized: true, visible: true, view: 'communication', tab: 'communications-calendar', sources: ['ph_department_calendar_events'] }), true);
  assert.equal(events.dispatch(target, { authorized: true, visible: true, view: 'communication', tab: 'communications-chat', sources: ['ph_master_inventory'] }), false);
  assert.equal(events.dispatch(target, { authorized: true, visible: true, view: 'managers', tab: 'communications-calendar', sources: ['ph_department_calendar_events'] }), false);
  assert.equal(received.length, 2);
  assert.equal(received[0].detail.surface, 'communications-chat');
  assert.equal(received[1].detail.surface, 'communications-calendar');
});
