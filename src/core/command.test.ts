import test from "node:test";
import assert from "node:assert/strict";
import { CommandExecutionError, runCommand } from "./command";

test("runCommand failure errors redact trailing raw arguments", async () => {
  const secretArg = "token=super-secret-value";

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write('boom\\n'); process.exit(7);",
        secretArg,
      ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(
          `Command failed: ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -e .* \\+1 arg`,
        ),
      );
      assert.match(error.message, /exitCode=7/);
      assert.match(error.message, /boom/);
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("runCommand failure errors bound noisy stderr", async () => {
  const noisyPrefix = "prefix-line";
  const noisySuffix = "suffix-line";
  const noisyMiddle = "x".repeat(1_200);

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write(process.env.NOISY_STDERR ?? ''); process.exit(9);",
      ], {
        env: {
          ...process.env,
          NOISY_STDERR: `${noisyPrefix}\n${noisyMiddle}\n${noisySuffix}\n`,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Command failed:/);
      assert.match(error.message, /exitCode=9/);
      assert.match(error.message, new RegExp(noisyPrefix));
      assert.match(error.message, new RegExp(noisySuffix));
      assert.match(error.message, /\n\.\.\.\n/);
      assert.ok(error.message.length < 900, `expected bounded error message, got length ${error.message.length}`);
      return true;
    },
  );
});

test("runCommand failure errors preserve stdout and stderr on the error object", async () => {
  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "process.stdout.write('stdout line\\n'); process.stderr.write('stderr line\\n'); process.exit(6);",
      ]),
    (error: unknown) => {
      assert.ok(error instanceof CommandExecutionError);
      assert.equal(error.exitCode, 6);
      assert.equal(error.timedOut, false);
      assert.equal(error.stdout, "stdout line\n");
      assert.equal(error.stderr, "stderr line\n");
      return true;
    },
  );
});

