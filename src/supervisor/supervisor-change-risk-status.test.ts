import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 92,
    title: "Issue",
    body: executionReadyBody("Keep the fixture current."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
    ...overrides,
  };
}

async function writeActiveState(
  stateFile: string,
  activeRecord: ReturnType<typeof createRecord>,
): Promise<void> {
  const state: SupervisorStateFile = {
    activeIssueNumber: activeRecord.issue_number,
    issues: {
      [String(activeRecord.issue_number)]: activeRecord,
    },
  };
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

test("status reports a focused verification policy for docs-only changes", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "guide.md"), "# guide\n", "utf8");
  git(["add", "docs/guide.md"], fixture.repoPath);
  git(["commit", "-m", "Update docs"], fixture.repoPath);

  await writeActiveState(
    fixture.stateFile,
    createRecord({
      issue_number: issueNumber,
      state: "reproducing",
      branch,
      workspace: fixture.repoPath,
      journal_path: null,
      blocked_reason: null,
      last_error: null,
    }),
  );

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => createIssue(),
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /change_classes=docs/);
  assert.match(status, /verification_policy intensity=focused driver=changed_files:docs/);
});

test("status reports issue metadata when it drives a stronger verification policy", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "guide.md"), "# auth guide\n", "utf8");
  git(["add", "docs/guide.md"], fixture.repoPath);
  git(["commit", "-m", "Update auth docs"], fixture.repoPath);

  await writeActiveState(
    fixture.stateFile,
    createRecord({
      issue_number: issueNumber,
      state: "reproducing",
      branch,
      workspace: fixture.repoPath,
      journal_path: null,
      blocked_reason: null,
      last_error: null,
    }),
  );

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () =>
      createIssue({
        title: "Clarify auth rollout",
        body: executionReadyBody("Keep the auth rollout notes current."),
      }),
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /change_classes=docs/);
  assert.match(status, /verification_policy intensity=strong driver=issue_metadata:auth/);
});
