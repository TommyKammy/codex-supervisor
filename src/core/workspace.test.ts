import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SupervisorConfig } from "./types";
import { ensureWorkspace } from "./workspace";
import { DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH, issueJournalPath, syncIssueJournal } from "./journal";

const execFileAsync = promisify(execFile);

function createConfig(root: string): SupervisorConfig {
  return {
    repoPath: path.join(root, "repo"),
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(root, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(root, "state.json"),
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: path.join(root, "reviews"),
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args]);
  return result.stdout.trim();
}

async function withFakeGitFetch<T>(
  branch: string,
  stderrMessage: string,
  callback: () => Promise<T>,
): Promise<T> {
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-fake-git-"));
  const fakeGitPath = path.join(fakeRoot, "git");
  const realGitPath = (await execFileAsync("bash", ["-lc", "command -v git"])).stdout.trim();
  const targetFetchRefspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;

  await fs.writeFile(
    fakeGitPath,
    `#!/bin/sh
REAL_GIT=${JSON.stringify(realGitPath)}
git_c_arg_1=
git_c_arg_2=
if [ "$1" = "-C" ]; then
  git_c_arg_1="$1"
  git_c_arg_2="$2"
  shift
  shift
fi
if [ "$#" -eq 3 ] && [ "$1" = "fetch" ] && [ "$2" = "origin" ] && [ "$3" = "${targetFetchRefspec}" ]; then
  printf '%s\\n' ${JSON.stringify(stderrMessage)} >&2
  exit 128
fi
if [ -n "$git_c_arg_1" ]; then
  exec "$REAL_GIT" "$git_c_arg_1" "$git_c_arg_2" "$@"
fi
exec "$REAL_GIT" "$@"
`,
    { mode: 0o755 },
  );

  const originalPath = process.env.PATH ?? "";
  process.env.PATH = `${fakeRoot}:${originalPath}`;
  try {
    return await callback();
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(fakeRoot, { recursive: true, force: true });
  }
}

async function createRepositoryFixture(): Promise<SupervisorConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-workspace-"));
  const originPath = path.join(root, "origin.git");
  const config = createConfig(root);

  await execFileAsync("git", ["init", "--bare", originPath]);
  await execFileAsync("git", ["clone", originPath, config.repoPath]);
  await git(config.repoPath, "config", "user.name", "Codex Supervisor");
  await git(config.repoPath, "config", "user.email", "codex@example.test");
  await git(config.repoPath, "checkout", "-b", config.defaultBranch);
  await fs.writeFile(path.join(config.repoPath, "README.md"), "fixture\n", "utf8");
  await git(config.repoPath, "add", "README.md");
  await git(config.repoPath, "commit", "-m", "Initial commit");
  await git(config.repoPath, "push", "-u", "origin", config.defaultBranch);

  return config;
}

async function createSplitRemoteRepositoryFixture(): Promise<SupervisorConfig & { githubPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-workspace-split-"));
  const originPath = path.join(root, "origin.git");
  const githubPath = path.join(root, "github.git");
  const config = createConfig(root);

  await execFileAsync("git", ["init", "--bare", originPath]);
  await execFileAsync("git", ["init", "--bare", githubPath]);
  await execFileAsync("git", ["clone", originPath, config.repoPath]);
  await git(config.repoPath, "config", "user.name", "Codex Supervisor");
  await git(config.repoPath, "config", "user.email", "codex@example.test");
  await git(config.repoPath, "checkout", "-b", config.defaultBranch);
  await fs.writeFile(path.join(config.repoPath, "README.md"), "fixture\n", "utf8");
  await git(config.repoPath, "add", "README.md");
  await git(config.repoPath, "commit", "-m", "Initial commit");
  await git(config.repoPath, "push", "-u", "origin", config.defaultBranch);
  await git(config.repoPath, "remote", "add", "github", githubPath);
  await git(config.repoPath, "push", "-u", "github", config.defaultBranch);

  await fs.writeFile(path.join(config.repoPath, "fresh.txt"), "fresh authoritative change\n", "utf8");
  await git(config.repoPath, "add", "fresh.txt");
  await git(config.repoPath, "commit", "-m", "Fresh authoritative commit");
  await git(config.repoPath, "push", "github", config.defaultBranch);
  await git(config.repoPath, "fetch", "github", config.defaultBranch);

  return { ...config, githubPath };
}

