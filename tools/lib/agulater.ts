import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertPackageSchema } from "./package-schema.ts";
import { compareSemVer, satisfiesSemVer } from "./semver.ts";

export const packageFormat = "agulater/package/v2" as const;
export const launchFormat = "agul/launch/v2" as const;
export const harnessFormat = "agulater/harness/v1" as const;
export const poolsFormat = "agulater/pools/v2" as const;
export const snapshotFormat = "agulater/snapshot/v1" as const;
export const specialistsFormat = "agulater/specialists/v1" as const;
export const handoffFormat = "agul/handoff/v1" as const;
export const catalogFormat = "agulater/catalog/v1" as const;
export const catalogRegistryFormat = "agulater/catalogs/v1" as const;
export const catalogListFormat = "agulater/catalog-list/v1" as const;
export const defaultAgentKubeCatalog = "https://raw.githubusercontent.com/storious/agentkube/main/catalog/catalog.json";

export const extensionTypes = ["skill", "plugin", "package"] as const;
export type ExtensionType = (typeof extensionTypes)[number];

type ResourceEntry = { id: string; path: string };
type ContextEntry = ResourceEntry & {
  description: string;
  load: "eager" | "on_demand";
};

export type DependencySource =
  | { type: "catalog" }
  | { type: "host" }
  | { type: "path"; path: string }
  | { type: "git"; url: string; subdir?: string; ref?: string };

export type Dependency = {
  id: string;
  version?: string;
  alias?: string;
  source?: DependencySource;
};

export type AgentPackage = {
  format: typeof packageFormat;
  id: string;
  version: string;
  description: string;
  instructions: string;
  resources?: {
    skills?: ResourceEntry[];
    plugins?: ResourceEntry[];
    contexts?: ContextEntry[];
    packages?: Array<{ path: string }>;
  };
  dependencies?: {
    skills?: Dependency[];
    plugins?: Dependency[];
    packages?: Dependency[];
  };
  profile?: {
    accepts: string[];
    workspace_effect: "read" | "write";
    contexts: string[];
    harness: string;
  };
};

export type Harness = {
  format: typeof harnessFormat;
  task_template: string;
  requirements: { min_context_window: number; capabilities: string[] };
  defaults: {
    reasoning_effort: string;
    max_rounds: number;
    max_tool_calls: number;
    max_tokens: number;
    timeout_seconds: number;
  };
  result: {
    format: typeof handoffFormat;
    summary_max_chars: number;
    evidence_max_items: number;
  };
  completion: {
    verification: "required" | "when_changed" | "none";
    rules: string[];
  };
};

type PoolCommon = {
  id: string;
  description?: string;
  labels?: string[];
  reasoning_effort?: string;
  capabilities: string[];
  max_concurrency: number;
  request_timeout_seconds: number;
  override?: boolean;
};

export type NativePool = PoolCommon & {
  engine: "native";
  provider: string;
  endpoint: string;
  model: string;
  api_key_env?: string;
  context_window: number;
};

export type CodexPool = PoolCommon & {
  engine: "codex";
  model?: string;
  codex_command?: string;
  context_window?: number;
};

export type Pool = NativePool | CodexPool;

export type PoolsFile = {
  format: typeof poolsFormat;
  default_pool?: string;
  pools: Pool[];
};

export type ExtensionResult = {
  name: string;
  type: ExtensionType;
  path: string;
  version: string;
};

export type CatalogRegistration = { id: string; url: string };

export type CatalogEntry = {
  id: string;
  kind: ExtensionType;
  description: string;
  versions: Array<{ version: string; source: Extract<DependencySource, { type: "git" }> }>;
};

export type Catalog = { entries: CatalogEntry[] };

export type CatalogListResult = {
  format: typeof catalogListFormat;
  catalogs: Array<CatalogRegistration & { cached: boolean; entries: number }>;
};

export type CatalogSearchResult = {
  catalog: string;
  id: string;
  type: ExtensionType;
  description: string;
  version: string;
};

type SourceRecord = {
  id: string;
  type: ExtensionType;
  version: string;
  path: string;
  source:
    | { type: "path"; path: string }
    | { type: "git"; url: string; subdir?: string; ref?: string }
    | { type: "catalog"; catalog: string; entry: string };
};

export type PrepareOptions = { home?: string; store?: string };

export type SyncOptions = PrepareOptions & { catalog?: string };

export type SyncResult = {
  installed: Array<{ id: string; type: ExtensionType; version: string; path: string }>;
  launchPath: string;
};

type ResolvedSource = DependencySource | { type: "resource"; path: string };
type LocatedEntry = {
  id: string;
  version: string;
  source: ResolvedSource;
  sourcePath: string;
};
type LocatedContext = LocatedEntry & ContextEntry;
type ResolvedEntry = Omit<LocatedEntry, "sourcePath"> & { path: string };
type ResolvedContext = ResolvedEntry & Pick<ContextEntry, "description" | "load">;
type ResolvedPackage = ResolvedEntry & { launch_path: string; snapshot_path: string };

type Specialist = {
  id: string;
  version: string;
  description: string;
  accepts: string[];
  workspace_effect: "read" | "write";
  launch_path: string;
  snapshot_path: string;
  requirements: Harness["requirements"];
  defaults: Harness["defaults"];
  handoff_format: typeof handoffFormat;
};

type Snapshot = {
  format: typeof snapshotFormat;
  package: { id: string; version: string };
  instructions: { source: string; path: string };
  resources: {
    skills: ResolvedEntry[];
    plugins: ResolvedEntry[];
    contexts: ResolvedContext[];
    packages: ResolvedPackage[];
  };
  dependencies: {
    skills: ResolvedEntry[];
    plugins: ResolvedEntry[];
    packages: ResolvedPackage[];
  };
};

type CompileState = {
  runtimeRoot: string;
  home: string;
  store: string;
  compiling: string[];
  compiled: Map<string, { sourceRoot: string; manifest: AgentPackage; outputRoot: string }>;
  specialists: Specialist[];
};

type CompileResult = {
  manifest: AgentPackage;
  launchPath: string;
  snapshotPath: string;
};

type Candidate = {
  name: string;
  type: ExtensionType;
  path: string;
  version: string;
};

export function projectAgentsRoot(workspace = "."): string {
  return join(resolve(workspace), ".agents");
}

export function userAgentsRoot(home = homedir()): string {
  return join(resolve(home), ".agents");
}

export function managedStoreRoot(home = homedir()): string {
  return join(userAgentsRoot(home), "store");
}

export function createProject(workspace = ".", requestedName?: string): string {
  const agentsRoot = projectAgentsRoot(workspace);
  if (existsSync(join(agentsRoot, "package.json"))) {
    throw new Error(`an assistant already exists at ${agentsRoot}`);
  }
  initializePackage(agentsRoot, requestedName ?? (basename(resolve(workspace)) || "assistant"));
  return agentsRoot;
}

export function ensureProject(workspace = "."): string {
  const agentsRoot = projectAgentsRoot(workspace);
  if (!existsSync(join(agentsRoot, "package.json"))) {
    initializePackage(agentsRoot, basename(resolve(workspace)) || "assistant");
  } else {
    readPackage(agentsRoot);
  }
  return agentsRoot;
}

export function setupUser(
  home = homedir(),
  options: { ifMissing?: boolean } = {},
): { root: string; created: boolean; prepared: boolean; unmanaged: boolean; notice?: string } {
  const root = userAgentsRoot(home);
  if (!existsSync(root)) {
    initializePackage(root, "user-assistant", "General user assistant for Agul", home);
    ensureCatalogRegistry(root);
    return { root, created: true, prepared: true, unmanaged: false };
  }
  if (!existsSync(join(root, "package.json"))) {
    return { root, created: false, prepared: false, unmanaged: true, notice: "existing .agents directory was not changed" };
  }
  const existing = readJson(join(root, "package.json"), "assistant package");
  if (isRecord(existing) && existing.format === "agulater/package/v1") {
    if (!isGeneratedUserV1(root, existing)) {
      if (options.ifMissing) {
        return {
          root,
          created: false,
          prepared: false,
          unmanaged: true,
          notice: "customized legacy assistant was not changed; run agulater migrate user explicitly",
        };
      }
      throw new Error(`customized legacy user assistant at ${root}; run agulater migrate user explicitly`);
    }
    writePackage(root, defaultUserManifest());
    ensureCatalogRegistry(root);
    prepare(root, { home });
    return { root, created: false, prepared: true, unmanaged: false };
  }
  if (options.ifMissing) {
    if (isRecord(existing) && existing.format === packageFormat) ensureCatalogRegistry(root);
    return { root, created: false, prepared: false, unmanaged: false, notice: "existing user assistant was not changed" };
  }
  readPackage(root);
  ensureCatalogRegistry(root);
  prepare(root, { home });
  return { root, created: false, prepared: true, unmanaged: false };
}

export function migrateUser(home = homedir()): { root: string; launchPath: string } {
  const root = userAgentsRoot(home);
  const packagePath = join(root, "package.json");
  const record = strictObject(
    readJson(packagePath, "legacy user assistant"),
    packagePath,
    ["format", "name", "version", "instructions", "skills", "plugins", "agents"],
    ["format", "name", "version", "instructions"],
  );
  if (record.format !== "agulater/package/v1") throw new Error(`${packagePath} is not an agulater/package/v1 package`);
  const manifest: AgentPackage = {
    format: packageFormat,
    id: packageId(slug(nonEmptyString(record.name, `${packagePath}.name`)), `${packagePath}.name`),
    version: semanticVersion(record.version, `${packagePath}.version`),
    description: `Migrated user assistant ${nonEmptyString(record.name, `${packagePath}.name`)}`,
    instructions: packageLocator(record.instructions, `${packagePath}.instructions`),
  };
  const resources: NonNullable<AgentPackage["resources"]> = {};
  for (const type of ["skill", "plugin"] as const) {
    const field = `${type}s` as "skills" | "plugins";
    if (record[field] === undefined) continue;
    const directory = resolveInside(root, packageLocator(record[field], `${packagePath}.${field}`), `${packagePath}.${field}`);
    if (!existsSync(directory)) continue;
    const candidates = collectCandidates(directory).filter((candidate) => candidate.type === type);
    resources[field] = candidates.map((candidate) => ({
      id: packageId(candidate.name, `${field} id`),
      path: relativeLocator(root, candidate.path),
    }));
  }
  if (record.agents !== undefined) {
    const directory = resolveInside(root, packageLocator(record.agents, `${packagePath}.agents`), `${packagePath}.agents`);
    if (existsSync(directory)) {
      const packages = collectCandidates(directory).filter((candidate) => candidate.type === "package");
      const packagePaths = new Set(packages.map((candidate) => resolve(candidate.path)));
      const unsupported = collectLegacyAgentDirectories(directory).filter((path) => !packagePaths.has(resolve(path)));
      if (unsupported.length > 0) {
        throw new Error(`legacy agents need package/v2 manifests before migration: ${unsupported.join(", ")}`);
      }
      resources.packages = packages.map((candidate) => ({ path: relativeLocator(root, candidate.path) }));
    }
  }
  if (Object.values(resources).some((entries) => entries && entries.length > 0)) manifest.resources = resources;
  parsePackage(manifest, packagePath);
  writePackage(root, manifest);
  ensureCatalogRegistry(root);
  return { root, launchPath: prepare(root, { home }) };
}

