import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewPolicyInput } from "../codex-connector-review-policy";
import { buildPrLifecycleDecisionTrace } from "./pr-lifecycle-trace";
import { normalizePrLifecycleFacts, type PrLifecycleFactInventory } from "./pr-lifecycle-state";
import { evaluateDecisionKernelV2PrLifecycleAction } from "./v2-pr-lifecycle-action";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fresh_github",
    observedAt: "2026-06-09T00:00:00.000Z",
    pullRequest: {
      number: 2312,
      headSha: "head-current",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadReviewObservedAt: "2026-06-09T00:01:00.000Z",
      currentHeadReviewHeadSha: "head-current",
    },
    reviewThreads: {
      unresolvedManualThreadCount: 0,
      unresolvedCurrentHeadConfiguredBotThreadCount: 0,
      stalePreviousHeadConfiguredBotThreadCount: 0,
      metadataOnlyUnresolvedThreadCount: 0,
    },
    checks: {
      passingCount: 3,
      pendingCount: 0,
      failingCount: 0,
      unknownCount: 0,
    },
    localState: {
      trackedHeadSha: "head-current",
      workspaceHeadSha: "head-current",
      lastObservedPrHeadSha: "head-current",
    },
    configuredCurrentHeadReviewRequired: true,
    ...overrides,
  };
}

function reviewPolicyInput(
  outcomes: Array<ReviewPolicyInput["threads"][number]["boundaryOutcome"]>,
): ReviewPolicyInput {
  return {
    providerIdentity: {
      configuredProviderKinds: ["codex"],
      configuredBotLogins: ["chatgpt-codex-connector"],
    },
    pr: {
      number: 2312,
      headSha: "head-current",
      currentHeadObservedAt: "2026-06-09T00:01:00.000Z",
      latestReviewedCommitSha: "head-current",
      providerSuccessHeadSha: null,
      externalReviewHeadSha: null,
      currentHeadCiGreenAt: "2026-06-09T00:02:00.000Z",
    },
    threads: outcomes.map((boundaryOutcome, index) => ({
      id: `thread-${index}`,
      isResolved: false,
      isOutdated: boundaryOutcome === "stale_commit_thread",
      path: "src/example.ts",
      line: 10 + index,
      comments: [],
      latestComment: null,
      latestCodexConnectorSeverity: null,
      latestCodexConnectorCommentFingerprint: null,
      findingKind: boundaryOutcome === "must_fix_current_head" ? "must_fix" : "none",
      headRelation: boundaryOutcome === "stale_commit_thread" ? "stale_commit" : "current_head",
      boundaryOutcome,
      processedEvidence: {
        threadId: `thread-${index}`,
        latestCommentFingerprint: null,
        processedOnCurrentHead: boundaryOutcome === "metadata_only_unresolved",
        processedOnPriorHead: boundaryOutcome === "stale_commit_thread",
        processedThreadKeys: [`thread-${index}@head-current`],
        processedThreadFingerprintKeys: [],
      },
      vocabulary: [],
    })),
  };
}

test("evaluateDecisionKernelV2PrLifecycleAction promotes missing review to request_review behind the PR lifecycle gate", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
  });

  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["v2_request_review"]);
  assert.deepEqual(decision.traceDecision, {
    value: "request_review",
    recommendedAction: "request_review",
    summary: "Current-head review evidence is missing.",
  });
  assert.equal(decision.mode.actionSource, "pr_lifecycle_v2");
  assert.equal(decision.guard?.decision, "allowed");
});

