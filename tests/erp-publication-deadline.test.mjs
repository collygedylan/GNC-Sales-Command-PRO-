import test from 'node:test';
import {assertPublicationDeadline} from './helpers/erp-publication-deadline-contract.mjs';

test('ERP publication aborts stalled status RPCs and confirms only the durable batch receipt',assertPublicationDeadline);
