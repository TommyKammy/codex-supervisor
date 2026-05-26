import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

test("explain reuses the recorded recovery reason for a recovered tracked PR issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Reuse tracked PR recovery reason in explain",
    body: executionReadyBody("Explain should show the persisted recovery story for tracked PR resumptions."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "reproducing",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 191,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191",
        last_recovery_at: "2026-03-19T00:20:00Z",
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
        last_failure_signature: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=reproducing$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#101 at=2026-03-19T00:20:00Z reason=tracked_pr_head_advanced detail=resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191$/m,
  );
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in draft_pr", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed explain diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR lifecycle state."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 192,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192",
        last_recovery_at: "2026-03-19T00:20:00Z",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=draft_pr$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#102 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in addressing_review", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 103;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed review diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR review lifecycle state."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 193,
        last_head_sha: "head-193",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193",
        last_recovery_at: "2026-03-19T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=addressing_review$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#103 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain surfaces failed no-PR transient auto-requeue recovery reasons", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 104;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Failed no-PR transient auto-requeue recovery",
    body: executionReadyBody("Explain should show why a transient already-satisfied failed no-PR issue was auto-requeued."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
        last_runtime_error: "Selected model is at capacity. Please try a different model.",
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-18T00:10:00Z",
        },
        last_recovery_reason:
          "failed_no_pr_transient_retry: requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
        last_recovery_at: "2026-03-19T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=queued$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#104 at=2026-03-19T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});
