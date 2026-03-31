import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserLocalCiChecklistEntries,
  buildBrowserLocalCiStatusLines,
  postMutationJsonWithAuth,
} from "./webui-browser-script-helpers";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("shared local CI helpers preserve advisory recommendation wording across surfaces", () => {
  const contract = {
    configured: false,
    command: null,
    recommendedCommand: "npm run verify:pre-pr",
    source: "repo_script_candidate",
    summary:
      "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
  };

  assert.deepEqual(buildBrowserLocalCiStatusLines(contract), [
    "local ci configured=no source=repo script candidate command=none recommended command=npm run verify:pre-pr warning=none",
    "Repo-owned local CI candidate exists but localCiCommand is unset. Recommended command: npm run verify:pre-pr.",
  ]);

  assert.deepEqual(buildBrowserLocalCiChecklistEntries(contract), [{
    title: "Configured: no",
    tone: "",
    meta: [
      "Command: none",
      "Source: repo script candidate",
      "Recommended command: npm run verify:pre-pr",
    ],
    notes: [
      "This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured.",
      "This warning is advisory only; first-run setup readiness and blocker semantics stay unchanged until you opt in by configuring localCiCommand.",
    ],
  }]);
});

test("shared mutation helper retries a 401 after prompting once and preserves dashboard empty-body semantics", async () => {
  const storage = new MemoryStorage();
  const fetchCalls: Array<{ path: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];
  const responses = [
    {
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: "Mutation auth required." }),
    },
    {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true }),
    },
  ];

  const payload = await postMutationJsonWithAuth(
    async (path, init) => {
      fetchCalls.push({ path, init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    {
      localStorage: storage,
      prompt: () => "prompted-secret",
    },
    "/api/commands/run-once",
    undefined,
    {
      mutationAuthStorageKey: "webui-token",
      mutationAuthHeader: "x-webui-token",
      fallbackBody: "{}",
    },
  );

  assert.deepEqual(payload, { ok: true });
  assert.deepEqual(fetchCalls, [
    {
      path: "/api/commands/run-once",
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    },
    {
      path: "/api/commands/run-once",
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-webui-token": "prompted-secret",
        },
        body: "{}",
      },
    },
  ]);
  assert.equal(storage.getItem("webui-token"), "prompted-secret");
});
