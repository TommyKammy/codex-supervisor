import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupReadinessReport } from "../setup-readiness";
import type { SetupConfigPreview } from "../setup-config-preview";
import type { SetupConfigUpdateResult } from "../setup-config-write";
import { buildActiveIssueChangedEvent, type SupervisorEvent, type SupervisorEventSink } from "../supervisor";
import type { SupervisorService } from "../supervisor";
import { createSupervisorHttpServer } from "./supervisor-http-server";

async function readJson(args: {
  server: http.Server;
  path: string;
  method?: string;
  body?: string;
  headers?: http.OutgoingHttpHeaders;
}): Promise<{ statusCode: number; body: unknown }> {
  const address = args.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }

  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: args.path,
        method: args.method ?? "GET",
        agent: false,
        headers: {
          ...(args.body ? { "Content-Length": Buffer.byteLength(args.body) } : {}),
          ...args.headers,
        },
      },
      (response) => {
        let payload = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          payload += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(payload),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    if (args.body) {
      request.write(args.body);
    }
    request.end();
  });
}

interface ReadSseEventResult {
  id: string | null;
  event: string | null;
  data: string[];
  comments: string[];
}

async function openSseStream(args: {
  server: http.Server;
  path: string;
  lastEventId?: string;
}): Promise<http.IncomingMessage> {
  const address = args.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }

  return await new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: args.path,
      method: "GET",
      agent: false,
      headers: args.lastEventId ? { "Last-Event-ID": args.lastEventId } : undefined,
    });
    request.on("response", resolve);
    request.on("error", reject);
    request.end();
  });
}

async function readSseEvent(response: http.IncomingMessage): Promise<ReadSseEventResult> {
  let buffer = "";

  return await new Promise((resolve, reject) => {
    const consume = () => {
      let chunk: string | null;
      while ((chunk = response.read() as string | null) !== null) {
        buffer += chunk;
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          continue;
        }

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        response.off("readable", consume);
        response.off("error", onError);
        response.off("end", onEnd);

        let id: string | null = null;
        let event: string | null = null;
        const data: string[] = [];
        const comments: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith(":")) {
            comments.push(line.slice(1).trimStart());
            continue;
          }
          if (line.startsWith("id:")) {
            id = line.slice(3).trimStart();
            continue;
          }
          if (line.startsWith("event:")) {
            event = line.slice(6).trimStart();
            continue;
          }
          if (line.startsWith("data:")) {
            data.push(line.slice(5).trimStart());
            continue;
          }
        }

        resolve({ id, event, data, comments });
        return;
      }
    };

    const onError = (error: Error) => {
      response.off("readable", consume);
      response.off("error", onError);
      response.off("end", onEnd);
      reject(error);
    };

    const onEnd = () => {
      response.off("readable", consume);
      response.off("error", onError);
      response.off("end", onEnd);
      reject(new Error("SSE stream ended before the next event."));
    };

    response.setEncoding("utf8");
    response.on("readable", consume);
    response.on("error", onError);
    response.on("end", onEnd);
    consume();
  });
}

