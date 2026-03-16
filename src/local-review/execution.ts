import { dedupeFindings } from "./finalize";
import { findingMeetsReviewerThreshold, reviewerTypeForRole } from "./thresholds";
import { runRoleReview as defaultRunRoleReview, runVerifierReview as defaultRunVerifierReview } from "./runner";
import { type ExternalReviewMissPattern } from "../external-review-misses";
import { type LocalReviewFinding, type LocalReviewRoleResult, type LocalReviewVerifierReport } from "./types";
import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "../types";

export function selectVerifierFindings(args: {
  config: SupervisorConfig;
  detectedRoles?: LocalReviewRoleSelection[];
  roleResults: LocalReviewRoleResult[];
}): LocalReviewFinding[] {
  return dedupeFindings(
    args.roleResults
      .flatMap((result) => result.findings)
      .filter((finding) =>
        finding.severity === "high" &&
        findingMeetsReviewerThreshold({
          finding,
          reviewerType: reviewerTypeForRole({ role: finding.role, detectedRoles: args.detectedRoles }),
          config: args.config,
        }),
      ),
  );
}

export async function runLocalReviewExecution(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  roles: string[];
  detectedRoles?: LocalReviewRoleSelection[];
  alwaysReadFiles: string[];
  onDemandFiles: string[];
  priorMissPatterns: ExternalReviewMissPattern[];
  runRoleReview?: typeof defaultRunRoleReview;
  runVerifierReview?: typeof defaultRunVerifierReview;
}): Promise<{
  roleResults: LocalReviewRoleResult[];
  verifierReport: LocalReviewVerifierReport | null;
}> {
  const runRoleReview = args.runRoleReview ?? defaultRunRoleReview;
  const runVerifierReview = args.runVerifierReview ?? defaultRunVerifierReview;
  const roleResults: LocalReviewRoleResult[] = new Array(args.roles.length);
  const concurrency = Math.min(2, args.roles.length);
  let currentIndex = 0;

  async function runNextRole(): Promise<void> {
    while (true) {
      const index = currentIndex;
      if (index >= args.roles.length) {
        return;
      }
      currentIndex += 1;
      roleResults[index] = await runRoleReview({
        config: args.config,
        issue: args.issue,
        branch: args.branch,
        workspacePath: args.workspacePath,
        defaultBranch: args.defaultBranch,
        pr: args.pr,
        role: args.roles[index]!,
        alwaysReadFiles: args.alwaysReadFiles,
        onDemandFiles: args.onDemandFiles,
        priorMissPatterns: args.priorMissPatterns,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runNextRole()));

  const findings = selectVerifierFindings({
    config: args.config,
    detectedRoles: args.detectedRoles,
    roleResults,
  });

  if (findings.length === 0) {
    return {
      roleResults,
      verifierReport: null,
    };
  }

  return {
    roleResults,
    verifierReport: await runVerifierReview({
      config: args.config,
      issue: args.issue,
      branch: args.branch,
      workspacePath: args.workspacePath,
      defaultBranch: args.defaultBranch,
      pr: args.pr,
      findings,
    }),
  };
}
