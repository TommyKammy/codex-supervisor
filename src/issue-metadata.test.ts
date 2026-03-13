import test from "node:test";
import assert from "node:assert/strict";
import { findParentIssuesReadyToClose, parseIssueMetadata } from "./issue-metadata";
import { GitHubIssue } from "./types";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.com/issues/1",
    state: "OPEN",
    ...overrides,
  };
}

test("parseIssueMetadata accepts both parent issue metadata formats", () => {
  const legacyFormat = createIssue({
    body: "Part of #123",
  });
  const templateFormat = createIssue({
    body: "Part of: #123",
  });

  assert.equal(parseIssueMetadata(legacyFormat).parentIssueNumber, 123);
  assert.equal(parseIssueMetadata(templateFormat).parentIssueNumber, 123);
});

test("findParentIssuesReadyToClose treats both parent metadata formats as the same parent", () => {
  const readyToClose = findParentIssuesReadyToClose([
    createIssue({ number: 123, state: "OPEN" }),
    createIssue({ number: 201, state: "CLOSED", body: "Part of #123" }),
    createIssue({ number: 202, state: "CLOSED", body: "Part of: #123" }),
  ]);

  assert.deepEqual(
    readyToClose.map((candidate) => ({
      parentIssueNumber: candidate.parentIssue.number,
      childIssueNumbers: candidate.childIssues.map((issue) => issue.number),
    })),
    [
      {
        parentIssueNumber: 123,
        childIssueNumbers: [201, 202],
      },
    ],
  );
});