async function closeResponse(response: http.IncomingMessage): Promise<void> {
  if (response.destroyed) {
    return;
  }

  await new Promise<void>((resolve) => {
    response.once("close", () => resolve());
    response.destroy();
  });
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createStubService(args?: {
  statusWhyCalls?: boolean[];
  explainCalls?: number[];
  issueLintCalls?: number[];
  setupReadinessCalls?: number;
  setupReadinessReport?: SetupReadinessReport;
  setupConfigPreviewCalls?: Array<string | null>;
  setupConfigPreview?: SetupConfigPreview;
  setupConfigUpdateCalls?: Array<unknown>;
  setupConfigUpdateResult?: SetupConfigUpdateResult;
  runOnceDryRunCalls?: boolean[];
  recoveryCalls?: { action: string; issueNumber: number }[];
  pruneCalls?: number;
  resetCalls?: number;
  subscribeEventCalls?: number;
}): SupervisorService {
  const doctorDiagnostics: DoctorDiagnostics = {
    overallStatus: "pass",
    checks: [
      {
        name: "github_auth",
        status: "pass",
        summary: "GitHub auth ok.",
        details: [],
      },
    ],
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
    },
    cadenceDiagnostics: {
      pollIntervalSeconds: 60,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 60,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  };
  const setupReadinessReport: SetupReadinessReport = args?.setupReadinessReport ?? {
    kind: "setup_readiness",
    ready: false,
    overallStatus: "missing",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoSlug",
        label: "Repository slug",
        state: "configured",
        value: "owner/repo",
        message: "Repository slug is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "repo_slug",
        },
      },
      {
        key: "reviewProvider",
        label: "Review provider",
        state: "missing",
        value: null,
        message: "Configure at least one review provider before first-run setup is complete.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "review_provider",
        },
      },
    ],
    blockers: [
      {
        code: "missing_review_provider",
        message: "Configure at least one review provider before first-run setup is complete.",
        fieldKeys: ["reviewProvider"],
        remediation: {
          kind: "configure_review_provider",
          summary: "Configure at least one review provider before first-run setup is complete.",
          fieldKeys: ["reviewProvider"],
        },
      },
    ],
    hostReadiness: {
      overallStatus: "pass",
      checks: [
        {
          name: "github_auth",
          status: "pass",
          summary: "GitHub auth ok.",
          details: [],
        },
      ],
    },
    providerPosture: {
      profile: "none",
      provider: "none",
      reviewers: [],
      signalSource: "none",
      configured: false,
      summary: "No review provider is configured.",
    },
    trustPosture: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
  };
  const setupConfigPreview: SetupConfigPreview = args?.setupConfigPreview ?? {
    kind: "setup_config_preview",
    mode: "patch",
    configPath: "/tmp/supervisor.config.json",
    writesConfig: false,
    selectedReviewProviderProfile: "codex",
    supportedReviewProviderProfiles: [
      {
        id: "none",
        label: "No provider selected yet",
        reviewBotLogins: [],
      },
      {
        id: "copilot",
        label: "GitHub Copilot",
        reviewBotLogins: ["copilot-pull-request-reviewer"],
      },
      {
        id: "codex",
        label: "Codex Connector",
        reviewBotLogins: ["chatgpt-codex-connector"],
      },
      {
        id: "coderabbit",
        label: "CodeRabbit",
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      },
    ],
    preservedUnknownFields: ["experimentalFlag"],
    document: {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "/tmp/worktrees",
      stateFile: "/tmp/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      reviewBotLogins: ["chatgpt-codex-connector"],
      experimentalFlag: true,
    },
    fieldChanges: [
      {
        key: "reviewProvider",
        label: "Review provider",
        currentValue: null,
        previewValue: ["chatgpt-codex-connector"],
        source: "selected_review_provider_profile",
        state: "suggested",
        summary: "Applies the Codex Connector review provider profile.",
      },
    ],
    validation: {
      status: "ready",
      missingRequiredFields: [],
      invalidFields: [],
      error: null,
    },
  };
  const setupConfigUpdateResult: SetupConfigUpdateResult = args?.setupConfigUpdateResult ?? {
    kind: "setup_config_update",
    configPath: "/tmp/supervisor.config.json",
    backupPath: "/tmp/supervisor.config.json.bak",
    updatedFields: ["reviewProvider"],
    document: {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "/tmp/worktrees",
      stateFile: "/tmp/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      reviewBotLogins: ["chatgpt-codex-connector"],
      experimentalFlag: true,
    },
    readiness: setupReadinessReport,
  };

  const eventSubscribers = new Set<SupervisorEventSink>();

  return {
    config: {} as SupervisorService["config"],
    pollIntervalMs: async () => 60_000,
    runOnce: async ({ dryRun }) => {
      args?.runOnceDryRunCalls?.push(dryRun);
      return "run-once complete";
    },
    queryStatus: async ({ why }) => {
      args?.statusWhyCalls?.push(why);
      return {
        gsdSummary: null,
        trustDiagnostics: {
          trustMode: "trusted_repo_and_authors",
          executionSafetyMode: "unsandboxed_autonomous",
          warning: null,
        },
        cadenceDiagnostics: {
          pollIntervalSeconds: 60,
          mergeCriticalRecheckSeconds: null,
          mergeCriticalEffectiveSeconds: 60,
          mergeCriticalRecheckEnabled: false,
        },
        candidateDiscoverySummary: null,
        candidateDiscovery: {
          fetchWindow: 100,
          strategy: "paginated",
          truncated: false,
          observedMatchingOpenIssues: null,
          warning: null,
        },
        activeIssue: null,
        selectionSummary: {
          selectedIssueNumber: null,
          selectionReason: why ? "no_runnable_issue" : null,
        },
        trackedIssues: [],
        runnableIssues: [],
        blockedIssues: [],
        detailedStatusLines: ["tracked_issues=0"],
        reconciliationPhase: null,
        reconciliationWarning: null,
        readinessLines: [],
        whyLines: why ? ["selected_issue=none"] : [],
        warning: null,
      };
    },
    runRecoveryAction: async (action, issueNumber) => {
      args?.recoveryCalls?.push({ action, issueNumber });
      return {
        action,
        issueNumber,
        outcome: "mutated",
        summary: `Requeued issue #${issueNumber}.`,
        previousState: "blocked",
        previousRecordSnapshot: null,
        nextState: "queued",
        recoveryReason: "operator_requested",
      };
    },
    pruneOrphanedWorkspaces: async () => {
      if (args) {
        args.pruneCalls = (args.pruneCalls ?? 0) + 1;
      }
      return {
        action: "prune-orphaned-workspaces",
        outcome: "completed",
        summary: "Pruned 0 orphaned workspaces.",
        pruned: [],
        skipped: [],
      };
    },
    resetCorruptJsonState: async () => {
      if (args) {
        args.resetCalls = (args.resetCalls ?? 0) + 1;
      }
      return {
        action: "reset-corrupt-json-state",
        outcome: "mutated",
        summary: "Reset corrupt JSON state.",
        stateFile: "/tmp/state.json",
        quarantinedFile: "/tmp/state.json.corrupt",
        quarantinedAt: "2026-03-22T00:00:00.000Z",
      };
    },
    queryExplain: async (issueNumber) => {
      args?.explainCalls?.push(issueNumber);
      return {
        issueNumber,
        title: "Explain issue",
        state: "untracked",
        blockedReason: "none",
        runnable: true,
        changeRiskLines: [],
        externalReviewFollowUpSummary: null,
        latestRecoverySummary: null,
        activityContext: {
          handoffSummary: "blocker: waiting on typed explain activity context",
          localReviewRoutingSummary: null,
          changeClassesSummary: null,
          verificationPolicySummary: null,
          durableGuardrailSummary: null,
          externalReviewFollowUpSummary: null,
          latestRecovery: {
            issueNumber,
            at: "2026-03-22T00:00:00Z",
            reason: "tracked_pr_head_advanced",
            detail: "resumed issue after tracked PR advanced",
          },
          localReviewSummaryPath: null,
          externalReviewMissesPath: null,
          reviewWaits: [],
        },
        selectionReason: "selected for execution",
        reasons: ["selected for execution"],
        lastError: null,
        failureSummary: null,
      };
    },
    queryIssueLint: async (issueNumber) => {
      args?.issueLintCalls?.push(issueNumber);
      return {
        issueNumber,
        title: "Lint issue",
        executionReady: true,
        missingRequired: [],
        missingRecommended: [],
        metadataErrors: [],
        highRiskBlockingAmbiguity: null,
        repairGuidance: [],
      };
    },
    queryDoctor: async () => doctorDiagnostics,
    querySetupReadiness: async () => {
      if (args) {
        args.setupReadinessCalls = (args.setupReadinessCalls ?? 0) + 1;
      }
      return setupReadinessReport;
    },
    querySetupConfigPreview: async ({ reviewProviderProfile }) => {
      args?.setupConfigPreviewCalls?.push(reviewProviderProfile ?? null);
      return setupConfigPreview;
    },
    updateSetupConfig: async (payload) => {
      args?.setupConfigUpdateCalls?.push(payload);
      return setupConfigUpdateResult;
    },
    subscribeEvents: (listener) => {
      if (args) {
        args.subscribeEventCalls = (args.subscribeEventCalls ?? 0) + 1;
      }
      eventSubscribers.add(listener);
      return () => {
        eventSubscribers.delete(listener);
      };
    },
  };
}

