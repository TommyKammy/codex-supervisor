import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findSubprocessSafetyFindings } from "./subprocess-safety";

test("repo-owned subprocess contract uses resolved executables, bounded timeouts, and no shell trampolines", async () => {
  const findings = await findSubprocessSafetyFindings({
    workspacePath: process.cwd(),
    filePaths: [
      "src/build.test.ts",
      "src/local-ci.test.ts",
      "scripts/check-workstation-local-paths.ts",
    ],
  });

  assert.deepEqual(findings, []);
});

test("default subprocess safety scan discovers verifier scripts under scripts/", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "subprocess-safety-workspace-"));
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(workspacePath, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, "scripts", "check-example.ts"),
    'import { spawnSync } from "node:child_process";\nspawnSync("npm", ["run", "build"], { encoding: "utf8" });\n',
    "utf8",
  );

  const findings = await findSubprocessSafetyFindings({ workspacePath });

  assert.deepEqual(
    findings,
    [
      {
        filePath: "scripts/check-example.ts",
        line: 2,
        ruleId: "bounded_timeout_required",
        summary: "spawnSync must set a bounded timeout in repo-owned tests and verifier scripts.",
      },
      {
        filePath: "scripts/check-example.ts",
        line: 2,
        ruleId: "resolved_executable_required",
        summary: 'spawnSync should use a resolved executable path for "npm" instead of relying on PATH lookup.',
      },
    ],
  );
});
