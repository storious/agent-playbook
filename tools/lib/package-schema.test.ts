import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertPackageSchema } from "./package-schema.ts";

const validPackage = {
  format: "agulater/package/v2",
  id: "helper",
  version: "0.1.0",
  description: "A helper",
  instructions: "AGENTS.md",
};

describe("package-v2 schema", () => {
  test("accepts the minimal package", () => {
    expect(() => assertPackageSchema(validPackage, "package.json")).not.toThrow();
  });

  test("reports nested structure errors without Ajv internals", () => {
    expectFailure(
      { resources: { skills: [{ id: "review", path: "skills/review", unexpected: true }] } },
      "package.json.resources.skills[0] has unknown field unexpected",
    );
    expectFailure(
      { dependencies: { skills: [{ id: "review", source: { type: "path" } }] } },
      "package.json.dependencies.skills[0].source needs path",
    );
    expectFailure(
      { dependencies: { skills: [{ id: "review", source: { type: "git" } }] } },
      "package.json.dependencies.skills[0].source needs url",
    );
    expectFailure(
      { dependencies: { skills: [{ id: "review", source: { type: "other" } }] } },
      "package.json.dependencies.skills[0].source.type must be catalog, host, path, or git",
    );
  });

  test("selects the declared dependency-source branch", () => {
    expectFailure(
      { dependencies: { skills: [{ id: "review", source: { type: "path", path: "skills/review", url: "extra" } }] } },
      "package.json.dependencies.skills[0].source has unknown field url",
    );
  });

  test("ships a self-contained generated validator", () => {
    const source = readFileSync(join(import.meta.dir, "..", "generated", "package-v2-validator.js"), "utf8");
    expect(source).not.toMatch(/^(?:import .* from ["']ajv|[^'"\r\n]*=\s*require\(["']ajv)/m);
  });
});

function expectFailure(extra: Record<string, unknown>, message: string): void {
  let error: Error | undefined;
  try {
    assertPackageSchema({ ...validPackage, ...extra }, "package.json");
  } catch (caught) {
    error = caught as Error;
  }
  expect(error?.message).toBe(message);
  expect(error?.message).not.toMatch(/oneOf|schemaPath|pattern/);
}
