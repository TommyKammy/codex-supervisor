import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexConnectorP2P3PolicyDiagnostic,
  buildCodexConnectorPolicyBlockDiagnostic,
  buildCodexConnectorReviewChurnDiagnostic,
  clusterConfiguredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  evaluateCodexConnectorConvergencePolicy,
  formatCodexConnectorReviewChurnDiagnostic,
} from "./codex-connector-review-policy";
import type { GitHubPullRequest, ReviewThread } from "./core/types";
import { createConfig, createReviewThread } from "./turn-execution-test-helpers";

function codexThread(overrides: Partial<ReviewThread> & { body: string }): ReviewThread {
  return createReviewThread({
    ...overrides,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: overrides.body,
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
}

test("Codex Connector policy classifies must-fix, nitpick, and stale review commit findings", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const p2Thread = codexThread({
    id: "thread-p2",
    body: "P2: Preserve failed restore cleanup as a blocking verification failure.",
  });
  const p3NitpickThread = codexThread({
    id: "thread-p3-softened",
    body: "P3: Nitpick: prefer a shorter helper name for readability.",
  });
  const p3RiskThread = codexThread({
    id: "thread-p3-escalated",
    body: "P3: This cleanup can cause a regression in the restore failure path.",
  });
  const pr: Pick<
    GitHubPullRequest,
    "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"
  > = {
    headRefOid: "head-new",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: "head-old",
  };

  assert.deepEqual(codexConnectorMustFixReviewThreads([p2Thread, p3NitpickThread, p3RiskThread]), [
    p2Thread,
    p3RiskThread,
  ]);
  assert.deepEqual(codexConnectorStaleReviewCommitThreads(pr, [p2Thread]), [p2Thread]);
  assert.deepEqual(buildCodexConnectorP2P3PolicyDiagnostic(config, [p2Thread, p3NitpickThread, p3RiskThread]), {
    p2Actionable: 1,
    p3Softened: 1,
    p3Escalated: 1,
  });
});

test("Codex Connector policy diagnostics and convergence stay focused in the policy module", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const p1Thread = codexThread({
    id: "thread-p1",
    path: "src/policy.ts",
    line: 12,
    body: "P1: Tighten the diagnostic wording before merge.",
  });
  const p0Thread = codexThread({
    id: "thread-p0",
    path: "src/auth.ts",
    line: 24,
    body: "P0: Keep the authorization bypass blocked.",
  });

  assert.deepEqual(buildCodexConnectorPolicyBlockDiagnostic(config, [p1Thread, p0Thread]), {
    count: 2,
    severity: "P0",
    file: "src/auth.ts",
    line: "24",
    threadUrl: "https://example.test/pr/44#discussion_r1",
    nextAction: "fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path",
  });
  assert.equal(
    evaluateCodexConnectorConvergencePolicy(config, { configuredBotCurrentHeadObservedAt: "2026-03-11T00:04:00Z" }, [
      p0Thread,
    ])?.outcome,
    "must_fix_remaining",
  );
});

test("Codex Connector policy clusters repeated configured-bot findings", () => {
  const body =
    "P1: Missing verifier coverage lets failed restore writes leave a half-restored durable state. Add a regression.";
  const firstThread = codexThread({
    id: "thread-restore",
    path: "src/restore.ts",
    line: 42,
    body,
  });
  const secondThread = codexThread({
    id: "thread-restore-test",
    path: "src/restore.test.ts",
    line: 88,
    body,
  });
  const unrelatedThread = codexThread({
    id: "thread-export",
    path: "src/export.ts",
    line: 12,
    body: "P2: Export readiness must reject mixed-snapshot rows instead of stitching partial results together.",
  });

  const clusters = clusterConfiguredBotReviewThreads([firstThread, secondThread, unrelatedThread]);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0]?.threads.map((thread) => thread.id), ["thread-restore", "thread-restore-test"]);
  assert.deepEqual(clusters[1]?.threads.map((thread) => thread.id), ["thread-export"]);
});

