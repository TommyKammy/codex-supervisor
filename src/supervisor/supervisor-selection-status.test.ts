import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueExplainSummary as buildIssueExplainSummaryFacade,
  buildIssueLintSummary as buildIssueLintSummaryFacade,
  buildNonRunnableLocalStateReasons as buildNonRunnableLocalStateReasonsFacade,
  buildReadinessSummary as buildReadinessSummaryFacade,
  buildSelectionWhySummary as buildSelectionWhySummaryFacade,
  formatSelectionReason as formatSelectionReasonFacade,
  loadActiveIssueStatusSnapshot as loadActiveIssueStatusSnapshotFacade,
  summarizeSupervisorStatusRecords as summarizeSupervisorStatusRecordsFacade,
} from "./supervisor-selection-status";
import { loadActiveIssueStatusSnapshot } from "./supervisor-selection-active-status";
import {
  buildIssueExplainSummary,
  buildNonRunnableLocalStateReasons,
  formatSelectionReason,
} from "./supervisor-selection-issue-explain";
import { buildIssueLintSummary } from "./supervisor-selection-issue-lint";
import {
  buildReadinessSummary,
  buildSelectionWhySummary,
} from "./supervisor-selection-readiness-summary";
import { summarizeSupervisorStatusRecords } from "./supervisor-selection-status-records";

test("supervisor-selection-status facade re-exports the dedicated status modules", () => {
  assert.equal(loadActiveIssueStatusSnapshotFacade, loadActiveIssueStatusSnapshot);
  assert.equal(buildIssueExplainSummaryFacade, buildIssueExplainSummary);
  assert.equal(buildNonRunnableLocalStateReasonsFacade, buildNonRunnableLocalStateReasons);
  assert.equal(formatSelectionReasonFacade, formatSelectionReason);
  assert.equal(buildIssueLintSummaryFacade, buildIssueLintSummary);
  assert.equal(buildReadinessSummaryFacade, buildReadinessSummary);
  assert.equal(buildSelectionWhySummaryFacade, buildSelectionWhySummary);
  assert.equal(summarizeSupervisorStatusRecordsFacade, summarizeSupervisorStatusRecords);
});
