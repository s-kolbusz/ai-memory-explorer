import { cors } from "@elysiajs/cors";
import { trpc } from "@elysiajs/trpc";
import { initTRPC } from "@trpc/server";
import { Elysia } from "elysia";
import { statSync } from "fs";
import { basename } from "path";
import { z } from "zod";
import { getAdapter } from "./adapters/index";
import {
	addCustomDirectory,
	getAllDirectories,
	getConversationById,
	getConversations,
	getConversationsPaginated,
	getProjects,
	getProviders,
	getScanHistory,
	initDefaultDirectories,
	removeCustomDirectory,
	searchConversationsFts5,
} from "./db";
import { runScan, startPeriodicScanner } from "./scanner";
import { normalizeProviderId, PROVIDER_IDS } from "../shared/providers";

const t = initTRPC.create();
const providerSchema = z.enum(PROVIDER_IDS);

initDefaultDirectories();
startPeriodicScanner(Number(process.env.SCAN_INTERVAL_MS ?? 60000));

const router = t.router({
	getBrains: t.procedure.query(() => {
		return getAllDirectories().map((directory) => ({
			id: directory.id,
			name: basename(directory.path) || String(directory.path),
			path: directory.path,
			provider: normalizeProviderId(directory.provider),
		}));
	}),

	addCustomDirectory: t.procedure
		.input(z.object({ path: z.string().min(1), provider: providerSchema }))
		.mutation(({ input }) => {
			addCustomDirectory(input.path, input.provider);
			void runScan();
			return true;
		}),

	removeCustomDirectory: t.procedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => {
			removeCustomDirectory(input.id);
			return true;
		}),

	getProviders: t.procedure.query(() => {
		return getProviders().filter(Boolean).sort();
	}),

	getProjects: t.procedure
		.input(z.object({ provider: providerSchema.nullable().optional() }).optional())
		.query(({ input }) => {
			return getProjects(input?.provider ?? null);
		}),

	getConversationsPaginated: t.procedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(50),
				cursor: z.string().optional(),
				directoryId: z.string().optional(),
				provider: providerSchema.optional(),
				hasError: z.boolean().optional(),
				dateFrom: z.string().optional(),
				dateTo: z.string().optional(),
			}),
		)
		.query(({ input }) => {
			return getConversationsPaginated(input);
		}),

	getConversationsByProject: t.procedure
		.input(z.object({ project: z.string() }))
		.query(({ input }) => {
			const conversations = getConversations();
			if (input.project === "All") return conversations;

			return conversations.filter((conversation) => {
				let project = conversation.project || "Unknown";
				if (/^[0-9a-fA-F-]{36}$/.test(project) || /^[0-9a-fA-F]{64}$/.test(project)) {
					project = "Unknown";
				}
				project = project.replace(/["']$/g, "");
				return project === input.project;
			});
		}),

	getConversation: t.procedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => getConversationById(input.id)),

	getTranscript: t.procedure
		.input(z.object({ logPath: z.string(), provider: providerSchema.optional() }))
		.query(async ({ input }) => {
			try {
				statSync(input.logPath);
				const providerName = input.provider ?? "antigravity";
				const adapter = getAdapter(providerName);
				const context = {
					filePath: input.logPath,
					directoryPath: "",
					directoryId: "",
					provider: providerName,
				};
				const sessionId = basename(input.logPath).replace(/\.jsonl$/, "") || "unknown";
				return await adapter.getTranscript(sessionId, context);
			} catch {
				return [];
			}
		}),

	searchConversations: t.procedure
		.input(z.object({ query: z.string() }))
		.query(({ input }) => {
			if (!input.query.trim()) return [];
			return searchConversationsFts5(input.query);
		}),

	getScanStats: t.procedure.query(() => getScanHistory(10)),
});

export type AppRouter = typeof router;

const app = new Elysia().use(cors()).use(trpc(router)).listen(3333);

console.log(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
