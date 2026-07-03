import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfig,
  createRecord,
} from "../turn-execution-test-helpers";
import { shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve } from "./codex-connector-verified-stale-residue-selection";

test("shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve skips hydration when Codex is not configured", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai"],
  });
  const record = createRecord({
    issue_number: 2401,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 2402,
  });
  const calls: string[] = [];

  const result = await shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve({
    config,
    record,
    getPullRequestIfExists: async () => {
      calls.push("pull-request");
      throw new Error("should not hydrate PRs for non-Codex configs");
    },
    getChecks: async () => {
      calls.push("checks");
      return [];
    },
    getUnresolvedReviewThreads: async () => {
      calls.push("review-threads");
      return [];
    },
  });

  assert.equal(result, false);
  assert.deepEqual(calls, []);
});
