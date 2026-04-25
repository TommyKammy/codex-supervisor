import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupReadinessReport } from "../setup-readiness";
import type { SetupConfigPreview } from "../setup-config-preview";
import type { SetupConfigUpdateResult } from "../setup-config-write";
import { buildActiveIssueChangedEvent, type SupervisorEvent, type SupervisorEventSink } from "../supervisor";
import type { SupervisorService } from "../supervisor";
import {
  createSetupConfigPreview,
  createSetupConfigUpdateResult,
  createSetupReadinessReport,
  createUnavailableManagedRestart,
} from "./setup-test-fixtures";
import { createRestartableWebUiShellService } from "./restartable-webui-shell-service";
import { createSupervisorHttpServer } from "./supervisor-http-server";
import { WEBUI_MUTATION_AUTH_HEADER } from "./webui-mutation-auth";

const unavailableManagedRestart = createUnavailableManagedRestart();

const testMutationAuth = { token: "local-test-secret" };

function mutationAuthHeaders(server: http.Server, headers?: http.OutgoingHttpHeaders): http.OutgoingHttpHeaders {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }
  return {
    Origin: `http://127.0.0.1:${address.port}`,
    [WEBUI_MUTATION_AUTH_HEADER]: testMutationAuth.token,
    ...headers,
  };
}

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

