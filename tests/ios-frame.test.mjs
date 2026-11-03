import test from 'node:test';
import { iosFrameContract, iosReloadContract } from './helpers/ios-frame-contract.mjs';

test('iOS background hydration retains identical view nodes and ignores height-only resize', iosFrameContract);
test('iOS version cutovers share a durable reload claim and cooldown', iosReloadContract);
