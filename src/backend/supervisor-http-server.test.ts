import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { DoctorDiagnostics } from "../doctor";
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

function createStubService(): SupervisorService {
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

  return {
    config: {} as SupervisorService["config"],
    pollIntervalMs: async () => 60_000,
    runOnce: async () => "unused",
    queryStatus: async () => ({
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
    }),
    runRecoveryAction: async () => {
      throw new Error("unused");
    },
    pruneOrphanedWorkspaces: async () => {
      throw new Error("unused");
    },
    resetCorruptJsonState: async () => {
      throw new Error("unused");
    },
    queryExplain: async (issueNumber) => ({
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
    }),
    queryIssueLint: async (issueNumber) => ({
      issueNumber,
      title: "Lint issue",
      executionReady: true,
      missingRequired: [],
      missingRecommended: [],
      metadataErrors: [],
      highRiskBlockingAmbiguity: null,
      repairGuidance: [],
    }),
    queryDoctor: async () => doctorDiagnostics,
  };
}

test("createSupervisorHttpServer serves read-only supervisor DTOs as JSON", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService(),
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const statusResponse = await readJson({ server, path: "/api/status?why=true" });
  assert.equal(statusResponse.statusCode, 200);
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
});