async function readText(args: {
  server: http.Server;
  path: string;
  method?: string;
  body?: string;
  headers?: http.OutgoingHttpHeaders;
}): Promise<{ statusCode: number; body: string }> {
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
          resolve({
            statusCode: response.statusCode ?? 0,
            body: payload,
          });
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
  postMergeAuditSummaryCalls?: number;
  setupReadinessCalls?: number;
  setupReadinessError?: Error;
  setupReadinessReport?: SetupReadinessReport;
  setupConfigPreviewCalls?: Array<string | null>;
  setupConfigPreview?: SetupConfigPreview;
  setupConfigUpdateCalls?: Array<unknown>;
  setupConfigUpdateResult?: SetupConfigUpdateResult;
  updateSetupConfig?: SupervisorService["updateSetupConfig"];
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
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    loopHostWarning: null,
  };
  const setupReadinessReport: SetupReadinessReport = args?.setupReadinessReport ?? createSetupReadinessReport();
  const setupConfigPreview: SetupConfigPreview = args?.setupConfigPreview ?? createSetupConfigPreview();
  const setupConfigUpdateResult: SetupConfigUpdateResult =
    args?.setupConfigUpdateResult ?? createSetupConfigUpdateResult({ readiness: setupReadinessReport });

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
        loopRuntime: {
          state: "off",
          hostMode: "unknown",
          markerPath: "none",
          configPath: null,
          stateFile: "none",
          pid: null,
          startedAt: null,
          ownershipConfidence: "none",
          detail: null,
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
        operatorEventSummary: null,
        staleRecoveryWarningSummary: null,
        activityContext: {
          handoffSummary: "blocker: waiting on typed explain activity context",
          localReviewRoutingSummary: null,
          changeClassesSummary: null,
          verificationPolicySummary: null,
          durableGuardrailSummary: null,
          externalReviewFollowUpSummary: null,
          localCiStatus: null,
          latestRecovery: {
            issueNumber,
            at: "2026-03-22T00:00:00Z",
            reason: "tracked_pr_head_advanced",
            detail: "resumed issue after tracked PR advanced",
          },
          retryContext: {
            timeoutRetryCount: 0,
            blockedVerificationRetryCount: 0,
            repeatedBlockerCount: 0,
            repeatedFailureSignatureCount: 0,
            lastFailureSignature: null,
          },
          repeatedRecovery: null,
          recentPhaseChanges: [],
          localReviewSummaryPath: null,
          externalReviewMissesPath: null,
          reviewWaits: [],
        },
        trackedPrMismatchSummary: null,
        recoveryGuidance: null,
        selectionReason: "selected for execution",
        reasons: ["selected for execution"],
        lastError: null,
        failureSummary: null,
        preservedPartialWorkSummary: null,
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
    queryPostMergeAuditSummary: async () => {
      if (args) {
        args.postMergeAuditSummaryCalls = (args.postMergeAuditSummaryCalls ?? 0) + 1;
      }
      return {
        schemaVersion: 4,
        advisoryOnly: true,
        autoApplyGuardrails: false,
        autoCreateFollowUpIssues: false,
        generatedAt: "2026-03-24T12:00:00Z",
        artifactDir: "/tmp/post-merge-audits",
        artifactsAnalyzed: 3,
        artifactsSkipped: 1,
        reviewPatterns: [],
        failurePatterns: [],
        recoveryPatterns: [],
        followUpCandidates: [],
        promotionCandidates: [],
      };
    },
    queryDoctor: async () => doctorDiagnostics,
    querySetupReadiness: async () => {
      if (args) {
        args.setupReadinessCalls = (args.setupReadinessCalls ?? 0) + 1;
      }
      if (args?.setupReadinessError) {
        throw args.setupReadinessError;
      }
      return setupReadinessReport;
    },
    querySetupConfigPreview: async ({ reviewProviderProfile }) => {
      args?.setupConfigPreviewCalls?.push(reviewProviderProfile ?? null);
      return setupConfigPreview;
    },
    updateSetupConfig: async (payload) => {
      args?.setupConfigUpdateCalls?.push(payload);
      if (args?.updateSetupConfig) {
        return args.updateSetupConfig(payload);
      }
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
  const serviceArgs = {
    statusWhyCalls,
    explainCalls,
    issueLintCalls,
    postMergeAuditSummaryCalls: 0,
    setupReadinessCalls: 0,
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
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
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
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    loopHostWarning: null,
  });

  const postMergeAuditSummaryResponse = await readJson({ server, path: "/api/post-merge-audits/summary" });
  assert.equal(postMergeAuditSummaryResponse.statusCode, 200);
  assert.equal(serviceArgs.postMergeAuditSummaryCalls, 1);
  assert.deepEqual(postMergeAuditSummaryResponse.body, {
    schemaVersion: 4,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    generatedAt: "2026-03-24T12:00:00Z",
    artifactDir: "/tmp/post-merge-audits",
    artifactsAnalyzed: 3,
    artifactsSkipped: 1,
    reviewPatterns: [],
    failurePatterns: [],
    recoveryPatterns: [],
    followUpCandidates: [],
    promotionCandidates: [],
  });

  const setupReadinessResponse = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(setupReadinessResponse.statusCode, 200);
  assert.deepEqual(setupReadinessResponse.body, {
    kind: "setup_readiness",
    managedRestart: unavailableManagedRestart,
    ready: false,
    overallStatus: "missing",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoPath",
        label: "Repository path",
        state: "configured",
        value: "/tmp/repo",
        message: "Repository path is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "directory_path",
        },
      },
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
        key: "workspaceRoot",
        label: "Workspace root",
        state: "configured",
        value: "/tmp/worktrees",
        message: "Workspace root is configured.",
        required: true,
        metadata: {
          source: "config",
          editable: true,
          valueType: "directory_path",
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
    nextActions: [
      {
        action: "fix_config",
        source: "missing_review_provider",
        priority: 100,
        required: true,
        summary: "Configure at least one review provider before first-run setup is complete.",
        fieldKeys: ["reviewProvider"],
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
      configured: true,
      executionSafetyMode: "unsandboxed_autonomous",
      warning:
        "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
      summary:
        "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
    },
    modelRoutingPosture: {
      summary: "Model routing follows the host Codex default model unless you opt into a per-target override.",
      invalid: false,
      targets: [
        {
          key: "codex",
          label: "Default Codex route",
          strategy: "inherit",
          strategyField: "codexModelStrategy",
          modelField: "codexModel",
          model: null,
          overrideConfigured: false,
          invalidStrategy: false,
          requiresExplicitModel: false,
          missingExplicitModel: false,
          summary: "Default Codex turns inherit the host Codex default model.",
          guidance: 'Recommended default: keep `codexModelStrategy: "inherit"` and set the Codex host default model instead of pinning it here.',
        },
        {
          key: "bounded_repair",
          label: "Bounded repair override",
          strategy: "inherit",
          strategyField: "boundedRepairModelStrategy",
          modelField: "boundedRepairModel",
          model: null,
          overrideConfigured: false,
          invalidStrategy: false,
          requiresExplicitModel: false,
          missingExplicitModel: false,
          summary: "Bounded repair turns currently inherit the default Codex route.",
          guidance: 'Leave boundedRepairModelStrategy unset or use `"inherit"` to keep following the default Codex route.',
        },
        {
          key: "local_review",
          label: "Generic local-review override",
          strategy: "inherit",
          strategyField: "localReviewModelStrategy",
          modelField: "localReviewModel",
          model: null,
          overrideConfigured: false,
          invalidStrategy: false,
          requiresExplicitModel: false,
          missingExplicitModel: false,
          summary: "Generic local-review turns currently inherit the default Codex route.",
          guidance: 'Leave localReviewModelStrategy unset or use `"inherit"` to keep following the default Codex route.',
        },
      ],
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
    dangerousExplicitOptIns: [
      {
        key: "localReviewHighSeverityAction",
        label: "High-severity local-review autonomous action posture.",
        currentValue: null,
        previewValue: null,
        state: "unchanged",
        requiresConfirmation: true,
        operatorImpact:
          "Can route verifier-confirmed high-severity local-review findings into another repair pass instead of blocking.",
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
    staleRecoveryWarningSummary: null,
    activityContext: {
      handoffSummary: "blocker: waiting on typed explain activity context",
      localReviewRoutingSummary: null,
      changeClassesSummary: null,
      verificationPolicySummary: null,
      durableGuardrailSummary: null,
      externalReviewFollowUpSummary: null,
      localCiStatus: null,
      latestRecovery: {
        issueNumber: 42,
        at: "2026-03-22T00:00:00Z",
        reason: "tracked_pr_head_advanced",
        detail: "resumed issue after tracked PR advanced",
      },
      retryContext: {
        timeoutRetryCount: 0,
        blockedVerificationRetryCount: 0,
        repeatedBlockerCount: 0,
        repeatedFailureSignatureCount: 0,
        lastFailureSignature: null,
      },
      repeatedRecovery: null,
      recentPhaseChanges: [],
      localReviewSummaryPath: null,
      externalReviewMissesPath: null,
      reviewWaits: [],
    },
    trackedPrMismatchSummary: null,
    recoveryGuidance: null,
    selectionReason: "selected for execution",
    reasons: ["selected for execution"],
    lastError: null,
    failureSummary: null,
    preservedPartialWorkSummary: null,
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
  const service = createStubService({
    runOnceDryRunCalls,
    recoveryCalls,
    ...serviceCallCounts,
  });
  const server = createSupervisorHttpServer({
    service,
    loopController: {
      runCycle: async (_command, options) => service.runOnce(options),
    },
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
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
    headers: mutationAuthHeaders(server),
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
    headers: mutationAuthHeaders(server),
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({ issueNumber: 0 }),
  });
  assert.equal(invalidRequeueResponse.statusCode, 400);
  assert.deepEqual(invalidRequeueResponse.body, { error: "Issue number must be a positive integer." });

  const blockedCommandResponse = await readJson({
    server,
    path: "/api/commands/loop",
    method: "POST",
    headers: mutationAuthHeaders(server),
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

test("createSupervisorHttpServer rejects unauthenticated mutation requests before supervisor actions run", async (t) => {
  const runOnceDryRunCalls: boolean[] = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ runOnceDryRunCalls }),
    loopController: {
      runCycle: async (_command, options) => {
        runOnceDryRunCalls.push(options.dryRun);
        return "run-once complete";
      },
    },
    mutationAuth: testMutationAuth,
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
    path: "/api/commands/run-once",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true }),
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "Mutation auth required." });
  assert.deepEqual(runOnceDryRunCalls, []);
});

test("createSupervisorHttpServer rejects cross-origin mutation requests before setup writes run", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: {
      Origin: "http://attacker.example",
      "Content-Type": "application/json",
      [WEBUI_MUTATION_AUTH_HEADER]: testMutationAuth.token,
    },
    body: JSON.stringify({
      changes: {
        reviewProvider: "codex",
      },
    }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "Mutation requests must originate from the local WebUI origin." });
  assert.deepEqual(setupConfigUpdateCalls, []);
});

