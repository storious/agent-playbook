import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform as hostPlatform, arch as hostArch, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { compareSemVer } from "./semver.ts";
import {
  ensureUserPath,
  pathIsReady,
  pathRegistrationFormat,
  removeUserPath,
  type PathRegistration,
} from "./path-environment.ts";

export const runtimeReleaseFormat = "agulater/runtime-releases/v1" as const;
export const runtimeInstallFormat = "agulater/runtime-install/v1" as const;
export const runtimePlatforms = ["windows-x64", "linux-x64", "macos-x64", "macos-arm64"] as const;

export type RuntimePlatform = (typeof runtimePlatforms)[number];
export type RuntimeChannel = "stable" | "next";

type ReleaseAsset = { path?: string; url?: string; executable?: string };
type RuntimeRelease = {
  version: string;
  channel: RuntimeChannel;
  assets: Partial<Record<RuntimePlatform, ReleaseAsset>>;
};

type GitHubCommandResult = {
  exitCode: number;
  stdout: { toString(): string };
  stderr: { toString(): string };
};

type GitHubJsonResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type GitHubReleaseDependencies = {
  githubCli?: string | null;
  spawn?: (command: string[]) => GitHubCommandResult;
  fetch?: (url: string) => Promise<GitHubJsonResponse>;
};

export type ResolvedGitHubRelease = {
  version: string;
  tagName: string;
  assetName: string;
  downloadUrl?: string;
  githubCli?: string;
};

export type RuntimeInstallRecord = {
  format: typeof runtimeInstallFormat;
  version: string;
  channel: RuntimeChannel;
  platform: RuntimePlatform;
  executable: string;
  shim: string;
  repository?: string;
  url?: string;
  environment?: PathRegistration;
};

export type RuntimeOptions = {
  channel?: RuntimeChannel;
  prefix?: string;
  repository?: string;
  url?: string;
  home?: string;
  modifyPath?: boolean;
};

export type RuntimeResult = RuntimeInstallRecord & {
  prefix: string;
  installed: boolean;
  pathReady: boolean;
  reason?: string;
};

export type RuntimeUninstallResult = {
  format: "agulater/runtime-uninstall/v1";
  prefix: string;
  removed: boolean;
  version?: string;
  shim?: string;
  pathRemoved: boolean;
};

const defaultRepository = "storious/agul";
const runtimeVerificationTimeoutMs = 30_000;
const runtimeLockStaleMs = 300_000;
const runtimeLockUpdateMs = 10_000;

export async function installRuntime(options: RuntimeOptions = {}): Promise<RuntimeResult> {
  return installRuntimeAtLeast(options);
}

