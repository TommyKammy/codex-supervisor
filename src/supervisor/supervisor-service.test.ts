import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { SupervisorConfig } from "../core/types";
import type { SetupReadinessReport } from "../setup-readiness";
import { buildActiveIssueChangedEvent, type SupervisorEventSink } from "./supervisor-events";
import { createSupervisorService, createSupervisorServiceFromSupervisor } from "./supervisor-service";
import { Supervisor } from "./supervisor";

function createStubSupervisor() {
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
      },
      {
        key: "reviewProvider",
        label: "Review provider",
        state: "missing",
        value: null,
        message: "Configure at least one review provider login for automated review posture.",
        required: true,
      },
    ],
    blockers: [
      {
        code: "missing_review_provider",
        message: "A review provider must be configured before first-run setup is complete.",
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
  };

  const service = createSupervisorServiceFromStub({
    setupReadinessReport: async () => report,
  });

  assert.ok(service.querySetupReadiness);
  assert.deepEqual(await service.querySetupReadiness(), report);
});

function createSupervisorServiceFromStub(
  overrides: Partial<ReturnType<typeof createStubSupervisor>>,
) {
  return createSupervisorServiceFromSupervisor({
    ...createStubSupervisor(),
    ...overrides,
  } as unknown as Supervisor);
}
