import { describe, expect, test } from "bun:test";

import { compareSemVer, satisfiesSemVer } from "./semver.ts";

describe("Bun-backed SemVer", () => {
  test("orders releases and numeric prerelease identifiers", () => {
    expect(compareSemVer("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemVer("1.0.0-alpha.2", "1.0.0-alpha.10")).toBeLessThan(0);
    expect(compareSemVer("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });

  test("uses standard caret, tilde, and prerelease ranges", () => {
    expect(satisfiesSemVer("0.0.3", "^0.0.3")).toBeTrue();
    expect(satisfiesSemVer("0.0.4", "^0.0.3")).toBeFalse();
    expect(satisfiesSemVer("0.2.9", "^0.2.0")).toBeTrue();
    expect(satisfiesSemVer("0.3.0", "^0.2.0")).toBeFalse();
    expect(satisfiesSemVer("0.0.4", "~0.0.3")).toBeTrue();
    expect(satisfiesSemVer("2.0.0", ">=1.9.0")).toBeTrue();
    expect(satisfiesSemVer("1.2.4-rc.1", "^1.2.3")).toBeFalse();
    expect(satisfiesSemVer("2.0.0-rc.1", ">=1.0.0")).toBeFalse();
    expect(satisfiesSemVer("1.2.3-rc.2", "^1.2.3-rc.1")).toBeTrue();
    expect(satisfiesSemVer("1.3.0-rc.1", "^1.2.3-rc.1")).toBeFalse();
  });
});
