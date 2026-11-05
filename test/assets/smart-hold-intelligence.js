/* Park Hill planning estimates. Custom nursery GDD: max(0, (high + low - 50) / 2). */
(function (root) {
    'use strict';
    const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.8334&longitude=-94.9080&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&past_days=30&forecast_days=14&timezone=America%2FChicago';
    const field = (row, ...names) => { for (const name of names) { const value = row?.[name] ?? row?.[name.toUpperCase()]; if (value != null && String(value).trim() !== '') return value; } return ''; };
    const key = value => String(value || '').trim().toUpperCase();
    const number = value => { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
    const parkHillDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = () => parkHillDateFormat.format(new Date());
    const date = value => { const text = String(value || '').trim(); if (!text) return ''; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00Z' : text); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''; };
    const addDays = (day, n) => new Date(new Date(day + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
    const dailyGdd = (high, low) => Math.max(0, (number(high) + number(low) - 50) / 2);
    function seasonal(day) {
        const d = new Date(day + 'T12:00:00Z'), month = d.getUTCMonth(), part = (d.getUTCDate() - 1) / new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
        const highs = [48, 53, 63, 72, 79, 87, 92, 91, 84, 73, 61, 51], lows = [28, 31, 40, 49, 59, 67, 71, 69, 61, 49, 39, 31];
        return { date: day, high: Math.round(highs[month] * (1-part) + highs[(month+1)%12] * part), low: Math.round(lows[month] * (1-part) + lows[(month+1)%12] * part), source: 'Seasonal estimate' };
    }
    function normalizeWeather(payload) {
        const daily = payload?.daily;
        if (!Array.isArray(daily?.time)) return [];
        return daily.time.flatMap((day, i) => /^\d{4}-\d{2}-\d{2}$/.test(day) && daily.temperature_2m_max?.[i] != null && daily.temperature_2m_min?.[i] != null && Number.isFinite(daily.temperature_2m_max[i]) && Number.isFinite(daily.temperature_2m_min[i]) ? [{ date: day, high: daily.temperature_2m_max[i], low: daily.temperature_2m_min[i], source: 'Open-Meteo' }] : []);
    }
    function weatherDay(day, weather = []) { return weather.find(row => row.date === day) || seasonal(day); }
    function sumGdd(start, end, weather = []) {
        if (!start || !end || end <= start) return 0;
        const length = Math.min(1096, Math.ceil((new Date(end+'T12:00:00Z') - new Date(start+'T12:00:00Z')) / 86400000));
        let sum = 0; for (let i=0;i<length;i++) { const w=weatherDay(addDays(start,i),weather); sum += dailyGdd(w.high,w.low); } return Math.round(sum * 10) / 10;
    }
    function projectDate(needed, start = today(), weather = []) {
        if (needed <= 0) return start;
        let total=0; for(let i=0;i<730;i++) {const w=weatherDay(addDays(start,i),weather);total+=dailyGdd(w.high,w.low);if(total>=needed)return addDays(start,i+1);} return '';
    }
    function holdReason(row) {
        // Imported holdreason is spelled holdstopreason in the canonical tables.
        const name=['holdreason','holdstopreason','hold_stop_reason','current_holdstopreason','open_episode_reason'].find(k=>Object.hasOwn(row||{},k)||Object.hasOwn(row||{},k.toUpperCase()));
        const exact=name?String(row[name]??row[name.toUpperCase()]??'').trim():'';
        const code=String(field(row,'holdstop','holdstopcode','hold_stop_code')).trim();
        return {category:exact,exact,held:!!exact,code};
    }
    const identity=row=>[key(field(row,'itemcode','item')),key(field(row,'locationcode')),key(field(row,'lotcode'))].join('|');
    const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;return n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null;};
    const historyIndexes=new WeakMap();
    function historyModel(row,history,weather) {
        let cached=historyIndexes.get(history);
        if(!cached||cached.length!==history.length){const byIdentity=new Map();for(const observation of history){const item=Object.hasOwn(observation,'completed_cycles')?key(field(observation,'itemcode')):identity(observation);if(!item)continue;if(!byIdentity.has(item))byIdentity.set(item,[]);byIdentity.get(item).push(observation);}cached={length:history.length,byIdentity};historyIndexes.set(history,cached);}
        const records=cached.byIdentity.get(identity(row))||cached.byIdentity.get(key(field(row,'itemcode')))||[];
        if(records.some(r=>Object.hasOwn(r,'completed_cycles')))return {models:records,observations:Math.max(0,...records.map(r=>number(r.observations)))};
        const days=new Map();for(const observation of records){const day=date(field(observation,'file_date','report_date','snapshot_date'));if(!day)continue;if(!days.has(day))days.set(day,new Set());const reason=holdReason(observation).exact;if(reason)days.get(day).add(reason);}
        const reasons=[...new Set([...days.values()].flatMap(v=>[...v]))],ordered=[...days].sort(([a],[b])=>a.localeCompare(b));
        const weatherByDate=new Map(weather.map(w=>[w.date,w]));
        const measured=(start,end)=>{let total=0;for(let d=start;d<end;d=addDays(d,1)){const w=weatherByDate.get(d);if(!w||!Number.isFinite(w.high)||!Number.isFinite(w.low))return null;total+=dailyGdd(w.high,w.low);}return Math.round(total*10)/10;};
        const models=reasons.map(reason=>{const cycles=[],onsets=[];let on='',off='',lastOn='';for(const [day,active] of ordered){if(active.has(reason)&&!on){on=lastOn=day;if(off)onsets.push(measured(off,day));}else if(!active.has(reason)){if(on){cycles.push(measured(on,day));on='';off=day;}else if(!off)off=day;}}return {holdreason:reason,recovery:median(cycles),onset:median(onsets),sample_count:cycles.filter(Number.isFinite).length,completed_cycles:cycles.length,on_date:on,off_date:off,last_on_date:lastOn,observations:days.size};});
        return {models,cycles:models.flatMap(m=>Array.from({length:m.completed_cycles},()=>({reason:m.holdreason,gdd:m.recovery}))),observations:days.size};
    }
    function holdRisk(row,weather=[],history=[],start=today(),selectedReason='') {
        const current=holdReason(row),model=historyModel(row,history,weather);
        const requested=selectedReason||current.exact;
        const sample=requested?model.models.find(m=>m.holdreason===requested):model.models.slice().sort((a,b)=>String(b.last_on_date||b.on_date||'').localeCompare(String(a.last_on_date||a.on_date||'')))[0];
        const exact=requested||sample?.holdreason||'',held=current.held&&current.exact===exact;
        const finite=value=>value!=null&&Number.isFinite(Number(value))?Number(value):null;
        const recovery=finite(sample?.recovery),onset=finite(sample?.onset),since=date(sample?.on_date),off=date(sample?.off_date);
        const elapsed=held?(sample?.as_of===start?finite(sample.elapsed_gdd):since?sumGdd(since,start,weather):null):0;
        const clearElapsed=sample?.as_of===start?finite(sample?.clear_gdd):off?sumGdd(off,start,weather):null;
        const offRemaining=recovery==null||elapsed==null?null:Math.max(0,recovery-elapsed),onRemaining=held?0:onset==null||clearElapsed==null?null:Math.max(0,onset-clearElapsed);
        const onDate=held?since:onRemaining==null?'':projectDate(onRemaining,start,weather);
        const offDate=held?(offRemaining==null?'':projectDate(offRemaining,start,weather)):(onRemaining==null||recovery==null?'':projectDate(onRemaining+recovery,start,weather));
        return {category:exact,exact,held,recovery,onset,onRemaining,offRemaining,onDate,offDate,sampleCount:number(sample?.sample_count),observations:model.observations,basis:recovery==null?'Uncalibrated: insufficient recorded hold / weather history; no threshold assumed': 'Historical itemcode + exact holdreason / file-date transitions; forecast dates use seasonal estimates beyond available weather'};
    }
    function reasonsFor(rows=[],history=[]) {return [...new Set([...rows,...history].map(r=>holdReason(r).exact).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
    function shearedRecovery(row,weather=[],history=[],start=today()) {
        const model=historyModel(row,history,weather),record=model.models.filter(m=>/^sheared\b/i.test(m.holdreason||'')).sort((a,b)=>number(b.sample_count)-number(a.sample_count))[0];
        return record?holdRisk(row,weather,history,start,record.holdreason):{recovery:null,onset:null,sampleCount:0,exact:'',basis:'No recorded Sheared recovery cycle'};
    }
    function buildLoadIndex(soc=[],reserves=[],docks=[]) {
        const trips=new Map(docks.map(d=>[key(field(d,'tripnumber')),d])), seen=new Set(), byItem=new Map();
        for(const [source,rows] of [['SOC',soc],['Reserve',reserves]]) for(const row of rows) {
            const item=key(field(row,'itemcode','item')), trip=key(field(row,'tripnumber')), dock=trips.get(trip);
            if(!item || /complete|cancel|delivered|closed|shipped/i.test(String(field(row,'status','stagename'))) || /complete|depart|delivered|closed/i.test(String(field(dock,'status'))))continue;
            const qty=Math.max(0,number(field(row,'quantityordered'))-number(field(row,'quantityshipped'))); if(!qty)continue;
            const order=key(field(row,'transactionnumber','ordernumber','purchaseordernumber')) || key(field(row,'unique_id'));
            const location=key(field(row,'locationcode','location')), lot=key(field(row,'lotcode','lot'));
            const line=key(field(row,'unique_id')) || [order,item,location,lot,trip,field(row,'stopnumber'),qty].join('|');
            // Only remove identical source receipts. Distinct physical order lines stay distinct.
            const receipt=source+'|'+line;if(seen.has(receipt))continue;seen.add(receipt);
            const entry={source,item,location,lot,order,trip,qty,shipDate:date(field(row,'planstart','shipdate','plan_start_date','requestdate')),dock:field(dock,'dock_num') || field(row,'dock_num','dock')};
            if(!byItem.has(item))byItem.set(item,[]);byItem.get(item).push(entry);
        }
        return byItem;
    }
    function shearGuard(row, index, weather=[], history=[], inventory=[], start=today()) {
        const item=key(field(row,'itemcode','item')), location=key(field(row,'locationcode','location')), lot=key(field(row,'lotcode','lot'));
        const loads=(index.get(item)||[]).filter(load=>(!load.location||load.location===location)&&(!load.lot||load.lot===lot));
        if(!loads.length)return {conflict:false,loads:[]};
        const recoveryModel=shearedRecovery(row,weather,history,start),recovery=recoveryModel.recovery;
        const dated=loads.map(l=>l.shipDate).filter(Boolean).sort(), shipDate=dated[0]||'', forecast=shipDate?sumGdd(start,shipDate,weather):0;
        const qty=loads.reduce((sum,l)=>sum+l.qty,0), orders=new Set(loads.map(l=>l.order||l.trip||l.source)).size;
        const alternatives=[...new Set(inventory.filter(r=>key(field(r,'itemcode','item'))===item&&key(field(r,'locationcode','location'))!==location&&!holdReason(r).held&&number(field(r,'ptravailable','available'))>=qty).map(r=>String(field(r,'locationcode','location'))))].slice(0,5);
        return {conflict:recovery==null || forecast<recovery || loads.some(l=>!l.shipDate),loads,recovery,onset:recoveryModel.onset,onRemaining:recoveryModel.onRemaining,reason:recoveryModel.exact,forecast,deficit:recovery==null?null:Math.max(0,Math.ceil(recovery-forecast)),qty,orders,shipDate,offDate:recovery==null?'':projectDate(recovery,start,weather),alternatives,scope:loads.some(l=>!l.location||!l.lot)?'Unallocated item commitment — confirm exact pull location':'Exact location / lot'};
    }
    const nurseryStages = Object.freeze([
        ['Cuttings','T-98d'],['Stick Cuttings','T-91d'],['Consolidate Inventory','T-28d to T-14d; clear whole beds before Can Filling'],
        ['Can Filling','T-14d to T-5d; after Consolidation, before Planting'],['Plant','T-7d to T-0d; preserve .Y shift lots'],
        ['Water & Shear','Review GDD and outbound Shear Load Guard'],['Start Selling','Photos / Specs → Drive Mode & AV'],
        ['Bunch / Bunch Notes','Overwinter'],['Bunch Counts','Count plants before House Cover'],['House Cover','After Bunch Counts'],
        ['Spread / Spread Notes & Spread Counts','Spring'],['Pull Shade','After Spread Counts']
    ].map(([label,timing],index)=>Object.freeze({stage:index+1,label,timing})));
    function isShiftLot(row) { return key(field(row,'season'))==='Y' || /(?:^|\.)Y(?:$|[.\s-])/.test(key(field(row,'lotcode'))); }
    function wholeGroupKey(row) { return [key(field(row,'locationcode')),key(field(row,'itemcode')),key(field(row,'saleyear','salesyear')||String(field(row,'lotcode')).split('.')[0])].join('|'); }
    function lifecycleFor(row, recommendedStage=null) {
        const stage=isShiftLot(row)?5:Number(field(row,'nursery_stage'))||recommendedStage;
        const entry=nurseryStages.find(s=>s.stage===stage);
        return {groupKey:wholeGroupKey(row),stage:entry?.stage||null,shiftLot:isShiftLot(row),label:[field(row,'locationcode')||'Location unconfirmed',field(row,'lotcode')||'Lot unconfirmed',entry? 'Stage '+entry.stage+' · '+entry.label+(recommendedStage&&!isShiftLot(row)?' (plan)':''):'Stage needs review'].join(' · ')};
    }
    function seasonalWorkflow(mode) { return mode==='spring'?['Spread Notes','Spread Counts','Pull Shade']:['Bunch Notes','Bunch Counts','House Cover']; }
    function historicalModels(context={}) {
        const result=new Map((context.history||[]).map(m=>[key(m.itemcode)+'|'+m.holdreason,{...m}]));
        const all=[...(context.summaries||[]),...(context.cycles||[]),...(context.releases||[]),...(context.observations||[])];
        for(const row of all) {
            const itemcode=key(field(row,'itemcode')),holdreason=holdReason(row).exact;if(!itemcode||!holdreason)continue;
            const id=itemcode+'|'+holdreason,prior=result.get(id);if(prior?.recovery!=null&&prior?.onset!=null)continue;
            const summary=(context.summaries||[]).find(r=>key(r.itemcode)===itemcode && holdReason(r).exact===holdreason);
            const cycles=[...(context.cycles||[]),...(context.releases||[])].filter(r=>key(r.itemcode)===itemcode&&holdReason(r).exact===holdreason);
            const profile=(context.profiles||[]).find(r=>key(r.itemcode)===itemcode&&String(r.hold_reason_category||'').trim().toLowerCase()===holdreason.toLowerCase());
            const finite=(...values)=>{for(const value of values)if(value!=null&&value!==''&&Number.isFinite(Number(value)))return Number(value);return null;};
            const starts=cycles.map(r=>date(field(r,'episode_start_date','hold_started_on'))).filter(Boolean).sort();
            const releases=cycles.map(r=>date(field(r,'episode_release_date','hold_released_on'))).filter(Boolean).sort();
            const recovery=finite(prior?.recovery,summary?.median_gdd_base_50_to_release,summary?.avg_gdd_base_50_to_release,profile?.median_gdd_base_50_to_release,profile?.avg_gdd_base_50_to_release);
            // Complete SQL summaries/models own thresholds; bounded raw rows provide trace dates only.
            result.set(id,{...prior,itemcode,holdreason,recovery,onset:finite(prior?.onset,profile?.median_gdd_base_50_30d,profile?.avg_gdd_base_50_30d),
                completed_cycles:prior?.completed_cycles??summary?.released_cycle_count??cycles.filter(r=>field(r,'episode_release_date','hold_released_on')).length,
                sample_count:prior?.sample_count??summary?.released_cycle_count??profile?.release_sample_count??0,
                on_date:prior?.on_date||date(summary?.open_episode_start_date)||'',off_date:prior?.off_date||date(summary?.last_release_date)||releases.at(-1)||'',
                last_on_date:prior?.last_on_date||starts.at(-1)||'',observations:prior?.observations??summary?.history_file_count??0});
        }
        return [...result.values()];
    }
    let weather=[], fetchedAt=0, pending=null;
    try {const saved=JSON.parse(root.localStorage?.getItem('agdata-park-hill-weather-v1')||'null');if(saved?.rows?.every(r=>r.date&&Number.isFinite(r.high)&&Number.isFinite(r.low))){weather=saved.rows;fetchedAt=Number(saved.fetchedAt)||0;}}catch{}
    function refreshWeather() {
        if(pending)return pending;if(Date.now()-fetchedAt<3600000)return Promise.resolve(weather);
        pending=fetch(WEATHER_URL,{referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('weather unavailable');return r.json();}).then(body=>{const rows=normalizeWeather(body);if(!rows.length)throw Error('weather empty');weather=rows;fetchedAt=Date.now();try{root.localStorage?.setItem('agdata-park-hill-weather-v1',JSON.stringify({rows,fetchedAt}));}catch{}return weather;}).catch(()=>weather).finally(()=>{pending=null;});return pending;
    }
    root.AgDataHoldIntelligence=Object.freeze({nurseryStages,isShiftLot,wholeGroupKey,lifecycleFor,seasonalWorkflow,historicalModels,WEATHER_URL,field,key,today,date,addDays,dailyGdd,seasonal,normalizeWeather,weatherDay,sumGdd,projectDate,holdReason,historyModel,holdRisk,reasonsFor,shearedRecovery,buildLoadIndex,shearGuard,refreshWeather,setWeather:rows=>{weather=[...new Map([...rows.map(r=>({...r,high:r.high??r.temperature_high_f,low:r.low??r.temperature_low_f,source:r.source||'Park Hill daily weather'})),...weather].filter(r=>r.date&&Number.isFinite(r.high)&&Number.isFinite(r.low)).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));},getWeather:()=>weather});
})(globalThis);
