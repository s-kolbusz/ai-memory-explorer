import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Terminal, ChevronRight } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { TerminalViewer } from "./TerminalViewer";
import type { Step } from "../types";

/** Decode common HTML entities so &lt; &gt; &amp; etc. render correctly in content. */
function decodeHtmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"');
}

/** Try to parse a structured system event and return a prettified card. */
function formatSystemContent(raw: string): {
	summary: string | null;
	body: string;
	tags: { label: string; color: string }[];
} {
	const tags: { label: string; color: string }[] = [];

	// Try JSON parse for structured events
	try {
		const obj = JSON.parse(raw);
		if (obj && typeof obj === "object") {
			const entries: string[] = [];

			// Type badge (RUN_COMMAND, etc.)
			if (obj.type) {
				tags.push({
					label: obj.type,
					color:
						obj.status === "DONE" || obj.status === "SUCCESS"
							? "text-green-500/80 border-green-500/20 bg-green-500/10"
							: "text-purple-500/80 border-purple-500/20 bg-purple-500/10",
				});
			}

			// Status badge
			if (obj.status) {
				tags.push({
					label: obj.status,
					color:
						obj.status === "DONE" || obj.status === "SUCCESS"
							? "text-green-500/80 border-green-500/20 bg-green-500/10"
							: obj.status === "FAILED" || obj.status === "ERROR"
								? "text-red-500/80 border-red-500/20 bg-red-500/10"
								: "text-muted-foreground/80 border-border/30 bg-muted/30",
				});
			}

			// Source/model badge
			if (obj.source) {
				tags.push({
					label: obj.source,
					color: "text-blue-500/80 border-blue-500/20 bg-blue-500/10",
				});
			}
			if (obj.model) {
				tags.push({
					label: obj.model,
					color: "text-blue-500/80 border-blue-500/20 bg-blue-500/10",
				});
			}

			// Gemini thoughts
			if (obj.thoughts && Array.isArray(obj.thoughts)) {
				tags.push({
					label: `${obj.thoughts.length} thoughts`,
					color: "text-amber-500/80 border-amber-500/20 bg-amber-500/10",
				});
			}

			// Token counts
			if (obj.tokens && typeof obj.tokens === "object") {
				const t = obj.tokens as Record<string, number>;
				const total =
					t.total ??
					Object.values(t).reduce((a: number, b: number) => a + b, 0);
				tags.push({
					label: `${total.toLocaleString()} tokens`,
					color: "text-muted-foreground/80 border-border/30 bg-muted/30",
				});
			}

			// Build body: use the content field or other fields (thoughts, tokens, model)
			if (obj.content && typeof obj.content === "string") {
				entries.push(obj.content);
			} else if (obj.content && typeof obj.content === "object") {
				entries.push(JSON.stringify(obj.content, null, 2));
			}

			// If content is empty but we have thoughts, format them as a list
			if (
				obj.thoughts &&
				Array.isArray(obj.thoughts) &&
				obj.thoughts.length > 0
			) {
				const thoughtLines = obj.thoughts.map((t: any, i: number) => {
					const ts = t.timestamp
						? new Date(t.timestamp).toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							})
						: "";
					return `Thought ${i + 1}:${ts ? ` [${ts}]` : ""}\n  ${t.subject || ""}${t.description ? `\n  ${t.description}` : ""}`;
				});
				entries.push(thoughtLines.join("\n\n"));
			}

			// Token breakdown
			if (obj.tokens && typeof obj.tokens === "object") {
				const t = obj.tokens as Record<string, number>;
				const tokenParts = Object.entries(t)
					.filter(([k]) => k !== "total")
					.map(([k, v]) => `  ${k}: ${v.toLocaleString()}`);
				if (tokenParts.length > 0) {
					entries.push("Token usage:");
					entries.push(tokenParts.join("\n"));
				}
				if (t.total) {
					entries.push(`  total: ${t.total.toLocaleString()}`);
				}
			}

			// Model info
			if (obj.model && !entries.some((e) => e.includes(obj.model))) {
				entries.push(`Model: ${obj.model}`);
			}

			// Fallback: use full JSON if nothing else
			const body = entries.length > 0 ? entries.join("\n\n") : raw;
			return { summary: null, body, tags };
		}
	} catch {
		// Not JSON, fall through
	}

	return { summary: null, body: raw, tags };
}

