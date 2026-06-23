import { createReadStream } from "fs";
import { open } from "fs/promises";
import { createInterface } from "readline";
import { createHash } from "crypto";
import {
	type ProviderAdapter,
	type ConversationMeta,
	type UnifiedStep,
	AdapterError,
	AdapterErrorCode,
	type ScanContext,
} from "../types";
import { CodexRepository } from "./CodexRepository";
import { projectRegistry } from "../../projectRegistry";

/** Map of known XML-tag → accordion label. */
const ACCORDION_TAGS: [RegExp, string][] = [
	[/<INSTRUCTIONS>([\s\S]*?)<\/INSTRUCTIONS>/gi, "Instructions"],
	[
		/<skills_instructions>([\s\S]*?)<\/skills_instructions>/gi,
		"Skills Instructions",
	],
	[
		/<environment_context>([\s\S]*?)<\/environment_context>/gi,
		"Environment Context",
	],
	[
		/<permissions_instructions>([\s\S]*?)<\/permissions_instructions>/gi,
		"Permissions Instructions",
	],
	[
		/<permissions instructions>([\s\S]*?)<\/permissions instructions>/gi,
		"Permissions Instructions",
	],
	[/<app-context>([\s\S]*?)<\/app-context>/gi, "App Context"],
	[/<skill>([\s\S]*?)<\/skill>/gi, "Skill Context"],
	[/<plan>([\s\S]*?)<\/plan>/gi, "Execution Plan"],
	[
		/<collaboration_mode>([\s\S]*?)<\/collaboration_mode>/gi,
		"Collaboration Mode",
	],
	[/<filesystem_access>([\s\S]*?)<\/filesystem_access>/gi, "Filesystem Access"],
	[/<EPHEMERAL_MESSAGE>([\s\S]*?)<\/EPHEMERAL_MESSAGE>/gi, "Ephemeral Message"],
	[
		/<plugins_instructions>([\s\S]*?)<\/plugins_instructions>/gi,
		"Plugins Instructions",
	],
	[
		/<bash_command_reminder>([\s\S]*?)<\/bash_command_reminder>/gi,
		"Bash Command Reminder",
	],
];

export class CodexAdapter implements ProviderAdapter {
	readonly displayName = "Codex";
	readonly providerId = "codex";
	private repo: CodexRepository;

	constructor() {
		this.repo = new CodexRepository();
	}

	async getMetadata(
		sessionId: string,
		context: ScanContext,
	): Promise<ConversationMeta | null> {
		let fallbackUsed = false;
		let fallbackTier: 1 | 2 | 3 = 1;

		// Tier 1: Native SQLite
		try {
			const thread = this.repo.getThread(sessionId);
			if (thread) {
				const ts = thread.created_at_ms
					? new Date(thread.created_at_ms).toISOString()
					: thread.created_at
						? new Date(thread.created_at * 1000).toISOString()
						: new Date().toISOString();

				// Prefer first_user_message (raw). The title column may contain
				// truncated AGENTS.md fragments without the **ALWAYS** prefix.
				const title = thread.first_user_message?.trim()
					? this.sanitizeTitle(thread.first_user_message)
					: "Codex Conversation";

				const project = thread.cwd
					? projectRegistry.inferFromPath(thread.cwd)
					: "Unknown";
				const tree = this.repo.getThreadTree(sessionId);

				return {
					id: sessionId,
					directoryId: context.directoryId,
					provider: this.providerId,
					title,
					project,
					createdAt: ts,
					timestamp: ts,
					parentThreadId: tree.parentThreadId ?? undefined,
					childThreadIds:
						tree.childThreadIds.length > 0 ? tree.childThreadIds : undefined,
					path: thread.rollout_path ?? context.filePath,
					contentHash: context.contentHash ?? "",
					fallbackUsed: false,
					fallbackTier: 1,
				};
			}
		} catch (e) {
			const code =
				e instanceof AdapterError ? e.code : AdapterErrorCode.CORRUPT_DB;
			fallbackUsed = true;
			fallbackTier = code === AdapterErrorCode.MISSING_TABLE ? 2 : 3;
		}

		// Tier 2/3: Fallback from JSONL
		try {
			const meta = await this.extractMetadataFromJsonl(
				sessionId,
				context.filePath,
			);
			if (meta) {
				return {
					...meta,
					id: sessionId,
					directoryId: context.directoryId,
					provider: this.providerId,
					path: context.filePath,
					contentHash: context.contentHash ?? "",
					fallbackUsed,
					fallbackTier,
				};
			}
		} catch {
			// exhausted
		}

		return null;
	}

