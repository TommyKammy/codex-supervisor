import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChangedFiles,
  detectDeterministicChangeClasses,
} from "./issue-metadata-change-classification";

test("classifyChangedFiles maps representative paths into deterministic change classes", () => {
  assert.deepEqual(
    classifyChangedFiles([
      "README.md",
      "docs/getting-started.md",
      "src/issue-metadata/issue-metadata.test.ts",
      ".github/workflows/ci.yml",
      "prisma/schema.prisma",
      "infra/docker/Dockerfile",
      "src/supervisor/supervisor.ts",
    ]),
    [
      { path: ".github/workflows/ci.yml", changeClass: "workflow" },
      { path: "docs/getting-started.md", changeClass: "docs" },
      { path: "infra/docker/Dockerfile", changeClass: "infrastructure" },
      { path: "prisma/schema.prisma", changeClass: "schema" },
      { path: "README.md", changeClass: "docs" },
      { path: "src/issue-metadata/issue-metadata.test.ts", changeClass: "tests" },
      { path: "src/supervisor/supervisor.ts", changeClass: "backend" },
    ],
  );
});

test("detectDeterministicChangeClasses returns a sorted unique set of matched classes", () => {
  assert.deepEqual(
    detectDeterministicChangeClasses([
      "docs/getting-started.md",
      "src/a.test.ts",
      "src/supervisor/supervisor.ts",
      "src/b.test.ts",
      "docs/issue-metadata.md",
    ]),
    ["backend", "docs", "tests"],
  );
});
