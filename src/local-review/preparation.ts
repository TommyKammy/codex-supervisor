import {
  compareExternalReviewPatterns,
  loadCommittedExternalReviewGuardrails,
} from "../committed-guardrails";
import { runCommand } from "../command";
import { loadRelevantExternalReviewMissPatterns, type ExternalReviewMissPattern } from "../external-review-misses";
import { reviewDir } from "./artifacts";
import { compareRef } from "./prompt";
import { detectLocalReviewRoleSelections, type LocalReviewRoleSelection } from "../review-role-detector";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "../types";

export function selectLocalReviewRoles(args: {
  config: Pick<SupervisorConfig, "localReviewRoles">;
  detectedRoles: LocalReviewRoleSelection[];
}): string[] {
  if (args.config.localReviewRoles.length > 0) {
    return args.config.localReviewRoles;
  }
  if (args.detectedRoles.length > 0) {
    return args.detectedRoles.map((selection) => selection.role);
  }

  return ["reviewer", "explorer"];
}

export async function collectLocalReviewChangedFiles(args: {
  workspacePath: string;
  defaultBranch: string;
  runGitDiff?: (defaultBranch: string, workspacePath: string) => Promise<string>;
}): Promise<string[]> {
  const runGitDiff = args.runGitDiff ?? defaultRunGitDiff;
  const stdout = await runGitDiff(args.defaultBranch, args.workspacePath);
  return stdout
    .split("\0")
    .filter((line) => line.length > 0);
}

async function defaultRunGitDiff(defaultBranch: string, workspacePath: string): Promise<string> {
  const ref = compareRef(defaultBranch);
  const changedFilesResult = await runCommand(
    "git",
    ["diff", "--name-only", "-z", ref],
    {
      cwd: workspacePath,
      env: process.env,
    },
  );
  return changedFilesResult.stdout;
}

export async function loadLocalReviewExternalReviewContext(args: {
  config: Pick<SupervisorConfig, "localReviewArtifactDir" | "repoSlug">;
  issue: Pick<GitHubIssue, "number">;
  branch: string;
  workspacePath: string;
  currentHeadSha: GitHubPullRequest["headRefOid"];
  changedFiles: string[];
  loadCommittedPatterns?: (workspacePath: string) => Promise<ExternalReviewMissPattern[]>;
  loadRelevantPatterns?: (args: {
    artifactDir: string;
    branch: string;
    currentHeadSha: string;
    changedFiles: string[];
    limit?: number;
    workspacePath?: string;
  }) => Promise<ExternalReviewMissPattern[]>;
}): Promise<{
  committedExternalReviewPatterns: ExternalReviewMissPattern[];
  runtimeExternalReviewPatterns: ExternalReviewMissPattern[];
  priorMissPatterns: ExternalReviewMissPattern[];
}> {
  const loadCommittedPatterns = args.loadCommittedPatterns ?? loadCommittedExternalReviewGuardrails;
  const loadRelevantPatterns = args.loadRelevantPatterns ?? loadRelevantExternalReviewMissPatterns;
  const changedFileSet = new Set(args.changedFiles);
  const artifactDir = reviewDir(args.config, args.issue.number);
  const committedExternalReviewPatterns = (await loadCommittedPatterns(args.workspacePath))
    .filter((pattern) => changedFileSet.has(pattern.file))
    .sort(compareExternalReviewPatterns)
    .slice(0, 3);
  const runtimeExternalReviewPatterns = await loadRelevantPatterns({
    artifactDir,
    branch: args.branch,
    currentHeadSha: args.currentHeadSha,
    changedFiles: args.changedFiles,
    limit: 3,
  });
  const priorMissPatterns = await loadRelevantPatterns({
    artifactDir,
    branch: args.branch,
    currentHeadSha: args.currentHeadSha,
    changedFiles: args.changedFiles,
    limit: 3,
    workspacePath: args.workspacePath,
  });

  return {
    committedExternalReviewPatterns,
    runtimeExternalReviewPatterns,
    priorMissPatterns,
  };
}

export async function prepareLocalReviewRoleSelection(args: {
  config: SupervisorConfig;
  detectRoles?: () => Promise<LocalReviewRoleSelection[]>;
}): Promise<{
  detectedRoles: LocalReviewRoleSelection[];
  roles: string[];
}> {
  const detectedRoles =
    args.config.localReviewRoles.length === 0 && args.config.localReviewAutoDetect
      ? await (args.detectRoles ?? (() => detectLocalReviewRoleSelections(args.config)))()
      : [];

  return {
    detectedRoles,
    roles: selectLocalReviewRoles({
      config: args.config,
      detectedRoles,
    }),
  };
}
