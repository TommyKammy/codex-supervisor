import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../core/state-store";
import type { IssueRunRecord } from "../core/types";
import type { GitHubClient } from "../github";
import {
  hasCompletedVerifiedStaleResidueAutoResolve,
  runPreparedIssueFlow,
} from "./prepared-issue-runner";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createSupervisorState,
} from "./supervisor-test-helpers";

async function runTrackedIndependentVerificationRetryCase(
  verificationPassed: boolean,
): Promise<{
  dispatchedState: IssueRunRecord["state"] | null;
  postTurnTransitionCount: number;
  postTurnMergeCount: number;
  savedRecord: IssueRunRecord;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prepared-verifier-retry-"));
  try {
    const stateFile = path.join(root, "state.json");
    const config = createConfig({
      repoPath: path.join(root, "repo"),
      stateFile,
      workspaceRoot: path.join(root, "workspaces"),
    });
    const failureContext = {
      category: "blocked" as const,
      summary: "Codex reported blocked for issue #2086.",
      signature: "verification:images",
      command: "npm run verify:images",
      details: ["structured_blocked_reason=verification"],
      url: null,
      updated_at: "2026-07-11T12:40:00Z",
    };
    const record = createRecord({
      issue_number: 2086,
      state: "queued",
      branch: "codex/issue-2086",
      pr_number: 2086,
      workspace: path.join(config.workspaceRoot, "issue-2086"),
      journal_path: path.join(
        config.workspaceRoot,
        "issue-2086",
        ".codex-supervisor",
        "issue-journal.md",
      ),
      blocked_reason: "verification",
      last_error: "Auto-retrying after verification failure (2/3).",
      last_failure_context: failureContext,
      last_failure_signature: failureContext.signature,
      last_blocker_signature: failureContext.signature,
      blocked_verification_retry_count: 2,
    });
    const state = createSupervisorState({
      activeIssueNumber: record.issue_number,
      issues: [record],
    });
    const stateStore = new StateStore(stateFile, { backend: "json" });
    const pr = createPullRequest({
      number: record.pr_number ?? 2086,
      headRefName: record.branch,
      headRefOid: "head-2086",
      isDraft: false,
      mergeStateStatus: "CLEAN",
    });
    const workspaceStatus = {
      branch: record.branch,
      headSha: pr.headRefOid,
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    };
    const independentVerificationBlocker = {
      lastError: record.last_error,
      lastBlockerSignature: record.last_blocker_signature,
      lastFailureContext: failureContext,
      lastFailureSignature: record.last_failure_signature,
      repeatedFailureSignatureCount: record.repeated_failure_signature_count,
      repeatedBlockerCount: record.repeated_blocker_count,
      blockedVerificationRetryCount: record.blocked_verification_retry_count,
    };
    let dispatchedState: IssueRunRecord["state"] | null = null;
    let postTurnTransitionCount = 0;
    let postTurnMergeCount = 0;

    await runPreparedIssueFlow(
      {
        config,
        stateStore,
        github: {} as GitHubClient,
        executeCodexTurn: async (context) => {
          dispatchedState = context.record.state;
          return {
            kind: "completed",
            record: verificationPassed
              ? {
                  ...context.record,
                  state: "ready_to_merge",
                  blocked_reason: null,
                  last_error: null,
                  last_failure_context: null,
                  last_failure_signature: null,
                  last_blocker_signature: null,
                }
              : {
                  ...context.record,
                  state: "addressing_review",
                  blocked_reason: "verification",
                  last_error: failureContext.summary,
                  last_failure_context: failureContext,
                  last_failure_signature: failureContext.signature,
                  last_blocker_signature: failureContext.signature,
                },
            workspaceStatus,
            pr,
            checks: [],
            reviewThreads: [],
          };
        },
        handlePostTurnPullRequestTransitions: async (context) => {
          postTurnTransitionCount += 1;
          state.issues[String(context.record.issue_number)] = context.record;
          await stateStore.save(state);
          return {
            record: context.record,
            pr: context.pr,
            checks: [],
            reviewThreads: [],
          };
        },
        handlePostTurnMergeAndCompletion: async (_state, _issue, postTurnRecord) => {
          postTurnMergeCount += 1;
          return postTurnRecord;
        },
      },
      {
        state,
        record,
        issue: createIssue({ number: record.issue_number }),
        previousCodexSummary: null,
        previousError: failureContext.summary,
        workspacePath: record.workspace,
        journalPath:
          record.journal_path ??
          path.join(record.workspace, ".codex-supervisor", "issue-journal.md"),
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: path.join(root, "context-index.md"),
          agentsPath: path.join(root, "AGENTS.generated.md"),
        },
        workspaceStatus,
        pr,
        checks: [],
        reviewThreads: [],
        independentVerificationBlocker,
        options: { dryRun: false },
        recoveryEvents: [],
        recoveryLog: null,
      },
    );

    const savedState = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
      issues: Record<string, IssueRunRecord>;
    };
    return {
      dispatchedState,
      postTurnTransitionCount,
      postTurnMergeCount,
      savedRecord: savedState.issues[String(record.issue_number)]!,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("runPreparedIssueFlow dispatches a tracked independent verifier before clean PR lifecycle projection and stops while it remains blocked", async () => {
  const result = await runTrackedIndependentVerificationRetryCase(false);

  assert.equal(result.dispatchedState, "queued");
  assert.equal(result.postTurnTransitionCount, 0);
  assert.equal(result.postTurnMergeCount, 0);
  assert.equal(result.savedRecord.state, "blocked");
  assert.equal(result.savedRecord.blocked_reason, "verification");
  assert.equal(
    result.savedRecord.last_failure_context?.command,
    "npm run verify:images",
  );
});

test("runPreparedIssueFlow resumes tracked PR transitions after the independent verifier passes", async () => {
  const result = await runTrackedIndependentVerificationRetryCase(true);

  assert.equal(result.dispatchedState, "queued");
  assert.equal(result.postTurnTransitionCount, 1);
  assert.equal(result.postTurnMergeCount, 1);
  assert.equal(result.savedRecord.blocked_reason, null);
});

test("runPreparedIssueFlow persists no-PR prepared issues without dispatching Codex when lifecycle says to wait", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prepared-issue-runner-"));
  try {
    const stateFile = path.join(root, "state.json");
    const config = createConfig({
      repoPath: path.join(root, "repo"),
      stateFile,
      workspaceRoot: path.join(root, "workspaces"),
    });
    const record = createRecord({
      issue_number: 2085,
      state: "stabilizing",
      branch: "codex/issue-2085",
      pr_number: null,
      workspace: path.join(config.workspaceRoot, "issue-2085"),
      journal_path: path.join(config.workspaceRoot, "issue-2085", ".codex-supervisor", "issue-journal.md"),
      implementation_attempt_count: 1,
      last_failure_context: null,
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
      blocked_reason: null,
    });
    const state = createSupervisorState({
      activeIssueNumber: null,
      issues: [record],
    });
    const stateStore = new StateStore(stateFile, { backend: "json" });
    const syncJournalRecords: IssueRunRecord[] = [];
    let saveObserved = false;

    const message = await runPreparedIssueFlow(
      {
        config,
        stateStore,
        github: {} as GitHubClient,
        executeCodexTurn: async () => {
          throw new Error("unexpected Codex dispatch");
        },
        handlePostTurnPullRequestTransitions: async () => {
          throw new Error("unexpected post-turn PR transition");
        },
        handlePostTurnMergeAndCompletion: async () => {
          throw new Error("unexpected post-turn merge transition");
        },
      },
      {
        state,
        record,
        issue: createIssue({ number: record.issue_number }),
        previousCodexSummary: null,
        previousError: null,
        workspacePath: record.workspace,
        journalPath: record.journal_path ?? path.join(record.workspace, ".codex-supervisor", "issue-journal.md"),
        syncJournal: async (syncedRecord) => {
          syncJournalRecords.push(syncedRecord);
        },
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: path.join(root, "context-index.md"),
          agentsPath: path.join(root, "AGENTS.generated.md"),
        },
        workspaceStatus: {
          branch: record.branch,
          headSha: "head-2085",
          hasUncommittedChanges: false,
          baseAhead: 1,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr: null,
        checks: [],
        reviewThreads: [],
        options: { dryRun: false },
        recoveryEvents: [],
        recoveryLog: null,
      },
    );

    const savedState = JSON.parse(await fs.readFile(stateFile, "utf8"));
    saveObserved = true;
    assert.match(message, /issue=#2085 state=draft_pr/);
    assert.equal(savedState.activeIssueNumber, 2085);
    assert.equal(savedState.issues["2085"].state, "draft_pr");
    assert.equal(syncJournalRecords.length, 2);
    assert.equal(syncJournalRecords.at(-1)?.state, "draft_pr");
    assert.equal(saveObserved, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("hasCompletedVerifiedStaleResidueAutoResolve requires matching resolve progress", () => {
  const headSha = "68401b26947918f0ce2280a9526ab68298b1a25c";
  const signature = "stalled-bot:PRRT_verified_residue";
  const pr = createPullRequest({ headRefOid: headSha });
  const replyOnlyRecord = createRecord({
    last_stale_review_bot_reply_head_sha: headSha,
    last_stale_review_bot_reply_signature: signature,
    stale_review_bot_reply_progress_keys: [
      `reply:PRRT_verified_residue@${headSha}:${signature}`,
    ],
    stale_review_bot_resolve_progress_keys: [],
  });
  const resolvedRecord = createRecord({
    ...replyOnlyRecord,
    stale_review_bot_resolve_progress_keys: [
      `resolve:PRRT_verified_residue@${headSha}:${signature}`,
    ],
  });
  const finalizedRecord = createRecord({
    last_stale_review_bot_reply_head_sha: headSha,
    last_stale_review_bot_reply_signature:
      "stalled-bot:PRRT_resolved_externally|stalled-bot:PRRT_verified_residue",
    last_failure_context: null,
    last_failure_signature: null,
    stale_review_bot_resolve_progress_keys: [
      `resolve:PRRT_verified_residue@${headSha}:stalled-bot:PRRT_resolved_externally|stalled-bot:PRRT_verified_residue`,
    ],
  });

  assert.equal(hasCompletedVerifiedStaleResidueAutoResolve({ record: replyOnlyRecord, pr }), false);
  assert.equal(hasCompletedVerifiedStaleResidueAutoResolve({ record: resolvedRecord, pr }), true);
  assert.equal(hasCompletedVerifiedStaleResidueAutoResolve({ record: finalizedRecord, pr }), true);
});
