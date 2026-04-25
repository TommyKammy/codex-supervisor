import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { StateStore } from "./core/state-store";
import { MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING } from "./core/config";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import {
  buildDoctorOperatorDecisionSurface,
  collectDoctorRawHostDiagnostics,
  collectDoctorRawDiagnostics,
  diagnoseBootstrapReadiness,
  diagnoseSupervisorHost,
  loadStateReadonlyForDoctor,
  renderDoctorReport,
} from "./doctor";
import { type SupervisorStateFile } from "./core/types";
import { diagnoseSetupReadiness } from "./setup-readiness";

test("diagnoseSupervisorHost reports representative auth, state, and workspace failures without mutating state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: path.join(root, "missing-codex"),
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        workspace: path.join(workspaceRoot, "issue-102"),
      }),
    },
  };

  const beforeState = await fs.readFile(stateFile, "utf8");
  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: false, message: "token expired" }),
    loadState: async () => trackedState,
  });
  const afterState = await fs.readFile(stateFile, "utf8");

  assert.equal(afterState, beforeState);
  assert.equal(diagnostics.overallStatus, "fail");
  assert.deepEqual(
    diagnostics.checks.map((check) => ({ name: check.name, status: check.status })),
    [
      { name: "github_auth", status: "fail" },
      { name: "codex_cli", status: "fail" },
      { name: "state_file", status: "fail" },
      { name: "worktrees", status: "warn" },
    ],
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "state_file")?.summary ?? "",
    /captured 1 corruption finding/i,
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.details[0] ?? "",
    /missing workspace/i,
  );
  assert.equal(diagnostics.trustDiagnostics.trustMode, "trusted_repo_and_authors");
  assert.equal(diagnostics.trustDiagnostics.executionSafetyMode, "unsandboxed_autonomous");
  assert.match(
    diagnostics.trustDiagnostics.warning ?? "",
    /trusted GitHub-authored inputs/i,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_posture trust_mode=trusted_repo_and_authors execution_safety_mode=unsandboxed_autonomous/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_warning kind=execution_safety detail=Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution\./,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_warning kind=config detail=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
  );
});

test("diagnoseSupervisorHost ignores recovery-only synthetic parent epic records in worktree diagnostics", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {
        "123": createRecord({
          issue_number: 123,
          state: "done",
          branch: "",
          pr_number: null,
          workspace: "",
          journal_path: null,
          codex_session_id: null,
          blocked_reason: null,
          last_recovery_reason:
            "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
          last_recovery_at: "2026-03-13T00:20:00Z",
        }),
      },
    }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(renderDoctorReport(diagnostics), /doctor_check name=worktrees status=pass summary=Tracked worktrees look consistent\./);
});

test("diagnoseSupervisorHost surfaces host-migration path repair and journal rehydration without downgrading worktree health", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-host-migration-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  const issueNumber = 177;
  const workspacePath = path.join(workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", String(issueNumber), "issue-journal.md");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Codex"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "codex@example.test"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "seed\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: repoPath });
  execFileSync("git", ["worktree", "add", "-b", "codex/reopen-issue-177", workspacePath, "HEAD"], { cwd: repoPath });
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Host migration

## Codex Working Notes
### Current Handoff
- Current blocker: None.
- Next exact step:

### Scratchpad
- Journal rehydration note: this journal was rehydrated on this host because the prior local-only handoff journal was unavailable.
`,
    "utf8",
  );
  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {
        [String(issueNumber)]: createRecord({
          issue_number: issueNumber,
          workspace: `/tmp/other-host/issue-${issueNumber}`,
          journal_path: `/tmp/other-host/issue-${issueNumber}/.codex-supervisor/issues/${issueNumber}/issue-journal.md`,
        }),
      },
    }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  const report = renderDoctorReport(diagnostics);
  assert.match(
    report,
    /^doctor_detail name=worktrees detail=issue_host_paths issue=#177 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required$/m,
  );
  assert.match(
    report,
    /^doctor_detail name=worktrees detail=issue_journal_state issue=#177 status=rehydrated guidance=no_manual_action_required detail=prior_local_only_handoff_unavailable$/m,
  );
  assert.doesNotMatch(report, /missing workspace/);
});

test("diagnoseSupervisorHost degrades per-issue host inspection failures and continues other worktree diagnostics", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-host-inspect-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  const brokenIssueNumber = 188;
  const migratedIssueNumber = 189;
  const brokenWorkspacePath = path.join(workspaceRoot, `issue-${brokenIssueNumber}`);
  const migratedWorkspacePath = path.join(workspaceRoot, `issue-${migratedIssueNumber}`);
  const migratedJournalPath = path.join(
    migratedWorkspacePath,
    ".codex-supervisor",
    "issues",
    String(migratedIssueNumber),
    "issue-journal.md",
  );
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Codex"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "codex@example.test"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "seed\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: repoPath });
  execFileSync("git", ["worktree", "add", "-b", "codex/issue-188", brokenWorkspacePath, "HEAD"], { cwd: repoPath });
  execFileSync("git", ["worktree", "add", "-b", "codex/issue-189", migratedWorkspacePath, "HEAD"], { cwd: repoPath });
  await fs.mkdir(path.dirname(migratedJournalPath), { recursive: true });
  await fs.writeFile(
    migratedJournalPath,
    `# Issue #189: Host migration

## Codex Working Notes
### Current Handoff
- Current blocker: None.
- Next exact step:

### Scratchpad
- Journal rehydration note: this journal was rehydrated on this host because the prior local-only handoff journal was unavailable.
`,
    "utf8",
  );

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {
        [String(brokenIssueNumber)]: createRecord({
          issue_number: brokenIssueNumber,
          workspace: brokenWorkspacePath,
          journal_path: brokenWorkspacePath,
        }),
        [String(migratedIssueNumber)]: createRecord({
          issue_number: migratedIssueNumber,
          workspace: `/tmp/other-host/issue-${migratedIssueNumber}`,
          journal_path: `/tmp/other-host/issue-${migratedIssueNumber}/.codex-supervisor/issues/${migratedIssueNumber}/issue-journal.md`,
        }),
      },
    }),
  });

  const worktreesCheck = diagnostics.checks.find((check) => check.name === "worktrees");
  assert.equal(worktreesCheck?.status, "warn");
  assert.match(
    worktreesCheck?.summary ?? "",
    /1 tracked workspace issue\(s\) detected\./,
  );
  const report = renderDoctorReport(diagnostics);
  assert.match(
    report,
    /^doctor_detail name=worktrees detail=Issue #188 host diagnostics could not be inspected: EISDIR: illegal operation on a directory, read\.$/m,
  );
  assert.match(
    report,
    /^doctor_detail name=worktrees detail=issue_host_paths issue=#189 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required$/m,
  );
  assert.match(
    report,
    /^doctor_detail name=worktrees detail=issue_journal_state issue=#189 status=rehydrated guidance=no_manual_action_required detail=prior_local_only_handoff_unavailable$/m,
  );
});

test("diagnoseSupervisorHost degrades malformed synthetic recovery records without throwing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {
        "123": {
          ...createRecord({
            issue_number: 123,
            state: "done",
            pr_number: null,
            journal_path: null,
            codex_session_id: null,
            blocked_reason: null,
            last_recovery_reason:
              "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
            last_recovery_at: "2026-03-13T00:20:00Z",
          }),
          branch: null,
          workspace: null,
        } as unknown as SupervisorStateFile["issues"][string],
      },
    }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.details[0] ?? "",
    /Issue #123 is missing workspace null\./,
  );
});

test("diagnoseSupervisorHost records reconciliation backlog reload failures without throwing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify({
    activeIssueNumber: null,
    issues: {},
  }, null, 2)}\n`, "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  let loadStateCalls = 0;
  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => {
      loadStateCalls += 1;
      if (loadStateCalls === 1) {
        return {
          activeIssueNumber: null,
          issues: {},
        };
      }

      throw new Error("EACCES: permission denied");
    },
  });

  assert.equal(loadStateCalls, 2);
  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.reconciliationBacklogLine, null);
  assert.equal(diagnostics.checks.find((check) => check.name === "github_auth")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "codex_cli")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(
    diagnostics.checks.find((check) => check.name === "state_file")?.summary ?? "",
    /Failed to read JSON state file for reconciliation backlog diagnostics:/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=state_file detail=reconciliation_backlog_state_read_failed location=.*state\.json message=EACCES: permission denied/,
  );
});

