import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackedPrStatusCommentBody,
  buildTrackedPrStatusCommentMarker,
  parseTrackedPrStatusCommentMarker,
  selectOwnedTrackedPrStatusComment,
  syncTrackedPrPersistentStatusComment,
  workspacePreparationRemediationTarget,
} from "./tracked-pr-status-comment";
import { publishTrackedPrStatusComment } from "./tracked-pr-status-comment-publisher";
import { buildTrackedPrHostLocalBlockerComment } from "./tracked-pr-status-comment-rendering";
import { handleStaleConfiguredBotReviewRemediation } from "./stale-configured-bot-auto-handle";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorState,
} from "./supervisor/supervisor-test-helpers";
import { IssueRunRecord, SupervisorStateFile } from "./core/types";

test("buildTrackedPrStatusCommentMarker renders the stable sticky tracked PR marker", () => {
  assert.equal(
    buildTrackedPrStatusCommentMarker({
      issueNumber: 102,
      prNumber: 116,
      kind: "status",
    }),
    "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
  );
});

test("parseTrackedPrStatusCommentMarker reads only the stable sticky tracked PR marker", () => {
  assert.deepEqual(
    parseTrackedPrStatusCommentMarker(
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
    ),
    {
      issueNumber: 102,
      prNumber: 116,
      kind: "status",
    },
  );
  assert.deepEqual(
    parseTrackedPrStatusCommentMarker(
      "prefix <!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=host-local-blocker --> suffix",
    ),
    {
      issueNumber: 102,
      prNumber: 116,
      kind: "host-local-blocker",
    },
  );
  assert.equal(
    parseTrackedPrStatusCommentMarker(
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=unknown -->",
    ),
    null,
  );
});

test("buildTrackedPrStatusCommentBody appends the owned marker without GitHub transport", () => {
  assert.equal(
    buildTrackedPrStatusCommentBody({
      body: "Tracked PR head `head-116` remains stopped near merge.",
      marker: {
        issueNumber: 102,
        prNumber: 116,
        kind: "status",
      },
    }),
    [
      "Tracked PR head `head-116` remains stopped near merge.",
      "",
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
    ].join("\n"),
  );
});

test("selectOwnedTrackedPrStatusComment picks the newest editable marked comment", () => {
  const marker = buildTrackedPrStatusCommentMarker({
    issueNumber: 102,
    prNumber: 116,
    kind: "status",
  });
  const selected = selectOwnedTrackedPrStatusComment({
    issueComments: [
      {
        id: "foreign",
        databaseId: 10,
        body: marker,
        createdAt: "2026-03-16T02:00:00Z",
        url: "https://example.test/comments/10",
        viewerDidAuthor: false,
        author: null,
      },
      {
        id: "old-owned",
        databaseId: 11,
        body: marker,
        createdAt: "2026-03-16T01:00:00Z",
        url: "https://example.test/comments/11",
        viewerDidAuthor: true,
        author: null,
      },
      {
        id: "new-owned",
        databaseId: 12,
        body: marker,
        createdAt: "2026-03-16T03:00:00Z",
        url: "https://example.test/comments/12",
        viewerDidAuthor: true,
        author: null,
      },
    ],
    markers: [marker],
  });

  assert.equal(selected?.databaseId, 12);
});

