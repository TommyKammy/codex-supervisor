import { execFileSync } from "node:child_process";

const EXECUTABLE_RESOLUTION_TIMEOUT_MS = 5_000;
export const REPO_OWNED_SUBPROCESS_TIMEOUT_MS = 30_000;

export function resolveExecutablePath(executable: string): string {
  const resolver = process.platform === "win32" ? "where" : "which";
  const resolved = execFileSync(resolver, [executable], {
    encoding: "utf8",
    timeout: EXECUTABLE_RESOLUTION_TIMEOUT_MS,
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!resolved) {
    throw new Error(`Unable to resolve executable path for ${JSON.stringify(executable)}.`);
  }

  return resolved;
}
