import { useState } from "react";
import { Folder, FolderOpen, Check, ArrowRight, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "../trpc";
import type { ProviderId } from "@/shared/providers";

function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
	const [customPath, setCustomPath] = useState("");
	const [customProvider, setCustomProvider] = useState<ProviderId>("antigravity");
	const [isPicking, setIsPicking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: brains } = trpc.getBrains.useQuery();
	const addDirectory = trpc.addCustomDirectory.useMutation({
		onSuccess: () => {
			setCustomPath("");
		},
		onError: (err) => setError(err.message),
	});

	async function handlePickFolder() {
		if (!isTauri()) {
			setError("File picker is only available in the desktop app.");
			return;
		}

		setIsPicking(true);
		setError(null);
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				directory: true,
				multiple: false,
				title: "Select a conversation log directory",
			});
			if (selected && typeof selected === "string") {
				setCustomPath(selected);
			}
		} catch (e) {
			setError(String(e));
		} finally {
			setIsPicking(false);
		}
	}

	function handleAddCustom() {
		if (!customPath.trim()) return;
		setError(null);
		addDirectory.mutate({
			path: customPath.trim(),
			provider: customProvider,
		});
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-xl space-y-8">
				<div className="text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
						<Brain className="h-8 w-8 text-primary" />
					</div>
					<h1 className="text-3xl font-bold tracking-tight">
						AI Conversations Explorer
					</h1>
					<p className="mt-2 text-muted-foreground">
						Let’s find your conversation logs so you can explore them.
					</p>
				</div>

				<div className="rounded-xl border bg-card p-6 shadow-sm">
					<h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
						<Folder className="h-5 w-5" />
						Monitored directories
					</h2>

					{!brains || brains.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No directories configured yet.
						</p>
					) : (
						<ul className="space-y-2">
							{brains.map((brain) => (
								<li
									key={brain.id}
									className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
								>
									<div className="min-w-0">
										<p className="truncate font-mono text-muted-foreground">
											{brain.path}
										</p>
										<p className="text-xs capitalize text-muted-foreground/70">
											{brain.provider}
										</p>
									</div>
									<span className="flex items-center gap-1 text-xs font-medium text-green-600">
										<Check className="h-3.5 w-3.5" />
										Configured
									</span>
								</li>
							))}
						</ul>
					)}

					<p className="mt-3 text-xs text-muted-foreground">
						Default log locations are monitored automatically. Add a custom
						directory below if your logs live elsewhere.
					</p>
				</div>

				<div className="rounded-xl border bg-card p-6 shadow-sm">
					<h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
						<FolderOpen className="h-5 w-5" />
						Add a custom directory
					</h2>

					<div className="space-y-3">
						<div className="flex gap-2">
							<input
								type="text"
								value={customPath}
								onChange={(e) => setCustomPath(e.target.value)}
								placeholder="/path/to/your/logs"
								className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
							/>
							{isTauri() && (
								<Button
									type="button"
									variant="outline"
									onClick={handlePickFolder}
									disabled={isPicking}
								>
									Browse
								</Button>
							)}
						</div>

						<div className="flex items-center gap-2">
							<label className="text-sm text-muted-foreground">Provider:</label>
							<select
								value={customProvider}
								onChange={(e) => setCustomProvider(e.target.value as ProviderId)}
								className="rounded-md border bg-background px-2 py-1 text-sm"
							>
								<option value="antigravity">Antigravity</option>
								<option value="codex">Codex</option>
								<option value="gemini-cli">Gemini CLI</option>
								<option value="claude-code">Claude Code</option>
							</select>
							<Button
								type="button"
								onClick={handleAddCustom}
								disabled={!customPath.trim() || addDirectory.isLoading}
							>
								Add
							</Button>
						</div>

						{error && <p className="text-sm text-red-500">{error}</p>}
					</div>
				</div>

				<div className="flex justify-end">
					<Button size="lg" onClick={onComplete}>
						Open Explorer
						<ArrowRight className="ml-2 h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
