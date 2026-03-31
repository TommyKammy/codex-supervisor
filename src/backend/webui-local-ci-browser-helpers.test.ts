import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalCiContractChecklistItems,
  buildLocalCiContractStatusLines,
  canAdoptRecommendedLocalCiCommand,
} from "./webui-local-ci-browser-helpers";

test("local CI browser helpers summarize a repo-owned candidate contract consistently", () => {
  const contract = {
    configured: false,
    command: null,
    recommendedCommand: "npm run verify:pre-pr",
    source: "repo_script_candidate",
    summary:
      "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
  };

  assert.deepEqual(buildLocalCiContractStatusLines(contract), [
    "local ci configured=no source=repo script candidate command=none recommended command=npm run verify:pre-pr",
    "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
  ]);
  assert.deepEqual(buildLocalCiContractChecklistItems(contract), [{
    title: "Configured: no",
    tone: "",
    meta: [
      "Command: none",
      "Source: repo script candidate",
      "Recommended command: npm run verify:pre-pr",
    ],
    notes: [
      "This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured.",
      "This warning is advisory only; first-run setup readiness and blocker semantics stay unchanged until you opt in by configuring localCiCommand.",
    ],
  }]);
  assert.equal(canAdoptRecommendedLocalCiCommand(contract, true), true);
  assert.equal(canAdoptRecommendedLocalCiCommand(contract, false), false);
});

test("local CI browser helpers preserve configured and fallback contract guidance", () => {
  assert.deepEqual(buildLocalCiContractChecklistItems({
    configured: true,
    command: "npm run ci:local",
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
  }), [{
    title: "Configured: yes",
    tone: "",
    meta: [
      "Command: npm run ci:local",
      "Source: config",
    ],
    notes: [
      "This repo-owned command is the canonical local verification step before PR publication or update.",
      "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
    ],
  }]);

  assert.deepEqual(buildLocalCiContractChecklistItems(null), [{
    title: "Configured: no",
    tone: "",
    meta: [
      "Command: none",
      "Source: config",
    ],
    notes: [
      "If the repo does not declare this contract, codex-supervisor falls back to the issue's ## Verification guidance and operator workflow.",
      "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
    ],
  }]);
  assert.deepEqual(buildLocalCiContractStatusLines(null), []);
});
