import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ArtifactTestPaths {
  rootPath: string;
  workspacePath: string;
  reviewDir: string;
}

export async function createArtifactTestPaths(prefix: string): Promise<ArtifactTestPaths> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const workspacePath = path.join(rootPath, "workspace");
  const reviewDir = path.join(rootPath, "reviews");

  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });

  return {
    rootPath,
    workspacePath,
    reviewDir,
  };
}
