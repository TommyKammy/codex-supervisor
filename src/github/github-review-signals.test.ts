import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfiguredBotReviewSummary,
  CopilotReviewLifecycleFacts,
  inferCopilotReviewLifecycle,
} from "./github-review-signals";

test("inferCopilotReviewLifecycle returns not_requested when no Copilot signal exists", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [],
      comments: [],
      issueComments: [],
      timeline: [],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "not_requested",
    requestedAt: null,
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle returns requested when Copilot was requested but has not reviewed", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["copilot-pull-request-reviewer"],
      reviews: [],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle returns arrived when Copilot review exists", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [
        {
          authorLogin: "copilot-pull-request-reviewer",
          submittedAt: "2026-03-13T02:03:04Z",
        },
      ],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("inferCopilotReviewLifecycle returns arrived when Copilot comments on a review thread", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [],
      comments: [
        {
          authorLogin: "copilot-pull-request-reviewer",
          createdAt: "2026-03-13T02:04:05Z",
        },
      ],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:04:05Z",
  });
});

test("inferCopilotReviewLifecycle treats configured review bots generically for Codex-only and mixed configurations", () => {
  const facts = {
    reviewRequests: ["chatgpt-codex-connector"],
    reviews: [
      {
        authorLogin: "chatgpt-codex-connector",
        submittedAt: "2026-03-13T02:03:04Z",
        state: "COMMENTED",
        body: "Nitpick: the fallback path still skips the auth guard.",
      },
    ],
    comments: [],
    issueComments: [],
    timeline: [
      {
        type: "requested" as const,
        createdAt: "2026-03-13T01:02:03Z",
        reviewerLogin: "chatgpt-codex-connector",
      },
      {
        type: "requested" as const,
        createdAt: "2026-03-13T01:00:00Z",
        reviewerLogin: "copilot-pull-request-reviewer",
      },
    ],
  };

  assert.deepEqual(inferCopilotReviewLifecycle(facts, ["chatgpt-codex-connector"]), {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });

  assert.deepEqual(inferCopilotReviewLifecycle(facts, ["copilot-pull-request-reviewer", "chatgpt-codex-connector"]), {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("inferCopilotReviewLifecycle ignores summary-only and draft-skip issue comments from configured bots", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [],
      comments: [],
      issueComments: [
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T02:04:05Z",
          body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
        },
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T02:05:05Z",
          body: "Skipping review because this pull request is still in draft.",
        },
      ],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "coderabbitai[bot]",
        },
      ],
    },
    ["coderabbitai[bot]"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle treats actionable configured-bot top-level reviews as arrived", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [
        {
          authorLogin: "coderabbitai[bot]",
          submittedAt: "2026-03-13T02:03:04Z",
          state: "COMMENTED",
          body: "Nitpick: this nil check is inverted and can mask the error path.",
        },
      ],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "coderabbitai[bot]",
        },
      ],
    },
    ["coderabbitai[bot]"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("inferCopilotReviewLifecycle ignores configured-bot activity that predates the latest active request", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [
        {
          authorLogin: "coderabbitai[bot]",
          submittedAt: "2026-03-13T01:03:04Z",
          state: "COMMENTED",
          body: "Nitpick: old review on the prior request cycle.",
        },
      ],
      comments: [
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T01:04:05Z",
        },
      ],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:00:00Z",
          reviewerLogin: "coderabbitai[bot]",
        },
        {
          type: "removed",
          createdAt: "2026-03-13T01:05:00Z",
          reviewerLogin: "coderabbitai[bot]",
        },
        {
          type: "requested",
          createdAt: "2026-03-13T02:00:00Z",
          reviewerLogin: "coderabbitai[bot]",
        },
      ],
    },
    ["coderabbitai[bot]"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T02:00:00Z",
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle computes the active request cutoff per configured bot", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [],
      comments: [
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T00:30:00Z",
        },
      ],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:00:00Z",
          reviewerLogin: "coderabbitai[bot]",
        },
        {
          type: "requested",
          createdAt: "2026-03-13T02:00:00Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
        {
          type: "removed",
          createdAt: "2026-03-13T03:00:00Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["coderabbitai[bot]", "copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T01:00:00Z",
    arrivedAt: null,
  });
});

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
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
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
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
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
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: "2026-03-13T03:15:00Z",
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary records draft-skip issue comments distinctly from actionable arrival", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: ["coderabbitai[bot]"],
    reviews: [],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T03:14:00Z",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T03:15:00Z",
        body: "Skipping review because this pull request is still in draft.",
      },
    ],
    timeline: [
      {
        type: "requested",
        createdAt: "2026-03-13T03:00:00Z",
        reviewerLogin: "coderabbitai[bot]",
      },
    ],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"]), {
    lifecycle: {
      state: "requested",
      requestedAt: "2026-03-13T03:00:00Z",
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: "2026-03-13T03:15:00Z",
  });
});