async function installRuntimeAtLeast(
  options: RuntimeOptions,
  minimumVersion?: string,
  baseline?: RuntimeInstallRecord,
): Promise<RuntimeResult> {
  const prefix = resolve(options.prefix ?? defaultRuntimePrefix(options.home));
  const current = baseline ?? readInstallRecord(prefix);
  const channel = options.channel ?? current?.channel ?? "stable";
  const rawUrl = options.url ?? (!options.repository ? current?.url : undefined);
  const url = rawUrl ? localSource(rawUrl) ?? rawUrl : undefined;
  const repository = options.repository ?? (!url ? current?.repository ?? defaultRepository : undefined);
  const platform = runtimePlatform();
  const selected = url
    ? await releaseFromIndex(url, channel)
    : await releaseFromGitHub(repository!, channel, platform);
  if (minimumVersion && compareVersions(selected.release.version, minimumVersion) < 0) {
    throw new Error(`refusing to downgrade Agul from ${minimumVersion} to ${selected.release.version} on ${channel}`);
  }
  const temporary = mkdtempSync(join(tmpdir(), "agulater-runtime-"));
  try {
    const source = await acquireAsset(selected.release, platform, selected.base, selected.download, temporary);
    const executableName = selected.release.assets[platform]?.executable
      ?? (platform === "windows-x64" ? "agul.exe" : "agul");
    const unpacked = unpackAsset(source, executableName, temporary);
    mkdirSync(prefix, { recursive: true });
    const release = await acquireRuntimeLock(prefix);
    try {
      const active = readInstallRecord(prefix);
      if (!sameInstallRecord(current, active)) {
        throw new Error(`Agul runtime changed at ${prefix} while the release was prepared; retry the command`);
      }
      if (active?.channel === channel && compareVersions(selected.release.version, active.version) < 0) {
        throw new Error(`refusing to downgrade Agul from ${active.version} to ${selected.release.version} on ${channel}`);
      }
      const versionRoot = join(prefix, "versions", selected.release.version);
      const destination = join(versionRoot, basename(unpacked));
      mkdirSync(versionRoot, { recursive: true });
      let reusable = false;
      if (existsSync(destination)) {
        try {
          verifyRuntime(destination, selected.release.version);
          reusable = true;
        } catch {
          reusable = false;
        }
      }
      if (!reusable) installExecutable(unpacked, destination, platform, selected.release.version);
      const bin = shimDirectory(prefix, options.home, platform);
      const shim = runtimeShimPath(bin, platform);
      const record: RuntimeInstallRecord = {
        format: runtimeInstallFormat,
        version: selected.release.version,
        channel,
        platform,
        executable: destination,
        shim,
        ...(url ? { url } : { repository: repository! }),
      };
      let addedEnvironment: PathRegistration | undefined;
      if (options.modifyPath ?? options.prefix === undefined) {
        const registration = ensureUserPath(bin, { home: options.home });
        if (registration.managed) addedEnvironment = registration;
        record.environment = active?.environment?.directory === registration.directory && active.environment.managed
          ? { ...registration, managed: true }
          : registration;
      } else if (active?.environment) {
        record.environment = active.environment;
      }
      try {
        commitRuntimeActivation(prefix, record);
      } catch (error) {
        if (addedEnvironment) {
          try {
            removeUserPath(addedEnvironment, { home: options.home });
          } catch (rollbackError) {
            throw new Error(`${errorMessage(error)}; PATH rollback failed: ${errorMessage(rollbackError)}`);
          }
        }
        throw error;
      }
      return { ...record, prefix, installed: true, pathReady: pathIsReady(bin) };
    } finally {
      await releaseRuntimeLock(release);
    }
  } finally {
    removeTemporaryRuntime(temporary);
  }
}

export async function updateRuntime(options: RuntimeOptions = {}): Promise<RuntimeResult> {
  const prefix = resolve(options.prefix ?? defaultRuntimePrefix(options.home));
  const current = readInstallRecord(prefix);
  if (!current) throw new Error(`Agul is not managed at ${prefix}; run agulater runtime install first`);
  const source = options.url
    ? { url: options.url }
    : options.repository
      ? { repository: options.repository }
      : current.url
        ? { url: current.url }
        : { repository: current.repository ?? defaultRepository };
  const channel = options.channel ?? current.channel;
  const minimumVersion = channel === current.channel ? current.version : undefined;
  const modifyPath = options.modifyPath ?? options.prefix === undefined;
  return installRuntimeAtLeast({ ...options, ...source, prefix, channel, modifyPath }, minimumVersion, current);
}

export async function uninstallRuntime(
  options: Pick<RuntimeOptions, "prefix" | "home"> & { keepPath?: boolean } = {},
): Promise<RuntimeUninstallResult> {
  const prefix = resolve(options.prefix ?? defaultRuntimePrefix(options.home));
  const current = readInstallRecord(prefix);
  if (!current) {
    return { format: "agulater/runtime-uninstall/v1", prefix, removed: false, pathRemoved: false };
  }
  const release = await acquireRuntimeLock(prefix);
  try {
    const active = readInstallRecord(prefix);
    if (!sameInstallRecord(current, active)) throw new Error(`Agul runtime changed at ${prefix}; retry the command`);
    if (resolve(current.shim).startsWith(`${prefix}${process.platform === "win32" ? "\\" : "/"}`)) {
      rmSync(prefix, { recursive: true, force: true });
    } else {
      rmSync(current.shim, { force: true });
      rmSync(prefix, { recursive: true, force: true });
    }
    const pathRemoved = !options.keepPath && current.environment
      ? removeUserPath(current.environment, { home: options.home })
      : false;
    return {
      format: "agulater/runtime-uninstall/v1",
      prefix,
      removed: true,
      version: current.version,
      shim: current.shim,
      pathRemoved,
    };
  } finally {
    await releaseRuntimeLock(release);
  }
}

