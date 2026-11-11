import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

async function serveAssignedFixture(base, req, res) {
    try {
        const file = path.resolve(base, '.' + new URL(req.url, 'http://fixture').pathname.replace(/\/$/, '/index.html'));
        if (!file.startsWith(base + path.sep)) throw Error('path');
        const type = {'.js':'text/javascript','.css':'text/css','.html':'text/html'}[path.extname(file)] || 'application/json';
        res.writeHead(200, { 'content-type': type });
        res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
}

export async function openAssignedBrowser() {
    const base = path.resolve('_site');
    const server = createServer((req, res) => serveAssignedFixture(base, req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, timeout: 15000 });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue()
        : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    try {
        await page.goto(origin + '/?e2e=assigned-first-open', { waitUntil: 'load', timeout: 20000 });
        await page.waitForFunction(() => window.__gncAppRuntimeExecuted === true);
    } catch (error) {
        await browser.close();
        server.closeAllConnections();
        server.close();
        throw error;
    }
    return { page, close: async () => {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    } };
}

export async function seedAssignedBrowser(page) {
    return page.evaluate(() => window.eval(`(() => {
        resetProductionLiveSync();
        currentUser = 'dylan_collyge'; currentUserDisplay = 'Dylan Collyge'; currentRole = 'Manager';
        activeHomeTab = MANAGER_TABLE_MANAGEMENT_VIEW;
        managersSearchTerm = ''; managerAssignedItemsAssignedToFilter = 'all';
        managerAssignedColumnState = { owner: currentUser, filters: {}, sort: null, editor: null };
        fullInventory = Array.from({length:9695}, (_, i) => ({ UNIQUE_ID:'row-'+i, MASTER_UNIQUE_ID:'row-'+i,
            ITEMCODE:String(i).padStart(6,'0'), COMMONNAME:i % 7 === 0 ? 'Zebra Rose' : 'Acer',
            ASSIGNEDTO:i % 3 === 0 ? 'megan_kelly' : 'dylan_collyge', DEFAULT_ASSIGNEDTO:'dylan_collyge',
            CONTSIZE:'#3', LOCATIONCODE:'D.08.'+String(i % 100).padStart(3,'0'), WAREHOUSEI:'10', GENUSNAME:'Rosa',
            PTRONHAND:100, AVAILABLE:75, SEASON:'S1', SALESYEAR:'26', LOTCODE:'26.S1', present_in_drive:true }));
        warehouseAssignedItemsInventory = [];
        for (const key of ['master','warehouseAssignedItems']) {
            const dataset = getDatasetState(key); dataset.initialLoaded = dataset.fullLoaded = true; dataset.fieldCoverage = 'full';
        }
        canAccessView = () => true; canViewAssignedItemsExport = () => true;
        getCurrentVisibleViewId = () => 'managers'; isViewVisible = view => view === 'managers';
        GncMobileWorkspace.syncHub = () => {}; syncManagersHeaderChrome = () => {};
        evalAssignableUsersDirectoryResolved = assignableAppUsersLoaded = true;
        getManagerToolTabs = () => [{id:MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW,label:'Assigned Items'}];
        hydrateAssignedItemsHomeTab = () => {};
        const wrapper = document.getElementById('view-wrapper');
        for (const view of wrapper.children) if (view.id.startsWith('view-')) view.classList.add('hidden');
        document.getElementById('view-managers').classList.remove('hidden');
        document.getElementById('app-wrapper').classList.remove('hidden');
        document.getElementById('app-wrapper').style.display = 'flex';
        document.getElementById('view-login').style.display = 'none';
        const start = performance.now();
        const result = new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const count = document.querySelectorAll('[data-manager-assigned-item-row]').length;
                if (count) { observer.disconnect(); resolve({ elapsed:performance.now()-start, count }); }
            });
            observer.observe(document.getElementById('managers-content'), {childList:true,subtree:true});
        });
        openManagerTableManagement('assigned-items');
        return result;
    })()`));
}
