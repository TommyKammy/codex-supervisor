import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { SupervisorConfig } from "../core/types";
import { buildActiveIssueChangedEvent, type SupervisorEventSink } from "./supervisor-events";
import { createSupervisorService } from "./supervisor-service";
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
