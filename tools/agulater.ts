#!/usr/bin/env bun

import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import {
  addCatalogExtension,
  addExtension,
  createProject,
  ensureProject,
  extensionTypes,
  listCatalogs,
  migrateUser,
  prepare,
  projectAgentsRoot,
  readPackage,
  refreshCatalogs,
  removeCatalog,
  removeExtension,
  searchCatalogs,
  setCatalog,
  setupUser,
  syncDependencies,
  updateExtensions,
  userAgentsRoot,
  type ExtensionResult,
  type ExtensionType,
} from "./lib/agulater.ts";
import {
  installRuntime,
  runtimeStatus,
  updateRuntime,
  type RuntimeChannel,
} from "./lib/runtime-manager.ts";
import { agulaterVersion } from "./lib/version.ts";

const help = `Agulater prepares .agents packages for Agul.

Usage:
  agulater create [name] [--path <workspace>]
  agulater add <source> [--type skill|plugin|package] [--name <name>]
                        [--path <workspace> | --user [--home <directory>]] [--json]
  agulater update <name> | --all [--type skill|plugin|package]
                        [--path <workspace> | --user [--home <directory>]] [--json]
  agulater remove <name> [--type skill|plugin|package]
                           [--path <workspace> | --user [--home <directory>]]
  agulater prepare [--path <workspace> | --user] [--home <directory>]
  agulater sync [--catalog <catalog.json>] [--path <workspace> | --user]
                 [--home <directory>]
  agulater setup user [--if-missing] [--home <directory>]
  agulater migrate user [--home <directory>]
  agulater catalog list [--home <directory>] [--json]
  agulater catalog add <id> <url-or-path> [--home <directory>] [--json]
  agulater catalog remove <id> [--home <directory>] [--json]
  agulater catalog refresh [catalog] [--home <directory>] [--json]
  agulater catalog search [query] [--home <directory>] [--json]
  agulater runtime install [--channel stable|next] [--prefix <directory>]
                            [--repository <owner/name> | --url <release-index>] [--json]
  agulater runtime update [--channel stable|next] [--prefix <directory>]
                           [--repository <owner/name> | --url <release-index>] [--json]
  agulater runtime status [--prefix <directory>] [--json]
  agulater --version
  agulater --help`;

const catalogHelp = `Usage:
  agulater catalog list [--home <directory>] [--json]
  agulater catalog add <id> <url-or-path> [--home <directory>] [--json]
  agulater catalog remove <id> [--home <directory>] [--json]
  agulater catalog refresh [catalog] [--home <directory>] [--json]
  agulater catalog search [query] [--home <directory>] [--json]`;

const runtimeHelp = `Usage:
  agulater runtime install [--channel stable|next] [--prefix <directory>]
                            [--repository <owner/name> | --url <release-index>] [--json]
  agulater runtime update [--channel stable|next] [--prefix <directory>]
                           [--repository <owner/name> | --url <release-index>] [--json]
  agulater runtime status [--prefix <directory>] [--json]`;

type Parsed = {
  positionals: string[];
  values: Map<string, string>;
  flags: Set<string>;
};

