import { createReadStream } from "fs";
import { open } from "fs/promises";
import { createInterface } from "readline";
import { join, dirname } from "path";
import type {
	ProviderAdapter,
	ConversationMeta,
	UnifiedStep,
	UnifiedStepType,
	ScanContext,
} from "../types";
import { projectRegistry } from "../../projectRegistry";

export class AntigravityAdapter implements ProviderAdapter {
	get displayName(): string {
		return "Antigravity";
	}
	get providerId(): string {
		return "antigravity";
	}

	/** Resolve the transcript path for a session within a base directory. */
	protected resolveTranscriptPath(
		directoryPath: string,
		sessionId: string,
	): string {
		// Antigravity format: <sessionId>/.system_generated/logs/transcript.jsonl
		return join(
			directoryPath,
			sessionId,
			".system_generated",
			"logs",
			"transcript.jsonl",
		);
	}

	async getMetadata(
		sessionId: string,
		context: ScanContext,
	): Promise<ConversationMeta | null> {
		const filePath =
			context.filePath ||
			this.resolveTranscriptPath(context.directoryPath, sessionId);

		const steps: UnifiedStep[] = [];

		// Read first 100 lines to extract metadata
		await this.streamLines(filePath, (line, _index) => {
			if (steps.length >= 100) return;
			try {
				const obj = JSON.parse(line);
				steps.push(this.parseLine(obj, steps.length));
			} catch {
				// skip parse errors in metadata scan
			}
		});

		if (steps.length === 0) return null;

		const meta = this.buildMetadata(steps, sessionId, context);
		if (!meta) return null;

		// Override with the actual last message's timestamp (not just the
		// timestamp from the last line within the first 100).
		const lastTs = await this.readLastTimestamp(filePath);
		if (lastTs) meta.timestamp = lastTs;

		return meta;
	}

	async getTranscript(
		sessionId: string,
		context: ScanContext,
	): Promise<UnifiedStep[]> {
		const filePath =
			context.filePath ||
			this.resolveTranscriptPath(context.directoryPath, sessionId);
		const steps: UnifiedStep[] = [];

		await this.streamLines(filePath, (line, _index) => {
			try {
				const obj = JSON.parse(line);
				steps.push(this.parseLine(obj, steps.length));
			} catch {
				steps.push({
					id: `${steps.length}`,
					index: steps.length,
					type: "ERROR",
					content: line,
				});
			}
		});

		return steps;
	}

	async getThreadTree(
		_sessionId: string,
		_context: ScanContext,
	): Promise<{
		parentThreadId?: string;
		childThreadIds: string[];
	}> {
		// Antigravity doesn't have thread trees
		return { childThreadIds: [] };
	}

