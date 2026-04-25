import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { JsonCorruptStateResetResult, SupervisorConfig } from "../core/types";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupConfigPreview, SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import type { SetupReadinessReport } from "../setup-readiness";
import { buildActiveIssueChangedEvent, type SupervisorEventSink, type SupervisorService, type SupervisorStatusDto } from "../supervisor";
import { createRestartableWebUiShellService } from "./restartable-webui-shell-service";

type PreviewCacheKey = SetupConfigPreviewSelectableReviewProviderProfile | null;

function createStatusDto(label: string, why: boolean): SupervisorStatusDto {
  return {
    gsdSummary: null,
    trustDiagnostics: null,
    cadenceDiagnostics: null,
    candidateDiscoverySummary: null,
    candidateDiscovery: null,
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
      selectionReason: why ? `selection:${label}` : null,
    },
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [`status=${label}`],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: why ? [`why=${label}`] : [],
    warning: null,
  };
}

function createSetupConfigPreview(profile: PreviewCacheKey): SetupConfigPreview {
  const selectedReviewProviderProfile = profile ?? "none";
  return {
    kind: "setup_config_preview",
    mode: "patch",
    configPath: `/tmp/${selectedReviewProviderProfile}.config.json`,
    writesConfig: false,
    selectedReviewProviderProfile,
    supportedReviewProviderProfiles: [
      {
        id: "none",
        label: "No provider selected yet",
        reviewBotLogins: [],
      },
      {
        id: "coderabbit",
        label: "CodeRabbit",
        reviewBotLogins: ["coderabbitai"],
      },
    ],
    preservedUnknownFields: [],
    document: {
      reviewBotLogins: selectedReviewProviderProfile === "coderabbit" ? ["coderabbitai"] : [],
    },
    fieldChanges: [],
    validation: {
      status: "ready",
      missingRequiredFields: [],
      invalidFields: [],
      error: null,
    },
  };
}

