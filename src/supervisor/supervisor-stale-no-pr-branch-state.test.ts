import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../core/command";
import { IssueRunRecord } from "../core/types";
import { createConfig, createRecord } from "./supervisor-test-helpers";
import { Supervisor } from "./supervisor";

type StaleNoPrBranchState = "recoverable" | "already_satisfied_on_main";

async function classifyStaleStabilizingNoPrBranchState(
  supervisor: Supervisor,
  record: Pick<IssueRunRecord, "workspace" | "journal_path">,
): Promise<StaleNoPrBranchState> {
  return (
    supervisor as unknown as {
      classifyStaleStabilizingNoPrBranchState(
        input: Pick<IssueRunRecord, "workspace" | "journal_path">,
      ): Promise<StaleNoPrBranchState>;
    }
  ).classifyStaleStabilizingNoPrBranchState(record);
}

async function createRepositoryWithOrigin(): Promise<{ repoPath: string; rootPath: string }> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-stale-no-pr-"));
  const remotePath = path.join(rootPath, "remote.git");
  const repoPath = path.join(rootPath, "repo");

  await runCommand("git", ["init", "--bare", remotePath]);
  await runCommand("git", ["init", "--initial-branch", "main", repoPath]);
  await runCommand("git", ["-C", repoPath, "config", "user.name", "Codex Test"]);
  await runCommand("git", ["-C", repoPath, "config", "user.email", "codex@example.test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "initial\n");
  await runCommand("git", ["-C", repoPath, "add", "README.md"]);
  await runCommand("git", ["-C", repoPath, "commit", "-m", "initial"]);
  await runCommand("git", ["-C", repoPath, "remote", "add", "origin", remotePath]);
  await runCommand("git", ["-C", repoPath, "push", "-u", "origin", "main"]);

  return { repoPath, rootPath };
}

async function withFakeGitOnPath<T>(scriptBody: string, run: () => Promise<T>): Promise<T> {
  const originalPath = process.env.PATH;
  const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-fake-git-"));
  const gitPath = path.join(binPath, "git");

  await fs.writeFile(gitPath, `#!/usr/bin/env bash\nset -eu\n${scriptBody}\n`);
  await fs.chmod(gitPath, 0o755);
  process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;

  try {
    return await run();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
}

test("classifyStaleStabilizingNoPrBranchState ignores the default journal path when journal_path is null", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: null,
  });

  assert.equal(result, "already_satisfied_on_main");
});

test("classifyStaleStabilizingNoPrBranchState falls back to recoverable when fetch times out", async () => {
  await withFakeGitOnPath(
    `
case " $* " in
  *" fetch "*)
    sleep 2
    ;;
esac
`,
    async () => {
      const supervisor = new Supervisor(
        createConfig({
          repoPath: "/tmp/repo",
          codexExecTimeoutMinutes: 0.001,
        }),
      );
      const startedAt = Date.now();

      const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
        workspace: "/tmp/workspace",
        journal_path: "/tmp/workspace/.codex-supervisor/issue-journal.md",
      });

      assert.equal(result, "recoverable");
      assert.ok(Date.now() - startedAt < 1_000);
    },
  );
});

test("classifyStaleStabilizingNoPrBranchState falls back to recoverable when diff times out", async () => {
  await withFakeGitOnPath(
    `
case " $* " in
  *" diff "*)
    sleep 2
    ;;
esac
`,
    async () => {
      const supervisor = new Supervisor(
        createConfig({
          repoPath: "/tmp/repo",
          codexExecTimeoutMinutes: 0.001,
        }),
      );
      const startedAt = Date.now();

      const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
        workspace: "/tmp/workspace",
        journal_path: "/tmp/workspace/.codex-supervisor/issue-journal.md",
      });

      assert.equal(result, "recoverable");
      assert.ok(Date.now() - startedAt < 1_000);
    },
  );
});

test("classifyStaleStabilizingNoPrBranchState falls back to recoverable when status times out", async () => {
  await withFakeGitOnPath(
    `
case " $* " in
  *" status "*)
    sleep 2
    ;;
esac
`,
    async () => {
      const supervisor = new Supervisor(
        createConfig({
          repoPath: "/tmp/repo",
          codexExecTimeoutMinutes: 0.001,
        }),
      );
      const startedAt = Date.now();

      const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
        workspace: "/tmp/workspace",
        journal_path: "/tmp/workspace/.codex-supervisor/issue-journal.md",
      });

      assert.equal(result, "recoverable");
      assert.ok(Date.now() - startedAt < 1_000);
    },
  );
});

