import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getProviderConfig } from "@/shared/providers";
import { trpc } from "../trpc";
import type { SearchResult } from "../types";

interface SearchDialogProps {
	onSelectConversation: (
		convoId: string,
		projectId: string,
		query?: string,
		stepId?: string | null,
	) => void;
}

function stripSnippetHtml(snippet: string): string {
	return snippet.replace(/<\/?b>/g, "");
}

export function SearchDialog({ onSelectConversation }: SearchDialogProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const { data: results = [], isLoading } = trpc.searchConversations.useQuery(
		{ query },
		{ enabled: query.trim().length > 2, keepPreviousData: true },
	);

	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen((current) => !current);
			}
		};
		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	function handleSelect(result: SearchResult): void {
		onSelectConversation(
			result.id,
			result.project ?? "Unknown",
			query,
			result.stepId,
		);
		setOpen(false);
	}

	return (
		<>
			<div
				onClick={() => setOpen(true)}
				className="mx-4 mt-2 mb-4 px-3 py-2 bg-muted/50 hover:bg-muted text-muted-foreground text-xs rounded-md border flex items-center justify-between cursor-pointer transition-colors"
			>
				<div className="flex items-center">
					<Search className="w-3.5 h-3.5 mr-2 opacity-50" />
					<span>Search conversations...</span>
				</div>
				<kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
					<span className="text-xs">⌘</span>K
				</kbd>
			</div>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-[720px] p-0 overflow-hidden">
					<div className="flex items-center border-b px-4">
						<Search className="w-4 h-4 text-muted-foreground mr-3" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search messages, commands, diffs, files, and errors..."
							className="h-12 flex-1 bg-transparent outline-none text-sm"
							autoFocus
						/>
						{isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
					</div>

					<div className="max-h-[480px] overflow-y-auto">
						{query.trim().length <= 2 ? (
							<div className="p-8 text-sm text-muted-foreground text-center">
								Type at least three characters.
							</div>
						) : results.length === 0 && !isLoading ? (
							<div className="p-8 text-sm text-muted-foreground text-center">
								No matches found.
							</div>
						) : (
							results.map((result) => {
								const cfg = getProviderConfig(result.provider ?? "antigravity");
								return (
									<button
										key={`${result.id}-${result.stepId ?? "conversation"}`}
										type="button"
										onClick={() => handleSelect(result)}
										className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/40 transition-colors"
									>
										<div className="flex items-center gap-2">
											<Badge variant="outline" className={cfg.textColor}>
												{cfg.displayName}
											</Badge>
											{result.stepType && (
												<Badge variant="secondary">{result.stepType}</Badge>
											)}
											<span className="text-sm font-medium truncate">
												{result.title || "Untitled conversation"}
											</span>
										</div>
										<p className="mt-2 text-xs text-muted-foreground line-clamp-2">
											{stripSnippetHtml(result.snippet || "")}
										</p>
									</button>
								);
							})
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
