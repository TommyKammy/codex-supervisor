import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { REPLAY_CORPUS_MISMATCH_DETAILS_ARTIFACT_RELATIVE_PATH } from "./supervisor/replay-corpus-mismatch-artifact";

const workflowPath = path.resolve(__dirname, "..", ".github/workflows/ci.yml");

interface WorkflowStep {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with: Record<string, string>;
}

interface ParsedWorkflow {
  on: {
    pushBranches: string[];
    hasPullRequest: boolean;
  };
  concurrency: {
    group: string | null;
    cancelInProgress: string | null;
  };
  buildSteps: WorkflowStep[];
}

function countIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function splitKeyValue(raw: string): [string, string] | null {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const key = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1).trim();
  return key === "" ? null : [key, value];
}

function collectBlock(lines: string[], startIndex: number): Array<{ indent: number; text: string }> {
  const block: Array<{ indent: number; text: string }> = [];
  const parentIndent = countIndent(lines[startIndex] ?? "");
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const indent = countIndent(line);
    if (indent <= parentIndent) {
      break;
    }

    block.push({ indent, text: trimmed });
  }

  return block;
}

function findSectionIndex(lines: string[], expected: string, startIndex = 0): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === expected) {
      return index;
    }
  }

  throw new Error(`Expected workflow section "${expected}" to exist.`);
}

function parseStepEntry(text: string): [string, string] | null {
  if (!text.startsWith("- ")) {
    return null;
  }

  return splitKeyValue(text.slice(2));
}

function parseWorkflow(workflow: string): ParsedWorkflow {
  const lines = workflow.split(/\r?\n/u);

  const onIndex = findSectionIndex(lines, "on:");
  const onBlock = collectBlock(lines, onIndex);
  const pushBranches: string[] = [];
  let hasPullRequest = false;
  let inPushBranches = false;

  for (const entry of onBlock) {
    if (entry.indent === 2 && entry.text === "push:") {
      inPushBranches = false;
      continue;
    }
    if (entry.indent === 2 && entry.text === "pull_request:") {
      hasPullRequest = true;
      inPushBranches = false;
      continue;
    }
    if (entry.indent === 4 && entry.text === "branches:") {
      inPushBranches = true;
      continue;
    }
    if (inPushBranches && entry.indent === 6 && entry.text.startsWith("- ")) {
      pushBranches.push(entry.text.slice(2).trim());
      continue;
    }
    if (entry.indent <= 4) {
      inPushBranches = false;
    }
  }

  const concurrencyIndex = findSectionIndex(lines, "concurrency:");
  const concurrencyBlock = collectBlock(lines, concurrencyIndex);
  const concurrency = {
    group: null as string | null,
    cancelInProgress: null as string | null,
  };
  for (const entry of concurrencyBlock) {
    if (entry.indent !== 2) {
      continue;
    }
    const pair = splitKeyValue(entry.text);
    if (!pair) {
      continue;
    }
    const [key, value] = pair;
    if (key === "group") {
      concurrency.group = value;
    }
    if (key === "cancel-in-progress") {
      concurrency.cancelInProgress = value;
    }
  }

  const jobsIndex = findSectionIndex(lines, "jobs:");
  const buildIndex = findSectionIndex(lines, "build:", jobsIndex + 1);
  const stepsIndex = findSectionIndex(lines, "steps:", buildIndex + 1);
  const stepsBlock = collectBlock(lines, stepsIndex);
  const buildSteps: WorkflowStep[] = [];
  let currentStep: WorkflowStep | null = null;
  let inWithBlock = false;

  for (const entry of stepsBlock) {
    const inlinePair = parseStepEntry(entry.text);
    if (entry.indent === 6 && inlinePair) {
      currentStep = { with: {} };
      inWithBlock = false;
      buildSteps.push(currentStep);
      const [key, value] = inlinePair;
      if (key === "id") {
        currentStep.id = value;
      } else if (key === "if") {
        currentStep.if = value;
      } else if (key === "run") {
        currentStep.run = value;
      } else if (key === "uses") {
        currentStep.uses = value;
      }
      continue;
    }

    if (!currentStep) {
      continue;
    }

    if (entry.indent === 8 && entry.text === "with:") {
      inWithBlock = true;
      continue;
    }

    const pair = splitKeyValue(entry.text);
    if (!pair) {
      inWithBlock = false;
      continue;
    }

    const [key, value] = pair;
    if (inWithBlock && entry.indent === 10) {
      currentStep.with[key] = value;
      continue;
    }

    inWithBlock = false;
    if (entry.indent !== 8) {
      continue;
    }

    if (key === "id") {
      currentStep.id = value;
    } else if (key === "if") {
      currentStep.if = value;
    } else if (key === "run") {
      currentStep.run = value;
    } else if (key === "uses") {
      currentStep.uses = value;
    }
  }

  return {
    on: {
      pushBranches,
      hasPullRequest,
    },
    concurrency,
    buildSteps,
  };
}