test("diagnoseSupervisorHost does not skip synthetic-like records missing recovery metadata", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {
        "123": {
          ...createRecord({
            issue_number: 123,
            state: "done",
            branch: "",
            workspace: "",
            pr_number: null,
            journal_path: null,
            codex_session_id: null,
            blocked_reason: null,
          }),
          last_recovery_reason: undefined,
          last_recovery_at: undefined,
        } as unknown as SupervisorStateFile["issues"][string],
      },
    }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.details[0] ?? "",
    /Issue #123 is missing workspace \./,
  );
});

test("renderDoctorReport only warns for the legacy shared issue journal path", () => {
  const baseDiagnostics = {
    overallStatus: "pass" as const,
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    loopRuntime: {
      state: "off" as const,
      hostMode: "unknown" as const,
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none" as const,
      detail: null,
    },
    loopHostWarning: null,
    trustDiagnostics: {
      trustMode: "untrusted_or_mixed" as const,
      executionSafetyMode: "operator_gated" as const,
      warning: null,
      configWarning:
        "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
    },
  };

  assert.match(
    renderDoctorReport(baseDiagnostics),
    /doctor_warning kind=config detail=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
  );

  assert.doesNotMatch(
    renderDoctorReport({
      ...baseDiagnostics,
      trustDiagnostics: {
        ...baseDiagnostics.trustDiagnostics,
        configWarning: null,
      },
    }),
    /doctor_warning kind=config/,
  );
});

test("renderDoctorReport includes loop host diagnostics and macOS tmux drift warnings", () => {
  const report = renderDoctorReport({
    overallStatus: "warn",
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    trustDiagnostics: {
      trustMode: "untrusted_or_mixed",
      executionSafetyMode: "operator_gated",
      warning: null,
      configWarning: null,
    },
    loopRuntime: {
      state: "running",
      hostMode: "direct",
      runMode: "unknown",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: 4242,
      startedAt: "2026-03-25T00:00:00.000Z",
      ownershipConfidence: "duplicate_suspected",
      detail: "supervisor-loop-runtime",
      recoveryGuidance:
        "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      duplicateLoopDiagnostic: {
        kind: "duplicate_loop_processes",
        status: "duplicate",
        matchingProcessCount: 2,
        matchingPids: [4242, 4243],
        configPath: "/tmp/supervisor.config.json",
        stateFile: "/tmp/state.json",
        recoveryGuidance:
          "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      },
    },
    loopHostWarning:
      "macOS loop runtime is active outside tmux. Restart it with ./scripts/start-loop-tmux.sh and stop unsupported direct hosts before relying on steady-state automation.",
  });

  assert.match(
    report,
    /doctor_loop_runtime state=running host_mode=direct run_mode=unknown marker_path=\/tmp\/locks\/supervisor\/loop-runtime\.lock config_path=\/tmp\/supervisor\.config\.json state_file=\/tmp\/state\.json pid=4242 started_at=2026-03-25T00:00:00.000Z ownership_confidence=duplicate_suspected detail=supervisor-loop-runtime/,
  );
  assert.match(
    report,
    /doctor_loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=\/tmp\/supervisor.config.json state_file=\/tmp\/state.json recovery=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\./,
  );
  assert.match(
    report,
    /doctor_loop_runtime_recovery guidance=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\./,
  );
  assert.match(
    report,
    /^doctor_restart_recommendation category=safe_restart source=loop_runtime_diagnostic summary=Restart can be safe after following the runtime ownership and duplicate-process guidance\.$/m,
  );
  assert.match(
    report,
    /doctor_warning kind=loop_host detail=macOS loop runtime is active outside tmux\. Restart it with \.\/scripts\/start-loop-tmux\.sh and stop unsupported direct hosts before relying on steady-state automation\./,
  );
});

