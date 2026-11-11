import { reclassWorksheetSource } from './reclass-worksheet-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';
import { generatedDatabaseTypesPath, readGeneratedDatabaseTypes } from '../../scripts/database-type-parts.mjs';

export function createGoldenSourceReader(root) {
  const sources = new Map(), syntaxTrees = new Map(), indexes = new Map();
  function read(file) {
    if (sources.has(file)) return sources.get(file);
    if (file === 'assets/app-runtime.js') sources.set(file, readComposedRuntimeSource());
    else if (file === generatedDatabaseTypesPath) sources.set(file, readGeneratedDatabaseTypes(root));
    else sources.set(file, readFileSync(path.join(root,file),'utf8'));
    return sources.get(file);
  }
  function syntax(file) {
    if (!syntaxTrees.has(file)) syntaxTrees.set(file,ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,
      file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS));
    return syntaxTrees.get(file);
  }
  function functionSource(file,name) {
    if (file === 'assets/app-runtime.js' && name === 'buildOptimisticInventoryReclassMoveModel') return reclassWorksheetSource();
    const tree = syntax(file);
    if (!indexes.has(file)) indexes.set(file,indexFunctions(tree));
    const match = indexes.get(file).get(name);
    assert.ok(match,`${file}:${name}`);
    return match.getText(tree);
  }
  return {read,syntax,functionSource};
}

function indexFunctions(tree) {
  const index = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && !index.has(node.name.text)) index.set(node.name.text,node);
    ts.forEachChild(node,visit);
  }
  visit(tree);
  return index;
}