test("evaluateDecisionKernelV2PrLifecycleAction promotes pending and unknown checks to wait_ci", () => {
  const pending = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
        checks: {
          passingCount: 1,
          pendingCount: 1,
          failingCount: 0,
          unknownCount: 0,
        },
      }),
    ),
  });
  const unknown = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
        checks: {
          passingCount: 0,
          pendingCount: 0,
          failingCount: 0,
          unknownCount: 0,
        },
      }),
    ),
  });

  assert.equal(pending.action, "wait_ci");
  assert.equal(unknown.action, "wait_ci");
  assert.deepEqual(pending.traceDecision, {
    value: "wait",
    recommendedAction: "wait_ci",
    summary: "Required checks are still pending.",
  });
  assert.deepEqual(unknown.v2Decision.reasons, ["checks_unknown"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction keeps repair outside the action boundary and promotes merge readiness", () => {
  const failingChecks = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        checks: {
          passingCount: 1,
          pendingCount: 0,
          failingCount: 1,
          unknownCount: 0,
        },
      }),
    ),
  });
  const mergeReady = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
    checkPolicyInput: {
      mergeReadyBlockedByRequiredChecks: false,
      mergeReadyBlockedByLocalCi: false,
      mergeReadyBlockedByFinalGuard: false,
    },
  });

  assert.equal(failingChecks.v2Decision.action, "run_codex");
  assert.equal(failingChecks.action, "no_action");
  assert.deepEqual(failingChecks.reasons, ["v2_action_not_promoted"]);
  assert.equal(mergeReady.v2Decision.action, "merge");
  assert.equal(mergeReady.action, "merge");
  assert.deepEqual(mergeReady.reasons, ["v2_merge_ready"]);
  assert.deepEqual(mergeReady.traceDecision, {
    value: "merge",
    recommendedAction: "merge",
    summary: "PR appears merge-ready.",
  });
  assert.deepEqual(mergeReady.evidenceTokens, [
    "v2_reason=merge_ready_diagnostic_only",
    "gate=head_sha:current_head",
    "gate=local_state:fresh",
    "gate=review:current_head_review_observed",
    "gate=checks:green",
    "gate=mergeability:mergeable",
    "gate=required_checks:passed",
    "gate=local_verification:passed",
    "gate=final_guard:passed",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction requires explicit merge gate input before promoting merge", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
  });

  assert.equal(decision.v2Decision.action, "merge");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_merge_gate_evidence_missing"]);
  assert.deepEqual(decision.evidenceTokens, [
    "missing=merge_gate_input",
    "v2_reason=merge_ready_diagnostic_only",
    "gate=head_sha:current_head",
    "gate=local_state:fresh",
    "gate=review:current_head_review_observed",
    "gate=checks:green",
    "gate=mergeability:mergeable",
    "gate=required_checks:missing",
    "gate=local_verification:missing",
    "gate=final_guard:missing",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction lets merge-ready facts bypass repair retry exhaustion", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
    checkPolicyInput: {
      mergeReadyBlockedByRequiredChecks: false,
      mergeReadyBlockedByLocalCi: false,
      mergeReadyBlockedByFinalGuard: false,
    },
    reviewerLoopTerminal: {
      retryBudgetExhausted: true,
      reason: "repair retry exhausted",
    },
  });

  assert.equal(decision.v2Decision.action, "merge");
  assert.equal(decision.action, "merge");
  assert.deepEqual(decision.reasons, ["v2_merge_ready"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction fails closed before merge when safety evidence is missing or blocking", () => {
  const cases: Array<{
    label: string;
    normalizedState: ReturnType<typeof normalizePrLifecycleFacts>;
    checkPolicyInput?: Parameters<typeof evaluateDecisionKernelV2PrLifecycleAction>[0]["checkPolicyInput"];
    expectedAction: string;
    expectedReasons: string[];
  }> = [
    {
      label: "pending CI",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          checks: { passingCount: 2, pendingCount: 1, failingCount: 0, unknownCount: 0 },
        }),
      ),
      expectedAction: "wait_ci",
      expectedReasons: ["v2_wait_ci"],
    },
    {
      label: "failing CI",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          checks: { passingCount: 2, pendingCount: 0, failingCount: 1, unknownCount: 0 },
        }),
      ),
      expectedAction: "no_action",
      expectedReasons: ["v2_action_not_promoted"],
    },
    {
      label: "manual review",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          reviewThreads: {
            unresolvedManualThreadCount: 1,
            unresolvedCurrentHeadConfiguredBotThreadCount: 0,
            stalePreviousHeadConfiguredBotThreadCount: 0,
            metadataOnlyUnresolvedThreadCount: 0,
          },
        }),
      ),
      expectedAction: "ask_operator",
      expectedReasons: ["v2_ask_operator"],
    },
    {
      label: "SHA mismatch",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          pullRequest: {
            number: 2312,
            headSha: "head-new",
            state: "OPEN",
            isDraft: false,
            mergeStateStatus: "CLEAN",
            mergeable: "MERGEABLE",
            currentHeadReviewObservedAt: "2026-06-09T00:01:00.000Z",
            currentHeadReviewHeadSha: "head-new",
          },
          localState: {
            trackedHeadSha: "head-current",
            workspaceHeadSha: "head-current",
            lastObservedPrHeadSha: "head-current",
          },
        }),
      ),
      expectedAction: "ask_operator",
      expectedReasons: ["fresh_facts_guard_blocked"],
    },
    {
      label: "merge conflict",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          pullRequest: {
            number: 2312,
            headSha: "head-current",
            state: "OPEN",
            isDraft: false,
            mergeStateStatus: "DIRTY",
            mergeable: "CONFLICTING",
            currentHeadReviewObservedAt: "2026-06-09T00:01:00.000Z",
            currentHeadReviewHeadSha: "head-current",
          },
        }),
      ),
      expectedAction: "ask_operator",
      expectedReasons: ["v2_ask_operator"],
    },
    {
      label: "missing local verification",
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          localState: {
            trackedHeadSha: null,
            workspaceHeadSha: null,
            lastObservedPrHeadSha: null,
          },
        }),
      ),
      expectedAction: "ask_operator",
      expectedReasons: ["fresh_facts_guard_blocked"],
    },
    {
      label: "final guard blocked",
      normalizedState: normalizePrLifecycleFacts(inventory()),
      checkPolicyInput: { mergeReadyBlockedByFinalGuard: true },
      expectedAction: "ask_operator",
      expectedReasons: ["v2_ask_operator"],
    },
  ];

  for (const testCase of cases) {
    const decision = evaluateDecisionKernelV2PrLifecycleAction({
      mode: "pr_lifecycle_action_taking",
      normalizedState: testCase.normalizedState,
      checkPolicyInput: testCase.checkPolicyInput,
    });

    assert.equal(decision.action, testCase.expectedAction, testCase.label);
    assert.deepEqual(decision.reasons, testCase.expectedReasons, testCase.label);
    assert.notEqual(decision.action, "merge", testCase.label);
  }
});

