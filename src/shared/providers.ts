export const PROVIDER_IDS = [
	"antigravity",
	"codex",
	"gemini-cli",
	"claude-code",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderConfig {
	id: ProviderId;
	displayName: string;
	color: string;
	borderColor: string;
	bgColor: string;
	textColor: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
	antigravity: {
		id: "antigravity",
		displayName: "Antigravity",
		color: "blue-500",
		borderColor: "border-blue-500/30",
		bgColor: "bg-blue-500/5",
		textColor: "text-blue-500/80",
	},
	codex: {
		id: "codex",
		displayName: "Codex",
		color: "green-500",
		borderColor: "border-green-500/30",
		bgColor: "bg-green-500/5",
		textColor: "text-green-500/80",
	},
	"gemini-cli": {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		color: "purple-500",
		borderColor: "border-purple-500/30",
		bgColor: "bg-purple-500/5",
		textColor: "text-purple-500/80",
	},
	"claude-code": {
		id: "claude-code",
		displayName: "Claude Code",
		color: "orange-500",
		borderColor: "border-orange-500/30",
		bgColor: "bg-orange-500/5",
		textColor: "text-orange-500/80",
	},
};

const PROVIDER_ALIASES: Record<string, ProviderId> = {
	antigravity: "antigravity",
	codex: "codex",
	"gemini-cli": "gemini-cli",
	geminicli: "gemini-cli",
	gemini: "gemini-cli",
	"claude-code": "claude-code",
	claudecode: "claude-code",
	claude: "claude-code",
};

export function isProviderId(value: string): value is ProviderId {
	return PROVIDER_IDS.includes(value as ProviderId);
}

export function normalizeProviderId(value: string): ProviderId {
	const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
	return PROVIDER_ALIASES[key] ?? "antigravity";
}

export function getProviderConfig(id: string): ProviderConfig {
	return PROVIDERS[normalizeProviderId(id)];
}
