import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import {
  DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
  issueJournalPath,
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  resolveIssueJournalRelativePath,
  syncIssueJournal,
  trackedIssueJournalPath,
  trackedIssueJournalRelativePath,
} from "./core/journal";
import { GitHubIssue, IssueRunRecord } from "./core/types";
import { buildReviewFailureContext } from "./review-thread-reporting";

const issue: GitHubIssue = {
  number: 177,
  title: "Structured handoff: define a clearer issue journal schema",
  body: "Issue body",
  createdAt: "2026-03-14T00:00:00Z",
  updatedAt: "2026-03-14T00:00:00Z",
  url: "https://example.test/issues/177",
};

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 177,
    state: "reproducing",
    branch: "codex/issue-177",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-177",
    journal_path: "/tmp/workspaces/issue-177/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 1,
    implementation_attempt_count: 1,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "deadbeef",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-14T00:00:00Z",
    ...overrides,
  };
}

function extractLatestCodexSummary(content: string): string {
  const match = content.match(/## Latest Codex Summary\n([\s\S]*?)\n\n## Active Failure Context/);
  assert.ok(match, "expected latest Codex summary section");
  return match[1];
}

test("issueJournalPath throws when an issueNumber template is left unresolved", () => {
  assert.throws(
    () => issueJournalPath("/tmp/workspaces/issue-177", ".codex-supervisor/issues/{issueNumber}/issue-journal.md"),
    /issueJournalRelativePath requires issueNumber when using \{issueNumber\}/,
  );
});

test("issueJournalPath resolves the canonical issue-scoped journal template when issueNumber is provided", () => {
  assert.equal(
    issueJournalPath("/tmp/workspaces/issue-177", ".codex-supervisor/issues/{issueNumber}/issue-journal.md", 177),
    "/tmp/workspaces/issue-177/.codex-supervisor/issues/177/issue-journal.md",
  );
});

test("issueJournalPath keeps non-tokenized custom journal paths working without issueNumber", () => {
  assert.equal(
    issueJournalPath("/tmp/workspaces/issue-177", ".codex-supervisor/custom-journal.md"),
    "/tmp/workspaces/issue-177/.codex-supervisor/custom-journal.md",
  );
});

test("syncIssueJournal writes the structured handoff schema for new journals", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-schema-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /## Codex Working Notes/);
  assert.match(content, /- What changed:/);
  assert.match(content, /- Current blocker:/);
  assert.match(content, /- Next exact step:/);
  assert.match(content, /- Verification gap:/);
  assert.match(content, /- Files touched:/);
  assert.match(content, /- Rollback concern:/);
});

