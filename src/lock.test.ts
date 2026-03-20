import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireFileLock, inspectFileLock } from "./core/lock";

function currentTestOwner(): string {
  try {
    const { username } = os.userInfo();
    if (username) {
      return username;
    }
  } catch {
    // Fall through to environment-based owner detection.
  }

  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}

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

test("acquireFileLock writes host and owner metadata into new lock payloads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "issues", "issue-643.lock");

  const lock = await acquireFileLock(lockPath, "issue-643");
  assert.equal(lock.acquired, true);

  const payload = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    pid: number;
    label: string;
    acquired_at: string;
    host?: string;
    owner?: string;
  };

  assert.equal(payload.pid, process.pid);
  assert.equal(payload.label, "issue-643");
  assert.match(payload.acquired_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(payload.host, os.hostname());
  assert.equal(typeof payload.owner, "string");
  assert.notEqual(payload.owner, "");

  await lock.release();
});

test("inspectFileLock keeps legacy lock payloads readable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "issues", "issue-legacy.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: process.pid,
      label: "issue-legacy",
      acquired_at: "2026-03-20T00:00:00.000Z",
    }, null, 2)}\n`,
    "utf8",
  );

  const existing = await inspectFileLock(lockPath);

  assert.equal(existing.status, "live");
  assert.deepEqual(existing.payload, {
    pid: process.pid,
    label: "issue-legacy",
    acquired_at: "2026-03-20T00:00:00.000Z",
  });
});

test("inspectFileLock distinguishes stale local locks from ambiguous owner locks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const staleLockPath = path.join(root, "issues", "issue-stale.lock");
  const ambiguousLockPath = path.join(root, "issues", "issue-ambiguous.lock");
  await fs.mkdir(path.dirname(staleLockPath), { recursive: true });

  await fs.writeFile(
    staleLockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "issue-stale",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: os.hostname(),
      owner: currentTestOwner(),
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    ambiguousLockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "issue-ambiguous",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const stale = await inspectFileLock(staleLockPath);
  const ambiguous = await inspectFileLock(ambiguousLockPath);

  assert.equal(stale.status, "stale");
  assert.equal(ambiguous.status, "ambiguous_owner");
});

test("acquireFileLock refuses to clean up ambiguous owner locks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "issues", "issue-ambiguous-acquire.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "issue-ambiguous-acquire",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const lock = await acquireFileLock(lockPath, "issue-ambiguous-acquire");

  assert.equal(lock.acquired, false);
  assert.match(lock.reason ?? "", /ambiguous owner/i);
  await fs.access(lockPath);
});

test("acquireFileLock can reclaim ambiguous owner locks when explicitly allowed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-lock-"));
  const lockPath = path.join(root, "supervisor", "run.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const lock = await acquireFileLock(lockPath, "supervisor-loop", {
    allowAmbiguousOwnerCleanup: true,
  });

  assert.equal(lock.acquired, true);
  const payload = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    pid: number;
    label: string;
    acquired_at: string;
    host?: string;
    owner?: string;
  };
  assert.equal(payload.pid, process.pid);
  assert.equal(payload.label, "supervisor-loop");

  await lock.release();
  await assert.rejects(fs.access(lockPath));
});