test("renderDoctorReport sanitizes loop runtime run mode values", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    trustDiagnostics: {
      trustMode: "untrusted_or_mixed",
      executionSafetyMode: "operator_gated",
      warning: null,
      configWarning: null,
    },
    loopRuntime: {
      state: "running",
      hostMode: "unknown",
      runMode: "unknown\nmutated=line" as never,
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: 4242,
      startedAt: "2026-03-25T00:00:00.000Z",
      ownershipConfidence: "live_lock",
      detail: "supervisor-loop-runtime",
    },
    loopHostWarning: null,
  });

  assert.match(report, /doctor_loop_runtime .* run_mode=unknown\\nmutated=line /);
  assert.doesNotMatch(report, /\nmutated=line/);
});

test("renderDoctorReport sanitizes multiline Codex policy lines", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    checks: [],
    codexModelPolicyLines: [
      "doctor_codex_model_policy default=inherit->gpt-5.4@inherited_host_default\nmutated=line",
    ],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    loopHostWarning: null,
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
      configWarning: null,
    },
  });

  assert.match(
    report,
    /doctor_codex_model_policy default=inherit->gpt-5\.4@inherited_host_default\\nmutated=line/,
  );
  assert.doesNotMatch(report, /\nmutated=line/);
});

test("diagnoseSupervisorHost reports inherited host Codex defaults in doctor output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-model-"));
  const codexHome = path.join(root, "codex-home");
  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.4" # shared default\n', "utf8");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  process.env.CODEX_HOME = codexHome;

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      codexModelStrategy: "inherit",
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({ activeIssueNumber: null, issues: {} }),
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 0,
        truncated: false,
      }),
    },
  });

  const report = renderDoctorReport(diagnostics);
  assert.match(report, /doctor_codex_model_policy default=inherit->gpt-5\.4@inherited_host_default/);
  assert.match(report, /doctor_codex_route_overrides repair=default_route\(gpt-5\.4\) local_review=default_route\(gpt-5\.4\)/);
  assert.match(report, new RegExp(`doctor_codex_host_default model=gpt-5\\.4 source=${codexHome.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/config\\.toml`));
});

test("diagnoseSupervisorHost surfaces orphan prune candidates and representative eligibility reasons", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "seed"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });

  const eligibleWorkspace = path.join(workspaceRoot, "issue-201");
  const lockedWorkspace = path.join(workspaceRoot, "issue-202");
  const recentWorkspace = path.join(workspaceRoot, "issue-203");
  execFileSync("git", ["worktree", "add", "-b", "codex/reopen-issue-201", eligibleWorkspace, "HEAD"], { cwd: repoPath });
  execFileSync("git", ["worktree", "add", "-b", "codex/reopen-issue-202", lockedWorkspace, "HEAD"], { cwd: repoPath });
  execFileSync("git", ["worktree", "add", "-b", "codex/reopen-issue-203", recentWorkspace, "HEAD"], { cwd: repoPath });

  const oldTime = new Date("2026-03-01T00:00:00Z");
  const recentTime = new Date();
  await fs.utimes(eligibleWorkspace, oldTime, oldTime);
  await fs.utimes(lockedWorkspace, oldTime, oldTime);
  await fs.utimes(recentWorkspace, recentTime, recentTime);

  const lockPath = path.join(path.dirname(stateFile), "locks", "issues", "issue-202.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: "issue-202", acquired_at: "2026-03-21T00:00:00Z" }, null, 2)}\n`,
    "utf8",
  );

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      cleanupDoneWorkspacesAfterHours: -1,
      maxDoneWorkspaces: -1,
      cleanupOrphanedWorkspacesAfterHours: 24,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({ activeIssueNumber: null, issues: {} }),
  });

  const report = renderDoctorReport(diagnostics);
  assert.match(
    report,
    /doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=24 preserved=locked,recent,unsafe_target/,
  );
  assert.match(report, /doctor_check name=worktrees status=warn summary=.*orphaned prune candidate/i);
  assert.match(report, /doctor_detail name=worktrees detail=orphan_prune_candidate issue_number=201 eligibility=eligible /);
  assert.match(report, /doctor_detail name=worktrees detail=orphan_prune_candidate issue_number=202 eligibility=locked /);
  assert.match(report, /doctor_detail name=worktrees detail=orphan_prune_candidate issue_number=203 eligibility=recent /);
});

test("diagnoseSupervisorHost reports unsafe orphan prune targets when branch naming is invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "seed"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });

  const orphanWorkspace = path.join(workspaceRoot, "issue-301");
  execFileSync("git", ["worktree", "add", "-b", "codex/reopen-issue-301", orphanWorkspace, "HEAD"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      branchPrefix: "bad ref ",
      cleanupDoneWorkspacesAfterHours: 24,
      maxDoneWorkspaces: -1,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({ activeIssueNumber: null, issues: {} }),
  });

  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=orphan_prune_candidate issue_number=301 eligibility=unsafe_target /,
  );
});

test("diagnoseBootstrapReadiness returns structured ready config and host summary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-bootstrap-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      reviewBotLogins: [],
    }),
    "utf8",
  );

  const summary = await diagnoseBootstrapReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.config.status, "ready");
  assert.equal(summary.config.config?.repoPath, repoPath);
  assert.equal(summary.readiness.ready, true);
  assert.equal(summary.readiness.overallStatus, "pass");
  assert.equal(summary.readiness.missingRequiredFields.length, 0);
  assert.equal(summary.readiness.repo.status, "pass");
  assert.match(summary.readiness.repo.summary, /Tracked worktrees look consistent/);
  assert.deepEqual(
    summary.readiness.checks.map((check) => check.status),
    ["pass", "pass", "pass", "pass"],
  );
});

