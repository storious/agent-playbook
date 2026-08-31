import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
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
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import {
  addExtension,
  createProject,
  listCatalogs,
  migrateUser,
  prepare,
  readPackage,
  refreshCatalogs,
  removeExtension,
  searchCatalogs,
  setupUser,
  syncDependencies,
  updateExtensions,
} from "./lib/agulater.ts";
import {
  commitRuntimeActivation,
  installRuntime,
  resolveGitHubRelease,
  runtimeInstallFormat,
  runtimePlatform,
  runtimeStatus,
  updateRuntime,
} from "./lib/runtime-manager.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Agulater v2 product flow", () => {
  test("creates a strict package and complete minimal runtime", () => {
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "Helper Name");

    expect(readPackage(agentsRoot)).toEqual({
      format: "agulater/package/v2",
      id: "helper-name",
      version: "0.1.0",
      description: "Assistant for Helper Name",
      instructions: "AGENTS.md",
    });
    expect(readJson(join(agentsRoot, "runtime", "launch.json"))).toEqual({
      format: "agul/launch/v2",
      instructions: "instructions.md",
    });
    expect(readJson(join(agentsRoot, "runtime", "specialists.json"))).toEqual({
      format: "agulater/specialists/v1",
      specialists: [],
    });
    expect(readJson(join(agentsRoot, "runtime", "pools.json"))).toEqual({
      format: "agulater/pools/v2",
      pools: [],
    });
    expect(readJson(join(agentsRoot, "runtime", "snapshot.json"))).toMatchObject({
      format: "agulater/snapshot/v1",
      package: { id: "helper-name", version: "0.1.0" },
    });
  });

  test("rejects v1 and unknown fields without replacing the last-good runtime", () => {
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const launchPath = join(agentsRoot, "runtime", "launch.json");
    const lastGood = readFileSync(launchPath, "utf8");
    const manifest = readJson(join(agentsRoot, "package.json")) as Record<string, unknown>;
    manifest.unexpected = true;
    writeJson(join(agentsRoot, "package.json"), manifest);

    expect(() => prepare(agentsRoot)).toThrow("unknown field unexpected");
    expect(readFileSync(launchPath, "utf8")).toBe(lastGood);

    writeJson(join(agentsRoot, "package.json"), {
      format: "agulater/package/v1",
      name: "helper",
      version: "0.1.0",
      instructions: "AGENTS.md",
    });
    expect(() => prepare(agentsRoot)).toThrow("legacy packages are not accepted");
    expect(readFileSync(launchPath, "utf8")).toBe(lastGood);
  });

  test("compiles explicit resources, context modes, harness, and a nested specialist", () => {
    const workspace = temporaryDirectory();
    const agentsRoot = join(workspace, ".agents");
    const skill = join(workspace, "extensions", "review");
    const plugin = join(workspace, "extensions", "weather");
    const specialist = join(workspace, "specialist");
    mkdirSync(skill, { recursive: true });
    mkdirSync(plugin, { recursive: true });
    mkdirSync(join(agentsRoot, "context"), { recursive: true });
    mkdirSync(join(specialist, "context"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: review\nversion: 1.2.0\ndescription: Review.\n---\n\n# Review\n", "utf8");
    writeJson(join(plugin, "plugin.json"), { format: "agul/plugin/v2", name: "weather", version: "2.0.0" });
    writeFileSync(join(agentsRoot, "AGENTS.md"), "# Master\n", "utf8");
    writeFileSync(join(agentsRoot, "context", "core.md"), "Core facts.\n", "utf8");
    writeFileSync(join(agentsRoot, "context", "reference.md"), "Reference facts.\n", "utf8");
    writeJson(join(agentsRoot, "package.json"), {
      format: "agulater/package/v2",
      id: "acme/master",
      version: "0.2.0-dev",
      description: "Master assistant",
      instructions: "AGENTS.md",
      resources: {
        skills: [{ id: "acme/review", path: "../extensions/review" }],
        plugins: [{ id: "acme/weather", path: "../extensions/weather" }],
        contexts: [
          { id: "core", description: "Always available facts", path: "context/core.md", load: "eager" },
          { id: "reference", description: "Load only when useful", path: "context/reference.md", load: "on_demand" },
        ],
        packages: [{ path: "../specialist" }],
      },
    });
    writeFileSync(join(specialist, "AGENTS.md"), "# Scout\n", "utf8");
    writeFileSync(join(specialist, "context", "rules.md"), "Read-only evidence.\n", "utf8");
    writeJson(join(specialist, "harness.json"), harness());
    writeJson(join(specialist, "package.json"), {
      format: "agulater/package/v2",
      id: "acme/scout",
      version: "0.1.0",
      description: "Find repository evidence",
      instructions: "AGENTS.md",
      resources: {
        contexts: [{ id: "rules", description: "Scout rules", path: "context/rules.md", load: "eager" }],
      },
      profile: {
        accepts: ["repository_search"],
        workspace_effect: "read",
        contexts: ["rules"],
        harness: "harness.json",
      },
    });

    prepare(agentsRoot, { home: temporaryDirectory() });

    expect(readJson(join(agentsRoot, "runtime", "launch.json"))).toEqual({
      format: "agul/launch/v2",
      instructions: "instructions.md",
      skills: "resources/skills",
      plugins: "resources/plugins",
    });
    const instructions = readFileSync(join(agentsRoot, "runtime", "instructions.md"), "utf8");
    expect(instructions).toContain("Core facts.");
    expect(instructions).not.toContain("Reference facts.");
    expect(instructions).toContain("acme/scout");
    expect(existsSync(join(agentsRoot, "runtime", "resources", "skills", "acme--review", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(agentsRoot, "runtime", "resources", "skills", "context-reference", "SKILL.md"), "utf8")).toContain("Reference facts.");
    expect(existsSync(join(agentsRoot, "runtime", "resources", "plugins", "acme--weather", "plugin.json"))).toBe(true);
    const specialistInstructions = readFileSync(
      join(agentsRoot, "runtime", "specialists", "acme", "scout", "instructions.md"),
      "utf8",
    );
    expect(specialistInstructions).toContain("Specialist harness");
    expect(specialistInstructions).toContain(
      '<agul-handoff format="agul/handoff/v1">{"format":"agul/handoff/v1","status":"completed","summary":"..."}</agul-handoff>',
    );
    expect(specialistInstructions.match(/<agul-handoff/g)).toHaveLength(1);
    expect(specialistInstructions).toContain(
      "evidence, changes, verification, risks, and next_steps must each be JSON arrays",
    );
    expect(specialistInstructions).toContain(
      "do not narrate plans, count rounds or tool calls, restate gathered evidence, or draft the final answer",
    );
    expect(specialistInstructions).toContain(
      "If space is tight, omit optional prose and optional handoff fields, then emit the minimal truthful handoff immediately",
    );
    expect(specialistInstructions).toContain("Never omit the handoff or claim work that was not completed");
    expect(specialistInstructions).toContain("Read-only evidence.");
    expect(specialistInstructions).not.toContain("Reference facts.");
    expect(readJson(join(agentsRoot, "runtime", "specialists.json"))).toMatchObject({
      format: "agulater/specialists/v1",
      specialists: [{
        id: "acme/scout",
        workspace_effect: "read",
        launch_path: "specialists/acme/scout/launch.json",
        snapshot_path: "specialists/acme/scout/snapshot.json",
        handoff_format: "agul/handoff/v1",
      }],
    });
  });

  test("layers user and project pools only with an explicit override", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    mkdirSync(join(home, ".agents"), { recursive: true });
    writeJson(join(home, ".agents", "pools.json"), pools("primary", [pool("primary", "user-model")]));
    writeJson(join(agentsRoot, "pools.json"), pools("primary", [pool("primary", "project-model")]));

    expect(() => prepare(agentsRoot, { home })).toThrow("override: true");
    writeJson(join(agentsRoot, "pools.json"), pools("primary", [{ ...pool("primary", "project-model"), override: true }]));
    prepare(agentsRoot, { home });

    expect(readJson(join(agentsRoot, "runtime", "pools.json"))).toEqual({
      format: "agulater/pools/v2",
      default_pool: "primary",
      pools: [pool("primary", "project-model")],
    });

    writeJson(join(agentsRoot, "pools.json"), pools("primary", [{ ...codexPool("primary"), override: true }]));
    prepare(agentsRoot, { home });
    expect(readJson(join(agentsRoot, "runtime", "pools.json"))).toEqual({
      format: "agulater/pools/v2",
      default_pool: "primary",
      pools: [codexPool("primary")],
    });
  });

  test("compiles a minimal Codex pool without native placeholders", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const codexPool = {
      id: "codex-account",
      engine: "codex",
      capabilities: ["read", "write", "edit", "shell"],
      max_concurrency: 1,
      request_timeout_seconds: 600,
    };
    writeJson(join(agentsRoot, "pools.json"), pools("codex-account", [codexPool]));

    prepare(agentsRoot, { home });

    expect(readJson(join(agentsRoot, "runtime", "pools.json"))).toEqual({
      format: "agulater/pools/v2",
      default_pool: "codex-account",
      pools: [codexPool],
    });
  });

  test("preserves optional Codex runtime and routing selections", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const configured = {
      ...codexPool("codex-pinned"),
      model: "gpt-test",
      codex_command: "codex app-server",
      reasoning_effort: "medium",
      context_window: 131072,
    };
    writeJson(join(agentsRoot, "pools.json"), pools("codex-pinned", [configured]));

    prepare(agentsRoot, { home });

    expect(readJson(join(agentsRoot, "runtime", "pools.json"))).toEqual({
      format: "agulater/pools/v2",
      default_pool: "codex-pinned",
      pools: [configured],
    });
  });

  test("rejects legacy and cross-engine pool fields without replacing runtime", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const runtimePools = join(agentsRoot, "runtime", "pools.json");
    const lastGood = readFileSync(runtimePools, "utf8");
    const poolPath = join(agentsRoot, "pools.json");

    writeJson(poolPath, {
      format: "agulater/pools/v1",
      default_pool: "legacy",
      pools: [{ ...pool("legacy", "old-model"), engine: undefined }],
    });
    expect(() => prepare(agentsRoot, { home })).toThrow("format must be agulater/pools/v2");
    expect(readFileSync(runtimePools, "utf8")).toBe(lastGood);

    writeJson(poolPath, pools("codex-account", [{
      ...codexPool("codex-account"),
      endpoint: "https://placeholder.invalid/v1",
    }]));
    expect(() => prepare(agentsRoot, { home })).toThrow("has unknown field endpoint");
    expect(readFileSync(runtimePools, "utf8")).toBe(lastGood);

    writeJson(poolPath, pools("native", [{
      ...pool("native", "model"),
      codex_command: "codex app-server",
    }]));
    expect(() => prepare(agentsRoot, { home })).toThrow("has unknown field codex_command");
    expect(readFileSync(runtimePools, "utf8")).toBe(lastGood);
  });

  test("resolves path and highest stable managed-store dependencies", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = join(workspace, ".agents");
    const pathSkill = join(workspace, "path-skill");
    const prereleaseSkill = join(workspace, "path-prerelease");
    mkdirSync(agentsRoot, { recursive: true });
    skill(pathSkill, "path-skill", "2.0.0");
    skill(prereleaseSkill, "path-prerelease", "2.0.0-rc.1");
    for (const version of ["1.0.0", "1.1.0", "1.2.0-beta.1"]) {
      skill(join(home, ".agents", "store", "skill", "acme", "stored", version), "stored", version);
    }
    writeFileSync(join(agentsRoot, "AGENTS.md"), "# Helper\n", "utf8");
    writeJson(join(agentsRoot, "package.json"), {
      format: "agulater/package/v2",
      id: "helper",
      version: "0.1.0",
      description: "Dependency fixture",
      instructions: "AGENTS.md",
      dependencies: {
        skills: [
          { id: "path-skill", version: "2.0.0", source: { type: "path", path: "../path-skill" } },
          { id: "path-prerelease", version: "*", source: { type: "path", path: "../path-prerelease" } },
          { id: "acme/stored", version: "^1.0.0", source: { type: "catalog" } },
        ],
      },
    });

    prepare(agentsRoot, { home });
    const snapshot = readJson(join(agentsRoot, "runtime", "snapshot.json")) as any;
    expect(snapshot.dependencies.skills.map((entry: any) => [entry.id, entry.version])).toEqual([
      ["path-skill", "2.0.0"],
      ["path-prerelease", "2.0.0-rc.1"],
      ["acme/stored", "1.1.0"],
    ]);

    skill(prereleaseSkill, "path-prerelease", "not-semver");
    expect(() => prepare(agentsRoot, { home })).toThrow("must be a SemVer version");
  });

  test("atomically adds, records, prepares, and removes a local extension", () => {
    const workspace = temporaryDirectory();
    const source = join(temporaryDirectory(), "review");
    skill(source, "review", "1.3.0");
    const agentsRoot = createProject(workspace, "helper");

    expect(addExtension(agentsRoot, source)).toMatchObject({ type: "skill", name: "review", version: "1.3.0" });
    expect(existsSync(join(agentsRoot, "resources", "skills", "review", "SKILL.md"))).toBe(true);
    expect(readJson(join(agentsRoot, ".agulater", "sources.json"))).toMatchObject({
      format: "agulater/sources/v1",
      sources: [{ id: "review", type: "skill", version: "1.3.0" }],
    });
    expect(readPackage(agentsRoot).resources?.skills).toEqual([{ id: "review", path: "resources/skills/review" }]);

    removeExtension(agentsRoot, "review");
    expect(existsSync(join(agentsRoot, "resources", "skills", "review"))).toBe(false);
    expect(readPackage(agentsRoot).resources?.skills).toEqual([]);
  });

  test("rolls back a local extension when prepare fails", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const source = join(temporaryDirectory(), "review");
    const agentsRoot = createProject(workspace, "helper");
    skill(source, "review", "1.0.0");
    const before = extensionMutationState(agentsRoot);
    writeJson(join(agentsRoot, "pools.json"), { format: "agulater/pools/v1", pools: [] });

    expect(() => addExtension(agentsRoot, source, undefined, undefined, { home })).toThrow("format must be agulater/pools/v2");

    expect(extensionMutationState(agentsRoot)).toEqual(before);
  });

  test("does not touch project files when extension discovery fails", () => {
    const workspace = temporaryDirectory();
    const source = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const packagePath = join(agentsRoot, "package.json");
    const before = fileIdentity(packagePath);

    expect(() => addExtension(agentsRoot, source)).toThrow("no matching skill, plugin, or package");

    expect(fileIdentity(packagePath)).toEqual(before);
    expect(existsSync(join(agentsRoot, ".agulater"))).toBe(false);
  });

  test("restores the resource and package when the source record cannot be written", () => {
    const workspace = temporaryDirectory();
    const source = join(temporaryDirectory(), "review");
    const agentsRoot = createProject(workspace, "helper");
    const blockedMetadata = join(agentsRoot, ".agulater");
    skill(source, "review", "1.0.0");
    writeFileSync(blockedMetadata, "occupied by a file\n", "utf8");
    const before = extensionMutationState(agentsRoot);

    expect(() => addExtension(agentsRoot, source)).toThrow();

    expect(extensionMutationState(agentsRoot)).toEqual(before);
    expect(readFileSync(blockedMetadata, "utf8")).toBe("occupied by a file\n");
  });

  test("adds a selected extension from a local Git URL", () => {
    const workspace = temporaryDirectory();
    const repository = temporaryDirectory();
    skill(join(repository, "skills", "selected"), "selected", "1.0.0");
    skill(join(repository, "skills", "other"), "other", "1.0.0");
    commitGitFixture(repository);
    const agentsRoot = createProject(workspace, "helper");

    addExtension(agentsRoot, pathToFileURL(repository).href, "skill", "selected");
    expect(existsSync(join(agentsRoot, "resources", "skills", "selected", "SKILL.md"))).toBe(true);
  });

  test("adds a manifest-declared skill from a Git collection", () => {
    const workspace = temporaryDirectory();
    const repository = temporaryDirectory();
    const collection = join(repository, ".agents");
    const source = pathToFileURL(repository).href;
    const grilling = join(collection, "skills", "grilling");
    mkdirSync(grilling, { recursive: true });
    writeFileSync(join(grilling, "SKILL.md"), "---\nname: grilling\ndescription: Grill a plan.\n---\n\n# Grilling\n", "utf8");
    writeFileSync(join(collection, "AGENTS.md"), "# AgentKube\n", "utf8");
    writeJson(join(collection, "package.json"), {
      format: "agulater/package/v2",
      id: "agentkube",
      version: "0.1.0",
      description: "Extension collection",
      instructions: "AGENTS.md",
      resources: {
        skills: [{ id: "grilling", path: "skills/grilling" }],
      },
    });
    commitGitFixture(repository);
    createProject(workspace, "helper");

    const result = cli(
      "add",
      source,
      "--type",
      "skill",
      "--name",
      "grilling",
      "--path",
      workspace,
    );

    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
    expect(result.stdout.toString()).toContain("added skill grilling");
    const agentsRoot = join(workspace, ".agents");
    expect(existsSync(join(agentsRoot, "resources", "skills", "grilling", "SKILL.md"))).toBe(true);
    expect(readPackage(agentsRoot).resources?.skills).toEqual([
      { id: "grilling", path: "resources/skills/grilling" },
    ]);
    expect(readJson(join(agentsRoot, ".agulater", "sources.json"))).toMatchObject({
      sources: [{
        id: "grilling",
        type: "skill",
        version: "0.1.0",
        source: { type: "git", url: source },
        path: "resources/skills/grilling",
      }],
    });
  });

  test("selects only direct resources declared by a package", () => {
    const workspace = temporaryDirectory();
    const repository = temporaryDirectory();
    const collection = join(repository, ".agents");
    const plugin = join(repository, "plugins", "helper");
    const child = join(repository, "packages", "scout");
    skill(join(collection, "skills", "review"), "review", "1.2.0");
    skill(join(collection, "skills", "hidden"), "hidden", "1.2.0");
    skill(join(repository, "skills", "loose"), "loose", "1.2.0");
    skill(join(child, "skills", "nested"), "nested", "3.0.0");
    mkdirSync(plugin, { recursive: true });
    writeJson(join(plugin, "plugin.json"), { format: "agul/plugin/v2", name: "helper", version: "2.0.0" });
    mkdirSync(child, { recursive: true });
    writeFileSync(join(collection, "AGENTS.md"), "# Collection\n", "utf8");
    writeFileSync(join(child, "AGENTS.md"), "# Scout\n", "utf8");
    writeJson(join(child, "package.json"), {
      format: "agulater/package/v2",
      id: "scout",
      version: "3.0.0",
      description: "Scout package",
      instructions: "AGENTS.md",
      resources: {
        skills: [{ id: "nested", path: "skills/nested" }],
      },
    });
    writeJson(join(collection, "package.json"), {
      format: "agulater/package/v2",
      id: "collection",
      version: "1.0.0",
      description: "Extension collection",
      instructions: "AGENTS.md",
      resources: {
        skills: [{ id: "review", path: "skills/review" }],
        plugins: [{ id: "helper", path: "../plugins/helper" }],
        packages: [{ path: "../packages/scout" }],
      },
    });
    const agentsRoot = createProject(workspace, "helper");

    expect(addExtension(agentsRoot, repository, "skill", "review")).toMatchObject({
      name: "review",
      type: "skill",
      version: "1.2.0",
    });
    expect(addExtension(agentsRoot, repository, "plugin", "helper")).toMatchObject({
      name: "helper",
      type: "plugin",
      version: "2.0.0",
    });
    expect(addExtension(agentsRoot, repository, "package", "scout")).toMatchObject({
      name: "scout",
      type: "package",
      version: "3.0.0",
    });
    expect(existsSync(join(agentsRoot, "resources", "skills", "review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(agentsRoot, "resources", "plugins", "helper", "plugin.json"))).toBe(true);
    expect(existsSync(join(agentsRoot, "resources", "packages", "scout", "package.json"))).toBe(true);
    expect(() => addExtension(agentsRoot, repository, "skill", "hidden")).toThrow(
      "no matching skill, plugin, or package found in the source",
    );
    expect(() => addExtension(agentsRoot, repository, "skill", "loose")).toThrow(
      "no matching skill, plugin, or package found in the source",
    );
    expect(() => addExtension(agentsRoot, repository, "skill", "nested")).toThrow(
      "no matching skill, plugin, or package found in the source",
    );
  });

  test("keeps a resource-bearing package as the default candidate", () => {
    const workspace = temporaryDirectory();
    const collection = join(temporaryDirectory(), ".agents");
    const nested = join(collection, ".agents");
    skill(join(collection, "skills", "review"), "review", "1.0.0");
    writeFileSync(join(collection, "AGENTS.md"), "# Collection\n", "utf8");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "AGENTS.md"), "# Nested\n", "utf8");
    writeJson(join(nested, "package.json"), {
      format: "agulater/package/v2",
      id: "nested",
      version: "1.0.0",
      description: "Nested development assistant",
      instructions: "AGENTS.md",
    });
    writeJson(join(collection, "package.json"), {
      format: "agulater/package/v2",
      id: "collection",
      version: "1.0.0",
      description: "Extension collection",
      instructions: "AGENTS.md",
      resources: {
        skills: [{ id: "review", path: "skills/review" }],
      },
    });
    const agentsRoot = createProject(workspace, "helper");

    expect(addExtension(agentsRoot, collection)).toMatchObject({
      name: "collection",
      type: "package",
      version: "1.0.0",
    });
    expect(addExtension(agentsRoot, collection, "package")).toMatchObject({
      name: "collection",
      type: "package",
      version: "1.0.0",
    });
    expect(existsSync(join(agentsRoot, "resources", "packages", "collection", "package.json"))).toBe(true);
  });

  test("syncs the highest stable catalog version into the managed store", () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const repository = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    skill(join(repository, "skills", "shared"), "shared", "1.1.0");
    const bundle = join(repository, "bundle");
    mkdirSync(join(bundle, ".agents"), { recursive: true });
    mkdirSync(join(bundle, "plugin"), { recursive: true });
    writeFileSync(join(bundle, ".agents", "AGENTS.md"), "# Bundle\n", "utf8");
    writeJson(join(bundle, "plugin", "plugin.json"), { format: "agul/plugin/v2", name: "helper-plugin", version: "1.0.0" });
    writeJson(join(bundle, ".agents", "package.json"), {
      format: "agulater/package/v2",
      id: "bundle",
      version: "1.0.0",
      description: "Package with a repository-relative resource",
      instructions: "AGENTS.md",
      resources: { plugins: [{ id: "helper-plugin", path: "../plugin" }] },
    });
    commitGitFixture(repository);
    git(repository, "tag", "catalog-fixture-v1");
    const manifest = readPackage(agentsRoot);
    manifest.dependencies = {
      skills: [{ id: "shared", version: "^1.0.0" }],
      packages: [{ id: "bundle", version: "1.0.0" }],
    };
    writeJson(join(agentsRoot, "package.json"), manifest);
    const catalog = join(workspace, "catalog.json");
    writeJson(catalog, {
      format: "agulater/catalog/v1",
      entries: [{
        id: "shared",
        kind: "skill",
        description: "Shared fixture",
        versions: [
          { version: "1.2.0-beta.1", source: { type: "git", url: pathToFileURL(repository).href, subdir: "skills/shared", ref: "main" } },
          { version: "1.1.0", source: { type: "git", url: pathToFileURL(repository).href, subdir: "skills/shared", ref: "catalog-fixture-v1" } },
        ],
      }, {
        id: "bundle",
        kind: "package",
        description: "Bundle fixture",
        versions: [{ version: "1.0.0", source: { type: "git", url: pathToFileURL(repository).href, subdir: "bundle/.agents", ref: "catalog-fixture-v1" } }],
      }],
    });

    const result = syncDependencies(agentsRoot, { home, catalog });

    expect(result.installed).toHaveLength(2);
    expect(result.installed).toContainEqual(expect.objectContaining({ id: "shared", type: "skill", version: "1.1.0" }));
    const stored = join(home, ".agents", "store", "skill", "shared", "1.1.0");
    expect(existsSync(join(stored, "SKILL.md"))).toBe(true);
    expect(readJson(join(stored, ".agulater", "source.json"))).toMatchObject({
      format: "agulater/store-source/v1",
      id: "shared",
      version: "1.1.0",
    });
    expect(existsSync(join(agentsRoot, "runtime", "resources", "skills", "shared", "SKILL.md"))).toBe(true);
    const storedBundle = join(home, ".agents", "store", "package", "bundle", "1.0.0");
    expect(readPackage(storedBundle).resources?.plugins).toEqual([{ id: "helper-plugin", path: "resources/plugins/helper-plugin" }]);
    expect(existsSync(join(storedBundle, "resources", "plugins", "helper-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(agentsRoot, "runtime", "specialists", "bundle", "resources", "plugins", "helper-plugin", "plugin.json"))).toBe(true);
  });

  test("registers AgentKube without downloading and exposes the narrow JSON list", () => {
    const home = temporaryDirectory();
    setupUser(home);

    expect(listCatalogs(home)).toEqual({
      format: "agulater/catalog-list/v1",
      catalogs: [{
        id: "agentkube",
        url: "https://raw.githubusercontent.com/storious/agentkube/main/catalog/catalog.json",
        cached: false,
        entries: 0,
      }],
    });
    const result = cli("catalog", "list", "--home", home, "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual(listCatalogs(home));

    const replacement = join(temporaryDirectory(), "catalog.json");
    writeJson(replacement, { format: "agulater/catalog/v1", entries: [] });
    writeJson(join(home, ".agents", ".agulater", "catalogs", "agentkube.json"), {
      format: "agulater/catalog/v1",
      entries: [],
    });
    expect(listCatalogs(home).catalogs[0]?.cached).toBe(true);
    expect(cli("catalog", "add", "agentkube", replacement, "--home", home).exitCode).toBe(0);
    expect(listCatalogs(home).catalogs[0]?.url).toBe(replacement);
    expect(listCatalogs(home).catalogs[0]?.cached).toBe(false);
    expect(cli("catalog", "add", "nested/catalog", replacement, "--home", home).exitCode).toBe(1);
    expect(cli("catalog", "remove", "agentkube", "--home", home).exitCode).toBe(0);
    expect(listCatalogs(home).catalogs).toEqual([]);
  });

  test("refreshes and searches a local catalog, adds by catalog id, and updates to its latest stable tag", async () => {
    const home = temporaryDirectory();
    const repository = temporaryDirectory();
    const skillRoot = join(repository, "skills", "review");
    skill(skillRoot, "review", "1.0.0");
    commitGitFixture(repository);
    git(repository, "tag", "review-v1.0.0");
    const catalogPath = join(temporaryDirectory(), "catalog.json");
    writeCatalog(catalogPath, pathToFileURL(repository).href, [
      { version: "1.0.0", ref: "review-v1.0.0" },
    ]);
    setupUser(home);
    pointAgentKubeCatalog(home, catalogPath);

    const searched = cli("catalog", "search", "review", "--home", home, "--json");
    expect(searched.exitCode).toBe(0);
    expect(JSON.parse(searched.stdout.toString()).results).toEqual([expect.objectContaining({ id: "review", version: "1.0.0" })]);
    expect((await refreshCatalogs(home)).catalogs[0]).toMatchObject({ id: "agentkube", cached: true, entries: 1 });
    expect(searchCatalogs(home, "review")).toEqual([{
      catalog: "agentkube",
      id: "review",
      type: "skill",
      description: "Review fixture",
      version: "1.0.0",
    }]);
    const added = cli("add", "agentkube:review", "--user", "--home", home, "--json");
    expect({ exitCode: added.exitCode, stderr: added.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
    const addedJson = JSON.parse(added.stdout.toString());
    expect(addedJson).toMatchObject({
      format: "agulater/extension-result/v1",
      action: "added",
      extension: { id: "review", type: "skill", version: "1.0.0" },
    });
    expect(addedJson.extension.skill_path).toBe(join(home, ".agents", "resources", "skills", "review", "SKILL.md"));
    expect(readJson(join(home, ".agents", ".agulater", "sources.json"))).toMatchObject({
      sources: [{ source: { type: "catalog", catalog: "agentkube", entry: "review" } }],
    });

    skill(skillRoot, "review", "1.1.0");
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "review 1.1.0");
    git(repository, "tag", "release-review-1.1");
    git(repository, "tag", "review-v2.0.0");
    writeCatalog(catalogPath, pathToFileURL(repository).href, [
      { version: "1.0.0", ref: "review-v1.0.0" },
      { version: "1.1.0", ref: "release-review-1.1" },
      { version: "2.0.0", ref: "review-v2.0.0" },
      { version: "2.0.0-dev.1", ref: "main" },
    ]);
    const updated = await updateExtensions(join(home, ".agents"), { id: "review", home });
    expect(updated).toEqual([expect.objectContaining({ name: "review", type: "skill", version: "1.1.0" })]);
    expect(readFileSync(join(home, ".agents", "resources", "skills", "review", "SKILL.md"), "utf8")).toContain("version: 1.1.0");
    expect(readFileSync(join(home, ".agents", "runtime", "resources", "skills", "review", "SKILL.md"), "utf8")).toContain("version: 1.1.0");
  });

  test("requires --type for an ambiguous catalog id", async () => {
    const home = temporaryDirectory();
    const catalogPath = join(temporaryDirectory(), "catalog.json");
    writeJson(catalogPath, {
      format: "agulater/catalog/v1",
      entries: ["skill", "plugin"].map((kind) => ({
        id: "shared",
        kind,
        description: `${kind} fixture`,
        versions: [{
          version: "1.0.0",
          source: { type: "git", url: "https://example.invalid/extensions.git", ref: `${kind}-release-1` },
        }],
      })),
    });
    setupUser(home);
    pointAgentKubeCatalog(home, catalogPath);
    await refreshCatalogs(home);

    const result = cli("add", "agentkube:shared", "--user", "--home", home);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("add --type");
  });

  test("rejects a branch ref for a stable catalog version", async () => {
    const home = temporaryDirectory();
    const catalogPath = join(temporaryDirectory(), "catalog.json");
    writeJson(catalogPath, {
      format: "agulater/catalog/v1",
      entries: [{
        id: "review",
        kind: "skill",
        description: "Invalid stable fixture",
        versions: [{
          version: "1.0.0",
          source: { type: "git", url: "https://example.invalid/extensions.git", ref: "refs/heads/release" },
        }],
      }],
    });
    setupUser(home);
    pointAgentKubeCatalog(home, catalogPath);

    await expect(refreshCatalogs(home)).rejects.toThrow("must name a Git tag");
  });

  test("replays Git sources with --all and local sources only when named", async () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const local = join(temporaryDirectory(), "local-review");
    skill(local, "local-review", "1.0.0");
    addExtension(agentsRoot, local, undefined, undefined, { home });
    skill(local, "local-review", "1.1.0");

    const repository = temporaryDirectory();
    skill(join(repository, "git-review"), "git-review", "2.0.0");
    commitGitFixture(repository);
    addExtension(agentsRoot, pathToFileURL(repository).href, "skill", "git-review", { home });
    skill(join(repository, "git-review"), "git-review", "2.1.0");
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "git review 2.1.0");

    const updated = await updateExtensions(agentsRoot, { all: true, home });
    expect(updated.map((entry) => `${entry.name}@${entry.version}`)).toEqual(["git-review@2.1.0"]);
    expect(readFileSync(join(agentsRoot, "runtime", "resources", "skills", "git-review", "SKILL.md"), "utf8")).toContain("version: 2.1.0");
    expect(readFileSync(join(agentsRoot, "runtime", "resources", "skills", "local-review", "SKILL.md"), "utf8")).toContain("version: 1.0.0");

    const localUpdate = await updateExtensions(agentsRoot, { id: "local-review", home });
    expect(localUpdate).toEqual([expect.objectContaining({ name: "local-review", version: "1.1.0" })]);
    expect(readFileSync(join(agentsRoot, "runtime", "resources", "skills", "local-review", "SKILL.md"), "utf8")).toContain("version: 1.1.0");

    if (process.platform === "win32" && agentsRoot.slice(0, 2).toLowerCase() !== import.meta.dir.slice(0, 2).toLowerCase()) {
      const crossDrive = join(import.meta.dir, "..", ".bun-cache", `cross-drive-${crypto.randomUUID()}`);
      temporaryRoots.push(crossDrive);
      skill(crossDrive, "cross-drive", "3.0.0");
      addExtension(agentsRoot, crossDrive, undefined, undefined, { home });
      const sourceRecord = (readJson(join(agentsRoot, ".agulater", "sources.json")) as any).sources
        .find((entry: any) => entry.id === "cross-drive");
      expect(sourceRecord.source.path).toBe(crossDrive);
      skill(crossDrive, "cross-drive", "3.1.0");
      expect(await updateExtensions(agentsRoot, { id: "cross-drive", home })).toEqual([
        expect.objectContaining({ name: "cross-drive", version: "3.1.0" }),
      ]);
    }
  });

  test("rolls back a named extension update when prepare fails", async () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const source = join(temporaryDirectory(), "review");
    const agentsRoot = createProject(workspace, "helper");
    skill(source, "review", "1.0.0");
    addExtension(agentsRoot, source, undefined, undefined, { home });
    const before = extensionMutationState(agentsRoot);
    skill(source, "review", "2.0.0");
    writeJson(join(agentsRoot, "pools.json"), { format: "agulater/pools/v1", pools: [] });

    await expect(updateExtensions(agentsRoot, { id: "review", home })).rejects.toThrow("format must be agulater/pools/v2");

    expect(extensionMutationState(agentsRoot)).toEqual(before);
  });

  test("rolls back every extension when a later --all update fails", async () => {
    const home = temporaryDirectory();
    const workspace = temporaryDirectory();
    const agentsRoot = createProject(workspace, "helper");
    const firstRepository = temporaryDirectory();
    const secondRepository = temporaryDirectory();
    skill(join(firstRepository, "first"), "first", "1.0.0");
    skill(join(secondRepository, "second"), "second", "1.0.0");
    commitGitFixture(firstRepository);
    commitGitFixture(secondRepository);
    addExtension(agentsRoot, pathToFileURL(firstRepository).href, "skill", "first", { home });
    addExtension(agentsRoot, pathToFileURL(secondRepository).href, "skill", "second", { home });
    const before = extensionMutationState(agentsRoot);

    skill(join(firstRepository, "first"), "first", "2.0.0");
    git(firstRepository, "add", ".");
    git(firstRepository, "commit", "--quiet", "-m", "first 2.0.0");
    rmSync(join(secondRepository, "second", "SKILL.md"));
    git(secondRepository, "add", "--all");
    git(secondRepository, "commit", "--quiet", "-m", "break second");

    await expect(updateExtensions(agentsRoot, { all: true, home })).rejects.toThrow("no matching skill, plugin, or package");

    expect(extensionMutationState(agentsRoot)).toEqual(before);
  });

  test("selects the newest authenticated GitHub release with an Agul asset for this platform", async () => {
    const platform = runtimePlatform();
    const expectedAsset = githubAssetFixture("1.1.0", platform);
    const commands: string[][] = [];
    const selected = await resolveGitHubRelease("example/agul", "stable", platform, {
      githubCli: "gh",
      spawn: (command) => {
        commands.push(command);
        return {
          exitCode: 0,
          stdout: Buffer.from(JSON.stringify([
            githubReleaseFixture("2.0.0", []),
            githubReleaseFixture("1.1.0", [{
              name: expectedAsset,
              browser_download_url: "https://example.invalid/agul-1.1.0",
            }]),
          ])),
          stderr: Buffer.from(""),
        };
      },
    });

    expect(selected).toMatchObject({
      version: "1.1.0",
      tagName: "v1.1.0",
      assetName: expectedAsset,
      githubCli: "gh",
    });
    expect(commands).toEqual([["gh", "api", "repos/example/agul/releases?per_page=100"]]);
  });

  test("selects an older usable GitHub release over a newer HTTP release without this platform asset", async () => {
    const platform = runtimePlatform();
    const expectedAsset = githubAssetFixture("1.2.0", platform);
    let requestUrl = "";
    const selected = await resolveGitHubRelease("example/agul", "stable", platform, {
      githubCli: null,
      fetch: async (url) => {
        requestUrl = url;
        return new Response(JSON.stringify([
          githubReleaseFixture("1.3.0", [{
            name: "agul-v1.3.0-source.zip",
            browser_download_url: "https://example.invalid/source",
          }]),
          githubReleaseFixture("1.2.0", [{
            name: expectedAsset,
            browser_download_url: "https://example.invalid/agul-1.2.0",
          }]),
        ]));
      },
    });

    expect(requestUrl).toBe("https://api.github.com/repos/example/agul/releases?per_page=100");
    expect(selected).toEqual({
      version: "1.2.0",
      tagName: "v1.2.0",
      assetName: expectedAsset,
      downloadUrl: "https://example.invalid/agul-1.2.0",
    });
  });

  test("reports when GitHub has releases but no usable Agul asset for this platform", async () => {
    const platform = runtimePlatform();
    await expect(resolveGitHubRelease("example/agul", "stable", platform, {
      githubCli: null,
      fetch: async () => new Response(JSON.stringify([
        githubReleaseFixture("1.3.0", [{
          name: "agul-v1.3.0-source.zip",
          browser_download_url: "https://example.invalid/source",
        }]),
      ])),
    })).rejects.toThrow(`example/agul has no stable release with an available ${platform} Agul asset`);
  });

  test("installs, reports, and switches a fake Agul release without a Bun-dependent shim", () => {
    const fixture = temporaryDirectory();
    const prefix = join(temporaryDirectory(), "agul-install");
    const index = join(fixture, "releases.json");
    const first = fakeAgul(fixture, "1.0.0");
    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(first) }]);

    const installed = cli("runtime", "install", "--url", index, "--prefix", prefix, "--json");
    expect({ exitCode: installed.exitCode, stderr: installed.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
    const installResult = JSON.parse(installed.stdout.toString());
    expect(installResult).toMatchObject({ installed: true, version: "1.0.0", channel: "stable", prefix });
    expect(runAgulShim(installResult.shim)).toBe("agul 1.0.0");
    expect(JSON.parse(cli("runtime", "status", "--prefix", prefix, "--json").stdout.toString())).toMatchObject({
      installed: true,
      version: "1.0.0",
    });
    const humanStatus = cli("runtime", "status", "--prefix", prefix);
    expect(humanStatus.exitCode).toBe(0);
    expect(humanStatus.stdout.toString()).toContain(`Launcher: ${installResult.shim}`);
    expect(humanStatus.stdout.toString()).toContain(`Run now: ${launcherCommandFixture(installResult.shim)}`);
    expect(humanStatus.stdout.toString()).toContain("Open a new terminal, then run: agul");
    writeFileSync(installResult.executable, "not an Agul executable\n", "utf8");
    const repaired = cli("runtime", "install", "--url", index, "--prefix", prefix, "--json");
    expect(repaired.exitCode).toBe(0);
    expect(runAgulShim(JSON.parse(repaired.stdout.toString()).shim)).toBe("agul 1.0.0");

    const second = fakeAgul(fixture, "1.1.0");
    const previewTwo = fakeAgul(fixture, "2.0.0-alpha.2");
    const previewTen = fakeAgul(fixture, "2.0.0-alpha.10");
    writeRuntimeIndex(index, [
      { version: "1.0.0", executable: basename(first) },
      { version: "1.1.0", executable: basename(second) },
      { version: "2.0.0-alpha.10", executable: basename(previewTen), channel: "next" },
      { version: "2.0.0-alpha.2", executable: basename(previewTwo), channel: "next" },
    ]);
    const updated = cli("runtime", "update", "--prefix", prefix, "--json");
    expect({ exitCode: updated.exitCode, stderr: updated.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
    const updateResult = JSON.parse(updated.stdout.toString());
    expect(updateResult.version).toBe("1.1.0");
    expect(runAgulShim(updateResult.shim)).toBe("agul 1.1.0");
    expect(existsSync(join(prefix, "versions", "1.0.0"))).toBe(true);
    expect(existsSync(join(prefix, "versions", "1.1.0"))).toBe(true);

    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(first) }]);
    const downgrade = cli("runtime", "update", "--prefix", prefix, "--json");
    expect(downgrade.exitCode).toBe(1);
    expect(downgrade.stderr.toString()).toContain("refusing to downgrade");
    expect(runAgulShim(updateResult.shim)).toBe("agul 1.1.0");

    writeRuntimeIndex(index, [
      { version: "2.0.0-alpha.10", executable: basename(previewTen), channel: "next" },
      { version: "2.0.0-alpha.2", executable: basename(previewTwo), channel: "next" },
    ]);
    const previewPrefix = join(temporaryDirectory(), "agul-preview");
    const previewInstall = cli("runtime", "install", "--channel", "next", "--url", index, "--prefix", previewPrefix, "--json");
    const previewResult = JSON.parse(previewInstall.stdout.toString());
    expect(previewResult).toMatchObject({ version: "2.0.0-alpha.10", channel: "next" });
    rmSync(previewResult.shim, { force: true });
    expect(JSON.parse(cli("runtime", "status", "--prefix", previewPrefix, "--json").stdout.toString())).toMatchObject({
      installed: false,
      version: "2.0.0-alpha.10",
      reason: "launcher is missing",
    });

    const invalid = readJson(index) as any;
    invalid.releases[0].unexpected = true;
    writeJson(index, invalid);
    const rejected = cli("runtime", "install", "--channel", "next", "--url", index, "--prefix", join(temporaryDirectory(), "invalid"));
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("unknown field unexpected");
  });

  test("restores the previous Agul launcher when activation state cannot commit", async () => {
    const fixture = temporaryDirectory();
    const prefix = join(temporaryDirectory(), "agul-install");
    const index = join(fixture, "releases.json");
    const first = fakeAgul(fixture, "1.0.0");
    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(first) }]);
    const installed = await installRuntime({ url: index, prefix });
    const previousShim = readFileSync(installed.shim);
    const recordPath = join(prefix, "current.json");
    const previousRecord = readFileSync(recordPath);

    const second = fakeAgul(fixture, "1.1.0");
    writeRuntimeIndex(index, [
      { version: "1.0.0", executable: basename(first) },
      { version: "1.1.0", executable: basename(second) },
    ]);
    const savedRecord = join(prefix, "current-before-failed-update.json");
    renameSync(recordPath, savedRecord);
    mkdirSync(recordPath);

    try {
      expect(() => commitRuntimeActivation(prefix, {
        format: runtimeInstallFormat,
        version: "1.1.0",
        channel: installed.channel,
        platform: installed.platform,
        executable: second,
        shim: installed.shim,
        url: index,
      })).toThrow();
      expect(readFileSync(installed.shim)).toEqual(previousShim);
      expect(runAgulShim(installed.shim)).toBe("agul 1.0.0");
      if (process.platform !== "win32") expect(statSync(installed.shim).mode & 0o111).not.toBe(0);
    } finally {
      rmSync(recordPath, { recursive: true, force: true });
      renameSync(savedRecord, recordPath);
    }

    expect(readFileSync(recordPath)).toEqual(previousRecord);
  });

  test("removes a first-install launcher when activation state cannot commit", () => {
    const fixture = temporaryDirectory();
    const prefix = join(temporaryDirectory(), "agul-install");
    const index = join(fixture, "releases.json");
    const executable = fakeAgul(fixture, "1.0.0");
    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(executable) }]);
    const platform = runtimePlatform();
    const shim = join(prefix, "bin", platform === "windows-x64" ? "agul.cmd" : "agul");
    mkdirSync(join(prefix, "current.json"), { recursive: true });

    expect(() => commitRuntimeActivation(prefix, {
      format: runtimeInstallFormat,
      version: "1.0.0",
      channel: "stable",
      platform,
      executable,
      shim,
      url: index,
    })).toThrow();
    expect(existsSync(shim)).toBe(false);
  });

  test("removes a legacy Windows executable that shadows the managed launcher", () => {
    const prefix = join(temporaryDirectory(), "agul-install");
    const executable = join(prefix, "versions", "1.0.0", "agul.exe");
    const shim = join(prefix, "bin", "agul.cmd");
    const shadow = join(prefix, "bin", "agul.exe");
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(executable, "managed executable", "utf8");
    writeFileSync(shadow, "legacy executable", "utf8");

    commitRuntimeActivation(prefix, {
      format: runtimeInstallFormat,
      version: "1.0.0",
      channel: "stable",
      platform: "windows-x64",
      executable,
      shim,
      repository: "example/agul",
    });

    expect(existsSync(shadow)).toBe(false);
    expect(readFileSync(shim, "utf8")).toContain(`"${executable}" %*`);
    expect(readJson(join(prefix, "current.json"))).toMatchObject({ version: "1.0.0", shim });
  });

  test("restores a shadowing Windows executable when activation cannot commit", () => {
    const prefix = join(temporaryDirectory(), "agul-install");
    const executable = join(prefix, "versions", "1.1.0", "agul.exe");
    const shim = join(prefix, "bin", "agul.cmd");
    const shadow = join(prefix, "bin", "agul.exe");
    const previousShim = Buffer.from("@echo off\r\necho previous\r\n");
    const previousShadow = Buffer.from("legacy executable");
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(executable, "managed executable", "utf8");
    writeFileSync(shim, previousShim);
    writeFileSync(shadow, previousShadow);
    mkdirSync(join(prefix, "current.json"));

    expect(() => commitRuntimeActivation(prefix, {
      format: runtimeInstallFormat,
      version: "1.1.0",
      channel: "stable",
      platform: "windows-x64",
      executable,
      shim,
      repository: "example/agul",
    })).toThrow();

    expect(readFileSync(shim)).toEqual(previousShim);
    expect(readFileSync(shadow)).toEqual(previousShadow);
  });

  test("reports a managed Windows runtime as unavailable while a legacy executable shadows it", () => {
    const prefix = join(temporaryDirectory(), "agul-install");
    const executable = join(prefix, "versions", "1.0.0", "agul.exe");
    const shim = join(prefix, "bin", "agul.cmd");
    const shadow = join(prefix, "bin", "agul.exe");
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(executable, "managed executable", "utf8");
    writeFileSync(shim, "@echo off\r\n", "utf8");
    writeFileSync(shadow, "legacy executable", "utf8");
    writeJson(join(prefix, "current.json"), {
      format: runtimeInstallFormat,
      version: "1.0.0",
      channel: "stable",
      platform: "windows-x64",
      executable,
      shim,
      repository: "example/agul",
    });

    expect(runtimeStatus({ prefix })).toMatchObject({
      installed: false,
      reason: `legacy Agul executable shadows the managed launcher: ${shadow}`,
    });
  });

  test("rejects an overlapping runtime activation without changing the active version", async () => {
    const fixture = temporaryDirectory();
    const prefix = join(temporaryDirectory(), "agul-install");
    const index = join(fixture, "releases.json");
    const first = fakeAgul(fixture, "1.0.0");
    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(first) }]);
    const installed = await installRuntime({ url: index, prefix });

    const second = fakeAgul(fixture, "1.1.0");
    writeRuntimeIndex(index, [
      { version: "1.0.0", executable: basename(first) },
      { version: "1.1.0", executable: basename(second) },
    ]);
    const release = await lockfile.lock(prefix, { retries: 0 });
    try {
      const busy = cli("runtime", "update", "--prefix", prefix, "--json");
      expect(busy.exitCode).toBe(1);
      expect(busy.stderr.toString()).toContain("another Agul install or update is finishing");
      expect(existsSync(join(prefix, "versions", "1.1.0"))).toBe(false);
    } finally {
      await release();
    }

    expect(runAgulShim(installed.shim)).toBe("agul 1.0.0");
    expect(readJson(join(prefix, "current.json"))).toMatchObject({ version: "1.0.0" });
    expect(existsSync(`${prefix}.lock`)).toBe(false);
  });

  test("rechecks the active version before publishing a stale runtime update", async () => {
    const fixture = temporaryDirectory();
    const prefix = join(temporaryDirectory(), "agul-install");
    const index = join(fixture, "releases.json");
    const first = fakeAgul(fixture, "1.0.0");
    writeRuntimeIndex(index, [{ version: "1.0.0", executable: basename(first) }]);
    const installed = await installRuntime({ url: index, prefix });

    const stale = fakeAgul(fixture, "1.1.0");
    writeRuntimeIndex(index, [
      { version: "1.0.0", executable: basename(first) },
      { version: "1.1.0", executable: basename(stale) },
    ]);
    const staleUpdate = updateRuntime({ prefix });

    const newest = fakeAgul(fixture, "2.0.0-alpha.1");
    commitRuntimeActivation(prefix, {
      format: runtimeInstallFormat,
      version: "2.0.0-alpha.1",
      channel: "next",
      platform: installed.platform,
      executable: newest,
      shim: installed.shim,
      url: index,
    });

    await expect(staleUpdate).rejects.toThrow("Agul runtime changed");
    expect(runAgulShim(installed.shim)).toBe("agul 2.0.0-alpha.1");
    expect(readJson(join(prefix, "current.json"))).toMatchObject({
      version: "2.0.0-alpha.1",
      channel: "next",
    });
    expect(existsSync(join(prefix, "versions", "1.1.0"))).toBe(false);
  });

  test("bootstrap does not claim an existing directory and upgrades only the exact generated v1", () => {
    const unmanagedHome = temporaryDirectory();
    mkdirSync(join(unmanagedHome, ".agents"), { recursive: true });
    writeFileSync(join(unmanagedHome, ".agents", "KEEP"), "keep\n", "utf8");
    const unmanaged = setupUser(unmanagedHome, { ifMissing: true });
    expect(unmanaged).toMatchObject({ created: false, prepared: false, unmanaged: true });
    expect(existsSync(join(unmanagedHome, ".agents", "package.json"))).toBe(false);

    const legacyHome = temporaryDirectory();
    const legacyRoot = join(legacyHome, ".agents");
    mkdirSync(legacyRoot, { recursive: true });
    writeJson(join(legacyRoot, "package.json"), legacyUserPackage());
    writeFileSync(join(legacyRoot, "AGENTS.md"), defaultUserInstructions(), "utf8");
    expect(setupUser(legacyHome, { ifMissing: true })).toMatchObject({ created: false, prepared: true });
    expect(readPackage(legacyRoot).format).toBe("agulater/package/v2");

    const customHome = temporaryDirectory();
    const customRoot = join(customHome, ".agents");
    mkdirSync(customRoot, { recursive: true });
    writeJson(join(customRoot, "package.json"), legacyUserPackage());
    writeFileSync(join(customRoot, "AGENTS.md"), "custom\n", "utf8");
    skill(join(customRoot, "skills", "legacy"), "legacy", "1.0.0");
    const nestedPackage = join(customRoot, "skills", ".agents");
    mkdirSync(nestedPackage, { recursive: true });
    writeFileSync(join(nestedPackage, "AGENTS.md"), "# Nested\n", "utf8");
    writeJson(join(nestedPackage, "package.json"), {
      format: "agulater/package/v2",
      id: "nested",
      version: "1.0.0",
      description: "Nested migration fixture",
      instructions: "AGENTS.md",
    });
    expect(setupUser(customHome, { ifMissing: true })).toMatchObject({
      prepared: false,
      unmanaged: true,
      notice: expect.stringContaining("run agulater migrate user explicitly"),
    });
    expect(migrateUser(customHome).launchPath).toBe(join(customRoot, "runtime", "launch.json"));
    expect(readFileSync(join(customRoot, "AGENTS.md"), "utf8")).toBe("custom\n");
    expect(readPackage(customRoot)).toMatchObject({ format: "agulater/package/v2", id: "user-assistant" });
    expect(readPackage(customRoot).resources?.skills).toEqual([{ id: "legacy", path: "skills/legacy" }]);
  });

  test("CLI and package metadata expose the strict v2 workflow", () => {
    const workspace = temporaryDirectory();
    expect(cli("create", "helper", "--path", workspace).exitCode).toBe(0);
    expect(cli("prepare", "--path", workspace, "--home", temporaryDirectory()).exitCode).toBe(0);
    const help = cli("--help");
    expect(help.stdout.toString()).toContain("skill|plugin|package");
    expect(help.stdout.toString()).toContain("--if-missing");
    expect(cli("catalog", "--help").stdout.toString()).toContain("catalog add <id> <url-or-path>");
    expect(cli("catalog").stdout.toString()).toContain("catalog search [query]");
    expect(cli("runtime", "--help").stdout.toString()).toContain("runtime install");
    expect(cli("runtime").stdout.toString()).toContain("runtime status");
    for (const [command, expected] of [
      [["runtime", "install", "--help"], "runtime install"],
      [["catalog", "add", "--help"], "catalog add <id> <url-or-path>"],
      [["add", "--help"], "agulater add <source>"],
      [["prepare", "-h"], "agulater prepare"],
    ] as const) {
      const result = cli(...command);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).toContain(expected);
    }
    const unknown = cli("prepare", "--unknown");
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr.toString()).toContain("unknown option: --unknown");
    const metadata = readJson(join(import.meta.dir, "..", "package.json")) as any;
    expect(metadata.scripts.postinstall).toBe("bun tools/agulater.ts setup user --if-missing");
  });

  test("ships parseable formal schemas", () => {
    const schemaRoot = join(import.meta.dir, "..", "schemas");
    for (const name of ["package-v2", "harness-v1", "pools-v2", "snapshot-v1", "specialists-v1", "catalog-v1", "catalogs-v1", "runtime-releases-v1"]) {
      expect(readJson(join(schemaRoot, `${name}.schema.json`))).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
      });
    }
  });
});

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "agulater-test-"));
  temporaryRoots.push(root);
  return root;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileIdentity(path: string): Record<string, bigint> {
  const stats = statSync(path, { bigint: true });
  return { inode: stats.ino, modified: stats.mtimeNs, size: stats.size };
}

