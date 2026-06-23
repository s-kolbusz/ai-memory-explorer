import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./trpc";
import { ThemeProvider } from "./theme";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

function RootApp() {
	const [queryClient] = useState(() => new QueryClient());
	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [
				httpBatchLink({
					url: "http://localhost:3333/trpc",
				}),
			],
		}),
	);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<ErrorBoundary>
						<App />
					</ErrorBoundary>
				</ThemeProvider>
			</QueryClientProvider>
		</trpc.Provider>
	);
}

root.render(<RootApp />);
