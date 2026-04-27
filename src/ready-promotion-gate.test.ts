import test from "node:test";
import assert from "node:assert/strict";
import { createFailureContext, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import {
  deriveReadyPromotionPathHygieneDecision,
  type ReadyPromotionPathHygieneDecision,
} from "./ready-promotion-gate";
import { type WorkstationLocalPathGateResult } from "./workstation-local-path-gate";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;

function applyFailureSignature(
  _record: Parameters<typeof deriveReadyPromotionPathHygieneDecision>[0]["record"],
  context: Parameters<typeof deriveReadyPromotionPathHygieneDecision>[0]["gate"]["failureContext"],
) {
  return {
    last_failure_signature: context?.signature ?? null,
    repeated_failure_signature_count: context ? 1 : 0,
  };
}

function deriveDecision(args: {
  gate: WorkstationLocalPathGateResult;
  fallbackSummary?: string;
}): ReadyPromotionPathHygieneDecision {
  return deriveReadyPromotionPathHygieneDecision({
    record: createRecord({ state: "draft_pr" }),
    pr: createPullRequest({ isDraft: true, headRefOid: "head-116" }),
    gate: args.gate,
    fallbackSummary: args.fallbackSummary ?? "fallback ready-promotion gate failure",
    applyFailureSignature,
  });
}

test("ready-promotion path hygiene gate matrix protects draft promotion safety transitions", async (t) => {
  const failureContext = {
    ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
  };
  const cases: {
    name: string;
    gate: WorkstationLocalPathGateResult;
    expected: {
      kind: ReadyPromotionPathHygieneDecision["kind"];
      state?: string;
      blockedReason?: string | null;
      remediationTarget?: string;
      rewrittenTrackedPaths?: string[];
      lastFailureSignature?: string | null;
      lastErrorPattern?: RegExp;
    };
  }[] = [
    {
      name: "clean gate keeps the draft ready-promotion path open",
      gate: { ok: true, failureContext: null },
      expected: {
        kind: "passed",
        rewrittenTrackedPaths: [],
      },
    },
    {
      name: "clean gate returns normalized durable artifacts before promotion",
      gate: {
        ok: true,
        failureContext: null,
        rewrittenJournalPaths: [".codex-supervisor/issue-journal.md"],
        rewrittenTrustedGeneratedArtifactPaths: ["docs/generated-summary.md"],
      },
      expected: {
        kind: "passed",
        rewrittenTrackedPaths: [".codex-supervisor/issue-journal.md", "docs/generated-summary.md"],
      },
    },
    {
      name: "actionable path hygiene blocker queues repair instead of marking ready",
      gate: {
        ok: false,
        failureContext,
        actionablePublishableFilePaths: ["docs/guide.md"],
      },
      expected: {
        kind: "repair",
        state: "repairing_ci",
        blockedReason: null,
        remediationTarget: "repair_already_queued",
        lastFailureSignature: "workstation-local-path-hygiene-failed",
        lastErrorPattern: /will retry a repair turn/i,
      },
    },
    {
      name: "non-actionable path hygiene blocker requires manual verification",
      gate: {
        ok: false,
        failureContext,
        actionablePublishableFilePaths: [],
      },
      expected: {
        kind: "manual_review",
        state: "blocked",
        blockedReason: "verification",
        remediationTarget: "manual_review",
        lastFailureSignature: "workstation-local-path-hygiene-failed",
        lastErrorPattern: /Tracked durable artifacts failed workstation-local path hygiene/,
      },
    },
    {
      name: "malformed failed gate without failure context fails closed to manual verification",
      gate: {
        ok: false,
        failureContext: null,
        actionablePublishableFilePaths: ["docs/guide.md"],
      },
      expected: {
        kind: "manual_review",
        state: "blocked",
        blockedReason: "verification",
        remediationTarget: "manual_review",
        lastFailureSignature: null,
        lastErrorPattern: /fallback ready-promotion gate failure/,
      },
    },
  ];

  for (const matrixCase of cases) {
    await t.test(matrixCase.name, () => {
      const decision = deriveDecision({ gate: matrixCase.gate });

      assert.equal(decision.kind, matrixCase.expected.kind);
      if (decision.kind === "passed") {
        assert.deepEqual(decision.rewrittenTrackedPaths, matrixCase.expected.rewrittenTrackedPaths);
        return;
      }

      assert.equal(decision.recordPatch.state, matrixCase.expected.state);
      assert.equal(decision.recordPatch.blocked_reason, matrixCase.expected.blockedReason);
      assert.equal(decision.recordPatch.last_failure_signature, matrixCase.expected.lastFailureSignature);
      assert.equal(decision.comment.remediationTarget, matrixCase.expected.remediationTarget);
      assert.match(decision.recordPatch.last_error ?? "", matrixCase.expected.lastErrorPattern ?? /./);
    });
  }
});

test("deriveReadyPromotionPathHygieneDecision routes actionable path hygiene blockers to repair", () => {
  const record = createRecord({ state: "draft_pr" });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-116" });
  const failureContext = {
    ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
  };

  const decision = deriveReadyPromotionPathHygieneDecision({
    record,
    pr,
    gate: {
      ok: false,
      failureContext,
      actionablePublishableFilePaths: ["docs/guide.md"],
    },
    fallbackSummary: "fallback",
    applyFailureSignature: (_record, context) => ({
      last_failure_signature: context?.signature ?? null,
      repeated_failure_signature_count: context ? 1 : 0,
    }),
  });

  assert.equal(decision.kind, "repair");
  assert.equal(decision.recordPatch.state, "repairing_ci");
  assert.equal(decision.recordPatch.blocked_reason, null);
  assert.equal(decision.recordPatch.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(decision.comment.remediationTarget, "repair_already_queued");
  assert.match(decision.failureContext.summary, /will retry a repair turn/i);
  assert.deepEqual(decision.recordPatch.timeline_artifacts, [
    {
      type: "path_hygiene_result",
      gate: "workstation_local_path_hygiene",
      command: "npm run verify:paths",
      head_sha: "head-116",
      outcome: "repair_queued",
      remediation_target: "repair_already_queued",
      next_action: "wait_for_repair_turn",
      summary: decision.failureContext.summary,
      recorded_at: decision.failureContext.updated_at,
      repair_targets: ["docs/guide.md"],
    },
  ]);
});

test("deriveReadyPromotionPathHygieneDecision falls back to manual review for non-actionable blockers", () => {
  const record = createRecord({ state: "draft_pr" });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-116" });
  const failureContext = {
    ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
  };

  const decision = deriveReadyPromotionPathHygieneDecision({
    record,
    pr,
    gate: {
      ok: false,
      failureContext,
      actionablePublishableFilePaths: [],
    },
    fallbackSummary: "fallback",
    applyFailureSignature: (_record, context) => ({
      last_failure_signature: context?.signature ?? null,
      repeated_failure_signature_count: context ? 1 : 0,
    }),
  });

  assert.equal(decision.kind, "manual_review");
  assert.equal(decision.recordPatch.state, "blocked");
  assert.equal(decision.recordPatch.blocked_reason, "verification");
  assert.equal(decision.recordPatch.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(decision.comment.remediationTarget, "manual_review");
  assert.match(decision.recordPatch.last_error ?? "", /Tracked durable artifacts failed/);
  assert.deepEqual(decision.recordPatch.timeline_artifacts, [
    {
      type: "path_hygiene_result",
      gate: "workstation_local_path_hygiene",
      command: "npm run verify:paths",
      head_sha: "head-116",
      outcome: "failed",
      remediation_target: "manual_review",
      next_action: "operator_manual_review",
      summary: failureContext.summary,
      recorded_at: failureContext.updated_at,
    },
  ]);
});
