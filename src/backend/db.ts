import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ScanStats } from "./adapters/types";
import { runMigrations } from "./migrations";
import { injectDeps } from "./scanner";
import {
	normalizeProviderId,
	PROVIDER_IDS,
	type ProviderId,
} from "../shared/providers";

const dbDir = join(homedir(), ".gemini", "antigravity-cli");
try {
	mkdirSync(dbDir, { recursive: true });
} catch {
	// The next SQLite open will surface a useful error if the directory is unusable.
}

const dbPath = join(dbDir, "explorer.db");
export const db = new Database(dbPath);

db.run("PRAGMA journal_mode=WAL");
runMigrations(db);

export interface DirectoryRecord {
	id: string;
	path: string;
	provider: ProviderId;
	is_custom: number;
}

export interface ConversationRecord {
	id: string;
	directory_id: string;
	title: string | null;
	created_at: string | null;
	timestamp: string | null;
	project: string | null;
	provider: ProviderId;
	path: string | null;
	content_hash: string | null;
	fallback_used: number;
	fallback_tier: number;
	parent_thread_id: string | null;
	child_thread_ids: string | null;
	tokens_used: number | null;
	execution_time_ms: number | null;
	sandbox_policy: string | null;
	has_error: number;
}

export interface IndexedStepRecord {
	stepId: string;
	stepType: string;
	content: string;
}

export interface SearchResult extends ConversationRecord {
	snippet: string;
	stepId: string | null;
	stepType: string | null;
}

export interface ConversationFilters {
	limit: number;
	cursor?: string;
	directoryId?: string;
	provider?: ProviderId;
	hasError?: boolean;
	dateFrom?: string;
	dateTo?: string;
}

export interface PaginatedResult<T> {
	items: T[];
	nextCursor?: string;
	hasMore: boolean;
}

const insertDir = db.prepare(`
	INSERT OR IGNORE INTO directories (id, path, provider, is_custom)
	VALUES ($id, $path, $provider, $is_custom)
`);

const insertConvo = db.prepare(`
	INSERT OR REPLACE INTO conversations (
		id, directory_id, title, created_at, timestamp, project, provider, path,
		content_hash, fallback_used, fallback_tier,
		parent_thread_id, child_thread_ids,
		tokens_used, execution_time_ms, sandbox_policy, has_error
	) VALUES (
		$id, $directory_id, $title, $created_at, $timestamp, $project, $provider, $path,
		$content_hash, $fallback_used, $fallback_tier,
		$parent_thread_id, $child_thread_ids,
		$tokens_used, $execution_time_ms, $sandbox_policy, $has_error
	)
`);

const insertSearch = db.prepare(`
	INSERT INTO conversation_search (conversation_id, content)
	VALUES ($id, $content)
`);

const deleteSearch = db.prepare(`
	DELETE FROM conversation_search WHERE conversation_id = $id
`);

const insertStepSearch = db.prepare(`
	INSERT INTO conversation_step_search (conversation_id, step_id, step_type, content)
	VALUES ($conversation_id, $step_id, $step_type, $content)
`);

const deleteStepSearch = db.prepare(`
	DELETE FROM conversation_step_search WHERE conversation_id = $conversation_id
`);

const upsertScannedFileStmt = db.prepare(`
	INSERT OR REPLACE INTO scanned_files (
		path, content_hash, provider, file_size, last_scanned_at, scan_duration_ms, fallback_tier
	) VALUES (
		$path, $content_hash, $provider, $file_size, $last_scanned_at, $scan_duration_ms, $fallback_tier
	)
`);

const insertScanHistory = db.prepare(`
	INSERT INTO scan_history (
		scanned_at, total_files, parsed, skipped, failed, fallback_used, duration_ms
	) VALUES (
		$scanned_at, $total_files, $parsed, $skipped, $failed, $fallback_used, $duration_ms
	)
`);

function directoryId(path: string): string {
	return Buffer.from(path).toString("base64");
}

function insertDirParams(path: string, provider: string, isCustom: number) {
	return {
		$id: directoryId(path),
		$path: path,
		$provider: normalizeProviderId(provider),
		$is_custom: isCustom,
	};
}

const home = homedir();
const defaultPaths = [
	{
		path: join(home, ".gemini", "antigravity-cli", "brain"),
		provider: "antigravity",
		isCustom: 0,
	},
	{
		path: join(home, ".gemini", "antigravity", "brain"),
		provider: "antigravity",
		isCustom: 0,
	},
	{ path: join(home, ".codex", "sessions"), provider: "codex", isCustom: 0 },
	{ path: join(home, ".gemini", "tmp"), provider: "gemini-cli", isCustom: 0 },
	{
		path: join(home, ".claude", "sessions"),
		provider: "claude-code",
		isCustom: 0,
	},
] as const;

