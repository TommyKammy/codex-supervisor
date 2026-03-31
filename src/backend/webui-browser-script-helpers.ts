export type BrowserChecklistEntry = {
  title: string;
  tone: string;
  meta: string[];
  notes: string[];
};

export type BrowserLocalCiContractLike = {
  configured?: boolean | null;
  command?: string | null;
  recommendedCommand?: string | null;
  source?: string | null;
  summary?: string | null;
};

export type BrowserHostLike = {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  } | null;
  prompt?(message: string): string | null;
};

export type BrowserMutationResponsePayload = {
  payload: unknown;
  rawText: string;
  parseError: boolean;
};

export type BrowserResponseLike = {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  } | null;
  text(): Promise<string>;
};

export type BrowserFetchLike = (
  path: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<BrowserResponseLike>;

export function formatBrowserToken(value: string | null | undefined): string {
  return String(value || "none").replace(/_/gu, " ");
}

export function normalizeBrowserLocalCiContract(
  localCiContract: BrowserLocalCiContractLike | null | undefined,
): Required<BrowserLocalCiContractLike> {
  return {
    configured: Boolean(localCiContract?.configured),
    command: localCiContract?.command ?? null,
    recommendedCommand: localCiContract?.recommendedCommand ?? null,
    source: localCiContract?.source ?? "config",
    summary: localCiContract?.summary ?? "No repo-owned local CI contract is configured.",
  };
}

export function buildBrowserLocalCiStatusLines(
  localCiContract: BrowserLocalCiContractLike | null | undefined,
): string[] {
  if (localCiContract == null) {
    return [];
  }
  const normalized = normalizeBrowserLocalCiContract(localCiContract);
  return [
    [
      "local ci",
      "configured=" + (normalized.configured ? "yes" : "no"),
      "source=" + formatBrowserToken(normalized.source),
      "command=" + (normalized.command ?? "none"),
      "recommended command=" + (normalized.recommendedCommand ?? "none"),
    ].join(" "),
    ...(typeof normalized.summary === "string" && normalized.summary.trim() !== "" ? [normalized.summary] : []),
  ];
}

export function buildBrowserLocalCiChecklistEntries(
  localCiContract: BrowserLocalCiContractLike | null | undefined,
): BrowserChecklistEntry[] {
  const normalized = normalizeBrowserLocalCiContract(localCiContract);
  return [{
    title: "Configured: " + (normalized.configured ? "yes" : "no"),
    tone: "",
    meta: [
      "Command: " + (normalized.command || "none"),
      "Source: " + formatBrowserToken(normalized.source),
      ...(normalized.recommendedCommand ? ["Recommended command: " + normalized.recommendedCommand] : []),
    ],
    notes: normalized.configured
      ? [
        "This repo-owned command is the canonical local verification step before PR publication or update.",
        "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
      ]
      : normalized.recommendedCommand
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

export function canAdoptBrowserLocalCiRecommendedCommand(
  localCiContract: BrowserLocalCiContractLike | null | undefined,
  hasInput: boolean,
): boolean {
  const normalized = normalizeBrowserLocalCiContract(localCiContract);
  return Boolean(normalized.recommendedCommand) && hasInput;
}

export function readStoredMutationAuthToken(host: BrowserHostLike, storageKey: string): string | null {
  try {
    const value = host.localStorage && host.localStorage.getItem(storageKey);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredMutationAuthToken(
  host: BrowserHostLike,
  storageKey: string,
  value: string | null | undefined,
): void {
  try {
    if (!host.localStorage) {
      return;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      host.localStorage.removeItem(storageKey);
      return;
    }
    host.localStorage.setItem(storageKey, value.trim());
  } catch {}
}

export function promptForMutationAuthToken(host: BrowserHostLike, storageKey: string): string {
  if (!host || typeof host.prompt !== "function") {
    throw new Error("WebUI mutation auth requires a browser prompt to collect the token.");
  }
  const value = host.prompt("Enter the local WebUI mutation token.");
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Mutation auth token is required for WebUI write actions.");
  }
  const normalized = value.trim();
  writeStoredMutationAuthToken(host, storageKey, normalized);
  return normalized;
}

export function buildMutationHeaders(token: string | null | undefined, mutationAuthHeader: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (typeof token === "string" && token.length > 0) {
    headers[mutationAuthHeader] = token;
  }
  return headers;
}

export async function readMutationResponsePayload(response: BrowserResponseLike): Promise<BrowserMutationResponsePayload> {
  const headers = response && response.headers;
  const contentType = headers && typeof headers.get === "function" ? String(headers.get("content-type") || "") : "";
  const rawText = typeof response.text === "function" ? await response.text() : "";
  if (!rawText) {
    return { payload: null, rawText: "", parseError: false };
  }
  const prefersJson = contentType.toLowerCase().indexOf("application/json") !== -1;
  try {
    return {
      payload: JSON.parse(rawText),
      rawText,
      parseError: false,
    };
  } catch {
    return {
      payload: null,
      rawText,
      parseError: prefersJson,
    };
  }
}

export async function postMutationJsonWithAuth(
  fetchImpl: BrowserFetchLike,
  host: BrowserHostLike,
  path: string,
  body: unknown,
  options: {
    mutationAuthStorageKey: string;
    mutationAuthHeader: string;
    fallbackBody?: string;
  },
): Promise<unknown> {
  let token = readStoredMutationAuthToken(host, options.mutationAuthStorageKey);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const serializedBody = body === undefined ? options.fallbackBody : JSON.stringify(body);
    const response = await fetchImpl(path, {
      method: "POST",
      headers: buildMutationHeaders(token, options.mutationAuthHeader),
      body: serializedBody,
    });

    const responsePayload = await readMutationResponsePayload(response);
    const payload = responsePayload.payload;
    if (response.ok) {
      if (payload === null) {
        throw new Error(path + ": Server returned invalid JSON response.");
      }
      return payload;
    }

    let message = "Request failed";
    if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
      message = payload.error;
    } else if (responsePayload.rawText.trim().length > 0) {
      message = responsePayload.rawText.trim();
    } else if (responsePayload.parseError) {
      message = "Server returned invalid JSON response.";
    }
    if (response.status === 401) {
      writeStoredMutationAuthToken(host, options.mutationAuthStorageKey, null);
      if (attempt === 0) {
        token = promptForMutationAuthToken(host, options.mutationAuthStorageKey);
        continue;
      }
    }
    throw new Error(path + ": " + message);
  }

  throw new Error(path + ": Mutation auth required.");
}
