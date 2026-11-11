import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { appliedMigrationNames, describeMigrationFailure, MIGRATIONS_DIR } from "./migrate.js";

// Guards on the migrations folder itself, so a malformed file fails CI rather
// than a deploy. CI also applies every migration to an empty Postgres.

const files = readdirSync(MIGRATIONS_DIR).filter((f) => !f.startsWith("."));

describe("migrations folder", () => {
  // `npm run migrate:create -- add_thing` writes NNNN_add-thing.sql.
  it("holds only numbered .sql files: NNNN_lower-case-name.sql", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_-]+\.sql$/);
  });

  it("numbers them 0001, 0002, … with no gaps or duplicates", () => {
    const numbers = files.map((f) => Number(f.slice(0, 4))).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("gives every file an explicit Up Migration section", () => {
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      expect(sql, f).toMatch(/^-- Up Migration$/m);
    }
  });

  it("puts Down Migration after Up when there is one", () => {
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      const down = sql.search(/^-- Down Migration$/m);
      if (down >= 0) expect(down, f).toBeGreaterThan(sql.search(/^-- Up Migration$/m));
    }
  });

  // A down section here would let `migrate:down` drop live tables.
  it("keeps the baseline (0001–0007) and the legacy-table drop (0008) irreversible", () => {
    for (const f of files.filter((name) => Number(name.slice(0, 4)) <= 8)) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      expect(sql, f).not.toMatch(/^-- Down Migration$/m);
    }
  });
});

describe("describeMigrationFailure", () => {
  it("names the failing migration and Postgres' reason", () => {
    const stdout = "### MIGRATION 0009_drop_redundant_garmin_index (UP) ###\n…\n### MIGRATION 0010_broken (UP) ###\nALTER TABLE …";
    const stderr = [
      "Error executing:",
      "ALTER TABLE does_not_exist ADD COLUMN x INT;",
      'error: relation "does_not_exist" does not exist',
      "> Rolling back attempted migration ...",
      "  routine: 'RangeVarGetRelidExtended'",
      "}",
    ].join("\n");
    expect(describeMigrationFailure(stdout, stderr)).toBe('Migration 0010_broken failed: relation "does_not_exist" does not exist');
  });

  it("still says something useful when it fails before any migration runs", () => {
    expect(describeMigrationFailure("", "could not connect to postgres: Error: connect ECONNREFUSED")).toBe(
      "Migrations failed: could not connect to postgres: Error: connect ECONNREFUSED",
    );
  });
});

describe("appliedMigrationNames", () => {
  it("reads the migrations the CLI reports applying", () => {
    const output = [
      "> Migrating files:",
      "> - 0008_drop_legacy_tables",
      "### MIGRATION 0008_drop_legacy_tables (UP) ###",
      "DROP TABLE IF EXISTS meals;",
      "### MIGRATION 0009_drop_redundant_garmin_index (UP) ###",
      "Migrations complete!",
    ].join("\n");
    expect(appliedMigrationNames(output)).toEqual(["0008_drop_legacy_tables", "0009_drop_redundant_garmin_index"]);
    expect(appliedMigrationNames("No migrations to run!\nMigrations complete!")).toEqual([]);
  });
});