test("diagnoseSetupReadiness returns typed first-run setup state distinct from doctor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      reviewBotLogins: [],
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.kind, "setup_readiness");
  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "missing");
  assert.deepEqual(
    summary.fields.map((field) => [field.key, field.state, field.metadata.source, field.metadata.editable, field.metadata.valueType]),
    [
      ["repoPath", "configured", "config", true, "directory_path"],
      ["repoSlug", "configured", "config", true, "repo_slug"],
      ["defaultBranch", "configured", "config", true, "git_ref"],
      ["workspaceRoot", "configured", "config", true, "directory_path"],
      ["stateFile", "configured", "config", true, "file_path"],
      ["codexBinary", "configured", "config", true, "executable_path"],
      ["branchPrefix", "configured", "config", true, "text"],
      ["workspacePreparationCommand", "missing", "config", true, "text"],
      ["localCiCommand", "missing", "config", true, "text"],
      ["trustMode", "missing", "config", true, "trust_mode"],
      ["executionSafetyMode", "missing", "config", true, "execution_safety_mode"],
      ["reviewProvider", "missing", "config", true, "review_provider"],
    ],
  );
  assert.deepEqual(summary.blockers.map((blocker) => blocker.code), [
    "missing_trust_mode",
    "missing_execution_safety_mode",
    "missing_review_provider",
  ]);
  assert.deepEqual(summary.blockers.at(-1), {
    code: "missing_review_provider",
    message: "Configure at least one review provider before first-run setup is complete.",
    fieldKeys: ["reviewProvider"],
    remediation: {
      kind: "configure_review_provider",
      summary: "Configure at least one review provider before first-run setup is complete.",
      fieldKeys: ["reviewProvider"],
    },
  });
  assert.deepEqual(summary.blockers.slice(0, 2), [
    {
      code: "missing_trust_mode",
      message: "Trust mode needs an explicit first-run setup decision.",
      fieldKeys: ["trustMode"],
      remediation: {
        kind: "edit_config",
        summary: "Trust mode needs an explicit first-run setup decision.",
        fieldKeys: ["trustMode"],
      },
    },
    {
      code: "missing_execution_safety_mode",
      message: "Execution safety mode needs an explicit first-run setup decision.",
      fieldKeys: ["executionSafetyMode"],
      remediation: {
        kind: "edit_config",
        summary: "Execution safety mode needs an explicit first-run setup decision.",
        fieldKeys: ["executionSafetyMode"],
      },
    },
  ]);
  assert.equal(summary.hostReadiness.overallStatus, "pass");
  assert.deepEqual(summary.hostReadiness.checks.map((check) => check.name), [
    "github_auth",
    "codex_cli",
    "state_file",
    "worktrees",
  ]);
  assert.deepEqual(summary.providerPosture, {
    profile: "none",
    provider: "none",
    reviewers: [],
    signalSource: "none",
    configured: false,
    summary: "No review provider is configured.",
  });
  assert.deepEqual(summary.trustPosture, {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning:
      "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
    configWarning: null,
    configured: false,
    summary: "Trust posture needs an explicit first-run setup decision.",
  });
  assert.deepEqual(summary.localCiContract, {
    configured: false,
    command: null,
    recommendedCommand: null,
    source: "config",
    summary: "No repo-owned local CI contract is configured.",
    warning: null,
  });
});

test("diagnoseSetupReadiness recommends a repo-owned local CI candidate when localCiCommand is unset", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      scripts: {
        "verify:supervisor-pre-pr": "npm test",
        "verify:pre-pr": "npm run lint",
        "ci:local": "npm run check",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.deepEqual(summary.localCiContract, {
    configured: false,
    command: null,
    recommendedCommand: "npm run verify:supervisor-pre-pr",
    source: "repo_script_candidate",
    summary:
      "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:supervisor-pre-pr.",
    warning: null,
  });
  assert.equal(summary.ready, true);
});

test("diagnoseSetupReadiness still detects a repo-owned local CI candidate when the config is invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "configs", "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      scripts: {
        "verify:supervisor-pre-pr": "npm test",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: "../repo",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "invalid branch prefix with spaces",
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.deepEqual(summary.localCiContract, {
    configured: false,
    command: null,
    recommendedCommand: "npm run verify:supervisor-pre-pr",
    source: "repo_script_candidate",
    summary:
      "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:supervisor-pre-pr.",
    warning: null,
  });
  assert.equal(summary.overallStatus, "invalid");
  assert.equal(summary.ready, false);
});

test("diagnoseSetupReadiness prefers the configured local CI command over repo-owned candidates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      scripts: {
        "verify:supervisor-pre-pr": "npm test",
        "verify:pre-pr": "npm run lint",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: "npm run ci:local",
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.deepEqual(summary.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
  });
  assert.equal(summary.ready, true);
});

test("diagnoseSetupReadiness warns when localCiCommand is configured without workspacePreparationCommand", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: "npm run ci:local",
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.localCiContract?.configured, true);
  assert.match(
    summary.localCiContract?.warning ?? "",
    /localCiCommand is configured but workspacePreparationCommand is unset/i,
  );
  assert.match(
    summary.localCiContract?.warning ?? "",
    /GitHub checks can stay green while host-local CI still blocks tracked PR progress/i,
  );
});

test("diagnoseSetupReadiness surfaces a structured local CI command as configured", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: {
        mode: "structured",
        executable: "npm",
        args: ["run", "ci:local"],
      },
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.deepEqual(summary.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
  });
  assert.equal(summary.fields.find((field) => field.key === "localCiCommand")?.value, "npm run ci:local");
  assert.equal(summary.ready, true);
});

test("diagnoseSetupReadiness preserves structured local CI warnings when config is otherwise invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-[",
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: {
        mode: "structured",
        executable: "npm",
        args: ["run", "ci:local"],
      },
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.overallStatus, "invalid");
  assert.deepEqual(summary.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
  });
});

