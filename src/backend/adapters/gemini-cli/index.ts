import { createReadStream } from "fs";
import { open } from "fs/promises";
import { createInterface } from "readline";
import type {
	ProviderAdapter,
	ConversationMeta,
	UnifiedStep,
	ScanContext,
} from "../types";

/** Gemini CLI specific line types */
interface GeminiCliLine {
	type?: string; // "user" | "model" | "tool" | "gemini" | unknown
	content?: string | Array<{ text?: string; [key: string]: unknown }>;
	parts?: Array<{ text?: string; [key: string]: unknown }>;
	toolCalls?: Array<{
		name: string;
		args: Record<string, unknown>;
		response?: Record<string, unknown>;
		[key: string]: unknown;
	}>;
	functionResponse?: {
		name: string;
		response: Record<string, unknown>;
		[key: string]: unknown;
	};
	thoughts?: Array<{ subject: string; description: string; timestamp: string }>;
	tokens?: Record<string, number>;
	model?: string;
	timestamp?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export class GeminiCliAdapter implements ProviderAdapter {
	readonly displayName = "Gemini CLI";
	readonly providerId = "gemini-cli";

	async getMetadata(
		sessionId: string,
		context: ScanContext,
	): Promise<ConversationMeta | null> {
		// Gemini CLI encodes project in the session path: <project>/<session-id>
		const project = sessionId.includes("/")
			? (sessionId.split("/")[0] as string)
			: "Unknown";

		// Read first 50 lines to extract metadata
		const { title, timestamp, createdAt } = await this.extractMetadata(
			context.filePath,
		);

		if (!title) return null;

		return {
			id: sessionId,
			directoryId: context.directoryId,
			provider: this.providerId,
			title,
			project,
			createdAt,
			timestamp,
			path: context.filePath,
			contentHash: context.contentHash ?? "",
			fallbackUsed: false,
			fallbackTier: 1,
		};
	}

	async getTranscript(
		_sessionId: string,
		context: ScanContext,
	): Promise<UnifiedStep[]> {
		return this.parseJsonlFile(context.filePath);
	}

	async getThreadTree(
		_sessionId: string,
		_context: ScanContext,
	): Promise<{
		parentThreadId?: string;
		childThreadIds: string[];
	}> {
		// Gemini CLI doesn't have thread trees
		return { childThreadIds: [] };
	}

	/** Parse a gemini-cli JSONL file into UnifiedSteps. */
	private async parseJsonlFile(filePath: string): Promise<UnifiedStep[]> {
		const steps: UnifiedStep[] = [];
		let idx = 0;

		await this.streamLines(filePath, (line) => {
			try {
				const obj = JSON.parse(line) as GeminiCliLine;
				const step = this.parseLine(obj, idx);
				steps.push(step);
				idx++;
			} catch {
				steps.push({
					id: `${idx}`,
					index: idx++,
					type: "ERROR",
					content: line,
				});
			}
		});

		return steps;
	}

	/** Check if content is an array of functionResponse objects (tool results fed back to model). */
	private isFunctionResponseContent(obj: GeminiCliLine): {
		isFunctionResponse: boolean;
		names: string[];
	} {
		const content = obj.content;
		if (!Array.isArray(content))
			return { isFunctionResponse: false, names: [] };
		const names: string[] = [];
		for (const item of content) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const fr: unknown = (item as Record<string, unknown>)["functionResponse"];
			if (fr && typeof fr === "object" && !Array.isArray(fr)) {
				const name = (fr as Record<string, unknown>)["name"];
				names.push(typeof name === "string" ? name : "unknown");
			}
		}
		return { isFunctionResponse: names.length > 0, names };
	}