function findBuildStep(
  steps: WorkflowStep[],
  expected: Partial<Pick<WorkflowStep, "id" | "if" | "run" | "uses">>,
): WorkflowStep | undefined {
  return steps.find((step) =>
    Object.entries(expected).every(([key, value]) => {
      if (value === undefined) {
        return true;
      }

      return step[key as keyof Pick<WorkflowStep, "id" | "if" | "run" | "uses">] === value;
    }),
  );
}

test("workflow parser does not treat separate step fields as one executable step", () => {
  const parsed = parseWorkflow(`
name: CI
on:
  push:
    branches:
      - main
  pull_request:
concurrency:
  group: ci-group
  cancel-in-progress: true
jobs:
  build:
    steps:
      - if: matrix.os == 'ubuntu-latest'
        run: echo "different command"
      - run: npm run verify:paths
`);

  assert.equal(
    findBuildStep(parsed.buildSteps, {
      if: "matrix.os == 'ubuntu-latest'",
      run: "npm run verify:paths",
    }),
    undefined,
  );
});

test("CI workflow cancels stale runs for the same branch or PR", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));

  assert.deepEqual(workflow.on.pushBranches, ["main"]);
  assert.equal(workflow.on.hasPullRequest, true);
  assert.equal(
    workflow.concurrency.group,
    "${{ github.workflow }}-${{ github.event.pull_request.head.repo.full_name || github.repository }}-${{ github.head_ref || github.ref_name }}",
  );
  assert.equal(workflow.concurrency.cancelInProgress, "true");
});

test("CI workflow surfaces the compact replay corpus summary in pull request output", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));

  assert.ok(
    findBuildStep(workflow.buildSteps, {
      id: "replay_corpus",
      if: "matrix.os == 'ubuntu-latest'",
      run: "npx tsx src/index.ts replay-corpus",
    }),
  );
});

test("CI workflow uploads replay corpus mismatch details only when the Ubuntu replay run fails", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));
  const artifactStep = findBuildStep(workflow.buildSteps, {
    if: "${{ failure() && matrix.os == 'ubuntu-latest' && steps.replay_corpus.outcome == 'failure' }}",
    uses: "actions/upload-artifact@v4",
  });

  assert.ok(artifactStep);
  assert.equal(artifactStep.with.name, "replay-corpus-mismatch-details");
  assert.equal(artifactStep.with.path, ".codex-supervisor/replay/replay-corpus-mismatch-details.json");
});

test("CI workflow runs the focused malformed-inventory regression suite on Ubuntu pull request jobs", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));

  assert.ok(
    findBuildStep(workflow.buildSteps, {
      if: "matrix.os == 'ubuntu-latest'",
      run: "npm run test:malformed-inventory-regressions",
    }),
  );
});

test("CI workflow runs the focused managed-restart regression suite on Ubuntu pull request jobs", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));

  assert.ok(
    findBuildStep(workflow.buildSteps, {
      if: "matrix.os == 'ubuntu-latest'",
      run: "npm run test:managed-restart-regressions",
    }),
  );
});

test("CI workflow runs the workstation-local path hygiene gate on Ubuntu pull request jobs", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));

  assert.ok(
    findBuildStep(workflow.buildSteps, {
      if: "matrix.os == 'ubuntu-latest'",
      run: "npm run verify:paths",
    }),
  );
});

test("CI workflow npm run steps reference package scripts and keep replay artifact paths aligned", async () => {
  const workflow = parseWorkflow(await fs.readFile(workflowPath, "utf8"));
  const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, "..", "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const workflowScriptNames = workflow.buildSteps
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string" && run.startsWith("npm run "))
    .map((run) => run.slice("npm run ".length));
  const missingScripts = workflowScriptNames.filter((name) => !packageJson.scripts?.[name]);

  assert.deepEqual(
    missingScripts,
    [],
    [
      `${path.relative(process.cwd(), workflowPath)} must only invoke npm scripts that exist in package.json.`,
      `Missing script definitions: ${missingScripts.join(", ") || "none"}.`,
    ].join(" "),
  );

  const artifactStep = findBuildStep(workflow.buildSteps, {
    if: "${{ failure() && matrix.os == 'ubuntu-latest' && steps.replay_corpus.outcome == 'failure' }}",
    uses: "actions/upload-artifact@v4",
  });

  assert.equal(
    artifactStep?.with.path,
    REPLAY_CORPUS_MISMATCH_DETAILS_ARTIFACT_RELATIVE_PATH,
    `${path.relative(process.cwd(), workflowPath)} artifact upload path must stay aligned with src/supervisor/replay-corpus-mismatch-artifact.ts`,
  );
});