test("runCommand success bounds large stdout while preserving both ends", async () => {
  const stdoutPrefix = "stdout-prefix";
  const stdoutSuffix = "stdout-suffix";

  const result = await runCommand(process.execPath, [
    "-e",
    `
      const write = (chunk) => new Promise((resolve, reject) => {
        process.stdout.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
      (async () => {
        await write(${JSON.stringify(`${stdoutPrefix}\n`)});
        for (let i = 0; i < 200; i += 1) {
          await write("o".repeat(1000));
        }
        await write(${JSON.stringify(`\n${stdoutSuffix}\n`)});
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `,
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(stdoutPrefix));
  assert.match(result.stdout, new RegExp(stdoutSuffix));
  assert.match(result.stdout, /\n\.\.\.\n/);
  assert.ok(result.stdout.length < 70_000, `expected bounded stdout capture, got length ${result.stdout.length}`);
  assert.equal(result.stderr, "");
});

test("runCommand can opt out of stdout truncation for machine-readable payloads", async () => {
  const payload = JSON.stringify(
    Array.from({ length: 220 }, (_value, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`,
      body: `Body ${index + 1} ${"z".repeat(500)}`,
    })),
  );

  const result = await runCommand(
    process.execPath,
    [
      "-e",
      `process.stdout.write(${JSON.stringify(payload)});`,
    ],
    { stdoutCaptureLimitBytes: null },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, payload);
  assert.doesNotMatch(result.stdout, /\n\.\.\.\n/);
});

test("runCommand failure bounds large stderr on the error object while preserving both ends", async () => {
  const stderrPrefix = "stderr-prefix";
  const stderrSuffix = "stderr-suffix";

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        `
          const write = (chunk) => new Promise((resolve, reject) => {
            process.stderr.write(chunk, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(undefined);
            });
          });
          (async () => {
            await write(${JSON.stringify(`${stderrPrefix}\n`)});
            for (let i = 0; i < 200; i += 1) {
              await write("e".repeat(1000));
            }
            await write(${JSON.stringify(`\n${stderrSuffix}\n`)});
            process.exit(8);
          })().catch((error) => {
            console.error(error);
            process.exit(1);
          });
        `,
      ]),
    (error: unknown) => {
      assert.ok(error instanceof CommandExecutionError);
      assert.equal(error.exitCode, 8);
      assert.match(error.stderr, new RegExp(stderrPrefix));
      assert.match(error.stderr, new RegExp(stderrSuffix));
      assert.match(error.stderr, /\n\.\.\.\n/);
      assert.ok(error.stderr.length < 70_000, `expected bounded stderr capture, got length ${error.stderr.length}`);
      assert.equal(error.stdout, "");
      return true;
    },
  );
});

test("runCommand timeout errors redact trailing raw arguments", async () => {
  const secretArg = "token=timeout-secret-value";

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        "setTimeout(() => process.exit(0), 1000);",
        secretArg,
      ], {
        timeoutMs: 10,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(
          `Command timed out: ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -e .* \\+1 arg`,
        ),
      );
      assert.match(error.message, /exitCode=/);
      assert.match(error.message, /Command timed out after 10ms: .* -e .* \+1 arg/);
      assert.doesNotMatch(error.message, /timeout-secret-value/);
      return true;
    },
  );
});

test("runCommand timeout errors keep bounded timeout context when stderr rendering is noisy", async () => {
  const noisyPrefix = "timeout-prefix";
  const noisySuffix = "timeout-suffix";
  const noisyMiddle = "y".repeat(1_200);
  const timeoutSignalScript =
    `
      const write = (chunk) => new Promise((resolve, reject) => {
        process.stderr.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
      (async () => {
        await write(process.env.NOISY_STDERR ?? "");
        setInterval(() => {}, 1000);
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;

  await assert.rejects(
    () =>
      runCommand(
        process.execPath,
        [
          "-e",
          timeoutSignalScript,
        ],
        {
          env: {
            ...process.env,
            NOISY_STDERR: `${noisyPrefix}\n${noisyMiddle}\n${noisySuffix}\n`,
          },
          timeoutMs: 50,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Command timed out:/);
      assert.match(error.message, /Command timed out after 50ms:/);
      assert.match(error.message, /\n\.\.\.\n/);
      assert.match(error.message, /const write =/);
      assert.match(error.message, /process\.exit\(1\);/);
      assert.ok(
        error.message.length < 1_300,
        `expected bounded timeout error message, got length ${error.message.length}`,
      );
      return true;
    },
  );
});

test("runCommand timeout errors preserve timeout summaries when stderr is already noisy before the timeout", async () => {
  const stderrPrefix = "pre-timeout-prefix";
  const stderrSuffix = "pre-timeout-suffix";
  const noisyWriteCount = 70;
  const timeoutMs = 250;

  await assert.rejects(
    () =>
      runCommand(
        process.execPath,
        [
          "-e",
          `
            const write = (chunk) => new Promise((resolve, reject) => {
              process.stderr.write(chunk, (error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve(undefined);
              });
            });
            (async () => {
              await write(${JSON.stringify(`${stderrPrefix}\n`)});
              for (let i = 0; i < ${noisyWriteCount}; i += 1) {
                await write("q".repeat(1000));
              }
              await write(${JSON.stringify(`\n${stderrSuffix}\n`)});
              setInterval(() => {}, 1000);
            })().catch((error) => {
              console.error(error);
              process.exit(1);
            });
          `,
        ],
        {
          timeoutMs,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof CommandExecutionError);
      assert.equal(error.timedOut, true);
      assert.match(error.message, /Command timed out:/);
      assert.match(error.message, new RegExp(`Command timed out after ${timeoutMs}ms:`));
      assert.match(error.message, new RegExp(stderrPrefix));
      assert.match(error.message, /\n\.\.\.\n/);
      assert.match(error.stderr, new RegExp(stderrPrefix));
      assert.match(error.stderr, new RegExp(stderrSuffix));
      assert.match(error.stderr, new RegExp(`Command timed out after ${timeoutMs}ms:`));
      assert.match(error.stderr, /\n\.\.\.\n/);
      return true;
    },
  );
});

test("runCommand timeout errors bound long timeout summaries", async () => {
  const timeoutMs = 10;
  const longInlineScript = `setInterval(() => {}, 1000); /* ${"very-long-timeout-summary ".repeat(4_000)} */`;

  await assert.rejects(
    () =>
      runCommand(process.execPath, [
        "-e",
        longInlineScript,
      ], {
        timeoutMs,
      }),
    (error: unknown) => {
      assert.ok(error instanceof CommandExecutionError);
      assert.equal(error.timedOut, true);
      const renderedStderr = error.message.split("\n").slice(2).join("\n");
      assert.match(error.message, new RegExp(`Command timed out after ${timeoutMs}ms:`));
      assert.match(error.message, /\n\.\.\.\n/);
      assert.ok(renderedStderr.length <= 500, `expected bounded rendered stderr, got length ${renderedStderr.length}`);
      assert.match(error.stderr, new RegExp(`Command timed out after ${timeoutMs}ms:`));
      assert.match(error.stderr, /\n\.\.\.\n/);
      assert.ok(error.stderr.length <= 65_536, `expected bounded stderr capture, got length ${error.stderr.length}`);
      return true;
    },
  );
});