async function createDivergedDefaultBranchFixture(): Promise<SupervisorConfig> {
  const config = await createRepositoryFixture();
  const root = path.dirname(config.repoPath);
  const githubPath = path.join(root, "github.git");
  const githubClonePath = path.join(root, "github-clone");

  await execFileAsync("git", ["init", "--bare", githubPath]);
  await git(config.repoPath, "remote", "add", "github", githubPath);
  await git(config.repoPath, "push", "-u", "github", config.defaultBranch);

  await fs.writeFile(path.join(config.repoPath, "origin-only.txt"), "origin-only change\n", "utf8");
  await git(config.repoPath, "add", "origin-only.txt");
  await git(config.repoPath, "commit", "-m", "Origin-only commit");
  await git(config.repoPath, "push", "origin", config.defaultBranch);

  await execFileAsync("git", ["clone", githubPath, githubClonePath]);
  await git(githubClonePath, "config", "user.name", "GitHub Collaborator");
  await git(githubClonePath, "config", "user.email", "github@example.test");
  await git(githubClonePath, "checkout", "-b", config.defaultBranch, `origin/${config.defaultBranch}`);
  await fs.writeFile(path.join(githubClonePath, "github-only.txt"), "github-only change\n", "utf8");
  await git(githubClonePath, "add", "github-only.txt");
  await git(githubClonePath, "commit", "-m", "GitHub-only commit");
  await git(githubClonePath, "push", "origin", config.defaultBranch);

  await git(config.repoPath, "fetch", "github", config.defaultBranch);

  return config;
}

test("ensureWorkspace reports when a recreated workspace restores from an existing local branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 721;
  const branch = `${config.branchPrefix}${issueNumber}`;

  await git(config.repoPath, "branch", branch, config.defaultBranch);

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "local_branch");
  assert.equal(ensured.restore.ref, branch);
});

test("ensureWorkspace reports when a recreated workspace bootstraps from the default branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 722;
  const branch = `${config.branchPrefix}${issueNumber}`;

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `origin/${config.defaultBranch}`);
});

test("ensureWorkspace keeps origin authoritative when the local default branch has unpublished commits", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 726;
  const branch = `${config.branchPrefix}${issueNumber}`;

  await fs.writeFile(path.join(config.repoPath, "local-only.txt"), "local-only change\n", "utf8");
  await git(config.repoPath, "add", "local-only.txt");
  await git(config.repoPath, "commit", "-m", "Local-only commit");

  const originDefaultSha = await gitOutput(config.repoPath, "rev-parse", `origin/${config.defaultBranch}`);
  const localDefaultSha = await gitOutput(config.repoPath, "rev-parse", config.defaultBranch);
  assert.notEqual(localDefaultSha, originDefaultSha);

  const ensured = await ensureWorkspace(config, issueNumber, branch);
  const branchHeadSha = await gitOutput(ensured.workspacePath, "rev-parse", "HEAD");

  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `origin/${config.defaultBranch}`);
  assert.equal(branchHeadSha, originDefaultSha);
  assert.notEqual(branchHeadSha, localDefaultSha);
});

test("ensureWorkspace reports when a recreated workspace discovers an existing remote branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 723;
  const branch = `${config.branchPrefix}${issueNumber}`;
  const collaboratorPath = path.join(path.dirname(config.repoPath), "collaborator");

  await execFileAsync("git", ["clone", path.join(path.dirname(config.repoPath), "origin.git"), collaboratorPath]);
  await git(collaboratorPath, "config", "user.name", "Codex Collaborator");
  await git(collaboratorPath, "config", "user.email", "collaborator@example.test");
  await git(collaboratorPath, "checkout", "-b", branch, `origin/${config.defaultBranch}`);
  await fs.writeFile(path.join(collaboratorPath, "remote-branch.txt"), "remote branch fixture\n", "utf8");
  await git(collaboratorPath, "add", "remote-branch.txt");
  await git(collaboratorPath, "commit", "-m", "Add remote issue branch");
  await git(collaboratorPath, "push", "-u", "origin", branch);

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "remote_branch");
  assert.equal(ensured.restore.ref, `origin/${branch}`);
});

test("ensureWorkspace treats a missing remote branch as bootstrap even when fetch stderr wording differs", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 724;
  const branch = `${config.branchPrefix}${issueNumber}`;

  const ensured = await withFakeGitFetch(
    branch,
    `fatal: remote branch ${branch} not found`,
    async () => ensureWorkspace(config, issueNumber, branch),
  );

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `origin/${config.defaultBranch}`);
});

test("ensureWorkspace bootstraps from the fresh default-branch ref instead of stale origin in split-remote repos", async () => {
  const config = await createSplitRemoteRepositoryFixture();
  const issueNumber = 725;
  const branch = `${config.branchPrefix}${issueNumber}`;

  const originDefaultSha = await gitOutput(config.repoPath, "rev-parse", `origin/${config.defaultBranch}`);
  const githubDefaultSha = await gitOutput(config.repoPath, "rev-parse", `github/${config.defaultBranch}`);
  const localDefaultSha = await gitOutput(config.repoPath, "rev-parse", config.defaultBranch);

  assert.notEqual(originDefaultSha, githubDefaultSha);
  assert.equal(localDefaultSha, githubDefaultSha);

  const ensured = await ensureWorkspace(config, issueNumber, branch);
  const branchHeadSha = await gitOutput(ensured.workspacePath, "rev-parse", "HEAD");

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `github/${config.defaultBranch}`);
  assert.equal(branchHeadSha, githubDefaultSha);
  assert.notEqual(branchHeadSha, originDefaultSha);
});

