import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SupervisorConfig } from "../core/types";
import { createIssueLintDto, type SupervisorIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";
import type { SupervisorService } from "../supervisor/supervisor-service";
import { diagnoseSetupReadiness, renderFirstRunDoctorSummary } from "../setup-readiness";
import { runCli } from "./entrypoint";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function fillSampleIssueBody(body: string): string {
  return body
    .replace("<one short paragraph describing the intended outcome>", "Add a first-run smoke check.")
    .replace("<in-scope behavior delta>", "prove init, sample issue generation, and issue-lint stay connected")
    .replace("<observable completion check>", "the generated sample issue passes issue-lint")
    .replace(
      "<exact command, test file, or manual check>",
      "`node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>`",
    );
}

function createIssueLintOnlyService(dto: SupervisorIssueLintDto): SupervisorService {
  const unsupported = async (): Promise<never> => {
    throw new Error("unexpected supervisor service call");
  };

  return {
    config: {} as SupervisorConfig,
    pollIntervalMs: async () => 0,
    runOnce: unsupported,
    queryStatus: unsupported,
    runRecoveryAction: unsupported,
    pruneOrphanedWorkspaces: unsupported,
    resetCorruptJsonState: unsupported,
    queryExplain: unsupported,
    queryIssueLint: async () => dto,
    queryDoctor: unsupported,
  };
}

test("first-run temp repo golden path connects init, sample issue, issue-lint, and first-run guidance", { concurrency: false }, async (t) => {
  const originalCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-first-run-"));
  t.after(async () => {
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "managed-repo");
  await fs.mkdir(repoPath, { recursive: true });
  git(repoPath, "init", "--initial-branch", "main");
  git(repoPath, "remote", "add", "origin", "git@github.com:example/first-run.git");
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify(
      {
        private: true,
        scripts: {
          "verify:pre-pr": "npm test",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}\n", "utf8");
  process.chdir(repoPath);

  const configPath = path.join(root, "supervisor.config.json");
  const initPreview: string[] = [];
  await runCli(["init", "--config", configPath, "--dry-run"], {
    assertRuntimeFreshness: async () => {},
    writeStdout: (line) => initPreview.push(line),
  });

  assert.match(initPreview.join("\n"), /^codex_supervisor_init mode=preview writes_config=false/m);
  assert.match(initPreview.join("\n"), /^repo_identity repo_slug=example\/first-run default_branch=main$/m);
  assert.match(initPreview.join("\n"), /^workspace_preparation_candidate command=npm ci$/m);
  assert.match(initPreview.join("\n"), /^local_ci_candidate command=npm run verify:pre-pr$/m);
  assert.match(initPreview.join("\n"), /^sample_issue_preview_command=node dist\/index\.js sample-issue$/m);
  assert.match(initPreview.join("\n"), /^next_command=node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>$/m);

  await runCli(["init", "--config", configPath], {
    assertRuntimeFreshness: async () => {},
    writeStdout: () => {},
  });
  const writtenConfig = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  assert.equal(writtenConfig.repoPath, ".");
  assert.equal(writtenConfig.repoSlug, "example/first-run");
  assert.equal(writtenConfig.trustMode, "untrusted_or_mixed");
  assert.equal(writtenConfig.executionSafetyMode, "operator_gated");
  assert.deepEqual(writtenConfig.reviewBotLogins, []);

  const sampleIssuePath = path.join(root, "SAMPLE_ISSUE.md");
  await runCli(["sample-issue", "--output", sampleIssuePath], {
    assertRuntimeFreshness: async () => {},
    writeStdout: () => {},
  });
  const sampleBody = await fs.readFile(sampleIssuePath, "utf8");
  const issueBody = fillSampleIssueBody(sampleBody);
  assert.match(issueBody, /^Depends on: none$/m);
  assert.match(issueBody, /^Parallelizable: No$/m);
  assert.match(issueBody, /^## Execution order\n1 of 1$/m);
  assert.doesNotMatch(issueBody, /Part of:/u);

  const issueLintDto = createIssueLintDto({
    number: 42,
    title: "First runnable issue",
    body: issueBody,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    url: "https://example.test/issues/42",
    labels: [{ name: "codex" }],
    state: "OPEN",
  });
  const issueLintOutput: string[] = [];
  await runCli(["issue-lint", "42", "--config", configPath], {
    assertRuntimeFreshness: async () => {},
    createSupervisorService: () => createIssueLintOnlyService(issueLintDto),
    writeStdout: (line) => issueLintOutput.push(line),
  });

  assert.match(issueLintOutput.join("\n"), /^issue=#42$/m);
  assert.match(issueLintOutput.join("\n"), /^execution_ready=yes$/m);
  assert.match(issueLintOutput.join("\n"), /^metadata_errors=none$/m);

  const firstRunReport = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });
  const firstRunSummary = renderFirstRunDoctorSummary(firstRunReport);
  assert.match(firstRunSummary, /^first_run_config_placeholders status=clear count=0 summary=none$/m);
  assert.match(firstRunSummary, /^first_run_trust_posture status=clear /m);
  assert.match(firstRunSummary, /^first_run_next_action action=fix_config source=missing_review_provider required=true /m);
  assert.match(firstRunSummary, /^first_run_next_command command=node dist\/index\.js init --config <supervisor-config-path>$/m);
  assert.doesNotMatch(firstRunSummary, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
});
