import assert from "node:assert/strict";
import test from "node:test";
import {
  createSetupConfigPreview,
  createSetupConfigUpdateResult,
  createSetupDocument,
  createSetupField,
  createSetupReadinessReport,
  createUnavailableManagedRestart,
  withManagedRestart,
} from "./setup-test-fixtures";

test("createSetupReadinessReport builds the shared missing-provider fixture by default", () => {
  const report = createSetupReadinessReport();

  assert.equal(report.kind, "setup_readiness");
  assert.equal(report.ready, false);
  assert.equal(report.fields[0]?.key, "repoPath");
  assert.equal(report.fields.at(-1)?.key, "reviewProvider");
  assert.equal(report.blockers[0]?.code, "missing_review_provider");
  assert.equal(report.nextActions[0]?.action, "fix_config");
  assert.equal(report.nextActions[0]?.required, true);
  assert.equal(report.providerPosture.summary, "No review provider is configured.");
});

test("setup test fixtures allow targeted overrides without rewriting the full payload", () => {
  const report = createSetupReadinessReport({
    ready: true,
    overallStatus: "configured",
    fields: [
      createSetupField("localCiCommand", {
        state: "configured",
        value: "npm run verify:pre-pr",
        message: "Local CI command is configured.",
      }),
    ],
    blockers: [],
  });
  const response = withManagedRestart(
    createSetupConfigUpdateResult({
      updatedFields: ["localCiCommand"],
      readiness: report,
    }),
    createUnavailableManagedRestart(),
  );

  assert.equal(response.managedRestart.state, "unavailable");
  assert.deepEqual(response.updatedFields, ["localCiCommand"]);
  assert.equal(response.readiness.ready, true);
  assert.equal(response.readiness.fields[0]?.value, "npm run verify:pre-pr");
});

test("createSetupField returns fresh metadata for each fixture", () => {
  const first = createSetupField("repoPath");
  first.metadata.valueType = "text";

  const second = createSetupField("repoPath");
  assert.equal(second.metadata.valueType, "directory_path");
});

test("createSetupDocument returns fresh review bot login arrays", () => {
  const first = createSetupDocument();
  const firstReviewBotLogins = first.reviewBotLogins;
  assert.ok(Array.isArray(firstReviewBotLogins));
  firstReviewBotLogins.push("coderabbitai");

  const second = createSetupDocument();
  assert.deepEqual(second.reviewBotLogins, ["chatgpt-codex-connector"]);
});

test("createSetupConfigPreview clones nested supported profiles and validation", () => {
  const first = createSetupConfigPreview();
  first.supportedReviewProviderProfiles[0]?.reviewBotLogins.push("extra-bot");
  first.validation.invalidFields.push("repoPath");

  const second = createSetupConfigPreview();
  assert.deepEqual(second.supportedReviewProviderProfiles[0]?.reviewBotLogins, []);
  assert.deepEqual(second.validation.invalidFields, []);
});
