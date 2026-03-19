import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GitHubIssue,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import { Supervisor } from "./supervisor";

export function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
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
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
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
    ...overrides,
  };
}

export function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 366,
    state: "blocked",
    branch: "codex/reopen-issue-366",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-366",
    journal_path: "/tmp/workspaces/issue-366/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: "session-1",
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
    attempt_count: 2,
    implementation_attempt_count: 2,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 1,
    last_head_sha: "abcdef1",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "Codex completed without updating the issue journal for issue #366.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Codex completed without updating the issue journal for issue #366.",
      signature: "handoff-missing",
      command: null,
      details: ["Update the Codex Working Notes section before ending the turn."],
      url: null,
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_blocker_signature: null,
    last_failure_signature: "handoff-missing",
    blocked_reason: "handoff_missing",
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-11T01:50:41.997Z",
    ...overrides,
  };
}

export function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  };
}

export function executionReadyBody(summary: string): string {
  return `## Summary
${summary}

## Scope
- keep the test fixture execution-ready

## Acceptance criteria
- supervisor treats this issue as runnable

## Verification
- npm test -- src/supervisor.test.ts`;
}

export function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  }).trim();
}

export async function createSupervisorFixture(options: {
  codexScriptLines?: string[];
} = {}): Promise<{
  config: SupervisorConfig;
  repoPath: string;
  stateFile: string;
  workspaceRoot: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-issue-87-"));
  const remotePath = path.join(root, "remote.git");
  const seedPath = path.join(root, "seed");
  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  const codexBinary = path.join(root, "fake-codex.sh");

  git(["init", "--bare", remotePath]);
  await fs.mkdir(seedPath, { recursive: true });
  git(["init", "-b", "main"], seedPath);
  await fs.writeFile(path.join(seedPath, "README.md"), "# fixture\n", "utf8");
  git(["add", "README.md"], seedPath);
  git(["commit", "-m", "seed"], seedPath);
  git(["remote", "add", "origin", remotePath], seedPath);
  git(["push", "-u", "origin", "main"], seedPath);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], remotePath);
  git(["clone", remotePath, repoPath]);
  git(["-C", repoPath, "branch", "--set-upstream-to=origin/main", "main"]);

  const codexScriptLines = options.codexScriptLines ?? [
    "#!/bin/sh",
    "set -eu",
    'out=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    "done",
    'printf \'{"type":"thread.started","thread_id":"thread-123"}\\n\'',
    "cat <<'EOF' > \"$out\"",
    "Summary: created a dirty checkpoint",
    "State hint: stabilizing",
    "Blocked reason: none",
    "Tests: not run",
    "Failure signature: none",
    "Next action: inspect the dirty worktree and finish recovery",
    "EOF",
    "printf '\\n- Scratchpad note: codex wrote a dirty change for reproduction.\\n' >> .codex-supervisor/issue-journal.md",
    "printf 'dirty change\\n' >> dirty.txt",
    "exit 0",
    "",
  ];
  await fs.writeFile(codexBinary, codexScriptLines.join("\n"), "utf8");
  await fs.chmod(codexBinary, 0o755);

  return {
    repoPath,
    stateFile,
    workspaceRoot,
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary,
      issueJournalMaxChars: 12000,
    }),
  };
}

export async function createIssueLintFixture(): Promise<{
  fixture: {
    config: SupervisorConfig;
    repoPath: string;
    stateFile: string;
    workspaceRoot: string;
  };
  loadIssueLintReport: (issue: GitHubIssue) => Promise<string>;
}> {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  let stubbedIssue: GitHubIssue | null = null;
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => {
      if (stubbedIssue === null) {
        throw new Error("Stubbed issue was not set before issue lint load.");
      }
      return stubbedIssue;
    },
  };

  return {
    fixture,
    loadIssueLintReport: async (issue: GitHubIssue) => {
      stubbedIssue = issue;
      return supervisor.issueLint(issue.number);
    },
  };
}

export function branchName(config: SupervisorConfig, issueNumber: number): string {
  return `${config.branchPrefix}${issueNumber}`;
}
