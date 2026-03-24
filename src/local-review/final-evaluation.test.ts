import assert from "node:assert/strict";
import test from "node:test";
import { derivePreMergeFinalEvaluation } from "./final-evaluation";
import { type LocalReviewFinding } from "./types";

function createFinding(overrides: Partial<LocalReviewFinding> = {}): LocalReviewFinding {
  return {
    role: "reviewer",
    title: "Finding",
    body: "Finding body",
    file: "src/example.ts",
    start: 10,
    end: 12,
    severity: "medium",
    confidence: 0.9,
    category: "correctness",
    evidence: null,
    ...overrides,
  };
}

test("derivePreMergeFinalEvaluation classifies mergeable, follow-up, fix-blocked, and manual-review-blocked outcomes", () => {
  const mergeable = derivePreMergeFinalEvaluation({
    actionableFindings: [],
    verificationFindings: [],
    degraded: false,
  });
  assert.equal(mergeable.outcome, "mergeable");
  assert.equal(mergeable.residualFindings.length, 0);

  const followUpEligible = derivePreMergeFinalEvaluation({
    actionableFindings: [
      createFinding({
        title: "Medium follow-up",
        body: "This remains a follow-up candidate.",
        severity: "medium",
      }),
    ],
    verificationFindings: [],
    degraded: false,
  });
  assert.equal(followUpEligible.outcome, "follow_up_eligible");
  assert.equal(followUpEligible.followUpCount, 1);
  assert.equal(followUpEligible.residualFindings[0]?.resolution, "follow_up_candidate");

  const highSeverityFinding = createFinding({
    title: "Confirmed high severity finding",
    body: "This must block merge.",
    severity: "high",
    start: 30,
    end: 34,
  });
  const fixBlocked = derivePreMergeFinalEvaluation({
    actionableFindings: [highSeverityFinding],
    verificationFindings: [
      {
        findingKey: "src/example.ts|30|34|confirmed high severity finding|this must block merge.",
        verdict: "confirmed",
        rationale: "Confirmed.",
      },
    ],
    degraded: false,
  });
  assert.equal(fixBlocked.outcome, "fix_blocked");
  assert.equal(fixBlocked.mustFixCount, 1);
  assert.equal(fixBlocked.residualFindings[0]?.resolution, "must_fix");

  const manualReviewBlocked = derivePreMergeFinalEvaluation({
    actionableFindings: [
      createFinding({
        title: "Unverified high severity finding",
        body: "This still needs verification.",
        severity: "high",
        start: 40,
        end: 45,
      }),
    ],
    verificationFindings: [],
    degraded: false,
  });
  assert.equal(manualReviewBlocked.outcome, "manual_review_blocked");
  assert.equal(manualReviewBlocked.manualReviewCount, 1);
  assert.equal(manualReviewBlocked.residualFindings[0]?.resolution, "manual_review_required");
});
