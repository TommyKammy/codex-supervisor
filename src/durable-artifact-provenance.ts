export const TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE = "trusted-generated-durable-artifact/v1";
export const TRUSTED_GENERATED_DURABLE_ARTIFACT_JSON_KEY = "codexSupervisorProvenance";
export const TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER =
  `<!-- codex-supervisor-provenance: ${TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE} -->`;

export function withTrustedGeneratedDurableArtifactProvenance<T extends object>(
  artifact: T,
): T & { codexSupervisorProvenance: typeof TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE } {
  return {
    ...artifact,
    [TRUSTED_GENERATED_DURABLE_ARTIFACT_JSON_KEY]: TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE,
  } as T & { codexSupervisorProvenance: typeof TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE };
}

export function prependTrustedGeneratedDurableArtifactMarkdownMarker(document: string): string {
  return `${TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER}\n${document}`;
}

export function hasTrustedGeneratedDurableArtifactProvenance(contents: string): boolean {
  if (contents.includes(TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER)) {
    return true;
  }

  const trimmed = contents.trimStart();
  if (!trimmed.startsWith("{")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      !!parsed &&
      !Array.isArray(parsed) &&
      parsed[TRUSTED_GENERATED_DURABLE_ARTIFACT_JSON_KEY] === TRUSTED_GENERATED_DURABLE_ARTIFACT_PROVENANCE_VALUE
    );
  } catch {
    return false;
  }
}
