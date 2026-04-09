import test from "node:test";
import assert from "node:assert/strict";

test("GitHub family resolves from src/github/", async () => {
  const clientModule = await import("./github");
  const inventoryModule = await import("./github-inventory");
  const reviewSurfaceModule = await import("./github-review-surface");
  const mutationsModule = await import("./github-mutations");
  const transportModule = await import("./github-transport");
  const hydrationModule = await import("./github-hydration");
  const pullRequestHydratorModule = await import("./github-pull-request-hydrator");
  const reviewSignalsModule = await import("./github-review-signals");

  assert.equal(typeof clientModule.GitHubClient, "function");
  assert.equal(typeof inventoryModule.GitHubInventoryClient, "function");
  assert.equal(typeof reviewSurfaceModule.GitHubReviewSurfaceClient, "function");
  assert.equal(typeof mutationsModule.GitHubMutationClient, "function");
  assert.equal(typeof transportModule.GitHubTransport, "function");
  assert.equal(typeof hydrationModule.normalizeRollupChecks, "function");
  assert.equal(typeof pullRequestHydratorModule.GitHubPullRequestHydrator, "function");
  assert.equal(typeof reviewSignalsModule.inferCopilotReviewLifecycle, "function");
});
