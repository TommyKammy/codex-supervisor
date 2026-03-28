export interface PersistedArtifactPromotionIdentity {
  issueNumber?: number | null;
  prNumber?: number | null;
  branch?: string | null;
  headSha?: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isNullablePromotionEvidenceString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

export function hasMatchingPromotionIdentity(
  artifact: PersistedArtifactPromotionIdentity,
  context: PersistedArtifactPromotionIdentity,
): boolean {
  return (
    matchesOptionalNumber(artifact.issueNumber, context.issueNumber) &&
    matchesOptionalNumber(artifact.prNumber, context.prNumber) &&
    matchesOptionalString(artifact.branch, context.branch) &&
    matchesOptionalString(artifact.headSha, context.headSha)
  );
}

function matchesOptionalNumber(actual: unknown, expected: number | null | undefined): boolean {
  if (expected == null) {
    return true;
  }

  return typeof actual === "number" && Number.isInteger(actual) && actual === expected;
}

function matchesOptionalString(actual: unknown, expected: string | null | undefined): boolean {
  if (expected == null) {
    return true;
  }

  return typeof actual === "string" && actual === expected;
}
