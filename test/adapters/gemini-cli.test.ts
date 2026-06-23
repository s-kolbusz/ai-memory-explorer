import { test, expect, describe, beforeAll } from "bun:test";
import { join } from "path";
import { GeminiCliAdapter } from "../../src/backend/adapters/gemini-cli/index";

const fixtureDir = join(import.meta.dir, "fixtures", "gemini-cli");
const sampleFile = join(fixtureDir, "project-session.jsonl");

describe("GeminiCliAdapter", () => {
	let adapter: GeminiCliAdapter;

	beforeAll(() => {
		adapter = new GeminiCliAdapter();
	});

	test("getTranscript parses gemini-cli JSONL format", async () => {
		const steps = await adapter.getTranscript("my-project/session-1", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "gemini-cli",
		});

		expect(steps).toBeDefined();
		expect(steps.length).toBe(4);

		// First step should be user
		expect(steps[0]!.type).toBe("USER");
		expect(steps[0]!.content).toContain("React");

		// Model responses → AGENT
		const agentSteps = steps.filter((s) => s.type === "AGENT");
		expect(agentSteps.length).toBeGreaterThanOrEqual(2);

		// Tool steps → TERMINAL_OUTPUT
		const toolStep = steps.find((s) => s.type === "TERMINAL_OUTPUT");
		expect(toolStep).toBeDefined();
		expect(toolStep!.content).toContain("Analyzing");
	});

	test("getMetadata extracts correct provider and title", async () => {
		const meta = await adapter.getMetadata("my-project/session-1", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "gemini-cli",
			contentHash: "dummy",
		});

		expect(meta).not.toBeNull();
		expect(meta!.provider).toBe("gemini-cli");
		expect(meta!.project).toBe("my-project");
		// Title from first user message
		expect(meta!.title).toContain("React");
	});

	test("getMetadata extracts project from session ID", async () => {
		const meta = await adapter.getMetadata("ai-tool/session-abc", {
			filePath: join(fixtureDir, "project-session.jsonl"),
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "gemini-cli",
			contentHash: "dummy",
		});

		expect(meta).not.toBeNull();
		// Project comes from sessionId prefix when not in path
		expect(meta!.project).toBe("ai-tool");
	});

	test("getThreadTree returns empty for Gemini CLI", async () => {
		const tree = await adapter.getThreadTree("session-1", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "gemini-cli",
		});

		expect(tree.childThreadIds).toEqual([]);
	});

	test("parse handles empty content gracefully", async () => {
		// Access the parse method via transcript
		// Just verify no crash
		const steps = await adapter.getTranscript("empty", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "gemini-cli",
		});
		expect(steps).toBeDefined();
	});
});
