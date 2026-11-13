import { reclassWorksheetSource } from './reclass-worksheet-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';
import { generatedDatabaseTypesPath, readGeneratedDatabaseTypes } from '../../scripts/database-type-parts.mjs';
import { importedFixtureFunction } from './golden-imported-source.mjs';

export function createGoldenSourceReader(root) {
  const sources = new Map(), syntaxTrees = new Map(), indexes = new Map(), browserDefinitions = new Map();
  let browserCandidates;
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
  function lookup(file,name,globalOnly=false) {
    if (indexes.has(file)) return indexedSource(indexes.get(file).get(name), syntaxTrees.get(file), globalOnly);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`).test(read(file))) return null;
    const tree = syntax(file);
    if (!indexes.has(file)) indexes.set(file,indexFunctions(tree));
    return indexedSource(indexes.get(file).get(name), tree, globalOnly);
  }
  function browserDefinition(name) {
    if (browserDefinitions.has(name)) return browserDefinitions.get(name);
    const files = (browserCandidates ||= indexBrowserFunctionCandidates(read)).get(name) || [];
    const matches = files.map(file => lookup(file,name,true)).filter(Boolean);
    const unique = [...new Set(matches)];
    assert.ok(unique.length < 2, `Ambiguous production fixture function: ${name}`);
    browserDefinitions.set(name, unique[0] || null);
    return browserDefinitions.get(name);
  }
  function functionSource(file,name,required=true) {
    if (file === 'assets/app-runtime.js' && name === 'buildOptimisticInventoryReclassMoveModel') return reclassWorksheetSource();
    const source = lookup(file,name,!required) || (file === 'assets/app-runtime.js' ? browserDefinition(name)
      : importedFixtureFunction(file, name, { syntax, lookup }));
    if (required) assert.ok(source,`${file}:${name}`);
    return source;
  }
  return {read,syntax,functionSource};
}

function indexBrowserFunctionCandidates(read) {
  const candidates = new Map();
  const files = [...read('index.html').matchAll(/<script\b[^>]*\bsrc="\.\/(assets\/[^"?]+\.js)(?:\?[^" ]*)?"/g)]
    .map(match => match[1]).filter(file => !file.includes('/vendor/') && file !== 'assets/app-runtime.js');
  for (const file of new Set(files)) {
    const names = new Set([...read(file).matchAll(/\bfunction\s+([\w$]+)\s*\(/g)].map(match=>match[1]));
    for (const name of names) {
      if (!candidates.has(name)) candidates.set(name,[]);
      candidates.get(name).push(file);
    }
  }
  return candidates;
}

function indexedSource(node, tree, globalOnly) {
  if (!node) return null;
  for (let parent = node.parent; globalOnly && parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return null;
  }
  return node.getText(tree);
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
