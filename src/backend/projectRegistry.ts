import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export class ProjectRegistry {
	private registry: Record<string, string> = {};

	constructor() {
		this.load();
	}

	private load(): void {
		try {
			const projDir = join(homedir(), ".gemini", "config", "projects");
			if (statSync(projDir).isDirectory()) {
				const files = readdirSync(projDir).filter((f) => f.endsWith(".json"));
				for (const file of files) {
					try {
						const data = JSON.parse(readFileSync(join(projDir, file), "utf8"));
						if (data.name && data.projectResources?.resources) {
							for (const res of data.projectResources.resources) {
								if (res.gitFolder?.folderUri) {
									const cleanUri = res.gitFolder.folderUri.replace(
										/^file:\/\//,
										"",
									);
									// Normalize to forward slashes for cross-platform comparison
									this.registry[cleanUri.replace(/\\/g, "/")] = data.name;
								}
							}
						}
					} catch {
						// skip malformed project config files
					}
				}
			}
		} catch {
			// directory doesn't exist yet
		}
	}

	/** Get project name for a given directory path. */
	lookup(cwd: string): string | undefined {
		const normalizedCwd = cwd.replace(/\\/g, "/");
		for (const [uri, name] of Object.entries(this.registry)) {
			if (normalizedCwd.startsWith(uri)) {
				return name;
			}
		}
		return undefined;
	}

	/** Infer project name from a CWD path. */
	inferFromPath(cwd: string): string {
		// First try registered projects
		const registered = this.lookup(cwd);
		if (registered) return registered;

		// Split by both / and \ to handle any platform
		const parts = cwd.split(/[/\\]/);

		// Fall back to the deepest meaningful directory name
		const projIdx = parts.indexOf("Projects");
		if (projIdx !== -1 && projIdx + 1 < parts.length) {
			return parts[projIdx + 1]!;
		}

		// Last resort: grab the last non-empty segment
		return parts.filter(Boolean).pop() || "Unknown";
	}
}

/** Singleton for use across the app. */
export const projectRegistry = new ProjectRegistry();
