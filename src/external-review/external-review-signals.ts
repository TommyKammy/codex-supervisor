export type ExternalReviewSignalSourceKind = "review_thread" | "top_level_review" | "issue_comment";

export interface ExternalReviewSignalEnvelope {
  sourceKind: ExternalReviewSignalSourceKind;
  sourceId: string;
  sourceUrl: string | null;
  reviewerLogin: string;
  body: string;
  file: string | null;
  line: number | null;
  threadId: string | null;
}
