import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodexReviewTurn, runRoleReview, runVerifierReview, type LocalReviewTurnRequest } from "./runner";
import { type LocalReviewExecutionRouting } from "./types";
import {
  createConfig,
  createFakeLocalReviewRunner,
  createIssue,
  createMissPattern,
  createPullRequest,
} from "./test-helpers";

function routingForRequest(
  request: LocalReviewTurnRequest,
  model: string | null = null,
  reasoningEffort: LocalReviewExecutionRouting["reasoningEffort"] = null,
): LocalReviewExecutionRouting {
  return {
    target: request.executionTarget,
    model,
    reasoningEffort,
  };
}

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
        routing: routingForRequest(request, "reviewer-turn-model", "xhigh"),
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
    routing: {
      target: "local_review_generic",
      model: "reviewer-turn-model",
      reasoningEffort: "xhigh",
    },
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
        routing: routingForRequest(request),
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
        routing: routingForRequest(request),
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
          routing: routingForRequest(request, "verifier-turn-model", "max"),
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
      routing: {
        target: "local_review_verifier",
        model: "verifier-turn-model",
        reasoningEffort: "max",
      },
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
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '{"models":[{"slug":"gpt-5.6-luna","supported_reasoning_levels":["low"]}]}'
  exit 0
fi
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
      codexModelRoutingByTarget: {
        local_review_generic: { strategy: "fixed", model: "gpt-5.6-luna" },
      },
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
  assert.deepEqual(result.routing, {
    target: "local_review_generic",
    model: "gpt-5.6-luna",
    modelStrategy: "fixed",
    requestedModel: "gpt-5.6-luna",
    effectiveModel: "gpt-5.6-luna",
    modelRouteSource: "per_target_override",
    modelFallbackSource: null,
    modelCapabilitySource: "live_catalog",
    modelCapabilityFallbackReason: null,
    reasoningEffort: "low",
    requestedReasoningEffort: "low",
    reasoningEffortFallbackReason: null,
  });
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.deepEqual(args.slice(0, 7), [
    "exec",
    "-m",
    "gpt-5.6-luna",
    "-c",
    'model_reasoning_effort="low"',
    "--json",
    "-C",
  ]);
  assert.equal(args[7], workspacePath);
});

test("runCodexReviewTurn emits max reasoning for GPT-5.6 Sol", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-runner-test-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex.sh");
  const argsPath = path.join(root, "args.log");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(
    codexBinary,
    `#!/bin/sh
set -eu
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '{"models":[{"slug":"gpt-5.6-sol","supported_reasoning_levels":["high","max"]}]}'
  exit 0
fi
printf '%s\n' "$@" > "${argsPath}"
exit 0
`,
    "utf8",
  );
  await fs.chmod(codexBinary, 0o755);

  const result = await runCodexReviewTurn({
    config: createConfig({
      codexBinary,
      codexModelStrategy: "fixed",
      codexModel: "legacy-supervisor-model",
      codexModelRoutingByTarget: {
        local_review_generic: { strategy: "alias", model: "gpt-5.6-sol" },
      },
      codexReasoningEffortByState: { local_review: "max" },
    }),
    workspacePath,
    role: "reviewer",
    outputFileName: "reviewer.txt",
    prompt: "max local review prompt",
    executionTarget: "local_review_generic",
  });
  const args = (await fs.readFile(argsPath, "utf8")).trim().split("\n");

  assert.deepEqual(result.routing, {
    target: "local_review_generic",
    model: "gpt-5.6-sol",
    modelStrategy: "alias",
    requestedModel: "gpt-5.6-sol",
    effectiveModel: "gpt-5.6-sol",
    modelRouteSource: "per_target_override",
    modelFallbackSource: null,
    modelCapabilitySource: "live_catalog",
    modelCapabilityFallbackReason: null,
    reasoningEffort: "max",
    requestedReasoningEffort: "max",
    reasoningEffortFallbackReason: null,
  });

  assert.deepEqual(args.slice(0, 5), [
    "exec",
    "-m",
    "gpt-5.6-sol",
    "-c",
    'model_reasoning_effort="max"',
  ]);
});