test("createSupervisorHttpServer serializes concurrent run-once requests", async (t) => {
  let activeRuns = 0;
  let maxConcurrentRuns = 0;
  let releaseFirstRun!: () => void;
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  let resolveSecondCycleAttempt!: () => void;
  const secondCycleAttempt = new Promise<void>((resolve) => {
    resolveSecondCycleAttempt = resolve;
  });

  const service = {
    ...createStubService(),
    runOnce: async (_options: Parameters<SupervisorService["runOnce"]>[0]) => {
      activeRuns += 1;
      maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns);
      try {
        await firstRunGate;
        return "run-once complete";
      } finally {
        activeRuns -= 1;
      }
    },
  };
  const server = createSupervisorHttpServer({
    service,
    loopController: {
      runCycle: (() => {
        let lockHeld = false;
        let callCount = 0;
        return async (_command, options) => {
          callCount += 1;
          if (callCount === 2) {
            resolveSecondCycleAttempt();
          }
          if (lockHeld) {
            return "Skipped supervisor cycle: lock unavailable.";
          }
          lockHeld = true;
          try {
            return await service.runOnce(options);
          } finally {
            lockHeld = false;
          }
        };
      })(),
    },
    mutationAuth: testMutationAuth,
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const firstResponsePromise = readJson({
    server,
    path: "/api/commands/run-once",
    method: "POST",
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({ dryRun: false }),
  });

  await new Promise<void>((resolve) => setImmediate(resolve));

  const secondResponsePromise = readJson({
    server,
    path: "/api/commands/run-once",
    method: "POST",
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({ dryRun: false }),
  });

  await secondCycleAttempt;
  releaseFirstRun();

  const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(maxConcurrentRuns, 1);
  assert.deepEqual(
    [firstResponse.body, secondResponse.body],
    [
      { command: "run-once", dryRun: false, summary: "run-once complete" },
      { command: "run-once", dryRun: false, summary: "Skipped supervisor cycle: lock unavailable." },
    ],
  );
});

test("createSupervisorHttpServer accepts narrow setup config writes and returns refreshed readiness", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
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
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: "/tmp/supervisor.config.json.bak",
    updatedFields: ["reviewProvider"],
    restartRequired: true,
    restartScope: "supervisor",
    restartTriggeredByFields: ["reviewProvider"],
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
          key: "repoPath",
          label: "Repository path",
          state: "configured",
          value: "/tmp/repo",
          message: "Repository path is configured.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "directory_path",
          },
        },
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
          key: "workspaceRoot",
          label: "Workspace root",
          state: "configured",
          value: "/tmp/worktrees",
          message: "Workspace root is configured.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "directory_path",
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
      nextActions: [
        {
          action: "fix_config",
          source: "missing_review_provider",
          priority: 100,
          required: true,
          summary: "Configure at least one review provider before first-run setup is complete.",
          fieldKeys: ["reviewProvider"],
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
        configured: true,
        executionSafetyMode: "unsandboxed_autonomous",
        warning:
          "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
        summary:
          "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
      },
      modelRoutingPosture: {
        summary: "Model routing follows the host Codex default model unless you opt into a per-target override.",
        invalid: false,
        targets: [
          {
            key: "codex",
            label: "Default Codex route",
            strategy: "inherit",
            strategyField: "codexModelStrategy",
            modelField: "codexModel",
            model: null,
            overrideConfigured: false,
            invalidStrategy: false,
            requiresExplicitModel: false,
            missingExplicitModel: false,
            summary: "Default Codex turns inherit the host Codex default model.",
            guidance: 'Recommended default: keep `codexModelStrategy: "inherit"` and set the Codex host default model instead of pinning it here.',
          },
          {
            key: "bounded_repair",
            label: "Bounded repair override",
            strategy: "inherit",
            strategyField: "boundedRepairModelStrategy",
            modelField: "boundedRepairModel",
            model: null,
            overrideConfigured: false,
            invalidStrategy: false,
            requiresExplicitModel: false,
            missingExplicitModel: false,
            summary: "Bounded repair turns currently inherit the default Codex route.",
            guidance: 'Leave boundedRepairModelStrategy unset or use `"inherit"` to keep following the default Codex route.',
          },
          {
            key: "local_review",
            label: "Generic local-review override",
            strategy: "inherit",
            strategyField: "localReviewModelStrategy",
            modelField: "localReviewModel",
            model: null,
            overrideConfigured: false,
            invalidStrategy: false,
            requiresExplicitModel: false,
            missingExplicitModel: false,
            summary: "Generic local-review turns currently inherit the default Codex route.",
            guidance: 'Leave localReviewModelStrategy unset or use `"inherit"` to keep following the default Codex route.',
          },
        ],
      },
    },
  });
});

