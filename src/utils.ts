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

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
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

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTerminalState(state: string): boolean {
  return state === "done" || state === "blocked" || state === "failed";
}

export function resolveMaybeRelative(baseDir: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

export function parseJson<T>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${source}: ${message}`);
  }
}

export function hoursSince(isoTimestamp: string): number {
  const timestampMs = Date.parse(isoTimestamp);
  if (Number.isNaN(timestampMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - timestampMs) / 3_600_000;
}
