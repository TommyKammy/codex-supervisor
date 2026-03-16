import test from "node:test";
import assert from "node:assert/strict";
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
