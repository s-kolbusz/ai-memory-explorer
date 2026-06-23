import { test, expect, describe, beforeAll } from "bun:test";
import { join } from "path";
import { CodexAdapter } from "../../src/backend/adapters/codex/index";

const fixtureDir = join(import.meta.dir, "fixtures", "codex");
const sampleFile = join(fixtureDir, "sample-session.jsonl");

describe("CodexAdapter", () => {
	let adapter: CodexAdapter;

	beforeAll(() => {
		adapter = new CodexAdapter();
	});

	test("getTranscript parses sample JSONL into steps", async () => {
		const steps = await adapter.getTranscript("test-session-123", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "codex",
		});

		expect(steps).toBeDefined();
		expect(steps.length).toBeGreaterThanOrEqual(3);

		// First step should be session meta
		expect(steps[0]).toBeDefined();
		expect(steps[0]!.type).toBe("SYSTEM");
		expect(steps[0]!.content).toContain("Session started");

		// Second step should be a user message
		const userStep = steps.find((s) => s.type === "USER");
		expect(userStep).toBeDefined();
		expect(userStep!.content).toContain("authentication");

		// Should have an agent step with tool calls
		const agentStep = steps.find((s) => s.type === "AGENT");
		expect(agentStep).toBeDefined();
		expect(agentStep!.toolCalls).toBeDefined();
		expect(agentStep!.toolCalls!.length).toBeGreaterThanOrEqual(1);
		expect(agentStep!.toolCalls![0]!.name).toBe("readFile");
	});

	test("getMetadata from JSONL fallback works", async () => {
		const meta = await adapter.getMetadata("test-session-123", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "codex",
			contentHash: "dummy",
		});

		expect(meta).not.toBeNull();
		expect(meta!.id).toBe("test-session-123");
		expect(meta!.provider).toBe("codex");
		expect(meta!.project).toBe("my-project");
		// Title should be extracted from first user message
		expect(meta!.title).toContain("authentication");
	});

	test("computeHash returns a SHA256 hex string", async () => {
		const { computeHash } = await import(
			"../../src/backend/adapters/codex/index"
		);
		const hash = await computeHash(sampleFile);
		expect(hash).toBeDefined();
		expect(hash.length).toBe(64); // SHA256 hex = 64 chars
		expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
	});

	test("getThreadTree returns empty for JSONL-only (no SQLite)", async () => {
		const tree = await adapter.getThreadTree("test-session-123", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "codex",
		});

		expect(tree).toBeDefined();
		expect(tree.childThreadIds).toEqual([]);
	});
});
