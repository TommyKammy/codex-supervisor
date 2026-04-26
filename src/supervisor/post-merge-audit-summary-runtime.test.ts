import assert from "node:assert/strict";
import test from "node:test";
import type { SupervisorConfig } from "../core/types";
import { runSupervisorCommand } from "../cli/supervisor-runtime";

test("runSupervisorCommand renders a structured post-merge audit summary result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "summarize-post-merge-audits", dryRun: false, why: false, issueNumber: undefined },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async () => {
          throw new Error("unexpected queryIssueLint");
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryPostMergeAuditSummary: async () => ({
          schemaVersion: 6,
          advisoryOnly: true,
          autoApplyGuardrails: false,
          autoCreateFollowUpIssues: false,
          generatedAt: "2026-03-24T12:00:00Z",
          artifactDir: "/tmp/post-merge-audits",
          artifactsAnalyzed: 2,
          artifactsSkipped: 0,
          reviewPatterns: [],
          failurePatterns: [],
          recoveryPatterns: [],
          followUpCandidates: [],
          promotionCandidates: [],
          releaseNotesSources: [],
          evaluatorWorkflow: {
            advisoryOnly: true,
            autoCreateFollowUpIssues: false,
            followUpIssueCreationRequiresConfirmation: true,
            reviewerSummary: "Reviewed 0 post-merge audit artifacts.",
            evaluatorSummary: "No evaluator evidence was available.",
            productSafetyFindings: [],
            verificationNotes: [],
            followUpIssueDrafts: [],
            obsidianHistoryDraft: "",
          },
        }),
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
    schemaVersion: 6,
    advisoryOnly: true,
    autoApplyGuardrails: false,
    autoCreateFollowUpIssues: false,
    generatedAt: "2026-03-24T12:00:00Z",
    artifactDir: "/tmp/post-merge-audits",
    artifactsAnalyzed: 2,
    artifactsSkipped: 0,
    reviewPatterns: [],
    failurePatterns: [],
    recoveryPatterns: [],
    followUpCandidates: [],
    promotionCandidates: [],
    releaseNotesSources: [],
    evaluatorWorkflow: {
      advisoryOnly: true,
      autoCreateFollowUpIssues: false,
      followUpIssueCreationRequiresConfirmation: true,
      reviewerSummary: "Reviewed 0 post-merge audit artifacts.",
      evaluatorSummary: "No evaluator evidence was available.",
      productSafetyFindings: [],
      verificationNotes: [],
      followUpIssueDrafts: [],
      obsidianHistoryDraft: "",
    },
  });
});