test("createSupervisorHttpServer serves read-only supervisor DTOs as JSON", async (t) => {
  const statusWhyCalls: boolean[] = [];
  const explainCalls: number[] = [];
  const issueLintCalls: number[] = [];
  const serviceCallCounts = { setupReadinessCalls: 0 };
  const server = createSupervisorHttpServer({
    service: createStubService({ statusWhyCalls, explainCalls, issueLintCalls, setupReadinessCalls: 0 }),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const statusResponse = await readJson({ server, path: "/api/status?why=true" });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusWhyCalls, [true]);
  assert.deepEqual(statusResponse.body, {
    gsdSummary: null,
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
    },
    cadenceDiagnostics: {
      pollIntervalSeconds: 60,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 60,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: null,
    candidateDiscovery: {
      fetchWindow: 100,
      strategy: "paginated",
      truncated: false,
      observedMatchingOpenIssues: null,
      warning: null,
    },
    activeIssue: null,
    selectionSummary: {
      selectedIssueNumber: null,
      selectionReason: "no_runnable_issue",
    },
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: ["tracked_issues=0"],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: ["selected_issue=none"],
    warning: null,
  });

  const doctorResponse = await readJson({ server, path: "/api/doctor" });
  assert.equal(doctorResponse.statusCode, 200);
  assert.deepEqual(doctorResponse.body, {
    overallStatus: "pass",
    checks: [
      {
        name: "github_auth",
        status: "pass",
        summary: "GitHub auth ok.",
        details: [],
      },
    ],
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
    },
    cadenceDiagnostics: {
      pollIntervalSeconds: 60,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 60,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  });

  const setupReadinessResponse = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(setupReadinessResponse.statusCode, 200);
  assert.deepEqual(setupReadinessResponse.body, {
    kind: "setup_readiness",
    ready: false,
    overallStatus: "missing",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoSlug",
        label: "Repository slug",
        state: "configured",
        value: "owner/repo",
        message: "Repository slug is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "repo_slug",
        },
      },
      {
        key: "reviewProvider",
        label: "Review provider",
        state: "missing",
        value: null,
        message: "Configure at least one review provider before first-run setup is complete.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "review_provider",
        },
      },
    ],
    blockers: [
      {
        code: "missing_review_provider",
        message: "Configure at least one review provider before first-run setup is complete.",
        fieldKeys: ["reviewProvider"],
        remediation: {
          kind: "configure_review_provider",
          summary: "Configure at least one review provider before first-run setup is complete.",
          fieldKeys: ["reviewProvider"],
        },
      },
    ],
    hostReadiness: {
      overallStatus: "pass",
      checks: [
        {
          name: "github_auth",
          status: "pass",
          summary: "GitHub auth ok.",
          details: [],
        },
      ],
    },
    providerPosture: {
      profile: "none",
      provider: "none",
      reviewers: [],
      signalSource: "none",
      configured: false,
      summary: "No review provider is configured.",
    },
    trustPosture: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
  });

  const setupConfigPreviewResponse = await readJson({
    server,
    path: "/api/setup-config-preview?reviewProviderProfile=codex",
  });
  assert.equal(setupConfigPreviewResponse.statusCode, 200);
  assert.deepEqual(setupConfigPreviewResponse.body, {
    kind: "setup_config_preview",
    mode: "patch",
    configPath: "/tmp/supervisor.config.json",
    writesConfig: false,
    selectedReviewProviderProfile: "codex",
    supportedReviewProviderProfiles: [
      {
        id: "none",
        label: "No provider selected yet",
        reviewBotLogins: [],
      },
      {
        id: "copilot",
        label: "GitHub Copilot",
        reviewBotLogins: ["copilot-pull-request-reviewer"],
      },
      {
        id: "codex",
        label: "Codex Connector",
        reviewBotLogins: ["chatgpt-codex-connector"],
      },
      {
        id: "coderabbit",
        label: "CodeRabbit",
        reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      },
    ],
    preservedUnknownFields: ["experimentalFlag"],
    document: {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "/tmp/worktrees",
      stateFile: "/tmp/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      reviewBotLogins: ["chatgpt-codex-connector"],
      experimentalFlag: true,
    },
    fieldChanges: [
      {
        key: "reviewProvider",
        label: "Review provider",
        currentValue: null,
        previewValue: ["chatgpt-codex-connector"],
        source: "selected_review_provider_profile",
        state: "suggested",
        summary: "Applies the Codex Connector review provider profile.",
      },
    ],
    validation: {
      status: "ready",
      missingRequiredFields: [],
      invalidFields: [],
      error: null,
    },
  });

  const explainResponse = await readJson({ server, path: "/api/issues/42/explain" });
  assert.equal(explainResponse.statusCode, 200);
  assert.deepEqual(explainResponse.body, {
    issueNumber: 42,
    title: "Explain issue",
    state: "untracked",
    blockedReason: "none",
    runnable: true,
    changeRiskLines: [],
    externalReviewFollowUpSummary: null,
    latestRecoverySummary: null,
    activityContext: {
      handoffSummary: "blocker: waiting on typed explain activity context",
      localReviewRoutingSummary: null,
      changeClassesSummary: null,
      verificationPolicySummary: null,
      durableGuardrailSummary: null,
      externalReviewFollowUpSummary: null,
      latestRecovery: {
        issueNumber: 42,
        at: "2026-03-22T00:00:00Z",
        reason: "tracked_pr_head_advanced",
        detail: "resumed issue after tracked PR advanced",
      },
      localReviewSummaryPath: null,
      externalReviewMissesPath: null,
      reviewWaits: [],
    },
    selectionReason: "selected for execution",
    reasons: ["selected for execution"],
    lastError: null,
    failureSummary: null,
  });

  const issueLintResponse = await readJson({ server, path: "/api/issues/42/issue-lint" });
  assert.equal(issueLintResponse.statusCode, 200);
  assert.deepEqual(issueLintResponse.body, {
    issueNumber: 42,
    title: "Lint issue",
    executionReady: true,
    missingRequired: [],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [],
  });
  assert.deepEqual(explainCalls, [42]);
  assert.deepEqual(issueLintCalls, [42]);

  const explainZeroResponse = await readJson({ server, path: "/api/issues/0/explain" });
  assert.equal(explainZeroResponse.statusCode, 400);
  assert.deepEqual(explainZeroResponse.body, { error: "Issue number must be a positive integer." });

  const issueLintZeroResponse = await readJson({ server, path: "/api/issues/0/issue-lint" });
  assert.equal(issueLintZeroResponse.statusCode, 400);
  assert.deepEqual(issueLintZeroResponse.body, { error: "Issue number must be a positive integer." });
  assert.deepEqual(explainCalls, [42]);
  assert.deepEqual(issueLintCalls, [42]);
});

