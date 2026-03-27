import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssue,
  createPullRequest,
  createRecord,
  createSupervisorState,
} from "./supervisor-test-helpers";

test("createSupervisorState indexes array records by issue number", () => {
  const firstRecord = createRecord({ issue_number: 91, state: "reproducing" });
  const secondRecord = createRecord({ issue_number: 92, state: "waiting_ci", pr_number: 192 });

  const state = createSupervisorState({
    activeIssueNumber: 91,
    issues: [firstRecord, secondRecord],
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 77,
    },
  });

  assert.equal(state.activeIssueNumber, 91);
  assert.equal(state.issues["91"], firstRecord);
  assert.equal(state.issues["92"], secondRecord);
  assert.equal(state.issues["92"]?.pr_number, 192);
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, 77);
});

test("createIssue and createPullRequest accept focused overrides without repeating common fields", () => {
  const issue = createIssue({
    number: 1125,
    title: "Introduce shared fixture builders",
  });
  const pr = createPullRequest({
    number: 2250,
    title: "Extract shared supervisor fixture builders",
    headRefName: "codex/issue-1125",
    headRefOid: "head-2250",
  });

  assert.equal(issue.url, "https://example.test/issues/1125");
  assert.equal(issue.state, "OPEN");
  assert.equal(pr.url, "https://example.test/pr/2250");
  assert.equal(pr.state, "OPEN");
  assert.equal(pr.headRefName, "codex/issue-1125");
  assert.equal(pr.headRefOid, "head-2250");
});
