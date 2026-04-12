import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const bashPath = "/bin/bash";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function assertShellExport(script: string, variable: string, fallbackValue: string): void {
  const expectedLine = `export ${variable}="\${${variable}:-${fallbackValue}}"`;
  assert.equal(script.split(/\r?\n/u).includes(expectedLine), true);
}

function assertLaunchdEnvironmentVariable(plist: string, variable: string, value: string): void {
  assert.match(
    plist,
    new RegExp(`<key>${escapeRegex(variable)}</key>\\s*<string>${escapeRegex(value)}</string>`, "u"),
  );
}

function assertSystemdEnvironmentVariable(unit: string, variable: string, value: string): void {
  assert.match(unit, new RegExp(`^Environment=${escapeRegex(variable)}=${escapeRegex(value)}$`, "mu"));
}

async function createMissingNodePath(commands: string[]): Promise<string> {
  const pathDir = await fs.mkdtemp(path.join(os.tmpdir(), "managed-restart-path-"));

  await Promise.all(commands.map(async (commandName) => {
    const commandPath = (await execFileAsync(bashPath, ["-lc", `command -v ${commandName}`])).stdout.trim();
    await fs.symlink(commandPath, path.join(pathDir, commandName));
  }));

  return pathDir;
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
}

async function assertMissingBinaryMessage(relativePath: string, requiredCommands: string[]): Promise<void> {
  const scriptPath = path.join(process.cwd(), relativePath);
  const pathDir = await createMissingNodePath(requiredCommands);

  try {
    await assert.rejects(
      async () => execFileAsync(bashPath, [scriptPath], {
        env: {
          HOME: os.tmpdir(),
          PATH: pathDir,
        },
      }),
      (error: unknown) => {
        assert.equal(typeof error, "object");
        assert.notEqual(error, null);
        assert.equal((error as NodeJS.ErrnoException).code, 1);
        const stderr = (error as { stderr?: string }).stderr ?? "";
        assert.equal(stderr.trim(), "node and npm must be available on PATH");
        assert.doesNotMatch(stderr, /command not found/u);
        return true;
      },
    );
  } finally {
    await fs.rm(pathDir, { recursive: true, force: true });
  }
}

async function assertMissingCommandMessage(
  relativePath: string,
  requiredCommands: string[],
  expectedMessage: string,
): Promise<void> {
  const scriptPath = path.join(process.cwd(), relativePath);
  const pathDir = await createMissingNodePath(requiredCommands);

  try {
    await assert.rejects(
      async () => execFileAsync(bashPath, [scriptPath], {
        env: {
          HOME: os.tmpdir(),
          PATH: pathDir,
        },
      }),
      (error: unknown) => {
        assert.equal(typeof error, "object");
        assert.notEqual(error, null);
        assert.equal((error as NodeJS.ErrnoException).code, 1);
        const stderr = (error as { stderr?: string }).stderr ?? "";
        assert.equal(stderr.trim(), expectedMessage);
        assert.doesNotMatch(stderr, /command not found/u);
        return true;
      },
    );
  } finally {
    await fs.rm(pathDir, { recursive: true, force: true });
  }
}

