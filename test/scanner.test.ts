import { test, expect, describe } from "bun:test";
import { join } from "path";
import { computeHash } from "../src/backend/adapters/codex/index";
import { injectDeps, runScan, type ScannerDeps } from "../src/backend/scanner";
import { buildSearchSteps } from "../src/backend/scanner-core";

const fixtureDir = join(import.meta.dir, "adapters", "fixtures");

describe("Scanner", () => {
	test("computeHash returns consistent SHA256 for same file", async () => {
		const sampleFile = join(fixtureDir, "antigravity", "modern-session.jsonl");
		const hash1 = await computeHash(sampleFile);
		const hash2 = await computeHash(sampleFile);

		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64);
	});

	test("computeHash returns different hashes for different files", async () => {
		const file1 = join(fixtureDir, "antigravity", "modern-session.jsonl");
		const file2 = join(fixtureDir, "antigravity", "legacy-session.jsonl");
		const hash1 = await computeHash(file1);
		const hash2 = await computeHash(file2);

		expect(hash1).not.toBe(hash2);
	});

	test("runScan with no directories does not crash", async () => {
		const mockDeps: ScannerDeps = {
			getAllDirectories: () => [],
			getAllScannedFileHashes: () => ({}),
			getScannedFile: () => null,
			upsertScannedFile: () => {},
			upsertConversation: () => {},
			indexConversationContent: () => {},
			indexConversationSteps: () => {},
			recordScan: () => {},
		};

		injectDeps(mockDeps);

		const stats = await runScan();
		expect(stats).toBeDefined();
		expect(stats.totalFiles).toBe(0);
		expect(stats.parsed).toBe(0);
	});

	test("runScan with real directories processes files", async () => {
		const trackedFiles = new Map<string, string>();
		const trackedConvos = new Map<string, Record<string, unknown>>();
		const indexedSteps = new Map<
			string,
			Array<{ stepId: string; stepType: string; content: string }>
		>();

		const mockDeps: ScannerDeps = {
			getAllDirectories: () => [
				{
					id: "test-antigravity",
					path: join(fixtureDir, "antigravity"),
					provider: "antigravity",
					is_custom: 0,
				},
				{
					id: "test-codex",
					path: join(fixtureDir, "codex"),
					provider: "codex",
					is_custom: 0,
				},
				{
					id: "test-gemini",
					path: join(fixtureDir, "gemini-cli"),
					provider: "gemini-cli",
					is_custom: 0,
				},
			],
			getAllScannedFileHashes: () => {
				const map: Record<string, string> = {};
				for (const [path, hash] of trackedFiles) {
					map[path] = hash;
				}
				return map;
			},
			getScannedFile: (path: string) => {
				const hash = trackedFiles.get(path);
				return hash ? { content_hash: hash } : null;
			},
			upsertScannedFile: (record: { path: string; content_hash: string }) => {
				trackedFiles.set(record.path, record.content_hash);
			},
			upsertConversation: (convo: Record<string, unknown>) => {
				trackedConvos.set(convo.id as string, convo);
			},
			indexConversationContent: () => {},
			indexConversationSteps: (id, steps) => {
				indexedSteps.set(id, steps);
			},
			recordScan: () => {},
		};

		injectDeps(mockDeps);

		const stats = await runScan();
		expect(stats).toBeDefined();
		expect(stats.totalFiles).toBeGreaterThan(0);
		expect(stats.parsed).toBeGreaterThan(0);
		expect(trackedConvos.size).toBeGreaterThan(0);
		expect(indexedSteps.size).toBeGreaterThan(0);

		// Run again: should skip all files (hash unchanged)
		const stats2 = await runScan();
		expect(stats2.skipped).toBe(stats2.totalFiles);
	});

	test("buildSearchSteps indexes visible tool output and skips noise", () => {
		const steps = buildSearchSteps([
			{
				id: "user-1",
				index: 0,
				type: "USER",
				content: "find the failing command",
			},
			{
				id: "terminal-1",
				index: 1,
				type: "TERMINAL_OUTPUT",
				content: "bun test failed with command-not-found",
			},
			{
				id: "diff-1",
				index: 2,
				type: "DIFF_OUTPUT",
				content: "@@ changed file",
				toolCalls: [{ name: "write_file", arguments: { path: "x.ts" } }],
			},
			{
				id: "noise-1",
				index: 3,
				type: "NOISE",
				content: "hidden",
			},
		]);

		expect(steps.map((step) => step.stepType)).toEqual([
			"USER",
			"TERMINAL_OUTPUT",
			"DIFF_OUTPUT",
		]);
		expect(steps[1]?.content).toContain("command-not-found");
		expect(steps[2]?.content).toContain("write_file");
	});
});
