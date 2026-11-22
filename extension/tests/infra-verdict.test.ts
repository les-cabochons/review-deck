import assert from "node:assert/strict";
import { test } from "node:test";
import type { InfraBlock, Risk } from "../../src/infra/types";
import { verdict } from "../src/ui/infra/verdict";

const removed = (risk: Risk): InfraBlock => ({
  address: "azurerm_storage_account.this",
  kind: "resource",
  type: "azurerm_storage_account",
  name: "this",
  file: "infra/main.tf",
  line: 1,
  status: "removed",
  docsOnly: false,
  changes: [],
  risk,
  notes: [],
});

test("Given a destroy reading, then its label carries the reading's certainty", () => {
  assert.equal(verdict(removed({ kind: "destroy", certainty: "likely", reason: "" })).label, "destroy likely");
  assert.equal(verdict(removed({ kind: "destroy", certainty: "possible", reason: "" })).label, "destroy possible");
});