export function readPackage(agentsRoot: string): AgentPackage {
  const path = join(resolve(agentsRoot), "package.json");
  return parsePackage(readJson(path, "assistant package"), path);
}

export function readHarness(path: string): Harness {
  const absolute = resolve(path);
  const record = strictObject(
    readJson(absolute, "harness"),
    absolute,
    ["format", "task_template", "requirements", "defaults", "result", "completion"],
    ["format", "task_template", "requirements", "defaults", "result", "completion"],
  );
  if (record.format !== harnessFormat) throw new Error(`${absolute}.format must be ${harnessFormat}`);
  const requirements = strictObject(record.requirements, `${absolute}.requirements`, ["min_context_window", "capabilities"], ["min_context_window", "capabilities"]);
  const defaults = strictObject(record.defaults, `${absolute}.defaults`, ["reasoning_effort", "max_rounds", "max_tool_calls", "max_tokens", "timeout_seconds"], ["reasoning_effort", "max_rounds", "max_tool_calls", "max_tokens", "timeout_seconds"]);
  const result = strictObject(record.result, `${absolute}.result`, ["format", "summary_max_chars", "evidence_max_items"], ["format", "summary_max_chars", "evidence_max_items"]);
  const completion = strictObject(record.completion, `${absolute}.completion`, ["verification", "rules"], ["verification", "rules"]);
  if (result.format !== handoffFormat) throw new Error(`${absolute}.result.format must be ${handoffFormat}`);
  return {
    format: harnessFormat,
    task_template: nonEmptyString(record.task_template, `${absolute}.task_template`),
    requirements: {
      min_context_window: positiveInteger(requirements.min_context_window, `${absolute}.requirements.min_context_window`),
      capabilities: stringArray(requirements.capabilities, `${absolute}.requirements.capabilities`),
    },
    defaults: {
      reasoning_effort: nonEmptyString(defaults.reasoning_effort, `${absolute}.defaults.reasoning_effort`),
      max_rounds: positiveInteger(defaults.max_rounds, `${absolute}.defaults.max_rounds`),
      max_tool_calls: positiveInteger(defaults.max_tool_calls, `${absolute}.defaults.max_tool_calls`),
      max_tokens: positiveInteger(defaults.max_tokens, `${absolute}.defaults.max_tokens`),
      timeout_seconds: positiveInteger(defaults.timeout_seconds, `${absolute}.defaults.timeout_seconds`),
    },
    result: {
      format: handoffFormat,
      summary_max_chars: positiveInteger(result.summary_max_chars, `${absolute}.result.summary_max_chars`),
      evidence_max_items: positiveInteger(result.evidence_max_items, `${absolute}.result.evidence_max_items`),
    },
    completion: {
      verification: enumeration(completion.verification, ["required", "when_changed", "none"] as const, `${absolute}.completion.verification`),
      rules: stringArray(completion.rules, `${absolute}.completion.rules`),
    },
  };
}

export function readPools(path: string): PoolsFile {
  const absolute = resolve(path);
  const record = strictObject(readJson(absolute, "pool file"), absolute, ["format", "default_pool", "pools"], ["format", "pools"]);
  if (record.format !== poolsFormat) throw new Error(`${absolute}.format must be ${poolsFormat}`);
  const pools = array(record.pools, `${absolute}.pools`).map((entry, index) => parsePool(entry, `${absolute}.pools[${index}]`));
  uniqueBy(pools, (pool) => pool.id, `${absolute}.pools`);
  const defaultPool = record.default_pool === undefined ? undefined : packageId(record.default_pool, `${absolute}.default_pool`);
  if (pools.length > 0 && !defaultPool) throw new Error(`${absolute}.default_pool is required when pools is not empty`);
  if (defaultPool && !pools.some((pool) => pool.id === defaultPool)) throw new Error(`${absolute}.default_pool must name a pool in pools`);
  return { format: poolsFormat, ...(defaultPool ? { default_pool: defaultPool } : {}), pools };
}

