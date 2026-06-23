import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
	plugins: [tailwindcss(), react()],
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version),
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/trpc": {
				target: "http://localhost:3333",
				changeOrigin: true,
			},
		},
	},
});
