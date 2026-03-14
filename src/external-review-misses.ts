import {
  collectExternalReviewSignals,
  normalizeExternalReviewFinding,
  normalizeExternalReviewSignal,
  type NormalizedExternalReviewFinding,
  type ExternalReviewSignalEnvelope,
  type ExternalReviewSignalSourceKind,
} from "./external-review-normalization";
import {
  classifyExternalReviewFinding,
  type ExternalReviewMatch,
  type ExternalReviewMissFinding,
  type LocalReviewArtifactLike,
} from "./external-review-classifier";
import {
  type ExternalReviewDurableGuardrailCandidate,
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
  collectExternalReviewSignals,
  normalizeExternalReviewFinding,
  normalizeExternalReviewSignal,
  type ExternalReviewMissArtifact,
  type ExternalReviewMatch,
  type ExternalReviewDurableGuardrailCandidate,
  type ExternalReviewMissContext,
  type ExternalReviewMissFinding,
  type ExternalReviewMissPattern,
  type ExternalReviewPromptFinding,
  type ExternalReviewRegressionCandidate,
  type ExternalReviewSignalEnvelope,
  type ExternalReviewSignalSourceKind,
  type LocalReviewArtifactLike,
  type NormalizedExternalReviewFinding,
};
