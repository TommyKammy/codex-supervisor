import { type ExternalReviewMissContext } from "./external-review-misses";
import { type StateStore } from "../core/state-store";
import {
  type GitHubPullRequest,
  type IssueRunRecord,
  type SupervisorStateFile,
} from "../core/types";

export function nextExternalReviewMissPatch(
  record: Pick<
    IssueRunRecord,
    | "external_review_head_sha"
    | "external_review_misses_path"
    | "external_review_matched_findings_count"
    | "external_review_near_match_findings_count"
    | "external_review_missed_findings_count"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
  context: ExternalReviewMissContext | null,
): Partial<IssueRunRecord> {
  if (context && pr) {
    return {
      external_review_head_sha: pr.headRefOid,
      external_review_misses_path: context.artifactPath,
      external_review_matched_findings_count: context.matchedCount,
      external_review_near_match_findings_count: context.nearMatchCount,
      external_review_missed_findings_count: context.missedCount,
    };
  }

  if (pr && record.external_review_head_sha && record.external_review_head_sha !== pr.headRefOid) {
    return {
      external_review_head_sha: null,
      external_review_misses_path: null,
      external_review_matched_findings_count: 0,
      external_review_near_match_findings_count: 0,
      external_review_missed_findings_count: 0,
    };
  }

  return {};
}

export async function syncExternalReviewMissState(args: {
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: Pick<GitHubPullRequest, "headRefOid"> | null;
  context: ExternalReviewMissContext | null;
  syncJournal: (record: IssueRunRecord) => Promise<void>;
}): Promise<IssueRunRecord> {
  const patch = nextExternalReviewMissPatch(args.record, args.pr, args.context);
  if (Object.keys(patch).length === 0) {
    return args.record;
  }

  const record = args.stateStore.touch(args.record, patch);
  args.state.issues[String(record.issue_number)] = record;
  await args.stateStore.save(args.state);
  await args.syncJournal(record);
  return record;
}