test("createSupervisorHttpServer forwards dangerous opt-in confirmation and returns typed missing-confirmation errors", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({
      setupConfigUpdateCalls,
      updateSetupConfig: async () => {
        const { SetupConfigWriteError } = await import("../setup-config-write");
        throw new SetupConfigWriteError("Dangerous explicit opt-in confirmation required for: localReviewHighSeverityAction.", [
          "localReviewHighSeverityAction",
        ]);
      },
    }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      changes: {
        localReviewHighSeverityAction: "retry",
      },
      dangerousOptInConfirmation: {
        acknowledged: true,
        fieldKeys: ["localReviewHighSeverityAction"],
      },
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(setupConfigUpdateCalls, [
    {
      changes: {
        localReviewHighSeverityAction: "retry",
      },
      dangerousOptInConfirmation: {
        acknowledged: true,
        fieldKeys: ["localReviewHighSeverityAction"],
      },
    },
  ]);
  assert.deepEqual(response.body, {
    error: "Dangerous explicit opt-in confirmation required for: localReviewHighSeverityAction.",
    code: "dangerous_confirmation_required",
    dangerousFields: ["localReviewHighSeverityAction"],
  });
});

test("createSupervisorHttpServer rejects unknown dangerous opt-in confirmation field keys", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      changes: {
        localReviewHighSeverityAction: "retry",
      },
      dangerousOptInConfirmation: {
        acknowledged: true,
        fieldKeys: ["localReviewHighSeverityAction", "unsupportedDangerousField"],
      },
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error:
      "dangerousOptInConfirmation.fieldKeys includes unknown dangerous setup config field: unsupportedDangerousField.",
  });
  assert.deepEqual(setupConfigUpdateCalls, []);
});

