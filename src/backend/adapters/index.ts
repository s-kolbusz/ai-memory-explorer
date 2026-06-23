import type { ProviderAdapter } from "./types";
import { CodexAdapter } from "./codex/index";
import { AntigravityAdapter } from "./antigravity/index";
import { GeminiCliAdapter } from "./gemini-cli/index";
import { ClaudeCodeAdapter } from "./claude-code/index";

export type {
	ProviderAdapter,
	ScanContext,
	ConversationMeta,
	UnifiedStep,
	UnifiedStepType,
	ScanStats,
} from "./types";
export { AdapterError, AdapterErrorCode } from "./types";
export { computeHash } from "./codex/index";

const registry = new Map<string, ProviderAdapter>();

export function registerProvider(name: string, adapter: ProviderAdapter): void {
	registry.set(name.toLowerCase(), adapter);
}

export function getAdapter(provider: string): ProviderAdapter {
	const adapter = registry.get(provider.toLowerCase());
	if (!adapter) throw new Error(`Unknown provider: ${provider}`);
	return adapter;
}

export function getRegisteredProviders(): string[] {
	return Array.from(registry.keys());
}

// Default registration
registerProvider("antigravity", new AntigravityAdapter());
registerProvider("codex", new CodexAdapter());
registerProvider("gemini-cli", new GeminiCliAdapter());
registerProvider("claude-code", new ClaudeCodeAdapter());