test("runCodexReviewTurn blocks nested ultra delegation for every local-review target", async (t) => {
  const routeByTarget = {
    local_review_generic: { strategy: "alias" as const, model: "gpt-5.6-luna" },
    local_review_specialist: { strategy: "fixed" as const, model: "gpt-5.6-terra" },
    local_review_verifier: { strategy: "alias" as const, model: "gpt-5.6-sol" },
  };
  const targets = Object.keys(routeByTarget) as LocalReviewTurnRequest["executionTarget"][];

  for (const executionTarget of targets) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `local-review-runner-ultra-${executionTarget}-`));
    const workspacePath = path.join(root, "workspace");
    const codexBinary = path.join(root, "fake-codex.sh");
    const argsPath = path.join(root, "args.log");
    t.after(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(
      codexBinary,
      `#!/bin/sh
set -eu
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '{"models":[{"slug":"gpt-5.6-sol","supported_reasoning_levels":["high","xhigh","max","ultra"]},{"slug":"gpt-5.6-terra","supported_reasoning_levels":["high","xhigh","max","ultra"]},{"slug":"gpt-5.6-luna","supported_reasoning_levels":["high","xhigh","max","ultra"]}]}'
  exit 0
fi
printf '%s\n' "$@" > "${argsPath}"
exit 0
`,
      { mode: 0o755 },
    );

    const configuredRoute = routeByTarget[executionTarget];
    const result = await runCodexReviewTurn({
      config: createConfig({
        codexBinary,
        codexModelStrategy: "fixed",
        codexModel: "legacy-supervisor-model",
        localReviewModelStrategy: "alias",
        localReviewModel: "legacy-generic-model",
        codexModelRoutingByTarget: routeByTarget,
        codexReasoningEffortByState: { local_review: "ultra" },
      }),
      workspacePath,
      role: executionTarget,
      outputFileName: `${executionTarget}.txt`,
      prompt: `nested delegation guard for ${executionTarget}`,
      executionTarget,
    });
    const args = (await fs.readFile(argsPath, "utf8")).trim().split("\n");

    assert.deepEqual(result.routing, {
      target: executionTarget,
      model: configuredRoute.model,
      modelStrategy: configuredRoute.strategy,
      requestedModel: configuredRoute.model,
      effectiveModel: configuredRoute.model,
      modelRouteSource: "per_target_override",
      modelFallbackSource: null,
      modelCapabilitySource: "live_catalog",
      modelCapabilityFallbackReason: null,
      reasoningEffort: "max",
      requestedReasoningEffort: "ultra",
      reasoningEffortFallbackReason: "nested_delegation_blocked",
    });
    assert.equal(args.includes('model_reasoning_effort="ultra"'), false);
    assert.deepEqual(args.slice(0, 5), [
      "exec",
      "-m",
      configuredRoute.model,
      "-c",
      'model_reasoning_effort="max"',
    ]);
  }
});

test("runCodexReviewTurn reports target fallback when a live catalog omits the configured alias", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-runner-unknown-alias-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex.sh");
  const argsPath = path.join(root, "args.log");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(
    codexBinary,
    `#!/bin/sh
set -eu
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '{"models":[{"slug":"gpt-5.6-sol","supported_reasoning_levels":["high","xhigh","max"]}]}'
  exit 0
fi
printf '%s\n' "$@" > "${argsPath}"
exit 0
`,
    { mode: 0o755 },
  );

  const result = await runCodexReviewTurn({
    config: createConfig({
      codexBinary,
      codexModelRoutingByTarget: {
        local_review_verifier: { strategy: "alias", model: "unknown-review-tier" },
      },
      codexReasoningEffortByState: { local_review: "max" },
    }),
    workspacePath,
    role: "verifier",
    outputFileName: "verifier.txt",
    prompt: "unknown alias provenance",
    executionTarget: "local_review_verifier",
  });

  assert.equal(result.routing.effectiveModel, "unknown-review-tier");
  assert.equal(result.routing.modelCapabilitySource, "fallback");
  assert.equal(result.routing.modelCapabilityFallbackReason, "model_not_in_catalog");
  assert.equal(result.routing.reasoningEffort, "xhigh");
  assert.equal(result.routing.reasoningEffortFallbackReason, "unsupported_reasoning_effort");
});

test("runCodexReviewTurn returns the same routing used for a transient catalog fallback", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-runner-fallback-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex.sh");
  const argsPath = path.join(root, "args.log");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(
    codexBinary,
    `#!/bin/sh
set -eu
printf '%s\n' "$@" > "${argsPath}"
exit 0
`,
    "utf8",
  );
  await fs.chmod(codexBinary, 0o755);

  const result = await runCodexReviewTurn({
    config: createConfig({
      codexBinary,
      codexModelStrategy: "fixed",
      codexModel: "gpt-5.6-terra",
      localReviewModelStrategy: "inherit",
      codexReasoningEffortByState: { local_review: "max" },
    }),
    workspacePath,
    role: "reviewer",
    outputFileName: "reviewer.txt",
    prompt: "fallback local review prompt",
    executionTarget: "local_review_generic",
  });
  const args = (await fs.readFile(argsPath, "utf8")).trim().split("\n");

  assert.deepEqual(result.routing, {
    target: "local_review_generic",
    model: "gpt-5.6-terra",
    modelStrategy: "inherit",
    requestedModel: null,
    effectiveModel: "gpt-5.6-terra",
    modelRouteSource: "default_route",
    modelFallbackSource: "supervisor_config",
    modelCapabilitySource: "fallback",
    modelCapabilityFallbackReason: "malformed_catalog",
    reasoningEffort: "xhigh",
    requestedReasoningEffort: "max",
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });
  assert.deepEqual(args.slice(0, 5), [
    "exec",
    "-m",
    "gpt-5.6-terra",
    "-c",
    'model_reasoning_effort="xhigh"',
  ]);
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
