import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform as hostPlatform } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";

export const pathRegistrationFormat = "agulater/path-registration/v1" as const;

export type PathRegistration = {
  format: typeof pathRegistrationFormat;
  directory: string;
  target: "windows-user" | "profile";
  managed: boolean;
  profile?: string;
};

type SpawnResult = {
  exitCode: number;
  stdout: { toString(): string };
  stderr: { toString(): string };
};

export type PathEnvironmentOptions = {
  home?: string;
  platform?: NodeJS.Platform;
  shell?: string;
  spawn?: (command: string[], options: { env: NodeJS.ProcessEnv; stdout: "pipe"; stderr: "pipe" }) => SpawnResult;
};

export function pathIsReady(directory: string, path = process.env.PATH ?? ""): boolean {
  const wanted = normalizedPath(directory);
  return path.split(delimiter).filter(Boolean).some((entry) => normalizedPath(entry) === wanted);
}

export function ensureUserPath(directory: string, options: PathEnvironmentOptions = {}): PathRegistration {
  const path = resolve(directory);
  assertPathEntry(path);
  const platform = options.platform ?? hostPlatform();
  const registration = platform === "win32"
    ? changeWindowsUserPath(path, "add", options)
    : addProfilePath(path, options);
  if (!pathIsReady(path)) process.env.PATH = `${process.env.PATH ?? ""}${delimiter}${path}`;
  return registration;
}

export function removeUserPath(registration: PathRegistration, options: PathEnvironmentOptions = {}): boolean {
  if (!registration.managed) return false;
  const changed = registration.target === "windows-user"
    ? changeWindowsUserPath(registration.directory, "remove", options).managed
    : removeProfilePath(registration);
  process.env.PATH = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => normalizedPath(entry) !== normalizedPath(registration.directory))
    .join(delimiter);
  return changed;
}

function changeWindowsUserPath(
  directory: string,
  action: "add" | "remove",
  options: PathEnvironmentOptions,
): PathRegistration {
  const executable = Bun.which("pwsh.exe") ?? Bun.which("powershell.exe") ?? "powershell.exe";
  const script = [
    "$entry=$env:AGULATER_PATH_ENTRY",
    "$current=[Environment]::GetEnvironmentVariable('Path','User')",
    "$parts=@($current -split ';' | Where-Object { $_ })",
    "$match=@($parts | Where-Object { $_.TrimEnd('\\') -ieq $entry.TrimEnd('\\') })",
    action === "add"
      ? "if($match.Count -eq 0){[Environment]::SetEnvironmentVariable('Path',(@($parts)+$entry)-join ';','User');'changed'}else{'unchanged'}"
      : "if($match.Count -gt 0){$next=(@($parts | Where-Object { $_.TrimEnd('\\') -ine $entry.TrimEnd('\\') }) -join ';');[Environment]::SetEnvironmentVariable('Path',$next,'User');'changed'}else{'unchanged'}",
  ].join(";");
  const spawn = options.spawn ?? ((command, spawnOptions) => Bun.spawnSync(command, spawnOptions));
  const result = spawn(
    [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, AGULATER_PATH_ENTRY: directory }, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || `exit code ${result.exitCode}`;
    throw new Error(`cannot ${action} ${directory} ${action === "add" ? "to" : "from"} the user PATH: ${message}`);
  }
  return {
    format: pathRegistrationFormat,
    directory,
    target: "windows-user",
    managed: result.stdout.toString().trim().split(/\r?\n/).at(-1) === "changed",
  };
}

function addProfilePath(directory: string, options: PathEnvironmentOptions): PathRegistration {
  const home = resolve(options.home ?? homedir());
  const shell = basename(options.shell ?? process.env.SHELL ?? "");
  const profile = join(home, shell === "zsh" ? ".zshrc" : shell === "bash" ? ".bashrc" : ".profile");
  const block = profileBlock(directory);
  const current = existsSync(profile) ? readFileSync(profile, "utf8") : "";
  const managed = !current.includes(block);
  if (managed) {
    const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    writeFileSync(profile, `${current}${separator}${block}`, "utf8");
  }
  return { format: pathRegistrationFormat, directory, target: "profile", managed, profile };
}

function removeProfilePath(registration: PathRegistration): boolean {
  const profile = registration.profile;
  if (!profile || !existsSync(profile)) return false;
  const block = profileBlock(registration.directory);
  const current = readFileSync(profile, "utf8");
  if (!current.includes(block)) return false;
  writeFileSync(profile, current.replace(block, "").replace(/^\n|\n{3,}/g, "\n\n"), "utf8");
  return true;
}

function profileBlock(directory: string): string {
  const marker = Buffer.from(resolve(directory)).toString("base64url");
  const quoted = directory.replaceAll("'", `'"'"'`);
  return `# >>> agulater PATH ${marker} >>>\nexport PATH='${quoted}':"$PATH"\n# <<< agulater PATH ${marker} <<<\n`;
}

function normalizedPath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertPathEntry(path: string): void {
  if (path.includes("\0") || path.includes("\n") || path.includes("\r")) throw new Error("PATH directory contains unsupported characters");
}
