import type { inferProcedureOutput } from "@trpc/server";
import type { ProviderId } from "@/shared/providers";
import type { AppRouter } from "../shared/trpc";

export type Directory = inferProcedureOutput<AppRouter["getBrains"]>[number];
export type PaginatedConversations = inferProcedureOutput<
	AppRouter["getConversationsPaginated"]
>;
export type ConversationItem = PaginatedConversations["items"][number];
export type Step = NonNullable<
	inferProcedureOutput<AppRouter["getTranscript"]>
>[number];
export type SearchResult =
	inferProcedureOutput<AppRouter["searchConversations"]>[number];

export interface EventFilters {
	SYSTEM: boolean;
	TOOL_USE: boolean;
	FILE_PREVIEW: boolean;
	DIFF_OUTPUT: boolean;
	TERMINAL_OUTPUT: boolean;
	ERROR: boolean;
}

export type ProviderName = ProviderId;
export type { AppRouter };
