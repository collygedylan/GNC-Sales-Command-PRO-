export async function seedOperationalExcel(page) {
    await page.evaluate(() => window.eval(`(() => {
        ensureViewDataForRender=()=>false;isMasterFullProjectionReady=()=>true;requireCurrentProductionLiveSyncProof=()=>true;
        fullInventory=fullInventory.slice(0,3).map((row,index)=>({...row,COMMONNAME:index===2?'Oak':'Acer',
            PHOTOS:index===1?[]:[{url:'https://fixture.test/photo-'+index+'.jpg',created_at:new Date().toISOString()}],
            PHOTO_LINK:index===1?'':'https://fixture.test/photo-'+index+'.jpg',PHOTO_DATE:new Date().toISOString(),
            LOC_PHOTO_MATCH:50,MATCH:50,PRIORITY:1,REQ_QTY:3,ORDER_QTY:5}));
        fullInventory.forEach(buildSearchIndex);avOpenInventory=fullInventory;
        activeAVTab='open';activeAvSalesBucket='open';activeAvPhotoMode='valid_photos';avValidPhotosOnly=true;
        avResolvedBaseStateKey='';avResolvedBaseStateCache=null;document.getElementById('av-search').value='Acer';
        activeDriveMode='ok';activeDriveTab='name';document.getElementById('drive-search').value='Acer';
        window.__excelView='drive';getCurrentVisibleViewId=()=>window.__excelView;isViewVisible=view=>view===window.__excelView;
        window.__excelRows=fullInventory.filter(row=>row.COMMONNAME==='Acer');
        useManagerReportPages=()=>false;canViewManagerEvalReports2=()=>true;isManagerEvalReport2SnapshotReadyForEdits=()=>true;
        getManagerEvalReport2Rows=()=>fullInventory;
        getManagerEvalReport2Index=()=>({currentSalesYear:'26',nextSeason:'F1',nextSalesYear:'27',settings:{lowStockMaxSLts:150,holdAgeDays:10,locationNoteAgeDays:10}});
        managerEvalReport2SeasonFilters=new Set();managerEvalReport2AssignedToFilters=new Set();
        managerEvalReport2ContSizeFilter='all';managerEvalReport2LocationFilter='all';managerEvalReport2PriorityFilter='all';
        managerEvalReport2SelectedCommonName='Acer';managerEvalReport2SelectedContSize='';managerEvalReport2BrowseMode='plant';
        managersSearchTerm='';managerEvalReport2Mode='reports';
    })()`));
}

export async function selectOperationalExcel(page, view, tab = '') {
    return page.evaluate(({view,tab}) => window.eval(`(() => {
        window.__excelView=${JSON.stringify(view)};
        if (${JSON.stringify(view)}==='request') activeReqTab=${JSON.stringify(tab)};
        if (${JSON.stringify(view)}==='managers') activeHomeTab=MANAGER_EVAL_REPORTS_2_VIEW;
        if (['request','docks'].includes(${JSON.stringify(view)})) rememberOperationalExport(${JSON.stringify(view)},window.__excelRows);
        if (${JSON.stringify(view)}==='av') return getAVExportColumns()[0].label;
        if (['drive','managers'].includes(${JSON.stringify(view)})) return getDriveReportExportColumns()[0].label;
        return 'ITEMCODE';
    })()`), {view,tab});
}
