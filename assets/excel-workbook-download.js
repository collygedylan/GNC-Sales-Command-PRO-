function buildFilteredWorkbookFile(columns, rows, title, searchTerm, fileLabel, metaRows, options = {}) {
    const normalized = columns.map(column => Array.isArray(column)
        ? { label: column[1], value: row => row[column[0]] ?? '' } : column);
    return buildExcelWorkbookFile(normalized, rows, title, searchTerm, fileLabel, metaRows,
        { ...options, filenameBase: options.filenameBase || title || fileLabel });
}

function setExcelExportFeedback(message, pending = false) {
    const button = document.getElementById('global-excel-export');
    if (!button) return;
    const label = button.querySelector('span');
    if (label) label.textContent = message;
    button.disabled = pending;
    button.setAttribute('aria-live', 'polite');
}

function downloadExcelWorkbook(columns, rows, title, searchTerm = '', fileLabel = 'export', metaRows = null, options = {}) {
    const workbookFile = buildFilteredWorkbookFile(columns, rows, title, searchTerm, fileLabel, metaRows, options);
    const url = URL.createObjectURL(workbookFile.workbookBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = workbookFile.filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
    }, 10000);
    setExcelExportFeedback('✓ Exported (' + rows.length + ' rows)');
    return { ...workbookFile, rowCount: rows.length };
}
