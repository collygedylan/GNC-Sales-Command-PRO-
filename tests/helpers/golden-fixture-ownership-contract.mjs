import assert from 'node:assert/strict';
import vm from 'node:vm';
import { includeFixtureFunctionDependencies } from './golden-function-dependencies.mjs';

function fixtureDefinitions() {
  return new Map([
    ['entry', `function entry(input) {
      if (input.denied) throw new Error('DENIED');
      if (typeof optionalPaint === 'function') optionalPaint(input);
      return requiredStep(input);
    }`],
    ['requiredStep', `function requiredStep(input) {
      if (input.paint) optionalPaint(input);
      return exactIdentity(input);
    }`],
    ['exactIdentity', `function exactIdentity(input) {
      if (!input.uid) throw new Error('IDENTITY_REQUIRED');
      return input.uid;
    }`],
    ['optionalPaint', "function optionalPaint() { throw new Error('UNREQUESTED_UI_OWNER'); }"],
  ]);
}

function compileFixture(context = {}) {
  const definitions = fixtureDefinitions();
  const source = includeFixtureFunctionDependencies({
    file:'fixture.js', names:['entry'], context, typescript:false,
    functionSource(_file, name, required) {
      const value = definitions.get(name);
      if (required) assert.ok(value, name);
      return value || null;
    },
  }).join('\n');
  vm.runInNewContext(source, context);
  return context;
}

export function assertGoldenFixtureOwnership() {
  const fixture = compileFixture();
  assert.equal(fixture.entry({uid:'physical-row'}),'physical-row');
  assert.throws(()=>fixture.entry({uid:'physical-row',denied:true}),/DENIED/);
  assert.throws(()=>fixture.entry({}),/IDENTITY_REQUIRED/);
  assert.equal(fixture.optionalPaint,undefined,'an optional UI boundary stays absent across transitive helpers');
  assert.throws(()=>fixture.entry({uid:'physical-row',paint:true}),/optionalPaint is not defined/);
  const calls=[];
  const supplied=compileFixture({requiredStep:input=>{calls.push(input.uid);return input.uid;}});
  assert.equal(supplied.entry({uid:'supplied-owner'}),'supplied-owner');
  assert.deepEqual(calls,['supplied-owner'],'explicit fixture owners cannot be overwritten');
  assert.throws(()=>includeFixtureFunctionDependencies({
    file:'missing.js',names:['missing'],context:{},typescript:false,
    functionSource(){throw new Error('MISSING_PRODUCTION_DECLARATION');},
  }),/MISSING_PRODUCTION_DECLARATION/);
}
