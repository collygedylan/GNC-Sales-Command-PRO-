import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { installGoldenRuntimeDefaults, goldenRuntimeDependencies } from '../../src/core/golden-runtime-fixture.mjs';

export function createGoldenFunctionRunner({ functionSource, appApiVersion }) {
  return function (file, names, context = {}, typescript = file.endsWith('.ts')) {
    installGoldenRuntimeDefaults(file, names, context, appApiVersion());
    const sandbox = vm.createContext(context);
    const dependencies = file === 'assets/app-runtime.js'
      && names.some(name => ['getDisplayLocMatchQtyValue', 'getEditorLocMatchQtyValue'].includes(name))
      && !context.calculateLiveLocPhotoMatch ? ['calculateLiveLocPhotoMatch'] : [];
    dependencies.push(...goldenRuntimeDependencies(file, names, context));
    if (file === 'assets/app-runtime.js' && names.includes('saveDockSuspendDcRequestMirrorData')) {
      dependencies.push('restoreCapturedPhotoFields', 'publishRowEvaluationToMasterAndNotes');
      context.getDockSuspendCompletionRevision ??= () => '';
      context.getPendingPhotoPreviewEntries ??= () => [];
    }
    if (names.includes('applySuspendTagInventoryReceipt')) {
      const state = {};
      context.getManagerAssignedColumnState ??= () => state;
      context.getRequestItemCodeOptionItemCode ??= item => item.ITEMCODE;
    }
    if (file === 'assets/app-runtime.js' && names.includes('getManagerAssignedItemsDisplayRows')) {
      dependencies.push('enrichManagerAssignedPlantGroups');
      context.buildManagerEvalAssignmentKey ??= value => String(value || '').trim().toUpperCase();
    }
    if (file === 'assets/app-runtime.js'
      && names.some(name => ['normalizeWarehouseAssignedItemRow', 'getManagerAssignedItemsDisplayRows'].includes(name))) {
      dependencies.push('getCropRollPlantGroup');
    }
    const datasetSource = names.includes('ensureDatasetLoaded') ? readFileSync(new URL('../../assets/dataset-load-runtime.js',import.meta.url),'utf8') : '';
    const source = [...new Set([...dependencies, ...names])].filter(name => !datasetSource || name !== 'ensureDatasetLoaded')
      .map(name => functionSource(file, name)).concat(datasetSource).join('\n');
    const executable = typescript ? ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText : source;
    vm.runInContext(executable, sandbox, { filename: file });
    return sandbox;
  };
}

export function createGoldenLocationContext(read, extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(read('assets/location-code.js'), context, { filename: 'assets/location-code.js' });
  return context;
}

export function plainGoldenValue(value) {
  return JSON.parse(JSON.stringify(value));
}
