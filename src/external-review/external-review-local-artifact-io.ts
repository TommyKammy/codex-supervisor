import fs from "node:fs/promises";
import path from "node:path";
import { parseJson } from "../utils";
import { type LocalReviewArtifactLike } from "./external-review-classifier";

export async function loadLocalReviewArtifact(summaryPath: string | null): Promise<{
  findingsPath: string | null;
  artifact: LocalReviewArtifactLike | null;
  available: boolean;
}> {
  if (!summaryPath || path.extname(summaryPath) !== ".md") {
    return { findingsPath: null, artifact: null, available: false };
  }

  const findingsPath = `${summaryPath.slice(0, -3)}.json`;
  try {
    const raw = await fs.readFile(findingsPath, "utf8");
    return {
      findingsPath,
      artifact: parseJson<LocalReviewArtifactLike>(raw, findingsPath),
      available: true,
    };
  } catch {
    return { findingsPath, artifact: null, available: false };
  }
}