test("createSupervisorHttpServer exposes only the safe supervisor mutations over HTTP", async (t) => {
  const runOnceDryRunCalls: boolean[] = [];
  const recoveryCalls: { action: string; issueNumber: number }[] = [];
  const serviceCallCounts = { pruneCalls: 0, resetCalls: 0 };
  const server = createSupervisorHttpServer({
    service: createStubService({
      runOnceDryRunCalls,
      recoveryCalls,
      ...serviceCallCounts,
    }),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const runOnceResponse = await readJson({
    server,
    path: "/api/commands/run-once",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(runOnceResponse.statusCode, 200);
  assert.deepEqual(runOnceDryRunCalls, [true]);
  assert.deepEqual(runOnceResponse.body, {
    command: "run-once",
    dryRun: true,
    summary: "run-once complete",
  });

  const requeueResponse = await readJson({
    server,
    path: "/api/commands/requeue",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueNumber: 42 }),
  });
  assert.equal(requeueResponse.statusCode, 200);
  assert.deepEqual(recoveryCalls, [{ action: "requeue", issueNumber: 42 }]);
  assert.deepEqual(requeueResponse.body, {
    action: "requeue",
    issueNumber: 42,
    outcome: "mutated",
    summary: "Requeued issue #42.",
    previousState: "blocked",
    previousRecordSnapshot: null,
    nextState: "queued",
    recoveryReason: "operator_requested",
  });

  const pruneResponse = await readJson({
    server,
    path: "/api/commands/prune-orphaned-workspaces",
    method: "POST",
  });
  assert.equal(pruneResponse.statusCode, 200);
  assert.deepEqual(pruneResponse.body, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 0 orphaned workspaces.",
    pruned: [],
    skipped: [],
  });

  const resetResponse = await readJson({
    server,
    path: "/api/commands/reset-corrupt-json-state",
    method: "POST",
  });
  assert.equal(resetResponse.statusCode, 200);
  assert.deepEqual(resetResponse.body, {
    action: "reset-corrupt-json-state",
    outcome: "mutated",
    summary: "Reset corrupt JSON state.",
    stateFile: "/tmp/state.json",
    quarantinedFile: "/tmp/state.json.corrupt",
    quarantinedAt: "2026-03-22T00:00:00.000Z",
  });

  const invalidRequeueResponse = await readJson({
    server,
    path: "/api/commands/requeue",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueNumber: 0 }),
  });
  assert.equal(invalidRequeueResponse.statusCode, 400);
  assert.deepEqual(invalidRequeueResponse.body, { error: "Issue number must be a positive integer." });

  const blockedCommandResponse = await readJson({
    server,
    path: "/api/commands/loop",
    method: "POST",
  });
  assert.equal(blockedCommandResponse.statusCode, 404);
  assert.deepEqual(blockedCommandResponse.body, { error: "Not found." });

  const wrongMethodResponse = await readJson({
    server,
    path: "/api/commands/run-once",
  });
  assert.equal(wrongMethodResponse.statusCode, 405);
  assert.deepEqual(wrongMethodResponse.body, { error: "Method not allowed." });
});

