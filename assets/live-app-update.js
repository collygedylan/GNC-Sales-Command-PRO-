'use strict';
if (!(typeof window !== 'undefined' ? window : globalThis).GncLiveAppUpdate) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const doc = root.document, serviceWorker = root.navigator?.serviceWorker;
    const reportedErrors = new Set();
    const reportUnexpected = (error,code) => {
        if(root.navigator?.onLine===false || ['AbortError','QuotaExceededError','SecurityError'].includes(error?.name) || /ABORT|SCOPE_CHANGED|NETWORK|TIMEOUT/.test(String(error?.code || '')) || error?.name==='TypeError' && /fetch|network|load failed/i.test(String(error?.message || '')))return;
        if(reportedErrors.has(code))return;reportedErrors.add(code);root.reportHandledRuntimeIssue?.('live_app_update',code);
    };
    const workerVersions = new WeakMap(), workerWaiters = new Map(), watchedRegistrations = new WeakSet(), watchedInstallations = new WeakSet();
    const normalize = value => String(value || '').trim().match(/^(?:AgData\s+v|v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/i)?.[1] || '';
    const currentVersion = () => normalize(root.__APP_RELEASE_VERSION__ || root.__APP_SHELL_VERSION__);
    const newer = (a,b) => { const x=normalize(a).split('.').map(Number),y=normalize(b).split('.').map(Number); if(x.length!==3||y.length!==3)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false; };
    let targetVersion = '', inFlightCheck = null, applyFlight = null, registrationFlight = null, registration = null;
    let registeredVersion = '', activation = null, activationTimer = null;
    let restoreReady = false, started = false, reloading = false, lastCheckAt = 0, lastShellProof = null;
    let prepareExplicitUpdate = null, applyMessage = '', userRequestedUpdateApply = false;
    let pauseNoticeDeadline = 0, pauseNoticeTimer = null;
    const pauseMessage = 'Update paused — tap to retry';
    let retryNotBefore = 0, manifestBackoff = 45000;
    let retiredWorkerCleanupStarted = false;
    let handoffFlight = null, handoffPostedWorker = null;
    const visible = () => !doc.hidden && root.navigator?.onLine !== false;
    const deadline = work => typeof root.withBootDeadline === 'function' ? root.withBootDeadline(work,null) : Promise.resolve(null);
    const runtimeReady = () => typeof root.saveWorkStateBeforeAppUpdate === 'function' && typeof root.getAppUpdateBusyState === 'function' && typeof root.isAppUpdateSnapshotCurrent === 'function' && typeof root.commitAppUpdateSnapshotForReload === 'function';
    const busy = () => {
        if (!restoreReady || !runtimeReady()) return true;
        try { return root.isCameraCaptureProtected?.() === true || Number(root.GncLiveUpdateNetwork?.pendingWrites || 0)>0 || root.getAppUpdateBusyState()?.busy !== false; }
        catch (error) { reportUnexpected(error,'UPDATE_BUSY_CHECK_FAILED'); return true; }
    };
    function renderPill(message = '') {
        if (!doc.body || !targetVersion || !newer(targetVersion,currentVersion())) return;
        let pill = doc.getElementById('agdata-live-update-pill');
        if (!message && !userRequestedUpdateApply && applyMessage === pauseMessage && busy()) {
            if (pill) pill.hidden = true;
            return;
        }
        if (!pill) {
            pill=doc.createElement('button');pill.id='agdata-live-update-pill';pill.type='button';pill.setAttribute('aria-live','polite');
            pill.style.cssText='position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);z-index:10020;max-width:calc(100vw - 32px);border:1px solid #b7dfce;border-radius:999px;padding:9px 15px;background:#123d2c;color:#ecfdf5;font:600 12px/1.3 system-ui;box-shadow:0 2px 10px #0003;cursor:pointer;pointer-events:auto';
            pill.addEventListener('click',event => { if (event.isTrusted) void applyBannerTap(); });
            doc.body.appendChild(pill);
        }
        pill.hidden = false;
        pill.textContent = message || (userRequestedUpdateApply
            ? 'Applying v' + targetVersion + '…'
            : applyMessage || 'Update v' + targetVersion + ' ready — tap to apply');
    }
    function dismissPausedUpdate() {
        pauseNoticeTimer = null;
        if (applyMessage !== pauseMessage || pauseNoticeDeadline > Date.now()) return;
        applyMessage = '';
        const pill = doc.getElementById('agdata-live-update-pill');
        if (pill && !userRequestedUpdateApply) pill.hidden = true;
    }
    function finishUpdateTap() {
        applyFlight = null;
        if (!activation) userRequestedUpdateApply = false;
        if (reloading) return;
        if (applyMessage === pauseMessage) {
            root.clearTimeout(pauseNoticeTimer);
            pauseNoticeDeadline = Date.now() + 4000;
            pauseNoticeTimer = root.setTimeout(dismissPausedUpdate, 4000);
        }
        renderPill();
    }
    function showPendingUpdate() {
        if (!targetVersion || reloading) return false;
        renderPill();
        return true;
    }
    function rememberTarget(value) {
        const candidate=normalize(value);
        if (!candidate || !newer(candidate,currentVersion())) return false;
        if (!targetVersion || newer(candidate,targetVersion)) { targetVersion=candidate;lastShellProof=null;applyMessage=''; }
        root.__gncShellUpdateReady=true;renderPill();return true;
    }
    function watchInstallation(reg) {
        const installing = reg.installing;
        if (!installing || watchedInstallations.has(installing)) return;
        watchedInstallations.add(installing);
        installing?.addEventListener?.('statechange', () => {
            if (installing.state !== 'installed') return;
            void askWorkerVersion(reg.waiting || installing);
            offerInstalledBannerWorker(reg);
            void resumeReloadHandoff(reg);
        });
    }
    function watchRegistration(reg) {
        if (!reg) return null;registration=reg;root.__swReg=reg;
        if (!watchedRegistrations.has(reg)) {
            watchedRegistrations.add(reg);
            reg.addEventListener?.('updatefound', () => watchInstallation(reg));
        }
        watchInstallation(reg);
        if (reg.waiting) void askWorkerVersion(reg.waiting);
        void resumeReloadHandoff(reg);
        return reg;
    }
    function ensureRegistration(update=false) {
        if (!serviceWorker?.register) return Promise.resolve(null);
        if (registrationFlight) return registrationFlight;
        registrationFlight=(async()=>{
            const version = update && targetVersion ? targetVersion : currentVersion();
            if (!version) return null;
            const reuse = registeredVersion === version;
            const pending = reuse ? Promise.resolve(registration) : Promise.resolve(serviceWorker.register('./sw.js?v='+encodeURIComponent(version),{scope:'./',updateViaCache:'none'}));
            void pending.then(watchRegistration).catch(error=>reportUnexpected(error,'UPDATE_REGISTRATION_FAILED'));
            const reg = await deadline(pending);
            if (!reg) return null;
            registeredVersion = version;
            watchRegistration(reg);
            if (update && reuse && !reg.waiting && !reg.installing) await deadline(Promise.resolve().then(()=>reg.update?.()));
            return reg;
        })().catch(error=>{reportUnexpected(error,'UPDATE_REGISTRATION_FAILED');return null;}).finally(()=>{registrationFlight=null;});return registrationFlight;
    }
    function askWorkerVersion(worker) {
        if (!worker) return Promise.resolve('');
        if (workerVersions.has(worker)) return Promise.resolve(workerVersions.get(worker));
        if (workerWaiters.has(worker)) return workerWaiters.get(worker).promise;
        let resolve;const promise=new Promise(done=>{resolve=done;});
        const timer=root.setTimeout(()=>{workerWaiters.delete(worker);resolve('');},1200);
        workerWaiters.set(worker,{promise,resolve,timer});
        try { worker.postMessage({type:'GNC_GET_SHELL_VERSION'}); } catch { root.clearTimeout(timer);workerWaiters.delete(worker);resolve(''); }
        return promise;
    }
    async function verifyShell(target) {
        const controller=new root.AbortController();
        try {
            const proof=await deadline((async()=>{
                const response=await root.fetch('./index.html?verify='+encodeURIComponent(target)+'&t='+Date.now(),{cache:'no-store',referrerPolicy:'no-referrer',credentials:'same-origin',signal:controller.signal});
                if(response?.status!==200)return null;
                const text=await response.text();
                const metadata = typeof root.DOMParser==='function' ? new root.DOMParser().parseFromString(text,'text/html').querySelectorAll('meta[name="agdata-release"]') : [];
                return metadata.length===1 && normalize(metadata[0].getAttribute('content'))===target ? {target,at:Date.now()} : null;
            })());
            if(proof)lastShellProof=proof;return !!proof;
        } catch (error) { reportUnexpected(error,'UPDATE_SHELL_RESPONSE_FAILED'); return false; } finally {controller.abort();}
    }
    function snapshotIsCurrent(receipt,target,sameRelease=false) {
        const validTarget = sameRelease ? target===currentVersion() : target===targetVersion && newer(target,currentVersion());
        return visible() && !reloading && validTarget && !busy()
            && receipt?.ok===true && root.isAppUpdateSnapshotCurrent(receipt)===true;
    }
    async function checkpoint(target,sameRelease=false) {
        if (!visible() || busy()) return null;
        let receipt;try { receipt=await root.saveWorkStateBeforeAppUpdate({targetVersion:target,deadlineMs:1500}); } catch (error) { reportUnexpected(error,'UPDATE_CHECKPOINT_FAILED'); return null; }
        return snapshotIsCurrent(receipt,target,sameRelease) ? receipt : null;
    }
    function navigate(target,receipt) {
        if(!snapshotIsCurrent(receipt,target))return false;
        const key='agdata_live_update_reload_v1';
        try {
            const prior=JSON.parse(root.sessionStorage.getItem(key)||'null');
            if(prior?.target===target && prior?.from===currentVersion() && Date.now()-prior.at<60000)return false;
        } catch (error) { reportUnexpected(error,'UPDATE_RELOAD_MARKER_FAILED'); return false; }
        const next=new URL(root.location.href);next.searchParams.set('v',target);next.searchParams.set('shellv','AgData v'+target);next.searchParams.set('_reload',String(Date.now()));
        // No await follows this final snapshot/account/input check and commit marker.
        if(!snapshotIsCurrent(receipt,target))return false;
        try {
            if(root.commitAppUpdateSnapshotForReload(receipt)!==true)return false;
            if(!snapshotIsCurrent(receipt,target)){root.cancelAppUpdateSnapshotReload?.(receipt);return false;}
            root.sessionStorage.setItem(key,JSON.stringify({target,from:currentVersion(),at:Date.now(),snapshotId:receipt.snapshotId,owner:receipt.owner,tabNonce:receipt.tabNonce}));
            reloading=true;root.__agdataVersionReloadPending=true;root.__agdataMarkBootComplete?.();
            root.suspendShellMaintenanceForNavigation?.();root.location.replace(next.href);return true;
        } catch(error) {
            reloading=false;root.__agdataVersionReloadPending=false;root.cancelAppUpdateSnapshotReload?.(receipt);
            try{root.sessionStorage.removeItem(key);}catch{}reportUnexpected(error,'UPDATE_NAVIGATION_FAILED');return false;
        }
    }
    function readReloadHandoff() {
        try {
            if (root.sessionStorage.getItem('agdata_update_restore_commit_v1')) return null;
            const marker=JSON.parse(root.sessionStorage.getItem('agdata_live_update_reload_v1') || 'null');
            const age=Date.now()-Number(marker?.at);
            return marker?.target===currentVersion() && newer(currentVersion(),marker.from) && age>=0 && age<120000
                && typeof marker.snapshotId==='string' && marker.snapshotId && typeof marker.tabNonce==='string' && marker.tabNonce
                && typeof marker.owner?.username==='string' && typeof marker.owner?.subject==='string' ? marker : null;
        } catch (error) { reportUnexpected(error,'UPDATE_HANDOFF_MARKER_FAILED');return null; }
    }
    function handoffReceiptMatches(marker,receipt) {
        return marker && snapshotIsCurrent(receipt,currentVersion(),true) && receipt.tabNonce===marker.tabNonce
            && receipt.owner?.username===marker.owner.username && receipt.owner?.subject===marker.owner.subject;
    }
    function resumeReloadHandoff(reg=registration) {
        const marker=readReloadHandoff(),worker=reg?.waiting;
        if (!marker || !worker || handoffPostedWorker===worker || !visible() || busy()) return Promise.resolve(false);
        if (handoffFlight) return handoffFlight;
        handoffFlight=(async()=>{
            if (await askWorkerVersion(worker)!==currentVersion() || reg.waiting!==worker) return false;
            if (!readReloadHandoff()) return false;
            const receipt=await checkpoint(currentVersion(),true);
            if (!handoffReceiptMatches(readReloadHandoff(),receipt) || reg.waiting!==worker) return false;
            const build='AgData v'+currentVersion();
            worker.postMessage({type:'SKIP_WAITING',protocol:'agdata-update-restore-v1',trigger:'update-banner',snapshotId:receipt.snapshotId,targetBuild:build,build,version:build});
            handoffPostedWorker=worker;
            return true;
        })().catch(error=>{reportUnexpected(error,'UPDATE_HANDOFF_FAILED');return false;}).finally(()=>{handoffFlight=null;});
        return handoffFlight;
    }
    function finishReloadHandoff(worker,version) {
        if (!readReloadHandoff() || worker!==serviceWorker?.controller || version!==currentVersion()) return;
        try { root.sessionStorage.removeItem('agdata_live_update_reload_v1'); }
        catch (error) { reportUnexpected(error,'UPDATE_HANDOFF_MARKER_FAILED'); }
    }
    function finishActivation(tap, result) {
        if (activation !== tap) return false;
        activation = null;
        userRequestedUpdateApply = false;
        root.clearTimeout(activationTimer);
        activationTimer = null;
        tap.resolve(result);
        if (!reloading) renderPill();
        return result;
    }
    async function fallbackBannerActivation(tap) {
        if (activation !== tap) return false;
        if (!snapshotIsCurrent(tap.receipt,tap.target)) return finishActivation(tap,false);
        const verified = await verifyShell(tap.target);
        if (activation !== tap) return false;
        if (!verified) applyMessage='Update unavailable — tap to retry';
        return finishActivation(tap,verified && navigate(tap.target,tap.receipt));
    }
    function beginBannerActivation(target, receipt) {
        let resolve;
        const completion = new Promise(done => { resolve=done; });
        root.clearTimeout(activationTimer);
        const tap = {worker:null, target, receipt, resolve, completion};
        activation = tap;
        activationTimer = root.setTimeout(() => {
            activationTimer = null;
            void fallbackBannerActivation(tap).catch(error => {
                reportUnexpected(error,'UPDATE_ACTIVATION_FALLBACK_FAILED');
                finishActivation(tap,false);
            });
        }, 800);
        return tap;
    }
    function activateWaitingWorker(tap, worker) {
        const build = 'AgData v' + tap.target;
        tap.worker = worker;
        try { worker.postMessage({type:'SKIP_WAITING',protocol:'agdata-update-restore-v1',trigger:'update-banner',snapshotId:tap.receipt.snapshotId,targetBuild:build,build,version:build}); }
        catch (error) { reportUnexpected(error,'UPDATE_ACTIVATION_MESSAGE_FAILED'); }
        return true;
    }
    function offerInstalledBannerWorker(reg) {
        const tap=activation,worker=reg.waiting;
        if (!tap?.shellVerified || !worker || tap.worker || !snapshotIsCurrent(tap.receipt,tap.target)) return;
        activateWaitingWorker(tap,worker);
    }
    function finishBannerActivation(worker, version) {
        const tap = activation;
        if (!tap || tap.worker !== worker || worker !== serviceWorker?.controller || tap.target !== version) return false;
        return finishActivation(tap,navigate(tap.target,tap.receipt));
    }
    async function prepareBannerActivation(tap) {
        const [reg,verified] = await Promise.all([ensureRegistration(true),verifyShell(tap.target)]);
        if (activation !== tap) return reloading;
        if (!verified) {
            applyMessage='Update unavailable — tap to retry';
            return finishActivation(tap,false);
        }
        if (!snapshotIsCurrent(tap.receipt,tap.target)) return finishActivation(tap,false);
        tap.shellVerified=true;
        if (reg?.installing && !reg.waiting) return tap.completion;
        if (!reg?.waiting) return finishActivation(tap,navigate(tap.target,tap.receipt));
        return activateWaitingWorker(tap,reg.waiting);
    }
    async function applyTappedTarget(target) {
        prepareExplicitUpdate?.();
        const receipt = await checkpoint(target);
        if (!receipt) return false;
        const tap = beginBannerActivation(target,receipt);
        const preparing = prepareBannerActivation(tap).catch(error => {
            reportUnexpected(error,'UPDATE_ACTIVATION_PREPARATION_FAILED');
            return finishActivation(tap,false);
        });
        return Promise.race([preparing,tap.completion]);
    }
    function applyBannerTap() {
        if (reloading || !restoreReady || !visible() || !newer(targetVersion,currentVersion())) return false;
        if (applyFlight || activation) return false;
        if (busy()) {
            applyMessage = pauseMessage;
            finishUpdateTap();
            return false;
        }
        userRequestedUpdateApply = true;
        applyMessage=pauseMessage;
        renderPill('Applying v' + targetVersion + '…');
        applyFlight = applyTappedTarget(targetVersion).catch(error => {
            reportUnexpected(error,'UPDATE_APPLY_FAILED');
            return false;
        }).finally(finishUpdateTap);
        return applyFlight;
    }
    function retryPendingRestore() {
        if(!restoreReady || reloading || !visible() || typeof root.retryAppUpdateWorkRestore!=='function')return Promise.resolve(false);
        try { return Promise.resolve(root.retryAppUpdateWorkRestore()).catch(error=>{reportUnexpected(error,'UPDATE_RESTORE_RETRY_FAILED');return false;}); }
        catch(error){reportUnexpected(error,'UPDATE_RESTORE_RETRY_FAILED');return Promise.resolve(false);}
    }
    async function readUpdateManifest(signal) {
        const response=await root.fetch('./version.json?t='+Date.now(),{cache:'no-store',referrerPolicy:'no-referrer',credentials:'same-origin',headers:{Accept:'application/json'},signal});
        return response?.status === 200 ? response.json() : null;
    }
    function updateManifestBackoff(manifest) {
        retryNotBefore = manifest ? 0 : Date.now() + manifestBackoff;
        manifestBackoff = manifest ? 45000 : Math.min(180000, manifestBackoff * 2);
    }
    function checkForLiveAppUpdate(reason='check',options={}) {
        if(reloading)return Promise.resolve(false);
        if(inFlightCheck)return inFlightCheck;
        if(!visible())return Promise.resolve(false);
        if (reason === 'interval' && Date.now() < retryNotBefore) return Promise.resolve(false);
        if(!options.force && Date.now()-lastCheckAt<1000)return Promise.resolve(false);
        lastCheckAt=Date.now();
        inFlightCheck=(async()=>{
            void retryPendingRestore();
            void resumeReloadHandoff();
            const controller=new root.AbortController();
            let manifest = null;
            try {
                manifest = await deadline(readUpdateManifest(controller.signal));
            } catch (error) {reportUnexpected(error,'UPDATE_MANIFEST_RESPONSE_FAILED');} finally {controller.abort();}
            updateManifestBackoff(manifest);
            if(manifest)rememberTarget(manifest.version || manifest.release);
            if(targetVersion) {void ensureRegistration(true);renderPill();return true;}
            return false;
        })().finally(()=>{inFlightCheck=null;});return inFlightCheck;
    }
    function requestLiveAppUpdate(value,options={}) {
        if(rememberTarget(value)) return Promise.resolve(true);
        return checkForLiveAppUpdate(options.reason || 'legacy-update',{force:options.force===true});
    }
    function isRetiredTestRegistration(candidate) {
        const base = new URL('./', root.location.href);
        const scope = new URL('test/', base);
        if (candidate.scope !== scope.href) return false;
        const workers = [candidate.active, candidate.waiting, candidate.installing].filter(Boolean);
        return workers.length > 0 && workers.every(worker => {
            const script = new URL(worker.scriptURL);
            return script.origin === scope.origin && script.pathname === scope.pathname + 'sw.js';
        });
    }
    function retireObsoleteWorkerRegistrations(worker) {
        if (retiredWorkerCleanupStarted || !serviceWorker?.getRegistrations) return;
        retiredWorkerCleanupStarted = true;
        const cleanup = serviceWorker.getRegistrations().then(registrations => {
            if (worker !== serviceWorker.controller || workerVersions.get(worker) !== currentVersion()) return;
            return Promise.all(registrations.filter(isRetiredTestRegistration).map(candidate => candidate.unregister()));
        }).catch(error => reportUnexpected(error, 'UPDATE_RETIRED_WORKER_CLEANUP_FAILED'));
        void deadline(cleanup);
    }
    function announceCurrentShell(worker = serviceWorker?.controller) {
        if (!restoreReady || !worker || worker !== serviceWorker.controller || workerVersions.get(worker) !== currentVersion()) return;
        retireObsoleteWorkerRegistrations(worker);
        try { worker.postMessage({ type: 'GNC_SHELL_READY', build: 'AgData v' + currentVersion() }); }
        catch (error) { reportUnexpected(error, 'UPDATE_CACHE_RETIREMENT_FAILED'); }
    }
    function start() {
        if(started)return false;started=true;
        const requestedVersion = new URL(root.location.href).searchParams.get('forceupgrade');
        if (requestedVersion) rememberTarget(requestedVersion);
        void ensureRegistration();void checkForLiveAppUpdate('boot',{force:true});
        root.setInterval(() => {
            if (!visible() || reloading || inFlightCheck || Date.now() < retryNotBefore) return;
            void checkForLiveAppUpdate('interval',{force:true});
        },45000);
        return true;
    }
    serviceWorker?.addEventListener?.('message',event=>{
        const data=event.data,worker=event.source;
        if(!data || !['GNC_SHELL_VERSION','GNC_SHELL_ACTIVATED'].includes(data.type))return;
        if(worker!==serviceWorker.controller && worker!==registration?.waiting && worker!==registration?.installing && worker!==registration?.active)return;
        const version=normalize(data.build || data.version);if(!version)return;
        workerVersions.set(worker,version);const waiter=workerWaiters.get(worker);
        if(waiter){root.clearTimeout(waiter.timer);workerWaiters.delete(worker);waiter.resolve(version);}
        if (worker === serviceWorker.controller && data.type === 'GNC_SHELL_ACTIVATED') announceCurrentShell(worker);
        finishReloadHandoff(worker,version);
        rememberTarget(version);
    });
    serviceWorker?.addEventListener?.('controllerchange',()=>{
        const worker = serviceWorker.controller;
        void askWorkerVersion(worker).then(version=>{
            if (worker !== serviceWorker.controller) return;
            finishReloadHandoff(worker,version);
            if (!finishBannerActivation(worker,version) && !rememberTarget(version)) announceCurrentShell(worker);
        });
    });
    const resumed=reason=>{if(visible())void checkForLiveAppUpdate(reason,{force:true});};
    doc.addEventListener('visibilitychange',()=>resumed('visible'),{passive:true});
    root.addEventListener('online',()=>resumed('online'));root.addEventListener('pageshow',()=>resumed('pageshow'));root.addEventListener('focus',()=>resumed('focus'));
    root.addEventListener('agdata:update-work-settled',()=>{void resumeReloadHandoff();});
    root.checkForLiveAppUpdate=checkForLiveAppUpdate;root.requestLiveAppUpdate=requestLiveAppUpdate;
    root.GncLiveAppUpdate=Object.freeze({start,runtimeReady(prepare){restoreReady=true;prepareExplicitUpdate=prepare;void retryPendingRestore();void resumeReloadHandoff();void askWorkerVersion(serviceWorker?.controller).then(()=>announceCurrentShell());},check:checkForLiveAppUpdate,request:requestLiveAppUpdate,requestApply:()=>applyFlight || Promise.resolve(false),scheduleApply:showPendingUpdate,ensureRegistration,
        getState:()=>({targetVersion,currentVersion:currentVersion(),busy:busy(),checking:!!inFlightCheck,applying:userRequestedUpdateApply,userRequestedUpdateApply,reloading,lastShellProof})});
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
