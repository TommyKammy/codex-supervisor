import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireFileLock } from "./core/lock";

test("acquireFileLock self-heals malformed lock payloads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "issues", "issue-91.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, "{not json\n", "utf8");

  const lock = await acquireFileLock(lockPath, "issue-91");

  assert.equal(lock.acquired, true);
  await lock.release();
  await assert.rejects(fs.access(lockPath));
});