test("createSupervisorHttpServer accepts narrow setup config writes and returns refreshed readiness", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const response = await readJson({
    server,
    path: "/api/setup-config",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      changes: {
        reviewProvider: "codex",
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(setupConfigUpdateCalls, [
    {
      changes: {
        reviewProvider: "codex",
      },
    },
  ]);
  assert.deepEqual(response.body, {
    kind: "setup_config_update",
    configPath: "/tmp/supervisor.config.json",
    backupPath: "/tmp/supervisor.config.json.bak",
    updatedFields: ["reviewProvider"],
    document: {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "/tmp/worktrees",
      stateFile: "/tmp/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      reviewBotLogins: ["chatgpt-codex-connector"],
      experimentalFlag: true,
    },
    readiness: {
      kind: "setup_readiness",
      ready: false,
      overallStatus: "missing",
      configPath: "/tmp/supervisor.config.json",
      fields: [
        {
          key: "repoSlug",
          label: "Repository slug",
          state: "configured",
          value: "owner/repo",
          message: "Repository slug is configured.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "repo_slug",
          },
        },
        {
          key: "reviewProvider",
          label: "Review provider",
          state: "missing",
          value: null,
          message: "Configure at least one review provider before first-run setup is complete.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "review_provider",
          },
        },
      ],
      blockers: [
        {
          code: "missing_review_provider",
          message: "Configure at least one review provider before first-run setup is complete.",
          fieldKeys: ["reviewProvider"],
          remediation: {
            kind: "configure_review_provider",
            summary: "Configure at least one review provider before first-run setup is complete.",
            fieldKeys: ["reviewProvider"],
          },
        },
      ],
      hostReadiness: {
        overallStatus: "pass",
        checks: [
          {
            name: "github_auth",
            status: "pass",
            summary: "GitHub auth ok.",
            details: [],
          },
        ],
      },
      providerPosture: {
        profile: "none",
        provider: "none",
        reviewers: [],
        signalSource: "none",
        configured: false,
        summary: "No review provider is configured.",
      },
      trustPosture: {
        trustMode: "trusted_repo_and_authors",
        executionSafetyMode: "unsandboxed_autonomous",
        warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
        summary: "Trusted inputs with unsandboxed autonomous execution.",
      },
    },
  });
});

