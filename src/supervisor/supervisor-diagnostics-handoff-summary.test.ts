import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
} from "./supervisor-test-helpers";

test("status includes a compact handoff summary for an active blocker", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status output should summarize the live handoff.
- What changed: Added structured journal fields.
- Current blocker: Waiting on the status formatter to show the blocker and next step.
- Next exact step: Render a compact handoff summary in status output.
- Verification gap: Focused supervisor status test still missing.
- Files touched: src/journal.ts, src/supervisor.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /handoff_summary=blocker: Waiting on the status formatter to show the blocker and next step\. \| next: Render a compact handoff summary in status output\./,
  );
});

test("status keeps the active handoff summary when PR status loading emits a warning", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Preserve the active handoff summary even when status loading warns.
- What changed: Added a focused status warning assertion.
- Current blocker: Waiting on GitHub status hydration to finish cleanly.
- Next exact step: Keep the warning path rendering the same handoff summary.
- Verification gap: Focused supervisor status warning coverage was missing.
- Files touched: src/supervisor.test.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern status warning

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => {
      throw new Error("injected status hydration failure");
    },
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /handoff_summary=blocker: Waiting on GitHub status hydration to finish cleanly\. \| next: Keep the warning path rendering the same handoff summary\./,
  );
  assert.match(status, /status_warning=.*injected status hydration failure/);
});

test("status downgrades journal read failures into status warnings", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92");
  await fs.mkdir(journalPath, { recursive: true });

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92-workspace"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /status_warning=/);
  assert.doesNotMatch(status, /handoff_summary=/);
});

test("status omits handoff summary when the handoff has no actionable blocker or next step", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis:
- What changed: Added structured journal fields.
- Current blocker: None.
- Next exact step:
- Verification gap: None.
- Files touched: src/journal.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "implementing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.doesNotMatch(status, /handoff_summary=/);
});