export function runtimeStatus(options: Pick<RuntimeOptions, "prefix" | "home"> = {}): RuntimeResult | {
  format: typeof runtimeInstallFormat;
  prefix: string;
  installed: false;
  pathReady?: boolean;
  reason?: string;
} {
  const prefix = resolve(options.prefix ?? defaultRuntimePrefix(options.home));
  const record = readInstallRecord(prefix);
  if (!record) return { format: runtimeInstallFormat, prefix, installed: false };
  const shadow = windowsShadowExecutable(record);
  if (shadow && existsSync(shadow)) {
    return {
      ...record,
      prefix,
      installed: false,
      pathReady: pathIsReady(dirname(record.shim)),
      reason: `legacy Agul executable shadows the managed launcher: ${shadow}`,
    };
  }
  if (!existsSync(record.executable)) return { ...record, prefix, installed: false, pathReady: pathIsReady(dirname(record.shim)), reason: "managed executable is missing" };
  if (!existsSync(record.shim)) return { ...record, prefix, installed: false, pathReady: pathIsReady(dirname(record.shim)), reason: "launcher is missing" };
  try {
    verifyRuntime(record.executable, record.version);
    verifyRuntime(record.shim, record.version);
  } catch (error) {
    return { ...record, prefix, installed: false, pathReady: pathIsReady(dirname(record.shim)), reason: error instanceof Error ? error.message : String(error) };
  }
  return { ...record, prefix, installed: true, pathReady: pathIsReady(dirname(record.shim)) };
}

export function defaultRuntimePrefix(home = homedir()): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || resolve(home, "AppData", "Local"), "Programs", "Agul");
  }
  return join(resolve(home), ".local", "share", "agul");
}

export function runtimePlatform(platform = hostPlatform(), architecture = hostArch()): RuntimePlatform {
  if (platform === "win32" && architecture === "x64") return "windows-x64";
  if (platform === "linux" && architecture === "x64") return "linux-x64";
  if (platform === "darwin" && architecture === "x64") return "macos-x64";
  if (platform === "darwin" && architecture === "arm64") return "macos-arm64";
  throw new Error(`Agul has no release for ${platform}-${architecture}`);
}

async function releaseFromIndex(
  source: string,
  channel: RuntimeChannel,
): Promise<{ release: RuntimeRelease; base: string; download?: undefined }> {
  const location = localSource(source);
  const text = location
    ? readFileSync(location, "utf8")
    : await fetchText(source, "runtime release index");
  const value: unknown = JSON.parse(text);
  const index = strictRecord(value, "runtime release index", ["format", "releases"], ["format", "releases"]);
  if (index.format !== runtimeReleaseFormat) throw new Error(`runtime release index must use ${runtimeReleaseFormat}`);
  if (!Array.isArray(index.releases)) throw new Error("runtime release index.releases must be an array");
  const releases = index.releases.map((entry, itemIndex) => parseRelease(entry, `releases[${itemIndex}]`));
  const release = releases
    .filter((entry) => entry.channel === channel)
    .sort((left, right) => compareVersions(left.version, right.version))
    .at(-1);
  if (!release) throw new Error(`runtime release index has no ${channel} release`);
  return { release, base: location ? dirname(location) : new URL(".", source).href };
}

async function releaseFromGitHub(
  repository: string,
  channel: RuntimeChannel,
  platform: RuntimePlatform,
): Promise<{ release: RuntimeRelease; base: string; download: (asset: string, destination: string) => Promise<void> }> {
  const selected = await resolveGitHubRelease(repository, channel, platform);
  const release = githubRelease(selected.version, channel);
  return {
    release,
    base: `https://github.com/${repository}/releases/download/${selected.tagName}/`,
    download: selected.githubCli
      ? async (asset, destination) => {
        const downloaded = Bun.spawnSync([
          selected.githubCli!,
          "release",
          "download",
          selected.tagName,
          "--repo",
          repository,
          "--pattern",
          asset,
          "--dir",
          dirname(destination),
          "--clobber",
        ], { stdout: "pipe", stderr: "pipe" });
        if (downloaded.exitCode !== 0) throw new Error(`cannot download ${asset}: ${downloaded.stderr.toString().trim()}`);
      }
      : async (asset, destination) => {
        if (asset !== selected.assetName || !selected.downloadUrl) {
          throw new Error(`${selected.tagName} does not contain a downloadable ${asset}`);
        }
        await downloadFile(selected.downloadUrl, destination);
      },
  };
}

