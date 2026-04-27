import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

interface PublishedStateMachineContract {
  contractName: string;
  contractVersion: number;
  canonicalSource: string;
  publicStates: Array<{
    state: string;
    internalStates: string[];
    operatorActions: string[];
  }>;
}

interface CodexAutomationConnectorBoundaryArtifact {
  artifactName: string;
  artifactVersion: number;
  canonicalGuide: string;
  enforcementBoundary: string;
  allowedResponsibilities: string[];
  prohibitedBypasses: string[];
  nonGoals: string[];
}

function sortedValues(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function extractRunStateValues(source: string): string[] {
  const runStateMatch = /export type RunState\s*=([\s\S]*?);/u.exec(source);
  assert.ok(runStateMatch, "RunState union must stay discoverable for docs drift tests");
  return [...runStateMatch[1]!.matchAll(/"([a-z0-9_]+)"/gu)].map((match) => match[1]!);
}

test("supervised automation lane product primitive note is repo-owned and discoverable", async () => {
  const [readme, note] = await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/supervised-automation-lane.md"),
  ]);

  const laneLink = /\[Supervised automation lane\]\(\.\/docs\/supervised-automation-lane\.md\)/;
  const docsMapIndex = readme.indexOf("## Docs Map");
  assert.notEqual(docsMapIndex, -1, "README must include a Docs Map section");
  assert.match(readme.slice(0, docsMapIndex), laneLink);
  assert.match(readme.slice(docsMapIndex), laneLink);

  assert.match(note, /^# Supervised Automation Lane$/m);
  assert.match(note, /OpenAI-ready product primitive/i);
  assert.match(note, /chat-driven vibe coding/i);
  assert.match(note, /issue\/spec-driven supervised automation/i);

  for (const primitive of [
    "Task Contract",
    "Trust Posture",
    "Execution Attempt",
    "Evidence Timeline",
    "Operator Action",
    "Bounded Recovery",
    "Durable Memory Writeback",
  ]) {
    assert.match(note, new RegExp(`### ${primitive}`));
  }

  for (const boundary of [
    /GitHub-authored text is execution input, not supervisor policy/i,
    /does not create new automation authority/i,
    /does not default-enable follow-up issue creation/i,
    /trusted solo-lane automation/i,
  ]) {
    assert.match(note, boundary);
  }

  assert.doesNotMatch(note, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(note, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("supervised automation lane documents an auditable work state machine", async () => {
  const note = await readRepoFile("docs/supervised-automation-lane.md");

  assert.match(note, /^### Auditable Work State Machine$/m);
  assert.match(note, /operator-facing state is a trust surface/i);
  assert.match(note, /status, explain, WebUI, evidence timeline, and recovery diagnostics/i);
  assert.match(note, /does not rename runtime states/i);

  for (const heading of ["State", "Reason", "Evidence", "Authority Boundary", "Next Operator Action"]) {
    assert.match(note, new RegExp(`\\| ${heading} `));
  }

  for (const state of [
    "queued",
    "running",
    "blocked",
    "failed",
    "waiting_ci",
    "waiting_review",
    "repairing_ci",
    "merging",
    "done",
    "manual_review",
  ]) {
    const row = new RegExp("\\| `" + state + "` \\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|");
    assert.match(note, row, `${state} must map to reason, evidence, authority, and action`);
  }

  assert.match(note, /supervisor-owned/i);
  assert.match(note, /operator judgment/i);
  assert.match(note, /live operator surfaces such as `status` and `explain`/i);
  assert.match(note, /fresh GitHub facts/i);
  assert.match(note, /issue journal/i);
  assert.match(note, /Persisted PR status comments are snapshots/i);
  assert.match(note, /must not be treated as authoritative lifecycle state/i);
  assert.match(note, /tracked-done cleanup/i);
  assert.doesNotMatch(note, /tracked done cleanup/i);
});

test("published supervised automation state-machine contract maps every runtime state", async () => {
  const [note, typesSource, contractSource, operatorActionsSource] = await Promise.all([
    readRepoFile("docs/supervised-automation-lane.md"),
    readRepoFile("src/core/types.ts"),
    readRepoFile("docs/supervised-automation-state-machine.schema.json"),
    readRepoFile("docs/operator-actions.schema.json"),
  ]);
  const contract = JSON.parse(contractSource) as PublishedStateMachineContract;
  const operatorActionContract = JSON.parse(operatorActionsSource) as { actions: Array<{ action: string }> };
  const operatorActionVocabulary = new Set(operatorActionContract.actions.map((entry) => entry.action));

  assert.equal(contract.contractName, "codex-supervisor.supervised-automation-state-machine");
  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.canonicalSource, "src/core/types.ts");

  const runtimeStates = extractRunStateValues(typesSource);
  const mappedInternalStates = contract.publicStates.flatMap((state) => state.internalStates);
  assert.deepEqual(sortedValues(mappedInternalStates), sortedValues(runtimeStates));
  assert.equal(new Set(mappedInternalStates).size, mappedInternalStates.length, "internal states must map exactly once");

  for (const publicState of contract.publicStates) {
    assert.match(note, new RegExp(`\\| \`${publicState.state}\` \\|`), `${publicState.state} must be documented`);
    if (publicState.state === "manual_review") {
      assert.deepEqual(publicState.internalStates, [], "manual_review is a public boundary, not a stored RunState");
    } else {
      assert.ok(publicState.internalStates.length > 0, `${publicState.state} must list internal runtime states`);
    }
    assert.ok(publicState.operatorActions.length > 0, `${publicState.state} must list next operator action vocabulary`);
    assert.deepEqual(
      publicState.operatorActions.filter((action) => !operatorActionVocabulary.has(action)),
      [],
      `${publicState.state} operator actions must use the published operator action vocabulary`,
    );
  }

  assert.doesNotMatch(contractSource, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(contractSource, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("supervised automation lane documents contract-first issue authoring UX", async () => {
  const [template, metadataReference, note] = await Promise.all([
    readRepoFile(".github/ISSUE_TEMPLATE/codex-execution-ready.md"),
    readRepoFile("docs/issue-metadata.md"),
    readRepoFile("docs/supervised-automation-lane.md"),
  ]);

  assert.match(template, /## Summary/);
  assert.match(template, /## Scope/);
  assert.match(template, /## Acceptance criteria/);
  assert.match(template, /## Verification/);
  assert.match(template, /^Part of: #____$/m);
  assert.match(template, /^Depends on: none$/m);
  assert.match(template, /^Parallelizable: No$/m);
  assert.match(template, /^## Execution order$/m);
  assert.match(metadataReference, /Use this document as the canonical reference/i);
  assert.match(metadataReference, /`Part of: #\.\.\.` line when the issue is part of a sequenced child set/);
  assert.match(metadataReference, /one canonical `Depends on: none` or `Depends on: #\.\.\.` line/);
  assert.match(metadataReference, /one canonical `Parallelizable: Yes\|No` line/);
  assert.match(metadataReference, /one valid `Execution order` declaration/);

  assert.match(note, /^### Contract-First Issue Authoring UX$/m);

  for (const term of [
    "Summary",
    "Scope",
    "Acceptance criteria",
    "Verification",
    "dependencies",
    "parallelization",
    "execution order",
    "Part of",
  ]) {
    assert.match(note, new RegExp(term, "i"));
  }

  for (const surface of [
    "GitHub issue template",
    "docs/issue-metadata.md",
    "issue-lint",
    "CLI",
    "WebUI",
    "operator workflow",
  ]) {
    assert.match(note, new RegExp(surface.replace("/", "\\/"), "i"));
  }

  for (const unsafeInput of [
    "missing metadata",
    "unsafe scope",
    "ambiguous verification",
    "dependency",
    "order",
  ]) {
    assert.match(note, new RegExp(unsafeInput, "i"));
  }

  assert.match(note, /fail closed/i);
  assert.match(note, /node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>/);
  assert.doesNotMatch(note, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(note, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("supervised automation lane defines durable project memory writeback responsibilities", async () => {
  const note = await readRepoFile("docs/supervised-automation-lane.md");

  assert.match(note, /^### Durable Memory Writeback$/m);
  assert.match(note, /durable project memory writeback/i);
  assert.match(note, /transient chat memory/i);

  for (const surface of ["GitHub", "CLI", "WebUI", "Codex app Automation", "durable notes"]) {
    assert.match(note, new RegExp(surface, "i"));
  }

  for (const memoryKind of [
    "development history",
    "release notes",
    "roadmap",
    "operator decisions",
    "follow-up backlog",
    "incident/recovery notes",
  ]) {
    assert.match(note, new RegExp(memoryKind, "i"));
  }

  for (const outcome of ["safe continuation", "evaluation", "release work"]) {
    assert.match(note, new RegExp(outcome, "i"));
  }

  assert.match(note, /repo-relative/i);
  assert.match(note, /placeholder/i);
  assert.doesNotMatch(note, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(note, /C:\\Users\\[A-Za-z0-9._-]+\\/);
});

test("Codex Automation connector boundary artifact agrees with lane docs and grants no executor authority", async () => {
  const [artifactSource, automationGuide, laneNote, architecture] = await Promise.all([
    readRepoFile("docs/codex-automation-connector-boundary.schema.json"),
    readRepoFile("docs/automation.md"),
    readRepoFile("docs/supervised-automation-lane.md"),
    readRepoFile("docs/architecture.md"),
  ]);
  const artifact = JSON.parse(artifactSource) as CodexAutomationConnectorBoundaryArtifact;

  assert.equal(artifact.artifactName, "codex-supervisor.codex-automation-connector-boundary");
  assert.equal(artifact.artifactVersion, 1);
  assert.equal(artifact.canonicalGuide, "docs/automation.md");
  assert.equal(artifact.enforcementBoundary, "codex-supervisor-executor-safety-gates");

  const expectedResponsibilities = [
    "evaluate",
    "route",
    "draft",
    "record",
    "notify",
    "prepare_operator_evidence",
  ];
  assert.deepEqual(
    sortedValues(artifact.allowedResponsibilities),
    sortedValues(expectedResponsibilities),
    "allowedResponsibilities must match the published connector vocabulary exactly",
  );

  const expectedProhibitedBypasses = [
    "executor_safety_gates",
    "issue_lint",
    "fresh_pr_facts",
    "local_ci",
    "operator_confirmations",
  ];
  assert.deepEqual(
    sortedValues(artifact.prohibitedBypasses),
    sortedValues(expectedProhibitedBypasses),
    "prohibitedBypasses must match the published non-bypassable set exactly",
  );

  const expectedNonGoals = ["new_executor_authority", "multi_repo_orchestration_in_core"];
  assert.deepEqual(
    sortedValues(artifact.nonGoals),
    sortedValues(expectedNonGoals),
    "nonGoals must match the published exclusions exactly",
  );

  for (const source of [artifactSource, automationGuide, laneNote, architecture]) {
    assert.match(source, /`?codex-supervisor`? remains the implementation executor/i);
    assert.match(source, /must not bypass/i);
    assert.match(source, /issue-lint/i);
    assert.match(source, /fresh (GitHub )?PR facts/i);
    assert.match(source, /local CI/i);
    assert.match(source, /operator confirmations/i);
    assert.match(source, /multi-repo orchestration/i);
    assert.match(source, /new executor authority/i);
    assert.doesNotMatch(source, /\/Users\/[A-Za-z0-9._-]+\//);
    assert.doesNotMatch(source, /C:\\Users\\[A-Za-z0-9._-]+\\/);
  }
});
