import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { SupervisorConfig } from "../core/types";
import type { SetupReadinessReport } from "../setup-readiness";
import { buildActiveIssueChangedEvent, type SupervisorEventSink } from "./supervisor-events";
import { createSupervisorService, createSupervisorServiceFromSupervisor } from "./supervisor-service";
import { Supervisor } from "./supervisor";

type StubSupervisor = Pick<
  Supervisor,
  | "config"
  | "pollIntervalMs"
  | "runOnce"
  | "statusReport"
  | "runRecoveryAction"
  | "pruneOrphanedWorkspaces"
  | "resetCorruptJsonState"
  | "explainReport"
  | "issueLint"
  | "doctorReport"
  | "setupReadinessReport"
>;

function createStubSupervisor(): StubSupervisor {
  return {
    config: {} as SupervisorConfig,
    pollIntervalMs: async () => 60_000,
    runOnce: async () => "unused",
    statusReport: async () => {
      throw new Error("unused");
    },
    runRecoveryAction: async () => {
      throw new Error("unused");
    },
    pruneOrphanedWorkspaces: async () => {
      throw new Error("unused");
    },
    resetCorruptJsonState: async () => {
      throw new Error("unused");
    },
    explainReport: async () => {
      throw new Error("unused");
    },
    issueLint: async () => {
      throw new Error("unused");
    },
    doctorReport: async () => {
      throw new Error("unused");
    },
    setupReadinessReport: async (): Promise<SetupReadinessReport> => {
      throw new Error("unused");
    },
  };
}

test("createSupervisorService isolates subscriber failures from the supervisor event path", async () => {
  const stubSupervisor = createStubSupervisor();
  let emitEvent: SupervisorEventSink | undefined;
  const fromConfigMock = mock.method(
    Supervisor,
    "fromConfig",
    (_configPath?: string, options: { onEvent?: SupervisorEventSink } = {}) => {
      emitEvent = options.onEvent;
      return stubSupervisor as unknown as Supervisor;
    },
  );
  const consoleErrors: unknown[][] = [];
  const errorMock = mock.method(console, "error", (...args: unknown[]) => {
    consoleErrors.push(args);
  });

  try {
    const service = createSupervisorService();
    if (!service.subscribeEvents) {
      throw new Error("Expected createSupervisorService to expose subscribeEvents.");
    }

    const received: string[] = [];
    service.subscribeEvents(() => {
      throw new Error("listener failed");
    });
    service.subscribeEvents((event) => {
      received.push(event.type);
    });

    const event = buildActiveIssueChangedEvent({
      issueNumber: 42,
      previousIssueNumber: null,
      nextIssueNumber: 42,
      reason: "reserved_for_cycle",
      at: "2026-03-22T00:00:00.000Z",
    });
    const serviceEventSink = emitEvent;
    assert.ok(serviceEventSink, "Expected createSupervisorService to wire the supervisor event sink.");
    assert.doesNotThrow(() => serviceEventSink(event));
    assert.deepEqual(received, []);

    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(received, ["supervisor.active_issue.changed"]);
    assert.equal(
      consoleErrors.some(([message]) =>
        String(message).includes("Supervisor event subscriber failed for supervisor.active_issue.changed."),
      ),
      true,
    );
  } finally {
    errorMock.mock.restore();
    fromConfigMock.mock.restore();
  }
});

test("createSupervisorService exposes a dedicated typed setup readiness query", async () => {
  const report: SetupReadinessReport = {
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
        message: "Configure at least one review provider login for automated review posture.",
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
        message: "A review provider must be configured before first-run setup is complete.",
        fieldKeys: ["reviewProvider"],
        remediation: {
          kind: "configure_review_provider",
          summary: "Add at least one review provider login before first-run setup is complete.",
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
        summary: "Add at least one review provider login before first-run setup is complete.",
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
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
      warning: null,
    },
  };

  const service = createSupervisorServiceFromStub({
    setupReadinessReport: async () => report,
  });

  assert.ok(service.querySetupReadiness);
  assert.deepEqual(await service.querySetupReadiness(), report);
});

test("createSupervisorService preserves typed operator observability fields on status and explain queries", async () => {
  const statusReport: Awaited<ReturnType<StubSupervisor["statusReport"]>> = {
    gsdSummary: null,
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
    localCiContract: {
      configured: true,
      command: "npm run ci:local",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
      warning: null,
    },
    activeIssue: {
      issueNumber: 42,
      state: "stabilizing",
      branch: "codex/issue-42",
      prNumber: 42,
      blockedReason: null,
      activityContext: {
        handoffSummary: null,
        localReviewRoutingSummary: null,
        changeClassesSummary: null,
        verificationPolicySummary: null,
        durableGuardrailSummary: null,
        externalReviewFollowUpSummary: null,
        preMergeEvaluation: null,
        localCiStatus: null,
        latestRecovery: null,
        retryContext: {
          timeoutRetryCount: 1,
          blockedVerificationRetryCount: 2,
          repeatedBlockerCount: 0,
          repeatedFailureSignatureCount: 3,
          lastFailureSignature: "verification-loop",
        },
        repeatedRecovery: {
          kind: "stale_stabilizing_no_pr",
          repeatCount: 2,
          repeatLimit: 3,
          status: "retrying",
          action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
          lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
        },
        recentPhaseChanges: [
          {
            at: "2026-03-22T00:15:00Z",
            from: "blocked",
            to: "addressing_review",
            reason: "tracked_pr_head_advanced",
            source: "recovery",
          },
        ],
        localReviewSummaryPath: null,
        externalReviewMissesPath: null,
        reviewWaits: [],
      },
    },
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  };
  assert.ok(statusReport.activeIssue);
  const explainReport: Awaited<ReturnType<StubSupervisor["explainReport"]>> = {
    issueNumber: 42,
    title: "Typed operator observability",
    state: "stabilizing",
    blockedReason: "none",
    runnable: true,
    changeRiskLines: [],
    externalReviewFollowUpSummary: null,
    latestRecoverySummary: null,
    operatorEventSummary: null,
    staleRecoveryWarningSummary: null,
    activityContext: statusReport.activeIssue.activityContext,
    trackedPrMismatchSummary: null,
    recoveryGuidance: null,
    selectionReason: "candidate selected",
    reasons: [],
    lastError: null,
    failureSummary: null,
    preservedPartialWorkSummary: null,
  };

  const service = createSupervisorServiceFromStub({
    statusReport: async () => statusReport,
    explainReport: async () => explainReport,
  });

  assert.deepEqual(await service.queryStatus({ why: true }), statusReport);
  assert.deepEqual(await service.queryExplain(42), explainReport);
});

function createSupervisorServiceFromStub(
  overrides: Partial<ReturnType<typeof createStubSupervisor>>,
) {
  return createSupervisorServiceFromSupervisor({
    ...createStubSupervisor(),
    ...overrides,
  } as unknown as Supervisor);
}