test("ensureWorkspace ignores similarly suffixed remote-tracking refs when bootstrapping", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 727;
  const branch = `${config.branchPrefix}${issueNumber}`;

  await git(config.repoPath, "checkout", "-b", "release/main", `origin/${config.defaultBranch}`);
  await fs.writeFile(path.join(config.repoPath, "release-main.txt"), "release branch change\n", "utf8");
  await git(config.repoPath, "add", "release-main.txt");
  await git(config.repoPath, "commit", "-m", "Release branch commit");
  await git(config.repoPath, "push", "-u", "origin", "release/main");
  await git(config.repoPath, "checkout", config.defaultBranch);

  const originDefaultSha = await gitOutput(config.repoPath, "rev-parse", `origin/${config.defaultBranch}`);
  const releaseMainSha = await gitOutput(config.repoPath, "rev-parse", "origin/release/main");
  assert.notEqual(releaseMainSha, originDefaultSha);

  const ensured = await ensureWorkspace(config, issueNumber, branch);
  const branchHeadSha = await gitOutput(ensured.workspacePath, "rev-parse", "HEAD");

  assert.equal(ensured.restore.source, "bootstrap_default_branch");
  assert.equal(ensured.restore.ref, `origin/${config.defaultBranch}`);
  assert.equal(branchHeadSha, originDefaultSha);
  assert.notEqual(branchHeadSha, releaseMainSha);
});

