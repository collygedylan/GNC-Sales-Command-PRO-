function appendDriveCommonNameHtml(pending, html, firstBatch) {
    const template = pending.container.ownerDocument.createElement('template');
    template.innerHTML = html;
    pending.fragment.appendChild(template.content);
    if (firstBatch) pending.container.replaceChildren(pending.fragment);
    else pending.container.appendChild(pending.fragment);
}

function updateDriveCommonNameProgress(pending, total) {
    const progress = pending.container.querySelector('[data-drive-commonname-progress]');
    if (progress) progress.textContent = `${pending.index} of ${total} names`;
}

function runDriveCommonNameBatch(options) {
    const { pending, entries, renderEntry } = options;
    if (!options.isCurrent()) {
        options.onStale();
        return;
    }
    try {
        const started = performance.now();
        const batchSize = 40;
        const budgetMs = pending.index === 0 ? 16 : 8;
        let html = '', count = 0;
        while (pending.index < entries.length && count < batchSize
            && (count === 0 || performance.now() - started < budgetMs)) {
            html += renderEntry(entries[pending.index++]);
            count += 1;
        }
        const firstBatch = pending.index === count;
        (options.appendHtml || appendDriveCommonNameHtml)(pending, html, firstBatch);
        (options.updateProgress || updateDriveCommonNameProgress)(pending, entries.length);
        if (pending.index < entries.length) {
            pending.frame = (options.requestFrame || requestAnimationFrame)(() => runDriveCommonNameBatch(options));
            return;
        }
        if (!options.isCurrent()) return;
        const countRendered = options.getRenderedCount
            ? options.getRenderedCount() : pending.container.querySelectorAll('[role="button"]').length;
        if (countRendered !== entries.length) throw new Error('The complete Common Name list could not be prepared. Please retry.');
        options.onComplete();
    } catch (error) {
        options.onError(error);
    }
}

function prepareDriveCommonNameBatches(options = {}) {
    const callbacks = ['renderEntry', 'isCurrent', 'onStale', 'onComplete', 'onError'];
    if (!options.pending || !Array.isArray(options.entries)
        || callbacks.some(name => typeof options[name] !== 'function')) {
        throw new TypeError('Drive Common Name preparation requires state, entries and lifecycle callbacks.');
    }
    runDriveCommonNameBatch(options);
    return options.pending;
}

(function (root, api) {
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GncDriveCommonNamePreparation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,
    Object.freeze({ prepareDriveCommonNameBatches }));
