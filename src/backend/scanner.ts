import { Worker } from "node:worker_threads";
import type { ScanStats } from "./adapters/types";
import { runScanLogic, type ScanDirectory, type ScanResult } from "./scanner-core";

export interface ScannerDeps {
	getAllDirectories: () => Array<{
		id: string;
		path: string;
		provider: string;
		is_custom: number;
	}>;
	getAllScannedFileHashes: () => Record<string, string>;
	getScannedFile: (path: string) => { content_hash: string } | null;
	upsertScannedFile: (record: {
		path: string;
		content_hash: string;
		provider: string;
		file_size: number;
		last_scanned_at: string;
		scan_duration_ms: number;
		fallback_tier: number;
	}) => void;
	upsertConversation: (convo: Record<string, unknown>) => void;
	indexConversationContent: (id: string, content: string) => void;
	indexConversationSteps: (
		id: string,
		steps: Array<{ stepId: string; stepType: string; content: string }>,
	) => void;
	recordScan: (stats: ScanStats) => void;
}

let deps: ScannerDeps | null = null;
let isScanning = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function injectDeps(injected: ScannerDeps): void {
	deps = injected;
}

function emptyStats(): ScanStats {
	return {
		totalFiles: 0,
		parsed: 0,
		skipped: 0,
		failed: 0,
		fallbackUsed: 0,
		durationMs: 0,
		scannedAt: new Date().toISOString(),
	};
}

export async function runScan(): Promise<ScanStats> {
	if (isScanning) return emptyStats();
	if (!deps) {
		console.error("Scanner dependencies not injected");
		return emptyStats();
	}

	isScanning = true;
	const startTime = Date.now();

	try {
		console.log("Starting background directory discovery scan...");
		const directories = deps.getAllDirectories();
		const knownHashes = deps.getAllScannedFileHashes();
		const stats = await runWorkerScan(directories, knownHashes);
		const finalStats: ScanStats = {
			...stats,
			durationMs: Date.now() - startTime,
			scannedAt: new Date().toISOString(),
		};

		deps.recordScan(finalStats);
		console.log(
			`Scan complete. ${finalStats.parsed} parsed, ${finalStats.skipped} skipped, ${finalStats.failed} failed`,
		);
		return finalStats;
	} catch (error) {
		console.error("Scan error:", error);
		const finalStats = {
			...emptyStats(),
			failed: 1,
			durationMs: Date.now() - startTime,
			scannedAt: new Date().toISOString(),
		};
		deps.recordScan(finalStats);
		return finalStats;
	} finally {
		isScanning = false;
	}
}

interface ResultsMessage {
	type: "RESULTS";
	results: ScanResult[];
}

interface DoneMessage {
	type: "DONE";
	stats: ScanStats;
}

interface ErrorMessage {
	type: "ERROR";
	error?: string;
}

type WorkerMessage = ResultsMessage | DoneMessage | ErrorMessage;

function persistResults(results: ScanResult[]): void {
	for (const result of results) {
		deps?.upsertScannedFile({
			path: result.filePath,
			content_hash: result.contentHash,
			provider: result.provider,
			file_size: result.fileSize,
			last_scanned_at: new Date().toISOString(),
			scan_duration_ms: result.scanDurationMs,
			fallback_tier: result.fallbackTier,
		});

		if (!result.meta) continue;
		deps?.upsertConversation(result.meta);
		deps?.indexConversationSteps(String(result.meta.id), result.searchSteps);
	}
}

function runWorkerScan(
	directories: ScanDirectory[],
	knownHashes: Record<string, string>,
): Promise<ScanStats> {
	if (typeof Worker === "undefined") {
		return runScanLogic(directories, knownHashes, persistResults);
	}

	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./scanner.worker.ts", import.meta.url));

		worker.on("message", (message: WorkerMessage) => {
			if (message.type === "RESULTS") {
				persistResults(message.results);
				return;
			}
			if (message.type === "DONE") {
				worker.terminate().catch(() => {});
				resolve(message.stats);
				return;
			}
			if (message.type === "ERROR") {
				worker.terminate().catch(() => {});
				reject(new Error(message.error ?? "Unknown worker error"));
			}
		});

		worker.on("error", (error) => {
			worker.terminate().catch(() => {});
			reject(error);
		});

		worker.on("exit", (code) => {
			if (code !== 0) reject(new Error(`Scanner worker exited with code ${code}`));
		});

		worker.postMessage({ type: "SCAN", directories, knownHashes });
	});
}

export function startPeriodicScanner(intervalMs = 60000): void {
	void runScan();
	if (intervalHandle) clearInterval(intervalHandle);
	intervalHandle = setInterval(() => void runScan(), intervalMs);
}

export function stopPeriodicScanner(): void {
	if (intervalHandle) clearInterval(intervalHandle);
	intervalHandle = null;
}