export async function resolveGitHubRelease(
  repository: string,
  channel: RuntimeChannel,
  platform: RuntimePlatform,
  dependencies: GitHubReleaseDependencies = {},
): Promise<ResolvedGitHubRelease> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("--repository must be owner/name");
  }
  const gh = dependencies.githubCli === undefined ? authenticatedGitHubCli() : dependencies.githubCli ?? undefined;
  if (gh) {
    const spawn = dependencies.spawn ?? ((command: string[]) => Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" }));
    const result = spawn([
      gh,
      "api",
      `repos/${repository}/releases?per_page=100`,
    ]);
    if (result.exitCode !== 0) throw new Error(`cannot list ${repository} releases: ${result.stderr.toString().trim()}`);
    return { ...selectGitHubRelease(JSON.parse(result.stdout.toString()), repository, channel, platform), githubCli: gh };
  }

  const request = dependencies.fetch ?? (async (url: string) => fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "agulater" },
  }));
  const response = await request(`https://api.github.com/repos/${repository}/releases?per_page=100`);
  if (!response.ok) throw new Error(`cannot list ${repository} releases: HTTP ${response.status}`);
  return selectGitHubRelease(await response.json(), repository, channel, platform);
}

export function selectGitHubRelease(
  value: unknown,
  repository: string,
  channel: RuntimeChannel,
  platform: RuntimePlatform,
): ResolvedGitHubRelease {
  if (!Array.isArray(value)) throw new Error(`cannot list ${repository} releases: unexpected GitHub response`);
  const releases = value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const tagName = typeof raw.tag_name === "string" ? raw.tag_name : undefined;
    const version = tagName ? tryReleaseVersion(tagName) : undefined;
    if (!tagName || !version || typeof raw.draft !== "boolean" || typeof raw.prerelease !== "boolean") return [];
    const assets = Array.isArray(raw.assets)
      ? raw.assets.flatMap((asset) => {
        if (!isRecord(asset) || typeof asset.name !== "string") return [];
        return [{
          name: asset.name,
          downloadUrl: typeof asset.browser_download_url === "string" ? asset.browser_download_url : undefined,
        }];
      })
      : [];
    return [{ tagName, version, draft: raw.draft, prerelease: raw.prerelease, assets }];
  });
  const candidates = releases
    .filter((entry) => !entry.draft && (channel === "next" ? entry.prerelease : !entry.prerelease))
    .sort((left, right) => compareVersions(left.version, right.version));
  if (candidates.length === 0) throw new Error(`${repository} has no ${channel} release`);
  const selected = candidates
    .filter((entry) => entry.assets.some((asset) => asset.name === githubAssetName(entry.version, platform)))
    .at(-1);
  if (!selected) {
    throw new Error(`${repository} has no ${channel} release with an available ${platform} Agul asset`);
  }
  const assetName = githubAssetName(selected.version, platform);
  const asset = selected.assets.find((entry) => entry.name === assetName)!;
  return {
    version: selected.version,
    tagName: selected.tagName,
    assetName,
    ...(asset.downloadUrl ? { downloadUrl: asset.downloadUrl } : {}),
  };
}

function githubRelease(version: string, channel: RuntimeChannel): RuntimeRelease {
  return {
    version,
    channel,
    assets: {
      "windows-x64": { path: `agul-v${version}-x86_64-pc-windows-msvc.zip`, executable: "agul.exe" },
      "linux-x64": { path: `agul-v${version}-x86_64-unknown-linux-gnu.tar.gz`, executable: "agul" },
      "macos-x64": { path: `agul-v${version}-x86_64-apple-darwin.tar.gz`, executable: "agul" },
      "macos-arm64": { path: `agul-v${version}-aarch64-apple-darwin.tar.gz`, executable: "agul" },
    },
  };
}

