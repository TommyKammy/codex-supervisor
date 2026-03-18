import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
} from "./supervisor-test-helpers";

async function writeExternalReviewDigest(args: {
  artifactPath: string;
  headStatus: "current-head" | "stale-head";
  missedFindings: number;
  sections: string[];
}): Promise<void> {
  await fs.mkdir(path.dirname(args.artifactPath), { recursive: true });
  await fs.writeFile(args.artifactPath, "{}\n", "utf8");
  await fs.writeFile(
    args.artifactPath.replace(/\.json$/u, ".md"),
    [
      "# External Review Miss Follow-up Digest",
      "",
      `- Miss artifact: ${args.artifactPath}`,
      "- Local review summary: none",
      "- Generated at: 2026-03-18T00:00:00.000Z",
      "- Miss analysis head SHA: deadbeefcafebabe",
      "- Active PR head SHA: deadbeefcafebabe",
      "- Local review artifact head SHA: deadbeefcafebabe",
      `- Head status: ${args.headStatus} (${args.headStatus === "current-head" ? "digest matches the active PR head" : "digest does not match the active PR head"})`,
      `- Missed findings: ${args.missedFindings}`,
      "",
      ...args.sections,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("status reports compact unresolved external-review follow-up actions for a current-head digest", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const artifactPath = path.join(
    fixture.workspaceRoot,
    "reviews",
    "owner-repo",
    `issue-${issueNumber}`,
    "external-review-misses-head-deadbeefcafe.json",
  );
  await writeExternalReviewDigest({
    artifactPath,
    headStatus: "current-head",
    missedFindings: 2,
    sections: [
      "## Durable guardrail (1 finding)",
      "",
      "## Regression test (1 finding)",
    ],
  });

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch: branchName(fixture.config, issueNumber),
    workspace,
    journal_path: null,
    pr_number: 92,
    external_review_head_sha: "deadbeefcafebabe",
    external_review_misses_path: artifactPath,
    external_review_missed_findings_count: 2,
    last_error: null,
    last_failure_context: null,
    last_failure_signature: null,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /external_review_follow_up unresolved=2 actions=durable_guardrail:1\|regression_test:1/);
});

test("status hides unresolved external-review follow-up actions when the digest is stale-head", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const artifactPath = path.join(
    fixture.workspaceRoot,
    "reviews",
    "owner-repo",
    `issue-${issueNumber}`,
    "external-review-misses-head-deadbeefcafe.json",
  );
  await writeExternalReviewDigest({
    artifactPath,
    headStatus: "stale-head",
    missedFindings: 2,
    sections: [
      "## Durable guardrail (1 finding)",
      "",
      "## Regression test (1 finding)",
    ],
  });

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch: branchName(fixture.config, issueNumber),
    workspace,
    journal_path: null,
    pr_number: 92,
    external_review_head_sha: "oldheadcafebabe",
    external_review_misses_path: artifactPath,
    external_review_missed_findings_count: 2,
    last_error: null,
    last_failure_context: null,
    last_failure_signature: null,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.doesNotMatch(status, /external_review_follow_up=/);
});
