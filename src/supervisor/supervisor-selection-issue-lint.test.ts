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
    labels: [],
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

test("buildIssueLintDto treats standalone codex issues with explicit scheduling metadata as execution-ready", async () => {
  const issue = createIssue({
    number: 604,
    title: "Ship standalone codex issue",
    labels: [{ name: "codex" }],
    body: `## Summary
Preserve codex issue-lint behavior for standalone work.

## Scope
- keep standalone codex issues execution-ready without a parent epic
- require explicit scheduling metadata

## Acceptance criteria
- standalone codex issues remain runnable with explicit scheduling metadata

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts

Depends on: none
Execution order: 1 of 1
Parallelizable: No`,
  });

  const dto = await buildIssueLintDto(
    {
      getIssue: async () => issue,
    },
    issue.number,
  );

  assert.deepEqual(dto, {
    issueNumber: 604,
    title: "Ship standalone codex issue",
    executionReady: true,
    missingRequired: [],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [],
  });
});

test("buildIssueLintDto requires parent metadata for sequenced codex child issues", async () => {
  const issue = createIssue({
    number: 605,
    title: "Run sequenced codex child issue",
    labels: [{ name: "codex" }],
    body: `## Summary
Require explicit parent metadata before a sequenced codex issue can run.

## Scope
- block sequenced codex issues without a parent epic
- keep the missing field diagnostic explicit

## Acceptance criteria
- sequenced codex child issues are not execution-ready without Part of

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts

Depends on: none
Execution order: 2 of 3
Parallelizable: No`,
  });

  const dto = await buildIssueLintDto(
    {
      getIssue: async () => issue,
    },
    issue.number,
  );

  assert.deepEqual(dto, {
    issueNumber: 605,
    title: "Run sequenced codex child issue",
    executionReady: false,
    missingRequired: ["part of"],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [
      "Add `Part of: #<number>` when this sequenced codex issue belongs to a parent epic or tracking issue.",
    ],
  });
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

test("buildIssueLintDto reports duplicate scheduling metadata as invalid", async () => {
  const issue = createIssue({
    number: 606,
    title: "Reject conflicting scheduling metadata",
    labels: [{ name: "codex" }],
    body: `## Summary
Reject duplicated scheduling declarations instead of accepting the first match.

## Scope
- keep reviewer-facing diagnostics explicit
- reject duplicate scheduling metadata

## Acceptance criteria
- issue lint reports duplicate declarations as invalid metadata

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts

Depends on: none
Depends on: #601
Execution order: 1 of 1
Execution order: 2 of 2
Parallelizable: No
Parallelizable: Yes`,
  });

  const dto = await buildIssueLintDto(
    {
      getIssue: async () => issue,
    },
    issue.number,
  );

  assert.deepEqual(dto, {
    issueNumber: 606,
    title: "Reject conflicting scheduling metadata",
    executionReady: false,
    missingRequired: ["depends on", "parallelizable", "execution order"],
    missingRecommended: [],
    metadataErrors: [
      "depends on must appear exactly once",
      "execution order must appear exactly once",
      "parallelizable must appear exactly once",
    ],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [
      "Add `Depends on: none` if nothing blocks this issue, or list blocking issues as `Depends on: #123, #456`.",
      "Add `Parallelizable: No` unless this issue is explicitly safe to run alongside related work.",
      "Add `Execution order: 1 of 1` if this issue stands alone, or `Execution order: N of M` for a sequenced series.",
      "Replace invalid scheduling metadata with valid `Part of: #<number>`, `Depends on: none|#<number>`, `Execution order: N of M`, and `Parallelizable: Yes|No` lines.",
    ],
  });
});
