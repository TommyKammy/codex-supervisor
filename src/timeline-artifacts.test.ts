import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIssueRunTimelineExport,
  formatTimelineArtifactStatusLine,
} from "./timeline-artifacts";
import { createPullRequest, createRecord } from "./turn-execution-test-helpers";

test("formatTimelineArtifactStatusLine escapes multiline command and summary values", () => {
  const line = formatTimelineArtifactStatusLine({
    issueNumber: 1733,
    prNumber: 1738,
    artifact: {
      type: "verification_result",
      gate: "local_ci",
      command: "npm run verify:paths\nnpm run build\r\nnpm test\rnode --version",
      head_sha: "abc123",
      outcome: "failed",
      remediation_target: "tracked_publishable_content",
      next_action: "repair_tracked_publishable_content",
      summary: "first line\nsecond line\rthird line",
      recorded_at: "2026-04-25T10:50:35Z",
    },
  });

  assert.equal(line.split("\n").length, 1);
  assert.equal(line.includes("\r"), false);
  assert.match(
    line,
    /^timeline_artifact issue=#1733 pr=#1738 type=verification_result gate=local_ci outcome=failed head_sha=abc123 remediation_target=tracked_publishable_content next_action=repair_tracked_publishable_content command=npm run verify:paths\\nnpm run build\\nnpm test\\nnode --version summary=first line\\nsecond line\\nthird line$/,
  );
});

test("buildIssueRunTimelineExport orders available major lifecycle events", () => {
  const record = createRecord({
    issue_number: 1742,
    branch: "codex/issue-1742",
    last_head_sha: "head-1748",
    pr_number: 1748,
    state: "done",
    codex_session_id: "session-1742",
    last_codex_summary: "Implemented timeline export.",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "npm run build passed.",
      ran_at: "2026-04-25T10:06:00Z",
      head_sha: "head-1748",
      execution_mode: "legacy_shell_string",
      command: "npm run build",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "path_hygiene_result",
        gate: "workstation_local_path_hygiene",
        command: "npm run verify:paths",
        head_sha: "head-1748",
        outcome: "repair_queued",
        remediation_target: "repair_already_queued",
        next_action: "wait_for_repair_turn",
        summary: "Tracked durable artifacts failed workstation-local path hygiene before publication.",
        recorded_at: "2026-04-25T10:04:00Z",
        repair_targets: ["docs/guide.md"],
      },
      {
        type: "verification_result",
        gate: "local_ci",
        command: "npm run build",
        head_sha: "head-1748",
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "npm run build passed.",
        recorded_at: "2026-04-25T10:06:00Z",
      },
    ],
    local_review_head_sha: "head-1748",
    local_review_run_at: "2026-04-25T10:08:00Z",
    local_review_recommendation: "ready",
    local_review_findings_count: 0,
    local_review_blocker_summary: null,
    last_recovery_reason: "stale_state_cleanup: moved from stabilizing to draft_pr",
    last_recovery_at: "2026-04-25T10:05:00Z",
    updated_at: "2026-04-25T10:12:00Z",
  });
  const pr = createPullRequest({
    number: 1748,
    createdAt: "2026-04-25T10:03:00Z",
    mergedAt: "2026-04-25T10:11:00Z",
    headRefOid: "head-1748",
  });

  const timeline = buildIssueRunTimelineExport({ record, pr });

  assert.deepEqual(
    timeline.events
      .filter((event) => event.outcome !== "missing")
      .map((event) => [event.event_type, event.timestamp, event.outcome, event.next_action]),
    [
      ["reservation", null, "recorded", null],
      ["pr_created", "2026-04-25T10:03:00Z", "created", null],
      ["path_hygiene", "2026-04-25T10:04:00Z", "repair_queued", "wait_for_repair_turn"],
      ["recovery", "2026-04-25T10:05:00Z", "recorded", null],
      ["local_ci", "2026-04-25T10:06:00Z", "passed", "continue"],
      ["review", "2026-04-25T10:08:00Z", "ready", null],
      ["merge", "2026-04-25T10:11:00Z", "merged", null],
      ["codex_turn", "2026-04-25T10:12:00Z", "completed", null],
      ["done", "2026-04-25T10:12:00Z", "done", null],
    ],
  );
  assert.deepEqual(timeline.events[0], {
    issue_number: 1742,
    pr_number: 1748,
    event_type: "reservation",
    timestamp: null,
    outcome: "recorded",
    summary: "Issue run reservation exists for branch codex/issue-1742.",
    head_sha: "head-1748",
    remediation_target: null,
    next_action: null,
  });
});

test("buildIssueRunTimelineExport keeps sparse historical records explicit", () => {
  const timeline = buildIssueRunTimelineExport({
    record: createRecord({
      pr_number: null,
      latest_local_ci_result: undefined,
      timeline_artifacts: undefined,
      local_review_run_at: null,
      local_review_recommendation: null,
      last_recovery_reason: null,
      last_recovery_at: null,
      codex_session_id: null,
      last_codex_summary: null,
      updated_at: "2026-04-25T10:12:00Z",
    }),
    pr: null,
  });

  assert.equal(timeline.issue_number, 102);
  assert.equal(timeline.pr_number, null);
  assert.deepEqual(
    timeline.events.map((event) => [event.event_type, event.timestamp, event.outcome, event.summary]),
    [
      ["reservation", null, "recorded", "Issue run reservation exists for branch codex/issue-102."],
      ["codex_turn", null, "missing", "No Codex turn summary is recorded for this issue run."],
      ["publication_gate", null, "missing", "No publication gate event is recorded for this issue run."],
      ["pr_created", null, "missing", "No pull request creation event is recorded for this issue run."],
      ["local_ci", null, "missing", "No local CI result is recorded for this issue run."],
      ["path_hygiene", null, "missing", "No workstation-local path hygiene result is recorded for this issue run."],
      ["review", null, "missing", "No local review result is recorded for this issue run."],
      ["stale_review_metadata", null, "missing", "No stale review metadata handling event is recorded for this issue run."],
      ["recovery", null, "missing", "No recovery event is recorded for this issue run."],
      ["merge", null, "missing", "No merge event is recorded for this issue run."],
      ["done", null, "missing", "Issue run is not recorded as done."],
    ],
  );
});
