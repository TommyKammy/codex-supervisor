import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncIssueJournal } from "./journal";
import { GitHubIssue, IssueRunRecord } from "./types";

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
    updated_at: "2026-03-14T00:00:00Z",
    ...overrides,
  };
}

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
