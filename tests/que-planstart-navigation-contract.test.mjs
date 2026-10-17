import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function functionSource(name, nextName) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = html.indexOf(`\n        function ${nextName}(`, start + 1);
  assert.ok(end > start, `${name} boundary`);
  return html.slice(start, end);
}

function makePlanstartContext() {
  const context = {
    item: { PLANSTART: '2026-10-19T00:30:00+14:00' },
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
    findDockSuspendDcRequestSourceRow: () => null
  };
  vm.createContext(context);
  const start = html.indexOf('        const DOCK_SUSPEND_PLANSTART_ALIASES');
  const end = html.indexOf('\n        function getDockSuspendDcRequestPlanstartWeekday(', start);
  assert.ok(start >= 0 && end > start, 'Plan Start value/parser helper block exists');
  vm.runInContext(html.slice(start, end), context);
  return context;
}

test('Suspend Plan Start uses date calendar parts for ISO values and aliases', () => {
  const context = makePlanstartContext();
  const iso = context.getDockSuspendDcRequestPlanstartInfo(context.item);
  assert.equal(iso.weekday, 1, '2026-10-19 remains Monday despite a positive UTC offset');
  assert.equal(iso.tone, 'monday');
  context.item = { 'Plan Start': '10/20/2026' };
  assert.equal(context.getDockSuspendDcRequestPlanstartInfo(context.item).tone, 'tuesday');
  context.item = { PLANSTART: '2026-02-30' };
  assert.equal(context.getDockSuspendDcRequestPlanstartInfo(context.item).tone, 'unknown');
});

test('Date PLANSTART inputs use the Chicago calendar and card metadata names the date', () => {
  const context=makePlanstartContext();
  vm.runInContext("item = {PLANSTART:new Date('2026-10-20T02:00:00Z')}",context);
  assert.equal(context.getDockSuspendDcRequestPlanstartInfo(context.item).tone,'monday');
  assert.match(html,/app-operational-planstart-date/);
  assert.match(html,/PLANSTART:/);
});

test('queue category updates preserve the navigation and existing focused buttons', () => {
  const dom=new JSDOM('<div id="toolbar"><div class="request-category-options"><button data-request-category="pending"><span>Request</span><span>1</span></button></div></div>');
  const {document}=dom.window, toolbar=document.getElementById('toolbar'), root=toolbar.firstElementChild, button=root.firstElementChild;
  const context={document};vm.createContext(context);
  const start=html.indexOf('        function syncQueueCategoryToolbarMarkup(');
  assert.ok(start>=0,'keyed queue navigation helper exists');
  const end=html.indexOf('\n        function ',start+12);vm.runInContext(html.slice(start,end),context);
  button.focus();toolbar.scrollLeft=80;
  context.syncQueueCategoryToolbarMarkup(toolbar,'<div class="request-category-options"><button data-request-category="pending" aria-pressed="true"><span>Request</span><span>2</span></button><button data-request-category="bunch-notes">Bunch Notes</button></div>');
  assert.equal(toolbar.firstElementChild,root);assert.equal(root.firstElementChild,button);
  assert.equal(document.activeElement,button);assert.equal(toolbar.scrollLeft,80);
  assert.equal(button.textContent,'Request2');dom.window.close();
});

test('Que navigation state captures and restores its active tab, filters, and drill context', () => {
  const context = {
    activeReqTab: 'suspend-tag', selectedReqStatus: 'Complete', requestViewLevel: 2,
    selectedReqFolder: 'folder-1', selectedReqRepView: 'rep-1', selectedReqCustView: 'cust-1',
    selectedReqConsigneeView: 'consignee-1', selectedReqFolderView: 'folder-view-1',
    requestFolderSearchTerm: 'orchid', requestConsigneeDrillMode: 'credit', requestRepSearchTerm: 'rep',
    requestCustomerSearchTerm: 'customer', requestConsigneeSearchTerm: 'consignee', requestFolderDateFilter: 'last-week',
    requestDylanFilterMode: 'location', requestDylanFilterValue: 'north', requestDylanSalesRepValue: 'rep-1',
    requestDylanLocationValue: 'loc-1', requestSuspendTagDockFilter: 'dock-4',
    requestSuspendTagStatusFilter: 'completed', requestSuspendTagContSizeFilter: '#3',
    requestSuspendTagAssignedToFilter: 'worker-1', requestSuspendTagCommonNameSearchTerm: 'maple',
    requestDylanFilterMenuOpen: 'location',
    normalizeRequestTabValue: value => value,
    normalizeRequestDylanFilterMode: value => value,
    normalizeRequestSuspendTagDockFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    canUseRequestDylanViewerFilter: () => true,
    syncRequestTabButtons() {}
  };
  vm.createContext(context);
  vm.runInContext(functionSource('captureRequestViewState', 'restoreRequestViewState'), context);
  vm.runInContext(functionSource('restoreRequestViewState', 'normalizeAppFilterStateUserKey'), context);
  const snapshot = context.captureRequestViewState();
  context.activeReqTab = 'pending';
  context.requestViewLevel = 0;
  context.requestSuspendTagCommonNameSearchTerm = '';
  assert.equal(context.restoreRequestViewState(snapshot), true);
  assert.equal(context.activeReqTab, 'suspend-tag');
  assert.equal(context.selectedReqStatus, 'Complete');
  assert.equal(context.requestViewLevel, 2);
  assert.equal(context.requestSuspendTagCommonNameSearchTerm, 'maple');
  assert.equal(context.requestDylanFilterMenuOpen, '', 'transient filter menus are intentionally closed on restore');
});

test('Que primary panel is retained and hidden rather than removed during primary-view navigation', () => {
  const primaryIdsStart = html.indexOf('function getPrimaryViewIds()');
  const primaryIdsEnd = html.indexOf('\n        function getViewElementById(', primaryIdsStart);
  assert.ok(primaryIdsStart >= 0 && primaryIdsEnd > primaryIdsStart);
  assert.match(html.slice(primaryIdsStart, primaryIdsEnd), /return \['home', \.\.\.TRACKED_VIEW_IDS, 'detail'\]/);
  assert.match(html, /<div id="view-request" class="hidden">/);
  const visibilityStart = html.indexOf('function showOnlyPrimaryView(');
  const visibilityEnd = html.indexOf('\n        function scheduleTrackedViewRender(', visibilityStart);
  const visibility = html.slice(visibilityStart, visibilityEnd);
  assert.match(visibility, /el\.classList\.add\('hidden'\)/);
  assert.doesNotMatch(visibility, /\.remove\(\)|\.replaceWith\(/);
  assert.match(html, /function switchView\(viewId, options = \{\}\)[\s\S]*?scheduleRequestNavigationLiveWake\('request-switch'\)/);
});
