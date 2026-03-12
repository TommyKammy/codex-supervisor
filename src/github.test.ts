import test from "node:test";
import assert from "node:assert/strict";
import { inferCopilotReviewLifecycle } from "./github";

test("inferCopilotReviewLifecycle returns not_requested when no Copilot signal exists", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [],
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
