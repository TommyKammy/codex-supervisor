import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDir = process.cwd();

test("GitHub DTO types are owned by the GitHub domain module and compatibility-reexported from core types", async () => {
  const [githubTypesSource, coreTypesSource] = await Promise.all([
    fs.readFile(path.join(rootDir, "src", "github", "types.ts"), "utf8"),
    fs.readFile(path.join(rootDir, "src", "core", "types.ts"), "utf8"),
  ]);

  assert.match(githubTypesSource, /export interface GitHubIssue\b/);
  assert.match(githubTypesSource, /export interface GitHubPullRequest\b/);
  assert.match(githubTypesSource, /export interface ReviewThread\b/);
  assert.match(coreTypesSource, /export type \{[\s\S]*GitHubIssue[\s\S]*\} from "\.\.\/github\/types";/);
  assert.doesNotMatch(coreTypesSource, /export interface GitHubIssue\b/);
  assert.doesNotMatch(coreTypesSource, /export interface GitHubPullRequest\b/);
  assert.doesNotMatch(coreTypesSource, /export interface ReviewThread\b/);
});
