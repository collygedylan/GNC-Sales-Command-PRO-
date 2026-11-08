import path from 'node:path';
import {fileURLToPath} from 'node:url';
export {engineeringFailures} from './engineering-validator.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const {validateAndWriteEngineeringProof} = await import('./engineering-proof.mjs');
    await validateAndWriteEngineeringProof(root);
    process.stdout.write('ENGINEERING LOCK PASS: changed functions, canonical helpers, cost patterns and dead code.\n');
  } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
