import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./utils";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-utils-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("writeJsonAtomic uses a unique temp path for each write attempt", async (t) => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "state.json");
    const tempPaths: string[] = [];
    const originalWriteFile = fs.writeFile.bind(fs);
    const writeFileMock = mock.method(
      fs,
      "writeFile",
      async (...args: Parameters<typeof fs.writeFile>) => {
        tempPaths.push(String(args[0]));
        return originalWriteFile(...args);
      },
    );
    t.after(() => {
      writeFileMock.mock.restore();
    });

    await writeJsonAtomic(filePath, { sequence: 1 });
    await writeJsonAtomic(filePath, { sequence: 2 });

    assert.equal(tempPaths.length, 2);
    assert.notEqual(tempPaths[0], tempPaths[1]);
    assert.equal(path.dirname(tempPaths[0] ?? ""), dir);
    assert.equal(path.dirname(tempPaths[1] ?? ""), dir);
    assert.match(path.basename(tempPaths[0] ?? ""), /^state\.json\.tmp\./);
    assert.match(path.basename(tempPaths[1] ?? ""), /^state\.json\.tmp\./);
    assert.deepEqual(
      (await fs.readdir(dir)).sort(),
      ["state.json"],
    );
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), { sequence: 2 });
  });
});
