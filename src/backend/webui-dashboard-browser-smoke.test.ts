import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import type { DoctorDiagnostics } from "../doctor";
import type { SetupConfigUpdateResult } from "../setup-config-write";
import type { SetupReadinessReport } from "../setup-readiness";
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
    ([elementId, source, flags]) => {
      const element = document.getElementById(elementId);
      return !!element && new RegExp(source, flags).test(element.textContent ?? "");
    },
    [id, pattern.source, pattern.flags],
  );
}

async function dragPanelHandle(page: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const sourceHandle = document.querySelector(from);
      const targetHandle = document.querySelector(to);
      if (!(sourceHandle instanceof HTMLElement) || !(targetHandle instanceof HTMLElement)) {
        throw new Error(`Expected drag handles for ${from} -> ${to}.`);
      }

      sourceHandle.scrollIntoView({ block: "center", inline: "center" });
      targetHandle.scrollIntoView({ block: "center", inline: "center" });

      const sourceRect = sourceHandle.getBoundingClientRect();
      const targetRect = targetHandle.getBoundingClientRect();
      const sourceX = sourceRect.left + sourceRect.width / 2;
      const sourceY = sourceRect.top + sourceRect.height / 2;
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;

      sourceHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: sourceX,
          clientY: sourceY,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
      for (let step = 1; step <= 12; step += 1) {
        const progress = step / 12;
        sourceHandle.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: sourceX + (targetX - sourceX) * progress,
            clientY: sourceY + (targetY - sourceY) * progress,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      }
      sourceHandle.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: targetX,
          clientY: targetY,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    },
    { from: sourceSelector, to: targetSelector },
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

test("browser smoke reorders the dashboard with keyboard controls in reduced motion mode", async (t) => {
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
  const context = await browser.newContext({ reducedMotion: "reduce" });
  t.after(async () => {
    await context.close();
  });

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  await page.waitForSelector("[data-dashboard-root]");
  await page.waitForFunction(() => document.getElementById("doctor-overall")?.textContent === "pass");
  await page.focus("#panel-drag-operator-actions");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.getElementById("panel-operator-actions")?.classList.contains("drag-active"));
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => document.getElementById("panel-tracked-history")?.classList.contains("drop-target"));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("#details-grid > article"))
        .map((element) => element.id)
        .join(",") ===
      "panel-issue-details,panel-operator-actions,panel-tracked-history,panel-live-events,panel-operator-timeline",
  );

  assert.deepEqual(
    await page.locator("#details-grid > article").evaluateAll((elements) => elements.map((element) => element.id)),
    [
      "panel-issue-details",
      "panel-operator-actions",
      "panel-tracked-history",
      "panel-live-events",
      "panel-operator-timeline",
    ],
  );
  assert.equal(await page.textContent("#connection-state"), "connected");
  assert.equal(await page.textContent("#dashboard-panel-reorder-status"), "Moved operator actions panel before tracked history.");
});

test("browser smoke reorders the dashboard with pointer dragging in both horizontal directions", async (t) => {
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

  await dragPanelHandle(page, "#panel-drag-operator-actions", "#panel-drag-operator-timeline");
  assert.equal(await page.textContent("#dashboard-panel-reorder-status"), "Moved operator actions panel before operator timeline.");
  assert.deepEqual(
    await page.locator("#details-grid > article").evaluateAll((elements) => elements.map((element) => element.id)),
    [
      "panel-issue-details",
      "panel-tracked-history",
      "panel-live-events",
      "panel-operator-actions",
      "panel-operator-timeline",
    ],
  );
  await dragPanelHandle(page, "#panel-drag-operator-timeline", "#panel-drag-tracked-history");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("#details-grid > article"))
        .map((element) => element.id)
        .join(",") ===
      "panel-issue-details,panel-operator-timeline,panel-tracked-history,panel-live-events,panel-operator-actions",
  );

  assert.deepEqual(
    await page.locator("#details-grid > article").evaluateAll((elements) => elements.map((element) => element.id)),
    [
      "panel-issue-details",
      "panel-operator-timeline",
      "panel-tracked-history",
      "panel-live-events",
      "panel-operator-actions",
    ],
  );
  assert.equal(await page.textContent("#dashboard-panel-reorder-status"), "Moved operator timeline panel before tracked history.");
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

function createFirstRunSetupService(args: {
  updateCalls: Array<unknown>;
  readinessCalls: number[];
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
      readiness = {
        ...readiness,
        ready: true,
        overallStatus: "configured",
        fields: [
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
        updatedFields: ["repoPath", "reviewProvider"],
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
  assert.ok(readinessCalls.length >= 2);
});