export async function run(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(help);
    return;
  }
  if (args.some((argument) => argument === "--help" || argument === "-h")) {
    console.log(args[0] === "catalog" ? catalogHelp : args[0] === "runtime" ? runtimeHelp : help);
    return;
  }
  if (args[0] === "--version" || args[0] === "-V") {
    console.log(`agulater ${agulaterVersion}`);
    return;
  }

  const [command, ...rest] = args;
  switch (command) {
    case "create": {
      const parsed = parse(rest, ["path"]);
      expectPositionals(parsed, 0, 1, "create [name]");
      const root = createProject(parsed.values.get("path") ?? ".", parsed.positionals[0]);
      console.log(`created ${root}`);
      return;
    }
    case "add": {
      const parsed = parse(rest, ["path", "home", "type", "name"], ["user", "json"]);
      expectPositionals(parsed, 1, 1, "add <source>");
      const type = parseType(parsed.values.get("type"));
      const root = targetRoot(parsed, true);
      const home = parsed.values.get("home") ?? homedir();
      const catalog = catalogReference(parsed.positionals[0]!);
      if (catalog && parsed.values.has("name")) throw new Error("catalog extensions are named by their entry; remove --name");
      const result = catalog
        ? await addCatalogExtension(root, catalog.catalog, catalog.entry, type, { home })
        : addExtension(root, parsed.positionals[0]!, type, parsed.values.get("name"), { home });
      printExtension("added", result, root, parsed.flags.has("json"));
      return;
    }
    case "update": {
      const parsed = parse(rest, ["path", "home", "type"], ["user", "all", "json"]);
      expectPositionals(parsed, parsed.flags.has("all") ? 0 : 1, parsed.flags.has("all") ? 0 : 1, "update <name> | --all");
      const root = targetRoot(parsed, false);
      const results = await updateExtensions(root, {
        id: parsed.positionals[0],
        all: parsed.flags.has("all"),
        type: parseType(parsed.values.get("type")),
        home: parsed.values.get("home") ?? homedir(),
      });
      if (parsed.flags.has("json")) {
        console.log(JSON.stringify({ format: "agulater/update-result/v1", updated: results.map(extensionJson) }));
      } else if (results.length === 0) {
        console.log("no Catalog or Git extensions to update; name a local extension explicitly");
      } else {
        console.log(`updated ${results.map((result) => `${result.type}:${result.name}@${result.version}`).join(", ")}`);
      }
      return;
    }
    case "remove": {
      const parsed = parse(rest, ["path", "home", "type"], ["user"]);
      expectPositionals(parsed, 1, 1, "remove <name>");
      const type = parseType(parsed.values.get("type"));
      const root = targetRoot(parsed, false);
      const result = removeExtension(root, parsed.positionals[0]!, type);
      console.log(`removed ${result.type} ${result.name} from ${root}`);
      return;
    }
    case "prepare": {
      const parsed = parse(rest, ["path", "home"], ["user"]);
      expectPositionals(parsed, 0, 0, "prepare");
      const root = targetRoot(parsed, false);
      console.log(`prepared ${prepare(root, { home: parsed.values.get("home") })}`);
      return;
    }
    case "sync": {
      const parsed = parse(rest, ["path", "home", "catalog"], ["user"]);
      expectPositionals(parsed, 0, 0, "sync");
      const root = targetRoot(parsed, false);
      const result = syncDependencies(root, {
        home: parsed.values.get("home"),
        catalog: parsed.values.get("catalog"),
      });
      console.log(`synced ${result.installed.length} dependencies; prepared ${result.launchPath}`);
      return;
    }
    case "setup": {
      const parsed = parse(rest, ["home"], ["if-missing"]);
      expectPositionals(parsed, 1, 1, "setup user");
      if (parsed.positionals[0] !== "user") {
        throw new Error("usage: agulater setup user [--home <directory>]");
      }
      const result = setupUser(parsed.values.get("home") ?? homedir(), {
        ifMissing: parsed.flags.has("if-missing"),
      });
      const action = result.created ? "created" : result.prepared ? "prepared" : "left unchanged";
      console.log(`${action} ${result.root}${result.notice ? `; ${result.notice}` : ""}`);
      return;
    }
    case "migrate": {
      const parsed = parse(rest, ["home"]);
      expectPositionals(parsed, 1, 1, "migrate user");
      if (parsed.positionals[0] !== "user") {
        throw new Error("usage: agulater migrate user [--home <directory>]");
      }
      const result = migrateUser(parsed.values.get("home") ?? homedir());
      console.log(`migrated ${result.root}; prepared ${result.launchPath}`);
      return;
    }
    case "catalog": {
      if (groupHelpRequested(rest)) {
        console.log(catalogHelp);
        return;
      }
      const parsed = parse(rest, ["home"], ["json"]);
      expectPositionals(parsed, 1, 3, "catalog list|add|remove|refresh|search");
      const [action, query, source] = parsed.positionals;
      const home = parsed.values.get("home") ?? homedir();
      if (action === "list") {
        if (query) throw new Error("usage: agulater catalog list");
        const result = listCatalogs(home);
        if (parsed.flags.has("json")) console.log(JSON.stringify(result));
        else if (result.catalogs.length === 0) console.log("no catalogs registered");
        else for (const item of result.catalogs) console.log(`${item.id}\t${item.cached ? `${item.entries} entries` : "not cached"}\t${item.url}`);
        return;
      }
      if (action === "add") {
        if (!query || !source) throw new Error("usage: agulater catalog add <id> <url-or-path>");
        const result = setCatalog(home, query, source);
        if (parsed.flags.has("json")) console.log(JSON.stringify(result));
        else console.log(`registered catalog ${query}`);
        return;
      }
      if (action === "remove") {
        if (!query || source) throw new Error("usage: agulater catalog remove <id>");
        const result = removeCatalog(home, query);
        if (parsed.flags.has("json")) console.log(JSON.stringify(result));
        else console.log(`removed catalog ${query}`);
        return;
      }
      if (action === "refresh") {
        if (source) throw new Error("usage: agulater catalog refresh [catalog]");
        const result = await refreshCatalogs(home, query);
        if (parsed.flags.has("json")) console.log(JSON.stringify(result));
        else console.log(`refreshed ${query ? 1 : result.catalogs.length} catalog(s)`);
        return;
      }
      if (action === "search") {
        if (source) throw new Error("usage: agulater catalog search [query]");
        if (listCatalogs(home).catalogs.some((catalog) => !catalog.cached)) await refreshCatalogs(home);
        const results = searchCatalogs(home, query);
        if (parsed.flags.has("json")) console.log(JSON.stringify({ format: "agulater/catalog-search/v1", results }));
        else if (results.length === 0) console.log("no matching extensions");
        else for (const item of results) console.log(`${item.catalog}:${item.id}\t${item.type}\t${item.version}\t${item.description}`);
        return;
      }
      throw new Error("usage: agulater catalog list|add|remove|refresh|search");
    }
    case "runtime": {
      if (groupHelpRequested(rest)) {
        console.log(runtimeHelp);
        return;
      }
      const parsed = parse(rest, ["channel", "prefix", "repository", "url", "home"], ["json"]);
      expectPositionals(parsed, 1, 1, "runtime install|update|status");
      if (parsed.values.has("repository") && parsed.values.has("url")) throw new Error("use either --repository or --url");
      const channel = parseChannel(parsed.values.get("channel"));
      const options = {
        ...(channel ? { channel } : {}),
        ...(parsed.values.get("prefix") ? { prefix: parsed.values.get("prefix") } : {}),
        ...(parsed.values.get("repository") ? { repository: parsed.values.get("repository") } : {}),
        ...(parsed.values.get("url") ? { url: parsed.values.get("url") } : {}),
        ...(parsed.values.get("home") ? { home: parsed.values.get("home") } : {}),
      };
      const action = parsed.positionals[0];
      if (action === "status" && (channel || parsed.values.has("repository") || parsed.values.has("url"))) {
        throw new Error("runtime status accepts only --prefix, --home, and --json");
      }
      const result = action === "install"
        ? await installRuntime(options)
        : action === "update"
          ? await updateRuntime(options)
          : action === "status"
            ? runtimeStatus(options)
            : undefined;
      if (!result) throw new Error("usage: agulater runtime install|update|status");
      if (parsed.flags.has("json")) console.log(JSON.stringify(result));
      else if (!result.installed) console.log(result.reason ? `Agul at ${result.prefix} is unavailable: ${result.reason}` : `Agul is not managed at ${result.prefix}`);
      else {
        console.log(`Agul ${result.version} (${result.channel})`);
        console.log(`Launcher: ${result.shim}`);
        console.log(`Run now: ${runtimeLauncherCommand(result.shim)}`);
        for (const hint of runtimePathHints(result.shim)) console.log(hint);
      }
      return;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

function groupHelpRequested(args: string[]): boolean {
  return args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"));
}

function catalogReference(source: string): { catalog: string; entry: string } | undefined {
  const match = source.match(/^([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._/-]*)$/);
  return match ? { catalog: match[1]!, entry: match[2]! } : undefined;
}

function extensionJson(result: ExtensionResult): Record<string, unknown> {
  return {
    id: result.name,
    type: result.type,
    version: result.version,
    path: result.path,
    ...(result.type === "skill" ? { skill_path: resolve(result.path, "SKILL.md") } : {}),
  };
}

function printExtension(action: string, result: ExtensionResult, root: string, json: boolean): void {
  if (json) console.log(JSON.stringify({ format: "agulater/extension-result/v1", action, extension: extensionJson(result) }));
  else console.log(`${action} ${result.type} ${result.name} to ${root}`);
}

function parseChannel(value: string | undefined): RuntimeChannel | undefined {
  if (value === undefined) return undefined;
  if (value !== "stable" && value !== "next") throw new Error("--channel must be stable or next");
  return value;
}

function runtimeLauncherCommand(shim: string): string {
  if (process.platform === "win32") return `& '${shim.replaceAll("'", "''")}'`;
  return `'${shim.replaceAll("'", `'"'"'`)}'`;
}

function runtimePathHints(shim: string): string[] {
  const bin = dirname(shim);
  const normalize = (path: string) => resolve(path).replace(/[\\/]+$/, "").toLowerCase();
  if ((process.env.PATH ?? "").split(delimiter).filter(Boolean).some((path) => normalize(path) === normalize(bin))) {
    return ["PATH is ready; run: agul"];
  }
  return process.platform === "win32"
    ? [`Add this directory to your user PATH: ${bin}`, "Open a new terminal, then run: agul"]
    : [`Add to your shell profile: export PATH="${bin}:$PATH"`, "Open a new terminal, then run: agul"];
}

function targetRoot(parsed: Parsed, createIfMissing: boolean): string {
  const user = parsed.flags.has("user");
  if (user && parsed.values.has("path")) {
    throw new Error("use either --path or --user");
  }
  if (user) {
    const home = parsed.values.get("home") ?? homedir();
    if (createIfMissing) {
      return setupUser(home).root;
    }
    const root = userAgentsRoot(home);
    readPackage(root);
    return root;
  }
  const workspace = resolve(parsed.values.get("path") ?? ".");
  return createIfMissing ? ensureProject(workspace) : projectAgentsRoot(workspace);
}

function parse(args: string[], valueNames: string[], flagNames: string[] = []): Parsed {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (flagNames.includes(name)) {
      flags.add(name);
      continue;
    }
    if (!valueNames.includes(name)) {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    values.set(name, value);
    index += 1;
  }
  return { positionals, values, flags };
}

function parseType(value: string | undefined): ExtensionType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!extensionTypes.includes(value as ExtensionType)) {
    throw new Error(`--type must be ${extensionTypes.join(", ")}`);
  }
  return value as ExtensionType;
}

function expectPositionals(parsed: Parsed, minimum: number, maximum: number, usage: string): void {
  if (parsed.positionals.length < minimum || parsed.positionals.length > maximum) {
    throw new Error(`usage: agulater ${usage}`);
  }
}

if (import.meta.main) {
  try {
    await run(Bun.argv.slice(2));
  } catch (error) {
    console.error(`agulater: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
