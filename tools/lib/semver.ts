export function compareSemVer(left: string, right: string): number {
  return Bun.semver.order(left, right);
}

export function satisfiesSemVer(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}
