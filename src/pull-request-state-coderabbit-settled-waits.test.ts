import assert from "node:assert/strict";
import test from "node:test";
import { inferStateFromPullRequest } from "./pull-request-state";
import {
  createConfig,
  createPullRequest,
  createRecord,
  passingChecks,
  withStubbedDateNow,
} from "./pull-request-state-test-helpers";

test("inferStateFromPullRequest waits briefly after a recent CodeRabbit current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest waits briefly after required checks turn green for a silent CodeRabbit provider", () => {
  withStubbedDateNow("2026-03-13T02:05:45Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    config.configuredBotInitialGraceWaitSeconds = 90;

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest hands off from the initial CodeRabbit grace wait to the settled wait after provider activity begins", () => {
  withStubbedDateNow("2026-03-13T02:06:17Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    config.configuredBotInitialGraceWaitSeconds = 90;

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:06:16Z",
          currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:06:15Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not wait after the initial CodeRabbit grace window expires without provider activity", () => {
  withStubbedDateNow("2026-03-13T02:06:31Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    config.configuredBotInitialGraceWaitSeconds = 90;

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest re-arms CodeRabbit waiting after ready-for-review when the latest prior signal was a draft skip", () => {
  withStubbedDateNow("2026-03-13T02:30:10Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:30:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
          configuredBotCurrentHeadObservedAt: null,
          configuredBotDraftSkipAt: "2026-03-13T02:25:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest keeps waiting after ready-for-review when the local review wait was re-armed but current-head CI hydration is missing", () => {
  withStubbedDateNow("2026-03-13T02:30:10Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:30:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          configuredBotDraftSkipAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest re-arms CodeRabbit latest-head waiting when the PR advances after an earlier review arrived", () => {
  withStubbedDateNow("2026-03-13T02:32:29Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:31:00Z",
      review_wait_head_sha: "head456",
      last_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          headRefOid: "head456",
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:30:00Z",
          configuredBotTopLevelReviewSubmittedAt: "2026-03-13T02:30:00Z",
          currentHeadCiGreenAt: "2026-03-13T02:31:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest lets latest-head CodeRabbit re-arm waiting expire after the initial grace window", () => {
  withStubbedDateNow("2026-03-13T02:32:31Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:31:00Z",
      review_wait_head_sha: "head456",
      last_head_sha: "head456",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          headRefOid: "head456",
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:30:00Z",
          configuredBotTopLevelReviewSubmittedAt: "2026-03-13T02:30:00Z",
          currentHeadCiGreenAt: "2026-03-13T02:31:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest keeps unchanged-head CodeRabbit reviews ready to merge after the initial grace window expires", () => {
  withStubbedDateNow("2026-03-13T02:32:31Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:30:00Z",
      review_wait_head_sha: "head123",
      last_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          headRefOid: "head123",
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:30:00Z",
          configuredBotTopLevelReviewSubmittedAt: "2026-03-13T02:30:00Z",
          currentHeadCiGreenAt: "2026-03-13T02:31:00Z",
          configuredBotCurrentHeadObservedAt: null,
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest ignores malformed earlier CodeRabbit timestamps when a fresh actionable signal clears the re-armed wait", () => {
  withStubbedDateNow("2026-03-13T02:30:10Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:30:00Z",
      review_wait_head_sha: "head123",
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        record,
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
          configuredBotCurrentHeadObservedAt: "not-a-timestamp",
          configuredBotDraftSkipAt: "2026-03-13T02:25:00Z",
          configuredBotTopLevelReviewSubmittedAt: "2026-03-13T02:30:05Z",
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest waits on a recent summary-only CodeRabbit current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "not_requested",
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest waits on later actionable CodeRabbit issue comments after a current-head observation", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:02:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        passingChecks(),
        [],
      ),
      "waiting_ci",
    );
  });
});

test("inferStateFromPullRequest does not wait on stale CodeRabbit current-head observations", () => {
  withStubbedDateNow("2026-03-13T02:04:06Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});

test("inferStateFromPullRequest uses configuredBotSettledWaitSeconds for recent CodeRabbit current-head observations", () => {
  withStubbedDateNow("2026-03-13T02:04:04Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    config.configuredBotSettledWaitSeconds = 3;

    assert.equal(
      inferStateFromPullRequest(
        config,
        createRecord({ state: "waiting_ci" }),
        createPullRequest({
          copilotReviewState: "arrived",
          copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
          configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
        }),
        passingChecks(),
        [],
      ),
      "ready_to_merge",
    );
  });
});