test("workspacePreparationRemediationTarget keeps generic preparation failures on workspace environment", () => {
  assert.equal(workspacePreparationRemediationTarget("non_zero_exit"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("workspace_toolchain_missing"), "workspace_environment");
  assert.equal(workspacePreparationRemediationTarget("missing_command"), "config_contract");
  assert.equal(workspacePreparationRemediationTarget("worktree_helper_missing"), "config_contract");
});

test("buildTrackedPrHostLocalBlockerComment renders status text without marker transport concerns", () => {
  const body = buildTrackedPrHostLocalBlockerComment({
    pr: { headRefOid: "head-116" },
    gateType: "local_ci",
    blockerSignature: "verify-pre-pr:failed",
    failureClass: "non_zero_exit",
    remediationTarget: "workspace_environment",
    summary: "verify-pre-pr failed",
    details: [" npm run build   failed ", ".codex-supervisor/issues/116/issue-journal.md:1 matched"],
    localHeadSha: "local-head",
    remoteHeadSha: "head-116",
  });

  assert.equal(
    body,
    [
      "Tracked PR head `head-116` is still draft because ready-for-review promotion is blocked locally.",
      "",
      "- local head SHA: `local-head`",
      "- remote PR head SHA: `head-116`",
      "- reason code: `ready_promotion_blocked_local_ci`",
      "- gate type: `local_ci`",
      "- blocker signature: `verify-pre-pr:failed`",
      "- failure class: `non_zero_exit`",
      "- remediation target: `workspace_environment`",
      "- summary: verify-pre-pr failed",
      "- evidence: npm run build failed",
      "- automatic retry: no",
      "- next action: fix the tracked workspace blocker, then rerun the supervisor to retry ready-for-review promotion.",
      "",
      "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
    ].join("\n"),
  );
  assert.doesNotMatch(body, /codex-supervisor:tracked-pr-status-comment/);
});

test("handleStaleConfiguredBotReviewRemediation owns reply_only recovery decisions outside status publishing", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const pr = createPullRequest({
    number: 116,
    headRefOid: "head-116",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Configured bot thread is stale.",
    signature: "stalled-bot:thread-1",
    command: null,
    details: ["file=src/file.ts line=12 processed_on_current_head=yes"],
    url: "https://example.test/pr/116#discussion_r1",
    updated_at: "2026-05-26T00:00:00Z",
  };
  const record = createRecord({
    issue_number: 102,
    pr_number: pr.number,
    state: "blocked",
    blocked_reason: "stale_review_bot",
    last_head_sha: pr.headRefOid,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
  });
  const state = createSupervisorState({ issues: [record] });
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-26T00:01:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
      saveCalls += 1;
    },
  };

  const result = await handleStaleConfiguredBotReviewRemediation({
    github: {
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        isOutdated: true,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "This finding is stale on the current head.",
              createdAt: "2026-05-26T00:00:00Z",
              url: "https://example.test/pr/116#discussion_r1",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    syncJournal: async () => undefined,
    config,
    failureContext,
    manualReviewThreadCount: 0,
    statusCommentAvailable: true,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    skipAutoHandleStaleConfiguredBotReview: false,
    conversationResolutionBlocker: null,
  });

  assert.equal(result.handled, true);
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, pr.headRefOid);
  assert.equal(result.record.last_stale_review_bot_reply_signature, failureContext.signature);
  assert.equal(replyCalls.length, 1);
  assert.equal(replyCalls[0]?.threadId, "thread-1");
  assert.match(replyCalls[0]?.body ?? "", /Leaving thread resolution to a human operator/);
  assert.equal(saveCalls, 2);
});

