import { agulaterVersion } from "./version.ts";

type HelpItem = readonly [label: string, description: string];

type HelpSection = {
  title: string;
  items?: readonly HelpItem[];
  lines?: readonly string[];
};

type HelpPage = {
  heading: string;
  details?: readonly string[];
  usage: readonly string[];
  sections?: readonly HelpSection[];
  footer?: readonly string[];
};

const helpOption: HelpItem = ["-h, --help", "Show help for this command."];
const jsonOption: HelpItem = ["--json", "Print machine-readable JSON."];
const catalogHomeOption: HelpItem = [
  "--home <directory>",
  "Override the home that stores Catalog registrations.",
];
const runtimeHomeOption: HelpItem = [
  "--home <directory>",
  "Override the home used for default install paths.",
];

const targetOptions: readonly HelpItem[] = [
  ["--path <workspace>", "Target <workspace>/.agents (default: current directory)."],
  ["--user", "Target the user package at <home>/.agents."],
  ["--home <directory>", "Override home for user packages, Catalogs, and the managed Store."],
];

const sourceTypeOption: HelpItem = [
  "--type <type>",
  "Select skill, plugin, or package; required when the source is ambiguous.",
];

const pages: Readonly<Record<string, HelpPage>> = {
  create: {
    heading: "Create a minimal .agents package for a workspace.",
    details: [
      "The package name defaults to the workspace directory name. Existing",
      ".agents/package.json files are never replaced.",
    ],
    usage: ["agulater create [name] [--path <workspace>]"],
    sections: [
      {
        title: "Arguments",
        items: [["[name]", "Package id to create (default: workspace directory name)."]],
      },
      {
        title: "Options",
        items: [targetOptions[0]!, helpOption],
      },
      {
        title: "Examples",
        lines: ["agulater create", "agulater create project-helper --path ./my-project"],
      },
    ],
  },
  add: {
    heading: "Install one Skill, Plugin, or Package and prepare the target.",
    details: [
      "<source> may be a Catalog reference such as agentkube:web-search, a local",
      "directory, or a Git URL. A missing project .agents package is created.",
    ],
    usage: [
      "agulater add <source> [--type <type>] [--name <name>]",
      "                    [--path <workspace> | --user] [--home <directory>] [--json]",
    ],
    sections: [
      {
        title: "Arguments",
        items: [["<source>", "Catalog id, local directory, or Git URL to install."]],
      },
      {
        title: "Options",
        items: [
          sourceTypeOption,
          ["--name <name>", "Select a named resource from a local or Git collection, not a Catalog."],
          ...targetOptions,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: [
          "agulater add agentkube:web-search --path . --type plugin",
          "agulater add ./skills/review --user --type skill",
        ],
      },
    ],
  },
  update: {
    heading: "Update installed extensions and prepare the target.",
    details: [
      "Catalog and Git sources can be updated together with --all. Name a local",
      "extension explicitly when you want its source directory recopied.",
    ],
    usage: [
      "agulater update <name> [--type <type>] [--path <workspace> | --user]",
      "                       [--home <directory>] [--json]",
      "agulater update --all [--type <type>] [--path <workspace> | --user]",
      "                      [--home <directory>] [--json]",
    ],
    sections: [
      {
        title: "Arguments",
        items: [["<name>", "Installed extension id to update."]],
      },
      {
        title: "Options",
        items: [
          ["--all", "Update every installed Catalog or Git extension."],
          sourceTypeOption,
          ...targetOptions,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater update web-search --path .", "agulater update --all --user"],
      },
    ],
  },
  remove: {
    heading: "Remove an installed extension and prepare the target.",
    usage: [
      "agulater remove <name> [--type <type>]",
      "                       [--path <workspace> | --user] [--home <directory>]",
    ],
    sections: [
      {
        title: "Arguments",
        items: [["<name>", "Installed extension id to remove."]],
      },
      {
        title: "Options",
        items: [sourceTypeOption, ...targetOptions, helpOption],
      },
      {
        title: "Examples",
        lines: ["agulater remove web-search --path . --type plugin"],
      },
    ],
  },
  prepare: {
    heading: "Compile a .agents package into runtime state Agul can load.",
    details: [
      "Preparation validates the package and replaces .agents/runtime only after",
      "the new launch, resources, Specialists, and Pools are complete.",
    ],
    usage: ["agulater prepare [--path <workspace> | --user] [--home <directory>]"],
    sections: [
      { title: "Options", items: [...targetOptions, helpOption] },
      {
        title: "Examples",
        lines: ["agulater prepare --path .", "agulater prepare --user"],
      },
    ],
  },
  sync: {
    heading: "Install declared dependencies, then prepare the target.",
    details: [
      "Catalog and Git dependencies are copied into the managed Store at their",
      "resolved versions. Host and local path dependencies stay in place.",
    ],
    usage: [
      "agulater sync [--catalog <catalog.json>]",
      "               [--path <workspace> | --user] [--home <directory>]",
    ],
    sections: [
      {
        title: "Options",
        items: [
          ["--catalog <catalog.json>", "Use an explicit Catalog file for dependency resolution."],
          ...targetOptions,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater sync --path .", "agulater sync --catalog ./catalog/catalog.json --user"],
      },
    ],
  },
  "setup user": {
    heading: "Create or prepare the default user .agents package.",
    details: [
      "New setups include the AgentKube Catalog registration without installing",
      "extensions. Existing unmanaged .agents directories are left untouched.",
    ],
    usage: ["agulater setup user [--if-missing] [--home <directory>]"],
    sections: [
      {
        title: "Options",
        items: [
          ["--if-missing", "Leave any existing user package unchanged."],
          ["--home <directory>", "Set the home that contains .agents."],
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater setup user --if-missing"],
      },
    ],
  },
  "migrate user": {
    heading: "Migrate a legacy user package to the current format.",
    details: [
      "Converts an agulater/package/v1 manifest to strict v2 while preserving",
      "valid instructions and resources. Unsupported legacy agents are rejected.",
    ],
    usage: ["agulater migrate user [--home <directory>]"],
    sections: [
      {
        title: "Options",
        items: [["--home <directory>", "Set the home that contains .agents."], helpOption],
      },
      {
        title: "Examples",
        lines: ["agulater migrate user"],
      },
    ],
  },
  catalog: {
    heading: "Discover extensions through registered Catalogs.",
    details: [
      "Registration never installs an extension. Search refreshes a Catalog when",
      "its local cache is missing; add installs a selected result separately.",
    ],
    usage: ["agulater catalog <command> [options]"],
    sections: [
      {
        title: "Commands",
        items: [
          ["list", "List registered Catalogs and cache state."],
          ["add", "Register a Catalog id and URL or local path."],
          ["remove", "Remove a Catalog registration and cache."],
          ["refresh", "Refresh one or every registered Catalog."],
          ["search", "Search extension ids, names, and descriptions."],
        ],
      },
      {
        title: "Examples",
        lines: ["agulater catalog search web", "agulater catalog refresh agentkube"],
      },
    ],
    footer: ["Run agulater catalog <command> --help for command options."],
  },
  "catalog list": {
    heading: "List registered Catalogs and their cache state.",
    usage: ["agulater catalog list [--home <directory>] [--json]"],
    sections: [
      {
        title: "Options",
        items: [
          catalogHomeOption,
          jsonOption,
          helpOption,
        ],
      },
    ],
  },
  "catalog add": {
    heading: "Register a Catalog without installing its extensions.",
    usage: ["agulater catalog add <id> <url-or-path> [--home <directory>] [--json]"],
    sections: [
      {
        title: "Arguments",
        items: [
          ["<id>", "Short name used in references such as <id>:web-search."],
          ["<url-or-path>", "HTTP(S) URL or local path to an agulater/catalog/v1 file."],
        ],
      },
      {
        title: "Options",
        items: [
          catalogHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: [
          "agulater catalog add agentkube <catalog-url>",
          "agulater catalog add local ./catalog/catalog.json",
        ],
      },
    ],
  },
  "catalog remove": {
    heading: "Remove a Catalog registration and its local cache.",
    usage: ["agulater catalog remove <id> [--home <directory>] [--json]"],
    sections: [
      { title: "Arguments", items: [["<id>", "Registered Catalog id to remove."]] },
      {
        title: "Options",
        items: [
          catalogHomeOption,
          jsonOption,
          helpOption,
        ],
      },
    ],
  },
  "catalog refresh": {
    heading: "Refresh one or every registered Catalog cache.",
    usage: ["agulater catalog refresh [catalog] [--home <directory>] [--json]"],
    sections: [
      {
        title: "Arguments",
        items: [["[catalog]", "Catalog id to refresh (default: every registered Catalog)."]],
      },
      {
        title: "Options",
        items: [
          catalogHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater catalog refresh", "agulater catalog refresh agentkube"],
      },
    ],
  },
  "catalog search": {
    heading: "Search registered Catalogs for extensions.",
    details: ["Catalogs without a local cache are refreshed before the search."],
    usage: ["agulater catalog search [query] [--home <directory>] [--json]"],
    sections: [
      {
        title: "Arguments",
        items: [["[query]", "Text matched against extension ids, names, and descriptions."]],
      },
      {
        title: "Options",
        items: [
          catalogHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater catalog search", "agulater catalog search web"],
      },
    ],
  },
  runtime: {
    heading: "Install and update standalone Agul runtimes.",
    details: [
      "Agulater selects a release, verifies its version, and switches a small",
      "launcher. It never starts Agul or participates in a model session.",
    ],
    usage: ["agulater runtime <command> [options]"],
    sections: [
      {
        title: "Commands",
        items: [
          ["install", "Install and activate an Agul release."],
          ["update", "Update the managed runtime without downgrading."],
          ["status", "Show the active version, channel, and launcher."],
        ],
      },
      {
        title: "Examples",
        lines: ["agulater runtime install --channel next", "agulater runtime status"],
      },
    ],
    footer: ["Run agulater runtime <command> --help for command options."],
  },
  "runtime install": {
    heading: "Install and activate an Agul runtime.",
    details: [
      "The first install uses the stable channel unless --channel next is given.",
      "Public GitHub releases work without gh; authenticated gh is used when available.",
    ],
    usage: [
      "agulater runtime install [--channel <stable|next>] [--prefix <directory>]",
      "                         [--repository <owner/name> | --url <release-index>]",
      "                         [--home <directory>] [--json]",
    ],
    sections: [
      {
        title: "Options",
        items: [
          ["--channel <stable|next>", "Select the release channel (default: stable on first install)."],
          ["--prefix <directory>", "Keep versions and the launcher below a custom directory."],
          ["--repository <owner/name>", "GitHub release repository (default: storious/agul)."],
          ["--url <release-index>", "Local path or URL to agulater/runtime-releases/v1."],
          runtimeHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: [
          "agulater runtime install --channel next",
          "agulater runtime install --prefix ./tools/agul --channel stable",
        ],
      },
    ],
  },
  "runtime update": {
    heading: "Update the managed Agul runtime without downgrading.",
    details: ["The current release channel and source are retained unless overridden."],
    usage: [
      "agulater runtime update [--channel <stable|next>] [--prefix <directory>]",
      "                        [--repository <owner/name> | --url <release-index>]",
      "                        [--home <directory>] [--json]",
    ],
    sections: [
      {
        title: "Options",
        items: [
          ["--channel <stable|next>", "Switch channels or keep the currently installed channel."],
          ["--prefix <directory>", "Select a custom managed runtime directory."],
          ["--repository <owner/name>", "Use releases from another GitHub repository."],
          ["--url <release-index>", "Use a local or remote runtime release index."],
          runtimeHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater runtime update", "agulater runtime update --channel next"],
      },
    ],
  },
  "runtime status": {
    heading: "Show the managed Agul runtime and launcher.",
    usage: ["agulater runtime status [--prefix <directory>] [--home <directory>] [--json]"],
    sections: [
      {
        title: "Options",
        items: [
          ["--prefix <directory>", "Inspect a custom managed runtime directory."],
          runtimeHomeOption,
          jsonOption,
          helpOption,
        ],
      },
      {
        title: "Examples",
        lines: ["agulater runtime status", "agulater runtime status --json"],
      },
    ],
  },
};

const topLevelPage = (): HelpPage => ({
  heading: `Agulater ${agulaterVersion}`,
  details: [
    "Install Agul, manage extensions, and prepare .agents packages.",
    "Agulater configures the runtime; run agul to start the agent.",
    "Package changes prepare automatically; use prepare after manual edits.",
  ],
  usage: ["agulater <command> [options]"],
  sections: [
    {
      title: "Quick start",
      lines: [
        "agulater runtime install --channel next",
        "agulater catalog search web",
        "agulater add agentkube:web-search --path . --type plugin",
        "agul",
      ],
    },
    {
      title: "Runtime",
      items: [
        ["runtime install", "Install and activate an Agul release."],
        ["runtime update", "Update the managed Agul runtime."],
        ["runtime status", "Show the active version and launcher."],
      ],
    },
    {
      title: "Extensions",
      items: [
        ["catalog", "Discover extensions through registered Catalogs."],
        ["add", "Install one Skill, Plugin, or Package."],
        ["update", "Update installed extensions."],
        ["remove", "Remove an installed extension."],
      ],
    },
    {
      title: "Packages",
      items: [
        ["create", "Create a minimal project .agents package."],
        ["prepare", "Compile a package into runtime state for Agul."],
        ["sync", "Install declared dependencies and prepare."],
      ],
    },
    {
      title: "User setup",
      items: [
        ["setup user", "Create or prepare the default user package."],
        ["migrate user", "Migrate an Agulater-generated legacy package."],
      ],
    },
    {
      title: "Global options",
      items: [helpOption, ["-V, --version", "Print the Agulater version."]],
    },
  ],
  footer: [
    "Run agulater <command> --help for command options and examples.",
    "Docs: https://github.com/storious/agulater",
  ],
});

const catalogCommands = new Set(["list", "add", "remove", "refresh", "search"]);
const runtimeCommands = new Set(["install", "update", "status"]);

export function helpFor(args: readonly string[]): string {
  const key = helpKey(args);
  const page = key ? pages[key] : undefined;
  return renderHelp(page ?? topLevelPage());
}

function helpKey(args: readonly string[]): string | undefined {
  const [command] = args;
  if (!command || command.startsWith("-")) return undefined;
  if (command === "catalog") return nestedKey(command, args, catalogCommands);
  if (command === "runtime") return nestedKey(command, args, runtimeCommands);
  if (command === "setup" || command === "migrate") return `${command} user`;
  return pages[command] ? command : undefined;
}

function nestedKey(group: string, args: readonly string[], commands: ReadonlySet<string>): string {
  const action = args.slice(1).find((argument) => commands.has(argument));
  return action ? `${group} ${action}` : group;
}

function renderHelp(page: HelpPage): string {
  const lines = [page.heading];
  if (page.details) lines.push(...page.details);
  lines.push("", "Usage:", ...page.usage.map((usage) => `  ${usage}`));
  for (const section of page.sections ?? []) {
    lines.push("", `${section.title}:`);
    if (section.items) lines.push(...renderItems(section.items));
    if (section.lines) lines.push(...section.lines.map((line) => `  ${line}`));
  }
  if (page.footer?.length) lines.push("", ...page.footer);
  return lines.join("\n");
}

function renderItems(items: readonly HelpItem[]): string[] {
  const width = Math.max(...items.map(([label]) => label.length));
  return items.map(([label, description]) => `  ${label.padEnd(width)}  ${description}`);
}
