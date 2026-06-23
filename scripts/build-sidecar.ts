import { execSync } from "node:child_process";
import { platform, arch } from "node:os";
import { mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Build the Bun backend executable and copy it into src-tauri/binaries/
 * with the target-triple filename that Tauri expects for an externalBin sidecar.
 */

const TAURI_TARGET = process.env.TAURI_TARGET?.trim();

const bunTargetMap: Record<string, string> = {
	"aarch64-apple-darwin": "bun-darwin-arm64",
	"x86_64-apple-darwin": "bun-darwin-x64",
	"x86_64-unknown-linux-gnu": "bun-linux-x64",
	"x86_64-pc-windows-msvc": "bun-windows-x64",
};

function getTargetTriple(): string {
	if (TAURI_TARGET) return TAURI_TARGET;

	const p = platform();
	const a = arch();

	if (p === "darwin") {
		return a === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
	}
	if (p === "linux") return "x86_64-unknown-linux-gnu";
	if (p === "win32") return "x86_64-pc-windows-msvc";

	throw new Error(`Unsupported platform: ${p}`);
}

function getBunTarget(targetTriple: string): string {
	const bunTarget = bunTargetMap[targetTriple];
	if (!bunTarget) {
		throw new Error(`Unsupported target triple: ${targetTriple}`);
	}
	return bunTarget;
}

function main() {
	const targetTriple = getTargetTriple();
	const bunTarget = getBunTarget(targetTriple);
	const isWindows = platform() === "win32";
	const binaryName = isWindows ? "server.exe" : "server";
	const sidecarName = `server-${targetTriple}${isWindows ? ".exe" : ""}`;

	console.log(`🔧 Building sidecar for ${targetTriple} (${bunTarget})...`);

	const outDir = join(import.meta.dir, "..", "dist");
	const binariesDir = join(import.meta.dir, "..", "src-tauri", "binaries");

	mkdirSync(outDir, { recursive: true });
	mkdirSync(binariesDir, { recursive: true });

	const compileCmd = [
		"bun",
		"build",
		"src/backend/index.ts",
		"--compile",
		`--target=${bunTarget}`,
		`--outfile=${join(outDir, binaryName)}`,
	].join(" ");

	execSync(compileCmd, { stdio: "inherit" });

	const source = join(outDir, binaryName);
	const dest = join(binariesDir, sidecarName);

	if (!existsSync(source)) {
		throw new Error(`Compiled binary not found at ${source}`);
	}

	if (existsSync(dest)) rmSync(dest);
	cpSync(source, dest);

	console.log(`✅ Sidecar ready: ${dest}`);
}

main();