function githubAssetName(version: string, platform: RuntimePlatform): string {
  const target = {
    "windows-x64": "x86_64-pc-windows-msvc.zip",
    "linux-x64": "x86_64-unknown-linux-gnu.tar.gz",
    "macos-x64": "x86_64-apple-darwin.tar.gz",
    "macos-arm64": "aarch64-apple-darwin.tar.gz",
  }[platform];
  return `agul-v${version}-${target}`;
}

async function acquireAsset(
  release: RuntimeRelease,
  platform: RuntimePlatform,
  base: string,
  customDownload: ((asset: string, destination: string) => Promise<void>) | undefined,
  temporary: string,
): Promise<string> {
  const asset = release.assets[platform];
  if (!asset) throw new Error(`Agul ${release.version} has no ${platform} asset`);
  const locator = asset.path ?? asset.url;
  if (!locator) throw new Error(`Agul ${release.version} ${platform} asset needs path or url`);
  const destination = join(temporary, basename(new URL(locator, "file:///asset/").pathname));
  if (customDownload && asset.path) {
    await customDownload(asset.path, destination);
    const downloaded = join(dirname(destination), asset.path);
    return existsSync(downloaded) ? downloaded : destination;
  }
  if (asset.url) {
    await downloadFile(asset.url, destination);
    return destination;
  }
  if (/^https?:\/\//.test(base)) {
    await downloadFile(new URL(asset.path!, base).href, destination);
    return destination;
  }
  const source = resolve(base, asset.path!);
  if (!existsSync(source)) throw new Error(`runtime asset not found: ${source}`);
  return source;
}

function unpackAsset(source: string, executableName: string, temporary: string): string {
  if (!/\.(?:zip|tar\.gz|tgz)$/i.test(source)) return source;
  const output = join(temporary, "unpacked");
  mkdirSync(output, { recursive: true });
  const args = source.toLowerCase().endsWith(".zip")
    ? ["tar", "-xf", source, "-C", output]
    : ["tar", "-xzf", source, "-C", output];
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`cannot unpack ${basename(source)}: ${result.stderr.toString().trim()}`);
  const executable = findFile(output, executableName);
  if (!executable) throw new Error(`${basename(source)} does not contain ${executableName}`);
  return executable;
}

function findFile(root: string, name: string): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    }
  }
  return undefined;
}

function verifyRuntime(executable: string, version: string): void {
  const command = executable.toLowerCase().endsWith(".cmd")
    ? [process.env.ComSpec || "cmd.exe", "/d", "/c", executable, "--version"]
    : [executable, "--version"];
  const result = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: runtimeVerificationTimeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.exitedDueToTimeout) {
    throw new Error(`downloaded Agul did not answer --version within ${runtimeVerificationTimeoutMs / 1_000} seconds`);
  }
  const reported = result.stdout.toString().trim();
  if (result.exitCode !== 0 || reported !== `agul ${version}`) {
    throw new Error(`downloaded Agul did not report agul ${version}`);
  }
}

