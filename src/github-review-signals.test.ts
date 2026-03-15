import test from "node:test";
import assert from "node:assert/strict";
import { buildConfiguredBotReviewSummary, CopilotReviewLifecycleFacts } from "./github-review-signals";

test("buildConfiguredBotReviewSummary treats actionable configured-bot issue comments as arrival signals", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: ["coderabbitai[bot]"],
    reviews: [],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:24:00Z",
        body: "Nitpick: return early before mutating shared state.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:25:00Z",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    timeline: [
      {
        type: "requested",
        createdAt: "2026-03-13T01:02:03Z",
        reviewerLogin: "coderabbitai[bot]",
      },
    ],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"]), {
    lifecycle: {
      state: "arrived",
      requestedAt: "2026-03-13T01:02:03Z",
      arrivedAt: "2026-03-13T02:24:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    rateLimitWarningAt: null,
  });
});

test("buildConfiguredBotReviewSummary keeps top-level review strength scoped to the latest configured bot changes request", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "octocat",
        submittedAt: "2026-03-13T02:02:00Z",
        state: "CHANGES_REQUESTED",
        body: "Please address these blocking concerns.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:03:04Z",
        state: "CHANGES_REQUESTED",
        body: "Nitpick: rename this helper for consistency.",
      },
    ],
    comments: [],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"]), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:03:04Z",
    },
    topLevelReview: {
      strength: "nitpick_only",
      submittedAt: "2026-03-13T02:03:04Z",
    },
    rateLimitWarningAt: null,
  });
});

test("buildConfiguredBotReviewSummary treats configured-bot rate limit issue comments as a temporary requested state", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai",
        createdAt: "2026-03-13T03:15:00Z",
        body: "Rate limit exceeded for this repository. Please try again later.",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai", "coderabbitai[bot]"]), {
    lifecycle: {
      state: "requested",
      requestedAt: "2026-03-13T03:15:00Z",
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    rateLimitWarningAt: "2026-03-13T03:15:00Z",
  });
});