test("handleStaleConfiguredBotReviewRemediation keeps conversation-resolution recovery provider-neutral", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const pr = createPullRequest({
    number: 117,
    headRefOid: "head-117",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Required conversation resolution is blocking merge.",
    signature: "stalled-bot:thread-coderabbit",
    command: null,
    details: ["reviewer=coderabbitai file=src/file.ts line=12 processed_on_current_head=yes"],
    url: "https://example.test/pr/117#discussion_coderabbit",
    updated_at: "2026-05-26T00:00:00Z",
  };
  const record = createRecord({
    issue_number: 103,
    pr_number: pr.number,
    state: "pr_open",
    last_head_sha: pr.headRefOid,
    provider_success_head_sha: pr.headRefOid,
    provider_success_observed_at: "2026-05-26T00:00:00Z",
  });
  const state = createSupervisorState({ issues: [record] });
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-26T00:01:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
    },
  };

  const result = await handleStaleConfiguredBotReviewRemediation({
    github: {
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [
      createReviewThread({
        id: "thread-coderabbit",
        isOutdated: true,
        comments: {
          nodes: [
            {
              id: "comment-coderabbit",
              body: "CodeRabbit finding is stale on the current head.",
              createdAt: "2026-05-26T00:00:00Z",
              url: "https://example.test/pr/117#discussion_coderabbit",
              author: {
                login: "coderabbitai",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    syncJournal: async () => undefined,
    config,
    failureContext: null,
    manualReviewThreadCount: 0,
    statusCommentAvailable: true,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    skipAutoHandleStaleConfiguredBotReview: false,
    conversationResolutionBlocker: { failureContext },
  });

  assert.equal(result.handled, true);
  assert.deepEqual(resolveCalls, ["thread-coderabbit"]);
  assert.equal(replyCalls[0]?.threadId, "thread-coderabbit");
  assert.match(replyCalls[0]?.body ?? "", /reason=stale_review_bot/);
  assert.doesNotMatch(replyCalls[0]?.body ?? "", /reason=verified_no_source_change_auto_resolve/);
});

test("syncTrackedPrPersistentStatusComment preserves conversation-resolution blocker comment body", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: 116,
    headRefOid: "head-116",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-26T00:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=enabled"],
    },
  });
  const record = createRecord({
    issue_number: 102,
    pr_number: pr.number,
    state: "pr_open",
    last_head_sha: pr.headRefOid,
    provider_success_head_sha: pr.headRefOid,
    provider_success_observed_at: "2026-05-26T00:00:00Z",
    merge_readiness_last_evaluated_at: "2026-05-26T00:01:00Z",
  });
  const state = createSupervisorState({ issues: [record] });
  const addBodies: string[] = [];
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-26T00:02:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
    },
  };

  const updated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async (issueNumber: number, body: string) => {
        assert.equal(issueNumber, pr.number);
        addBodies.push(body);
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        isOutdated: true,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Finding is stale on the current head.",
              createdAt: "2026-05-26T00:00:00Z",
              url: "https://example.test/pr/116#discussion_r1",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    syncJournal: async () => undefined,
    config,
    failureContext: null,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.deepEqual(addBodies, [
    [
      "Tracked PR head `head-116` remains stopped near merge.",
      "",
      "- reason code: `conversation_resolution_blocked`",
      "- summary: GitHub is not merge-ready because unresolved outdated configured-bot review conversations still require resolution.",
      "- evidence: merge_state=BLOCKED",
      "- evidence: mergeable=MERGEABLE",
      "- evidence: required_conversation_resolution=enabled",
      "- evidence: required_conversation_resolution_source=branch_protection",
      "- evidence: conversation_threads=thread-1",
      "- evidence: check=verify-pre-pr:pass:SUCCESS",
      "- automatic retry: no",
      "- next action: Resolve the listed configured-bot review conversations, or rerun with the verified configured-bot auto-resolve opt-in enabled.",
      "",
      "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
    ].join("\n"),
  ]);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(updated.last_host_local_pr_blocker_comment_signature, "conversation-resolution:head-116:thread-1");
});

test("publishTrackedPrStatusComment updates the newest owned editable marker before adding", async () => {
  const pr = createPullRequest({
    number: 116,
    headRefOid: "head-116",
    updatedAt: "2026-03-16T03:00:00Z",
  });
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  await publishTrackedPrStatusComment({
    github: {
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async (prNumber, options) => {
        assert.equal(prNumber, 116);
        assert.deepEqual(options, {
          purpose: "action",
          headSha: "head-116",
          reviewSurfaceVersion: "2026-03-16T03:00:00Z",
        });
        return {
          reviews: [],
          issueComments: [
            {
              id: "comment-41",
              databaseId: 41,
              body: "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=host-local-blocker -->",
              createdAt: "2026-03-16T02:00:00Z",
              url: "https://example.test/comments/41",
              viewerDidAuthor: true,
              author: null,
            },
          ],
        };
      },
      updateIssueComment: async (commentId, body) => {
        updateCalls.push({ commentId, body });
      },
    },
    issueNumber: 102,
    pr,
    kind: "status",
    body: "Tracked PR head `head-116` remains stopped near merge.",
  });

  assert.equal(addCalls, 0);
  assert.deepEqual(updateCalls, [
    {
      commentId: 41,
      body: [
        "Tracked PR head `head-116` remains stopped near merge.",
        "",
        "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
      ].join("\n"),
    },
  ]);
});

test("syncTrackedPrPersistentStatusComment publishes handoff-missing operator review routing diagnostics once per head and signature", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: 182,
    headRefOid: "head-182",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const record = createRecord({
    issue_number: 173,
    state: "blocked",
    pr_number: pr.number,
    blocked_reason: "handoff_missing",
    last_head_sha: pr.headRefOid,
    last_failure_context: {
      category: "blocked",
      summary: "Codex started a turn but did not write a durable handoff.",
      signature: "handoff-missing",
      command: null,
      details: ["durable_progress_evidence=journal_unchanged"],
      url: null,
      updated_at: "2026-05-23T00:00:00Z",
    },
    last_failure_signature: "handoff-missing",
  });
  const state = createSupervisorState({
    issues: [record],
  });
  const addBodies: string[] = [];
  let saveCalls = 0;
  const touched: Partial<IssueRunRecord>[] = [];
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touched.push(patch);
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-23T00:01:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
      saveCalls += 1;
    },
  };
  const failureContext = {
    category: "review" as const,
    summary:
      "Code and test evidence appears to cover the current-head finding, but unresolved review-thread metadata still requires explicit operator routing.",
    signature: "codex_connector_operator_diagnostic:actionable_current_diff",
    command: null,
    details: [
      "interpretation=actionable_current_diff actionable_current_diff_threads=2",
      "next_action=repair_must_fix_findings",
    ],
    url: "https://example.test/pr/182",
    updated_at: "2026-05-23T00:00:30Z",
  };

  const updated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async (issueNumber: number, body: string) => {
        assert.equal(issueNumber, pr.number);
        addBodies.push(body);
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.equal(addBodies.length, 1);
  assert.match(addBodies[0] ?? "", /reason code: `handoff_missing`/);
  assert.match(addBodies[0] ?? "", /operator review routing/);
  assert.match(addBodies[0] ?? "", /actionable_current_diff_threads=2/);
  assert.match(addBodies[0] ?? "", /next_action=repair_must_fix_findings/);
  assert.match(
    addBodies[0] ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=173 pr=182 kind=status -->/,
  );
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(updated.last_host_local_pr_blocker_comment_signature, failureContext.signature);
  assert.equal(saveCalls, 1);
  assert.equal(touched.length, 1);

  const repeated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async () => {
        throw new Error("unexpected duplicate tracked PR status comment");
      },
    },
    stateStore,
    state,
    record: updated,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.equal(repeated, updated);
  assert.equal(saveCalls, 1);
});

