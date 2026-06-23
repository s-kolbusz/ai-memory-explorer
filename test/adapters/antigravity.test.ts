import { test, expect, describe, beforeAll } from "bun:test";
import { join } from "path";
import { AntigravityAdapter } from "../../src/backend/adapters/antigravity/index";

const fixtureDir = join(import.meta.dir, "fixtures", "antigravity");
const modernFile = join(fixtureDir, "modern-session.jsonl");
const legacyFile = join(fixtureDir, "legacy-session.jsonl");
const noiseFile = join(fixtureDir, "noise-empty.jsonl");

describe("AntigravityAdapter", () => {
	let adapter: AntigravityAdapter;

	beforeAll(() => {
		adapter = new AntigravityAdapter();
	});

	test("getTranscript parses modern JSONL format", async () => {
		const steps = await adapter.getTranscript("modern-session", {
			filePath: modernFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "antigravity",
		});

		expect(steps).toBeDefined();
		expect(steps.length).toBe(3);

		// USER_INPUT → USER type
		expect(steps[0]!.type).toBe("USER");
		expect(steps[0]!.content).toContain("database");

		// PLANNER_RESPONSE → AGENT type
		expect(steps[1]!.type).toBe("AGENT");
		expect(steps[1]!.toolCalls).toBeDefined();
		expect(steps[1]!.toolCalls!.length).toBe(2);
		expect(steps[1]!.toolCalls![0]!.name).toBe("readFile");

		// SYSTEM_MESSAGE with Stdout → TERMINAL_OUTPUT
		expect(steps[2]!.type).toBe("TERMINAL_OUTPUT");
		expect(steps[2]!.content).toContain("completed successfully");
	});

	test("getTranscript parses legacy JSONL format", async () => {
		const steps = await adapter.getTranscript("legacy-session", {
			filePath: legacyFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "antigravity",
		});

		expect(steps).toBeDefined();
		// legacy format with user+gemini+toolCalls produces extra steps for tool results
		expect(steps.length).toBeGreaterThanOrEqual(2);

		// user → USER type
		const userStep = steps.find((s) => s.type === "USER");
		expect(userStep).toBeDefined();
		expect(userStep!.content).toContain("weather");

		// gemini with toolCalls and content → AGENT type
		const agentSteps = steps.filter((s) => s.type === "AGENT");
		expect(agentSteps.length).toBeGreaterThanOrEqual(1);
	});

	test("getMetadata extracts title and project from modern format", async () => {
		const meta = await adapter.getMetadata("modern-session", {
			filePath: modernFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "antigravity",
			contentHash: "dummy",
		});

		expect(meta).not.toBeNull();
		expect(meta!.title).toBeDefined();
		expect(meta!.provider).toBe("antigravity");
	});

	test("getMetadata returns null for noise-only transcripts", async () => {
		const meta = await adapter.getMetadata("noise-empty", {
			filePath: noiseFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "antigravity",
			contentHash: "dummy",
		});

		// No real messages (USER/AGENT) → null
		expect(meta).toBeNull();
	});

	test("getThreadTree returns empty for Antigravity", async () => {
		const tree = await adapter.getThreadTree("modern-session", {
			filePath: modernFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "antigravity",
		});

		expect(tree).toBeDefined();
		expect(tree.childThreadIds).toEqual([]);
		expect(tree.parentThreadId).toBeUndefined();
	});

	test("categorizeSystemMessage classifies terminal output", () => {
		const type = adapter["categorizeSystemMessage"](
			"Stdout:\nnpm install success",
		);
		expect(type).toBe("TERMINAL_OUTPUT");
	});

	test("categorizeSystemMessage classifies diffs", () => {
		const type = adapter["categorizeSystemMessage"](
			"diff --git a/src/index.ts b/src/index.ts",
		);
		expect(type).toBe("DIFF_OUTPUT");
	});

	test("categorizeSystemMessage classifies file previews", () => {
		const type = adapter["categorizeSystemMessage"](
			"File Path: src/index.ts\nShowing lines 1-50",
		);
		expect(type).toBe("FILE_PREVIEW");
	});
});