function extensionMutationState(root: string): Record<string, unknown> {
  const sources = join(root, ".agulater", "sources.json");
  return {
    package: readFileSync(join(root, "package.json"), "utf8"),
    sources: existsSync(sources) ? readFileSync(sources, "utf8") : undefined,
    resources: treeSnapshot(join(root, "resources")),
    runtime: treeSnapshot(join(root, "runtime")),
  };
}

function treeSnapshot(root: string): Array<[string, "directory"] | [string, "file", string]> {
  if (!existsSync(root)) return [];
  const snapshot: Array<[string, "directory"] | [string, "file", string]> = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const locator = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        snapshot.push([locator, "directory"]);
        visit(path);
      } else {
        snapshot.push([locator, "file", readFileSync(path).toString("base64")]);
      }
    }
  };
  visit(root);
  return snapshot;
}

function skill(path: string, name: string, version: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(path + "/SKILL.md", `---\nname: ${name}\nversion: ${version}\ndescription: Test skill.\n---\n\n# ${name}\n`, "utf8");
}

function harness(): Record<string, unknown> {
  return {
    format: "agulater/harness/v1",
    task_template: "## Task\n{{task}}",
    requirements: { min_context_window: 16000, capabilities: ["shell"] },
    defaults: { reasoning_effort: "medium", max_rounds: 4, max_tool_calls: 8, max_tokens: 1536, timeout_seconds: 600 },
    result: { format: "agul/handoff/v1", summary_max_chars: 800, evidence_max_items: 8 },
    completion: { verification: "required", rules: ["Cite repository evidence."] },
  };
}

