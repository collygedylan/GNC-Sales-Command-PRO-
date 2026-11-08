import test from 'node:test';
import { assertExactRowEvaluationContract } from '../src/core/golden-row-evaluation-contract.mjs';
test('all evaluation views retain exact row identity, true stock and receipt guards',assertExactRowEvaluationContract);
