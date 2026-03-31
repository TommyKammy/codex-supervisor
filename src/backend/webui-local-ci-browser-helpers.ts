export interface BrowserLocalCiContractLike {
  configured?: boolean;
  command?: string | null;
  recommendedCommand?: string | null;
  source?: string | null;
  summary?: string | null;
}

export interface BrowserChecklistItemLike {
  title: string;
  tone: string;
  meta: string[];
  notes: string[];
}

export interface BrowserLocalCiContractSummary {
  configured: boolean;
  command: string | null;
  recommendedCommand: string | null;
  source: string;
  summary: string;
}

export function normalizeLocalCiContract(
  contract: BrowserLocalCiContractLike | null | undefined,
): BrowserLocalCiContractSummary {
  return {
    configured: contract?.configured === true,
    command: typeof contract?.command === "string" && contract.command.trim() !== "" ? contract.command : null,
    recommendedCommand:
      typeof contract?.recommendedCommand === "string" && contract.recommendedCommand.trim() !== ""
        ? contract.recommendedCommand
        : null,
    source: typeof contract?.source === "string" && contract.source.trim() !== "" ? contract.source : "config",
    summary:
      typeof contract?.summary === "string" && contract.summary.trim() !== ""
        ? contract.summary
        : "No repo-owned local CI contract is configured.",
  };
}

export function formatLocalCiContractSource(source: string | null | undefined): string {
  return String(source ?? "config").replace(/_/gu, " ");
}

export function buildLocalCiContractStatusLines(
  contract: BrowserLocalCiContractLike | null | undefined,
): string[] {
  if (contract === null || contract === undefined) {
    return [];
  }

  const normalizedContract = normalizeLocalCiContract(contract);
  return [
    [
      "local ci",
      "configured=" + (normalizedContract.configured ? "yes" : "no"),
      "source=" + formatLocalCiContractSource(normalizedContract.source),
      "command=" + (normalizedContract.command ?? "none"),
      "recommended command=" + (normalizedContract.recommendedCommand ?? "none"),
    ].join(" "),
    normalizedContract.summary,
  ];
}

export function canAdoptRecommendedLocalCiCommand(
  contract: BrowserLocalCiContractLike | null | undefined,
  hasLocalCiInput: boolean,
): boolean {
  const normalizedContract = normalizeLocalCiContract(contract);
  return hasLocalCiInput && normalizedContract.recommendedCommand !== null;
}

export function buildLocalCiContractChecklistItems(
  contract: BrowserLocalCiContractLike | null | undefined,
): BrowserChecklistItemLike[] {
  const normalizedContract = normalizeLocalCiContract(contract);
  return [{
    title: "Configured: " + (normalizedContract.configured ? "yes" : "no"),
    tone: "",
    meta: [
      "Command: " + (normalizedContract.command ?? "none"),
      "Source: " + formatLocalCiContractSource(normalizedContract.source),
      ...(normalizedContract.recommendedCommand !== null
        ? ["Recommended command: " + normalizedContract.recommendedCommand]
        : []),
    ],
    notes: normalizedContract.configured
      ? [
        "This repo-owned command is the canonical local verification step before PR publication or update.",
        "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
      ]
      : normalizedContract.recommendedCommand !== null
        ? [
          "This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured.",
          "This warning is advisory only; first-run setup readiness and blocker semantics stay unchanged until you opt in by configuring localCiCommand.",
        ]
        : [
          "If the repo does not declare this contract, codex-supervisor falls back to the issue's ## Verification guidance and operator workflow.",
          "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
        ],
  }];
}
