import { readdir, stat } from "fs/promises";
import { join } from "path";
import { computeHash, getAdapter } from "./adapters/index";
import type {
	ConversationMeta,
	ScanContext,
	ScanStats,
	UnifiedStep,
} from "./adapters/types";
import { normalizeProviderId, type ProviderId } from "../shared/providers";

export interface ScanDirectory {
	id: string;
	path: string;
	provider: string;
}

export interface SearchStep {
	stepId: string;
	stepType: string;
	content: string;
}

export interface ScanResult {
	filePath: string;
	provider: ProviderId;
	contentHash: string;
	fileSize: number;
	scanDurationMs: number;
	fallbackTier: number;
	meta: Record<string, unknown> | null;
	searchSteps: SearchStep[];
}

export interface ScanProgress {
	stats: ScanStats;
	results: ScanResult[];
}

export async function runScanLogic(
	directories: ScanDirectory[],
	knownHashes: Record<string, string>,
	onBatch: (results: ScanResult[]) => void,
): Promise<ScanStats> {
	const stats: ScanStats = {
		totalFiles: 0,
		parsed: 0,
		skipped: 0,
		failed: 0,
		fallbackUsed: 0,
		durationMs: 0,
		scannedAt: new Date().toISOString(),
	};

	for (const dir of directories) {
		try {
			await stat(dir.path);
		} catch {
			continue;
		}

		const providerName = normalizeProviderId(dir.provider);
		let files: Array<{ path: string; sessionId: string; project?: string }> = [];

		if (providerName === "codex") {
			files = await enumerateCodexFiles(dir.path);
		} else if (providerName === "gemini-cli") {
			files = await enumerateGeminiCliFiles(dir.path);
		} else {
			files = await enumerateSessionDirs(dir.path);
		}

		stats.totalFiles += files.length;

		for (const file of files) {
			try {
				const result = await processFile(
					file.path,
					file.sessionId,
					{ ...dir, provider: providerName },
					knownHashes,
					file.project,
				);
				if (result.skipped) {
					stats.skipped++;
				} else if (result.parsed) {
					stats.parsed++;
				}
				if (result.fallbackUsed) stats.fallbackUsed++;
				if (result.result) onBatch([result.result]);
			} catch {
				stats.failed++;
			}
		}
	}

	return stats;
}

async function processFile(
	filePath: string,
	sessionId: string,
	dir: ScanDirectory,
	knownHashes: Record<string, string>,
	defaultProject?: string,
): Promise<{
	parsed: boolean;
	skipped: boolean;
	fallbackUsed: boolean;
	result: ScanResult | null;
}> {
	const fileStat = await stat(filePath);
	const hash = await computeHash(filePath);

	if (knownHashes[filePath] === hash) {
		return { parsed: false, skipped: true, fallbackUsed: false, result: null };
	}

	const scanStart = Date.now();
	const providerName = normalizeProviderId(dir.provider);
	const adapter = getAdapter(providerName);
	const context: ScanContext = {
		filePath,
		directoryPath: dir.path,
		directoryId: dir.id,
		provider: providerName,
		contentHash: hash,
	};

	const meta = await adapter.getMetadata(sessionId, context);
	const steps = await adapter.getTranscript(sessionId, context);

	if (!meta) {
		return {
			parsed: false,
			skipped: false,
			fallbackUsed: false,
			result: {
				filePath,
				provider: providerName,
				contentHash: hash,
				fileSize: fileStat.size,
				scanDurationMs: Date.now() - scanStart,
				fallbackTier: 1,
				meta: null,
				searchSteps: [],
			},
		};
	}

	if (defaultProject && meta.project === "Unknown") {
		meta.project = defaultProject;
	}

	const searchSteps = buildSearchSteps(steps);
	const hasError = steps.some((step) => step.type === "ERROR");

	return {
		parsed: true,
		skipped: false,
		fallbackUsed: meta.fallbackUsed,
		result: {
			filePath,
			provider: providerName,
			contentHash: hash,
			fileSize: fileStat.size,
			scanDurationMs: Date.now() - scanStart,
			fallbackTier: meta.fallbackTier,
			meta: conversationMetaToRecord(meta, hasError),
			searchSteps,
		},
	};
}

