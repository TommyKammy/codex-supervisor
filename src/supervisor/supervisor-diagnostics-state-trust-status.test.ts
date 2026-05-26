import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { renderSupervisorStatusDto } from "./supervisor-status-report";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("doctor uses the diagnostic-only state loader instead of StateStore.load", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
  };

  const stateStore = (supervisor as unknown as { stateStore: StateStore }).stateStore;
  stateStore.load = async () => {
    throw new Error("StateStore.load should not be used by doctor");
  };

  const diagnostics = await supervisor.doctorReport();
  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");

  const report = await supervisor.doctor();

  assert.match(report, /doctor_check name=github_auth status=pass/);
  assert.match(report, /doctor_check name=state_file status=fail/);
  assert.match(report, /doctor_check name=worktrees status=pass/);
});

test("status surfaces corrupted JSON state as an explicit hard diagnostic", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.match(
    report.detailedStatusLines.join("\n"),
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/,
  );
  assert.equal(report.warning, null);

  const status = await supervisor.status();
  assert.match(
    status,
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(status, /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/);
  assert.match(status, /^No active issue\.$/m);
});

test("status surfaces the default trust posture and execution-safety warning", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning:
      "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=trusted_repo_and_authors/);
  assert.match(status, /execution_safety_mode=unsandboxed_autonomous/);
  assert.match(
    status,
    /execution_safety_warning=Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution\./,
  );
  assert.match(
    status,
    /config_warning=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
  );
});

test("status surfaces host-migration path repair and journal rehydration from the canonical local journal", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 145;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", String(issueNumber), "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(path.join(workspacePath, ".git"), "gitdir: /tmp/fake\n", "utf8");
  await fs.writeFile(
    journalPath,
    `# Issue #145: Host migration

## Supervisor Snapshot
- Updated at: 2026-04-17T00:10:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Current blocker: No blocker.
- Next exact step: Resume focused verification from the local worktree.

### Scratchpad
- Journal rehydration note: this journal was rehydrated on this host because the prior local-only handoff journal was unavailable.
`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "reproducing",
        branch,
        workspace: `/tmp/other-host/issue-${issueNumber}`,
        journal_path: `/tmp/other-host/issue-${issueNumber}/.codex-supervisor/issues/${issueNumber}/issue-journal.md`,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ({
      number: issueNumber,
      title: "Host migration diagnostics",
      body: executionReadyBody("Surface host migration diagnostics in status."),
      createdAt: "2026-04-17T00:00:00Z",
      updatedAt: "2026-04-17T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      labels: [],
      state: "OPEN",
    } satisfies GitHubIssue),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /^handoff_summary=next: Resume focused verification from the local worktree\.$/m,
  );
  assert.match(
    status,
    /^issue_host_paths issue=#145 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required$/m,
  );
  assert.match(
    status,
    /^issue_journal_state issue=#145 status=rehydrated guidance=no_manual_action_required detail=prior_local_only_handoff_unavailable$/m,
  );
  assert.match(
    status,
    /^status_warning=Tracked work is active for issue #145, but the supervisor loop is off\. Restart the supported loop host; expect loop_runtime state=running before issue #145 advances\.$/m,
  );
});

test("status does not warn for issue-scoped or custom issue journal paths", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const githubStub = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const issueScopedSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  (issueScopedSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const issueScopedStatus = await issueScopedSupervisor.status();
  assert.doesNotMatch(issueScopedStatus, /config_warning=/);

  const customPathSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/custom/issue-{issueNumber}.md",
  });
  (customPathSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const customPathStatus = await customPathSupervisor.status();
  assert.doesNotMatch(customPathStatus, /config_warning=/);
});

test("status omits execution-safety warnings when the trust posture does not require one", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.trustMode = "untrusted_or_mixed";
  fixture.config.executionSafetyMode = "operator_gated";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
    warning: null,
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.doesNotMatch(status, /execution_safety_warning=/);
});

test("runOnce fail-closes before execution when corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  let authStatusCalls = 0;
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => {
      authStatusCalls += 1;
      return { ok: true, message: null };
    },
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      return [];
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });

  assert.match(
    message,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.match(message, /status/);
  assert.match(message, /doctor/);
  assert.match(message, /reset-corrupt-json-state/);
  assert.equal(authStatusCalls, 0);
  assert.equal(listAllIssuesCalls, 0);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.json_state_quarantine?.marker_file, fixture.stateFile);
  assert.match(persisted.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
});

test("runRecoveryAction fail-closes requeue while corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.runRecoveryAction("requeue", 91);

  assert.equal(result.action, "requeue");
  assert.equal(result.issueNumber, 91);
  assert.equal(result.outcome, "rejected");
  assert.match(
    result.summary,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.equal(result.previousState, null);
  assert.equal(result.nextState, null);
  assert.equal(result.recoveryReason, null);
});
