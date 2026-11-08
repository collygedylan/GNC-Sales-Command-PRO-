import test from 'node:test';
import { assertCurrentSocDockContract } from '../src/core/golden-current-soc-docks.mjs';
test('Current SOC numeric Dock identity and active evaluated tags remain aligned',assertCurrentSocDockContract);