function pool(id: string, model: string): Record<string, unknown> {
  return {
    id,
    engine: "native",
    provider: "openai-compatible",
    endpoint: "http://127.0.0.1:8000/v1",
    model,
    context_window: 32768,
    capabilities: ["tools"],
    max_concurrency: 2,
    request_timeout_seconds: 420,
  };
}

function codexPool(id: string): Record<string, unknown> {
  return {
    id,
    engine: "codex",
    capabilities: ["read", "write", "edit", "shell"],
    max_concurrency: 1,
    request_timeout_seconds: 600,
  };
}

function pools(defaultPool: string, entries: Record<string, unknown>[]): Record<string, unknown> {
  return { format: "agulater/pools/v2", default_pool: defaultPool, pools: entries };
}

function legacyUserPackage(): Record<string, unknown> {
  return {
    format: "agulater/package/v1",
    name: "user-assistant",
    version: "0.1.0",
    instructions: "AGENTS.md",
    skills: "skills",
    plugins: "plugins",
    agents: "agents",
  };
}

function defaultUserInstructions(): string {
  return "# user-assistant\n\nHelp with tasks in this directory. Read the existing files, make the requested changes, and verify the result.\n";
}

function pointAgentKubeCatalog(home: string, catalog: string): void {
  writeJson(join(home, ".agents", ".agulater", "catalogs.json"), {
    format: "agulater/catalogs/v1",
    catalogs: [{ id: "agentkube", url: catalog }],
  });
}

