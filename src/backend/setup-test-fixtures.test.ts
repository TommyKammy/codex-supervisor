import assert from "node:assert/strict";
import test from "node:test";
import {
  createSetupConfigUpdateResult,
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