test("diagnoseSetupReadiness suppresses the local CI warning when invalid config still carries a structured workspace preparation command", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath,
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot,
      stateFile: path.join(root, "state.json"),
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-[",
      reviewBotLogins: ["chatgpt-codex-connector"],
      localCiCommand: {
        mode: "structured",
        executable: "npm",
        args: ["run", "ci:local"],
      },
      workspacePreparationCommand: {
        mode: "shell",
        command: "npm ci",
      },
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.overallStatus, "invalid");
  assert.deepEqual(summary.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning: null,
  });
});

test("renderDoctorReport surfaces merge-critical recheck cadence visibility", () => {
  const diagnostics = {
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    },
    checks: [
      {
        name: "github_auth",
        status: "pass",
        summary: "GitHub auth looks healthy.",
        details: [],
      },
    ],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 30,
      mergeCriticalEffectiveSeconds: 30,
      mergeCriticalRecheckEnabled: true,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    orphanPolicySummary:
      "doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=24 preserved=locked,recent,unsafe_target",
    workspacePreparationContract: {
      configured: true,
      command: "npm ci",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned workspace preparation contract is configured.",
    },
    localCiContract: {
      configured: true,
      command: "npm run ci:local",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
    },
  };

  const report = renderDoctorReport(diagnostics as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(report, /doctor_cadence poll_interval_seconds=120 merge_critical_recheck_seconds=30 merge_critical_effective_seconds=30 enabled=true/);
  assert.match(
    report,
    /doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=24 preserved=locked,recent,unsafe_target/,
  );
  assert.match(
    report,
    /doctor_workspace_preparation configured=true source=config command=npm ci summary=Repo-owned workspace preparation contract is configured\./,
  );
  assert.match(report, /doctor_local_ci configured=true source=config command=npm run ci:local summary=Repo-owned local CI contract is configured\./);
});

test("renderDoctorReport starts with decision summary and tiers active risks, maintenance, and informational details", () => {
  const report = renderDoctorReport({
    overallStatus: "fail",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: null,
      configWarning: null,
    },
    checks: [
      {
        name: "github_auth",
        status: "fail",
        summary: "GitHub CLI authentication is unavailable.",
        details: ["Run `gh auth status --hostname github.com` to inspect the current login state."],
      },
      {
        name: "worktrees",
        status: "warn",
        summary: "orphaned prune candidates=1 eligible=1 locked=0 recent=0 unsafe_target=0",
        details: [
          "issue_host_paths issue=#177 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required",
          "orphan_prune_candidate issue_number=201 eligibility=eligible workspace=<workspace-root>/issue-201 branch=codex/issue-201 modified_at=2026-03-01T00:00:00.000Z reason=done_state_missing_from_supervisor_state",
        ],
      },
    ],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  const lines = report.split("\n");
  assert.match(lines[0], /^doctor_decision action=stop summary=/);
  assert.match(lines[1], /^doctor_operator_action action=fix_config source=doctor_check priority=80 summary=/);
  assert.equal(lines[2], "doctor_tier tier=active_risk count=2");
  assert.equal(lines[5], "doctor_tier tier=maintenance count=2");
  assert.equal(lines[8], "doctor_tier tier=informational count=1");
  assert.match(report, /^doctor_tier_item tier=active_risk source=github_auth detail=GitHub CLI authentication is unavailable\.$/m);
  assert.match(report, /^doctor_tier_item tier=maintenance source=worktrees detail=orphaned prune candidates=1 eligible=1 locked=0 recent=0 unsafe_target=0$/m);
  assert.match(report, /^doctor_tier_item tier=informational source=worktrees detail=issue_host_paths issue=#177 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required$/m);
  assert.match(report, /^doctor_check name=github_auth status=fail summary=GitHub CLI authentication is unavailable\.$/m);
  assert.match(report, /^doctor_detail name=worktrees detail=orphan_prune_candidate issue_number=201 eligibility=eligible /m);
});

test("doctor raw diagnostics stay separate from operator decision summary rendering", () => {
  const rawDiagnostics = collectDoctorRawDiagnostics([
    {
      name: "github_auth",
      status: "fail",
      summary: "GitHub CLI authentication is unavailable.",
      details: ["Run `gh auth status --hostname github.com` to inspect the current login state."],
    },
    {
      name: "worktrees",
      status: "warn",
      summary: "orphaned prune candidates=1 eligible=1 locked=0 recent=0 unsafe_target=0",
      details: [
        "issue_host_paths issue=#177 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required",
        "orphan_prune_candidate issue_number=201 eligibility=eligible workspace=<workspace-root>/issue-201 branch=codex/issue-201 modified_at=2026-03-01T00:00:00.000Z reason=done_state_missing_from_supervisor_state",
      ],
    },
  ]);

  assert.equal(rawDiagnostics.overallStatus, "fail");
  assert.deepEqual(
    rawDiagnostics.checks.map((check) => ({ name: check.name, status: check.status })),
    [
      { name: "github_auth", status: "fail" },
      { name: "worktrees", status: "warn" },
    ],
  );
  assert.equal("decisionSummary" in rawDiagnostics, false);
  assert.equal("diagnosticTiers" in rawDiagnostics, false);

  const decisionSurface = buildDoctorOperatorDecisionSurface(rawDiagnostics);
  assert.deepEqual(decisionSurface.decisionSummary, {
    action: "stop",
    summary: "2 active risk(s) require operator attention before continuing.",
  });
  assert.equal(decisionSurface.diagnosticTiers.active_risk.length, 2);
  assert.equal(decisionSurface.diagnosticTiers.maintenance.length, 2);
  assert.equal(decisionSurface.diagnosticTiers.informational.length, 1);
});

test("doctor raw host diagnostics collector returns checks without operator decision fields", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-raw-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const rawDiagnostics = await collectDoctorRawHostDiagnostics({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({
      activeIssueNumber: null,
      issues: {},
    }),
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 0,
        truncated: false,
      }),
    },
  });

  assert.equal(rawDiagnostics.overallStatus, "pass");
  assert.deepEqual(
    rawDiagnostics.checks.map((check) => check.name),
    ["github_auth", "codex_cli", "state_file", "worktrees"],
  );
  assert.equal("decisionSummary" in rawDiagnostics, false);
  assert.equal("diagnosticTiers" in rawDiagnostics, false);
});

