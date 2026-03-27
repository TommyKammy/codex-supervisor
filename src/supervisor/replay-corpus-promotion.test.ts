import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayCorpusCaseBundle, ReplayCorpusInputSnapshot } from "./replay-corpus-model";
import {
  buildPromotedCaseMetadata,
  normalizePromotedInputSnapshot,
} from "./replay-corpus-promotion";
import { suggestReplayCorpusCaseIds } from "./replay-corpus-promotion-case-id";
import {
  deriveReplayCorpusPromotionWorthinessHints,
  summarizeReplayCorpusPromotion,
} from "./replay-corpus-promotion-summary";

function createSnapshot(): ReplayCorpusInputSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-03-19T00:00:00Z",
    issue: {
      number: 557,
      title: "Replay corpus promotion: suggest normalized case ids during promotion",
      url: "https://example.test/issues/557",
      state: "OPEN",
      updatedAt: "2026-03-19T00:00:00Z",
    },
    local: {
      record: {
        issue_number: 557,
        state: "stabilizing",
        branch: "codex/issue-557",
        pr_number: 91,
        workspace: "/tmp/workspaces/issue-557",
        journal_path: "/tmp/workspaces/issue-557/.codex-supervisor/issue-journal.md",
        attempt_count: 1,
        implementation_attempt_count: 1,
        repair_attempt_count: 0,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        last_head_sha: "old-head",
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        local_review_head_sha: null,
        local_review_blocker_summary: null,
        local_review_summary_path: "/tmp/reviews/summary.md",
        local_review_run_at: null,
        local_review_max_severity: null,
        local_review_findings_count: 0,
        local_review_root_cause_count: 0,
        local_review_verified_max_severity: null,
        local_review_verified_findings_count: 0,
        local_review_recommendation: null,
        local_review_degraded: false,
        last_local_review_signature: null,
        repeated_local_review_signature_count: 0,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        updated_at: "2026-03-19T00:00:00Z",
      },
      workspaceStatus: {
        branch: "codex/issue-557",
        headSha: "new-head",
        hasUncommittedChanges: true,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
    },
    github: {
      pullRequest: {
        number: 91,
        title: "Replay corpus promotion summary example",
        url: "https://example.test/pull/91",
        state: "OPEN",
        createdAt: "2026-03-19T00:00:00Z",
        updatedAt: "2026-03-19T00:00:00Z",
        isDraft: false,
        reviewDecision: "APPROVED",
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
        headRefName: "codex/issue-557",
        headRefOid: "new-head",
        mergedAt: null,
        configuredBotTopLevelReviewStrength: "blocking",
      },
      checks: [],
      reviewThreads: [],
    },
    decision: {
      nextState: "stabilizing",
      shouldRunCodex: true,
      blockedReason: null,
      failureContext: null,
    },
    operatorSummary: null,
  };
}

test("promotion case-id helpers stay deterministic in their dedicated module", () => {
  assert.deepEqual(suggestReplayCorpusCaseIds(createSnapshot()), [
    "issue-557-stabilizing",
    "issue-557-replay-corpus-promotion-suggest-normalized-case",
  ]);
});

test("promotion normalization helpers canonicalize local metadata before writing", () => {
  const normalizedSnapshot = normalizePromotedInputSnapshot(createSnapshot());

  assert.equal(normalizedSnapshot.local.record.workspace, ".");
  assert.equal(normalizedSnapshot.local.record.journal_path, ".codex-supervisor/issues/557/issue-journal.md");
  assert.equal(normalizedSnapshot.local.record.local_review_summary_path, null);
  assert.equal(normalizedSnapshot.local.workspaceStatus.hasUncommittedChanges, false);
  assert.deepEqual(buildPromotedCaseMetadata(normalizedSnapshot, "issue-557-stabilizing"), {
    schemaVersion: 1,
    id: "issue-557-stabilizing",
    issueNumber: 557,
    title: "Replay corpus promotion: suggest normalized case ids during promotion",
    capturedAt: "2026-03-19T00:00:00Z",
  });
});

test("promotion summary helpers surface normalization notes and advisory hints", () => {
  const sourceSnapshot = createSnapshot();
  const promotedCase: ReplayCorpusCaseBundle = {
    id: "issue-557-stabilizing",
    bundlePath: "/tmp/replay-corpus/cases/issue-557-stabilizing",
    metadata: buildPromotedCaseMetadata(sourceSnapshot, "issue-557-stabilizing"),
    input: {
      snapshot: normalizePromotedInputSnapshot(sourceSnapshot),
    },
    expected: {
      nextState: "stabilizing",
      shouldRunCodex: true,
      blockedReason: null,
      failureSignature: null,
    },
  };

  assert.deepEqual(deriveReplayCorpusPromotionWorthinessHints(sourceSnapshot).map((hint) => hint.id), [
    "stale-head-safety",
    "retry-escalation",
  ]);
  assert.deepEqual(summarizeReplayCorpusPromotion(sourceSnapshot, promotedCase), {
    casePath: "/tmp/replay-corpus/cases/issue-557-stabilizing",
    expectedOutcome: "nextState=stabilizing, shouldRunCodex=true, blockedReason=none, failureSignature=none",
    normalizationNotes: [
      "workspace=>.",
      "journal_path=>.codex-supervisor/issues/557/issue-journal.md",
      "local_review_summary_path=>none",
      "hasUncommittedChanges=>false",
    ],
    promotionHints: [
      {
        id: "stale-head-safety",
        summary: "tracked head differs from the current PR head",
      },
      {
        id: "retry-escalation",
        summary: "retry pressure is already visible via timeout_retry_count=1",
      },
    ],
  });
});

test("promotion summary helpers do not infer provider wait from a missing observation timestamp", () => {
  const sourceSnapshot = createSnapshot();

  sourceSnapshot.decision.nextState = "waiting_ci";
  sourceSnapshot.decision.shouldRunCodex = false;
  sourceSnapshot.local.record.timeout_retry_count = 0;
  sourceSnapshot.local.record.blocked_verification_retry_count = 0;
  sourceSnapshot.local.record.repeated_failure_signature_count = 0;
  sourceSnapshot.github.pullRequest!.currentHeadCiGreenAt = "2026-03-19T00:05:00Z";
  sourceSnapshot.github.checks = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  assert.deepEqual(deriveReplayCorpusPromotionWorthinessHints(sourceSnapshot).map((hint) => hint.id), []);
});
