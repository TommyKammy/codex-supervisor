import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DURABLE_MISS_PATTERN_KEYS,
  EXTERNAL_REVIEW_GUARDRAILS_SCHEMA_VERSION,
  formatCommittedGuardrails,
  validateCommittedGuardrails,
  VERIFIER_GUARDRAIL_KEYS,
  VERIFIER_GUARDRAILS_SCHEMA_VERSION,
} from "./committed-guardrails";

test("validateCommittedGuardrails rejects duplicate committed verifier ids and durable fingerprints", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-duplicates-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "retry-state",
          title: "Inspect retry state reuse",
          file: "src/retry.ts",
          line: 15,
          summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
          rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
        },
        {
          id: " retry-state ",
          title: "Duplicate id after normalization",
          file: "src/retry.ts",
          line: 25,
          summary: "This should fail validation.",
          rationale: "Committed ids must stay unique for deterministic auditing.",
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "external-review-guardrails.json"),
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-old.json",
          sourceHeadSha: "oldhead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
        {
          fingerprint: " src/auth.ts|permission ",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Duplicate fingerprint after normalization.",
          rationale: "Committed fingerprints must stay unique for deterministic auditing.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Duplicate verifier guardrail id "retry-state" in .*verifier-guardrails\.json at rules\[1\]\./,
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "retry-state",
          title: "Inspect retry state reuse",
          file: "src/retry.ts",
          line: 15,
          summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
          rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Duplicate durable external review fingerprint "src\/auth\.ts\|permission" in .*external-review-guardrails\.json at patterns\[1\]\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("validateCommittedGuardrails reports verifier failures before external-review failures in a stable order", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-stable-errors-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "duplicate-id",
          title: "First verifier rule",
          file: "src/retry.ts",
          line: 15,
          summary: "First rule.",
          rationale: "Keep ids unique.",
        },
        {
          id: " duplicate-id ",
          title: "Second verifier rule",
          file: "src/retry.ts",
          line: 16,
          summary: "Second rule.",
          rationale: "This should fail first.",
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "external-review-guardrails.json"),
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Keep fingerprints unique.",
          sourceArtifactPath: "external-review-misses-head-old.json",
          sourceHeadSha: "oldhead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
        {
          fingerprint: " src/auth.ts|permission ",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 43,
          summary: "Duplicate fingerprint.",
          rationale: "This should fail second.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Duplicate verifier guardrail id "duplicate-id" in .*verifier-guardrails\.json at rules\[1\]\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("validateCommittedGuardrails accepts schema version 1 and rejects missing or unsupported committed schema versions predictably", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-schema-version-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  const verifierPath = path.join(sharedMemoryDir, "verifier-guardrails.json");
  const externalReviewPath = path.join(sharedMemoryDir, "external-review-guardrails.json");

  await fs.writeFile(
    verifierPath,
    JSON.stringify({
      version: 1,
      rules: [],
    }),
    "utf8",
  );
  await fs.writeFile(
    externalReviewPath,
    JSON.stringify({
      version: 1,
      patterns: [],
    }),
    "utf8",
  );

  await validateCommittedGuardrails(workspaceDir);

  await fs.writeFile(
    verifierPath,
    JSON.stringify({
      rules: [],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: missing schema version; expected version 1\./,
  );

  await fs.writeFile(
    verifierPath,
    JSON.stringify({
      version: "1",
      rules: [],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: schema version must be a positive integer; expected version 1\./,
  );

  await fs.writeFile(
    verifierPath,
    JSON.stringify({
      version: 1,
      rules: [],
    }),
    "utf8",
  );
  await fs.writeFile(
    externalReviewPath,
    JSON.stringify({
      version: 2,
      patterns: [],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: unsupported schema version 2; expected version 1\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("formatCommittedGuardrails rewrites committed guardrails into canonical sorted JSON", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-format-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: " z-rule ",
          title: " Zebra check ",
          file: " src/z.ts ",
          line: 20,
          summary: " Last rule ",
          rationale: " Keep sorted output stable ",
        },
        {
          id: "a-rule",
          title: "Alpha check",
          file: "src/a.ts",
          line: 3,
          summary: "First rule",
          rationale: "Sorted first by file and line.",
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "external-review-guardrails.json"),
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/z.ts|slow-path",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/z.ts",
          line: 20,
          summary: "Slow path skips the invariant.",
          rationale: "Audit the slow path before clearing the finding.",
          sourceArtifactPath: "external-review-misses-head-older.json",
          sourceHeadSha: "olderhead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
        {
          fingerprint: " src/a.ts|auth ",
          reviewerLogin: " copilot-pull-request-reviewer ",
          file: " src/a.ts ",
          line: 5,
          summary: " Auth fallback bypasses the check. ",
          rationale: " Require a direct read of the fallback guard path. ",
          sourceArtifactPath: " external-review-misses-head-newer.json ",
          sourceHeadSha: " newerhead ",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const formatted = await formatCommittedGuardrails(workspaceDir);

  assert.equal(formatted.verifier.updated, true);
  assert.equal(formatted.externalReview.updated, true);
  assert.match(formatted.verifier.contents, /\n$/);
  assert.match(formatted.externalReview.contents, /\n$/);
  assert.deepEqual(JSON.parse(formatted.verifier.contents), {
    version: 1,
    rules: [
      {
        id: "a-rule",
        title: "Alpha check",
        file: "src/a.ts",
        line: 3,
        summary: "First rule",
        rationale: "Sorted first by file and line.",
      },
      {
        id: "z-rule",
        title: "Zebra check",
        file: "src/z.ts",
        line: 20,
        summary: "Last rule",
        rationale: "Keep sorted output stable",
      },
    ],
  });
  assert.deepEqual(JSON.parse(formatted.externalReview.contents), {
    version: 1,
    patterns: [
      {
        fingerprint: "src/a.ts|auth",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/a.ts",
        line: 5,
        summary: "Auth fallback bypasses the check.",
        rationale: "Require a direct read of the fallback guard path.",
        sourceArtifactPath: "external-review-misses-head-newer.json",
        sourceHeadSha: "newerhead",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
      {
        fingerprint: "src/z.ts|slow-path",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/z.ts",
        line: 20,
        summary: "Slow path skips the invariant.",
        rationale: "Audit the slow path before clearing the finding.",
        sourceArtifactPath: "external-review-misses-head-older.json",
        sourceHeadSha: "olderhead",
        lastSeenAt: "2026-03-10T00:00:00Z",
      },
    ],
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("repo shared-memory guardrails include committed journal hygiene guidance", async () => {
  const externalReviewGuardrails = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "docs", "shared-memory", "external-review-guardrails.json"), "utf8"),
  ) as { patterns?: Array<{ fingerprint?: string; file?: string; summary?: string; rationale?: string }> };

  const patterns = externalReviewGuardrails.patterns ?? [];
  const committedJournalPathRule = patterns.find(
    (pattern) =>
      pattern.fingerprint === ".codex-supervisor/issue-journal.md|committed-journals-must-not-embed-workstation-local-absolute-paths",
  );
  assert.ok(committedJournalPathRule, "expected committed journal absolute-path hygiene guidance to exist");
  assert.equal(committedJournalPathRule.file, ".codex-supervisor/issue-journal.md");
  assert.equal(
    committedJournalPathRule.summary,
    "Flag committed journals or similar durable artifacts that embed workstation-local absolute paths from operator home directories instead of repo-relative or redacted references.",
  );
  assert.equal(
    committedJournalPathRule.rationale,
    "Shared memory must stay portable across operators, CI, and future sessions; committed machine-specific paths leak private local context and break reproducibility.",
  );

  const committedJournalConsistencyRule = patterns.find(
    (pattern) =>
      pattern.fingerprint ===
      ".codex-supervisor/issue-journal.md|committed-journal-snapshot-handoff-sections-must-stay-internally-consistent",
  );
  assert.ok(committedJournalConsistencyRule, "expected committed journal consistency guidance to exist");
  assert.equal(committedJournalConsistencyRule.file, ".codex-supervisor/issue-journal.md");
  assert.equal(
    committedJournalConsistencyRule.summary,
    "Flag committed journal states where Supervisor Snapshot, Latest Codex Summary, Active Failure Context, and Current Handoff contradict each other within the same durable handoff.",
  );
  assert.equal(
    committedJournalConsistencyRule.rationale,
    "Future operators and Codex turns depend on one coherent committed journal state; contradictory snapshot, summary, failure, and handoff sections cause the next action to start from false premises.",
  );
});

test("repo shared-memory examples encode authoritative-over-derived state guidance", async () => {
  const decisions = await fs.readFile(path.join(process.cwd(), "docs", "shared-memory", "decisions.example.md"), "utf8");
  const constitution = await fs.readFile(path.join(process.cwd(), "docs", "shared-memory", "constitution.example.md"), "utf8");
  const workflow = await fs.readFile(path.join(process.cwd(), "docs", "shared-memory", "workflow.example.md"), "utf8");

  assert.match(
    decisions,
    /Authoritative lifecycle records beat derived summaries, convenience projections, and operator-facing DTOs when they disagree\./,
  );
  assert.match(
    decisions,
    /Resolve `current`, `latest`, `active`, `terminal`, `open`, and `done` classifications from authoritative lifecycle fields first, then derive summaries from that result\./,
  );
  assert.match(
    decisions,
    /Do not let refresh failures, timeline rows, badges, counters, or detail projections overwrite the authoritative outcome of a successful mutation or lifecycle transition\./,
  );
  assert.match(
    decisions,
    /Multi-read responses such as readiness rollups, detail views, exports, backups, and restore previews should come from one committed snapshot or fail explicitly instead of mixing records from different snapshots\./,
  );
  assert.match(
    decisions,
    /One logical multi-record mutation should commit atomically; never leave partial durable state behind for later sessions to treat as truth\./,
  );
  assert.match(
    decisions,
    /On rejected, forbidden, restore-failure, or other failed mutation paths, prove the durable state stayed clean: no orphan records, no partial writes, and no half-restored state should survive the attempt\./,
  );

  assert.match(
    constitution,
    /When authoritative records and derived status surfaces disagree, repair the derived surface to match the authoritative record instead of teaching the system to trust the projection\./,
  );
  assert.match(
    constitution,
    /Do not hold a database transaction open across network hops, queued jobs, adapter dispatch, or other remote waits; cross the boundary only after commit or rollback\./,
  );
  assert.match(
    constitution,
    /Do not treat a thrown error, rejected mutation, or failed restore as sufficient by itself; verify the failed path leaves no orphan or partial durable state behind\./,
  );

  assert.match(
    workflow,
    /Before shipping a stateful change, check that current\/latest\/active\/terminal selection still comes from the authoritative record rather than a summary DTO, timeline projection, or operator-facing status field\./,
  );
  assert.match(
    workflow,
    /Before shipping aggregation, backup\/restore\/export, or multi-write persistence changes, verify the read path is snapshot-consistent and the write path is atomic across every affected record\./,
  );
  assert.match(
    workflow,
    /Before shipping rejected, forbidden, approval-failure, or restore-failure paths, verify the system proves both outcomes: the path failed and no durable orphan, partial write, or half-restored state remained afterward\./,
  );
});

test("atlaspm example markdown keeps its embedded config aligned with the checked-in example json", async () => {
  const atlaspmMarkdownPath = path.join(process.cwd(), "docs", "examples", "atlaspm.md");
  const atlaspmJsonPath = path.join(process.cwd(), "docs", "examples", "atlaspm.supervisor.config.example.json");
  const atlaspmMarkdown = await fs.readFile(atlaspmMarkdownPath, "utf8");
  const jsonBlockMatch = atlaspmMarkdown.match(/## Example config\n\n```json\n([\s\S]*?)\n```/u);

  assert.ok(jsonBlockMatch, `${path.relative(process.cwd(), atlaspmMarkdownPath)} should include an Example config JSON block`);

  const embeddedConfig = JSON.parse(jsonBlockMatch[1]) as Record<string, unknown>;
  const checkedInConfig = JSON.parse(await fs.readFile(atlaspmJsonPath, "utf8")) as Record<string, unknown>;

  assert.deepEqual(
    embeddedConfig,
    checkedInConfig,
    [
      `${path.relative(process.cwd(), atlaspmMarkdownPath)} and ${path.relative(process.cwd(), atlaspmJsonPath)} must describe the same example config contract.`,
      "Update the markdown JSON block or the checked-in example so operators do not copy a stale sample that is locally valid but cross-file inconsistent.",
    ].join(" "),
  );
});

test("committed guardrail schemas stay aligned with the loader contract", async () => {
  const rootDir = process.cwd();
  const verifierSchemaPath = path.join(rootDir, "docs", "shared-memory", "verifier-guardrails.schema.json");
  const externalReviewSchemaPath = path.join(rootDir, "docs", "shared-memory", "external-review-guardrails.schema.json");
  const verifierSchema = JSON.parse(await fs.readFile(verifierSchemaPath, "utf8")) as {
    properties?: {
      version?: { const?: unknown };
      rules?: { items?: { required?: unknown; properties?: Record<string, unknown>; additionalProperties?: unknown } };
    };
  };
  const externalReviewSchema = JSON.parse(await fs.readFile(externalReviewSchemaPath, "utf8")) as {
    properties?: {
      version?: { const?: unknown };
      patterns?: { items?: { required?: unknown; properties?: Record<string, unknown>; additionalProperties?: unknown } };
    };
  };

  assert.equal(
    verifierSchema.properties?.version?.const,
    VERIFIER_GUARDRAILS_SCHEMA_VERSION,
    `${path.relative(rootDir, verifierSchemaPath)} version const must match src/committed-guardrails.ts`,
  );
  assert.deepEqual(
    verifierSchema.properties?.rules?.items?.required,
    [...VERIFIER_GUARDRAIL_KEYS],
    `${path.relative(rootDir, verifierSchemaPath)} required rule keys must match src/committed-guardrails.ts`,
  );
  assert.deepEqual(
    Object.keys(verifierSchema.properties?.rules?.items?.properties ?? {}),
    [...VERIFIER_GUARDRAIL_KEYS],
    `${path.relative(rootDir, verifierSchemaPath)} rule property keys must match src/committed-guardrails.ts`,
  );
  assert.equal(
    verifierSchema.properties?.rules?.items?.additionalProperties,
    false,
    `${path.relative(rootDir, verifierSchemaPath)} should reject unexpected rule keys for the same contract enforced by src/committed-guardrails.ts`,
  );

  assert.equal(
    externalReviewSchema.properties?.version?.const,
    EXTERNAL_REVIEW_GUARDRAILS_SCHEMA_VERSION,
    `${path.relative(rootDir, externalReviewSchemaPath)} version const must match src/committed-guardrails.ts`,
  );
  assert.deepEqual(
    externalReviewSchema.properties?.patterns?.items?.required,
    [...DURABLE_MISS_PATTERN_KEYS],
    `${path.relative(rootDir, externalReviewSchemaPath)} required pattern keys must match src/committed-guardrails.ts`,
  );
  assert.deepEqual(
    Object.keys(externalReviewSchema.properties?.patterns?.items?.properties ?? {}),
    [...DURABLE_MISS_PATTERN_KEYS],
    `${path.relative(rootDir, externalReviewSchemaPath)} pattern property keys must match src/committed-guardrails.ts`,
  );
  assert.equal(
    externalReviewSchema.properties?.patterns?.items?.additionalProperties,
    false,
    `${path.relative(rootDir, externalReviewSchemaPath)} should reject unexpected pattern keys for the same contract enforced by src/committed-guardrails.ts`,
  );
});
