import test from "node:test";
import assert from "node:assert/strict";
import type { CommandOptions } from "../core/command";
import { GitHubTransport, isTransientGitHubCommandFailure } from "./github-transport";

test("isTransientGitHubCommandFailure matches connection reset GraphQL failures", () => {
  assert.equal(
    isTransientGitHubCommandFailure(
      'Command failed: gh pr list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
    ),
    true,
  );
  assert.equal(
    isTransientGitHubCommandFailure("Command failed: gh pr create --repo owner/repo\nexitCode=1\npull request create failed: No commits between main and branch"),
    false,
  );
});

test("GitHubTransport retries transient gh failures and succeeds on a later attempt", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  let delayCalls = 0;
  const transport = new GitHubTransport(
    async (command, args) => {
      calls.push({ command, args });
      if (calls.length < 3) {
        throw new Error(
          'Command failed: gh pr list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
        );
      }

      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
    async () => {
      delayCalls += 1;
    },
  );

  const result = await transport.run(["pr", "list", "--repo", "owner/repo"]);

  assert.equal(result.stdout, "ok");
  assert.equal(calls.length, 3);
  assert.equal(delayCalls, 2);
});

test("GitHubTransport retries timeout-shaped gh failures and succeeds on a later attempt", async () => {
  let calls = 0;
  let delayCalls = 0;
  const transport = new GitHubTransport(
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Command timed out: gh pr +2 args\nexitCode=1\nCommand timed out after 60000ms: gh pr +2 args");
      }

      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
    async () => {
      delayCalls += 1;
    },
  );

  const result = await transport.run(["pr", "list", "--repo", "owner/repo"]);

  assert.equal(result.stdout, "ok");
  assert.equal(calls, 2);
  assert.equal(delayCalls, 1);
});

test("GitHubTransport retry warnings redact raw gh arguments", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };

  try {
    let calls = 0;
    const transport = new GitHubTransport(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error(
            'Command failed: gh api graphql -f query=query { viewer { login secretField } }\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
          );
        }

        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
        };
      },
      async () => undefined,
    );

    await transport.run(["api", "graphql", "-f", "query=query { viewer { login secretField } }"]);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Transient GitHub CLI failure for gh api graphql/);
    assert.match(warnings[0] ?? "", /\+\d+ arg/);
    assert.doesNotMatch(warnings[0] ?? "", /secretField/);
    assert.doesNotMatch(warnings[0] ?? "", /query=query/);
  } finally {
    console.warn = originalWarn;
  }
});

test("GitHubTransport terminal transient failure redacts raw gh arguments", async () => {
  const transport = new GitHubTransport(
    async () => {
      throw new Error(
        'Command failed: gh api graphql -f query=query { viewer { login secretField } }\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      );
    },
    async () => undefined,
  );

  await assert.rejects(
    () => transport.run(["api", "graphql", "-f", "query=query { viewer { login secretField } }"]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Transient GitHub CLI failure after 3 attempts: gh api graphql/);
      assert.match(error.message, /\+\d+ arg/);
      assert.doesNotMatch(error.message, /secretField/);
      assert.doesNotMatch(error.message, /query=query/);
      return true;
    },
  );
});

test("GitHubTransport terminal timeout-shaped failure stays concise and deterministic", async () => {
  const transport = new GitHubTransport(
    async () => {
      throw new Error(
        "Command timed out: gh api graphql +2 args\nexitCode=1\nCommand timed out after 60000ms: gh api graphql +2 args",
      );
    },
    async () => undefined,
  );

  await assert.rejects(
    () => transport.run(["api", "graphql", "-f", "query=query { viewer { login secretField } }"]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Transient GitHub CLI failure after 3 attempts: gh api graphql/);
      assert.match(error.message, /Command timed out: gh api graphql \+\d+ arg/);
      assert.doesNotMatch(error.message, /secretField/);
      assert.doesNotMatch(error.message, /query=query/);
      return true;
    },
  );
});

test("GitHubTransport does not retry non-transient gh failures", async () => {
  let calls = 0;
  const transport = new GitHubTransport(
    async () => {
      calls += 1;
      throw new Error(
        "Command failed: gh pr create --repo owner/repo\nexitCode=1\npull request create failed: No commits between main and codex/issue-105",
      );
    },
    async () => undefined,
  );

  await assert.rejects(
    () => transport.run(["pr", "create", "--repo", "owner/repo"]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /No commits between main and codex\/issue-105/);
      assert.equal(calls, 1);
      return true;
    },
  );
});

test("GitHubTransport applies a default timeout when callers omit one", async () => {
  const seenOptions: CommandOptions[] = [];
  const transport = new GitHubTransport(async (_command, _args, options) => {
    seenOptions.push({ ...options });
    return {
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    };
  });

  await transport.run(["pr", "list", "--repo", "owner/repo"]);

  assert.equal(seenOptions.length, 1);
  assert.equal(seenOptions[0]?.timeoutMs, 60_000);
});

test("GitHubTransport preserves explicit caller timeout overrides", async () => {
  const seenOptions: CommandOptions[] = [];
  const transport = new GitHubTransport(async (_command, _args, options) => {
    seenOptions.push({ ...options });
    return {
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    };
  });

  await transport.run(["pr", "list", "--repo", "owner/repo"], { timeoutMs: 5_000, allowExitCodes: [0, 1] });

  assert.equal(seenOptions.length, 1);
  assert.equal(seenOptions[0]?.timeoutMs, 5_000);
  assert.deepEqual(seenOptions[0]?.allowExitCodes, [0, 1]);
});