export function buildSearchSteps(steps: UnifiedStep[]): SearchStep[] {
	return steps
		.filter((step) => step.type !== "NOISE")
		.map((step) => {
			const parts: string[] = [];
			if (typeof step.content === "string") {
				parts.push(step.content);
			} else if (step.content !== undefined && step.content !== null) {
				parts.push(JSON.stringify(step.content));
			}

			if (step.toolCalls && step.toolCalls.length > 0) {
				parts.push(JSON.stringify(step.toolCalls));
			}

			return {
				stepId: step.id,
				stepType: step.type,
				content: parts.join("\n").trim(),
			};
		})
		.filter((step) => step.content.length > 0);
}

function conversationMetaToRecord(
	meta: ConversationMeta,
	hasError: boolean,
): Record<string, unknown> {
	return {
		id: meta.id,
		directory_id: meta.directoryId,
		title: meta.title,
		created_at: meta.createdAt,
		timestamp: meta.timestamp,
		project: meta.project,
		provider: normalizeProviderId(meta.provider),
		path: meta.path,
		content_hash: meta.contentHash,
		fallback_used: meta.fallbackUsed ? 1 : 0,
		fallback_tier: meta.fallbackTier,
		parent_thread_id: meta.parentThreadId ?? null,
		child_thread_ids: meta.childThreadIds ? JSON.stringify(meta.childThreadIds) : null,
		tokens_used: meta.tokensUsed ?? null,
		execution_time_ms: meta.executionTimeMs ?? null,
		sandbox_policy: meta.sandboxPolicy ?? null,
		has_error: hasError ? 1 : 0,
	};
}

async function enumerateCodexFiles(
	basePath: string,
): Promise<Array<{ path: string; sessionId: string }>> {
	const files: Array<{ path: string; sessionId: string }> = [];

	async function scanDir(currentPath: string): Promise<void> {
		try {
			const entries = await readdir(currentPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(currentPath, entry.name);
				if (entry.isDirectory()) {
					await scanDir(fullPath);
				} else if (entry.name.endsWith(".jsonl")) {
					files.push({
						path: fullPath,
						sessionId: entry.name.replace(/\.jsonl$/, ""),
					});
				}
			}
		} catch {
			// Skip unreadable directories.
		}
	}

	await scanDir(basePath);
	return files;
}

async function enumerateGeminiCliFiles(
	basePath: string,
): Promise<Array<{ path: string; sessionId: string; project: string }>> {
	const files: Array<{ path: string; sessionId: string; project: string }> = [];

	try {
		const subdirs = await readdir(basePath, { withFileTypes: true });
		for (const subdir of subdirs) {
			if (!subdir.isDirectory()) continue;
			const chatsPath = join(basePath, subdir.name, "chats");
			try {
				const chatFiles = (await readdir(chatsPath)).filter((file) =>
					file.endsWith(".jsonl"),
				);
				for (const file of chatFiles) {
					files.push({
						path: join(chatsPath, file),
						sessionId: `${subdir.name}/${file.replace(/\.jsonl$/, "")}`,
						project: subdir.name,
					});
				}
			} catch {
				// Skip projects without chat logs.
			}
		}
	} catch {
		// Skip inaccessible base directory.
	}

	return files;
}

async function enumerateSessionDirs(
	basePath: string,
): Promise<Array<{ path: string; sessionId: string }>> {
	const files: Array<{ path: string; sessionId: string }> = [];

	try {
		const entries = await readdir(basePath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const id = entry.name;

			if (id === "chats") {
				try {
					const chats = await readdir(join(basePath, "chats"), {
						withFileTypes: true,
					});
					for (const chat of chats) {
						if (!chat.name.endsWith(".jsonl")) continue;
						files.push({
							path: join(basePath, "chats", chat.name),
							sessionId: `chats/${chat.name.replace(/\.jsonl$/, "")}`,
						});
					}
				} catch {
					// Skip unreadable chat directory.
				}
				continue;
			}

			const logDir = join(basePath, id, ".system_generated", "logs");
			const transcriptPath = join(logDir, "transcript.jsonl");
			try {
				await stat(transcriptPath);
				files.push({ path: transcriptPath, sessionId: id });
			} catch {
				// transcript not found
			}

			try {
				const logFiles = (await readdir(logDir)).filter((file) =>
					file.endsWith(".pb"),
				);
				for (const file of logFiles) {
					files.push({ path: join(logDir, file), sessionId: `${id}/${file}` });
				}
			} catch {
				// skip
			}
		}
	} catch {
		// skip inaccessible base directory
	}

	return files;
}
