import test from 'node:test';
import {assertWatchdogRpcRecovery,assertWatchdogReadContinuity} from './helpers/watchdog-recovery-contract.mjs';
import {assertWatchdogTransportRecovery} from './helpers/watchdog-transport-contract.mjs';

test('Watchdog RPC recovery retries bounded transient failures with identical commands and rejects unsafe replay',assertWatchdogRpcRecovery);
test('Request refresh retains its rows, Home defers Suspend and communication rejects empty filters',assertWatchdogReadContinuity);
test('Actual native AV and app-api read transports recover with identical command identity and no terminal telemetry',assertWatchdogTransportRecovery);
