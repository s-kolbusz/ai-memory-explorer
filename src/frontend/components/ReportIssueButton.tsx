import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "../trpc";

const REPO_URL = "https://github.com/aimemory/explorer/issues/new";

interface ReportIssueButtonProps {
	error?: Error | null;
}

function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatLatestScan(scan: Record<string, unknown> | undefined): string[] {
	if (!scan) return ["- Last scan: unavailable"];
	return [
		`- Last scan: ${String(scan.scanned_at ?? "unknown")}`,
		`- Parsed/skipped/failed: ${String(scan.parsed ?? 0)} / ${String(scan.skipped ?? 0)} / ${String(scan.failed ?? 0)}`,
		`- Fallback used: ${String(scan.fallback_used ?? 0)}`,
		`- Duration ms: ${String(scan.duration_ms ?? 0)}`,
	];
}

function buildIssueUrl(
	error: Error | null,
	latestScan: Record<string, unknown> | undefined,
): string {
	const title = error
		? `[Bug] ${error.message.slice(0, 80)}`
		: "[Bug] Report an issue";
	const body = [
		"## Description",
		"",
		"<!-- Describe the issue. Do not paste conversation contents unless you intentionally want to share them. -->",
		"",
		"## Environment",
		"",
		`- App version: ${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown"}`,
		`- Platform: ${typeof navigator !== "undefined" ? navigator.platform : "unknown"}`,
		`- User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
		"",
		"## Scan Summary",
		"",
		...formatLatestScan(latestScan),
		"",
		error ? "## Error" : "",
		error ? "" : "",
		error ? `\`\`\`\n${error.stack ?? error.message}\n\`\`\`` : "",
		"",
		"## Steps to reproduce",
		"",
		"<!-- List steps to reproduce. -->",
	].join("\n");

	const params = new URLSearchParams({ title, body });
	return `${REPO_URL}?${params.toString()}`;
}

export function ReportIssueButton({ error = null }: ReportIssueButtonProps) {
	const [opening, setOpening] = useState(false);
	const { data: scanStats = [] } = trpc.getScanStats.useQuery(undefined, {
		staleTime: 10000,
	});

	async function handleClick(): Promise<void> {
		setOpening(true);
		try {
			const url = buildIssueUrl(error, scanStats[0]);
			if (isTauri()) {
				const { open } = await import("@tauri-apps/plugin-shell");
				await open(url);
			} else {
				window.open(url, "_blank", "noopener,noreferrer");
			}
		} finally {
			setOpening(false);
		}
	}

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={handleClick}
			disabled={opening}
			className="gap-1.5"
		>
			<Bug className="h-4 w-4" />
			Report Issue
		</Button>
	);
}