test("ensureWorkspace skips bootstrap-base resolution when restoring an existing local issue branch", async () => {
  const config = await createDivergedDefaultBranchFixture();
  const issueNumber = 728;
  const branch = `${config.branchPrefix}${issueNumber}`;

  await git(config.repoPath, "branch", branch, config.defaultBranch);

  const ensured = await ensureWorkspace(config, issueNumber, branch);

  assert.equal(ensured.workspacePath, path.join(config.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(ensured.restore.source, "local_branch");
  assert.equal(ensured.restore.ref, branch);
});

test("ensureWorkspace rejects reusing an existing workspace on the wrong branch", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 729;
  const branch = `${config.branchPrefix}${issueNumber}`;
  const ensured = await ensureWorkspace(config, issueNumber, branch);

  await git(ensured.workspacePath, "checkout", "-b", "unexpected-branch");

  await assert.rejects(
    () => ensureWorkspace(config, issueNumber, branch),
    /expected branch/i,
  );
});

test("ensureWorkspace rejects reusing an existing workspace on a detached HEAD", async () => {
  const config = await createRepositoryFixture();
  const issueNumber = 731;
  const branch = `${config.branchPrefix}${issueNumber}`;
  const ensured = await ensureWorkspace(config, issueNumber, branch);
  const headSha = await gitOutput(ensured.workspacePath, "rev-parse", "HEAD");

  await git(ensured.workspacePath, "checkout", "--detach", headSha);

  await assert.rejects(
    () => ensureWorkspace(config, issueNumber, branch),
    /detached head/i,
  );
});

test("ensureWorkspace rejects reusing an existing workspace from a foreign repository", async () => {
  const config = await createRepositoryFixture();
  const foreignConfig = await createRepositoryFixture();
  const issueNumber = 730;
  const branch = `${config.branchPrefix}${issueNumber}`;
  const workspacePath = path.join(config.workspaceRoot, `issue-${issueNumber}`);

  await fs.mkdir(config.workspaceRoot, { recursive: true });
  await execFileAsync("git", ["clone", foreignConfig.repoPath, workspacePath]);

  await assert.rejects(
    () => ensureWorkspace(config, issueNumber, branch),
    /worktree|repository|workspace/i,
  );
});

test("issue-scoped journals do not manufacture merge conflicts between unrelated issue branches", async () => {
  const config = await createRepositoryFixture();
  const issueA = 801;
  const issueB = 802;
  const branchA = `${config.branchPrefix}${issueA}`;
  const branchB = `${config.branchPrefix}${issueB}`;
  const workspaceA = await ensureWorkspace(config, issueA, branchA);
  const workspaceB = await ensureWorkspace(config, issueB, branchB);
  const journalPathA = issueJournalPath(workspaceA.workspacePath, config.issueJournalRelativePath, issueA);
  const journalPathB = issueJournalPath(workspaceB.workspacePath, config.issueJournalRelativePath, issueB);

  await syncIssueJournal({
    issue: {
      number: issueA,
      title: "Issue-scoped journal branch A",
      body: "",
      createdAt: "2026-03-27T00:00:00Z",
      updatedAt: "2026-03-27T00:00:00Z",
      url: "https://example.test/issues/801",
      state: "OPEN",
    },
    record: {
      issue_number: issueA,
      state: "reproducing",
      branch: branchA,
      pr_number: null,
      workspace: workspaceA.workspacePath,
      journal_path: journalPathA,
      review_wait_started_at: null,
      review_wait_head_sha: null,
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      codex_session_id: null,
      local_review_head_sha: null,
      local_review_blocker_summary: null,
      local_review_summary_path: null,
      local_review_run_at: null,
      local_review_max_severity: null,
      local_review_findings_count: 0,
      local_review_root_cause_count: 0,
      local_review_verified_max_severity: null,
      local_review_verified_findings_count: 0,
      local_review_recommendation: null,
      local_review_degraded: false,
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
      external_review_head_sha: null,
      external_review_misses_path: null,
      external_review_matched_findings_count: 0,
      external_review_near_match_findings_count: 0,
      external_review_missed_findings_count: 0,
      attempt_count: 1,
      implementation_attempt_count: 1,
      repair_attempt_count: 0,
      timeout_retry_count: 0,
      blocked_verification_retry_count: 0,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 0,
      last_head_sha: null,
      last_codex_summary: null,
      last_recovery_reason: null,
      last_recovery_at: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_blocker_signature: null,
      last_failure_signature: null,
      blocked_reason: null,
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      updated_at: "2026-03-27T00:00:00Z",
    },
    journalPath: journalPathA,
  });
  await fs.writeFile(path.join(workspaceA.workspacePath, "issue-801.txt"), "branch A change\n", "utf8");
  await git(workspaceA.workspacePath, "add", ".");
  await git(workspaceA.workspacePath, "commit", "-m", "Issue 801 journal and code");

  await syncIssueJournal({
    issue: {
      number: issueB,
      title: "Issue-scoped journal branch B",
      body: "",
      createdAt: "2026-03-27T00:00:00Z",
      updatedAt: "2026-03-27T00:00:00Z",
      url: "https://example.test/issues/802",
      state: "OPEN",
    },
    record: {
      issue_number: issueB,
      state: "reproducing",
      branch: branchB,
      pr_number: null,
      workspace: workspaceB.workspacePath,
      journal_path: journalPathB,
      review_wait_started_at: null,
      review_wait_head_sha: null,
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      codex_session_id: null,
      local_review_head_sha: null,
      local_review_blocker_summary: null,
      local_review_summary_path: null,
      local_review_run_at: null,
      local_review_max_severity: null,
      local_review_findings_count: 0,
      local_review_root_cause_count: 0,
      local_review_verified_max_severity: null,
      local_review_verified_findings_count: 0,
      local_review_recommendation: null,
      local_review_degraded: false,
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
      external_review_head_sha: null,
      external_review_misses_path: null,
      external_review_matched_findings_count: 0,
      external_review_near_match_findings_count: 0,
      external_review_missed_findings_count: 0,
      attempt_count: 1,
      implementation_attempt_count: 1,
      repair_attempt_count: 0,
      timeout_retry_count: 0,
      blocked_verification_retry_count: 0,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 0,
      last_head_sha: null,
      last_codex_summary: null,
      last_recovery_reason: null,
      last_recovery_at: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_blocker_signature: null,
      last_failure_signature: null,
      blocked_reason: null,
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      updated_at: "2026-03-27T00:00:00Z",
    },
    journalPath: journalPathB,
  });
  await fs.writeFile(path.join(workspaceB.workspacePath, "issue-802.txt"), "branch B change\n", "utf8");
  await git(workspaceB.workspacePath, "add", ".");
  await git(workspaceB.workspacePath, "commit", "-m", "Issue 802 journal and code");

  await git(config.repoPath, "merge", "--no-ff", branchA, "-m", "Merge issue 801");
  await git(workspaceB.workspacePath, "merge", config.defaultBranch);

  assert.equal(
    await gitOutput(workspaceB.workspacePath, "diff", "--name-only", "--diff-filter=U"),
    "",
  );
  assert.equal(await gitOutput(workspaceB.workspacePath, "status", "--short"), "");
  assert.equal(
    await gitOutput(workspaceB.workspacePath, "ls-files", "--others", "--exclude-standard"),
    "",
  );
  assert.equal(
    await gitOutput(workspaceB.workspacePath, "ls-files", ".codex-supervisor/issues/801/issue-journal.md"),
    ".codex-supervisor/issues/801/issue-journal.md",
  );
  assert.equal(
    await gitOutput(workspaceB.workspacePath, "ls-files", ".codex-supervisor/issues/802/issue-journal.md"),
    ".codex-supervisor/issues/802/issue-journal.md",
  );
});
