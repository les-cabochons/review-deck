import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ORGANIZATION_SETTINGS, describeAccess, enabledFor, readOrganizationSettings, withProject } from "../src/data/access";

test("Given no saved organization settings, then every project has the Deck and Changelog, and AI titles are allowed", () => {
  const s = readOrganizationSettings(null);
  assert.deepEqual(s, DEFAULT_ORGANIZATION_SETTINGS);
  assert.equal(enabledFor(s.deck, "p1"), true);
  assert.equal(enabledFor(s.changelog, "p1"), true);
});

test("Given malformed settings, then each part falls back to its default", () => {
  const s = readOrganizationSettings({ deck: { mode: "sometimes", projects: { p1: false, p2: "yes" } }, changelog: 3, aiTitles: "no" });
  assert.deepEqual(s.deck, { mode: "default-on", projects: { p1: false } });
  assert.deepEqual(s.changelog, { mode: "default-on", projects: {} });
  assert.equal(s.aiTitles, true);
  assert.equal(readOrganizationSettings({ aiTitles: false }).aiTitles, false);
});

test("Given a default-off feature, then only the projects turned on have it, and new projects don't", () => {
  const policy = withProject({ mode: "default-off", projects: {} }, "p1", true);
  assert.equal(enabledFor(policy, "p1"), true);
  assert.equal(enabledFor(policy, "p2"), false);
  assert.match(describeAccess(policy, "p1"), /On for this project/);
  assert.match(describeAccess(policy, "p2"), /Off, as for every project by default/);
});

test("Given a project switched back to the default, then it follows the default when that changes", () => {
  const off = withProject({ mode: "default-on", projects: {} }, "p1", false);
  const back = withProject(off, "p1", true);
  assert.deepEqual(back.projects, {});
  assert.equal(enabledFor({ ...back, mode: "default-off" }, "p1"), false);
});

test("Given the organization set a feature for every project, then project choices are ignored and can't change", () => {
  const policy = { mode: "off" as const, projects: { p1: true } };
  assert.equal(enabledFor(policy, "p1"), false);
  assert.equal(enabledFor({ mode: "on", projects: { p1: false } }, "p1"), true);
  assert.throws(() => withProject(policy, "p1", true), /every project/);
  assert.match(describeAccess(policy, "p1"), /turned this off for every project/);
});

test("Given the organization unlocks a feature, then projects' earlier choices apply again", () => {
  const policy = { mode: "on" as const, projects: { p1: false } };
  assert.equal(enabledFor({ ...policy, mode: "default-on" }, "p1"), false);
});
