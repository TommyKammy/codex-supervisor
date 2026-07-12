import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  executeCodexTurnPhase,
  renderCodexExecutionSummary,
  unresolvedIndependentVerificationBlockerAfterTurnEvidence,
} from "./run-once-turn-execution";
import {
  FailureContextCategory,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorStateFile,
} from "./core/types";
import {
  createCodexTurnContext,
  createWorkspaceStatus,
} from "./orchestration-test-helpers";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";
import { AgentRunner, AgentTurnRequest } from "./supervisor/agent-runner";
import { stableSameFileCodexConnectorChurnDossierConsumptionPatch } from "./supervisor/supervisor-lifecycle";
import { interruptedTurnMarkerPath } from "./interrupted-turn-marker";
import type { GitHubClient } from "./github";
import { WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE } from "./workstation-local-path-gate";
import type { IndependentVerificationBlockerSnapshot } from "./supervisor/independent-verification-blocker";
import {
  codexTurnVerificationIncludesCommand,
  explicitFailedCodexTurnVerificationCommand,
  explicitPassingCodexTurnVerificationCommand,
  explicitSinglePassingCodexTurnVerificationCommand,
} from "./run-once-turn-verification-evidence";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;
const SAMPLE_MACOS_WORKSTATION_PATH = `/${"Users"}/alice/Dev/private-repo`;

test("renderCodexExecutionSummary preserves requested and effective reasoning provenance", () => {
  assert.equal(
    renderCodexExecutionSummary({
      supervisorMessage: "Summary: implemented the bounded ultra route.",
      routing: {
        target: "supervisor",
        model: "gpt-5.6-luna",
        modelStrategy: "alias",
        requestedModel: "gpt-5.6-luna",
        effectiveModel: "gpt-5.6-luna",
        modelRouteSource: "per_target_override",
        modelFallbackSource: null,
        modelCapabilitySource: "live_catalog",
        modelCapabilityFallbackReason: null,
        requestedReasoningEffort: "ultra",
        reasoningEffort: "max",
        reasoningEffortFallbackReason: "unsupported_reasoning_effort",
      },
    }),
    [
      "codex_execution_routing target=supervisor model=gpt-5.6-luna requested_model=gpt-5.6-luna effective_model=gpt-5.6-luna model_route_source=per_target_override model_fallback_source=none model_capability_source=live_catalog model_capability_fallback_reason=none requested_reasoning=ultra effective_reasoning=max reasoning_fallback_reason=unsupported_reasoning_effort",
      "Summary: implemented the bounded ultra route.",
    ].join("\n\n"),
  );
  assert.equal(
    renderCodexExecutionSummary({ supervisorMessage: "Legacy runner summary." }),
    "Legacy runner summary.",
  );
});

test("failed structured verification retains a command identity that later passing evidence can match", () => {
  const failedCommand = explicitFailedCodexTurnVerificationCommand(
    "npm run verify:images; failed",
  );
  assert.equal(failedCommand, "npm run verify:images");
  assert.equal(
    codexTurnVerificationIncludesCommand(
      "npm run verify:images",
      failedCommand,
    ),
    true,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand(
      "npm run verify:images; failed\nnpm test; passed",
    ),
    "npm run verify:images",
  );
  const selectorCommand = explicitFailedCodexTurnVerificationCommand(
    "pytest -k failed: failed",
  );
  assert.equal(selectorCommand, "pytest -k failed");
  assert.equal(
    codexTurnVerificationIncludesCommand(
      "pytest -k passed: passed",
      selectorCommand,
    ),
    false,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npm run verify:images failed"),
    "npm run verify:images",
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npm test failed"),
    "npm test",
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("pytest -k failed"),
    null,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("pytest -k smoke failed"),
    null,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npx vitest failed"),
    null,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npm run failed"),
    null,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npm test -- failed"),
    null,
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand("npx vitest failed: failed"),
    "npx vitest failed",
  );
  assert.equal(
    explicitPassingCodexTurnVerificationCommand("npx vitest passed"),
    null,
  );
  assert.equal(
    explicitPassingCodexTurnVerificationCommand("npm test passed"),
    "npm test",
  );
  assert.equal(
    explicitPassingCodexTurnVerificationCommand(
      "npm run verify:images passed; npm test failed",
    ),
    "npm run verify:images",
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "npm run verify:images",
    ),
    "npm run verify:images",
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "npm run verify:images; passed",
    ),
    "npm run verify:images",
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand("passed"),
    null,
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "npm run verify:images passed; npm test failed",
    ),
    null,
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "npm run verify:images; ambiguous",
    ),
    null,
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "npm run verify:images; npm test",
    ),
    null,
  );
});

test("passing verification evidence is command-scoped and failed outcomes dominate equivalent passes", () => {
  const cases: Array<{
    name: string;
    evidence: string;
    expected: string | null;
  }> = [
    {
      name: "same inline command passes then fails",
      evidence: "npm test: passed; npm test: failed",
      expected: null,
    },
    {
      name: "same inline command fails then passes",
      evidence: "npm test: failed; npm test: passed",
      expected: null,
    },
    {
      name: "rtk wrapper and outcome delimiter variants still identify one command",
      evidence: "rtk npm test (passed); npm test — failed",
      expected: null,
    },
    {
      name: "adjacent outcome entries still give failure precedence",
      evidence: "$ npm test; passed; rtk npm test; failure",
      expected: null,
    },
    {
      name: "space-separated outcome variants still give failure precedence",
      evidence: "npm run verify:images passed; rtk npm run verify:images failed",
      expected: null,
    },
    {
      name: "a skipped result conflicts with a pass for the same command",
      evidence: "npm run verify:images passed; npm run verify:images skipped",
      expected: null,
    },
    {
      name: "a not-run result conflicts with a pass for the same command",
      evidence: "npm run verify:images: passed; npm run verify:images: not run",
      expected: null,
    },
    {
      name: "an adjacent skipped result conflicts with an adjacent pass",
      evidence: "$ npm test; passed; rtk npm test; skipped",
      expected: null,
    },
    {
      name: "a failed command does not suppress a different passing command",
      evidence: "npm run verify:images failed; npm test passed",
      expected: "npm test",
    },
    {
      name: "an independent pass survives alongside a conflicting command",
      evidence: "npm test passed; rtk npm test failed; npm run verify:images passed",
      expected: "npm run verify:images",
    },
    {
      name: "equivalent passing variants are de-duplicated",
      evidence: "rtk npm test: passed; npm test: passed",
      expected: "rtk npm test",
    },
  ];

  for (const fixture of cases) {
    assert.equal(
      explicitPassingCodexTurnVerificationCommand(fixture.evidence),
      fixture.expected,
      fixture.name,
    );
  }

  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "rtk npm run verify:images",
    ),
    "rtk npm run verify:images",
    "a commandless carried blocker can still be cleared by one unambiguous pass",
  );
  assert.equal(
    explicitSinglePassingCodexTurnVerificationCommand(
      "rtk npm run verify:images: passed; npm run verify:images: failed",
    ),
    null,
    "mixed outcomes are never accepted as a single passing command",
  );
  assert.equal(
    codexTurnVerificationIncludesCommand(
      "npm run verify:images",
      "npm run verify:images; failed",
    ),
    true,
    "legacy adjacent failure outcomes are stripped before command matching",
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand(
      "npm run verify:images; skipped",
    ),
    "npm run verify:images",
    "skipped verifier outcomes retain their command identity",
  );
  assert.equal(
    explicitFailedCodexTurnVerificationCommand(
      "npm run verify:images\nnot run",
    ),
    "npm run verify:images",
    "not-run verifier outcomes retain their command identity",
  );
});

test("matching turn evidence permanently resolves only the carried verifier command", () => {
  const blocker: IndependentVerificationBlockerSnapshot = {
    lastError: "Independent image verification remains blocked.",
    lastBlockerSignature: "verification:images",
    lastFailureContext: {
      category: "blocked",
      summary: "Independent image verification remains blocked.",
      signature: "verification:images",
      command: "npm run verify:images",
      details: ["structured_blocked_reason=verification"],
      url: null,
      updated_at: "2026-07-12T00:00:00Z",
    },
    lastFailureSignature: "verification:images",
    repeatedFailureSignatureCount: 3,
    repeatedBlockerCount: 2,
    blockedVerificationRetryCount: 1,
  };

  assert.equal(
    unresolvedIndependentVerificationBlockerAfterTurnEvidence(
      blocker,
      "npm run verify:images passed; npm test failed",
    ),
    null,
  );
  assert.equal(
    unresolvedIndependentVerificationBlockerAfterTurnEvidence(
      blocker,
      "npm test passed; npm run verify:images failed",
    ),
    blocker,
  );
  assert.equal(
    unresolvedIndependentVerificationBlockerAfterTurnEvidence(
      null,
      "not run",
    ),
    null,
    "a later same-turn retry cannot resurrect a verifier that already passed",
  );
});

test("run-once turn execution does not import Decision Kernel v2 action decisions", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src", "run-once-turn-execution.ts"), "utf8");

  assert.doesNotMatch(source, /decision-kernel-v2/u);
  assert.doesNotMatch(source, /evaluateDecisionKernelV2/u);
  assert.doesNotMatch(source, /buildDecisionKernelV2ExplainDto/u);
  assert.doesNotMatch(source, /pr_lifecycle_action_taking/u);
  assert.doesNotMatch(source, /prLifecycleEvaluationModeForRuntime/u);
  assert.doesNotMatch(source, /external_orchestration_handoff/u);
  assert.doesNotMatch(source, /external_handoff/u);
  assert.doesNotMatch(source, /mutation_authority/u);
  assert.doesNotMatch(source, /v2_routing/u);
  assert.doesNotMatch(source, /externalOrchestrationHandoff/u);
  assert.doesNotMatch(source, /routingCategory/u);
  assert.doesNotMatch(source, /mutationAuthority/u);
});

test("run-once turn execution keeps artifact-only repair paths across same-turn retries", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src", "run-once-turn-execution.ts"), "utf8");
  const accumulatorIndex = source.indexOf("let artifactOnlyChangedFilesAfterPublication: string[] = [];");
  const loopIndex = source.indexOf("while (true)");

  assert.ok(accumulatorIndex >= 0);
  assert.ok(loopIndex >= 0);
  assert.ok(accumulatorIndex < loopIndex);
  assert.match(source, /rememberArtifactOnlyChangedFilesAfterPublication\(\s*rewrittenTrackedPaths\s*,?\s*\)/u);
  assert.match(source, /rememberArtifactOnlyChangedFilesAfterPublication\(\s*publicationGate\.rewrittenTrackedPaths\s*,?\s*\)/u);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

test("executeCodexTurnPhase carries an independent verifier through a timeout persistence path", async () => {
  await withTempWorkspace("run-once-carried-verifier-timeout-", async (workspacePath) => {
    const issueNumber = 2447;
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(
      journalPath,
      "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair review feedback.\n",
      "utf8",
    );
    const failureContext = {
      category: "blocked" as const,
      summary: "Independent image verification remains blocked.",
      signature: "verification:images",
      command: "npm run verify:images",
      details: ["structured_blocked_reason=verification"],
      url: null,
      updated_at: "2026-07-12T00:00:00Z",
    };
    const record = createRecord({
      issue_number: issueNumber,
      state: "addressing_review",
      branch: `codex/issue-${issueNumber}`,
      workspace: workspacePath,
      journal_path: journalPath,
      pr_number: 2451,
      last_head_sha: "head-2451",
      blocked_reason: "verification",
      last_error: failureContext.summary,
      last_failure_context: failureContext,
      last_failure_signature: failureContext.signature,
      repeated_failure_signature_count: 3,
      last_blocker_signature: "verification:images",
      repeated_blocker_count: 2,
      blocked_verification_retry_count: 1,
      timeout_retry_count: 2,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: issueNumber,
      issues: { [String(issueNumber)]: record },
    };
    const issue = createIssue({ number: issueNumber });
    const pr = createPullRequest({
      number: 2451,
      headRefName: record.branch,
      headRefOid: "head-2451",
      state: "OPEN",
      mergedAt: null,
    });

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (current, patch) => ({
          ...current,
          ...patch,
          updated_at: "2026-07-12T00:05:00Z",
        }),
        save: async () => undefined,
      },
      github: {
        findOpenPullRequestsForBranch: async () => [pr],
        getPullRequestIfExists: async () => pr,
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => ({ reviews: [], issueComments: [] }),
      },
      context: createCodexTurnContext({
        state,
        record,
        issue,
        pr,
        workspacePath,
        journalPath,
        workspaceStatus: {
          branch: record.branch,
          headSha: "head-2451",
        },
      }),
      acquireSessionLock: async () => null,
      classifyFailure: () => "timeout",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-07-12T00:05:00Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: "superseding-timeout",
        repeated_failure_signature_count: 1,
      }),
      normalizeBlockerSignature: () => "timeout:review-repair",
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected lifecycle projection");
      },
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async ({ error }) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
      readIssueJournal: async () =>
        "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair review feedback.\n",
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 1,
        sessionId: "session-2447",
        supervisorMessage: "Review repair timed out before verification.",
        stderr: "Command timed out after 1800000ms: codex exec",
        stdout: "",
        structuredResult: {
          summary: "Review repair timed out.",
          stateHint: "failed",
          blockedReason: null,
          failureSignature: "timeout:review-repair",
          nextAction: "retry review repair",
          tests: "not run",
        },
        failureKind: "timeout",
        failureContext: null,
      })),
    });

    const updated = state.issues[String(issueNumber)]!;
    assert.equal(result.kind, "returned");
    assert.equal(updated.state, "blocked");
    assert.equal(updated.blocked_reason, "verification");
    assert.equal(updated.last_failure_context?.command, "npm run verify:images");
    assert.equal(updated.last_failure_signature, "verification:images");
    assert.equal(updated.repeated_failure_signature_count, 3);
    assert.equal(updated.last_blocker_signature, "verification:images");
    assert.equal(updated.repeated_blocker_count, 2);
    assert.equal(updated.blocked_verification_retry_count, 1);
    assert.equal(updated.timeout_retry_count, 3);
    assert.match(
      updated.last_failure_context?.details.join("\n") ?? "",
      /review_repair_interruption_detail=.*timed out/i,
    );
  });
});

