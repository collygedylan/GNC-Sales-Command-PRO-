export function buildColdHydrationJoinFixture(runFunctions, identity, getIdentity = () => identity) {
  let resolveFull;
  const fullPromise = new Promise(resolve => { resolveFull = resolve; });
  const state = { fullPromise };
  let coordinatorCalls = 0;
  const coldPromise = Promise.resolve(true);
  Object.defineProperty(coldPromise,'ownerIdentity',{value:identity});
  const duplicate = () => { coordinatorCalls += 1; throw new Error('duplicate live-sync adapter'); };
  const context = runFunctions('assets/app-runtime.js',['ensureDatasetLoaded'],{
    RETIRED_DATASET_KEYS:new Set(),DATASET_DEFINITIONS:{warehouseAssignedItems:{}},
    coldSourceHydrations:new Map([['warehouseAssignedItems',coldPromise]]),
    getSupabaseReadIdentityScope:getIdentity,getDatasetState:() => state,canUseProductionLiveSync:() => true,
    getProductionLiveSyncContext:duplicate,getProductionLiveSyncCoordinator:duplicate,createProductionCoreLiveAdapter:duplicate,
    getDatasetRenderRowCount:() => 0
  });
  return {promise:context.ensureDatasetLoaded('warehouseAssignedItems','full'),resolveFull,calls:() => coordinatorCalls};
}