test("createSupervisorHttpServer rejects malformed setup config write requests before calling the service", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const response = await readJson({
    server,
    path: "/api/setup-config",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewProvider: "codex" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Request body must include a changes object." });
  assert.deepEqual(setupConfigUpdateCalls, []);
});

test("createSupervisorHttpServer serves a dashboard shell with only the safe operator command actions", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService(),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/dashboard",
        method: "GET",
        agent: false,
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });

  let html = "";
  response.setEncoding("utf8");
  for await (const chunk of response) {
    html += chunk;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.match(html, /<title>codex-supervisor operator dashboard<\/title>/i);
  assert.match(html, /data-dashboard-root/u);
  assert.match(html, /\/api\/status\?why=true/u);
  assert.match(html, /\/api\/doctor/u);
  assert.match(html, /\/api\/events/u);
  assert.match(html, /\/api\/commands\/run-once/u);
  assert.match(html, /\/api\/commands\/requeue/u);
  assert.match(html, /\/api\/commands\/prune-orphaned-workspaces/u);
  assert.match(html, /\/api\/commands\/reset-corrupt-json-state/u);
  assert.doesNotMatch(html, /\/api\/commands\/loop/u);
  assert.match(html, /load issue details/iu);
  assert.match(html, /operator actions/iu);
  assert.match(html, /confirm/i);
  assert.match(html, /command result/iu);
  assert.match(html, /live events/iu);
  assert.match(html, /operator timeline/iu);
});

