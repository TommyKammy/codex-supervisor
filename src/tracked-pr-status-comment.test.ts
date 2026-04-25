import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackedPrStatusCommentBody,
  buildTrackedPrStatusCommentMarker,
  parseTrackedPrStatusCommentMarker,
  selectOwnedTrackedPrStatusComment,
  workspacePreparationRemediationTarget,
} from "./tracked-pr-status-comment";

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

test("parseTrackedPrStatusCommentMarker reads only the stable sticky tracked PR marker", () => {
  assert.deepEqual(
    parseTrackedPrStatusCommentMarker(
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
    ),
    {
      issueNumber: 102,
      prNumber: 116,
      kind: "status",
    },
  );
  assert.deepEqual(
    parseTrackedPrStatusCommentMarker(
      "prefix <!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=host-local-blocker --> suffix",
    ),
    {
      issueNumber: 102,
      prNumber: 116,
      kind: "host-local-blocker",
    },
  );
  assert.equal(
    parseTrackedPrStatusCommentMarker(
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=unknown -->",
    ),
    null,
  );
});

test("buildTrackedPrStatusCommentBody appends the owned marker without GitHub transport", () => {
  assert.equal(
    buildTrackedPrStatusCommentBody({
      body: "Tracked PR head `head-116` remains stopped near merge.",
      marker: {
        issueNumber: 102,
        prNumber: 116,
        kind: "status",
      },
    }),
    [
      "Tracked PR head `head-116` remains stopped near merge.",
      "",
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
    ].join("\n"),
  );
});

test("selectOwnedTrackedPrStatusComment picks the newest editable marked comment", () => {
  const marker = buildTrackedPrStatusCommentMarker({
    issueNumber: 102,
    prNumber: 116,
    kind: "status",
  });
  const selected = selectOwnedTrackedPrStatusComment({
    issueComments: [
      {
        id: "foreign",
        databaseId: 10,
        body: marker,
        createdAt: "2026-03-16T02:00:00Z",
        url: "https://example.test/comments/10",
        viewerDidAuthor: false,
        author: null,
      },
      {
        id: "old-owned",
        databaseId: 11,
        body: marker,
        createdAt: "2026-03-16T01:00:00Z",
        url: "https://example.test/comments/11",
        viewerDidAuthor: true,
        author: null,
      },
      {
        id: "new-owned",
        databaseId: 12,
        body: marker,
        createdAt: "2026-03-16T03:00:00Z",
        url: "https://example.test/comments/12",
        viewerDidAuthor: true,
        author: null,
      },
    ],
    markers: [marker],
  });

  assert.equal(selected?.databaseId, 12);
});

test("workspacePreparationRemediationTarget keeps generic preparation failures on workspace environment", () => {
  assert.equal(workspacePreparationRemediationTarget("non_zero_exit"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("workspace_toolchain_missing"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("missing_command"), "config_contract");
  assert.equal(workspacePreparationRemediationTarget("worktree_helper_missing"), "config_contract");
});
