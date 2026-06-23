import { test, expect, describe, beforeAll } from "bun:test";
import { join } from "path";
import { ClaudeCodeAdapter } from "../../src/backend/adapters/claude-code/index";

const fixtureDir = join(import.meta.dir, "fixtures", "antigravity");
const sampleFile = join(fixtureDir, "modern-session.jsonl");

describe("ClaudeCodeAdapter", () => {
	let adapter: ClaudeCodeAdapter;

	beforeAll(() => {
		adapter = new ClaudeCodeAdapter();
	});

	test("displayName and providerId are correct", () => {
		expect(adapter.displayName).toBe("Claude Code");
		expect(adapter.providerId).toBe("claude-code");
	});

	test("getTranscript delegates to AntigravityAdapter parser", async () => {
		const steps = await adapter.getTranscript("modern-session", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "claude-code",
		});

		expect(steps).toBeDefined();
		expect(steps.length).toBeGreaterThanOrEqual(3);
		expect(steps[0]!.type).toBe("USER");
	});

	test("getMetadata overrides provider to claude-code", async () => {
		const meta = await adapter.getMetadata("modern-session", {
			filePath: sampleFile,
			directoryPath: fixtureDir,
			directoryId: "test-dir",
			provider: "claude-code",
			contentHash: "dummy",
		});

		expect(meta).not.toBeNull();
		expect(meta!.provider).toBe("claude-code");
	});
});