test("createSupervisorHttpServer serves a dedicated setup shell and keeps the dashboard on its own route", async (t) => {
  const serviceCallCounts = { setupReadinessCalls: 0 };
  const server = createSupervisorHttpServer({
    service: createStubService(serviceCallCounts),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }
  const port = address.port;

  async function readHtml(path: string): Promise<string> {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "GET",
          agent: false,
        },
        resolve,
      );
      request.on("error", reject);
      request.end();
    });

    let html = "";
    response.setEncoding("utf8");
    for await (const chunk of response) {
      html += chunk;
    }
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    return html;
  }

  const rootHtml = await readHtml("/");
  const setupHtml = await readHtml("/setup");
  const dashboardHtml = await readHtml("/dashboard");

  assert.equal(serviceCallCounts.setupReadinessCalls, 1);
  assert.match(rootHtml, /<title>codex-supervisor setup<\/title>/i);
  assert.match(rootHtml, /data-setup-root/u);
  assert.match(rootHtml, /\/api\/setup-readiness/u);
  assert.doesNotMatch(rootHtml, /\/api\/status\?why=true/u);
  assert.match(setupHtml, /<title>codex-supervisor setup<\/title>/i);
  assert.match(dashboardHtml, /<title>codex-supervisor operator dashboard<\/title>/i);
  assert.match(dashboardHtml, /data-dashboard-root/u);
});

test("createSupervisorHttpServer keeps root on the operator dashboard after setup is configured", async (t) => {
  const serviceArgs: { setupReadinessCalls: number; setupReadinessReport: SetupReadinessReport } = {
    setupReadinessCalls: 0,
    setupReadinessReport: {
      kind: "setup_readiness",
      ready: true,
      overallStatus: "configured",
      configPath: "/tmp/supervisor.config.json",
      fields: [],
      blockers: [],
      hostReadiness: {
        overallStatus: "pass",
        checks: [],
      },
      providerPosture: {
        profile: "codex",
        provider: "codex",
        reviewers: ["codex"],
        signalSource: "reviewBotLogins",
        configured: true,
        summary: "Review provider posture uses codex via reviewBotLogins.",
      },
      trustPosture: {
        trustMode: "trusted_repo_and_authors",
        executionSafetyMode: "unsandboxed_autonomous",
        warning: null,
        summary: "Trusted inputs with unsandboxed autonomous execution.",
      },
    },
  };
  const server = createSupervisorHttpServer({
    service: createStubService(serviceArgs),
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/",
        method: "GET",
        agent: false,
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });

  let html = "";
  response.setEncoding("utf8");
  for await (const chunk of response) {
    html += chunk;
  }

  assert.equal(serviceArgs.setupReadinessCalls, 1);
  assert.equal(response.statusCode, 200);
  assert.match(html, /<title>codex-supervisor operator dashboard<\/title>/i);
  assert.match(html, /data-dashboard-root/u);
  assert.doesNotMatch(html, /data-setup-root/u);
});

