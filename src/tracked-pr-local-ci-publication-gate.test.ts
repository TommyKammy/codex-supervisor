import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runLocalCiGate } from "./local-ci";
import { runTrackedPrReadyLocalCiPublicationGate } from "./tracked-pr-local-ci-publication-gate";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import type { SupervisorStateFile } from "./core/types";

test("runTrackedPrReadyLocalCiPublicationGate reports workspace failures with the shared remediation target", async () => {
  const pr = createPullRequest({
    number: 116,
    isDraft: true,
    headRefOid: "head-116",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: pr.number,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: record.issue_number,
    issues: { [String(record.issue_number)]: record },
  };
  const comments: string[] = [];

  const result = await runTrackedPrReadyLocalCiPublicationGate({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (currentRecord, patch) => ({
        ...currentRecord,
        ...patch,
        updated_at: currentRecord.updated_at,
      }),
      save: async () => undefined,
    },
    state,
    record,
    pr,
    workspacePath: path.join("workspace", "issue-102"),
    github: {
      addIssueComment: async (_issueNumber, body) => {
        comments.push(body);
      },
    },
    syncJournal: async () => undefined,
    applyFailureSignature: (_currentRecord, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    runLocalCiCommand: async () => {
      throw Object.assign(
        new Error("Command failed: sh -lc +1 args\nexitCode=1\ntsc is not installed in this workspace"),
        { stderr: "tsc is not installed in this workspace" },
      );
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.record.latest_local_ci_result?.failure_class, "workspace_toolchain_missing");
  assert.equal(result.record.latest_local_ci_result?.remediation_target, "workspace_environment");
  assert.equal(
    result.record.last_host_local_pr_blocker_comment_signature,
    "local-ci-gate-workspace_toolchain_missing|gate=local_ci|failure=workspace_toolchain_missing|target=workspace_environment",
  );
  assert.match(comments[0] ?? "", /remediation target: `workspace_environment`/);
});

test("runLocalCiGate reports missing local CI configuration as a config-contract target", async () => {
  const result = await runLocalCiGate({
    config: { localCiCommand: "" },
    workspacePath: path.join("workspace", "issue-102"),
    gateLabel: "before opening a pull request",
  });

  assert.equal(result.ok, true);
  assert.equal(result.latestResult?.failure_class, "unset_contract");
  assert.equal(result.latestResult?.remediation_target, "config_contract");
  assert.equal(
    result.latestResult?.summary,
    "No repo-owned local CI contract is configured before opening a pull request. Remediation target: config contract.",
  );
});
