import { useState } from "react";
import {
	CheckCircle2,
	FolderGit2,
	Monitor,
	Moon,
	Plus,
	Settings,
	Sun,
	Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { PROVIDER_IDS, getProviderConfig, type ProviderId } from "@/shared/providers";
import { useTheme } from "../theme";
import { trpc } from "../trpc";
import type { EventFilters } from "../types";

interface SettingsDialogProps {
	showSystemEvents: boolean;
	setShowSystemEvents: (value: boolean) => void;
	eventFilters: EventFilters;
	setEventFilters: React.Dispatch<React.SetStateAction<EventFilters>>;
}

const FILTERS: Array<{ key: keyof EventFilters; label: string }> = [
	{ key: "SYSTEM", label: "System Messages & Prompts" },
	{ key: "TOOL_USE", label: "Tool Invocations" },
	{ key: "TERMINAL_OUTPUT", label: "Terminal Executions" },
	{ key: "DIFF_OUTPUT", label: "File Modifications (Diffs)" },
	{ key: "FILE_PREVIEW", label: "File Previews" },
	{ key: "ERROR", label: "Errors" },
];

export function SettingsDialog({
	showSystemEvents,
	setShowSystemEvents,
	eventFilters,
	setEventFilters,
}: SettingsDialogProps) {
	const [open, setOpen] = useState(false);
	const [newPath, setNewPath] = useState("");
	const [newProvider, setNewProvider] = useState<ProviderId>("antigravity");
	const { theme, setTheme } = useTheme();
	const trpcContext = trpc.useContext();
	const { data: directories, isLoading } = trpc.getBrains.useQuery();
	const { data: scanStats = [] } = trpc.getScanStats.useQuery(undefined, {
		refetchInterval: 15000,
	});
	const latestScan = scanStats[0];

	const addMutation = trpc.addCustomDirectory.useMutation({
		onSuccess: () => {
			setNewPath("");
			void trpcContext.getBrains.invalidate();
		},
	});

	const removeMutation = trpc.removeCustomDirectory.useMutation({
		onSuccess: () => {
			void trpcContext.getBrains.invalidate();
		},
	});

	function addDirectory(): void {
		const path = newPath.trim();
		if (!path) return;
		addMutation.mutate({ path, provider: newProvider });
	}

	return (
		<>
			<Button
				variant="ghost"
				className="w-full justify-start text-muted-foreground hover:text-foreground mb-2 px-3 py-2 h-auto font-medium"
				onClick={() => setOpen(true)}
			>
				<Settings className="w-4 h-4 mr-3" />
				Preferences
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-[620px] gap-0 p-0 overflow-hidden bg-card border-border/50">
					<div className="bg-muted/30 p-6 pb-4 border-b border-border/40">
						<DialogHeader>
							<DialogTitle className="flex items-center text-xl tracking-tight">
								<Settings className="w-5 h-5 mr-2 text-primary" />
								Settings
							</DialogTitle>
						</DialogHeader>
					</div>

					<div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
						<section>
							<h3 className="text-sm font-semibold mb-3">Conversation Rendering</h3>
							<label className="flex items-start gap-3 text-sm cursor-pointer">
								<input
									type="checkbox"
									className="mt-1"
									checked={showSystemEvents}
									onChange={(event) => setShowSystemEvents(event.target.checked)}
								/>
								<span>
									<span className="block font-medium">Show system actions</span>
									<span className="text-xs text-muted-foreground">
										Includes tool calls, terminal output, diffs, file previews, and
										errors.
									</span>
								</span>
							</label>

							{showSystemEvents && (
								<div className="pl-7 space-y-2 pt-3 mt-3 border-t border-border/30">
									{FILTERS.map((filter) => (
										<label
											key={filter.key}
											className="flex items-center gap-2 text-sm cursor-pointer"
										>
											<input
												type="checkbox"
												checked={eventFilters[filter.key]}
												onChange={(event) =>
													setEventFilters((current) => ({
														...current,
														[filter.key]: event.target.checked,
													}))
												}
											/>
											<span>{filter.label}</span>
										</label>
									))}
								</div>
							)}
						</section>

						<section className="border-t border-border/30 pt-4">
							<h3 className="text-sm font-semibold mb-3">Theme</h3>
							<div className="flex gap-2">
								{[
									{ value: "dark" as const, icon: Moon, label: "Dark" },
									{ value: "light" as const, icon: Sun, label: "Light" },
									{ value: "system" as const, icon: Monitor, label: "System" },
								].map(({ value, icon: Icon, label }) => (
									<button
										key={value}
										type="button"
										onClick={() => setTheme(value)}
										className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors border ${
											theme === value
												? "bg-primary/10 text-primary border-primary/30"
												: "bg-muted/20 text-muted-foreground border-border/40 hover:bg-muted/40"
										}`}
									>
										<Icon className="w-3.5 h-3.5" />
										{label}
									</button>
								))}
							</div>
						</section>

						<section className="border-t border-border/30 pt-4">
							<h3 className="text-sm font-semibold mb-3 flex items-center">
								<FolderGit2 className="w-4 h-4 mr-2 text-muted-foreground" />
								Tracked Directories
							</h3>
							<div className="bg-muted/10 border border-border/50 rounded-lg overflow-hidden">
								{isLoading ? (
									<div className="text-sm text-muted-foreground p-6 text-center">
										Loading directories...
									</div>
								) : (
									<div className="max-h-52 overflow-y-auto">
										{directories?.map((directory, index) => {
											const cfg = getProviderConfig(directory.provider);
											return (
												<div
													key={directory.id}
													className={`flex items-center justify-between p-3 ${
														index !== 0 ? "border-t border-border/30" : ""
													}`}
												>
													<div className="min-w-0 mr-3">
														<span className="block text-sm font-mono truncate opacity-90">
															{directory.path}
														</span>
														<span className={`text-[10px] uppercase ${cfg.textColor}`}>
															{cfg.displayName}
														</span>
													</div>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8 text-muted-foreground hover:text-destructive"
														onClick={() =>
															removeMutation.mutate({ id: directory.id })
														}
														title="Remove directory"
													>
														<Trash2 className="w-4 h-4" />
													</Button>
												</div>
											);
										})}
									</div>
								)}

								<div className="border-t border-border/50 p-3 bg-muted/20">
									<div className="flex gap-2">
										<input
											className="flex-1 h-9 rounded-md border border-input bg-background/50 px-3 py-1 text-sm"
											placeholder="Add absolute path..."
											value={newPath}
											onChange={(event) => setNewPath(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") addDirectory();
											}}
										/>
										<select
											className="h-9 w-[140px] rounded-md border border-input bg-background/50 px-3 py-1 text-sm"
											value={newProvider}
											onChange={(event) =>
												setNewProvider(event.target.value as ProviderId)
											}
										>
											{PROVIDER_IDS.map((provider) => (
												<option key={provider} value={provider}>
													{getProviderConfig(provider).displayName}
												</option>
											))}
										</select>
										<Button
											className="h-9 w-9 shrink-0"
											size="icon"
											disabled={!newPath.trim() || addMutation.isLoading}
											onClick={addDirectory}
										>
											<Plus className="w-4 h-4" />
										</Button>
									</div>
								</div>
							</div>
						</section>

						<section className="border-t border-border/30 pt-4">
							<h3 className="text-sm font-semibold mb-3 flex items-center">
								<CheckCircle2 className="w-4 h-4 mr-2 text-muted-foreground" />
								Scan Status
							</h3>
							{latestScan ? (
								<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
									<span>Last scan</span>
									<span>{String(latestScan.scanned_at ?? "unknown")}</span>
									<span>Parsed / skipped / failed</span>
									<span>
										{String(latestScan.parsed ?? 0)} /{" "}
										{String(latestScan.skipped ?? 0)} /{" "}
										{String(latestScan.failed ?? 0)}
									</span>
									<span>Duration</span>
									<span>{String(latestScan.duration_ms ?? 0)}ms</span>
								</div>
							) : (
								<p className="text-xs text-muted-foreground">No scans recorded yet.</p>
							)}
						</section>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
