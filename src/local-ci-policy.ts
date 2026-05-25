import { displayLocalCiCommand } from "./core/config";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "./core/types";

export type LocalCiConfiguredState = Pick<SupervisorConfig, "localCiCommand"> & {
  localCiCommand?: SupervisorConfig["localCiCommand"] | null;
};

export function hasConfiguredLocalCiCommand(config: LocalCiConfiguredState): boolean {
  return displayLocalCiCommand(config.localCiCommand ?? undefined) !== null;
}

export function hasCurrentHeadLocalCiSuccess(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  const latestLocalCi = record.latest_local_ci_result ?? null;
  return latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === pr.headRefOid;
}

export function currentHeadLocalCiMissing(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return !hasCurrentHeadLocalCiSuccess(record, pr);
}
