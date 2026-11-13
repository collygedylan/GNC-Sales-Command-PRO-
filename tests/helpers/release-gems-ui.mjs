import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function squareMediaFixture(lockContext) {
    return lockContext(['renderAvInventoryCardMarkup', 'renderAvCardNote', 'ensurePhotoTakenDateBadges'], {
        firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
        buildAuthorizedAvCardActivationAttrs: () => '',
        buildAvCardSelection: () => '',
        buildAvCardActions: () => '',
        escJsAttrValue: String,
        escapeHtml: String,
        esc: String,
        renderAvCardHeading: () => '',
        renderAvCardQuantities: () => '<div data-fixture-quantity>80</div>',
        renderAvCardHold: () => '',
        resolveAndFormatPhotoDate: () => 'Nov 13, 2026'
    });
}

export function assertSharedSquareMedia(read, lockContext) {
    const css = read('assets/app-shell-style-05.css');
    assert.ok(/app-inline-thumb-box[^}]*width:84px!important;height:84px!important/.test(css), 'shared thumbnail must be 84px square');
    assert.ok(/app-inline-thumb-box[^}]*img\{[^}]*object-fit:cover!important/.test(css), 'shared thumbnail must crop inside the border');
    const context = squareMediaFixture(lockContext);
    const markup = context.renderAvInventoryCardMarkup({
        item: { DOM_ID: 'row', SPEC: '16–18 in', CALIPER: '1 in' }, liveEvidenceRow: {},
        sourceView: 'av', avNoteText: 'Keep in shade', hasValidAvPhotos: true,
        heroHtml: '<img src="example.webp">', photoDateHtml: '', holdBorderClass: ''
    });
    const { window } = new JSDOM(markup);
    try {
        const { document } = window;
        context.ensurePhotoTakenDateBadges(document);
        context.ensurePhotoTakenDateBadges(document);
        const media = document.querySelector('.app-av-catalog-media');
        assert.equal(media.querySelectorAll('.photo-thumb-date').length, 1);
        assert.equal(media.querySelector('.app-av-catalog-photo-wrap .photo-thumb-date'), null);
        assert.equal(media.querySelector(':scope > .photo-thumb-date').textContent, 'Nov 13, 2026');
        const fields = Array.from(document.querySelector('.app-av-catalog-info').children, node => node.textContent);
        assert.deepEqual(fields.slice(0, 4), ['80', 'Spec16–18 in', 'Caliper1 in', 'AV NoteKeep in shade']);
    } finally {
        window.close();
    }
}

export function assertErpProgress(read, lockedFunction) {
    const shell = read('index.html');
    const css = read('assets/erp-sync-progress.css');
    assert.ok(/\bPrint\b/.test(shell), 'Home keeps Print');
    assert.ok(shell.includes('Run Script Now'), 'ERP modal keeps the Run Script action');
    assert.ok(/id="erp-sync-progress-modal" class="modal hidden"/.test(shell), 'ERP modal starts hidden');
    assert.ok(/#erp-sync-progress-modal[^}]*align-items:center;justify-content:center/.test(css), 'ERP modal stays centered');
    assert.ok(/width:min\(94vw,480px\);max-width:100%;margin:0 auto;box-sizing:border-box/.test(css), 'ERP dialog fits the viewport');
    const context = vm.createContext({});
    vm.runInContext(read('assets/erp-sync-ui-functions.js'), context);
    const keys = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];
    const stages = keys.map(key => ({ key, outcome: 'UP_TO_DATE' }));
    const complete = { stageResults: stages, sourceProgress: { order_history: { percent: 0 } } };
    const cards = context.erpSyncProgressCards(complete);
    assert.deepEqual(Array.from(cards, card => card.key), ['drive', 'cav', 'reserves', 'soc', 'hl_po']);
    assert.equal(cards.reduce((sum, card) => sum + card.percent, 0) / 5, 100);
    assert.equal(context.completeOperationalErpSyncStatus(complete).status, 'complete');
    const drive = { fileName: 'exact.xlsx', publishedFileName: 'exact.xlsx', publicationConfirmed: true,
        rowsPublished: 9498, percent: 95, stage: 'downloading' };
    const running = { active: true, status: 'running', sourceProgress: { drive } };
    const partial = context.completeOperationalErpSyncStatus(running);
    assert.equal(partial.active, true);
    assert.equal(partial.status, 'running');
    assert.equal(partial.percent, 20);
    const partialCards = context.erpSyncProgressCards(partial);
    assert.equal(partialCards[0].percent, 100);
    assert.equal(partialCards[0].stage, 'published');
    assert.equal(partialCards.slice(1).every(card => card.percent === 0), true);
    drive.publishedFileName = 'different.xlsx';
    assert.equal(context.erpSyncProgressCards(running)[0].percent, 95);
    assert.doesNotMatch(lockedFunction('renderErpSyncProgressModal'), /state.percent === 100 \? 100/);
    assert.ok(read('assets/erp-sync-ui-functions.js').includes('Checked Drive — Up to date in App'), 'unchanged sources retain their status label');
}