test("syncTrackedPrPersistentStatusComment keeps handoff-missing signature stable without live failure context", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: 182,
    headRefOid: "head-182",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const blockerSignature = "codex_connector_operator_diagnostic:actionable_current_diff";
  const record = createRecord({
    issue_number: 173,
    state: "blocked",
    pr_number: pr.number,
    blocked_reason: "handoff_missing",
    last_head_sha: pr.headRefOid,
    last_failure_context: {
      category: "review",
      summary:
        "Code and test evidence appears to cover the current-head finding, but unresolved review-thread metadata still requires explicit operator routing.",
      signature: blockerSignature,
      command: null,
      details: [
        "interpretation=actionable_current_diff actionable_current_diff_threads=2",
        "next_action=repair_must_fix_findings",
      ],
      url: "https://example.test/pr/182",
      updated_at: "2026-05-23T00:00:30Z",
    },
    last_failure_signature: blockerSignature,
  });
  const state = createSupervisorState({
    issues: [record],
  });
  const addBodies: string[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-23T00:01:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
      saveCalls += 1;
    },
  };

  const updated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async (issueNumber: number, body: string) => {
        assert.equal(issueNumber, pr.number);
        addBodies.push(body);
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext: null,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.equal(addBodies.length, 1);
  assert.match(addBodies[0] ?? "", /reason code: `handoff_missing`/);
  assert.match(addBodies[0] ?? "", /unresolved review-thread metadata still requires explicit operator routing/);
  assert.match(addBodies[0] ?? "", /actionable_current_diff_threads=2/);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(updated.last_host_local_pr_blocker_comment_signature, blockerSignature);
  assert.equal(saveCalls, 1);

  const repeated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async () => {
        throw new Error("unexpected duplicate tracked PR status comment");
      },
    },
    stateStore,
    state,
    record: updated,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext: null,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.equal(repeated, updated);
  assert.equal(saveCalls, 1);
});