test("renderDoctorReport surfaces absent workspace preparation posture when no repo-owned contract exists", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    workspacePreparationContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned workspace preparation contract is configured.",
    },
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(
    report,
    /doctor_workspace_preparation configured=false source=config command=none summary=No repo-owned workspace preparation contract is configured\./,
  );
});

test("renderDoctorReport surfaces advisory local CI posture when a repo-owned candidate exists", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: "npm run verify:supervisor-pre-pr",
      source: "repo_script_candidate",
      summary:
        "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:supervisor-pre-pr.",
      warning: null,
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(
    report,
    /doctor_local_ci configured=false source=repo_script_candidate command=none summary=Repo-owned local CI candidate exists but localCiCommand is unset\. Recommended command: npm run verify:supervisor-pre-pr\./,
  );
  assert.match(
    report,
    /^doctor_operator_action action=adopt_local_ci source=doctor_local_ci priority=55 summary=Repo-owned local CI candidate exists; adopt it in config or explicitly dismiss it before relying on local verification posture\.$/m,
  );
});

test("renderDoctorReport surfaces explicitly dismissed local CI candidate posture", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: "npm run verify:supervisor-pre-pr",
      source: "dismissed_repo_script_candidate",
      summary:
        "Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking. Dismissed candidate: npm run verify:supervisor-pre-pr.",
      warning: null,
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(
    report,
    /doctor_local_ci configured=false source=dismissed_repo_script_candidate command=none summary=Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking\. Dismissed candidate: npm run verify:supervisor-pre-pr\./,
  );
  assert.match(
    report,
    /^doctor_operator_action action=safe_to_ignore source=doctor_local_ci priority=10 summary=Repo-owned local CI candidate was intentionally dismissed; no local CI adoption action is required\.$/m,
  );
});

test("renderDoctorReport warns when localCiCommand is configured without workspacePreparationCommand", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    workspacePreparationContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned workspace preparation contract is configured.",
      warning: null,
    },
    localCiContract: {
      configured: true,
      command: "npm run ci:local",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned local CI contract is configured.",
      warning: MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING,
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.equal(report.includes(`doctor_warning kind=config detail=${MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING}`), true);
  assert.equal(report.split(MISSING_WORKSPACE_PREPARATION_CONTRACT_WARNING).length - 1, 1);
});

test("renderDoctorReport warns when workspacePreparationCommand points at a missing repo-relative helper", () => {
  const warning =
    "workspacePreparationCommand points at ./scripts/prepare-workspace.sh, but that path does not resolve to a file inside repoPath. Move the helper into the repository and commit it, or switch to a worktree-compatible repo-owned command.";
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    workspacePreparationContract: {
      configured: true,
      command: "./scripts/prepare-workspace.sh",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned workspace preparation contract is configured.",
      warning,
    },
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.equal(report.includes(`doctor_warning kind=config detail=${warning}`), true);
});

test("renderDoctorReport warns when workspacePreparationCommand points at an untracked repo-relative helper", () => {
  const warning =
    "workspacePreparationCommand points at ./scripts/prepare-workspace.sh, but that path resolves to an untracked helper. Commit the helper so preserved issue worktrees inherit it, or switch to a tracked repo-owned command.";
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    workspacePreparationContract: {
      configured: true,
      command: "./scripts/prepare-workspace.sh",
      recommendedCommand: null,
      source: "config",
      summary: "Repo-owned workspace preparation contract is configured.",
      warning,
    },
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.equal(report.includes(`doctor_warning kind=config detail=${warning}`), true);
});

test("renderDoctorReport surfaces absent local CI posture when no repo-owned contract exists", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    localCiContract: {
      configured: false,
      command: null,
      recommendedCommand: null,
      source: "config",
      summary: "No repo-owned local CI contract is configured.",
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(
    report,
    /doctor_local_ci configured=false source=config command=none summary=No repo-owned local CI contract is configured\./,
  );
  assert.match(
    report,
    /^doctor_operator_action action=continue source=doctor priority=0 summary=No blocking doctor action was detected; continue normal supervisor operation\.$/m,
  );
});

test("renderDoctorReport surfaces the selected local review posture preset", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "trusted_repo_and_authors",
      executionSafetyMode: "unsandboxed_autonomous",
      warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
      configWarning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
    localReviewPosture: {
      preset: "repair_high_severity",
      enabled: true,
      policy: "block_merge",
      autoRepair: "high_severity_only",
      followUpIssueCreation: false,
      summary: "Local review posture repairs verifier-confirmed high-severity findings only.",
      guarantees: [
        "auto-repair is limited to verifier-confirmed high-severity findings",
        "follow-up issue creation stays disabled",
      ],
    },
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.match(
    report,
    /doctor_local_review_posture preset=repair_high_severity enabled=true policy=block_merge auto_repair=high_severity_only follow_up_issue_creation=false summary=Local review posture repairs verifier-confirmed high-severity findings only\./,
  );
});

test("renderDoctorReport omits execution-safety warnings when trust posture does not require one", () => {
  const report = renderDoctorReport({
    overallStatus: "pass",
    trustDiagnostics: {
      trustMode: "untrusted_or_mixed",
      executionSafetyMode: "operator_gated",
      warning: null,
    },
    checks: [],
    cadenceDiagnostics: {
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: null,
      mergeCriticalEffectiveSeconds: 120,
      mergeCriticalRecheckEnabled: false,
    },
    candidateDiscoverySummary: "doctor_candidate_discovery fetch_window=100 strategy=paginated",
    candidateDiscoveryWarning: null,
  } as Awaited<ReturnType<typeof diagnoseSupervisorHost>>);

  assert.doesNotMatch(report, /doctor_warning kind=execution_safety/);
});

