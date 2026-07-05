import assert from "node:assert/strict";
import test from "node:test";
import {
  codexConnectorCurrentHeadTopLevelReviewFindings,
  parseCodexConnectorTopLevelReviewFindings,
} from "./codex-connector-top-level-review";

test("parseCodexConnectorTopLevelReviewFindings preserves malformed encoded paths", () => {
  const findings = parseCodexConnectorTopLevelReviewFindings({
    id: "IC_kw",
    databaseId: 4884683854,
    authorLogin: "chatgpt-codex-connector",
    createdAt: "2026-07-05T03:19:37Z",
    url: "https://github.com/TommyKammy/codex-supervisor/pull/2404#issuecomment-4884683854",
    body: [
      "### Codex Review",
      "",
      "https://github.com/TommyKammy/codex-supervisor/blob/6dc3165c745feb07b5e67a9036366d4e4b3206d3/src/file%ZZname.ts#L12-L13",
      "",
      "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> Guard malformed encoded paths**",
      "",
      "A malformed percent escape should not abort PR hydration.",
    ].join("\n"),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "src/file%ZZname.ts");
  assert.equal(findings[0]?.line, 12);
  assert.equal(findings[0]?.lineEnd, 13);
});

test("codexConnectorCurrentHeadTopLevelReviewFindings keeps findings tied with success timestamps", () => {
  const findings = codexConnectorCurrentHeadTopLevelReviewFindings({
    currentHeadSha: "6dc3165c745feb07b5e67a9036366d4e4b3206d3",
    supersededAt: "2026-07-05T03:19:37Z",
    comments: [
      {
        id: "IC_kw",
        databaseId: 4884683854,
        authorLogin: "chatgpt-codex-connector",
        createdAt: "2026-07-05T03:19:37Z",
        url: "https://github.com/TommyKammy/codex-supervisor/pull/2404#issuecomment-4884683854",
        body: [
          "### Codex Review",
          "",
          "https://github.com/TommyKammy/codex-supervisor/blob/6dc3165c745feb07b5e67a9036366d4e4b3206d3/src/file.ts#L12",
          "",
          "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> Keep tied findings**",
          "",
          "Same-second ordering is ambiguous, so the finding remains active.",
        ].join("\n"),
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "P2");
});
