import test from "node:test";
import assert from "node:assert/strict";
import { Supervisor } from "./supervisor";

test("supervisor module continues to export the Supervisor class", () => {
  assert.equal(typeof Supervisor, "function");
});
