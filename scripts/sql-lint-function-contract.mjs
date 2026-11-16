function argumentTypes(value) {
  return String(value||'').split(',').map(arg=>arg.trim().toLowerCase()).filter(Boolean);
}

function validateDeclarations(item,specification,args,parameterNames,qualifiedName) {
  for(const declaration of specification.declarations) {
    const variable=declaration.match(/^([a-z_][a-z0-9_$]*)\s+/i)?.[1];
    const [name,type]=declaration.slice(0,-1).split(/\s+/);
    const parameterType=args[parameterNames.indexOf(name)];
    if(!variable || (parameterType!==type && !new RegExp(`\\b${name}\\s+${type}\\b`,'i').test(item.body))) {
      throw new Error(`SQL_LINT_TEMP_CONTEXT_LOCAL_DECLARATION_CHANGED:${qualifiedName}:${name}`);
    }
  }
}

function validateReferences(item,specification,statements,parameterNames,qualifiedName,firstBeginIndex) {
  const beginIndex=firstBeginIndex(item.body);
  const declaredNames=[...item.body.slice(0,beginIndex).matchAll(/^\s*([a-z_][a-z0-9_$]*)\s+(?=[a-z_])/gmi)]
    .map(match=>match[1].toLowerCase()).filter(name=>name!=='declare');
  const supportedNames=new Set(specification.declarations.map(value=>value.split(/\s+/)[0].toLowerCase()));
  const referenced=name=>statements.some(statement=>new RegExp(`\\b${name}\\b`,'i').test(statement.statement));
  for(const name of [...declaredNames,...parameterNames.filter(Boolean)]) {
    if(!supportedNames.has(name) && referenced(name)) {
      throw new Error(`SQL_LINT_TEMP_CONTEXT_UNSUPPORTED_LOCAL_VARIABLE:${qualifiedName}:${name}`);
    }
  }
}

function parseFunction(item,specification,qualifiedName,adapters) {
  const args=argumentTypes(item.arguments);
  if(JSON.stringify(args)!==JSON.stringify(specification.args)) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_SIGNATURE_CHANGED:${qualifiedName}`);
  }
  if(!item.body || !item.definition) throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_INVALID:${qualifiedName}`);
  const parameterNames=Array.isArray(item.argumentNames)?item.argumentNames.map(name=>String(name||'').toLowerCase()):[];
  validateDeclarations(item,specification,args,parameterNames,qualifiedName);
  const variants=adapters.temporaryStatements(item.body,qualifiedName,specification);
  validateReferences(item,specification,variants,parameterNames,qualifiedName,adapters.firstBeginIndex);
  const statements=[...new Map(variants.map(statement=>[statement.name.toLowerCase(),statement])).values()];
  if(specification.compiledProbe) {
    const outputs=new Set(statements.map(statement=>statement.name.toLowerCase()));
    const references=[...item.body.matchAll(/pg_temp\.([a-z_][a-z0-9_$]*)/gi)].map(match=>match[1].toLowerCase());
    const contextTables=[...new Set([...(specification.contextTables||[]),...references])].filter(name=>!outputs.has(name));
    specification={...specification,contextTables};
  }
  const contextSetup=specification.stagedView?adapters.stagedViewSetup(item.body,qualifiedName):specification.contextSetup||'';
  return {...item,qualifiedName,specification,statements,variants,contextSetup};
}

function validateFunctionSet(functions,registry,compiledEpoch,allowMissing) {
  const expected=Object.keys(registry).filter(name=>(!registry[name].compiledEpoch||compiledEpoch)
    && (!registry[name].alternateEpoch||!functions.has(registry[name].alternateEpoch))).sort();
  const actual=[...functions.keys()].sort();
  if((!allowMissing && JSON.stringify(actual)!==JSON.stringify(expected)) || actual.some(name=>!expected.includes(name))) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_SET_CHANGED:${actual.join(',')}`);
  }
  const tables=[...functions.values()].flatMap(item=>item.statements.map(statement=>
    `${item.specification.probeGroup||'default'}:${statement.name.toLowerCase()}`));
  if(new Set(tables).size!==tables.length) throw new Error('SQL_LINT_TEMP_CONTEXT_TEMP_TABLE_NAME_COLLISION');
}

export function supportedTempFunctions(rawFunctions,{registry,selectSpecification,allowMissing,...adapters}) {
  if(!Array.isArray(rawFunctions)) throw new Error('SQL_LINT_TEMP_CONTEXT_FUNCTION_INVENTORY_INVALID');
  const compiledEpoch=rawFunctions.some(item=>registry[`${item.schema}.${item.name}`]?.compiledEpoch);
  const functions=new Map(),inventory=new Map(rawFunctions.map(item=>[`${item.schema}.${item.name}`,item]));
  for(const item of rawFunctions) {
    const qualifiedName=`${item.schema}.${item.name}`;
    const specification=selectSpecification(qualifiedName,item.body,compiledEpoch);
    if(!specification) throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_UNSUPPORTED:${qualifiedName}`);
    if(functions.has(qualifiedName)) throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_INVALID:${qualifiedName}`);
    const parsed=parseFunction(item,specification,qualifiedName,adapters);
    functions.set(qualifiedName,parsed.specification.compiledProbe?{...parsed,probeInventory:inventory}:parsed);
  }
  validateFunctionSet(functions,registry,compiledEpoch,allowMissing);
  return [...functions.values()];
}
