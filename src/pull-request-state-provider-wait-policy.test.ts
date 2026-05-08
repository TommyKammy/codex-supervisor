import assert from "node:assert/strict";
import test from "node:test";
import { blockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import {
  createConfig,
  createPullRequest,
  createRecord,
  passingChecks,
  withStubbedDateNow,
} from "./pull-request-state-test-helpers";

test("inferStateFromPullRequest does not wait for Copilot when no lifecycle signal exists", () => {
  const config = createConfig({ copilotReviewWaitMinutes: 10 });
  const now = new Date().toISOString();
  const record = createRecord({
    state: "pr_open",
    review_wait_started_at: now,
    review_wait_head_sha: "head123",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ createdAt: now }), passingChecks(), []),
    "ready_to_merge",
  );
});

test("inferStateFromPullRequest waits briefly after ready-for-review for Copilot request propagation", () => {
  withStubbedDateNow("2026-03-13T05:42:40Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not time out immediately when configured review waiting is disabled", () => {
  const config = createConfig({
    copilotReviewWaitMinutes: 0,
    copilotReviewTimeoutAction: "block",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "waiting_ci",
    review_wait_started_at: "2026-03-11T00:00:00Z",
    review_wait_head_sha: "head123",
  });

  assert.equal(
    inferStateFromPullRequest(
      config,
      record,
      createPullRequest({
        copilotReviewState: "requested",
        copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
        copilotReviewArrivedAt: null,
      }),
      passingChecks(),
      [],
    ),
    "waiting_ci",
  );
});

test("inferStateFromPullRequest waits for Codex Connector current-head activity without a requested signal", () => {
  withStubbedDateNow("2026-03-13T05:42:40Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest fails closed for Codex Connector when no current-head signal exists", () => {
  withStubbedDateNow("2026-05-08T03:30:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    });
    const record = createRecord({
      state: "pr_open",
      last_head_sha: "head-pr-4",
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: "head-pr-4",
    });

    const pr = createPullRequest({
      number: 4,
      createdAt: "2026-05-08T03:09:36Z",
      headRefOid: "head-pr-4",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotTopLevelReviewSubmittedAt: null,
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "blocked");
    assert.equal(blockedReasonFromReviewState(config, record, pr, [], []), "review_bot_timeout");
  });
});

test("inferStateFromPullRequest fails closed for Codex Connector when current-head signals are malformed", () => {
  withStubbedDateNow("2026-05-08T03:30:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    });
    const record = createRecord({
      state: "pr_open",
      last_head_sha: "head-pr-4",
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: "head-pr-4",
    });

    const pr = createPullRequest({
      number: 4,
      createdAt: "2026-05-08T03:09:36Z",
      headRefOid: "head-pr-4",
      currentHeadCiGreenAt: "not-a-timestamp",
      configuredBotCurrentHeadObservedAt: "not-a-timestamp",
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
    assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "review_bot_timeout");
  });
});

test("inferStateFromPullRequest fails closed for stale Codex Connector PR conversation success comments before the active wait", () => {
  withStubbedDateNow("2026-05-08T03:30:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "pr_open",
      last_head_sha: "head-pr-4",
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: "head-pr-4",
    });

    const pr = createPullRequest({
      number: 4,
      createdAt: "2026-05-08T03:00:00Z",
      headRefOid: "head-pr-4",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: "2026-05-08T03:08:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      configuredBotTopLevelReviewSubmittedAt: null,
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "blocked");
    assert.equal(blockedReasonFromReviewState(config, record, pr, [], []), "review_bot_timeout");
  });
});

test("inferStateFromPullRequest accepts Codex Connector PR conversation success comments after the active wait", () => {
  withStubbedDateNow("2026-05-08T03:30:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "pr_open",
      last_head_sha: "head-pr-4",
      review_wait_started_at: "2026-05-08T03:09:36Z",
      review_wait_head_sha: "head-pr-4",
    });

    const pr = createPullRequest({
      number: 4,
      createdAt: "2026-05-08T03:00:00Z",
      headRefOid: "head-pr-4",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      copilotReviewState: "not_requested",
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: "2026-05-08T03:24:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      configuredBotTopLevelReviewSubmittedAt: null,
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "ready_to_merge");
    assert.equal(blockedReasonFromReviewState(config, record, pr, [], []), null);
  });
});

