import test from "node:test";
import assert from "node:assert/strict";
import { formatTimelineArtifactStatusLine } from "./timeline-artifacts";

test("formatTimelineArtifactStatusLine escapes multiline command and summary values", () => {
  const line = formatTimelineArtifactStatusLine({
    issueNumber: 1733,
    prNumber: 1738,
    artifact: {
      type: "verification_result",
      gate: "local_ci",
      command: "npm run verify:paths\nnpm run build\r\nnpm test\rnode --version",
      head_sha: "abc123",
      outcome: "failed",
      remediation_target: "tracked_publishable_content",
      next_action: "repair_tracked_publishable_content",
      summary: "first line\nsecond line\rthird line",
      recorded_at: "2026-04-25T10:50:35Z",
    },
  });

  assert.equal(line.split("\n").length, 1);
  assert.equal(line.includes("\r"), false);
  assert.match(
    line,
    /^timeline_artifact issue=#1733 pr=#1738 type=verification_result gate=local_ci outcome=failed head_sha=abc123 remediation_target=tracked_publishable_content next_action=repair_tracked_publishable_content command=npm run verify:paths\\nnpm run build\\nnpm test\\nnode --version summary=first line\\nsecond line\\nthird line$/,
  );
});
