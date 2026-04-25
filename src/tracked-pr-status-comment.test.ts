import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackedPrStatusCommentMarker,
  workspacePreparationRemediationTarget,
} from "./tracked-pr-status-comment";

test("buildTrackedPrStatusCommentMarker renders the stable sticky tracked PR marker", () => {
  assert.equal(
    buildTrackedPrStatusCommentMarker({
      issueNumber: 102,
      prNumber: 116,
      kind: "status",
    }),
    "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
  );
});

test("workspacePreparationRemediationTarget keeps generic preparation failures on workspace environment", () => {
  assert.equal(workspacePreparationRemediationTarget("non_zero_exit"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("workspace_toolchain_missing"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("missing_command"), "config_contract");
  assert.equal(workspacePreparationRemediationTarget("worktree_helper_missing"), "config_contract");
});