test("inferStateFromPullRequest allows merge after the Copilot propagation grace window expires", () => {
  withStubbedDateNow("2026-03-13T05:42:42Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "pr_open",
      review_wait_started_at: "2026-03-13T05:42:36Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          createdAt: "2026-03-13T05:40:00Z",
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest keeps Codex Connector on current-head wait instead of request fallback", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:05:00Z",
      copilot_review_requested_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest waits when mixed configured bots include Copilot lifecycle state", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["chatgpt-codex-connector", "copilot-pull-request-reviewer"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest keeps waiting when Copilot review was explicitly requested", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest treats an arrived configured-bot top-level review as satisfying the wait state", () => {
  withStubbedDateNow("2026-03-11T00:10:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      reviewBotLogins: ["coderabbitai[bot]"],
    });
    const requestedAt = "2026-03-11T00:05:00Z";
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: requestedAt,
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewRequestedAt: requestedAt,
          copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest waits through a configured-bot rate limit warning for the configured window", () => {
  withStubbedDateNow("2026-03-11T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:10:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:15:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest lets the rate-limit wait win over a blocking configured-bot timeout", () => {
  withStubbedDateNow("2026-03-11T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      copilot_review_requested_observed_at: "2026-03-11T00:00:00Z",
      copilot_review_requested_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:00:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:15:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest allows merge again after a configured-bot rate limit wait expires", () => {
  withStubbedDateNow("2026-03-11T00:50:01Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRateLimitWaitMinutes: 30,
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:10:00Z",
          copilotReviewArrivedAt: null,
          configuredBotRateLimitedAt: "2026-03-11T00:20:00Z",
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest keeps waiting for a strict CodeRabbit current-head signal after the initial grace expires", () => {
  withStubbedDateNow("2026-03-11T00:02:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          currentHeadCiGreenAt: "2026-03-11T00:00:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest blocks after a strict CodeRabbit current-head signal timeout expires", () => {
  withStubbedDateNow("2026-03-11T00:11:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          currentHeadCiGreenAt: "2026-03-11T00:00:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "blocked",
    );
  });
});

test("inferStateFromPullRequest does not spend strict CodeRabbit timeout budget before checks turn green", () => {
  withStubbedDateNow("2026-03-11T00:11:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          currentHeadCiGreenAt: null,
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest keeps waiting for strict CodeRabbit current-head signal when timeout is disabled", () => {
  withStubbedDateNow("2026-03-11T00:11:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 0,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          currentHeadCiGreenAt: "2026-03-11T00:00:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest keeps strict current-head waiting active even when requested-review timeout already expired", () => {
  withStubbedDateNow("2026-03-11T00:11:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]", "copilot-pull-request-reviewer"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
      copilotReviewWaitMinutes: 5,
      copilotReviewTimeoutAction: "continue",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:00:00Z",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: "2026-03-11T00:10:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest ignores malformed currentHeadCiGreenAt values for strict CodeRabbit waiting", () => {
  withStubbedDateNow("2026-03-11T00:11:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotRequireCurrentHeadSignal: true,
      configuredBotInitialGraceWaitSeconds: 30,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "block",
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          currentHeadCiGreenAt: "not-a-timestamp",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest does not start Copilot timeout from the generic review wait window", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest can time out from the observed Copilot request timestamp when GitHub omits one", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:15:00Z",
      copilot_review_requested_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "blocked",
    );
  });
});

test("inferStateFromPullRequest blocks Codex Connector from current-head timeout instead of request fallback", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:15:00Z",
      copilot_review_requested_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "blocked",
    );
  });
});

test("inferStateFromPullRequest does not wait on stale configured bot request state when no review bots are configured", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: [],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
      copilot_review_requested_observed_at: "2026-03-11T00:05:00Z",
      copilot_review_requested_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest times out requested Copilot reviews and continues by default", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({ copilotReviewWaitMinutes: 10, copilotReviewTimeoutAction: "continue" });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest can block when a requested Copilot review times out", () => {
  withStubbedDateNow("2026-03-11T00:30:00Z", () => {
    const config = createConfig({
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-11T00:00:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "requested",
          copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
          copilotReviewArrivedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "blocked",
    );
  });
});