export function initDefaultDirectories(): void {
	db.transaction(() => {
		for (const dp of defaultPaths) {
			insertDir.run(insertDirParams(dp.path, dp.provider, dp.isCustom));
		}
	})();
}

export function getAllDirectories(): DirectoryRecord[] {
	return db.query("SELECT * FROM directories").all() as DirectoryRecord[];
}

export function addCustomDirectory(path: string, provider: string): void {
	insertDir.run(insertDirParams(path, provider, 1));
}

export function removeCustomDirectory(id: string): void {
	db.run("DELETE FROM directories WHERE id = ? AND is_custom = 1", [id]);
}

export function upsertConversation(convo: Record<string, unknown>): void {
	insertConvo.run({
		$id: convo.id as string,
		$directory_id: convo.directory_id as string,
		$title: (convo.title ?? null) as string | null,
		$created_at: (convo.created_at ?? null) as string | null,
		$timestamp: (convo.timestamp ?? null) as string | null,
		$project: (convo.project ?? null) as string | null,
		$provider: normalizeProviderId(String(convo.provider ?? "antigravity")),
		$path: (convo.path ?? null) as string | null,
		$content_hash: (convo.content_hash ?? null) as string | null,
		$fallback_used: (convo.fallback_used ?? 0) as number,
		$fallback_tier: (convo.fallback_tier ?? 1) as number,
		$parent_thread_id: (convo.parent_thread_id ?? null) as string | null,
		$child_thread_ids: (convo.child_thread_ids ?? null) as string | null,
		$tokens_used: (convo.tokens_used ?? null) as number | null,
		$execution_time_ms: (convo.execution_time_ms ?? null) as number | null,
		$sandbox_policy: (convo.sandbox_policy ?? null) as string | null,
		$has_error: (convo.has_error ?? 0) as number,
	});
}

export function indexConversationContent(id: string, content: string): void {
	db.transaction(() => {
		deleteSearch.run({ $id: id });
		insertSearch.run({ $id: id, $content: content });
	})();
}

export function indexConversationSteps(
	conversationId: string,
	steps: IndexedStepRecord[],
): void {
	const legacyContent = steps.map((step) => step.content).join("\n\n");

	db.transaction(() => {
		deleteSearch.run({ $id: conversationId });
		deleteStepSearch.run({ $conversation_id: conversationId });

		if (legacyContent.trim()) {
			insertSearch.run({ $id: conversationId, $content: legacyContent });
		}

		for (const step of steps) {
			const content = step.content.trim();
			if (!content) continue;
			insertStepSearch.run({
				$conversation_id: conversationId,
				$step_id: step.stepId,
				$step_type: step.stepType,
				$content: content,
			});
		}
	})();
}

export function getConversations(): ConversationRecord[] {
	return db
		.query("SELECT * FROM conversations ORDER BY timestamp DESC")
		.all() as ConversationRecord[];
}

export function getConversationById(id: string): ConversationRecord | null {
	const results = db
		.query("SELECT * FROM conversations WHERE id = ?")
		.all(id) as ConversationRecord[];
	return results[0] ?? null;
}