test("evaluateDecisionKernelV2PrLifecycleAction promotes ambiguous review facts to ask_operator", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 1,
          unresolvedCurrentHeadConfiguredBotThreadCount: 0,
          stalePreviousHeadConfiguredBotThreadCount: 0,
          metadataOnlyUnresolvedThreadCount: 0,
        },
      }),
    ),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_ask_operator"]);
  assert.deepEqual(decision.traceDecision, {
    value: "ask_operator",
    recommendedAction: "manual_review",
    summary: "Manual review threads require operator review.",
  });
});

test("evaluateDecisionKernelV2PrLifecycleAction requests current-head review before stale previous-head terminal resolution", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 0,
          unresolvedCurrentHeadConfiguredBotThreadCount: 0,
          stalePreviousHeadConfiguredBotThreadCount: 1,
          metadataOnlyUnresolvedThreadCount: 0,
        },
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
    reviewPolicyInput: reviewPolicyInput(["stale_commit_thread"]),
  });

  assert.equal(decision.v2Decision.action, "wait");
  assert.deepEqual(decision.v2Decision.reasons, ["stale_commit_review"]);
  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["v2_stale_review_needs_current_head_review"]);
  assert.deepEqual(decision.traceDecision, {
    value: "request_review",
    recommendedAction: "request_review",
    summary: "Stale review residue needs current-head review evidence before terminal stale resolution.",
  });
  assert.deepEqual(decision.evidenceTokens, [
    "terminal=stale_commit_review",
    "missing=current_head_review",
    "v2_reason=stale_commit_review",
    "required_evidence=current_head_review",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction promotes stale review residue after current-head evidence exists", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
    reviewPolicyInput: reviewPolicyInput(["stale_commit_thread"]),
  });

  assert.equal(decision.v2Decision.action, "wait");
  assert.deepEqual(decision.v2Decision.reasons, ["stale_commit_review"]);
  assert.equal(decision.v2Decision.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(decision.action, "mark_stale_resolved");
  assert.deepEqual(decision.reasons, ["v2_mark_stale_resolved"]);
  assert.deepEqual(decision.traceDecision, {
    value: "do_nothing",
    recommendedAction: "mark_stale_resolved",
    summary: "Review findings are tied to a stale commit and need current-head evidence.",
  });
});

