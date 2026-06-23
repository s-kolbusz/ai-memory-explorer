import { mkdir, rm } from "node:fs/promises";
import { arch } from "node:os";
import { join } from "node:path";

interface PackageJson {
	version?: string;
}

interface TauriConfig {
	productName?: string;
	version?: string;
}

const packageJson = (await Bun.file("package.json").json()) as PackageJson;
const tauriConfig = (await Bun.file("src-tauri/tauri.conf.json").json()) as TauriConfig;

const productName = tauriConfig.productName ?? "AI Conversations Explorer";
const version = tauriConfig.version ?? packageJson.version ?? "0.0.0";
const targetTriple = process.env.TAURI_TARGET?.trim();
const archLabel =
	targetTriple?.includes("x86_64") || arch() === "x64" ? "x64" : "aarch64";
const releaseDir = targetTriple
	? join("src-tauri", "target", targetTriple, "release")
	: join("src-tauri", "target", "release");

const appPath = join(
	releaseDir,
	"bundle",
	"macos",
	`${productName}.app`,
);
const dmgDir = join(releaseDir, "bundle", "dmg");
const dmgPath = join(dmgDir, `${productName}_${version}_${archLabel}.dmg`);

await mkdir(dmgDir, { recursive: true });
await rm(dmgPath, { force: true });

await Bun.$`hdiutil create -volname ${productName} -srcfolder ${appPath} -ov -format UDZO ${dmgPath}`;

console.log(`DMG ready: ${dmgPath}`);