function installExecutable(source: string, destination: string, platform: RuntimePlatform, version: string): void {
  const staging = mkdtempSync(join(dirname(destination), ".runtime-staging-"));
  const candidate = join(staging, basename(destination));
  try {
    copyFileSync(source, candidate);
    if (platform !== "windows-x64") chmodSync(candidate, 0o755);
    verifyRuntime(candidate, version);
    replaceFile(candidate, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function replaceFile(source: string, destination: string): void {
  const backup = join(dirname(destination), `.runtime-backup-${crypto.randomUUID()}`);
  let backedUp = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      backedUp = true;
    }
    renameSync(source, destination);
    if (backedUp) rmSync(backup, { force: true });
  } catch (error) {
    if (!existsSync(destination) && backedUp && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function shimDirectory(prefix: string, home: string | undefined, platform: RuntimePlatform): string {
  const resolvedHome = resolve(home ?? homedir());
  if (platform !== "windows-x64" && prefix === resolve(defaultRuntimePrefix(resolvedHome))) {
    return join(resolvedHome, ".local", "bin");
  }
  return join(prefix, "bin");
}

function runtimeShimPath(bin: string, platform: RuntimePlatform): string {
  return join(bin, platform === "windows-x64" ? "agul.cmd" : "agul");
}

/** Internal activation transaction. The caller must hold the runtime prefix lock. */
export function commitRuntimeActivation(prefix: string, record: RuntimeInstallRecord): void {
  const shimSnapshot = snapshotFile(record.shim);
  const shadow = windowsShadowExecutable(record);
  const shadowSnapshot = shadow ? snapshotFile(shadow) : undefined;
  let shadowRemoved = false;
  try {
    writeShim(dirname(record.shim), record.executable, record.platform);
    if (shadow && existsSync(shadow)) {
      rmSync(shadow);
      shadowRemoved = true;
    }
    atomicWriteJson(join(prefix, "current.json"), record);
  } catch (error) {
    const rollbackErrors: string[] = [];
    try {
      restoreFileSnapshot(shimSnapshot);
    } catch (rollbackError) {
      rollbackErrors.push(`launcher: ${errorMessage(rollbackError)}`);
    }
    if (shadowRemoved && shadowSnapshot) {
      try {
        restoreFileSnapshot(shadowSnapshot);
      } catch (rollbackError) {
        rollbackErrors.push(`legacy executable: ${errorMessage(rollbackError)}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${errorMessage(error)}; activation rollback failed: ${rollbackErrors.join("; ")}`);
    }
    throw error;
  }
}

function windowsShadowExecutable(record: RuntimeInstallRecord): string | undefined {
  if (record.platform !== "windows-x64" || basename(record.shim).toLowerCase() !== "agul.cmd") return undefined;
  const shadow = join(dirname(record.shim), "agul.exe");
  return resolve(shadow).toLowerCase() === resolve(record.executable).toLowerCase() ? undefined : shadow;
}

async function acquireRuntimeLock(prefix: string): Promise<() => Promise<void>> {
  try {
    return await lockfile.lock(prefix, {
      retries: 0,
      stale: runtimeLockStaleMs,
      update: runtimeLockUpdateMs,
    });
  } catch (error) {
    if (isErrorCode(error, "ELOCKED")) {
      throw new Error(`another Agul install or update is finishing at ${prefix}; retry when it completes`);
    }
    throw error;
  }
}

async function releaseRuntimeLock(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch {
    // Activation has already committed or rolled back; lock cleanup must not rewrite that outcome.
  }
}

function writeShim(bin: string, executable: string, platform: RuntimePlatform): void {
  mkdirSync(bin, { recursive: true });
  const shim = runtimeShimPath(bin, platform);
  if (platform === "windows-x64") {
    atomicWrite(shim, `@echo off\r\n"${executable}" %*\r\n`);
    return;
  }
  atomicWrite(shim, `#!/bin/sh\nexec "${executable.replaceAll('"', '\\"')}" "$@"\n`, 0o755);
}

type FileSnapshot = {
  path: string;
  contents?: Uint8Array;
  mode?: number;
};

function snapshotFile(path: string): FileSnapshot {
  if (!existsSync(path)) return { path };
  return { path, contents: readFileSync(path), mode: statSync(path).mode & 0o777 };
}

function restoreFileSnapshot(snapshot: FileSnapshot): void {
  if (snapshot.contents === undefined) {
    rmSync(snapshot.path, { force: true });
    return;
  }
  atomicWrite(snapshot.path, snapshot.contents, snapshot.mode);
}

function readInstallRecord(prefix: string): RuntimeInstallRecord | undefined {
  const path = join(prefix, "current.json");
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value) || value.format !== runtimeInstallFormat) throw new Error(`invalid runtime state at ${path}`);
  const channel = value.channel === "stable" || value.channel === "next" ? value.channel : undefined;
  const platform = runtimePlatforms.includes(value.platform as RuntimePlatform) ? value.platform as RuntimePlatform : undefined;
  if (!channel || !platform) throw new Error(`invalid runtime state at ${path}`);
  if (value.environment !== undefined && !isPathRegistration(value.environment)) {
    throw new Error(`invalid runtime environment state at ${path}`);
  }
  return {
    format: runtimeInstallFormat,
    version: semanticVersion(value.version, `${path}.version`),
    channel,
    platform,
    executable: text(value.executable, `${path}.executable`),
    shim: text(value.shim, `${path}.shim`),
    ...(typeof value.repository === "string" ? { repository: value.repository } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(isPathRegistration(value.environment) ? { environment: value.environment } : {}),
  };
}

function sameInstallRecord(left: RuntimeInstallRecord | undefined, right: RuntimeInstallRecord | undefined): boolean {
  if (!left || !right) return left === right;
  return left.format === right.format
    && left.version === right.version
    && left.channel === right.channel
    && left.platform === right.platform
    && left.executable === right.executable
    && left.shim === right.shim
    && left.repository === right.repository
    && left.url === right.url
    && JSON.stringify(left.environment) === JSON.stringify(right.environment);
}

function isPathRegistration(value: unknown): value is PathRegistration {
  return isRecord(value)
    && value.format === pathRegistrationFormat
    && typeof value.directory === "string"
    && (value.target === "windows-user" || value.target === "profile")
    && typeof value.managed === "boolean"
    && (value.profile === undefined || typeof value.profile === "string");
}

function parseRelease(value: unknown, label: string): RuntimeRelease {
  const record = strictRecord(value, label, ["version", "channel", "assets"], ["version", "channel", "assets"]);
  if (!isRecord(record.assets)) throw new Error(`${label}.assets must be an object`);
  const unknownPlatform = Object.keys(record.assets).find((key) => !runtimePlatforms.includes(key as RuntimePlatform));
  if (unknownPlatform) throw new Error(`${label}.assets has unknown platform ${unknownPlatform}`);
  if (Object.keys(record.assets).length === 0) throw new Error(`${label}.assets must not be empty`);
  const channel = record.channel === "stable" || record.channel === "next" ? record.channel : undefined;
  if (!channel) throw new Error(`${label}.channel must be stable or next`);
  const assets: RuntimeRelease["assets"] = {};
  for (const platform of runtimePlatforms) {
    const raw = record.assets[platform];
    if (raw === undefined) continue;
    if (typeof raw === "string") assets[platform] = { path: text(raw, `${label}.assets.${platform}`) };
    else if (isRecord(raw)) {
      const asset = strictRecord(raw, `${label}.assets.${platform}`, ["path", "url", "executable"]);
      const path = asset.path === undefined ? undefined : text(asset.path, `${label}.assets.${platform}.path`);
      const url = asset.url === undefined ? undefined : text(asset.url, `${label}.assets.${platform}.url`);
      if (Boolean(path) === Boolean(url)) throw new Error(`${label}.assets.${platform} needs exactly one of path or url`);
      assets[platform] = {
        ...(path ? { path } : {}),
        ...(url ? { url } : {}),
        ...(asset.executable === undefined ? {} : { executable: text(asset.executable, `${label}.assets.${platform}.executable`) }),
      };
    } else throw new Error(`${label}.assets.${platform} is invalid`);
  }
  return { version: semanticVersion(record.version, `${label}.version`), channel, assets };
}

function authenticatedGitHubCli(): string | undefined {
  const path = Bun.which("gh");
  if (!path) return undefined;
  const status = Bun.spawnSync([path, "auth", "status", "--hostname", "github.com"], { stdout: "ignore", stderr: "ignore" });
  return status.exitCode === 0 ? path : undefined;
}

function tryReleaseVersion(tag: string): string | undefined {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : undefined;
}

function semanticVersion(value: unknown, label: string): string {
  const version = text(value, label);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`${label} must be SemVer`);
  return version;
}

function compareVersions(left: string, right: string): number {
  return compareSemVer(left, right);
}

function localSource(source: string): string | undefined {
  if (source.startsWith("file://")) return decodeURIComponent(new URL(source).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
  const path = resolve(source);
  return existsSync(path) ? path : undefined;
}

async function fetchText(url: string, kind: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "agulater" } });
  if (!response.ok) throw new Error(`cannot download ${kind}: HTTP ${response.status}`);
  return response.text();
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": "agulater" }, redirect: "follow" });
  if (!response.ok) throw new Error(`cannot download ${url}: HTTP ${response.status}`);
  writeFileSync(destination, new Uint8Array(await response.arrayBuffer()));
}

function atomicWrite(path: string, contents: string | Uint8Array, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents);
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function strictRecord(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has unknown field ${unknown}`);
  const missing = required.find((key) => value[key] === undefined);
  if (missing) throw new Error(`${label} needs ${missing}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error) && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === code;
}

function removeTemporaryRuntime(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // A verified and activated runtime remains usable even if its download workspace cannot be cleaned up.
  }
}
