/* Park Hill planning estimates. Custom nursery GDD: max(0, (high + low - 50) / 2). */
(function (root) {
    'use strict';
    const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.8334&longitude=-94.9080&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&past_days=30&forecast_days=14&timezone=America%2FChicago';
    const REASONS = Object.freeze({
        SHEARED: { pattern: /shear|trim|prun/i, onset: 420, recovery: 240 },
        'FLUSHING / SOFT GROWTH': { pattern: /flush|soft|tender/i, onset: 350, recovery: 180 },
        'OFF COLOR / CHLOROSIS': { pattern: /color|chloros|yellow|iron|nutrient/i, onset: 500, recovery: 300 },
        'ROOTING / FRESH SHIFT': { pattern: /root|shift|repot/i, onset: 600, recovery: 450 },
        'BUD / BLOOM TIMING': { pattern: /bud|bloom|flower/i, onset: 320, recovery: 200 },
        'WEEDS / CLEANUP': { pattern: /weed|clean/i, onset: 600, recovery: 200 },
        'DISEASE / PEST': { pattern: /disease|pest|spray|quarant|fung|insect/i, onset: 500, recovery: 350 },
        'WINTER / DORMANCY': { pattern: /winter|dorman|cold|frost/i, onset: 800, recovery: 400 }
    });
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
        const exact = String(field(row,'hold_stop_reason','holdstopreason','hold_reason','holdreason')).trim();
        const code = String(field(row,'hold_stop_code','holdstopcode','hold_stop','holdstop')).trim();
        const notes = [exact, code, field(row,'locnote','locationnote'), field(row,'av_note'), field(row,'status'), field(row,'spec','itemspec')].join(' ');
        const category = Object.keys(REASONS).find(reason => REASONS[reason].pattern.test(notes)) || (exact || 'SHEARED');
        const held = !!(code && !/^(0|no|none|false|off|released|n\/a)$/i.test(code));
        return { category, exact: exact || (held ? code : category), held };
    }
    const identity = row => [key(field(row,'itemcode','item')),key(field(row,'locationcode','location')),key(field(row,'lotcode','lot'))].join('|');
    const median = values => {const sorted=values.slice().sort((a,b)=>a-b);return sorted.length ? sorted[Math.floor(sorted.length/2)] : null;};
    const historyIndexes = new WeakMap();
    function historyModel(row, history, weather) {
        let cached = historyIndexes.get(history);
        if (!cached || cached.length !== history.length) {
            const byIdentity = new Map();
            for (const observation of history) {
                const id = identity(observation), day = date(field(observation,'report_date','archived_at'));
                if (!day) continue;
                if (!byIdentity.has(id)) byIdentity.set(id, []);
                byIdentity.get(id).push({...observation,day});
            }
            for (const observations of byIdentity.values()) observations.sort((a,b)=>a.day.localeCompare(b.day));
            cached = {length:history.length,byIdentity}; historyIndexes.set(history,cached);
        }
        const observations = cached.byIdentity.get(identity(row)) || [];
        const cycles = [], onset = []; let heldAt = '', heldReason = '', offAt = '';
        for(const observation of observations) { const hold=holdReason(observation); if(hold.held && !heldAt) {if(offAt)onset.push(sumGdd(offAt,observation.day,weather));heldAt=observation.day;heldReason=hold.category;} else if(!hold.held && heldAt) {cycles.push({reason:heldReason,gdd:sumGdd(heldAt,observation.day,weather)});heldAt='';offAt=observation.day;} }
        return {cycles,onset,lastOn:heldAt,lastOff:offAt,observations:observations.length};
    }
    function holdRisk(row, weather=[], history=[], start=today()) {
        const reason=holdReason(row), curve=REASONS[reason.category] || REASONS.SHEARED, model=historyModel(row,history,weather);
        const samples=model.cycles.filter(c=>c.reason===reason.category && c.gdd>0).map(c=>c.gdd);
        const group = key(field(row,'plantgroupcode','plant_group'));
        const factor=/ROSE|PERENN|ANNUAL/.test(group)?0.85:/TREE|MAPLE|OAK/.test(group)?1.25:1;
        const recovery=Math.round(median(samples) ?? curve.recovery*factor), onset=Math.round(median(model.onset.filter(n=>n>0)) ?? curve.onset*factor);
        const since=date(field(row,'holdstopbegindate','hold_stop_begin_date','hsreasonbegin')) || model.lastOn;
        const elapsed=reason.held && since ? sumGdd(since,start,weather) : 0;
        const offRemaining=Math.max(0,recovery-elapsed), onRemaining=reason.held?0:Math.max(0,onset-(model.lastOff?sumGdd(model.lastOff,start,weather):0));
        return {...reason,recovery,onRemaining,offRemaining,onDate:reason.held?start:projectDate(onRemaining,start,weather),offDate:projectDate(reason.held?offRemaining:onRemaining+recovery,start,weather),sampleCount:samples.length,basis:samples.length?'Historical exact-location cycles; estimated temperatures outside weather window':'Uncalibrated plant-group planning estimate',observations:model.observations};
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
        const recovery=holdRisk({...row,hold_stop_reason:'SHEARED',hold_stop_code:'',HOLDSTOPCODE:''},weather,history,start).recovery;
        const dated=loads.map(l=>l.shipDate).filter(Boolean).sort(), shipDate=dated[0]||'', forecast=shipDate?sumGdd(start,shipDate,weather):0;
        const qty=loads.reduce((sum,l)=>sum+l.qty,0), orders=new Set(loads.map(l=>l.order||l.trip||l.source)).size;
        const alternatives=[...new Set(inventory.filter(r=>key(field(r,'itemcode','item'))===item&&key(field(r,'locationcode','location'))!==location&&!holdReason(r).held&&number(field(r,'ptravailable','available'))>=qty).map(r=>String(field(r,'locationcode','location'))))].slice(0,5);
        return {conflict:forecast<recovery || loads.some(l=>!l.shipDate),loads,recovery,forecast,deficit:Math.max(0,Math.ceil(recovery-forecast)),qty,orders,shipDate,offDate:projectDate(recovery,start,weather),alternatives,scope:loads.some(l=>!l.location||!l.lot)?'Unallocated item commitment — confirm exact pull location':'Exact location / lot'};
    }
    let weather=[], fetchedAt=0, pending=null;
    try {const saved=JSON.parse(root.localStorage?.getItem('agdata-park-hill-weather-v1')||'null');if(saved?.rows?.every(r=>r.date&&Number.isFinite(r.high)&&Number.isFinite(r.low))){weather=saved.rows;fetchedAt=Number(saved.fetchedAt)||0;}}catch{}
    function refreshWeather() {
        if(pending)return pending;if(Date.now()-fetchedAt<3600000)return Promise.resolve(weather);
        pending=fetch(WEATHER_URL,{referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('weather unavailable');return r.json();}).then(body=>{const rows=normalizeWeather(body);if(!rows.length)throw Error('weather empty');weather=rows;fetchedAt=Date.now();try{root.localStorage?.setItem('agdata-park-hill-weather-v1',JSON.stringify({rows,fetchedAt}));}catch{}return weather;}).catch(()=>weather).finally(()=>{pending=null;});return pending;
    }
    root.AgDataHoldIntelligence=Object.freeze({WEATHER_URL,REASONS,field,key,today,date,addDays,dailyGdd,seasonal,normalizeWeather,weatherDay,sumGdd,projectDate,holdReason,historyModel,holdRisk,buildLoadIndex,shearGuard,refreshWeather,getWeather:()=>weather});
})(globalThis);
