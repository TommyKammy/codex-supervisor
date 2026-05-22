export const ISSUE_METADATA_FIELDS = {
  partOf: "Part of",
  dependsOn: "Depends on",
  parallelizable: "Parallelizable",
  executionOrder: "Execution order",
  parallelGroup: "Parallel group",
  touches: "Touches",
} as const;

export const ISSUE_METADATA_KEYS = {
  partOf: "part of",
  dependsOn: "depends on",
  parallelizable: "parallelizable",
  executionOrder: "execution order",
} as const;

export const ISSUE_METADATA_VALUES = {
  dependsOnNone: "none",
  defaultParallelizable: "No",
  defaultExecutionOrder: "1 of 1",
} as const;

export const ISSUE_METADATA_PATTERNS = {
  partOfParseLine: /^\s*(?:-\s+)?Part of:?\s+#(\d+)\s*$/im,
  partOfSyntaxLine: /^\s*(?:-\s+)?Part of\b.*$/im,
  validPartOfSyntaxLine: /^\s*(?:-\s+)?Part of:?\s+#([1-9]\d*)\s*$/i,
  canonicalPartOfReadinessLine: /^\s*(?:-\s+)?Part of:\s+#\d+\s*$/im,
  executionOrderLineDeclaration: /^\s*Execution order:[^\r\n]*$/gim,
  executionOrderHeadingDeclaration: /^\s*##\s*Execution order\s*$[\r\n]+^[^\r\n]*$/gim,
  executionOrderHeadingValue: /^\s*##\s*Execution order\s*$[\r\n]+^\s*(\d+)\s+of\s+(\d+)\s*$/im,
  executionOrderLineValue: /^\s*Execution order:\s*(\d+)\s+of\s+(\d+)\s*$/im,
  validDependsOnValue: /^(?:none|#(?:[1-9]\d*)(?:\s*,\s*#(?:[1-9]\d*))*)$/i,
  validParallelizableValue: /^(?:yes|no)$/i,
} as const;

export function escapeMetadataRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createMetadataLineDeclarationPattern(fieldName: string): RegExp {
  return new RegExp(`^\\s*${escapeMetadataRegExp(fieldName)}:[^\\r\\n]*$`, "gim");
}

export function createMetadataLineValuePattern(fieldName: string): RegExp {
  return new RegExp(`^\\s*${escapeMetadataRegExp(fieldName)}:[^\\S\\r\\n]*(.*)$`, "gim");
}

export function countMetadataLineDeclarations(body: string, fieldName: string): number {
  return [...body.matchAll(createMetadataLineDeclarationPattern(fieldName))].length;
}

export function getSingleMetadataLineValue(body: string, fieldName: string): string | null {
  const matches = [...body.matchAll(createMetadataLineValuePattern(fieldName))];
  if (matches.length !== 1) {
    return null;
  }

  return matches[0][1].trim();
}

export function countExecutionOrderDeclarations(body: string): number {
  return [
    ...body.matchAll(new RegExp(ISSUE_METADATA_PATTERNS.executionOrderLineDeclaration)),
    ...body.matchAll(new RegExp(ISSUE_METADATA_PATTERNS.executionOrderHeadingDeclaration)),
  ].length;
}
