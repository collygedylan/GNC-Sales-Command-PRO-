import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const index = read('index.html');
const rowWorkflow = read('assets/row-workflow-functions.js');
const markup = read('assets/av-filter-markup.js');
const excel = read('assets/header-excel-export.js');

function takeFunctions(source, names) {
    const declarations = new Map(parse(source, { ecmaVersion: 'latest' }).body
        .filter(node => node.type === 'FunctionDeclaration').map(node => [node.id.name, node]));
    return names.map(name => {
        const node = declarations.get(name);
        assert.ok(node, name);
        return source.slice(node.start, node.end);
    }).join('\n');
}

const columnFunctions = takeFunctions(rowWorkflow, [
    'getInventoryExcelFields', 'getInventoryExcelState', 'inventoryExcelKey', 'getInventoryExcelFacts',
    'inventoryExcelFactMatches', 'getInventoryExcelOptions', 'getVisibleInventoryExcelFields'
]);
const fixtureSource = `
    let owner = 'authorized-account';
    function getSupabaseReadIdentityScope() { return owner; }
    function getAvPhotoMode() { return 'all'; }
    function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'); }
    const stateRows = [
        {COMMONNAME:'Gardenia', SEASON:'S1', LOCATIONCODE:'A.01', assigned_usernames:['eval-a']},
        {COMMONNAME:'Gardenia', SEASON:'S1', LOCATIONCODE:'A.02', assigned_usernames:['eval-b']},
        {COMMONNAME:'Holly', SEASON:'F1', LOCATIONCODE:'B.01', assigned_usernames:['eval-c']}
    ];
    function seedCurrentAvRows() {
        const state = getInventoryExcelState('av');
        state.rows = stateRows;
        state.filters.season = new Set(['s1']);
        return state;
    }`;

export function verifyAvCompactFilterContract() {
    const context = vm.createContext({});
    vm.runInContext(columnFunctions + '\n' + excel + fixtureSource, context);
    const result = vm.runInContext(`JSON.stringify({
        headers: inventoryExcelBarHtml('av'),
        names: getInventoryExcelOptions(seedCurrentAvRows(), 'commonname'),
        users: getInventoryExcelOptions(getInventoryExcelState('av'), 'username'),
        switched: (owner = 'other', getInventoryExcelOptions(getInventoryExcelState('av'), 'username')),
        drive: inventoryExcelBarHtml('drive')
    })`, context);
    const { headers, names, users, switched, drive } = JSON.parse(result);
    assert.match(headers, /openInventoryExcelFilter\('av',this.dataset.field,this\)"><span>Username \/ Eval User<\/span><span>All ▾<\/span>/);
    assert.deepEqual(names, [{ key: 'gardenia', label: 'Gardenia', count: 2 }]);
    assert.deepEqual(users.map(user => user.key), ['eval-a', 'eval-b']);
    assert.deepEqual(switched, []);
    assert.match(drive, /<span>Year<\/span><button[^>]*data-field="salesyear"/);
}

function fixtureShell() {
    return index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, tag => {
        const file = tag.match(/href="\.\/([^"?]+)\?/)?.[1];
        return file && tag.includes('rel="stylesheet"') ? '<style>' + read(file) + '</style>' : '';
    });
}

function fixtureBrowserSource() {
    const popover = takeFunctions(rowWorkflow, ['openInventoryExcelFilter', 'getInventoryExcelDisplayedOptions', 'paintInventoryExcelOptions', 'getInventoryExcelPopoverHost', 'positionDriveExcelPopover', 'closeInventoryExcelPopover']);
    return [columnFunctions, markup, excel, fixtureSource, popover, `
        function ensureAvControlsVisible(el) { el.classList.add('av-top-inline'); el.classList.remove('hidden'); }
        function setContainerHtml(el, value) { el.innerHTML = value; }
        function setContainerHtmlWithSignature(el, value) { el.innerHTML = value; }
        function setNodeClassNameIfChanged(el, value) { el.className = value; }
        function setNodeTextIfChanged(el, value) { el.textContent = value; }
        function buildExcelFilterFastAttrs(handler) { return 'onclick="' + handler + '()"'; }
        function doesExcelFilterSearchMatchStart(label, term) { return label.toLowerCase().includes(term.toLowerCase()); }
        function toggleAvSourceDropdown() {
            syncAvTopControlShell(document.getElementById('av-top-filters'), 'source', {
                open:true, summary:'Season', bodyHtml:'<button type="button">Current Season</button>'
            });
        }`].join('\n');
}

