import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  collectLocalReviewChangedFiles,
  loadLocalReviewExternalReviewContext,
  prepareLocalReviewRoleSelection,
  selectLocalReviewRoles,
} from "./local-review-preparation";
import { createConfig, createDetectedRoles, createMissPattern } from "./local-review-test-helpers";
import { type LocalReviewRoleSelection } from "./review-role-detector";

test("selectLocalReviewRoles preserves configured roles before detected or default roles", () => {
  assert.deepEqual(
    selectLocalReviewRoles({
      config: { localReviewRoles: ["security_reviewer"] },
      detectedRoles: createDetectedRoles(),
    }),
    ["security_reviewer"],
  );

  assert.deepEqual(
    selectLocalReviewRoles({
      config: { localReviewRoles: [] },
      detectedRoles: createDetectedRoles(),
    }),
    ["reviewer", "prisma_postgres_reviewer"],
  );

  assert.deepEqual(
    selectLocalReviewRoles({
      config: { localReviewRoles: [] },
      detectedRoles: [],
    }),
    ["reviewer", "explorer"],
  );
});

test("prepareLocalReviewRoleSelection skips auto-detect when roles are configured or disabled", async () => {
  let detectCalls = 0;
  const detectRoles = async (): Promise<LocalReviewRoleSelection[]> => {
    detectCalls += 1;
    return createDetectedRoles();
  };

  const configured = await prepareLocalReviewRoleSelection({
    config: createConfig({ localReviewRoles: ["security_reviewer"], localReviewAutoDetect: true }),
    detectRoles,
  });
  assert.equal(detectCalls, 0);
  assert.deepEqual(configured.detectedRoles, []);
  assert.deepEqual(configured.roles, ["security_reviewer"]);

  const disabled = await prepareLocalReviewRoleSelection({
    config: createConfig({ localReviewRoles: [], localReviewAutoDetect: false }),
    detectRoles,
  });
  assert.equal(detectCalls, 0);
  assert.deepEqual(disabled.detectedRoles, []);
  assert.deepEqual(disabled.roles, ["reviewer", "explorer"]);

  const autodetected = await prepareLocalReviewRoleSelection({
    config: createConfig({ localReviewRoles: [], localReviewAutoDetect: true }),
    detectRoles,
  });
  assert.equal(detectCalls, 1);
  assert.deepEqual(autodetected.detectedRoles, createDetectedRoles());
  assert.deepEqual(autodetected.roles, ["reviewer", "prisma_postgres_reviewer"]);
});

test("collectLocalReviewChangedFiles preserves exact paths from NUL-delimited git diff output", async () => {
  const changedFiles = await collectLocalReviewChangedFiles({
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    runGitDiff: async () => "src/a.ts\0 src/b.ts \0",
  });

  assert.deepEqual(changedFiles, ["src/a.ts", " src/b.ts "]);
});

test("loadLocalReviewExternalReviewContext filters committed patterns to changed files and loads runtime/prior variants", async () => {
  const loadRelevantCalls: Array<{
    artifactDir: string;
    branch: string;
    currentHeadSha: string;
    changedFiles: string[];
    limit?: number;
    workspacePath?: string;
  }> = [];
  const committedPatterns = [
    createMissPattern({
      fingerprint: "src-old",
      file: "src/changed.ts",
      lastSeenAt: "2026-03-10T00:00:00Z",
    }),
    createMissPattern({
      fingerprint: "unrelated",
      file: "src/ignored.ts",
      lastSeenAt: "2026-03-12T00:00:00Z",
    }),
    createMissPattern({
      fingerprint: "src-new",
      file: "src/changed.ts",
      lastSeenAt: "2026-03-13T00:00:00Z",
    }),
    createMissPattern({
      fingerprint: "docs",
      file: "docs/guide.md",
      lastSeenAt: "2026-03-14T00:00:00Z",
    }),
  ];
  const runtimePatterns = [createMissPattern({ fingerprint: "runtime", file: "src/changed.ts" })];
  const priorPatterns = [createMissPattern({ fingerprint: "prior", file: "src/changed.ts" })];

  const context = await loadLocalReviewExternalReviewContext({
    config: { localReviewArtifactDir: "/tmp/reviews", repoSlug: "owner/repo" },
    issue: { number: 42 },
    branch: "codex/issue-42",
    workspacePath: "/tmp/repo",
    currentHeadSha: "head123",
    changedFiles: ["src/changed.ts", "docs/guide.md"],
    loadCommittedPatterns: async () => committedPatterns,
    loadRelevantPatterns: async (args) => {
      loadRelevantCalls.push(args);
      return args.workspacePath ? priorPatterns : runtimePatterns;
    },
  });

  assert.deepEqual(
    context.committedExternalReviewPatterns.map((pattern) => pattern.fingerprint),
    ["docs", "src-new", "src-old"],
  );
  assert.deepEqual(context.runtimeExternalReviewPatterns, runtimePatterns);
  assert.deepEqual(context.priorMissPatterns, priorPatterns);
  assert.deepEqual(loadRelevantCalls, [
    {
      artifactDir: path.join("/tmp/reviews", "owner-repo", "issue-42"),
      branch: "codex/issue-42",
      currentHeadSha: "head123",
      changedFiles: ["src/changed.ts", "docs/guide.md"],
      limit: 3,
    },
    {
      artifactDir: path.join("/tmp/reviews", "owner-repo", "issue-42"),
      branch: "codex/issue-42",
      currentHeadSha: "head123",
      changedFiles: ["src/changed.ts", "docs/guide.md"],
      limit: 3,
      workspacePath: "/tmp/repo",
    },
  ]);
});
