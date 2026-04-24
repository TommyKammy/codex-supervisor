import {
  buildBrowserLocalCiChecklistEntries,
  buildBrowserLocalCiStatusLines,
  canAdoptBrowserLocalCiRecommendedCommand,
  canDismissBrowserLocalCiRecommendedCommand,
  formatBrowserToken,
  normalizeBrowserLocalCiContract,
  type BrowserChecklistEntry,
  type BrowserLocalCiContractLike,
} from "./webui-browser-script-helpers";

export type BrowserChecklistItemLike = BrowserChecklistEntry;

export type BrowserLocalCiContractSummary = Required<BrowserLocalCiContractLike>;

export function normalizeLocalCiContract(
  contract: BrowserLocalCiContractLike | null | undefined,
): BrowserLocalCiContractSummary {
  return normalizeBrowserLocalCiContract(contract);
}

export function formatLocalCiContractSource(source: string | null | undefined): string {
  return formatBrowserToken(source);
}

export function buildLocalCiContractStatusLines(
  contract: BrowserLocalCiContractLike | null | undefined,
): string[] {
  return buildBrowserLocalCiStatusLines(contract);
}

export function canAdoptRecommendedLocalCiCommand(
  contract: BrowserLocalCiContractLike | null | undefined,
  hasLocalCiInput: boolean,
): boolean {
  return canAdoptBrowserLocalCiRecommendedCommand(contract, hasLocalCiInput);
}

export function canDismissRecommendedLocalCiCommand(
  contract: BrowserLocalCiContractLike | null | undefined,
): boolean {
  return canDismissBrowserLocalCiRecommendedCommand(contract);
}

export function buildLocalCiContractChecklistItems(
  contract: BrowserLocalCiContractLike | null | undefined,
): BrowserChecklistItemLike[] {
  return buildBrowserLocalCiChecklistEntries(contract);
}
