        function getFilteredSmartMoveKpis(model, cards) {
            if (!['rep','state','plant','size','hold','search'].some(key=>salesIntelligenceFilters[key]) && salesIntelligenceFilters.move==='all') return model;
            const groups=new Set(cards.map(card=>globalThis.AgDataHoldIntelligence.wholeGroupKey(card.row)));
            const facts=model.inventoryFacts.filter(fact=>groups.has(globalThis.AgDataHoldIntelligence.wholeGroupKey(fact.row)));
            const f1=facts.filter(f=>f.season==='F1'&&(f.salesYear==null||f.salesYear<=SALES_INTELLIGENCE_TARGET_YEAR)),s1=facts.filter(f=>f.season==='S1'&&f.salesYear===SALES_INTELLIGENCE_TARGET_YEAR),held=facts.filter(f=>f.hold);
            const items=new Set(facts.map(f=>f.itemCode));
            const demand=model.demandFacts.filter(f=>items.has(f.itemCode)&&(!salesIntelligenceFilters.state||f.state===salesIntelligenceFilters.state)&&(!salesIntelligenceFilters.rep||normalizeRepMatchToken(f.rep)===normalizeRepMatchToken(salesIntelligenceFilters.rep)));
            const coverage=buildSalesIntelligenceCoverage(demand,facts,{socLoaded:isDatasetLoaded('soc','full'),reservesLoaded:isDatasetLoaded('reserves','full')});
            const sum=(rows,qty,value=false)=>rows.reduce((n,f)=>n+Math.max(0,f[qty])*(value?f.listPrice:1),0);
            return {...model,coverage,traceRows:{f1:f1.length,s1:s1.length,trapped:held.length,coverage:coverage.rowCount},totals:{f1Units:sum(f1,'openStock'),f1Value:sum(f1,'openStock',true),s1Units:sum(s1,'available'),s1Value:sum(s1,'available',true),trappedUnits:sum(held,'onHand'),trappedValue:sum(held,'onHand',true),coverageUnits:coverage.units,coverageValue:coverage.value}};
        }

        async function fetchSmartHoldContextDirect(itemcodes) {
            const scope='&itemcode=in.('+itemcodes.map(encodeURIComponent).join(',')+')';
            const specs=[['summaries','ph_hold_stop_itemcode_summaries','select=*'+scope+'&limit=30'],['cycles','ph_hold_stop_itemcode_cycles','select=*'+scope+'&order=episode_start_date.desc&limit=1500'],['releases','ph_hold_release_cycles','select=*'+scope+'&order=hold_started_on.desc&limit=1500'],['profiles','ph_hold_learning_profiles','select=*'+scope+'&limit=1500'],['observations','ph_drive_around_report_rows','select=unique_id,file_id,file_name,report_date,itemcode,locationcode,lotcode,holdstopcode,holdstopreason,hold_reason_category,holdstopbegindate,hsreasonbegin,itemspec,locationnote'+scope+'&order=report_date.desc&limit=1500'],['weather','ph_weather_daily','select=date,temperature_high_f,temperature_low_f&station_key=eq.park_hill_ok&order=date.desc&limit=90'],['docks','ph_dock_trip_status','select=tripnumber,dock_num,status&limit=500']];
            const reads=await Promise.allSettled(specs.map(([,table,query])=>supabaseFetch(table,'GET',null,query)));
            return {ok:true,history:[],partial:reads.some(r=>r.status!=='fulfilled'),...Object.fromEntries(specs.map(([key],i)=>[key,reads[i].status==='fulfilled'?reads[i].value:[]]))};
        }

        function getSmartHoldContext() {
            const owner = getSupabaseReadIdentityScope();
            if (smartHoldContext.owner !== owner) smartHoldContext = { owner, history: [], docks: [], key: '', pending: null, requested: '', weatherAt: 0 };
            return smartHoldContext;
        }

        function warmSmartHoldContext(rows = []) {
            const context = getSmartHoldContext(), H = globalThis.AgDataHoldIntelligence;
            if (!H || !currentUser) return;
            const repaint = () => { if (context !== getSmartHoldContext()) return; if (isViewVisible('smart-moves')) renderSmartMovesIntelligence(); if (isViewVisible('shear-list')) renderShearList(); if (isViewVisible('weather-hold')) renderWeatherHold(); };
            if (Date.now() - context.weatherAt > 3600000) { context.weatherAt = Date.now(); H.refreshWeather().then(repaint); }
            context.loadedCodes ||= new Set();
            const wanted = [...new Set(rows.map(row => getSalesIntelligenceItemCode(row)).filter(Boolean))].sort();
            const itemcodes = wanted.filter(code => !context.loadedCodes.has(code)).slice(0,30);
            if (!itemcodes.length || context.pending || Date.now() < (context.retryAfter || 0)) return;
            const owner = context.owner;
            context.pending = postAppFunctionJson(APP_API_FUNCTION_URL, { action:'smart_hold_context',itemcodes }, {timeoutMs:12000,label:'Hold history'})
                .then(async result => { if(result?.ok && result.enabled!==false && result.partial) { const direct=await fetchSmartHoldContextDirect(itemcodes); return {...direct,history:result.history||[]}; } return result; },()=>fetchSmartHoldContextDirect(itemcodes))
                .then(result => {
                    if (context !== getSmartHoldContext() || owner !== context.owner || !result?.ok || result.enabled === false) return;
                    if (result.partial) { context.partial=true; context.retryAfter=Date.now()+30000; }
                    const scope=new Set(itemcodes); context.history=[...context.history.filter(row=>!scope.has(String(row.itemcode||'').toUpperCase())),...H.historicalModels(result)];
                    context.docks=result.docks||context.docks; H.setWeather(result.weather||[]); if(!result.partial)itemcodes.forEach(code=>context.loadedCodes.add(code));
                    context.partial=!!result.partial; context.key=[...context.loadedCodes].sort().join('|'); repaint();
                }).catch(()=>{context.partial=true;context.retryAfter=Date.now()+30000;})
                .finally(()=>{context.pending=null;if(context===getSmartHoldContext() && !context.partial && wanted.some(code=>!context.loadedCodes.has(code)))warmSmartHoldContext(rows);});
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

        function renderSmartHoldMetrics(row, reason = '') {
            const H = globalThis.AgDataHoldIntelligence, risk = H.holdRisk(row, H.getWeather(), getSmartHoldContext().history, H.today(), reason);
            return '<div class="smart-hold-metrics"><div><small>Hold Reason</small><b>' + escapeHtml(risk.exact || 'No recorded holdreason') + '</b></div><div><small>GDD Until ON HOLD</small><b>' + (risk.held ? 'CURRENTLY ON HOLD' : risk.onRemaining == null ? 'History unavailable' : risk.onRemaining + ' GDD · ' + (risk.onDate || 'Forecast unavailable')) + '</b></div><div><small>GDD Until OFF HOLD</small><b>' + (risk.offRemaining == null ? 'History unavailable' : risk.offRemaining + ' GDD · ' + (risk.offDate || 'Forecast unavailable')) + '</b></div><small class="smart-estimate">' + escapeHtml(risk.basis) + ' · ' + risk.sampleCount + ' completed cycles. Hold release requires field review; cleanup, treatment and cold holds are not resolved by heat alone.</small></div>';
        }

        function smartShearGuardMessage(guard) {
            return 'Outbound Load Commitment: ' + guard.orders + ' Active Order(s) · ' + guard.qty + ' Units · Earliest Load Plan Start: ' + (guard.shipDate || 'Date unconfirmed') + '\nSOC / Dock Load: ' + guard.loads.map(load => load.source + ' ' + (load.order || load.trip) + (load.dock ? ' · Dock ' + load.dock : '')).join(', ') + '\nGDD Before Shear Hold: ' + (guard.onRemaining ?? 'History unavailable') + ' GDD | GDD to Come Off Sheared Hold: ' + (guard.recovery ?? 'History unavailable') + ' GDD | Forecast GDD Before Load Ships: ' + guard.forecast + ' GDD (Short by ' + guard.deficit + ' GDD!)\nProjected Off-Hold Date If Sheared Today: ~' + (guard.offDate || 'History unavailable') + '\nDO NOT SHEAR THIS LOCATION BEFORE LOAD SHIPS — Ship ' + guard.qty + ' units first' + (guard.alternatives.length ? ' (or confirm unsheared alternate location ' + guard.alternatives.join(', ') + ')' : '') + ', then shear!\n' + guard.scope + ' · Planning estimate; confirm field recovery.';
        }

        function renderSmartShearGuard(row) {
            const guard = getSmartShearGuard(row);
            return guard.conflict ? '<aside class="smart-shear-alert" role="note"><strong>🛑 DO NOT SHEAR — GOING OUT ON LOAD</strong><p>' + escapeHtml(smartShearGuardMessage(guard)).replace(/\n/g, '<br>') + '</p></aside>' : '';
        }

        async function confirmSmartShearLoadGuard(rows) {
            warmSalesIntelligenceData();
            warmSmartHoldContext(rows);
            const guards = rows.map(getSmartShearGuard).filter(guard => guard.conflict);
            if (!guards.length && !getSmartHoldContext().partial && rows.every(row=>getSmartHoldContext().loadedCodes?.has(getSalesIntelligenceItemCode(row))) && isDatasetLoaded('soc', 'full') && isDatasetLoaded('reserves', 'full')) return true;
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

