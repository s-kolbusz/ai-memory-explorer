import { join } from "path";
import { homedir } from "os";
import type { ConversationMeta, UnifiedStep, ScanContext } from "../types";
import { AntigravityAdapter } from "../antigravity/index";

export class ClaudeCodeAdapter extends AntigravityAdapter {
	override get displayName(): string {
		return "Claude Code";
	}
	override get providerId(): string {
		return "claude-code";
	}

	/** Claude Code stores sessions in ~/.claude/sessions/<session-id>/transcript.jsonl */
	override resolveTranscriptPath(
		_directoryPath: string,
		sessionId: string,
	): string {
		return join(
			homedir(),
			".claude",
			"sessions",
			sessionId,
			"transcript.jsonl",
		);
	}

	override async getMetadata(
		sessionId: string,
		context: ScanContext,
	): Promise<ConversationMeta | null> {
		const filePath =
			context.filePath ||
			this.resolveTranscriptPath(context.directoryPath, sessionId);

		const steps: UnifiedStep[] = [];
		await this.streamLines(filePath, (line, _index) => {
			if (steps.length >= 100) return;
			try {
				const obj = JSON.parse(line);
				steps.push(this.parseLine(obj, steps.length));
			} catch {
				// skip
			}
		});

		if (steps.length === 0) return null;

		const meta = this.buildMetadata(steps, sessionId, context);
		if (meta) {
			meta.provider = this.providerId;
		}
		return meta;
	}

	override async getTranscript(
		sessionId: string,
		context: ScanContext,
	): Promise<UnifiedStep[]> {
		return super.getTranscript(sessionId, context);
	}
}