	async getTranscript(
		_sessionId: string,
		context: ScanContext,
	): Promise<UnifiedStep[]> {
		return this.parseJsonlFile(context.rolloutPath || context.filePath);
	}

	async getThreadTree(
		sessionId: string,
		_context: ScanContext,
	): Promise<{ parentThreadId?: string; childThreadIds: string[] }> {
		try {
			const tree = this.repo.getThreadTree(sessionId);
			return {
				parentThreadId: tree.parentThreadId ?? undefined,
				childThreadIds: tree.childThreadIds,
			};
		} catch {
			return { childThreadIds: [] };
		}
	}

	/**
	 * Parse a Codex JSONL file into UnifiedSteps.
	 *
	 * Known line types:
	 *   session_meta                     – session metadata
	 *   response_item (message, role=*)  – conversation message
	 *   response_item (function_call)    – tool invocation
	 *   response_item (function_call_output) – tool result
	 *   event_msg                        – internal events (skipped)
	 */
	private async parseJsonlFile(filePath: string): Promise<UnifiedStep[]> {
		const steps: UnifiedStep[] = [];

		await this.streamLines(filePath, (line: string) => {
			let obj: Record<string, unknown>;
			try {
				obj = JSON.parse(line);
			} catch {
				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "ERROR",
					content: "[Parse error: unparseable line]",
					metadata: { rawLine: line.substring(0, 200) },
				});
				return;
			}

			const type = obj.type as string;
			if (type === "event_msg") return;

			if (type === "session_meta") {
				const p = obj.payload as Record<string, unknown> | undefined;
				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "SYSTEM",
					content: `Session started\nModel: ${p?.model_provider ?? "unknown"}\nCWD: ${p?.cwd ?? "unknown"}`,
					timestamp: obj.timestamp as string | undefined,
				});
				return;
			}

			if (type !== "response_item") return;

			const p = obj.payload as Record<string, unknown> | undefined;
			if (!p) return;

			const msgType = p.type as string | undefined;

			// Tool calls (standalone or inline on messages)
			if (msgType === "function_call" || (p.name && p.arguments)) {
				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "AGENT",
					content: "",
					timestamp: obj.timestamp as string | undefined,
					toolCalls: [
						{
							name: String(
								p["name"] ??
									(p.function as Record<string, unknown>)?.["name"] ??
									"",
							),
							arguments:
								typeof p["arguments"] === "string"
									? JSON.parse(p["arguments"] as string)
									: ((p["arguments"] as Record<string, unknown>) ?? {}),
						},
					],
				});
				return;
			}

			// Tool outputs
			if (msgType === "function_call_output") {
				const output = String(p.output ?? "");
				if (!output) return;
				const truncated =
					output.length > 5000
						? output.substring(0, 5000) + "\n... [truncated]"
						: output;
				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "TERMINAL_OUTPUT",
					content: truncated,
					timestamp: obj.timestamp as string | undefined,
					metadata: { callId: String(p.call_id ?? "") },
				});
				return;
			}

			// Messages
			if (msgType !== "message") return;

			const role = p.role as string | undefined;
			const rawContent = p.content as
				| Array<Record<string, unknown>>
				| undefined;
			const hasEncrypted = !!p.encrypted_content;

			// Developer role – always emit if there are accordion blocks or plain text
			if (role === "developer") {
				if (hasEncrypted) {
					steps.push({
						id: `${steps.length}`,
						index: steps.length,
						type: "SYSTEM",
						content: "[Encrypted response]",
						timestamp: obj.timestamp as string | undefined,
						metadata: { encrypted: true },
					});
					return;
				}

				const allText = this.pullText(rawContent);
				const blocks = this.extractBlocks(allText);

				// Only skip if there's neither accordion blocks nor plain text
				if (blocks.length === 0 && !this.cleanText(allText)) return;

				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "SYSTEM",
					content: this.cleanText(allText),
					timestamp: obj.timestamp as string | undefined,
					metadata: this.buildAccordionMeta(allText),
				});
				return;
			}

			// User messages
			if (role === "user") {
				const allText = this.pullText(rawContent);
				const blocks = this.extractBlocks(allText);
				let cleaned = this.cleanText(allText);

				// Convert USER_REQUEST inline
				cleaned = cleaned.replace(
					/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi,
					(_m: string, cap: string) => cap.trim(),
				);

				if (!cleaned && blocks.length === 0) return;

				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "USER",
					content: cleaned || "(instructions)",
					timestamp: obj.timestamp as string | undefined,
					metadata: blocks.length > 0 ? { accordionBlocks: blocks } : undefined,
				});
				return;
			}

			// Assistant messages (role = 'assistant' or empty or 'model')
			if (hasEncrypted) return;

			const allText = this.pullText(rawContent);
			const blocks = this.extractBlocks(allText);
			const cleaned = this.cleanText(allText);

			// Skip empty assistant messages UNLESS they have inline tool_calls
			const hasInlineToolCalls =
				Array.isArray(p.tool_calls) && p.tool_calls.length > 0;
			if (!cleaned && !hasInlineToolCalls) return;

			const tc = hasInlineToolCalls
				? (
						p.tool_calls as Array<{
							name: string;
							arguments: Record<string, unknown>;
						}>
					).map((t) => ({
						name: t.name,
						arguments:
							typeof t.arguments === "string"
								? JSON.parse(t.arguments as string)
								: (t.arguments ?? {}),
					}))
				: undefined;

			steps.push({
				id: `${steps.length}`,
				index: steps.length,
				type: "AGENT",
				content: cleaned,
				timestamp: obj.timestamp as string | undefined,
				toolCalls: tc,
				metadata: blocks.length > 0 ? { accordionBlocks: blocks } : undefined,
			});
		});

		return steps;
	}

	/** Join text parts from content array. Content parts may use type+text or just text. */
	private pullText(
		content: Array<Record<string, unknown>> | undefined,
	): string {
		return (content ?? []).map((c) => String(c.text ?? "")).join("\n");
	}

	/** Remove AGENTS.md boilerplate lines and normalize whitespace. */
	private cleanText(text: string): string {
		return text
			.replace(/# AGENTS\.md instructions for[^\n]*(?:\n|$)/gi, "")
			.replace(
				/# (Global Agent Guidelines|Role & System Context)[^\n]*\n*/gi,
				"",
			)
			.replace(/\*\*ALWAYS\*\*[^\n]*\n*/gi, "")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/set a non-interactive editor env[^\n]*/gi, "")
			.replace(/for git continuation commands[^\n]*/gi, "")
			.replace(/when running commands like[^\n]*/gi, "")
			.replace(/instead of `[^`]+`[^\n]*/gi, "")
			.replace(/use `fd` instead of[^\n]*/gi, "")
			.replace(/use `rg` instead of[^\n]*/gi, "")
			.replace(/git rebase[^\n]*/gi, "")
			.replace(/rebase --continue[^\n]*/gi, "")
			.trim();
	}

	private buildAccordionMeta(
		text: string,
	):
		| { accordionBlocks: Array<{ title: string; content: string }> }
		| undefined {
		const blocks = this.extractBlocks(text);
		return blocks.length > 0 ? { accordionBlocks: blocks } : undefined;
	}

	/** Extract XML block contents into accordion entries. */
	/** Clean a raw user message for use as a conversation title. */
	private sanitizeTitle(raw: string): string {
		let msg = raw.trim();

		// Prefer USER_REQUEST content first
		const urMatch = msg.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
		if (urMatch?.[1]?.trim()) {
			msg = urMatch[1].trim();
			// Skip if result is empty or just punctuation
			if (msg.length > 0 && !/^[\s.,!?;:]+$/.test(msg)) {
				return msg.length > 80 ? msg.substring(0, 80) + "..." : msg;
			}
		}

		// Strip known AGENTS.md boilerplate
		msg = msg
			.replace(/# AGENTS\.md instructions for[^\n]*(?:\n|$)/gi, "")
			.replace(
				/# (Global Agent Guidelines|Role & System Context)[^\n]*\n*/gi,
				"",
			)
			.replace(/\*\*ALWAYS\*\*[^\n]*\n*/gi, "")
			.replace(/<[^>]+>/g, "")
			.replace(/\n{3,}/g, "\n")
			.trim();

		// Find the first line that looks like real user content
		// (not markdown boilerplate, numbered lists, or indented items)
		const lines = msg.split("\n");
		const contentLines = lines.filter((l) => {
			const t = l.trim();
			if (!t) return false;
			// Skip headings, bold markers, list items, blockquotes
			if (/^#{1,6}\s/.test(t)) return false;
			if (/^\*\*[A-Z]+\*\*/.test(t)) return false;
			if (/^[-*]\s/.test(t)) return false;
			if (/^\d+\.\s/.test(t)) return false;
			if (/^>/.test(t)) return false;
			// Skip indented numbered lists (common in AGENTS.md)
			if (/^\s{2,}\d+\.\s/.test(t)) return false;
			// Skip lines that are just tags/punctuation
			if (/^[[\](){}<>]+$/.test(t)) return false;
			return true;
		});
		msg = contentLines.join(" ").trim();

		// Secondary cleanup: strip remaining AGENTS.md directive fragments
		// (without **ALWAYS** prefix, which may be missing from truncated titles)
		const agentsMdPatterns = [
			/set a non-interactive editor env[^\n]*/gi,
			/for git continuation commands[^\n]*/gi,
			/when running commands like[^\n]*/gi,
			/instead of `[^`]+`[^\n]*/gi,
			/use `fd` instead of[^\n]*/gi,
			/use `rg` instead of[^\n]*/gi,
			/Think a lot before[^\n]*/gi,
			/No breadcrumbs[^\n]*/gi,
			/Do not lose the plot[^\n]*/gi,
			/Language Guidance[^\n]*/gi,
			/git rebase[^\n]*/gi,
			/git merge --continue[^\n]*/gi,
			/rebase --continue[^\n]*/gi,
		];
		for (const pat of agentsMdPatterns) {
			pat.lastIndex = 0;
			msg = msg.replace(pat, "").trim();
		}

		if (!msg) return "Codex Conversation";
		return msg.length > 80 ? msg.substring(0, 80) + "..." : msg;
	}

	private extractBlocks(
		text: string,
	): Array<{ title: string; content: string }> {
		const blocks: Array<{ title: string; content: string }> = [];
		for (const [regex, label] of ACCORDION_TAGS) {
			regex.lastIndex = 0;
			const match = regex.exec(text);
			if (match && match[1]?.trim()) {
				blocks.push({ title: label, content: match[1].trim() });
			}
		}
		return blocks;
	}

	/** Lightweight metadata extraction from JSONL (first 500 lines). */
	private async extractMetadataFromJsonl(
		_sessionId: string,
		filePath: string,
	): Promise<Pick<
		ConversationMeta,
		"title" | "project" | "timestamp" | "createdAt"
	> | null> {
		let title = "Codex Conversation";
		let createdAt = new Date().toISOString();
		let hasSetCreatedAt = false;
		let timestamp = new Date().toISOString();
		let project = "Unknown";
		let linesRead = 0;
		const MAX_LINES = 500;

		await this.streamLines(filePath, (line: string) => {
			if (linesRead++ >= MAX_LINES) return;

			try {
				const obj = JSON.parse(line);
				if (obj.type === "session_meta") {
					const p = obj.payload as Record<string, unknown> | undefined;
					if (p?.cwd) project = projectRegistry.inferFromPath(String(p.cwd));
					if (obj.timestamp) {
						if (!hasSetCreatedAt) {
							createdAt = obj.timestamp;
							hasSetCreatedAt = true;
						}
						timestamp = String(obj.timestamp);
					}
				}

				if (obj.type !== "response_item") return;
				const p = obj.payload as Record<string, unknown> | undefined;
				if (p?.type !== "message") return;
				if (p?.role !== "user") return;
				if (title !== "Codex Conversation") return;

				const content = p.content as Array<Record<string, unknown>> | undefined;
				let combined = (content ?? [])
					.map((c: Record<string, unknown>) => String(c.text ?? ""))
					.join("\n");

				const urMatch = combined.match(
					/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i,
				);
				if (urMatch?.[1]?.trim()) {
					combined = urMatch[1].trim();
				}

				const cleaned = this.sanitizeTitle(combined);
				if (cleaned !== "Codex Conversation") {
					title = cleaned;
				}
			} catch {
				// skip
			}
		});

		// Override with the actual last message's timestamp
		const lastTs = await this.readLastTimestamp(filePath);
		if (lastTs) timestamp = lastTs;

		return { title, project, timestamp, createdAt };
	}

	/** Read the last valid JSON line's timestamp from a JSONL file. */
	private async readLastTimestamp(filePath: string): Promise<string | null> {
		let file;
		try {
			file = await open(filePath, "r");
			const stat = await file.stat();
			const chunkSize = Math.min(4096, stat.size);
			const buffer = Buffer.alloc(chunkSize);
			await file.read(buffer, 0, chunkSize, stat.size - chunkSize);
			const tail = buffer.toString("utf-8").trimEnd();
			const lines = tail.split("\n");
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i];
				if (!line) continue;
				try {
					const obj = JSON.parse(line);
					if (obj.timestamp) return obj.timestamp;
				} catch {
					// skip partial lines
				}
			}
			return null;
		} catch {
			return null;
		} finally {
			if (file) await file.close();
		}
	}

	/** Stream a file line-by-line. */
	private async streamLines(
		filePath: string,
		onLine: (line: string) => void,
	): Promise<void> {
		const rl = createInterface({
			input: createReadStream(filePath, { encoding: "utf-8" }),
			crlfDelay: Infinity,
		});

		for await (const line of rl) {
			if (line.trim()) {
				onLine(line);
			}
		}
	}
}

/** Streaming SHA256 hash computation. */
export async function computeHash(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk as Buffer);
	}
	return hash.digest("hex");
}
