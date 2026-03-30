import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { StateStore } from "./core/state-store";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";
import { diagnoseBootstrapReadiness, diagnoseSupervisorHost, loadStateReadonlyForDoctor, renderDoctorReport } from "./doctor";
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
    /doctor_warning kind=execution_safety detail=Unsandboxed autonomous execution assumes trusted GitHub-authored inputs\./,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_warning kind=config detail=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
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
      ["reviewProvider", "missing", "config", true, "review_provider"],
    ],
  );
  assert.deepEqual(summary.blockers, [
    {
      code: "missing_review_provider",
      message: "Configure at least one review provider before first-run setup is complete.",
      fieldKeys: ["reviewProvider"],
      remediation: {
        kind: "configure_review_provider",
        summary: "Configure at least one review provider before first-run setup is complete.",
        fieldKeys: ["reviewProvider"],
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
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    configWarning: null,
    summary: "Trusted inputs with unsandboxed autonomous execution.",
  });
  assert.deepEqual(summary.localCiContract, {
    configured: false,
    command: null,
    recommendedCommand: null,
    source: "config",
    summary: "No repo-owned local CI contract is configured.",
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
  });
  assert.equal(summary.ready, true);
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
  assert.match(report, /doctor_local_ci configured=true source=config command=npm run ci:local summary=Repo-owned local CI contract is configured\./);
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
    /doctor_detail name=worktrees detail=tracked_pr_mismatch issue=#171 pr=#271 github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes/,
  );
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=worktrees detail=recovery_guidance=Tracked PR facts are fresher than local state; run the supervisor again to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\./,
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
