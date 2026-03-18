import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRoleReview, runVerifierReview, type LocalReviewTurnRequest } from "./runner";
import {
  createConfig,
  createFakeLocalReviewRunner,
  createIssue,
  createMissPattern,
  createPullRequest,
} from "./test-helpers";

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

test("runVerifierReview routes verifier turns through the injected execution contract", async () => {
  const requests: LocalReviewTurnRequest[] = [];
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-verifier-runner-test-"));

  try {
    const result = await runVerifierReview({
      config: createConfig(),
      issue: createIssue({ number: 524, title: "Route verifier turns through a runner contract" }),
      branch: "codex/issue-524",
      workspacePath,
      defaultBranch: "main",
      pr: createPullRequest({ number: 89, headRefOid: "headsha524" }),
      findings: [
        {
          role: "reviewer",
          title: "Confirm the verifier seam",
          body: "Verifier turns should execute through the injected runner contract.",
          file: "src/local-review/runner.ts",
          start: 142,
          end: 168,
          severity: "high",
          confidence: 0.94,
          category: "correctness",
          evidence: "Direct verifier CLI invocation would bypass the shared runner-backed execution seam.",
        },
      ],
      executeTurn: async (request) => {
        requests.push(request);
        return {
          exitCode: 0,
          rawOutput: [
            "Verification summary: Runner-backed verifier result",
            "Recommendation: changes_requested",
            "REVIEW_VERIFIER_JSON_START",
            JSON.stringify({
              findings: [
                {
                  findingKey: "reviewer:src/local-review/runner.ts:142-168:Confirm the verifier seam",
                  verdict: "confirmed",
                  rationale: "The verifier contract executed through the injected runner abstraction.",
                },
              ],
            }),
            "REVIEW_VERIFIER_JSON_END",
          ].join("\n"),
        };
      },
    } as Parameters<typeof runVerifierReview>[0] & {
      executeTurn: (request: LocalReviewTurnRequest) => Promise<{ exitCode: number; rawOutput: string }>;
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.role, "verifier");
    assert.equal(requests[0]?.workspacePath, workspacePath);
    assert.equal(requests[0]?.outputFileName, "verifier.txt");
    assert.match(requests[0]?.prompt ?? "", /Route verifier turns through a runner contract/);
    assert.match(requests[0]?.prompt ?? "", /Confirm the verifier seam/);

    assert.deepEqual(result, {
      role: "verifier",
      summary: "Runner-backed verifier result",
      recommendation: "changes_requested",
      findings: [
        {
          findingKey: "reviewer:src/local-review/runner.ts:142-168:Confirm the verifier seam",
          verdict: "confirmed",
          rationale: "The verifier contract executed through the injected runner abstraction.",
        },
      ],
      rawOutput: [
        "Verification summary: Runner-backed verifier result",
        "Recommendation: changes_requested",
        "REVIEW_VERIFIER_JSON_START",
        JSON.stringify({
          findings: [
            {
              findingKey: "reviewer:src/local-review/runner.ts:142-168:Confirm the verifier seam",
              verdict: "confirmed",
              rationale: "The verifier contract executed through the injected runner abstraction.",
            },
          ],
        }),
        "REVIEW_VERIFIER_JSON_END",
      ].join("\n"),
      exitCode: 0,
      degraded: false,
      verifierGuardrails: [],
    });
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
});

test("runRoleReview accepts empty fake-runner output as a configured result", async () => {
  const fakeRunner = createFakeLocalReviewRunner({
    reviewer: "",
  });

  const result = await runRoleReview({
    config: createConfig(),
    issue: createIssue({ number: 525, title: "Allow empty fake runner output" }),
    branch: "codex/issue-525",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest({ number: 90, headRefOid: "headsha525" }),
    role: "reviewer",
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    executeTurn: fakeRunner.executeTurn,
  });

  assert.deepEqual(fakeRunner.requests.map((request) => request.role), ["reviewer"]);
  assert.equal(result.rawOutput, "");
  assert.equal(result.summary, "reviewer review completed without a structured summary.");
  assert.equal(result.recommendation, "unknown");
  assert.deepEqual(result.findings, []);
});