export function SystemItem({
	sysItem,
	getSystemLabel,
}: {
	sysItem: Step;
	getSystemLabel: (type: string) => string;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const toolName = sysItem.toolCalls?.[0]?.name;
	const header = toolName ? `run_${toolName}` : getSystemLabel(sysItem.type);

	// Format content for prettified view
	const contentStr =
		typeof sysItem.content === "string"
			? sysItem.content
			: JSON.stringify(sysItem.content, null, 2);
	const formatted = formatSystemContent(contentStr);

	return (
		<details
			className="group/item border-b border-border/20 last:border-0 overflow-hidden"
			id={`step-${sysItem.id}`}
		>
			<summary className="flex items-center h-7 px-3 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 font-mono cursor-pointer select-none list-none transition-colors">
				<ChevronRight className="w-3 h-3 mr-1 opacity-60 group-open/item:rotate-90 transition-transform shrink-0" />
				<Terminal className="w-3.5 h-3.5 mr-1.5 opacity-70 shrink-0" />
				<span className="truncate">{header}</span>

				{/* Formatted tags (shown inline on the summary line) */}
				{!showRaw && formatted.tags.length > 0 && (
					<span className="ml-2 flex gap-1 overflow-hidden max-w-[200px]">
						{formatted.tags.slice(0, 3).map((t, i) => (
							<Badge
								key={i}
								variant="outline"
								className={`text-[8px] py-0 px-1 leading-none ${t.color}`}
							>
								{t.label}
							</Badge>
						))}
					</span>
				)}

				{/* Tool call badges */}
				{sysItem.toolCalls && sysItem.toolCalls.length > 0 && !showRaw && (
					<span className="ml-2 flex gap-1 overflow-hidden max-w-[200px]">
						{sysItem.toolCalls.map((tc: any, i: number) => {
							let colorClass =
								"text-muted-foreground/80 border-border/30 bg-muted/30";
							if (tc.name.includes("file") || tc.name.includes("write"))
								colorClass =
									"text-green-500/70 border-green-500/20 bg-green-500/8";
							else if (
								tc.name.includes("read") ||
								tc.name.includes("view") ||
								tc.name.includes("grep")
							)
								colorClass =
									"text-blue-500/70 border-blue-500/20 bg-blue-500/8";
							else if (
								tc.name.includes("command") ||
								tc.name.includes("terminal")
							)
								colorClass =
									"text-orange-500/70 border-orange-500/20 bg-orange-500/8";
							else if (tc.name.includes("search"))
								colorClass =
									"text-purple-500/70 border-purple-500/20 bg-purple-500/8";
							return (
								<Badge
									key={i}
									variant="outline"
									className={`text-[8px] py-0 px-1 leading-none ${colorClass}`}
								>
									{tc.name}
								</Badge>
							);
						})}
					</span>
				)}

				{/* Timestamp */}
				{sysItem.timestamp && (
					<span className="ml-auto text-[9px] text-muted-foreground/60 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0 tabular-nums">
						{new Date(sysItem.timestamp).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
							second: "2-digit",
						})}
					</span>
				)}
			</summary>

			<button
				onClick={() => setShowRaw(!showRaw)}
				className="absolute top-1 right-2 px-1.5 py-0.5 rounded hover:bg-muted/50 text-[9px] opacity-0 group-hover/details:opacity-100 transition-opacity text-muted-foreground/80 z-10"
			>
				{showRaw ? "Hide" : "JSON"}
			</button>

			<div className="border-t border-border/20 bg-muted/10 relative">
				{showRaw ? (
					<pre className="text-[11px] whitespace-pre-wrap font-mono p-3 overflow-x-auto text-muted-foreground/90 max-h-96">
						{decodeHtmlEntities(contentStr)}
					</pre>
				) : (
					<div className="p-3">
						{sysItem.type === "DIFF_OUTPUT" ? (
							<DiffViewer content={sysItem.content || ""} />
						) : sysItem.type === "TERMINAL_OUTPUT" ? (
							<TerminalViewer content={sysItem.content || ""} />
						) : sysItem.type === "FILE_PREVIEW" ? (
							<pre className="bg-muted/30 border border-border/30 rounded-md p-3 overflow-x-auto text-[12px] font-mono text-muted-foreground/90 whitespace-pre-wrap max-h-96">
								{contentStr}
							</pre>
						) : (
							/* SYSTEM events: render prettified card */
							<div className="space-y-2">
								{/* Tag row */}
								{formatted.tags.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{formatted.tags.map((t, i) => (
											<Badge
												key={i}
												variant="outline"
												className={`text-[9px] px-1.5 py-0.5 ${t.color}`}
											>
												{t.label}
											</Badge>
										))}
									</div>
								)}

								{/* Body */}
								{formatted.body.trim() ? (
									<pre className="bg-muted/40 border border-border/30 rounded-md p-3 overflow-x-auto text-[12px] font-mono text-muted-foreground/90 whitespace-pre-wrap max-h-96 leading-relaxed">
										{decodeHtmlEntities(formatted.body)}
									</pre>
								) : sysItem.toolCalls ? (
									<pre className="bg-muted/40 border border-border/30 rounded-md p-3 overflow-x-auto text-[12px] font-mono text-muted-foreground/90 whitespace-pre-wrap max-h-96">
										{JSON.stringify(sysItem.toolCalls, null, 2)}
									</pre>
								) : null}
							</div>
						)}
					</div>
				)}
			</div>
		</details>
	);
}
