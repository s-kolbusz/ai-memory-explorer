import React, { useState, useCallback } from "react";
import { trpc } from "./trpc";
import {
	MessageSquare,
	Terminal,
	ChevronRight,
	Bot,
	User,
	Code,
	SplitSquareHorizontal,
	FileCode2,
	Diff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { ReportIssueButton } from "./components/ReportIssueButton";
import { SystemItem } from "./components/SystemItem";
import { ChatMessage } from "./components/ChatMessage";
import { getProviderConfig } from "@/shared/providers";
import type { ConversationItem, EventFilters, Step } from "./types";
import type { ProviderId } from "@/shared/providers";

function formatRelativeTime(dateString: string | null) {
	if (!dateString) return "";
	const ts = new Date(dateString).getTime();
	const now = Date.now();
	const diff = now - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	const days = Math.floor(hrs / 24);
	if (days < 14) return `${days}d`;
	const weeks = Math.floor(days / 7);
	return `${weeks}w`;
}

export default function App() {
	const [showOnboarding, setShowOnboarding] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.localStorage.getItem("onboarding-complete") !== "true";
	});

	if (showOnboarding) {
		return (
			<OnboardingScreen
				onComplete={() => {
					window.localStorage.setItem("onboarding-complete", "true");
					setShowOnboarding(false);
				}}
			/>
		);
	}

	return <Explorer />;
}

