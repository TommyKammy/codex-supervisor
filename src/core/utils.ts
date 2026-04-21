import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function truncate(input: string | null | undefined, maxLength = 4000): string | null {
  if (!input) {
    return null;
  }

  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 3)}...`;
}

export function truncatePreservingStartAndEnd(
  input: string | null | undefined,
  maxLength = 4000,
  truncationMarker = "\n...\n",
): string | null {
  if (!input) {
    return null;
  }

  if (input.length <= maxLength) {
    return input;
  }

  if (maxLength <= truncationMarker.length) {
    return truncationMarker.slice(0, maxLength);
  }

  const availableLength = maxLength - truncationMarker.length;
  const prefixLength = Math.ceil(availableLength / 2);
  const suffixLength = Math.floor(availableLength / 2);
  return `${input.slice(0, prefixLength)}${truncationMarker}${input.slice(input.length - suffixLength)}`;
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${randomUUID()}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseJson<T>(raw, filePath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isTerminalState(state: string): boolean {
  return state === "done" || state === "blocked" || state === "failed";
}

export function isLoopAdvanceableState(state: string | null | undefined): boolean {
  if (!state) {
    return false;
  }

  return !isTerminalState(state);
}

export function resolveMaybeRelative(baseDir: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

export function parseJson<T>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${source}: ${message}`, { cause: error });
  }
}

export function isValidGitRefName(ref: string): boolean {
  if (
    ref.trim() === "" ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("\\") ||
    ref.includes("//")
  ) {
    return false;
  }

  if (/[\u0000-\u001F\u007F ~^:?*\[]/.test(ref)) {
    return false;
  }

  return ref.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.endsWith(".lock"));
}

export function hoursSince(isoTimestamp: string): number {
  const timestampMs = Date.parse(isoTimestamp);
  if (Number.isNaN(timestampMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - timestampMs) / 3_600_000;
}
