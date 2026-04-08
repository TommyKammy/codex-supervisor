import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const supervisorSourcePath = path.resolve(process.cwd(), "src/supervisor/supervisor.ts");

function extractMethodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find method signature: ${signature}`);

  const bodyStart = source.indexOf("{", start + signature.length);
  assert.notEqual(bodyStart, -1, `Expected to find method body for: ${signature}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index).trim();
      }
    }
  }

  throw new Error(`Unterminated method body for: ${signature}`);
}

test("Supervisor read-only reporting methods remain thin delegators", async () => {
  const source = await fs.readFile(supervisorSourcePath, "utf8");

  assert.match(
    extractMethodBody(source, 'async statusReport(options: Pick<CliOptions, "why"> = { why: false }): Promise<SupervisorStatusDto>'),
    /^return buildSupervisorStatusReport\(\{\s*config: this\.config,\s*github: this\.github,\s*stateStore: this\.stateStore,\s*options,\s*\}\);$/s,
  );
  assert.match(
    extractMethodBody(source, "async explainReport(issueNumber: number): Promise<SupervisorExplainDto>"),
    /^return buildSupervisorExplainReport\(\{\s*config: this\.config,\s*github: this\.github,\s*stateStore: this\.stateStore,\s*issueNumber,\s*\}\);$/s,
  );
  assert.match(
    extractMethodBody(source, "async doctorReport()"),
    /^return buildSupervisorDoctorReport\(\{\s*config: this\.config,\s*github: this\.github,\s*\}\);$/s,
  );
  assert.match(
    extractMethodBody(source, "async setupReadinessReport()"),
    /^return buildSupervisorSetupReadinessReport\(\{\s*configPath: this\.configPath,\s*github: this\.github,\s*\}\);$/s,
  );
});
