import {fileURLToPath} from 'node:url';
import {createGoldenSourceReader} from './golden-source-reader.mjs';
import {createGoldenFunctionRunner, createGoldenLocationContext, plainGoldenValue} from './golden-function-runner.mjs';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const {read, syntax, functionSource} = createGoldenSourceReader(root);
export {read, syntax, functionSource};
export function expectedAppApiVersion() {
  const pkg = JSON.parse(read('package.json'));
  return pkg.frontendOnlyRelease?.version === pkg.version ? pkg.frontendOnlyRelease.appApiVersion : pkg.version;
}
export const runFunctions = createGoldenFunctionRunner({functionSource, appApiVersion:expectedAppApiVersion});
export const locationContext = extra => createGoldenLocationContext(read, extra);
export const plain = plainGoldenValue;