test("evaluateDecisionKernelV2PrLifecycleAction treats processed metadata-only residue as terminal operator cleanup", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 0,
          unresolvedCurrentHeadConfiguredBotThreadCount: 0,
          stalePreviousHeadConfiguredBotThreadCount: 0,
          metadataOnlyUnresolvedThreadCount: 1,
        },
      }),
    ),
    reviewPolicyInput: reviewPolicyInput(["metadata_only_unresolved"]),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_metadata_terminal"]);
  assert.deepEqual(decision.evidenceTokens, [
    "terminal=metadata_only_review_residue",
    "v2_reason=metadata_only_review_residue",
    "required_evidence=resolved_metadata_residue",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction sends exhausted reviewer loops to operator instead of Codex repair", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 0,
          unresolvedCurrentHeadConfiguredBotThreadCount: 1,
          stalePreviousHeadConfiguredBotThreadCount: 0,
          metadataOnlyUnresolvedThreadCount: 0,
        },
      }),
    ),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"]),
    reviewerLoopTerminal: {
      retryBudgetExhausted: true,
      reason: "repeat stop exhausted",
    },
  });

  assert.equal(decision.v2Decision.action, "run_codex");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_reviewer_loop_terminal"]);
  assert.deepEqual(decision.evidenceTokens, [
    "terminal=reviewer_loop_exhausted",
    "retry_budget=repeat_stop_exhausted",
    "v2_reason=current_head_must_fix_review",
    "required_evidence=current_head_review+resolved_manual_threads",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction honors exhausted reviewer loops before requesting review", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
    reviewerLoopTerminal: {
      retryBudgetExhausted: true,
      reason: "retry exhausted",
    },
  });

  assert.equal(decision.v2Decision.action, "request_review");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_reviewer_loop_terminal"]);
  assert.deepEqual(decision.evidenceTokens, [
    "terminal=reviewer_loop_exhausted",
    "retry_budget=retry_exhausted",
    "v2_reason=missing_current_head_review",
    "required_evidence=current_head_review",
  ]);
});

test("evaluateDecisionKernelV2PrLifecycleAction keeps must-fix current-head reviews outside terminal promotion without retry exhaustion", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 0,
          unresolvedCurrentHeadConfiguredBotThreadCount: 1,
          stalePreviousHeadConfiguredBotThreadCount: 0,
          metadataOnlyUnresolvedThreadCount: 0,
        },
      }),
    ),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"]),
  });

  assert.equal(decision.v2Decision.action, "run_codex");
  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["v2_action_not_promoted"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction fails closed when fresh fact requirements are not met", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        source: "cached_github",
      }),
    ),
  });

  assert.equal(decision.guard?.decision, "blocked");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["fresh_facts_guard_blocked"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction keeps disabled and diagnostic-only modes non-mutating", () => {
  const normalizedState = normalizePrLifecycleFacts(
    inventory({
      pullRequest: {
        number: 2312,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
    }),
  );
  const disabled = evaluateDecisionKernelV2PrLifecycleAction({ mode: "disabled", normalizedState });
  const diagnosticOnly = evaluateDecisionKernelV2PrLifecycleAction({ mode: "diagnostic_only", normalizedState });

  assert.equal(disabled.v2Decision.action, "request_review");
  assert.equal(disabled.action, "no_action");
  assert.equal(disabled.mode.actionSource, "disabled");
  assert.deepEqual(disabled.reasons, ["v2_disabled"]);
  assert.equal(diagnosticOnly.v2Decision.action, "request_review");
  assert.equal(diagnosticOnly.action, "no_action");
  assert.equal(diagnosticOnly.mode.actionSource, "disabled");
  assert.deepEqual(diagnosticOnly.reasons, ["v2_diagnostic_only"]);
});