function createStubService(args?: {
  statusCalls?: boolean[];
  previewCalls?: PreviewCacheKey[];
  statusByWhy?: Record<"true" | "false", SupervisorStatusDto>;
  previewsByProfile?: Map<PreviewCacheKey, SetupConfigPreview>;
  eventSinkRef?: { current: SupervisorEventSink | null };
}): SupervisorService {
  const doctorDiagnostics: DoctorDiagnostics = {
    overallStatus: "pass",
    checks: [],
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
  const setupReadinessReport: SetupReadinessReport = {
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
    hostReadiness: {
      overallStatus: "pass",
      checks: [],
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
      warning: null,
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
  };
  const statusByWhy = args?.statusByWhy ?? {
    false: createStatusDto("false", false),
    true: createStatusDto("true", true),
  };
  const previewsByProfile = args?.previewsByProfile ?? new Map<PreviewCacheKey, SetupConfigPreview>([
    [null, createSetupConfigPreview(null)],
    ["coderabbit", createSetupConfigPreview("coderabbit")],
  ]);

  return {
    config: {} as SupervisorConfig,
    pollIntervalMs: async () => 60_000,
    runOnce: async () => "unused",
    queryStatus: async ({ why }) => {
      args?.statusCalls?.push(why);
      return statusByWhy[String(why) as "true" | "false"];
    },
    runRecoveryAction: async () => {
      throw new Error("unused");
    },
    pruneOrphanedWorkspaces: async () => {
      throw new Error("unused");
    },
    resetCorruptJsonState: async (): Promise<JsonCorruptStateResetResult> => {
      throw new Error("unused");
    },
    queryExplain: async () => {
      throw new Error("unused");
    },
    queryIssueLint: async () => {
      throw new Error("unused");
    },
    queryDoctor: async () => doctorDiagnostics,
    querySetupReadiness: async () => setupReadinessReport,
    querySetupConfigPreview: async ({ reviewProviderProfile }) => {
      const profileKey = reviewProviderProfile ?? null;
      args?.previewCalls?.push(profileKey);
      return previewsByProfile.get(profileKey) ?? createSetupConfigPreview(profileKey);
    },
    subscribeEvents: (listener) => {
      if (args?.eventSinkRef) {
        args.eventSinkRef.current = listener;
      }
      return () => {
        if (args?.eventSinkRef?.current === listener) {
          args.eventSinkRef.current = null;
        }
      };
    },
  };
}

test("createRestartableWebUiShellService keys cached reconnect reads by request arguments", async () => {
  const statusCalls: boolean[] = [];
  const previewCalls: PreviewCacheKey[] = [];
  let releaseRestart!: () => void;
  const restartGate = new Promise<void>((resolve) => {
    releaseRestart = resolve;
  });
  const initialService = createStubService({ statusCalls, previewCalls });
  const shell = createRestartableWebUiShellService({
    service: initialService,
    recreateWorker: async () => {
      await restartGate;
      return { service: createStubService() };
    },
    capability: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
  });

  assert.deepEqual((await shell.service.queryStatus({ why: false })).whyLines, []);
  assert.deepEqual((await shell.service.queryStatus({ why: true })).whyLines, ["why=true"]);
  assert.equal((await shell.service.querySetupConfigPreview!({})).selectedReviewProviderProfile, "none");
  assert.equal(
    (await shell.service.querySetupConfigPreview!({ reviewProviderProfile: "coderabbit" })).selectedReviewProviderProfile,
    "coderabbit",
  );

  const restartPromise = shell.service.restartWorker();
  assert.equal(shell.service.workerPhase, "restarting");

  const reconnectFalseStatus = await shell.service.queryStatus({ why: false });
  const reconnectTrueStatus = await shell.service.queryStatus({ why: true });
  const reconnectDefaultPreview = await shell.service.querySetupConfigPreview!({});
  const reconnectCoderabbitPreview = await shell.service.querySetupConfigPreview!({ reviewProviderProfile: "coderabbit" });

  assert.deepEqual(reconnectFalseStatus.whyLines, []);
  assert.equal(reconnectFalseStatus.warning?.message.includes("WebUI shell is still available"), true);
  assert.deepEqual(reconnectTrueStatus.whyLines, ["why=true"]);
  assert.equal(reconnectDefaultPreview.selectedReviewProviderProfile, "none");
  assert.equal(reconnectCoderabbitPreview.selectedReviewProviderProfile, "coderabbit");
  assert.deepEqual(statusCalls, [false, true]);
  assert.deepEqual(previewCalls, [null, "coderabbit"]);

  releaseRestart();
  await restartPromise;
});

test("createRestartableWebUiShellService restores the shell after a synchronous recreateService failure", async () => {
  const shell = createRestartableWebUiShellService({
    service: createStubService(),
    recreateWorker: () => {
      throw new Error("restart exploded");
    },
    capability: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
  });

  await assert.rejects(shell.service.restartWorker(), /restart exploded/u);
  assert.equal(shell.service.workerPhase, "open");
  assert.deepEqual((await shell.service.queryStatus({ why: false })).whyLines, []);
});

test("createRestartableWebUiShellService isolates synchronous subscriber failures", async () => {
  const eventSinkRef = { current: null as SupervisorEventSink | null };
  const consoleErrors: unknown[][] = [];
  const errorMock = mock.method(console, "error", (...args: unknown[]) => {
    consoleErrors.push(args);
  });
  const shell = createRestartableWebUiShellService({
    service: createStubService({ eventSinkRef }),
    recreateWorker: async () => ({ service: createStubService() }),
    capability: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
  });
  const received: string[] = [];

  try {
    if (!eventSinkRef.current) {
      throw new Error("Expected restartable shell to subscribe to the active service.");
    }

    shell.service.subscribeEvents?.(() => {
      throw new Error("listener failed");
    });
    shell.service.subscribeEvents?.((event) => {
      received.push(event.type);
    });

    const event = buildActiveIssueChangedEvent({
      issueNumber: 42,
      previousIssueNumber: null,
      nextIssueNumber: 42,
      reason: "reserved_for_cycle",
      at: "2026-03-26T00:00:00.000Z",
    });
    assert.doesNotThrow(() => eventSinkRef.current?.(event));
    assert.deepEqual(received, []);

    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(received, ["supervisor.active_issue.changed"]);
    assert.equal(
      consoleErrors.some(([message]) =>
        String(message).includes("WebUI shell event subscriber failed for supervisor.active_issue.changed."),
      ),
      true,
    );
  } finally {
    errorMock.mock.restore();
  }
});

test("createRestartableWebUiShellService keeps run-once paired with the fresh loop controller after restart", async () => {
  const runCycleCalls: string[] = [];
  const shell = createRestartableWebUiShellService({
    service: createStubService({
      statusByWhy: {
        false: createStatusDto("initial", false),
        true: createStatusDto("initial", true),
      },
    }),
    loopController: {
      runCycle: async () => {
        runCycleCalls.push("initial");
        return "run-once initial";
      },
    },
    recreateWorker: async () => ({
      service: createStubService({
        statusByWhy: {
          false: createStatusDto("replacement", false),
          true: createStatusDto("replacement", true),
        },
      }),
      loopController: {
        runCycle: async () => {
          runCycleCalls.push("replacement");
          return "run-once replacement";
        },
      },
    }),
    capability: {
      supported: true,
      launcher: "systemd",
      state: "ready",
      summary: "Managed restart is available through the systemd launcher.",
    },
  });

  assert.equal(await shell.service.runOnce({ dryRun: false }), "run-once initial");
  await shell.service.restartWorker();

  const reloadedStatus = await shell.service.queryStatus({ why: false });
  assert.deepEqual(reloadedStatus.detailedStatusLines, ["status=replacement"]);
  assert.equal(await shell.service.runOnce({ dryRun: false }), "run-once replacement");
  assert.deepEqual(runCycleCalls, ["initial", "replacement"]);
});
