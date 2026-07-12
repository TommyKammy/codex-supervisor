import { FailureContext, IssueRunRecord } from "../core/types";
import { truncatePreservingStartAndEnd } from "../core/utils";
import { hasBlockedTurnVerificationProvenance } from "./blocked-turn-pr-reconciliation";

export interface IndependentVerificationBlockerSnapshot {
  lastError: string | null;
  lastBlockerSignature: string | null;
  lastFailureContext: FailureContext;
  lastFailureSignature: string | null;
  repeatedFailureSignatureCount: number;
  repeatedBlockerCount: number;
  blockedVerificationRetryCount: number;
}

export interface IndependentVerificationBlockerPersistenceOptions {
  diagnosticPrefix?: "review_repair_interruption" | "review_repair_terminal";
}

export function independentVerificationBlockerSnapshot(
  record: IssueRunRecord,
): IndependentVerificationBlockerSnapshot | null {
  const carriesTrackedReviewRepairVerifier =
    record.state === "addressing_review" ||
    (record.state === "queued" && record.pr_number !== null);
  if (
    !carriesTrackedReviewRepairVerifier ||
    record.last_failure_context === null ||
    !hasBlockedTurnVerificationProvenance(record)
  ) {
    return null;
  }

  return {
    lastError: record.last_error,
    lastBlockerSignature: record.last_blocker_signature,
    lastFailureContext: record.last_failure_context,
    lastFailureSignature: record.last_failure_signature,
    repeatedFailureSignatureCount: record.repeated_failure_signature_count,
    repeatedBlockerCount: record.repeated_blocker_count,
    blockedVerificationRetryCount: record.blocked_verification_retry_count,
  };
}

function compactPersistenceDetail(value: string, maxLength = 1000): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (normalized || "unknown").slice(0, maxLength);
}

/**
 * Keep an independent verifier failure authoritative until that exact verifier
 * passes, while retaining a later review-repair failure as nested diagnostic
 * evidence. Callers can safely use this over any terminal persistence patch.
 */
export function preserveIndependentVerificationBlockerPatch(
  snapshot: IndependentVerificationBlockerSnapshot,
  nextPatch: Partial<IssueRunRecord>,
  options: IndependentVerificationBlockerPersistenceOptions = {},
): Partial<IssueRunRecord> {
  const diagnosticPrefix =
    options.diagnosticPrefix ?? "review_repair_interruption";
  const supersedingFailureContext = nextPatch.last_failure_context ?? null;
  const supersedingBlockedReason = nextPatch.blocked_reason ?? "unknown";
  const supersedingState = nextPatch.state ?? "unknown";
  const supersedingFailureKind = nextPatch.last_failure_kind ?? "none";
  const diagnosticDetails = [
    `${diagnosticPrefix}_state=${supersedingState}`,
    `${diagnosticPrefix}_blocked_reason=${supersedingBlockedReason}`,
    `${diagnosticPrefix}_failure_kind=${supersedingFailureKind}`,
    ...(supersedingFailureContext
      ? [
          `${diagnosticPrefix}_category=${supersedingFailureContext.category}`,
          `${diagnosticPrefix}_summary=${compactPersistenceDetail(
            supersedingFailureContext.summary,
          )}`,
          ...supersedingFailureContext.details.map(
            (detail) =>
              `${diagnosticPrefix}_detail=${compactPersistenceDetail(detail)}`,
          ),
        ]
      : []),
  ];
  const existingDetails = snapshot.lastFailureContext.details;
  const foundationalDetails = existingDetails
    .filter((detail) => !detail.startsWith("review_repair_"))
    .slice(0, 12);
  const durableBlockedReasonDetails = existingDetails
    .filter((detail) =>
      /^review_repair_(?:interruption|terminal)_blocked_reason=/.test(detail),
    )
    .slice(-8);
  const recentDiagnosticDetails = [
    ...existingDetails.filter(
      (detail) =>
        detail.startsWith("review_repair_") &&
        !/^review_repair_(?:interruption|terminal)_blocked_reason=/.test(
          detail,
        ),
    ),
    ...diagnosticDetails,
  ].slice(-12);
  const details = [
    ...foundationalDetails,
    ...durableBlockedReasonDetails,
    ...recentDiagnosticDetails,
  ].filter((detail, index, all) => all.indexOf(detail) === index);
  const supersedingError = nextPatch.last_error ??
    supersedingFailureContext?.summary ??
    null;
  const foundationalLastError = snapshot.lastError
    ?.split("\n")
    .filter(
      (line) =>
        !/^review_repair_(?:interruption|terminal):/.test(line.trim()),
    )
    .join("\n")
    .trim();
  const lastError = truncatePreservingStartAndEnd(
    [
      foundationalLastError,
      supersedingError
        ? `${diagnosticPrefix}: ${compactPersistenceDetail(supersedingError)}`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n"),
    1000,
  );

  return {
    ...nextPatch,
    state: "blocked",
    blocked_reason: "verification",
    last_error: lastError,
    last_failure_kind: null,
    last_failure_context: {
      ...snapshot.lastFailureContext,
      details,
      updated_at:
        supersedingFailureContext?.updated_at ??
        snapshot.lastFailureContext.updated_at,
    },
    last_failure_signature: snapshot.lastFailureSignature,
    repeated_failure_signature_count:
      snapshot.repeatedFailureSignatureCount,
    last_blocker_signature: snapshot.lastBlockerSignature,
    repeated_blocker_count: snapshot.repeatedBlockerCount,
    blocked_verification_retry_count:
      snapshot.blockedVerificationRetryCount,
  };
}
