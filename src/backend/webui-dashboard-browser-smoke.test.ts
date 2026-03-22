import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import type { DoctorDiagnostics } from "../doctor";
import type { SupervisorService } from "../supervisor";
import { createSupervisorHttpServer } from "./supervisor-http-server";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on an ephemeral port.");
  }

  return address.port;
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

function createStubService(args?: { pruneCalls?: number[] }): SupervisorService {
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
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  };

  return {
    config: {} as SupervisorService["config"],
    pollIntervalMs: async () => 60_000,
    runOnce: async () => "run-once complete",
    queryStatus: async () => ({
      gsdSummary: null,
      trustDiagnostics: doctorDiagnostics.trustDiagnostics,
      cadenceDiagnostics: doctorDiagnostics.cadenceDiagnostics,
      candidateDiscoverySummary: null,
      candidateDiscovery: null,
      activeIssue: null,
      selectionSummary: {
        selectedIssueNumber: null,
        selectionReason: "no_runnable_issue",
      },
      trackedIssues: [],
      runnableIssues: [],
      blockedIssues: [],
      detailedStatusLines: ["tracked_issues=0"],
      readinessLines: [],
      whyLines: ["selected_issue=none"],
      reconciliationPhase: null,
      reconciliationWarning: null,
      warning: null,
    }),
    queryDoctor: async () => doctorDiagnostics,
    queryExplain: async (issueNumber) => ({
      issueNumber,
      title: `Issue ${issueNumber}`,
      state: "queued",
      blockedReason: null,
      runnable: true,
      selectionReason: "selected",
      failureSummary: null,
      lastError: null,
      changeRiskLines: [],
      externalReviewFollowUpSummary: null,
      latestRecoverySummary: null,
      activityContext: null,
      reasons: ["selected"],
    }),
    queryIssueLint: async (issueNumber) => ({
      issueNumber,
      title: `Issue ${issueNumber}`,
      executionReady: true,
      missingRequired: [],
      missingRecommended: [],
      metadataErrors: [],
      highRiskBlockingAmbiguity: null,
      repairGuidance: [],
    }),
    runRecoveryAction: async (action, issueNumber) => ({
      action,
      issueNumber,
      outcome: "mutated",
      summary: `Requeued issue #${issueNumber}.`,
      previousState: "blocked",
      previousRecordSnapshot: null,
      nextState: "queued",
      recoveryReason: "operator_requested",
    }),
    pruneOrphanedWorkspaces: async () => {
      args?.pruneCalls?.push(Date.now());
      return {
        action: "prune-orphaned-workspaces",
        outcome: "completed",
        summary: "Pruned 0 orphaned workspaces.",
        pruned: [],
        skipped: [],
      };
    },
    resetCorruptJsonState: async () => ({
      action: "reset-corrupt-json-state",
      outcome: "mutated",
      summary: "Reset corrupt JSON state.",
      stateFile: "/tmp/state.json",
      quarantinedFile: "/tmp/state.json.corrupt",
      quarantinedAt: "2026-03-22T00:00:00.000Z",
    }),
    subscribeEvents: () => () => {},
  };
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveChromeExecutable();
  return await chromium.launch({
    executablePath,
    headless: true,
  });
}

function resolveChromeExecutable(): string {
  const explicitPath = process.env.CHROME_BIN;
  if (explicitPath && explicitPath.trim().length > 0) {
    return explicitPath;
  }

  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
    } catch {
      continue;
    }
  }

  throw new Error("Set CHROME_BIN to a local Chrome/Chromium executable for the WebUI smoke test.");
}

async function waitForCodeText(page: Page, id: string, pattern: RegExp): Promise<void> {
  await page.waitForFunction(
    ([elementId, source, flags]) => {
      const element = document.getElementById(elementId);
      return !!element && new RegExp(source, flags).test(element.textContent ?? "");
    },
    [id, pattern.source, pattern.flags],
  );
}

test("browser smoke loads the read-only dashboard against the live HTTP fixture", async (t) => {
  const server = createSupervisorHttpServer({
    service: createStubService(),
  });
  t.after(async () => {
    await closeServer(server);
  });

  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
  });

  const port = await listen(server);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  await page.waitForSelector("[data-dashboard-root]");
  await page.waitForFunction(() => document.getElementById("doctor-overall")?.textContent === "pass");
  await waitForCodeText(page, "status-lines", /tracked_issues=0/u);

  assert.equal(await page.textContent("h1"), "Operator dashboard");
  assert.equal(await page.textContent("#selected-issue-badge"), "none");
  assert.equal(await page.textContent("#connection-state"), "connected");
  assert.match((await page.textContent("#command-result")) ?? "", /Structured command result JSON appears here\./u);
  assert.match((await page.textContent("#event-list")) ?? "", /Waiting for live events/u);
});

test("browser smoke runs a confirmed safe command through the dashboard", async (t) => {
  const pruneCalls: number[] = [];
  const server = createSupervisorHttpServer({
    service: createStubService({ pruneCalls }),
  });
  t.after(async () => {
    await closeServer(server);
  });

  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
  });

  const port = await listen(server);
  const page = await browser.newPage();
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.goto(`http://127.0.0.1:${port}/`);

  await page.waitForFunction(() => document.getElementById("doctor-overall")?.textContent === "pass");
  await page.click("#prune-workspaces-button");
  await page.waitForFunction(() => document.getElementById("command-status")?.textContent === "Pruned 0 orphaned workspaces.");
  await waitForCodeText(page, "command-result", /"action": "prune-orphaned-workspaces"/u);
  await waitForCodeText(page, "command-result", /"outcome": "completed"/u);
  await waitForCodeText(
    page,
    "command-result",
    /"summary": "Pruned 0 orphaned workspaces\."/u,
  );

  assert.equal(pruneCalls.length, 1);
});
