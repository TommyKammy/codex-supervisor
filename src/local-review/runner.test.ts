import assert from "node:assert/strict";
import test from "node:test";
import { runRoleReview, type LocalReviewTurnRequest } from "./runner";
import { createConfig, createIssue, createMissPattern, createPullRequest } from "./test-helpers";

test("runRoleReview routes reviewer turns through the injected execution contract", async () => {
  const requests: LocalReviewTurnRequest[] = [];

  const result = await runRoleReview({
    config: createConfig(),
    issue: createIssue({ number: 523, title: "Route reviewer turns through a runner contract" }),
    branch: "codex/issue-523",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest({ number: 88, headRefOid: "headsha523" }),
    role: "reviewer",
    alwaysReadFiles: ["/tmp/repo/.codex-supervisor/issue-journal.md"],
    onDemandFiles: ["/tmp/repo/README.md"],
    priorMissPatterns: [createMissPattern()],
    executeTurn: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        rawOutput: [
          "Review summary: Runner-backed reviewer result",
          "Recommendation: changes_requested",
          "REVIEW_FINDINGS_JSON_START",
          JSON.stringify({
            findings: [
              {
                title: "Guard the runner seam",
                body: "Reviewer turns should execute through the injected runner contract.",
                file: "src/local-review/runner.ts",
                start: 12,
                end: 34,
                severity: "high",
                confidence: 0.92,
                category: "correctness",
                evidence: "Direct CLI construction here would bypass the injected runner seam.",
              },
            ],
          }),
          "REVIEW_FINDINGS_JSON_END",
        ].join("\n"),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.role, "reviewer");
  assert.equal(requests[0]?.workspacePath, "/tmp/repo");
  assert.equal(requests[0]?.outputFileName, "reviewer.txt");
  assert.match(requests[0]?.prompt ?? "", /Route reviewer turns through a runner contract/);
  assert.match(requests[0]?.prompt ?? "", /Relevant prior confirmed external misses for this diff/);

  assert.deepEqual(result, {
    role: "reviewer",
    summary: "Runner-backed reviewer result",
    recommendation: "changes_requested",
    findings: [
      {
        role: "reviewer",
        title: "Guard the runner seam",
        body: "Reviewer turns should execute through the injected runner contract.",
        file: "src/local-review/runner.ts",
        start: 12,
        end: 34,
        severity: "high",
        confidence: 0.92,
        category: "correctness",
        evidence: "Direct CLI construction here would bypass the injected runner seam.",
      },
    ],
    rawOutput: [
      "Review summary: Runner-backed reviewer result",
      "Recommendation: changes_requested",
      "REVIEW_FINDINGS_JSON_START",
      JSON.stringify({
        findings: [
          {
            title: "Guard the runner seam",
            body: "Reviewer turns should execute through the injected runner contract.",
            file: "src/local-review/runner.ts",
            start: 12,
            end: 34,
            severity: "high",
            confidence: 0.92,
            category: "correctness",
            evidence: "Direct CLI construction here would bypass the injected runner seam.",
          },
        ],
      }),
      "REVIEW_FINDINGS_JSON_END",
    ].join("\n"),
    exitCode: 0,
    degraded: false,
  });
});