test("executeCodexTurnPhase passes the pre-preparation verifier to unexpected recovery", async () => {
  const failureContext = {
    category: "blocked" as const,
    summary: "Independent image verification remains blocked.",
    signature: "verification:images",
    command: "npm run verify:images",
    details: ["structured_blocked_reason=verification"],
    url: null,
    updated_at: "2026-07-12T00:00:00Z",
  };
  const record = createRecord({
    issue_number: 2447,
    state: "addressing_review",
    pr_number: 2451,
    blocked_reason: "verification",
    last_error: failureContext.summary,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    last_blocker_signature: "verification:images",
    repeated_blocker_count: 2,
    blocked_verification_retry_count: 1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 2447,
    issues: { "2447": record },
  };
  let recoveredVerifier: IndependentVerificationBlockerSnapshot | null = null;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (current, patch) => ({ ...current, ...patch }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => ({ reviews: [], issueComments: [] }),
    },
    context: createCodexTurnContext({ state, record }),
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-07-12T00:05:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected lifecycle projection");
    },
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async (args) => {
      recoveredVerifier = args.independentVerificationBlocker ?? null;
      return args.record;
    },
    readIssueJournal: async () => {
      throw new Error("journal read exploded before prompt preparation");
    },
    agentRunner: createSuccessfulAgentRunner(async () => {
      throw new Error("unexpected runTurn call");
    }),
  });

  const recovered = recoveredVerifier as IndependentVerificationBlockerSnapshot | null;
  assert.ok(recovered);
  assert.equal(result.kind, "returned");
  assert.equal(recovered.lastFailureContext.command, "npm run verify:images");
  assert.equal(recovered.lastFailureSignature, "verification:images");
  assert.equal(recovered.repeatedFailureSignatureCount, 3);
  assert.equal(recovered.blockedVerificationRetryCount, 1);
});

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "run-once-turn-path-hygiene-"),
  );
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  git(repoPath, "init", "--bare", "origin.git");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  git(repoPath, "remote", "add", "origin", path.join(repoPath, "origin.git"));
  git(repoPath, "push", "-u", "origin", "main");
  return repoPath;
}

function createSuccessfulAgentRunner(
  impl: (request: AgentTurnRequest) => ReturnType<AgentRunner["runTurn"]>,
): AgentRunner {
  return {
    capabilities: {
      supportsResume: true,
      supportsStructuredResult: true,
    },
    runTurn: impl,
  };
}

async function withTempWorkspace<T>(
  prefix: string,
  run: (workspacePath: string) => Promise<T>,
): Promise<T> {
  const workspacePath = await fs.mkdtemp(path.join("/tmp", prefix));
  try {
    return await run(workspacePath);
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

test("executeCodexTurnPhase does not mark review threads processed for a refreshed PR head it did not evaluate", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Avoid attributing review processing to a refreshed head",
  });
  const initialPr: GitHubPullRequest = createPullRequest({
    title: "Address review threads",
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });
  const refreshedPr: GitHubPullRequest = {
    ...initialPr,
    headRefOid: "head-c",
  };
  const reviewThreads = [createReviewThread()];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        pr_number: 116,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      }),
    },
  };

  let journalReads = 0;
  let resolveCalls = 0;
  const resolvePurposes: Array<"status" | "action" | undefined> = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr: initialPr,
    checks: [],
    reviewThreads,
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-b",
    },
  });
  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async (_branch, _prNumber, options) => {
        resolveCalls += 1;
        resolvePurposes.push(options?.purpose);
        return resolveCalls === 1 ? refreshedPr : refreshedPr;
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "addressing_review",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => "manual_review",
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({ branch: "codex/issue-102", headSha: "head-b" }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: address the review thread on the current head.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: address the review thread on the current head.",
            "- What changed: reviewed the configured bot thread before the PR head changed again.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage:
        "Reviewed the configured bot thread on the current head.",
      stderr: "",
      stdout: "",
      structuredResult: null,
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.equal(state.issues["102"]?.last_head_sha, "head-b");
  assert.deepEqual(state.issues["102"]?.processed_review_thread_ids, [
    "thread-1@head-a",
  ]);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_fingerprints, [
    "thread-1@head-a#comment-1",
  ]);
  assert.deepEqual(resolvePurposes, ["action"]);
});

test("executeCodexTurnPhase persists explicit successful Codex verification for the current PR head", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Persist Codex verification evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    headRefOid: "head-verified",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: 116,
        last_head_sha: "head-verified",
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr,
    checks: [],
    reviewThreads: [],
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-verified",
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-verified",
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: Verified the remaining Codex Connector review fixes.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: npx tsx --test src/run-once-turn-execution.test.ts",
        "Failure signature: none",
        "Next action: open PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Verified the remaining Codex Connector review fixes.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "open PR",
        tests: "npx tsx --test src/run-once-turn-execution.test.ts",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist successful Codex verification.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist successful Codex verification.",
            "- What changed: implemented the current-head verification evidence.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.deepEqual(result.record.timeline_artifacts, [
    {
      type: "verification_result",
      gate: "codex_turn",
      command: "npx tsx --test src/run-once-turn-execution.test.ts",
      head_sha: "head-verified",
      outcome: "passed",
      remediation_target: null,
      next_action: "continue",
      summary: "Verified the remaining Codex Connector review fixes.",
      recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
    },
  ]);
});

