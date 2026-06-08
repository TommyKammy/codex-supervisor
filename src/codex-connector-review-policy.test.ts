import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexConnectorP2P3PolicyDiagnostic,
  buildCodexConnectorPolicyBlockDiagnostic,
  buildCodexConnectorReviewChurnDiagnostic,
  buildCodexConnectorReviewChurnProgressSummary,
  buildReviewPolicyInput,
  clusterConfiguredBotReviewThreads,
  compareCodexConnectorReviewChurnProgress,
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

test("review policy input snapshots provider, PR, thread vocabulary, and processed evidence", () => {
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
    id: "thread-p3-risk",
    body: "P3: This cleanup can cause a regression in the restore failure path.",
  });
  const manualThread = createReviewThread({
    id: "thread-manual",
    comments: {
      nodes: [
        {
          id: "comment-human",
          body: "Please double-check the migration note.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_human",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const pr: Pick<
    GitHubPullRequest,
    "number" | "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha" | "currentHeadCiGreenAt"
  > = {
    number: 44,
    headRefOid: "head-new",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: "head-old",
    currentHeadCiGreenAt: "2026-03-11T00:03:00Z",
  };
  const input = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: "HEAD-OLD",
      external_review_head_sha: "HEAD-NEW",
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-p3-softened@head-new", "thread-p2@head-old"],
      processed_review_thread_fingerprints: [
        "thread-p3-softened@head-new#comment-1",
        "thread-p2@head-old#comment-1",
      ],
    },
    reviewThreads: [p2Thread, p3NitpickThread, p3RiskThread, manualThread],
  });

  assert.deepEqual(input.providerIdentity, {
    configuredProviderKinds: ["codex"],
    configuredBotLogins: ["chatgpt-codex-connector"],
  });
  assert.deepEqual(input.pr, {
    number: 44,
    headSha: "head-new",
    currentHeadObservedAt: null,
    latestReviewedCommitSha: "head-old",
    providerSuccessHeadSha: "head-old",
    externalReviewHeadSha: "head-new",
    currentHeadCiGreenAt: "2026-03-11T00:03:00Z",
  });

  const p2Input = input.threads.find((thread) => thread.id === "thread-p2");
  assert.equal(p2Input?.headRelation, "stale_commit");
  assert.equal(p2Input?.findingKind, "must_fix");
  assert.equal(p2Input?.boundaryOutcome, "stale_commit_thread");
  assert.equal(p2Input?.processedEvidence.processedOnCurrentHead, false);
  assert.equal(p2Input?.processedEvidence.processedOnPriorHead, true);
  assert.deepEqual(p2Input?.vocabulary, ["stale_commit_thread", "configured_bot_thread", "must_fix_finding"]);

  const p3Input = input.threads.find((thread) => thread.id === "thread-p3-softened");
  assert.equal(p3Input?.headRelation, "current_head");
  assert.equal(p3Input?.findingKind, "softened_p3_advisory");
  assert.equal(p3Input?.boundaryOutcome, "softened_p3_advisory");
  assert.equal(p3Input?.processedEvidence.processedOnCurrentHead, true);
  assert.deepEqual(p3Input?.vocabulary, [
    "current_head_thread",
    "configured_bot_thread",
    "softened_p3_advisory",
  ]);

  const p3RiskInput = input.threads.find((thread) => thread.id === "thread-p3-risk");
  assert.equal(p3RiskInput?.findingKind, "must_fix");
  assert.equal(p3RiskInput?.boundaryOutcome, "stale_commit_thread");
  assert.deepEqual(p3RiskInput?.vocabulary, [
    "stale_commit_thread",
    "configured_bot_thread",
    "must_fix_finding",
    "escalated_p3",
  ]);

  const manualInput = input.threads.find((thread) => thread.id === "thread-manual");
  assert.equal(manualInput?.findingKind, "none");
  assert.equal(manualInput?.boundaryOutcome, "manual_thread");
  assert.deepEqual(manualInput?.vocabulary, ["manual_thread"]);

  const idOnlyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-p3-softened@head-new"],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(idOnlyInput?.processedEvidence.processedOnCurrentHead, true);
  assert.equal(idOnlyInput?.headRelation, "current_head");

  const refreshedCommentInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-p3-softened@head-new"],
      processed_review_thread_fingerprints: ["thread-p3-softened@head-new#old-comment"],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(refreshedCommentInput?.processedEvidence.processedOnCurrentHead, false);
  assert.equal(refreshedCommentInput?.headRelation, "unknown");
  assert.equal(refreshedCommentInput?.boundaryOutcome, "softened_p3_advisory");

  const priorIdOnlyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-p3-softened@head-old"],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(priorIdOnlyInput?.processedEvidence.processedOnPriorHead, true);

  const priorFingerprintOnlyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: ["thread-p3-softened@head-old#comment-1"],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(priorFingerprintOnlyInput?.processedEvidence.processedOnPriorHead, false);

  const outdatedInput = buildReviewPolicyInput({
    config,
    pr: {
      ...pr,
      configuredBotCurrentHeadObservedAt: "2026-03-11T00:04:00Z",
      configuredBotLatestReviewedCommitSha: null,
    },
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads: [{ ...p3RiskThread, id: "thread-p3-outdated", isOutdated: true }],
  }).threads[0];
  assert.equal(outdatedInput?.headRelation, "unknown");
  assert.equal(outdatedInput?.findingKind, "none");
  assert.equal(outdatedInput?.boundaryOutcome, "configured_bot_thread");
  assert.deepEqual(outdatedInput?.vocabulary, ["configured_bot_thread"]);

  const outdatedManualInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads: [{ ...manualThread, id: "thread-manual-outdated", isOutdated: true }],
  }).threads[0];
  assert.deepEqual(outdatedManualInput?.vocabulary, ["manual_thread"]);
  assert.equal(outdatedManualInput?.boundaryOutcome, "manual_thread");

  const codexReplyThread = createReviewThread({
    id: "thread-codex-replied",
    comments: {
      nodes: [
        {
          id: "comment-codex-finding",
          body: "P2: Preserve the original Codex finding fingerprint.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_codex",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-supervisor-reply",
          body: "Handled in the current patch.",
          createdAt: "2026-03-11T00:01:00Z",
          url: "https://example.test/pr/44#discussion_reply",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const codexReplyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: ["thread-codex-replied@head-new#comment-codex-finding"],
    },
    reviewThreads: [codexReplyThread],
  }).threads[0];
  assert.equal(codexReplyInput?.processedEvidence.processedOnCurrentHead, true);

  const priorCodexReplyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-codex-replied@head-old"],
      processed_review_thread_fingerprints: ["thread-codex-replied@head-old#comment-supervisor-reply"],
    },
    reviewThreads: [codexReplyThread],
  }).threads[0];
  assert.equal(priorCodexReplyInput?.processedEvidence.processedOnPriorHead, true);

  const fingerprintOnlyInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: ["thread-p3-softened@head-new#comment-1"],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(fingerprintOnlyInput?.processedEvidence.processedOnCurrentHead, true);

  const legacyRawIdInput = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: ["thread-p3-softened"],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads: [p3NitpickThread],
  }).threads[0];
  assert.equal(legacyRawIdInput?.processedEvidence.processedOnCurrentHead, true);

  p2Thread.comments.nodes[0]!.body = "P3: Nitpick after snapshot mutation.";
  assert.equal(p2Input?.comments[0]?.body, "P2: Preserve failed restore cleanup as a blocking verification failure.");
});

