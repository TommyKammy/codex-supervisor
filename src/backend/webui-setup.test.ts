import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createSetupField,
  createSetupProviderPosture,
  createSetupReadinessReport,
  createSetupTrustPosture,
  createUnavailableManagedRestart,
  withManagedRestart,
} from "./setup-test-fixtures";
import { createSetupHarness, jsonResponse } from "./webui-dashboard-test-fixtures";

const unavailableManagedRestart = createUnavailableManagedRestart();

test("WebUI setup API declares a server-side setup diagnostics DTO boundary", async () => {
  const content = await fs.readFile(path.join(process.cwd(), "src", "backend", "supervisor-http-server.ts"), "utf8");

  assert.match(content, /SetupReadinessResponseDto[\s\S]*SharedDiagnosticHostSummaryDto/u);
  assert.doesNotMatch(content, /interface SetupReadinessResponseDto extends SetupReadinessReport/u);
});

test("setup shell renders guided local CI adoption flow details", async () => {
  const harness = createSetupHarness([
    {
      path: "/api/setup-readiness",
      response: jsonResponse(withManagedRestart(createSetupReadinessReport({
        ready: true,
        overallStatus: "configured",
        fields: [
          createSetupField("localCiCommand"),
        ],
        blockers: [],
        hostReadiness: { overallStatus: "pass", checks: [] },
        providerPosture: createSetupProviderPosture({
          profile: "codex",
          provider: "codex",
          reviewers: ["chatgpt-codex-connector"],
          signalSource: "review_bot_logins",
          configured: true,
          summary: "Codex Connector is configured.",
        }),
        trustPosture: createSetupTrustPosture({ warning: null }),
        localCiContract: {
          configured: false,
          command: null,
          recommendedCommand: "npm run verify:pre-pr",
          source: "repo_script_candidate",
          summary:
            "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
          adoptionFlow: {
            state: "candidate_detected",
            candidateDetected: true,
            commandPreview: "npm run verify:pre-pr",
            validationStatus: "not_run",
            workspacePreparationCommand: null,
            workspacePreparationRecommendedCommand: "npm ci",
            workspacePreparationGuidance:
              "workspacePreparationCommand is unset. Recommended repo-native preparation command: npm ci.",
            decisions: [
              {
                kind: "adopt",
                enabled: true,
                summary: "Save npm run verify:pre-pr as localCiCommand.",
                writes: ["localCiCommand"],
              },
              {
                kind: "dismiss",
                enabled: true,
                summary: "Record localCiCandidateDismissed=true without changing an already configured localCiCommand.",
                writes: ["localCiCandidateDismissed"],
              },
            ],
          },
        },
      }), unavailableManagedRestart)),
    },
  ]);
  await harness.flush();

  const details = harness.document.getElementById("setup-local-ci-details")?.textContent ?? "";
  assert.match(details, /Command preview: npm run verify:pre-pr/u);
  assert.match(details, /Validation status: not run/u);
  assert.match(details, /workspacePreparationCommand is unset\. Recommended repo-native preparation command: npm ci\./u);
  assert.match(details, /Decision: Save npm run verify:pre-pr as localCiCommand\./u);
  assert.match(
    details,
    /Decision: Record localCiCandidateDismissed=true without changing an already configured localCiCommand\./u,
  );
});
