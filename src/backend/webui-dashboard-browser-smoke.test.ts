import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { chromium, type Browser, type Dialog, type Page } from "playwright-core";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupConfigUpdateResult } from "../setup-config-write";
import type { SetupReadinessFieldKey, SetupReadinessReport } from "../setup-readiness";
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
      loopRuntime: {
        state: "off",
        pid: null,
        startedAt: null,
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
      staleRecoveryWarningSummary: null,
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
    (args: string[]) => {
      const [elementId, source, flags] = args;
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

  assert.equal(await page.textContent(".topbar-title h1"), "Operator dashboard");
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
  page.on("dialog", async (dialog: Dialog) => {
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

function createFirstRunSetupService(args: {
  updateCalls: Array<unknown>;
  readinessCalls: number[];
  restartRequired?: boolean;
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
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  };

  let readiness: SetupReadinessReport = {
    kind: "setup_readiness",
    ready: false,
    overallStatus: "missing",
    configPath: "/tmp/supervisor.config.json",
    fields: [
      {
        key: "repoPath",
        label: "Repository path",
        state: "missing",
        value: null,
        message: "Repository path is required before first-run setup is complete.",
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
        code: "missing_repo_path",
        message: "Repository path is required before first-run setup is complete.",
        fieldKeys: ["repoPath"],
        remediation: {
          kind: "edit_config",
          summary: "Set repoPath in the supervisor config.",
          fieldKeys: ["repoPath"],
        },
      },
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
      warning: null,
      summary: "Trusted inputs with unsandboxed autonomous execution.",
    },
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
      loopRuntime: {
        state: "off",
        pid: null,
        startedAt: null,
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
      staleRecoveryWarningSummary: null,
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
    pruneOrphanedWorkspaces: async () => ({
      action: "prune-orphaned-workspaces",
      outcome: "completed",
      summary: "Pruned 0 orphaned workspaces.",
      pruned: [],
      skipped: [],
    }),
    resetCorruptJsonState: async () => ({
      action: "reset-corrupt-json-state",
      outcome: "mutated",
      summary: "Reset corrupt JSON state.",
      stateFile: "/tmp/state.json",
      quarantinedFile: "/tmp/state.json.corrupt",
      quarantinedAt: "2026-03-22T00:00:00.000Z",
    }),
    querySetupReadiness: async () => {
      args.readinessCalls.push(Date.now());
      return readiness;
    },
    updateSetupConfig: async (options): Promise<SetupConfigUpdateResult> => {
      args.updateCalls.push(options);
      const restartRequired = args.restartRequired ?? true;
      const updatedFields: SetupReadinessFieldKey[] = options.changes.repoPath
        ? ["repoPath", "reviewProvider"]
        : ["reviewProvider"];
      const restartTriggeredByFields: SetupReadinessFieldKey[] = restartRequired ? updatedFields : [];
      readiness = {
        ...readiness,
        ready: true,
        overallStatus: "configured",
        fields: options.changes.repoPath
          ? [
            {
              key: "repoPath",
              label: "Repository path",
              state: "configured",
              value: options.changes.repoPath ?? "/tmp/repo",
              message: "Repository path is configured.",
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
              state: "configured",
              value: "chatgpt-codex-connector",
              message: "Review provider posture is configured.",
              required: true,
              metadata: {
                source: "config",
                editable: true,
                valueType: "review_provider",
              },
            },
          ]
          : [
            {
              key: "reviewProvider",
              label: "Review provider",
              state: "configured",
              value: "chatgpt-codex-connector",
              message: "Review provider posture is configured.",
              required: true,
              metadata: {
                source: "config",
                editable: true,
                valueType: "review_provider",
              },
            },
          ],
        blockers: [],
        providerPosture: {
          profile: "codex",
          provider: "codex",
          reviewers: ["chatgpt-codex-connector"],
          signalSource: "review_bot_logins",
          configured: true,
          summary: "Codex Connector is configured.",
        },
      };

      return {
        kind: "setup_config_update",
        configPath: readiness.configPath,
        backupPath: null,
        updatedFields,
        restartRequired,
        restartScope: restartRequired ? "supervisor" : null,
        restartTriggeredByFields,
        document: {
          repoPath: options.changes.repoPath ?? "/tmp/repo",
          reviewBotLogins: ["chatgpt-codex-connector"],
        },
        readiness,
      };
    },
    subscribeEvents: () => () => {},
  };
}

test("browser smoke completes the first-run setup flow through the narrow config API", async (t) => {
  const updateCalls: Array<unknown> = [];
  const readinessCalls: number[] = [];
  const server = createSupervisorHttpServer({
    service: createFirstRunSetupService({ updateCalls, readinessCalls }),
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

  await page.waitForSelector("[data-setup-root]");
  await page.waitForSelector("#setup-input-repoPath");
  await page.fill("#setup-input-repoPath", "/tmp/repo");
  await page.selectOption("#setup-input-reviewProvider", "codex");
  await page.click("#setup-save-button");

  await page.waitForFunction(() => document.getElementById("setup-save-status")?.textContent === "Saved 2 setup fields.");
  await page.waitForFunction(() => document.getElementById("setup-overall-status")?.textContent === "configured");
  await page.waitForFunction(() => document.getElementById("setup-restart-status")?.textContent === "Restart required");
  await page.waitForFunction(
    () => document.getElementById("setup-blocker-summary")?.textContent === "No blocking setup conditions remain.",
  );

  assert.deepEqual(updateCalls, [
    {
      changes: {
        repoPath: "/tmp/repo",
        reviewProvider: "codex",
      },
    },
  ]);
  assert.equal(await page.textContent("h1"), "First-run setup");
  assert.match((await page.textContent("#setup-provider-posture")) ?? "", /Codex Connector is configured\./u);
  assert.match(
    (await page.textContent("#setup-restart-details")) ?? "",
    /Saved changes to repoPath, reviewProvider require a supervisor restart before they take effect\./u,
  );
  assert.equal(await page.isDisabled("#setup-restart-button"), true);
  assert.ok(readinessCalls.length >= 2);
});

test("browser smoke reports when a setup save is already effective", async (t) => {
  const updateCalls: Array<unknown> = [];
  const readinessCalls: number[] = [];
  const server = createSupervisorHttpServer({
    service: createFirstRunSetupService({ updateCalls, readinessCalls, restartRequired: false }),
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

  await page.waitForSelector("[data-setup-root]");
  await page.waitForSelector("#setup-input-reviewProvider");
  await page.selectOption("#setup-input-reviewProvider", "codex");
  await page.click("#setup-save-button");

  await page.waitForFunction(() => document.getElementById("setup-save-status")?.textContent === "Saved 1 setup field.");
  await page.waitForFunction(() => document.getElementById("setup-restart-status")?.textContent === "Saved and effective");

  assert.deepEqual(updateCalls, [
    {
      changes: {
        reviewProvider: "codex",
      },
    },
  ]);
  assert.match(
    (await page.textContent("#setup-restart-details")) ?? "",
    /Saved changes to reviewProvider are already effective\. No supervisor restart is required for this save\./u,
  );
  assert.equal(await page.isDisabled("#setup-restart-button"), true);
  assert.ok(readinessCalls.length >= 2);
});

test("browser smoke enables launcher-managed restart only when capability is present", async (t) => {
  const updateCalls: Array<unknown> = [];
  const readinessCalls: number[] = [];
  let restartRequests = 0;
  const server = createSupervisorHttpServer({
    service: createFirstRunSetupService({ updateCalls, readinessCalls }),
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
          summary: "Managed restart requested through the systemd launcher. The worker is reconnecting while this WebUI shell stays available.",
        };
      },
    },
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

  await page.waitForSelector("[data-setup-root]");
  await page.waitForSelector("#setup-input-repoPath");
  await page.fill("#setup-input-repoPath", "/tmp/repo");
  await page.selectOption("#setup-input-reviewProvider", "codex");
  await page.click("#setup-save-button");

  await page.waitForFunction(() => document.getElementById("setup-restart-status")?.textContent === "Restart required");
  await page.waitForFunction(() => {
    const button = document.getElementById("setup-restart-button");
    return button instanceof HTMLButtonElement && button.disabled === false;
  });

  assert.match(
    (await page.textContent("#setup-restart-guidance")) ?? "",
    /Managed restart is available through the systemd launcher\./u,
  );

  await page.click("#setup-restart-button");
  await page.waitForFunction(
    () => document.getElementById("setup-restart-guidance")?.textContent ===
      "Managed restart requested through the systemd launcher. The worker is reconnecting while this WebUI shell stays available.",
  );

  assert.equal(restartRequests, 1);
  assert.equal(await page.isDisabled("#setup-restart-button"), true);
  assert.ok(readinessCalls.length >= 2);
});
