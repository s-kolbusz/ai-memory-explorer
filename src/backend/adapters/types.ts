// ==== Error Classification ====
export enum AdapterErrorCode {
	MISSING_FILE = "MISSING_FILE",
	CORRUPT_DB = "CORRUPT_DB",
	MISSING_TABLE = "MISSING_TABLE",
	PARSE_FAILURE = "PARSE_FAILURE",
	PERMISSION_DENIED = "PERMISSION_DENIED",
	UNKNOWN = "UNKNOWN",
}

export class AdapterError extends Error {
	constructor(
		public code: AdapterErrorCode,
		message: string,
		public recoverable: boolean,
		public fallbackAvailable: boolean,
		public sourceError?: Error,
	) {
		super(message);
		this.name = "AdapterError";
	}
}

// ==== Source File Tracking ====
export interface SourceFileRecord {
	path: string;
	contentHash: string; // SHA256 of raw file
	lastScannedAt: string; // ISO timestamp
	fallbackUsed: boolean; // true if DB was unavailable
	fallbackTier: 1 | 2 | 3; // 1=clean, 2=table-missing, 3=corrupted
	provider: string; // normalized lowercase
}

// ==== Unified Output Schema ====
export interface ConversationMeta {
	// Identity
	id: string; // session/thread UUID
	directoryId: string; // FK to directories table
	provider: string; // normalized: 'antigravity', 'codex', 'gemini-cli', 'claude-code'

	// Display
	title: string;
	project: string; // inferred from CWD / tool calls

	// Timing
	createdAt: string; // ISO string of first activity
	timestamp: string; // ISO string of last activity

	// Thread hierarchy
	parentThreadId?: string;
	childThreadIds?: string[];

	// Advanced metadata (populated when native DB is available)
	tokensUsed?: number;
	executionTimeMs?: number;
	sandboxPolicy?: string;

	// File tracking
	path: string;
	contentHash: string;
	fallbackUsed: boolean;
	fallbackTier: 1 | 2 | 3;
}

export type UnifiedStepType =
	| "USER"
	| "AGENT"
	| "TOOL_USE"
	| "SYSTEM"
	| "TERMINAL_OUTPUT"
	| "FILE_PREVIEW"
	| "DIFF_OUTPUT"
	| "NOISE"
	| "ERROR";

export interface UnifiedStep {
	id: string;
	index: number;
	type: UnifiedStepType;
	content: string;
	timestamp?: string;
	toolCalls?: ToolCall[];
	metadata?: StepMetadata;
}

export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
	result?: unknown;
	durationMs?: number; // populated from native DB timestamps
	tokens?: number;
}

export interface StepMetadata {
	source?: string; // original type from source format
	originalType?: string;
	isTruncated?: boolean;
	durationMs?: number;
	tokens?: number;
	encrypted?: boolean;
	rawLine?: string;
	callId?: string;
	/** Accordion blocks extracted from XML tags (for user/developer messages). */
	accordionBlocks?: Array<{ title: string; content: string }>;
	error?: {
		code: AdapterErrorCode;
		message: string;
	};
}

// ==== Scanning Context ====
/** Context passed from scanner to adapter methods. */
export interface ScanContext {
	filePath: string;
	directoryPath: string;
	directoryId: string;
	provider: string;
	contentHash?: string;
	/** Native path in case rollout_path differs from scanned path. */
	rolloutPath?: string;
}

// ==== ProviderAdapter Interface ====
export interface ProviderAdapter {
	/** Lightweight metadata extraction (DB headers/index) for fast listing. */
	getMetadata(
		sessionId: string,
		context: ScanContext,
	): Promise<ConversationMeta | null>;

	/** Full transcript parsing, lazily loaded. */
	getTranscript(
		sessionId: string,
		context: ScanContext,
	): Promise<UnifiedStep[]>;

	/** Thread tree for subagent/spawned-thread relationships. */
	getThreadTree(
		sessionId: string,
		context: ScanContext,
	): Promise<{
		parentThreadId?: string;
		childThreadIds: string[];
	}>;

	/** Display name for the provider (e.g. "Antigravity", "Codex", "Gemini CLI"). */
	displayName: string;

	/** Normalized provider identifier (e.g. 'codex', 'antigravity'). */
	providerId: string;
}

// ==== Scan Statistics ====
export interface ScanStats {
	totalFiles: number;
	parsed: number;
	skipped: number;
	failed: number;
	fallbackUsed: number;
	durationMs: number;
	scannedAt: string;
}