export function getConversationsPaginated(
	filters: ConversationFilters,
): PaginatedResult<ConversationRecord> {
	const conditions: string[] = [];
	const params: Array<string | number> = [];

	if (filters.cursor) {
		conditions.push("timestamp < ?");
		params.push(filters.cursor);
	}
	if (filters.directoryId) {
		conditions.push("directory_id = ?");
		params.push(filters.directoryId);
	}
	if (filters.provider) {
		conditions.push("provider = ?");
		params.push(filters.provider);
	}
	if (filters.hasError !== undefined) {
		conditions.push("has_error = ?");
		params.push(filters.hasError ? 1 : 0);
	}
	if (filters.dateFrom) {
		conditions.push("timestamp >= ?");
		params.push(filters.dateFrom);
	}
	if (filters.dateTo) {
		conditions.push("timestamp <= ?");
		params.push(filters.dateTo);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = Math.min(Math.max(filters.limit, 1), 100);
	const rows = db
		.query(`SELECT * FROM conversations ${where} ORDER BY timestamp DESC LIMIT ?`)
		.all(...([...params, limit + 1] as SQLQueryBindings[])) as ConversationRecord[];

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	return {
		items,
		nextCursor: hasMore ? (items.at(-1)?.timestamp ?? undefined) : undefined,
		hasMore,
	};
}

export function getScannedFile(path: string): { content_hash: string } | null {
	const results = db
		.query("SELECT content_hash FROM scanned_files WHERE path = ?")
		.all(path) as Array<{ content_hash: string }>;
	return results[0] ?? null;
}

export function getAllScannedFileHashes(): Record<string, string> {
	const rows = db
		.query("SELECT path, content_hash FROM scanned_files")
		.all() as Array<{ path: string; content_hash: string }>;
	const map: Record<string, string> = {};
	for (const row of rows) map[row.path] = row.content_hash;
	return map;
}

export function upsertScannedFile(record: {
	path: string;
	content_hash: string;
	provider: string;
	file_size: number;
	last_scanned_at: string;
	scan_duration_ms: number;
	fallback_tier: number;
}): void {
	upsertScannedFileStmt.run({
		$path: record.path,
		$content_hash: record.content_hash,
		$provider: normalizeProviderId(record.provider),
		$file_size: record.file_size,
		$last_scanned_at: record.last_scanned_at,
		$scan_duration_ms: record.scan_duration_ms,
		$fallback_tier: record.fallback_tier,
	});
}

export function recordScan(stats: ScanStats): void {
	insertScanHistory.run({
		$scanned_at: stats.scannedAt,
		$total_files: stats.totalFiles,
		$parsed: stats.parsed,
		$skipped: stats.skipped,
		$failed: stats.failed,
		$fallback_used: stats.fallbackUsed,
		$duration_ms: stats.durationMs,
	});
}

export function getScanHistory(limit = 10): Array<Record<string, unknown>> {
	return db
		.query("SELECT * FROM scan_history ORDER BY scanned_at DESC LIMIT ?")
		.all(limit) as Array<Record<string, unknown>>;
}

function buildFtsQuery(query: string): string {
	return query
		.replace(/['"\\]/g, "")
		.trim()
		.split(/\s+/)
		.map((word) => {
			const parts = word.split(/[^\w]+/).filter(Boolean);
			if (parts.length > 1) return `"${parts.join(" ")}"*`;
			if (parts.length === 1) return `"${parts[0]}"*`;
			return "";
		})
		.filter(Boolean)
		.join(" ");
}

function buildLikeSnippet(content: string, query: string): string {
	const lowerContent = content.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const index = lowerContent.indexOf(lowerQuery);
	if (index === -1) return content.slice(0, 180);
	const start = Math.max(0, index - 70);
	const end = Math.min(content.length, index + query.length + 90);
	return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}

export function searchConversationsFts5(query: string): SearchResult[] {
	const sanitized = buildFtsQuery(query);
	if (!sanitized) return [];

	try {
		return db
			.query(`
				SELECT
					c.*,
					snippet(conversation_step_search, 3, '<b>', '</b>', '...', 40) AS snippet,
					conversation_step_search.step_id AS stepId,
					conversation_step_search.step_type AS stepType
				FROM conversation_step_search
				JOIN conversations c ON conversation_step_search.conversation_id = c.id
				WHERE conversation_step_search MATCH ?
				ORDER BY rank
				LIMIT 50
			`)
			.all(sanitized) as SearchResult[];
	} catch {
		const rows = db
			.query(`
				SELECT c.*, s.content, s.step_id AS stepId, s.step_type AS stepType
				FROM conversation_step_search s
				JOIN conversations c ON s.conversation_id = c.id
				WHERE s.content LIKE ?
				LIMIT 50
			`)
			.all(`%${query}%`) as Array<SearchResult & { content: string }>;

		return rows.map((row) => ({
			...row,
			snippet: buildLikeSnippet(row.content, query),
			stepId: row.stepId ?? null,
			stepType: row.stepType ?? null,
		}));
	}
}

export function getProviders(): ProviderId[] {
	const rows = db
		.query("SELECT DISTINCT provider FROM conversations")
		.all() as Array<{ provider: string }>;
	const present = new Set(rows.map((row) => normalizeProviderId(row.provider)));
	return PROVIDER_IDS.filter((provider) => present.has(provider));
}

export function getProjects(providerFilter?: ProviderId | null): string[] {
	const conversations = getConversations();
	const filtered = providerFilter
		? conversations.filter((conversation) => conversation.provider === providerFilter)
		: conversations;
	const projectMap = new Map<string, number>();

	for (const conversation of filtered) {
		let project = conversation.project || "Unknown";
		if (/^[0-9a-fA-F-]{36}$/.test(project) || /^[0-9a-fA-F]{64}$/.test(project)) {
			project = "Unknown";
		}
		project = project.replace(/["']$/g, "");

		const timestamp = new Date(conversation.timestamp ?? 0).getTime();
		if (!projectMap.has(project) || timestamp > projectMap.get(project)!) {
			projectMap.set(project, timestamp);
		}
	}

	return Array.from(projectMap.keys()).sort(
		(a, b) => projectMap.get(b)! - projectMap.get(a)!,
	);
}

injectDeps({
	getAllDirectories,
	getAllScannedFileHashes,
	getScannedFile,
	upsertScannedFile,
	upsertConversation,
	indexConversationContent,
	indexConversationSteps,
	recordScan,
});
