import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Supervisor } from "./supervisor";
import { AgentRunner, AgentTurnRequest } from "./agent-runner";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { createConfig, createSupervisorFixture, executionReadyBody } from "./supervisor-test-helpers";

test("runOnce routes supervisor turn execution through an injected agent runner", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 93;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Use the shared agent runner for supervisor turns",
    body: executionReadyBody("Use the shared agent runner for supervisor turns."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const requests: AgentTurnRequest[] = [];
  const agentRunner: AgentRunner = {
    capabilities: {
      supportsResume: true,
      supportsStructuredResult: true,
    },
    async runTurn(request) {
      requests.push(request);
      await fs.appendFile(
        path.join(request.workspacePath, ".codex-supervisor", "issue-journal.md"),
        "\n- What changed: the injected agent runner handled this turn.\n",
        "utf8",
      );
      return {
        exitCode: 0,
        sessionId: "session-agent-runner",
        supervisorMessage: [
          "Summary: completed via injected agent runner",
          "State hint: stabilizing",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: continue",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "completed via injected agent runner",
          stateHint: "stabilizing",
          blockedReason: null,
          failureSignature: null,
          nextAction: "continue",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    },
  };

  const supervisor = new Supervisor(
    createConfig({
      ...fixture.config,
      codexBinary: path.join(path.dirname(fixture.stateFile), "missing-codex"),
    }),
    { agentRunner },
  );
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /issue=#93/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.codex_session_id, "session-agent-runner");
  assert.equal(record.last_failure_kind, null);
  assert.match(record.last_codex_summary ?? "", /completed via injected agent runner/);
});
