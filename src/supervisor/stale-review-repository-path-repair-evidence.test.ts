import test from "node:test";
import assert from "node:assert/strict";
import { createReviewThread } from "../turn-execution-test-helpers";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "../codex-connector-tracked-pr-test-helpers";
import {
  deterministicRepositoryPathRepairProbeEvidence,
  requiresDeterministicRepositoryPathRepairProbeEvidence,
} from "./stale-review-repository-path-repair-evidence";

function codexPathListThread({
  body,
  path = "src/review-policy.ts",
  severity = "P2",
}: {
  body: string;
  path?: string;
  severity?: "P1" | "P2" | "P3";
}) {
  return createReviewThread({
    id: `thread-${path}`,
    path,
    comments: {
      nodes: [
        {
          id: `comment-${path}`,
          body: `${severity}: ${body}`,
          createdAt: "2026-06-05T21:10:00Z",
          url: "https://example.test/pr/2421#discussion_r1",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
}

test("deterministicRepositoryPathRepairProbeEvidence finds requested live path list membership", () => {
  const policyPath = "src/review-policy.ts";
  const documentPath = "docs/policy/page.mdx";
  const componentPath = "src/components/view.tsx";
  const thread = codexPathListThread({
    body: `Add \`${componentPath}\` and \`${documentPath}\` to the policy scan path list.`,
    path: `./${policyPath}`,
  });

  assert.equal(
    deterministicRepositoryPathRepairProbeEvidence({
      reviewThreads: [thread],
      repositoryFileContents: {
        [policyPath]: [
          "const POLICY_SCAN_PATHS = [",
          `  "${documentPath}",`,
          `  "${componentPath}",`,
          "];",
        ].join("\n"),
      },
    }),
    [
      `deterministic_repair_probe:path_present_in_requested_live_lists:${documentPath}:policy_scan`,
      `deterministic_repair_probe:path_present_in_requested_live_lists:${componentPath}:policy_scan`,
    ].join(";"),
  );
});

test("deterministicRepositoryPathRepairProbeEvidence normalizes repository file content keys", () => {
  const policyPath = "src/review-policy.ts";
  const documentPath = "docs/policy/page.md";
  const thread = codexPathListThread({
    body: `Append ${documentPath} to the loader path array.`,
    path: String.raw`.\src\review-policy.ts`,
  });

  assert.equal(
    deterministicRepositoryPathRepairProbeEvidence({
      reviewThreads: [thread],
      repositoryFileContents: {
        [policyPath]: [
          "const LOADER_PATHS = [",
          `  "${documentPath}",`,
          "];",
        ].join("\n"),
      },
    }),
    `deterministic_repair_probe:path_present_in_requested_live_lists:${documentPath}:loader`,
  );
});

test("deterministicRepositoryPathRepairProbeEvidence fails closed for inverse lists and non-additive findings", () => {
  const policyPath = "src/review-policy.ts";
  const documentPath = "docs/policy/page.md";
  const inverseThread = codexPathListThread({
    body: `Add \`${documentPath}\` to the policy scan path list.`,
    path: policyPath,
  });
  const nonAdditiveThread = codexPathListThread({
    body: `Deduplicate \`${documentPath}\` from the loader path list.`,
    path: policyPath,
  });

  assert.equal(
    deterministicRepositoryPathRepairProbeEvidence({
      reviewThreads: [inverseThread],
      repositoryFileContents: {
        [policyPath]: [
          "const excludedPolicyScanPaths = [",
          `  "${documentPath}",`,
          "];",
        ].join("\n"),
      },
    }),
    null,
  );
  assert.equal(
    deterministicRepositoryPathRepairProbeEvidence({
      reviewThreads: [nonAdditiveThread],
      repositoryFileContents: {
        [policyPath]: [
          "const LOADER_PATHS = [",
          `  "${documentPath}",`,
          "];",
        ].join("\n"),
      },
    }),
    null,
  );
});

test("requiresDeterministicRepositoryPathRepairProbeEvidence only flags concrete path-list findings", () => {
  assert.equal(
    requiresDeterministicRepositoryPathRepairProbeEvidence([
      codexPathListThread({
        body: "Add `docs/policy/page.md` to the coverage expectation array.",
      }),
    ]),
    true,
  );
  assert.equal(
    requiresDeterministicRepositoryPathRepairProbeEvidence([
      codexPathListThread({
        body: "Add coverage for the missing policy behavior.",
      }),
    ]),
    false,
  );
});
