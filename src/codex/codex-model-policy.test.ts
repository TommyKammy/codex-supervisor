import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCodexModelPolicySnapshot,
  renderDoctorCodexModelPolicyLines,
  resolveHostCodexDefaultModel,
} from "./codex-model-policy";
import { createConfig } from "../turn-execution-test-helpers";

test("resolveHostCodexDefaultModel ignores untrusted workspace config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-untrusted-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-sol"\n');
  await fs.writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.4"\n');

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.4",
    source: path.join(codexHome, "config.toml"),
  });
});

test("resolveHostCodexDefaultModel loads workspace config only for an explicitly trusted project", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-trusted-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-terra"\n');
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    `model = "gpt-5.4"\n\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.6-terra",
    source: path.join(workspace, ".codex", "config.toml"),
  });
});

test("resolveHostCodexDefaultModel decodes TOML escapes in trusted project keys", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-escaped-trust-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, String.raw`workspace\with\backslashes`);
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(workspace, ".codex", "config.toml"), 'model = "gpt-5.6-terra"\n');
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    `model = "gpt-5.4"\n\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );

  assert.deepEqual(await resolveHostCodexDefaultModel(workspace), {
    model: "gpt-5.6-terra",
    source: path.join(workspace, ".codex", "config.toml"),
  });
});