test("createSupervisorHttpServer only accepts managed restart commands when launcher support is available", async (t) => {
  let restartRequests = 0;
  const server = createSupervisorHttpServer({
    service: createStubService(),
    mutationAuth: testMutationAuth,
    managedRestart: {
      capability: {
        supported: true,
        launcher: "systemd",
        state: "ready",
        summary: "Managed restart is available through the systemd launcher.",
      },
      requestRestart: async () => {
        restartRequests += 1;
        return {
          command: "managed-restart",
          accepted: true,
          summary: "Managed restart requested through the systemd launcher. This WebUI process will exit for relaunch.",
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

  const readinessResponse = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(readinessResponse.statusCode, 200);
  assert.match(JSON.stringify(readinessResponse.body), /"launcher":"systemd"/u);

  const restartResponse = await readJson({
    server,
    path: "/api/commands/managed-restart",
    method: "POST",
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  assert.equal(restartResponse.statusCode, 200);
  assert.deepEqual(restartResponse.body, {
    command: "managed-restart",
    accepted: true,
    summary: "Managed restart requested through the systemd launcher. This WebUI process will exit for relaunch.",
  });
  assert.equal(restartRequests, 1);
});

test("createSupervisorHttpServer rejects managed restart commands for unmanaged WebUI sessions", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService(),
    mutationAuth: testMutationAuth,
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const restartResponse = await readJson({
    server,
    path: "/api/commands/managed-restart",
    method: "POST",
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  assert.equal(restartResponse.statusCode, 409);
  assert.deepEqual(restartResponse.body, {
    error: unavailableManagedRestart.summary,
  });
});

test("createSupervisorHttpServer keeps setup routes reachable while the worker is reconnecting", async (t) => {
  let recreateCalls = 0;
  let releaseRestart!: () => void;
  const restartGate = new Promise<void>((resolve) => {
    releaseRestart = resolve;
  });
  const baseSetupReadiness = await createStubService().querySetupReadiness!();
  const initialService = createStubService({
    setupReadinessReport: {
      ...baseSetupReadiness,
      configPath: "/tmp/initial.config.json",
    },
  });
  const replacementService = createStubService({
    setupReadinessReport: {
      ...(await initialService.querySetupReadiness!()),
      configPath: "/tmp/reloaded.config.json",
    },
  });
  const shell = createRestartableWebUiShellService({
    service: initialService,
    recreateWorker: async () => {
      recreateCalls += 1;
      await restartGate;
      return { service: replacementService };
    },
    capability: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
  });
  const server = createSupervisorHttpServer({
    service: shell.service,
    managedRestart: shell.managedRestart,
    mutationAuth: testMutationAuth,
  });
  t.after(async () => {
    await closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const initialReadiness = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(initialReadiness.statusCode, 200);
  assert.match(JSON.stringify(initialReadiness.body), /"configPath":"\/tmp\/initial\.config\.json"/u);

  const restartResponse = await readJson({
    server,
    path: "/api/commands/managed-restart",
    method: "POST",
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  assert.equal(restartResponse.statusCode, 200);
  assert.match(JSON.stringify(restartResponse.body), /shell stays available/u);
  assert.equal(recreateCalls, 1);

  const setupPage = await readText({ server, path: "/setup" });
  assert.equal(setupPage.statusCode, 200);
  assert.match(setupPage.body, /First-run setup/u);

  const restartingReadiness = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(restartingReadiness.statusCode, 200);
  assert.match(JSON.stringify(restartingReadiness.body), /shell stays available/u);
  assert.match(JSON.stringify(restartingReadiness.body), /"state":"reconnecting"/u);
  assert.match(JSON.stringify(restartingReadiness.body), /"configPath":"\/tmp\/initial\.config\.json"/u);

  releaseRestart();
  await restartGate;

  const reloadedReadiness = await readJson({ server, path: "/api/setup-readiness" });
  assert.equal(reloadedReadiness.statusCode, 200);
  assert.match(JSON.stringify(reloadedReadiness.body), /"state":"ready"/u);
  assert.match(JSON.stringify(reloadedReadiness.body), /"configPath":"\/tmp\/reloaded\.config\.json"/u);
});

test("createSupervisorHttpServer surfaces no-op setup config writes without a restart requirement", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService({
      setupConfigUpdateResult: {
        kind: "setup_config_update",
        configPath: "/tmp/supervisor.config.json",
        backupPath: "/tmp/supervisor.config.json.bak",
        updatedFields: ["reviewProvider"],
        restartRequired: false,
        restartScope: null,
        restartTriggeredByFields: [],
        document: {
          repoPath: ".",
          repoSlug: "owner/repo",
          defaultBranch: "main",
          workspaceRoot: "/tmp/worktrees",
          stateFile: "/tmp/state.json",
          codexBinary: "codex",
          branchPrefix: "codex/issue-",
          reviewBotLogins: ["chatgpt-codex-connector"],
        },
        readiness: {
          kind: "setup_readiness",
          ready: true,
          overallStatus: "configured",
          configPath: "/tmp/supervisor.config.json",
          fields: [],
          blockers: [],
          nextActions: [
            {
              action: "continue",
              source: "setup_readiness",
              priority: 0,
              required: false,
              summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
              fieldKeys: [],
            },
          ],
          hostReadiness: { overallStatus: "pass", checks: [] },
          providerPosture: {
            profile: "codex",
            provider: "codex",
            reviewers: ["chatgpt-codex-connector"],
            signalSource: "review_bot_logins",
            configured: true,
            summary: "Codex Connector is configured.",
          },
          trustPosture: {
            trustMode: "trusted_repo_and_authors",
            configured: true,
            executionSafetyMode: "unsandboxed_autonomous",
            warning:
              "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
            summary:
              "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
          },
        },
      },
    }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      changes: {
        reviewProvider: "codex",
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    kind: "setup_config_update",
    managedRestart: unavailableManagedRestart,
    configPath: "/tmp/supervisor.config.json",
    backupPath: "/tmp/supervisor.config.json.bak",
    updatedFields: ["reviewProvider"],
    restartRequired: false,
    restartScope: null,
    restartTriggeredByFields: [],
    document: {
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "/tmp/worktrees",
      stateFile: "/tmp/state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      reviewBotLogins: ["chatgpt-codex-connector"],
    },
    readiness: {
      kind: "setup_readiness",
      ready: true,
      overallStatus: "configured",
      configPath: "/tmp/supervisor.config.json",
      fields: [],
      blockers: [],
      nextActions: [
        {
          action: "continue",
          source: "setup_readiness",
          priority: 0,
          required: false,
          summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
          fieldKeys: [],
        },
      ],
      hostReadiness: { overallStatus: "pass", checks: [] },
      providerPosture: {
        profile: "codex",
        provider: "codex",
        reviewers: ["chatgpt-codex-connector"],
        signalSource: "review_bot_logins",
        configured: true,
        summary: "Codex Connector is configured.",
      },
      trustPosture: {
        trustMode: "trusted_repo_and_authors",
        configured: true,
        executionSafetyMode: "unsandboxed_autonomous",
        warning:
          "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
        summary:
          "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
      },
    },
  });
});

test("createSupervisorHttpServer rejects malformed setup config write requests before calling the service", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reviewProvider: "codex" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Request body must include a changes object." });
  assert.deepEqual(setupConfigUpdateCalls, []);
});

test("createSupervisorHttpServer preserves the malformed JSON error contract for setup config writes", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: "{\"changes\":",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Request body must be valid JSON." });
  assert.deepEqual(setupConfigUpdateCalls, []);
});

test("createSupervisorHttpServer rejects oversized setup config write requests before calling the service", async (t) => {
  const setupConfigUpdateCalls: Array<unknown> = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ setupConfigUpdateCalls }),
    mutationAuth: testMutationAuth,
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
    headers: mutationAuthHeaders(server, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      changes: {
        reviewProvider: "codex",
        notes: "x".repeat(1024 * 1024),
      },
    }),
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, { error: "Request body exceeds the maximum JSON size." });
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
  assert.match(html, /id="repo-slug-value" class="masthead-repo">owner\/repo</u);
  assert.match(html, /id="repo-path-value" class="context-path">\/tmp\/repo</u);
  assert.match(html, /id="workspace-root-value" class="context-path">\/tmp\/worktrees</u);
  assert.doesNotMatch(html, /\/api\/commands\/loop/u);
  assert.match(html, /load issue details/iu);
  assert.match(html, /secondary actions/iu);
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

  assert.equal(serviceCallCounts.setupReadinessCalls, 2);
  assert.match(rootHtml, /<title>codex-supervisor setup<\/title>/i);
  assert.match(rootHtml, /data-setup-root/u);
  assert.match(rootHtml, /\/api\/setup-readiness/u);
  assert.doesNotMatch(rootHtml, /\/api\/status\?why=true/u);
  assert.match(setupHtml, /<title>codex-supervisor setup<\/title>/i);
  assert.match(dashboardHtml, /<title>codex-supervisor operator dashboard<\/title>/i);
  assert.match(dashboardHtml, /data-dashboard-root/u);
  assert.match(dashboardHtml, /id="repo-slug-value" class="masthead-repo">owner\/repo</u);
});

test("createSupervisorHttpServer falls back to dashboard HTML when setup readiness cannot be queried", async (t) => {
  const serviceArgs = {
    setupReadinessCalls: 0,
    setupReadinessError: new Error("setup readiness unavailable"),
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
  const dashboardHtml = await readHtml("/dashboard");

  assert.equal(serviceArgs.setupReadinessCalls, 2);
  assert.match(rootHtml, /<title>codex-supervisor operator dashboard<\/title>/i);
  assert.match(rootHtml, /data-dashboard-root/u);
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
          key: "repoPath",
          label: "Repository path",
          state: "configured",
          value: "/tmp/repo",
          message: "Repository path is configured.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "directory_path",
          },
        },
        {
          key: "workspaceRoot",
          label: "Workspace root",
          state: "configured",
          value: "/tmp/worktrees",
          message: "Workspace root is configured.",
          required: true,
          metadata: {
            source: "config",
            editable: true,
            valueType: "directory_path",
          },
        },
      ],
      blockers: [],
      nextActions: [
        {
          action: "continue",
          source: "setup_readiness",
          priority: 0,
          required: false,
          summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
          fieldKeys: [],
        },
      ],
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
        summary:
          "Trusted inputs with unsandboxed autonomous execution. This is appropriate only for a trusted solo-lane repository and trusted GitHub authors.",
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
  assert.match(html, /id="repo-slug-value" class="masthead-repo">owner\/repo</u);
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
