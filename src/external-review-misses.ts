import {
  normalizeExternalReviewFinding,
  type NormalizedExternalReviewFinding,
} from "./external-review-normalization";
import {
  classifyExternalReviewFinding,
  type ExternalReviewMatch,
  type ExternalReviewMissFinding,
  type LocalReviewArtifactLike,
} from "./external-review-classifier";
import {
  type ExternalReviewMissArtifact,
  type ExternalReviewMissContext,
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
  type ExternalReviewRegressionCandidate,
} from "./external-review-miss-artifact-types";
export { loadRelevantExternalReviewMissPatterns } from "./external-review-miss-history";
export { writeExternalReviewMissArtifact } from "./external-review-miss-persistence";

export {
  classifyExternalReviewFinding,
  normalizeExternalReviewFinding,
  type ExternalReviewMissArtifact,
  type ExternalReviewMatch,
  type ExternalReviewMissContext,
  type ExternalReviewMissFinding,
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
  type ExternalReviewRegressionCandidate,
  type LocalReviewArtifactLike,
  type NormalizedExternalReviewFinding,
};
