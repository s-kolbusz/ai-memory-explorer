import type React from "react";
import { useState } from "react";
import { Check, Code, Timer } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Step } from "../types";

export function ChatMessage({
	step,
	renderIcon,
}: {
	step: Step & { elapsedText?: string };
	renderIcon: (type: string) => React.ReactNode;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const isUser = step.type === "USER";

	let text =
		typeof step.content === "string"
			? step.content
			: JSON.stringify(step.content) || "";

	// Decode common HTML entities so encoded XML tags (e.g. &lt;hook_context&gt;) are
	// visible to the accordion extraction regexes below
	const decodeHtmlEntities = (s: string): string =>
		s
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"');
	text = decodeHtmlEntities(text);

	// Extract all known XML tag types as accordion blocks
	// Must match the tagsToStrip that App.tsx used to strip here
	type BlockEntry = { title: string; content: string };
	const blocks: BlockEntry[] = [];

	const extractBlock = (title: string, regex: RegExp): void => {
		text = text.replace(regex, (_match: string, content: string) => {
			if (content?.trim()) {
				blocks.push({ title, content: content.trim() });
			}
			return "";
		});
	};

	// Tags extracted as accordion blocks (user/frontend visible context)
	extractBlock("Instructions", /<INSTRUCTIONS>([\s\S]*?)<\/INSTRUCTIONS>/gi);
	extractBlock(
		"Skills Instructions",
		/<skills_instructions>([\s\S]*?)<\/skills_instructions>/gi,
	);
	extractBlock(
		"Environment Context",
		/<environment_context>([\s\S]*?)<\/environment_context>/gi,
	);
	extractBlock(
		"Permissions Instructions",
		/<permissions_instructions>([\s\S]*?)<\/permissions_instructions>/gi,
	);
	extractBlock(
		"Permissions Instructions",
		/<permissions instructions>([\s\S]*?)<\/permissions instructions>/gi,
	);
	extractBlock("Skill Context", /<skill>([\s\S]*?)<\/skill>/gi);
	extractBlock(
		"Collaboration Mode",
		/<collaboration_mode>([\s\S]*?)<\/collaboration_mode>/gi,
	);
	extractBlock("App Context", /<app-context>([\s\S]*?)<\/app-context>/gi);
	extractBlock(
		"Filesystem Access",
		/<filesystem_access>([\s\S]*?)<\/filesystem_access>/gi,
	);
	extractBlock("Turn Aborted", /<turn_aborted>([\s\S]*?)<\/turn_aborted>/gi);
	extractBlock("Execution Plan", /<plan>([\s\S]*?)<\/plan>/gi);
	extractBlock(
		"Plugins Instructions",
		/<plugins_instructions>([\s\S]*?)<\/plugins_instructions>/gi,
	);
	extractBlock(
		"Bash Command Reminder",
		/<bash_command_reminder>([\s\S]*?)<\/bash_command_reminder>/gi,
	);

	// System tags that are stripped but shown as accordion blocks
	extractBlock(
		"Additional Metadata",
		/<ADDITIONAL_METADATA>([\s\S]*?)<\/ADDITIONAL_METADATA>/gi,
	);
	extractBlock(
		"Settings Change",
		/<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/gi,
	);
	extractBlock(
		"Conversation Summaries",
		/<conversation_summaries>([\s\S]*?)<\/conversation_summaries>/gi,
	);
	extractBlock("Artifacts", /<artifacts>([\s\S]*?)<\/artifacts>/gi);
	extractBlock("Plugins", /<plugins>([\s\S]*?)<\/plugins>/gi);
	extractBlock("Subagents", /<subagents>([\s\S]*?)<\/subagents>/gi);
	extractBlock("Skills", /<skills>([\s\S]*?)<\/skills>/gi);
	extractBlock("Messaging", /<messaging>([\s\S]*?)<\/messaging>/gi);
	extractBlock(
		"Transcript",
		/<conversation_transcript>([\s\S]*?)<\/conversation_transcript>/gi,
	);
	extractBlock(
		"Slash Commands",
		/<slash_commands>([\s\S]*?)<\/slash_commands>/gi,
	);
	extractBlock("Guidelines", /<guidelines>([\s\S]*?)<\/guidelines>/gi);
	extractBlock(
		"Style Guide",
		/<communication_style>([\s\S]*?)<\/communication_style>/gi,
	);
	extractBlock("User Rules", /<user_rules>([\s\S]*?)<\/user_rules>/gi);
	extractBlock(
		"Priority Instructions",
		/<priority_instructions>([\s\S]*?)<\/priority_instructions>/gi,
	);
	extractBlock(
		"Context Window Protection",
		/<context_window_protection>([\s\S]*?)<\/context_window_protection>/gi,
	);
	extractBlock("Hook Context", /<hook_context>([\s\S]*?)<\/hook_context>/gi);
	extractBlock(
		"Session Context",
		/<session_context>([\s\S]*?)<\/session_context>/gi,
	);
	extractBlock(
		"Project Context",
		/<project_context>([\s\S]*?)<\/project_context>/gi,
	);

	// Extract "--- Content from referenced files ---" section
	// IMPORTANT: only match specific end marker or EOS — never bare ---,
	// because --- appears in markdown tables, YAML frontmatter, and hr.
	// Split the captured content into per-file accordions underneath.
	text = text.replace(
		/--- Content from referenced files ---([\s\S]*?)(?:--- End of content ---|$)/gi,
		(_match: string, content: string) => {
			if (!content?.trim()) return "";
			let refContent = content.trim();

			// First extract any nested project context sections from within the
			// referenced files block, so they get their own accordion.
			refContent = refContent.replace(
				/--- Newly Discovered Project Context ---([\s\S]*?)(?:--- End Project Context ---|$)/gi,
				(_m: string, ctxContent: string) => {
					if (ctxContent?.trim()) {
						// Strip the "--- Context from:" structural header line
						const cleaned = ctxContent
							.trim()
							.replace(/^--- Context from:[^\n]*---\n?/gm, "")
							.trim();
						if (cleaned) {
							blocks.push({
								title: "Discovered Project Context",
								content: cleaned,
							});
						}
					}
					return "";
				},
			);

			// Also extract any "--- Context from: ... ---" sub-sections
			refContent = refContent.replace(
				/--- Context from:[^\n]*---([\s\S]*?)(?:--- End of Context from:[^\n]*---|$)/gi,
				(_m: string, ctxContent: string) => {
					if (ctxContent?.trim()) {
						blocks.push({
							title: "Context File",
							content: ctxContent.trim(),
						});
					}
					return "";
				},
			);

			// Split remaining content by "Content from @path:" headers
			const fileSections = refContent.split(/(?=Content from @[^\n]*:)/);
			for (const section of fileSections) {
				const trimmed = section.trim();
				if (!trimmed) continue;

				const headerMatch = trimmed.match(/Content from @([^\n]*):/);
				if (headerMatch) {
					const filename = (headerMatch[1] ?? "").trim();
					const fileContent = trimmed
						.replace(/Content from @[^\n]*:\n?/, "")
						.trim();
					if (fileContent) {
						// Shorten the label if the path is long
						const label =
							filename.length > 45 ? "..." + filename.slice(-40) : filename;
						blocks.push({
							title: label,
							content: fileContent,
						});
					}
				} else if (trimmed.length > 20) {
					// Orphan content without a @ header — treat as plain
					// text that didn't get split; skip it.
				}
			}

			return "";
		},
	);

	// Standalone extractions (for sections NOT nested inside referenced files)
	// Extract "--- Newly Discovered Project Context ---" section
	text = text.replace(
		/--- Newly Discovered Project Context ---([\s\S]*?)(?:--- End Project Context ---|$)/gi,
		(_match: string, content: string) => {
			if (content?.trim()) {
				const cleaned = content
					.trim()
					.replace(/^--- Context from:[^\n]*---\n?/gm, "")
					.trim();
				if (cleaned) {
					blocks.push({
						title: "Discovered Project Context",
						content: cleaned,
					});
				}
			}
			return "";
		},
	);

	// Extract "--- Context from: ... ---" sections
	text = text.replace(
		/--- Context from:[^\n]*---([\s\S]*?)(?:--- End of Context from:[^\n]*---|$)/gi,
		(_match: string, content: string) => {
			if (content?.trim()) {
				const cleaned = content
					.trim()
					.replace(/^--- Context from:[^\n]*---\n?/gm, "")
					.trim();
				if (cleaned) {
					blocks.push({
						title: "Context File",
						content: cleaned,
					});
				}
			}
			return "";
		},
	);

	// Final cleanup: strip any remaining standalone --- section markers
	// (end markers left over from edge cases like double --- End of content ---)
	text = text.replace(
		/--- (?:End of content|End Project Context|End of Context from:[^\n]*) ---/gi,
		"",
	);

	// Final safety pass: strip any remaining standalone known XML tags
	// (in case previous accordion extractions missed edge cases)
	const knownTags = [
		"hook_context",
		"context_window_protection",
		"priority_instructions",
		"instructions",
		"INSTRUCTIONS",
		"user_rules",
		"guidelines",
		"session_context",
		"project_context",
		"skill",
		"skills",
		"tool_selection_hierarchy",
		"when_not_to_use",
		"file_writing_policy",
		"output_constraints",
		"session_continuity",
		"ctx_commands",
		"artifact_policy",
		"communication_style",
	];
	const knownTagPattern = new RegExp(
		`</?(?:${knownTags.join("|")})\\s*>`,
		"gi",
	);
	text = text.replace(knownTagPattern, "").trim();

	text = text.replace(
		/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi,
		(_match: string, c: string) => {
			return c.trim();
		},
	);
	text = text
		.replace(/# AGENTS\.md instructions for[^\n]*(?:\n|$)/gi, "")
		.replace(/# (Global Agent Guidelines|Role & System Context)[^\n]*\n*/gi, "")
		.replace(/\*\*ALWAYS\*\*[^\n]*\n*/gi, "")
		.trim();

	// Wrap skill reference (/word) at start of user messages so ReactMarkdown renders it as code
	if (isUser) {
		text = text.replace(/^\/([\w-]+)/, "`/$1`");
	}

	// Also load accordion blocks from backend-extracted metadata
	const metaBlocks = step.metadata?.accordionBlocks as
		| Array<{ title: string; content: string }>
		| undefined;
	if (metaBlocks) {
		for (const mb of metaBlocks) {
			const isDuplicate = blocks.some(
				(b) => b.title === mb.title && b.content === mb.content,
			);
			if (!isDuplicate) {
				blocks.push(mb);
			}
		}
	}

	const hiddenCount = blocks.length;
	const showContent =
		text.trim() !== "" || (step.toolCalls && step.toolCalls.length > 0);

	return (
		<div className="flex flex-col w-full mb-6">
			{/* Accordion blocks (rendered outside the main row) */}
			{blocks.length > 0 && (
				<div
					className={`flex flex-col gap-2 mb-3 w-full ${isUser ? "items-end" : "items-start"}`}
				>
					{blocks.map((b, i) => (
						<details
							key={i}
							className="bg-muted/20 border border-border/30 rounded-md overflow-hidden group max-w-3xl w-full"
						>
							<summary className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:bg-muted/40 transition-colors select-none flex items-center">
								<Code className="w-3.5 h-3.5 mr-2 opacity-70" />
								{b.title}
							</summary>
							<div className="p-3 text-[12px] font-mono border-t border-border/30 whitespace-pre-wrap max-h-60 overflow-y-auto text-muted-foreground/90 bg-muted/10">
								{b.content}
							</div>
						</details>
					))}
				</div>
			)}

			{/* Main Row: Avatar + Content */}
			{showContent && (
				<div
					id={`step-${step.id}`}
					className={`flex gap-3 w-full group ${isUser ? "flex-row-reverse" : ""}`}
				>
					{/* Avatar */}
					<div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted/50 border border-border/30">
						{renderIcon(step.type)}
					</div>

					<div
						className={`flex flex-col min-w-0 ${isUser ? "items-end" : "items-start"} max-w-[calc(100%-3.5rem)]`}
					>
						{/* Header row */}
						<div
							className={`flex items-center gap-2 mb-1.5 ${isUser ? "flex-row-reverse" : ""}`}
						>
							<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
								{isUser ? "You" : "Assistant"}
							</span>
							{step.timestamp && (
								<span
									className="text-[10px] text-muted-foreground/60 font-normal"
									title={new Date(step.timestamp).toLocaleString()}
								>
									{new Date(step.timestamp).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})}{" "}
									{new Date(step.timestamp).toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
									})}
								</span>
							)}
							{step.elapsedText && (
								<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded-full font-mono">
									<Timer className="w-2.5 h-2.5" />
									{step.elapsedText}
								</span>
							)}
							<button
								onClick={() => setShowRaw(!showRaw)}
								className="px-1.5 py-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground/70"
							>
								{showRaw ? "Hide" : "JSON"}
							</button>
						</div>

						{/* Content area */}
						{showRaw ? (
							<pre className="text-[11px] whitespace-pre-wrap font-mono p-3 bg-muted/30 border border-border/20 rounded-lg overflow-x-auto text-muted-foreground/90 max-h-[500px] w-full">
								{typeof step.content === "string"
									? step.content
									: JSON.stringify(step.content, null, 2)}
							</pre>
						) : isUser ? (
							/* User messages: subtle bubble */
							<div className="bg-muted/60 border border-border/40 rounded-2xl px-4 py-3 max-w-[85%]">
								<div className="prose prose-sm max-w-none break-words dark:prose-invert prose-p:leading-relaxed prose-pre:bg-muted/70 prose-pre:border prose-pre:border-border/30 prose-a:text-primary prose-code:text-[0.85em] prose-code:font-normal">
									<ReactMarkdown
										remarkPlugins={[remarkGfm]}
										components={{
											code: ({ children, className, ...props }) => {
												const text = String(children);
												if (text.startsWith("/") && text.length > 1) {
													return (
														<code className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/25">
															{text}
														</code>
													);
												}
												return (
													<code className={className} {...props}>
														{children}
													</code>
												);
											},
										}}
									>
										{text.trim()}
									</ReactMarkdown>
								</div>
							</div>
						) : (
							/* Agent messages: no bubble, clean text directly */
							<div className="w-full prose prose-sm max-w-none break-words dark:prose-invert prose-p:leading-relaxed prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-lg prose-a:text-primary prose-code:text-[0.85em] prose-code:font-normal">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{text.trim()}
								</ReactMarkdown>
							</div>
						)}

						{/* Hidden blocks indicator — clickable to show raw */}
						{hiddenCount > 0 && !showRaw && (
							<div
								className={`mt-1 flex items-center gap-1.5 ${isUser ? "justify-end" : ""}`}
							>
								<button
									onClick={() => setShowRaw(true)}
									className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors inline-flex items-center gap-1 bg-muted/20 hover:bg-muted/40 px-2 py-0.5 rounded-md"
								>
									<Check className="w-2.5 h-2.5" />
									{hiddenCount} metadata block{hiddenCount > 1 ? "s" : ""} —
									click to preview
								</button>
							</div>
						)}

						{/* Tool calls */}
						{step.toolCalls && step.toolCalls.length > 0 && (
							<div
								className={`flex flex-wrap gap-1.5 mt-1.5 ${isUser ? "justify-end" : ""}`}
							>
								{step.toolCalls.map((tc: any, i: number) => {
									let colorClass = isUser
										? "bg-muted-foreground/10 text-foreground/80 border-transparent"
										: "text-muted-foreground/80 border-border/30 bg-muted/40";

									if (!isUser) {
										if (tc.name.includes("file") || tc.name.includes("write"))
											colorClass =
												"text-green-500/80 border-green-500/20 bg-green-500/10";
										else if (
											tc.name.includes("read") ||
											tc.name.includes("view") ||
											tc.name.includes("grep")
										)
											colorClass =
												"text-blue-500/80 border-blue-500/20 bg-blue-500/10";
										else if (
											tc.name.includes("command") ||
											tc.name.includes("terminal")
										)
											colorClass =
												"text-orange-500/80 border-orange-500/20 bg-orange-500/10";
										else if (tc.name.includes("search"))
											colorClass =
												"text-purple-500/80 border-purple-500/20 bg-purple-500/10";
									}

									return (
										<span
											key={i}
											className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono border ${colorClass}`}
										>
											<Code className="w-2.5 h-2.5" />
											{tc.name}
										</span>
									);
								})}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
