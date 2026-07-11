import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateLocalReviewModelRoutingFixture,
  formatLocalReviewModelRoutingEvaluationSummary,
  loadLocalReviewModelRoutingEvaluationFixture,
  serializeLocalReviewModelRoutingEvaluationSummary,
  writeLocalReviewModelRoutingEvaluationSummary,
} from "./model-routing-evaluation";

const FIXTURE_RELATIVE_PATH =
  "replay-corpus/local-review-model-routing/representative-evaluation.json";
const SUMMARY_RELATIVE_PATH =
  "replay-corpus/local-review-model-routing/representative-summary.json";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== "--write");
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown arguments: ${unknownArgs.join(", ")}. Supported argument: --write.`);
  }
  const repoRoot = path.resolve(__dirname, "../..");
  const fixturePath = path.join(repoRoot, FIXTURE_RELATIVE_PATH);
  const summaryPath = path.join(repoRoot, SUMMARY_RELATIVE_PATH);

  if (args.includes("--write")) {
    const summary = await writeLocalReviewModelRoutingEvaluationSummary({
      fixturePath,
      outputPath: summaryPath,
      sourceFixture: FIXTURE_RELATIVE_PATH,
    });
    console.log(formatLocalReviewModelRoutingEvaluationSummary(summary));
    console.log(`wrote=${SUMMARY_RELATIVE_PATH}`);
    return;
  }

  const fixture = await loadLocalReviewModelRoutingEvaluationFixture(fixturePath);
  const summary = evaluateLocalReviewModelRoutingFixture(fixture, FIXTURE_RELATIVE_PATH);
  const expected = serializeLocalReviewModelRoutingEvaluationSummary(summary);
  const committed = await fs.readFile(summaryPath, "utf8");
  if (committed !== expected) {
    throw new Error(
      `Local-review model-routing evaluation summary is stale. Run npm run evaluate:local-review-model-routing -- --write.`,
    );
  }
  console.log(formatLocalReviewModelRoutingEvaluationSummary(summary));
  console.log(`summary=${SUMMARY_RELATIVE_PATH} status=current`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
