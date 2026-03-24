import assert from "node:assert/strict";
import test from "node:test";
import { createPostMergeAuditResult, renderPostMergeAuditContractSummary } from "./post-merge-audit";
import {
  type PostMergeAuditPromotionCandidate,
  type PostMergeAuditRecurringPatternSummary,
} from "./types";

test("createPostMergeAuditResult keeps post-merge learning outcomes explicitly non-gating", () => {
  const recurringPatterns: PostMergeAuditRecurringPatternSummary[] = [
    {
      key: "retry-context-staleness",
      summary: "Repair attempts reused stale review context after the head changed.",
      category: "correctness",
      severity: "medium",
      evidenceCount: 2,
      sourceCount: 1,
      exampleFindingKeys: ["src/supervisor.ts|210|214|retry path|stale context"],
    },
  ];
  const promotionCandidates: PostMergeAuditPromotionCandidate[] = [
    {
      key: "guardrail-retry-context-refresh",
      kind: "guardrail",
      title: "Refresh retry context after head changes",
      summary: "Promote a durable guardrail that invalidates repair context on head changes.",
      rationale: "The same miss recurred after merge and should inform future prevention.",
      sourcePatternKeys: ["retry-context-staleness"],
      autoPromote: false,
      autoCreateFollowUpIssue: false,
    },
  ];

  const result = createPostMergeAuditResult({
    recurringPatterns,
    promotionCandidates,
  });

  assert.equal(result.outcome, "promotion_candidates_identified");
  assert.equal(result.gating, "non_gating");
  assert.equal(result.mergeBehavior, "unchanged");
  assert.equal(result.issueCompletionBehavior, "unchanged");
  assert.equal(result.followUpIssueCreation, "separate_contract");
  assert.deepEqual(result.recurringPatterns, recurringPatterns);
  assert.deepEqual(result.promotionCandidates, promotionCandidates);
});

test("renderPostMergeAuditContractSummary documents the advisory contract", () => {
  const summary = renderPostMergeAuditContractSummary(
    createPostMergeAuditResult({
      recurringPatterns: [],
      promotionCandidates: [],
    }),
  );

  assert.match(summary, /Outcome: no_action/i);
  assert.match(summary, /Gating: non-gating/i);
  assert.match(summary, /Merge behavior: unchanged/i);
  assert.match(summary, /Issue completion: unchanged/i);
  assert.match(summary, /Follow-up issue creation: separate contract/i);
});
