import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedDatabaseTypesPath, readGeneratedDatabaseTypes } from '../../scripts/database-type-parts.mjs';
import { sandboxDatabaseTypesPath } from '../../scripts/sandbox-database-workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const typeArtifacts = [generatedDatabaseTypesPath, sandboxDatabaseTypesPath];

export function readDatabaseToolingFixture(file, ...options) {
  const artifact = typeof file === 'string' && options[0] === 'utf8'
    && typeArtifacts.find(entry => path.resolve(root, entry) === path.resolve(file));
  return artifact ? readGeneratedDatabaseTypes(root, artifact) : readFileSync(file, ...options);
}
