import { Database, type SQLQueryBindings } from "bun:sqlite";
import { statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { AdapterError, AdapterErrorCode } from "../types";

export interface ThreadRow {
	id: string;
	title: string | null;
	cwd: string | null;
	created_at_ms: number | null;
	created_at: number | null;
	parent_thread_id: string | null;
	model: string | null;
	first_user_message: string | null;
	rollout_path: string | null;
}

export interface ThreadTreeRow {
	id: string;
	parent_id: string | null;
}

export class CodexRepository {
	private dbPath: string;
	private db: Database | null = null;
	private maxRetries = 3;

	constructor() {
		this.dbPath = join(homedir(), ".codex", "state_5.sqlite");
	}

	/** Open a read-only connection to the Codex state DB. */
	private open(): void {
		if (this.db) return;
		try {
			statSync(this.dbPath);
		} catch {
			throw new AdapterError(
				AdapterErrorCode.MISSING_FILE,
				`Codex state DB not found at ${this.dbPath}`,
				false,
				true, // can fall back to JSONL
			);
		}

		try {
			this.db = new Database(this.dbPath, { readonly: true });
			// Enable WAL mode for better concurrent read performance
			this.db.run("PRAGMA journal_mode=WAL");
		} catch (e: unknown) {
			throw new AdapterError(
				AdapterErrorCode.CORRUPT_DB,
				`Failed to open Codex state DB: ${(e as Error).message}`,
				false,
				true,
				e as Error,
			);
		}
	}

	/** Close the connection. */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	/** Reset connection state (for retry on SQLITE_BUSY). */
	private reset(): void {
		this.close();
	}

	/** Execute a query with auto-reconnect on SQLITE_BUSY. */
	private query<T>(sql: string, params: Record<string, unknown> = {}): T[] {
		this.open();
		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			try {
				const stmt = this.db!.prepare(sql);
				return stmt.all(
					...(Object.values(params) as SQLQueryBindings[]),
				) as T[];
			} catch (e: unknown) {
				const err = e as Error & { code?: string };
				if (err.code === "SQLITE_BUSY" && attempt < this.maxRetries - 1) {
					this.reset();
					continue;
				}
				if (
					err.code === "SQLITE_ERROR" &&
					err.message?.includes("no such table")
				) {
					throw new AdapterError(
						AdapterErrorCode.MISSING_TABLE,
						`Table not found in Codex state DB: ${err.message}`,
						true,
						true,
						err,
					);
				}
				throw new AdapterError(
					AdapterErrorCode.UNKNOWN,
					`Codex DB query failed: ${err.message}`,
					false,
					true,
					err,
				);
			}
		}
		return [];
	}

	/** Get thread metadata by session ID. */
	getThread(sessionId: string): ThreadRow | null {
		const rows = this.query<ThreadRow>(
			`SELECT id, title, cwd, created_at_ms, created_at, parent_thread_id, model, first_user_message, rollout_path FROM threads WHERE id = $id`,
			{ $id: sessionId },
		);
		return rows[0] ?? null;
	}

	/** Get thread tree relationships (parent + children). */
	getThreadTree(sessionId: string): {
		parentThreadId: string | null;
		childThreadIds: string[];
	} {
		const parentRows = this.query<{ parent_thread_id: string }>(
			`SELECT parent_thread_id FROM thread_spawn_edges WHERE child_thread_id = $id`,
			{ $id: sessionId },
		);

		const childRows = this.query<{ child_thread_id: string }>(
			`SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = $id`,
			{ $id: sessionId },
		);

		return {
			parentThreadId: parentRows[0]?.parent_thread_id ?? null,
			childThreadIds: childRows.map((r) => r.child_thread_id),
		};
	}

	/** Check if the threads table exists. */
	hasThreadsTable(): boolean {
		try {
			this.open();
			const rows = this.db!.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name='threads'`,
			).all() as { name: string }[];
			return rows.length > 0;
		} catch {
			return false;
		}
	}

	/** Get the session ID for a file path (used for fallback when DB is unavailable). */
	static sessionIdFromPath(filePath: string): string {
		// Normalize to forward slashes for cross-platform matching
		const normalized = filePath.replace(/\\/g, "/");

		// Extract the session directory name (UUID-like) from the path
		const match = normalized.match(/([^/]+)\/[^/]+\.jsonl$/);
		if (match?.[1]) return match[1];

		// Fall back to filename without extension
		return basename(filePath).replace(/\.jsonl$/, "") || filePath;
	}
}