test("diagnoseSupervisorHost and renderDoctorReport surface paginated candidate discovery", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
      candidateDiscoveryFetchWindow: 250,
    }),
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => ({ activeIssueNumber: null, issues: {} }),
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 250,
        observedMatchingOpenIssues: 251,
        truncated: false,
      }),
    },
  });

  const report = renderDoctorReport(diagnostics);

  assert.match(report, /doctor_candidate_discovery fetch_window=250 strategy=paginated/);
  assert.doesNotMatch(report, /doctor_warning kind=candidate_discovery/);
});

test("diagnoseSupervisorHost uses a strict default state loader for existing invalid JSON", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "github_auth")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "codex_cli")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=state_file detail=state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/,
  );
});

test("loadStateReadonlyForDoctor preserves the persisted JSON quarantine marker", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stateFile = path.join(root, "state.json");
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");

  const store = new StateStore(stateFile, { backend: "json" });
  await store.load();

  const state = await loadStateReadonlyForDoctor(
    createConfig({
      stateFile,
    }),
  );

  assert.equal(state.json_state_quarantine?.marker_file, stateFile);
  assert.match(state.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
  assert.match(state.load_findings?.[0]?.message ?? "", /quarantined corrupt json state/i);
  assert.match(
    state.load_findings?.[0]?.message ?? "",
    new RegExp(state.json_state_quarantine?.quarantined_file?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? ""),
  );
});

test("diagnoseSupervisorHost surfaces captured sqlite corruption findings in doctor output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.sqlite");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const db = new DatabaseSync(stateFile);
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE issues (
      issue_number INTEGER PRIMARY KEY,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("schemaVersion", "1");
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("activeIssueNumber", "");
  db.prepare("INSERT INTO issues(issue_number, record_json, updated_at) VALUES (?, ?, ?)").run(
    102,
    "{not-json}",
    "2026-03-20T00:00:00Z",
  );

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateBackend: "sqlite",
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "warn");
  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=state_file detail=state_load_finding backend=sqlite scope=issue_row issue_number=102 location=sqlite issues row 102 message=/,
  );
});

test("diagnoseSupervisorHost exposes tracked PR mismatches when GitHub is ready but local state is still blocked", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-171");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-171", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run ci:local",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "171": createRecord({
        issue_number: 171,
        state: "blocked",
        branch: "codex/reopen-issue-171",
        workspace,
        pr_number: 271,
        blocked_reason: "manual_review",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  const readyPr = createPullRequest({
    number: 271,
    headRefName: "codex/reopen-issue-171",
    headRefOid: "head-ready-271",
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => readyPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.summary ?? "",
    /tracked PR mismatch/i,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\./,
  );
});

test("diagnoseSupervisorHost skips tracked PR hydration for historical done records", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-171");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-171", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run ci:local",
  });

  const historicalRecords = Object.fromEntries(
    Array.from({ length: 160 }, (_, index) => {
      const issueNumber = 3000 + index;
      return [
        String(issueNumber),
        createRecord({
          issue_number: issueNumber,
          state: "done",
          branch: "codex/reopen-issue-171",
          workspace,
          pr_number: 5000 + index,
          blocked_reason: null,
          last_head_sha: `done-head-${issueNumber}`,
        }),
      ];
    }),
  );

  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      ...historicalRecords,
      "171": createRecord({
        issue_number: 171,
        state: "blocked",
        branch: "codex/reopen-issue-171",
        workspace,
        pr_number: 271,
        blocked_reason: "manual_review",
        last_head_sha: "head-ready-271",
      }),
    },
  };

  const readyPr = createPullRequest({
    number: 271,
    headRefName: "codex/reopen-issue-171",
    headRefOid: "head-ready-271",
  });
  let getPullRequestIfExistsCalls = 0;

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async (prNumber) => {
        getPullRequestIfExistsCalls += 1;
        return prNumber === readyPr.number ? readyPr : null;
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(getPullRequestIfExistsCalls, 1);
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes/,
  );
});

test("diagnoseSupervisorHost exposes stale_review_bot tracked PR mismatches when GitHub is already clear", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-172");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-172", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run ci:local",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "172": createRecord({
        issue_number: 172,
        state: "blocked",
        branch: "codex/reopen-issue-172",
        workspace,
        pr_number: 272,
        blocked_reason: "stale_review_bot",
        last_head_sha: "head-ready-272",
        last_failure_signature: "stalled-bot:thread-1",
      }),
    },
  };
  const readyPr = createPullRequest({
    number: 272,
    headRefName: "codex/reopen-issue-172",
    headRefOid: "head-ready-272",
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => readyPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_mismatch issue=#172 pr=#272 recoverability=stale_already_handled github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=stale_review_bot stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\./,
  );
});

test("diagnoseSupervisorHost preserves draft tracked PR verification blockers instead of suggesting a no-op rerun", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-174");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-174", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run verify:paths",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "174": createRecord({
        issue_number: 174,
        state: "blocked",
        branch: "codex/reopen-issue-174",
        workspace,
        pr_number: 274,
        blocked_reason: "verification",
        last_head_sha: "head-draft-274",
        last_error: "Configured local CI command failed before marking PR #274 ready.",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #274 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-draft-274",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "repo_owned_command",
        },
      }),
    },
  };
  const draftPr = createPullRequest({
    number: 274,
    headRefName: "codex/reopen-issue-174",
    headRefOid: "head-draft-274",
    isDraft: true,
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => draftPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_ready_promotion_blocked issue=#174 pr=#274 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_ready_promotion_gate issue=#174 pr=#274 gate=local_ci summary=Configured local CI command failed before marking PR #274 ready\./,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=PR #274 is still draft because ready-for-review promotion is blocked by local verification\. The same blocker is still present, so rerunning the supervisor alone will not help\. Failed gate: npm run verify:paths\. Fix the gate in the tracked workspace first, then rerun it to promote the PR\./,
  );
  assert.doesNotMatch(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_mismatch /,
  );
});

