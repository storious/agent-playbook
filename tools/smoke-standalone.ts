import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agulaterVersion } from "./lib/version.ts";

const executable = resolve(Bun.argv[2] ?? join("dist", process.platform === "win32" ? "agulater.exe" : "agulater"));

if (!existsSync(executable)) throw new Error(`standalone executable is missing: ${executable}`);

const home = mkdtempSync(join(tmpdir(), "agulater-standalone-smoke-"));
const emptyPath = join(home, "empty-path");
mkdirSync(emptyPath);
const standaloneEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
);
standaloneEnvironment.PATH = emptyPath;
try {
  expectOutput(["--version"], `agulater ${agulaterVersion}`);
  expectOutput(["--help"], "Install Agul, manage extensions, and prepare .agents packages.");
  expectOutput(["runtime", "install", "--help"], "default: stable on first install");
  expectOutput(["catalog", "search", "--help"], "Catalogs without a local cache are refreshed");
  expectOutput(["setup", "user", "--if-missing", "--home", home], "created");

  const packagePath = join(home, ".agents", "package.json");
  const launchPath = join(home, ".agents", "runtime", "launch.json");
  if (!existsSync(packagePath) || !existsSync(launchPath)) {
    throw new Error("standalone setup did not create the user package and launch configuration");
  }
  const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { format?: string };
  if (manifest.format !== "agulater/package/v2") {
    throw new Error(`standalone setup wrote an unexpected package format: ${String(manifest.format)}`);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

function expectOutput(args: string[], expected: string): void {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: standaloneEnvironment,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
  }
  if (!result.stdout.includes(expected)) {
    throw new Error(`${args.join(" ")} did not include ${JSON.stringify(expected)}: ${result.stdout.trim()}`);
  }
}
