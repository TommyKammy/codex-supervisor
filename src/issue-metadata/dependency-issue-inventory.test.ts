import assert from "node:assert/strict";
import test from "node:test";
import { GitHubIssue } from "../core/types";
import { hydrateDependencyIssueInventory } from "./dependency-issue-inventory";

function createIssue(number: number, overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: "Depends on: none",
    createdAt: "2026-07-14T00:00:00Z",
    updatedAt: "2026-07-14T00:00:00Z",
    url: `https://example.test/issues/${number}`,
    labels: [],
    state: "OPEN",
    ...overrides,
  };
}

test("hydrateDependencyIssueInventory ignores dependency numbers from malformed metadata", async () => {
  const issue = createIssue(92, {
    body: "Depends on: #999999, blocked by #oops",
  });
  let lookupCount = 0;

  const issues = await hydrateDependencyIssueInventory(
    {
      getIssue: async () => {
        lookupCount += 1;
        throw new Error("unexpected dependency lookup");
      },
    },
    [issue],
  );

  assert.deepEqual(issues, [issue]);
  assert.equal(lookupCount, 0);
});

test("hydrateDependencyIssueInventory does not recurse through closed dependencies", async () => {
  const child = createIssue(92, { body: "Depends on: #91" });
  const closedDependency = createIssue(91, {
    body: "Depends on: #90",
    state: "CLOSED",
  });
  const requestedIssueNumbers: number[] = [];

  const issues = await hydrateDependencyIssueInventory(
    {
      getIssue: async (issueNumber) => {
        requestedIssueNumbers.push(issueNumber);
        assert.equal(issueNumber, 91);
        return closedDependency;
      },
    },
    [child],
  );

  assert.deepEqual(requestedIssueNumbers, [91]);
  assert.deepEqual(issues.map((issue) => issue.number), [92, 91]);
});

test("hydrateDependencyIssueInventory only traverses dependencies from the supplied roots", async () => {
  const skipped = createIssue(91, { body: "Depends on: #999999" });
  const runnable = createIssue(92);
  let lookupCount = 0;

  const issues = await hydrateDependencyIssueInventory(
    {
      getIssue: async () => {
        lookupCount += 1;
        throw new Error("unexpected dependency lookup");
      },
    },
    [skipped, runnable],
    [runnable],
  );

  assert.deepEqual(issues, [skipped, runnable]);
  assert.equal(lookupCount, 0);
});
