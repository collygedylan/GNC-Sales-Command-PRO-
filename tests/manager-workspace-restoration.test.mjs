import test from 'node:test';
import { assertManagerTableLayoutRestoration, assertEvalReportSelectionRestoration,
  assertEvalReportWorkspaceEntry, assertEvalReportOptionalFilters } from './helpers/manager-workspace-restoration.mjs';

test('all five Manager tables retain their compact workspace while Drive stays pinned',assertManagerTableLayoutRestoration);
test('persistent report choices commit their union only on Apply',assertEvalReportSelectionRestoration);
test('fresh Eval2 entry opens the overview and delegates root Back to the universal owner',assertEvalReportWorkspaceEntry);
test('existing optional filters remain visible with their exact values',assertEvalReportOptionalFilters);
