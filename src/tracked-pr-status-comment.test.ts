import test from "node:test";
import assert from "node:assert/strict";
import { buildTrackedPrStatusCommentMarker } from "./tracked-pr-status-comment";

test("buildTrackedPrStatusCommentMarker renders the stable sticky tracked PR marker", () => {
  assert.equal(
    buildTrackedPrStatusCommentMarker({
      issueNumber: 102,
      prNumber: 116,
      kind: "status",
    }),
    "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
  );
});
