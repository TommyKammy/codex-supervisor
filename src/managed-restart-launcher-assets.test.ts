import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
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
  assert.match(runWeb, /CODEX_SUPERVISOR_MANAGED_RESTART/u);
  assert.match(runWeb, /CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER/u);

  assert.match(launchdTemplate, /io\.codex\.supervisor\.web/u);
  assert.match(launchdTemplate, /scripts\/run-web\.sh/u);
  assert.match(launchdTemplate, /CODEX_SUPERVISOR_MANAGED_RESTART/u);
  assert.match(launchdTemplate, /<string>launchd<\/string>/u);

  assert.match(systemdTemplate, /codex-supervisor WebUI/u);
  assert.match(systemdTemplate, /scripts\/run-web\.sh/u);
  assert.match(systemdTemplate, /Environment=CODEX_SUPERVISOR_MANAGED_RESTART=1/u);
  assert.match(systemdTemplate, /Environment=CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER=systemd/u);

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
  assert.doesNotMatch(runLoop, /CODEX_SUPERVISOR_MANAGED_RESTART/u);
  assert.doesNotMatch(launchdTemplate, /CODEX_SUPERVISOR_MANAGED_RESTART/u);
  assert.doesNotMatch(systemdTemplate, /CODEX_SUPERVISOR_MANAGED_RESTART/u);
});
