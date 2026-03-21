import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { DoctorDiagnostics } from "../doctor";
import { buildActiveIssueChangedEvent, type SupervisorEvent, type SupervisorEventSink } from "../supervisor";
import type { SupervisorService } from "../supervisor";
import { createSupervisorHttpServer } from "./supervisor-http-server";

async function readJson(args: {
  server: http.Server;
  path: string;
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
        method: "GET",
        agent: false,
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

  const eventSubscribers = new Set<SupervisorEventSink>();

  return {
    config: {} as SupervisorService["config"],
    pollIntervalMs: async () => 60_000,
    runOnce: async () => "unused",
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
        detailedStatusLines: ["tracked_issues=0"],
        reconciliationPhase: null,
        reconciliationWarning: null,
        readinessLines: [],
        whyLines: why ? ["selected_issue=none"] : [],
        warning: null,
      };
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
  const server = createSupervisorHttpServer({
    service: createStubService({ statusWhyCalls, explainCalls, issueLintCalls }),
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