test("buildConfiguredBotReviewSummary ignores configured-bot draft-skip signals that were superseded by a later request removal", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai",
        createdAt: "2026-03-13T03:15:00Z",
        body: "Skipping review because this pull request is still in draft.",
      },
    ],
    timeline: [
      {
        type: "requested",
        createdAt: "2026-03-13T03:00:00Z",
        reviewerLogin: "coderabbitai",
      },
      {
        type: "removed",
        createdAt: "2026-03-13T03:20:00Z",
        reviewerLogin: "coderabbitai",
      },
    ],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai", "coderabbitai[bot]"]), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary ignores configured-bot rate limit warnings that were superseded by a later request removal", () => {
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
    timeline: [
      {
        type: "requested",
        createdAt: "2026-03-13T03:00:00Z",
        reviewerLogin: "coderabbitai",
      },
      {
        type: "removed",
        createdAt: "2026-03-13T03:20:00Z",
        reviewerLogin: "coderabbitai",
      },
    ],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai", "coderabbitai[bot]"]), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary records the latest configured-bot observation on the current head", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "head-44",
        state: "COMMENTED",
        body: "Current head top-level review.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:03:00Z",
        commitOid: "stale-head",
        state: "COMMENTED",
        body: "Newer stale-head top-level review.",
      },
    ],
    comments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:04:00Z",
        originalCommitOid: "head-44",
      },
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:05:00Z",
        originalCommitOid: "stale-head",
      },
    ],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:05:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:04:00Z",
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary treats summary-only configured-bot reviews on the current head as observations", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "head-44",
        state: "COMMENTED",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:03:00Z",
        commitOid: "stale-head",
        state: "COMMENTED",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    comments: [],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:02:00Z",
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary extends current-head observation with later actionable configured-bot issue comments", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "head-44",
        state: "COMMENTED",
        body: "Nitpick: prefer the simpler branch here.",
      },
    ],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:04:00Z",
        body: "Nitpick: return early before mutating shared state.",
      },
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:05:00Z",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:04:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:04:00Z",
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary extends current-head observation with later weakly anchored CodeRabbit review comments", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "head-44",
        state: "COMMENTED",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    comments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:04:00Z",
        originalCommitOid: null,
      },
    ],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:04:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:04:00Z",
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary keeps weakly anchored CodeRabbit review comments from stale-head history out of current-head observation", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "stale-head",
        state: "COMMENTED",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    comments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:04:00Z",
        originalCommitOid: null,
      },
    ],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:04:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary ignores late configured-bot closed-PR follow-up comments after a current-head observation", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:02:00Z",
        commitOid: "head-44",
        state: "COMMENTED",
        body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
      },
    ],
    comments: [],
    issueComments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:04:00Z",
        body: "This pull request is already closed. Please ignore this follow-up review comment.",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:02:00Z",
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary leaves current-head observation empty when only stale-head evidence exists", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [
      {
        authorLogin: "coderabbitai[bot]",
        submittedAt: "2026-03-13T02:03:00Z",
        commitOid: "stale-head",
        state: "COMMENTED",
        body: "Stale-head top-level review.",
      },
    ],
    comments: [
      {
        authorLogin: "coderabbitai[bot]",
        createdAt: "2026-03-13T02:05:00Z",
        originalCommitOid: "stale-head",
      },
    ],
    issueComments: [],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "arrived",
      requestedAt: null,
      arrivedAt: "2026-03-13T02:05:00Z",
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary treats current-head CodeRabbit status contexts as observations and excludes stale-head statuses", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [],
    statusContexts: [
      {
        creatorLogin: "coderabbitai",
        context: "CodeRabbit",
        description: "CodeRabbit finished preparing its review.",
        createdAt: "2026-03-13T02:06:00Z",
        commitOid: "stale-head",
      },
      {
        creatorLogin: "coderabbitai",
        context: "CodeRabbit",
        description: "CodeRabbit started reviewing the current head.",
        state: "SUCCESS",
        createdAt: "2026-03-13T02:04:00Z",
        commitOid: "head-44",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai", "coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: "2026-03-13T02:04:00Z",
    currentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary scopes current-head status state to CodeRabbit-specific contexts", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [],
    statusContexts: [
      {
        creatorLogin: "coderabbitai",
        context: "CodeRabbit",
        description: "CodeRabbit is still reviewing the current head.",
        state: "PENDING",
        createdAt: "2026-03-13T02:04:00Z",
        commitOid: "head-44",
      },
      {
        creatorLogin: "chatgpt-codex-connector",
        context: "Codex Review",
        description: "Codex finished its review on the current head.",
        state: "SUCCESS",
        createdAt: "2026-03-13T02:07:00Z",
        commitOid: "head-44",
      },
    ],
    timeline: [],
  };

  const summary = buildConfiguredBotReviewSummary(
    facts,
    ["coderabbitai", "coderabbitai[bot]", "chatgpt-codex-connector"],
    "head-44",
  );

  assert.equal(summary.currentHeadObservedAt, "2026-03-13T02:07:00Z");
  assert.equal(summary.currentHeadStatusState, "PENDING");
});

