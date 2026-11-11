function installNurseryExcelProvider(context) {
    context.root.agdataExcelProvider = () => {
        if (context.state.destroyed || !context.root.isConnected || context.options.authorized?.() === false) {
            throw Error('The table or account changed. Reopen it before exporting.');
        }
        if (context.state.loading || context.state.pending.size) throw Error('Wait for the current table read or save before exporting.');
        context.draw();
        const snapshot = context.state.excelSnapshot;
        if (!snapshot) throw Error('The table has no exportable rows yet.');
        const template = document.createElement('template');
        const rows = snapshot.rows.map((row,index) => snapshot.render(row,index - context.state.page * 100)
            .map(value => nurseryExcelCellText(template,value)));
        const columns = snapshot.headers.map((label,index) => ({label,value:row => row[index]}));
        return {title:snapshot.title,columns,rows};
    };
}

function publishNurseryExcelSnapshot(context, rows, headers, render) {
    const title = context.model.TABLES.find(table => table.id === context.state.view)?.label || context.state.view;
    context.state.excelSnapshot = {title,rows,headers,render};
}

function publishNurseryDrillExcelSnapshot(context, rows, cards, planting, level, query) {
    const prefix = level === 'number' ? context.state.alpha + '.' : context.state.blockNumber + '.';
    const candidates = level === 'cards' ? cards : rows.filter(row => level === 'alpha' || row.location.startsWith(prefix));
    const filtered = candidates.filter(row => !query || [row.itemcode,row.commonname,row.location].join(' ').toLowerCase().includes(query));
    if (planting) {
        const fields = ['itemcode','commonname','contsize','from','final_target','final_qty','final_beds'];
        publishNurseryExcelSnapshot(context,filtered,fields,row => fields.map(field => context.escape(row[field] ?? '')));
        return;
    }
    publishNurseryIssueExcelSnapshot(context,filtered);
}

function publishNurseryIssueExcelSnapshot(context, rows) {
    const headers = ['Item Code','Common Name','Container Size','Location','Lot / Date','On Hand','Available','Current Bunch Note','Suggested Bunch Note','Status'];
    const render = row => [row.itemcode,row.commonname,row.contsize,row.location,context.readRow(row.row,'lotcode'),
        row.qty,row.available,row.rawBunchNote,row.autoSuggestedBunchNote,row.approved ? 'Approved' : row.bunchNoteIssues.length + ' issues'].map(context.escape);
    publishNurseryExcelSnapshot(context,rows,headers,render);
}

function nurseryExcelCellText(template, value) {
    template.innerHTML = String(value ?? '');
    const input = template.content.querySelector('input,textarea,select');
    if (!input) return template.content.textContent;
    if (input.type === 'checkbox') return input.checked;
    if (input.tagName === 'SELECT') return input.selectedOptions[0]?.textContent || input.value;
    return input.value;
}