test("createSupervisorHttpServer streams supervisor events over SSE with reconnect replay", async (t) => {
  let subscribeEventCalls = 0;
  const eventEmitter: { current: ((event: SupervisorEvent) => void) | null } = { current: null };
  const server = createSupervisorHttpServer({
    service: {
      ...createStubService({ subscribeEventCalls }),
      subscribeEvents: (listener) => {
        subscribeEventCalls += 1;
        eventEmitter.current = listener;
        return () => {
          if (eventEmitter.current === listener) {
            eventEmitter.current = null;
          }
        };
      },
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const response = await openSseStream({ server, path: "/api/events" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-cache, no-transform");
  assert.equal(response.headers.connection, "keep-alive");
  assert.equal(subscribeEventCalls, 1);

  const firstEventPromise = readSseEvent(response);
  const emitEvent = eventEmitter.current;
  if (!emitEvent) {
    throw new Error("Expected the SSE adapter to subscribe to supervisor events.");
  }
  emitEvent(buildActiveIssueChangedEvent({
    issueNumber: 42,
    previousIssueNumber: null,
    nextIssueNumber: 42,
    reason: "reserved_for_cycle",
    at: "2026-03-22T00:00:00.000Z",
  }));
  const firstEvent = await firstEventPromise;
  assert.equal(firstEvent.id, "1");
  assert.equal(firstEvent.event, "supervisor.active_issue.changed");
  assert.deepEqual(firstEvent.data, [
    JSON.stringify({
      type: "supervisor.active_issue.changed",
      family: "active_issue",
      issueNumber: 42,
      previousIssueNumber: null,
      nextIssueNumber: 42,
      reason: "reserved_for_cycle",
      at: "2026-03-22T00:00:00.000Z",
    }),
  ]);
  assert.deepEqual(firstEvent.comments, []);

  await closeResponse(response);

  const replayResponse = await openSseStream({
    server,
    path: "/api/events",
    lastEventId: "0",
  });

  assert.equal(replayResponse.statusCode, 200);
  assert.equal(subscribeEventCalls, 1);

  const replayedEvent = await readSseEvent(replayResponse);
  assert.equal(replayedEvent.id, "1");
  assert.equal(replayedEvent.event, "supervisor.active_issue.changed");
  assert.deepEqual(replayedEvent.data, firstEvent.data);
  assert.deepEqual(replayedEvent.comments, []);
  await closeResponse(replayResponse);
  await closeServer(server);
});

test("createSupervisorHttpServer starts fresh SSE connections at the live edge", async (t) => {
  const eventEmitter: { current: ((event: SupervisorEvent) => void) | null } = { current: null };
  const server = createSupervisorHttpServer({
    service: {
      ...createStubService(),
      subscribeEvents: (listener) => {
        eventEmitter.current = listener;
        return () => {
          if (eventEmitter.current === listener) {
            eventEmitter.current = null;
          }
        };
      },
    },
  });
  t.after(async () => {
    await closeServer(server);
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const emitEvent = eventEmitter.current;
  if (!emitEvent) {
    throw new Error("Expected the SSE adapter to subscribe to supervisor events.");
  }

  emitEvent(buildActiveIssueChangedEvent({
    issueNumber: 42,
    previousIssueNumber: null,
    nextIssueNumber: 42,
    reason: "reserved_for_cycle",
    at: "2026-03-22T00:00:00.000Z",
  }));

  const response = await openSseStream({ server, path: "/api/events" });
  assert.equal(response.statusCode, 200);

  const nextEventPromise = readSseEvent(response);
  emitEvent(buildActiveIssueChangedEvent({
    issueNumber: 43,
    previousIssueNumber: 42,
    nextIssueNumber: 43,
    reason: "reserved_for_cycle",
    at: "2026-03-22T00:01:00.000Z",
  }));
  const nextEvent = await nextEventPromise;
  assert.equal(nextEvent.id, "2");
  assert.equal(nextEvent.event, "supervisor.active_issue.changed");
  assert.deepEqual(nextEvent.data, [
    JSON.stringify({
      type: "supervisor.active_issue.changed",
      family: "active_issue",
      issueNumber: 43,
      previousIssueNumber: 42,
      nextIssueNumber: 43,
      reason: "reserved_for_cycle",
      at: "2026-03-22T00:01:00.000Z",
    }),
  ]);

  await closeResponse(response);
});

test("createSupervisorHttpServer sends SSE heartbeats while idle", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService(),
    heartbeatIntervalMs: 20,
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const response = await openSseStream({ server, path: "/api/events" });

  assert.equal(response.statusCode, 200);
  const heartbeat = await readSseEvent(response);
  assert.equal(heartbeat.id, null);
  assert.equal(heartbeat.event, null);
  assert.deepEqual(heartbeat.data, []);
  assert.deepEqual(heartbeat.comments, ["heartbeat"]);
  await closeResponse(response);
  await closeServer(server);
});
