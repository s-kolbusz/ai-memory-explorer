import type { Database } from "bun:sqlite";

export interface Migration {
	version: number;
	name: string;
	up: (db: Database) => void;
}

function tableExists(db: Database, name: string): boolean {
	const rows = db
		.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
		.all(name) as Array<Record<string, unknown>>;
	return rows.length > 0;
}

function columnExists(db: Database, table: string, column: string): boolean {
	const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return rows.some((row) => row.name === column);
}

function createTableIfNotExists(
	db: Database,
	name: string,
	ddl: string,
): void {
	if (!tableExists(db, name)) db.run(ddl);
}

function addColumnIfNotExists(
	db: Database,
	table: string,
	column: string,
	definition: string,
): void {
	if (!columnExists(db, table, column)) {
		db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
	}
}

function normalizeProviders(db: Database): void {
	const cases = `
		CASE lower(replace(replace(provider, '_', '-'), ' ', '-'))
			WHEN 'codex' THEN 'codex'
			WHEN 'gemini-cli' THEN 'gemini-cli'
			WHEN 'geminicli' THEN 'gemini-cli'
			WHEN 'gemini' THEN 'gemini-cli'
			WHEN 'claude-code' THEN 'claude-code'
			WHEN 'claudecode' THEN 'claude-code'
			WHEN 'claude' THEN 'claude-code'
			ELSE 'antigravity'
		END
	`;

	if (tableExists(db, "directories")) {
		db.run(`UPDATE directories SET provider = ${cases}`);
	}
	if (tableExists(db, "conversations")) {
		db.run(`UPDATE conversations SET provider = ${cases}`);
	}
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "Initial schema",
		up(db) {
			createTableIfNotExists(
				db,
				"directories",
				`
					CREATE TABLE directories (
						id TEXT PRIMARY KEY,
						path TEXT UNIQUE NOT NULL,
						provider TEXT NOT NULL,
						is_custom INTEGER DEFAULT 0,
						created_at TEXT DEFAULT (datetime('now'))
					)
				`,
			);

			createTableIfNotExists(
				db,
				"conversations",
				`
					CREATE TABLE conversations (
						id TEXT PRIMARY KEY,
						directory_id TEXT NOT NULL,
						title TEXT,
						timestamp TEXT,
						project TEXT,
						provider TEXT NOT NULL,
						path TEXT NOT NULL,
						content_hash TEXT,
						fallback_used INTEGER DEFAULT 0,
						fallback_tier INTEGER DEFAULT 1,
						parent_thread_id TEXT,
						child_thread_ids TEXT,
						tokens_used INTEGER,
						execution_time_ms INTEGER,
						sandbox_policy TEXT,
						created_at TEXT,
						FOREIGN KEY (directory_id) REFERENCES directories (id) ON DELETE CASCADE
					)
				`,
			);

			if (!tableExists(db, "conversation_search")) {
				db.run(`
					CREATE VIRTUAL TABLE conversation_search USING fts5(
						conversation_id UNINDEXED,
						content,
						tokenize='porter unicode61'
					)
				`);
			}

			createTableIfNotExists(
				db,
				"scanned_files",
				`
					CREATE TABLE scanned_files (
						path TEXT PRIMARY KEY,
						content_hash TEXT NOT NULL,
						provider TEXT NOT NULL,
						file_size INTEGER NOT NULL,
						last_scanned_at TEXT NOT NULL,
						scan_duration_ms INTEGER,
						fallback_tier INTEGER DEFAULT 1
					)
				`,
			);

			createTableIfNotExists(
				db,
				"scan_history",
				`
					CREATE TABLE scan_history (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						scanned_at TEXT NOT NULL,
						total_files INTEGER NOT NULL,
						parsed INTEGER NOT NULL,
						skipped INTEGER NOT NULL,
						failed INTEGER NOT NULL,
						fallback_used INTEGER NOT NULL,
						duration_ms INTEGER NOT NULL
					)
				`,
			);
		},
	},
	{
		version: 2,
		name: "Add has_error filter column",
		up(db) {
			addColumnIfNotExists(db, "conversations", "has_error", "INTEGER DEFAULT 0");
		},
	},
	{
		version: 3,
		name: "Add step-level search and normalize providers",
		up(db) {
			normalizeProviders(db);

			if (!tableExists(db, "conversation_step_search")) {
				db.run(`
					CREATE VIRTUAL TABLE conversation_step_search USING fts5(
						conversation_id UNINDEXED,
						step_id UNINDEXED,
						step_type UNINDEXED,
						content,
						tokenize='porter unicode61'
					)
				`);
			}
		},
	},
];

export function getCurrentSchemaVersion(db: Database): number {
	if (!tableExists(db, "schema_migrations")) return 0;

	const rows = db
		.query("SELECT MAX(version) AS version FROM schema_migrations")
		.all() as Array<{ version: number | null }>;
	return rows[0]?.version ?? 0;
}

export function runMigrations(db: Database): void {
	db.run(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT DEFAULT (datetime('now'))
		)
	`);

	const currentVersion = getCurrentSchemaVersion(db);
	const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
	if (pending.length === 0) return;

	console.log(`Running ${pending.length} database migration(s)...`);
	db.transaction(() => {
		for (const migration of pending) {
			console.log(` -> ${migration.version}: ${migration.name}`);
			migration.up(db);
			db.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
				migration.version,
				migration.name,
			]);
		}
	})();
	console.log(`Database at schema version ${getCurrentSchemaVersion(db)}`);
}
