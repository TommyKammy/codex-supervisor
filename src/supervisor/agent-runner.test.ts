import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  BlockedReason,
  FailureContext,
  FailureKind,
  GitHubIssue,
  GitHubPullRequest,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";
import type {
  AgentRunner,
  AgentRunnerCapabilities,
  AgentTurnContext,
  AgentTurnResult,
  AgentTurnStructuredResult,
  ResumeAgentTurnContext,
  StartAgentTurnContext,
} from "./agent-runner";
import { createCodexAgentRunner, detectCodexCliCapabilities, parseAgentTurnStructuredResult } from "./agent-runner";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

function createStructuredResult(
  overrides: Partial<AgentTurnStructuredResult> = {},
): AgentTurnStructuredResult {
  return {
    summary: "Implemented the requested update.",
    stateHint: "implementing",
    blockedReason: null,
    failureSignature: null,
    nextAction: "Run targeted verification.",
    tests: "not run",
    ...overrides,
  };
}

function createTurnResult(overrides: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    exitCode: 0,
    sessionId: "session-123",
    supervisorMessage: "Summary: Implemented the requested update.",
    stderr: "",
    stdout: "",
    structuredResult: createStructuredResult(),
    failureKind: null,
    failureContext: null,
    ...overrides,
  };
}

async function writeExecutableScript(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

function createStartTurnContext(config: SupervisorConfig): StartAgentTurnContext {
  return {
    kind: "start",
    config,
    workspacePath: "/tmp/workspace",
    state: "repairing_ci",
    record: null,
    repoSlug: config.repoSlug,
    issue: {
      number: 102,
      title: "Normalize the shared agent turn context",
      body: "",
      createdAt: "2026-03-16T00:00:00Z",
      updatedAt: "2026-03-16T00:00:00Z",
      url: "https://example.test/issues/102",
    },
    branch: "codex/issue-102",
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: null,
    failureContext: null,
    previousSummary: null,
    previousError: null,
  };
}

test("agent runner contract normalizes start and resume turn requests", async () => {
  const capabilities: AgentRunnerCapabilities = {
    supportsResume: true,
    supportsStructuredResult: true,
  };
  const config = createConfig();
  const seenRequests: AgentTurnContext[] = [];

  const runner: AgentRunner = {
    capabilities,
    async runTurn(request): Promise<AgentTurnResult> {
      seenRequests.push(request);
      return createTurnResult({
        sessionId: request.kind === "resume" ? request.sessionId : "session-new",
      });
    },
  };

  const issue: GitHubIssue = {
    number: 102,
    title: "Normalize the shared agent turn context",
    body: "## Summary\nUse the normalized supervisor-facing input shape.",
    createdAt: "2026-03-16T00:00:00Z",
    updatedAt: "2026-03-16T00:00:00Z",
    url: "https://example.test/issues/102",
  };
  const pr: GitHubPullRequest = {
    number: 116,
    title: "Normalize the shared agent turn context",
    url: "https://example.test/pull/116",
    state: "OPEN",
    createdAt: "2026-03-16T00:00:00Z",
    isDraft: true,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "DIRTY",
    headRefName: "codex/issue-102",
    headRefOid: "head-123",
  };
  const checks: PullRequestCheck[] = [
    {
      name: "build",
      state: "SUCCESS",
      bucket: "pass",
    },
  ];
  const reviewThreads: ReviewThread[] = [
    {
      id: "thread-1",
      isResolved: false,
      isOutdated: false,
      path: "src/index.ts",
      line: 12,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Please tighten the contract.",
            createdAt: "2026-03-16T00:00:00Z",
            url: "https://example.test/pull/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];
  const failureContext: FailureContext = {
    category: "codex",
    summary: "Previous run exited non-zero.",
    signature: "codex-exit",
    command: "codex exec",
    details: ["non-zero exit code"],
    url: null,
    updated_at: "2026-03-16T00:00:00Z",
  };

  const startRequest: StartAgentTurnContext = {
    kind: "start",
    config,
    workspacePath: "/tmp/workspace",
    state: "reproducing",
    record: {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
    },
    repoSlug: config.repoSlug,
    issue,
    branch: "codex/issue-102",
    pr,
    checks,
    reviewThreads,
    alwaysReadFiles: ["/tmp/AGENTS.generated.md"],
    onDemandMemoryFiles: ["/tmp/README.md"],
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: "## Codex Working Notes\n### Current Handoff\n- Hypothesis: tighten the contract.\n",
    failureContext,
    previousSummary: "Prior attempt reproduced the mismatch.",
    previousError: "resume unsupported",
    gsdEnabled: false,
    gsdPlanningFiles: [],
  };
  const resumeRequest: ResumeAgentTurnContext = {
    kind: "resume",
    config,
    workspacePath: "/tmp/workspace",
    state: "implementing",
    sessionId: "session-123",
    record: null,
    repoSlug: config.repoSlug,
    issue,
    branch: "codex/issue-102",
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: "## Codex Working Notes\n### Current Handoff\n- Next exact step: continue.\n",
    failureContext,
    previousSummary: "Prior attempt reproduced the mismatch.",
    previousError: "resume unsupported",
  };

  const startResult = await runner.runTurn(startRequest);
  const resumeResult = await runner.runTurn(resumeRequest);

  assert.deepEqual(seenRequests, [startRequest, resumeRequest]);
  assert.equal(startResult.sessionId, "session-new");
  assert.equal(resumeResult.sessionId, "session-123");
  assert.equal(runner.capabilities.supportsResume, true);
  assert.equal(runner.capabilities.supportsStructuredResult, true);
});

test("agent turn result supports both parsed and raw supervisor output", () => {
  const rawOnlyResult: AgentTurnResult = createTurnResult({
    supervisorMessage: "Summary: waiting on verification",
    structuredResult: null,
    failureKind: "codex_exit",
    failureContext: {
      category: "codex",
      summary: "Runner exited non-zero.",
      signature: "codex-exit",
      command: "agent exec",
      details: ["non-zero exit code"],
      url: null,
      updated_at: "2026-03-16T00:00:00Z",
    },
  });
  const parsedResult: AgentTurnResult = createTurnResult({
    structuredResult: createStructuredResult({
      stateHint: "blocked",
      blockedReason: "verification",
      failureSignature: "missing-test",
    }),
  });

  assert.equal(rawOnlyResult.structuredResult, null);
  assert.equal(rawOnlyResult.failureKind, "codex_exit");
  assert.equal(parsedResult.structuredResult?.stateHint, "blocked");
  assert.equal(parsedResult.structuredResult?.blockedReason, "verification");
  assert.equal(parsedResult.structuredResult?.failureSignature, "missing-test");
});

test("parseAgentTurnStructuredResult only keeps canonical blocked and failure fields for blocked or failed hints", () => {
  const implementing = parseAgentTurnStructuredResult([
    "Summary: making progress",
    "State hint: implementing",
    "Blocked reason: verification",
    "Failure signature: should-not-apply",
    "Tests: not run",
    "Next action: continue",
  ].join("\n"));
  const blocked = parseAgentTurnStructuredResult([
    "Summary: waiting on verification",
    "State hint: blocked",
    "Blocked reason: verification",
    "Failure signature: missing-test",
  ].join("\n"));
  const failed = parseAgentTurnStructuredResult([
    "Summary: implementation failed",
    "State hint: failed",
    "Blocked reason: verification",
    "Failure signature: compile-error",
  ].join("\n"));

  assert.deepEqual(implementing, {
    summary: "making progress",
    stateHint: "implementing",
    blockedReason: null,
    failureSignature: null,
    nextAction: "continue",
    tests: "not run",
  });
  assert.equal(blocked?.blockedReason, "verification");
  assert.equal(blocked?.failureSignature, "missing-test");
  assert.equal(failed?.blockedReason, null);
  assert.equal(failed?.failureSignature, "compile-error");
});

test("createCodexAgentRunner adapts normalized start and resume turn contexts to Codex CLI turns", async () => {
  const config = createConfig();
  const issue: GitHubIssue = {
    number: 102,
    title: "Normalize the shared agent turn context",
    body: "## Summary\nUse the normalized supervisor-facing input shape.",
    createdAt: "2026-03-16T00:00:00Z",
    updatedAt: "2026-03-16T00:00:00Z",
    url: "https://example.test/issues/102",
  };
  const pr: GitHubPullRequest = {
    number: 116,
    title: "Normalize the shared agent turn context",
    url: "https://example.test/pull/116",
    state: "OPEN",
    createdAt: "2026-03-16T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-102",
    headRefOid: "head-123",
  };
  const seenCalls: Array<{
    workspacePath: string;
    prompt: string;
    state: RunState;
    record:
      | {
          repeated_failure_signature_count: number;
          blocked_verification_retry_count: number;
          timeout_retry_count: number;
        }
      | null
      | undefined;
    sessionId: string | null | undefined;
  }> = [];
  const runner = createCodexAgentRunner({
    runCodexTurnImpl: async (_config, workspacePath, prompt, state, record, sessionId) => {
      seenCalls.push({
        workspacePath,
        prompt,
        state,
        record,
        sessionId,
      });
      return {
        exitCode: sessionId ? 1 : 0,
        sessionId: sessionId ?? "session-new",
        lastMessage: [
          "Summary: Codex adapter result",
          `State hint: ${sessionId ? "blocked" : "implementing"}`,
          `Blocked reason: ${sessionId ? "verification" : "none"}`,
          "Failure signature: reproduced-contract-gap",
          "Tests: npx tsx --test src/supervisor/agent-runner.test.ts",
          "Next action: continue with focused verification",
        ].join("\n"),
        stderr: sessionId ? "resume failed" : "",
        stdout: sessionId ? "resume output" : "fresh output",
      };
    },
  });

  const startResult = await runner.runTurn({
    kind: "start",
    config,
    workspacePath: "/tmp/workspace",
    state: "reproducing",
    record: {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
    },
    repoSlug: config.repoSlug,
    issue,
    branch: "codex/issue-102",
    pr,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: ["/tmp/AGENTS.generated.md"],
    onDemandMemoryFiles: ["/tmp/README.md"],
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: "## Codex Working Notes\n### Current Handoff\n- Hypothesis: use the new context.\n",
    failureContext: null,
    previousSummary: null,
    previousError: null,
    gsdEnabled: false,
    gsdPlanningFiles: [],
  });
  const resumeResult = await runner.runTurn({
    kind: "resume",
    config,
    workspacePath: "/tmp/workspace",
    state: "implementing",
    sessionId: "session-123",
    record: null,
    repoSlug: config.repoSlug,
    issue,
    branch: "codex/issue-102",
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: [
      "## Codex Working Notes",
      "### Current Handoff",
      "- What changed: agent turn context reached the runner.",
      "- Next exact step: continue from the saved session.",
    ].join("\n"),
    failureContext: null,
    previousSummary: "agent turn context reached the runner",
    previousError: null,
  });

  assert.equal(runner.capabilities.supportsResume, true);
  assert.equal(runner.capabilities.supportsStructuredResult, true);
  assert.equal(seenCalls.length, 2);
  assert.equal(seenCalls[0]?.workspacePath, "/tmp/workspace");
  assert.equal(seenCalls[0]?.state, "reproducing");
  assert.deepEqual(seenCalls[0]?.record, {
    repeated_failure_signature_count: 0,
    blocked_verification_retry_count: 0,
    timeout_retry_count: 0,
  });
  assert.equal(seenCalls[0]?.sessionId, undefined);
  assert.equal(seenCalls[1]?.workspacePath, "/tmp/workspace");
  assert.equal(seenCalls[1]?.state, "implementing");
  assert.equal(seenCalls[1]?.record, null);
  assert.equal(seenCalls[1]?.sessionId, "session-123");
  assert.match(seenCalls[0]!.prompt, /Current issue: #102 Normalize the shared agent turn context/);
  assert.match(seenCalls[0]!.prompt, /Use the normalized supervisor-facing input shape\./);
  assert.match(seenCalls[1]!.prompt, /Resume only from the current durable state below\./);
  assert.match(seenCalls[1]!.prompt, /agent turn context reached the runner/);
  assert.equal(startResult.sessionId, "session-new");
  assert.equal(startResult.failureKind, null);
  assert.equal(startResult.structuredResult?.summary, "Codex adapter result");
  assert.equal(startResult.structuredResult?.stateHint, "implementing");
  assert.equal(startResult.structuredResult?.blockedReason, null);
  assert.equal(startResult.structuredResult?.tests, "npx tsx --test src/supervisor/agent-runner.test.ts");
  assert.equal(resumeResult.sessionId, "session-123");
  assert.equal(resumeResult.failureKind, "codex_exit");
  assert.equal(resumeResult.structuredResult, null);
  assert.match(resumeResult.failureContext?.summary ?? "", /exited non-zero/i);
});

test("createCodexAgentRunner normalizes Codex execution errors into the shared failure shape", async () => {
  const runner = createCodexAgentRunner({
    runCodexTurnImpl: async () => {
      throw new Error("Command timed out after 1800000ms");
    },
  });

  const result = await runner.runTurn({
    kind: "start",
    config: createConfig(),
    workspacePath: "/tmp/workspace",
    state: "repairing_ci",
    record: null,
    repoSlug: "owner/repo",
    issue: {
      number: 102,
      title: "Normalize the shared agent turn context",
      body: "",
      createdAt: "2026-03-16T00:00:00Z",
      updatedAt: "2026-03-16T00:00:00Z",
      url: "https://example.test/issues/102",
    },
    branch: "codex/issue-102",
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: null,
    failureContext: null,
    previousSummary: null,
    previousError: null,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.sessionId, null);
  assert.equal(result.structuredResult, null);
  assert.equal(result.failureKind, "timeout");
  assert.equal(result.failureContext?.category, "codex");
  assert.match(result.failureContext?.details[0] ?? "", /Command timed out after 1800000ms/);
});

test("createCodexAgentRunner preserves bounded noisy stderr for real non-zero Codex subprocess exits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-runner-test-"));
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex.sh");
  await fs.mkdir(workspacePath, { recursive: true });

  await writeExecutableScript(
    codexBinary,
    `#!/bin/sh
exec "${process.execPath}" -e '
const fs = require("node:fs");
const args = process.argv.slice(1);
let out = "";
const writeStderr = (chunk) =>
  new Promise((resolve, reject) => {
    process.stderr.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o") {
    out = args[i + 1] || "";
    i += 1;
  }
}
fs.writeFileSync(out, [
  "Summary: noisy non-zero subprocess",
  "State hint: failed",
  "Failure signature: real-noisy-exit",
  "Next action: inspect bounded stderr",
].join("\\n"));
(async () => {
  await writeStderr("stderr-prefix\\n");
  for (let i = 0; i < 200; i += 1) {
    await writeStderr("e".repeat(1000));
  }
  await writeStderr("\\nstderr-suffix\\n");
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' "$@"
`,
  );

  const config = createConfig({ codexBinary });
  const runner = createCodexAgentRunner({ config });
  const result = await runner.runTurn({
    ...createStartTurnContext(config),
    workspacePath,
  });

  assert.equal(result.failureKind, "codex_exit");
  assert.match(result.stderr, /stderr-prefix/);
  assert.match(result.stderr, /stderr-suffix/);
  assert.match(result.stderr, /\n\.\.\.\n/);
  assert.match(result.failureContext?.details[0] ?? "", /stderr-prefix/);
  assert.match(result.failureContext?.details[0] ?? "", /stderr-suffix/);
  assert.match(result.failureContext?.details[0] ?? "", /\n\.\.\.\n/);
});

test("createCodexAgentRunner preserves timeout summaries for real Codex subprocess timeouts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-runner-test-"));
  const workspacePath = path.join(root, "workspace");
  const codexBinary = path.join(root, "fake-codex-timeout.sh");
  await fs.mkdir(workspacePath, { recursive: true });

  await writeExecutableScript(
    codexBinary,
    `#!/bin/sh
exec "${process.execPath}" -e '
const fs = require("node:fs");
const args = process.argv.slice(1);
let out = "";
const writeStderr = (chunk) =>
  new Promise((resolve, reject) => {
    process.stderr.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o") {
    out = args[i + 1] || "";
    i += 1;
  }
}
fs.writeFileSync(out, "Summary: noisy timeout subprocess\\nState hint: failed\\n");
void (async () => {
  await writeStderr("timeout-prefix\\n");
  for (let i = 0; i < 200; i += 1) {
    await writeStderr("t".repeat(1000));
  }
  await writeStderr("\\ntimeout-suffix\\n");
  setInterval(() => {}, 1000);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' "$@"
`,
  );

  const config = createConfig({
    codexBinary,
    codexExecTimeoutMinutes: 0.001,
  });
  const runner = createCodexAgentRunner({ config });
  const result = await runner.runTurn({
    ...createStartTurnContext(config),
    workspacePath,
  });

  assert.equal(result.failureKind, "timeout");
  assert.equal(result.failureContext?.summary, "Codex turn execution failed.");
  assert.match(result.stderr, /Command timed out after 60ms:/);
  assert.match(result.failureContext?.details[0] ?? "", /Command timed out after 60ms:/);
  assert.match(result.failureContext?.details[0] ?? "", /CommandExecutionError:/);
});

