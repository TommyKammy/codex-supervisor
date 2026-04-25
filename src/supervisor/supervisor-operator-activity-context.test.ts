import assert from "node:assert/strict";
import test from "node:test";
import { buildIssueActivityContext } from "./supervisor-operator-activity-context";
import { createConfig, createPullRequest, createRecord } from "./supervisor-test-helpers";

test("buildIssueActivityContext keeps the legacy local CI failure signature blocking during rollout", () => {
  const context = buildIssueActivityContext({
    config: createConfig(),
    record: createRecord({
      blocked_reason: "verification",
      last_failure_signature: "local-ci-gate-failed",
      last_head_sha: "head-1207",
      latest_local_ci_result: {
        outcome: "failed",
        summary: "Configured local CI command failed before marking PR #1210 ready.",
        ran_at: "2026-03-30T13:30:00Z",
        head_sha: "head-1207",
        execution_mode: "legacy_shell_string",
        failure_class: "non_zero_exit",
        remediation_target: "tracked_publishable_content",
      },
    }),
    pr: createPullRequest({
      headRefOid: "head-1207",
    }),
  });

  assert.equal(context.localCiStatus?.context, "blocking");
  assert.equal(context.localCiStatus?.failureClass, "non_zero_exit");
  assert.equal(context.localCiStatus?.remediationTarget, "tracked_publishable_content");
});
