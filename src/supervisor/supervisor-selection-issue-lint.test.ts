import assert from "node:assert/strict";
import test from "node:test";
import { GitHubIssue } from "../core/types";
import { buildIssueLintDto, renderIssueLintDto } from "./supervisor-selection-issue-lint";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 602,
    title: "Extract issue lint diagnostics",
    body: "## Summary\nPreserve issue-lint behavior during helper extraction.\n",
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/602",
    state: "OPEN",
    ...overrides,
  };
}

test("buildIssueLintDto keeps clean issue-lint output stable", async () => {
  const issue = createIssue({
    body: `## Summary
Preserve issue-lint behavior during helper extraction.

## Scope
- move issue-lint diagnostics into a dedicated helper module

## Acceptance criteria
- helper output remains unchanged

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts

Part of: #600
Depends on: #601
Execution order: 2 of 5
Parallelizable: No`,
  });

  const dto = await buildIssueLintDto(
    {
      getIssue: async () => issue,
    },
    issue.number,
  );

  assert.deepEqual(dto, {
    issueNumber: 602,
    title: "Extract issue lint diagnostics",
    executionReady: true,
    missingRequired: [],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [],
  });
  assert.equal(
    renderIssueLintDto(dto),
    [
      "issue=#602",
      "title=Extract issue lint diagnostics",
      "execution_ready=yes",
      "missing_required=none",
      "missing_recommended=none",
      "metadata_errors=none",
      "high_risk_blocking_ambiguity=none",
    ].join("\n"),
  );
});

test("buildIssueLintDto keeps repair guidance ordering stable", async () => {
  const issue = createIssue({
    number: 603,
    title: "Clarify auth rollout",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

Part of: #603
Depends on: #603, #604, #604, blocked by #oops
Execution order: 4 of 3
Parallelizable: Later`,
  });

  const dto = await buildIssueLintDto(
    {
      getIssue: async () => issue,
    },
    issue.number,
  );

  assert.deepEqual(dto, {
    issueNumber: 603,
    title: "Clarify auth rollout",
    executionReady: false,
    missingRequired: ["scope", "acceptance criteria", "verification"],
    missingRecommended: [],
    metadataErrors: [
      "part of references the issue itself",
      "depends on contains malformed references: #oops",
      "depends on references the issue itself",
      "depends on repeats #604",
      "execution order must be N of M with 1 <= N <= M",
      "parallelizable must be Yes or No",
    ],
    highRiskBlockingAmbiguity: "high-risk blocking ambiguity (unresolved_choice) for auth changes",
    repairGuidance: [
      "Add a `## Scope` section with bullet points describing the in-scope work.",
      "Add a `## Acceptance criteria` section listing the observable completion checks.",
      "Add a `## Verification` section with the exact command, test file, or manual check to run.",
      "Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Execution order: N of M`, and `Parallelizable: Yes|No` lines.",
      "Rewrite the issue to pick one auth path, remove the unresolved choice, and state the approved outcome explicitly.",
    ],
  });
  assert.equal(
    renderIssueLintDto(dto),
    [
      "issue=#603",
      "title=Clarify auth rollout",
      "execution_ready=no",
      "missing_required=scope, acceptance criteria, verification",
      "missing_recommended=none",
      "metadata_errors=part of references the issue itself; depends on contains malformed references: #oops; depends on references the issue itself; depends on repeats #604; execution order must be N of M with 1 <= N <= M; parallelizable must be Yes or No",
      "high_risk_blocking_ambiguity=high-risk blocking ambiguity (unresolved_choice) for auth changes",
      "repair_guidance_1=Add a `## Scope` section with bullet points describing the in-scope work.",
      "repair_guidance_2=Add a `## Acceptance criteria` section listing the observable completion checks.",
      "repair_guidance_3=Add a `## Verification` section with the exact command, test file, or manual check to run.",
      "repair_guidance_4=Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Execution order: N of M`, and `Parallelizable: Yes|No` lines.",
      "repair_guidance_5=Rewrite the issue to pick one auth path, remove the unresolved choice, and state the approved outcome explicitly.",
    ].join("\n"),
  );
});