test("diagnoseSupervisorHost marks old-head ready-promotion blockers as stale", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-175");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-175", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run verify:paths",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "175": createRecord({
        issue_number: 175,
        state: "blocked",
        branch: "codex/reopen-issue-175",
        workspace,
        pr_number: 275,
        blocked_reason: "verification",
        last_head_sha: "head-old-275",
        last_error: "Configured local CI command failed before marking PR #275 ready.",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #275 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-old-275",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "repo_owned_command",
        },
      }),
    },
  };
  const draftPr = createPullRequest({
    number: 275,
    headRefName: "codex/reopen-issue-175",
    headRefOid: "head-new-275",
    isDraft: true,
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => draftPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_ready_promotion_blocked issue=#175 pr=#275 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=PR #275 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\./,
  );
  assert.doesNotMatch(renderDoctorReport(diagnostics), /The same blocker is still present/);
});

test("diagnoseSupervisorHost marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-176");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-176", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run verify:paths",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "176": createRecord({
        issue_number: 176,
        state: "blocked",
        branch: "codex/reopen-issue-176",
        workspace,
        pr_number: 276,
        blocked_reason: "verification",
        last_head_sha: "head-draft-276",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #276 ready.",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-276",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  const draftPr = createPullRequest({
    number: 276,
    headRefName: "codex/reopen-issue-176",
    headRefOid: "head-draft-276",
    isDraft: true,
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => draftPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_ready_promotion_blocked issue=#176 pr=#276 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\./,
  );
  assert.doesNotMatch(renderDoctorReport(diagnostics), /The same blocker is still present/);
});

test("diagnoseSupervisorHost keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-177");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-177", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run verify:paths",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "177": createRecord({
        issue_number: 177,
        state: "blocked",
        branch: "codex/reopen-issue-177",
        workspace,
        pr_number: 277,
        blocked_reason: "verification",
        last_head_sha: "head-draft-277",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready.",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-277",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  const draftPr = createPullRequest({
    number: 277,
    headRefName: "codex/reopen-issue-177",
    headRefOid: "head-draft-277",
    isDraft: true,
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => draftPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "warn");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_ready_promotion_blocked issue=#177 pr=#277 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by local verification\. The same blocker is still present, so rerunning the supervisor alone will not help\./,
  );
  assert.doesNotMatch(
    renderDoctorReport(diagnostics),
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("diagnoseSupervisorHost exposes host-local CI blocker details for tracked PR mismatches", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const workspace = path.join(workspaceRoot, "issue-171");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "codex/reopen-issue-171", workspace], {
    encoding: "utf8",
  });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: process.execPath,
    localCiCommand: "npm run ci:local",
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "171": createRecord({
        issue_number: 171,
        state: "blocked",
        branch: "codex/reopen-issue-171",
        workspace,
        pr_number: 271,
        blocked_reason: "verification",
        last_head_sha: "head-ready-271",
        last_failure_signature: "local-ci-gate-workspace_toolchain_missing",
        latest_local_ci_result: {
          outcome: "failed",
          summary:
            "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-ready-271",
          execution_mode: "legacy_shell_string",
          failure_class: "workspace_toolchain_missing",
          remediation_target: "workspace_environment",
        },
      }),
    },
  };
  const readyPr = createPullRequest({
    number: 271,
    headRefName: "codex/reopen-issue-171",
    headRefOid: "head-ready-271",
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: true, message: null }),
    loadState: async () => trackedState,
    github: {
      getCandidateDiscoveryDiagnostics: async () => ({
        fetchWindow: 100,
        observedMatchingOpenIssues: 1,
        truncated: false,
      }),
      getPullRequestIfExists: async () => readyPr,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
  });

  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_host_local_ci issue=#171 pr=#271 github_checks=green head_sha=head-ready-271 outcome=failed failure_class=workspace_toolchain_missing remediation_target=workspace_environment head=current summary=Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\./,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\./,
  );
});

test("diagnoseSupervisorHost caps rendered sqlite corruption details and summarizes omissions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.sqlite");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const db = new DatabaseSync(stateFile);
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE issues (
      issue_number INTEGER PRIMARY KEY,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("schemaVersion", "1");
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("activeIssueNumber", "");

  for (const issueNumber of [101, 102, 103, 104, 105, 106]) {
    db.prepare("INSERT INTO issues(issue_number, record_json, updated_at) VALUES (?, ?, ?)").run(
      issueNumber,
      "{not-json}",
      "2026-03-20T00:00:00Z",
    );
  }

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateBackend: "sqlite",
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
  });

  const stateFileCheck = diagnostics.checks.find((check) => check.name === "state_file");
  assert.equal(stateFileCheck?.status, "warn");
  assert.equal(stateFileCheck?.details.length, 6);
  assert.match(stateFileCheck?.summary ?? "", /captured 6 corruption finding/i);
  assert.match(
    stateFileCheck?.details[0] ?? "",
    /state_load_finding backend=sqlite scope=issue_row issue_number=101 location=sqlite issues row 101 message=/,
  );
  assert.match(
    stateFileCheck?.details[4] ?? "",
    /state_load_finding backend=sqlite scope=issue_row issue_number=105 location=sqlite issues row 105 message=/,
  );
  assert.equal(stateFileCheck?.details[5], "state_load_finding_omitted count=1");
  assert.ok(
    !(stateFileCheck?.details.some((detail) => detail.includes("issue_number=106")) ?? false),
  );
});

test("loadStateReadonlyForDoctor does not bootstrap a missing sqlite state file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stateFile = path.join(root, "state.sqlite");
  const bootstrapFile = path.join(root, "bootstrap.json");
  await fs.writeFile(
    bootstrapFile,
    `${JSON.stringify({
      activeIssueNumber: 102,
      issues: {
        "102": createRecord(),
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const state = await loadStateReadonlyForDoctor(
    createConfig({
      stateBackend: "sqlite",
      stateFile,
      stateBootstrapFile: bootstrapFile,
    }),
  );

  assert.deepEqual(state, {
    activeIssueNumber: null,
    issues: {},
  });
  await assert.rejects(fs.access(stateFile));
});