function Explorer() {
	const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(
		null,
	);
	const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
	const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
	const [showSystemEvents, setShowSystemEvents] = useState(true);
	const [eventFilters, setEventFilters] = useState<EventFilters>({
		SYSTEM: true,
		TOOL_USE: true,
		FILE_PREVIEW: true,
		DIFF_OUTPUT: true,
		TERMINAL_OUTPUT: true,
		ERROR: true,
	});
	const [searchQuery, setSearchQuery] = useState("");
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [dateRange, setDateRange] = useState<"all" | "24h" | "7d">("all");

	// Infinite scroll conversation list
	const {
		data: pagesData,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading: loadingConvos,
	} = trpc.getConversationsPaginated.useInfiniteQuery(
		{
			limit: 50,
			provider: selectedProvider ?? undefined,
			hasError: errorsOnly ? true : undefined,
			dateFrom:
				dateRange === "24h"
					? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
					: dateRange === "7d"
						? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
						: undefined,
		},
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor,
		},
	);

	const conversations: ConversationItem[] = React.useMemo(
		() =>
			(pagesData?.pages.flatMap((page) => page.items) as ConversationItem[]) ??
			[],
		[pagesData],
	);

	// Intersection Observer for infinite scroll
	const sentinelRef = useCallback(
		(node: HTMLDivElement | null) => {
			if (!node) return;
			const observer = new IntersectionObserver(
				(entries) => {
					if (
						entries[0]?.isIntersecting &&
						hasNextPage &&
						!isFetchingNextPage
					) {
						fetchNextPage();
					}
				},
				{ rootMargin: "200px" },
			);
			observer.observe(node);
			return () => observer.disconnect();
		},
		[hasNextPage, isFetchingNextPage, fetchNextPage],
	);

	const { data: globalProviders } = trpc.getProviders.useQuery();
	const providers = globalProviders || [];

	const { data: selectedConvoData } = trpc.getConversation.useQuery(
		{ id: selectedConvoId || "" },
		{ enabled: !!selectedConvoId },
	);

	const selectedConvo = selectedConvoData as ConversationItem | null;
	const convoPath = selectedConvo?.path ?? undefined;
	const convoProvider = selectedConvo?.provider ?? undefined;
	const { data: transcript, isLoading: loadingTranscript } =
		trpc.getTranscript.useQuery(
			{ logPath: convoPath || "", provider: convoProvider },
			{ enabled: !!selectedConvoData },
		);

	const handleSelectSearchResult = (
		convoId: string,
		_projectId: string,
		query?: string,
		stepId?: string | null,
	) => {
		setSelectedConvoId(convoId);
		setSelectedProvider(null);
		setSelectedStepId(null);
		setSearchQuery(query || "");
		setSelectedStepId(stepId ?? null);
	};

	const steps: Step[] = transcript || [];

	React.useEffect(() => {
		if (steps.length > 0 && !loadingTranscript) {
			const targetStep = selectedStepId
				? steps.find((s: Step) => s.id === selectedStepId)
				: null;
			const lowerQuery = searchQuery.toLowerCase();
			const matchedStep =
				targetStep ??
				(searchQuery
					? steps.find((s: Step) =>
							s.content?.toLowerCase().includes(lowerQuery),
						)
					: null);
			if (matchedStep) {
				setTimeout(() => {
					const el = document.getElementById(`step-${matchedStep.id}`);
					if (el) {
						const details = el.closest("details");
						if (details) details.open = true;
						el.scrollIntoView({ behavior: "smooth", block: "center" });
						el.classList.add("bg-accent", "transition-colors", "duration-500");
						setTimeout(() => el.classList.remove("bg-accent"), 2000);
					}
					setSearchQuery("");
					setSelectedStepId(null);
				}, 300);
			}
		}
	}, [steps, searchQuery, selectedStepId, loadingTranscript]);

	// Group tool calls and system logs between agent messages into a single block
	const processedSteps: (Step | { isGroup: true; items: Step[] })[] = [];
	let currentGroup: Step[] = [];
	let lastUserTime = 0;

	for (const step of steps) {
		if (step.type === "NOISE") continue;
		if (step.content?.includes("<EPHEMERAL_MESSAGE>")) continue;

		let rawContent = step.content ?? "";
		if (typeof rawContent !== "string") {
			rawContent = JSON.stringify(rawContent, null, 2);
		}

		let elapsedText = "";
		if (step.type === "USER" && step.timestamp) {
			lastUserTime = new Date(step.timestamp).getTime();
		} else if (step.type === "AGENT" && step.timestamp && lastUserTime > 0) {
			const diffMs = new Date(step.timestamp).getTime() - lastUserTime;
			if (diffMs > 1000) {
				elapsedText = `${(diffMs / 1000).toFixed(1)}s`;
			}
		}

		const processedStep: Step & {
			elapsedText: string;
		} = { ...step, content: rawContent, elapsedText };

		const isSystemEvent = [
			"SYSTEM",
			"FILE_PREVIEW",
			"DIFF_OUTPUT",
			"TERMINAL_OUTPUT",
			"ERROR",
		].includes(step.type);
		const isAgentThinking = step.type === "AGENT" && !rawContent;
		const isEmptyUser = step.type === "USER" && !rawContent;

		if (isSystemEvent || isAgentThinking || isEmptyUser) {
			if (processedStep.type === "SYSTEM" && currentGroup.length > 0) {
				const prev = currentGroup[currentGroup.length - 1];
				if (
					prev &&
					prev.type === "AGENT" &&
					prev.toolCalls &&
					prev.toolCalls.length > 0 &&
					!prev.content
				) {
					processedStep.toolCalls = prev.toolCalls;
					currentGroup.pop();
				}
			}
			currentGroup.push(processedStep);
		} else {
			if (currentGroup.length > 0) {
				processedSteps.push({ isGroup: true, items: currentGroup });
				currentGroup = [];
			}
			processedSteps.push(processedStep);
		}
	}
	if (currentGroup.length > 0) {
		processedSteps.push({ isGroup: true, items: currentGroup });
	}

	const renderIcon = (type: string) => {
		switch (type) {
			case "USER":
				return (
					<div className="bg-muted text-muted-foreground rounded-full p-1.5">
						<User className="w-5 h-5" />
					</div>
				);
			case "AGENT":
				return (
					<div className="bg-primary/10 text-primary rounded-full p-1.5">
						<Bot className="w-5 h-5" />
					</div>
				);
			case "FILE_PREVIEW":
				return (
					<div className="bg-blue-500/10 text-blue-400 rounded-full p-1.5">
						<FileCode2 className="w-4 h-4" />
					</div>
				);
			case "DIFF_OUTPUT":
				return (
					<div className="bg-green-500/10 text-green-400 rounded-full p-1.5">
						<Diff className="w-4 h-4" />
					</div>
				);
			case "TERMINAL_OUTPUT":
				return (
					<div className="bg-orange-500/10 text-orange-400 rounded-full p-1.5">
						<Terminal className="w-4 h-4" />
					</div>
				);
			default:
				return (
					<div className="bg-muted text-muted-foreground rounded-full p-1.5">
						<Terminal className="w-4 h-4" />
					</div>
				);
		}
	};

	const getSystemLabel = (type: string) => {
		switch (type) {
			case "FILE_PREVIEW":
				return "File Preview";
			case "DIFF_OUTPUT":
				return "Diff Output";
			case "TERMINAL_OUTPUT":
				return "Terminal Execution";
			case "ERROR":
				return "Error";
			default:
				return "System Event";
		}
	};

	return (
		<div className="flex h-screen w-full bg-background text-foreground font-sans overflow-hidden">
			{/* Sidebar */}
			<div className="w-80 border-r bg-muted/10 flex flex-col h-full shrink-0">
				<div className="p-3 flex items-center justify-between">
					<h1 className="font-semibold flex items-center gap-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 512 512"
							className="w-5 h-5 shrink-0 text-primary"
							role="img"
							aria-label="AI Conversations Explorer icon"
						>
							<defs>
								<mask
									id="sidebar-lens"
									maskUnits="userSpaceOnUse"
									x="0"
									y="0"
									width="512"
									height="512"
								>
									<rect width="512" height="512" fill="white" />
									<circle cx="294" cy="238" r="82" fill="black" />
								</mask>
							</defs>
							<path
								d="M138 118H285C344 118 392 166 392 225V278C392 323 355 360 310 360H202L144 416C133 426 116 419 116 403V360H108C73 360 45 332 45 297V211C45 160 87 118 138 118Z"
								fill="currentColor"
								mask="url(#sidebar-lens)"
							/>
							<circle
								cx="294"
								cy="238"
								r="103"
								stroke="currentColor"
								stroke-width="32"
							/>
							<path
								d="M366 312L438 384"
								stroke="currentColor"
								stroke-width="38"
								stroke-linecap="round"
							/>
							<g fill="currentColor" opacity="0.7">
								<rect x="248" y="257" width="19" height="64" rx="4" />
								<circle cx="257.5" cy="248" r="24" />
								<rect x="309" y="209" width="19" height="112" rx="4" />
								<circle cx="318.5" cy="200" r="24" />
							</g>
						</svg>
						<span className="tracking-tight text-sm">
							AI Conversations Explorer
						</span>
					</h1>
				</div>

				<SearchDialog onSelectConversation={handleSelectSearchResult} />

				{/* Provider Tabs (Top Level) */}
				{providers.length > 0 && (
					<div className="flex border-y border-border/50 overflow-x-auto">
						<button
							onClick={() => {
								setSelectedProvider(null);
							}}
							className={`flex-1 min-w-[60px] py-2 text-[11px] uppercase tracking-wider font-semibold text-center border-b-2 transition-colors ${!selectedProvider ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
						>
							All
						</button>
						{providers.map((p) => {
							const cfg = getProviderConfig(p);
							// Static classes required for Tailwind v4 JIT
							const activeClass =
								selectedProvider === p
									? ({
											antigravity: "border-blue-500 text-blue-500",
											codex: "border-green-500 text-green-500",
											"gemini-cli": "border-purple-500 text-purple-500",
											"claude-code": "border-orange-500 text-orange-500",
										}[cfg.id] ?? "border-primary text-primary")
									: "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30";
							return (
								<button
									key={p}
									onClick={() => {
										setSelectedProvider(p);
									}}
									className={`flex-1 min-w-[60px] py-2 text-[11px] uppercase tracking-wider font-semibold text-center border-b-2 transition-all duration-200 ease-out ${activeClass}`}
								>
									{cfg.displayName}
								</button>
							);
						})}
					</div>
				)}

				<div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 text-[11px]">
					<button
						type="button"
						onClick={() => setErrorsOnly((value) => !value)}
						className={`px-2 py-1 rounded border transition-colors ${
							errorsOnly
								? "border-red-500/40 bg-red-500/10 text-red-500"
								: "border-border/50 text-muted-foreground hover:text-foreground"
						}`}
					>
						Errors
					</button>
					<select
						value={dateRange}
						onChange={(event) =>
							setDateRange(event.target.value as "all" | "24h" | "7d")
						}
						className="h-7 rounded border border-border/50 bg-background px-2 text-muted-foreground"
					>
						<option value="all">All time</option>
						<option value="24h">Last 24h</option>
						<option value="7d">Last 7d</option>
					</select>
				</div>

				<div className="flex-1 overflow-y-auto no-scrollbar p-2">
					{loadingConvos ? (
						<div className="space-y-2 px-2 py-2">
							{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
								<div
									key={i}
									className="flex flex-col gap-2 p-2 rounded-sm border border-border/5 bg-muted/20 animate-pulse"
								>
									<div className="flex justify-between items-center w-full">
										<div className="h-3 w-2/3 bg-muted rounded"></div>
									</div>
									<div className="flex justify-between items-center w-full mt-1">
										<div className="h-2.5 w-1/4 bg-muted rounded"></div>
										<div className="h-2.5 w-8 bg-muted rounded"></div>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="space-y-0.5">
							{conversations.length === 0 ? (
								<div className="text-xs text-muted-foreground/80 py-1 px-2">
									No conversations found.
								</div>
							) : (
								conversations.map((c) => {
									const cfg = getProviderConfig(c.provider ?? "antigravity");
									const isSelected = selectedConvoId === c.id;

									return (
										<div
											key={c.id}
											onClick={() => setSelectedConvoId(c.id)}
											className={`relative flex flex-col gap-0.5 px-3 py-2.5 cursor-pointer transition-all select-none
												${
													isSelected
														? "bg-accent/40 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-full before:bg-primary"
														: "hover:bg-muted/30 rounded-sm"
												}`}
										>
											<div className="flex items-center gap-2 min-w-0">
												<MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
												<span className="truncate text-sm font-medium leading-tight">
													{c.title || c.id}
												</span>
											</div>
											<div className="flex items-center gap-1.5 pl-5">
												<span
													className={`inline-block w-[6px] h-[6px] rounded-full ${
														{
															antigravity: "bg-blue-500",
															codex: "bg-green-500",
															"gemini-cli": "bg-purple-500",
															"claude-code": "bg-orange-500",
														}[cfg.id] ?? "bg-muted-foreground"
													}`}
												/>
												<span className="text-[11px] text-muted-foreground/80 truncate">
													{cfg.displayName}
												</span>
												<span
													className="ml-auto text-[10px] text-muted-foreground/60 shrink-0 tabular-nums flex items-center gap-1"
													title={
														c.timestamp
															? new Date(c.timestamp).toLocaleString()
															: ""
													}
												>
													<span>{formatRelativeTime(c.timestamp)} ago</span>
												</span>
											</div>
											{c.created_at && (
												<div className="text-[9px] text-muted-foreground/40 pl-5 mt-0.5">
													Started{" "}
													{new Date(c.created_at).toLocaleDateString(
														undefined,
														{
															month: "short",
															day: "numeric",
														},
													)}{" "}
													{new Date(c.created_at).toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</div>
											)}
										</div>
									);
								})
							)}
							{/* Infinite scroll sentinel */}
							{hasNextPage && <div ref={sentinelRef} className="h-4" />}
							{isFetchingNextPage && (
								<div className="flex justify-center py-3">
									<div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
								</div>
							)}
						</div>
					)}
				</div>

				<div className="p-3 border-t shrink-0 space-y-2">
					<ReportIssueButton />
					<SettingsDialog
						showSystemEvents={showSystemEvents}
						setShowSystemEvents={setShowSystemEvents}
						eventFilters={eventFilters}
						setEventFilters={setEventFilters}
					/>
				</div>
			</div>

			{/* Main Content - Chat view */}
			<div className="flex-1 flex flex-col bg-background relative overflow-hidden">
				{selectedConvoId ? (
					<div
						key={selectedConvoId}
						className="flex-1 flex flex-col min-h-0 animate-slide-in-right"
					>
						<div className="h-14 px-6 border-b border-border/40 flex items-center justify-between bg-background/95 backdrop-blur-md shrink-0 z-10 sticky top-0">
							<h2 className="font-semibold truncate pr-4 text-foreground text-sm tracking-tight">
								{selectedConvo?.title ?? ""}
							</h2>
							<div className="flex items-center gap-2 flex-shrink-0">
								{(() => {
									const cfg = getProviderConfig(
										selectedConvo?.provider ?? "antigravity",
									);
									return (
										<Badge
											variant="secondary"
											className={`text-[11px] uppercase tracking-wider font-mono px-2 py-0.5 ${
												{
													antigravity:
														"text-blue-500 bg-blue-500/10 border-blue-500/30",
													codex:
														"text-green-500 bg-green-500/10 border-green-500/30",
													"gemini-cli":
														"text-purple-500 bg-purple-500/10 border-purple-500/30",
													"claude-code":
														"text-orange-500 bg-orange-500/10 border-orange-500/30",
												}[cfg.id] ??
												"text-muted-foreground bg-muted/10 border-border/30"
											}`}
										>
											{cfg.displayName}
										</Badge>
									);
								})()}
								<Badge
									variant="outline"
									className="text-[10px] font-mono px-2 py-0.5 text-muted-foreground/80 border-border/50"
								>
									{selectedConvo?.timestamp
										? new Date(selectedConvo.timestamp).toLocaleString()
										: ""}
								</Badge>
							</div>
						</div>

						<div
							className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 scroll-smooth"
							id="transcript-container"
						>
							<div className="p-6 pb-20 space-y-6 max-w-4xl mx-auto w-full">
								{loadingTranscript ? (
									<div className="space-y-8 mt-4">
										{[1, 2, 3].map((i) => (
											<div key={i} className="flex gap-4 animate-pulse">
												<div className="w-8 h-8 rounded-full bg-muted shrink-0"></div>
												<div className="flex-1 space-y-3 pt-1">
													<div className="h-4 bg-muted rounded w-1/4"></div>
													<div className="h-24 bg-muted/30 rounded w-full border border-border/30"></div>
												</div>
											</div>
										))}
									</div>
								) : processedSteps.length === 0 ? (
									<div className="text-center text-muted-foreground mt-10">
										No steps found.
									</div>
								) : (
									processedSteps.map(
										(
											step: Step | { isGroup: true; items: Step[] },
											idx: number,
										) => {
											if ("isGroup" in step) {
												if (!showSystemEvents) return null;

												const visibleItems = step.items.filter(
													(sysItem: Step) =>
														eventFilters[
															sysItem.type as keyof typeof eventFilters
														] !== false,
												);

												if (visibleItems.length === 0) return null;

												return (
													<details
														key={`group-${idx}`}
														className="border border-border/20 rounded-lg max-w-3xl mx-auto w-full overflow-hidden group mb-6"
													>
														<summary className="px-3 py-2 text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors flex items-center list-none select-none uppercase tracking-wider">
															<Code className="w-3.5 h-3.5 mr-1.5 opacity-70" />
															{visibleItems.length} System Actions / Tool Calls
															<ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50 group-open:rotate-90 transition-transform" />
														</summary>
														<div className="divide-y divide-border/20">
															{visibleItems.map((sysItem: Step) => (
																<SystemItem
																	key={sysItem.id}
																	sysItem={sysItem}
																	getSystemLabel={getSystemLabel}
																/>
															))}
														</div>
													</details>
												);
											}
											return (
												<ChatMessage
													key={step.id}
													step={step}
													renderIcon={renderIcon}
												/>
											);
										},
									)
								)}
							</div>
						</div>
					</div>
				) : (
					<div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
						<SplitSquareHorizontal className="w-12 h-12 mb-4 opacity-20" />
						<p>Select a workspace and conversation to view</p>
					</div>
				)}
			</div>
		</div>
	);
}
