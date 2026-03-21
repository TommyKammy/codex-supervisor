import assert from "node:assert/strict";
import test from "node:test";
import { createSupervisorLoopControllerFromSupervisor } from "./supervisor-loop-controller";

test("loop controller falls back when a skipped lock has no reason", async () => {
  const loopController = createSupervisorLoopControllerFromSupervisor({
    acquireSupervisorLock: async () => ({
      acquired: false,
      release: async () => {},
    }),
    runOnce: async () => {
      throw new Error("unexpected runOnce");
    },
  } as never);

  const result = await loopController.runCycle("loop", { dryRun: false });

  assert.equal(result, "Skipped supervisor cycle: lock unavailable.");
});