test("buildCodexModelPolicySnapshot preserves ultra provenance across supported, unsupported, and nested routes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-ultra-"));
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = path.join(root, "codex-home");
  await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

  async function writeCatalogBinary(name: string, models: unknown[]): Promise<string> {
    const binary = path.join(root, name);
    await fs.writeFile(
      binary,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ models }))});\n`,
      { mode: 0o755 },
    );
    return binary;
  }

  const solBinary = await writeCatalogBinary("sol-catalog", [
    { slug: "gpt-5.6-sol", supported_reasoning_levels: ["max", "ultra"] },
  ]);
  const lunaBinary = await writeCatalogBinary("luna-catalog", [
    { slug: "gpt-5.6-luna", supported_reasoning_levels: ["xhigh", "max"] },
  ]);

  const supported = await buildCodexModelPolicySnapshot({
    config: createConfig({
      codexBinary: solBinary,
      codexModelStrategy: "fixed",
      codexModel: "gpt-5.6-sol",
      codexReasoningEffortByState: { implementing: "ultra" },
    }),
    activeState: "implementing",
    activeRecord: null,
  });
  assert.deepEqual(
    {
      target: supported.activeRoute.target,
      requested: supported.activeRoute.requestedReasoningEffort,
      effective: supported.activeRoute.reasoningEffort,
      reason: supported.activeRoute.reasoningEffortFallbackReason,
    },
    { target: "supervisor", requested: "ultra", effective: "ultra", reason: null },
  );

  const unsupported = await buildCodexModelPolicySnapshot({
    config: createConfig({
      codexBinary: lunaBinary,
      codexModelStrategy: "fixed",
      codexModel: "gpt-5.6-luna",
      codexReasoningEffortByState: { implementing: "ultra" },
    }),
    activeState: "implementing",
    activeRecord: null,
  });
  assert.deepEqual(
    {
      target: unsupported.activeRoute.target,
      requested: unsupported.activeRoute.requestedReasoningEffort,
      effective: unsupported.activeRoute.reasoningEffort,
      reason: unsupported.activeRoute.reasoningEffortFallbackReason,
    },
    {
      target: "supervisor",
      requested: "ultra",
      effective: "max",
      reason: "unsupported_reasoning_effort",
    },
  );
  assert.match(
    renderDoctorCodexModelPolicyLines(unsupported).join("\n"),
    /requested=ultra effective=max reasoning_fallback_reason=unsupported_reasoning_effort capability_source=live_catalog fallback_reason=none/,
  );

  const nested = await buildCodexModelPolicySnapshot({
    config: createConfig({
      codexBinary: solBinary,
      codexModelStrategy: "fixed",
      codexModel: "gpt-5.6-sol",
      localReviewModelStrategy: "inherit",
      codexReasoningEffortByState: { local_review: "ultra" },
    }),
    activeState: "local_review",
    activeRecord: null,
  });
  assert.deepEqual(
    {
      target: nested.activeRoute.target,
      requested: nested.activeRoute.requestedReasoningEffort,
      effective: nested.activeRoute.reasoningEffort,
      reason: nested.activeRoute.reasoningEffortFallbackReason,
    },
    {
      target: "local_review_generic",
      requested: "ultra",
      effective: "max",
      reason: "nested_delegation_blocked",
    },
  );
});

test("buildCodexModelPolicySnapshot reports requested and effective routes for every execution target", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-policy-targets-"));
  const codexHome = path.join(root, "codex-home");
  const codexBinary = path.join(root, "catalog.js");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.CODEX_HOME = codexHome;
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(
    codexBinary,
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({models:[\n` +
      `{slug:"gpt-5.6-sol",supported_reasoning_levels:["high","max"]},\n` +
      `{slug:"gpt-5.6-terra",supported_reasoning_levels:["high","max"]},\n` +
      `{slug:"gpt-5.6-luna",supported_reasoning_levels:["high","max"]}\n` +
      `]}));\n`,
    { mode: 0o755 },
  );

  const snapshot = await buildCodexModelPolicySnapshot({
    config: createConfig({
      codexBinary,
      codexModelStrategy: "fixed",
      codexModel: "legacy-supervisor",
      localReviewModelStrategy: "alias",
      localReviewModel: "legacy-generic",
      codexModelRoutingByTarget: {
        supervisor: { strategy: "fixed", model: "gpt-5.6-sol" },
        local_review_generic: { strategy: "alias", model: "gpt-5.6-luna" },
        local_review_specialist: { strategy: "fixed", model: "gpt-5.6-terra" },
        local_review_verifier: { strategy: "inherit" },
      },
      codexReasoningEffortByState: { local_review: "max" },
    }),
    activeState: "local_review",
    activeRecord: null,
  });

  assert.deepEqual(snapshot.targetRoutes, {
    supervisor: {
      strategy: "fixed",
      configuredModel: "gpt-5.6-sol",
      effectiveModel: "gpt-5.6-sol",
      source: "per_target_override",
      fallbackSource: null,
      requestedReasoningEffort: "high",
      reasoningEffort: "high",
      reasoningEffortFallbackReason: null,
      capabilitySource: "live_catalog",
      capabilityFallbackReason: null,
    },
    local_review_generic: {
      strategy: "alias",
      configuredModel: "gpt-5.6-luna",
      effectiveModel: "gpt-5.6-luna",
      source: "per_target_override",
      fallbackSource: null,
      requestedReasoningEffort: "max",
      reasoningEffort: "max",
      reasoningEffortFallbackReason: null,
      capabilitySource: "live_catalog",
      capabilityFallbackReason: null,
    },
    local_review_specialist: {
      strategy: "fixed",
      configuredModel: "gpt-5.6-terra",
      effectiveModel: "gpt-5.6-terra",
      source: "per_target_override",
      fallbackSource: null,
      requestedReasoningEffort: "max",
      reasoningEffort: "max",
      reasoningEffortFallbackReason: null,
      capabilitySource: "live_catalog",
      capabilityFallbackReason: null,
    },
    local_review_verifier: {
      strategy: "inherit",
      configuredModel: null,
      effectiveModel: "gpt-5.6-sol",
      source: "per_target_override",
      fallbackSource: "per_target_override",
      requestedReasoningEffort: "max",
      reasoningEffort: "max",
      reasoningEffortFallbackReason: null,
      capabilitySource: "live_catalog",
      capabilityFallbackReason: null,
    },
  });

  const doctorLines = renderDoctorCodexModelPolicyLines(snapshot);
  assert.match(
    doctorLines.join("\n"),
    /doctor_codex_target_route target=local_review_generic strategy=alias requested_model=gpt-5\.6-luna effective_model=gpt-5\.6-luna route_source=per_target_override fallback_source=none requested_reasoning=max effective_reasoning=max reasoning_fallback_reason=none capability_source=live_catalog fallback_reason=none/,
  );
  assert.match(
    doctorLines.join("\n"),
    /doctor_codex_target_route target=local_review_verifier strategy=inherit requested_model=inherit effective_model=gpt-5\.6-sol route_source=per_target_override fallback_source=per_target_override/,
  );
});
