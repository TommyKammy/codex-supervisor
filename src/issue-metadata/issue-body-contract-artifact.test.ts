import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GitHubIssue } from "../core/types";
import { createIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";

interface IssueBodyExample {
  name: string;
  kind: "standalone" | "sequenced-child";
  valid: boolean;
  body: string;
  expectedMissingRequired?: string[];
  expectedMetadataErrors?: string[];
}

interface IssueBodyContract {
  contractName: string;
  contractVersion: number;
  canonicalGuide: string;
  requiredSections: string[];
  standaloneDefaults: {
    dependsOn: string;
    parallelizable: "No" | "Yes";
    executionOrder: string;
    partOf: null;
  };
  sequencedChildMetadata: {
    partOfPattern: string;
    dependsOnPattern: string;
    parallelizable: "No" | "Yes";
    executionOrderPattern: string;
  };
  examples: IssueBodyExample[];
}

const contractPath = resolve(process.cwd(), "docs/issue-body-contract.schema.json");

function readContract(): IssueBodyContract {
  return JSON.parse(readFileSync(contractPath, "utf8")) as IssueBodyContract;
}

function createIssue(body: string): GitHubIssue {
  return {
    number: 100,
    title: "Contract example",
    body,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    url: "https://example.com/issues/100",
    labels: [{ name: "codex" }],
    state: "OPEN",
  };
}

test("published issue body contract captures required sections and scheduling shapes", () => {
  const contract = readContract();

  assert.equal(contract.contractName, "codex-supervisor.issue-body-contract");
  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.canonicalGuide, "docs/issue-metadata.md");
  assert.deepEqual(contract.requiredSections, [
    "Summary",
    "Scope",
    "Acceptance criteria",
    "Verification",
  ]);
  assert.deepEqual(contract.standaloneDefaults, {
    dependsOn: "none",
    parallelizable: "No",
    executionOrder: "1 of 1",
    partOf: null,
  });
  assert.match(contract.sequencedChildMetadata.partOfPattern, /Part of/u);
  assert.match(contract.sequencedChildMetadata.dependsOnPattern, /Depends on/u);
  assert.match(contract.sequencedChildMetadata.executionOrderPattern, /N of M/u);
});

test("published issue body contract examples match issue-lint behavior", () => {
  const contract = readContract();

  assert.ok(
    contract.examples.some((example) => example.kind === "standalone" && example.valid),
    "contract must include a valid standalone example",
  );
  assert.ok(
    contract.examples.some((example) => example.kind === "sequenced-child" && example.valid),
    "contract must include a valid sequenced child example",
  );
  assert.ok(
    contract.examples.some((example) => !example.valid),
    "contract must include at least one invalid example",
  );

  for (const example of contract.examples) {
    const lint = createIssueLintDto(createIssue(example.body));
    assert.equal(lint.executionReady, example.valid, example.name);
    assert.deepEqual(
      lint.missingRequired,
      example.expectedMissingRequired ?? [],
      `${example.name} missingRequired`,
    );
    assert.deepEqual(
      lint.metadataErrors,
      example.expectedMetadataErrors ?? [],
      `${example.name} metadataErrors`,
    );
  }
});
