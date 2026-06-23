import { parentPort } from "node:worker_threads";
import type { ScanStats } from "./adapters/types";
import {
	runScanLogic,
	type ScanResult,
	type ScanDirectory,
} from "./scanner-core";

interface ScanRequest {
	type: "SCAN";
	directories: ScanDirectory[];
	knownHashes: Record<string, string>;
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
	error: string;
}

type OutgoingMessage = ResultsMessage | DoneMessage | ErrorMessage;

const RESULT_BATCH_SIZE = 10;

parentPort?.on("message", async (msg: ScanRequest) => {
	if (msg.type !== "SCAN") return;

	try {
		const pendingResults: ScanResult[] = [];

		const flush = () => {
			if (pendingResults.length === 0) return;
			post({ type: "RESULTS", results: pendingResults.splice(0) });
		};

		const stats = await runScanLogic(
			msg.directories,
			msg.knownHashes,
			(results) => {
				pendingResults.push(...results);
				if (pendingResults.length >= RESULT_BATCH_SIZE) flush();
			},
		);

		flush();
		post({ type: "DONE", stats });
	} catch (e) {
		post({ type: "ERROR", error: String(e) });
	}
});

function post(msg: OutgoingMessage): void {
	parentPort?.postMessage(msg);
}