	/** Build ConversationMeta from parsed steps. */
	protected buildMetadata(
		steps: UnifiedStep[],
		sessionId: string,
		context: ScanContext,
	): ConversationMeta | null {
		if (steps.length === 0) return null;

		// Filter out conversations with no real messages
		const realMessages = steps.filter(
			(d) => d.type === "USER" || d.type === "AGENT",
		);
		if (realMessages.length === 0) return null;

		// Ignore conversations where the only 'real' messages are purely empty XML shells
		const hasMeaningfulContent = realMessages.some((d) => {
			const text = (d.content || "").replace(/<[^>]+>/g, "").trim();
			return text.length > 0;
		});
		if (!hasMeaningfulContent) return null;

		const firstStep = steps[0];
		const lastStep = steps[steps.length - 1];
		const createdAt =
			firstStep?.timestamp || lastStep?.timestamp || new Date().toISOString();
		const timestamp =
			lastStep?.timestamp || firstStep?.timestamp || new Date().toISOString();

		let title = "Conversation";
		let project = "Unknown";

		// Extract title from first user step
		const userStep = steps.find((d) => d.type === "USER");
		if (userStep?.content) {
			title = this.extractTitle(userStep.content, steps);
		}

		// Infer project from tool calls
		project = this.inferProject(steps);

		// Fallback for gemini-cli which encodes project in the ID
		if (
			project === "Unknown" &&
			context.provider === "gemini-cli" &&
			sessionId.includes("/")
		) {
			project = sessionId.split("/")[0] as string;
		}

		// Legacy title fallback
		if (title === "Conversation" && sessionId.includes("-")) {
			title = sessionId;
		}

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

	/** Extract a clean title from a user step's content. */
	protected extractTitle(content: string, allSteps: UnifiedStep[]): string {
		let rawContent = content;

		// Strip out automatic context headers
		rawContent = rawContent.replace(
			/# AGENTS\.md instructions for[^\n]*\n+/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<permissions[ _]instructions>[\s\S]*?<\/permissions[ _]instructions>/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<environment_context>[\s\S]*?<\/environment_context>/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi,
			"",
		);
		rawContent = rawContent.replace(
			/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/gi,
			"",
		);

		const titleMatch = rawContent.match(
			/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i,
		);
		let cleanContent = titleMatch
			? titleMatch[1]!.replace(/<[^>]+>/g, "").trim()
			: rawContent.replace(/<[^>]+>/g, "").trim();

		// Filter out slash commands for title if possible
		if (
			(cleanContent.startsWith("/") || cleanContent.startsWith("?")) &&
			cleanContent.split("\n").length === 1
		) {
			const otherUserSteps = allSteps.filter(
				(d) =>
					d.type === "USER" &&
					d.content &&
					!d.content.trim().startsWith("/") &&
					!d.content.trim().startsWith("?"),
			);
			if (otherUserSteps.length > 0) {
				const nextRaw = otherUserSteps[0]!.content
					.replace(/<[^>]+>/g, "")
					.trim();
				if (nextRaw) cleanContent = nextRaw;
			}
		}

		let title =
			cleanContent.length > 50
				? cleanContent.substring(0, 50) + "..."
				: cleanContent;
		if (!title) title = "Conversation";
		return title;
	}

	/** Infer project name from tool call CWDs. */
	protected inferProject(steps: UnifiedStep[]): string {
		const cwds: string[] = [];

		for (const step of steps) {
			if (step.toolCalls) {
				for (const tc of step.toolCalls) {
					const args = tc.arguments as Record<string, unknown>;
					if (typeof args?.Cwd === "string") cwds.push(args.Cwd);
					else if (typeof args?.AbsolutePath === "string")
						cwds.push(args.AbsolutePath);
					else if (typeof args?.DirectoryPath === "string")
						cwds.push(args.DirectoryPath);
					else if (typeof args?.TargetFile === "string")
						cwds.push(args.TargetFile);
				}
			}
		}

		if (cwds.length === 0) return "Unknown";

		// Find most common CWD
		const counts: Record<string, number> = {};
		let maxCwd = cwds[0]!;
		let maxCount = 0;

		for (let c of cwds) {
			if (c.includes(".")) c = dirname(c);
			if (c === "" || c === "/" || c.match(/^[A-Za-z]:[/\\]?$/)) continue;
			counts[c] = (counts[c] || 0) + 1;
			if (counts[c]! > maxCount) {
				maxCount = counts[c]!;
				maxCwd = c;
			}
		}

		return projectRegistry.inferFromPath(maxCwd);
	}

	/** Parse a single JSON object into a UnifiedStep. */
	protected parseLine(
		obj: Record<string, unknown>,
		index: number,
	): UnifiedStep {
		// Determine if this is modern (step-based) or legacy format
		const type = obj.type as string | undefined;
		if (!type && !obj.$set) {
			return {
				id: `${index}`,
				index,
				type: "ERROR",
				content: JSON.stringify(obj),
			};
		}

		// Modern format (step-based)
		if (
			type === "USER_INPUT" ||
			type === "PLANNER_RESPONSE" ||
			type === "SYSTEM_MESSAGE"
		) {
			let stepType: UnifiedStepType = "SYSTEM";
			if (type === "USER_INPUT") stepType = "USER";
			else if (type === "PLANNER_RESPONSE") stepType = "AGENT";
			else if (type === "SYSTEM_MESSAGE")
				stepType = this.categorizeSystemMessage(obj.content as string);

			return {
				id: `${index}`,
				index: (obj.step_index as number) ?? index,
				type: stepType,
				content: (obj.content as string) || "",
				timestamp: (obj.created_at as string) || (obj.timestamp as string),
				toolCalls: (
					obj.tool_calls as
						| Array<{
								name: string;
								args: Record<string, unknown>;
								[key: string]: unknown;
						  }>
						| undefined
				)?.map((tc) => ({
					name: tc.name,
					arguments: tc.args ?? tc,
				})),
				metadata: {
					source: obj.source as string,
					originalType: type,
					isTruncated: obj.is_truncated as boolean,
				},
			};
		}

		// Legacy format (user/gemini/info)
		if (type === "user") {
			const text = Array.isArray(obj.content)
				? (obj.content as Array<{ text?: string }>)
						.map((c) => c.text || "")
						.join("\n")
				: (obj.content as string) || "";
			return {
				id: `${index}`,
				index,
				type: "USER",
				content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>`,
				timestamp: obj.timestamp as string,
			};
		}

		if (type === "gemini") {
			const toolCalls = (
				obj.toolCalls as Array<{ name: string; args: Record<string, unknown> }>
			)?.map((tc) => ({
				name: tc.name,
				arguments: tc.args,
			}));

			let geminiText = "Executing tools...";
			if (Array.isArray(obj.content)) {
				geminiText = (obj.content as Array<{ text?: string }>)
					.map((c) => c.text || JSON.stringify(c))
					.join("\n");
			} else if (typeof obj.content === "string" && obj.content.trim()) {
				geminiText = obj.content;
			}

			return {
				id: `${index}`,
				index,
				type: "AGENT",
				content: geminiText,
				timestamp: obj.timestamp as string,
				toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
			};
		}

		if (type === "info" || type === "warning") {
			const infoText =
				typeof obj.content === "string"
					? obj.content
					: JSON.stringify(obj.content);
			return {
				id: `${index}`,
				index,
				type: "SYSTEM",
				content: `Output:\n${infoText}`,
				timestamp: obj.timestamp as string,
			};
		}

		// Unknown type
		return {
			id: `${index}`,
			index,
			type: "SYSTEM",
			content: JSON.stringify(obj),
		};
	}

	/** Categorize a system message into a more specific type. */
	protected categorizeSystemMessage(
		content: string | null | undefined,
	): UnifiedStepType {
		if (!content) return "SYSTEM";
		if (content.includes("File Path:") || content.includes("Showing lines"))
			return "FILE_PREVIEW";
		if (
			content.includes("[diff_block_start]") ||
			content.includes("diff --git")
		)
			return "DIFF_OUTPUT";
		if (
			content.includes("The command completed successfully") ||
			content.includes("Stdout:")
		)
			return "TERMINAL_OUTPUT";
		if (
			content.includes("Tool is running as a background task") ||
			content.includes('Task "da34')
		)
			return "NOISE";
		return "SYSTEM";
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
					if (obj.created_at) return obj.created_at;
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
	async streamLines(
		filePath: string,
		onLine: (line: string, index: number) => void,
	): Promise<void> {
		const rl = createInterface({
			input: createReadStream(filePath, { encoding: "utf-8" }),
			crlfDelay: Infinity,
		});

		let index = 0;
		for await (const line of rl) {
			if (line.trim()) {
				onLine(line, index++);
			}
		}
	}
}
