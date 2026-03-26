import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import test from "node:test";
import { createManagedRestartControllerFromEnv } from "./managed-restart";

test("createManagedRestartControllerFromEnv defers requestStop until after requestRestart resolves", async () => {
  const events: string[] = [];
  const controller = createManagedRestartControllerFromEnv({
    env: {
      CODEX_SUPERVISOR_MANAGED_RESTART: "1",
      CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER: "systemd",
    },
    requestStop: async () => {
      events.push("stop");
    },
  });

  assert.ok(controller);

  const result = await controller.requestRestart();
  events.push("resolved");

  assert.deepEqual(result, {
    command: "managed-restart",
    accepted: true,
    summary: "Managed restart requested through the systemd launcher. This WebUI process will exit for relaunch.",
  });
  assert.deepEqual(events, ["resolved"]);

  await waitForImmediate();
  assert.deepEqual(events, ["resolved", "stop"]);
});