test("createCodexAgentRunner preserves timeout summaries when non-zero Codex stderr is still noisy after bounded capture", async () => {
  const runner = createCodexAgentRunner({
    runCodexTurnImpl: async () => ({
      exitCode: 1,
      sessionId: "session-123",
      lastMessage: "Summary: bounded stderr still needs an actionable summary",
      stderr: `prefix\n${"x".repeat(5_000)}\nCommand timed out after 1800000ms: codex exec\n`,
      stdout: "",
    }),
  });

  const result = await runner.runTurn({
    kind: "start",
    config: createConfig(),
    workspacePath: "/tmp/workspace",
    state: "repairing_ci",
    record: null,
    repoSlug: "owner/repo",
    issue: {
      number: 102,
      title: "Normalize the shared agent turn context",
      body: "",
      createdAt: "2026-03-16T00:00:00Z",
      updatedAt: "2026-03-16T00:00:00Z",
      url: "https://example.test/issues/102",
    },
    branch: "codex/issue-102",
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspace/.codex-supervisor/issue-journal.md",
    journalExcerpt: null,
    failureContext: null,
    previousSummary: null,
    previousError: null,
  });

  assert.equal(result.failureKind, "codex_exit");
  assert.match(result.failureContext?.details[0] ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(result.failureContext?.details[0] ?? "", /\n\.\.\.\n/);
});

test("detectCodexCliCapabilities keeps Codex-compatible defaults conservative for non-codex binaries", () => {
  assert.deepEqual(detectCodexCliCapabilities({ codexBinary: "/usr/local/bin/codex" }), {
    supportsResume: true,
    supportsStructuredResult: true,
  });
  assert.deepEqual(detectCodexCliCapabilities({ codexBinary: "/usr/local/bin/custom-agent" }), {
    supportsResume: false,
    supportsStructuredResult: false,
  });
});

void ([
  "queued",
  "reproducing",
  "implementing",
  "blocked",
  "failed",
] satisfies RunState[]);
void ([null, "verification", "unknown"] satisfies BlockedReason[]);
void ([null, "command_error", "codex_exit"] satisfies FailureKind[]);