test("Codex Connector policy detects concentrated must-fix review churn", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    codexConnectorReviewChurnMustFixThreshold: 4,
    codexConnectorReviewChurnFileConcentrationPercent: 75,
  });
  const threads = [
    codexThread({
      id: "thread-authority",
      path: "scripts/verify-release-inventory.sh",
      line: 101,
      body: "P2: Reject release-bundle authority claims before they become RC/GA readiness assertions.",
    }),
    codexThread({
      id: "thread-truth",
      path: "scripts/verify-release-inventory.sh",
      line: 144,
      body: "P2: Block truth-source assertions that describe the inventory as authoritative.",
    }),
    codexThread({
      id: "thread-scope",
      path: "scripts/verify-release-inventory.sh",
      line: 188,
      body: "P2: Detect excluded scope claims when the bundle says subordinate sources are covered.",
    }),
    codexThread({
      id: "thread-regex",
      path: "scripts/verify-release-inventory.sh",
      line: 233,
      body: "P2: Generalize the forbidden claim regex instead of allowing another readiness claim variant.",
    }),
  ];

  const diagnostic = buildCodexConnectorReviewChurnDiagnostic(config, threads);

  assert.equal(diagnostic?.mustFixCount, 4);
  assert.equal(diagnostic?.concentrationBasis, "file");
  assert.equal(diagnostic?.dominantFile, "scripts/verify-release-inventory.sh");
  assert.equal(diagnostic?.dominantFilePercent, 100);
  assert.equal(diagnostic?.nextAction, "cluster_root_cause_repair");
  assert.match(diagnostic?.signature ?? "", /^codex-review-churn:P2:scripts\/verify-release-inventory\.sh:/);
  assert.deepEqual(diagnostic?.representativeThreadIds, [
    "thread-authority",
    "thread-truth",
    "thread-scope",
    "thread-regex",
  ]);
  assert.match(formatCodexConnectorReviewChurnDiagnostic(diagnostic!), /^codex_connector_review_churn /);
  assert.match(formatCodexConnectorReviewChurnDiagnostic(diagnostic!), /categories=.*truth_source/);
  assert.match(formatCodexConnectorReviewChurnDiagnostic(diagnostic!), /next_action=cluster_root_cause_repair$/);
});

test("Codex Connector churn compares unrounded file concentration", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    codexConnectorReviewChurnMustFixThreshold: 8,
    codexConnectorReviewChurnFileConcentrationPercent: 70,
  });
  const uniqueTokens = [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echoes",
    "foxtrot",
    "golfing",
    "hotel",
    "indigo",
    "juliet",
    "kiloed",
    "limaaa",
    "monaco",
    "november",
    "oscar",
    "papaya",
    "quartz",
    "romeos",
    "sierra",
    "tango",
    "umbrae",
    "violet",
    "whisky",
    "xenial",
    "yellow",
    "zephyr",
    "aurora",
    "boreal",
    "cosmos",
    "dynamo",
    "ember",
    "fresco",
    "galaxy",
  ];
  const threads = uniqueTokens.map((token, index) =>
    codexThread({
      id: `thread-${token}`,
      path: index < 23 ? "scripts/dominant.sh" : `scripts/other-${index}.sh`,
      line: index + 1,
      body: `P2: ${token} ${token} ${token} ${token}.`,
    }),
  );

  assert.equal(buildCodexConnectorReviewChurnDiagnostic(config, threads), null);
});

test("Codex Connector churn honors concentrated review themes across files", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    codexConnectorReviewChurnMustFixThreshold: 8,
    codexConnectorReviewChurnFileConcentrationPercent: 70,
  });
  const threads = Array.from({ length: 8 }, (_, index) =>
    codexThread({
      id: `thread-theme-${index}`,
      path: `src/theme-${index % 4}.ts`,
      line: 20 + index,
      body:
        "P2: Missing verifier coverage lets release-bundle readiness claims bypass the authority guard. Add generalized regression coverage.",
    }),
  );

  const diagnostic = buildCodexConnectorReviewChurnDiagnostic(config, threads);

  assert.equal(diagnostic?.concentrationBasis, "theme");
  assert.equal(diagnostic?.dominantFilePercent, 25);
  assert.equal(diagnostic?.largestClusterSize, 8);
  assert.equal(diagnostic?.largestClusterPercent, 100);
  assert.match(formatCodexConnectorReviewChurnDiagnostic(diagnostic!), /concentration_basis=theme/);
});

test("Codex Connector churn categories use the Codex finding instead of later replies", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    codexConnectorReviewChurnMustFixThreshold: 1,
    codexConnectorReviewChurnFileConcentrationPercent: 70,
  });
  const thread = createReviewThread({
    id: "thread-later-human-reply",
    path: "src/churn.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-codex",
          body: "P2: Block truth-source authority claims before release readiness is inferred.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-human",
          body: "Thanks, I will take a look.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  });

  const diagnostic = buildCodexConnectorReviewChurnDiagnostic(config, [thread]);

  assert.ok(diagnostic?.normalizedCategories.includes("truth_source"));
  assert.ok(diagnostic?.normalizedCategories.includes("readiness_claim"));
  assert.notDeepEqual(diagnostic?.normalizedCategories, ["general_must_fix"]);
});
