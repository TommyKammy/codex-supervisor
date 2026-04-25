import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOperatorAuditBundle,
  extractIssueVerificationCommands,
  renderOperatorAuditBundleDto,
} from "./operator-audit-bundle";
import { createIssue, createPullRequest, createRecord } from "./turn-execution-test-helpers";

function buildMacHomePath(owner: string, ...segments: string[]): string {
  return ["/", "Users", "/", owner, ...segments.flatMap((segment) => ["/", segment])].join("");
}

function buildWindowsHomePath(owner: string, ...segments: string[]): string {
  return ["C:", "\\", "Users", "\\", owner, ...segments.flatMap((segment) => ["\\", segment])].join("");
}

test("extractIssueVerificationCommands reads the issue Verification section", () => {
  assert.deepEqual(
    extractIssueVerificationCommands([
      "## Summary",
      "Ship a bundle.",
      "",
      "## Verification",
      "Run locally first.",
      "- Confirm the local environment is clean.",
      "- `npm run verify:paths`",
      "- npx tsx --test src/operator-audit-bundle.test.ts",
      "- CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js issue-lint 1745",
      "`make verify`",
      "- `npm run build`",
      "",
      "## Notes",
      "- not a command",
      "",
    ].join("\n")),
    [
      "npm run verify:paths",
      "npx tsx --test src/operator-audit-bundle.test.ts",
      "CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js issue-lint 1745",
      "make verify",
      "npm run build",
    ],
  );
});

test("buildOperatorAuditBundle includes structured issue-run evidence and explicit missing entries", () => {
  const forbiddenPath = buildMacHomePath("alice", "Dev", "private-repo");
  const forbiddenWindowsPath = buildWindowsHomePath("Alice", "Dev", "private-repo");
  const bundle = buildOperatorAuditBundle({
    issue: createIssue({
      number: 1745,
      title: "Generate operator audit bundle",
      body: [
        "## Summary",
        `Bundle should redact ${forbiddenPath} and ${forbiddenWindowsPath}.`,
        "",
        "## Verification",
        "- `npx tsx --test src/operator-audit-bundle.test.ts`",
        "- `npm run verify:paths`",
        "",
      ].join("\n"),
    }),
    record: createRecord({
      issue_number: 1745,
      branch: "codex/issue-1745",
      workspace: buildMacHomePath("alice", "Dev", "codex-supervisor", ".local", "worktrees", "issue-1745"),
      pr_number: 1750,
      last_head_sha: "head-1745",
      latest_local_ci_result: {
        outcome: "failed",
        summary: `Local CI failed while reading ${forbiddenPath}.`,
        ran_at: "2026-04-25T10:06:00Z",
        head_sha: "head-1745",
        execution_mode: "legacy_shell_string",
        command: "npm run build",
        failure_class: "non_zero_exit",
        remediation_target: "tracked_publishable_content",
      },
      timeline_artifacts: [
        {
          type: "path_hygiene_result",
          gate: "workstation_local_path_hygiene",
          command: "npm run verify:paths",
          head_sha: "head-1745",
          outcome: "repair_queued",
          remediation_target: "repair_already_queued",
          next_action: "wait_for_repair_turn",
          summary: `Path hygiene repaired ${forbiddenPath}.`,
          recorded_at: "2026-04-25T10:04:00Z",
          repair_targets: ["docs/guide.md"],
        },
      ],
      last_recovery_reason: "stale_state_cleanup: moved from stabilizing to draft_pr",
      last_recovery_at: "2026-04-25T10:05:00Z",
      updated_at: "2026-04-25T10:12:00Z",
    }),
    pr: createPullRequest({
      number: 1750,
      title: "Generate audit bundle",
      url: "https://example.test/pull/1750",
      headRefName: "codex/issue-1745",
      headRefOid: "head-1745",
    }),
    journalContent: [
      "# Issue #1745: Generate operator audit bundle",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: bundle evidence is scattered.",
      "- Current blocker: none",
      "- Next exact step: run focused verification.",
      `- Verification gap: inspect ${forbiddenPath}.`,
      "",
    ].join("\n"),
  });

  assert.equal(bundle.advisoryOnly, true);
  assert.equal(bundle.issue.number, 1745);
  assert.equal(bundle.pullRequest.value?.number, 1750);
  assert.equal(bundle.stateRecord.value?.branch, "codex/issue-1745");
  assert.equal(bundle.localCi.value?.outcome, "failed");
  assert.equal(bundle.pathHygiene.value?.outcome, "repair_queued");
  assert.deepEqual(bundle.pathHygiene.value?.repairTargets, ["docs/guide.md"]);
  assert.equal(bundle.staleConfiguredBotRemediation.status, "missing");
  assert.equal(bundle.recoveryEvents.value?.[0]?.event_type, "recovery");
  assert.deepEqual(bundle.verificationCommands.value, [
    "npx tsx --test src/operator-audit-bundle.test.ts",
    "npm run verify:paths",
  ]);

  const rendered = renderOperatorAuditBundleDto(bundle);
  assert.doesNotMatch(rendered, new RegExp(forbiddenPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(rendered, new RegExp(forbiddenWindowsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered, /<redacted-local-path>/);
});