test("buildConfiguredBotReviewSummary records the current-head CI-green timestamp from required passing checks only", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [],
    statusContexts: [
      {
        creatorLogin: "github-actions",
        context: "lint",
        createdAt: "2026-03-13T02:01:00Z",
        state: "SUCCESS",
        isRequired: true,
        commitOid: "head-44",
      },
      {
        creatorLogin: "github-actions",
        context: "optional-docs",
        createdAt: "2026-03-13T02:07:00Z",
        state: "SUCCESS",
        isRequired: false,
        commitOid: "head-44",
      },
      {
        creatorLogin: "github-actions",
        context: "stale-required",
        createdAt: "2026-03-13T02:09:00Z",
        state: "SUCCESS",
        isRequired: true,
        commitOid: "stale-head",
      },
    ],
    checkRuns: [
      {
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-03-13T02:05:00Z",
        isRequired: true,
        commitOid: "head-44",
      },
      {
        name: "test",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: "2026-03-13T02:06:00Z",
        isRequired: false,
        commitOid: "head-44",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});

test("buildConfiguredBotReviewSummary leaves current-head CI-green timestamp empty until all required current-head checks pass", () => {
  const facts: CopilotReviewLifecycleFacts = {
    reviewRequests: [],
    reviews: [],
    comments: [],
    issueComments: [],
    statusContexts: [
      {
        creatorLogin: "github-actions",
        context: "lint",
        createdAt: "2026-03-13T02:01:00Z",
        state: "SUCCESS",
        isRequired: true,
        commitOid: "head-44",
      },
    ],
    checkRuns: [
      {
        name: "build",
        status: "IN_PROGRESS",
        conclusion: null,
        completedAt: null,
        isRequired: true,
        commitOid: "head-44",
      },
      {
        name: "stale-build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-03-13T02:05:00Z",
        isRequired: true,
        commitOid: "stale-head",
      },
    ],
    timeline: [],
  };

  assert.deepEqual(buildConfiguredBotReviewSummary(facts, ["coderabbitai[bot]"], "head-44"), {
    lifecycle: {
      state: "not_requested",
      requestedAt: null,
      arrivedAt: null,
    },
    topLevelReview: {
      strength: null,
      submittedAt: null,
    },
    currentHeadObservedAt: null,
    currentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    rateLimitWarningAt: null,
    draftSkipAt: null,
  });
});
