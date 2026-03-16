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

test("acquireFileLock reports the owning pid and label when a live session lock is already held", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "sessions", "session-123.lock");

  const first = await acquireFileLock(lockPath, "session-123");
  const second = await acquireFileLock(lockPath, "session-123");

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.match(second.reason ?? "", new RegExp(`lock held by pid ${process.pid} for session-123`));

  await first.release();
  await assert.rejects(fs.access(lockPath));
});
