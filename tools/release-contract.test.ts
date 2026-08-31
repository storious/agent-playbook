import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(path, "utf8");

describe("standalone release contract", () => {
  test("tracks notices for every locked JavaScript package", () => {
    const lock = read("bun.lock");
    const notices = read("THIRD_PARTY_NOTICES");
    const packages = [...lock.matchAll(/^\s+"([^"]+)": \["[^"]+@([^"]+)"/gm)]
      .map((match) => `${match[1]} ${match[2]}`);

    expect(packages).toHaveLength(9);
    for (const dependency of packages) expect(notices).toContain(dependency);
    expect(notices).toContain("Bun runtime 1.4.0");
    expect(notices).toContain("bun-v1.4.0/LICENSE.md");
    expect(notices).not.toMatch(/Agulater \d+\.\d+\.\d+/);
  });

  test("ships project and third-party licenses in release archives and npm", () => {
    const metadata = JSON.parse(read("package.json")) as { files: string[] };
    const release = read(".github/workflows/release.yml");
    const ci = read(".github/workflows/ci.yml");

    expect(metadata.files).toContain("THIRD_PARTY_NOTICES");
    expect(release).toContain('cp LICENSE THIRD_PARTY_NOTICES "dist/${bundle}/"');
    expect(release).toContain('Copy-Item -LiteralPath "THIRD_PARTY_NOTICES"');
    expect(ci).toContain('grep -Fx "${bundle}/THIRD_PARTY_NOTICES"');
  });

  test("publishes GitHub artifacts before the optional npm path", () => {
    const release = read(".github/workflows/release.yml");
    const github = release.indexOf("publish-github:");
    const npm = release.indexOf("publish-npm:");

    expect(github).toBeGreaterThan(0);
    expect(npm).toBeGreaterThan(github);
    expect(release.slice(github, npm)).toContain("gh release create");
    expect(release.slice(npm)).toContain("if: env.NPM_TOKEN != ''");
    expect(release.slice(npm)).toContain("if: env.NPM_TOKEN == ''");
    expect(release).toContain('tarball="${PWD}/dist/agulater-${version}.tgz"');
  });

  test("uses the Agulater repository and keeps standalone install first", () => {
    const metadata = JSON.parse(read("package.json")) as {
      version: string;
      repository: { url: string };
      homepage: string;
      bugs: { url: string };
    };
    const assistant = JSON.parse(read(".agents/package.json")) as { version: string };
    const snapshot = JSON.parse(read(".agents/runtime/snapshot.json")) as {
      package: { version: string };
    };
    const readme = read("README.md");
    const runtime = read("docs/runtime.md");
    const scripts = `${read("scripts/install.sh")}\n${read("scripts/install.ps1")}`;
    const publicText = `${readme}\n${runtime}\n${scripts}\n${JSON.stringify(metadata)}`;

    expect(publicText).not.toContain("storious/agent-playbook");
    expect(metadata.repository.url).toBe("git+https://github.com/storious/agulater.git");
    expect(metadata.homepage).toBe("https://github.com/storious/agulater#readme");
    expect(metadata.bugs.url).toBe("https://github.com/storious/agulater/issues");
    expect(assistant.version).toBe(metadata.version);
    expect(snapshot.package.version).toBe(metadata.version);
    expect(read(".agents/runtime/instructions.md")).toBe(read(".agents/AGENTS.md"));

    const install = readme.indexOf("## Install the first experience release");
    const source = readme.indexOf("## Try the current source");
    expect(install).toBeGreaterThan(0);
    expect(source).toBeGreaterThan(install);
    expect(readme.slice(install, source)).toContain("do not need Bun, Node.js, or npm");
    expect(readme.slice(install, source)).toContain("v0.2.1-rc.2/install.sh");
    expect(readme.slice(install, source)).toContain("v0.2.1-rc.2/install.ps1");
    expect(readme.slice(install, source)).not.toContain("bun add");
    expect(runtime).toContain("v0.2.1-rc.2/install.sh");
    expect(runtime).toContain("v0.2.1-rc.2/install.ps1");
    expect(runtime).not.toContain("v0.2.1-rc.1/");
  });
});