async function loadAvFixture(page, html, script, mobile) {
    await page.setContent(html);
    await page.addScriptTag({ content: script });
    await page.evaluate(mobile => {
        document.body.classList.add('ops-precision-pilot', 'performance-lean-shell', 'agdata-pinned-results', 'current-view-av');
        if (mobile) document.body.classList.add('ios-device', 'app-standalone', 'viewport-compact');
        const app = document.getElementById('app-wrapper');
        app.classList.remove('hidden');
        for (const element of document.body.children) {
            if (element !== app && !['STYLE', 'SCRIPT'].includes(element.tagName)) element.style.display = 'none';
        }
        const view = document.getElementById('view-av');
        view.classList.remove('hidden');
        view.classList.add('agdata-pinned-view');
        const rail = document.getElementById('av-top-filters');
        ensureAvTopControlsShell(rail);
        seedCurrentAvRows();
        rail.querySelector('[data-inventory-excel-scope]').innerHTML = inventoryExcelBarHtml('av');
        const content = document.getElementById('av-content');
        content.classList.add('agdata-results-scroll');
        content.innerHTML = '<article class="app-av-catalog-card"><h2>Gardenia</h2></article>';
    }, mobile);
}

async function readRail(page) {
    return page.evaluate(() => {
        const rail = document.getElementById('av-top-filters');
        const card = document.querySelector('#av-content article').getBoundingClientRect();
        const controls = [...rail.querySelectorAll('button')].filter(el => el.getClientRects().length);
        const boxes = controls.map(el => {
            const { top, left, right, height } = el.getBoundingClientRect();
            return { top, left, right, height, label: el.textContent.trim().replace(/\s+/g, ' '), field: el.dataset.field };
        });
        const first = rail.getBoundingClientRect();
        return { boxes, cardTop: card.top, railHeight: first.height, railBottom: first.bottom, cardHeight: card.height, scrolls: rail.scrollWidth > rail.clientWidth };
    });
}

async function checkAvProfile(page, html, script, mobile) {
    await loadAvFixture(page, html, script, mobile);
    const geometry = await readRail(page);
    const { boxes } = geometry;
    assert.match(boxes[0]?.label, /^Stock/);
    assert.equal(boxes[1]?.field, 'username');
    assert.ok(boxes.some(box => box.field === 'lotcode'));
    assert.ok(boxes.every((box, index) => Math.abs(box.top + box.height / 2 - boxes[0].top - boxes[0].height / 2) <= 3
        && (!index || box.left >= boxes[index - 1].right - 1)), JSON.stringify(boxes));
    assert.ok(boxes.filter(box => !box.label.includes('×')).every(box => box.height >= 44));
    assert.ok(geometry.railHeight <= 62);
    assert.ok(geometry.cardHeight > 0 && geometry.cardTop >= geometry.railBottom && geometry.cardTop < geometry.railBottom + 75);
    if (mobile) assert.equal(geometry.scrolls, true);
    await page.getByRole('button', { name: /Common Name All/ }).click();
    const options = page.locator('#av-excel-popover [data-excel-options]');
    assert.match(await options.innerText(), /Gardenia\s+\(2\)/);
    assert.doesNotMatch(await options.innerText(), /Holly/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Stock Season/ }).click();
    const stock = page.locator('[data-av-filter-shell="source"] [data-role="panel"] button');
    const box = await stock.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width);
    assert.equal(await stock.evaluate(button => getComputedStyle(button).color), 'rgb(236, 253, 245)');
    assert.equal(await stock.evaluate(button => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true);
    const fallbackReachable = await stock.evaluate(button => {
        const panel = button.closest('[data-role="panel"]');
        panel.hidePopover();
        panel.removeAttribute('popover');
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    assert.equal(fallbackReachable, true, 'Stock remains clickable without a native popover');
    return Math.round(geometry.railHeight);
}

export async function verifyAvCompactFilterGeometry() {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
        const html = fixtureShell();
        const script = fixtureBrowserSource();
        const heights = [];
        for (const [width, height] of [[390, 844], [412, 915], [820, 1180], [1440, 900]]) {
            const mobile = width < 500;
            const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
            heights.push(await checkAvProfile(page, html, script, mobile));
            await page.close();
        }
        return heights;
    } finally {
        await browser.close();
    }
}