export function prepare(agentsRoot: string, options: PrepareOptions = {}): string {
  const root = resolve(agentsRoot);
  const manifest = readPackage(root);
  const userHome = resolve(options.home ?? homedir());
  const staging = mkdtempSync(join(root, ".runtime-staging-"));
  const state: CompileState = {
    runtimeRoot: staging,
    home: userHome,
    store: resolve(options.store ?? managedStoreRoot(userHome)),
    compiling: [],
    compiled: new Map(),
    specialists: [],
  };
  try {
    compilePackage(root, staging, state, manifest);
    writeJson(join(staging, "specialists.json"), {
      format: specialistsFormat,
      specialists: [...state.specialists].sort((a, b) => a.id.localeCompare(b.id)),
    });
    writeJson(join(staging, "pools.json"), layeredPools(root, userHome));
    replaceDirectory(staging, join(root, "runtime"));
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return join(root, "runtime", "launch.json");
}

export function syncDependencies(agentsRoot: string, options: SyncOptions = {}): SyncResult {
  const root = resolve(agentsRoot);
  const home = resolve(options.home ?? homedir());
  const store = resolve(options.store ?? managedStoreRoot(home));
  const catalogPath = options.catalog
    ? resolve(options.catalog)
    : [join(dirname(root), "catalog", "catalog.json"), join(userAgentsRoot(home), "catalog.json")]
        .find(existsSync);
  const catalog = catalogPath ? readCatalog(catalogPath) : undefined;
  const installed: SyncResult["installed"] = [];
  const visited = new Set<string>();

  const syncPackage = (packageRoot: string): void => {
    const manifest = readPackage(packageRoot);
    const visitKey = `${manifest.id}@${manifest.version}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    for (const type of extensionTypes) {
      const dependencies = type === "skill"
        ? manifest.dependencies?.skills ?? []
        : type === "plugin"
          ? manifest.dependencies?.plugins ?? []
          : manifest.dependencies?.packages ?? [];
      for (const dependency of dependencies) {
        const source = dependency.source ?? { type: "catalog" as const };
        if (source.type === "path" || source.type === "host") continue;
        const selected = source.type === "catalog"
          ? selectCatalogVersion(catalog, catalogPath, type, dependency)
          : { version: exactVersion(dependency.version), source };
        const result = installGitDependency(store, type, dependency, selected.source, selected.version);
        installed.push(result);
      }
    }
    for (const resource of manifest.resources?.packages ?? []) {
      syncPackage(resolveRelativeSource(packageRoot, resource.path));
    }
    const state: CompileState = {
      runtimeRoot: "",
      home,
      store,
      compiling: [],
      compiled: new Map(),
      specialists: [],
    };
    for (const dependency of manifest.dependencies?.packages ?? []) {
      const resolved = resolveDependency(packageRoot, "package", dependency, state);
      syncPackage(resolved.path);
    }
  };

  syncPackage(root);
  const uniqueInstalled = [...new Map(installed.map((entry) => [`${entry.type}:${entry.id}@${entry.version}`, entry])).values()];
  return { installed: uniqueInstalled, launchPath: prepare(root, { home, store }) };
}

function compilePackage(
  sourceRoot: string,
  outputRoot: string,
  state: CompileState,
  knownManifest?: AgentPackage,
): CompileResult {
  const root = resolve(sourceRoot);
  const manifest = knownManifest ?? readPackage(root);
  const existing = state.compiled.get(manifest.id);
  if (existing) {
    if (existing.sourceRoot !== root || existing.manifest.version !== manifest.version) {
      throw new Error(`package id ${manifest.id} resolves to more than one package`);
    }
    return { manifest: existing.manifest, launchPath: join(existing.outputRoot, "launch.json"), snapshotPath: join(existing.outputRoot, "snapshot.json") };
  }
  if (state.compiling.includes(manifest.id)) {
    throw new Error(`package dependency cycle: ${[...state.compiling, manifest.id].join(" -> ")}`);
  }
  state.compiling.push(manifest.id);
  mkdirSync(outputRoot, { recursive: true });
  try {
    const instructionSource = resolveInside(root, manifest.instructions, `${manifest.id}.instructions`);
    requireFile(instructionSource, "instructions not found");
    const resourceSkills = localResources(root, manifest, "skill");
    const resourcePlugins = localResources(root, manifest, "plugin");
    const dependencySkills = dependencyResources(root, manifest, "skill", state);
    const dependencyPlugins = dependencyResources(root, manifest, "plugin", state);
    const contexts = localContexts(root, manifest);
    copyResources(outputRoot, "skill", [...resourceSkills, ...dependencySkills]);
    copyResources(outputRoot, "plugin", [...resourcePlugins, ...dependencyPlugins]);
    copyContexts(outputRoot, contexts);

    const firstChildSpecialist = state.specialists.length;
    const children = [
      ...(manifest.resources?.packages ?? []).map((entry) => ({
        root: resolveRelativeSource(root, entry.path),
        source: { type: "resource" as const, path: entry.path } as ResolvedSource,
        dependency: false,
      })),
      ...packageDependencies(root, manifest, state).map((entry) => ({ ...entry, dependency: true })),
    ];
    const resourcePackages: ResolvedPackage[] = [];
    const dependencyPackages: ResolvedPackage[] = [];
    for (const child of children) {
      const childManifest = readPackage(child.root);
      const childOutput = join(state.runtimeRoot, "specialists", ...childManifest.id.split("/"));
      const compiled = compilePackage(child.root, childOutput, state, childManifest);
      const record = packageSnapshotRecord(state.runtimeRoot, compiled, child.source);
      (child.dependency ? dependencyPackages : resourcePackages).push(record);
    }

    const selectedContexts = selectContexts(manifest, contexts);
    const resourceIds = new Set([...resourceSkills, ...dependencySkills].map((entry) => safeFileId(entry.id)));
    for (const context of selectedContexts.filter((entry) => entry.load === "on_demand")) {
      if (resourceIds.has(`context-${safeFileId(context.id)}`)) {
        throw new Error(`${manifest.id} on-demand context ${context.id} conflicts with a Skill id`);
      }
      writeContextSkill(outputRoot, context);
    }
    const harness = manifest.profile ? readHarness(resolveInside(root, manifest.profile.harness, `${manifest.id}.profile.harness`)) : undefined;
    const childSpecialists = state.specialists.slice(firstChildSpecialist);
    writeFileSync(
      join(outputRoot, "instructions.md"),
      compiledInstructions(readFileSync(instructionSource, "utf8"), selectedContexts.filter((entry) => entry.load === "eager"), harness, childSpecialists),
      "utf8",
    );
    writeJson(join(outputRoot, "launch.json"), {
      format: launchFormat,
      instructions: "instructions.md",
      ...([...resourceSkills, ...dependencySkills].length > 0 || selectedContexts.some((entry) => entry.load === "on_demand") ? { skills: "resources/skills" } : {}),
      ...([...resourcePlugins, ...dependencyPlugins].length > 0 ? { plugins: "resources/plugins" } : {}),
    });
    const snapshot: Snapshot = {
      format: snapshotFormat,
      package: { id: manifest.id, version: manifest.version },
      instructions: { source: manifest.instructions, path: "instructions.md" },
      resources: {
        skills: resourceSkills.map((entry) => resourceSnapshot(outputRoot, "skill", entry)),
        plugins: resourcePlugins.map((entry) => resourceSnapshot(outputRoot, "plugin", entry)),
        contexts: contexts.map((entry) => contextSnapshot(outputRoot, entry)),
        packages: resourcePackages,
      },
      dependencies: {
        skills: dependencySkills.map((entry) => resourceSnapshot(outputRoot, "skill", entry)),
        plugins: dependencyPlugins.map((entry) => resourceSnapshot(outputRoot, "plugin", entry)),
        packages: dependencyPackages,
      },
    };
    writeJson(join(outputRoot, "snapshot.json"), snapshot);
    state.compiled.set(manifest.id, { sourceRoot: root, manifest, outputRoot });
    if (manifest.profile && harness) {
      if (state.specialists.some((entry) => entry.id === manifest.id)) throw new Error(`specialist id ${manifest.id} is declared more than once`);
      state.specialists.push({
        id: manifest.id,
        version: manifest.version,
        description: manifest.description,
        accepts: manifest.profile.accepts,
        workspace_effect: manifest.profile.workspace_effect,
        launch_path: relativeLocator(state.runtimeRoot, join(outputRoot, "launch.json")),
        snapshot_path: relativeLocator(state.runtimeRoot, join(outputRoot, "snapshot.json")),
        requirements: harness.requirements,
        defaults: harness.defaults,
        handoff_format: harness.result.format,
      });
    }
    return { manifest, launchPath: join(outputRoot, "launch.json"), snapshotPath: join(outputRoot, "snapshot.json") };
  } finally {
    state.compiling.pop();
  }
}

function localResources(root: string, manifest: AgentPackage, type: "skill" | "plugin"): LocatedEntry[] {
  const entries = type === "skill" ? manifest.resources?.skills ?? [] : manifest.resources?.plugins ?? [];
  return entries.map((entry) => {
    const sourcePath = resolveRelativeSource(root, entry.path);
    requireDirectory(sourcePath, `${type} resource not found`);
    validateExtension(type, sourcePath);
    return {
      id: entry.id,
      version: extensionVersion(type, sourcePath, manifest.version),
      source: { type: "resource", path: entry.path },
      sourcePath,
    };
  });
}

function localContexts(root: string, manifest: AgentPackage): LocatedContext[] {
  return (manifest.resources?.contexts ?? []).map((entry) => {
    const sourcePath = resolveInside(root, entry.path, `${manifest.id}.resources.contexts.${entry.id}`);
    requireFile(sourcePath, "context not found");
    return {
      ...entry,
      version: manifest.version,
      source: { type: "resource", path: entry.path },
      sourcePath,
    };
  });
}

function dependencyResources(
  root: string,
  manifest: AgentPackage,
  type: "skill" | "plugin",
  state: CompileState,
): LocatedEntry[] {
  const entries = type === "skill" ? manifest.dependencies?.skills ?? [] : manifest.dependencies?.plugins ?? [];
  return entries.map((dependency) => {
    const resolved = resolveDependency(root, type, dependency, state);
    validateExtension(type, resolved.path);
    const version = extensionVersion(type, resolved.path, resolved.version);
    if (dependency.version && !satisfiesVersion(version, dependency.version)) {
      throw new Error(`dependency ${dependency.id} ${version} does not satisfy ${dependency.version}`);
    }
    return {
      id: dependency.alias ?? dependency.id,
      version,
      source: resolved.source,
      sourcePath: resolved.path,
    };
  });
}

function packageDependencies(
  root: string,
  manifest: AgentPackage,
  state: CompileState,
): Array<{ root: string; source: ResolvedSource }> {
  return (manifest.dependencies?.packages ?? []).map((dependency) => {
    const resolved = resolveDependency(root, "package", dependency, state);
    const child = readPackage(resolved.path);
    if (child.id !== dependency.id) throw new Error(`dependency ${dependency.id} resolved package ${child.id}`);
    if (dependency.version && !satisfiesVersion(child.version, dependency.version)) {
      throw new Error(`dependency ${dependency.id} ${child.version} does not satisfy ${dependency.version}`);
    }
    return { root: resolved.path, source: resolved.source };
  });
}

function resolveDependency(
  root: string,
  type: ExtensionType,
  dependency: Dependency,
  state: CompileState,
): { path: string; version: string; source: ResolvedSource } {
  const source = dependency.source ?? { type: "catalog" as const };
  if (source.type === "path") {
    const path = resolveRelativeSource(root, source.path);
    requireDirectory(path, "dependency source not found");
    const version = type === "package"
      ? readPackage(path).version
      : extensionVersion(type, path, exactVersion(dependency.version) ?? "0.0.0");
    return { path, version, source };
  }
  if (source.type === "host") {
    const paths = hostCandidates(root, state.home, type, dependency.id);
    if (paths.length === 0) throw new Error(`host dependency not found: ${type}:${dependency.id}`);
    if (paths.length > 1) {
      throw new Error(`host dependency ${type}:${dependency.id} is ambiguous (${paths.join(", ")}); use source.type path`);
    }
    const path = paths[0]!;
    const version = type === "package"
      ? readPackage(path).version
      : extensionVersion(type, path, exactVersion(dependency.version) ?? "0.0.0");
    return { path, version, source };
  }
  const stored = storedDependency(state.store, type, dependency.id, dependency.version);
  if (!stored) {
    throw new Error(`dependency is not installed: ${type}:${dependency.id}; run agulater sync`);
  }
  return { ...stored, source };
}

function copyResources(outputRoot: string, type: "skill" | "plugin", entries: LocatedEntry[]): void {
  uniqueBy(entries, (entry) => safeFileId(entry.id), `${type} runtime resource paths`);
  for (const entry of entries) {
    const destination = runtimeResourcePath(outputRoot, type, entry.id);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(entry.sourcePath, destination, { recursive: true, filter: omitInternal });
  }
}

function copyContexts(outputRoot: string, contexts: LocatedContext[]): void {
  for (const context of contexts) {
    const destination = join(outputRoot, "resources", "contexts", `${safeFileId(context.id)}.md`);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(context.sourcePath, destination);
  }
}

function selectContexts(manifest: AgentPackage, contexts: LocatedContext[]): LocatedContext[] {
  if (!manifest.profile) return contexts;
  const byId = new Map(contexts.map((context) => [context.id, context]));
  return manifest.profile.contexts.map((id) => {
    const context = byId.get(id);
    if (!context) throw new Error(`${manifest.id}.profile.contexts references unknown context ${id}`);
    return context;
  });
}

function writeContextSkill(outputRoot: string, context: LocatedContext): void {
  const skillName = `context-${safeFileId(context.id)}`;
  const destination = join(outputRoot, "resources", "skills", skillName, "SKILL.md");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    `---\nname: ${skillName}\ndescription: ${JSON.stringify(context.description)}\n---\n\n${readFileSync(context.sourcePath, "utf8").trimEnd()}\n`,
    "utf8",
  );
}

function compiledInstructions(
  instructions: string,
  contexts: LocatedContext[],
  harness: Harness | undefined,
  specialists: Specialist[],
): string {
  const parts = [instructions.trimEnd()];
  for (const context of contexts) {
    parts.push(`## Context: ${context.id}\n\n${context.description}\n\n${readFileSync(context.sourcePath, "utf8").trimEnd()}`);
  }
  if (harness) {
    const handoff = `<agul-handoff format="${harness.result.format}">{"format":"${harness.result.format}","status":"completed","summary":"..."}</agul-handoff>`;
    parts.push([
      "## Specialist harness",
      "",
      harness.task_template,
      "",
      "Complete the bounded task before explaining it. During tool-use rounds, call only the tools needed for the next fact or change; do not narrate plans, count rounds or tool calls, restate gathered evidence, or draft the final answer. Stop using tools as soon as the completion rules are satisfied.",
      "Keep the final report compact and reserve output for the required handoff. If space is tight, omit optional prose and optional handoff fields, then emit the minimal truthful handoff immediately. Never omit the handoff or claim work that was not completed.",
      "",
      "Finish with exactly one single-line raw handoff block and no text after it:",
      handoff,
      `Status must be completed, blocked, or failed. Keep summary within ${harness.result.summary_max_chars} characters and evidence to at most ${harness.result.evidence_max_items} items. Add evidence, changes, verification, risks, or next_steps only when useful.`,
      "When present, evidence, changes, verification, risks, and next_steps must each be JSON arrays; never put the verification policy string in the handoff payload.",
      `Verification policy: ${harness.completion.verification}.`,
      ...harness.completion.rules.map((rule) => `- ${rule}`),
    ].join("\n"));
  }
  if (specialists.length > 0) {
    parts.push([
      "## Prepared specialists",
      "",
      ...specialists.map((specialist) =>
        `- \`${specialist.id}\`: ${specialist.description} Accepts: ${specialist.accepts.join(", ")}. Workspace effect: ${specialist.workspace_effect}.`),
    ].join("\n"));
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

function resourceSnapshot(outputRoot: string, type: "skill" | "plugin", entry: LocatedEntry): ResolvedEntry {
  return {
    id: entry.id,
    version: entry.version,
    source: entry.source,
    path: relativeLocator(outputRoot, runtimeResourcePath(outputRoot, type, entry.id)),
  };
}

function contextSnapshot(outputRoot: string, entry: LocatedContext): ResolvedContext {
  return {
    id: entry.id,
    version: entry.version,
    description: entry.description,
    load: entry.load,
    source: entry.source,
    path: relativeLocator(outputRoot, join(outputRoot, "resources", "contexts", `${safeFileId(entry.id)}.md`)),
  };
}

function packageSnapshotRecord(runtimeRoot: string, compiled: CompileResult, source: ResolvedSource): ResolvedPackage {
  return {
    id: compiled.manifest.id,
    version: compiled.manifest.version,
    source,
    path: relativeLocator(runtimeRoot, dirname(compiled.launchPath)),
    launch_path: relativeLocator(runtimeRoot, compiled.launchPath),
    snapshot_path: relativeLocator(runtimeRoot, compiled.snapshotPath),
  };
}

function layeredPools(root: string, home: string): PoolsFile {
  const localPath = join(root, "pools.json");
  const userPath = join(userAgentsRoot(home), "pools.json");
  const sameFile = resolve(localPath).toLowerCase() === resolve(userPath).toLowerCase();
  const base = !sameFile && existsSync(userPath) ? readPools(userPath) : undefined;
  const local = existsSync(localPath) ? readPools(localPath) : undefined;
  if (!base && !local) return { format: poolsFormat, pools: [] };
  const merged = new Map<string, Pool>();
  for (const pool of base?.pools ?? []) merged.set(pool.id, pool);
  for (const pool of local?.pools ?? []) {
    if (merged.has(pool.id) && pool.override !== true) {
      throw new Error(`${localPath} pool ${pool.id} must set override: true to replace the user pool`);
    }
    merged.set(pool.id, pool);
  }
  const pools = [...merged.values()].map(({ override: _override, ...pool }) => pool);
  if (pools.length === 0) return { format: poolsFormat, pools: [] };
  const defaultPool = local?.default_pool ?? base?.default_pool;
  if (!defaultPool || !pools.some((pool) => pool.id === defaultPool)) throw new Error("merged pools need a valid default_pool");
  return { format: poolsFormat, default_pool: defaultPool, pools };
}

type FileSnapshot = {
  path: string;
  contents?: Uint8Array;
  parentExisted: boolean;
};

type PendingDirectoryInstall = {
  commit: () => void;
  rollback: () => void;
};

type DirectoryInstallOptions = {
  sourceRecord?: Record<string, unknown>;
  prepare?: (staged: string) => void;
};

class ExtensionMutation {
  private readonly directoryInstalls: PendingDirectoryInstall[] = [];
  private readonly root: string;
  private snapshots?: FileSnapshot[];
  private metadataTouched = false;

  constructor(root: string) {
    this.root = root;
  }

  installDirectory(
    source: string,
    destination: string,
    options: DirectoryInstallOptions = {},
  ): void {
    this.directoryInstalls.push(stageDirectoryInstall(source, destination, options, () => this.captureMetadata()));
  }

  writeMetadata(write: () => void): void {
    this.metadataTouched = true;
    write();
  }

  commit(): void {
    for (const install of this.directoryInstalls) install.commit();
  }

  rollback(error: unknown): never {
    const failures: string[] = [];
    for (const install of [...this.directoryInstalls].reverse()) {
      try {
        install.rollback();
      } catch (rollbackError) {
        failures.push(errorMessage(rollbackError));
      }
    }
    if (this.metadataTouched) {
      for (const snapshot of [...(this.snapshots ?? [])].reverse()) {
        try {
          restoreFileSnapshot(snapshot);
        } catch (rollbackError) {
          failures.push(errorMessage(rollbackError));
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`${errorMessage(error)}; rollback failed: ${failures.join("; ")}`);
    }
    throw error;
  }

  private captureMetadata(): void {
    this.snapshots ??= [
      snapshotFile(join(this.root, "package.json")),
      snapshotFile(join(this.root, ".agulater", "sources.json")),
    ];
  }
}

export function addExtension(
  agentsRoot: string,
  source: string,
  requestedType?: ExtensionType,
  requestedName?: string,
  options: { home?: string; prepare?: boolean } = {},
): ExtensionResult {
  const root = resolve(agentsRoot);
  const mutation = new ExtensionMutation(root);
  try {
    const result = withSource(source, (sourceRoot, sourceRecord) => {
      const candidate = selectCandidate(sourceRoot, requestedType, requestedName);
      const recordedSource = sourceRecord.type === "path"
        ? { type: "path" as const, path: recordedSourcePath(root, sourceRecord.path) }
        : sourceRecord;
      return installExtension(root, candidate, requestedName, recordedSource, mutation);
    });
    if (options.prepare !== false) prepare(root, { ...(options.home ? { home: options.home } : {}) });
    mutation.commit();
    return result;
  } catch (error) {
    return mutation.rollback(error);
  }
}

export async function addCatalogExtension(
  agentsRoot: string,
  catalogId: string,
  entryId: string,
  requestedType?: ExtensionType,
  options: { home?: string; prepare?: boolean; range?: string } = {},
): Promise<ExtensionResult> {
  const root = resolve(agentsRoot);
  const home = resolve(options.home ?? homedir());
  const mutation = new ExtensionMutation(root);
  try {
    const result = await installCatalogExtension(root, catalogId, entryId, requestedType, options.range ?? "*", home, mutation);
    if (options.prepare !== false) prepare(root, { home });
    mutation.commit();
    return result;
  } catch (error) {
    return mutation.rollback(error);
  }
}

async function installCatalogExtension(
  root: string,
  catalogId: string,
  entryId: string,
  requestedType: ExtensionType | undefined,
  range: string,
  home: string,
  mutation: ExtensionMutation,
): Promise<ExtensionResult> {
  const catalog = await cachedCatalog(home, catalogName(catalogId, "catalog id"), true);
  const matches = catalog.entries.filter((entry) => entry.id === packageId(entryId, "catalog entry") && (!requestedType || entry.kind === requestedType));
  if (matches.length === 0) throw new Error(`catalog ${catalogId} does not contain ${requestedType ? `${requestedType}:` : ""}${entryId}`);
  if (matches.length > 1) throw new Error(`catalog ${catalogId} contains several extensions named ${entryId}; add --type`);
  const entry = matches[0]!;
  const selected = latestStableVersion(entry, range);
  return withGitCheckout(selected.source, (checkout) => {
    const sourceRoot = selected.source.subdir
      ? resolveInside(checkout, selected.source.subdir, `${entry.id}.source.subdir`)
      : checkout;
    const candidate = selectCandidate(sourceRoot, entry.kind, entry.id);
    if (candidate.version !== selected.version && candidate.type === "package") {
      throw new Error(`${entry.kind}:${entry.id} source version ${candidate.version} does not match ${selected.version}`);
    }
    return installExtension(
      root,
      { ...candidate, version: selected.version },
      entry.id,
      { type: "catalog", catalog: catalogId, entry: entry.id },
      mutation,
    );
  });
}

export async function updateExtensions(
  agentsRoot: string,
  options: { id?: string; all?: boolean; type?: ExtensionType; home?: string } = {},
): Promise<ExtensionResult[]> {
  const root = resolve(agentsRoot);
  const home = resolve(options.home ?? homedir());
  const matched = readSourceRecords(root).filter((record) => {
    if (options.type && record.type !== options.type) return false;
    return options.all || record.id === options.id;
  });
  if (!options.all && !options.id) throw new Error("update needs an extension id or --all");
  if (matched.length === 0) throw new Error(options.all ? "no managed extensions to update" : `extension not found: ${options.id}`);
  if (!options.type && !options.all && matched.length > 1) {
    throw new Error(`more than one extension is named ${options.id}; add --type`);
  }
  const records = options.all ? matched.filter((record) => record.source.type !== "path") : matched;
  if (records.length === 0) return [];
  const catalogs = [...new Set(records.flatMap((record) => record.source.type === "catalog" ? [record.source.catalog] : []))];
  for (const catalog of catalogs) await refreshCatalogs(home, catalog);
  const mutation = new ExtensionMutation(root);
  const results: ExtensionResult[] = [];
  try {
    for (const record of records) {
      if (record.source.type === "catalog") {
        results.push(await installCatalogExtension(
          root,
          record.source.catalog,
          record.source.entry,
          record.type,
          `^${record.version}`,
          home,
          mutation,
        ));
        continue;
      }
      if (record.source.type === "git") {
        results.push(withGitCheckout(record.source, (checkout) => {
          const sourceRoot = record.source.type === "git" && record.source.subdir
            ? resolveInside(checkout, record.source.subdir, `${record.id}.source.subdir`)
            : checkout;
          const candidate = selectCandidate(sourceRoot, record.type, record.id);
          return installExtension(root, candidate, record.id, record.source, mutation);
        }));
        continue;
      }
      const sourceRoot = isAbsolute(record.source.path)
        ? resolve(record.source.path)
        : resolve(root, ...record.source.path.split("/"));
      requireDirectory(sourceRoot, "extension source not found");
      const candidate = selectCandidate(sourceRoot, record.type, record.id);
      results.push(installExtension(root, candidate, record.id, record.source, mutation));
    }
    prepare(root, { home });
    mutation.commit();
    return results;
  } catch (error) {
    return mutation.rollback(error);
  }
}

function installExtension(
  root: string,
  candidate: Candidate,
  requestedName: string | undefined,
  source: SourceRecord["source"],
  mutation: ExtensionMutation,
): ExtensionResult {
  const manifest = readPackage(root);
  const name = packageId(candidate.type === "package" ? candidate.name : requestedName ?? candidate.name, "extension name");
  const plural = `${candidate.type}s`;
  const relativePath = `resources/${plural}/${name}`;
  const destination = join(root, ...relativePath.split("/"));
  mutation.installDirectory(candidate.path, destination, {
    prepare: candidate.type === "package"
      ? (staged) => vendorPackageResources(staged, candidate.path)
      : undefined,
  });
  manifest.resources ??= {};
  if (candidate.type === "package") {
    manifest.resources.packages = [
      ...(manifest.resources.packages ?? []).filter((entry) => entry.path !== relativePath),
      { path: relativePath },
    ];
  } else if (candidate.type === "skill") {
    manifest.resources.skills = [
      ...(manifest.resources.skills ?? []).filter((entry) => entry.id !== name),
      { id: name, path: relativePath },
    ];
  } else {
    manifest.resources.plugins = [
      ...(manifest.resources.plugins ?? []).filter((entry) => entry.id !== name),
      { id: name, path: relativePath },
    ];
  }
  mutation.writeMetadata(() => {
    writePackage(root, manifest);
    recordSource(root, { id: name, type: candidate.type, version: candidate.version, source, path: relativePath });
  });
  return { name, type: candidate.type, path: destination, version: candidate.version };
}

export function removeExtension(agentsRoot: string, name: string, requestedType?: ExtensionType): ExtensionResult {
  const root = resolve(agentsRoot);
  const manifest = readPackage(root);
  const id = packageId(name, "extension name");
  const matches: Array<{ type: ExtensionType; path: string; locator: string; version: string }> = [];
  if (!requestedType || requestedType === "skill") {
    const entry = manifest.resources?.skills?.find((item) => item.id === id);
    if (entry) matches.push({ type: "skill", path: resolveInside(root, entry.path, "skill path"), locator: entry.path, version: manifest.version });
  }
  if (!requestedType || requestedType === "plugin") {
    const entry = manifest.resources?.plugins?.find((item) => item.id === id);
    if (entry) matches.push({ type: "plugin", path: resolveInside(root, entry.path, "plugin path"), locator: entry.path, version: manifest.version });
  }
  if (!requestedType || requestedType === "package") {
    for (const entry of manifest.resources?.packages ?? []) {
      const path = resolveInside(root, entry.path, "package path");
      if (existsSync(join(path, "package.json"))) {
        const child = readPackage(path);
        if (child.id === id) matches.push({ type: "package", path, locator: entry.path, version: child.version });
      }
    }
  }
  if (matches.length === 0) throw new Error(`extension not found: ${id}`);
  if (matches.length > 1) throw new Error(`more than one extension is named ${id}; add --type`);
  const match = matches[0]!;
  if (match.type === "skill") manifest.resources!.skills = manifest.resources!.skills!.filter((entry) => entry.id !== id);
  if (match.type === "plugin") manifest.resources!.plugins = manifest.resources!.plugins!.filter((entry) => entry.id !== id);
  if (match.type === "package") manifest.resources!.packages = manifest.resources!.packages!.filter((entry) => entry.path !== match.locator);
  writePackage(root, manifest);
  rmSync(match.path, { recursive: true, force: true });
  removeSourceRecord(root, match.type, id);
  prepare(root);
  return { name: id, type: match.type, path: match.path, version: match.version };
}

export function removeManagedExtensions(agentsRoot: string, type: ExtensionType): ExtensionResult[] {
  const root = resolve(agentsRoot);
  const managed = readSourceRecords(root).filter((record) => record.type === type);
  return managed.map((record) => removeExtension(root, record.id, type));
}

function parsePackage(value: unknown, label: string): AgentPackage {
  if (isRecord(value) && value.format !== packageFormat) {
    throw new Error(`${label} format must be ${packageFormat}; legacy packages are not accepted`);
  }
  assertPackageSchema(value, label);
  const record = value as Record<string, unknown>;
  const manifest: AgentPackage = {
    format: packageFormat,
    id: packageId(record.id, `${label}.id`),
    version: semanticVersion(record.version, `${label}.version`),
    description: nonEmptyString(record.description, `${label}.description`),
    instructions: packageLocator(record.instructions, `${label}.instructions`),
  };
  if (record.resources !== undefined) manifest.resources = parseResources(record.resources, `${label}.resources`);
  if (record.dependencies !== undefined) manifest.dependencies = parseDependencies(record.dependencies, `${label}.dependencies`);
  if (record.profile !== undefined) manifest.profile = parseProfile(record.profile, `${label}.profile`);
  return manifest;
}

function parseResources(value: unknown, label: string): NonNullable<AgentPackage["resources"]> {
  const record = value as Record<string, unknown>;
  const result: NonNullable<AgentPackage["resources"]> = {};
  if (record.skills !== undefined) result.skills = resourceEntries(record.skills, `${label}.skills`);
  if (record.plugins !== undefined) result.plugins = resourceEntries(record.plugins, `${label}.plugins`);
  if (record.contexts !== undefined) {
    result.contexts = (record.contexts as unknown[]).map((value, index) => {
      const entryLabel = `${label}.contexts[${index}]`;
      const entry = value as Record<string, unknown>;
      return {
        id: packageId(entry.id, `${entryLabel}.id`),
        description: nonEmptyString(entry.description, `${entryLabel}.description`),
        path: packageLocator(entry.path, `${entryLabel}.path`),
        load: enumeration(entry.load, ["eager", "on_demand"] as const, `${entryLabel}.load`),
      };
    });
    uniqueBy(result.contexts, (entry) => entry.id, `${label}.contexts`);
  }
  if (record.packages !== undefined) {
    result.packages = (record.packages as unknown[]).map((value, index) => {
      const entryLabel = `${label}.packages[${index}]`;
      const entry = value as Record<string, unknown>;
      return { path: packageLocator(entry.path, `${entryLabel}.path`, true) };
    });
  }
  return result;
}

function resourceEntries(value: unknown, label: string): ResourceEntry[] {
  const entries = (value as unknown[]).map((value, index) => {
    const entryLabel = `${label}[${index}]`;
    const entry = value as Record<string, unknown>;
    return { id: packageId(entry.id, `${entryLabel}.id`), path: packageLocator(entry.path, `${entryLabel}.path`, true) };
  });
  uniqueBy(entries, (entry) => entry.id, label);
  return entries;
}

function parseDependencies(value: unknown, label: string): NonNullable<AgentPackage["dependencies"]> {
  const record = value as Record<string, unknown>;
  const result: NonNullable<AgentPackage["dependencies"]> = {};
  for (const key of ["skills", "plugins", "packages"] as const) {
    if (record[key] === undefined) continue;
    result[key] = (record[key] as unknown[]).map((entry, index) => parseDependency(entry, `${label}.${key}[${index}]`));
    uniqueBy(result[key]!, (entry) => entry.alias ?? entry.id, `${label}.${key}`);
  }
  return result;
}

function parseDependency(value: unknown, label: string): Dependency {
  const record = value as Record<string, unknown>;
  const result: Dependency = { id: packageId(record.id, `${label}.id`) };
  if (record.version !== undefined) result.version = versionRange(record.version, `${label}.version`);
  if (record.alias !== undefined) result.alias = packageId(record.alias, `${label}.alias`);
  if (record.source !== undefined) result.source = parseDependencySource(record.source, `${label}.source`);
  return result;
}

function parseDependencySource(value: unknown, label: string): DependencySource {
  const record = value as Record<string, unknown>;
  const type = record.type as string;
  if (type === "catalog" || type === "host") {
    return { type };
  }
  if (type === "path") {
    return { type, path: packageLocator(record.path, `${label}.path`, true) };
  }
  if (type === "git") {
    const url = nonEmptyString(record.url, `${label}.url`);
    if (!isGitUrl(url)) throw new Error(`${label}.url must be a Git URL`);
    const subdir = record.subdir === undefined ? undefined : packageLocator(record.subdir, `${label}.subdir`);
    const ref = record.ref === undefined ? undefined : nonEmptyString(record.ref, `${label}.ref`);
    return { type, url, ...(subdir ? { subdir } : {}), ...(ref ? { ref } : {}) };
  }
  throw new Error(`${label}.type must be catalog, host, path, or git`);
}

function parseProfile(value: unknown, label: string): NonNullable<AgentPackage["profile"]> {
  const record = value as Record<string, unknown>;
  return {
    accepts: stringArray(record.accepts, `${label}.accepts`, true),
    workspace_effect: enumeration(record.workspace_effect, ["read", "write"] as const, `${label}.workspace_effect`),
    contexts: idArray(record.contexts, `${label}.contexts`),
    harness: packageLocator(record.harness, `${label}.harness`),
  };
}

function parsePool(value: unknown, label: string): Pool {
  const engine = enumeration(
    objectDiscriminator(value, label, "engine"),
    ["native", "codex"] as const,
    `${label}.engine`,
  );
  const commonFields = [
    "id",
    "engine",
    "description",
    "labels",
    "reasoning_effort",
    "capabilities",
    "max_concurrency",
    "request_timeout_seconds",
    "override",
  ];
  const engineFields = engine === "native"
    ? ["provider", "endpoint", "model", "api_key_env", "context_window"]
    : ["model", "codex_command", "context_window"];
  const engineRequired = engine === "native"
    ? ["provider", "endpoint", "model", "context_window"]
    : [];
  const record = strictObject(
    value,
    label,
    [...commonFields, ...engineFields],
    [
      "id",
      "engine",
      "capabilities",
      "max_concurrency",
      "request_timeout_seconds",
      ...engineRequired,
    ],
  );
  const common: PoolCommon = {
    id: packageId(record.id, `${label}.id`),
    capabilities: stringArray(record.capabilities, `${label}.capabilities`),
    max_concurrency: positiveInteger(record.max_concurrency, `${label}.max_concurrency`),
    request_timeout_seconds: positiveInteger(record.request_timeout_seconds, `${label}.request_timeout_seconds`),
  };
  if (record.description !== undefined) common.description = nonEmptyString(record.description, `${label}.description`);
  if (record.labels !== undefined) common.labels = stringArray(record.labels, `${label}.labels`);
  if (record.reasoning_effort !== undefined) common.reasoning_effort = nonEmptyString(record.reasoning_effort, `${label}.reasoning_effort`);
  if (record.override !== undefined) common.override = boolean(record.override, `${label}.override`);

  if (engine === "codex") {
    const pool: CodexPool = { ...common, engine };
    if (record.model !== undefined) pool.model = nonEmptyString(record.model, `${label}.model`);
    if (record.codex_command !== undefined) pool.codex_command = nonEmptyString(record.codex_command, `${label}.codex_command`);
    if (record.context_window !== undefined) pool.context_window = positiveInteger(record.context_window, `${label}.context_window`);
    return pool;
  }

  const pool: NativePool = {
    ...common,
    engine,
    provider: nonEmptyString(record.provider, `${label}.provider`),
    endpoint: nonEmptyString(record.endpoint, `${label}.endpoint`),
    model: nonEmptyString(record.model, `${label}.model`),
    context_window: positiveInteger(record.context_window, `${label}.context_window`),
  };
  if (record.api_key_env !== undefined) {
    const variable = nonEmptyString(record.api_key_env, `${label}.api_key_env`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new Error(`${label}.api_key_env is invalid`);
    pool.api_key_env = variable;
  }
  return pool;
}

function initializePackage(root: string, rawName: string, description?: string, home?: string): void {
  const id = packageId(slug(rawName), "assistant id");
  mkdirSync(root, { recursive: true });
  const manifest: AgentPackage = {
    format: packageFormat,
    id,
    version: "0.1.0",
    description: description ?? `Assistant for ${rawName.trim()}`,
    instructions: "AGENTS.md",
  };
  writePackage(root, manifest);
  const instructionsPath = join(root, "AGENTS.md");
  if (!existsSync(instructionsPath)) {
    writeFileSync(instructionsPath, defaultInstructions(rawName.trim()), "utf8");
  }
  prepare(root, { ...(home ? { home } : {}) });
}

function defaultUserManifest(): AgentPackage {
  return {
    format: packageFormat,
    id: "user-assistant",
    version: "0.1.0",
    description: "General user assistant for Agul",
    instructions: "AGENTS.md",
  };
}

function isGeneratedUserV1(root: string, value: Record<string, unknown>): boolean {
  const expected = {
    format: "agulater/package/v1",
    name: "user-assistant",
    version: "0.1.0",
    instructions: "AGENTS.md",
    skills: "skills",
    plugins: "plugins",
    agents: "agents",
  };
  if (Object.keys(value).length !== Object.keys(expected).length) return false;
  if (Object.entries(expected).some(([key, item]) => value[key] !== item)) return false;
  if (["skills", "plugins", "agents"].some((name) => {
    const path = join(root, name);
    return existsSync(path) && readdirSync(path).length > 0;
  })) return false;
  const instructions = join(root, "AGENTS.md");
  return existsSync(instructions)
    && readFileSync(instructions, "utf8") === defaultInstructions("user-assistant");
}

function defaultInstructions(name: string): string {
  return `# ${name}\n\nHelp with tasks in this directory. Read the existing files, make the requested changes, and verify the result.\n`;
}

function withSource<T>(
  source: string,
  use: (root: string, source: { type: "path"; path: string } | { type: "git"; url: string }) => T,
): T {
  const localPath = resolve(source);
  if (existsSync(localPath)) {
    requireDirectory(localPath, "extension source must be a directory");
    return use(localPath, { type: "path", path: localPath });
  }
  if (!isGitUrl(source)) throw new Error(`extension source not found: ${source}`);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agulater-source-"));
  const checkout = join(temporaryRoot, "source");
  try {
    cloneRepository({ type: "git", url: source }, checkout);
    return use(checkout, { type: "git", url: source });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function selectCandidate(sourceRoot: string, requestedType?: ExtensionType, requestedName?: string): Candidate {
  const includeDeclaredResources = requestedName !== undefined
    || requestedType === "skill"
    || requestedType === "plugin";
  let candidates = collectCandidates(candidateSourceRoot(sourceRoot), includeDeclaredResources);
  if (requestedType) candidates = candidates.filter((candidate) => candidate.type === requestedType);
  if (requestedName) candidates = candidates.filter((candidate) => candidate.name === requestedName || basename(candidate.path) === requestedName);
  if (candidates.length === 0) throw new Error("no matching skill, plugin, or package found in the source");
  if (candidates.length > 1) {
    const choices = candidates.slice(0, 8).map((candidate) => `${candidate.type}:${candidate.name}`).join(", ");
    throw new Error(`source contains several extensions (${choices}); add --type and --name`);
  }
  return candidates[0]!;
}

function collectCandidates(sourceRoot: string, includeDeclaredResources = false): Candidate[] {
  const candidates = new Map<string, { candidate: Candidate; declared: boolean }>();
  const addCandidate = (candidate: Candidate, declared = false): void => {
    const key = JSON.stringify([candidate.type, candidate.name, resolve(candidate.path)]);
    const existing = candidates.get(key);
    if (!existing || (declared && !existing.declared)) candidates.set(key, { candidate, declared });
  };
  const visit = (directory: string, depth: number): void => {
    if (depth > 8) return;
    if (existsSync(join(directory, "package.json"))) {
      try {
        const manifest = readPackage(directory);
        addCandidate({ name: manifest.id, type: "package", path: directory, version: manifest.version }, true);
        if (includeDeclaredResources) {
          for (const candidate of packageResourceCandidates(directory, manifest)) addCandidate(candidate, true);
        }
        return;
      } catch (error) {
        const value = tryReadJson(join(directory, "package.json"));
        if (isRecord(value) && typeof value.format === "string" && value.format.startsWith("agulater/package/")) throw error;
      }
    }
    if (existsSync(join(directory, "SKILL.md"))) {
      addCandidate({ name: readSkillField(join(directory, "SKILL.md"), "name") ?? basename(directory), type: "skill", path: directory, version: readSkillField(join(directory, "SKILL.md"), "version") ?? "0.1.0" });
      return;
    }
    const pluginFile = [join(directory, ".codex-plugin", "plugin.json"), join(directory, "plugin.json")].find(existsSync);
    if (pluginFile) {
      addCandidate({ name: readJsonField(pluginFile, "name") ?? basename(directory), type: "plugin", path: directory, version: readJsonField(pluginFile, "version") ?? "0.1.0" });
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ![".git", ".codex-plugin", "node_modules", "runtime"].includes(entry.name)) visit(join(directory, entry.name), depth + 1);
    }
  };
  visit(resolve(sourceRoot), 0);
  return [...candidates.values()].map((entry) => entry.candidate);
}

function candidateSourceRoot(sourceRoot: string): string {
  const root = resolve(sourceRoot);
  if (hasPackageFormat(root)) return root;
  const collectionRoot = join(root, ".agents");
  return hasPackageFormat(collectionRoot) ? collectionRoot : root;
}

function hasPackageFormat(root: string): boolean {
  const manifest = tryReadJson(join(root, "package.json"));
  return isRecord(manifest) && manifest.format === packageFormat;
}

function packageResourceCandidates(root: string, manifest: AgentPackage): Candidate[] {
  const candidates: Candidate[] = [];
  for (const type of ["skill", "plugin"] as const) {
    for (const entry of localResources(root, manifest, type)) {
      candidates.push({ name: entry.id, type, path: entry.sourcePath, version: entry.version });
    }
  }
  for (const entry of manifest.resources?.packages ?? []) {
    const path = resolveRelativeSource(root, entry.path);
    requireDirectory(path, "package resource not found");
    const child = readPackage(path);
    candidates.push({ name: child.id, type: "package", path, version: child.version });
  }
  return candidates;
}

function collectLegacyAgentDirectories(root: string): string[] {
  const results: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 8) return;
    if (existsSync(join(directory, "AGENTS.md"))) {
      results.push(directory);
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ![".git", "node_modules", "runtime"].includes(entry.name)) {
        visit(join(directory, entry.name), depth + 1);
      }
    }
  };
  visit(root, 0);
  return results;
}

export function listCatalogs(home = homedir()): CatalogListResult {
  const root = userAgentsRoot(home);
  const catalogs = readCatalogRegistry(root).map((registration) => {
    const cache = catalogCachePath(root, registration.id);
    const catalog = existsSync(cache) ? readCatalog(cache) : undefined;
    return { ...registration, cached: Boolean(catalog), entries: catalog?.entries.length ?? 0 };
  });
  return { format: catalogListFormat, catalogs };
}

export function setCatalog(home: string, id: string, url: string): CatalogListResult {
  const root = userAgentsRoot(home);
  if (!existsSync(join(root, "package.json"))) {
    setupUser(home);
    if (!existsSync(join(root, "package.json"))) throw new Error(`existing unmanaged directory was not changed: ${root}`);
  }
  const catalogId = catalogName(id, "catalog id");
  const rawSource = nonEmptyString(url, "catalog url");
  const source = localCatalogPath(rawSource) ?? rawSource;
  const previous = readCatalogRegistry(root).find((catalog) => catalog.id === catalogId);
  const catalogs = [
    ...readCatalogRegistry(root).filter((catalog) => catalog.id !== catalogId),
    { id: catalogId, url: source },
  ].sort((left, right) => left.id.localeCompare(right.id));
  atomicWriteJson(join(root, ".agulater", "catalogs.json"), { format: catalogRegistryFormat, catalogs });
  if (previous?.url !== source) rmSync(catalogCachePath(root, catalogId), { force: true });
  return listCatalogs(home);
}

export function removeCatalog(home: string, id: string): CatalogListResult {
  const root = userAgentsRoot(home);
  const catalogId = catalogName(id, "catalog id");
  const existing = readCatalogRegistry(root);
  if (!existing.some((catalog) => catalog.id === catalogId)) throw new Error(`catalog is not registered: ${catalogId}`);
  const catalogs = existing.filter((catalog) => catalog.id !== catalogId);
  atomicWriteJson(join(root, ".agulater", "catalogs.json"), { format: catalogRegistryFormat, catalogs });
  rmSync(catalogCachePath(root, catalogId), { force: true });
  return listCatalogs(home);
}

export async function refreshCatalogs(home = homedir(), requestedId?: string): Promise<CatalogListResult> {
  const root = userAgentsRoot(home);
  const registrations = readCatalogRegistry(root);
  const selected = requestedId
    ? registrations.filter((registration) => registration.id === catalogName(requestedId, "catalog id"))
    : registrations;
  if (requestedId && selected.length === 0) throw new Error(`catalog is not registered: ${requestedId}`);
  for (const registration of selected) {
    const catalog = await readCatalogSource(registration.url);
    atomicWriteJson(catalogCachePath(root, registration.id), { format: catalogFormat, entries: catalog.entries });
  }
  return listCatalogs(home);
}

export function searchCatalogs(home = homedir(), query = ""): CatalogSearchResult[] {
  const normalized = query.trim().toLowerCase();
  const results: CatalogSearchResult[] = [];
  for (const registration of readCatalogRegistry(userAgentsRoot(home))) {
    const cache = catalogCachePath(userAgentsRoot(home), registration.id);
    if (!existsSync(cache)) continue;
    for (const entry of readCatalog(cache).entries) {
      const haystack = `${entry.id}\n${entry.kind}\n${entry.description}`.toLowerCase();
      if (normalized && !haystack.includes(normalized)) continue;
      const selected = latestStableVersion(entry, "*");
      results.push({
        catalog: registration.id,
        id: entry.id,
        type: entry.kind,
        description: entry.description,
        version: selected.version,
      });
    }
  }
  return results.sort((left, right) => `${left.catalog}:${left.id}:${left.type}`.localeCompare(`${right.catalog}:${right.id}:${right.type}`));
}

export function readCatalog(path: string): Catalog {
  return parseCatalog(readJson(path, "catalog"), path);
}

function parseCatalog(value: unknown, label: string): Catalog {
  const record = strictObject(value, label, ["format", "entries"], ["format", "entries"]);
  if (record.format !== catalogFormat) throw new Error(`${label}.format must be ${catalogFormat}`);
  const entries = array(record.entries, `${label}.entries`).map((value, index) => {
    const entryLabel = `${label}.entries[${index}]`;
    const entry = strictObject(value, entryLabel, ["id", "kind", "description", "versions"], ["id", "kind", "description", "versions"]);
    const description = nonEmptyString(entry.description, `${entryLabel}.description`);
    const kind = enumeration(entry.kind, extensionTypes, `${entryLabel}.kind`);
    const versions = array(entry.versions, `${entryLabel}.versions`).map((versionValue, versionIndex) => {
      const versionLabel = `${entryLabel}.versions[${versionIndex}]`;
      const versionRecord = strictObject(versionValue, versionLabel, ["version", "source"], ["version", "source"]);
      let source = parseDependencySource(versionRecord.source, `${versionLabel}.source`);
      if (source.type !== "git") throw new Error(`${versionLabel}.source.type must be git`);
      const version = semanticVersion(versionRecord.version, `${versionLabel}.version`);
      if (!source.ref) throw new Error(`${versionLabel}.source.ref is required`);
      if (!version.includes("-")) source = { ...source, ref: immutableCatalogTag(source.ref, `${versionLabel}.source.ref`) };
      return { version, source };
    });
    uniqueBy(versions, (version) => version.version, `${entryLabel}.versions`);
    if (versions.length === 0) throw new Error(`${entryLabel}.versions must not be empty`);
    return { id: packageId(entry.id, `${entryLabel}.id`), kind, description, versions };
  });
  uniqueBy(entries, (entry) => `${entry.kind}:${entry.id}`, `${label}.entries`);
  return { entries };
}

function latestStableVersion(
  entry: CatalogEntry,
  range: string,
): { version: string; source: Extract<DependencySource, { type: "git" }> } {
  const selected = entry.versions
    .filter((item) => !item.version.includes("-") && satisfiesVersion(item.version, range))
    .sort((left, right) => compareVersions(left.version, right.version))
    .at(-1);
  if (!selected) throw new Error(`catalog has no stable ${entry.kind}:${entry.id} satisfying ${range}`);
  return selected;
}

function ensureCatalogRegistry(root: string): void {
  const path = join(root, ".agulater", "catalogs.json");
  if (existsSync(path)) {
    readCatalogRegistry(root);
    return;
  }
  const url = process.env.AGULATER_AGENTKUBE_CATALOG?.trim() || defaultAgentKubeCatalog;
  atomicWriteJson(path, {
    format: catalogRegistryFormat,
    catalogs: [{ id: "agentkube", url }],
  });
}

function readCatalogRegistry(root: string): CatalogRegistration[] {
  const path = join(resolve(root), ".agulater", "catalogs.json");
  if (!existsSync(path)) return [];
  const record = strictObject(readJson(path, "catalog registry"), path, ["format", "catalogs"], ["format", "catalogs"]);
  if (record.format !== catalogRegistryFormat) throw new Error(`${path}.format must be ${catalogRegistryFormat}`);
  const catalogs = array(record.catalogs, `${path}.catalogs`).map((value, index) => {
    const label = `${path}.catalogs[${index}]`;
    const catalog = strictObject(value, label, ["id", "url"], ["id", "url"]);
    return { id: catalogName(catalog.id, `${label}.id`), url: nonEmptyString(catalog.url, `${label}.url`) };
  });
  uniqueBy(catalogs, (catalog) => catalog.id, `${path}.catalogs`);
  return catalogs;
}

async function cachedCatalog(home: string, id: string, refreshIfMissing: boolean): Promise<Catalog> {
  const root = userAgentsRoot(home);
  let cache = catalogCachePath(root, id);
  if (!existsSync(cache) && refreshIfMissing) {
    await refreshCatalogs(home, id);
    cache = catalogCachePath(root, id);
  }
  if (!existsSync(cache)) throw new Error(`catalog ${id} is not cached; run agulater catalog refresh`);
  return readCatalog(cache);
}

function catalogCachePath(root: string, id: string): string {
  return join(root, ".agulater", "catalogs", `${safeFileId(id)}.json`);
}

async function readCatalogSource(source: string): Promise<Catalog> {
  const local = localCatalogPath(source);
  if (local) return readCatalog(local);
  const privateGitHub = source.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (privateGitHub) {
    const [, owner, repository, ref, path] = privateGitHub;
    const gh = authenticatedGitHubCli();
    if (gh) {
      const result = Bun.spawnSync([
        gh,
        "api",
        `repos/${owner}/${repository}/contents/${path}?ref=${encodeURIComponent(ref!)}`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ], { stdout: "pipe", stderr: "pipe" });
      if (result.exitCode === 0) return parseCatalog(JSON.parse(result.stdout.toString()), source);
    }
  }
  const response = await fetch(source, { headers: { "User-Agent": "agulater" } });
  if (!response.ok) throw new Error(`cannot refresh catalog ${source}: HTTP ${response.status}`);
  return parseCatalog(await response.json(), source);
}

function localCatalogPath(source: string): string | undefined {
  if (source.startsWith("file://")) {
    const path = decodeURIComponent(new URL(source).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
    return existsSync(path) ? path : undefined;
  }
  const path = resolve(source);
  return existsSync(path) ? path : undefined;
}

function immutableCatalogTag(ref: string, label: string): string {
  if (ref.startsWith("refs/tags/") && ref.length > "refs/tags/".length) return ref;
  if (ref.startsWith("refs/")) throw new Error(`${label} must name a Git tag for a stable version`);
  if (["head", "main", "master", "dev", "develop", "next", "latest", "release", "stable", "trunk"].includes(ref.toLowerCase())) {
    throw new Error(`${label} must name an immutable tag for a stable version`);
  }
  if (ref.includes("..") || /[\s~^:?*[\]\\]/.test(ref) || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".")) {
    throw new Error(`${label} is not a valid Git tag`);
  }
  return `refs/tags/${ref}`;
}

function selectCatalogVersion(
  catalog: Catalog | undefined,
  catalogPath: string | undefined,
  type: ExtensionType,
  dependency: Dependency,
): { version: string; source: Extract<DependencySource, { type: "git" }> } {
  if (!catalog) throw new Error(`catalog dependency ${type}:${dependency.id} needs --catalog`);
  const entry = catalog.entries.find((item) => item.kind === type && item.id === dependency.id);
  if (!entry) throw new Error(`catalog ${catalogPath} does not contain ${type}:${dependency.id}`);
  const range = dependency.version ?? "*";
  const allowPrerelease = range.includes("-");
  const selected = allowPrerelease
    ? entry.versions.filter((item) => satisfiesVersion(item.version, range)).sort((a, b) => compareVersions(a.version, b.version)).at(-1)
    : latestStableVersion(entry, range);
  if (!selected) throw new Error(`catalog has no stable ${type}:${dependency.id} satisfying ${range}`);
  return selected;
}

function installGitDependency(
  store: string,
  type: ExtensionType,
  dependency: Dependency,
  source: Extract<DependencySource, { type: "git" }>,
  selectedVersion?: string,
): { id: string; type: ExtensionType; version: string; path: string } {
  return withGitCheckout(source, (checkout) => {
    const sourceRoot = source.subdir ? resolveInside(checkout, source.subdir, `${dependency.id}.source.subdir`) : checkout;
    const candidate = selectCandidate(sourceRoot, type, dependency.id);
    const version = selectedVersion ?? candidate.version;
    if (!isSemanticVersion(version)) throw new Error(`cannot determine an exact version for ${type}:${dependency.id}`);
    if (candidate.version !== version && candidate.type === "package") {
      throw new Error(`${type}:${dependency.id} source version ${candidate.version} does not match ${version}`);
    }
    if (dependency.version && !satisfiesVersion(version, dependency.version)) {
      throw new Error(`${type}:${dependency.id} ${version} does not satisfy ${dependency.version}`);
    }
    const destination = join(store, type, ...dependency.id.split("/"), version);
    installDirectory(candidate.path, destination, {
      sourceRecord: {
        format: "agulater/store-source/v1",
        id: dependency.id,
        type,
        version,
        source,
      },
      prepare: type === "package"
        ? (staged) => vendorPackageResources(staged, candidate.path)
        : undefined,
    });
    return { id: dependency.id, type, version, path: destination };
  });
}

function withGitCheckout<T>(source: Extract<DependencySource, { type: "git" }>, use: (root: string) => T): T {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agulater-sync-"));
  const checkout = join(temporaryRoot, "source");
  try {
    const refCheckedOut = cloneRepository(source, checkout);
    if (source.ref && !refCheckedOut) {
      const fetch = Bun.spawnSync(["git", "fetch", "--depth", "1", "--quiet", "origin", source.ref], { cwd: checkout, stdout: "pipe", stderr: "pipe" });
      if (fetch.exitCode !== 0) throw new Error(`cannot fetch ${source.ref}: ${fetch.stderr.toString().trim() || `git exited with ${fetch.exitCode}`}`);
      const checkoutResult = Bun.spawnSync(["git", "checkout", "--quiet", "FETCH_HEAD"], { cwd: checkout, stdout: "pipe", stderr: "pipe" });
      if (checkoutResult.exitCode !== 0) throw new Error(`cannot checkout ${source.ref}: ${checkoutResult.stderr.toString().trim()}`);
    }
    return use(checkout);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function cloneRepository(source: Extract<DependencySource, { type: "git" }>, checkout: string): boolean {
  const branch = source.ref ? cloneBranch(source.ref) : undefined;
  const repository = githubRepository(source.url);
  const gh = repository ? authenticatedGitHubCli() : undefined;
  if (gh) {
    checkoutGitHubArchive(gh, repository!, source.ref, checkout);
    return Boolean(source.ref);
  }
  const command = [
    "git",
    "clone",
    "--depth",
    "1",
    "--quiet",
    ...(branch ? ["--branch", branch] : []),
    source.url,
    checkout,
  ];
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || `git exited with ${result.exitCode}`;
    throw new Error(`cannot clone ${source.url}: ${detail}`);
  }
  if (source.ref?.startsWith("refs/tags/")) {
    const tag = Bun.spawnSync(["git", "show-ref", "--verify", source.ref], { cwd: checkout, stdout: "ignore", stderr: "pipe" });
    if (tag.exitCode !== 0) throw new Error(`catalog ref is not a Git tag: ${source.ref.slice("refs/tags/".length)}`);
  }
  return Boolean(branch);
}

function checkoutGitHubArchive(gh: string, repository: string, ref: string | undefined, checkout: string): void {
  let archiveRef = ref;
  if (ref?.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    const verified = Bun.spawnSync([gh, "api", `repos/${repository}/git/ref/tags/${tag}`], { stdout: "ignore", stderr: "pipe" });
    if (verified.exitCode !== 0) throw new Error(`catalog ref is not a Git tag: ${tag}`);
    archiveRef = tag;
  } else if (ref?.startsWith("refs/heads/")) {
    archiveRef = ref.slice("refs/heads/".length);
  }
  const endpoint = `repos/${repository}/tarball${archiveRef ? `/${encodeURIComponent(archiveRef)}` : ""}`;
  const downloaded = Bun.spawnSync([gh, "api", endpoint], { stdout: "pipe", stderr: "pipe" });
  if (downloaded.exitCode !== 0) {
    throw new Error(`cannot download ${repository}: ${downloaded.stderr.toString().trim() || `gh exited with ${downloaded.exitCode}`}`);
  }
  const temporary = dirname(checkout);
  const archive = join(temporary, "source.tar.gz");
  const extracted = join(temporary, "archive");
  writeFileSync(archive, downloaded.stdout);
  mkdirSync(extracted, { recursive: true });
  const unpacked = Bun.spawnSync(["tar", "-xzf", archive, "-C", extracted], { stdout: "pipe", stderr: "pipe" });
  if (unpacked.exitCode !== 0) throw new Error(`cannot unpack ${repository}: ${unpacked.stderr.toString().trim()}`);
  const roots = readdirSync(extracted, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (roots.length !== 1) throw new Error(`GitHub archive for ${repository} has an unexpected layout`);
  renameSync(join(extracted, roots[0]!.name), checkout);
}

function cloneBranch(ref: string): string | undefined {
  if (/^[0-9a-f]{40,64}$/i.test(ref)) return undefined;
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  return ref.startsWith("refs/") ? undefined : ref;
}

function githubRepository(url: string): string | undefined {
  const match = url.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/#\s]+)\/?$/i);
  if (!match) return undefined;
  return `${match[1]}/${match[2]!.replace(/\.git$/i, "")}`;
}

function authenticatedGitHubCli(): string | undefined {
  const gh = Bun.which("gh");
  if (!gh) return undefined;
  const auth = Bun.spawnSync([gh, "auth", "status", "--hostname", "github.com"], { stdout: "ignore", stderr: "ignore" });
  return auth.exitCode === 0 ? gh : undefined;
}

function vendorPackageResources(stagedRoot: string, sourceRoot: string, ancestors = new Set<string>()): void {
  const source = resolve(sourceRoot);
  if (ancestors.has(source)) throw new Error(`package resource cycle while installing ${source}`);
  const nextAncestors = new Set(ancestors).add(source);
  const manifest = readPackage(source);
  if (!manifest.resources) return;
  for (const type of ["skill", "plugin"] as const) {
    const field = `${type}s` as "skills" | "plugins";
    const entries = manifest.resources[field] ?? [];
    uniqueBy(entries, (entry) => safeFileId(entry.id), `${manifest.id}.${field}`);
    manifest.resources[field] = entries.map((entry) => {
      const locator = `resources/${field}/${safeFileId(entry.id)}`;
      const destination = join(stagedRoot, ...locator.split("/"));
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(resolveRelativeSource(source, entry.path), destination, { recursive: true, filter: omitInternal });
      return { id: entry.id, path: locator };
    });
  }
  const packages = manifest.resources.packages ?? [];
  manifest.resources.packages = packages.map((entry) => {
    const childSource = resolveRelativeSource(source, entry.path);
    const child = readPackage(childSource);
    const locator = `resources/packages/${safeFileId(child.id)}`;
    const destination = join(stagedRoot, ...locator.split("/"));
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(childSource, destination, { recursive: true, filter: omitInternal });
    vendorPackageResources(destination, childSource, nextAncestors);
    return { path: locator };
  });
  writePackage(stagedRoot, manifest);
}

function installDirectory(
  source: string,
  destination: string,
  options: DirectoryInstallOptions = {},
): void {
  stageDirectoryInstall(source, destination, options).commit();
}

function stageDirectoryInstall(
  source: string,
  destination: string,
  options: DirectoryInstallOptions = {},
  beforeReplace?: () => void,
): PendingDirectoryInstall {
  const parent = dirname(destination);
  const createdParents = missingDirectories(parent);
  mkdirSync(parent, { recursive: true });
  const stagingRoot = mkdtempSync(join(parent, ".install-staging-"));
  const staged = join(stagingRoot, "payload");
  const backup = join(parent, `.install-backup-${crypto.randomUUID()}`);
  let backedUp = false;
  let installed = false;
  try {
    cpSync(source, staged, { recursive: true, filter: omitInternal });
    options.prepare?.(staged);
    if (options.sourceRecord) atomicWriteJson(join(staged, ".agulater", "source.json"), options.sourceRecord);
    beforeReplace?.();
    if (existsSync(destination)) {
      renameSync(destination, backup);
      backedUp = true;
    }
    renameSync(staged, destination);
    installed = true;
    let pending = true;
    return {
      commit: () => {
        if (!pending) return;
        pending = false;
        tryRemove(backup);
        tryRemove(stagingRoot);
      },
      rollback: () => {
        if (!pending) return;
        pending = false;
        const failures: string[] = [];
        try {
          removeTree(destination);
        } catch (error) {
          failures.push(errorMessage(error));
        }
        if (backedUp && existsSync(backup)) {
          try {
            renameSync(backup, destination);
          } catch (error) {
            failures.push(errorMessage(error));
          }
        }
        tryRemove(stagingRoot);
        removeEmptyDirectories(createdParents);
        if (failures.length > 0) throw new Error(failures.join("; "));
      },
    };
  } catch (error) {
    if (backedUp && existsSync(backup)) {
      removeTree(destination);
      renameSync(backup, destination);
    }
    throw error;
  } finally {
    if (!installed) {
      tryRemove(stagingRoot);
      removeEmptyDirectories(createdParents);
    }
  }
}

function recordSource(root: string, record: SourceRecord): void {
  const path = join(root, ".agulater", "sources.json");
  const existing = existsSync(path) ? tryReadJson(path) : undefined;
  const sources = isRecord(existing) && Array.isArray(existing.sources)
    ? existing.sources.filter((entry) => !isRecord(entry) || entry.id !== record.id || entry.type !== record.type)
    : [];
  sources.push(record);
  atomicWriteJson(path, { format: "agulater/sources/v1", sources });
}

function readSourceRecords(root: string): SourceRecord[] {
  const path = join(root, ".agulater", "sources.json");
  if (!existsSync(path)) return [];
  const document = strictObject(readJson(path, "extension sources"), path, ["format", "sources"], ["format", "sources"]);
  if (document.format !== "agulater/sources/v1") throw new Error(`${path}.format must be agulater/sources/v1`);
  const records = array(document.sources, `${path}.sources`).map((value, index): SourceRecord => {
    const label = `${path}.sources[${index}]`;
    const record = strictObject(value, label, ["id", "type", "version", "source", "path"], ["id", "type", "version", "source", "path"]);
    const sourceLabel = `${label}.source`;
    const sourceType = objectDiscriminator(record.source, sourceLabel, "type");
    let source: SourceRecord["source"];
    if (sourceType === "path") {
      const parsed = strictObject(record.source, sourceLabel, ["type", "path"], ["type", "path"]);
      const rawPath = nonEmptyString(parsed.path, `${sourceLabel}.path`);
      source = {
        type: "path",
        path: isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)
          ? resolve(rawPath)
          : packageLocator(rawPath, `${sourceLabel}.path`, true),
      };
    } else if (sourceType === "git") {
      const parsed = parseDependencySource(record.source, sourceLabel);
      if (parsed.type !== "git") throw new Error(`${sourceLabel}.type must be git`);
      source = parsed;
    } else if (sourceType === "catalog") {
      const parsed = strictObject(record.source, sourceLabel, ["type", "catalog", "entry"], ["type", "catalog", "entry"]);
      source = {
        type: "catalog",
        catalog: catalogName(parsed.catalog, `${sourceLabel}.catalog`),
        entry: packageId(parsed.entry, `${sourceLabel}.entry`),
      };
    } else {
      throw new Error(`${sourceLabel}.type must be path, git, or catalog`);
    }
    return {
      id: packageId(record.id, `${label}.id`),
      type: enumeration(record.type, extensionTypes, `${label}.type`),
      version: semanticVersion(record.version, `${label}.version`),
      path: packageLocator(record.path, `${label}.path`),
      source,
    };
  });
  uniqueBy(records, (record) => `${record.type}:${record.id}`, `${path}.sources`);
  return records;
}

function removeSourceRecord(root: string, type: ExtensionType, id: string): void {
  const path = join(root, ".agulater", "sources.json");
  if (!existsSync(path)) return;
  const existing = tryReadJson(path);
  if (!isRecord(existing) || !Array.isArray(existing.sources)) return;
  const sources = existing.sources.filter((entry) => !isRecord(entry) || entry.id !== id || entry.type !== type);
  atomicWriteJson(path, { format: "agulater/sources/v1", sources });
}

function storedDependency(store: string, type: ExtensionType, id: string, range = "*"): { path: string; version: string } | undefined {
  const root = join(store, type, ...id.split("/"));
  if (!existsSync(root)) return undefined;
  const version = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSemanticVersion(entry.name))
    .map((entry) => entry.name)
    .filter((item) => satisfiesVersion(item, range))
    .filter((item) => range.includes("-") || !item.includes("-"))
    .sort(compareVersions)
    .at(-1);
  return version ? { path: join(root, version), version } : undefined;
}

function hostCandidates(root: string, home: string, type: ExtensionType, id: string): string[] {
  const workspace = basename(root) === ".agents" ? dirname(root) : root;
  const parts = id.split("/");
  const candidates = type === "package"
    ? [join(workspace, ".agents", "packages", ...parts), join(userAgentsRoot(home), "packages", ...parts)]
    : [
        join(workspace, ".agents", `${type}s`, ...parts),
        join(workspace, ".codex", `${type}s`, ...parts),
        join(workspace, ".claude", `${type}s`, ...parts),
        join(userAgentsRoot(home), `${type}s`, ...parts),
        join(home, ".codex", `${type}s`, ...parts),
        join(home, ".claude", `${type}s`, ...parts),
      ];
  return [...new Set(candidates.filter(existsSync).map((path) => resolve(path)))];
}

function extensionVersion(type: "skill" | "plugin", path: string, fallback: string): string {
  const raw = type === "skill"
    ? readSkillField(join(path, "SKILL.md"), "version")
    : [join(path, "plugin.json"), join(path, ".codex-plugin", "plugin.json")]
        .filter(existsSync)
        .map((file) => readJsonField(file, "version"))
        .find(Boolean);
  return raw ? semanticVersion(raw, `${type} version at ${path}`) : fallback;
}

function validateExtension(type: "skill" | "plugin", path: string): void {
  if (type === "skill" && !existsSync(join(path, "SKILL.md"))) throw new Error(`skill needs SKILL.md: ${path}`);
  if (type === "plugin" && !existsSync(join(path, "plugin.json"))) {
    throw new Error(`Agul plugin needs plugin.json at its root: ${path}`);
  }
}

function replaceDirectory(staging: string, destination: string): void {
  const backup = join(dirname(destination), `.runtime-backup-${crypto.randomUUID()}`);
  let backedUp = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      backedUp = true;
    }
    renameSync(staging, destination);
  } catch (error) {
    if (!existsSync(destination) && backedUp && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
  if (backedUp) tryRemove(backup);
}

function writePackage(root: string, manifest: AgentPackage): void {
  atomicWriteJson(join(root, "package.json"), parsePackage(manifest, `${root}/package.json`));
}

function snapshotFile(path: string): FileSnapshot {
  return {
    path,
    ...(existsSync(path) ? { contents: readFileSync(path) } : {}),
    parentExisted: existsSync(dirname(path)),
  };
}

function restoreFileSnapshot(snapshot: FileSnapshot): void {
  if (snapshot.contents) {
    atomicWriteFile(snapshot.path, snapshot.contents);
    return;
  }
  if (existsSync(snapshot.path)) rmSync(snapshot.path, { force: true });
  if (!snapshot.parentExisted) removeEmptyDirectories([dirname(snapshot.path)]);
}

function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicWriteFile(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function missingDirectories(path: string): string[] {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

function removeEmptyDirectories(paths: string[]): void {
  for (const path of paths) {
    try {
      if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path);
    } catch {
      // A non-empty or concurrently used parent belongs to the caller.
    }
  }
}

function tryRemove(path: string): void {
  try {
    removeTree(path);
  } catch {
    // Backup cleanup must not turn a completed mutation into a false failure.
  }
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string, kind: string): unknown {
  if (!existsSync(path)) throw new Error(`no ${kind} at ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${errorMessage(error)}`);
  }
}

function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function strictObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has unknown field ${unknown}`);
  const missing = required.find((key) => value[key] === undefined);
  if (missing) throw new Error(`${label} needs ${missing}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectDiscriminator(value: unknown, label: string, key: string): string {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  return nonEmptyString(value[key], `${label}.${key}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string, nonEmpty = false): string[] {
  const values = array(value, label).map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (nonEmpty && values.length === 0) throw new Error(`${label} must not be empty`);
  uniqueBy(values, (entry) => entry, label);
  return values;
}

function idArray(value: unknown, label: string): string[] {
  const values = array(value, label).map((entry, index) => packageId(entry, `${label}[${index}]`));
  uniqueBy(values, (entry) => entry, label);
  return values;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`);
  return value as number;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} must be ${values.join(", ")}`);
  return value as T[number];
}

function packageId(value: unknown, label: string): string {
  const id = nonEmptyString(value, label);
  const segment = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?";
  if (!new RegExp(`^${segment}(?:/${segment})*$`).test(id)) throw new Error(`${label} must be a lowercase package id`);
  return id;
}

function catalogName(value: unknown, label: string): string {
  const id = nonEmptyString(value, label);
  const segment = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?";
  if (!new RegExp(`^${segment}$`).test(id)) throw new Error(`${label} must be a lowercase catalog id without /`);
  return id;
}

function packageLocator(value: unknown, label: string, allowParent = false): string {
  const path = nonEmptyString(value, label);
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes("\\")) {
    throw new Error(`${label} must be a package-relative path using /`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || (!allowParent && part === ".."))) {
    throw new Error(`${label} must be a clean package-relative path`);
  }
  return path;
}

function semanticVersion(value: unknown, label: string): string {
  const version = nonEmptyString(value, label);
  if (!isSemanticVersion(version)) throw new Error(`${label} must be a SemVer version`);
  return version;
}

function versionRange(value: unknown, label: string): string {
  const range = nonEmptyString(value, label);
  if (!/^(?:\*|(?:\^|~|>=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(range)) {
    throw new Error(`${label} must be an exact, ^, ~, >=, or * SemVer range`);
  }
  return range;
}

function isSemanticVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function exactVersion(range: string | undefined): string | undefined {
  return range && isSemanticVersion(range) ? range : undefined;
}

function satisfiesVersion(version: string, range: string): boolean {
  if (!isSemanticVersion(version)) return false;
  // Agulater's validated `*` range has always included prerelease packages.
  if (range === "*") return true;
  return satisfiesSemVer(version, range);
}

function compareVersions(left: string, right: string): number {
  return compareSemVer(left, right);
}

function uniqueBy<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new Error(`${label} contains duplicate ${value}`);
    seen.add(value);
  }
}

function resolveInside(root: string, locator: string, label: string): string {
  const path = resolve(root, ...locator.split("/"));
  const difference = relative(resolve(root), path);
  if (difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) throw new Error(`${label} escapes its package`);
  return path;
}

function resolveRelativeSource(root: string, locator: string): string {
  return resolve(root, ...locator.split("/"));
}

function requireDirectory(path: string, message: string): void {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) throw new Error(`${message}: ${path}`);
}

function requireFile(path: string, message: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`${message}: ${path}`);
}

function relativeLocator(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function recordedSourcePath(root: string, source: string): string {
  const path = relative(resolve(root), resolve(source));
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)
    ? resolve(source)
    : path.split(sep).join("/");
}

function runtimeResourcePath(outputRoot: string, type: "skill" | "plugin", id: string): string {
  return join(outputRoot, "resources", `${type}s`, safeFileId(id));
}

function safeFileId(id: string): string {
  return id.replaceAll("/", "--");
}

function slug(value: string): string {
  const result = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!result) throw new Error("assistant name must contain a letter or number");
  return result;
}

function omitInternal(path: string): boolean {
  return ![".git", ".agulater"].includes(basename(path));
}

function readSkillField(path: string, field: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const frontmatter = readFileSync(path, "utf8").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return frontmatter?.[1]?.match(new RegExp(`^${field}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, "m"))?.[1]?.trim() || undefined;
}

function readJsonField(path: string, field: string): string | undefined {
  const value = tryReadJson(path);
  const result = isRecord(value) ? value[field] : undefined;
  return typeof result === "string" && result.trim() ? result.trim() : undefined;
}

function isGitUrl(value: string): boolean {
  return /^(?:https?|ssh|git|file):\/\//.test(value) || /^[^@\s]+@[^:\s]+:.+/.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
