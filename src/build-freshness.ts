import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const BUILD_MANIFEST_VERSION = 1;
const BUILD_MANIFEST_FILE = "build-manifest.json";
const HASHED_ROOT_FILES = ["package.json", "tsconfig.json"];

interface BuildManifest {
  schemaVersion: number;
  builtAt: string;
  sourceDigest: string;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function listHashedSourceFiles(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listHashedSourceFiles(fullPath);
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      return [fullPath];
    }
    return [];
  }));

  return files.flat().sort();
}

export async function computeBuildSourceDigest(repoRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const sourceFiles = await listHashedSourceFiles(path.join(repoRoot, "src"));
  const inputFiles = [
    ...HASHED_ROOT_FILES.map((file) => path.join(repoRoot, file)),
    ...sourceFiles,
  ];

  for (const filePath of inputFiles) {
    const relativePath = normalizeRelativePath(path.relative(repoRoot, filePath));
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function buildManifestPath(repoRoot: string): string {
  return path.join(repoRoot, "dist", BUILD_MANIFEST_FILE);
}

export async function writeBuildManifest(repoRoot: string = path.resolve(__dirname, "..")): Promise<void> {
  const manifest: BuildManifest = {
    schemaVersion: BUILD_MANIFEST_VERSION,
    builtAt: new Date().toISOString(),
    sourceDigest: await computeBuildSourceDigest(repoRoot),
  };
  await fs.mkdir(path.join(repoRoot, "dist"), { recursive: true });
  await fs.writeFile(buildManifestPath(repoRoot), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function shouldEnforceRuntimeFreshness(entryScript: string | undefined): entryScript is string {
  if (typeof entryScript !== "string" || entryScript.length === 0) {
    return false;
  }
  const normalized = entryScript.split(path.sep).join("/");
  return normalized.endsWith("/dist/index.js");
}

async function readBuildManifest(repoRoot: string): Promise<BuildManifest> {
  const manifestPath = buildManifestPath(repoRoot);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    throw staleRuntimeError(repoRoot, "dist/build-manifest.json is missing");
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw staleRuntimeError(repoRoot, "dist/build-manifest.json is not valid JSON");
  }

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest as { schemaVersion?: unknown }).schemaVersion !== BUILD_MANIFEST_VERSION ||
    typeof (manifest as { sourceDigest?: unknown }).sourceDigest !== "string"
  ) {
    throw staleRuntimeError(repoRoot, "dist/build-manifest.json is missing required fields");
  }

  return manifest as BuildManifest;
}

function staleRuntimeError(repoRoot: string, detail: string): Error {
  return new Error(
    `Stale compiled runtime detected: ${detail}. This checkout changed without rebuilding dist/. Run \`npm run build\` in ${repoRoot} and retry.`,
  );
}

export async function assertRuntimeFreshness(entryScript: string | undefined = process.argv[1]): Promise<void> {
  if (!shouldEnforceRuntimeFreshness(entryScript)) {
    return;
  }

  const repoRoot = path.resolve(path.dirname(entryScript), "..");
  const manifest = await readBuildManifest(repoRoot);
  const currentDigest = await computeBuildSourceDigest(repoRoot);
  if (currentDigest !== manifest.sourceDigest) {
    throw staleRuntimeError(repoRoot, "src/, package.json, or tsconfig.json no longer match the compiled dist/ output");
  }
}

if (require.main === module) {
  void writeBuildManifest().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
