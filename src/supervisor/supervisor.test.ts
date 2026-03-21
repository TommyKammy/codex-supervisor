import test from "node:test";
import assert from "node:assert/strict";
import { createSupervisorLoopController, createSupervisorService, Supervisor } from "./index";

test("supervisor module continues to export the Supervisor class", () => {
  assert.equal(typeof Supervisor, "function");
});

test("supervisor module exports the supervisor application service factory", () => {
  assert.equal(typeof createSupervisorService, "function");
});

test("supervisor module exports the supervisor loop controller factory", () => {
  assert.equal(typeof createSupervisorLoopController, "function");
});
