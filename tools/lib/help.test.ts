import { describe, expect, test } from "bun:test";
import { helpFor } from "./help.ts";
import { agulaterVersion } from "./version.ts";

describe("Agulater command help", () => {
  test("gives a concise first-run path before the command reference", () => {
    const output = helpFor([]);
    expect(output).toStartWith(`Agulater ${agulaterVersion}\n`);
    expect(output).toContain("Quick start:\n  agulater runtime install --channel next");
    expect(output).toContain("Package changes prepare automatically; use prepare after manual edits.");
    expect(output).toContain("Runtime:\n  runtime install");
    expect(output).toContain("Extensions:\n  catalog");
    expect(output).toContain("Packages:\n  create");
    expect(output).toContain("User setup:\n  setup user");
    expect(output).toContain("Docs: https://github.com/storious/agulater");
  });

  test("routes every command path to focused help", () => {
    for (const [args, expected, unrelated] of [
      [["create", "--help"], ".agents/package.json files are never replaced.", "runtime update"],
      [["add", "--help"], "Catalog id, local directory, or Git URL to install.", "runtime install"],
      [["update", "--help"], "--all", "catalog add <id>"],
      [["remove", "--help"], "Installed extension id to remove.", "runtime status"],
      [["prepare", "--help"], "Compile a .agents package into runtime state", "catalog search"],
      [["sync", "--help"], "--catalog <catalog.json>", "runtime status"],
      [["setup", "user", "--help"], "--if-missing", "catalog refresh"],
      [["migrate", "user", "--help"], "valid instructions and resources", "runtime install"],
      [["catalog", "--help"], "Discover extensions through registered Catalogs.", "--prefix"],
      [["catalog", "list", "--help"], "List registered Catalogs and their cache state.", "catalog add <id>"],
      [["catalog", "add", "--help"], "Register a Catalog without installing", "catalog search [query]"],
      [["catalog", "remove", "--help"], "Remove a Catalog registration", "catalog refresh [catalog]"],
      [["catalog", "refresh", "--help"], "default: every registered Catalog", "<url-or-path>"],
      [["catalog", "search", "--help"], "refreshed before the search", "catalog remove <id>"],
      [["runtime", "--help"], "Install and update standalone Agul runtimes.", "--type"],
      [["runtime", "install", "--help"], "default: stable on first install", "runtime update"],
      [["runtime", "update", "--help"], "current release channel and source are retained", "runtime install"],
      [["runtime", "status", "--help"], "Show the managed Agul runtime and launcher.", "--repository"],
    ] as const) {
      const output = helpFor(args);
      expect(output).toContain(expected);
      expect(output).not.toContain(unrelated);
    }
  });

  test("accepts help flags anywhere without hiding invalid non-help options", () => {
    expect(helpFor(["runtime", "--channel", "next", "install", "--help"])).toContain(
      "Install and activate an Agul runtime.",
    );
    expect(helpFor(["catalog", "search", "web", "-h"])).toContain(
      "Search registered Catalogs for extensions.",
    );
    expect(helpFor(["unknown", "--help"])).toContain("agulater <command> [options]");
  });

  test("keeps help readable in an ordinary terminal", () => {
    for (const args of [[], ["add"], ["catalog", "add"], ["runtime", "install"]]) {
      const longest = Math.max(...helpFor(args).split("\n").map((line) => line.length));
      expect(longest).toBeLessThanOrEqual(100);
    }
  });
});
