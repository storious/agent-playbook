import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { agulaterVersion } from "./lib/version.ts";

describe("standalone installer contract", () => {
  test("selects this platform's release archive and schedules user setup", () => {
    const windows = process.platform === "win32";
    const command = windows ? "pwsh" : "sh";
    const script = resolve("scripts", windows ? "install.ps1" : "install.sh");
    const args = windows
      ? ["-NoProfile", "-File", script, "-Version", agulaterVersion, "-DryRun"]
      : [script, "--version", agulaterVersion, "--dry-run"];
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, windowsHide: true });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const platform = windows
      ? "windows-x64.zip"
      : process.platform === "darwin" && process.arch === "arm64"
        ? "macos-arm64.tar.gz"
        : process.platform === "darwin"
          ? "macos-x64.tar.gz"
          : "linux-x64.tar.gz";
    expect(result.stdout).toContain(`agulater-v${agulaterVersion}-${platform}`);
    expect(result.stdout).toContain("agulater setup user --if-missing");
    expect(result.stdout).toContain("PATH: add");
  });
});
