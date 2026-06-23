import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
	runMigrations,
	getCurrentSchemaVersion,
	MIGRATIONS,
} from "../src/backend/migrations";

describe("Migrations", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
	});

	test("starts at version 0 for a fresh database", () => {
		expect(getCurrentSchemaVersion(db)).toBe(0);
	});

	test("applies all migrations and tracks schema version", () => {
		runMigrations(db);
		expect(getCurrentSchemaVersion(db)).toBe(MIGRATIONS.length);
	});

	test("is idempotent across multiple runs", () => {
		runMigrations(db);
		runMigrations(db);
		runMigrations(db);
		expect(getCurrentSchemaVersion(db)).toBe(MIGRATIONS.length);
	});

	test("creates all required tables", () => {
		runMigrations(db);
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as Array<{ name: string }>;
		const names = tables.map((t) => t.name).sort();
		expect(names).toContain("directories");
		expect(names).toContain("conversations");
		expect(names).toContain("scanned_files");
		expect(names).toContain("scan_history");
		expect(names).toContain("schema_migrations");
	});

	test("creates FTS5 virtual table", () => {
		runMigrations(db);
		const vtables = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as Array<{ name: string }>;
		expect(vtables.map((t) => t.name)).toContain("conversation_search");
		expect(vtables.map((t) => t.name)).toContain("conversation_step_search");
	});

	test("adds beta filter and normalizes provider values", () => {
		runMigrations(db);
		const columns = db.query("PRAGMA table_info(conversations)").all() as Array<{
			name: string;
		}>;
		expect(columns.map((column) => column.name)).toContain("has_error");

		db.run(
			"INSERT INTO directories (id, path, provider, is_custom) VALUES ('d1', '/tmp/one', 'ClaudeCode', 1)",
		);
		db.run(
			"INSERT INTO conversations (id, directory_id, provider, path, has_error) VALUES ('c1', 'd1', 'Gemini CLI', '/tmp/one/log.jsonl', 1)",
		);
		MIGRATIONS[2]!.up(db);

		const directories = db
			.query("SELECT provider FROM directories WHERE id = 'd1'")
			.all() as Array<{ provider: string }>;
		const conversations = db
			.query("SELECT provider, has_error FROM conversations WHERE id = 'c1'")
			.all() as Array<{ provider: string; has_error: number }>;

		expect(directories[0]?.provider).toBe("claude-code");
		expect(conversations[0]?.provider).toBe("gemini-cli");
		expect(conversations[0]?.has_error).toBe(1);
	});
});
