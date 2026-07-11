import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config";

async function writeConfig(
  t: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      branchPrefix: "codex/issue-",
      ...overrides,
    }),
    "utf8",
  );
  return configPath;
}

test("loadConfig leaves bounded repair and local-review model routing unset by default so current model behavior stays unchanged", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.boundedRepairModelStrategy, undefined);
  assert.equal(config.boundedRepairModel, undefined);
  assert.equal(config.localReviewModelStrategy, undefined);
  assert.equal(config.localReviewModel, undefined);
  assert.equal(config.codexModelRoutingByTarget, undefined);
  assert.equal(config.codexModel, "gpt-5-codex");
});

test("loadConfig accepts explicit bounded repair model routing overrides", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      boundedRepairModelStrategy: "alias",
      boundedRepairModel: "gpt-5.4-mini",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.boundedRepairModelStrategy, "alias");
  assert.equal(config.boundedRepairModel, "gpt-5.4-mini");
});

test("loadConfig accepts explicit generic local-review model routing overrides", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-config-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const configPath = path.join(tempDir, "supervisor.config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      codexModelStrategy: "fixed",
      codexModel: "gpt-5-codex",
      localReviewModelStrategy: "alias",
      localReviewModel: "local-review-fast",
      branchPrefix: "codex/issue-",
    }),
    "utf8",
  );

  const config = loadConfig(configPath);

  assert.equal(config.localReviewModelStrategy, "alias");
  assert.equal(config.localReviewModel, "local-review-fast");
  assert.equal(config.codexModelRoutingByTarget, undefined);
});

test("loadConfig accepts and trims explicit routes for every Codex execution target", async (t) => {
  const configPath = await writeConfig(t, {
    codexModelRoutingByTarget: {
      supervisor: { strategy: "fixed", model: "  gpt-5.6-sol  " },
      local_review_generic: { strategy: "alias", model: "  review-fast  " },
      local_review_specialist: { strategy: "fixed", model: "  gpt-5.6-terra  " },
      local_review_verifier: { strategy: "inherit" },
    },
  });

  const config = loadConfig(configPath);

  assert.deepEqual(config.codexModelRoutingByTarget, {
    supervisor: { strategy: "fixed", model: "gpt-5.6-sol" },
    local_review_generic: { strategy: "alias", model: "review-fast" },
    local_review_specialist: { strategy: "fixed", model: "gpt-5.6-terra" },
    local_review_verifier: { strategy: "inherit" },
  });
});

test("loadConfig preserves empty and partial per-target routing maps", async (t) => {
  const emptyConfigPath = await writeConfig(t, {
    codexModelRoutingByTarget: {},
  });
  const partialConfigPath = await writeConfig(t, {
    codexModelRoutingByTarget: {
      local_review_specialist: { strategy: "alias", model: "specialist-fast" },
    },
  });

  assert.deepEqual(loadConfig(emptyConfigPath).codexModelRoutingByTarget, {});
  assert.deepEqual(loadConfig(partialConfigPath).codexModelRoutingByTarget, {
    local_review_specialist: { strategy: "alias", model: "specialist-fast" },
  });
});

test("loadConfig rejects non-object per-target routing values", async (t) => {
  for (const value of [null, [], "local_review_generic"] as const) {
    await t.test(`value=${JSON.stringify(value)}`, async (child) => {
      const configPath = await writeConfig(child, {
        codexModelRoutingByTarget: value,
      });

      assert.throws(
        () => loadConfig(configPath),
        /Invalid config field: codexModelRoutingByTarget \(expected an object keyed by execution target\)/,
      );
    });
  }
});

test("loadConfig rejects unsupported per-target routing targets", async (t) => {
  const configPath = await writeConfig(t, {
    codexModelRoutingByTarget: {
      local_review_unknown: { strategy: "inherit" },
    },
  });

  assert.throws(
    () => loadConfig(configPath),
    /Invalid config field: codexModelRoutingByTarget \(unsupported target: local_review_unknown\)/,
  );
});

test("loadConfig rejects unsupported per-target routing strategies", async (t) => {
  const configPath = await writeConfig(t, {
    codexModelRoutingByTarget: {
      local_review_generic: { strategy: "automatic", model: "review-fast" },
    },
  });

  assert.throws(
    () => loadConfig(configPath),
    /Invalid config field: codexModelRoutingByTarget \(unsupported strategy for local_review_generic: automatic\)/,
  );
});

test("loadConfig rejects fixed and alias routes without a model", async (t) => {
  for (const strategy of ["fixed", "alias"] as const) {
    await t.test(strategy, async (child) => {
      const configPath = await writeConfig(child, {
        codexModelRoutingByTarget: {
          local_review_specialist: { strategy, model: "   " },
        },
      });

      assert.throws(
        () => loadConfig(configPath),
        new RegExp(`Invalid config field: codexModelRoutingByTarget \\(model is required for local_review_specialist strategy=${strategy}\\)`),
      );
    });
  }
});

test("loadConfig rejects an inherit route that also sets a model", async (t) => {
  const configPath = await writeConfig(t, {
    codexModelRoutingByTarget: {
      local_review_verifier: { strategy: "inherit", model: "gpt-5.6-sol" },
    },
  });

  assert.throws(
    () => loadConfig(configPath),
    /Invalid config field: codexModelRoutingByTarget \(inherit route for local_review_verifier must not set model\)/,
  );
});