	/** Parse a single gemini-cli JSON line. */
	private parseLine(obj: GeminiCliLine, index: number): UnifiedStep {
		// Skip $set entries (noise from Gemini CLI checkpoint/metadata)
		if ("$set" in obj) {
			return {
				id: `${index}`,
				index,
				type: "NOISE",
				content: "",
			};
		}

		// Check for functionResponse at top level — this should never show as user content
		const fr = obj.functionResponse;
		if (fr && typeof fr === "object") {
			const fnName = fr.name || "unknown";
			return {
				id: `${index}`,
				index,
				type: "SYSTEM",
				content: `Function response: ${fnName}`,
				timestamp: obj.timestamp,
				metadata: {
					source: "gemini-cli",
					originalType: obj.type || "function_response",
					accordionBlocks: [
						{
							title: `Function Response: ${fnName}`,
							content: JSON.stringify(fr.response || {}, null, 2),
						},
					],
				},
			};
		}

		// type: "gemini" lines represent model activity
		// - with text content → agent text response (AGENT)
		// - with toolCalls but no text → tool invocation by model (AGENT, grouped)
		// - with only thoughts/tokens/metadata → thinking event (SYSTEM)
		if (obj.type === "gemini") {
			const text = this.extractText(obj);
			// Merge top-level toolCalls with functionCalls embedded in content array
			const topToolCalls =
				obj.toolCalls?.map((tc) => ({
					name: tc.name,
					arguments: tc.args || {},
					result: tc.response,
				})) || [];
			const contentFunctionCalls = this.extractFunctionCalls(obj);
			const allToolCalls = [...topToolCalls, ...contentFunctionCalls];
			const hasContent = text.trim().length > 0;
			const hasToolCalls = allToolCalls.length > 0;

			// Agent response (text and/or tool calls)
			if (hasContent || hasToolCalls) {
				return {
					id: `${index}`,
					index,
					type: "AGENT",
					content: text || "",
					timestamp: obj.timestamp,
					toolCalls: hasToolCalls ? allToolCalls : undefined,
					metadata: {
						source: "gemini-cli",
						originalType: "gemini-agent",
					},
				};
			}

			// Pure thinking/metadata (no content, no toolCalls)
			return {
				id: `${index}`,
				index,
				type: "SYSTEM",
				content: JSON.stringify(obj, null, 2),
				timestamp: obj.timestamp,
				metadata: {
					source: "gemini-cli",
					originalType: "gemini-event",
				},
			};
		}

		switch (obj.type) {
			case "user": {
				// Check if content is an array of functionResponse objects (tool results)
				// These look like user turns but are actually system/tool events
				const frCheck = this.isFunctionResponseContent(obj);
				if (frCheck.isFunctionResponse) {
					return {
						id: `${index}`,
						index,
						type: "SYSTEM",
						content: `Tool response: ${frCheck.names.join(", ")}`,
						timestamp: obj.timestamp,
						metadata: {
							source: "gemini-cli",
							originalType: "function_response",
							accordionBlocks: [
								{
									title: `Function Response: ${frCheck.names.join(", ")}`,
									content: JSON.stringify(obj.content, null, 2),
								},
							],
						},
					};
				}

				const text = this.extractText(obj);
				return {
					id: `${index}`,
					index,
					type: "USER",
					content: text || "[empty user message]",
					timestamp: obj.timestamp,
				};
			}

			case "model": {
				const text = this.extractText(obj);
				const toolCalls = obj.toolCalls?.map((tc) => ({
					name: tc.name,
					arguments: tc.args || {},
					result: tc.response,
				}));

				return {
					id: `${index}`,
					index,
					type: "AGENT",
					content:
						text ||
						(toolCalls ? "Executing tools..." : "[empty model response]"),
					timestamp: obj.timestamp,
					toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
					metadata: {
						source: "gemini-cli",
						originalType: "model",
					},
				};
			}

			case "tool": {
				const text = this.extractText(obj);
				return {
					id: `${index}`,
					index,
					type: "TERMINAL_OUTPUT",
					content: text || JSON.stringify(obj),
					timestamp: obj.timestamp,
					metadata: {
						source: "gemini-cli",
						originalType: "tool",
					},
				};
			}

			default: {
				// Unknown type — could be raw functionResponse or other
				const text = this.extractText(obj);
				return {
					id: `${index}`,
					index,
					type: "SYSTEM",
					content: text || JSON.stringify(obj, null, 2),
					timestamp: obj.timestamp,
					metadata: {
						source: "gemini-cli",
						originalType: obj.type || "unknown",
					},
				};
			}
		}
	}

