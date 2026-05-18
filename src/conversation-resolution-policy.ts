import type { GitHubPullRequest } from "./core/types";

export type RequiredConversationResolutionState = "enabled" | "disabled" | "unavailable" | "unknown";

export interface RequiredConversationResolutionEvidence {
  state: RequiredConversationResolutionState;
  source?: string | null;
  details?: string[] | null;
}

export function conversationResolutionEvidence(
  pr: Pick<GitHubPullRequest, "requiredConversationResolution">,
): RequiredConversationResolutionEvidence {
  return pr.requiredConversationResolution ?? {
    state: "unknown",
    source: "not_fetched",
    details: ["required_conversation_resolution=unknown"],
  };
}

export function conversationResolutionEvidenceToken(
  pr: Pick<GitHubPullRequest, "requiredConversationResolution">,
): string {
  return `required_conversation_resolution=${conversationResolutionEvidence(pr).state}`;
}

export function conversationResolutionEvidenceDetails(
  pr: Pick<GitHubPullRequest, "requiredConversationResolution">,
): string[] {
  const evidence = conversationResolutionEvidence(pr);
  return [
    conversationResolutionEvidenceToken(pr),
    ...(evidence.source ? [`required_conversation_resolution_source=${evidence.source}`] : []),
    ...(evidence.details ?? []).filter((detail) => detail !== conversationResolutionEvidenceToken(pr)),
  ];
}

export function conversationResolutionEvidenceContradictsBlocker(
  pr: Pick<GitHubPullRequest, "requiredConversationResolution">,
): boolean {
  return conversationResolutionEvidence(pr).state === "disabled";
}
