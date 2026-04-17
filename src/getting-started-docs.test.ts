import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readGettingStarted(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "getting-started.md"), "utf8");
}

async function readJapaneseOverview(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "README.ja.md"), "utf8");
}

async function readJapaneseGettingStarted(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "docs", "getting-started.ja.md"), "utf8");
}

test("getting-started stays focused on operator setup and flow", async () => {
  const content = await readGettingStarted();

  const requiredHeadings = [
    "# Getting Started with codex-supervisor",
    "## Before you start",
    "## Choose the operating mode",
    "## Prepare the supervisor config",
    "## Write execution-ready issues",
    "## Run the first pass",
    "## Move from run-once to loop",
    "## Common operator decisions",
    "## Common mistakes",
    "## Related docs",
  ];

  let lastIndex = -1;
  for (const heading of requiredHeadings) {
    const index = content.indexOf(heading);
    assert.notEqual(index, -1, `expected ${heading} in docs/getting-started.md`);
    assert.ok(index > lastIndex, `expected ${heading} to appear after the previous section`);
    lastIndex = index;
  }

  assert.match(content, /\[README\]\(\.\.\/README\.md\)/);
  assert.match(content, /\[Agent Bootstrap Protocol\]\(\.\/agent-instructions\.md\)/);
  assert.match(content, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(content, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(content, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);
  assert.match(content, /npm run verify:paths/);
  assert.match(content, /lightweight pre-PR path-hygiene check/i);
  assert.match(content, /independent from `build` and `test`/i);
  assert.match(content, /Current fail-closed implementation rule:/i);
  assert.match(content, /provenance, scope, auth context, or trust-boundary signals are missing, malformed, or only partially trusted/i);

  assert.doesNotMatch(content, /^## Full picture$/m);
  assert.doesNotMatch(content, /^## What codex-supervisor does$/m);
  assert.doesNotMatch(content, /^## Best fit$/m);
  assert.doesNotMatch(content, /^## Not a fit$/m);
  assert.doesNotMatch(content, /^## How readiness-driven scheduling works$/m);
  assert.doesNotMatch(content, /^## State machine$/m);
});

test("getting-started explains paginated candidate discovery across the open backlog", async () => {
  const [gettingStarted, japaneseGettingStarted] = await Promise.all([
    readGettingStarted(),
    readJapaneseGettingStarted(),
  ]);

  assert.match(gettingStarted, /pages through matching open issues/i);
  assert.match(gettingStarted, /matching open backlog/i);
  assert.match(gettingStarted, /older runnable issues remain discoverable/i);
  assert.match(japaneseGettingStarted, /backlog 全体を見て/i);
  assert.match(japaneseGettingStarted, /最初の page の外にあるだけで選定対象から見えなくなることはありません/i);
});

test("getting-started defines setup readiness as a typed first-run contract distinct from doctor", async () => {
  const content = await readGettingStarted();

  assert.match(content, /setup\/readiness contract/i);
  assert.match(content, /doctor is not that setup\/readiness contract/i);
  assert.match(content, /kind: "setup_readiness"/);
  assert.match(content, /configured \| missing \| invalid/);
  assert.match(content, /editable setup inputs without inferring from labels/i);
  assert.match(content, /typed remediation guidance/i);
  assert.match(content, /what is configured, what is missing, what is invalid, and what still blocks first-run operation/i);
  assert.match(content, /valueType:\s+SetupReadinessFieldValueType/);
  assert.match(
    content,
    /type SetupReadinessFieldValueType =[\s\S]*"directory_path"[\s\S]*"repo_slug"[\s\S]*"git_ref"[\s\S]*"file_path"[\s\S]*"executable_path"[\s\S]*"text"[\s\S]*"review_provider"/,
  );
  assert.match(content, /kind:\s+SetupReadinessRemediationKind/);
  assert.match(
    content,
    /type SetupReadinessRemediationKind =[\s\S]*"edit_config"[\s\S]*"configure_review_provider"[\s\S]*"authenticate_github"[\s\S]*"verify_codex_cli"[\s\S]*"repair_worktree_layout"/,
  );
  assert.match(
    content,
    /type SetupReadinessFieldKey =[\s\S]*"repoPath"[\s\S]*"repoSlug"[\s\S]*"defaultBranch"[\s\S]*"workspaceRoot"[\s\S]*"stateFile"[\s\S]*"codexBinary"[\s\S]*"branchPrefix"[\s\S]*"localCiCommand"[\s\S]*"reviewProvider"/,
  );
  assert.match(content, /localCiContract\?: LocalCiContractSummary/);
  assert.match(content, /setup flow and WebUI should surface whether the repo-owned local CI contract is configured/i);
});

test("getting-started defines the repo-owned local CI contract for pre-PR verification", async () => {
  const content = await readGettingStarted();

  assert.match(content, /repo-owned local CI contract/i);
  assert.match(content, /ci:local/);
  assert.match(content, /verify:pre-pr/);
  assert.match(content, /the repo remains the source of truth/i);
  assert.match(content, /codex-supervisor only runs the configured entrypoint/i);
  assert.match(content, /exit code 0/i);
  assert.match(content, /any non-zero exit code/i);
  assert.match(content, /Ruff or similar static-analysis checks for `tests\/` or `scripts\/`/i);
  assert.match(content, /inline suppression with the exact rule code and a short rationale/i);
  assert.match(content, /# noqa: S106 - dummy fixture credential/i);
  assert.match(content, /# noqa: S104 - test fixture requires wildcard bind/i);
  assert.match(content, /if no local CI contract is configured/i);
  assert.match(content, /does not infer or reconstruct workflow logic from GitHub Actions YAML/i);
  assert.match(content, /when configured local CI fails, PR publication stays blocked/i);
  assert.match(content, /ready-for-review promotion stays blocked/i);
});

test("operator-facing docs explain steady-state local CI posture and remediation flow", async () => {
  const [gettingStarted, operatorDashboard, configuration] = await Promise.all([
    readGettingStarted(),
    fs.readFile(path.join(process.cwd(), "docs", "operator-dashboard.md"), "utf8"),
    fs.readFile(path.join(process.cwd(), "docs", "configuration.md"), "utf8"),
  ]);

  for (const content of [gettingStarted, operatorDashboard, configuration]) {
    assert.match(content, /No repo-owned local CI contract is configured\./);
    assert.match(
      content,
      /Repo-owned local CI candidate exists but localCiCommand is unset\./,
    );
    assert.match(content, /This warning is advisory only/i);
    assert.match(content, /Repo-owned local CI contract is configured\./);
    assert.match(content, /when configured local CI fails/i);
    assert.match(content, /PR publication stays blocked/i);
  }

  assert.match(gettingStarted, /fix the GitHub issue body/i);
  assert.match(gettingStarted, /fix GitHub auth on the host/i);
  assert.match(gettingStarted, /fix the supervisor config rather than the issue body/i);

  assert.match(operatorDashboard, /Issue details.*fix the issue first/si);
  assert.match(operatorDashboard, /Doctor.*repair host\/config\/state next/si);

  assert.match(configuration, /repo script candidate/i);
  assert.match(configuration, /codex-supervisor will not run it until localCiCommand is configured/i);
  assert.match(configuration, /preserve backward compatibility by not inventing one/i);
});

test("getting-started points operators to doctor for the effective orphan cleanup policy", async () => {
  const content = await readGettingStarted();

  assert.match(content, /doctor_orphan_policy mode=explicit_only/i);
  assert.match(content, /background_prune=false/i);
  assert.match(content, /operator_prune=true/i);
  assert.match(content, /preserved=locked,recent,unsafe_target/i);
});

test("getting-started documents tmux as the supported macOS loop host and keeps Linux and WebUI guidance distinct", async () => {
  const [gettingStarted, japaneseGettingStarted] = await Promise.all([
    readGettingStarted(),
    readJapaneseGettingStarted(),
  ]);

  assert.match(gettingStarted, /On macOS, the supported background loop host is `tmux`\./);
  assert.match(gettingStarted, /`\.\/scripts\/start-loop-tmux\.sh`/);
  assert.match(gettingStarted, /`\.\/scripts\/stop-loop-tmux\.sh`/);
  assert.match(gettingStarted, /`\.\/scripts\/install-launchd\.sh` now fails closed/i);
  assert.match(gettingStarted, /If you want a launcher-managed background loop on Linux, use `\.\/scripts\/install-systemd\.sh`/);
  assert.match(gettingStarted, /For a launcher-managed WebUI on macOS, use `\.\/scripts\/install-launchd-web\.sh`/);

  assert.match(japaneseGettingStarted, /macOS でサポートしている常駐 loop host は `tmux`/);
  assert.match(japaneseGettingStarted, /`\.\/scripts\/start-loop-tmux\.sh`/);
  assert.match(japaneseGettingStarted, /`\.\/scripts\/stop-loop-tmux\.sh`/);
});

test("japanese docs keep overview and getting-started responsibilities separate", async () => {
  const [overview, gettingStarted] = await Promise.all([
    readJapaneseOverview(),
    readJapaneseGettingStarted(),
  ]);

  assert.match(overview, /\[README\.md\]\(\.\.\/README\.md\)/);
  assert.match(overview, /\[docs\/getting-started\.md\]\(\.\/getting-started\.md\)/);
  assert.match(overview, /\[docs\/getting-started\.ja\.md\]\(\.\/getting-started\.ja\.md\)/);

  assert.doesNotMatch(overview, /\/Users\//);
  assert.doesNotMatch(gettingStarted, /\/Users\//);

  assert.doesNotMatch(overview, /^## 初回セットアップの流れ$/m);
  assert.doesNotMatch(overview, /^## Local Review Swarm$/m);
  assert.doesNotMatch(overview, /^## Codex への指示例$/m);
  assert.doesNotMatch(overview, /^## 最初の実行手順$/m);

  assert.match(gettingStarted, /\[README\]\(\.\.\/README\.md\)/);
  assert.match(gettingStarted, /\[README\.ja\]\(\.\/README\.ja\.md\)/);
  assert.match(gettingStarted, /\[Agent Bootstrap Protocol\]\(\.\/agent-instructions\.ja\.md\)/);
  assert.match(gettingStarted, /\[Configuration reference\]\(\.\/configuration\.md\)/);
  assert.match(gettingStarted, /\[Local review reference\]\(\.\/local-review\.md\)/);
  assert.match(gettingStarted, /\[Issue metadata reference\]\(\.\/issue-metadata\.md\)/);
});