test("dedicated WebUI launcher assets enable managed restart for launcher-backed WebUI sessions", async () => {
  const [
    runWeb,
    launchdTemplate,
    systemdTemplate,
    installLaunchdWeb,
    installSystemdWeb,
  ] = await Promise.all([
    readRepoFile("scripts/run-web.sh"),
    readRepoFile("launchd/io.codex.supervisor.web.plist.template"),
    readRepoFile("systemd/codex-supervisor-web.service.template"),
    readRepoFile("scripts/install-launchd-web.sh"),
    readRepoFile("scripts/install-systemd-web.sh"),
  ]);

  assert.match(runWeb, /dist\/index\.js" web --config/u);
  assertShellExport(runWeb, "CODEX_SUPERVISOR_MANAGED_RESTART", "1");
  assertShellExport(runWeb, "CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER", "custom");

  assert.match(launchdTemplate, /io\.codex\.supervisor\.web/u);
  assert.match(launchdTemplate, /scripts\/run-web\.sh/u);
  assertLaunchdEnvironmentVariable(launchdTemplate, "CODEX_SUPERVISOR_MANAGED_RESTART", "1");
  assertLaunchdEnvironmentVariable(launchdTemplate, "CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER", "launchd");

  assert.match(systemdTemplate, /codex-supervisor WebUI/u);
  assert.match(systemdTemplate, /scripts\/run-web\.sh/u);
  assertSystemdEnvironmentVariable(systemdTemplate, "CODEX_SUPERVISOR_MANAGED_RESTART", "1");
  assertSystemdEnvironmentVariable(systemdTemplate, "CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER", "systemd");

  assert.match(installLaunchdWeb, /io\.codex\.supervisor\.web/u);
  assert.match(installLaunchdWeb, /io\.codex\.supervisor\.web\.plist/u);
  assert.match(installSystemdWeb, /codex-supervisor-web\.service/u);
});

test("existing loop launcher assets stay scoped to loop mode without managed restart wiring", async () => {
  const [
    runLoop,
    launchdTemplate,
    systemdTemplate,
  ] = await Promise.all([
    readRepoFile("scripts/run-loop.sh"),
    readRepoFile("launchd/io.codex.supervisor.plist.template"),
    readRepoFile("systemd/codex-supervisor.service.template"),
  ]);

  assert.match(runLoop, /dist\/index\.js" loop --config/u);
  assert.doesNotMatch(runLoop, /^export CODEX_SUPERVISOR_MANAGED_RESTART(?:_LAUNCHER)?=/mu);
  assert.doesNotMatch(launchdTemplate, /<key>CODEX_SUPERVISOR_MANAGED_RESTART(?:_LAUNCHER)?<\/key>/u);
  assert.doesNotMatch(systemdTemplate, /^Environment=CODEX_SUPERVISOR_MANAGED_RESTART(?:_LAUNCHER)?=/mu);
});

test("macOS tmux loop launcher assets define a single-session contract with explicit launcher metadata", async () => {
  const [startTmuxLoop, stopTmuxLoop] = await Promise.all([
    readRepoFile("scripts/start-loop-tmux.sh"),
    readRepoFile("scripts/stop-loop-tmux.sh"),
  ]);

  assert.match(startTmuxLoop, /TMUX_SESSION_NAME="\$\{TMUX_SESSION_NAME:-codex-supervisor-loop\}"/u);
  assert.match(startTmuxLoop, /CODEX_SUPERVISOR_LAUNCHER="\$\{CODEX_SUPERVISOR_LAUNCHER:-tmux\}"/u);
  assert.match(startTmuxLoop, /CODEX_SUPERVISOR_TMUX_SESSION="\$\{CODEX_SUPERVISOR_TMUX_SESSION:-\$\{TMUX_SESSION_NAME\}\}"/u);
  assert.match(startTmuxLoop, /has-session -t "\$\{TMUX_SESSION_NAME\}"/u);
  assert.match(startTmuxLoop, /new-session -d -s "\$\{TMUX_SESSION_NAME\}"/u);
  assert.match(startTmuxLoop, /CODEX_SUPERVISOR_CONFIG=/u);
  assert.match(startTmuxLoop, /scripts\/run-loop\.sh/u);

  assert.match(stopTmuxLoop, /TMUX_SESSION_NAME="\$\{TMUX_SESSION_NAME:-codex-supervisor-loop\}"/u);
  assert.match(stopTmuxLoop, /has-session -t "\$\{TMUX_SESSION_NAME\}"/u);
  assert.match(stopTmuxLoop, /kill-session -t "\$\{TMUX_SESSION_NAME\}"/u);
});

test("launcher-backed WebUI shell scripts keep their explicit missing-binary diagnostics under set -euo pipefail", async () => {
  await Promise.all([
    assertMissingBinaryMessage("scripts/run-web.sh", ["dirname"]),
    assertMissingBinaryMessage("scripts/install-launchd-web.sh", ["dirname"]),
    assertMissingBinaryMessage("scripts/install-systemd-web.sh", ["dirname"]),
    assertMissingCommandMessage("scripts/start-loop-tmux.sh", ["dirname", "node", "npm"], "tmux must be available on PATH"),
    assertMissingCommandMessage("scripts/stop-loop-tmux.sh", ["dirname"], "tmux must be available on PATH"),
  ]);
});

test("tmux loop start script preserves idempotency before checking node and npm", async () => {
  const scriptPath = path.join(process.cwd(), "scripts/start-loop-tmux.sh");
  const pathDir = await fs.mkdtemp(path.join(os.tmpdir(), "managed-restart-tmux-"));
  const dirnamePath = (await execFileAsync(bashPath, ["-lc", "command -v dirname"])).stdout.trim();

  try {
    await fs.symlink(dirnamePath, path.join(pathDir, "dirname"));
    await writeExecutable(
      path.join(pathDir, "tmux"),
      `#!/bin/bash
set -euo pipefail

if [[ "$1" == "has-session" ]]; then
  exit 0
fi

echo "unexpected tmux invocation: $*" >&2
exit 1
`,
    );

    const { stdout, stderr } = await execFileAsync(bashPath, [scriptPath], {
      env: {
        HOME: os.tmpdir(),
        PATH: pathDir,
      },
    });

    assert.equal(stderr, "");
    assert.equal(stdout.trim(), "codex-supervisor loop tmux session already running: codex-supervisor-loop");
  } finally {
    await fs.rm(pathDir, { recursive: true, force: true });
  }
});
