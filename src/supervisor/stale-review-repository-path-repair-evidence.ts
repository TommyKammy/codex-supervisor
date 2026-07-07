import type { ReviewThread } from "../core/types";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewComment,
} from "../codex-connector-review-policy";
import { allCodexConnectorRepairResidueThreadsAreP2 } from "../codex-connector-review-repair-coverage";

export type RepositoryFileContents = Record<string, string | null | undefined>;

function normalizeRepositoryPath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\/+/u, "");
}

function repositoryFileContent(
  contents: RepositoryFileContents | undefined,
  path: string | null | undefined,
): string | null {
  if (!contents || !path) {
    return null;
  }
  const normalizedPath = normalizeRepositoryPath(path);
  return contents[normalizedPath] ?? contents[path] ?? null;
}

function extractConcreteRepoPaths(body: string): string[] {
  const paths = new Set<string>();
  const pathPattern =
    /(?:`([^`\r\n]+\.(?:tsx|jsx|mdx|ya?ml|toml|json|scss|html|conf|txt|ts|js|md|py|rb|go|rs|java|kt|cs|php|sh|sql|ini|cfg|csv|tsv|css))(?![\w.-])`)|((?:[\w.-]+\/)+[\w.-]+\.(?:tsx|jsx|mdx|ya?ml|toml|json|scss|html|conf|txt|ts|js|md|py|rb|go|rs|java|kt|cs|php|sh|sql|ini|cfg|csv|tsv|css))(?![\w.-])/giu;
  for (const match of body.matchAll(pathPattern)) {
    const path = normalizeRepositoryPath(match[1] ?? match[2] ?? "");
    if (path && !path.startsWith("/") && !/^[a-z]:\//iu.test(path) && path.includes("/")) {
      paths.add(path);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function hasAdditivePathListRepairIntent(body: string): boolean {
  if (
    /\b(?:remove|delete|drop|exclude|avoid|deduplicat(?:e|ed|es|ing|ion)|de-duplicat(?:e|ed|es|ing|ion))\b/iu.test(
      body,
    )
  ) {
    return false;
  }

  return (
    /\b(?:add|include|insert|append|restore|register|wire)\b/iu.test(body) &&
    /\b(?:path|paths|list|lists|array|arrays|loader|loaders|scan|scans|coverage|expectation|expectations)\b/iu.test(body)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countExactRepoPathOccurrences(haystack: string, repoPath: string): number {
  const pathTokenBoundary = "[A-Za-z0-9._/-]";
  const pattern = new RegExp(`(?<!${pathTokenBoundary})${escapeRegExp(repoPath)}(?!${pathTokenBoundary})`, "gu");
  return Array.from(haystack.matchAll(pattern)).length;
}

function maskComments(source: string): string {
  let masked = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        masked += char;
        continue;
      }
      masked += source.slice(index, literal.next);
      index = literal.next - 1;
      continue;
    }
    if (char === "/" && next === "/") {
      masked += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        masked += " ";
        index += 1;
      }
      if (source[index] === "\n") {
        masked += "\n";
      }
      continue;
    }
    if (char === "/" && next === "*") {
      masked += "  ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        masked += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        masked += "  ";
        index += 1;
      }
      continue;
    }
    masked += char;
  }
  return masked;
}

function readStringLiteral(source: string, start: number): { value: string; next: number } | null {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return null;
  }

  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped !== undefined) {
        value += escaped;
        index += 1;
      }
      continue;
    }
    if (char === quote) {
      return { value, next: index + 1 };
    }
    value += char;
  }

  return null;
}

function matchingArrayEnd(source: string, start: number): number | null {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        return null;
      }
      index = literal.next - 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function directStringValuesInArray(source: string, start: number, end: number): Set<string> {
  const values = new Set<string>();
  let nestingDepth = 0;
  for (let index = start + 1; index < end; index += 1) {
    const char = source[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        return values;
      }
      if (nestingDepth === 0) {
        values.add(literal.value);
      }
      index = literal.next - 1;
      continue;
    }
    if (char === "[" || char === "{" || char === "(") {
      nestingDepth += 1;
    } else if ((char === "]" || char === "}" || char === ")") && nestingDepth > 0) {
      nestingDepth -= 1;
    }
  }
  return values;
}

interface RequestedPathListSelector {
  label: string;
  requiredTokens: string[];
  allowExpectationTokens: boolean;
}

function requestedPathListSelectors(body: string): RequestedPathListSelector[] {
  const selectors: RequestedPathListSelector[] = [];
  const normalizedBody = body.toLowerCase();
  const addSelector = (selector: RequestedPathListSelector) => {
    if (!selectors.some((candidate) => candidate.label === selector.label)) {
      selectors.push(selector);
    }
  };

  if (/\bload(?:er|ers|ing)?\b/iu.test(body)) {
    addSelector({ label: "loader", requiredTokens: ["loader"], allowExpectationTokens: false });
  }
  if (/\bpolicy\s+scans?\b/iu.test(body)) {
    addSelector({ label: "policy_scan", requiredTokens: ["policy", "scan"], allowExpectationTokens: false });
  } else if (/\bscans?\b/iu.test(body)) {
    addSelector({ label: "scan", requiredTokens: ["scan"], allowExpectationTokens: false });
  }
  if (/\bcoverage\b/iu.test(body) && /\bexpect(?:ation|ations|ed)?\b/iu.test(body)) {
    addSelector({
      label: "coverage_expectation",
      requiredTokens: ["coverage", "expect"],
      allowExpectationTokens: true,
    });
  }

  return normalizedBody.includes("list") || normalizedBody.includes("array") ? selectors : [];
}

function identifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .map((token) => {
      const singular = token.replace(/s$/u, "");
      return singular.startsWith("expect") ? "expect" : singular;
    });
}

function arrayIdentifierContextTokens(source: string, arrayStart: number): string[] {
  const prefix = source.slice(Math.max(0, arrayStart - 160), arrayStart);
  const candidates = [
    ...prefix.matchAll(/\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*(?::\s*[^=:\r\n]+)?=\s*$/gu),
    ...prefix.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*$/gu),
  ];
  const context = candidates[candidates.length - 1]?.[1] ?? "";
  return identifierTokens(context);
}

function arrayMatchesRequestedSelector(tokens: string[], selector: RequestedPathListSelector): boolean {
  if (tokens.length === 0 || !selector.requiredTokens.every((token) => tokens.includes(token))) {
    return false;
  }

  if (tokens.some((token) => (
    token === "disable" ||
    token === "disabled" ||
    token === "exclude" ||
    token === "excluded" ||
    token === "exclusion" ||
    token === "ignore" ||
    token === "ignored" ||
    token === "omit" ||
    token === "omitted" ||
    token === "skip" ||
    token === "skipped"
  ))) {
    return false;
  }

  if (!selector.allowExpectationTokens && tokens.some((token) => (
    token === "expect" ||
    token === "expected" ||
    token === "expectation" ||
    token === "fixture" ||
    token === "mock" ||
    token === "sample" ||
    token === "test"
  ))) {
    return false;
  }

  return true;
}

function requestedLiveRepoPathArrayMemberships(
  source: string,
  repoPath: string,
  selectors: RequestedPathListSelector[],
): string[] | null {
  if (countExactRepoPathOccurrences(source, repoPath) === 0) {
    return null;
  }
  if (selectors.length === 0) {
    return null;
  }

  const uncommentedSource = maskComments(source);
  const matchedSelectors = new Set<string>();
  for (let index = 0; index < uncommentedSource.length; index += 1) {
    const char = uncommentedSource[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(uncommentedSource, index);
      if (!literal) {
        continue;
      }
      index = literal.next - 1;
      continue;
    }
    if (char !== "[") {
      continue;
    }

    const end = matchingArrayEnd(uncommentedSource, index);
    if (end === null) {
      continue;
    }
    if (!directStringValuesInArray(uncommentedSource, index, end).has(repoPath)) {
      index = end;
      continue;
    }

    const contextTokens = arrayIdentifierContextTokens(uncommentedSource, index);
    for (const selector of selectors) {
      if (arrayMatchesRequestedSelector(contextTokens, selector)) {
        matchedSelectors.add(selector.label);
      }
    }
    index = end;
  }

  return selectors.every((selector) => matchedSelectors.has(selector.label))
    ? selectors.map((selector) => selector.label)
    : null;
}

export function deterministicRepositoryPathRepairProbeEvidence(args: {
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): string | null {
  const mustFixThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  if (!allCodexConnectorRepairResidueThreadsAreP2(mustFixThreads)) {
    return null;
  }

  const evidence: string[] = [];
  for (const thread of mustFixThreads) {
    const source = repositoryFileContent(args.repositoryFileContents, thread.path);
    if (!source) {
      return null;
    }

    const codexFindingBody = latestCodexConnectorReviewComment(thread)?.body ?? "";
    if (!hasAdditivePathListRepairIntent(codexFindingBody)) {
      return null;
    }
    const requestedPathLists = requestedPathListSelectors(codexFindingBody);
    if (requestedPathLists.length === 0) {
      return null;
    }
    const concretePaths = extractConcreteRepoPaths(codexFindingBody);
    if (concretePaths.length === 0) {
      return null;
    }
    const pathEvidence: string[] = [];
    for (const concretePath of concretePaths) {
      const liveListMemberships = requestedLiveRepoPathArrayMemberships(source, concretePath, requestedPathLists);
      if (!liveListMemberships) {
        return null;
      }
      pathEvidence.push(
        `deterministic_repair_probe:path_present_in_requested_live_lists:${concretePath}:${liveListMemberships.join(",")}`,
      );
    }
    evidence.push(...pathEvidence);
  }

  return evidence.length > 0 ? evidence.join(";") : null;
}

export function requiresDeterministicRepositoryPathRepairProbeEvidence(reviewThreads: ReviewThread[]): boolean {
  return codexConnectorMustFixReviewThreads(reviewThreads).some((thread) => {
    const codexFindingBody = latestCodexConnectorReviewComment(thread)?.body ?? "";
    return (
      requestedPathListSelectors(codexFindingBody).length > 0 &&
      extractConcreteRepoPaths(codexFindingBody).length > 0
    );
  });
}
