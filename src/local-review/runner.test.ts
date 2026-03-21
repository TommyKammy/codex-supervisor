import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodexReviewTurn, runRoleReview, runVerifierReview, type LocalReviewTurnRequest } from "./runner";
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

test("runRoleReview routes docs researcher turns through the generic local-review execution target", async () => {
  const requests: LocalReviewTurnRequest[] = [];

  await runRoleReview({
    config: createConfig(),
    issue: createIssue({ number: 526, title: "Route docs researcher turns through generic local review" }),
    branch: "codex/issue-526",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest({ number: 91, headRefOid: "headsha526" }),
    role: "docs_researcher",
    detectedRoles: [
      {
        role: "docs_researcher",
        reasons: [{ kind: "repo_signal", signal: "docs", paths: ["README.md"] }],
      },
    ],
    alwaysReadFiles: [],
    onDemandFiles: ["/tmp/repo/README.md"],
    priorMissPatterns: [],
    executeTurn: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        rawOutput: [
          "Review summary: Docs researcher ran",
          "Recommendation: ready",
          "REVIEW_FINDINGS_JSON_START",
          JSON.stringify({ findings: [] }),
          "REVIEW_FINDINGS_JSON_END",
        ].join("\n"),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.role, "docs_researcher");
  assert.equal(requests[0]?.executionTarget, "local_review_generic");
});

test("runRoleReview keeps specialist local-review turns on the specialist execution target", async () => {
  const requests: LocalReviewTurnRequest[] = [];

  await runRoleReview({
    config: createConfig(),
    issue: createIssue({ number: 527, title: "Keep specialist turns on the specialist target" }),
    branch: "codex/issue-527",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest({ number: 92, headRefOid: "headsha527" }),
    role: "prisma_postgres_reviewer",
    detectedRoles: [
      {
        role: "prisma_postgres_reviewer",
        reasons: [{ kind: "repo_signal", signal: "prisma", paths: ["prisma/schema.prisma"] }],
      },
    ],
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    executeTurn: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        rawOutput: [
          "Review summary: Specialist reviewer ran",
          "Recommendation: ready",
          "REVIEW_FINDINGS_JSON_START",
          JSON.stringify({ findings: [] }),
          "REVIEW_FINDINGS_JSON_END",
        ].join("\n"),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.role, "prisma_postgres_reviewer");
  assert.equal(requests[0]?.executionTarget, "local_review_specialist");
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

test("runCodexReviewTurn omits bypass flags when execution safety mode is operator gated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-runner-test-"));
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex.sh");
  const argsPath = path.join(root, "args.log");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(
    codexBinary,
    `#!/bin/sh
set -eu
printf '%s\n' "$@" > "${argsPath}"
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat <<'EOF' > "$out"
Review summary: Operator gated local review ran
Recommendation: ready
REVIEW_FINDINGS_JSON_START
{"findings":[]}
REVIEW_FINDINGS_JSON_END
EOF
exit 0
`,
    "utf8",
  );
  await fs.chmod(codexBinary, 0o755);

  const result = await runCodexReviewTurn({
    config: createConfig({
      codexBinary,
      executionSafetyMode: "operator_gated",
    }),
    workspacePath,
    role: "reviewer",
    outputFileName: "reviewer.txt",
    prompt: "operator gated local review prompt",
    executionTarget: "local_review_generic",
  });
  const args = (await fs.readFile(argsPath, "utf8")).trim().split("\n");

  assert.equal(result.exitCode, 0);
  assert.match(result.rawOutput, /Operator gated local review ran/);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.deepEqual(args.slice(0, 5), [
    "exec",
    "-c",
    'model_reasoning_effort="low"',
    "--json",
    "-C",
  ]);
  assert.equal(args[5], workspacePath);
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