test("syncIssueJournal writes workspace metadata as workspace-relative paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-relative-paths-"));
  const journalPath = issueJournalPath(tempDir, DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH, issue.number);

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /- Workspace: \./);
  assert.match(content, /- Journal: \.codex-supervisor\/issues\/177\/issue-journal\.md/);
  assert.doesNotMatch(content, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("resolveIssueJournalRelativePath scopes the default journal path by issue number", () => {
  assert.equal(
    resolveIssueJournalRelativePath(DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH, 177),
    ".codex-supervisor/issues/177/issue-journal.md",
  );
});

test("trackedIssueJournal helpers canonicalize the legacy shared path but preserve custom paths", () => {
  assert.equal(
    trackedIssueJournalRelativePath(
      "/tmp/workspaces/issue-177",
      "/tmp/workspaces/issue-177/.codex-supervisor/issue-journal.md",
      DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
      177,
    ),
    ".codex-supervisor/issues/177/issue-journal.md",
  );
  assert.equal(
    trackedIssueJournalRelativePath(
      "/tmp/workspaces/issue-177",
      "/tmp/workspaces/issue-177/.codex-supervisor/custom-journal.md",
      DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
      177,
    ),
    ".codex-supervisor/custom-journal.md",
  );
  assert.equal(
    trackedIssueJournalPath(
      "/tmp/workspaces/issue-177",
      LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
      DEFAULT_ISSUE_JOURNAL_RELATIVE_PATH,
      177,
    ),
    "/tmp/workspaces/issue-177/.codex-supervisor/issues/177/issue-journal.md",
  );
});

test("syncIssueJournal normalizes absolute local paths before writing durable content", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-path-normalization-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");
  const repoFilePath = path.join(tempDir, "src", "journal.ts");
  const hostOnlyPath = ["", "home", "alice", ".config", "codex", "history.log"].join("/");

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- What changed: Investigated ${repoFilePath} and ${hostOnlyPath}.

### Scratchpad
- Notes mention ${repoFilePath}.
- Machine-local note: ${hostOnlyPath}
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      last_codex_summary: `Summary: Reproduced in ${repoFilePath} with extra context from ${hostOnlyPath}`,
      last_failure_context: {
        category: "manual",
        summary: `Path leak persisted through ${repoFilePath}`,
        signature: "journal-path-leak",
        command: `cat ${repoFilePath} ${hostOnlyPath}`,
        url: "https://example.test/issues/177",
        details: [
          `Repo file: ${repoFilePath}`,
          `Host file: ${hostOnlyPath}`,
        ],
        updated_at: "2026-03-14T00:00:00Z",
      },
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.doesNotMatch(content, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(content, new RegExp(hostOnlyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(content, /src\/journal\.ts/);
  assert.match(content, /<redacted-local-path>/);
});

test("syncIssueJournal normalizes inline absolute path substrings and quoted spaced paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-inline-paths-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");
  const repoFilePath = path.join(tempDir, "docs", "Alice Smith", "guide.md");
  const hostOnlyPath = ["", "Users", "Alice Smith", "log.txt"].join("/");

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- What changed: Captured path=${repoFilePath} and [guide](${repoFilePath}).

### Scratchpad
- Quoted host path: "${hostOnlyPath}".
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      last_codex_summary: `Summary: path=${repoFilePath} [guide](${repoFilePath}) "${hostOnlyPath}"`,
      last_failure_context: {
        category: "manual",
        summary: `Inline path path=${repoFilePath}`,
        signature: "journal-inline-paths",
        command: `cat path=${repoFilePath}`,
        url: "https://example.test/issues/177",
        details: [
          `[guide](${repoFilePath})`,
          `"${hostOnlyPath}"`,
        ],
        updated_at: "2026-03-14T00:00:00Z",
      },
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.doesNotMatch(content, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(content, new RegExp(hostOnlyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(content, /path=docs\/Alice Smith\/guide\.md/);
  assert.match(content, /\[guide\]\(docs\/Alice Smith\/guide\.md\)/);
  assert.match(content, /"<redacted-local-path>"/);
});

test("syncIssueJournal redacts broader non-portable absolute path roots", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-nonportable-roots-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");
  const nonPortablePaths = [
    ["", "tmp", "codex", "run.log"].join("/"),
    ["", "private", "var", "folders", "aa", "bb", "cache.txt"].join("/"),
    ["", "mnt", "c", "Users", "Alice", "report.txt"].join("/"),
    "C:/Codex/log.txt",
  ];

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- What changed: Checked ${nonPortablePaths.join(" and ")}.

### Scratchpad
- Host notes: ${nonPortablePaths.join(" | ")}
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      last_codex_summary: `Summary: ${nonPortablePaths.join(" | ")}`,
      last_failure_context: {
        category: "manual",
        summary: `Leaked local paths ${nonPortablePaths.join(" and ")}`,
        signature: "journal-nonportable-roots",
        command: `cat ${nonPortablePaths.join(" ")}`,
        url: "https://example.test/issues/177",
        details: nonPortablePaths,
        updated_at: "2026-03-14T00:00:00Z",
      },
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  for (const candidate of nonPortablePaths) {
    assert.doesNotMatch(content, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.ok(
    (content.match(/<redacted-local-path>/g) ?? []).length >= nonPortablePaths.length,
    "expected broader local absolute path roots to be redacted",
  );
});

test("syncIssueJournal preserves legacy handoff content by normalizing old field names", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-legacy-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- Hypothesis: A structured handoff should reduce scanning time.
- Primary failure or risk: The journal still relies on free-form notes.
- Last focused command: npm test -- src/journal.test.ts
- Files changed: src/journal.ts
- Next 1-3 actions:
  - Add the new schema fields.

### Scratchpad
- Existing note.
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.doesNotMatch(content, /- Primary failure or risk:/);
  assert.doesNotMatch(content, /- Files changed:/);
  assert.doesNotMatch(content, /- Next 1-3 actions:/);
  assert.match(content, /- Current blocker: The journal still relies on free-form notes\./);
  assert.match(content, /- Files touched: src\/journal\.ts/);
  assert.match(content, /- Next exact step: Add the new schema fields\./);
  assert.match(content, /- Last focused command: npm test -- src\/journal\.test\.ts/);
  assert.match(content, /### Scratchpad\n- Existing note\./);
});

test("syncIssueJournal keeps wrapped next steps and preserves extra legacy actions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-next-step-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- Next 1-3 actions:
  - Implement the handoff normalization
    without dropping wrapped text.
  - Update the downstream sanitizer for the new label.

### Scratchpad
- Existing note.
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /- Next exact step: Implement the handoff normalization without dropping wrapped text\./);
  assert.match(content, /Update the downstream sanitizer for the new label\./);
  assert.match(content, /### Scratchpad\n- Existing note\./);
});

test("syncIssueJournal compaction preserves populated current handoff values", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-compact-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #177: Structured handoff: define a clearer issue journal schema

## Codex Working Notes
### Current Handoff
- Hypothesis: Structured handoff fields speed operator recovery.
- What changed: Added explicit journal labels and normalization.
- Current blocker: None.
- Next exact step: Update the remaining prompt sanitizer.
- Verification gap: Full npm test was not rerun.
- Files touched: src/journal.ts, src/codex.ts
- Rollback concern: Low.
- Last focused command: npx tsx --test src/journal.test.ts

### Scratchpad
${Array.from({ length: 30 }, (_, index) => `- Scratch line ${index + 1}: ${"detail ".repeat(8).trim()}`).join("\n")}
`,
    "utf8",
  );

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
    maxChars: 650,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /- What changed: Added explicit journal labels and normalization\./);
  assert.match(content, /- Next exact step: Update the remaining prompt sanitizer\./);
  assert.match(content, /- Verification gap: Full npm test was not rerun\./);
  assert.doesNotMatch(content, /Scratch line 1:/);
  assert.match(content, /Scratch line 30:/);
});

test("syncIssueJournal keeps the rendered summary failure signature aligned with the live snapshot", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-failure-signature-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      state: "addressing_review",
      last_failure_signature: "PRRT_kwDORgvdZ852EV-a",
      repeated_failure_signature_count: 1,
      last_codex_summary: [
        "Summary: waiting for refreshed CI checks",
        "State hint: waiting_ci",
        "Blocked reason: none",
        "Tests: npm run build",
        "Failure signature: none",
        "Next action: monitor the check run",
      ].join("\n"),
      last_failure_context: {
        category: "review",
        summary: "1 unresolved automated review thread(s) remain.",
        signature: "PRRT_kwDORgvdZ852EV-a",
        command: null,
        url: "https://example.test/pr/880#discussion_r2973644268",
        details: ["review thread still points at the tracked journal snapshot"],
        updated_at: "2026-03-14T00:00:00Z",
      },
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /- Last failure signature: PRRT_kwDORgvdZ852EV-a/);
  assert.match(content, /- Repeated failure signature count: 1/);
  assert.match(content, /Failure signature: PRRT_kwDORgvdZ852EV-a/);
  assert.doesNotMatch(content, /Failure signature: none/);
});

test("syncIssueJournal preserves an appended failure signature when the summary is truncated", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-truncated-appended-signature-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      last_failure_signature: "retry-budget",
      last_codex_summary: `Summary: ${"detail ".repeat(700).trim()}`,
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  const renderedSummary = extractLatestCodexSummary(content);
  assert.ok(renderedSummary.length <= 4000);
  assert.match(renderedSummary, /Failure signature: retry-budget$/);
});

test("syncIssueJournal stores review failure details as concise summary plus link", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-review-summary-link-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");
  const failureContext = buildReviewFailureContext([
    {
      id: "thread-1",
      isResolved: false,
      isOutdated: false,
      path: "src/auth.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: [
              "Bug: this fallback skips the permission guard and allows unauthorized writes.",
              "",
              "<details>",
              "<summary>Generated review payload</summary>",
              "",
              "```suggestion",
              "if (!viewer.canWrite()) {",
              "  return;",
              "}",
              "```",
              "",
              "<table><tr><td>html payload</td></tr></table>",
              "</details>",
            ].join("\n"),
            createdAt: "2026-03-14T00:00:00Z",
            url: "https://example.test/pr/880#discussion_r2973644268",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ]);

  assert.ok(failureContext);

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      state: "addressing_review",
      last_failure_context: failureContext,
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  assert.match(content, /- Summary: 1 unresolved automated review thread\(s\) remain\./);
  assert.match(content, /src\/auth\.ts:42/i);
  assert.match(content, /permission guard and allows unauthorized writes/i);
  assert.match(content, /https:\/\/example\.test\/pr\/880#discussion_r2973644268/);
  assert.doesNotMatch(content, /Generated review payload/);
  assert.doesNotMatch(content, /```suggestion/);
  assert.doesNotMatch(content, /<details>/i);
  assert.doesNotMatch(content, /<table>/i);
});

test("syncIssueJournal preserves a replaced failure signature when the summary is truncated", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-truncated-replaced-signature-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");

  await syncIssueJournal({
    issue,
    record: createRecord({
      workspace: tempDir,
      journal_path: journalPath,
      last_failure_signature: "PRRT_kwDORgvdZ852E4Jy",
      last_codex_summary: [
        `Summary: ${"detail ".repeat(700).trim()}`,
        "Failure signature: stale-footer",
      ].join("\n"),
    }),
    journalPath,
  });

  const content = await fs.readFile(journalPath, "utf8");
  const renderedSummary = extractLatestCodexSummary(content);
  assert.ok(renderedSummary.length <= 4000);
  assert.match(renderedSummary, /Failure signature: PRRT_kwDORgvdZ852E4Jy$/);
  assert.doesNotMatch(renderedSummary, /Failure signature: stale-footer/);
});

test("syncIssueJournal writes through a temp file before atomically replacing the journal", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-atomic-write-"));
  const journalPath = path.join(tempDir, ".codex-supervisor", "issue-journal.md");
  const writeTargets: string[] = [];
  const renameTargets: Array<{ from: string; to: string }> = [];
  const originalWriteFile = fs.writeFile.bind(fs);
  const originalRename = fs.rename.bind(fs);
  const writeFileMock = mock.method(
    fs,
    "writeFile",
    async (...args: Parameters<typeof fs.writeFile>) => {
      writeTargets.push(String(args[0]));
      return originalWriteFile(...args);
    },
  );
  const renameMock = mock.method(
    fs,
    "rename",
    async (...args: Parameters<typeof fs.rename>) => {
      renameTargets.push({ from: String(args[0]), to: String(args[1]) });
      return originalRename(...args);
    },
  );
  t.after(() => {
    writeFileMock.mock.restore();
    renameMock.mock.restore();
  });

  await syncIssueJournal({
    issue,
    record: createRecord({ workspace: tempDir, journal_path: journalPath }),
    journalPath,
  });

  assert.equal(writeTargets.length, 1);
  assert.notEqual(writeTargets[0], journalPath);
  assert.match(path.basename(writeTargets[0] ?? ""), /^issue-journal\.md\.tmp(\.|$)/);
  assert.deepEqual(renameTargets, [{ from: writeTargets[0] ?? "", to: journalPath }]);
  assert.deepEqual(
    (await fs.readdir(path.dirname(journalPath))).sort(),
    ["issue-journal.md"],
  );
});