	/** Check if a content item is a non-text object (functionCall, thoughtSignature, etc.) that should be filtered out of text extraction. */
	private isContentMetaItem(item: unknown): boolean {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const obj = item as Record<string, unknown>;
		return (
			"functionCall" in obj ||
			"functionResponse" in obj ||
			"thoughtSignature" in obj
		);
	}

	/** Extract functionCall items from content array as tool calls. */
	private extractFunctionCalls(obj: GeminiCliLine): {
		name: string;
		arguments: Record<string, unknown>;
	}[] {
		const content = obj.content;
		if (!Array.isArray(content)) return [];
		const calls: {
			name: string;
			arguments: Record<string, unknown>;
		}[] = [];
		for (const item of content) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const entry = item as Record<string, unknown>;
			const fc = entry.functionCall;
			if (fc && typeof fc === "object" && !Array.isArray(fc)) {
				calls.push({
					name: String((fc as Record<string, unknown>).name || "unknown"),
					arguments:
						((fc as Record<string, unknown>).args as Record<string, unknown>) ||
						{},
				});
			}
		}
		return calls;
	}

	/** Extract text content from a Gemini CLI line (handles both string and array-of-parts formats, filtering non-text items). */
	private extractText(obj: GeminiCliLine): string {
		if (typeof obj.content === "string") return obj.content;
		if (Array.isArray(obj.content)) {
			return obj.content
				.filter((c) => !this.isContentMetaItem(c))
				.map((c) => (typeof c === "string" ? c : c.text || ""))
				.filter(Boolean)
				.join("\n")
				.trim();
		}
		if (Array.isArray(obj.parts)) {
			return obj.parts
				.filter((c) => !this.isContentMetaItem(c))
				.map((c) => (typeof c === "string" ? c : c.text || ""))
				.filter(Boolean)
				.join("\n")
				.trim();
		}
		return "";
	}

	/** Lightweight metadata extraction from first N lines. */
	private async extractMetadata(filePath: string): Promise<{
		title: string | null;
		timestamp: string;
		createdAt: string;
	}> {
		let title: string | null = null;
		let timestamp = new Date().toISOString();
		let createdAt = timestamp;
		let hasSetCreatedAt = false;
		let linesRead = 0;
		const MAX_LINES = 50;

		await this.streamLines(filePath, (line) => {
			if (linesRead++ >= MAX_LINES || title) return;
			try {
				const obj = JSON.parse(line) as GeminiCliLine;
				if (obj.timestamp) {
					if (!hasSetCreatedAt) {
						createdAt = obj.timestamp;
						hasSetCreatedAt = true;
					}
					timestamp = obj.timestamp;
				}
				// Skip $set entries
				if ("$set" in obj) return;
				// Use first real user message as title (skip functionResponse entries)
				if (obj.type === "user") {
					// Skip functionResponse entries
					const frCheck = this.isFunctionResponseContent(obj);
					if (frCheck.isFunctionResponse) return;

					const text = this.extractText(obj);
					if (!text) return;
					// Decode HTML entities then strip XML tags for title
					const cleanText = text
						.replace(/&lt;/g, "<")
						.replace(/&gt;/g, ">")
						.replace(/&amp;/g, "&")
						.replace(/<[^>]+>/g, "")
						.trim();
					if (
						cleanText &&
						!cleanText.startsWith("/") &&
						!cleanText.startsWith("?")
					) {
						// Skip known system/prompt boilerplate
						const skippablePrefixes = [
							"Every byte a tool returns",
							"You are an expert",
							"You are a skilled",
							"You are Claude",
							"You are an AI",
						];
						const isBoilerplate = skippablePrefixes.some(
							(p) =>
								cleanText.startsWith(p) ||
								cleanText.toLowerCase().startsWith(p.toLowerCase()),
						);
						if (isBoilerplate) return;

						title =
							cleanText.length > 50
								? cleanText.substring(0, 50) + "..."
								: cleanText;
					}
				}
			} catch {
				// skip
			}
		});

		// Override with the actual last message's timestamp
		const lastTs = await this.readLastTimestamp(filePath);
		if (lastTs) timestamp = lastTs;

		return { title, timestamp, createdAt };
	}

	/** Stream a file line-by-line. */
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
