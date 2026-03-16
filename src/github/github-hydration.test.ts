import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRollupChecks } from "./github-hydration";

test("normalizeRollupChecks keeps the newest check per workflow and context", () => {
  const checks = normalizeRollupChecks({
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "build",
        workflowName: "CI",
        detailsUrl: "https://example.test/checks/build-old",
        conclusion: "FAILURE",
        status: "COMPLETED",
        completedAt: "2026-03-13T02:01:00Z",
      },
      {
        __typename: "CheckRun",
        name: "build",
        workflowName: "CI",
        detailsUrl: "https://example.test/checks/build-new",
        conclusion: "SUCCESS",
        status: "COMPLETED",
        completedAt: "2026-03-13T02:02:00Z",
      },
      {
        __typename: "StatusContext",
        context: "lint",
        targetUrl: "https://example.test/checks/lint",
        state: "PENDING",
        startedAt: "2026-03-13T02:03:00Z",
      },
    ],
  });

  assert.deepEqual(checks, [
    {
      name: "build",
      state: "SUCCESS",
      bucket: "pass",
      workflow: "CI",
      link: "https://example.test/checks/build-new",
    },
    {
      name: "lint",
      state: "PENDING",
      bucket: "pending",
      link: "https://example.test/checks/lint",
    },
  ]);
});