test("executeCodexTurnPhase persists no-change current-head Codex thread and verification evidence after local review repair", async (t) => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const localReviewDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-no-change-"));
  t.after(async () => {
    await fs.rm(localReviewDir, { recursive: true, force: true });
  });
  const localReviewSummaryPath = path.join(localReviewDir, "head-7a77d998.md");
  const localReviewFindingsPath = path.join(localReviewDir, "head-7a77d998.json");
  await fs.writeFile(localReviewSummaryPath, "# Local Review\n", "utf8");
  await fs.writeFile(
    localReviewFindingsPath,
    `${JSON.stringify({
      issueNumber: 492,
      prNumber: 498,
      branch: "codex/issue-492",
      headSha: "7a77d998712882166f79c3710dd4c567da6da779",
      rootCauseSummaries: [
        {
          summary: "Focused verification covers the query workflow shell state.",
          severity: "medium",
          file: "src/query-shell.ts",
          start: 40,
          end: 40,
        },
        {
          summary: "Focused verification covers the query export flow.",
          severity: "medium",
          file: "src/query-export.ts",
          start: 72,
          end: 72,
        },
      ],
      actionableFindings: [
        {
          role: "codex_connector_reviewer",
          title: "Preserve query workflow shell state",
          body: "Focused verification covers the query workflow shell state.",
          file: "src/query-shell.ts",
          start: 40,
          end: 40,
          severity: "medium",
          confidence: 0.93,
          category: "review_thread",
          evidence: "PRRT_kwDOSHIe7c6HbSbo",
        },
        {
          role: "codex_connector_reviewer",
          title: "Keep query export flow covered",
          body: "Focused verification covers the query export flow.",
          file: "src/query-export.ts",
          start: 72,
          end: 72,
          severity: "medium",
          confidence: 0.93,
          category: "review_thread",
          evidence: "PRRT_kwDOSHIe7c6HbjhR",
        },
      ],
    })}\n`,
    "utf8",
  );
  const headSha = "7a77d998712882166f79c3710dd4c567da6da779";
  const issue: GitHubIssue = createIssue({
    title: "Persist verified no-change Codex thread evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    number: 498,
    headRefOid: headSha,
  });
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_kwDOSHIe7c6HbSbo",
      path: "src/query-shell.ts",
      line: 40,
      comments: {
        nodes: [
          {
            id: "comment-safequery-shell",
            body: "P2: Preserve query workflow shell state after the current-head revalidation.",
            createdAt: "2026-06-05T17:55:00Z",
            url: "https://example.test/pr/498#discussion_shell",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "PRRT_kwDOSHIe7c6HbjhR",
      path: "src/query-export.ts",
      line: 72,
      comments: {
        nodes: [
          {
            id: "comment-safequery-export",
            body: "P2: Keep query export flow covered by focused verification.",
            createdAt: "2026-06-05T17:55:01Z",
            url: "https://example.test/pr/498#discussion_export",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const latePostPromptReviewThread = createReviewThread({
    id: "PRRT_late_same_anchor",
    path: "src/query-shell.ts",
    line: 40,
    comments: {
      nodes: [
        {
          id: "comment-late-same-anchor",
          body: "P2: Newly posted same-anchor finding that was not in the Codex prompt.",
          createdAt: "2026-06-05T17:59:00Z",
          url: "https://example.test/pr/498#discussion_late_same_anchor",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const postRunReviewThreads = [...reviewThreads, latePostPromptReviewThread];
  const state: SupervisorStateFile = {
    activeIssueNumber: 492,
    issues: {
      "492": createRecord({
        issue_number: 492,
        state: "local_review_fix",
        pr_number: 498,
        last_head_sha: headSha,
        local_review_summary_path: localReviewSummaryPath,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "codex_turn",
            command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
            head_sha: headSha,
            outcome: "passed",
            remediation_target: null,
            next_action: "continue",
            summary: "Earlier source-changing repair verification passed on this head.",
            recorded_at: "2026-06-05T17:45:00Z",
          },
        ],
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["492"]!,
    issue,
    pr,
    checks: [],
    reviewThreads,
    workspaceStatus: {
      branch: "codex/issue-492",
      headSha,
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => postRunReviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary: `${category}:${summary}`,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-06-05T18:00:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (recordForState) => ({
      recordForState,
      nextState: "blocked",
      failureContext: {
        category: "review",
        summary: "Verified no-change Codex residue is still awaiting thread resolution.",
        signature: "unresolved-thread:PRRT_kwDOSHIe7c6HbSbo|PRRT_kwDOSHIe7c6HbjhR",
        command: null,
        details: [],
        url: "https://example.test/pr/498#discussion_shell",
        updated_at: "2026-06-05T18:00:00Z",
      },
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => "manual_review",
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-492",
        headSha,
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-492",
      supervisorMessage: [
        "Summary: Revalidated the current code against both live P2 threads with no source changes.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
        "Failure signature: none",
        "Next action: resolve verified Codex residue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Revalidated the current code against both live P2 threads with no source changes.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "resolve verified Codex residue",
        tests: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: no source change revalidation should persist Codex thread evidence.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: no source change revalidation should persist Codex thread evidence.",
            "- What changed: revalidated both current-head Codex P2 threads with focused tests and no source changes.",
            "- Next exact step: resolve verified Codex residue.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.deepEqual(state.issues["492"]?.processed_review_thread_ids, [
    `PRRT_kwDOSHIe7c6HbSbo@${headSha}`,
    `PRRT_kwDOSHIe7c6HbjhR@${headSha}`,
  ]);
  assert.deepEqual(state.issues["492"]?.processed_review_thread_fingerprints, [
    `PRRT_kwDOSHIe7c6HbSbo@${headSha}#comment-safequery-shell`,
    `PRRT_kwDOSHIe7c6HbjhR@${headSha}#comment-safequery-export`,
  ]);
  assert.deepEqual(state.issues["492"]?.timeline_artifacts, [
    {
      type: "verification_result",
      gate: "codex_turn",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      head_sha: headSha,
      outcome: "passed",
      remediation_target: null,
      next_action: "continue",
      summary: "Earlier source-changing repair verification passed on this head.",
      recorded_at: "2026-06-05T17:45:00Z",
    },
    {
      type: "verification_result",
      gate: "codex_turn",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      head_sha: headSha,
      outcome: "passed",
      remediation_target: null,
      next_action: "continue",
      summary: "Revalidated the current code against both live P2 threads with no source changes.",
      recorded_at: state.issues["492"]?.timeline_artifacts?.[1]?.recorded_at ?? "",
      repair_targets: [
        "verified_no_source_change_review_thread_residue",
        "verified_current_head_repair_review_thread_residue",
      ],
      processed_review_thread_ids: [
        `PRRT_kwDOSHIe7c6HbSbo@${headSha}`,
        `PRRT_kwDOSHIe7c6HbjhR@${headSha}`,
      ],
      processed_review_thread_fingerprints: [
        `PRRT_kwDOSHIe7c6HbSbo@${headSha}#comment-safequery-shell`,
        `PRRT_kwDOSHIe7c6HbjhR@${headSha}#comment-safequery-export`,
      ],
    },
  ]);
});

test("executeCodexTurnPhase does not persist no-change evidence after publication hygiene commits", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-492");
  await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "src", "query.ts"), "export const ready = true;\n", "utf8");
  git(workspacePath, "add", "src/query.ts");
  git(workspacePath, "commit", "-m", "add query workflow");
  git(workspacePath, "push", "-u", "origin", "codex/issue-492");
  const remoteHead = git(workspacePath, "rev-parse", "HEAD").trim();
  await fs.writeFile(
    path.join(workspacePath, "docs", "handoff.md"),
    `Path hygiene should rewrite ${SAMPLE_MACOS_WORKSTATION_PATH} before publication.\n`,
    "utf8",
  );
  git(workspacePath, "add", "docs/handoff.md");
  git(workspacePath, "commit", "-m", "add local handoff artifact");
  const turnStartHead = git(workspacePath, "rev-parse", "HEAD").trim();
  const localReviewDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-publication-"));
  t.after(async () => {
    await fs.rm(localReviewDir, { recursive: true, force: true });
  });
  const localReviewSummaryPath = path.join(localReviewDir, "head-publication.md");
  await fs.writeFile(localReviewSummaryPath, "# Local Review\n", "utf8");
  await fs.writeFile(
    path.join(localReviewDir, "head-publication.json"),
    `${JSON.stringify({
      issueNumber: 492,
      prNumber: 498,
      branch: "codex/issue-492",
      headSha: turnStartHead,
      rootCauseSummaries: [
        {
          summary: "Focused verification covers the query workflow thread.",
          severity: "medium",
          file: "src/query.ts",
          start: 1,
          end: 1,
        },
      ],
      actionableFindings: [
        {
          role: "codex_connector_reviewer",
          title: "Keep query workflow covered",
          body: "Focused verification covers the query workflow thread.",
          file: "src/query.ts",
          start: 1,
          end: 1,
          severity: "medium",
          confidence: 0.93,
          category: "review_thread",
          evidence: "PRRT_publication_hygiene",
        },
      ],
    })}\n`,
    "utf8",
  );

  const issue = createIssue({
    number: 492,
    title: "Do not persist after publication hygiene commits",
  });
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_publication_hygiene",
      path: "src/query.ts",
      line: 1,
      comments: {
        nodes: [
          {
            id: "comment-publication-hygiene",
            body: "P2: Keep query workflow covered by focused verification.",
            createdAt: "2026-06-05T17:55:00Z",
            url: "https://example.test/pr/498#discussion_publication_hygiene",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 492,
    issues: {
      "492": createRecord({
        issue_number: 492,
        state: "local_review_fix",
        branch: "codex/issue-492",
        workspace: workspacePath,
        pr_number: 498,
        last_head_sha: turnStartHead,
        local_review_summary_path: localReviewSummaryPath,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["492"]!,
    issue,
    workspacePath,
    pr: createPullRequest({
      number: 498,
      headRefName: "codex/issue-492",
      headRefOid: remoteHead,
    }),
    checks: [],
    reviewThreads,
    workspaceStatus: {
      branch: "codex/issue-492",
      headSha: turnStartHead,
      baseAhead: 2,
      remoteBranchExists: true,
      remoteAhead: 1,
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () =>
        createPullRequest({
          number: 498,
          headRefName: "codex/issue-492",
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        }),
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary: `${category}:${summary}`,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-06-05T18:00:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (recordForState) => ({
      recordForState,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => {
      const currentHead = git(workspacePath, "rev-parse", "HEAD").trim();
      return createWorkspaceStatus({
        branch: "codex/issue-492",
        headSha: currentHead,
        baseAhead: currentHead === turnStartHead ? 2 : 3,
        remoteBranchExists: true,
        remoteAhead: currentHead === turnStartHead ? 1 : 0,
      });
    },
    runWorkstationLocalPathGate: async () => {
      await fs.writeFile(
        path.join(workspacePath, "docs", "handoff.md"),
        "Path hygiene rewrote the local handoff artifact.\n",
        "utf8",
      );
      return {
        ok: true,
        failureContext: null,
        rewrittenTrustedGeneratedArtifactPaths: ["docs/handoff.md"],
      };
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: no source change revalidation should not persist evidence after publication commits.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: no source change revalidation should not persist evidence after publication commits.",
            "- What changed: revalidated the current code and publication hygiene rewrote a durable artifact.",
            "- Current blocker: none.",
            "- Next exact step: continue review handling without no-change thread evidence.",
            "- Verification gap: none.",
          ].join("\n");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-492",
      supervisorMessage: [
        "Summary: Revalidated the current code against the live P2 thread with no source changes.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Revalidated the current code against the live P2 thread with no source changes.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.notEqual(git(workspacePath, "rev-parse", "HEAD").trim(), turnStartHead);
  assert.deepEqual(state.issues["492"]?.processed_review_thread_ids, []);
  assert.deepEqual(state.issues["492"]?.processed_review_thread_fingerprints, []);
});

test("executeCodexTurnPhase does not persist no-change Codex thread evidence with a dirty workspace", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const headSha = "7a77d998712882166f79c3710dd4c567da6da779";
  const issue: GitHubIssue = createIssue({
    title: "Do not persist dirty no-change Codex thread evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    number: 498,
    headRefOid: headSha,
  });
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_kwDOSHIe7c6HbSbo",
      comments: {
        nodes: [
          {
            id: "comment-safequery-shell",
            body: "P2: Preserve query workflow shell state after the current-head revalidation.",
            createdAt: "2026-06-05T17:55:00Z",
            url: "https://example.test/pr/498#discussion_shell",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 492,
    issues: {
      "492": createRecord({
        issue_number: 492,
        state: "local_review_fix",
        pr_number: 498,
        last_head_sha: headSha,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["492"]!,
    issue,
    pr,
    checks: [],
    reviewThreads,
    workspaceStatus: {
      branch: "codex/issue-492",
      headSha,
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary: `${category}:${summary}`,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-06-05T18:00:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (recordForState) => ({
      recordForState,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-492",
        headSha,
        hasUncommittedChanges: true,
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-492",
      supervisorMessage: [
        "Summary: Revalidated the current code against the live P2 thread but left local edits uncommitted.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
        "Failure signature: none",
        "Next action: commit or discard local edits before resolving verified Codex residue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Revalidated the current code against the live P2 thread but left local edits uncommitted.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "commit or discard local edits before resolving verified Codex residue",
        tests: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: dirty no-source-change revalidation must not persist Codex thread evidence.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: dirty no-source-change revalidation must not persist Codex thread evidence.",
            "- What changed: revalidated the current-head Codex P2 thread but left workspace edits uncommitted.",
            "- Next exact step: commit or discard local edits before resolving verified Codex residue.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.deepEqual(state.issues["492"]?.processed_review_thread_ids, []);
  assert.deepEqual(state.issues["492"]?.processed_review_thread_fingerprints, []);
});

test("executeCodexTurnPhase accepts command-backed Codex verification with failure-adjacent path tokens", async () => {
  const commands = [
    "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
    "npm run test:error-reporter",
    "node ./scripts/failed-fixture-verification.js",
  ];

  for (const command of commands) {
    const config = createConfig();
    const issue: GitHubIssue = createIssue({
      title: "Persist Codex verification evidence with path tokens",
    });
    const pr: GitHubPullRequest = createPullRequest({
      headRefOid: "head-verified",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "stabilizing",
          pr_number: 116,
          last_head_sha: "head-verified",
        }),
      },
    };
    const context = createCodexTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      checks: [],
      reviewThreads: [],
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-verified",
      },
    });
    let journalReads = 0;

    const result = await executeCodexTurnPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: record.updated_at,
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context,
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-13T06:20:00Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "pr_open",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-verified",
        }),
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: Verified the remaining Codex Connector review fixes.",
          "State hint: pr_open",
          "Blocked reason: none",
          `Tests: ${command}`,
          "Failure signature: none",
          "Next action: open PR",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "Verified the remaining Codex Connector review fixes.",
          stateHint: "pr_open",
          blockedReason: null,
          failureSignature: null,
          nextAction: "open PR",
          tests: command,
        },
        failureKind: null,
        failureContext: null,
      })),
      readIssueJournal: async () => {
        journalReads += 1;
        return journalReads === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist successful Codex verification with path tokens.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist successful Codex verification with path tokens.",
              "- What changed: implemented the path-token verification evidence.",
              "- Next exact step: inspect the refreshed PR state.",
            ].join("\n");
      },
    });

    assert.equal(result.kind, "completed");
    assert.deepEqual(result.record.timeline_artifacts, [
      {
        type: "verification_result",
        gate: "codex_turn",
        command,
        head_sha: "head-verified",
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified the remaining Codex Connector review fixes.",
        recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
      },
    ]);
  }
});

test("executeCodexTurnPhase rejects ambiguous Codex verification evidence", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Reject ambiguous Codex verification evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    headRefOid: "head-verified",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: 116,
        last_head_sha: "head-verified",
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr,
    checks: [],
    reviewThreads: [],
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-verified",
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-verified",
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: Reviewed the remaining Codex Connector findings.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: remaining review findings look addressed",
        "Failure signature: none",
        "Next action: open PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Reviewed the remaining Codex Connector findings.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "open PR",
        tests: "remaining review findings look addressed",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist only explicit command-backed verification.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist only explicit command-backed verification.",
            "- What changed: reviewed ambiguous evidence handling.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.record.timeline_artifacts, undefined);
});


test("executeCodexTurnPhase refreshes review bookkeeping after supervisor-owned journal normalization commits", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const otherJournalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issues",
    "181",
    "issue-journal.md",
  );
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(
    currentJournalPath,
    [
      "# Issue #102: review bookkeeping normalization",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: publish the normalization commit and keep review bookkeeping aligned.",
      "- What changed: published the supervisor-owned journal normalization commit.",
      "- Current blocker: none.",
      "- Next exact step: continue review handling on the normalized head.",
      "- Verification gap:",
      "- Files touched: .codex-supervisor/issues/181/issue-journal.md",
      "- Rollback concern: low.",
      "- Last focused command: git push",
      "",
      "### Scratchpad",
      "- Keep this section short. The supervisor may compact older notes automatically.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: reproduced a leak from ${SAMPLE_MACOS_WORKSTATION_PATH}.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(
    workspacePath,
    "add",
    ".codex-supervisor/issue-journal.md",
    ".codex-supervisor/issues/181/issue-journal.md",
  );
  git(workspacePath, "commit", "-m", "seed cross-issue journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const remoteHead = git(workspacePath, "rev-parse", "HEAD").trim();
  await fs.appendFile(
    path.join(workspacePath, "README.md"),
    "implementation change\n",
    "utf8",
  );
  git(workspacePath, "add", "README.md");
  git(workspacePath, "commit", "-m", "local implementation change");
  const preNormalizationHead = git(workspacePath, "rev-parse", "HEAD").trim();

  const issue = createIssue({
    title: "Refresh review bookkeeping after supervisor normalization",
  });
  const reviewThreads = [createReviewThread()];
  let pathGateCalls = 0;
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: currentJournalPath,
        last_head_sha: remoteHead,
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath,
    journalPath: currentJournalPath,
    syncJournal: async () => undefined,
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: preNormalizationHead,
      baseAhead: 2,
      remoteBranchExists: true,
      remoteAhead: 1,
    },
    pr: createPullRequest({
      number: 116,
      title: "Review bookkeeping normalization",
      reviewDecision: "CHANGES_REQUESTED",
      headRefName: "codex/issue-102",
      headRefOid: remoteHead,
    }),
    checks: [],
    reviewThreads,
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () =>
        createPullRequest({
          number: 116,
          title: "Review bookkeeping normalization",
          reviewDecision: "CHANGES_REQUESTED",
          headRefName: "codex/issue-102",
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        }),
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    getWorkspaceStatus: async () => {
      const currentHead = git(workspacePath, "rev-parse", "HEAD").trim();
      return currentHead === preNormalizationHead
        ? createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: preNormalizationHead,
            baseAhead: 2,
            remoteBranchExists: true,
            remoteAhead: 1,
          })
        : createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: currentHead,
            baseAhead: 3,
            remoteBranchExists: true,
            remoteAhead: 0,
          });
    },
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      await fs.writeFile(
        otherJournalPath,
        (await fs.readFile(otherJournalPath, "utf8")).replaceAll(
          SAMPLE_MACOS_WORKSTATION_PATH,
          "<redacted-local-path>",
        ),
        "utf8",
      );
      return {
        ok: true,
        failureContext: null,
        rewrittenJournalPaths: [
          ".codex-supervisor/issues/181/issue-journal.md",
        ],
      };
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "addressing_review",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    readIssueJournal: (() => {
      const journalContent = [
        "## Codex Working Notes",
        "### Current Handoff",
        "- Hypothesis: publish the normalization commit and keep review bookkeeping aligned.",
        "- What changed:",
        "- Current blocker: none.",
        "- Next exact step: write the supervisor handoff after the turn.",
      ].join("\n");
      return async () => journalContent;
    })(),
    agentRunner: createSuccessfulAgentRunner(async () => {
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: addressing_review",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: publish the rewritten journal",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "addressing_review",
          blockedReason: null,
          failureSignature: null,
          nextAction: "publish the rewritten journal",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    }),
  });

  const normalizedHead = git(workspacePath, "rev-parse", "HEAD").trim();
  assert.equal(pathGateCalls, 1);
  assert.equal(result.kind, "completed");
  assert.notEqual(normalizedHead, preNormalizationHead);
  assert.equal(state.issues["102"]?.last_head_sha, normalizedHead);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_ids, [
    `thread-1@${normalizedHead}`,
  ]);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_fingerprints, [
    `thread-1@${normalizedHead}#comment-1`,
  ]);
  assert.match(
    git(workspacePath, "log", "-1", "--pretty=%s"),
    /Normalize trusted durable artifacts for path hygiene/,
  );
  assert.doesNotMatch(
    await fs.readFile(otherJournalPath, "utf8"),
    new RegExp(
      SAMPLE_MACOS_WORKSTATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
});

test("executeCodexTurnPhase skips prompt preparation side effects when the session lock is unavailable", async () => {
  const issue = createIssue({
    title: "Skip prompt preparation when the session lock is unavailable",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "implementing",
        codex_session_id: "session-102",
        local_review_head_sha: "head-a",
        local_review_summary_path: "/tmp/reviews/head-a.md",
      }),
    },
  };
  let syncJournalCalls = 0;
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr: createPullRequest({
      title: "Session-locked review turn",
      reviewDecision: "CHANGES_REQUESTED",
      headRefOid: "head-a",
    }),
    checks: [],
    reviewThreads: [createReviewThread()],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => {
        throw new Error("unexpected resolvePullRequestForBranch call");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => ({
      sessionId: "session-102",
      acquired: false,
      reason: "session already locked elsewhere",
      release: async () => undefined,
    }),
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
    },
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    readIssueJournal: async () =>
      "## Codex Working Notes\n### Current Handoff\n- Hypothesis: wait for the lock.\n",
    agentRunner: createSuccessfulAgentRunner(async () => {
      throw new Error("unexpected agentRunner.runTurn call");
    }),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Skipped issue #102: session already locked elsewhere.",
  });
  assert.equal(syncJournalCalls, 0);
  assert.equal(state.issues["102"]?.external_review_misses_path, null);
  assert.equal(state.issues["102"]?.external_review_head_sha, null);
});

test("executeCodexTurnPhase blocks draft PR creation when configured local CI fails", async () => {
  const issue = createIssue({ title: "Gate PR creation on local CI" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let createPullRequestCalls = 0;
  let syncJournalCalls = 0;
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-b",
      baseAhead: 1,
    },
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-b",
        baseAhead: 1,
      }),
    pushBranch: async () => undefined,
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: finish the implementation and publish a PR.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: finish the implementation and publish a PR.",
              "- What changed: completed the implementation turn.",
            ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalCiCommand: async () => {
      throw new Error(
        "Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed",
      );
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: implementation complete",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: publish the PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "implementation complete",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "publish the PR",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Local CI gate blocked pull request creation for issue #102.",
  });
  assert.equal(createPullRequestCalls, 0);
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    "local-ci-gate-non_zero_exit",
  );
  assert.match(
    state.issues["102"]?.last_error ?? "",
    /Configured local CI command failed before opening a pull request\. Remediation target: tracked publishable content\./,
  );
});

test("executeCodexTurnPhase blocks branch publication when workstation-local path hygiene fails", async () => {
  const issue = createIssue({
    title: "Gate branch publication on path hygiene",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  const observedAllowlistMarkers: Array<readonly string[] | undefined> = [];
  const publishedComments: string[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      localCiCommand: "npm run ci:local",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      addIssueComment: async (_prNumber: number, body: string) => {
        publishedComments.push(body);
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    } as Pick<
      GitHubClient,
      | "resolvePullRequestForBranch"
      | "createPullRequest"
      | "getChecks"
      | "getUnresolvedReviewThreads"
      | "getExternalReviewSurface"
    > & {
      addIssueComment: (_prNumber: number, body: string) => Promise<void>;
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-b",
        remoteAhead: 1,
      }),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    pushBranch: async () => {
      pushBranchCalls += 1;
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
              "- What changed: completed the implementation turn.",
            ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async (gateArgs) => {
      observedAllowlistMarkers.push(gateArgs.publishablePathAllowlistMarkers);
      return {
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
      };
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: implementation complete",
        "State hint: draft_pr",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: push the branch update",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "implementation complete",
        stateHint: "draft_pr",
        blockedReason: null,
        failureSignature: null,
        nextAction: "push the branch update",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.deepEqual(observedAllowlistMarkers, [
    ["publishable-path-hygiene: allowlist"],
  ]);
  assert.equal(pushBranchCalls, 0);
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    "workstation-local-path-hygiene-failed",
  );
  assert.match(
    state.issues["102"]?.last_failure_context?.details[0] ?? "",
    /docs\/guide\.md:1/,
  );
  assert.equal(publishedComments.length, 1);
  assert.match(
    publishedComments[0] ?? "",
    /Tracked PR head `head-b` is still draft because ready-for-review promotion is blocked locally\./,
  );
  assert.match(publishedComments[0] ?? "", /- local head SHA: `head-b`/);
  assert.match(publishedComments[0] ?? "", /- remote PR head SHA: `head-b`/);
  assert.match(
    publishedComments[0] ?? "",
    /- blocker signature: `workstation-local-path-hygiene-failed`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- gate name: `workstation_local_path_hygiene`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- evidence: docs\/guide\.md:1 matched .*<redacted-user-home>.*/,
  );
  assert.doesNotMatch(
    publishedComments[0] ?? "",
    /\/Users\/alice\/|\/home\/alice\//,
  );
});

test("executeCodexTurnPhase classifies actionable publishable path hygiene as repairable publication hygiene", async () => {
  const issue = createIssue({
    title: "Queue publication path hygiene fixes for actionable publishable files",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "run-once-publication-path-hygiene-"),
  );
  const issueWorkspacePath = path.join(workspaceRoot, "issue-102");
  const issueJournalPath = path.join(
    issueWorkspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        workspace: issueWorkspacePath,
        journal_path: issueJournalPath,
        implementation_attempt_count: 1,
      }),
    },
  };
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  const publishedComments: string[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    workspaceRoot,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });
  const journalPath = issueJournalPath;
  const handoffBeforeRun = [
    "## Codex Working Notes",
    "### Current Handoff",
    "- Hypothesis: update the existing PR.",
    "- Current blocker: publication path hygiene failure.",
  ].join("\n");
  const handoffAfterRun = [
    "## Codex Working Notes",
    "### Current Handoff",
    "- Hypothesis: update the existing PR.",
    "- Current blocker: none.",
    "- What changed: repaired the publishable fixture path in this turn.",
  ].join("\n");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, handoffAfterRun, "utf8");
  let result: Awaited<ReturnType<typeof executeCodexTurnPhase>>;
  try {
    result = await executeCodexTurnPhase({
      config: createConfig({ localCiCommand: "npm run ci:local" }),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: record.updated_at,
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        addIssueComment: async (_prNumber: number, body: string) => {
          publishedComments.push(body);
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      } as Pick<
        GitHubClient,
        | "resolvePullRequestForBranch"
        | "createPullRequest"
        | "getChecks"
        | "getUnresolvedReviewThreads"
        | "getExternalReviewSurface"
      > & {
        addIssueComment: (_prNumber: number, body: string) => Promise<void>;
      },
      context,
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-13T06:20:00Z",
      }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "draft_pr",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "draft_pr",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      readIssueJournal: async () => handoffBeforeRun,
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-b",
          remoteAhead: 1,
        }),
      listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
      pushBranch: async () => {
        pushBranchCalls += 1;
      },
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
        actionablePublishableFilePaths: ["docs/guide.md"],
      }),
      agentRunner: createSuccessfulAgentRunner(async () => {
        return {
          exitCode: 0,
          sessionId: "session-102",
          supervisorMessage: [
            "Summary: implementation complete",
            "State hint: draft_pr",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: push the branch update",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "implementation complete",
            stateHint: "draft_pr",
            blockedReason: null,
            failureSignature: null,
            nextAction: "push the branch update",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }

  assert.deepEqual(result, {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(pushBranchCalls, 0);
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "repairing_ci");
  assert.equal(state.issues["102"]?.blocked_reason, null);
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE,
  );
  assert.match(
    state.issues["102"]?.last_failure_context?.summary ?? "",
    /Publication path hygiene found actionable fixture-level failures/,
  );
  assert.deepEqual(state.issues["102"]?.timeline_artifacts?.[0], {
    type: "path_hygiene_result",
    gate: "workstation_local_path_hygiene",
    command: "npm run verify:paths",
    head_sha: "head-b",
    outcome: "repair_queued",
    remediation_target: "repair_already_queued",
    next_action: "wait_for_repair_turn",
    summary: state.issues["102"]?.last_failure_context?.summary,
    recorded_at: "2026-03-13T06:20:00Z",
    repair_targets: ["docs/guide.md"],
  });
  assert.equal(publishedComments.length, 1);
  assert.match(
    publishedComments[0] ?? "",
    /- remediation target: `repair_already_queued`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- automatic retry: yes/,
  );
});

test("executeCodexTurnPhase retries once in the same turn when changed publishable files fail path hygiene and the repair clears it", async () => {
  const issue = createIssue({
    title:
      "Retry one same-turn publication repair for changed publishable files",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  let agentRunCount = 0;
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  let pathGateCalls = 0;
  const requests: AgentTurnRequest[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      localCiCommand: "npm run ci:local",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: agentRunCount >= 2 ? "head-c" : "head-b",
        remoteAhead: 1,
      }),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    pushBranch: async () => {
      pushBranchCalls += 1;
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
            ].join("\n")
          : readCount === 2
            ? [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: update the existing PR.",
                "- What changed: completed the first implementation pass.",
              ].join("\n")
            : readCount === 3
              ? [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: update the existing PR.",
                  "- What changed: completed the first implementation pass.",
                ].join("\n")
              : [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: update the existing PR.",
                  "- What changed: repaired the publishable path leak and completed the retry.",
                ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      return pathGateCalls === 1
        ? {
            ok: false,
            failureContext: {
              category: "blocked",
              summary:
                "Tracked durable artifacts failed workstation-local path hygiene before publication. Edit tracked publishable content to remove workstation-local paths. First fix: docs/guide.md (1 match, linux_home).",
              signature: "workstation-local-path-hygiene-failed",
              command: "npm run verify:paths",
              details: [
                `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
              ],
              url: null,
              updated_at: "2026-03-13T06:20:00Z",
            },
            actionablePublishableFilePaths: ["docs/guide.md"],
          }
        : {
            ok: true,
            failureContext: null,
            actionablePublishableFilePaths: [],
          };
    },
    agentRunner: createSuccessfulAgentRunner(async (request) => {
      requests.push(request);
      agentRunCount += 1;
      if (agentRunCount === 2) {
        assert.equal(request.kind, "resume");
        assert.match(
          request.failureContext?.summary ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
        assert.match(
          request.previousError ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
      }
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          `Summary: ${agentRunCount === 1 ? "implementation complete" : "publishable path repaired"}`,
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          `Next action: ${agentRunCount === 1 ? "repair the publishable path finding" : "push the branch update"}`,
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary:
            agentRunCount === 1
              ? "implementation complete"
              : "publishable path repaired",
          stateHint: "draft_pr",
          blockedReason: null,
          failureSignature: null,
          nextAction:
            agentRunCount === 1
              ? "repair the publishable path finding"
              : "push the branch update",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    }),
  });

  assert.equal(result.kind, "completed");
  assert.equal(agentRunCount, 2);
  assert.equal(pathGateCalls, 2);
  assert.equal(pushBranchCalls, 1);
  assert.ok(syncJournalCalls >= 1);
  assert.match(requests[1]?.previousSummary ?? "", /implementation complete/);
  assert.equal(state.issues["102"]?.state, "draft_pr");
  assert.equal(state.issues["102"]?.blocked_reason, null);
  assert.equal(state.issues["102"]?.last_failure_context, null);
});

test("executeCodexTurnPhase persists rewritten tracked paths before continuing a same-turn repair retry", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const journalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const publishableGuidePath = path.join(workspacePath, "docs", "guide.md");
  const trustedArtifactPath = path.join(
    workspacePath,
    "docs",
    "generated-summary.md",
  );
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(publishableGuidePath), { recursive: true });
  await fs.writeFile(
    journalPath,
    [
      "# Issue #102",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    publishableGuidePath,
    `Guide path: ${SAMPLE_MACOS_WORKSTATION_PATH}\n`,
    "utf8",
  );
  await fs.writeFile(
    trustedArtifactPath,
    `Trusted artifact path: ${SAMPLE_MACOS_WORKSTATION_PATH}\n`,
    "utf8",
  );
  git(workspacePath, "add", "docs/guide.md", "docs/generated-summary.md");
  git(workspacePath, "commit", "-m", "seed same-turn repair fixture");

  const initialHeadSha = git(workspacePath, "rev-parse", "HEAD").trim();
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
        workspace: workspacePath,
        journal_path: journalPath,
        branch: "codex/issue-102",
        last_head_sha: initialHeadSha,
      }),
    },
  };
  const issue = createIssue({
    title: "Persist rewritten tracked paths before same-turn retry",
  });
  const requests: AgentTurnRequest[] = [];
  let pathGateCalls = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () =>
        createPullRequest({
          number: 200,
          isDraft: true,
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        }),
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath,
      journalPath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: initialHeadSha,
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: false,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-27T09:00:00.000Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: (() => {
      let statusCalls = 0;
      return async () => {
        statusCalls += 1;
        return createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha:
            statusCalls === 1
              ? "head-after-turn-1"
              : git(workspacePath, "rev-parse", "HEAD").trim(),
          baseAhead: statusCalls === 1 ? 1 : 2,
          remoteBranchExists: statusCalls !== 1,
        });
      };
    })(),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
            ].join("\n")
          : readCount === 2
            ? [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                "- What changed: completed the first implementation pass.",
              ].join("\n")
            : readCount === 3
              ? [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                  "- What changed: completed the first implementation pass.",
                ].join("\n")
              : [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                  "- What changed: repaired the publishable path finding after the normalization commit.",
                ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      if (pathGateCalls === 1) {
        await fs.writeFile(
          trustedArtifactPath,
          "Trusted artifact path: <workstation-local>\n",
          "utf8",
        );
        return {
          ok: false,
          failureContext: {
            category: "blocked",
            summary:
              "Tracked durable artifacts failed workstation-local path hygiene before publication. Edit tracked publishable content to remove workstation-local paths. First fix: docs/guide.md (1 match, macos_home).",
            signature: "workstation-local-path-hygiene-failed",
            command: "npm run verify:paths",
            details: [
              `docs/guide.md:1 matched /${"Users"}/ via "${SAMPLE_MACOS_WORKSTATION_PATH}"`,
            ],
            url: null,
            updated_at: "2026-03-27T09:00:00.000Z",
          },
          actionablePublishableFilePaths: ["docs/guide.md"],
          rewrittenTrustedGeneratedArtifactPaths: ["docs/generated-summary.md"],
        };
      }

      return {
        ok: true,
        failureContext: null,
        actionablePublishableFilePaths: [],
      };
    },
    agentRunner: createSuccessfulAgentRunner(async (request) => {
      requests.push(request);
      if (requests.length === 2) {
        assert.equal(request.kind, "resume");
        assert.match(
          request.previousError ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
      }
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          `Summary: ${requests.length === 1 ? "implementation complete" : "publishable path repaired"}`,
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: continue",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary:
            requests.length === 1
              ? "implementation complete"
              : "publishable path repaired",
          stateHint: "draft_pr",
          blockedReason: null,
          failureSignature: null,
          nextAction: "continue",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    }),
  });

  assert.equal(result.kind, "completed");
  assert.equal(pathGateCalls, 2);
  assert.equal(requests.length, 2);
  assert.equal(
    git(workspacePath, "log", "-1", "--pretty=%s").trim(),
    "Normalize trusted durable artifacts for path hygiene",
  );
  assert.equal(
    git(workspacePath, "status", "--short", "--untracked-files=no").trim(),
    "",
  );
  assert.equal(
    git(workspacePath, "rev-parse", "HEAD").trim(),
    git(workspacePath, "rev-parse", "origin/codex/issue-102").trim(),
  );
  assert.equal(
    await fs.readFile(trustedArtifactPath, "utf8"),
    "Trusted artifact path: <workstation-local>\n",
  );
});

test("executeCodexTurnPhase deduplicates tracked PR publication gate comments for unchanged blockers", async () => {
  const issue = createIssue({
    title: "Deduplicate tracked PR publication-blocker comments",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  const publishedComments: string[] = [];
  let blockerSignature = "workstation-local-path-hygiene-failed-a";

  const executeTurn = async () =>
    executeCodexTurnPhase({
      config: createConfig({
        publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
      }),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: record.updated_at,
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        addIssueComment: async (_prNumber: number, body: string) => {
          publishedComments.push(body);
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      } as Pick<
        GitHubClient,
        | "resolvePullRequestForBranch"
        | "createPullRequest"
        | "getChecks"
        | "getUnresolvedReviewThreads"
        | "getExternalReviewSurface"
      > & {
        addIssueComment: (_prNumber: number, body: string) => Promise<void>;
      },
      context: createCodexTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        syncJournal: async () => undefined,
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-a",
        },
        pr,
        checks: [],
        reviewThreads: [],
      }),
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-13T06:20:00Z",
      }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "draft_pr",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "draft_pr",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-b",
          remoteAhead: 1,
        }),
      listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: (() => {
        let readCount = 0;
        return async () => {
          readCount += 1;
          return [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: prevent duplicate tracked PR blocker comments.",
            ...(readCount > 1
              ? ["- What changed: completed the implementation turn once."]
              : []),
          ].join("\n");
        };
      })(),
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: blockerSignature,
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
      }),
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: push the branch update",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "draft_pr",
          blockedReason: null,
          failureSignature: null,
          nextAction: "push the branch update",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      })),
    });

  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 1);

  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 1);

  blockerSignature = "workstation-local-path-hygiene-failed-b";
  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 2);
});

test("executeCodexTurnPhase routes start and resume turns through the shared agent runner contract", async () => {
  const requests: AgentTurnRequest[] = [];
  const agentRunner = createSuccessfulAgentRunner(async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      sessionId:
        request.kind === "resume" ? request.sessionId : "session-started",
      supervisorMessage: [
        "Summary: completed via agent runner",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "completed via agent runner",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    };
  });
  const issue: GitHubIssue = createIssue({
    title: "Use the agent runner contract",
  });
  const pr: GitHubPullRequest = createPullRequest({
    title: "Agent runner turn execution",
  });

  const createContext = (record = createRecord({ codex_session_id: null })) => {
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": record,
      },
    };

    return {
      state,
      record,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    };
  };

  const createArgs = (context: ReturnType<typeof createContext>) => ({
    config: createConfig(),
    stateStore: {
      touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error" as const,
    buildCodexFailureContext: (
      category: FailureContextCategory,
      summary: string,
      details: string[],
    ) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record: typeof context.record) => ({
      recordForState: record,
      nextState: "stabilizing" as const,
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing" as const,
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => context.workspaceStatus,
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: use the agent runner contract.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: use the agent runner contract.",
              "- What changed: agent runner wrote a journal handoff.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  const startContext = createContext();
  const startResult = await executeCodexTurnPhase(createArgs(startContext));
  assert.equal(startResult.kind, "completed");

  const resumeContext = createContext(
    createRecord({ codex_session_id: "session-existing" }),
  );
  const resumeResult = await executeCodexTurnPhase(createArgs(resumeContext));
  assert.equal(resumeResult.kind, "completed");

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(requests[1]?.kind, "resume");
  assert.equal(requests[1]?.sessionId, "session-existing");
});

test("executeCodexTurnPhase rehydrates a missing local journal before resuming a tracked turn", async () => {
  await withTempWorkspace(
    "codex-turn-missing-journal-",
    async (workspacePath) => {
      const journalPath = path.join(
        workspacePath,
        ".codex-supervisor",
        "issues",
        "102",
        "issue-journal.md",
      );
      const state: SupervisorStateFile = {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "stabilizing",
            codex_session_id: "session-existing",
            workspace: workspacePath,
            journal_path: journalPath,
            pr_number: 116,
          }),
        },
      };

      let syncJournalCalls = 0;
      let journalExistedDuringRun = false;

      const result = await executeCodexTurnPhase({
        config: createConfig({
          issueJournalRelativePath:
            ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
        }),
        stateStore: {
          touch: (record, patch) => ({
            ...record,
            ...patch,
            updated_at: "2026-03-26T01:00:01.000Z",
          }),
          save: async () => undefined,
        },
        github: {
          resolvePullRequestForBranch: async () =>
            createPullRequest({ number: 116, headRefOid: "head-116" }),
          createPullRequest: async () => {
            throw new Error("unexpected createPullRequest call");
          },
          getChecks: async () => [],
          getUnresolvedReviewThreads: async () => [],
          getExternalReviewSurface: async () => {
            throw new Error("unexpected getExternalReviewSurface call");
          },
        },
        context: {
          state,
          record: state.issues["102"]!,
          issue: createIssue({
            number: 102,
            title: "Rehydrate missing journal before resume",
          }),
          previousCodexSummary: null,
          previousError: null,
          workspacePath,
          journalPath,
          syncJournal: async () => {
            syncJournalCalls += 1;
            await fs.mkdir(path.dirname(journalPath), { recursive: true });
            await fs.writeFile(
              journalPath,
              [
                "# Issue #102: Rehydrate missing journal before resume",
                "",
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: restore the missing journal before the resume turn runs.",
                "- What changed: journal was rehydrated on this host because the local-only copy was missing.",
                "- Current blocker:",
                "- Next exact step: resume the tracked PR follow-up safely.",
                "- Verification gap:",
                "- Files touched:",
                "- Rollback concern:",
                "- Last focused command:",
                "",
                "### Scratchpad",
                "- Keep this section short. The supervisor may compact older notes automatically.",
                "",
              ].join("\n"),
              "utf8",
            );
          },
          memoryArtifacts: {
            alwaysReadFiles: [],
            onDemandFiles: [],
            contextIndexPath: "/tmp/context-index.md",
            agentsPath: "/tmp/AGENTS.generated.md",
          },
          workspaceStatus: createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
          pr: createPullRequest({ number: 116, headRefOid: "head-116" }),
          checks: [],
          reviewThreads: [],
          options: { dryRun: false },
        },
        acquireSessionLock: async () => null,
        classifyFailure: () => "command_error",
        buildCodexFailureContext: (category, summary, details) => ({
          category,
          summary,
          signature: `${category}:${summary}`,
          command: null,
          details,
          url: null,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        applyFailureSignature: () => ({
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
        }),
        normalizeBlockerSignature: () => null,
        isVerificationBlockedMessage: () => false,
        derivePullRequestLifecycleSnapshot: (record) => ({
          recordForState: record,
          nextState: "stabilizing",
          failureContext: null,
          reviewWaitPatch: {},
          copilotRequestObservationPatch: {},
          mergeLatencyVisibilityPatch: {
            provider_success_observed_at: null,
            provider_success_head_sha: null,
            merge_readiness_last_evaluated_at: null,
          },
          copilotTimeoutPatch: {
            copilot_review_timed_out_at: null,
            copilot_review_timeout_action: null,
            copilot_review_timeout_reason: null,
          },
        }),
        inferStateWithoutPullRequest: () => "stabilizing",
        blockedReasonFromReviewState: () => null,
        recoverUnexpectedCodexTurnFailure: async ({ error }) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
        getWorkspaceStatus: async () =>
          createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
        pushBranch: async () => {
          throw new Error("unexpected pushBranch call");
        },
        agentRunner: createSuccessfulAgentRunner(async (request) => {
          assert.equal(request.kind, "resume");
          await fs.access(journalPath);
          journalExistedDuringRun = true;
          await fs.appendFile(
            journalPath,
            "- What changed: resume turn completed after journal rehydration.\n",
            "utf8",
          );
          return {
            exitCode: 0,
            sessionId: "session-existing",
            supervisorMessage:
              "Paused on the resumed head after rehydrating the missing journal.",
            stderr: "",
            stdout: "",
            structuredResult: {
              summary:
                "Paused on the resumed head after rehydrating the missing journal.",
              stateHint: "blocked",
              blockedReason: "manual_review",
              failureSignature: null,
              nextAction: "continue from the recreated journal",
              tests: "not run",
            },
            failureKind: null,
            failureContext: null,
          };
        }),
      });

      assert.equal(result.kind, "returned");
      assert.match(result.message, /Codex reported blocked/);
      assert.ok(syncJournalCalls >= 1);
      assert.equal(journalExistedDuringRun, true);
      const journalContent = await fs.readFile(journalPath, "utf8");
      assert.match(journalContent, /local-only copy was missing/);
    },
  );
});

test("executeCodexTurnPhase does not rehydrate a missing local journal when the resume lock is unavailable", async () => {
  await withTempWorkspace(
    "codex-turn-missing-journal-locked-",
    async (workspacePath) => {
      const journalPath = path.join(
        workspacePath,
        ".codex-supervisor",
        "issues",
        "102",
        "issue-journal.md",
      );
      const state: SupervisorStateFile = {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "stabilizing",
            codex_session_id: "session-existing",
            workspace: workspacePath,
            journal_path: journalPath,
            pr_number: 116,
          }),
        },
      };

      let syncJournalCalls = 0;
      let journalReadCalls = 0;

      const result = await executeCodexTurnPhase({
        config: createConfig({
          issueJournalRelativePath:
            ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
        }),
        stateStore: {
          touch: (record, patch) => ({
            ...record,
            ...patch,
            updated_at: "2026-03-26T01:00:01.000Z",
          }),
          save: async () => undefined,
        },
        github: {
          resolvePullRequestForBranch: async () =>
            createPullRequest({ number: 116, headRefOid: "head-116" }),
          createPullRequest: async () => {
            throw new Error("unexpected createPullRequest call");
          },
          getChecks: async () => [],
          getUnresolvedReviewThreads: async () => [],
          getExternalReviewSurface: async () => {
            throw new Error("unexpected getExternalReviewSurface call");
          },
        },
        context: {
          state,
          record: state.issues["102"]!,
          issue: createIssue({
            number: 102,
            title:
              "Skip missing journal rehydration when the resume lock is unavailable",
          }),
          previousCodexSummary: null,
          previousError: null,
          workspacePath,
          journalPath,
          syncJournal: async () => {
            syncJournalCalls += 1;
          },
          memoryArtifacts: {
            alwaysReadFiles: [],
            onDemandFiles: [],
            contextIndexPath: "/tmp/context-index.md",
            agentsPath: "/tmp/AGENTS.generated.md",
          },
          workspaceStatus: createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
          pr: createPullRequest({ number: 116, headRefOid: "head-116" }),
          checks: [],
          reviewThreads: [],
          options: { dryRun: false },
        },
        acquireSessionLock: async () => ({
          sessionId: "session-existing",
          acquired: false,
          reason: "session already locked elsewhere",
          release: async () => undefined,
        }),
        classifyFailure: () => "command_error",
        buildCodexFailureContext: (category, summary, details) => ({
          category,
          summary,
          signature: `${category}:${summary}`,
          command: null,
          details,
          url: null,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        applyFailureSignature: () => ({
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
        }),
        normalizeBlockerSignature: () => null,
        isVerificationBlockedMessage: () => false,
        derivePullRequestLifecycleSnapshot: () => {
          throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
        },
        inferStateWithoutPullRequest: () => "stabilizing",
        blockedReasonFromReviewState: () => null,
        recoverUnexpectedCodexTurnFailure: async ({ error }) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
        getWorkspaceStatus: async () =>
          createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
        pushBranch: async () => {
          throw new Error("unexpected pushBranch call");
        },
        readIssueJournal: async () => {
          journalReadCalls += 1;
          return null;
        },
        agentRunner: createSuccessfulAgentRunner(async () => {
          throw new Error("unexpected agentRunner.runTurn call");
        }),
      });

      assert.deepEqual(result, {
        kind: "returned",
        message: "Skipped issue #102: session already locked elsewhere.",
      });
      assert.equal(syncJournalCalls, 0);
      assert.equal(journalReadCalls, 0);
    },
  );
});

test("executeCodexTurnPhase writes a durable interrupted-turn marker before runTurn and clears it after success", async () => {
  await withTempWorkspace("codex-turn-marker-", async (workspacePath) => {
    const markerPath = interruptedTurnMarkerPath(workspacePath);
    const issue: GitHubIssue = createIssue({
      title: "Persist interrupted turn marker",
    });
    const pr: GitHubPullRequest = createPullRequest({
      title: "Interrupted turn marker lifecycle",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          codex_session_id: null,
          workspace: workspacePath,
          journal_path: path.join(
            workspacePath,
            ".codex-supervisor",
            "issue-journal.md",
          ),
        }),
      },
    };
    let markerSeenDuringRun = false;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        previousCodexSummary: null,
        previousError: null,
        workspacePath,
        journalPath: path.join(
          workspacePath,
          ".codex-supervisor",
          "issue-journal.md",
        ),
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-a",
          hasUncommittedChanges: false,
          baseAhead: 0,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr,
        checks: [],
        reviewThreads: [],
        options: { dryRun: false },
      },
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-26T01:00:01.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "stabilizing",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () => ({
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: (() => {
        let readCount = 0;
        return async () => {
          readCount += 1;
          return readCount === 1
            ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: persist an interrupted-turn marker.\n"
            : [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: persist an interrupted-turn marker.",
                "- What changed: wrote the marker lifecycle regression coverage.",
              ].join("\n");
        };
      })(),
      agentRunner: createSuccessfulAgentRunner(async () => {
        const rawMarker = await fs.readFile(markerPath, "utf8");
        const marker = JSON.parse(rawMarker) as {
          issueNumber: number;
          state: string;
          startedAt: string;
          journalFingerprint: { exists: boolean; sha256: string | null } | null;
        };
        assert.equal(marker.issueNumber, 102);
        assert.equal(marker.state, "implementing");
        assert.match(marker.startedAt, /^20/);
        assert.deepEqual(marker.journalFingerprint, {
          exists: false,
          sha256: null,
        });
        markerSeenDuringRun = true;
        return {
          exitCode: 0,
          sessionId: "session-marker",
          supervisorMessage: [
            "Summary: completed successfully",
            "State hint: stabilizing",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: continue",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "completed successfully",
            stateHint: "stabilizing",
            blockedReason: null,
            failureSignature: null,
            nextAction: "continue",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });

    assert.equal(result.kind, "completed");
    assert.equal(markerSeenDuringRun, true);
    await assert.rejects(fs.access(markerPath), { code: "ENOENT" });
  });
});

test("executeCodexTurnPhase does not consume a stable churn dossier before runTurn returns", async () => {
  await withTempWorkspace("codex-churn-dossier-dispatch-", async (workspacePath) => {
    const signature =
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:claim_detection_truth_source:head-a_head-b_head-c";
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    const record = createRecord({
      state: "addressing_review",
      workspace: workspacePath,
      journal_path: journalPath,
      last_tracked_pr_progress_snapshot: JSON.stringify({
        headRefOid: "head-c",
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        checks: [],
        unresolvedReviewThreadIds: ["thread-current-0"],
        codexConnectorStableSameFileChurn: {
          streak: 3,
          dominantFile: "src/release-readiness.ts",
          clusterCategorySignature: "claim_detection+truth_source",
          currentEffectiveMustFixCount: 4,
          reviewedHeadShas: ["head-a", "head-b", "head-c"],
          representativeThreadIds: ["thread-current-0"],
        },
      }),
      codex_connector_stable_churn_dossier_consumed_signature: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": record,
      },
    };
    let saveCalls = 0;
    let recoveredRecord: IssueRunRecord | null = null;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (currentRecord, patch) => ({
          ...currentRecord,
          ...patch,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        save: async () => {
          saveCalls += 1;
        },
      },
      github: {
        resolvePullRequestForBranch: async () => null,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: createCodexTurnContext({
        state,
        record,
        workspacePath,
        journalPath,
        pr: null,
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-c",
        },
      }),
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-26T01:00:01.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async ({ record: recordAtFailure }) => {
        recoveredRecord = recordAtFailure;
        return recordAtFailure;
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-c",
        }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: async () =>
        "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair stable churn.\n",
      agentRunner: createSuccessfulAgentRunner(async (request) => {
        assert.equal(
          request.record?.codex_connector_stable_churn_dossier_consumed_signature,
          null,
        );
        throw new Error("dispatch failed after marker");
      }),
    });

    const recordAtRecovery = recoveredRecord as IssueRunRecord | null;
    assert.deepEqual(result, {
      kind: "returned",
      message: "Recovered from unexpected Codex turn failure for issue #102.",
    });
    assert.equal(saveCalls, 0);
    assert.equal(
      recordAtRecovery?.codex_connector_stable_churn_dossier_consumed_signature,
      null,
    );
    assert.equal(
      stableSameFileCodexConnectorChurnDossierConsumptionPatch(recordAtRecovery ?? record)
        .codex_connector_stable_churn_dossier_consumed_signature,
      signature,
    );
  });
});

test("executeCodexTurnPhase does not consume a stable churn dossier when Codex fails before session start", async () => {
  await withTempWorkspace("codex-churn-dossier-prelaunch-", async (workspacePath) => {
    const signature =
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:claim_detection_truth_source:head-a_head-b_head-c";
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    const record = createRecord({
      state: "addressing_review",
      workspace: workspacePath,
      journal_path: journalPath,
      last_tracked_pr_progress_snapshot: JSON.stringify({
        headRefOid: "head-c",
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        checks: [],
        unresolvedReviewThreadIds: ["thread-current-0"],
        codexConnectorStableSameFileChurn: {
          streak: 3,
          dominantFile: "src/release-readiness.ts",
          clusterCategorySignature: "claim_detection+truth_source",
          currentEffectiveMustFixCount: 4,
          reviewedHeadShas: ["head-a", "head-b", "head-c"],
          representativeThreadIds: ["thread-current-0"],
        },
      }),
      codex_connector_stable_churn_dossier_consumed_signature: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": record,
      },
    };
    let recordAtExecutionFailure: IssueRunRecord | null = null;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (currentRecord, patch) => ({
          ...currentRecord,
          ...patch,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => null,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: createCodexTurnContext({
        state,
        record,
        workspacePath,
        journalPath,
        pr: null,
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-c",
        },
      }),
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-26T01:00:01.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      persistCodexTurnExecutionFailure: async ({ record: recordAtFailure }) => {
        recordAtExecutionFailure = recordAtFailure;
        return recordAtFailure;
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-c",
        }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: async () =>
        "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair stable churn.\n",
      agentRunner: createSuccessfulAgentRunner(async (request) => {
        assert.equal(request.kind, "start");
        assert.equal(
          request.record?.codex_connector_stable_churn_dossier_consumed_signature,
          null,
        );
        return {
          exitCode: 1,
          sessionId: null,
          supervisorMessage: "",
          stderr: "spawn codex ENOENT",
          stdout: "",
          structuredResult: null,
          failureKind: "command_error",
          failureContext: {
            category: "codex",
            summary: "Codex turn execution failed.",
            signature: "codex:Codex turn execution failed.",
            command: null,
            details: ["spawn codex ENOENT"],
            url: null,
            updated_at: "2026-03-26T01:00:01.000Z",
          },
        };
      }),
    });

    const failureRecord = recordAtExecutionFailure as IssueRunRecord | null;
    assert.deepEqual(result, {
      kind: "returned",
      message: "Codex turn failed for issue #102.",
    });
    assert.equal(
      failureRecord?.codex_connector_stable_churn_dossier_consumed_signature,
      null,
    );
    assert.equal(
      stableSameFileCodexConnectorChurnDossierConsumptionPatch(failureRecord ?? record)
        .codex_connector_stable_churn_dossier_consumed_signature,
      signature,
    );
  });
});

test("withTempWorkspace removes the interrupted-turn workspace when the test body throws", async () => {
  let workspacePath = "";

  await assert.rejects(
    withTempWorkspace("codex-turn-marker-", async (tempWorkspacePath) => {
      workspacePath = tempWorkspacePath;
      await fs.writeFile(path.join(tempWorkspacePath, "marker.json"), "{}");
      throw new Error("intentional test failure");
    }),
    /intentional test failure/,
  );

  assert.ok(workspacePath, "Expected temp workspace path to be captured");
  await assert.rejects(fs.access(workspacePath), { code: "ENOENT" });
});

test("executeCodexTurnPhase keeps local-CI blocked outcomes isolated from execution-metrics write failures", async () => {
  const consoleWarnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    consoleWarnings.push(args);
  };

  try {
    const config = createConfig({ localCiCommand: "npm run ci:local" });
    const issue: GitHubIssue = createIssue({
      title: "Keep local CI blocked despite metrics failures",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          implementation_attempt_count: 1,
          workspace: "/tmp/workspaces/issue-102",
          journal_path:
            "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
          updated_at: "not-an-iso-timestamp",
        }),
      },
    };
    let recoverCalls = 0;
    let recoveredError: unknown = null;
    let journalReads = 0;

    const result = await executeCodexTurnPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-24T03:10:00Z",
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => null,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        previousCodexSummary: null,
        previousError: null,
        workspacePath: "/tmp/workspaces/issue-102",
        journalPath:
          "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-102",
          hasUncommittedChanges: false,
          baseAhead: 1,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr: null,
        checks: [],
        reviewThreads: [],
        options: { dryRun: false },
      },
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-24T03:10:00Z",
      }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "implementing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async ({ error, record }) => {
        recoverCalls += 1;
        recoveredError = error;
        return record;
      },
      getWorkspaceStatus: async () => ({
        branch: "codex/issue-102",
        headSha: "head-102",
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => undefined,
      readIssueJournal: async () => {
        journalReads += 1;
        return journalReads === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: fail local CI before opening a pull request.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: fail local CI before opening a pull request.",
              "- What changed: local CI blocked the run before PR creation.",
            ].join("\n");
      },
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      runLocalCiCommand: async () => {
        throw new Error(
          "Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed",
        );
      },
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: stabilizing",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: publish the PR",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "stabilizing",
          blockedReason: null,
          failureSignature: null,
          nextAction: "publish the PR",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      })),
    });

    assert.deepEqual(result, {
      kind: "returned",
      message: "Local CI gate blocked pull request creation for issue #102.",
    });
    assert.equal(recoverCalls, 0, String(recoveredError));
    assert.equal(state.issues["102"]?.state, "blocked");
    assert.equal(state.issues["102"]?.blocked_reason, "verification");
    assert.equal(
      state.issues["102"]?.last_failure_signature,
      "local-ci-gate-non_zero_exit",
    );
    assert.equal(consoleWarnings.length, 1);
    assert.match(
      String(consoleWarnings[0]?.[0] ?? ""),
      /Failed to write execution metrics run summary while persisting issue #102\./,
    );
    assert.deepEqual(consoleWarnings[0]?.[1], {
      issueNumber: 102,
      terminalState: "blocked",
      updatedAt: "2026-03-24T03:10:00Z",
    });
    assert.match(
      String(consoleWarnings[0]?.[2] ?? ""),
      /startedAt must be an ISO-8601 timestamp/u,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("executeCodexTurnPhase falls back to a fresh start when the agent runner cannot resume", async () => {
  const requests: AgentTurnRequest[] = [];
  let sessionLockCalls = 0;
  const agentRunner: AgentRunner = {
    capabilities: {
      supportsResume: false,
      supportsStructuredResult: false,
    },
    async runTurn(request) {
      requests.push(request);
      return {
        exitCode: 0,
        sessionId: null,
        supervisorMessage: "Completed via fallback start turn.",
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "ignored without structured-result support",
          stateHint: "blocked",
          blockedReason: "verification",
          failureSignature: "should-not-apply",
          nextAction: "ignored",
          tests: "ignored",
        },
        failureKind: null,
        failureContext: null,
      };
    },
  };
  const issue: GitHubIssue = createIssue({
    title: "Fallback to a fresh start turn",
    body: "## Summary\nFresh sessions still need the full issue prompt.",
  });
  const pr: GitHubPullRequest = createPullRequest({
    title: "Agent runner compatibility fallback",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "reproducing",
        codex_session_id: "session-existing",
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => {
      sessionLockCalls += 1;
      return null;
    },
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: a fresh start fallback should use the full issue prompt.",
              "- Next exact step: restart from the issue body.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: a fresh start fallback should use the full issue prompt.",
              "- What changed: restarted from the full issue body.",
              "- Next exact step: continue with focused verification.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  assert.equal(result.kind, "completed");
  assert.equal(sessionLockCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(
    requests[0]?.issue.body,
    "## Summary\nFresh sessions still need the full issue prompt.",
  );
  assert.equal(
    requests[0]?.journalExcerpt?.includes("restart from the issue body."),
    true,
  );
  assert.equal(state.issues["102"]?.state, "stabilizing");
});

test("executeCodexTurnPhase does not take a session lock when the turn must restart from a non-resumeable state", async () => {
  const requests: AgentTurnRequest[] = [];
  let sessionLockCalls = 0;
  const agentRunner = createSuccessfulAgentRunner(async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      sessionId: null,
      supervisorMessage: [
        "Summary: completed via fallback start turn",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "completed via fallback start turn",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    };
  });
  const issue = createIssue({
    title: "Do not lock non-resumeable states",
    body: "## Summary\nAddressing review should restart from a fresh prompt.",
  });
  const pr = createPullRequest({
    title: "Non-resumeable state should not request a session lock",
    reviewDecision: "CHANGES_REQUESTED",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        codex_session_id: "session-existing",
        pr_number: pr.number,
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: "Previous review turn summary.",
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => {
      sessionLockCalls += 1;
      return {
        sessionId: "session-existing",
        acquired: false,
        reason: "stale lock should be ignored for fresh starts",
        release: async () => undefined,
      };
    },
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: review follow-up should restart without resuming the old session.",
              "- Next exact step: rebuild the full prompt for the review turn.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: review follow-up should restart without resuming the old session.",
              "- What changed: restarted from the full review prompt.",
              "- Next exact step: continue with focused verification.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  assert.equal(result.kind, "completed");
  assert.equal(sessionLockCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(
    requests[0]?.issue.body,
    "## Summary\nAddressing review should restart from a fresh prompt.",
  );
  assert.equal(state.issues["102"]?.state, "stabilizing");
});

test("executeCodexTurnPhase preserves stale stabilizing no-PR recovery tracking across a successful no-PR turn", async () => {
  const staleNoPrFailureContext = {
    category: "blocked" as const,
    summary:
      "Issue #102 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
    signature: "stale-stabilizing-no-pr-recovery-loop",
    command: null,
    details: [
      "state=stabilizing",
      "tracked_pr=none",
      "branch_state=recoverable",
      "repeat_count=1/3",
      "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
    ],
    url: null,
    updated_at: "2026-03-13T06:00:00.000Z",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        last_error: staleNoPrFailureContext.summary,
        last_failure_context: staleNoPrFailureContext,
        last_failure_signature: staleNoPrFailureContext.signature,
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue: createIssue({ title: "Preserve stale no-PR recovery tracking" }),
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: the stale no-PR turn can make progress without reopening a PR.",
              "- Next exact step: keep the recovery repeat tracking intact.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: the stale no-PR turn can make progress without reopening a PR.",
              "- What changed: completed another successful no-PR turn.",
              "- Next exact step: continue the stale recovery loop if needed.",
            ].join("\n");
      };
    })(),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: null,
      supervisorMessage: [
        "Summary: continued stale recovery without opening a PR",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "continued stale recovery without opening a PR",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.equal(state.issues["102"]?.state, "stabilizing");
  assert.equal(state.issues["102"]?.pr_number, null);
  assert.equal(
    state.issues["102"]?.last_error,
    staleNoPrFailureContext.summary,
  );
  assert.equal(
    state.issues["102"]?.last_failure_context,
    staleNoPrFailureContext,
  );
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    staleNoPrFailureContext.signature,
  );
  assert.equal(state.issues["102"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["102"]?.stale_stabilizing_no_pr_recovery_count, 1);
});

test("executeCodexTurnPhase normalizes workstation-local paths from a journal-only direct rewrite before post-run persistence", async () => {
  await withTempWorkspace("journal-direct-rewrite-", async (workspacePath) => {
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    const repoFilePath = path.join(workspacePath, "src", "review-fix.ts");
    const hostOnlyPath = path.posix.join(
      "/",
      "home",
      "alice",
      ".codex",
      "history.log",
    );
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.mkdir(path.dirname(repoFilePath), { recursive: true });
    await fs.writeFile(
      journalPath,
      [
        "## Codex Working Notes",
        "### Current Handoff",
        "- Hypothesis: a journal-only review fix should still sanitize durable paths.",
      ].join("\n"),
      "utf8",
    );

    const pr = createPullRequest({
      title: "Normalize journal-only review-fix rewrites",
      headRefOid: "head-review-fix",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "local_review_fix",
          workspace: workspacePath,
          journal_path: journalPath,
          pr_number: pr.number,
        }),
      },
    };

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-27T09:00:00.000Z",
        }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
        createPullRequest: async () => {
          throw new Error("unexpected createPullRequest call");
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue: createIssue({
          title: "Normalize journal-only review-fix rewrites",
        }),
        previousCodexSummary: null,
        previousError: null,
        workspacePath,
        journalPath,
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-review-fix",
          hasUncommittedChanges: false,
          baseAhead: 0,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr,
        checks: [],
        reviewThreads: [],
        options: { dryRun: false },
      },
      acquireSessionLock: async () => null,
      classifyFailure: () => "command_error",
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-27T09:00:00.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "local_review_fix",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () => ({
        branch: "codex/issue-102",
        headSha: "head-review-fix",
        hasUncommittedChanges: true,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      agentRunner: createSuccessfulAgentRunner(async (request) => {
        await fs.writeFile(
          request.journalPath,
          [
            "## Codex Working Notes",
            "### Current Handoff",
            `- What changed: rewrote ${repoFilePath} after inspecting ${hostOnlyPath}.`,
            "- Next exact step: rerun the review-focused verification.",
          ].join("\n"),
          "utf8",
        );

        return {
          exitCode: 0,
          sessionId: null,
          supervisorMessage: [
            "Summary: rewrote the journal for a local review fix",
            "State hint: local_review_fix",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: rerun the review-focused verification",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "rewrote the journal for a local review fix",
            stateHint: "local_review_fix",
            blockedReason: null,
            failureSignature: null,
            nextAction: "rerun the review-focused verification",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });

    assert.equal(result.kind, "completed");
    const content = await fs.readFile(journalPath, "utf8");
    assert.doesNotMatch(
      content,
      new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(
      content,
      new RegExp(hostOnlyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(content, /src\/review-fix\.ts/);
    assert.match(content, /<redacted-local-path>/);
  });
});

for (const terminalState of ["blocked", "failed"] as const) {
test(`executeCodexTurnPhase binds a uniquely resolved open PR before persisting structured ${terminalState}`, async () => {
  const branch = "codex/issue-102";
  const publishedHead = "head-published-102";
  const record = createRecord({
    state: "implementing",
    branch,
    pr_number: null,
    last_head_sha: "head-before-102",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": record },
  };
  const issue = createIssue({ number: 102 });
  const pr = createPullRequest({
    number: 202,
    baseRefName: "main",
    headRefName: branch,
    headRefOid: publishedHead,
    headRepositoryOwner: { login: "owner" },
    isCrossRepository: false,
    state: "OPEN",
    mergedAt: null,
  });
  const context = createCodexTurnContext({
    state,
    record,
    issue,
    pr: null,
    workspaceStatus: {
      branch,
      headSha: "head-before-102",
    },
  });
  let workspaceReads = 0;
  let pullRequestReads = 0;
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (current, patch) => ({
        ...current,
        ...patch,
        updated_at: current.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      findOpenPullRequestsForBranch: async (resolvedBranch, options) => {
        pullRequestReads += 1;
        assert.equal(resolvedBranch, branch);
        assert.equal(options?.purpose, "action");
        return [pr];
      },
      getPullRequestIfExists: async (prNumber, options) => {
        assert.equal(prNumber, pr.number);
        assert.equal(options?.purpose, "action");
        return pr;
      },
      resolvePullRequestForBranch: async () => {
        throw new Error("unexpected fallback PR resolution");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: null,
      command: null,
      details,
      url: null,
      updated_at: "2026-07-11T12:30:00Z",
    }),
    applyFailureSignature: (_current, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => "verification:prerequisite",
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected lifecycle projection");
    },
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async ({ error }) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    getWorkspaceStatus: async () => {
      workspaceReads += 1;
      return createWorkspaceStatus({
        branch,
        headSha: publishedHead,
      });
    },
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: publish the implementation.\n"
        : "## Codex Working Notes\n### Current Handoff\n- Hypothesis: publish the implementation.\n- What changed: opened PR #202 before verification stopped.\n";
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: "Verification blocked: prerequisite not satisfied.",
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Published the PR before the verifier stopped.",
        stateHint: terminalState,
        blockedReason: "verification",
        failureSignature: "gitops-images-high-critical",
        nextAction: "repair the verification prerequisite",
        tests: "npm run verify:images; failed",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  const updated = state.issues["102"]!;
  assert.equal(result.kind, "returned");
  assert.equal(result.message, `Codex reported ${terminalState} for issue #102.`);
  assert.equal(workspaceReads, 1);
  assert.equal(pullRequestReads, 1);
  assert.equal(updated.state, terminalState);
  assert.equal(
    updated.blocked_reason,
    terminalState === "blocked" ? "verification" : null,
  );
  assert.equal(updated.pr_number, pr.number);
  assert.equal(updated.last_head_sha, publishedHead);
  assert.match(
    updated.last_tracked_pr_progress_summary ?? "",
    /blocked_turn_pr_reconciliation=bound/,
  );
  assert.equal(updated.last_failure_signature, "gitops-images-high-critical");
  assert.equal(
    updated.last_failure_context?.details.includes(
      "structured_blocked_reason=verification",
    ),
    terminalState === "blocked",
  );
  assert.match(updated.last_failure_context?.command ?? "", /npm run verify:images/);
});
}

for (const terminalVerifierScenario of [
  {
    name: "preserves an independent verifier when review repair ends with a structured terminal hint",
    legacyCommand: "npm run verify:images",
    tests: "not run",
    preserves: true,
  },
  {
    name: "replaces a legacy commandless verifier after one passing command and a structured terminal hint",
    legacyCommand: null,
    tests: "npm run verify:images",
    preserves: false,
  },
] as const) {
test(`executeCodexTurnPhase ${terminalVerifierScenario.name}`, async () => {
  const branch = "codex/issue-103";
  const repairedHead = "head-repaired-103";
  const failureContext = {
    category: "blocked" as const,
    summary: "Image verification remains blocked.",
    signature: "gitops-images-high-critical",
    command: terminalVerifierScenario.legacyCommand,
    details: ["structured_blocked_reason=verification"],
    url: null,
    updated_at: "2026-07-11T12:35:00Z",
  };
  const record = createRecord({
    issue_number: 103,
    state: "addressing_review",
    branch,
    pr_number: 203,
    last_head_sha: "head-old-103",
    blocked_reason: "verification",
    last_error: failureContext.summary,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    last_blocker_signature: "verification:images",
    repeated_blocker_count: 2,
    blocked_verification_retry_count: 1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 103,
    issues: { "103": record },
  };
  const issue = createIssue({ number: 103 });
  const pr = createPullRequest({
    number: 203,
    baseRefName: "main",
    headRefName: branch,
    headRefOid: repairedHead,
    headRepositoryOwner: { login: "owner" },
    isCrossRepository: false,
    state: "OPEN",
    mergedAt: null,
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (current, patch) => ({
        ...current,
        ...patch,
        updated_at: current.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      findOpenPullRequestsForBranch: async () => [pr],
      getPullRequestIfExists: async () => pr,
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected review thread lookup");
      },
      getExternalReviewSurface: async () => {
        throw new Error("unexpected external review lookup");
      },
    },
    context: createCodexTurnContext({
      state,
      record,
      issue,
      pr: createPullRequest({
        number: 203,
        baseRefName: "main",
        headRefName: branch,
        headRefOid: "head-old-103",
      }),
      workspaceStatus: { branch, headSha: "head-old-103" },
    }),
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: null,
      command: null,
      details,
      url: null,
      updated_at: "2026-07-11T12:40:00Z",
    }),
    applyFailureSignature: (_current, nextFailureContext) => ({
      last_failure_signature: nextFailureContext?.signature ?? null,
      repeated_failure_signature_count: nextFailureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => "secrets:review-repair",
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected lifecycle projection");
    },
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async ({ error }) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({ branch, headSha: repairedHead }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair review findings.\n"
        : "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair review findings.\n- What changed: repair stopped on a permission boundary.\n";
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-103",
      supervisorMessage: "Need token before the review repair can continue.",
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Review repair stopped before the verifier ran.",
        stateHint: "blocked",
        blockedReason: "secrets",
        failureSignature: "secrets:review-repair",
        nextAction: "provide the token",
        tests: terminalVerifierScenario.tests,
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  const updated = state.issues["103"]!;
  assert.equal(result.kind, "returned");
  assert.equal(updated.state, "blocked");
  assert.equal(
    updated.blocked_reason,
    terminalVerifierScenario.preserves ? "verification" : "secrets",
  );
  assert.equal(updated.pr_number, 203);
  assert.equal(updated.last_head_sha, repairedHead);
  assert.equal(
    updated.last_failure_context?.command,
    terminalVerifierScenario.preserves ? "npm run verify:images" : null,
  );
  assert.equal(
    updated.last_failure_signature,
    terminalVerifierScenario.preserves
      ? failureContext.signature
      : "secrets:review-repair",
  );
  assert.equal(
    updated.repeated_failure_signature_count,
    terminalVerifierScenario.preserves ? 3 : 1,
  );
  assert.equal(
    updated.last_blocker_signature,
    terminalVerifierScenario.preserves
      ? "verification:images"
      : "secrets:review-repair",
  );
  assert.equal(
    updated.repeated_blocker_count,
    terminalVerifierScenario.preserves ? 2 : 1,
  );
  assert.equal(
    updated.blocked_verification_retry_count,
    terminalVerifierScenario.preserves ? 1 : 0,
  );
  assert.match(updated.last_error ?? "", /Need token/);
  assert.equal(
    updated.last_failure_context?.details.includes(
      "review_repair_terminal_blocked_reason=secrets",
    ),
    terminalVerifierScenario.preserves,
  );
});
}

for (const verifierScenario of [
  { name: "keeps an unverified blocker", tests: "not run", preserves: true },
  { name: "clears a verified blocker", tests: "npm run verify:images", preserves: false },
  {
    name: "clears a blocker when its command passes in mixed results",
    tests: "npm run verify:images passed; npm test failed",
    preserves: false,
  },
  {
    name: "clears a legacy commandless blocker after one passing command",
    tests: "npm run verify:images",
    preserves: false,
    legacyCommandMissing: true,
  },
  {
    name: "keeps a legacy commandless blocker after an arbitrary pass",
    tests: "passed",
    preserves: true,
    legacyCommandMissing: true,
  },
  {
    name: "keeps a legacy commandless blocker after mixed results",
    tests: "npm run verify:images passed; npm test failed",
    preserves: true,
    legacyCommandMissing: true,
  },
  {
    name: "keeps a legacy commandless blocker after multiple passing commands",
    tests: "npm run verify:images; npm test",
    preserves: true,
    legacyCommandMissing: true,
  },
  {
    name: "keeps a legacy commandless blocker after ambiguous evidence",
    tests: "npm run verify:images; ambiguous",
    preserves: true,
    legacyCommandMissing: true,
  },
] as const) {
test(`executeCodexTurnPhase ${verifierScenario.name} after review repair advances the PR head`, async () => {
  const branch = "codex/issue-102";
  const oldHead = "head-old-102";
  const repairedHead = "head-repaired-102";
  const failureContext = {
    category: "blocked" as const,
    summary: "Image verification remains blocked.",
    signature: "gitops-images-high-critical",
    command: "legacyCommandMissing" in verifierScenario &&
        verifierScenario.legacyCommandMissing
      ? null
      : "npm run verify:images",
    details: ["structured_blocked_reason=verification"],
    url: null,
    updated_at: "2026-07-11T12:35:00Z",
  };
  const record = createRecord({
    state: "addressing_review",
    branch,
    pr_number: 202,
    last_head_sha: oldHead,
    blocked_reason: "verification",
    last_error: failureContext.summary,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 2,
    last_blocker_signature: "verification:images",
    repeated_blocker_count: 2,
    blocked_verification_retry_count: 1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": record },
  };
  const issue = createIssue({ number: 102 });
  const repairedPr = createPullRequest({
    number: 202,
    baseRefName: "main",
    headRefName: branch,
    headRefOid: repairedHead,
    state: "OPEN",
    mergedAt: null,
  });
  let journalReads = 0;

  await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (current, patch) => ({
        ...current,
        ...patch,
        updated_at: current.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async (_branch, _prNumber, options) => {
        assert.equal(options?.purpose, "action");
        return repairedPr;
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => ({
        issueComments: [],
        reviews: [],
      }),
    },
    context: createCodexTurnContext({
      state,
      record,
      issue,
      pr: createPullRequest({
        number: 202,
        baseRefName: "main",
        headRefName: branch,
        headRefOid: oldHead,
      }),
      workspaceStatus: { branch, headSha: oldHead },
    }),
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: null,
      command: null,
      details,
      url: null,
      updated_at: "2026-07-11T12:40:00Z",
    }),
    applyFailureSignature: (_current, context) => ({
      last_failure_signature: context?.signature ?? null,
      repeated_failure_signature_count: context ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (current) => ({
      recordForState: current,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      codexConnectorRequestObservationPatch: {},
      copilotRequestObservationPatch: {},
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async ({ error }) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({ branch, headSha: repairedHead }),
    listChangedTrackedFilesBetween: async () => ["src/repaired.ts"],
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair the review.\n"
        : "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair the review.\n- What changed: pushed the review repair.\n";
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-review-102",
      supervisorMessage: "Applied the current-head review repair.",
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Applied the current-head review repair.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "rerun the independent verifier",
        tests: verifierScenario.tests,
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  const updated = state.issues["102"]!;
  assert.equal(updated.state, verifierScenario.preserves ? "blocked" : "pr_open");
  assert.equal(
    updated.blocked_reason,
    verifierScenario.preserves ? "verification" : null,
  );
  assert.equal(updated.pr_number, repairedPr.number);
  assert.equal(updated.last_head_sha, repairedHead);
  assert.equal(
    updated.last_error,
    verifierScenario.preserves ? failureContext.summary : null,
  );
  assert.deepEqual(
    updated.last_failure_context,
    verifierScenario.preserves ? failureContext : null,
  );
  assert.equal(
    updated.last_failure_signature,
    verifierScenario.preserves ? failureContext.signature : null,
  );
  assert.equal(
    updated.repeated_failure_signature_count,
    verifierScenario.preserves ? 2 : 0,
  );
  assert.equal(updated.repeated_blocker_count, verifierScenario.preserves ? 2 : 0);
  assert.equal(
    updated.last_blocker_signature,
    verifierScenario.preserves ? "verification:images" : null,
  );
  assert.equal(
    updated.blocked_verification_retry_count,
    verifierScenario.preserves ? 1 : 0,
  );
});
}