test("syncTrackedPrPersistentStatusComment supersedes draft suppression when current-head local review blocks manually", async () => {
  const artifactRoot = "runtime-artifacts/local-review";
  const summaryPath = `${artifactRoot}/owner-repo/issue-173/head-182.md`;
  const config = createConfig({
    localReviewArtifactDir: artifactRoot,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: 182,
    headRefOid: "head-182",
    isDraft: true,
    mergeStateStatus: "UNKNOWN",
    mergeable: "UNKNOWN",
  });
  const record = createRecord({
    issue_number: 173,
    state: "blocked",
    pr_number: pr.number,
    blocked_reason: "manual_review",
    last_head_sha: pr.headRefOid,
    local_review_head_sha: pr.headRefOid,
    local_review_summary_path: summaryPath,
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
    last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
    last_host_local_pr_blocker_comment_signature: "draft_review_provider_suppressed",
  });
  const state = createSupervisorState({
    issues: [record],
  });
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-24T00:01:00Z",
      };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      assert.equal(nextState.issues[String(record.issue_number)]?.issue_number, record.issue_number);
      saveCalls += 1;
    },
  };

  const updated = await syncTrackedPrPersistentStatusComment({
    github: {
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Tracked PR head `head-182` is still draft because provider review is intentionally suppressed.",
              "",
              "- reason code: `draft_review_provider_suppressed`",
              "- automatic retry: yes",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=173 pr=182 kind=status -->",
            ].join("\n"),
            createdAt: "2026-05-24T00:00:00Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: null,
          },
        ],
      }),
      updateIssueComment: async (commentId: number, body: string) => {
        updateCalls.push({ commentId, body });
      },
    },
    stateStore,
    state,
    record,
    pr,
    checks: [],
    reviewThreads: [],
    syncJournal: async () => undefined,
    config,
    failureContext: null,
    summarizeChecks: () => ({ hasPending: false, hasFailing: false }),
    manualReviewThreadCount: 0,
  });

  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `manual_review`/);
  assert.match(updateCalls[0]?.body ?? "", /local-review outcome: `manual_review_blocked`/);
  assert.match(updateCalls[0]?.body ?? "", /local-review summary path: `owner-repo\/issue-173\/head-182\.md`/);
  assert.match(updateCalls[0]?.body ?? "", /automatic retry: no/);
  assert.doesNotMatch(updateCalls[0]?.body ?? "", /automatic retry: yes/);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(
    updated.last_host_local_pr_blocker_comment_signature,
    "manual_review:head-182:manual_review_blocked:1:owner-repo/issue-173/head-182.md",
  );
  assert.equal(saveCalls, 1);
});