test("review policy input exposes typed boundary outcomes for current-head and metadata residue cases", () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const p1Thread = codexThread({
    id: "thread-p1-current",
    body: "P1: Keep current-head source fixes blocking until repaired.",
  });
  const p3RiskThread = codexThread({
    id: "thread-p3-risk-current",
    body: "P3: This cleanup can cause a regression in the restore failure path.",
  });
  const p3NitpickThread = codexThread({
    id: "thread-p3-soft-current",
    body: "P3: Nitpick: prefer a shorter helper name for readability.",
  });
  const metadataOnlyThread = codexThread({
    id: "thread-metadata-only",
    body: "P2: Older finding that lacks current-head processing evidence.",
  });
  const metadataOnlyP3RiskThread = codexThread({
    id: "thread-metadata-only-p3-risk",
    body: "P3: This cleanup can cause a regression before the current-head review is observed.",
  });
  const manualThread = createReviewThread({
    id: "thread-manual-current",
    comments: {
      nodes: [
        {
          id: "comment-human-current",
          body: "Manual review note.",
          createdAt: "2026-03-11T00:02:00Z",
          url: "https://example.test/pr/44#discussion_human_current",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const pr = {
    number: 44,
    headRefOid: "head-new",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: null,
    currentHeadCiGreenAt: "2026-03-11T00:03:00Z",
  };
  const input = buildReviewPolicyInput({
    config,
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: "head-new",
      processed_review_thread_ids: [
        "thread-p1-current@head-new",
        "thread-p3-risk-current@head-new",
        "thread-p3-soft-current@head-new",
      ],
      processed_review_thread_fingerprints: [
        "thread-p1-current@head-new#comment-1",
        "thread-p3-risk-current@head-new#comment-1",
        "thread-p3-soft-current@head-new#comment-1",
      ],
    },
    reviewThreads: [
      p1Thread,
      p3RiskThread,
      p3NitpickThread,
      metadataOnlyThread,
      metadataOnlyP3RiskThread,
      manualThread,
    ],
  });

  assert.deepEqual(
    input.threads.map((thread) => [thread.id, thread.boundaryOutcome]),
    [
      ["thread-p1-current", "must_fix_current_head"],
      ["thread-p3-risk-current", "escalated_p3"],
      ["thread-p3-soft-current", "softened_p3_advisory"],
      ["thread-metadata-only", "metadata_only_unresolved"],
      ["thread-metadata-only-p3-risk", "metadata_only_unresolved"],
      ["thread-manual-current", "manual_thread"],
    ],
  );
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
  const stalePr: Pick<
    GitHubPullRequest,
    "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"
  > = {
    headRefOid: "head-new",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: "head-old",
  };
  assert.equal(buildCodexConnectorPolicyBlockDiagnostic(config, [p1Thread], stalePr), null);
  assert.equal(buildCodexConnectorP2P3PolicyDiagnostic(config, [p1Thread], stalePr), null);
  const staleP3NitpickThread = codexThread({
    id: "thread-stale-p3-nitpick",
    body: "P3: Nitpick: prefer a shorter helper name for readability.",
  });
  assert.equal(buildCodexConnectorP2P3PolicyDiagnostic(config, [p1Thread, staleP3NitpickThread], stalePr), null);
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

test("Codex Connector policy clusters Codex findings instead of later replies", () => {
  const threads = Array.from({ length: 2 }, (_, index) =>
    createReviewThread({
      id: `thread-replied-${index}`,
      path: `src/replied-${index}.ts`,
      comments: {
        nodes: [
          {
            id: `comment-codex-${index}`,
            body:
              "P2: Missing verifier coverage lets release-bundle readiness claims bypass the authority guard. Add generalized regression coverage.",
            createdAt: "2026-03-11T00:00:00Z",
            url: `https://example.test/pr/44#discussion_codex_${index}`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
          {
            id: `comment-human-${index}`,
            body: `Thanks, local follow-up note ${index}.`,
            createdAt: "2026-03-11T00:01:00Z",
            url: `https://example.test/pr/44#discussion_human_${index}`,
            author: {
              login: "maintainer",
              typeName: "User",
            },
          },
        ],
      },
    }),
  );

  const clusters = clusterConfiguredBotReviewThreads(threads);

  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]?.threads.map((thread) => thread.id), ["thread-replied-0", "thread-replied-1"]);
  assert.deepEqual(clusters[0]?.sourceUrls, [
    "https://example.test/pr/44#discussion_codex_0",
    "https://example.test/pr/44#discussion_codex_1",
  ]);
});

test("Codex Connector policy clusters same-theme variants across files", () => {
  const threads = Array.from({ length: 8 }, (_, index) =>
    codexThread({
      id: `thread-cross-file-${index}`,
      path: `src/release-${index}.ts`,
      line: 30 + index,
      body:
        index % 2 === 0
          ? `P2: Missing verifier coverage lets release bundle readiness claim ${index} bypass the authority guard.`
          : `P2: The authority guard still lets release bundle readiness claim ${index} bypass verifier coverage.`,
    }),
  );

  const clusters = clusterConfiguredBotReviewThreads(threads);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.threads.length, 8);
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
  assert.deepEqual(diagnostic?.representativeThreadIds, [
    "thread-theme-0",
    "thread-theme-1",
    "thread-theme-2",
    "thread-theme-3",
    "thread-theme-4",
  ]);
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

test("Codex Connector churn progress compares effective must-fix summaries across heads", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    codexConnectorReviewChurnMustFixThreshold: 2,
    codexConnectorReviewChurnFileConcentrationPercent: 70,
  });
  const previousThreads = Array.from({ length: 4 }, (_, index) =>
    codexThread({
      id: `thread-previous-${index}`,
      path: "src/release-readiness.ts",
      line: 100 + index,
      body: "P2: Block release readiness truth-source claims until the verifier proves the authoritative source.",
    }),
  );
  const currentThreads = [
    ...Array.from({ length: 2 }, (_, index) =>
      codexThread({
        id: `thread-current-${index}`,
        path: "src/release-readiness.ts",
        line: 120 + index,
        body: "P2: Block release readiness truth-source claims until the verifier proves the authoritative source.",
      }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      codexThread({
        id: `thread-outdated-${index}`,
        isOutdated: true,
        path: "src/release-readiness.ts",
        line: 140 + index,
        body: "P2: Old unresolved outdated thread that must not count against current-head progress.",
      }),
    ),
  ];
  const previousDiagnostic = buildCodexConnectorReviewChurnDiagnostic(config, previousThreads);
  const currentDiagnostic = buildCodexConnectorReviewChurnDiagnostic(config, currentThreads);

  const previous = buildCodexConnectorReviewChurnProgressSummary(previousDiagnostic!, "head-before");
  const current = buildCodexConnectorReviewChurnProgressSummary(currentDiagnostic!, "head-after");
  const comparison = compareCodexConnectorReviewChurnProgress(current, previous);

  assert.equal(previous.currentEffectiveMustFixCount, 4);
  assert.equal(current.currentEffectiveMustFixCount, 2);
  assert.equal(comparison.classification, "improving");
  assert.equal(comparison.effectiveMustFixDelta, -2);
  assert.equal(comparison.previousHeadSha, "head-before");
  assert.equal(comparison.currentHeadSha, "head-after");
});
