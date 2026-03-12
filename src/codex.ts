import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { buildCodexConfigOverrideArgs, resolveCodexExecutionPolicy } from "./codex-policy";
import {
  BlockedReason,
  CodexTurnResult,
  FailureContext,
  GitHubIssue,
  IssueRunRecord,
  GitHubPullRequest,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "./types";

export interface LocalReviewRepairContext {
  summaryPath: string;
  findingsPath: string | null;
  relevantFiles: string[];
  rootCauses: Array<{
    severity: "low" | "medium" | "high";
    summary: string;
    file: string | null;
    lines: string | null;
  }>;
}

export function extractStateHint(message: string): RunState | null {
  const match = message.match(/State hint:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as RunState;
  const supported: RunState[] = [
    "queued",
    "planning",
    "reproducing",
    "implementing",
    "local_review_fix",
    "stabilizing",
    "draft_pr",
    "local_review",
    "pr_open",
    "repairing_ci",
    "resolving_conflict",
    "waiting_ci",
    "addressing_review",
    "ready_to_merge",
    "merging",
    "done",
    "blocked",
    "failed",
  ];

  return supported.includes(value) ? value : null;
}

export function extractBlockedReason(message: string): BlockedReason {
  const match = message.match(/Blocked reason:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as BlockedReason;
  const supported: BlockedReason[] = [
    "requirements",
    "permissions",
    "secrets",
    "verification",
    "manual_review",
    "manual_pr_closed",
    "handoff_missing",
    "unknown",
    null,
  ];
  return supported.includes(value) ? value : null;
}

export function extractFailureSignature(message: string): string | null {
  const match = message.match(/Failure signature:\s*(.+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  if (!value || value.toLowerCase() === "none") {
    return null;
  }

  return value.slice(0, 500);
}

function phaseGuidance(state: RunState): string[] {
  if (state === "planning" || state === "reproducing") {
    return [
      "- First make the failure reproducible in a focused way before broad implementation changes.",
      "- Add or tighten the narrowest test that proves the issue before attempting full verification.",
    ];
  }

  if (state === "implementing") {
    return [
      "- The current branch needs concrete code changes, not another clean-checkpoint pass.",
      "- Focus on the narrowest implementation fix that addresses the active blocker or review finding.",
    ];
  }

  if (state === "local_review_fix") {
    return [
      "- Focus only on the active local-review root causes blocking the PR or merge.",
      "- Make the smallest code change that resolves the current root cause and avoid checkpoint-maintenance work.",
    ];
  }

  if (state === "stabilizing") {
    return [
      "- You already have progress in the branch. Focus on turning current changes into a clean, reviewable checkpoint.",
      "- Prefer focused fixes and verification over broad rework.",
    ];
  }

  if (state === "draft_pr") {
    return [
      "- A draft PR exists or should exist. Keep changes incremental and reviewable.",
      "- Update the branch, run focused verification, and leave a clear handoff in the issue journal.",
    ];
  }

  if (state === "local_review") {
    return [
      "- A local advisory review is running for the current draft PR.",
      "- Do not change code in this phase unless a later implementation turn is explicitly triggered.",
    ];
  }

  if (state === "repairing_ci") {
    return [
      "- Treat the failing CI signal as the primary task. Fix the concrete failure instead of reshaping the feature.",
      "- Reproduce the failing command locally when possible and update the issue journal with the new result.",
    ];
  }

  if (state === "resolving_conflict") {
    return [
      "- Integrate the latest base branch, resolve conflicts conservatively, rerun focused verification, and push.",
    ];
  }

  if (state === "addressing_review") {
    return [
      "- Review threads are the primary task. Evaluate each comment, apply only valid fixes, and preserve existing behavior.",
    ];
  }

  return [];
}

export function buildCodexPrompt(input: {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  state: RunState;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  alwaysReadFiles: string[];
  onDemandMemoryFiles: string[];
  gsdEnabled?: boolean;
  gsdPlanningFiles?: string[];
  journalPath: string;
  journalExcerpt?: string | null;
  failureContext?: FailureContext | null;
  previousSummary?: string | null;
  previousError?: string | null;
  localReviewRepairContext?: LocalReviewRepairContext | null;
}): string {
  const checksSummary =
    input.checks.length === 0
      ? "No checks currently reported."
      : input.checks.map((check) => `- ${check.name}: ${check.bucket}/${check.state}`).join("\n");

  const prSummary = input.pr
    ? [
        `PR: #${input.pr.number} ${input.pr.url}`,
        `Draft: ${String(input.pr.isDraft)}`,
        `Review decision: ${input.pr.reviewDecision ?? "none"}`,
        `Merge state: ${input.pr.mergeStateStatus ?? "unknown"}`,
      ].join("\n")
    : "PR: none";

  const reviewSummary =
    input.reviewThreads.length === 0
      ? "No unresolved configured-bot review threads."
      : input.reviewThreads
          .map((thread) => {
            const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1];
            return [
              `- Thread ${thread.id}`,
              `  File: ${thread.path ?? "unknown"}:${thread.line ?? "?"}`,
              `  Updated: ${latestComment?.createdAt ?? "unknown"}`,
              `  Reviewer: ${latestComment?.author?.login ?? "unknown"}`,
              `  Comment URL: ${latestComment?.url ?? "n/a"}`,
              `  Comment: ${latestComment?.body.replace(/\s+/g, " ").trim() ?? ""}`,
            ].join("\n");
          })
          .join("\n");

  const failureSummary = input.failureContext
    ? [
        `Category: ${input.failureContext.category ?? "unknown"}`,
        `Summary: ${input.failureContext.summary}`,
        input.failureContext.command ? `Command/source: ${input.failureContext.command}` : null,
        input.failureContext.url ? `Reference: ${input.failureContext.url}` : null,
        ...(input.failureContext.details.length > 0
          ? ["Details:", ...input.failureContext.details.map((detail) => `- ${detail}`)]
          : []),
      ]
        .filter(Boolean)
        .join("\n")
    : "No structured failure context recorded.";

  const localReviewRepairSummary =
    input.state === "local_review_fix"
      ? [
          "Active local-review repair context:",
          ...(input.localReviewRepairContext
            ? [
                `- Summary artifact: ${input.localReviewRepairContext.summaryPath}`,
                input.localReviewRepairContext.findingsPath
                  ? `- Findings artifact: ${input.localReviewRepairContext.findingsPath}`
                  : "- Findings artifact: none",
                ...(input.localReviewRepairContext.relevantFiles.length > 0
                  ? [
                      "- Relevant files to inspect first:",
                      ...input.localReviewRepairContext.relevantFiles.map((filePath) => `  - ${filePath}`),
                    ]
                  : ["- Relevant files to inspect first: none identified"]),
                ...(input.localReviewRepairContext.rootCauses.length > 0
                  ? [
                      "- Compressed root causes:",
                      ...input.localReviewRepairContext.rootCauses.map((rootCause, index) =>
                        `  - ${index + 1}. severity=${rootCause.severity} file=${rootCause.file ?? "multiple"} lines=${rootCause.lines ?? "multiple"} summary=${rootCause.summary}`,
                      ),
                    ]
                  : ["- Compressed root causes: none available"]),
              ]
            : [
                "- No parsed local-review repair context was available. Read the local-review summary artifact before editing code.",
              ]),
        ]
      : [];

  return [
    `You are operating inside a dedicated worktree for ${input.repoSlug}.`,
    `Current issue: #${input.issue.number} ${input.issue.title}`,
    `Issue URL: ${input.issue.url}`,
    `Branch: ${input.branch}`,
    `Workspace: ${input.workspacePath}`,
    `Supervisor state: ${input.state}`,
    "",
    "Current phase guidance:",
    ...phaseGuidance(input.state),
    "",
    "Issue body:",
    input.issue.body || "(empty)",
    "",
    prSummary,
    "",
    "Checks:",
    checksSummary,
    "",
    "Unresolved configured-bot review threads:",
    reviewSummary,
    "",
    "Structured failure context:",
    failureSummary,
    ...(localReviewRepairSummary.length > 0 ? ["", ...localReviewRepairSummary] : []),
    ...(input.alwaysReadFiles.length > 0
      ? [
          "",
          "Always-read memory files:",
          ...input.alwaysReadFiles.map((filePath) => `- ${filePath}`),
          "",
          "On-demand durable memory files:",
          ...(input.onDemandMemoryFiles.length > 0
            ? input.onDemandMemoryFiles.map((filePath) => `- ${filePath}`)
            : ["- none configured"]),
          "",
          "Memory policy:",
          "- Read the always-read files first.",
          "- Use the context index to decide whether you need any on-demand durable memory files.",
          "- Do not bulk-read every durable memory file on every turn.",
          "- Treat these files as the durable cross-thread memory shared by Codex, CI agents, and future sessions.",
        ]
      : []),
    ...(input.gsdEnabled
      ? [
          "",
          "GSD collaboration:",
          "- This repository may contain get-shit-done planning artifacts.",
          `- Prefer these GSD planning files when requirements are ambiguous: ${input.gsdPlanningFiles?.join(", ") || "none configured"}.`,
          "- Treat GSD planning files as upstream intent and phase-definition documents.",
          "- Do not run GSD execution workflows inside this supervisor turn.",
          "- If a requirement is still unclear after reading the planning docs, record that gap in the issue journal instead of inventing policy.",
        ]
      : []),
    "",
    `Issue journal path: ${input.journalPath}`,
    "Read the issue journal before making changes and update its Codex Working Notes section before ending your turn.",
    ...(input.journalExcerpt
      ? ["", "Issue journal excerpt:", input.journalExcerpt]
      : []),
    ...(input.previousSummary
      ? ["", "Previous Codex summary:", input.previousSummary]
      : []),
    ...(input.previousError && input.previousError !== input.previousSummary
      ? ["", "Previous blocker or failure:", input.previousError]
      : []),
    "",
    "Constraints:",
    `- Never push to ${input.repoSlug}:${input.branch === "main" ? "main" : "main"} directly.`,
    `- Work only on branch ${input.branch}.`,
    "- If implementation changes are needed, edit code, run focused verification, and commit the result.",
    "- Checkpoint commits are allowed. If you have a coherent partial checkpoint (for example a reproducing test, a review fix, or a focused implementation slice), commit it with a clear message even if the whole issue is not fully complete yet.",
    "- If CI is failing, investigate and fix the failure instead of waiting.",
    "- If the PR is ready and you need to update it, use git/gh from this workspace.",
    "- If there is no PR but the branch already contains a coherent checkpoint, open or update a draft PR early rather than waiting for full completion.",
    "- If the PR merge state is DIRTY, fetch the latest base branch, integrate it into the issue branch, resolve conflicts in this workspace, rerun focused verification, and push the updated branch.",
    "- If local verification fails, keep iterating on the implementation and tests instead of reporting blocked, unless you are truly blocked by permissions, secrets, or unclear requirements.",
    "- If you are blocked by missing permissions, missing secrets, or unclear issue requirements, say so explicitly.",
    "- Before ending the turn, update the issue journal with the current hypothesis, exact failures, commands run, and next actions.",
    "",
    "Respond in this exact footer format at the end:",
    "Summary: <short summary>",
    "State hint: <reproducing|implementing|local_review_fix|stabilizing|draft_pr|local_review|pr_open|repairing_ci|resolving_conflict|waiting_ci|addressing_review|blocked|failed>",
    "Blocked reason: <requirements|permissions|secrets|verification|manual_review|unknown|none>",
    "Tests: <what you ran or not run>",
    "Failure signature: <stable short signature for the current primary failure or none>",
    "Next action: <next supervisor-relevant action>",
  ].join("\n");
}

export async function runCodexTurn(
  config: SupervisorConfig,
  workspacePath: string,
  prompt: string,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
  sessionId?: string | null,
): Promise<CodexTurnResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-"));
  const messageFile = path.join(tempDir, "last-message.txt");
  const overrideArgs = buildCodexConfigOverrideArgs(resolveCodexExecutionPolicy(config, state, record));
  const commandArgs = sessionId
    ? [
        "exec",
        "resume",
        ...overrideArgs,
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-o",
        messageFile,
        sessionId,
        prompt,
      ]
    : [
        "exec",
        ...overrideArgs,
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        workspacePath,
        "-o",
        messageFile,
        prompt,
      ];
  const result = await runCommand(
    config.codexBinary,
    commandArgs,
    {
      cwd: workspacePath,
      allowExitCodes: [0, 1],
      env: {
        ...process.env,
        npm_config_yes: "true",
        CI: "1",
      },
      timeoutMs: config.codexExecTimeoutMinutes * 60_000,
    },
  );

  let lastMessage = "";
  try {
    lastMessage = await fs.readFile(messageFile, "utf8");
  } catch {
    lastMessage = "";
  }

  let resolvedSessionId = sessionId ?? null;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as { type?: string; thread_id?: string };
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        resolvedSessionId = event.thread_id;
      }
    } catch {
      continue;
    }
  }

  await fs.rm(tempDir, { recursive: true, force: true });

  return {
    exitCode: result.exitCode,
    sessionId: resolvedSessionId,
    lastMessage: lastMessage.trim(),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}