function githubReleaseFixture(
  version: string,
  assets: Array<{ name: string; browser_download_url: string }>,
): Record<string, unknown> {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    assets,
  };
}

function githubAssetFixture(version: string, platform: ReturnType<typeof runtimePlatform>): string {
  const target = {
    "windows-x64": "x86_64-pc-windows-msvc.zip",
    "linux-x64": "x86_64-unknown-linux-gnu.tar.gz",
    "macos-x64": "x86_64-apple-darwin.tar.gz",
    "macos-arm64": "aarch64-apple-darwin.tar.gz",
  }[platform];
  return `agul-v${version}-${target}`;
}

function launcherCommandFixture(shim: string): string {
  if (process.platform === "win32") return `& '${shim.replaceAll("'", "''")}'`;
  return `'${shim.replaceAll("'", `'"'"'`)}'`;
}

function writeCatalog(path: string, repository: string, versions: Array<{ version: string; ref: string }>): void {
  writeJson(path, {
    format: "agulater/catalog/v1",
    entries: [{
      id: "review",
      kind: "skill",
      description: "Review fixture",
      versions: versions.map((version) => ({
        version: version.version,
        source: { type: "git", url: repository, subdir: "skills/review", ref: version.ref },
      })),
    }],
  });
}

function fakeAgul(root: string, version: string): string {
  const windows = process.platform === "win32";
  const path = join(root, `agul-${version}${windows ? ".cmd" : ""}`);
  const contents = windows
    ? `@echo off\r\nif "%1"=="--version" echo agul ${version}\r\n`
    : `#!/bin/sh\n[ "$1" = "--version" ] && echo "agul ${version}"\n`;
  writeFileSync(path, contents, "utf8");
  if (!windows) chmodSync(path, 0o755);
  return path;
}

function writeRuntimeIndex(path: string, releases: Array<{ version: string; executable: string; channel?: "stable" | "next" }>): void {
  const platform = runtimePlatform();
  writeJson(path, {
    format: "agulater/runtime-releases/v1",
    releases: releases.map((release) => ({
      version: release.version,
      channel: release.channel ?? "stable",
      assets: {
        [platform]: { path: release.executable, executable: release.executable },
      },
    })),
  });
}

function runAgulShim(path: string): string {
  const command = process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", "/d", "/c", path, "--version"]
    : [path, "--version"];
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function commitGitFixture(repository: string): void {
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Agulater Test");
  git(repository, "config", "user.email", "agulater@example.invalid");
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", "fixture");
}

function cli(...args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "agulater.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
}