test("Phase 4 v2 PR lifecycle action-taking replay evidence covers selected actions and rollback modes", () => {
  const normalizedReady = normalizePrLifecycleFacts(inventory());
  const cases = [
    {
      id: "request-review",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "pr_lifecycle_action_taking",
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            pullRequest: {
              number: 2312,
              headSha: "head-current",
              state: "OPEN",
              isDraft: false,
              mergeStateStatus: "CLEAN",
              mergeable: "MERGEABLE",
              currentHeadReviewObservedAt: null,
              currentHeadReviewHeadSha: null,
            },
          }),
        ),
      }),
    },
    {
      id: "wait-ci",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "pr_lifecycle_action_taking",
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            checks: {
              passingCount: 1,
              pendingCount: 1,
              failingCount: 0,
              unknownCount: 0,
            },
          }),
        ),
      }),
    },
    {
      id: "stale-terminal",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "pr_lifecycle_action_taking",
        normalizedState: normalizedReady,
        reviewPolicyInput: reviewPolicyInput(["stale_commit_thread"]),
      }),
    },
    {
      id: "operator-escalation",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "pr_lifecycle_action_taking",
        normalizedState: normalizePrLifecycleFacts(
          inventory({
            reviewThreads: {
              unresolvedManualThreadCount: 1,
              unresolvedCurrentHeadConfiguredBotThreadCount: 0,
              stalePreviousHeadConfiguredBotThreadCount: 0,
              metadataOnlyUnresolvedThreadCount: 0,
            },
          }),
        ),
      }),
    },
    {
      id: "merge-ready",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "pr_lifecycle_action_taking",
        normalizedState: normalizedReady,
        checkPolicyInput: {
          mergeReadyBlockedByRequiredChecks: false,
          mergeReadyBlockedByLocalCi: false,
          mergeReadyBlockedByFinalGuard: false,
        },
      }),
    },
    {
      id: "diagnostic-rollback",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "diagnostic_only",
        normalizedState: normalizedReady,
      }),
    },
    {
      id: "disabled-rollback",
      decision: evaluateDecisionKernelV2PrLifecycleAction({
        mode: "disabled",
        normalizedState: normalizedReady,
      }),
    },
  ] as const;

  const traces = cases.map(({ id, decision }) =>
    buildPrLifecycleDecisionTrace({
      traceId: `phase4-${id}`,
      generatedAt: "2026-06-09T00:03:00.000Z",
      normalizedState: decision.v2Decision.normalizedState,
      policy: {
        name: "pr_lifecycle_decision_kernel_v2",
        posture: "unknown",
        reasons: decision.v2Decision.reasons,
      },
      decision: decision.traceDecision,
      evidenceTokens: [`case=${id}`, ...decision.evidenceTokens],
      v2Mode: decision.mode,
    }),
  );

  assert.deepEqual(
    traces.map((trace, index) => [
      cases[index]?.id,
      trace.v2Mode.mode,
      trace.decision.value,
      trace.decision.recommendedAction,
      trace.v2Mode.actionSource,
      trace.v2Mode.mutationAllowed,
    ]),
    [
      ["request-review", "pr_lifecycle_action_taking", "request_review", "request_review", "pr_lifecycle_v2", true],
      ["wait-ci", "pr_lifecycle_action_taking", "wait", "wait_ci", "pr_lifecycle_v2", true],
      ["stale-terminal", "pr_lifecycle_action_taking", "do_nothing", "mark_stale_resolved", "pr_lifecycle_v2", true],
      ["operator-escalation", "pr_lifecycle_action_taking", "ask_operator", "manual_review", "pr_lifecycle_v2", true],
      ["merge-ready", "pr_lifecycle_action_taking", "merge", "merge", "pr_lifecycle_v2", true],
      ["diagnostic-rollback", "diagnostic_only", "do_nothing", "no_action", "disabled", false],
      ["disabled-rollback", "disabled", "do_nothing", "no_action", "disabled", false],
    ],
  );
});

test("v2 PR lifecycle action decisions can be recorded with a v2 action source trace posture", () => {
  const actionDecision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
  });
  const trace = buildPrLifecycleDecisionTrace({
    traceId: "trace-2312",
    generatedAt: "2026-06-09T00:02:00.000Z",
    normalizedState: actionDecision.v2Decision.normalizedState,
    policy: {
      name: "pr_lifecycle_decision_kernel_v2",
      posture: "request_current_head_review",
      reasons: actionDecision.v2Decision.reasons,
    },
    decision: actionDecision.traceDecision,
    evidenceTokens: ["pr=2312", "action_source=pr_lifecycle_v2", ...actionDecision.evidenceTokens],
    v2Mode: actionDecision.mode,
  });

  assert.equal(trace.v2Mode.mode, "pr_lifecycle_action_taking");
  assert.equal(trace.v2Mode.actionSource, "pr_lifecycle_v2");
  assert.equal(trace.decision.value, "request_review");
  assert.equal(trace.decision.recommendedAction, "request_review");
});