test("classifyStaleStabilizingNoPrBranchState returns recoverable when the branch still differs from origin/main", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  await fs.writeFile(path.join(repoPath, "feature.txt"), "pending\n");

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: path.join(repoPath, ".codex-supervisor", "issue-journal.md"),
  });

  assert.equal(result, "recoverable");
});

test("classifyStaleStabilizingNoPrBranchState ignores supervisor-owned replay artifacts", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const replayArtifactPath = path.join(repoPath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "already_satisfied_on_main");
});

test("classifyStaleStabilizingNoPrBranchState ignores supervisor-owned pre-merge and execution-metrics artifacts", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const preMergeArtifactPath = path.join(repoPath, ".codex-supervisor", "pre-merge", "assessment-snapshot.json");
  const executionMetricsArtifactPath = path.join(
    repoPath,
    ".codex-supervisor",
    "execution-metrics",
    "run-summary.json",
  );
  await fs.mkdir(path.dirname(preMergeArtifactPath), { recursive: true });
  await fs.mkdir(path.dirname(executionMetricsArtifactPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(preMergeArtifactPath, "{\n  \"kind\": \"pre-merge\"\n}\n");
  await fs.writeFile(executionMetricsArtifactPath, "{\n  \"kind\": \"execution-metrics\"\n}\n");

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "already_satisfied_on_main");
});

test("classifyStaleStabilizingNoPrBranchState ignores exact supervisor-owned replay artifact paths in the base diff", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const replayArtifactPath = path.join(repoPath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");

  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");
  await runCommand("git", ["-C", repoPath, "add", journalPath, replayArtifactPath]);
  await runCommand("git", ["-C", repoPath, "commit", "-m", "add replay artifact"]);

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "already_satisfied_on_main");
});

test("classifyStaleStabilizingNoPrBranchState preserves leading whitespace in porcelain paths", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const misleadingReplayLikePath = path.join(
    repoPath,
    " .codex-supervisor",
    "replay",
    "decision-cycle-snapshot.json",
  );
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(misleadingReplayLikePath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(misleadingReplayLikePath, "{\n  \"kind\": \"not-supervisor-owned\"\n}\n");

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "recoverable");
});

test("classifyStaleStabilizingNoPrBranchState preserves leading whitespace in base diff paths", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const misleadingReplayLikePath = path.join(
    repoPath,
    " .codex-supervisor",
    "replay",
    "decision-cycle-snapshot.json",
  );

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(misleadingReplayLikePath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(misleadingReplayLikePath, "{\n  \"kind\": \"not-supervisor-owned\"\n}\n");
  await runCommand("git", ["-C", repoPath, "add", journalPath, misleadingReplayLikePath]);
  await runCommand("git", ["-C", repoPath, "commit", "-m", "add misleading replay-like path"]);

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "recoverable");
});

test("classifyStaleStabilizingNoPrBranchState treats replay-to-code renames as meaningful workspace changes", async () => {
  const { repoPath, rootPath } = await createRepositoryWithOrigin();
  const journalPath = path.join(repoPath, ".codex-supervisor", "issue-journal.md");
  const replayArtifactPath = path.join(repoPath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  const renamedArtifactPath = path.join(repoPath, "src", "generated.ts");

  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");
  await runCommand("git", ["-C", repoPath, "add", replayArtifactPath]);
  await runCommand("git", ["-C", repoPath, "commit", "-m", "track replay artifact"]);
  await runCommand("git", ["-C", repoPath, "push", "origin", "main"]);

  await fs.mkdir(path.dirname(renamedArtifactPath), { recursive: true });
  await runCommand("git", ["-C", repoPath, "mv", replayArtifactPath, renamedArtifactPath]);

  const supervisor = new Supervisor(
    createConfig({
      repoPath,
      workspaceRoot: rootPath,
    }),
  );

  const result = await classifyStaleStabilizingNoPrBranchState(supervisor, {
    workspace: repoPath,
    journal_path: journalPath,
  });

  assert.equal(result, "recoverable");
});
