import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnoseSetupReadiness } from "./setup-readiness";
import {
  summarizeLocalCiContract,
  summarizeLocalReviewPosture,
  summarizeReleaseReadinessGate,
  summarizeTrustDiagnostics,
} from "./core/config";

interface TrustPostureConfigField {
  field: string;
  values?: string[];
  default?: string | boolean | null;
  requiredBySetupReadiness?: boolean;
  operatorAuthorityBoundary: string;
  setupReadinessSurface: string;
  dangerousOptIn?: boolean;
}

interface TrustPostureCombination {
  trustMode: string;
  executionSafetyMode: string;
  posture: string;
  dangerousOptIn: boolean;
}

interface TrustPostureConfigSchema {
  contractName: string;
  contractVersion: number;
  canonicalGuide: string;
  enforcementBoundary: string;
  setupReadinessEndpoint: string;
  fields: TrustPostureConfigField[];
  trustSafetyCombinations: TrustPostureCombination[];
  dangerousOptIns: string[];
  localCiPostures: Array<{ source: string; configured: boolean; summary: string }>;
  reviewProviderPosture: {
    configuredWhen: string[];
    signalSources: string[];
    operatorAuthorityBoundary: string;
  };
}

const schemaPath = resolve(process.cwd(), "docs/trust-posture-config.schema.json");

function readSchema(): TrustPostureConfigSchema {
  return JSON.parse(readFileSync(schemaPath, "utf8")) as TrustPostureConfigSchema;
}

test("published trust posture config schema captures the portable contract fields", () => {
  const schema = readSchema();

  assert.equal(schema.contractName, "codex-supervisor.trust-posture-config");
  assert.equal(schema.contractVersion, 1);
  assert.equal(schema.canonicalGuide, "docs/configuration.md");
  assert.equal(schema.enforcementBoundary, "config-loader-and-setup-readiness");
  assert.equal(schema.setupReadinessEndpoint, "GET /api/setup-readiness");

  const fields = new Map(schema.fields.map((field) => [field.field, field]));
  assert.deepEqual(fields.get("trustMode")?.values, ["trusted_repo_and_authors", "untrusted_or_mixed"]);
  assert.equal(fields.get("trustMode")?.requiredBySetupReadiness, true);
  assert.deepEqual(fields.get("executionSafetyMode")?.values, ["unsandboxed_autonomous", "operator_gated"]);
  assert.equal(fields.get("executionSafetyMode")?.requiredBySetupReadiness, true);
  assert.equal(fields.get("localCiCommand")?.setupReadinessSurface, "localCiContract");
  assert.equal(fields.get("configuredReviewProviders")?.setupReadinessSurface, "providerPosture");

  for (const field of ["localReviewFollowUpRepairEnabled", "localReviewManualReviewRepairEnabled", "localReviewFollowUpIssueCreationEnabled"]) {
    assert.equal(fields.get(field)?.dangerousOptIn, true, `${field} must stay visibly separate from defaults`);
  }
  assert.deepEqual(schema.dangerousOptIns, [
    "executionSafetyMode: unsandboxed_autonomous",
    "localReviewPosture: repair_high_severity",
    "localReviewPosture: follow_up_issue_creation",
    "localReviewFollowUpRepairEnabled",
    "localReviewManualReviewRepairEnabled",
    "localReviewFollowUpIssueCreationEnabled",
    "localReviewHighSeverityAction: retry",
    "staleConfiguredBotReviewPolicy: reply_only|reply_and_resolve",
    "approvedTrackedTopLevelEntries",
    "releaseReadinessGate: block_release_publication",
  ]);
});

test("published trust posture config schema maps to current validation and readiness behavior", async () => {
  const schema = readSchema();
  const combinations = schema.trustSafetyCombinations.map((entry) => ({
    trustMode: entry.trustMode,
    executionSafetyMode: entry.executionSafetyMode,
    dangerousOptIn: entry.dangerousOptIn,
  }));

  assert.deepEqual(combinations, [
    { trustMode: "trusted_repo_and_authors", executionSafetyMode: "operator_gated", dangerousOptIn: false },
    { trustMode: "untrusted_or_mixed", executionSafetyMode: "operator_gated", dangerousOptIn: false },
    { trustMode: "trusted_repo_and_authors", executionSafetyMode: "unsandboxed_autonomous", dangerousOptIn: true },
    { trustMode: "untrusted_or_mixed", executionSafetyMode: "unsandboxed_autonomous", dangerousOptIn: true },
  ]);

  assert.equal(
    summarizeTrustDiagnostics({
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }).warning !== null,
    true,
  );
  assert.equal(
    summarizeTrustDiagnostics({
      trustMode: "untrusted_or_mixed",
      executionSafetyMode: "operator_gated",
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }).warning,
    null,
  );

  assert.equal(summarizeLocalCiContract({}).source, "config");
  assert.equal(summarizeLocalCiContract({ localCiCommand: "npm run verify:pre-pr" }).configured, true);
  assert.equal(
    summarizeLocalReviewPosture({
      localReviewPosture: "repair_high_severity",
      localReviewEnabled: true,
      localReviewPolicy: "block_merge",
      localReviewFollowUpIssueCreationEnabled: false,
      localReviewHighSeverityAction: "retry",
    }).autoRepair,
    "high_severity_only",
  );
  assert.equal(summarizeReleaseReadinessGate({ releaseReadinessGate: "block_release_publication" }).canBlock[0], "release_publication");

  const readiness = await diagnoseSetupReadiness({
    configPath: resolve(process.cwd(), "supervisor.config.example.json"),
    authStatus: async () => ({ ok: true, message: null }),
  });
  assert.deepEqual(
    readiness.fields
      .filter((field) => field.key === "trustMode" || field.key === "executionSafetyMode")
      .map((field) => [field.key, field.metadata.valueType, field.required]),
    [
      ["trustMode", "trust_mode", true],
      ["executionSafetyMode", "execution_safety_mode", true],
    ],
  );
});
