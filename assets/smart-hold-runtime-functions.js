        function getSmartHoldContext() {
            const owner = getSupabaseReadIdentityScope();
            if (smartHoldContext.owner !== owner) smartHoldContext = { owner, history: [], docks: [], key: '', pending: null, requested: '', weatherAt: 0 };
            return smartHoldContext;
        }

        function warmSmartHoldContext(rows = []) {
            const context = getSmartHoldContext();
            const H = globalThis.AgDataHoldIntelligence;
            if (!H || !currentUser) return;
            if (Date.now() - context.weatherAt > 3600000) {
                context.weatherAt = Date.now();
                H.refreshWeather().then(() => { if (context !== getSmartHoldContext()) return; if (isViewVisible('smart-moves')) renderSmartMovesIntelligence(); if (isViewVisible('shear-list')) renderShearList(); });
            }
            const itemcodes = [...new Set(rows.map(row => getSalesIntelligenceItemCode(row)).filter(Boolean))].slice(0, 30).sort();
            const key = itemcodes.join('|');
            if (!key || context.key === key || context.pending || context.requested === key) return;
            context.requested = key;
            context.pending = postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'smart_hold_context', itemcodes }, { timeoutMs: 12000, label: 'Hold history' })
                .then(result => { if (context !== getSmartHoldContext() || !result?.ok) return; if (result.history?.length || !result.partial) context.history = result.history || []; if (result.docks?.length || !result.partial) context.docks = result.docks || []; context.partial = !!result.partial; context.key = key; if (isViewVisible('smart-moves')) renderSmartMovesIntelligence(); if (isViewVisible('shear-list')) renderShearList(); })
                .catch(() => {}).finally(() => { context.pending = null; });
        }

        function getSmartShearGuard(row) {
            const H = globalThis.AgDataHoldIntelligence, context = getSmartHoldContext();
            if (!H) return { conflict: false };
            const indexKey = [getDatasetLoadSignature('soc'), getDatasetLoadSignature('reserves'), context.key].join('|');
            if (context.indexKey !== indexKey) { context.indexKey = indexKey; context.loadIndex = H.buildLoadIndex(socInventory, reservesInventory, context.docks); }
            return H.shearGuard(row, context.loadIndex, H.getWeather(), context.history, fullInventory);
        }

        function renderSmartWeatherBar() {
            const H = globalThis.AgDataHoldIntelligence, weather = H.getWeather(), today = H.today(), day = H.weatherDay(today, weather);
            return '<div class="smart-weather-bar"><span>Today’s Temp: <b>' + day.high + '°F / ' + day.low + '°F</b></span><span>Today’s GDD Gain: <b>+' + H.dailyGdd(day.high, day.low).toFixed(1) + ' GDD</b></span><span>7-Day Forecast GDD: <b>+' + H.sumGdd(today, H.addDays(today, 7), weather) + '</b></span><span>14-Day Forecast GDD: <b>+' + H.sumGdd(today, H.addDays(today, 14), weather) + '</b></span><small>Park Hill, OK · ' + escapeHtml(day.source) + ' · max(0, (High + Low − 50) / 2) · <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather by Open-Meteo</a></small></div>';
        }

        function renderSmartHoldMetrics(row) {
            const H = globalThis.AgDataHoldIntelligence, risk = H.holdRisk(row, H.getWeather(), getSmartHoldContext().history);
            return '<div class="smart-hold-metrics"><div><small>Hold Reason</small><b>' + escapeHtml(risk.exact) + '</b></div><div><small>GDD Until ON HOLD</small><b>' + (risk.held ? 'CURRENTLY ON HOLD' : risk.onRemaining + ' GDD · ~' + risk.onDate) + '</b></div><div><small>GDD Until OFF HOLD</small><b>' + risk.offRemaining + ' GDD · ~' + risk.offDate + '</b></div><small class="smart-estimate">' + escapeHtml(risk.basis) + ' · ' + risk.sampleCount + ' completed cycles. Hold release requires field review; cleanup, treatment and cold holds are not resolved by heat alone.</small></div>';
        }

        function smartShearGuardMessage(guard) {
            return 'Outbound Load Commitment: ' + guard.orders + ' Active Order(s) · ' + guard.qty + ' Units · Earliest Load Plan Start: ' + (guard.shipDate || 'Date unconfirmed') + '\nSOC / Dock Load: ' + guard.loads.map(load => load.source + ' ' + (load.order || load.trip) + (load.dock ? ' · Dock ' + load.dock : '')).join(', ') + '\nGDD Before Shear Hold: 0 GDD | GDD to Come Off Sheared Hold: ' + guard.recovery + ' GDD | Forecast GDD Before Load Ships: ' + guard.forecast + ' GDD (Short by ' + guard.deficit + ' GDD!)\nProjected Off-Hold Date If Sheared Today: ~' + guard.offDate + '\nDO NOT SHEAR THIS LOCATION BEFORE LOAD SHIPS — Ship ' + guard.qty + ' units first' + (guard.alternatives.length ? ' (or confirm unsheared alternate location ' + guard.alternatives.join(', ') + ')' : '') + ', then shear!\n' + guard.scope + ' · Planning estimate; confirm field recovery.';
        }

        function renderSmartShearGuard(row) {
            const guard = getSmartShearGuard(row);
            return guard.conflict ? '<aside class="smart-shear-alert" role="note"><strong>🛑 DO NOT SHEAR — GOING OUT ON LOAD</strong><p>' + escapeHtml(smartShearGuardMessage(guard)).replace(/\n/g, '<br>') + '</p></aside>' : '';
        }

        async function confirmSmartShearLoadGuard(rows) {
            warmSalesIntelligenceData();
            warmSmartHoldContext(rows);
            const guards = rows.map(getSmartShearGuard).filter(guard => guard.conflict);
            if (!guards.length && isDatasetLoaded('soc', 'full') && isDatasetLoaded('reserves', 'full')) return true;
            return showAppConfirm(guards.length ? guards.map(smartShearGuardMessage).join('\n\n') : 'Outbound commitments are still refreshing. Confirm the load plan with the crew before shearing.', { title: guards.length ? '🛑 DO NOT SHEAR — GOING OUT ON LOAD' : 'Verify Outbound Load Plan', confirmLabel: 'I reviewed the load conflict — Continue', tone: 'danger' });
        }

        function buildSmartHoldCards(model) {
            const H = globalThis.AgDataHoldIntelligence;
            const type = salesIntelligenceFilters.move;
            return model.inventoryFacts.filter(fact => fact.onHand > 0).filter(fact => type !== 'shear-guard' || getSmartShearGuard(fact.row).conflict).map(fact => {
                const demand = model.demandByItem.get(fact.itemCode) || [];
                return { ...fact, type, title: type === 'shear-guard' ? 'SHEAR LOAD GUARD' : 'HOLD RISK (GDD)', value: fact.onHand * fact.listPrice, units: fact.onHand, states: new Set(demand.map(d=>d.state).filter(Boolean)), reps: new Set(demand.map(d=>d.rep).filter(Boolean)), source: 'DriveAround + SOC / Reserves', summary: H.holdReason(fact.row).exact + ' · ' + (H.field(fact.row,'locationcode') || 'Location unconfirmed') + ' · ' + H.field(fact.row,'lotcode'), rowCount: 1 };
            });
        }

