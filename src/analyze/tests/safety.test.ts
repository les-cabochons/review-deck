import assert from "node:assert/strict";
import { test } from "node:test";
import type { HunkInfo } from "../../core/types.js";
import { analyzeDiff, analyzeFile } from "./analyze.js";

// Built at run time, so no scanner reads this file as holding credentials.
const AWS_KEY = `AKIA${"IOSFODNN7EXAMPLE"}`;
const AZURITE_KEY = `Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq${"/K1SZFPTOtr/KBHBeksoGMGw=="}`;

const rules = (hunks: HunkInfo[]) => hunks.flatMap((h) => h.findings.map((f) => `${f.rule} @${f.line}`));

test("Given an added line holding a cloud access key, then its hunk has a high secret finding on that line, without the key in it", async () => {
  const [hunk] = await analyzeFile("src/storage.ts", ["export const region = 'ca-central-1';"], ["export const region = 'ca-central-1';", `export const accessKey = "${AWS_KEY}";`]);
  assert.deepEqual(hunk.findings.map((f) => [f.kind, f.severity, f.rule, f.line]), [["secret", "high", "AWS access key", 2]]);
  assert.ok(!JSON.stringify(hunk.findings).includes(AWS_KEY), "a finding is saved with the guide, so it must not carry the secret");
});

test("Given the same key in a test, a doc or an example env file, then nothing is flagged: those hold sample values on purpose", async () => {
  for (const path of ["src/tests/storage.test.ts", "src/storage.test.ts", "docs/setup.md", ".env.example", "fixtures/config.json"]) {
    assert.deepEqual(rules(await analyzeFile(path, ["# setup"], ["# setup", `ACCESS_KEY="${AWS_KEY}"`])), [], path);
  }
});

test("Given a password-like setting, then a real-looking value is flagged and a placeholder or a dev default isn't", async () => {
  const flagged = await analyzeFile("src/config.ts", ["export {};"], ["export {};", `const password = "h7Gq2-vLp9xT";`, `const url = "postgres://app:Zk3-pq8Lm@db.internal/shop";`]);
  assert.deepEqual(rules(flagged), ["Password or secret in code @2", "Password in a connection URL @3"]);
  const harmless = await analyzeFile(
    "src/config.ts",
    ["export {};"],
    ["export {};", `const password = "changeme";`, `const field = { accessToken: "saved-access-token" };`, `const url = "postgres://app:app@localhost/shop";`, `const storage = "AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};";`],
  );
  assert.deepEqual(rules(harmless), []);
});

test("Given a committed env file, then its first hunk is flagged for the file itself", async () => {
  const [hunk] = await analyzeFile(".env.production", null, ["LOG_LEVEL=info"]);
  assert.deepEqual(hunk.findings.map((f) => [f.rule, f.line]), [["Env file committed", null]]);
});

test("Given a committed key file, then it is flagged and not folded away with the mechanical changes", async () => {
  const diff = ["diff --git a/certs/prod.pfx b/certs/prod.pfx", "new file mode 100644", "Binary files /dev/null and b/certs/prod.pfx differ", ""].join("\n");
  const [hunk] = await analyzeDiff(diff);
  assert.deepEqual(rules([hunk]), ["Key file committed @null"]);
  assert.equal(hunk.mechanical, null);
});

test("Given a generated file, then it isn't scanned: nobody wrote it", async () => {
  const hunks = await analyzeFile("src/generated/client.ts", ["export {};"], ["export {};", `export const key = "${AWS_KEY}";`]);
  assert.equal(hunks[0].mechanical?.kind, "generated");
  assert.deepEqual(rules(hunks), []);
});

test("Given a SQL migration that drops a column, then it is flagged, but not in its down section or in a rollback file", async () => {
  const up = ["-- migrate:up", "ALTER TABLE orders ADD COLUMN note text;"];
  const dropInUp = await analyzeFile("db/migrations/003_orders.sql", up, [...up, "ALTER TABLE orders DROP COLUMN legacy_code;"]);
  assert.deepEqual(rules(dropInUp), ["Drops a column @3"]);
  assert.equal(dropInUp[0].findings[0].severity, "high");

  const withDown = [...up, "-- migrate:down"];
  assert.deepEqual(rules(await analyzeFile("db/migrations/003_orders.sql", withDown, [...withDown, "ALTER TABLE orders DROP COLUMN note;"])), []);
  assert.deepEqual(rules(await analyzeFile("db/migrations/003_orders.down.sql", null, ["ALTER TABLE orders DROP COLUMN note;"])), []);
});

test("Given a DELETE or UPDATE in a migration, then it is flagged only when its statement has no WHERE, even on a later line", async () => {
  const hunks = await analyzeFile("db/migrations/004_cleanup.sql", null, [
    "DELETE FROM sessions",
    "  WHERE expires_at < now();",
    "UPDATE orders SET status = 'open';",
    "UPDATE orders SET status = 'late' WHERE due < now();",
  ]);
  assert.deepEqual(rules(hunks), ["Writes rows without WHERE @3"]);
});

test("Given an EF Core migration, then a column dropped in Up is flagged and the table dropped in Down isn't", async () => {
  const file = (up: string[]) => [
    "public partial class AddOrderNotes : Migration",
    "{",
    "    protected override void Up(MigrationBuilder migrationBuilder)",
    "    {",
    '        migrationBuilder.CreateTable(name: "OrderNotes");',
    ...up,
    "    }",
    "",
    "    protected override void Down(MigrationBuilder migrationBuilder)",
    "    {",
    '        migrationBuilder.DropTable(name: "OrderNotes");',
    "    }",
    "}",
  ];
  const added = await analyzeFile("src/Shop.Data/Migrations/20261120_AddOrderNotes.cs", null, file(['        migrationBuilder.DropColumn(name: "LegacyCode", table: "Orders");']));
  assert.deepEqual(rules(added), ["Drops a column @6"]);
});

test("Given SQL keywords in ordinary code outside a migration, then nothing is flagged", async () => {
  const hunks = await analyzeFile("src/admin/reset.ts", ["export {};"], ["export {};", 'await db.query("DROP TABLE sessions");']);
  assert.deepEqual(rules(hunks), []);
});
