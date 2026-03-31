import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("pull-request hydration docs distinguish fresh action paths from informational cache use", async () => {
  const [readme, architecture, configuration] = await Promise.all([
    readDoc("README.md"),
    readDoc("docs/architecture.md"),
    readDoc("docs/configuration.md"),
  ]);

  assert.match(readme, /fresh GitHub PR facts/i);
  for (const content of [architecture, configuration]) {
    assert.match(content, /fresh GitHub review facts/i);
    assert.match(content, /informational and non-authoritative/i);
  }

  assert.match(
    architecture,
    /marking a PR ready, advancing or unblocking review-driven state, and merging must use fresh GitHub review facts/i,
  );
  assert.match(
    configuration,
    /no configuration should treat cached pull-request hydration as authority for readiness, review-blocking, or merge decisions/i,
  );
});
